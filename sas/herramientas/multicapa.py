# SetiAstroPilot — varios masters del mismo objeto: alinearlos, separar un dual band y combinar con el RGB.
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# Adaptación de siril/herramientas/multicapa.py a SASpro, con vistas en vez de la imagen cargada:
# alinearMasters: alinea varios masters (ficheros) contra el de referencia por su ASTROMETRÍA (los de WBPP vienen
#   resueltos): cada uno se reproyecta al WCS de la referencia con reproject (va con SASpro), se recorta todo a la zona
#   común con datos y se guarda como XISF nuevo en la carpeta pedida. Los ficheros del usuario no se tocan. SASpro no
#   tiene un comando sin ventana para alinear por estrellas.
# desmezclarDualBand: de una vista OSC con filtro dual band (Hα + OIII), Hα = rojo y OIII = media de verde y azul, en
#   lineal, como vistas mono nuevas (y ficheros si se pide carpeta).
# combinarCandidatos: sobre la vista RGB lineal, compara formas de añadir la banda estrecha (exceso de Hα al rojo y,
#   opcional, de OIII a verde y azul) a varias intensidades; mide nebulosa ganada, ruido y dominante del cielo y color
#   de las estrellas. La vista no cambia hasta aplicarCandidato(id). Mismos criterios que en Siril.
# combinarRGB: tres vistas mono alineadas (R, G, B) → vista RGB nueva, en lineal, sin escalar canales.

import time
from pathlib import Path

import numpy as np

import herramientas as H
import medidas as M

_r = H._r


# --- lectura de ficheros sin abrir vistas -------------------------------------------------------------------

def _leer(ctx, ruta):
    """Fichero -> (array (canales, alto, ancho) float32, cabecera, metadatos). ctx.load_image lee sin abrir vista
    (abrir un master de WBPP abre además sus mapas de rechazo)."""
    r = ctx.load_image(str(ruta), return_metadata=True)
    img = cab = meta = None
    for x in (r if isinstance(r, (tuple, list)) else (r,)):
        if img is None and isinstance(x, np.ndarray):
            img = x
        elif meta is None and isinstance(x, dict):
            meta = x
        elif cab is None and hasattr(x, "keys") and hasattr(x, "get") and not isinstance(x, dict):
            cab = x
    if img is None:
        raise RuntimeError(f"SASpro no ha podido leer {ruta}.")
    meta = meta or {}
    cab = cab if cab is not None else (meta.get("fits_header") or meta.get("original_header"))
    return H._p(img), cab, meta


def _wcs_valido(w, forma):
    """Un WCS resuelto tiene el píxel de referencia dentro (o cerca) de la imagen. Los masters de WBPP traen RA/DEC y
    CDELT pero no CRPIX: SASpro arma un WCS con CRPIX 0 que no vale (IC 1396: CRPIX1 −80; M31 60 s: 354 px de error)."""
    try:
        cx, cy = float(w.wcs.crpix[0]), float(w.wcs.crpix[1])
        h, wd = forma
        return -0.25 * wd < cx < 1.25 * wd and -0.25 * h < cy < 1.25 * h and abs(cx) > 1 and abs(cy) > 1
    except Exception:
        return False


def _wcs(cab, meta, forma=None):
    """WCS celeste de un fichero (el de SASpro o el de la cabecera), sólo si es válido para 'forma'."""
    from astropy.wcs import WCS
    cands = []
    w = meta.get("wcs")
    if w is not None and getattr(w, "has_celestial", False):
        cands.append(w.celestial)
    for h in (meta.get("wcs_header"), cab):
        if h is None:
            continue
        try:
            w = WCS(h, naxis=2)
            if w.has_celestial and "CRPIX1" in h:
                cands.append(w.celestial)
        except Exception:
            continue
    for w in cands:
        if forma is None or _wcs_valido(w, forma):
            return w
    return None


def _desplazar(p, dx, dy):
    """Traslación entera de (canales, alto, ancho) rellenando con 0 (luego se recorta a la zona común)."""
    q = np.zeros_like(p)
    h, w = p.shape[1:]
    dx, dy = int(round(dx)), int(round(dy))
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    q[:, yd, xd] = p[:, ys, xs]
    return q


def _mascara_datos(L, b=8):
    """True donde hay datos (como en Siril): bloques b×b planos y bajos conectados con el borde = sin datos."""
    L = np.nan_to_num(np.asarray(L, dtype=np.float64), nan=0.0, posinf=1.0, neginf=0.0)
    H_, W_ = L.shape
    med = float(np.median(L[::4, ::4]))
    d = L[:, 1:] - L[:, :-1]
    ruido = 1.4826 * float(np.median(np.abs(d[::4, ::4]))) / np.sqrt(2)
    hb, wb = H_ // b, W_ // b
    blk = L[:hb * b, :wb * b].reshape(hb, b, wb, b)
    sd, mn = blk.std(axis=(1, 3)), blk.mean(axis=(1, 3))
    vacio = ((sd < 0.2 * max(ruido, 1e-12)) & (mn < 0.5 * med)) | (mn < 1e-6)
    c = np.zeros_like(vacio)
    c[0, :], c[-1, :] = vacio[0, :], vacio[-1, :]
    c[:, 0] |= vacio[:, 0]
    c[:, -1] |= vacio[:, -1]
    for _ in range(hb + wb):
        n = c.copy()
        n[1:] |= c[:-1]; n[:-1] |= c[1:]; n[:, 1:] |= c[:, :-1]; n[:, :-1] |= c[:, 1:]
        n &= vacio
        if (n == c).all():
            break
        c = n
    datos = np.ones((H_, W_), bool)
    datos[:hb * b, :wb * b] = ~np.kron(c, np.ones((b, b), bool))
    return datos


