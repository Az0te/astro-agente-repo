# SetiAstroPilot — máscaras y PixelMath en SASpro (como mascaras.js de PixInsight, Paso 4 no lineal).
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# - crearMascara: máscara gris 0–1 en una vista nueva (luminancia, cielo, estrellas, color por tono o la de estructura
#   difusa de SASpro). No la aplica.
# - aplicarConMascara: mezcla en la vista un resultado (un candidato de cualquier comparación o otra vista) a través
#   de una máscara: original·(1 − k·m) + procesado·k·m, con deshacer. Mide el efecto y la fuga.
# - pixelMath: expresión de PixelMath de SASpro (su mismo evaluador, con los nombres de las vistas abiertas) sobre la
#   vista con deshacer o en una vista nueva.
# (16 nov 2026.)
# 25 nov 2026: tipos nuevos (rango con difuminado, crominancia, objeto = estructura sin estrellas, estrellas con las
# brillantes más crecidas), 'fuente' (sacar la máscara de otra vista: la starless, la capa de Hα…), combinarMascaras,
# ajustarMascara y máscara en las comparaciones (*Candidatos con 'mascara': cada candidato se mide ya mezclado a través
# de ella). Los cálculos de rango y crominancia siguen la idea de las máscaras de SASpro (mask_creation.py), escritos aquí.

import numpy as np

import herramientas as H
import medidas as M

_r = H._r

TONOS = {"rojo": 0, "naranja": 30, "amarillo": 60, "verde": 120, "cian": 180, "azul": 240, "magenta": 300}


def _norm(x, bajo=1.0, alto=99.9):
    lo, hi = (float(np.percentile(x[::4, ::4], q)) for q in (bajo, alto))
    return np.clip((x - lo) / max(hi - lo, 1e-9), 0.0, 1.0)


def _estrellas(L, crecer=2, sigma=5.0):
    hp = L - M._caja(L, 5)
    v = hp[::4, ::4]
    s = 1.4826 * float(np.median(np.abs(v - np.median(v))))
    m = (hp > sigma * max(s, 1e-9)).astype(np.float32)
    return (M._caja(m, int(crecer)) > 0).astype(np.float32) if crecer else m


def _tono(p):
    """Tono HSV en grados (0–360) y saturación."""
    r, g, b = p[0], p[1], p[2]
    mx, mn = p.max(axis=0), p.min(axis=0)
    d = np.maximum(mx - mn, 1e-9)
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60.0
    return h.astype(np.float32), M.saturacion(p)


def _estructura(p):
    """Máscara de estructura difusa de SASpro (imageops.diffuse_structure_mask) con los ajustes que ella sugiere."""
    from setiastro.saspro.imageops.diffuse_structure_mask import (diffuse_structure_mask,
                                                                  suggest_diffuse_structure_settings)
    img = p[0] if p.shape[0] == 1 else np.moveaxis(p, 0, -1)
    img = np.ascontiguousarray(img, dtype=np.float32)
    ajustes = {}
    try:
        s = suggest_diffuse_structure_settings(img)
        if isinstance(s, dict):
            ajustes = {k: v for k, v in s.items() if k in ("sensitivity", "feather_fraction", "min_area_fraction",
                                                           "envelope_fraction", "profile", "reject_stars")}
    except Exception:
        pass
    ajustes.setdefault("reject_stars", True)
    m = diffuse_structure_mask(img, **ajustes)
    if isinstance(m, tuple):
        m = m[0]
    return np.clip(np.asarray(m, dtype=np.float32), 0, 1), ajustes


TIPOS = ("luminancia", "cielo", "estrellas", "color", "estructura", "rango", "crominancia", "objeto")


def _max_filtro(m, r):
    """Dilatación en escala de grises (máximo en un cuadrado de 2r+1 px), separable."""
    r = int(r)
    if r <= 0:
        return m
    out = m.copy()
    for eje in (0, 1):
        base = out.copy()
        p = np.pad(base, [(r, r) if e == eje else (0, 0) for e in (0, 1)], mode="edge")
        n = base.shape[eje]
        for k in range(2 * r + 1):
            out = np.maximum(out, p[k:k + n, :] if eje == 0 else p[:, k:k + n])
    return out


