# SirilAstroPilot — herramientas de la lista blanca.
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# Cada herramienta es una función f(siril, **args) que devuelve algo serializable a JSON.
# El puente (puente/SirilAstroPilot.py) solo ejecuta las que están en LISTA, desde un único hilo.
# Siril tiene una sola imagen cargada: no hay parámetro "vista" como en PixInsight.
#
# Convenciones:
# - Valores de píxel normalizados a 0–1 (16 bits se dividen entre 65535).
# - Coordenadas como se ven en pantalla: (0, 0) arriba a la izquierda; rect = [x0, y0, x1, y1], x1 e y1 excluidos.
# - Nada de image_lock() alrededor de siril.cmd(): el comando no podría tomar el hilo de proceso.

import math
import os
import re
import time
from pathlib import Path

import numpy as np

try:
    import sirilpy as s
except ImportError:          # pruebas fuera de Siril (pruebas/simulador.py)
    s = None

VERSION = "0.1.0"
DATOS = Path.home() / ".sirilastropilot"
PREVIAS = DATOS / "previas"
CANALES = ("R", "G", "B")
PROGRESO = {"texto": "", "desde": 0.0}   # lo rellenan los trabajos largos (apilado); el puente lo enseña en __estado


# --- Utilidades --------------------------------------------------------------------------------------------

def _r(x, n=6):
    """Redondea floats (y numpy) para que el JSON sea corto."""
    try:
        x = float(x)
    except (TypeError, ValueError):
        return x
    if math.isnan(x) or math.isinf(x):
        return None
    return round(x, n)


def _hay_imagen(siril):
    if not siril.is_image_loaded():
        raise RuntimeError("No hay ninguna imagen cargada en Siril. Usa abrirImagen.")


def _info(siril):
    """Metadatos sin píxeles: tamaño, canales, bitpix, orden de filas."""
    _hay_imagen(siril)
    f = siril.get_image(with_pixels=False)
    c, h, w = siril.get_image_shape()
    bitpix = int(f.bitpix) if f is not None and f.bitpix is not None else None
    return {
        "ancho": w, "alto": h, "canales": c,
        "bitpix": bitpix,
        "tipo": "float32" if bitpix in (-32, -64) else "uint16",
        "top_down": bool(getattr(f, "top_down", False)),
        "fichero": siril.get_image_filename(),
    }


def _escala(info):
    """Divisor para pasar a 0–1 según el tipo de datos de Siril (USHORT o FLOAT)."""
    return 1.0 if info["tipo"] == "float32" else 65535.0


def _pixeles(siril, info=None):
    """Píxeles reales como float32 0–1, forma (canales, alto, ancho), fila 0 arriba."""
    info = info or _info(siril)
    a = siril.get_image_pixeldata()
    if a.ndim == 2:
        a = a[np.newaxis, :, :]
    a = a.astype(np.float32, copy=False)
    k = _escala(info)
    if k != 1.0:
        a = a / np.float32(k)
    if not info["top_down"]:
        a = a[:, ::-1, :]
    return a


def _rect(rect, w, h):
    if rect is None:
        return 0, 0, w, h
    if not isinstance(rect, (list, tuple)) or len(rect) != 4:
        raise ValueError("rect debe ser [x0, y0, x1, y1].")
    x0, y0, x1, y1 = (int(round(v)) for v in rect)
    x0, x1 = max(0, min(x0, w)), max(0, min(x1, w))
    y0, y1 = max(0, min(y0, h)), max(0, min(y1, h))
    if x1 - x0 < 2 or y1 - y0 < 2:
        raise ValueError(f"rect vacío o fuera de la imagen ({w}×{h}).")
    return x0, y0, x1, y1


def _est(a):
    """Estadísticas de un canal (array 2D 0–1). MAD sin normalizar, como en la guía."""
    v = a.ravel()
    med = float(np.median(v))
    return {
        "mediana": _r(med), "mad": _r(np.median(np.abs(v - med))),
        "media": _r(v.mean()), "min": _r(v.min()), "max": _r(v.max()),
    }