def _rect_con_datos(datos):
    """Mayor rectángulo centrado con datos en todas las filas y columnas (recorte de cuñas)."""
    H_, W_ = datos.shape
    y0, y1, x0, x1 = 0, H_, 0, W_
    for _ in range(4 * max(H_, W_)):
        sub = datos[y0:y1, x0:x1]
        if sub.all() or (y1 - y0) < 16 or (x1 - x0) < 16:
            break
        malos = {"arriba": 1 - sub[0].mean(), "abajo": 1 - sub[-1].mean(),
                 "izq": 1 - sub[:, 0].mean(), "der": 1 - sub[:, -1].mean()}
        lado = max(malos, key=malos.get)
        paso = max(1, int(0.002 * max(H_, W_)))
        if lado == "arriba":
            y0 += paso
        elif lado == "abajo":
            y1 -= paso
        elif lado == "izq":
            x0 += paso
        else:
            x1 -= paso
    return x0, y0, x1, y1


def _desfase_residual(a, b, lado=1024):
    """Desplazamiento (dx, dy) en px de b respecto a a, medido por correlación de fase de las estrellas (paso alto) en un
    recorte central: comprueba el alineado sin fiarse sólo de la astrometría."""
    def prep(x):
        h, w = x.shape
        y0, x0 = max(0, h // 2 - lado // 2), max(0, w // 2 - lado // 2)
        s = x[y0:y0 + lado, x0:x0 + lado].astype(np.float64)
        s = s - M._caja(s.astype(np.float32), 3)
        s = np.clip(s, 0, None)
        v = np.hanning(s.shape[0])[:, None] * np.hanning(s.shape[1])[None, :]
        return s * v
    A, B = np.fft.fft2(prep(a)), np.fft.fft2(prep(b))
    R = A * np.conj(B)
    R /= np.maximum(np.abs(R), 1e-12)
    c = np.abs(np.fft.ifft2(R))
    iy, ix = np.unravel_index(int(np.argmax(c)), c.shape)
    h, w = c.shape
    dy = iy if iy <= h // 2 else iy - h
    dx = ix if ix <= w // 2 else ix - w
    return -float(dx), -float(dy), float(c.max() / max(c.mean(), 1e-12))


def _cabecera_recortada(cab, w, x0, y0):
    """Cabecera de la referencia con el WCS del recorte (CRPIX desplazado)."""
    from astropy.io.fits import Header
    h = Header()
    if cab is not None:
        try:
            h = cab.copy()
        except Exception:
            pass
    import re as _re
    for k in list(h.keys()):                       # el WCS propio (otro marco, o incompleto como el de WBPP) fuera
        if _re.match(r"^(CTYPE|CRVAL|CRPIX|CUNIT|CD\d_|PC\d_|CDELT|CROTA|A_|B_|AP_|BP_|LONPOLE|LATPOLE|WCSAXES|RADESYS|EQUINOX|PLTSOLVD)", str(k)):
            try:
                del h[k]
            except Exception:
                pass
    if w is not None:
        wc = w.deepcopy()
        wc.wcs.crpix = [wc.wcs.crpix[0] - x0, wc.wcs.crpix[1] - y0]
        for k, v in wc.to_header(relax=True).items():
            h[k] = v
    return h


def alinearMasters(ctx, ficheros, carpeta=None, referencia=1):
    """Paso 5 lineal: alinea los masters contra el de 'referencia' (1 = el primero) por su astrometría y los recorta a la
    zona común con datos en todos. Guarda <nombre>_alin.xisf en 'carpeta' (por defecto <carpeta del primero>/alineados_sas)."""
    from reproject import reproject_interp
    if isinstance(ficheros, str):
        ficheros = [x.strip() for x in ficheros.split(";") if x.strip()]
    fs = [H._ruta(f) for f in ficheros]
    if len(fs) < 2:
        raise ValueError("alinearMasters necesita al menos dos ficheros.")
    for f in fs:
        if not f.is_file():
            raise FileNotFoundError(f"No existe {f}.")
    destino = H._ruta(carpeta) if carpeta else fs[0].parent / "alineados_sas"
    destino.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    iref = int(referencia) - 1
    pref, cref, mref = _leer(ctx, fs[iref])
    forma = pref.shape[1:]
    wref = _wcs(cref, mref, forma)
    metodo = "reproyección al WCS de la referencia (reproject)"
    if wref is None:
        # Sin WCS válido (p. ej. masters de WBPP: RA/DEC sin CRPIX), alineado por estrellas: traslación medida por
        # correlación de fase. Vale para masters de la misma sesión o con el mismo encuadre; si hay giro, resolver antes.
        metodo = "traslación por estrellas (sin astrometría válida en la referencia)"
    alineados, info, datos = [], [], None
    for i, f in enumerate(fs):
        if i == iref:
            p, cab, w = pref, cref, wref
        else:
            p, cab, meta = _leer(ctx, f)
            if p.shape[1:] != forma and wref is None:
                raise RuntimeError(f"{f.name} mide {p.shape[2]}×{p.shape[1]} y la referencia {forma[1]}×{forma[0]}, y no hay "
                                   "astrometría válida para reproyectar: resuelve los masters antes (resolverAstrometria).")
            w = _wcs(cab, meta, p.shape[1:]) if wref is not None else None
            if wref is not None and w is None:
                raise RuntimeError(f"{f.name} no tiene astrometría válida: resuélvela antes o alinéalos en otro programa.")
            if wref is not None:
                canales = []
                for c in range(p.shape[0]):
                    out, _ = reproject_interp((p[c], w), wref, shape_out=forma, order="bilinear")
                    canales.append(np.nan_to_num(out, nan=0.0).astype(np.float32))
                p = np.stack(canales)
                cen = w.pixel_to_world(p.shape[2] / 2, p.shape[1] / 2)
                x, y = wref.world_to_pixel(cen)
                info.append({"fichero": f.name, "desplazamiento_px": [_r(float(x) - forma[1] / 2, 1),
                                                                      _r(float(y) - forma[0] / 2, 1)]})
            else:
                dx, dy, pico = _desfase_residual(pref.mean(axis=0), p.mean(axis=0))
                if pico < 8:
                    raise RuntimeError(f"{f.name}: no encuentro el desplazamiento por estrellas (confianza {pico:.0f}): "
                                       "resuelve la astrometría de los masters antes.")
                p = _desplazar(p, -dx, -dy)
                info.append({"fichero": f.name, "desplazamiento_px": [_r(-dx, 1), _r(-dy, 1)]})
        if i != iref:
            dx, dy, pico = _desfase_residual(pref.mean(axis=0), p.mean(axis=0))
            info[-1]["residuo_estrellas_px"] = [_r(dx, 1), _r(dy, 1)]
            info[-1]["confianza"] = _r(pico, 1)
            if pico > 8 and max(abs(dx), abs(dy)) > 1.5:
                raise RuntimeError(f"{f.name}: tras reproyectar, las estrellas siguen desplazadas ({dx:+.0f}, {dy:+.0f}) px "
                                   "respecto a la referencia: su astrometría no es buena. Resuélvela de nuevo antes.")
        m = _mascara_datos(p.mean(axis=0))
        datos = m if datos is None else (datos & m)
        alineados.append((f, p, cab))
    x0, y0, x1, y1 = _rect_con_datos(datos)
    # Margen de seguridad: la interpolación del reproyectado deja 1–3 px mezclados con el relleno en el borde de los
    # datos (IC 1396: línea rojiza fina en el borde de las capas SII/OIII). 8 px fuera.
    m = 8
    x0, y0, x1, y1 = x0 + m, y0 + m, x1 - m, y1 - m
    if (x1 - x0) < forma[1] * 0.5 or (y1 - y0) < forma[0] * 0.5:
        raise RuntimeError(f"La zona común con datos es menor que la mitad ({x1 - x0}×{y1 - y0}): ¿son del mismo campo?")
    salidas = []
    for f, p, cab in alineados:
        rec = np.ascontiguousarray(p[:, y0:y1, x0:x1], dtype=np.float32)
        # Su propia cabecera (filtro, exposición, objeto…) con el WCS de la referencia recortado encima. Con la de la
        # referencia, el HaO3 de IC 1396 salía como «sin filtro» (14 nov 2026).
        h = _cabecera_recortada(cab if cab is not None else cref, wref, x0, y0)
        dst = H._libre(destino / f"{f.stem}_alin.xisf")
        img = rec[0] if rec.shape[0] == 1 else np.moveaxis(rec, 0, -1)
        ctx.save_image(np.ascontiguousarray(img), str(dst), original_format="xisf", bit_depth="32-bit floating point",
                       original_header=h, is_mono=(rec.shape[0] == 1))
        salidas.append(str(dst))
    r = {"alineados": salidas, "referencia": str(fs[iref]), "metodo": metodo,
         "desplazamientos": info, "recorte_comun": [x0, y0, x1, y1], "tam_comun": [x1 - x0, y1 - y0],
         "segundos": _r(time.perf_counter() - t0, 1),
         "nota": "Recortados todos al mismo rectángulo con datos en todos. Ábrelos con abrirImagen; el dual band se "
                 "separa con desmezclarDualBand."}
    if wref is None:
        r["aviso"] = ("Sin astrometría válida: los alineados se guardan sin WCS. Resuelve la referencia alineada "
                      "(resolverAstrometria) antes del color por estrellas o de documentarObjeto.")
    return r


def desmezclarDualBand(ctx, vista=None, carpeta=None):
    """Paso 7 lineal: capas Hα (rojo) y OIII (media de verde y azul) de una vista OSC dual band, en lineal, como vistas
    mono nuevas (<vista>_Ha, <vista>_OIII) y, con carpeta, también como XISF."""
    d = H._doc(ctx, vista)
    p = H._p(d.image)
    if p.shape[0] != 3:
        raise RuntimeError("desmezclarDualBand necesita el master dual band en color (3 canales).")
    if not M.lineal(p[:, ::8, ::8]):
        raise RuntimeError("El dual band parece estirado: se separa en lineal (Paso 7, antes del gradiente y del color).")
    ha, o3 = p[0].astype(np.float32), (0.5 * (p[1] + p[2])).astype(np.float32)
    base = H._seguro(Path(H._nombre(d)).stem)
    out = {}
    meta = dict(H._meta(d))
    meta.pop("file_path", None)
    for etiqueta, capa in (("Ha", ha), ("OIII", o3)):
        m = dict(meta)
        m["display_name"] = f"{base}_{etiqueta}"
        m["mono"] = True
        nuevo = ctx.open_new_document(np.ascontiguousarray(capa), metadata=m, name=f"{base}_{etiqueta}")
        c = M.cielo(capa[np.newaxis])
        ruido = c["ruido_rel"] * c["cielo"]
        senal = float(np.percentile(capa[::3, ::3], 99.5)) - c["cielo"]
        out[etiqueta] = {"vista": H._nombre(H._base(nuevo)) if nuevo is not None else f"{base}_{etiqueta}",
                         "cielo": c["cielo"], "ruido": _r(ruido, 6), "senal_p995_en_ruidos": _r(senal / max(ruido, 1e-9), 1)}
        if carpeta:
            dst = H._libre(H._ruta(carpeta) / f"{base}_{etiqueta}.xisf")
            dst.parent.mkdir(parents=True, exist_ok=True)
            ctx.save_image(np.ascontiguousarray(capa), str(dst), original_format="xisf",
                           bit_depth="32-bit floating point", original_header=H._cabecera_para_guardar(H._meta(d), capa.shape),
                           is_mono=True)
            out[etiqueta]["fichero"] = str(dst)
    H._reactivar(ctx, d)
    return {"capas": out, "metodo": "Hα = rojo; OIII = (verde + azul) / 2 (matriz Bayer con filtro dual band)",
            "vista_activa": H._nombre(d),
            "nota": "Capas lineales en vistas nuevas. Gradiente de cada capa con gradienteCandidatos(vista); después "
                    "combinarCandidatos(ha, oiii, vista=<RGB lineal ya calibrado de color>)."}


# --- combinar la banda estrecha con el RGB (criterios de Siril) --------------------------------------------

def _peso_senal(nb, mn, sn):
    """Peso 0–1 de dónde la banda estrecha tiene señal, medido sobre la capa SUAVIZADA (radio ~6 px) y con una rampa
    de 1 a 4 σ del ruido suavizado. Píxel a píxel, el umbral seguía el ruido y la máscara salía a manchas de borde duro
    que se veían con intensidad ×2 (IC 1396, 14 nov 2026)."""
    s = M.suave(np.asarray(nb, dtype=np.float32), 12)
    ss = max(sn / 6.0, 1e-9)          # ruido de la media en ~36 px
    return np.clip(((s - mn) / ss - 1.0) / 3.0, 0, 1).astype(np.float32)


def _excesos(base, nb, cielo_px, estrellas_px, obj_px):
    mb, mn = float(np.median(base[cielo_px])), float(np.median(nb[cielo_px]))
    sn = 1.4826 * float(np.median(np.abs(nb[cielo_px] - mn)))
    zona = obj_px & ~estrellas_px & ((nb - mn) > 3 * max(sn, 1e-9))
    if zona.sum() < 500:
        zona = ~estrellas_px & ((nb - mn) > 3 * max(sn, 1e-9))
    k = float(np.median((base[zona] - mb) / np.maximum(nb[zona] - mn, 1e-9))) if zona.sum() >= 100 else 1.0
    k = float(np.clip(k, 0.05, 20))
    ex = np.clip((nb - mn) * k - (base - mb), 0, None)
    ex = ex * _peso_senal(nb, mn, sn)
    ex[estrellas_px] = 0
    return ex, _r(k, 4)


def _flujos_estrellas(base, nb, max_n=600):
    hp = nb - M._caja(nb, 5)
    s = 1.4826 * float(np.median(np.abs(hp[::4, ::4] - np.median(hp[::4, ::4]))))
    cand = hp > 15 * max(s, 1e-12)
    cand[:12, :] = cand[-12:, :] = False
    cand[:, :12] = cand[:, -12:] = False
    ys, xs = np.nonzero(cand)
    v = hp[ys, xs]
    pico = np.ones(len(ys), bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx:
                pico &= v >= hp[ys + dy, xs + dx]
    ys, xs = ys[pico], xs[pico]
    orden = np.argsort(-hp[ys, xs])[: 4 * max_n]
    yy, xx = np.mgrid[-9:10, -9:10]
    rr = np.hypot(yy, xx)
    ap, an = rr <= 4, (rr >= 6) & (rr <= 9)
    fb, fn = [], []
    for j in orden:
        y, x = ys[j], xs[j]
        bb, nn = base[y - 9:y + 10, x - 9:x + 10], nb[y - 9:y + 10, x - 9:x + 10]
        if bb.max() > 0.9:
            continue
        f1 = float((bb[ap] - np.median(bb[an])).sum())
        f2 = float((nn[ap] - np.median(nn[an])).sum())
        if f1 > 0 and f2 > 0:
            fb.append(f1); fn.append(f2)
        if len(fb) >= max_n:
            break
    return np.array(fb), np.array(fn)


def _excesos_estrellas(base, nb, cielo_px, estrellas_px, obj_px):
    fb, fn = _flujos_estrellas(base, nb)
    if len(fb) < 20:
        return _excesos(base, nb, cielo_px, estrellas_px, obj_px)
    k = float(np.median(fb / fn))
    mb, mn = float(np.median(base[cielo_px])), float(np.median(nb[cielo_px]))
    sn = 1.4826 * float(np.median(np.abs(nb[cielo_px] - mn)))
    ex = np.clip((nb - mn) * k - (base - mb), 0, None)
    with np.errstate(over="ignore", invalid="ignore"):
        ex = ex * _peso_senal(nb, mn, sn)
    ex[estrellas_px] = 0
    zona = obj_px & ~estrellas_px
    s_base = float(np.median(base[zona])) - mb if zona.any() else 0.0
    s_ex = float(np.median(ex[zona])) if zona.any() else 0.0
    tope = 1.0
    if s_base > 0 and s_ex > s_base:
        tope = s_base / s_ex
        ex = ex * tope
    return ex, {"k_estrellas": _r(k, 3), "exceso_puro_sobre_rgb": _r(s_ex / s_base, 2) if s_base > 0 else None,
                "tope": _r(tope, 3)}


def _capa(ctx, vista, forma):
    d = H._doc(ctx, vista)
    c = H._p(d.image)
    c = c[0] if c.shape[0] == 1 else c.mean(axis=0)
    if c.shape != forma:
        raise RuntimeError(f"La vista '{H._nombre(d)}' mide {c.shape[1]}×{c.shape[0]} y el RGB {forma[1]}×{forma[0]}: "
                           "alinéalos antes (alinearMasters).")
    return c.astype(np.float32)


def combinarCandidatos(ctx, ha, oiii=None, vista=None, intensidades=(0.5, 1.0), con_oiii=True, ruido_max=1.25):
    """Paso 10 lineal: compara cómo añadir Hα (y OIII), vistas mono alineadas, al RGB lineal 'vista'. La vista no
    cambia: aplicarCandidato(id)."""
    d = H._doc(ctx, vista)
    p = H._p(d.image)
    if p.shape[0] != 3:
        raise RuntimeError("combinarCandidatos necesita el RGB en color (vista).")
    if not M.lineal(p[:, ::8, ::8]):
        raise RuntimeError("El RGB parece estirado: la banda estrecha se combina en lineal, tras el color (Paso 10).")
    Ha = _capa(ctx, ha, p.shape[1:])
    O = _capa(ctx, oiii, p.shape[1:]) if oiii else None
    z = M.zonas_objeto_cielo(p)
    cielo_px, obj_px, est_px = z["cielo_px"], z["obj_px"], z["est_px"]
    _, k_neb = _excesos(p[0], Ha, cielo_px, est_px, obj_px)
    fb, fn = _flujos_estrellas(p[0], Ha)
    if len(fb) >= 20 and k_neb:
        contraste = float(np.median(fb / fn)) / max(float(k_neb), 1e-9)
        if contraste < 1.5:
            raise RuntimeError(f"El RGB ('{H._nombre(d)}') y la capa Hα tienen la misma relación nebulosa/estrellas "
                               f"(×{_r(contraste, 2)}): parece el propio dual band, no el RGB de banda ancha.")
    exH, kH = _excesos_estrellas(p[0], Ha, cielo_px, est_px, obj_px)
    exO, kO = (_excesos_estrellas(0.5 * (p[1] + p[2]), O, cielo_px, est_px, obj_px) if O is not None else (None, None))
    cel = z["medidas"]["_celdas"]

    def medir(q):
        rgb = M.cielo_por_canal(q, cel)
        dom = 100.0 * (max(rgb) - min(rgb)) / max(float(np.mean(rgb)), 1e-9)
        L = q.mean(axis=0)
        cie = float(np.median(L[cielo_px]))
        ruido = 1.4826 * float(np.median(np.abs(L[cielo_px] - cie)))
        neb = float(np.median(q[0][obj_px])) - float(np.median(q[0][cielo_px])) if obj_px.any() else 0.0
        neb_o = float(np.median(q[2][obj_px])) - float(np.median(q[2][cielo_px])) if obj_px.any() else 0.0
        rg = float(np.median(q[0][est_px] / np.maximum(q[1][est_px], 1e-6))) if est_px.any() else None
        return {"nebulosa_rojo": neb, "nebulosa_azul": neb_o, "ruido_cielo": ruido, "dominante_cielo_pct": _r(dom, 1),
                "color_estrellas_rg": rg}

    m0 = medir(p)
    variantes = [(f"Hα en el rojo ×{a:g}", a, 0.0) for a in intensidades]
    if O is not None and con_oiii:
        variantes += [(f"Hα en el rojo ×{a:g} + OIII en verde y azul ×{a:g}", a, a) for a in intensidades]

    def hacer(a, b):
        def f(q):
            q = q.copy()
            q[0] = q[0] + a * exH
            if b and exO is not None:
                q[1] = q[1] + b * exO
                q[2] = q[2] + b * exO
            return np.clip(q, 0, 1)
        return f

    def metricas(q):
        m = medir(q)
        return {k: (_r(v, 6) if isinstance(v, float) else v) for k, v in m.items()}

    lista = [(n, "combinar_propio", {}, (lambda q, f=hacer(a, b): f(q))) for n, a, b in variantes]
    r = H._comparar(ctx, d, "combinacion", lista, metricas)
    for x, (_, a, b) in zip(r["candidatos"], variantes):
        m = x["metricas"]
        gan_h = 100.0 * (m["nebulosa_rojo"] / max(m0["nebulosa_rojo"], 1e-9) - 1)
        gan_o = 100.0 * (m["nebulosa_azul"] / max(m0["nebulosa_azul"], 1e-9) - 1) if b else 0.0
        ruido_x = m["ruido_cielo"] / max(m0["ruido_cielo"], 1e-12)
        cambio = (100.0 * (m["color_estrellas_rg"] / m0["color_estrellas_rg"] - 1)
                  if m0["color_estrellas_rg"] and m["color_estrellas_rg"] else 0.0)
        fal = []
        if ruido_x > ruido_max:
            fal.append(f"el ruido del cielo sube ×{_r(ruido_x, 2)} (> ×{ruido_max})")
        if m["dominante_cielo_pct"] >= 5 and m["dominante_cielo_pct"] > m0["dominante_cielo_pct"] + 1:
            fal.append(f"dominante del cielo {m['dominante_cielo_pct']} % (antes {m0['dominante_cielo_pct']} %)")
        if abs(cambio) > 10:
            fal.append(f"el color de las estrellas cambia un {_r(cambio, 1)} %")
        x["metricas"] = {"nebulosa_halfa_ganada_pct": _r(gan_h, 1), "nebulosa_oiii_ganada_pct": _r(gan_o, 1),
                         "ruido_cielo_x": _r(ruido_x, 3), "dominante_cielo_pct": m["dominante_cielo_pct"],
                         "color_estrellas_cambio_pct": _r(cambio, 1)}
        x["no_cumple"] = fal
    ok = [x for x in r["candidatos"] if not x["no_cumple"]
          and x["metricas"]["nebulosa_halfa_ganada_pct"] + x["metricas"]["nebulosa_oiii_ganada_pct"] >= 5]
    if ok:
        mejor = max(ok, key=lambda x: x["metricas"]["nebulosa_halfa_ganada_pct"] + x["metricas"]["nebulosa_oiii_ganada_pct"])
        mm = mejor["metricas"]
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: la nebulosa gana un {mm['nebulosa_halfa_ganada_pct']} % en Hα"
                       + (f" y un {mm['nebulosa_oiii_ganada_pct']} % en OIII" if mm["nebulosa_oiii_ganada_pct"] else "")
                       + f", con el ruido del cielo ×{mm['ruido_cielo_x']} y las estrellas sin cambiar de color.")
    else:
        r["recomendado"] = None
        r["motivo"] = "Ninguna cumple o ninguna aporta (≥ 5 % de nebulosa): ver no_cumple; sigue con el RGB tal cual."
    r.update(antes={k: (_r(v, 6) if isinstance(v, float) else v) for k, v in m0.items()}, escala_ha=kH, escala_oiii=kO)
    r["leyenda"] = ("Se suma sólo el EXCESO de la banda estrecha sobre el canal de banda ancha, escalada por las estrellas "
                    "y sin ellas (salen del RGB). La vista NO ha cambiado: aplicarCandidato(id).")
    return H._galeria(r, p, "diferencia")


def combinarRGB(ctx, r, g, b, nombre="RGB"):
    """Paso 10 lineal (mono con rueda): tres vistas mono alineadas (rojo, verde, azul) -> vista RGB nueva, en lineal y
    sin escalar ningún canal (el color lo pone después calibrarColor)."""
    dr = H._doc(ctx, r)
    forma = H._p(dr.image).shape[1:]
    canales = [_capa(ctx, v, forma) for v in (r, g, b)]
    q = np.stack(canales).astype(np.float32)
    m = dict(H._meta(dr))
    m.pop("file_path", None)
    m["display_name"], m["mono"] = nombre, False
    nuevo = ctx.open_new_document(np.ascontiguousarray(np.moveaxis(q, 0, -1)), metadata=m, name=nombre)
    return {"vista": H._nombre(H._base(nuevo)) if nuevo is not None else nombre,
            "mediana_por_canal": [_r(float(np.median(c[::4, ::4])), 6) for c in canales],
            "nota": "RGB lineal sin calibrar. Siguiente: gradiente, neutralizarFondo y calibrarColor."}


# --- NL2: paletas de banda estrecha (criterios de Siril) ---------------------------------------------------

def _igualar(o, ha, cielo_px=None):
    """Capa débil (OIII, SII) llevada al mismo cielo y al mismo recorrido cielo→p99 que Hα."""
    m = cielo_px if cielo_px is not None and cielo_px.any() else np.ones(o.shape, bool)
    mo, mh = float(np.median(o[m])), float(np.median(ha[m]))
    so = float(np.percentile(o[::4, ::4], 99)) - mo
    sh = float(np.percentile(ha[::4, ::4], 99)) - mh
    return np.clip(mh + (o - mo) * (sh / max(so, 1e-6)), 0, 1)


def _tonos(p, m):
    """Separación de tonos: desviación circular del tono (grados), ponderada por saturación, en la máscara m."""
    R, G, B = p[0][m], p[1][m], p[2][m]
    h = np.arctan2(np.sqrt(3) * (G - B), 2 * R - G - B)
    w = (np.maximum(np.maximum(R, G), B) - np.minimum(np.minimum(R, G), B)) + 1e-9
    rb = abs(np.sum(w * np.exp(1j * h))) / np.sum(w)
    return float(np.degrees(np.sqrt(-2 * np.log(max(rb, 1e-9)))))


def paletasCandidatos(ctx, ha, oiii, sii=None, vista=None, paletas=None, dominante_max=5.0, verde_max=5.0):
    """NL2: compone paletas de banda estrecha con capas YA ESTIRADAS (vistas mono alineadas: ha, oiii y opcional sii)
    y las compara. La paleta se pone en 'vista' (RGB del mismo tamaño) o, si no se da o es mono, en una vista RGB nueva
    «paleta». La vista no cambia hasta aplicarCandidato(id)."""
    dh = H._doc(ctx, ha)
    Ha = H._p(dh.image)
    Ha = Ha[0] if Ha.shape[0] == 1 else Ha.mean(axis=0)
    forma = Ha.shape
    if M.lineal(Ha[None, ::8, ::8]):
        raise RuntimeError("La capa Hα parece lineal: las paletas se componen con capas ya estiradas (estirarCandidatos "
                           "de cada capa antes).")
    O = _capa(ctx, oiii, forma)
    S = _capa(ctx, sii, forma) if sii else None
    d = H._doc(ctx, vista) if vista else None
    if d is None or H._p(d.image).shape[0] != 3 or H._p(d.image).shape[1:] != forma:
        m = dict(H._meta(dh))
        m.pop("file_path", None)
        m.update(display_name="paleta", mono=False)
        base = np.ascontiguousarray(np.repeat(Ha[:, :, None], 3, axis=2))
        d = H._base(ctx.open_new_document(base, metadata=m, name="paleta"))
    p3 = np.stack([Ha, Ha, Ha])
    z = M.zonas_objeto_cielo(p3)
    cpx = z["cielo_px"]
    Oa = _igualar(O, Ha, cpx)
    t = np.clip((Oa - float(np.median(Oa[cpx])) if cpx.any() else Oa) * 4, 0, 1)
    todas = {
        "HOO": ("HOO", lambda: (Ha, O, O)),
        "HOO_suave": ("HOO suave (G = 0,6·Hα + 0,4·OIII)", lambda: (Ha, 0.6 * Ha + 0.4 * O, O)),
        "HOO_realzado": ("HOO con OIII realzado", lambda: (Ha, Oa, Oa)),
        "HOO_dinamica": ("HOO dinámica (G mezcla Hα y OIII según OIII)", lambda: (Ha, t * Oa + (1 - t) * Ha, Oa)),
    }
    if S is not None:
        Sa = _igualar(S, Ha, cpx)
        todas["SHO"] = ("SHO", lambda: (Sa, Ha, Oa))
        todas["Foraxx"] = ("Foraxx (R = SII+Hα, G = Hα·OIII, B = OIII)",
                           lambda: (np.clip(0.5 * (Sa + Ha), 0, 1), np.clip(np.sqrt(np.maximum(Ha * Oa, 0)), 0, 1), Oa))
    elegir = [k for k in (paletas or list(todas)) if k in todas]
    cel = z["medidas"]["_celdas"]
    mo = z["obj_px"] if z["obj_px"].any() else np.ones(forma, bool)

    def medir(q):
        rgb = M.cielo_por_canal(q, cel)
        dom = 100.0 * (max(rgb) - min(rgb)) / max(float(np.mean(rgb)), 1e-6)
        Lo = float(M.lum(q)[mo].mean())
        verde = 100.0 * float(np.maximum(q[1] - np.maximum(q[0], q[2]), 0)[mo].mean()) / max(Lo, 1e-6)
        return {"dominante_cielo_pct": _r(dom, 1), "verde_residual_pct": _r(verde, 1),
                "sat_objeto": _r(float(M.saturacion(q)[mo].mean()), 3), "separacion_tonos_grados": _r(_tonos(q, mo), 1),
                **M.recortes(q)}

    lista = [(todas[k][0], f"paleta_{k}", {}, (lambda q, fn=todas[k][1]: np.clip(np.stack(fn()).astype(np.float32), 0, 1)))
             for k in elegir]
    r = H._comparar(ctx, d, "paleta", lista, medir)
    for x in r["candidatos"]:
        m, fal = x["metricas"], []
        if m["dominante_cielo_pct"] >= dominante_max:
            fal.append(f"cielo teñido: dominante {m['dominante_cielo_pct']} % ≥ {dominante_max} %")
        if m["verde_residual_pct"] >= verde_max:
            fal.append(f"verde residual {m['verde_residual_pct']} % ≥ {verde_max} % (quitarVerde después)")
        x["no_cumple"] = fal
    # El verde residual se arregla con quitarVerde: una paleta que sólo falla por verde vale, con ese paso después
    # (IC 1396, 14 nov 2026: sin esto ganaba una HOO oliva de 7,7° frente a Foraxx con 47,8° y un 7 % de verde).
    def solo_verde(x):
        return x["no_cumple"] and all(f.startswith("verde residual") for f in x["no_cumple"])
    ok = [x for x in r["candidatos"] if not x["no_cumple"] or solo_verde(x)]
    if r["candidatos"]:
        mejor = max(ok or r["candidatos"], key=lambda x: x["metricas"]["separacion_tonos_grados"] or 0)
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: la que más separa los tonos ({mejor['metricas']['separacion_tonos_grados']}°) "
                       "con el cielo neutro" + ("" if ok else " (NINGUNA cumple: ver no_cumple)")
                       + (" — después quitarVerde (forzar: true) por el verde residual" if solo_verde(mejor) else "")
                       + ". Una paleta es una convención, no el color real: la elección es estética; mírala en la galería.")
    r["vista_paleta"] = H._nombre(d)
    r["leyenda"] = ("separacion_tonos_grados: variedad de tonos en el objeto (más = más zonas distinguibles). "
                    "verde_residual_pct: verde por encima de rojo y azul en el objeto. dominante_cielo_pct: el cielo debe "
                    "quedar neutro. La vista NO ha cambiado: aplicarCandidato(id).")
    return H._galeria(r, H._p(d.image))