def _min_filtro(m, r):
    """Erosión en escala de grises (mínimo en 2r+1 px)."""
    return 1.0 - _max_filtro(1.0 - m, r)


def _construir(p, tipo="luminancia", gamma=1.0, tono=None, ancho=30.0, crecer=2, bajo=None, alto=None, difuso=0.05,
               sigma=5.0, crecer_brillantes=None, componente="luminancia"):
    """Máscara 0–1 (alto, ancho) de la imagen p (canales, alto, ancho) y datos para el resultado."""
    L = M.lum(p)
    info = {}
    if tipo in ("luminancia", "cielo"):
        m = _norm(L) ** float(gamma)
        if tipo == "cielo":
            m = 1.0 - m
    elif tipo == "estrellas":
        m = _estrellas(L, crecer, float(sigma))
        # las brillantes tienen halo: se crecen más (por defecto ×3), así la máscara las cubre enteras
        cb = int(crecer_brillantes if crecer_brillantes is not None else 3 * max(int(crecer), 1))
        if cb > int(crecer):
            nucleos = _estrellas(L, 0, 10.0 * float(sigma))
            m = np.maximum(m, (M._caja(nucleos, cb) > 0).astype(np.float32))
            info["crecer_brillantes"] = cb
    elif tipo == "color":
        if p.shape[0] < 3:
            raise ValueError("La máscara de color necesita una vista en color.")
        if tono is None:
            raise ValueError("Falta tono (rojo, naranja, amarillo, verde, cian, azul, magenta o grados).")
        t = float(TONOS.get(str(tono).lower(), tono))
        h, sat = _tono(p)
        dist = np.abs((h - t + 180.0) % 360.0 - 180.0)
        m = np.clip(1.0 - dist / max(float(ancho), 1.0), 0, 1) * np.clip(sat / max(float(np.percentile(sat, 99)), 1e-6), 0, 1)
        m = m ** float(gamma)
        info["tono_grados"] = t
    elif tipo == "estructura":
        m, info["ajustes_saspro"] = _estructura(p)
    elif tipo == "objeto":
        # estructura difusa sin estrellas: la nebulosa o galaxia sola (para color, contraste, saturación)
        e, info["ajustes_saspro"] = _estructura(p)
        est = _estrellas(L, max(int(crecer), 2), float(sigma))
        m = e * (1.0 - M.suave(est, 4))
    elif tipo == "rango":
        # luminancia normalizada entre 'bajo' y 'alto' con rampa 'difuso' (la Range Selection de SASpro)
        # componente «maximo»: el canal más alto, así el Hα rojo saturado cuenta tan brillante como se ve (la idea de la
        # opción L* de la Range Selection de SASpro 2.0)
        Ln = _norm(p.max(axis=0) if (componente == "maximo" and p.shape[0] >= 3) else L, 0.1, 99.9)
        lo = float(bajo if bajo is not None else 0.25)
        hi = float(alto if alto is not None else 1.0)
        f = max(float(difuso), 1e-6)
        m = np.clip((Ln - (lo - f)) / f, 0, 1) * np.clip(((hi + f) - Ln) / f, 0, 1)
        m = m ** float(gamma)
        info.update(bajo=lo, alto=hi, difuso=float(difuso), componente=componente)
    elif tipo == "crominancia":
        # distancia al gris en el plano de color (Cb/Cr): dónde hay color, sea del tono que sea
        if p.shape[0] < 3:
            raise ValueError("La máscara de crominancia necesita una vista en color.")
        r, g, b = p[0], p[1], p[2]
        y = 0.299 * r + 0.587 * g + 0.114 * b
        cb, cr = (b - y) * 0.564, (r - y) * 0.713
        c = np.sqrt((cb - np.median(cb[::4, ::4])) ** 2 + (cr - np.median(cr[::4, ::4])) ** 2)
        m = _norm(c, 1.0, 99.5) ** float(gamma)
    else:
        raise ValueError("tipo: " + ", ".join(TIPOS) + ".")
    return np.clip(m, 0, 1).astype(np.float32), info


