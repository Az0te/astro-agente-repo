# SirilAstroPilot — herramientas compuestas por paso de la guía (fase 2).
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# Siril tiene una sola imagen cargada, así que "comparar candidatos" se hace así:
#   1. se guarda la imagen tal como está (numpy, tipo de Siril),
#   2. cada candidato se aplica con un comando de Siril (o un programa externo), se mide y se guarda en
#      ~/.sirilastropilot/trabajo/<id>.npy,
#   3. la imagen vuelve a como estaba (set_image_pixeldata),
#   4. aplicarCandidato(id) pone el candidato elegido, con su estado de deshacer.
# Así lo que se aplica es exactamente lo que se midió, y la imagen no cambia hasta que el modelo (o el usuario) elige.
#
# Las medidas siguen los criterios de la guía (fichas de los pasos 9 lineal y 1 no lineal), escritos aquí desde cero
# en Python/numpy sin código de PixInsight, para que los umbrales de la guía sigan valiendo: cielo = mediana de las celdas de 64 px más
# oscuras (10 %), ruido del cielo por diferencias entre vecinos, fallo de estirado = ruido > 15 % del cielo, > 0,05 % de píxeles a 0 o > 0,95, etc.

import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

import numpy as np

import herramientas as H

TRABAJO = H.DATOS / "trabajo"
CONFIG = H.DATOS / "config.json"
_r = H._r


# --- Utilidades ---------------------------------------------------------------------------------------------

def _config():
    try:
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _crudo(siril):
    """Píxeles tal cual los da Siril (tipo y orden de filas de Siril), para poder devolverlos después."""
    a = siril.get_image_pixeldata()
    return a


def _pantalla(a, info):
    """Array de Siril -> float32 0–1, (canales, alto, ancho), fila 0 arriba."""
    if a.ndim == 2:
        a = a[np.newaxis, :, :]
    a = a.astype(np.float32, copy=False)
    k = H._escala(info)
    if k != 1.0:
        a = a / np.float32(k)
    if not info["top_down"]:
        a = a[:, ::-1, :]
    return a