def _ruta(ruta, campo="fichero"):
    if not ruta or not isinstance(ruta, str):
        raise ValueError(f"Falta {campo} (ruta absoluta).")
    p = Path(os.path.expanduser(ruta))
    if not p.is_absolute():
        raise ValueError(f"{campo} debe ser una ruta absoluta: {ruta}")
    return p


def _arg_cmd(p: Path) -> str:
    """Ruta como argumento de un comando de Siril: barras normales y entre comillas."""
    t = str(p).replace("\\", "/")
    if '"' in t:
        raise ValueError("La ruta no puede llevar comillas.")
    return f'"{t}"'


# --- Herramientas: lectura ---------------------------------------------------------------------------------

def ping(siril):
    """Comprueba que el puente y Siril responden."""
    r = {"herramientas": VERSION, "sirilpy": getattr(s, "__version__", None) if s else None,
         "imagen_cargada": bool(siril.is_image_loaded()), "directorio": siril.get_siril_wd()}
    if r["imagen_cargada"]:
        r["imagen"] = _info(siril)
    return r


def imagen(siril):
    """Datos de la imagen cargada (equivalente a 'vistas' de PixInsight, con una sola imagen)."""
    i = _info(siril)
    k = siril.get_image_keywords()
    i["astrometria"] = bool(getattr(k, "pltsolvd", False)) if k else False
    i["historial"] = (siril.get_image_history() or [])[-10:]
    return i