def _nueva_vista(ctx, d, m, nombre):
    meta = dict(H._meta(d))
    meta.pop("file_path", None)
    meta.update(display_name=nombre, mono=True)
    nuevo = ctx.open_new_document(np.ascontiguousarray(m.astype(np.float32)), metadata=meta, name=nombre)
    return H._nombre(H._base(nuevo)) if nuevo is not None else nombre


def _cobertura(m, p):
    z = M.zonas_objeto_cielo(p)
    return {"media": _r(float(m.mean()), 3), "cubre_pct": _r(100.0 * float((m > 0.5).mean()), 2),
            "media_cielo": _r(float(m[z["cielo_px"]].mean()), 3) if z["cielo_px"].any() else None,
            "media_objeto": _r(float(m[z["obj_px"]].mean()), 3) if z["obj_px"].any() else None,
            "media_estrellas": _r(float(m[z["est_px"]].mean()), 3) if z["est_px"].any() else None}


def crearMascara(ctx, vista=None, tipo="luminancia", gamma=1.0, suavizar=2, tono=None, ancho=30.0, crecer=2,
                 invertir=False, nombre=None, fuente=None, bajo=None, alto=None, difuso=0.05, sigma=5.0,
                 crecer_brillantes=None, componente="luminancia"):
    """Paso 4 no lineal: crea una máscara gris 0–1 en una vista nueva y mide su cobertura (cielo, objeto, estrellas).
    No la aplica. tipo: luminancia, cielo, estrellas, color, estructura, rango, crominancia u objeto. Con 'fuente'
    (otra vista del mismo tamaño: la starless, la capa de Hα…) la máscara se calcula sobre esa vista."""
    d = H._doc(ctx, vista)
    p = H._p(d.image)
    q = H._p(H._doc(ctx, fuente).image) if fuente else p
    if q.shape[1:] != p.shape[1:]:
        raise RuntimeError(f"La fuente mide {q.shape[2]}×{q.shape[1]} y la vista {p.shape[2]}×{p.shape[1]}.")
    m, info = _construir(q, tipo, gamma=gamma, tono=tono, ancho=ancho, crecer=crecer, bajo=bajo, alto=alto,
                         difuso=difuso, sigma=sigma, crecer_brillantes=crecer_brillantes, componente=componente)
    if suavizar and tipo not in ("estructura", "objeto"):
        m = M.suave(m.astype(np.float32), 2 * int(suavizar))
    if invertir:
        m = 1.0 - m
    m = np.clip(m, 0, 1).astype(np.float32)
    nombre = nombre or f"{H._nombre(d)}_mask_{tipo}"
    r = {"mascara": _nueva_vista(ctx, d, m, nombre), "tipo": tipo, **({"fuente": fuente} if fuente else {}),
         **_cobertura(m, p), **info,
         "nota": "Blanca = deja pasar el efecto. Úsala en cualquier comparación (*Candidatos con 'mascara') o con "
                 "aplicarConMascara; combínala con combinarMascaras y retócala con ajustarMascara. Mírala con previa."}
    H._reactivar(ctx, d)
    return r