def _huella(a):
    """Huella rápida de la imagen para saber si ha cambiado desde una comparación."""
    v = np.ascontiguousarray(a.reshape(-1)[:: max(1, a.size // 200000)])
    return hashlib.sha1(v.tobytes()).hexdigest()[:16] + f"_{a.shape}_{a.dtype}"


def _poner(siril, a, nota):
    """Sustituye los píxeles de la imagen cargada, dejando un estado de deshacer con 'nota'."""
    with siril.image_lock():
        try:
            siril.undo_save_state(nota[:70])
        except Exception:
            pass
        siril.set_image_pixeldata(a)


def _restaurar(siril, a):
    with siril.image_lock():
        siril.set_image_pixeldata(a)


def _guardar_candidato(grupo, n, a, datos):
    TRABAJO.mkdir(parents=True, exist_ok=True)
    cid = f"{grupo}_{n}"
    np.save(TRABAJO / f"{cid}.npy", a)
    (TRABAJO / f"{cid}.json").write_text(json.dumps(datos, ensure_ascii=False, default=str),
                                         encoding="utf-8")
    return cid


def _mtf(m, x):
    """Función de tonos medios: lleva m a 0,5 (0 → 0, 1 → 1)."""
    return np.where(x <= 0, 0.0, np.where(x >= 1, 1.0, (m - 1) * x / ((2 * m - 1) * x - m)))


def _autoestirar(q, objetivo=0.25, sombras=-2.8):
    """Autoestirado por canal (fondo neutro aunque falte calibrar el color): punto negro a mediana − 2,8 MAD y
    tonos medios para que la mediana quede en 'objetivo'."""
    out = np.empty_like(q, dtype=np.float32)
    for c in range(q.shape[0]):
        x = q[c]
        med = float(np.median(x))
        mad = 1.4826 * float(np.median(np.abs(x - med)))
        c0 = min(max(0.0, med + sombras * mad), 0.99)
        y = np.clip((x - c0) / (1 - c0), 0, 1)
        mn = (med - c0) / (1 - c0)
        out[c] = _mtf(float(_mtf(objetivo, np.float64(mn))) if mn > 0 else 0.5, y)
    return out


def _jpg(q, ruta):
    from PIL import Image
    a = (np.clip(q, 0, 1) * 255 + 0.5).astype(np.uint8)
    img = Image.fromarray(a[0] if a.shape[0] == 1 else np.ascontiguousarray(np.moveaxis(a, 0, -1)))
    img.save(ruta, "JPEG", quality=85)
    return str(ruta)


def _asegurar_restaurado(siril, crudo, huella, r):
    """Tras una comparación la imagen tiene que ser la de partida (si no, aplicarCandidato se niega). En M31 (10 nov 2026)
    una vez no lo era sin causa clara: se comprueba y se repone, avisando."""
    for _ in range(3):
        if _huella(_crudo(siril)) == huella:
            return
        _restaurar(siril, crudo)
        time.sleep(0.5)
    r.setdefault("errores", []).append("La imagen no ha vuelto a como estaba tras la comparación: abre de nuevo la de partida.")


def _galeria(r, info, base, modo=None, lado=800):
    """Miniaturas de cada candidato junto a su .npy: el resultado (<id>.jpg, autoestirado por canal si es lineal) y lo
    que quita (<id>_quita.jpg). modo: 'modelo' (gradiente), 'estrellas', 'diferencia' (ruido, contraste, saturación) o
    None. Marca el recomendado. Si algo falla, la comparación sigue sin galería."""
    paso = max(1, int(np.ceil(max(info["alto"], info["ancho"]) / lado)))
    b = base[:, ::paso, ::paso]
    for c in r.get("candidatos", []):
        try:
            q = _pantalla(np.load(TRABAJO / f"{c['id']}.npy", mmap_mode="r"), info)[:, ::paso, ::paso].astype(np.float32)
            c["previa"] = _jpg(_autoestirar(q) if _lineal(q) else q, TRABAJO / f"{c['id']}.jpg")
            if modo:
                d = b - q
                if modo == "modelo":            # el fondo restado, estirado para verlo
                    lo, hi = np.percentile(d, 1, axis=(1, 2), keepdims=True), np.percentile(d, 99, axis=(1, 2), keepdims=True)
                    v = (d - lo) / np.maximum(hi - lo, 1e-9)
                elif modo == "estrellas":
                    v = _autoestirar(np.clip(d, 0, 1), objetivo=0.08)
                else:                           # diferencia amplificada sobre gris
                    s = 1.4826 * float(np.median(np.abs(d - np.median(d)))) or 1e-6
                    v = 0.5 + d / (8 * s)
                c["previa_quita"] = _jpg(v, TRABAJO / f"{c['id']}_quita.jpg")
        except Exception as e:
            c["previa_error"] = str(e)[:120]
        if c.get("id") == r.get("recomendado"):
            c["recomendado"] = True
    return r


def _limpiar_grupo(grupo):
    TRABAJO.mkdir(parents=True, exist_ok=True)
    for f in TRABAJO.glob(f"{grupo}_*"):
        try:
            f.unlink()
        except OSError:
            pass


def _lum(p):
    return p.mean(axis=0) if p.shape[0] > 1 else p[0]


def _binar(x, b):
    h, w = x.shape[0] // b * b, x.shape[1] // b * b
    return x[:h, :w].reshape(h // b, b, w // b, b).mean(axis=(1, 3))


def _celdas(L, S=64):
    """Medianas de celdas S×S (submuestreadas a 1 de cada 2 píxeles)."""
    h, w = L.shape[0] // S * S, L.shape[1] // S * S
    c = L[:h:2, :w:2].reshape(h // S, S // 2, w // S, S // 2).transpose(0, 2, 1, 3).reshape(h // S, w // S, -1)
    return np.median(c, axis=2)


def _cielo(p, S=64):
    """Criterios de la ficha de estirado: cielo, ruido relativo, percentiles y píxeles a 0 / > 0,95."""
    L = _lum(p)
    m = _celdas(L, S)
    ys, xs = np.nonzero(m > 1e-6)                     # fuera bordes negros del registro o recorte
    vals = m[ys, xs]
    orden = np.argsort(vals)
    k = max(5, int(len(vals) * 0.10))
    sel = orden[:k]
    cielo = float(np.median(vals[sel]))
    dif = []
    for j in sel:
        y0, x0 = ys[j] * S, xs[j] * S
        blk = L[y0:y0 + S, x0:x0 + S]
        dif.append(np.abs(blk[:, 1::2] - blk[:, 0:-1:2]).ravel())
    ruido = float(np.median(np.concatenate(dif))) / (0.6745 * np.sqrt(2)) if dif else 0.0
    muestra = L.ravel()[::17]
    pc = np.percentile(muestra, [50, 90, 99, 99.9])
    n = p.size
    return {
        "cielo": _r(cielo, 4), "ruido_rel": _r(ruido / max(cielo, 1e-6), 3),
        "mediana": _r(pc[0], 4), "p90": _r(pc[1], 4), "p99": _r(pc[2], 4), "p999": _r(pc[3], 4),
        "cero_pct": _r(100.0 * float((p <= 0.0001).sum()) / n, 4), "alto_pct": _r(100.0 * float((p >= 0.95).sum()) / n, 4),
        "_celdas": (ys[sel], xs[sel], S),
    }


def _cielo_por_canal(p, celdas):
    ys, xs, S = celdas
    r = []
    for c in range(p.shape[0]):
        v = np.concatenate([p[c, y * S:(y + 1) * S:2, x * S:(x + 1) * S:2].ravel() for y, x in zip(ys, xs)])
        r.append(float(np.median(v)))
    return r


def _sin_privado(d):
    return {k: v for k, v in d.items() if not k.startswith("_")}


def _lineal(p):
    return float(np.median(_lum(p))) < 0.05


def _log_nuevo(siril, antes):
    """Líneas del registro de Siril escritas después de 'antes' (texto completo anterior)."""
    t = siril.get_siril_log() or ""
    nuevo = t[len(antes):] if t.startswith(antes[:200]) else t[-4000:]
    ls = []
    for l in nuevo.splitlines():
        l = _HORA.sub("", l.replace("\x00", "").strip()).strip()
        if l and not l.startswith(("Ejecutando comando", "Running command")):
            ls.append(l)
    return ls


_HORA = re.compile(r"^\d{1,2}:\d{2}:\d{2}:\s*")


def _comprobar_bordes(p, ignorar):
    L = _lum(p)
    med = float(np.median(L))
    p95, _, cunas = H._zonas_vacias(L, med)
    if not ignorar and (max(p95.values()) > 2 or cunas > 0.2):
        raise RuntimeError(
            f"La imagen tiene zonas sin datos (cuñas del registrado: {cunas} % del campo; p95 por lado {p95}). "
            "Recórtalas antes con recortarBordes (Paso 5): el modelo de fondo intentaría ajustar el relleno y falsearía todo.")


# --- L5: recortar bordes sin datos --------------------------------------------------------------------------

def _rect_con_datos(datos, ancho, alto, margen=8, tolerancia_pct=0.01, b=4):
    """Rectángulo más grande (x0, y0, x1, y1) sin cuñas a partir de una máscara de píxeles con datos: se van quitando
    filas o columnas del borde peor hasta que lo que queda tiene menos de 'tolerancia_pct' % sin datos."""
    malo = 1.0 - _binar(datos.astype(np.float32), b)
    h, w = malo.shape
    y0, y1, x0, x1 = 0, h, 0, w
    tol = tolerancia_pct / 100.0
    for _ in range(h + w):
        sub = malo[y0:y1, x0:x1]
        if sub.size == 0:
            raise RuntimeError("No queda ninguna zona con datos: revisa la imagen.")
        if sub.mean() <= tol:
            break
        bordes = {"arriba": sub[0, :].mean(), "abajo": sub[-1, :].mean(), "izquierda": sub[:, 0].mean(), "derecha": sub[:, -1].mean()}
        lado = max(bordes, key=bordes.get)
        if lado == "arriba":
            y0 += 1
        elif lado == "abajo":
            y1 -= 1
        elif lado == "izquierda":
            x0 += 1
        else:
            x1 -= 1
    m = int(margen)
    return x0 * b + m, y0 * b + m, min(ancho, x1 * b) - m, min(alto, y1 * b) - m


def recortarBordes(siril, margen=8, tolerancia_pct=0.01, aplicar=True):
    """Busca el rectángulo más grande sin cuñas sin datos y recorta (comando crop de Siril, con deshacer)."""
    info = H._info(siril)
    p = H._pixeles(siril, info)
    L = _lum(p)
    med = float(np.median(L))
    datos = L > max(1e-6, 0.25 * med)
    b = 4
    malo = 1.0 - _binar(datos.astype(np.float32), b)          # fracción sin datos por celda b×b
    h, w = malo.shape
    y0, y1, x0, x1 = 0, h, 0, w
    tol = tolerancia_pct / 100.0
    for _ in range(h + w):
        sub = malo[y0:y1, x0:x1]
        if sub.size == 0:
            raise RuntimeError("No queda ninguna zona con datos: revisa la imagen.")
        if sub.mean() <= tol:
            break
        bordes = {"arriba": sub[0, :].mean(), "abajo": sub[-1, :].mean(), "izquierda": sub[:, 0].mean(), "derecha": sub[:, -1].mean()}
        lado = max(bordes, key=bordes.get)
        if lado == "arriba":
            y0 += 1
        elif lado == "abajo":
            y1 -= 1
        elif lado == "izquierda":
            x0 += 1
        else:
            x1 -= 1
    m = int(margen)
    X0, Y0 = x0 * b + m, y0 * b + m
    X1, Y1 = min(info["ancho"], x1 * b) - m, min(info["alto"], y1 * b) - m
    W, Hh = X1 - X0, Y1 - Y0
    if W < info["ancho"] * 0.5 or Hh < info["alto"] * 0.5:
        raise RuntimeError(f"El recorte dejaría menos de la mitad de la imagen ({W}×{Hh}): revisa las cuñas con previa antes de recortar.")
    r = {"antes": [info["ancho"], info["alto"]], "rect": [X0, Y0, X1, Y1], "despues": [W, Hh],
         "quita_px": {"izquierda": X0, "derecha": info["ancho"] - X1, "arriba": Y0, "abajo": info["alto"] - Y1}}
    if not aplicar:
        r["aplicado"] = False
        return r
    # crop de Siril: x, y de la esquina superior izquierda como se ve en pantalla.
    siril.cmd("crop", str(X0), str(Y0), str(W), str(Hh))
    info2 = H._info(siril)
    p2 = H._pixeles(siril, info2)
    L2 = _lum(p2)
    p95, _, cunas = H._zonas_vacias(L2, float(np.median(L2)))
    r.update(aplicado=True, imagen=info2, cunas_pct_despues=cunas, bordes_p95_despues=p95)
    if cunas > 0.05:
        r["aviso"] = "Siguen quedando zonas sin datos después de recortar: comprueba con previa (¿orientación del recorte?)."
    return r


# --- L8: astrometría ----------------------------------------------------------------------------------------

def _sexa(v, horas):
    """'hh:mm:ss' (AR, horas) o 'dd:mm:ss' (Dec) o grados decimales → grados."""
    v = str(v).strip()
    if ":" not in v:
        return float(v)
    signo = -1.0 if v.startswith("-") else 1.0
    partes = [abs(float(x)) for x in v.lstrip("+-").split(":")]
    g = sum(x / 60 ** i for i, x in enumerate(partes))
    return signo * g * (15.0 if horas else 1.0)


def _distancia_grados(a1, d1, a2, d2):
    a1, d1, a2, d2 = map(np.radians, (a1, d1, a2, d2))
    c = np.sin(d1) * np.sin(d2) + np.cos(d1) * np.cos(d2) * np.cos(a1 - a2)
    return float(np.degrees(np.arccos(np.clip(c, -1, 1))))


def resolverAstrometria(siril, forzar=False, focal=None, pixel=None, centro=None, catalogo=None, astrometrynet=False,
                        reducir=False):
    """Plate solve con platesolve de Siril (no cambia los píxeles salvo que la imagen esté al revés)."""
    H._hay_imagen(siril)
    # Píxel y focal: los de la cabecera mandan. 11 nov 2026: un modelo local pasó 2,35 µm para una cámara de 3,76 µm.
    try:
        k0 = siril.get_image_keywords()
        px_cab = float(k0.pixel_size_x or 0) * max(1, int(k0.binning_x or 1)) if k0 else 0.0
        fo_cab = float(k0.focal_length or 0) if k0 else 0.0
    except Exception:
        px_cab = fo_cab = 0.0
    if pixel and px_cab and abs(float(pixel) - px_cab) / px_cab > 0.05:
        raise ValueError(f"La cabecera dice píxel {px_cab:g} µm (XPIXSZ × binning) y has pasado {float(pixel):g}: no pases pixel "
                         "(se toma de la cabecera) salvo que el usuario diga que la cabecera está mal.")
    if focal and fo_cab and abs(float(focal) - fo_cab) / fo_cab > 0.10:
        raise ValueError(f"La cabecera dice focal {fo_cab:g} mm y has pasado {float(focal):g}: no pases focal salvo que el "
                         "usuario diga que la cabecera está mal (reductor o corrector nuevos).")
    args = []
    if forzar:
        args.append("-force")
    # Centro: el de la cabecera manda. 11 nov 2026: el modelo se inventó 2h19m para un objeto que está a 21h39m (la
    # cabecera lo traía bien) y la astrometría no resolvió. Un centro a más de 2° de la cabecera se ignora con aviso.
    try:
        ar_cab = float(k0.ra) if k0 and k0.ra is not None else None
        de_cab = float(k0.dec) if k0 and k0.dec is not None else None
    except Exception:
        ar_cab = de_cab = None
    if ar_cab is not None and de_cab is not None and ar_cab == 0 and de_cab == 0:
        ar_cab = de_cab = None
    aviso_centro = None
    if centro:
        c = str(centro).replace(" ", ",")
        if not all(ch.isdigit() or ch in ".,:+-" for ch in c) or c.count(",") != 1:
            raise ValueError("centro: 'AR,Dec' en grados o 'hh:mm:ss,+dd:mm:ss' (o no lo pases: se usa el de la cabecera).")
        ar, de = c.split(",")
        if de and de[0] not in "+-":                    # Siril 1.4.5 rechazó "324.7,57.5" (sin signo en la Dec)
            c = f"{ar},+{de}"
            de = "+" + de
        if ar_cab is not None:
            try:
                ar_m, de_m = _sexa(ar, horas=True), _sexa(de, horas=False)
                d = _distancia_grados(ar_m, de_m, ar_cab, de_cab)
            except Exception:
                d = None
            if d is None or d > 2.0:
                aviso_centro = (f"Centro {centro} ignorado: está a {_r(d, 1) if d is not None else '?'}° del de la cabecera "
                                f"(AR {_r(ar_cab, 4)}°, Dec {_r(de_cab, 4)}°). Se usa el de la cabecera.")
                c = None
        if c:
            args.append(c)
    if ar_cab is not None and not any(a and a[0].isdigit() for a in args):
        args.append(f"{ar_cab:.5f},{de_cab:+.5f}")
    if focal:
        args.append(f"-focal={float(focal)}")
    if pixel:
        args.append(f"-pixelsize={float(pixel)}")
    if catalogo:
        if not str(catalogo).isalnum():
            raise ValueError("catalogo no válido.")
        args.append(f"-catalog={catalogo}")
    if astrometrynet:
        args.append("-localasnet")
    if reducir:
        args.append("-downscale")
    antes = siril.get_siril_log() or ""
    t0 = time.perf_counter()
    try:
        siril.cmd("platesolve", *args)
        ok = True
    except Exception as e:
        ok, err = False, str(e)
    k = siril.get_image_keywords()
    r = {"resuelta": bool(getattr(k, "pltsolvd", False)), "segundos": _r(time.perf_counter() - t0, 1),
         "comando": " ".join(["platesolve", *args])}
    if k:
        r.update(ar=_r(k.ra, 5) if k.ra is not None else None, dec=_r(k.dec, 5) if k.dec is not None else None,
                 focal=_r(k.focal_length, 1), pixel=_r(k.pixel_size_x, 2))
    r["registro"] = [l for l in _log_nuevo(siril, antes) if "[SirilAstroPilot]" not in l][-12:]
    if aviso_centro:
        r["aviso"] = aviso_centro
    if not ok:
        r["error"] = err
    if not r["resuelta"] and any("remote catalogue" in l or "libcurl" in l for l in r["registro"]):
        r["consejo"] = ("No se ha podido descargar el catálogo de estrellas (servidor VizieR caído o sin conexión): no es "
                        "problema de la imagen. Repite más tarde o instala en Siril el catálogo local de Gaia "
                        "(script Catalog_Installer) y usa catalogo: \"localgaia\".")
        r["registro"] = [l[:300] for l in r["registro"]]
    elif not r["resuelta"]:
        r["consejo"] = ("Sin solución: pasa focal y pixel si la cabecera no los trae, o centro (AR,Dec) del objeto; "
                        "con astrometrynet: true usa Astrometry.net local si está instalado.")
    return r


# --- L9: gradiente ------------------------------------------------------------------------------------------

def _ajuste_poli(Z, mascara, grado=2):
    """Polinomio 2D de 'grado' ajustado en los píxeles de 'mascara' (mínimos cuadrados). Devuelve la superficie."""
    h, w = Z.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    xx, yy = xx / w - 0.5, yy / h - 0.5
    terminos = [np.ones_like(xx)]
    for g in range(1, grado + 1):
        for i in range(g + 1):
            terminos.append(xx ** (g - i) * yy ** i)
    A = np.stack([t[mascara] for t in terminos], axis=1)
    coef, *_ = np.linalg.lstsq(A, Z[mascara].astype(np.float64), rcond=None)
    return sum(c * t for c, t in zip(coef, terminos))


def _rango_rejilla(Z, cielo):
    """Rango de las medianas del cielo en una rejilla 4×3 (gradiente que queda)."""
    h, w = Z.shape
    m = []
    for f in range(3):
        for c in range(4):
            sub = Z[f * h // 3:(f + 1) * h // 3, c * w // 4:(c + 1) * w // 4]
            mk = cielo[f * h // 3:(f + 1) * h // 3, c * w // 4:(c + 1) * w // 4]
            if mk.sum() > 20:
                m.append(float(np.median(sub[mk])))
    return (max(m) - min(m)) if len(m) >= 2 else float("nan")


def _preparar_gradiente(p, b=8):
    L = _binar(_lum(p), b)
    med = float(np.median(L))
    valido = L > max(1e-6, 0.25 * med)
    v = L[valido]
    m2 = float(np.median(v))
    sig = 1.4826 * float(np.median(np.abs(v - m2)))
    # Objeto: lo que sobresale del fondo después de quitar un plano grueso (el gradiente no cuenta como objeto).
    plano = _ajuste_poli(L, valido & (L < m2 + 2 * sig), 1)
    res = L - plano
    s2 = 1.4826 * float(np.median(np.abs(res[valido] - np.median(res[valido]))))
    obj = valido & (res > 3 * s2)
    # dilatar el objeto un poco (vecinos 3×3) para que los bordes no cuenten como cielo
    o = obj.copy()
    o[1:, :] |= obj[:-1, :]; o[:-1, :] |= obj[1:, :]; o[:, 1:] |= obj[:, :-1]; o[:, :-1] |= obj[:, 1:]
    # Cielo: el 25 % de las celdas de 64 px (enteras con datos, sin cuñas) con menor residuo tras el plano.
    # "Todo lo que no supera 3σ" metía la nebulosa débil cuando el objeto llena el campo y el gradiente
    # restante salía alto aunque el fondo quedara plano.
    k = max(1, 64 // b)
    hc, wc = res.shape[0] // k, res.shape[1] // k
    rc = res[:hc * k, :wc * k].reshape(hc, k, wc, k).transpose(0, 2, 1, 3).reshape(hc, wc, -1)
    vc = valido[:hc * k, :wc * k].reshape(hc, k, wc, k).all(axis=(1, 3))
    medc = np.median(rc, axis=2)
    cel = np.zeros_like(vc)
    if vc.sum() >= 8:
        umbral = np.percentile(medc[vc], 25)
        cel = vc & (medc <= umbral)
    oscuras = np.zeros_like(valido)
    oscuras[:hc * k, :wc * k] = np.repeat(np.repeat(cel, k, 0), k, 1)
    cielo = oscuras & valido
    if cielo.sum() < 50:                                  # imagen muy pequeña: criterio anterior
        cielo = valido & ~o
    # Cuánto del campo tiene señal: celdas cuyo residuo supera al cuarto más oscuro en más de 5 veces su dispersión.
    lleno = None
    if cel.any():
        q = medc[cel]
        s_q = 1.4826 * float(np.median(np.abs(q - np.median(q))))
        lleno = 100.0 * float((medc[vc] > float(np.max(q)) + 5 * max(s_q, 1e-9)).mean())
    O2 = _ajuste_poli(L, cielo, 2)
    return {"L": L, "valido": valido, "obj": o, "cielo": cielo, "rango0": _rango_rejilla(L, cielo),
            "plano0": _amplitud_plano(L, cielo, valido),
            "objeto_campo_pct": lleno if lleno is not None else 100.0 * float(o.sum()) / max(int(valido.sum()), 1),
            "senal_obj": float((L - O2)[o].sum()), "O_hp": L - O2, "b": b}


def _amplitud_plano(Z, cielo, valido):
    """Gradiente del cielo = recorrido (p98 − p2) del plano ajustado a las celdas de cielo. Un gradiente es liso y casi
    plano; la estructura de una nebulosa que llena el campo apenas entra en un plano y sí en el rango de una rejilla."""
    P = _ajuste_poli(Z, cielo, 1)[valido]
    return float(np.percentile(P, 98) - np.percentile(P, 2))


def _medir_gradiente(base, pc):
    """Criterios de la ficha de gradiente: copia_objeto, objeto_quitado_pct, gradiente_restante."""
    C = _binar(_lum(pc), base["b"])
    M = base["L"] - C                                    # modelo de fondo que se ha restado
    v, cielo, obj = base["valido"], base["cielo"], base["obj"]
    M2 = _ajuste_poli(M, v, 2)                           # lo liso del modelo (un gradiente lo es)
    m_hp = (M - M2)[v]
    o_hp = base["O_hp"][v]
    corr = float(np.corrcoef(m_hp, o_hp)[0, 1]) if m_hp.std() > 1e-12 and o_hp.std() > 1e-12 else 0.0
    exceso = M - _ajuste_poli(M, cielo, 2)               # lo que el modelo tiene de más sobre el objeto
    come = 100.0 * float(exceso[obj].sum()) / base["senal_obj"] if base["senal_obj"] > 0 and obj.any() else float("nan")
    irreg = _rango_rejilla(C, cielo) / base["rango0"] if base["rango0"] and base["rango0"] > 0 else float("nan")
    resid = _amplitud_plano(C, cielo, v) / base["plano0"] if base["plano0"] > 0 else float("nan")
    return {"copia_objeto": _r(corr, 3), "objeto_quitado_pct": _r(come, 1), "gradiente_restante": _r(resid, 3),
            "irregularidad_cielo": _r(irreg, 3), "negativos_pct": _r(100.0 * float((pc < 0).mean()), 3)}


def _graxpert_exe():
    c = _config().get("graxpert")
    cands = [c] if c else []
    for raiz in (os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("LOCALAPPDATA", "")):
        if raiz:
            cands += glob.glob(os.path.join(raiz, "GraXpert*", "GraXpert*.exe"))
            cands += glob.glob(os.path.join(raiz, "Programs", "GraXpert*", "GraXpert*.exe"))
    cands += [shutil.which("GraXpert") or "", "/Applications/GraXpert.app/Contents/MacOS/GraXpert"]
    for x in cands:
        if x and os.path.isfile(x):
            return x
    return None


def _graxpert_ia(siril, info, crudo, suavizado=0.0, timeout=900):
    """GraXpert IA por su CLI sobre una copia en disco; devuelve el array corregido (tipo y orden de Siril)."""
    exe = _graxpert_exe()
    if not exe:
        raise RuntimeError("No encuentro GraXpert. Pon su ruta en ~/.sirilastropilot/config.json: {\"graxpert\": \"C:/.../GraXpert.exe\"}.")
    TRABAJO.mkdir(parents=True, exist_ok=True)
    ent = TRABAJO / "gx_entrada.fits"
    sal = TRABAJO / "gx_salida"
    for f in TRABAJO.glob("gx_*"):
        f.unlink()
    cab = siril.get_image_fits_header() or ""
    a = crudo if crudo.dtype == np.float32 else (crudo.astype(np.float32) / 65535.0)
    siril.save_image_file(a, cab, str(ent))
    cmd = [exe, str(ent), "-cli", "-cmd", "background-extraction", "-output", str(sal),
           "-correction", "Subtraction", "-smoothing", str(float(suavizado))]
    pr = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    hechos = [f for f in TRABAJO.glob("gx_salida*") if f.suffix.lower() in (".fits", ".fit", ".fts", ".xisf", ".tif", ".tiff")]
    if not hechos:
        raise RuntimeError(f"GraXpert no ha dejado resultado (código {pr.returncode}): {(pr.stderr or pr.stdout)[-400:]}")
    f = siril.load_image_from_file(str(hechos[0]))
    d = np.asarray(f.data, dtype=np.float32)
    if d.ndim == 3 and d.shape[0] not in (1, 3) and d.shape[-1] in (1, 3):
        d = np.moveaxis(d, -1, 0)
    if d.shape != a.shape:
        raise RuntimeError(f"GraXpert devolvió {d.shape} y la imagen es {a.shape}.")
    if crudo.dtype != np.float32:
        d = np.clip(d * 65535.0, 0, 65535).astype(np.uint16)
    return d, " ".join(Path(c).name if i == 0 else c for i, c in enumerate(cmd))


def _graxpert_denoise(siril, crudo, fuerza=0.5, timeout=1800):
    """Denoise de GraXpert (IA) por su CLI sobre una copia FITS; devuelve el array en el tipo de Siril."""
    exe = _graxpert_exe()
    if not exe:
        raise RuntimeError("No encuentro GraXpert.")
    d = TRABAJO / "gxd"
    d.mkdir(parents=True, exist_ok=True)
    for x in d.glob("*"):
        x.unlink()
    ent, sal = d / "entrada.fits", d / "salida"
    a = np.clip(_de_siril(crudo), 0, 1).astype(np.float32)
    siril.save_image_file(a if crudo.ndim == 3 else a[0], siril.get_image_fits_header() or "", str(ent))
    cmd = [exe, str(ent), "-cli", "-cmd", "denoising", "-output", str(sal), "-strength", f"{float(fuerza):.2f}"]
    pr = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    hechos = [x for x in d.glob("salida*") if x.suffix.lower() in (".fits", ".fit", ".fts", ".xisf", ".tif", ".tiff")]
    if not hechos:
        raise RuntimeError(f"GraXpert no ha dejado resultado (código {pr.returncode}): {(pr.stderr or pr.stdout)[-300:]}")
    x = np.asarray(siril.load_image_from_file(str(hechos[0])).data)
    if x.ndim == 3 and x.shape[0] not in (1, 3) and x.shape[-1] in (1, 3):
        x = np.moveaxis(x, -1, 0)
    return _a_siril(np.clip(_de_siril(x), 0, 1), crudo.dtype).reshape(crudo.shape), " ".join(["GraXpert", *cmd[2:4], "denoising", "-strength", f"{float(fuerza):.2f}"])


def gradienteCandidatos(siril, polinomio=(1, 2), rbf=(0.5,), usar_graxpert=True, muestras=20, tolerancia=1.0,
                        ignorar_cunas=False, tipo=None):
    """Paso 9 lineal: compara subsky (polinomio y RBF) y GraXpert IA, mide y recomienda. La imagen no cambia."""
    info = H._info(siril)
    crudo = _crudo(siril)
    p = _pantalla(crudo, info)
    if not _lineal(p):
        raise RuntimeError("La imagen no parece lineal (mediana > 0,05): el gradiente se corrige en lineal (Paso 9).")
    _comprobar_bordes(p, ignorar_cunas)
    huella = _huella(crudo)
    base = _preparar_gradiente(p)
    grupo = "gradiente"
    _limpiar_grupo(grupo)
    r = {"candidatos": [], "errores": [], "recomendado": None, "motivo": ""}
    lista = [("subsky", f"polinomio {g}", ["subsky", str(int(g)), f"-samples={int(muestras)}", f"-tolerance={float(tolerancia)}"])
             for g in (polinomio or [])]
    lista += [("subsky", f"RBF suavizado {s}", ["subsky", "-rbf", f"-samples={int(muestras)}", f"-tolerance={float(tolerancia)}",
                                                  f"-smooth={float(s)}"]) for s in (rbf or [])]
    if usar_graxpert:
        lista.append(("graxpert", "GraXpert IA", None))
    n = 0
    try:
        for metodo, nombre, cmd in lista:
            n += 1
            t0 = time.perf_counter()
            try:
                if cmd:
                    siril.cmd(*cmd)
                    res = _crudo(siril)
                    texto = " ".join(cmd)
                else:
                    res, texto = _graxpert_ia(siril, info, crudo)
                m = _medir_gradiente(base, _pantalla(res, info))
                cid = _guardar_candidato(grupo, n, res, {"nombre": nombre, "comando": texto, "huella_base": huella,
                                                         "metricas": m})
                r["candidatos"].append({"id": cid, "metodo": nombre, "comando": texto, "metricas": m,
                                        "segundos": _r(time.perf_counter() - t0, 1)})
            except Exception as e:
                r["errores"].append(f"{nombre}: {e}")
            finally:
                if cmd:
                    _restaurar(siril, crudo)
    finally:
        _restaurar(siril, crudo)

    def absc(x): return abs(x["metricas"]["copia_objeto"] or 0)
    def resid(x): v = x["metricas"]["gradiente_restante"]; return v if v is not None else 9
    def eat(x): v = x["metricas"]["objeto_quitado_pct"]; return abs(v) if v is not None else 100
    c = r["candidatos"]
    # Campos de nebulosa o polvo extenso: lo que se lleva el modelo es señal débil que no vuelve (11 nov 2026: el ★ era
    # un RBF que se llevaba el 2,4 % de la nebulosa). Ahí se tolera ≤ 1 % y, a gradiente parecido, gana el que menos se lleva.
    extenso = base["objeto_campo_pct"] > 25 or bool(re.search(r"(?i)nebul|polvo|dust|ifn|oscur|extens|molecular", str(tipo or "")))
    tope = 1.0 if extenso else 3.0
    seguros = [x for x in c if eat(x) <= tope and absc(x) < 0.3]
    limpios = [x for x in c if absc(x) < 0.3]
    if seguros:
        r0 = min(resid(x) for x in seguros)
        margen = 0.15 if extenso else 0.05
        mejor = min([x for x in seguros if resid(x) <= r0 + margen], key=eat)
    else:
        mejor = min(limpios, key=eat) if limpios else min(c, key=absc) if c else None
    r["criterio"] = (f"campo con objeto extenso o polvo: se tolera que el modelo se lleve ≤ {tope:g} % del objeto"
                     if extenso else f"se tolera que el modelo se lleve ≤ {tope:g} % del objeto")
    if mejor:
        mm = mejor["metricas"]
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: deja {round(100 * resid(mejor))} % del gradiente del cielo, se lleva el "
                       f"{mm['objeto_quitado_pct']} % del objeto, corr {mm['copia_objeto']} "
                       f"({'modelo limpio' if absc(mejor) < 0.15 else 'copia el objeto: revisar' if absc(mejor) > 0.5 else 'intermedio: revisar el modelo'}).")
    else:
        r["motivo"] = "Ningún candidato se pudo medir: ver errores."
    r["objeto_campo_pct"] = _r(base["objeto_campo_pct"], 1)
    r["leyenda"] = ("copia_objeto: cuánto se parece el modelo al objeto (cerca de 0 = limpio; > 0,5 se come el objeto). "
                    "objeto_quitado_pct: % de la señal del objeto que se lleva el modelo. gradiente_restante: fracción del gradiente "
                    "del cielo que queda (plano ajustado a las celdas de cielo, después / antes; menor = más plano). "
                    "irregularidad_cielo: lo mismo con el rango de una rejilla 4×3 (incluye estructura que no es gradiente). "
                    "La imagen NO ha cambiado: aplicarCandidato(id).")
    if base["objeto_campo_pct"] > 40:
        r["aviso_campo"] = (f"El objeto ocupa el {round(base['objeto_campo_pct'])} % del campo: casi no hay cielo libre y las celdas "
                            "de cielo llevan nebulosa débil. gradiente_restante es orientativo (lo que queda puede ser nebulosa, "
                            "no gradiente); irregularidad_cielo no sirve aquí. Decide con previa y estadisticas(bordes).")
    _asegurar_restaurado(siril, crudo, huella, r)
    _galeria(r, info, p, "modelo")
    return r


# --- Aplicar un candidato -----------------------------------------------------------------------------------

def aplicarCandidato(siril, id):
    """Pone en la imagen cargada el candidato 'id' de la última comparación (con deshacer)."""
    cid = str(id)
    if not cid.replace("_", "").isalnum():
        raise ValueError("id no válido.")
    fj, fn = TRABAJO / f"{cid}.json", TRABAJO / f"{cid}.npy"
    if not fj.exists() or not fn.exists():
        disp = sorted(f.stem for f in TRABAJO.glob("*.npy")) if TRABAJO.exists() else []
        raise FileNotFoundError(f"No hay candidato {cid}. Disponibles: {', '.join(disp) or 'ninguno'}.")
    datos = json.loads(fj.read_text(encoding="utf-8"))
    actual = _crudo(siril)
    if _huella(actual) != datos.get("huella_base"):
        raise RuntimeError("La imagen ha cambiado desde la comparación (otra imagen o ya se aplicó algo): repite la comparación.")
    a = np.load(fn)
    _poner(siril, a, f"SirilAstroPilot: {datos.get('nombre', cid)}")
    info = H._info(siril)
    m = _cielo(H._pixeles(siril, info))
    r = {"aplicado": cid, "metodo": datos.get("nombre"), "comando": datos.get("comando"), "medidas": _sin_privado(m),
         "nota": "Guarda esta versión con guardarImagen (v1, v2…) antes del paso siguiente."}
    if datos.get("estrellas"):
        r["estrellas"] = datos["estrellas"]
        r["nota"] += " La capa de estrellas de este candidato es 'estrellas' (para recombinarEstrellas)."
    return r


# --- L12: color con SPCC ------------------------------------------------------------------------------------

def _nombre_spcc(v, campo):
    v = str(v)
    if '"' in v or "\n" in v:
        raise ValueError(f"{campo} no puede llevar comillas.")
    return v


def listaSPCC(siril, tipo="oscsensor"):
    """Nombres que acepta SPCC (sensores, filtros, blanco de referencia), tal como los escribe Siril."""
    tipos = ("oscsensor", "monosensor", "redfilter", "greenfilter", "bluefilter", "oscfilter", "osclpf", "whiteref")
    if tipo not in tipos:
        raise ValueError(f"tipo debe ser uno de {', '.join(tipos)}.")
    antes = siril.get_siril_log() or ""
    siril.cmd("spcc_list", tipo)
    ls = [l for l in _log_nuevo(siril, antes) if "[SirilAstroPilot]" not in l and not l.startswith("spcc_list")
          and not re.fullmatch(r"(?i)(osc|mono|red|green|blue)?\s*(sensors?|filters?|lpf.*|white.*)", l)]
    return {"tipo": tipo, "nombres": ls[:300]}


GUIA_DIR = Path(__file__).resolve().parents[2] / "guia"
# Modelo de cámara → sensor (para cuando la cabecera trae INSTRUME y no hay sensor).
CAMARA_SENSOR = {"2600": "IMX571", "6200": "IMX455", "533": "IMX533", "294": "IMX294", "585": "IMX585", "678": "IMX678",
                 "715": "IMX715", "462": "IMX462", "662": "IMX662", "183": "IMX183", "071": "IMX071", "410": "IMX410",
                 "571": "IMX571", "455": "IMX455", "224": "IMX224", "385": "IMX385", "482": "IMX482", "676": "IMX676"}


def _sensores_spcc(siril, tipo="oscsensor"):
    antes = siril.get_siril_log() or ""
    siril.cmd("spcc_list", tipo)
    return [l for l in _log_nuevo(siril, antes) if "[SirilAstroPilot]" not in l and not l.startswith("spcc_list")]


MARCAS_DSLR = r"(?i)\b(canon|nikon|sony\s+(?:ilce|slt|nex|dsc|alpha|α)|pentax|ricoh|fujifilm|olympus|om\s?system|panasonic)"


def _norm_cam(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower().replace("mark", "mk"))


def _sensor_de_texto(texto):
    m = re.search(r"IMX\s?(\d{3})", texto)
    if m:
        return f"Sony IMX{m.group(1)}"
    m = re.search(r"(?i)(?:ASI|QHY|POA|Player\w*|Touptek\w*)\s?(\d{3,4})\s?(?:MC|MM|C)\b", texto)
    if m and m.group(1) in CAMARA_SENSOR:
        return f"Sony {CAMARA_SENSOR[m.group(1)]}"
    return None


def _camara_cabecera(k):
    return str(getattr(k, "instrume", "") or "").strip()


def _sensor_por_defecto(siril, k, ignorar_perfil=False):
    """Sensor de SPCC sin preguntar al modelo. Manda la cámara de la cabecera (INSTRUME) de ESTA imagen; el perfil
    (guia/perfil.md) sólo si la cabecera no dice nada y no se pide ignorarlo (fotos de otro equipo).
    Devuelve (sensor | None, origen, dslr_sin_curva). Nunca uno inventado: el 10 nov 2026 Qwen eligió «OmniVision
    OS08B10» para una ASI2600MC (IMX571); el 11 nov el perfil (IMX571) se habría aplicado a una Canon EOS 6D."""
    cam = _camara_cabecera(k)
    if cam:
        s = _sensor_de_texto(cam)
        if s:
            return s, f"cabecera INSTRUME ({cam})", None
        if re.search(MARCAS_DSLR, cam):
            disp = _sensores_spcc(siril)
            igual = [d for d in disp if _norm_cam(d) == _norm_cam(cam)]
            if igual:
                return igual[0], f"cabecera INSTRUME ({cam}, DSLR)", None
            return None, f"cabecera INSTRUME ({cam}, DSLR)", cam
    if not ignorar_perfil:
        try:
            s = _sensor_de_texto((GUIA_DIR / "perfil.md").read_text(encoding="utf-8"))
            if s:
                return s, "perfil.md", None
        except OSError:
            pass
    return None, None, None


def _gaia_local(siril=None):
    """¿Está instalado el Gaia astrométrico local de Siril (siril_cat_healpix8_astro.dat)? Lo usan platesolve y pcc."""
    cands = []
    if siril is not None:
        try:
            cands.append(siril.get_siril_config("core", "catalogue_gaia_astro"))
        except Exception:
            pass
    cands.append(os.path.join(os.environ.get("LOCALAPPDATA", ""), "siril", "siril_cat_healpix8_astro.dat"))
    return any(c and os.path.isfile(str(c)) for c in cands)


FALLO_CATALOGO = re.compile(r"(?i)libcurl|remote catalogue|catalogue server|catalog error|no stars identified|"
                            r"unable to retrieve|could not download|cannot create catalogue")


def _estrellas_color(q, L, sigma, max_n=3000, caja=3):
    """Estrellas no saturadas para equilibrar el blanco: máximos locales de L por encima de 30 σ, lejos del borde, sin
    ningún canal cerca de la saturación. Devuelve el flujo por canal (caja (2·caja+1)² sin fondo) de cada estrella."""
    h, w = L.shape
    alto = L > 30 * max(sigma, 1e-7)
    alto[:caja + 2, :] = alto[-caja - 2:, :] = False
    alto[:, :caja + 2] = alto[:, -caja - 2:] = False
    ys, xs = np.nonzero(alto)
    if len(ys) == 0:
        return np.zeros((0, 3))
    v = L[ys, xs]
    pico = np.ones(len(ys), bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx:
                pico &= v >= L[ys + dy, xs + dx]
    ys, xs, v = ys[pico], xs[pico], v[pico]
    tope = float(np.percentile(q.max(axis=0)[::7, ::7], 99.99))
    orden = np.argsort(-v)
    flujos = []
    for j in orden:
        y, x = ys[j], xs[j]
        blk = q[:, y - caja:y + caja + 1, x - caja:x + caja + 1]
        if blk.max() >= 0.9 * max(tope, 1e-6) or blk.max() > 0.95 or blk.min(axis=(1, 2)).min() < -5 * sigma:
            continue                                    # saturada o pegada a otra cosa rara
        flujos.append(blk.sum(axis=(1, 2)))
        if len(flujos) >= max_n:
            break
    return np.array(flujos) if flujos else np.zeros((0, 3))


def equilibrarColor(siril, referencia="estrellas", **_):
    """Paso 12 sin catálogo (sin internet o cámara sin curvas): color APROXIMADO. Neutraliza el fondo (cada canal a la
    misma mediana del cielo) y equilibra el blanco para que el color medio de las estrellas no saturadas sea neutro
    (referencia «objeto»: el de las zonas brillantes). No es una calibración fotométrica: las estrellas de campo son de
    media algo amarillentas, así que el blanco queda un poco frío respecto a una SPCC. Deja deshacer."""
    info = H._info(siril)
    if info["canales"] != 3:
        raise RuntimeError("equilibrarColor necesita una imagen en color (3 canales).")
    crudo = siril.get_image_pixeldata()             # orden de filas de Siril: la operación es por píxel
    p = _de_siril(crudo)
    if not _lineal(p):
        raise RuntimeError("La imagen no parece lineal (mediana > 0,05): el color se equilibra en lineal, antes de estirar.")
    c0 = _cielo(p)
    cielo = np.array(_cielo_por_canal(p, c0["_celdas"]), dtype=np.float32)
    q = p - cielo[:, None, None]
    L = q.mean(axis=0)
    ys, xs, S = c0["_celdas"]
    muestra = np.concatenate([L[y * S:(y + 1) * S:2, x * S:(x + 1) * S:2].ravel() for y, x in zip(ys, xs)])
    sigma = 1.4826 * float(np.median(np.abs(muestra - np.median(muestra))))
    if referencia == "objeto":
        umbral = float(np.percentile(L[::4, ::4], 99.5))
        m = (L > umbral) & (p.max(axis=0) < 0.9)
        n_ref = int(m.sum())
        if n_ref < 500:
            raise RuntimeError("No hay bastante objeto brillante sin saturar para tomarlo como blanco: usa referencia «estrellas».")
        medio = np.array([float(np.median(q[c][m])) for c in range(3)])
        dispersion = None
    else:
        fl = _estrellas_color(q, L, sigma)
        fl = fl[(fl > 0).all(axis=1)]
        n_ref = len(fl)
        if n_ref < 20:
            raise RuntimeError(f"Sólo {n_ref} estrellas útiles (no saturadas, sobre 30 σ): no se puede equilibrar el blanco "
                               "con fiabilidad.")
        lr = np.log(fl / fl[:, 1:2])                  # color de cada estrella respecto al verde
        medio = np.exp(np.median(lr, axis=0))
        dispersion = _r(float(1.4826 * np.median(np.abs(lr[:, [0, 2]] - np.median(lr[:, [0, 2]], axis=0)))), 3)
    factores = 1.0 / np.maximum(medio, 1e-6)
    factores = factores / factores[1]
    nivel = float(np.median(cielo))
    out = np.clip(q * factores[:, None, None].astype(np.float32) + nivel, 0, 1).astype(np.float32)
    _poner(siril, _a_siril(out, crudo.dtype).reshape(crudo.shape), "equilibrarColor")
    despues = _cielo_por_canal(out, c0["_celdas"])
    dom0 = 100.0 * (cielo.max() - cielo.min()) / max(float(cielo.mean()), 1e-9)
    dom1 = 100.0 * (max(despues) - min(despues)) / max(float(np.mean(despues)), 1e-9)
    return {"metodo": f"equilibrado sin catálogo (fondo neutro + blanco medio {'de las estrellas' if referencia != 'objeto' else 'del objeto'})",
            "aproximado": True, "referencia": referencia, "n_referencia": n_ref,
            "factores_rgb": [_r(float(x), 4) for x in factores], "cielo_por_canal_antes": [_r(float(x), 5) for x in cielo],
            "cielo_por_canal_despues": [_r(x, 5) for x in despues], "dominante_cielo_antes_pct": _r(dom0, 1),
            "dominante_cielo_pct": _r(dom1, 1), "dispersion_color_estrellas": dispersion,
            "nota": "Color aproximado, no fotométrico: dilo en el informe. Con internet (o el catálogo local) es mejor PCC/SPCC."}


def _con_respaldo(siril, lanzar, que):
    """Lanza pcc/spcc; si falla por el catálogo (sin conexión, servidor caído), cae a equilibrarColor avisando."""
    log0 = siril.get_siril_log() or ""
    try:
        lanzar()
        return None
    except Exception as e:
        texto = str(e) + "\n" + "\n".join(_log_nuevo(siril, log0))
        if not FALLO_CATALOGO.search(texto):
            raise
        r = equilibrarColor(siril)
        r["aviso"] = (f"{que} no pudo leer el catálogo de estrellas (servidor sin respuesta o sin internet): se ha aplicado "
                      "el equilibrado sin catálogo, que es aproximado. No repitas la misma llamada: si quieres PCC/SPCC, "
                      "instala el catálogo local o espera a que vuelva el servidor y pásalo con deshacer antes.")
        r["fallo_catalogo"] = [l for l in _log_nuevo(siril, log0) if FALLO_CATALOGO.search(l)][:3]
        return r


def _calibrar_pcc(siril, info, p, limitmag, catalogo):
    """PCC de Siril: color por fotometría de estrellas del catálogo, sin curvas de sensor ni filtro."""
    if limitmag is not None and not re.fullmatch(r"[+-]?\d+(\.\d+)?", str(limitmag).strip()):
        raise ValueError("limitmag: un número o un ajuste relativo con signo (+1, -1).")
    c0 = _cielo(p)
    antes_canal = _cielo_por_canal(p, c0["_celdas"])
    args = []
    if limitmag is not None:
        args.append(f"-limitmag={str(limitmag).strip()}")
    cat = str(catalogo or "").strip().lower()
    if not cat and _gaia_local():
        cat = "localgaia"                   # sin pedirlo: el Gaia local si está (sin internet y sin colas de VizieR)
    if cat:
        if cat not in ("nomad", "apass", "gaia", "localgaia"):
            raise ValueError("catalogo para PCC: nomad, apass, gaia o localgaia.")
        args.append(f"-catalog={cat}")
    log0 = siril.get_siril_log() or ""
    t0 = time.perf_counter()
    r_resp = _con_respaldo(siril, lambda: siril.cmd("pcc", *args), "PCC")
    if r_resp:
        return r_resp
    despues_canal = _cielo_por_canal(H._pixeles(siril, info), c0["_celdas"])
    medias = np.mean(despues_canal)
    dom = 100.0 * (max(despues_canal) - min(despues_canal)) / medias if medias > 0 else 0
    registro = [l for l in _log_nuevo(siril, log0) if "[SirilAstroPilot]" not in l]
    r = {"comando": " ".join(["pcc", *args]), "metodo": "PCC (fotométrica, sin curvas de sensor)",
         "segundos": _r(time.perf_counter() - t0, 1),
         "cielo_por_canal_antes": [_r(x, 5) for x in antes_canal], "cielo_por_canal_despues": [_r(x, 5) for x in despues_canal],
         "dominante_cielo_pct": _r(dom, 1), "registro": registro[-15:]}
    desv = [float(x) for x in re.findall(r"deviation:\s*([\d.]+)", "\n".join(registro))]
    m_est = re.search(r"using (\d+) stars", "\n".join(registro))
    if desv:
        r["dispersion_factores"] = [_r(x, 3) for x in desv]
    if m_est:
        r["estrellas_usadas"] = int(m_est.group(1))
    if any("imprecise" in l.lower() for l in registro):
        r["aviso_pcc"] = ("Siril dice que la solución es imprecisa (dispersión de factores "
                          + (f"hasta {max(desv):.2f}" if desv else "alta")
                          + ") y sugiere quitar el gradiente, aunque ya esté quitado: es su mensaje genérico cuando las "
                          "estrellas dan colores muy distintos entre sí. Causas habituales: viñeteo sin flats (cada canal cae "
                          "distinto hacia los bordes), campo muy amplio con extinción o color variable, o gradiente residual. "
                          "Dilo en el informe; el color sale de cientos de estrellas y suele ser bueno en el centro. Comprueba "
                          "la dominante del cielo y, si hay viñeteo de color hacia los bordes, revísalo antes de estirar.")
    if dom >= 5:
        r["aviso"] = (f"El cielo queda con una dominante del {round(dom, 1)} %: suele venir del gradiente; revisa el Paso 9 "
                      "o neutraliza el fondo antes de estirar.")
    return r


def calibrarColor(siril, sensor=None, mono=False, forzar_sensor=False, filtro=None, lpf=None, filtros_rgb=None, blanco=None,
                  limitmag=None, catalogo=None, banda_estrecha=None, ignorar_perfil=False, fotometrica=False):
    """Paso 12 lineal: SPCC sobre la imagen cargada (lineal y con astrometría), con el cielo por canal antes y después.
    ignorar_perfil: la foto no es del equipo del perfil (no se usa su sensor). fotometrica: PCC (sin curvas de sensor)
    cuando la cámara no está en la base de SPCC (p. ej. muchas DSLR)."""
    info = H._info(siril)
    if info["canales"] != 3:
        raise RuntimeError("SPCC necesita una imagen en color (3 canales).")
    k = siril.get_image_keywords()
    if not getattr(k, "pltsolvd", False):
        raise RuntimeError("La imagen no tiene astrometría: resolverAstrometria primero (Paso 8).")
    p = H._pixeles(siril, info)
    if not _lineal(p):
        raise RuntimeError("La imagen no parece lineal (mediana > 0,05): SPCC va en lineal, antes de estirar.")
    # Argumentos comprobados antes de lanzar spcc (Siril sólo responde «Argument error»).
    if limitmag is not None and not re.fullmatch(r"[+-]?\d+(\.\d+)?", str(limitmag).strip()):
        raise ValueError("limitmag: un número (magnitud límite, p. ej. 12) o un ajuste relativo con signo (+1, -1).")
    if fotometrica:
        return _calibrar_pcc(siril, info, p, limitmag, catalogo)
    origen_sensor = "pedido"
    dslr = None
    if sensor and not mono and not forzar_sensor:
        esperado, origen, _ = _sensor_por_defecto(siril, k, ignorar_perfil)
        if esperado and esperado != sensor:
            raise ValueError(f"Según {origen}, el sensor es {esperado}, no «{sensor}». Usa {esperado} (o pasa "
                             "forzar_sensor: true si de verdad es otra cámara; ignorar_perfil: true si la foto es de otro equipo).")
    if not sensor and not mono:
        sensor, origen_sensor, dslr = _sensor_por_defecto(siril, k, ignorar_perfil)
        if dslr:
            raise ValueError(f"La cámara es una DSLR ({dslr}) que no está en la base de SPCC de Siril (sólo trae algunas "
                             "Canon y Nikon). No uses otra parecida: o calibrarColor con fotometrica: true (PCC, sin curvas "
                             "de sensor), o un sensor exacto de listaSPCC(oscsensor) que el usuario confirme como equivalente.")
        if not sensor:
            raise ValueError("Falta el sensor de la cámara: la cabecera no lo dice"
                             + (" y se pidió ignorar el perfil" if ignorar_perfil else "")
                             + ". Pídeselo al usuario o mira listaSPCC(oscsensor); si no está, fotometrica: true (PCC). "
                             "No uses uno parecido: un sensor equivocado da un color equivocado.")
    if sensor and not mono and not lpf and re.search(MARCAS_DSLR, str(sensor)):
        if re.search(r"(?i)canon", str(sensor)):
            lpf = "Canon LPF"               # filtro de serie de las Canon sin modificar (curva medida en una 350D)
        elif re.search(r"(?i)nikon", str(sensor)) and str(sensor) in _sensores_spcc(siril, "osclpf"):
            lpf = str(sensor)               # la base trae el filtro de serie de algunas Nikon con el nombre del modelo
    if sensor and not mono:
        disp = _sensores_spcc(siril)
        if disp and sensor not in disp:
            cerca = [d for d in disp if any(tok in d for tok in re.findall(r"\d{3,4}", sensor))]
            raise ValueError(f"El sensor «{sensor}» no está en la lista de SPCC de este Siril. "
                             + (f"Parecidos: {', '.join(cerca)}. " if cerca else "") + "Usa un nombre exacto de listaSPCC.")
    c0 = _cielo(p)
    antes_canal = _cielo_por_canal(p, c0["_celdas"])
    args = []
    if limitmag is not None:
        args.append(f"-limitmag={str(limitmag).strip()}")
    if catalogo:
        args.append(f"-catalog={'localgaia' if str(catalogo) == 'localgaia' else 'gaia'}")
    if banda_estrecha:
        args.append("-narrowband")
        for clave in ("rwl", "rbw", "gwl", "gbw", "bwl", "bbw"):
            if clave in banda_estrecha:
                args.append(f"-{clave}={float(banda_estrecha[clave])}")
    if sensor:
        args.append(f'"-{"monosensor" if mono else "oscsensor"}={_nombre_spcc(sensor, "sensor")}"')
    if mono and filtros_rgb:
        for clave, nombre in zip(("rfilter", "gfilter", "bfilter"), filtros_rgb):
            args.append(f'"-{clave}={_nombre_spcc(nombre, "filtros_rgb")}"')
    if not mono and filtro:
        args.append(f'"-oscfilter={_nombre_spcc(filtro, "filtro")}"')
    if not mono and lpf:
        args.append(f'"-osclpf={_nombre_spcc(lpf, "lpf")}"')
    if blanco:
        args.append(f'"-whiteref={_nombre_spcc(blanco, "blanco")}"')
    log0 = siril.get_siril_log() or ""
    t0 = time.perf_counter()
    r_resp = _con_respaldo(siril, lambda: siril.cmd("spcc", *args), "SPCC")
    if r_resp:
        return r_resp
    p2 =H._pixeles(siril, info)
    c1 = _cielo(p2)
    despues_canal = _cielo_por_canal(p2, c0["_celdas"])
    medias = np.mean(despues_canal)
    dom = 100.0 * (max(despues_canal) - min(despues_canal)) / medias if medias > 0 else 0
    r = {"comando": " ".join(["spcc", *args]), "segundos": _r(time.perf_counter() - t0, 1),
         "cielo_por_canal_antes": [_r(x, 5) for x in antes_canal], "cielo_por_canal_despues": [_r(x, 5) for x in despues_canal],
         "dominante_cielo_pct": _r(dom, 1),
         "registro": [l for l in _log_nuevo(siril, log0) if "[SirilAstroPilot]" not in l][-15:]}
    if dom >= 5:
        r["aviso"] = (f"El cielo queda con una dominante del {round(dom, 1)} %: suele venir del gradiente; revisa el Paso 9 "
                      "o neutraliza el fondo antes de estirar.")
    if origen_sensor != "pedido":
        r["nota_sensor"] = f"Sensor {sensor} tomado de: {origen_sensor} (no lo indicaste)."
    if lpf and re.search(MARCAS_DSLR, str(sensor or "")):
        r["nota_lpf"] = (f"DSLR con filtro de serie «{lpf}». Si la cámara está modificada (sin filtro IR), repite con "
                         "lpf: «Generic / None» (nombre exacto en listaSPCC(osclpf)).")
    return r


# --- L15: separar estrellas con StarNet ---------------------------------------------------------------------

def _starnet2_exe(siril):
    """starnet2.exe (StarNet2 2.5+ por línea de comandos): config.json, preferencia de Siril, PATH o carpeta de instalación."""
    cands = [_config().get("starnet2")]
    try:
        cands.append(siril.get_siril_config("core", "starnet_exe"))
    except Exception:
        pass
    cands += [shutil.which("starnet2") or "",
              os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "StarNet2", "bin", "starnet2.exe")]
    for x in cands:
        if x and os.path.isfile(str(x)) and Path(str(x)).name.lower().startswith("starnet2"):
            return str(x)
    return None


def _separar_starnet2(siril, info, crudo, lineal, upscale, timeout=1800):
    """StarNet2 por su ejecutable sobre una copia FITS. Devuelve (starless, estrellas, texto) en el tipo de Siril."""
    exe = _starnet2_exe(siril)
    if not exe:
        raise RuntimeError("No encuentro starnet2.exe. Ponlo en Siril (Preferencias > Misceláneo > StarNet) o en "
                           "~/.sirilastropilot/config.json: {\"starnet2\": \"D:/.../starnet2.exe\"}.")
    TRABAJO.mkdir(parents=True, exist_ok=True)
    for f in TRABAJO.glob("sn_*"):
        f.unlink()
    ent, sal, est = TRABAJO / "sn_entrada.fits", TRABAJO / "sn_starless.fits", TRABAJO / "sn_estrellas.fits"
    a = np.clip(_de_siril(crudo), 0, 1).astype(np.float32)
    siril.save_image_file(a if crudo.ndim == 3 else a[0], siril.get_image_fits_header() or "", str(ent))
    cmd = [exe, "-i", str(ent), "-o", str(sal), "-m", str(est), "-q"] + (["--linear"] if lineal else []) + \
          (["-u"] if upscale else [])
    pr = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if pr.returncode != 0 or not sal.exists():
        raise RuntimeError(f"StarNet2 falló (código {pr.returncode}): {(pr.stderr or pr.stdout)[-400:]}")

    def leer(f):
        d = np.asarray(siril.load_image_from_file(str(f)).data, dtype=np.float32)
        if d.ndim == 3 and d.shape[0] not in (1, 3) and d.shape[-1] in (1, 3):
            d = np.moveaxis(d, -1, 0)
        d = d.reshape(crudo.shape)
        return _a_siril(np.clip(_de_siril(d) if d.dtype != np.float32 else d, 0, 1), crudo.dtype).reshape(crudo.shape)

    sl = leer(sal)
    st = leer(est) if est.exists() else None
    texto = " ".join(Path(c).name if i == 0 or c.startswith(str(TRABAJO)) else c for i, c in enumerate(cmd))
    return sl, st, texto


def separarEstrellas(siril, estirar=None, upscale=False, motor="auto"):
    """Paso 15 lineal: StarNet. Deja la starless cargada y la capa de estrellas en un fichero.
    motor: siril (comando starnet), starnet2 (ejecutable StarNet2 2.5+ directo) o auto (Siril y, si falla, starnet2)."""
    info = H._info(siril)
    p = H._pixeles(siril, info)
    lineal = _lineal(p)
    if estirar is None:
        estirar = lineal
    if motor not in ("auto", "siril", "starnet2"):
        raise ValueError("motor: auto, siril o starnet2.")
    wd = siril.get_siril_wd()
    if motor == "starnet2":
        return _separar_directo(siril, info, p, lineal, upscale, wd)
    antes = {f: os.path.getmtime(f) for f in glob.glob(os.path.join(wd, "starmask*"))}
    args = (["-stretch"] if estirar else []) + (["-upscale"] if upscale else [])
    t0 = time.perf_counter()
    try:
        siril.cmd("starnet", *args)
    except Exception as e:
        if motor == "auto" and _starnet2_exe(siril):
            r = _separar_directo(siril, info, p, lineal, upscale, wd)
            r["nota_motor"] = f"El comando starnet de Siril falló ({str(e)[:120]}); hecho con starnet2 directo."
            return r
        if "not found" in str(e).lower():
            raise RuntimeError("Siril no encuentra StarNet: indica la carpeta de StarNet en Preferencias > Misceláneo "
                               "(o el ejecutable) y vuelve a probar.") from e
        raise
    nuevos = [f for f in glob.glob(os.path.join(wd, "starmask*")) if os.path.getmtime(f) != antes.get(f)]
    info2 = H._info(siril)
    p2 = H._pixeles(siril, info2)
    quitado = float(np.mean(_lum(p) - _lum(p2)))
    r = {"comando": " ".join(["starnet", *args]), "segundos": _r(time.perf_counter() - t0, 1), "lineal": lineal,
         "starless": "cargada en Siril (sin guardar)", "estrellas": max(nuevos, key=os.path.getmtime) if nuevos else None,
         "senal_quitada_media": _r(quitado, 6), "imagen": info2,
         "nota": "Guarda la starless con guardarImagen. La capa de estrellas se abre luego con abrirImagen."}
    if quitado <= 0:
        r["aviso"] = "La starless no tiene menos señal que la original: ¿ha funcionado StarNet? Mira registro."
    if not nuevos:
        r["aviso_estrellas"] = "No encuentro el fichero starmask en la carpeta de trabajo de Siril."
    return r


def _carpeta_capas(siril, info):
    """Carpeta para las capas de estrellas: la del fichero cargado (junto a las versiones), o trabajo/ si no se puede.
    Antes iban a la carpeta de trabajo de Siril (en M31 era Imágenes del usuario, 10 nov 2026)."""
    try:
        d = Path(info["fichero"]).parent
        if info["fichero"] and d.is_dir() and os.access(d, os.W_OK):
            return str(d)
    except Exception:
        pass
    TRABAJO.mkdir(parents=True, exist_ok=True)
    return str(TRABAJO)


def _separar_directo(siril, info, p, lineal, upscale, wd):
    wd = _carpeta_capas(siril, info)
    """separarEstrellas con starnet2.exe: pone la starless (con deshacer) y guarda las estrellas en la carpeta de Siril."""
    crudo = _crudo(siril)
    t0 = time.perf_counter()
    sl, st, texto = _separar_starnet2(siril, info, crudo, lineal, upscale)
    _poner(siril, sl, "SirilAstroPilot: StarNet2 starless")
    f_est = None
    if st is not None:
        base = Path(info["fichero"] or "imagen").stem
        f_est = os.path.join(wd, f"starmask_{base}.fit")
        n = 2
        while os.path.exists(f_est):
            f_est = os.path.join(wd, f"starmask_{base}_{n}.fit")
            n += 1
        siril.save_image_file(st if st.ndim == 3 and st.shape[0] > 1 else st.reshape(st.shape[-2:]),
                              siril.get_image_fits_header() or "", f_est)
    info2 = H._info(siril)
    p2 = H._pixeles(siril, info2)
    quitado = float(np.mean(_lum(p) - _lum(p2)))
    r = {"comando": texto, "motor": "starnet2", "segundos": _r(time.perf_counter() - t0, 1), "lineal": lineal,
         "starless": "cargada en Siril (sin guardar)", "estrellas": f_est, "senal_quitada_media": _r(quitado, 6),
         "imagen": info2, "nota": "Guarda la starless con guardarImagen. Capa de estrellas = original − starless "
                                 "(lineal si la imagen lo era): recombinarEstrellas con estirar_estrellas: true tras estirar."}
    if quitado <= 0:
        r["aviso"] = "La starless no tiene menos señal que la original: ¿ha funcionado StarNet2?"
    return r


# --- Herramientas de IA de RC Astro por su programa de línea de comandos (rc-astro) ---------------------------
# Productos: sxt (quitar estrellas), nxt (ruido), bxt (deconvolución). Se llaman sobre una copia FITS 0–1; la salida
# FITS conserva el orden de filas de la entrada (README-DEVS del CLI, sección 17), así que vuelve tal cual a Siril.

def _rcastro_exe():
    cands = [_config().get("rcastro"), shutil.which("rc-astro") or "",
             os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "RC-Astro", "CLI", "rc-astro.exe"),
             "/Applications/RC-Astro/CLI/rc-astro"]
    for x in cands:
        if x and os.path.isfile(str(x)):
            return str(x)
    return None


def _rcastro(siril, crudo, producto, args=(), timeout=1800, reescalar_alto=False):
    """Ejecuta 'rc-astro <producto>' sobre la imagen 'crudo'. Devuelve ({nombre: array tipo Siril}, texto del comando).
    reescalar_alto: si la salida pasa de 1 (la deconvolución concentra el flujo en núcleos más pequeños), se divide toda la
    imagen por su máximo en vez de recortar: recortar crea núcleos planos que cuentan como estrellas saturadas (11 nov 2026:
    327 → 1596 tras --correct-only). Sólo para salidas únicas (no para starless + estrellas, que deben sumar)."""
    exe = _rcastro_exe()
    if not exe:
        raise RuntimeError("No encuentro rc-astro (CLI de RC Astro). Instálalo o pon su ruta en ~/.sirilastropilot/config.json: "
                           "{\"rcastro\": \"C:/Program Files/RC-Astro/CLI/rc-astro.exe\"}.")
    d = TRABAJO / f"rc_{producto}"
    d.mkdir(parents=True, exist_ok=True)
    for f in d.glob("*"):
        f.unlink()
    ent, sal = d / "entrada.fits", d / "salida.fits"
    a = np.clip(_de_siril(crudo), 0, 1).astype(np.float32)
    holgura = 0.5 if reescalar_alto else 1.0          # rc-astro recorta su salida a 1: margen para núcleos que suben
    if holgura != 1.0:
        a = a * np.float32(holgura)
    siril.save_image_file(a if crudo.ndim == 3 else a[0], siril.get_image_fits_header() or "", str(ent))
    cmd = [exe, producto, str(ent), "-o", str(sal), "--overwrite", *[str(x) for x in args]]
    pr = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if pr.returncode != 0 or not sal.exists():
        raise RuntimeError(f"rc-astro {producto} falló (código {pr.returncode}): {(pr.stderr or pr.stdout)[-400:]}")
    out = {}
    for f in d.glob("*.fits"):
        if f.name == ent.name:
            continue
        x = np.asarray(siril.load_image_from_file(str(f)).data)
        if x.ndim == 3 and x.shape[0] not in (1, 3) and x.shape[-1] in (1, 3):
            x = np.moveaxis(x, -1, 0)
        x = _de_siril(x)
        if holgura != 1.0:
            x = x / np.float32(holgura)                   # vuelta a la escala original
            maximo = float(x.max())
            if maximo > 1.0:                              # núcleos por encima de 1: se baja todo, no se recorta
                x = x / np.float32(maximo)
                out["_reescalado"] = maximo
        x = np.clip(x, 0, 1)
        out["salida" if f.name == sal.name else f.stem] = _a_siril(x, crudo.dtype).reshape(crudo.shape)
    texto = " ".join(["rc-astro", producto, *[str(x) for x in args]])
    return out, texto


# --- L15: comparar motores para quitar estrellas ---------------------------------------------------------------

def _medir_starless(base, z, sl, est):
    """Criterios neutros: restos de estrellas, agujeros donde había estrellas, objeto quitado, aporte de la capa."""
    L0, L1 = _lum(base), _lum(sl)
    nucleos = z["est_px"]
    hp0 = z["hp"]
    hp1 = L1 - _caja(L1, 5)
    s = max(z["ruido"], 1e-9)
    picos = nucleos & (hp0 > 5 * s)
    restos = 100.0 * float(np.clip(hp1[picos], 0, None).sum()) / max(float(hp0[picos].sum()), 1e-12) if picos.any() else None
    loc = _caja(L1, 6)
    agujeros = 100.0 * float((L1[picos] < loc[picos] - 3 * s).mean()) if picos.any() else None
    # Objeto quitado con medianas de celdas de 64 px: la mediana no ve las estrellas (ocupan poco de cada celda),
    # así que solo cuenta lo que el motor quita de la nebulosa. Con píxeles, en un campo de Vía Láctea las estrellas
    # débiles fuera de los núcleos contaban como objeto (IC 1396: 15–19 % para los dos motores).
    S = z["S"]
    obj_c = z["obj_c"]
    cielo = z["medidas"]["cielo"]
    if obj_c.any():
        m0, m1 = _celdas(L0, S)[obj_c], _celdas(L1, S)[obj_c]
        senal = float((m0 - cielo).sum())
        quitado = 100.0 * float((m0 - m1).sum()) / senal if senal > 0 else None
    else:
        quitado = None
    return {"restos_estrellas_pct": _r(restos, 2), "agujeros_pct": _r(agujeros, 2), "objeto_quitado_pct": _r(quitado, 2),
            "capa_estrellas_media": _r(float(_lum(est).mean()), 6) if est is not None else None}


def estrellasCandidatos(siril, motores=("starnet", "starx"), objeto_max=2.0, tipo=None):
    """Paso 15 lineal: quita las estrellas con StarNet y con StarX (los que estén instalados), mide y recomienda.
    La imagen no cambia: aplicarCandidato(id) pone la starless elegida y devuelve su capa de estrellas."""
    info = H._info(siril)
    crudo = _crudo(siril)
    p = _pantalla(crudo, info)
    lineal = _lineal(p)
    z = _zonas(p)
    huella = _huella(crudo)
    grupo = "estrellas"
    _limpiar_grupo(grupo)
    wd = _carpeta_capas(siril, info)
    base = Path(info["fichero"] or "imagen").stem
    r = {"lineal": lineal, "candidatos": [], "errores": []}
    n = 0
    for m in motores:
        n += 1
        t0 = time.perf_counter()
        try:
            if m == "starnet":
                sl, st, texto = _separar_starnet2(siril, info, crudo, lineal, False)
                nombre = "StarNet2"
            elif m == "starx":
                out, texto = _rcastro(siril, crudo, "sxt", ["--stars"])
                sl = out.pop("salida")
                st = next(iter(out.values())) if out else None
                nombre = "StarX"
            else:
                raise ValueError("motor desconocido (starnet, starx)")
            if st is None:                                  # capa = original − starless
                st = _a_siril(np.clip(_de_siril(crudo) - _de_siril(sl), 0, 1), crudo.dtype).reshape(crudo.shape)
            f_est = os.path.join(wd, f"starmask_{base}_{m}.fit")
            k = 2
            while os.path.exists(f_est):
                f_est = os.path.join(wd, f"starmask_{base}_{m}_{k}.fit")
                k += 1
            siril.save_image_file(st if st.ndim == 3 and st.shape[0] > 1 else st.reshape(st.shape[-2:]),
                                  siril.get_image_fits_header() or "", f_est)
            met = _medir_starless(p, z, _pantalla(sl, info), _pantalla(st, info))
            cid = _guardar_candidato(grupo, n, sl, {"nombre": nombre, "comando": texto, "huella_base": huella,
                                                    "metricas": met, "estrellas": f_est})
            r["candidatos"].append({"id": cid, "metodo": nombre, "comando": texto, "estrellas": f_est, "metricas": met,
                                    "segundos": _r(time.perf_counter() - t0, 1)})
        except Exception as e:
            r["errores"].append(f"{m}: {e}")
    c = r["candidatos"]

    def v(x, k, d=1e9):
        y = x["metricas"][k]
        return d if y is None else y
    ok = [x for x in c if v(x, "objeto_quitado_pct", 0) <= objeto_max]
    mejor = min(ok or c, key=lambda x: (v(x, "restos_estrellas_pct") + v(x, "agujeros_pct", 0))) if c else None
    if mejor:
        mm = mejor["metricas"]
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: deja {mm['restos_estrellas_pct']} % de restos de estrellas, {mm['agujeros_pct']} % de "
                       f"agujeros y se lleva el {mm['objeto_quitado_pct']} % del objeto"
                       + ("" if ok else f" (todos se llevan más del {objeto_max} % del objeto: revisar con previa)") + ".")
    else:
        r["motivo"] = "Ningún motor ha funcionado: ver errores."
    r["leyenda"] = ("restos_estrellas_pct: energía de los picos de estrella que queda en la starless (menos es mejor). agujeros_pct: "
                    "% de núcleos que quedan por debajo del fondo de alrededor (huecos oscuros). objeto_quitado_pct: señal del "
                    "objeto (fuera de estrellas y halos) que se lleva el motor. La imagen NO ha cambiado: aplicarCandidato(id) "
                    "pone la starless y devuelve la ruta de su capa de estrellas.")
    _asegurar_restaurado(siril, crudo, huella, r)
    _galeria(r, info, p, "estrellas")
    return r


# --- L11/L13: deconvolución con IA (BlurX por el CLI de RC Astro) ----------------------------------------------

def nitidezLineal(siril, solo_corregir=False, estrellas=0.5, nebulosa=0.5, halos=0.0):
    """Pasos 11/13 lineales: deconvolución con el CLI de RC Astro (bxt). Pone el resultado con deshacer y mide estrellas."""
    info = H._info(siril)
    crudo = _crudo(siril)
    if not _lineal(_pantalla(crudo, info)):
        raise RuntimeError("La imagen no parece lineal: la deconvolución va en lineal (Pasos 11 y 13).")
    k = siril.get_image_keywords()
    escala = (206.265 * k.pixel_size_x * max(1, k.binning_x or 1) / k.focal_length
              if k and k.focal_length and k.pixel_size_x else None)
    antes = H._estrellas(siril, escala)
    if solo_corregir:
        args = ["--correct-only"]
    else:
        args = [f"--ss={float(estrellas):.2f}", f"--sn={float(nebulosa):.2f}", f"--ash={float(halos):.2f}"]
    t0 = time.perf_counter()
    out, texto = _rcastro(siril, crudo, "bxt", args, reescalar_alto=True)
    _poner(siril, out["salida"], f"SirilAstroPilot: {texto}"[:70])
    despues = H._estrellas(siril, escala)
    r = {"comando": texto, "segundos": _r(time.perf_counter() - t0, 1), "estrellas_antes": antes, "estrellas_despues": despues,
         "nota": "Hecho con deshacer. Mira un recorte al 100 % en estrellas (anillos oscuros, núcleos duros) antes de seguir."}
    if out.get("_reescalado"):
        r["reescalado"] = (f"La salida llegaba a {_r(out['_reescalado'], 3)} (núcleos más concentrados): se ha dividido toda la "
                           "imagen por ese valor en vez de recortar, así que no hay núcleos recortados nuevos. Es lineal: el "
                           "estirado lo compensa.")
    if antes.get("fwhm_px_mediana") and despues.get("fwhm_px_mediana"):
        cambio = 100.0 * (despues["fwhm_px_mediana"] / antes["fwhm_px_mediana"] - 1)
        r["fwhm_cambio_pct"] = _r(cambio, 1)
        if solo_corregir:
            r["lectura"] = ("Sólo corrección (--correct-only, sin enfoque): corrige la PSF (coma, astigmatismo, desenfoque del "
                            "borde, mezcla de la matriz Bayer). En ópticas de campo amplio y píxeles grandes (submuestreado) "
                            f"baja la FWHM de verdad; un {_r(cambio, 0)} % no indica que se haya enfocado de más. Lo que sí sería "
                            "sospechoso: anillos oscuros o núcleos duros en un recorte al 100 %.")
    return r


# --- NL1: estirado -------------------------------------------------------------------------------------------

TIPOS = {"galaxia": (0.07, 0.12), "nebulosa": (0.10, 0.15), "cumulo": (0.10, 0.15), "nebulosa_oscura": (0.12, 0.20)}


def _fallos(c, lim):
    f = []
    if c["ruido_rel"] > lim["ruido"]:
        f.append(f"ruido del cielo {c['ruido_rel']} > {lim['ruido']}")
    if c["cero_pct"] > lim["cero"]:
        f.append(f"sombras a 0 {c['cero_pct']} % > {lim['cero']} %")
    if c["alto_pct"] > lim["alto"]:
        f.append(f"luces > 0,95 {c['alto_pct']} % > {lim['alto']} %")
    return f


def _medir(siril, info):
    return _cielo(H._pixeles(siril, info))


def _punto_negro(siril, info, c, cielo, por_canal=False):
    """Lleva el cielo medido c['cielo'] a 'cielo' con un punto negro lineal (linstretch).
    por_canal: un punto negro por canal (numpy), para que el cielo de cada canal quede en 'cielo'. Con uno común,
    una diferencia pequeña entre canales en lineal (1,5 % en IC 1396) se hace grande al restar mucho fondo (8,7 %)."""
    if por_canal and info["canales"] > 1:
        crudo = _crudo(siril)
        rgb = _cielo_por_canal(_pantalla(crudo, info), c["_celdas"])
        bps = [max(0.0, (s - cielo) / (1 - cielo)) for s in rgb]
        if max(bps) <= 0:
            return 0.0, c
        a = _de_siril(crudo)
        for k, bp in enumerate(bps):
            a[k] = (a[k] - bp) / (1 - bp)
        _restaurar(siril, _a_siril(np.clip(a, 0, 1), crudo.dtype).reshape(crudo.shape))
        return float(np.mean(bps)), _medir(siril, info)
    if c["cielo"] <= cielo:
        return 0.0, c
    bp = (c["cielo"] - cielo) / (1 - cielo)
    siril.cmd("linstretch", f"-BP={bp:.6f}", "-clipmode=clip")
    return bp, _medir(siril, info)


def _ghs_al_fallo(siril, info, crudo, cielo, lim, maxp=25):
    m0 = float(np.median(_lum(_pantalla(crudo, info))))
    siril.cmd("ght", "-D=2.5", "-B=12", f"-SP={max(m0, 1e-5):.6f}", "-LP=0", "-HP=0.95", "-even")
    c = _medir(siril, info)
    pasadas = [{"n": 1, "D": 2.5, "B": 12, "SP": _r(m0, 5), "cielo": c["cielo"], "ruido_rel": c["ruido_rel"]}]
    D, motivo, desc = 1.0, "máximo de pasadas", 0
    for n in range(2, maxp + 1):
        prev = _crudo(siril)
        sp = c["cielo"]
        if lim.get("celdas_debil") is not None:          # variante «señal débil»: SP en el nivel del disco débil
            sp = _nivel_debil(_pantalla(prev, info), lim["celdas_debil"]) or sp
        siril.cmd("ght", f"-D={D:.3f}", "-B=6", f"-SP={max(sp, 1e-5):.6f}", "-LP=0", "-HP=0.92", "-even")
        c1 = _medir(siril, info)
        bp, c1 = _punto_negro(siril, info, c1, cielo, lim.get("por_canal"))
        f = _fallos(c1, lim)
        if f:
            _restaurar(siril, prev)
            desc += 1
            if D / 2 < 0.03:
                motivo = f"fallo con la pasada más corta (D {D}): {'; '.join(f)}; se queda la anterior"
                break
            D /= 2
            continue
        pasadas.append({"n": n, "D": D, "B": 6, "SP": _r(c["cielo"], 4), "punto_negro": _r(bp, 5),
                        "cielo": c1["cielo"], "ruido_rel": c1["ruido_rel"]})
        c = c1
    if c["cielo"] < cielo - 0.02:
        motivo += f" (el cielo se queda en {c['cielo']}, por debajo del objetivo)"
    return c, {"pasadas": len(pasadas), "descartadas": desc, "parada": motivo, "detalle": pasadas[-6:]}


def _asinh_al_fallo(siril, info, crudo, cielo, lim):
    """Arcsinh: el factor más alto que no falla (búsqueda en escala log), después punto negro al cielo objetivo."""
    tope = 100000.0
    lo, hi, mejor = np.log(2.0), np.log(tope), None
    for _ in range(12):
        mid = (lo + hi) / 2
        s = float(np.exp(mid))
        _restaurar(siril, crudo)
        siril.cmd("asinh", f"{s:.2f}")
        c = _medir(siril, info)
        _, c = _punto_negro(siril, info, c, cielo, lim.get("por_canal"))
        if _fallos(c, lim):
            hi = mid
        else:
            mejor, lo = (s, c), mid
    if not mejor:
        raise RuntimeError("ningún factor de arcsinh cumple los límites")
    s, _ = mejor
    _restaurar(siril, crudo)
    siril.cmd("asinh", f"{s:.2f}")
    c = _medir(siril, info)
    bp, c = _punto_negro(siril, info, c, cielo, lim.get("por_canal"))
    d = {"factor": _r(s, 1), "punto_negro": _r(bp, 5)}
    if s > tope * 0.9:
        d["parada"] = f"tope del factor ({int(tope)}) sin llegar al fallo"
    return c, d


def _autostretch(siril, info, crudo, cielo, lim):
    siril.cmd("autostretch", "-linked", "-2.8", f"{min(0.5, cielo * 2):.3f}")
    c = _medir(siril, info)
    bp, c = _punto_negro(siril, info, c, cielo, lim.get("por_canal"))
    return c, {"punto_negro": _r(bp, 5)}


def _negro_lineal(p, margen=3.0):
    """Punto negro por canal EN LINEAL, antes de estirar: resta a cada canal su cielo menos 'margen' ruidos (sin bajar del
    percentil 0,02 de los píxeles con datos, para no mandar a 0 las nebulosas oscuras). GHS en modo luminancia (-even) y
    arcsinh conservan las proporciones entre canales; si el pedestal del cielo sigue dentro, domina esas proporciones y todo
    sale gris y lavado (11 nov 2026, IC 1396 con DSLR: el fondo de Vía Láctea sin resolver lo cubría todo). Devuelve la
    imagen y los puntos negros."""
    c = _cielo(p)
    ys, xs, S = c["_celdas"]
    out, bps = np.empty_like(p), []
    # El pedestal que queda es el MISMO en los tres canales (margen × σ de la luminancia): con la σ de cada canal
    # (distinta en una DSLR) quedaban pedestales distintos y el cielo salía teñido (NGC1396, 11 nov 2026: 33–51 %).
    Lp = p.mean(axis=0)
    vL = np.concatenate([Lp[y * S:(y + 1) * S:2, x * S:(x + 1) * S:2].ravel() for y, x in zip(ys, xs)])
    dL = vL[1:] - vL[:-1]
    sigma = 1.4826 * float(np.median(np.abs(dL - np.median(dL)))) / np.sqrt(2)
    cielos, qs = [], []
    for k in range(p.shape[0]):
        v = np.concatenate([p[k, y * S:(y + 1) * S:2, x * S:(x + 1) * S:2].ravel() for y, x in zip(ys, xs)])
        cielos.append(float(np.median(v)))
        datos = p[k, ::3, ::3]
        qs.append(float(np.percentile(datos[datos > 1e-6], 0.02)) if (datos > 1e-6).any() else 0.0)
    # Un solo pedestal para los tres: el mayor de (margen·σ) y lo que pide el percentil 0,02 de cada canal (no mandar a 0
    # las nebulosas oscuras). Con un tope distinto por canal también quedaban pedestales distintos.
    ped = max([margen * sigma] + [ck - qk for ck, qk in zip(cielos, qs)])
    for k in range(p.shape[0]):
        bp = max(0.0, cielos[k] - ped)
        bps.append(bp)
        out[k] = np.clip((p[k] - bp) / max(1.0 - bp, 1e-6), 0, 1)
    return out.astype(np.float32), bps


def _celdas_debiles(p, S=64, lo=60, hi=85):
    """Celdas de la señal débil del objeto (brazos, disco exterior): las de rango entre los percentiles 'lo' y 'hi' de
    las medianas de celda de la imagen de partida (fuera el cielo y el núcleo). Fijas para comparar candidatos."""
    m = _celdas(_lum(p), S)
    v = m > 1e-6
    a, b = np.percentile(m[v], lo), np.percentile(m[v], hi)
    return (v & (m >= a) & (m <= b), S)


def _nivel_debil(q, celdas):
    sel, S = celdas
    m = _celdas(_lum(q), S)
    return float(np.median(m[sel])) if sel.any() else None


def _ghs_debil(siril, info, crudo, cielo, lim):
    """GHS por pasadas con el punto de simetría en el nivel de la señal débil (más contraste en los brazos)."""
    return _ghs_al_fallo(siril, info, crudo, cielo, lim)


def _ghs_parcial(fraccion):
    """GHS por pasadas que para antes: al 'fraccion' del límite de ruido (suave 0,6, medio 0,8; fuerte = al fallo)."""
    def f(siril, info, crudo, cielo, lim):
        return _ghs_al_fallo(siril, info, crudo, cielo, dict(lim, ruido=lim["ruido"] * fraccion))
    return f


def _luces_neutras(q, desde=0.55, hasta=0.97, fuerza=0.75):
    """Altas luces hacia neutro: los estirados en luminancia (GHS -even, arcsinh) conservan las proporciones de color hasta
    el blanco, así que un núcleo apenas cálido en lineal (M31: R/G 1,10) sale salmón (R 0,99 · G 0,86 · B 0,80) y el rojo
    se recorta. Un estirado por canal comprime esa diferencia en las luces; aquí se hace lo mismo sólo por encima de
    'desde': el color se acerca a la luminancia con un peso suave (0 en 'desde', 'fuerza' en 'hasta'). El cielo y la
    señal débil no cambian. Además ningún canal pasa de 1 (se escala el píxel entero: el tono no se tuerce)."""
    if q.shape[0] != 3:
        return q
    L = q.mean(axis=0)
    t = np.clip((L - desde) / max(hasta - desde, 1e-6), 0, 1)
    w = (t * t * (3 - 2 * t)) * fuerza
    out = L + (q - L) * (1 - w)
    m = out.max(axis=0)
    out = np.where(m > 1, out / np.maximum(m, 1e-6), out)
    return np.clip(out, 0, 1).astype(np.float32)


def _sat_nucleo(q):
    """Saturación (max − min) / max y R/G del 0,1 % más brillante (el núcleo, en una starless)."""
    if q.shape[0] != 3:
        return None
    L = _caja(q.mean(axis=0), 3)
    m = L >= np.percentile(L[::3, ::3], 99.9)
    rgb = [float(np.median(q[k][m])) for k in range(3)]
    return {"rgb": [_r(x, 3) for x in rgb], "saturacion": _r((max(rgb) - min(rgb)) / max(max(rgb), 1e-6), 3),
            "r_sobre_g": _r(rgb[0] / max(rgb[1], 1e-6), 3)}


def _suave(x, r):
    """Desenfoque casi gaussiano (tres cajas de radio r/2): la base sin los bordes cuadrados de una caja, que dejaban
    un anillo oscuro alrededor del núcleo al separar base y detalle (M31, 11 nov 2026)."""
    k = max(1, int(round(r / 2)))
    return _caja(_caja(_caja(x, k), k), k)


def _escalas(siril, info, crudo, cielo, lim, radio=None, gamma=0.7, tope_ganancia=2.0):
    """Estirado adaptativo por escalas (propio): la luminancia se parte en base (media en ventana grande) y detalle
    (lo que queda). La base se estira con una curva arcsinh de factor s; el detalle se multiplica por una ganancia que
    en el cielo es la pendiente de la curva (mismo ruido que un estirado global) y en lo brillante cae más despacio que
    ella (pendiente^gamma): el rango grande se comprime (núcleo sin quemar) y la estructura del disco y del núcleo se
    conserva. Color: los canales se escalan por L'/L, sin pasar de 1, y luces hacia neutro. El factor s es el más alto
    que no falla (búsqueda como arcsinh) y el cielo se lleva al objetivo con el mismo punto negro por canal."""
    x = _de_siril(crudo).astype(np.float32)
    L = x.mean(axis=0) if x.shape[0] > 1 else x[0]
    c0 = _cielo(x)
    sky = float(c0["cielo"])
    r = int(radio or max(12, round(max(L.shape) / 100)))
    B = _suave(L, r)
    D = L - B
    Bp = np.maximum(B - sky * 0.5, 0)            # la curva arranca algo por debajo del cielo (el punto negro lo ajusta)
    v0 = sky * 0.5

    def hacer(s):
        a = float(np.arcsinh(s))
        T = np.arcsinh(s * Bp) / a
        dT = s / (a * np.sqrt(1 + (s * Bp) ** 2))
        g0 = s / (a * np.sqrt(1 + (s * v0) ** 2))
        # ganancia del detalle: la pendiente de la curva, multiplicada en lo brillante por (g0/pendiente)^(1−gamma) con
        # tope: sin tope, el detalle del núcleo se disparaba y quedaba un punto blanco con un anillo oscuro
        g = dT * np.minimum((g0 / np.maximum(dT, 1e-12)) ** (1 - gamma), tope_ganancia)
        Lo = np.maximum(T + g * D, 0)
        f = Lo / np.maximum(L, 1e-7)
        out = x * f[None] if x.shape[0] > 1 else (Lo[None])
        m = out.max(axis=0)
        out = np.where(m > 1, out / np.maximum(m, 1e-6), out)
        return _luces_neutras(np.clip(out, 0, 1).astype(np.float32))

    def poner(s):
        _restaurar(siril, _a_siril(hacer(s), crudo.dtype).reshape(crudo.shape))
        c = _medir(siril, info)
        return _punto_negro(siril, info, c, cielo, lim.get("por_canal"))

    lo, hi, mejor = np.log(2.0), np.log(100000.0), None
    for _ in range(11):
        mid = (lo + hi) / 2
        s = float(np.exp(mid))
        _, c = poner(s)
        if _fallos(c, lim) or c["p999"] > 0.92:
            hi = mid
        else:
            mejor, lo = s, mid
    if not mejor:
        raise RuntimeError("ningún factor del estirado por escalas cumple los límites")
    bp, c = poner(mejor)
    return c, {"factor": _r(mejor, 1), "radio_base_px": r, "gamma_detalle": gamma, "tope_ganancia": tope_ganancia,
               "punto_negro": _r(bp, 5)}


def _con_luces_neutras(fn):
    """Envuelve un estirado en luminancia: al final, altas luces hacia neutro (sin núcleo salmón ni rojo recortado)."""
    def f(siril, info, crudo, cielo, lim):
        c, d = fn(siril, info, crudo, cielo, lim)
        if info["canales"] != 3:
            return c, d
        q = _de_siril(_crudo(siril))
        antes = _sat_nucleo(q)
        q2 = _luces_neutras(q)
        res = _crudo(siril)
        _restaurar(siril, _a_siril(q2, res.dtype).reshape(res.shape))
        d = dict(d, luces_neutras={"nucleo_antes": antes, "nucleo_despues": _sat_nucleo(q2)})
        return _medir(siril, info), d
    return f


def _dominante_aditiva(p, celdas_px=None, S=64):
    """Dominante del cielo que distingue un tinte (aditivo: igual en todas las celdas oscuras) del color propio de una
    nebulosa o de la Vía Láctea (crece con la señal). En el 30 % de celdas más oscuras se ajusta cada canal contra la
    luminancia: canal = a + b·L. El tinte es la diferencia de los términos a (en L = cielo); el color propio, la de las
    pendientes b. Además se mira la textura: las celdas planas (poca diferencia entre sub-bloques) son cielo de verdad.
    Devuelve (tinte %, color propio %, n de celdas)."""
    if p.shape[0] != 3:
        return 0.0, 0.0, 0
    L = _lum(p)
    m = _celdas(L, S)
    v = m > 1e-6
    if v.sum() < 20:
        return 0.0, 0.0, 0
    lim = np.percentile(m[v], 30)
    sel = v & (m <= lim)
    ys, xs = np.nonzero(sel)
    # textura: σ de las medianas de 4×4 sub-bloques dentro de la celda (estructura de 16 px)
    tex = []
    for y, x in zip(ys, xs):
        blk = L[y * S:(y + 1) * S, x * S:(x + 1) * S]
        tex.append(float(np.std(_binar(blk, S // 4))))
    tex = np.array(tex)
    planas = tex <= np.percentile(tex, 50)
    ys, xs = ys[planas], xs[planas]
    if len(ys) < 10:
        return 0.0, 0.0, int(len(ys))
    canales = np.array([[float(np.median(p[k, y * S:(y + 1) * S:2, x * S:(x + 1) * S:2])) for y, x in zip(ys, xs)] for k in range(3)])
    Lc = canales.mean(axis=0)
    l0 = float(np.median(Lc))
    a, b = [], []
    for k in range(3):
        A = np.stack([np.ones_like(Lc), Lc - l0], 1)
        coef, *_ = np.linalg.lstsq(A, canales[k], rcond=None)
        a.append(coef[0]); b.append(coef[1])
    tinte = 100.0 * (max(a) - min(a)) / max(float(np.mean(a)), 1e-9)
    propio = 100.0 * (max(b) - min(b)) / max(float(np.mean(np.abs(b))), 1e-9)
    return _r(tinte, 2), _r(propio, 1), int(len(ys))


def estirarCandidatos(siril, tipo=None, cielo=None, ruido_max=None,
                      metodos=("ghs_suave", "ghs_medio", "ghs", "ghs_debil", "asinh", "escalas", "autostretch"),
                      negro_por_canal=True, negro_lineal=True, neutralizar=True, luces_neutras=True):
    """Paso 1 no lineal: compara GHS al fallo, arcsinh, estirado por escalas y autostretch con el cielo en el mismo
    objetivo. No cambia la imagen.
    negro_lineal: punto negro por canal en lineal antes de estirar (el pedestal del cielo fuera), ver _negro_lineal.
    luces_neutras: en los estirados en luminancia, altas luces hacia neutro (sin núcleo salmón), ver _luces_neutras."""
    info = H._info(siril)
    crudo_original = _crudo(siril)
    p = _pantalla(crudo_original, info)
    if not _lineal(p):
        raise RuntimeError("La imagen ya parece estirada (mediana > 0,05): el estirado parte de la starless lineal.")
    crudo = crudo_original
    bps_lineal = None
    neutro = None
    if neutralizar and info["canales"] == 3:
        # Cielo de la starless igualado en LINEAL antes de estirar: a cada canal se le suma lo que le falta para llegar al
        # más alto, medido en las mismas celdas de cielo que mide luego el estirado (aditivo: el objeto no cambia). 11 nov
        # 2026: neutralizado sobre la imagen con estrellas antes de separarlas, la starless seguía teñida al estirar.
        c_n = _cielo(p)
        rgb_n = _cielo_por_canal(p, c_n["_celdas"])
        dom_n = 100.0 * (max(rgb_n) - min(rgb_n)) / max(float(np.mean(rgb_n)), 1e-9)
        if dom_n > 0.5:
            d = np.array([max(rgb_n) - x for x in rgb_n], dtype=np.float32)
            base = _de_siril(crudo)
            crudo = _a_siril(np.clip(base + d[:, None, None], 0, 1), crudo.dtype).reshape(crudo.shape)
            neutro = {"dominante_lineal_antes_pct": _r(dom_n, 2), "sumado_por_canal": [_r(float(x), 7) for x in d],
                      "nota": "cielo de la starless igualado en lineal antes de estirar (aditivo; el objeto no cambia)"}
    if negro_lineal:
        # Se deja un cielo de 2/límite_de_ruido sigmas (galaxia 0,12 → 17 σ; nebulosa 0,15 → 13 σ): con 3 σ el ruido
        # relativo del cielo empieza en 0,33 y ningún estirado baja al límite (M31, 11 nov 2026), y con 1/límite el GHS
        # se paraba por ruido antes de llegar al cielo objetivo (IC 1396). Aun así se quita casi todo el pedestal.
        r_lim = float(ruido_max or TIPOS.get(str(tipo or "nebulosa"), TIPOS["nebulosa"])[1])
        sin_pedestal, bps_lineal = _negro_lineal(_de_siril(crudo), margen=max(3.0, 2.0 / max(r_lim, 1e-3)))
        crudo = _a_siril(sin_pedestal, crudo_original.dtype).reshape(crudo_original.shape)
    c_def, r_def = TIPOS.get(str(tipo or "nebulosa"), TIPOS["nebulosa"])
    cielo = float(cielo or c_def)
    lim = {"ruido": float(ruido_max or r_def), "cero": 0.05, "alto": 0.05, "por_canal": bool(negro_por_canal)}
    huella = _huella(crudo_original)          # aplicarCandidato comprueba contra la imagen cargada (la original)
    debiles = _celdas_debiles(p)
    grupo = "estirado"
    _limpiar_grupo(grupo)
    ln = _con_luces_neutras if luces_neutras else (lambda f: f)
    funcs = {"ghs_suave": ("GHS suave (60 % del ruido límite)", ln(_ghs_parcial(0.6))),
             "ghs_medio": ("GHS medio (80 % del ruido límite)", ln(_ghs_parcial(0.8))),
             "ghs": ("GHS al fallo", ln(_ghs_al_fallo)),
             "ghs_debil": ("GHS al fallo, simetría en la señal débil", ln(_ghs_debil)),
             "asinh": ("arcsinh al fallo", ln(_asinh_al_fallo)),
             "escalas": ("por escalas (base comprimida, detalle conservado)", _escalas),
             "autostretch": ("autostretch enlazado", _autostretch)}
    r = {"cielo_objetivo": cielo, "limites": {k: v for k, v in lim.items() if k != "por_canal"},
         "punto_negro": "por canal" if negro_por_canal else "común", "candidatos": [], "errores": []}
    if bps_lineal is not None:
        r["negro_lineal"] = [_r(x, 6) for x in bps_lineal]
    if neutro:
        r["cielo_neutralizado"] = neutro
    n = 0
    try:
        for m in metodos:
            if m not in funcs:
                r["errores"].append(f"{m}: método desconocido ({', '.join(funcs)})")
                continue
            n += 1
            nombre, fn = funcs[m]
            t0 = time.perf_counter()
            try:
                _restaurar(siril, crudo)
                c, detalle = fn(siril, info, crudo, cielo, dict(lim, celdas_debil=debiles) if m == "ghs_debil" else lim)
                res = _crudo(siril)
                sep = (c["p90"] - c["cielo"]) / max(c["ruido_rel"] * c["cielo"], 1e-6)
                pp = H._pixeles(siril, info)
                nd = _nivel_debil(pp, debiles)
                senal_debil = (nd - c["cielo"]) if nd is not None else None
                dom_canal = _cielo_por_canal(pp, c["_celdas"]) if info["canales"] == 3 else []
                dom = 100.0 * (max(dom_canal) - min(dom_canal)) / np.mean(dom_canal) if dom_canal else 0.0
                # La dominante de las celdas más oscuras mezcla tinte y color propio (polvo, Vía Láctea, nebulosa): se
                # separan (tinte = parte aditiva en celdas planas) y sólo el tinte hace fallar.
                tinte, propio, n_planas = _dominante_aditiva(pp) if info["canales"] == 3 else (0.0, 0.0, 0)
                fal = _fallos(c, lim)
                # Topes de luces (M31, 10 nov 2026: p99 0,80 y p999 0,93 dieron disco lavado y núcleo quemado) y estirado
                # insuficiente (arcsinh con p99 0,09: apenas se ve el objeto).
                if c["p99"] > 0.80:
                    fal.append(f"luces demasiado altas: p99 {c['p99']} > 0,80 (disco lavado)")
                if c["p999"] > 0.92:
                    fal.append(f"núcleo o zonas brillantes quemadas: p999 {c['p999']} > 0,92")
                if c["p99"] < c["cielo"] + 0.10:
                    fal.append(f"apenas estira: p99 {c['p99']} a menos de 0,10 del cielo")
                if abs(c["cielo"] - cielo) > 0.02:
                    fal.append(f"cielo {c['cielo']} fuera del objetivo {cielo}")
                if dom >= 5 and tinte >= 5:
                    fal.append(f"tinte del cielo {tinte} % (dominante de las celdas oscuras {_r(dom, 1)} %) aun con el cielo "
                               "neutralizado en lineal: se combinó banda estrecha antes del color o el color no está calibrado "
                               "(rehacer: color de la RGB sola y combinar después). quitarVerde sólo corrige verde")
                cid = _guardar_candidato(grupo, n, res, {"nombre": nombre, "comando": nombre, "huella_base": huella})
                r["candidatos"].append({"id": cid, "metodo": nombre, "medidas": _sin_privado(c), "separacion": _r(sep, 2),
                                        "senal_debil": _r(senal_debil, 4),
                                        "dominante_cielo_pct": _r(dom, 1), "tinte_cielo_pct": tinte,
                                        "color_propio_fondo_pct": propio,
                                        "nucleo": _sat_nucleo(pp) if info["canales"] == 3 else None,
                                        "no_cumple": fal, "detalle": detalle,
                                        "segundos": _r(time.perf_counter() - t0, 1)})
            except Exception as e:
                r["errores"].append(f"{nombre}: {e}")
    finally:
        _restaurar(siril, crudo_original)
    ok = [x for x in r["candidatos"] if not x["no_cumple"]]
    pool = ok or (sorted(r["candidatos"], key=lambda x: len(x["no_cumple"]))[:1] if r["candidatos"] else [])
    mejor = None
    if pool:
        smax = max(x["separacion"] or 0 for x in pool)
        # Separaciones a menos de un 3 % se tratan como empate: gana el que más levanta la señal débil (en M31, 10 nov
        # 2026, «suave» ganó por 0,2 de separación y dejó los brazos apagados). En galaxias decide siempre la señal débil.
        cerca = pool if str(tipo or "") == "galaxia" else [x for x in pool if (x["separacion"] or 0) >= 0.97 * smax]
        mejor = max(cerca, key=lambda x: (x.get("senal_debil") if x.get("senal_debil") is not None else -1, x["separacion"] or 0))
    if mejor:
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: señal débil del objeto {mejor.get('senal_debil')} sobre el cielo, separa "
                       f"{mejor['separacion']} ruidos, cielo en {mejor['medidas']['cielo']}"
                       + ("" if ok else " (NINGUNO cumple: revisar no_cumple)") + ".")
    r["leyenda"] = ("separacion = (p90 − cielo) / ruido del cielo: más es mejor. senal_debil = nivel de la zona débil del "
                    "objeto (celdas entre los percentiles 60 y 85 de la imagen de partida: brazos, disco exterior) sobre el cielo: "
                    "más = más se ve. En galaxias, y en empates de separación, decide la señal débil, siempre dentro de los límites. "
                    "tinte_cielo_pct: parte aditiva de la dominante en las celdas oscuras y planas (un tinte: falla a partir del 5 %); "
                    "color_propio_fondo_pct: la que crece con la señal (polvo, Vía Láctea, nebulosa: no es un fallo). "
                    "nucleo: color del 0,1 % más brillante (saturación y R/G; con luces neutras el núcleo no sale salmón). "
                    "La imagen NO ha cambiado: aplicarCandidato(id). "
                    "Mira el recomendado con previa antes de seguir.")
    _asegurar_restaurado(siril, crudo_original, huella, r)
    _galeria(r, info, p, None)
    return r


# --- NL3: quitar verde ---------------------------------------------------------------------------------------

def quitarVerde(siril, umbral=3.0, forzar=False, tipo=0):
    """Paso 3 no lineal: SCNR (rmgreen) solo si el verde del cielo supera en > umbral % a rojo y azul."""
    info = H._info(siril)
    if info["canales"] != 3:
        raise RuntimeError("quitarVerde necesita una imagen en color.")
    p = H._pixeles(siril, info)
    c = _cielo(p)
    rgb = _cielo_por_canal(p, c["_celdas"])
    exceso = 100.0 * (rgb[1] - max(rgb[0], rgb[2])) / max(max(rgb[0], rgb[2]), 1e-6)
    r = {"cielo_rgb_antes": [_r(x, 5) for x in rgb], "exceso_verde_pct": _r(exceso, 1)}
    if exceso <= umbral and not forzar:
        r.update(aplicado=False, motivo=f"El verde no supera en más de {umbral} % a rojo y azul: no hace falta.")
        return r
    t = int(tipo)
    if t not in (0, 1, 2, 3):
        raise ValueError("tipo: 0 neutro promedio, 1 neutro máximo, 2 máscara máxima, 3 máscara aditiva.")
    siril.cmd("rmgreen", str(t))
    p2 = H._pixeles(siril, info)
    rgb2 = _cielo_por_canal(p2, c["_celdas"])
    r.update(aplicado=True, comando=f"rmgreen {t}", cielo_rgb_despues=[_r(x, 5) for x in rgb2])
    return r


# --- Utilidades de la fase 3: zonas, detalle, tipos -----------------------------------------------------------

def _caja(x, r):
    """Media en ventana (2r+1)² con sumas acumuladas (bordes por repetición)."""
    k = 2 * r + 1
    c = np.cumsum(np.pad(x.astype(np.float64), ((r + 1, r), (0, 0)), mode="edge"), axis=0)
    y = c[k:] - c[:-k]
    c = np.cumsum(np.pad(y, ((0, 0), (r + 1, r)), mode="edge"), axis=1)
    return ((c[:, k:] - c[:, :-k]) / (k * k)).astype(np.float32)


def _celdas_a_px(m, S, forma):
    """Máscara de celdas S×S -> máscara de píxeles (lo que no llena una celda entera queda fuera)."""
    out = np.zeros(forma, dtype=bool)
    out[:m.shape[0] * S, :m.shape[1] * S] = np.repeat(np.repeat(m, S, 0), S, 1)
    return out


def _zonas(p, S=64):
    """Celdas de cielo (las más oscuras, como en _cielo) y de objeto (cuartil alto y > cielo + 5 ruidos)."""
    c = _cielo(p, S)
    L = _lum(p)
    m = _celdas(L, S)
    ys, xs, _ = c["_celdas"]
    cielo_c = np.zeros(m.shape, dtype=bool)
    cielo_c[ys, xs] = True
    ruido = _ruido_en(L, c["_celdas"])
    validas = m > 1e-6
    # Las medianas de celda promedian ~1000 píxeles: superar el cielo en 1 σ de píxel ya es señal clara.
    obj_c = validas & (m >= np.percentile(m[validas], 75)) & (m > c["cielo"] + ruido) & ~cielo_c
    # Fuera las estrellas (y un margen): si la imagen aún las tiene, dominan la energía fina y el color,
    # y el denoise las respeta, así que taparían la pérdida de detalle de la nebulosa.
    # Núcleos: picos compactos por encima de 5σ y del percentil 99,5 del paso alto (los filamentos finos de la
    # nebulosa también superan 5σ y no deben salir: son justo el detalle a medir); margen de 2 px.
    hp = L - _caja(L, 5)
    est = hp > max(5 * max(ruido, 1e-6), float(np.percentile(hp.ravel()[::7], 99.5)))
    est = _caja(est.astype(np.float32), 2) > 0
    return {"medidas": c, "ruido": ruido, "cielo_c": cielo_c, "obj_c": obj_c, "S": S, "est_px": est, "hp": hp,
            "estrellas_pct": _r(100.0 * float(est.mean()), 2),
            "cielo_px": _celdas_a_px(cielo_c, S, L.shape) & ~est, "obj_px": _celdas_a_px(obj_c, S, L.shape) & ~est}


def _ruido_en(L, celdas):
    """Ruido (σ) por diferencias entre vecinos en las celdas dadas: mismo criterio que _cielo."""
    ys, xs, S = celdas
    dif = []
    for y, x in zip(ys, xs):
        blk = L[y * S:(y + 1) * S, x * S:(x + 1) * S]
        dif.append(np.abs(blk[:, 1::2] - blk[:, 0:-1:2]).ravel())
    return float(np.median(np.concatenate(dif))) / (0.6745 * np.sqrt(2)) if dif else 0.0


def _ruido_grueso(L, celdas, b=4):
    """σ de bloques b×b dentro de las celdas de cielo (moteado de baja frecuencia que el denoise deja)."""
    ys, xs, S = celdas
    v = []
    for y, x in zip(ys, xs):
        blk = _binar(L[y * S:(y + 1) * S, x * S:(x + 1) * S], b)
        v.append((blk - np.median(blk)).ravel())
    if not v:
        return 0.0
    v = np.concatenate(v)
    return 1.4826 * float(np.median(np.abs(v)))


def _energia_detalle(L, z, banda=(1, 4)):
    """Energía de una banda de escalas (por defecto 1–4 px: caja 3 − caja 9) en el objeto menos la del cielo (ruido).
    La banda 2–8 px (caja 5 − caja 17) promedia el ruido 25 veces: sirve en starless estiradas donde la fina no se ve."""
    if not z["obj_px"].any():
        return None
    D = _caja(L, banda[0]) - _caja(L, banda[1])
    e_obj = float(np.mean(D[z["obj_px"]] ** 2))
    if not z["cielo_px"].any():
        return e_obj
    # Se descuenta el ruido con el del cielo. Tras estirar, el ruido del objeto suele ser menor que el del cielo
    # (la curva comprime las luces) y la pérdida sale algo por debajo de la real; por eso un valor negativo es «0».
    # (Escalar con σ objeto / σ cielo por vecinos no sirve: el detalle fino también entra en esa σ.)
    e_cielo = float(np.mean(D[z["cielo_px"]] ** 2))
    return max(e_obj - e_cielo, 0.0)


def _zona_brillante(L, z):
    """Píxeles de la parte brillante del objeto (celdas de objeto entre la mediana y el p97: disco, sin núcleo) sin
    estrellas. Ahí el detalle de 2–8 px domina sobre el ruido, así que su energía no necesita descontar el cielo."""
    m = _celdas(L, z["S"])
    oc = z["obj_c"]
    if not oc.any():
        return None
    v = m[oc]
    sel = oc & (m >= np.percentile(v, 50)) & (m <= np.percentile(v, 97))
    px = _celdas_a_px(sel, z["S"], L.shape) & ~z["est_px"]
    return px if px.sum() > 2000 else None


def _energia_brillante(L, px):
    D = _caja(L, 2) - _caja(L, 8)
    return float(np.mean(D[px] ** 2))


def _a_siril(x, dtype):
    """float 0–1 -> tipo de Siril (float32 o uint16)."""
    if dtype == np.float32:
        return np.ascontiguousarray(x, dtype=np.float32)
    return np.clip(np.round(x * 65535.0), 0, 65535).astype(np.uint16)


def _de_siril(a):
    """Array de Siril -> float32 0–1 sin cambiar el orden de filas."""
    a = a[np.newaxis] if a.ndim == 2 else a
    return a.astype(np.float32) / (65535.0 if a.dtype == np.uint16 else 1.0)


def _recortes(p):
    n = p.size
    return {"altos_pct": _r(100.0 * float((p >= 0.999).sum()) / n, 4), "ceros_pct": _r(100.0 * float((p <= 0.0).sum()) / n, 4)}


# --- L14 / NL6: reducción de ruido ---------------------------------------------------------------------------

def reducirRuidoCandidatos(siril, mods=None, da3d=None, perdida_max=10.0, ia=None, graxpert=None,
                           perdida_limpia=2.0, tipo=None):     # tipo: se admite (el modelo lo pasa) y no cambia nada
    """Paso 14 lineal / 6 no lineal: compara denoise de Siril a varias fuerzas (y DA3D) con 'nada'. No cambia la imagen."""
    info = H._info(siril)
    crudo = _crudo(siril)
    p = _pantalla(crudo, info)
    lineal = _lineal(p)
    z = _zonas(p)
    L0 = _lum(p)
    r0, g0 = z["ruido"], _ruido_grueso(L0, z["medidas"]["_celdas"])
    # Detalle: energía de 2–8 px en la parte brillante del objeto. La medida anterior (1–4 px menos el cielo) daba 0 %
    # de pérdida a todo NoiseX, también a 0,9 con el ruido al 10 % (M31, 10 nov 2026).
    zb = _zona_brillante(L0, z)
    banda = (2, 8)
    e0 = _energia_brillante(L0, zb) if zb is not None else None
    if mods is None:                                      # denoise de Siril: en no lineal, más suave
        mods = (0.5, 0.7, 1.0) if lineal else (0.3, 0.5)
    if ia is None:                                        # NoiseX por defecto si está el CLI de RC Astro
        # Lineal: 0,5, 0,3 ×2 y 0,5 ×2. No lineal, mucho más suave (Rafael, 10 nov 2026): 0,3, 0,5 y 0,3 ×2.
        ia = (("0.5", "0.3x2", "0.5x2") if lineal else ("0.3", "0.5", "0.3x2")) if _rcastro_exe() else ()
    huella = _huella(crudo)
    grupo = "ruido"
    _limpiar_grupo(grupo)
    r = {"fase": "lineal" if lineal else "no lineal", "ruido_cielo_antes": _r(r0, 6),
         "zona_objeto_pct": _r(100.0 * float(z["obj_px"].mean()), 1), "estrellas_excluidas_pct": z["estrellas_pct"],
         "candidatos": [], "errores": [],
         "referencia": {"metodo": "nada", "ruido_rel": 1.0, "detalle_perdido_pct": 0.0}}
    if e0 is None:
        r["aviso"] = "No encuentro zonas con señal clara: la pérdida de detalle no se puede medir."
    elif e0 <= 0:
        e0 = None
        r["aviso"] = ("En las zonas con señal no hay detalle (ni de 1–4 ni de 2–8 px) por encima del ruido del cielo: la pérdida "
                      "de detalle no se puede medir.")
    r["escala_detalle_px"] = f"{banda[0]}–{banda[1]}" if e0 else None

    def medir(res_crudo, nombre, texto, t0, n):
        q = _pantalla(res_crudo, info)
        L = _lum(q)
        r1 = _ruido_en(L, z["medidas"]["_celdas"])
        e1 = _energia_brillante(L, zb) if zb is not None else None
        perd = max(0.0, 100.0 * (1.0 - e1 / e0)) if e0 and e1 is not None else None
        m = {"ruido_rel": _r(r1 / max(r0, 1e-9), 3), "ruido_grueso_rel": _r(_ruido_grueso(L, z["medidas"]["_celdas"]) / max(g0, 1e-9), 3),
             "detalle_perdido_pct": _r(perd, 1), **_recortes(q)}
        cid = _guardar_candidato(grupo, n, res_crudo, {"nombre": nombre, "comando": texto, "huella_base": huella, "metricas": m})
        r["candidatos"].append({"id": cid, "metodo": nombre, "comando": texto, "metricas": m,
                                "segundos": _r(time.perf_counter() - t0, 1)})

    n = 0
    try:
        t0 = time.perf_counter()
        siril.cmd("denoise")                                  # -mod=1: el resto se mezcla con la original
        den = _crudo(siril)
        _restaurar(siril, crudo)
        t_den = time.perf_counter() - t0
        orig_f, den_f = _de_siril(crudo), _de_siril(den)
        for mo in sorted({float(x) for x in mods}):
            if not 0 < mo <= 1:
                r["errores"].append(f"mod {mo}: fuera de 0–1")
                continue
            n += 1
            t1 = time.perf_counter()
            mezcla = den if mo == 1.0 else _a_siril(mo * den_f + (1 - mo) * orig_f, crudo.dtype).reshape(crudo.shape)
            medir(mezcla, f"denoise mod {mo}", f"denoise -mod={mo}", t1 - (t_den if mo == 1.0 else 0), n)
        for dn in (ia or ()):                               # denoise con IA (CLI de RC Astro, nxt), por pasadas
            n += 1
            t1 = time.perf_counter()
            try:
                fuerza, _, veces = str(dn).lower().partition("x")
                fuerza, veces = float(fuerza), max(1, min(4, int(veces or 1)))
                act = crudo
                for _ in range(veces):
                    out, texto = _rcastro(siril, act, "nxt", [f"--dn={fuerza:.2f}"])
                    act = out["salida"]
                etiqueta = f"NoiseX {fuerza:g}" + (f" ×{veces}" if veces > 1 else "")
                medir(act, etiqueta, texto + (f" ({veces} pasadas)" if veces > 1 else ""), t1, n)
            except Exception as e:
                r["errores"].append(f"NoiseX {dn}: {e}")
        # GraXpert denoise sólo si se pide (graxpert: [0.5]); por defecto no entra (Rafael, 10 nov 2026).
        for gf in (graxpert or ()):
            n += 1
            t1 = time.perf_counter()
            try:
                res, texto = _graxpert_denoise(siril, crudo, gf)
                medir(res, f"GraXpert denoise {float(gf):g}", texto, t1, n)
            except Exception as e:
                r["errores"].append(f"GraXpert denoise {gf}: {e}")
        if da3d is None:
            # En IC 1396 (25 MP) el normal tardó 12 s y DA3D 268 s (~20×): por defecto solo si el normal es muy rápido.
            da3d = t_den < 5
            if not da3d:
                r["nota_da3d"] = (f"DA3D no probado: el denoise normal tardó {round(t_den)} s y DA3D tarda unas 20 veces más "
                                  f"(~{round(20 * t_den / 60)} min); da3d: true para probarlo.")
        if da3d:
            n += 1
            t1 = time.perf_counter()
            try:
                siril.cmd("denoise", "-da3d")
                medir(_crudo(siril), "denoise DA3D", "denoise -da3d", t1, n)
            except Exception as e:
                r["errores"].append(f"denoise DA3D: {e}")
            finally:
                _restaurar(siril, crudo)
    except Exception as e:
        r["errores"].append(f"denoise: {e}")
    finally:
        _restaurar(siril, crudo)

    # Recomendación (Rafael, M31, 10 nov 2026): el que MÁS ruido quita sin perder prácticamente detalle (≤ perdida_limpia %)
    # ni añadir recortes, en lineal y en no lineal. «Mejor dos pasadas suaves que una fuerte» vale sólo si la fuerte pierde
    # detalle. Si ninguno queda por debajo, el que menos detalle pierde entre los que bajan el ruido ≥ 20 % (y < perdida_max).
    c = r["candidatos"]
    rec0 = _recortes(p)
    def rr(x): return x["metricas"]["ruido_rel"]
    def dp(x): return x["metricas"]["detalle_perdido_pct"]
    def sin_recorte(x):
        m = x["metricas"]
        return m["altos_pct"] - rec0["altos_pct"] <= 0.01 and m["ceros_pct"] - rec0["ceros_pct"] <= 0.01
    # Fondo muerto: una pasada que deja menos del 25 % del ruido da aspecto plástico (M31: NoiseX 0,9 al 10 % y luego
    # denoise 1,0 al 6 %). Y si el cielo ya está limpio (ruido < 1,5 % del nivel del cielo), no se insiste.
    minimo = 0.25 if lineal else 0.5          # en no lineal no bajar de la mitad del ruido (Rafael, 10 nov 2026)
    for x in c:
        if rr(x) < minimo:
            x.setdefault("no_cumple", []).append(f"fondo muerto: deja el {round(100 * rr(x))} % del ruido "
                                                 f"(mínimo {round(100 * minimo)} % en esta fase)")
    c_ok = [x for x in c if rr(x) >= minimo]
    ya_limpio = (not lineal) and (r0 / max(z["medidas"]["cielo"], 1e-9)) < 0.015   # sólo tiene sentido estirada
    if ya_limpio:
        r["aviso_cielo"] = "El ruido del cielo ya es muy bajo: como mucho una pasada suave (o ninguna)."
    medibles = [x for x in c_ok if e0 is not None and dp(x) is not None and sin_recorte(x)]
    mejor, regla = None, ""
    limpios = [x for x in medibles if dp(x) <= perdida_limpia]
    if ya_limpio and medibles:
        mejor, regla = max(medibles, key=rr), "el cielo ya está limpio: la pasada más suave"
    elif limpios:
        mejor, regla = min(limpios, key=rr), f"la que más baja el ruido sin perder más del {perdida_limpia} % de detalle ni recortar"
    else:
        cand = [x for x in medibles if dp(x) < perdida_max and rr(x) <= 0.8]
        if cand:
            mejor, regla = min(cand, key=dp), f"ninguna queda por debajo del {perdida_limpia} % de detalle: la que menos pierde bajando el ruido ≥ 20 %"
        elif c and e0 is None:
            cand = [x for x in c_ok if rr(x) <= 0.8 and sin_recorte(x)]
            if cand:
                mejor, regla = min(cand, key=lambda x: abs(rr(x) - 0.5)), "sin medida de detalle: la más cercana a la mitad del ruido"
    if mejor:
        mm = mejor["metricas"]
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: {regla}. Ruido del cielo al {round(100 * mm['ruido_rel'])} %"
                       + (f", detalle perdido {max(0.0, mm['detalle_perdido_pct'])} %" if mm["detalle_perdido_pct"] is not None else "")
                       + ". Aplica el recomendado salvo razón concreta (míralo en la galería).")
    else:
        r["recomendado"] = None
        r["motivo"] = (f"Ninguno baja el ruido sin perder ≥ {perdida_max} % del detalle: mejor no reducir ruido aquí."
                       if c else "Ningún candidato se pudo medir: ver errores.")
    r["leyenda"] = ("ruido_rel: ruido del cielo después / antes (menos es mejor; 1 = nada). ruido_grueso_rel: lo mismo para el "
                    "moteado de bloques de 4 px (si no baja, el denoise solo cambia el grano por manchas). detalle_perdido_pct: "
                    "energía de la escala 2–8 px en la parte brillante del objeto (sin núcleo ni estrellas) que se pierde. "
                    "no_cumple «fondo muerto» si deja menos del 25 % del ruido. El recomendado ya tiene en cuenta la fase "
                    "(la que más baja el ruido sin perder más del 2 % de detalle ni recortar, en las dos fases). IA nxt: NoiseX por el CLI de RC Astro. "
                    "mod 0,5 y 0,7 son la mezcla del denoise completo con la original (lo mismo que hace -mod). "
                    "La imagen NO ha cambiado: aplicarCandidato(id).")
    _asegurar_restaurado(siril, crudo, huella, r)
    _galeria(r, info, p, "diferencia")
    return r


# --- NL5: saturación -----------------------------------------------------------------------------------------

def _saturacion(p):
    mx, mn = p.max(axis=0), p.min(axis=0)
    return np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0.0).astype(np.float32)


def saturacionCandidatos(siril, cantidades=(0.25, 0.5, 0.75), fondo=1.0, dominante_max=5.0, tipo=None):
    """Paso 5 no lineal: compara satu de Siril a varias cantidades; mide saturación en objeto y cielo y recortes."""
    info = H._info(siril)
    if info["canales"] != 3:
        raise RuntimeError("La saturación necesita una imagen en color.")
    crudo = _crudo(siril)
    p = _pantalla(crudo, info)
    if _lineal(p):
        raise RuntimeError("La imagen parece lineal (mediana < 0,05): la saturación va después de estirar (Paso 5 no lineal).")
    z = _zonas(p)
    cel = z["medidas"]["_celdas"]

    def medir(q):
        s = _saturacion(q)
        rgb = _cielo_por_canal(q, cel)
        dom = 100.0 * (max(rgb) - min(rgb)) / max(float(np.mean(rgb)), 1e-6)
        return {"sat_objeto": _r(float(np.mean(s[z["obj_px"]])), 4) if z["obj_px"].any() else None,
                "sat_cielo": _r(float(np.mean(s[z["cielo_px"]])), 4), "dominante_cielo_pct": _r(dom, 2), **_recortes(q)}

    m0 = medir(p)
    # Recorte nuevo «de verdad»: píxeles que ahora tienen un canal ≥ 0,999 y antes estaban lejos (máx < 0,9) y no al lado
    # de algo ya brillante (núcleos, estrellas y sus bordes, que al saturar siempre tocan el techo). 11 nov 2026: con el
    # criterio global (cualquier ≥ 0,999 nuevo > 0,01 %) 0,25/0,5/0,75 salían todos «recortan» en una nebulosa de Cefeo.
    pmax0 = p.max(axis=0)
    cerca_brillante = _caja((pmax0 >= 0.9).astype(np.float32), 3) > 0
    huella = _huella(crudo)
    grupo = "saturacion"
    _limpiar_grupo(grupo)
    r = {"antes": m0, "candidatos": [], "errores": []}
    if m0["dominante_cielo_pct"] >= dominante_max:
        r["aviso"] = (f"El cielo ya tiene una dominante del {m0['dominante_cielo_pct']} % antes de saturar: saturar la amplifica. "
                      "Corrígela antes (fase lineal o neutralizar el fondo).")
    n = 0
    try:
        for q in cantidades:
            n += 1
            q = float(q)
            t0 = time.perf_counter()
            args = ["satu", f"{q:g}", f"{float(fondo):g}"]
            try:
                siril.cmd(*args)
                res = _crudo(siril)
                pq = _pantalla(res, info)
                m = medir(pq)
                nuevos = (pq.max(axis=0) >= 0.999) & (pmax0 < 0.9) & ~cerca_brillante
                m["recorte_nuevo_pct"] = _r(100.0 * float(nuevos.mean()), 4)
                gan_obj = (m["sat_objeto"] / m0["sat_objeto"] - 1) * 100 if m0["sat_objeto"] else None
                gan_cielo = (m["sat_cielo"] / max(m0["sat_cielo"], 1e-6) - 1) * 100
                m.update(ganancia_objeto_pct=_r(gan_obj, 1), ganancia_cielo_pct=_r(gan_cielo, 1))
                fal = []
                if m["dominante_cielo_pct"] >= dominante_max:
                    fal.append(f"dominante del cielo {m['dominante_cielo_pct']} % ≥ {dominante_max} %")
                if m["recorte_nuevo_pct"] > 0.01:
                    fal.append(f"recorte alto nuevo fuera de lo ya brillante {m['recorte_nuevo_pct']} %")
                if m["ceros_pct"] - m0["ceros_pct"] > 0.05:
                    fal.append(f"canales a 0 nuevos {_r(m['ceros_pct'] - m0['ceros_pct'], 3)} % (colores fuera de rango)")
                if gan_obj is not None and gan_cielo > max(gan_obj, 5.0):
                    fal.append("el cielo gana más color que el objeto")
                elif gan_cielo > 10.0:
                    fal.append(f"el cielo gana un {_r(gan_cielo, 1)} % de saturación (> 10 %)")
                texto = " ".join(args)
                cid = _guardar_candidato(grupo, n, res, {"nombre": f"satu {q:g}", "comando": texto, "huella_base": huella, "metricas": m})
                r["candidatos"].append({"id": cid, "metodo": f"satu {q:g}", "comando": texto, "metricas": m, "no_cumple": fal,
                                        "segundos": _r(time.perf_counter() - t0, 1)})
            except Exception as e:
                r["errores"].append(f"satu {q:g}: {e}")
            finally:
                _restaurar(siril, crudo)
    finally:
        _restaurar(siril, crudo)
    ok = [x for x in r["candidatos"] if not x["no_cumple"]]
    if ok:
        mejor = max(ok, key=lambda x: x["metricas"]["sat_objeto"] or 0)
        mm = mejor["metricas"]
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: el objeto gana un {mm['ganancia_objeto_pct']} % de saturación, el cielo queda con "
                       f"dominante {mm['dominante_cielo_pct']} % y sin recortes nuevos. Es la mayor que cumple: mírala con previa "
                       "(bandas de color, tonos raros, ruido de color) antes de aplicarla.")
    else:
        r["recomendado"] = None
        r["motivo"] = "Ninguna cumple (ver no_cumple): no saturar o resolver antes la dominante del cielo."
    r["leyenda"] = ("sat_*: saturación media (máx − mín) / máx en las zonas de objeto y de cielo. El cielo no debe ganar color "
                    f"(dominante < {dominante_max} %). altos_pct: píxeles con algún canal ≥ 0,999. "
                    "La imagen NO ha cambiado: aplicarCandidato(id).")
    _asegurar_restaurado(siril, crudo, huella, r)
    _galeria(r, info, p, "diferencia")
    return r


# --- NL5/NL7: contraste local --------------------------------------------------------------------------------

def _contraste_local(L, m, r=16):
    """σ de la estructura de escala media (L − caja de 33 px) dentro de la máscara."""
    if not m.any():
        return None
    d = (L - _caja(L, r))[m]
    return float(np.sqrt(np.mean(d ** 2)))


CONTRASTE = {
    "clahe_suave": (["clahe", "1.5", "8"], "CLAHE límite 1,5"),
    "clahe_medio": (["clahe", "2.5", "8"], "CLAHE límite 2,5"),
    "ondiculas": ("ondiculas", "ondículas: escalas 2–4 × 1,15–1,3"),
    "enfoque": (["unsharp", "2.0", "0.3"], "máscara de enfoque σ 2, 0,3"),
}


def contrasteCandidatos(siril, metodos=("clahe_suave", "clahe_medio", "ondiculas", "enfoque"), ruido_max=None, tipo=None):
    """Paso de contraste local (no lineal): compara CLAHE, realce de escalas medias con ondículas y máscara de enfoque.
    Mide el contraste local en el objeto, el ruido del cielo y los recortes; recomienda. La imagen no cambia."""
    info = H._info(siril)
    crudo = _crudo(siril)
    p = _pantalla(crudo, info)
    if _lineal(p):
        raise RuntimeError("La imagen parece lineal: el contraste local va después de estirar.")
    if ruido_max is None:                                   # en galaxias el fondo admite menos ruido nuevo (M31)
        ruido_max = 1.10 if str(tipo or "") == "galaxia" else 1.25
    z = _zonas(p)
    L0 = _lum(p)
    k0 = _contraste_local(L0, z["obj_px"])
    def dom(q):
        if q.shape[0] != 3:
            return 0.0
        rgb = _cielo_por_canal(q, z["medidas"]["_celdas"])
        return 100.0 * (max(rgb) - min(rgb)) / max(float(np.mean(rgb)), 1e-6)
    dom0 = dom(p)
    r0 = z["ruido"]
    rec0 = _recortes(p)
    huella = _huella(crudo)
    grupo = "contraste"
    _limpiar_grupo(grupo)
    r = {"contraste_objeto_antes": _r(k0, 5), "candidatos": [], "errores": []}
    n = 0
    try:
        for mt in metodos:
            if mt not in CONTRASTE:
                r["errores"].append(f"{mt}: método desconocido ({', '.join(CONTRASTE)})")
                continue
            n += 1
            cmd, nombre = CONTRASTE[mt]
            t0 = time.perf_counter()
            try:
                if cmd == "ondiculas":
                    siril.cmd("wavelet", "6", "2")
                    pesos = ["1", "1.15", "1.3", "1.3", "1.1", "1"]
                    siril.cmd("wrecons", *pesos)
                    texto = "wavelet 6 2; wrecons " + " ".join(pesos)
                else:
                    siril.cmd(*cmd)
                    texto = " ".join(cmd)
                res = _crudo(siril)
                q = _pantalla(res, info)
                L = _lum(q)
                k1 = _contraste_local(L, z["obj_px"])
                rr = _ruido_en(L, z["medidas"]["_celdas"]) / max(r0, 1e-9)
                rec = _recortes(q)
                d1 = dom(q)
                m = {"contraste_ganado_pct": _r(100 * (k1 / k0 - 1), 1) if k0 and k1 else None, "ruido_rel": _r(rr, 3),
                     "dominante_cielo_pct": _r(d1, 2),
                     "cielo": _r(float(np.median(L[z["cielo_px"]])), 4) if z["cielo_px"].any() else None, **rec}
                fal = []
                if rr > ruido_max:
                    fal.append(f"ruido del cielo × {round(rr, 2)} > {ruido_max}")
                if rec["altos_pct"] - rec0["altos_pct"] > 0.01 or rec["ceros_pct"] - rec0["ceros_pct"] > 0.05:
                    fal.append("recortes nuevos")
                if d1 - dom0 > 1.0:
                    fal.append(f"el cielo gana color: dominante {_r(dom0, 1)} → {_r(d1, 1)} %")
                cid = _guardar_candidato(grupo, n, res, {"nombre": nombre, "comando": texto, "huella_base": huella, "metricas": m})
                r["candidatos"].append({"id": cid, "metodo": nombre, "comando": texto, "metricas": m, "no_cumple": fal,
                                        "segundos": _r(time.perf_counter() - t0, 1)})
            except Exception as e:
                r["errores"].append(f"{nombre}: {e}")
            finally:
                _restaurar(siril, crudo)
    finally:
        _restaurar(siril, crudo)
    ok = [x for x in r["candidatos"] if not x["no_cumple"] and (x["metricas"]["contraste_ganado_pct"] or 0) > 0]
    if ok:
        # más contraste por unidad de ruido añadido
        def nota(x):
            g = x["metricas"]["contraste_ganado_pct"] / 100.0
            return g / max(x["metricas"]["ruido_rel"], 1.0)
        mejor = max(ok, key=nota)
        mm = mejor["metricas"]
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: +{mm['contraste_ganado_pct']} % de contraste local en el objeto con el ruido del cielo × "
                       f"{mm['ruido_rel']} y sin recortes nuevos (el mejor contraste por ruido añadido). Míralo con previa.")
    else:
        r["recomendado"] = None
        r["motivo"] = "Ninguno sube el contraste sin pasarse de ruido o recortar: no aplicar contraste local."
    r["leyenda"] = ("contraste_ganado_pct: estructura de escala media (≈ 33 px) en el objeto, después / antes − 1. ruido_rel: ruido del "
                    f"cielo después / antes (límite {ruido_max}). La imagen NO ha cambiado: aplicarCandidato(id).")
    _asegurar_restaurado(siril, crudo, huella, r)
    _galeria(r, info, p, "diferencia")
    return r


# --- NL2: paletas de banda estrecha --------------------------------------------------------------------------

def _canal_fichero(siril, ruta, info, nombre):
    d = _leer_fichero(siril, H._ruta(ruta, nombre), info)
    d = d.mean(axis=0) if d.shape[0] > 1 else d[0]
    if d.shape != (info["alto"], info["ancho"]):
        raise RuntimeError(f"{nombre} mide {d.shape[1]}×{d.shape[0]} y la imagen {info['ancho']}×{info['alto']}.")
    return d if info["top_down"] else d[::-1, :]


def _igualar(o, ha, cielo_px=None):
    """OIII realzado: el mismo cielo y el mismo recorrido cielo→p99 que Hα (el OIII suele ser mucho más débil). El cielo
    se mide en las celdas de cielo: con la mediana de toda la imagen el cielo quedaba teñido (dominante 90 %)."""
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


def paletasCandidatos(siril, ha=None, oiii=None, sii=None, paletas=None, dominante_max=5.0, verde_max=5.0, tipo=None):
    """Paso 2 no lineal: compone paletas de banda estrecha desde capas ya estiradas (de la imagen dual band cargada:
    Hα = R, OIII = media de G y B; o de ficheros) y las compara. La imagen no cambia: aplicarCandidato(id)."""
    info = H._info(siril)
    crudo = _crudo(siril)
    p = _pantalla(crudo, info)
    if _lineal(p):
        raise RuntimeError("La imagen parece lineal: las paletas se componen con capas ya estiradas (Paso 1 no lineal).")
    if ha:
        Ha = _canal_fichero(siril, ha, info, "ha")
    elif info["canales"] == 3:
        Ha = p[0]
    else:
        raise RuntimeError("Imagen en blanco y negro: pasa ha y oiii (ficheros de las capas estiradas).")
    if oiii:
        O = _canal_fichero(siril, oiii, info, "oiii")
    elif info["canales"] == 3:
        O = 0.5 * (p[1] + p[2])
    else:
        raise RuntimeError("Falta oiii.")
    S = _canal_fichero(siril, sii, info, "sii") if sii else None
    z = _zonas(p)
    Oa = _igualar(O, Ha, z["cielo_px"])
    t = np.clip((Oa - float(np.median(Oa[z["cielo_px"]])) if z["cielo_px"].any() else Oa) * 4, 0, 1)   # peso: OIII sobre el cielo
    todas = {
        "HOO": ("HOO", lambda: (Ha, O, O)),
        "HOO_suave": ("HOO suave (G = 0,6·Hα + 0,4·OIII)", lambda: (Ha, 0.6 * Ha + 0.4 * O, O)),
        "HOO_realzado": ("HOO con OIII realzado", lambda: (Ha, Oa, Oa)),
        "HOO_dinamica": ("HOO dinámica (G mezcla Hα y OIII según OIII)", lambda: (Ha, t * Oa + (1 - t) * Ha, Oa)),
    }
    if S is not None:
        # 12 nov 2026 (Tarántula): el SII es la raya más débil y, estirado por su cuenta, quedaba por debajo del Hα (p90 0,21
        # frente a 0,33): la SHO salía verde y apagada. Igual que el OIII, se lleva al mismo cielo y recorrido que el Hα.
        Sa = _igualar(S, Ha, z["cielo_px"])
        todas["SHO"] = ("SHO", lambda: (Sa, Ha, Oa))
    elegir = list(paletas) if paletas else list(todas)
    cel = z["medidas"]["_celdas"]
    huella = _huella(crudo)
    grupo = "paleta"
    _limpiar_grupo(grupo)
    r = {"fuente": {"ha": ha or "R de la imagen", "oiii": oiii or "media de G y B de la imagen", "sii": sii},
         "candidatos": [], "errores": []}
    n = 0
    for k in elegir:
        if k not in todas:
            r["errores"].append(f"{k}: paleta desconocida o sin SII ({', '.join(todas)})")
            continue
        n += 1
        nombre, fn = todas[k]
        t0 = time.perf_counter()
        try:
            q = np.clip(np.stack(fn()).astype(np.float32), 0, 1)
            rgb = _cielo_por_canal(q, cel)
            dom = 100.0 * (max(rgb) - min(rgb)) / max(float(np.mean(rgb)), 1e-6)
            mo = z["obj_px"] if z["obj_px"].any() else np.ones(q.shape[1:], bool)
            Lo = float(_lum(q)[mo].mean())
            verde = 100.0 * float(np.maximum(q[1] - np.maximum(q[0], q[2]), 0)[mo].mean()) / max(Lo, 1e-6)
            m = {"dominante_cielo_pct": _r(dom, 1), "verde_residual_pct": _r(verde, 1),
                 "sat_objeto": _r(float(_saturacion(q)[mo].mean()), 3), "separacion_tonos_grados": _r(_tonos(q, mo), 1),
                 **_recortes(q)}
            fal = []
            if dom >= dominante_max:
                fal.append(f"cielo teñido: dominante {m['dominante_cielo_pct']} % ≥ {dominante_max} %")
            if verde >= verde_max:
                fal.append(f"verde residual {m['verde_residual_pct']} % ≥ {verde_max} % (SCNR suave después)")
            res = q if info["top_down"] else q[:, ::-1, :]
            # 12 nov 2026 (Tarántula, mono): con una capa mono cargada y las rayas en ficheros, la paleta es RGB y no cabe
            # en la forma de la imagen cargada («cannot reshape»): se guarda con 3 canales.
            forma = crudo.shape if (crudo.ndim == 3 and crudo.shape[0] == 3) else (3,) + tuple(crudo.shape[-2:])
            res = _a_siril(res, crudo.dtype).reshape(forma)
            cid = _guardar_candidato(grupo, n, res, {"nombre": nombre, "comando": f"paleta {k}", "huella_base": huella, "metricas": m})
            r["candidatos"].append({"id": cid, "metodo": nombre, "metricas": m, "no_cumple": fal,
                                    "segundos": _r(time.perf_counter() - t0, 1)})
        except Exception as e:
            r["errores"].append(f"{nombre}: {e}")
    ok = [x for x in r["candidatos"] if not x["no_cumple"]]
    if r["candidatos"]:
        mejor = max(ok or r["candidatos"], key=lambda x: x["metricas"]["separacion_tonos_grados"] or 0)
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: la que más separa los tonos ({mejor['metricas']['separacion_tonos_grados']}°) con el "
                       f"cielo neutro" + ("" if ok else " (NINGUNA cumple: ver no_cumple)") + ". Una paleta es una convención, "
                       "no el color real: la elección es estética; mírala en la galería.")
    r["leyenda"] = ("separacion_tonos_grados: variedad de tonos en el objeto (desviación circular del tono ponderada por "
                    "saturación; más = más zonas distinguibles). verde_residual_pct: verde por encima de rojo y azul en el objeto. "
                    "dominante_cielo_pct: el cielo debe quedar neutro. La imagen NO ha cambiado: aplicarCandidato(id).")
    _asegurar_restaurado(siril, crudo, huella, r)
    _galeria(r, info, p, None)
    return r


# --- NL9: recombinar estrellas -------------------------------------------------------------------------------

def _leer_fichero(siril, ruta, info):
    """Lee un fichero con sirilpy y lo devuelve como float32 0–1 (canales, alto, ancho) en el orden de filas de Siril."""
    f = siril.load_image_from_file(str(ruta))
    d = np.asarray(f.data)
    if d.ndim == 3 and d.shape[0] not in (1, 3) and d.shape[-1] in (1, 3):
        d = np.moveaxis(d, -1, 0)
    d = d[np.newaxis] if d.ndim == 2 else d
    k = 65535.0 if d.dtype == np.uint16 else (255.0 if d.dtype == np.uint8 else 1.0)
    d = d.astype(np.float32) / np.float32(k)
    td = getattr(f, "top_down", None)
    if td is not None and bool(td) != bool(info["top_down"]):
        d = d[:, ::-1, :]
    return d


def _px_estrella(Lb):
    """Píxeles de estrella de la capa de estrellas: > mediana + 5σ (MAD); al menos el 0,5 % más brillante."""
    v = Lb.ravel()[::7]
    med = float(np.median(v))
    sig = 1.4826 * float(np.median(np.abs(v - med)))
    umbral = med + 5 * max(sig, 1e-6)
    m = Lb > umbral
    if m.mean() < 0.005:
        m = Lb >= np.percentile(v, 99.5)
    return m


def recombinarEstrellas(siril, fichero, metodo="screen", factor=1.0, estirar_estrellas=None):
    """Paso 9 no lineal: une la starless cargada con la capa de estrellas de 'fichero' (screen o suma), con deshacer."""
    info = H._info(siril)
    ruta = H._ruta(fichero)
    if not ruta.is_file():
        raise FileNotFoundError(f"No existe: {ruta}")
    if metodo not in ("screen", "suma"):
        raise ValueError("metodo: screen o suma.")
    k = float(factor)
    if not 0 < k <= 2:
        raise ValueError("factor entre 0 y 2 (1 = estrellas tal cual; 0,5–0,6 para estrellas discretas).")
    crudo = _crudo(siril)
    a = _de_siril(crudo)
    b = _leer_fichero(siril, ruta, info)
    if b.shape[1:] != a.shape[1:]:
        raise RuntimeError(f"La capa de estrellas mide {b.shape[2]}×{b.shape[1]} y la imagen {a.shape[2]}×{a.shape[1]}.")
    if b.shape[0] != a.shape[0]:
        if b.shape[0] == 1:
            b = np.repeat(b, a.shape[0], axis=0)
        else:
            raise RuntimeError("La capa de estrellas es en color y la imagen cargada en blanco y negro.")
    La, Lb = _lum(a), _lum(b)
    star_lineal = float(np.median(Lb)) < 0.05 and float(np.percentile(Lb.ravel()[::7], 99)) < 0.05
    starless_estirada = not _lineal(a)
    r = {"metodo": metodo, "factor": k, "estrellas": str(ruta),
         "capa_estrellas": {"mediana": _r(float(np.median(Lb)), 5), "p99": _r(float(np.percentile(Lb.ravel()[::7], 99)), 4)}}
    mascara = _px_estrella(Lb)
    if star_lineal and starless_estirada:
        if estirar_estrellas is None or not estirar_estrellas:
            r.update(aplicado=False, aviso=(
                "La capa de estrellas parece lineal (mediana < 0,05 y p99 < 0,05) y la starless está estirada: juntarlas así "
                "da estrellas apagadas o «círculos enormes». Repite con estirar_estrellas: true (arcsinh hasta que el p90 de "
                "los píxeles de estrella sea ≈ 0,10) o estira la capa antes."))
            return r
        vals = b[:, mascara].mean(axis=0)
        lo, hi = 0.0, np.log(1e5)
        for _ in range(30):
            s = float(np.exp((lo + hi) / 2))
            p90 = float(np.percentile(np.arcsinh(s * vals) / np.arcsinh(s), 90))
            if p90 < 0.10:
                lo = np.log(s)
            else:
                hi = np.log(s)
        s = float(np.exp((lo + hi) / 2))
        b = (np.arcsinh(s * np.clip(b, 0, 1)) / np.arcsinh(s)).astype(np.float32)
        r["estirado_estrellas"] = {"arcsinh": _r(s, 1), "p90_estrellas": _r(float(np.percentile(_lum(b)[mascara], 90)), 3)}
    elif metodo == "suma" and starless_estirada:
        r["aviso_suma"] = "La guía reserva la suma para capas lineales; con la starless estirada, mejor screen."
    if metodo == "screen":
        res = 1.0 - (1.0 - np.clip(a, 0, 1)) * (1.0 - np.clip(k * b, 0, 1))
    else:
        res = a + k * b
    res = np.clip(res, 0, 1).astype(np.float32)
    Lr = _lum(res)
    aporte = 100.0 * float((Lr - La).mean()) / max(float(Lr.mean()), 1e-9)
    # fondo: celdas de cielo de la starless, antes y después
    cel = _cielo(a)["_celdas"]
    fondo_a, fondo_r = np.mean(_cielo_por_canal(a, cel)), np.mean(_cielo_por_canal(res, cel))
    rec0, rec1 = _recortes(a), _recortes(res)
    r.update(aporte_estrellas_pct=_r(aporte, 2), fondo_antes=_r(fondo_a, 5), fondo_despues=_r(fondo_r, 5),
             recortes_antes=rec0, recortes_despues=rec1)
    avisos = []
    if aporte < 0.5:
        avisos.append(f"las estrellas aportan solo el {round(aporte, 2)} % (< 0,5 %): ¿capa vacía, lineal o factor bajo?")
    if fondo_r < fondo_a - 1e-5:
        avisos.append("el fondo baja tras recombinar: hay un error en otro sitio (no debería pasar)")
    if rec1["altos_pct"] - rec0["altos_pct"] > 0.05:
        avisos.append(f"recorte alto nuevo {_r(rec1['altos_pct'] - rec0['altos_pct'], 3)} % (núcleos de estrella a 1): baja factor")
    if avisos:
        r["avisos"] = avisos
    _poner(siril, _a_siril(res, crudo.dtype).reshape(crudo.shape),
           f"SirilAstroPilot: estrellas {metodo} x{k:g}")
    r.update(aplicado=True, nota="Hecho con deshacer. Mira con previa (y un recorte al 100 % en estrellas) y guarda con guardarImagen.")
    return r


# --- NL10: exportar ------------------------------------------------------------------------------------------

def _libre(carpeta, base):
    """<base>_final, o _final_2, _final_3... si ya existe el .tif o el .jpg."""
    n = 1
    while True:
        nombre = f"{base}_final" + (f"_{n}" if n > 1 else "")
        if not any((carpeta / (nombre + e)).exists() for e in (".tif", ".tiff", ".jpg", ".jpeg")):
            return carpeta / nombre
        n += 1


def exportarFinal(siril, carpeta, nombre=None, calidad=95):
    """Paso 10 no lineal: TIFF 16 bits y JPG en 'carpeta' como <nombre>_final.tif/.jpg, sin sobrescribir."""
    info = H._info(siril)
    dest = H._ruta(carpeta, "carpeta")
    base = str(nombre or Path(info["fichero"] or "imagen").stem)
    if not re.fullmatch(r"[\w .\-]+", base) or base.strip(". ") == "":
        raise ValueError("nombre: solo letras, números, espacios, _ . -")
    dest.mkdir(parents=True, exist_ok=True)
    raiz = _libre(dest, base)
    p = H._pixeles(siril, info)
    r = {"control": {**_recortes(p), "lineal": _lineal(p)}}
    if r["control"]["lineal"]:
        r["aviso"] = "La imagen parece lineal: en TIFF/JPG se verá casi negra. ¿Falta estirar?"
    q = max(1, min(100, int(calidad)))
    t0 = time.perf_counter()
    siril.cmd("savetif", H._arg_cmd(raiz))
    siril.cmd("savejpg", H._arg_cmd(raiz), str(q))
    hechos = []
    for e in (".tif", ".tiff", ".jpg", ".jpeg"):
        f = Path(str(raiz) + e)
        if f.exists():
            hechos.append({"fichero": str(f), "bytes": os.path.getsize(f)})
    if len(hechos) < 2:
        raise RuntimeError(f"Siril no ha escrito los dos ficheros ({[h['fichero'] for h in hechos]}): mira registro.")
    r.update(ficheros=hechos, segundos=_r(time.perf_counter() - t0, 1), calidad_jpg=q,
             nota="TIFF de 16 bits y JPG con el perfil de color que tenga la imagen en Siril (para web, sRGB). "
                  "Guarda también la versión FITS 32 bits con guardarImagen si no lo has hecho.")
    return r


LISTA_PASOS = {
    "reducirRuidoCandidatos": reducirRuidoCandidatos,
    "estrellasCandidatos": estrellasCandidatos,
    "nitidezLineal": nitidezLineal,
    "saturacionCandidatos": saturacionCandidatos,
    "contrasteCandidatos": contrasteCandidatos,
    "paletasCandidatos": paletasCandidatos,
    "recombinarEstrellas": recombinarEstrellas,
    "exportarFinal": exportarFinal,
    "recortarBordes": recortarBordes,
    "resolverAstrometria": resolverAstrometria,
    "gradienteCandidatos": gradienteCandidatos,
    "aplicarCandidato": aplicarCandidato,
    "listaSPCC": listaSPCC,
    "calibrarColor": calibrarColor,
    "equilibrarColor": equilibrarColor,
    "separarEstrellas": separarEstrellas,
    "estirarCandidatos": estirarCandidatos,
    "quitarVerde": quitarVerde,
}