def estadisticas(siril, rect=None, bordes=None):
    """Mediana, MAD, media, mín. y máx. por canal (0–1). Con bordes, franjas de borde frente al centro."""
    info = _info(siril)
    w, h = info["ancho"], info["alto"]
    if rect is None and not bordes:
        # Rápido: estadísticas que ya calcula Siril.
        # Si Siril aún no las ha calculado devuelve -999999 (recién cargada): entonces se calculan con numpy.
        k = _escala(info)
        r = {}
        validas = True
        for c in range(info["canales"]):
            st = siril.get_image_stats(c)
            if st is None or min(st.median, st.mad, st.mean) <= -999000:
                validas = False
                break
            r[CANALES[c] if info["canales"] == 3 else "K"] = {
                "mediana": _r(st.median / k), "mad": _r(st.mad / k), "media": _r(st.mean / k),
                "min": _r(st.min / k), "max": _r(st.max / k), "ruido_fondo": _r(st.bgnoise / k),
            }
        if validas and r:
            return {"ancho": w, "alto": h, "canales": r}
    a = _pixeles(siril, info)
    x0, y0, x1, y1 = _rect(rect, w, h)
    nombres = CANALES if info["canales"] == 3 else ("K",)
    sub = a[:, y0:y1, x0:x1]
    r = {"rect": [x0, y0, x1, y1], "canales": {n: _est(sub[i]) for i, n in enumerate(nombres)}}
    if bordes:
        b = int(bordes)
        if b < 2 or 2 * b >= min(x1 - x0, y1 - y0):
            raise ValueError("bordes debe ser > 1 y menor que la mitad del lado menor.")
        zonas = {
            "izquierda": sub[:, :, :b], "derecha": sub[:, :, -b:],
            "arriba": sub[:, :b, :], "abajo": sub[:, -b:, :],
            "centro": sub[:, (y1 - y0) // 2 - b // 2:(y1 - y0) // 2 + b // 2 + 1,
                             (x1 - x0) // 2 - b // 2:(x1 - x0) // 2 + b // 2 + 1],
        }
        med = {z: [float(np.median(v[i])) for i in range(v.shape[0])] for z, v in zonas.items()}
        r["bordes"] = {z: [_r(m) for m in med[z]] for z in zonas}
        r["caida_vs_centro"] = {z: [_r(m - c) for m, c in zip(med[z], med["centro"])]
                                for z in ("izquierda", "derecha", "arriba", "abajo")}
    return r


def previa(siril, lado=1600, rect=None, enlazado=None, fichero=None):
    """JPG con el autoestirado de Siril (sin tocar la imagen). Con rect, recorte al 100 % si cabe en 'lado'.
    enlazado: por defecto, por canal si la imagen es lineal (un master sin calibrar sale azul o verde con el estirado
    enlazado: M31, 10 nov 2026) y enlazado si ya está estirada (para ver el color real)."""
    from PIL import Image
    info = _info(siril)
    w, h = info["ancho"], info["alto"]
    if enlazado is None:
        try:
            st = [siril.get_image_stats(c) for c in range(info["canales"])]
            med = [x.median / _escala(info) for x in st if x is not None and x.median > -999000]
        except Exception:
            med = []
        if not med:
            med = [float(np.median(_pixeles(siril, info)[:, ::8, ::8]))]
        enlazado = max(med) >= 0.05
    a = siril.get_image_pixeldata(preview=True, linked=bool(enlazado))   # uint8, ya estirada
    if a.ndim == 2:
        a = a[np.newaxis, :, :]
    if not info["top_down"]:
        a = a[:, ::-1, :]
    x0, y0, x1, y1 = _rect(rect, w, h)
    a = a[:, y0:y1, x0:x1]
    img = Image.fromarray(np.ascontiguousarray(a[0] if a.shape[0] == 1 else np.moveaxis(a, 0, -1)))
    lado = max(64, int(lado))
    if max(img.size) > lado:
        img.thumbnail((lado, lado), Image.LANCZOS)
    PREVIAS.mkdir(parents=True, exist_ok=True)
    if fichero:
        p = _ruta(fichero)
    else:
        base = Path(info["fichero"] or "imagen").stem
        p = PREVIAS / (f"{base}_{x0}_{y0}.jpg" if rect else f"{base}.jpg")
    img.save(p, "JPEG", quality=90)
    return {"fichero": str(p), "ancho": img.size[0], "alto": img.size[1], "enlazado": bool(enlazado),
            "escala": _r(img.size[0] / (x1 - x0), 3), "rect": [x0, y0, x1, y1] if rect else None}


def _zonas_vacias(lum, mediana):
    """Ancho de las zonas sin datos (cuñas tras alinear) en cada lado: por cada fila (izquierda/derecha) o
    columna (arriba/abajo), píxeles desde el borde hasta el primer dato; por lado, percentil 95 y máximo.
    Las cuñas no siempre son cero exacto pero quedan muy por debajo del fondo: umbral relativo a la mediana."""
    umbral = max(1e-6, 0.25 * mediana)
    datos = lum > umbral
    h, w = datos.shape

    def hasta_dato(m, eje):
        # argmax da el primer True. Las filas/columnas sin ningún dato ya las cuenta el lado perpendicular
        # (son la banda de arriba/abajo o izquierda/derecha): se dejan fuera para no medir todo el ancho.
        hay = m.any(axis=eje)
        n = np.argmax(m, axis=eje)[hay]
        return n if n.size else np.zeros(1, dtype=int)

    medidas = {
        "izquierda": hasta_dato(datos, 1), "derecha": hasta_dato(datos[:, ::-1], 1),
        "arriba": hasta_dato(datos, 0), "abajo": hasta_dato(datos[::-1, :], 0),
    }
    p95 = {lado: int(np.percentile(v, 95)) for lado, v in medidas.items()}
    maximo = {lado: int(v.max()) for lado, v in medidas.items()}
    return p95, maximo, _r(100.0 * float((~datos).mean()), 3)


def analizarMaster(siril, estrellas=True):
    """Paso 1 lineal: cabecera, escala, estadísticas, saturados, si está lineal, estrellas y bordes sin datos."""
    info = _info(siril)
    k = siril.get_image_keywords()
    cab = {}
    if k:
        for campo in ("object", "filter", "instrume", "telescop", "bayer_pattern", "exposure", "livetime",
                      "stackcnt", "focal_length", "pixel_size_x", "binning_x", "gain", "offset", "ccd_temp",
                      "ra", "dec", "pltsolvd"):
            v = getattr(k, campo, None)
            if v not in (None, "", 0, 0.0):
                cab[campo] = _r(v, 5) if isinstance(v, float) else v
        if getattr(k, "date_obs", None):
            cab["date_obs"] = str(k.date_obs)
    escala = None
    if k and k.focal_length and k.pixel_size_x:
        escala = 206.265 * k.pixel_size_x * max(1, k.binning_x or 1) / k.focal_length
    a = _pixeles(siril, info)
    nombres = CANALES if info["canales"] == 3 else ("K",)
    canales = {}
    for i, n in enumerate(nombres):
        e = _est(a[i])
        e["saturados_pct"] = _r(100.0 * float((a[i] >= 0.999).mean()), 4)
        e["ceros_pct"] = _r(100.0 * float((a[i] <= 0).mean()), 4)
        canales[n] = e
    lum = a.mean(axis=0)
    med = float(np.median(lum))
    bordes, bordes_max, cunas_pct = _zonas_vacias(lum, med)
    # Fondo en una rejilla 3×3 (medianas): primera idea del gradiente, sin interpretar.
    h, w = lum.shape
    rejilla = [[_r(np.median(lum[f * h // 3:(f + 1) * h // 3, c * w // 3:(c + 1) * w // 3]))
                for c in range(3)] for f in range(3)]
    mad = float(np.median(np.abs(lum - med)))
    senal_pct = _r(100.0 * float((lum > med + 5 * 1.4826 * mad).mean()), 2)
    r = {
        "imagen": info, "cabecera": cab,
        "escala_arcsec_px": _r(escala, 3),
        "campo_arcmin": [_r(escala * info["ancho"] / 60, 1), _r(escala * info["alto"] / 60, 1)] if escala else None,
        "lineal": all(c["mediana"] < 0.05 for c in canales.values()),
        "canales": canales,
        "fondo_rejilla_3x3": rejilla,
        "senal_pct": senal_pct,
        "vacio_por_lado_px": bordes,
        "vacio_max_px": bordes_max,
        "cunas_pct": cunas_pct,
    }
    if estrellas:
        r["estrellas"] = _estrellas(siril, escala)
    return r


def _estrellas(siril, escala=None):
    try:
        lista = siril.get_image_stars() or []
    except Exception as e:      # sin estrellas detectables no es un fallo del análisis
        return {"error": str(e)}
    if not lista:
        return {"n": 0}
    fw = np.array([(p.fwhmx + p.fwhmy) / 2 for p in lista if p.fwhmx > 0])
    red = np.array([p.fwhmy / p.fwhmx for p in lista if p.fwhmx > 0])
    br = max(lista, key=lambda p: p.A)
    r = {
        "n": len(lista),
        "fwhm_px_mediana": _r(np.median(fw), 2) if fw.size else None,
        "redondez_mediana": _r(np.median(red), 3) if red.size else None,
        "saturadas": sum(1 for p in lista if p.has_saturated),
        "mas_brillante": {"x": _r(br.xpos, 1), "y": _r(br.ypos, 1), "fwhm_px": _r((br.fwhmx + br.fwhmy) / 2, 2),
                          "saturada": bool(br.has_saturated)},
    }
    if escala and r["fwhm_px_mediana"]:
        r["fwhm_arcsec_mediana"] = _r(r["fwhm_px_mediana"] * escala, 2)
    return r


def estrellas(siril):
    """Detecta estrellas con la configuración actual de Siril: número, FWHM, redondez, saturadas."""
    _hay_imagen(siril)
    k = siril.get_image_keywords()
    escala = (206.265 * k.pixel_size_x * max(1, k.binning_x or 1) / k.focal_length
              if k and k.focal_length and k.pixel_size_x else None)
    return _estrellas(siril, escala)


def medirRendimiento(siril, repeticiones=3, estrellas=False):
    """Tiempos del puente con la imagen cargada: metadatos, estadísticas, píxeles a numpy, previa y estrellas."""
    info = _info(siril)
    rep = max(1, min(10, int(repeticiones)))
    mp = info["ancho"] * info["alto"] / 1e6
    mb = info["ancho"] * info["alto"] * info["canales"] * (4 if info["tipo"] == "float32" else 2) / 2**20

    def medir(fn):
        t = []
        for _ in range(rep):
            t0 = time.perf_counter()
            fn()
            t.append((time.perf_counter() - t0) * 1000)
        return {"ms_mediana": _r(np.median(t), 1), "ms_min": _r(min(t), 1)}

    r = {"imagen": {"mp": _r(mp, 1), "mb": _r(mb, 1), **info}, "repeticiones": rep, "pruebas": {}}
    p = r["pruebas"]
    p["forma"] = medir(siril.get_image_shape)
    p["metadatos"] = medir(lambda: siril.get_image(with_pixels=False))
    p["estadisticas_siril"] = medir(lambda: [siril.get_image_stats(c) for c in range(info["canales"])])
    p["pixeles_numpy"] = medir(siril.get_image_pixeldata)
    p["pixeles_numpy"]["mb_s"] = _r(mb / (p["pixeles_numpy"]["ms_mediana"] / 1000), 0)
    p["previa_8bits"] = medir(lambda: siril.get_image_pixeldata(preview=True))
    a = _pixeles(siril, info)
    p["mediana_numpy"] = medir(lambda: np.median(a[0]))
    if estrellas:
        p["estrellas"] = medir(siril.get_image_stars)
    return r


def registro(siril, lineas=80, filtro=None, solo_errores=False):
    """Últimas líneas del registro (consola) de Siril. Con solo_errores, solo las que parecen errores o avisos."""
    t = siril.get_siril_log() or ""
    ls = [l for l in t.splitlines() if l.strip()]
    if solo_errores:
        claves = ("error", "fail", "fall", "no se", "cannot", "can't", "unable", "warning", "aviso", "traceback",
                  "exception")
        ls = [l for l in ls if any(c in l.lower() for c in claves)]
    if filtro:
        ls = [l for l in ls if str(filtro).lower() in l.lower()]
    n = max(1, min(500, int(lineas)))
    return {"total": len(ls), "lineas": ls[-n:]}


# --- Herramientas: disco -----------------------------------------------------------------------------------

EXT_ABRIR = {".fit", ".fits", ".fts", ".fz", ".tif", ".tiff", ".xisf", ".png", ".jpg", ".jpeg", ".cr2", ".cr3",
             ".nef", ".arw", ".dng", ".raf", ".orf", ".rw2", ".pef", ".ser", ".avi"}


def ruta_legible(p):
    """Para .xisf: FITS propio en ~/.sirilastropilot/xisf (reutilizado si es más nuevo que el XISF), porque Siril 1.4 leyó
    algún XISF desplazado 1440 px (11 nov 2026). Devuelve (ruta a abrir, aviso o None)."""
    p = Path(p)
    if p.suffix.lower() != ".xisf":
        return p, None
    from xisf import xisf_a_fits
    conv = DATOS / "xisf"
    conv.mkdir(parents=True, exist_ok=True)
    dst = conv / (p.stem + ".fit")
    try:
        if dst.exists() and dst.stat().st_mtime >= p.stat().st_mtime:
            fits = dst
        else:
            if dst.exists():
                dst.unlink()
            fits = xisf_a_fits(p, dst)
    except Exception as e:
        return p, f"no se pudo pasar el XISF a FITS ({e}): abierto tal cual"
    if not fits:
        return p, "XISF comprimido o con un formato que no leo: abierto tal cual con Siril"
    return Path(fits), f"XISF leído como FITS propio ({fits}); guarda las versiones en .fit"


# Paso 5 (Rafael, 12 nov 2026): masters abiertos en esta sesión con abrirImagen, para que el gradiente se pare si hay dos
# o más sin alinear. Siril sólo tiene una imagen cargada, así que se recuerdan aquí (sobrevive a la recarga del módulo).
# Clave: ruta en minúsculas; valor: ruta original. Los ficheros con «_alin» (salida de alinearMasters) no cuentan.
MASTERS_ABIERTOS = globals().get("MASTERS_ABIERTOS", {})
GUARDADOS = globals().get("GUARDADOS", set())   # versiones guardadas en esta sesión: al reabrirlas no son otro master


def _es_alineado(nombre):
    return bool(re.search(r"(?i)_alin", str(nombre or "")))


def abrirImagen(siril, fichero):
    """Carga un fichero en Siril (sustituye la imagen cargada). Devuelve sus datos."""
    p = _ruta(fichero)
    if not p.is_file():
        raise FileNotFoundError(f"No existe: {p}")
    if p.suffix.lower() not in EXT_ABRIR:
        raise ValueError(f"Extensión no admitida: {p.suffix}")
    original = p
    p, aviso = ruta_legible(p)
    siril.cmd("load", _arg_cmd(p))
    r = _info(siril)
    if aviso:
        r["aviso"] = aviso
    if (r.get("ancho") or 0) > 1000 and not _es_alineado(original) and str(original).lower() not in GUARDADOS \
            and original.suffix.lower() in (".fit", ".fits", ".fts", ".xisf"):
        MASTERS_ABIERTOS[str(original).lower()] = str(original)
        MASTERS_ABIERTOS[str(p).lower()] = str(original)      # el FITS propio de un XISF es el mismo master
    return r


# extensión -> (comando de Siril, extensiones que puede producir)
GUARDAR = {
    ".fit": ("save", (".fit", ".fits", ".fts")), ".fits": ("save", (".fit", ".fits", ".fts")),
    ".fts": ("save", (".fit", ".fits", ".fts")),
    ".tif": ("savetif", (".tif", ".tiff")), ".tiff": ("savetif", (".tif", ".tiff")),
    ".png": ("savepng", (".png",)), ".jpg": ("savejpg", (".jpg", ".jpeg")), ".jpeg": ("savejpg", (".jpg", ".jpeg")),
}


def guardarImagen(siril, fichero, sobrescribir=False):
    """Guarda la imagen cargada (formato por la extensión). No sobrescribe salvo sobrescribir: true."""
    _hay_imagen(siril)
    p = _ruta(fichero)
    ext = p.suffix.lower()
    if ext == ".xisf":
        raise ValueError("Siril puede abrir XISF pero no guardarlo: usa .fit (32 bits en coma flotante, como el original).")
    if ext not in GUARDAR:
        raise ValueError(f"Extensión no admitida: {ext}. Usa {', '.join(sorted(GUARDAR))}.")
    cmd, posibles = GUARDAR[ext]
    base = p.with_suffix("")
    existentes = [str(base) + e for e in posibles if Path(str(base) + e).exists()]
    if existentes and not sobrescribir:
        raise FileExistsError(f"Ya existe {existentes[0]}. No lo sobrescribo (usa sobrescribir: true).")
    p.parent.mkdir(parents=True, exist_ok=True)
    antes = {e: os.path.getmtime(e) for e in existentes}
    siril.cmd(cmd, _arg_cmd(base))
    hechos = [str(base) + e for e in posibles if Path(str(base) + e).exists()
              and os.path.getmtime(str(base) + e) != antes.get(str(base) + e)]
    if not hechos:
        raise RuntimeError(f"Siril no ha escrito {base}{ext}.")
    GUARDADOS.update(h.lower() for h in hechos)
    return {"fichero": hechos[0], "bytes": os.path.getsize(hechos[0])}


# --- Herramientas: cambian la imagen (con deshacer) --------------------------------------------------------

def deshacer(siril):
    _hay_imagen(siril)
    siril.undo()
    return {"historial": (siril.get_image_history() or [])[-5:]}


def rehacer(siril):
    _hay_imagen(siril)
    siril.redo()
    return {"historial": (siril.get_image_history() or [])[-5:]}


# Comandos de Siril de procesado de la imagen cargada. Nada que cargue, guarde, cambie de carpeta,
# ejecute scripts o toque preferencias (load, save*, cd, pyscript, script, set*, requires, exit...).
COMANDOS = {
    # estirados y curvas
    "asinh", "autostretch", "ght", "invght", "modasinh", "invmodasinh", "linstretch", "mtf", "invmtf", "autoghs",
    "clahe", "satu", "neg", "offset",
    # fondo, color y calibración
    "subsky", "rmgreen", "ccm", "pcc", "spcc", "platesolve", "linear_match", "fixbanding",
    # ruido, nitidez, deconvolución, estrellas
    "denoise", "fmedian", "gauss", "epf", "unsharp", "wiener", "rl", "sb", "starnet", "synthstar", "unclipstars",
    "findstar",
    # geometría
    "crop", "binxy", "resample", "rotate", "rotatepi", "mirrorx", "mirrory",
    # medidas (solo escriben en el registro)
    "stat", "bgnoise", "bg",
}
_ARG_OK = re.compile(r"^[A-Za-z0-9_.,:=+\-]+$")


def comandoSiril(siril, comando, args=None):
    """Ejecuta un comando de procesado de Siril de la lista blanca sobre la imagen cargada (con deshacer)."""
    c = str(comando).strip().lower()
    if c not in COMANDOS:
        raise ValueError(f"Comando no permitido: {comando}. Permitidos: {', '.join(sorted(COMANDOS))}.")
    _hay_imagen(siril)
    args = [str(a) for a in (args or [])]
    for a in args:
        if not _ARG_OK.match(a):
            raise ValueError(f"Argumento no permitido: {a!r} (solo letras, números y _ . , : = + -).")
    t0 = time.perf_counter()
    try:
        siril.cmd(c, *args)
    except Exception as e:
        ayuda = {"crop": "sintaxis: crop x y ancho alto (cuatro números posicionales, en píxeles, esquina superior izquierda; "
                         "sin -x= ni -w=). Para quitar cuñas sin datos usa recortarBordes; con varios masters, alinearMasters "
                         "ya los deja recortados al mismo marco."}.get(c)
        raise RuntimeError(f"{e}" + (f" — {ayuda}" if ayuda else "")) from None
    return {"comando": " ".join([c, *args]), "ms": _r((time.perf_counter() - t0) * 1000, 0),
            "imagen": _info(siril)}


# --- Lista blanca ------------------------------------------------------------------------------------------

LISTA = {
    "ping": ping,
    "imagen": imagen,
    "estadisticas": estadisticas,
    "previa": previa,
    "analizarMaster": analizarMaster,
    "estrellas": estrellas,
    "medirRendimiento": medirRendimiento,
    "registro": registro,
    "abrirImagen": abrirImagen,
    "guardarImagen": guardarImagen,
    "deshacer": deshacer,
    "rehacer": rehacer,
    "comandoSiril": comandoSiril,
}

# Herramientas compuestas por paso de la guía (pasos.py).
from pasos import LISTA_PASOS  # noqa: E402
LISTA.update(LISTA_PASOS)

# Consultas a internet (web.py): se niegan si la casilla «Internet» del chat está desmarcada.
from web import LISTA_WEB  # noqa: E402
LISTA.update(LISTA_WEB)

# Preprocesado y apilado (apilado.py).
from apilado import LISTA_APILADO  # noqa: E402
LISTA.update(LISTA_APILADO)

# Varios masters: alinear, separar el dual band y combinar con el RGB (multicapa.py).
from multicapa import LISTA_MULTICAPA  # noqa: E402
LISTA.update(LISTA_MULTICAPA)

# Núcleo de galaxias (nucleo.py): comprimir el bulbo tras estirar, antes de saturar.
from nucleo import LISTA_NUCLEO  # noqa: E402
LISTA.update(LISTA_NUCLEO)