def combinarMascaras(ctx, a, b, operacion="producto", nombre=None):
    """Combina dos máscaras (vistas del mismo tamaño) en una vista nueva. operacion: producto (las dos a la vez),
    maximo (cualquiera), minimo, resta (a − b) o a_sin_b (a · (1 − b): p. ej. objeto sin estrellas)."""
    da = H._doc(ctx, a)
    ma = _mascara(ctx, a, H._p(da.image).shape[1:])
    mb = _mascara(ctx, b, ma.shape)
    ops = {"producto": lambda x, y: x * y, "maximo": np.maximum, "minimo": np.minimum,
           "resta": lambda x, y: x - y, "a_sin_b": lambda x, y: x * (1.0 - y)}
    if operacion not in ops:
        raise ValueError("operacion: " + ", ".join(ops) + ".")
    m = np.clip(ops[operacion](ma, mb), 0, 1).astype(np.float32)
    nombre = nombre or f"{H._nombre(da)}_{operacion}"
    r = {"mascara": _nueva_vista(ctx, da, m, nombre), "operacion": operacion,
         "media": _r(float(m.mean()), 3), "cubre_pct": _r(100.0 * float((m > 0.5).mean()), 2)}
    H._reactivar(ctx, da)
    return r


def ajustarMascara(ctx, mascara, crecer=0, encoger=0, suavizar=0, gamma=1.0, bajo=0.0, alto=1.0, umbral=None,
                   invertir=False, nombre=None):
    """Retoca una máscara en una vista nueva, en este orden: umbral (binaria), crecer / encoger px (dilatar / erosionar),
    niveles bajo–alto, gamma, suavizar px e invertir. La original no cambia."""
    d = H._doc(ctx, mascara)
    q = H._p(d.image)
    m = (q[0] if q.shape[0] == 1 else q.mean(axis=0)).astype(np.float32)
    if umbral is not None:
        m = (m >= float(umbral)).astype(np.float32)
    if crecer:
        m = _max_filtro(m, int(crecer))
    if encoger:
        m = _min_filtro(m, int(encoger))
    lo, hi = float(bajo), float(alto)
    if (lo, hi) != (0.0, 1.0):
        m = np.clip((m - lo) / max(hi - lo, 1e-6), 0, 1)
    if float(gamma) != 1.0:
        m = m ** float(gamma)
    if suavizar:
        m = M.suave(m, 2 * int(suavizar))
    if invertir:
        m = 1.0 - m
    m = np.clip(m, 0, 1).astype(np.float32)
    nombre = nombre or f"{H._nombre(d)}_aj"
    gy, gx = np.abs(np.diff(m, axis=0)), np.abs(np.diff(m, axis=1))
    return {"mascara": _nueva_vista(ctx, d, m, nombre), "media": _r(float(m.mean()), 3),
            "cubre_pct": _r(100.0 * float((m > 0.5).mean()), 2),
            "borde_duro_pct": _r(100.0 * float(((gy > 0.3).mean() + (gx > 0.3).mean()) / 2), 3)}


# --- Máscara en las comparaciones -----------------------------------------------------------------------------------
# Las *Candidatos que la aceptan reciben 'mascara' (vista o {tipo, ...} para hacerla al vuelo), 'mascara_fuerza' y
# 'mascara_invertir'; _comparar mezcla cada candidato con la imagen de partida a través de ella antes de medirlo y de
# guardarlo, así aplicarCandidato pone exactamente lo medido.

def mascara_para(ctx, d, mascara, fuerza=1.0, invertir=False):
    """Devuelve (m, descripción) para la vista d. mascara: nombre de una vista o dict {tipo, ...} de crearMascara."""
    p = H._p(d.image)
    if isinstance(mascara, dict):
        op = dict(mascara)
        fuente = op.pop("fuente", None)
        suav = int(op.pop("suavizar", 2))
        inv = bool(op.pop("invertir", False))
        q = H._p(H._doc(ctx, fuente).image) if fuente else p
        m, _ = _construir(q, **op)
        if suav and op.get("tipo") not in ("estructura", "objeto"):
            m = M.suave(m, 2 * suav)
        if inv:
            m = 1.0 - m
        nombre = "al vuelo: " + ", ".join(f"{k}={v}" for k, v in mascara.items())
    else:
        m = _mascara(ctx, mascara, p.shape[1:])
        nombre = str(mascara)
    if invertir:
        m = 1.0 - m
    k = float(np.clip(fuerza, 0, 1))
    m = np.clip(m * k, 0, 1).astype(np.float32)
    desc = {"mascara": nombre, "fuerza": k, "invertida": bool(invertir), **_cobertura(m, p)}
    return m, desc