# --- L6: composición HDR con tomas cortas (alternativa propia de la ficha) ----------------------------------

def componerHDR(ctx, larga, corta, umbral=None, crecer=3, suavizar=8, nombre="HDR"):
    """L6: combina en lineal un master largo y uno corto (vistas alineadas, mismo tamaño): mide la razón de flujo
    larga/corta en estrellas no saturadas, sustituye en la larga lo que satura (cualquier canal ≥ umbral; por defecto el
    90 % de la meseta medida de cada canal) por la corta escalada, con una máscara dilatada y suavizada, y crea una vista
    nueva en la escala de la corta (HDR ≈ larga / razón: lineal y sin pasar de 1). Comprueba el escalón en la transición."""
    dl, dc = H._doc(ctx, larga), H._doc(ctx, corta)
    L, C = H._p(dl.image), H._p(dc.image)
    if L.shape != C.shape:
        raise RuntimeError(f"La larga mide {L.shape[2]}×{L.shape[1]} y la corta {C.shape[2]}×{C.shape[1]}: alinéalas antes "
                           "(alinearMasters).")
    if not M.lineal(L[:, ::8, ::8]) or not M.lineal(C[:, ::8, ::8]):
        raise RuntimeError("La HDR se compone en lineal: las dos vistas deben estar sin estirar.")
    fb, fs = _flujos_estrellas(L.mean(axis=0), C.mean(axis=0), max_n=800)
    if len(fb) < 20:
        raise RuntimeError(f"Sólo {len(fb)} estrellas no saturadas comunes: no puedo medir la razón larga/corta.")
    razones = fb / fs
    k = float(np.median(razones))
    dispersion = float(1.4826 * np.median(np.abs(razones - k)) / k)
    # Meseta de saturación de cada canal de la larga: píxeles pegados a su máximo (con normalización local no llega a 1:
    # guía, Paso 6). Umbral = 85 % de la meseta (la guía usó 0,80 con mesetas de 0,89–0,96). Sin meseta: no hace falta.
    mesetas = []
    for c in range(L.shape[0]):
        mx = float(L[c].max())
        # ≥ 20 px a menos del 2 % del máximo: en un drizzle ×2 los núcleos saturados no quedan planos del todo
        # (IC 63: con el 0,5 % no detectaba ninguna meseta)
        mesetas.append(mx if int((L[c] >= 0.98 * mx).sum()) >= 20 else None)
    if umbral is None:
        if not any(mesetas):
            return {"aplicado": False, "razon_larga_corta": _r(k, 3), "estrellas_medidas": int(len(fb)),
                    "maximos": [_r(float(L[c].max()), 3) for c in range(L.shape[0])],
                    "aviso": "La larga no tiene mesetas de saturación (ningún canal con ≥ 20 px pegados a su máximo): "
                             "no hace falta HDR. Con umbral se puede forzar."}
        umbrales = [0.85 * m if m else 1.01 for m in mesetas]
    else:
        umbrales = [float(umbral)] * L.shape[0]
    sat = np.zeros(L.shape[1:], bool)
    for c in range(L.shape[0]):
        sat |= L[c] >= umbrales[c]
    if not sat.any():
        return {"aplicado": False, "razon_larga_corta": _r(k, 3), "umbrales": [_r(u, 3) for u in umbrales],
                "aviso": "La larga no tiene píxeles saturados por encima del umbral: no hace falta HDR."}
    w = (M._caja(sat.astype(np.float32), int(crecer)) > 0).astype(np.float32)
    w = np.clip(M.suave(w, 2 * int(suavizar)), 0, 1)
    # La larga se lleva a la escala de la corta con su fondo: (L − cielo_L)/k + cielo_C por canal. Sólo dividir por k
    # dejaba el pedestal de la larga (otra noche, otro cielo) y un escalón que crecía hacia fuera (M31: 9–17 %).
    cel = M.cielo(C)["_celdas"]
    bL, bC = M.cielo_por_canal(L, cel), M.cielo_por_canal(C, cel)
    Lk = np.stack([(L[c] - bL[c]) / k + bC[c] for c in range(L.shape[0])]).astype(np.float32)
    out = (1 - w)[None] * Lk + w[None] * C
    out = np.clip(out, 0, 1).astype(np.float32)
    # Escalón: en el borde exterior de la máscara (0,02 < w < 0,2) la larga aún es lineal y larga/k debe coincidir con
    # la corta; una diferencia ahí se ve como un anillo tras estirar. (Dentro de la transición la larga ya satura.)
    anillo = (w > 0.02) & (w < 0.2) & ~sat
    escalon = None
    if anillo.sum() > 50:
        # suavizado (radio ~6 px): las dos tomas pueden ser de noches con distinto seeing y, píxel a píxel junto al
        # núcleo, el perfil no coincide aunque el flujo sí (M31 120 s / 60 s: 18 % sin suavizar)
        a = M.suave(Lk.mean(axis=0), 12)[anillo]
        b = M.suave(C.mean(axis=0).astype(np.float32), 12)[anillo]
        escalon = float(np.median(a / np.maximum(b, 1e-6)) - 1)
    m = dict(H._meta(dl))
    m.pop("file_path", None)
    m.update(display_name=nombre, mono=out.shape[0] == 1)
    img = out[0] if out.shape[0] == 1 else np.moveaxis(out, 0, -1)
    nuevo = ctx.open_new_document(np.ascontiguousarray(img), metadata=m, name=nombre)
    exp_l = (H._cabecera(dl).get("EXPTIME") or H._cabecera(dl).get("EXPOSURE"))
    exp_c = (H._cabecera(dc).get("EXPTIME") or H._cabecera(dc).get("EXPOSURE"))
    r = {"vista": H._nombre(H._base(nuevo)) if nuevo is not None else nombre,
         "razon_larga_corta": _r(k, 3), "razon_exposiciones": _r(float(exp_l) / float(exp_c), 3) if exp_l and exp_c else None,
         "dispersion_razon_pct": _r(100 * dispersion, 1), "estrellas_medidas": int(len(fb)),
         "umbrales": [_r(u, 3) for u in umbrales], "mesetas": [_r(m, 3) if m else None for m in mesetas],
         "sustituido_pct": _r(100.0 * float((w > 0.5).mean()), 3),
         "escalon_transicion_pct": _r(100 * escalon, 1) if escalon is not None else None,
         "corta_satura_pct": _r(100.0 * float((C.max(axis=0) >= 0.98).mean()), 4),
         "nota": "HDR lineal en la escala de la corta (se ve más oscura: es normal). Revisa con previa un recorte de la "
                 "estrella o núcleo más brillante (sin escalón ni anillo de color). Las estrellas, mejor de esta HDR."}
    if escalon is not None and abs(escalon) > 0.05:
        r["aviso"] = (f"Escalón del {_r(100 * escalon, 1)} % en la transición: sube suavizar/crecer o revisa el umbral.")
    return r


LISTA_MULTICAPA = {"alinearMasters": alinearMasters, "desmezclarDualBand": desmezclarDualBand,
                   "combinarCandidatos": combinarCandidatos, "combinarRGB": combinarRGB,
                   "paletasCandidatos": paletasCandidatos, "componerHDR": componerHDR}