def mezclar(p, q, m):
    """original·(1 − m) + procesado·m, en (canales, alto, ancho)."""
    w = m[np.newaxis]
    return np.clip(p * (1 - w) + q * w, 0, 1).astype(np.float32)


def _mascara(ctx, mascara, forma):
    dm = H._doc(ctx, mascara)
    q = H._p(dm.image)
    m = q[0] if q.shape[0] == 1 else q.mean(axis=0)
    if m.shape != forma:
        raise RuntimeError(f"La máscara '{H._nombre(dm)}' mide {m.shape[1]}×{m.shape[0]} y la vista {forma[1]}×{forma[0]}.")
    return np.clip(m, 0, 1).astype(np.float32)


def aplicarConMascara(ctx, mascara, vista=None, candidato=None, procesada=None, fuerza=1.0, invertir=False,
                      objetivo=None):
    """Paso 4 no lineal: pone en la vista un resultado a través de una máscara, con deshacer:
    original·(1 − k·m) + procesado·k·m. El procesado es un 'candidato' de la última comparación (id: contraste_2,
    saturacion_1…; hecha sobre esta misma vista) u otra vista 'procesada' del mismo tamaño. Mide el efecto donde
    m > 0,8, la fuga donde m < 0,05 y, con objetivo (fondo / brillante), avisa si la máscara parece invertida."""
    d = H._doc(ctx, vista)
    p = H._p(d.image)
    if (candidato is None) == (procesada is None):
        raise ValueError("Indica candidato (id de una comparación) o procesada (una vista), uno de los dos.")
    if candidato is not None:
        a, datos = H._cargar_candidato(candidato)
        if M.huella(d.image) != datos.get("huella_base"):
            raise RuntimeError(f"El candidato '{candidato}' no es de esta vista tal como está ahora: repite la comparación.")
        q = H._p(a)
        origen = f"candidato {candidato} ({datos.get('nombre')})"
    else:
        dp = H._doc(ctx, procesada)
        q = H._p(dp.image)
        origen = f"vista {H._nombre(dp)}"
    if q.shape != p.shape:
        if q.shape[1:] == p.shape[1:] and q.shape[0] == 1:
            q = np.repeat(q, p.shape[0], axis=0)
        else:
            raise RuntimeError(f"El procesado mide {q.shape} y la vista {p.shape}.")
    m = _mascara(ctx, mascara, p.shape[1:])
    if invertir:
        m = 1.0 - m
    k = float(np.clip(fuerza, 0, 1))
    w = (k * m)[np.newaxis]
    out = np.clip(p * (1 - w) + q * w, 0, 1).astype(np.float32)
    dif = np.abs(out - p).mean(axis=0)
    dentro, fuera = m > 0.8, m < 0.05
    total = float(np.abs(q - p).mean(axis=0)[dentro].mean()) if dentro.any() else None
    r = {"vista": H._nombre(d), "origen": origen, "fuerza": k,
         "efecto_dentro": _r(float(dif[dentro].mean()), 5) if dentro.any() else None,
         "efecto_dentro_vs_sin_mascara": _r(float(dif[dentro].mean()) / total, 3) if total else None,
         "fuga_fuera": _r(float(dif[fuera].mean()), 6) if fuera.any() else None,
         "mascara_media": _r(float(m.mean()), 3)}
    # bordes duros: salto grande de la máscara en 1 px
    gy, gx = np.abs(np.diff(m, axis=0)), np.abs(np.diff(m, axis=1))
    r["borde_duro_pct"] = _r(100.0 * float(((gy > 0.3).mean() + (gx > 0.3).mean()) / 2), 3)
    if objetivo in ("fondo", "brillante"):
        z = M.zonas_objeto_cielo(p)
        mc = float(m[z["cielo_px"]].mean()) if z["cielo_px"].any() else None
        mo = float(m[z["obj_px"]].mean()) if z["obj_px"].any() else None
        if mc is not None and mo is not None and ((objetivo == "fondo" and mo > mc) or (objetivo == "brillante" and mc > mo)):
            r["aviso"] = (f"La máscara parece invertida para '{objetivo}' (media en el cielo {mc:.2f}, en el objeto "
                          f"{mo:.2f}): ¿invertir: true?")
    if r["borde_duro_pct"] and r["borde_duro_pct"] > 0.5:
        r.setdefault("aviso", "La máscara tiene bordes duros: créala con más suavizar.")
    d.apply_edit(H._a_sas(out, d.image), metadata={}, step_name=f"SetiAstroPilot: {origen} con máscara (k {k:g})")
    return r


class _SoloLectura:
    """Envoltorio del documento sin set_image: así el PixelMath de SASpro devuelve el resultado sin escribirlo y se
    aplica con apply_edit (deshacer)."""

    def __init__(self, doc):
        self._doc = doc

    def __getattr__(self, n):
        if n == "set_image":
            raise AttributeError(n)
        return getattr(self._doc, n)


def pixelMath(ctx, vista=None, expr=None, expr_r=None, expr_g=None, expr_b=None, nueva=None):
    """PixelMath de SASpro (su evaluador: img o $T es la vista; img[0..2] sus canales; valen los títulos de las otras
    vistas abiertas, saneados, y funciones como mtf, iif, clamp, gauss, luma, med) sobre la vista con deshacer, o en
    una vista nueva con 'nueva' (nombre). expr para todos los canales, o expr_r/g/b. Varias líneas: la última es el
    resultado."""
    from setiastro.saspro.pixelmath import apply_pixel_math_to_doc
    d = H._doc(ctx, vista)
    preset = {"expr": expr or ""} if expr else {"expr_r": expr_r or "", "expr_g": expr_g or "", "expr_b": expr_b or ""}
    # En SASpro la vista es «img» (en PixInsight, $T): se aceptan los dos.
    preset = {k: str(v).replace("$T", "img") for k, v in preset.items()}
    if not any(str(v).strip() for v in preset.values()):
        raise ValueError("Falta la expresión (expr o expr_r/expr_g/expr_b).")
    sombra = _SoloLectura(d)
    out = apply_pixel_math_to_doc(getattr(ctx, "app", None), sombra, preset)
    if out is None or out is sombra:                  # sin set_image, SASpro hace doc.image = out
        out = sombra.__dict__.get("image")
    if out is None:
        raise RuntimeError("PixelMath no devolvió imagen.")
    out = np.clip(np.asarray(out, dtype=np.float32), 0, 1)
    texto = "; ".join(f"{k}={v}" for k, v in preset.items() if str(v).strip())
    if nueva:
        meta = dict(H._meta(d))
        meta.pop("file_path", None)
        meta.update(display_name=str(nueva), mono=out.ndim == 2)
        nv = ctx.open_new_document(np.ascontiguousarray(out), metadata=meta, name=str(nueva))
        H._reactivar(ctx, d)
        destino = H._nombre(H._base(nv)) if nv is not None else str(nueva)
    else:
        if out.shape != np.asarray(d.image).shape:
            raise RuntimeError(f"El resultado mide {out.shape} y la vista {np.asarray(d.image).shape}: usa 'nueva'.")
        d.apply_edit(out, metadata={}, step_name=f"PixelMath: {texto}"[:120])
        destino = H._nombre(d)
    q = H._p(out)
    return {"vista": destino, "expresion": texto, "media": _r(float(q.mean()), 5), **M.recortes(q)}


LISTA_MASCARAS = {"crearMascara": crearMascara, "aplicarConMascara": aplicarConMascara, "pixelMath": pixelMath,
                  "combinarMascaras": combinarMascaras, "ajustarMascara": ajustarMascara}
