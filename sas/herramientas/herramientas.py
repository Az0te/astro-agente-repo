# SetiAstroPilot — herramientas de la lista blanca para Seti Astro Suite Pro (SASpro).
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# Cada herramienta es una función f(ctx, **args) que devuelve algo serializable a JSON. ctx es el ScriptContext de
# SASpro (setiastro/saspro/ops/scripts.py). El puente (sas/puente/puente.py) solo ejecuta las que están en LISTA y
# siempre desde el hilo de la interfaz de SASpro, una detrás de otra.
#
# Convenciones (las mismas que en Siril y PixInsight):
# - Valores de píxel 0–1. En SASpro la imagen de un documento ya es float32 0–1, forma (alto, ancho) o (alto, ancho, 3).
# - Coordenadas como en pantalla: (0, 0) arriba a la izquierda; rect = [x0, y0, x1, y1], x1 e y1 excluidos.
# - SASpro tiene varias vistas abiertas (como PixInsight): casi todas las herramientas llevan 'vista' (nombre, título
#   de la ventana o uid). Sin 'vista' se usa la vista activa.
# - Todo lo que cambia una vista lo hace con deshacer de SASpro (doc.apply_edit / ctx.run_command).

import json
import os
import re
import sys
import time
from pathlib import Path

import numpy as np

import medidas as M
from medidas import _r

VERSION = "0.1.0"
DATOS = Path.home() / ".setiastropilot"
PREVIAS = DATOS / "previas"
TRABAJO = DATOS / "trabajo"
CONFIG = DATOS / "config.json"


# --- Utilidades --------------------------------------------------------------------------------------------

def _config():
    try:
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _base(doc):
    """Documento base (nunca el envoltorio de una previsualización ROI)."""
    for attr in ("_base", "_parent_doc"):
        d = getattr(doc, attr, None)
        if d is not None:
            doc = d
    return doc


def _activo(ctx):
    """Documento activo. En SASpro 1.24.2 ctx.base_document() falla (llama a active_document con un
    argumento que no acepta), así que cada intento va por separado y, si no hay ventana activa, se usa
    la única vista abierta."""
    for f in ("base_document", "active_document"):
        try:
            d = getattr(ctx, f)()
        except Exception:
            d = None
        if d is not None:
            return d
    docs = _docs(ctx)
    return docs[0] if len(docs) == 1 else None


def _doc(ctx, vista=None):
    if vista:
        d = ctx.get_document(str(vista))
        if d is None:
            d = ctx.get_document_by_view_name(str(vista))
        if d is None:
            nombres = ", ".join(_nombre(x) for x in _docs(ctx)) or "ninguna"
            raise RuntimeError(f"No hay ninguna vista '{vista}'. Abiertas: {nombres}.")
    else:
        d = _activo(ctx)
        if d is None:
            if _docs(ctx):
                raise RuntimeError("Hay varias vistas abiertas y ninguna activa: indica 'vista'.")
            raise RuntimeError("No hay ninguna imagen abierta en SASpro. Usa abrirImagen.")
    d = _base(d)
    if getattr(d, "image", None) is None:
        raise RuntimeError(f"La vista '{_nombre(d)}' no tiene imagen.")
    return d


def _docs(ctx):
    dm = getattr(ctx.app, "doc_manager", None)
    if dm is not None and hasattr(dm, "all_documents"):
        return [d for d in dm.all_documents() if getattr(d, "image", None) is not None]
    vistos, r = set(), []
    for v in ctx.list_views():
        d = ctx.get_document(v.get("uid") or v.get("name"))
        if d is not None and id(d) not in vistos:
            vistos.add(id(d))
            r.append(d)
    return r


def _nombre(doc):
    try:
        return str(doc.display_name())
    except Exception:
        return str(getattr(doc, "metadata", {}).get("display_name", "") or "sin nombre")


def _meta(doc):
    return getattr(doc, "metadata", None) or {}


def _p(img):
    """Imagen de SASpro -> float32 (canales, alto, ancho)."""
    a = np.asarray(img, dtype=np.float32)
    if a.ndim == 2:
        return a[np.newaxis, :, :]
    if a.ndim == 3 and a.shape[2] in (1, 3, 4):
        return np.moveaxis(a[:, :, :3] if a.shape[2] == 4 else a, -1, 0)
    raise ValueError(f"Forma de imagen no esperada: {a.shape}")


def _a_sas(p, como):
    """(canales, alto, ancho) -> forma de SASpro como la del array 'como'."""
    p = np.asarray(p, dtype=np.float32)
    if np.ndim(como) == 2:
        return np.ascontiguousarray(p[0])
    return np.ascontiguousarray(np.moveaxis(p, 0, -1))


def _info(doc):
    img = doc.image
    h, w = img.shape[:2]
    c = 1 if img.ndim == 2 else img.shape[2]
    m = _meta(doc)
    return {"vista": _nombre(doc), "uid": getattr(doc, "uid", None), "ancho": int(w), "alto": int(h),
            "canales": int(c), "fichero": m.get("file_path") or None, "bit_depth": m.get("bit_depth"),
            "deshacer": _n_deshacer(doc), "ultimo_paso": _ultimo_paso(doc)}


def _n_deshacer(doc):
    try:
        return len(doc._undo)
    except Exception:
        return None


def _ultimo_paso(doc):
    try:
        return doc.last_undo_name()
    except Exception:
        return None


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


def _ruta(ruta, campo="fichero"):
    if not ruta or not isinstance(ruta, str):
        raise ValueError(f"Falta {campo} (ruta absoluta).")
    p = Path(os.path.expanduser(ruta))
    if not p.is_absolute():
        raise ValueError(f"{campo} debe ser una ruta absoluta: {ruta}")
    return p


def _nombres_canales(p):
    return M.CANALES if p.shape[0] == 3 else ("K",)


def _cabecera(doc):
    """Palabras clave útiles de la cabecera FITS/XISF original (si la hay)."""
    m = _meta(doc)
    h = m.get("original_header") or m.get("fits_header")
    if h is None:
        return {}
    r = {}
    for k in ("OBJECT", "FILTER", "INSTRUME", "TELESCOP", "BAYERPAT", "EXPTIME", "EXPOSURE", "LIVETIME", "STACKCNT",
              "NCOMBINE", "FOCALLEN", "XPIXSZ", "PIXSIZE", "XBINNING", "GAIN", "OFFSET", "CCD-TEMP", "DATE-OBS",
              "RA", "DEC", "OBJCTRA", "OBJCTDEC", "CRVAL1", "CRVAL2", "CDELT1", "PLTSOLVD"):
        try:
            v = h.get(k) if hasattr(h, "get") else None
        except Exception:
            v = None
        if v not in (None, ""):
            r[k] = _r(v, 6) if isinstance(v, float) else v if isinstance(v, (int, bool)) else str(v)
    return r


def _escala(cab):
    try:
        f, px = float(cab.get("FOCALLEN") or 0), float(cab.get("XPIXSZ") or cab.get("PIXSIZE") or 0)
        b = int(cab.get("XBINNING") or 1)
        if f > 0 and px > 0:
            return 206.265 * px * max(1, b) / f
    except (TypeError, ValueError):
        pass
    try:
        d = abs(float(cab.get("CDELT1") or 0))
        return d * 3600 if d > 0 else None
    except (TypeError, ValueError):
        return None


def _tiene_wcs(doc):
    m = _meta(doc)
    if m.get("wcs") is not None or m.get("wcs_header") is not None:
        return True
    h = m.get("original_header")
    try:
        return bool(h is not None and h.get("CTYPE1"))
    except Exception:
        return False


def _jpg(p, ruta, calidad=90, lado=None):
    """(canales, alto, ancho) 0–1 -> JPG. PIL (va con SASpro) o, si no está, QImage.
    Con lado, el lado largo queda exactamente en 'lado' px si la imagen es mayor (remuestreo de calidad)."""
    a = (np.clip(p, 0, 1) * 255 + 0.5).astype(np.uint8)
    a = np.ascontiguousarray(a[0] if a.shape[0] == 1 else np.moveaxis(a, 0, -1))
    h, w = a.shape[:2]
    nuevo = None
    if lado and max(h, w) > int(lado):
        f = int(lado) / max(h, w)
        nuevo = (max(1, round(w * f)), max(1, round(h * f)))
    try:
        from PIL import Image
        im = Image.fromarray(a)
        if nuevo:
            im = im.resize(nuevo, Image.LANCZOS)
        im.save(ruta, "JPEG", quality=calidad)
    except ImportError:
        from PyQt6.QtCore import Qt
        from PyQt6.QtGui import QImage
        fmt = QImage.Format.Format_Grayscale8 if a.ndim == 2 else QImage.Format.Format_RGB888
        qi = QImage(a.data, w, h, a.strides[0], fmt)
        if nuevo:
            qi = qi.scaled(nuevo[0], nuevo[1], Qt.AspectRatioMode.IgnoreAspectRatio, Qt.TransformationMode.SmoothTransformation)
        qi.save(str(ruta), "JPG", calidad)
    return str(ruta)


def _reducir(p, lado):
    """Promedia bloques enteros sin bajar de 'lado' en el lado largo (el ajuste fino lo hace _jpg)."""
    paso = max(1, int(max(p.shape[1], p.shape[2]) // max(64, int(lado))))
    if paso == 1:
        return p
    h, w = p.shape[1] // paso * paso, p.shape[2] // paso * paso
    return p[:, :h, :w].reshape(p.shape[0], h // paso, paso, w // paso, paso).mean(axis=(2, 4))


def _seguro(nombre):
    return re.sub(r"[^\w\-.]+", "_", nombre).strip("_") or "imagen"


# --- Herramientas: lectura ---------------------------------------------------------------------------------

def _version_sas():
    """Versión de SASpro. El instalador de Windows deja los metadatos del paquete Python atrasados (1.23.2 en una
    1.24.2.post2), así que primero se mira el registro de desinstalación y luego el paquete."""
    try:
        from setiastro.saspro import __version__ as v
        return str(v)
    except Exception:
        pass
    if sys.platform == "win32":
        try:
            import winreg
            for raiz in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
                for ruta in (r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
                             r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"):
                    try:
                        k = winreg.OpenKey(raiz, ruta)
                    except OSError:
                        continue
                    for i in range(winreg.QueryInfoKey(k)[0]):
                        try:
                            sk = winreg.OpenKey(k, winreg.EnumKey(k, i))
                            nombre = str(winreg.QueryValueEx(sk, "DisplayName")[0])
                            if "setiastro" in nombre.lower().replace(" ", ""):
                                return str(winreg.QueryValueEx(sk, "DisplayVersion")[0])
                        except OSError:
                            continue
        except Exception:
            pass
    try:
        from importlib.metadata import version
        return version("setiastrosuitepro")
    except Exception:
        return None


def ping(ctx):
    """Comprueba que el puente y SASpro responden."""
    v_sas = _version_sas()
    d = _activo(ctx)
    act = _nombre(_base(d)) if d is not None else None
    return {"herramientas": VERSION, "saspro": v_sas, "vistas_abiertas": len(_docs(ctx)), "vista_activa": act}


def vistas(ctx):
    """Vistas abiertas en SASpro: nombre, uid, tamaño, canales, fichero, pasos de deshacer, si está activa."""
    d = _activo(ctx)
    activa = _base(d) if d is not None else None
    r = []
    for d in _docs(ctx):
        i = _info(d)
        i["activa"] = d is activa
        r.append(i)
    return r


def imagen(ctx, vista=None):
    """Datos de una vista: tamaño, canales, fichero, cabecera útil, astrometría y últimos pasos."""
    d = _doc(ctx, vista)
    i = _info(d)
    i["cabecera"] = _cabecera(d)
    i["astrometria"] = _tiene_wcs(d)
    try:
        i["historial"] = [x[2] for x in d._undo][-10:]
    except Exception:
        pass
    return i


def estadisticas(ctx, vista=None, rect=None, bordes=None):
    """Mediana, MAD, media, mín. y máx. por canal (0–1). Con bordes, franjas de borde frente al centro."""
    d = _doc(ctx, vista)
    p = _p(d.image)
    _, h, w = p.shape
    x0, y0, x1, y1 = _rect(rect, w, h)
    sub = p[:, y0:y1, x0:x1]
    r = {"vista": _nombre(d), "rect": [x0, y0, x1, y1],
         "canales": {n: M.est(sub[i]) for i, n in enumerate(_nombres_canales(p))}}
    if bordes:
        b = int(bordes)
        if b < 2 or 2 * b >= min(x1 - x0, y1 - y0):
            raise ValueError("bordes debe ser > 1 y menor que la mitad del lado menor.")
        zonas = {
            "izquierda": sub[:, :, :b], "derecha": sub[:, :, -b:], "arriba": sub[:, :b, :], "abajo": sub[:, -b:, :],
            "centro": sub[:, (y1 - y0) // 2 - b // 2:(y1 - y0) // 2 + b // 2 + 1,
                             (x1 - x0) // 2 - b // 2:(x1 - x0) // 2 + b // 2 + 1],
        }
        med = {z: [float(np.median(v[i])) for i in range(v.shape[0])] for z, v in zonas.items()}
        r["bordes"] = {z: [_r(m) for m in med[z]] for z in zonas}
        r["caida_vs_centro"] = {z: [_r(m - c) for m, c in zip(med[z], med["centro"])]
                                for z in ("izquierda", "derecha", "arriba", "abajo")}
    return r


def previa(ctx, vista=None, lado=1600, rect=None, enlazado=None, fichero=None, candidato=None):
    """JPG para ver la imagen sin tocarla: autoestirado (STF) si es lineal, tal cual si ya está estirada.
    enlazado: por defecto por canal si es lineal (un master sin calibrar sale con dominante con el estirado enlazado).
    Con candidato=<id>, la previa del candidato de la última comparación en vez de la vista."""
    if candidato:
        p = _p(_cargar_candidato(candidato)[0])
        base = f"candidato_{candidato}"
    else:
        d = _doc(ctx, vista)
        p = _p(d.image)
        base = _seguro(_nombre(d))
    _, h, w = p.shape
    x0, y0, x1, y1 = _rect(rect, w, h)
    q = p[:, y0:y1, x0:x1]
    q = _reducir(q, lado)
    lin = M.lineal(p[:, ::8, ::8])
    if enlazado is None:
        enlazado = not lin
    if lin:
        q = M.autoestirar(q, enlazado=bool(enlazado))
    PREVIAS.mkdir(parents=True, exist_ok=True)
    ruta = _ruta(fichero) if fichero else PREVIAS / (f"{base}_{x0}_{y0}.jpg" if rect else f"{base}.jpg")
    _jpg(q, ruta, lado=lado)
    hq, wq = int(q.shape[1]), int(q.shape[2])
    if max(hq, wq) > int(lado):
        f = int(lado) / max(hq, wq)
        hq, wq = max(1, round(hq * f)), max(1, round(wq * f))
    return {"fichero": str(ruta), "ancho": wq, "alto": hq, "lineal": bool(lin),
            "autoestirado": bool(lin), "enlazado": bool(enlazado), "escala": _r(wq / (x1 - x0), 3),
            "rect": [x0, y0, x1, y1] if rect else None}


def analizarMaster(ctx, vista=None):
    """Paso 1 lineal: cabecera, escala, estadísticas, saturados, si está lineal, fondo 3×3 y bordes sin datos."""
    d = _doc(ctx, vista)
    p = _p(d.image)
    cab = _cabecera(d)
    escala = _escala(cab)
    canales = {}
    for i, n in enumerate(_nombres_canales(p)):
        e = M.est(p[i])
        e["saturados_pct"] = _r(100.0 * float((p[i] >= 0.999).mean()), 4)
        e["ceros_pct"] = _r(100.0 * float((p[i] <= 0).mean()), 4)
        canales[n] = e
    L = M.lum(p)
    med = float(np.median(L))
    bordes, bordes_max, cunas = M.zonas_vacias(L, med)
    h, w = L.shape
    rejilla = [[_r(np.median(L[f * h // 3:(f + 1) * h // 3, c * w // 3:(c + 1) * w // 3]))
                for c in range(3)] for f in range(3)]
    mad = float(np.median(np.abs(L - med)))
    return {
        "imagen": _info(d), "cabecera": cab,
        "escala_arcsec_px": _r(escala, 3),
        "campo_arcmin": [_r(escala * w / 60, 1), _r(escala * h / 60, 1)] if escala else None,
        "astrometria": _tiene_wcs(d),
        "lineal": all(c["mediana"] < 0.05 for c in canales.values()),
        "canales": canales,
        "fondo_rejilla_3x3": rejilla,
        "senal_pct": _r(100.0 * float((L > med + 5 * 1.4826 * mad).mean()), 2),
        "vacio_por_lado_px": bordes, "vacio_max_px": bordes_max, "cunas_pct": cunas,
    }


def registro(ctx, n=40, solo_errores=False, filtro=None):
    """Últimas líneas de la consola de SASpro (si la ventana las expone)."""
    texto = ""
    for attr in ("console", "log_widget", "_console", "_log_widget", "log_view"):
        w = getattr(ctx.app, attr, None)
        if w is not None:
            for m in ("toPlainText", "text"):
                f = getattr(w, m, None)
                if callable(f):
                    try:
                        texto = f()
                        break
                    except Exception:
                        pass
        if texto:
            break
    if not texto:
        return {"lineas": [], "aviso": "No he encontrado la consola de SASpro en esta versión."}
    ls = [l for l in texto.splitlines() if l.strip()]
    if solo_errores:
        ls = [l for l in ls if re.search(r"(?i)error|fail|warn|aviso|traceback|exception", l)]
    if filtro:
        ls = [l for l in ls if str(filtro).lower() in l.lower()]
    return {"lineas": ls[-max(1, min(500, int(n))):]}


# --- Herramientas: disco -----------------------------------------------------------------------------------

def abrirImagen(ctx, fichero):
    """Abre un fichero (FITS, XISF, TIFF…) en una vista nueva de SASpro y la deja activa."""
    p = _ruta(fichero)
    if not p.exists():
        raise FileNotFoundError(f"No existe {p}")
    dm = getattr(ctx.app, "doc_manager", None)
    if dm is None:
        raise RuntimeError("SASpro no expone doc_manager.")
    doc = dm.open_path(str(p))
    if doc is None:
        raise RuntimeError(f"SASpro no ha podido abrir {p}")
    try:
        ctx.activate_view(getattr(doc, "uid", None) or _nombre(doc))
    except Exception:
        pass
    return _info(_base(doc))


_FORMATOS = {".fit": "fits", ".fits": "fits", ".fts": "fits", ".tif": "tif", ".tiff": "tif", ".png": "png",
             ".jpg": "jpg", ".jpeg": "jpg", ".xisf": "xisf"}


def _libre(p: Path) -> Path:
    if not p.exists():
        return p
    n = 2
    while True:
        q = p.with_name(f"{p.stem}_{n}{p.suffix}")
        if not q.exists():
            return q
        n += 1


_CLAVES_WCS = ("CTYPE1", "CTYPE2", "CRVAL1", "CRVAL2", "CRPIX1", "CRPIX2", "CD1_1", "CD1_2", "CD2_1", "CD2_2",
               "CDELT1", "CDELT2", "PC1_1", "PC1_2", "PC2_1", "PC2_2", "A_ORDER", "B_ORDER")


def cabecera(ctx, vista=None, todas=False):
    """Metadatos de una vista: claves de metadata, palabras clave de la cabecera (todas o las principales) y si tiene
    astrometría (y de dónde sale). Solo lectura."""
    d = _doc(ctx, vista)
    m = _meta(d)
    h = m.get("original_header") or m.get("fits_header")
    claves = []
    try:
        claves = list(h.keys()) if h is not None else []
    except Exception:
        pass
    r = {"vista": _nombre(d), "metadata": sorted(str(k) for k in m.keys()), "n_palabras": len(claves),
         "wcs_en_cabecera": [k for k in _CLAVES_WCS if k in claves],
         "wcs_en_metadata": [k for k in ("wcs", "wcs_header", "original_wcs", "sip_wcs") if m.get(k) is not None],
         "astrometria": _tiene_wcs(d), "principales": _cabecera(d)}
    if todas and h is not None:
        r["cabecera"] = {k: _r(h.get(k), 6) if isinstance(h.get(k), float) else str(h.get(k)) for k in claves[:400]}
    return r


def guardarImagen(ctx, fichero, vista=None, sobrescribir=False, bits=None):
    """Guarda una vista (formato por la extensión: .fits, .xisf, .tif, .png, .jpg). No sobrescribe salvo
    sobrescribir: true. bits: '16-bit', '32-bit floating point'… (por defecto 32 bits flotante en FITS/XISF/TIFF)."""
    d = _doc(ctx, vista)
    p = _ruta(fichero)
    fmt = _FORMATOS.get(p.suffix.lower())
    if not fmt:
        raise ValueError(f"Extensión no admitida: {p.suffix}. Usa una de {', '.join(sorted(_FORMATOS))}.")
    if p.exists() and not sobrescribir:
        raise FileExistsError(f"{p} ya existe. Usa otro nombre (v1, v2…) o sobrescribir: true.")
    p.parent.mkdir(parents=True, exist_ok=True)
    if bits is None:
        bits = "8-bit" if fmt in ("jpg",) else "16-bit" if fmt == "png" else "32-bit floating point"
    m = _meta(d)
    img = d.image
    cab = _cabecera_para_guardar(m)
    # En SASpro la cabecera está en metadata["fits_header"] (no en "original_header") y la astrometría en "wcs_header".
    # Antes se pasaba original_header (None) y el fichero salía con 7 palabras clave: sin OBJECT, exposición ni WCS
    # (M31, 13 nov 2026). image_meta no se pasa en XISF: con ella SASpro copia las palabras de la XISF original y
    # descarta la solución astrométrica; sin ella las escribe desde la cabecera, WCS incluido.
    ctx.save_image(img, str(p), original_format=fmt, bit_depth=bits, original_header=cab,
                   is_mono=(np.ndim(img) == 2), image_meta=None if fmt == "xisf" else m.get("xisf_meta"),
                   file_meta=m.get("file_meta"))
    if not p.exists():
        raise RuntimeError(f"SASpro no ha escrito {p}.")
    return {"fichero": str(p), "formato": fmt, "bits": bits, "bytes": p.stat().st_size, "vista": _nombre(d),
            "palabras_cabecera": len(cab) if cab is not None else 0,
            "astrometria_guardada": bool(cab is not None and "CTYPE1" in cab)}


def _cabecera_para_guardar(m):
    """Cabecera FITS de la vista (fits_header u original_header) con la astrometría de wcs_header encima, sin tocar el
    original. None si no hay cabecera."""
    h = m.get("original_header") or m.get("fits_header")
    if h is None:
        return None
    try:
        h = h.copy()
    except Exception:
        return h
    w = m.get("wcs_header")
    if w is not None:
        try:
            for k in w.keys():
                if k in ("SIMPLE", "BITPIX", "NAXIS", "NAXIS1", "NAXIS2", "NAXIS3", "EXTEND", "COMMENT", "HISTORY", ""):
                    continue
                h[k] = w[k]
        except Exception:
            pass
    return h


def exportarFinal(ctx, carpeta=None, nombre=None, vista=None):
    """Entrega: TIFF de 16 bits + JPG calidad 95 como <nombre>_final, sin sobrescribir (_2, _3…)."""
    d = _doc(ctx, vista)
    if M.lineal(_p(d.image)[:, ::8, ::8]):
        raise RuntimeError("La imagen parece lineal (mediana < 0,05): estírala antes de exportar.")
    fich = _meta(d).get("file_path")
    c = _ruta(carpeta, "carpeta") if carpeta else (Path(fich).parent if fich else DATOS / "exportado")
    base = _seguro(nombre or Path(fich or _nombre(d)).stem) + "_final"
    tif, jpg = _libre(c / f"{base}.tif"), _libre(c / f"{base}.jpg")
    r1 = guardarImagen(ctx, str(tif), vista=vista, bits="16-bit")
    p = _p(d.image)
    c.mkdir(parents=True, exist_ok=True)
    _jpg(p, jpg, calidad=95)
    return {"tif": r1["fichero"], "jpg": str(jpg), "vista": _nombre(d)}


# --- Herramientas: vista (deshacer, procesos de SASpro) ----------------------------------------------------

def deshacer(ctx, vista=None):
    """Deshace el último paso de la vista."""
    d = _doc(ctx, vista)
    if not d.can_undo():
        raise RuntimeError("No hay nada que deshacer en esta vista.")
    paso = d.undo()
    return {"deshecho": paso, "vista": _nombre(d), "quedan": _n_deshacer(d)}


def rehacer(ctx, vista=None):
    """Rehace el último paso deshecho de la vista."""
    d = _doc(ctx, vista)
    if not d.can_redo():
        raise RuntimeError("No hay nada que rehacer en esta vista.")
    paso = d.redo()
    return {"rehecho": paso, "vista": _nombre(d)}


def duplicarVista(ctx, vista=None, nombre=None):
    """Copia una vista en otra nueva (para probar a mano o guardar una versión intermedia)."""
    d = _doc(ctx, vista)
    nombre = nombre or f"{_nombre(d)}_copia"
    m = dict(_meta(d))
    m.pop("file_path", None)
    m["display_name"] = nombre          # si no, la copia hereda el nombre de la original
    nuevo = ctx.open_new_document(np.array(d.image, copy=True), metadata=m, name=nombre)
    return _info(_base(nuevo)) if nuevo is not None else {"vista": nombre}


# Comandos de SASpro (ops/commands.py) que se pueden lanzar con procesoSAS. Fuera: function_bundle/bundle (cadenas de
# código libre), export_fits (escribe en disco: va por guardarImagen) y los que solo tienen interfaz.
PROCESOS = {
    "abe", "graxpert", "srgc", "background_neutral", "white_balance", "remove_green", "linear_fit",
    "stat_stretch", "star_stretch", "ghs", "curves", "wavescale_hdr", "wavescale_dark_enhance",
    "cosmic_clarity", "convo", "aberration_ai", "syqon_prism", "syqon_starless", "remove_stars", "morphology",
    "extract_luminance", "recombine_luminance", "nbextract", "plate_solve", "debayer",
    "geom_flip_horizontal", "geom_flip_vertical", "geom_rotate_clockwise", "geom_rotate_counterclockwise",
    "geom_rotate_180", "geom_rescale", "geom_invert",
}


def _correr(ctx, doc, proceso, preset=None):
    try:
        from setiastro.saspro.ops.commands import normalize_cid
        cid = normalize_cid(proceso)
    except Exception:
        cid = str(proceso)
    if cid not in PROCESOS:
        raise ValueError(f"Proceso no permitido: {proceso}. Permitidos: {', '.join(sorted(PROCESOS))}.")
    _comprobar_ia(cid, preset)
    return ctx.run_command(cid, dict(preset or {}), target_doc=doc)


# Procesos de SASpro que necesitan el entorno de IA (PyTorch en %LOCALAPPDATA%\SASpro\runtime\...\venv).
PROCESOS_IA = {"cosmic_clarity", "aberration_ai", "syqon_prism", "syqon_starless"}


def _comprobar_ia(proceso, preset=None):
    """Sin PyTorch en el entorno de IA de SASpro, Cosmic Clarity y compañía no terminan nunca en modo sin ventana (SASpro
    1.24.2 solo lo dice en el System Log). Si torch se instaló después de arrancar SASpro, tampoco lo ve hasta reiniciar."""
    if proceso == "remove_stars" and (preset or {}).get("tool") != "darkstar":
        return
    if proceso not in PROCESOS_IA and proceso != "remove_stars":
        return
    base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "SASpro" / "runtime"
    if not base.is_dir():
        return                                      # otra plataforma o instalación: no se puede comprobar
    torch = sorted(base.glob("*/venv/Lib/site-packages/torch")) or sorted(base.glob("*/venv/lib/python*/site-packages/torch"))
    if not torch:
        raise RuntimeError(f"{proceso} necesita la aceleración de SASpro (PyTorch) y no está instalada: SASpro > "
                           "Configuración > Preferencias > instalar GPU Acceleration, reiniciar SASpro y volver a "
                           "lanzar el puente.")
    try:
        inicio = json.loads((DATOS / "puente.json").read_text(encoding="utf-8")).get("inicio")
        t_inicio = time.mktime(time.strptime(inicio, "%Y-%m-%dT%H:%M:%S")) if inicio else None
    except Exception:
        t_inicio = None
    if t_inicio and torch[-1].stat().st_mtime > t_inicio + 60:
        raise RuntimeError(f"PyTorch se instaló después de arrancar SASpro y {proceso} no lo verá: reinicia SASpro y "
                           "vuelve a lanzar el puente (Scripts > AstroPilot).")


def procesoSAS(ctx, proceso, preset=None, vista=None):
    """Lanza un proceso de SASpro de la lista blanca sobre una vista, con su preset (ver ayudaProceso). Con deshacer."""
    d = _doc(ctx, vista)
    n0, h0 = _n_deshacer(d), M.huella(d.image)
    t0 = time.perf_counter()
    _correr(ctx, d, proceso, preset)
    cambio = M.huella(d.image) != h0
    r = {"proceso": proceso, "vista": _nombre(d), "segundos": _r(time.perf_counter() - t0, 1), "cambio": cambio,
         "paso": _ultimo_paso(d) if _n_deshacer(d) != n0 else None}
    if not cambio and proceso not in ("plate_solve",):
        r["aviso"] = "La imagen no ha cambiado: revisa el preset o el registro."
    return r


def ayudaProceso(ctx, proceso=None):
    """Lista los procesos permitidos o, con proceso, sus parámetros de preset (tipo, defecto, mín., máx., valores)."""
    from setiastro.saspro.ops.commands import get_spec, normalize_cid
    if not proceso:
        r = {}
        for cid in sorted(PROCESOS):
            s = get_spec(cid)
            if s is not None:
                r[cid] = {"nombre": s.name, "grupo": s.group, "lineal": s.supports_linear,
                          "no_lineal": s.supports_nonlinear, "mono": s.supports_mono}
        return r
    s = get_spec(normalize_cid(proceso))
    if s is None or s.id not in PROCESOS:
        raise ValueError(f"Proceso desconocido o no permitido: {proceso}")
    return {"id": s.id, "nombre": s.name, "notas": s.notes,
            "preset": [{"clave": p.key, "tipo": p.type, "defecto": p.default, "min": p.min, "max": p.max,
                        "valores": p.enum, "descripcion": p.desc} for p in s.presets],
            "ejemplos": s.examples[:3]}


# --- Comparar candidatos ------------------------------------------------------------------------------------
# A diferencia de Siril, en SASpro cada candidato se hace sobre la propia vista con su proceso, se copia el resultado
# y se deshace. La vista queda como estaba (se comprueba con la huella) y aplicarCandidato pone exactamente el array
# medido, con un paso de deshacer.

def _probar(ctx, doc, proceso, preset):
    """Lanza un proceso, devuelve el resultado (copia) y deja la vista como estaba."""
    h0, n0, img0 = M.huella(doc.image), _n_deshacer(doc), doc.image
    _correr(ctx, doc, proceso, preset)
    if M.huella(doc.image) == h0:
        raise RuntimeError(f"{proceso} no ha cambiado la imagen (¿falta el programa externo o el modelo?).")
    res = np.array(doc.image, dtype=np.float32, copy=True)
    _volver(doc, h0, n0, img0)
    return res


def _volver(doc, h0, n0, img0):
    n1 = _n_deshacer(doc)
    if n0 is not None and n1 is not None and n1 > n0:
        for _ in range(n1 - n0):
            doc.undo()
        _vaciar_rehacer(doc)      # que «rehacer» no traiga un candidato descartado
    if M.huella(doc.image) != h0:
        doc.apply_edit(np.array(img0, copy=True), metadata={}, step_name="SetiAstroPilot: restaurar")
    if M.huella(doc.image) != h0:
        raise RuntimeError("La vista no ha vuelto a como estaba tras la comparación: revisa el historial de deshacer.")


def _vaciar_rehacer(doc):
    """Vacía la pila de rehacer como lo hace ImageDocument.apply_edit: en SASpro cada estado es un fichero de
    intercambio (swap) que hay que soltar y borrar; en el SASpro falso son arrays."""
    pila = getattr(doc, "_redo", None)
    if not pila:
        return
    try:
        from setiastro.saspro.swap_manager import get_swap_manager
        sm = get_swap_manager()
    except Exception:
        sm = None
    for item in list(pila):
        sid = item[0] if isinstance(item, tuple) and item and isinstance(item[0], str) else None
        if sm is not None and sid is not None:
            for f in ("unpin_state", "delete_state"):
                try:
                    getattr(sm, f)(sid)
                except Exception:
                    pass
    pila.clear()


def _limpiar_grupo(grupo):
    TRABAJO.mkdir(parents=True, exist_ok=True)
    for f in TRABAJO.glob(f"{grupo}_*"):
        try:
            f.unlink()
        except OSError:
            pass


def _guardar_candidato(grupo, n, a, datos):
    TRABAJO.mkdir(parents=True, exist_ok=True)
    cid = f"{grupo}_{n}"
    np.save(TRABAJO / f"{cid}.npy", a)
    (TRABAJO / f"{cid}.json").write_text(json.dumps(datos, ensure_ascii=False, default=str), encoding="utf-8")
    return cid


def _cargar_candidato(cid):
    cid = str(cid)
    if not re.fullmatch(r"[A-Za-z0-9_]+", cid):
        raise ValueError("id no válido.")
    fj, fn = TRABAJO / f"{cid}.json", TRABAJO / f"{cid}.npy"
    if not fj.exists() or not fn.exists():
        disp = sorted(f.stem for f in TRABAJO.glob("*.npy")) if TRABAJO.exists() else []
        raise FileNotFoundError(f"No hay candidato {cid}. Disponibles: {', '.join(disp) or 'ninguno'}.")
    return np.load(fn), json.loads(fj.read_text(encoding="utf-8"))


def _galeria(r, base_p, modo=None, lado=800):
    """Miniaturas de cada candidato (<id>.jpg) y de lo que quita (<id>_quita.jpg)."""
    b = _reducir(base_p, lado)
    for c in r.get("candidatos", []):
        try:
            q = _reducir(_p(np.load(TRABAJO / f"{c['id']}.npy", mmap_mode="r")), lado)
            c["previa"] = _jpg(M.autoestirar(q) if M.lineal(q) else q, TRABAJO / f"{c['id']}.jpg", 85)
            if modo:
                dlt = b - q
                if modo == "modelo":
                    lo = np.percentile(dlt, 1, axis=(1, 2), keepdims=True)
                    hi = np.percentile(dlt, 99, axis=(1, 2), keepdims=True)
                    v = (dlt - lo) / np.maximum(hi - lo, 1e-9)
                else:
                    s = 1.4826 * float(np.median(np.abs(dlt - np.median(dlt)))) or 1e-6
                    v = 0.5 + dlt / (8 * s)
                c["previa_quita"] = _jpg(v, TRABAJO / f"{c['id']}_quita.jpg", 85)
        except Exception as e:
            c["previa_error"] = str(e)[:120]
        if c.get("id") == r.get("recomendado"):
            c["recomendado"] = True
    return r


def _comparar(ctx, doc, grupo, lista, medir):
    """lista: [(nombre, proceso, preset)]. medir(res_p) -> métricas. Devuelve r con candidatos y errores."""
    h0 = M.huella(doc.image)
    _limpiar_grupo(grupo)
    r = {"vista": _nombre(doc), "candidatos": [], "errores": [], "recomendado": None, "motivo": ""}
    for n, item in enumerate(lista, 1):
        nombre, proceso, preset = item[:3]
        funcion = item[3] if len(item) > 3 else LOCALES.get(proceso)
        t0 = time.perf_counter()
        try:
            if funcion is not None:           # cálculo propio en numpy: no toca la vista
                res = _a_sas(funcion(_p(doc.image), **(preset or {})), doc.image)
            else:
                res = _probar(ctx, doc, proceso, preset)
            m = medir(_p(res))
            cid = _guardar_candidato(grupo, n, res, {"nombre": nombre, "proceso": proceso, "preset": preset,
                                                     "huella_base": h0, "uid": getattr(doc, "uid", None),
                                                     "metricas": m})
            r["candidatos"].append({"id": cid, "metodo": nombre, "proceso": proceso, "preset": preset, "metricas": m,
                                    "segundos": _r(time.perf_counter() - t0, 1)})
        except Exception as e:
            r["errores"].append(f"{nombre}: {e}")
    return r


def gradienteCandidatos(ctx, vista=None, polinomio=(1, 2), rbf=True, usar_graxpert=True, muestras=120, tipo=None):
    """Paso 9 lineal: compara ABE (polinomio 1 y 2, y con RBF) y GraXpert IA, mide y recomienda. La vista no cambia."""
    d = _doc(ctx, vista)
    p = _p(d.image)
    if not M.lineal(p[:, ::8, ::8]):
        raise RuntimeError("La imagen no parece lineal (mediana > 0,05): el gradiente se corrige en lineal (Paso 9).")
    base = M.preparar_gradiente(p)
    lista = [(f"ABE polinomio {int(g)}", "abe", {"degree": int(g), "samples": int(muestras), "rbf": False})
             for g in (polinomio or [])]
    if rbf:
        lista.append(("ABE polinomio 2 + RBF", "abe", {"degree": 2, "samples": int(muestras), "rbf": True}))
    if usar_graxpert:
        lista.append(("GraXpert IA", "graxpert", {"op": "background", "smoothing": 0.1}))
    r = _comparar(ctx, d, "gradiente", lista, lambda q: M.medir_gradiente(base, q))
    r["recomendado"], r["criterio"], r["motivo"] = M.elegir_gradiente(r["candidatos"], base["objeto_campo_pct"], tipo)
    r["objeto_campo_pct"] = _r(base["objeto_campo_pct"], 1)
    r["leyenda"] = ("copia_objeto: cuánto se parece el modelo al objeto (cerca de 0 = limpio; > 0,5 se come el objeto). "
                    "objeto_quitado_pct: % de la señal del objeto que se lleva el modelo. gradiente_restante: fracción "
                    "del gradiente del cielo que queda (menor = más plano). La vista NO ha cambiado: aplicarCandidato(id).")
    if base["objeto_campo_pct"] > 40:
        r["aviso_campo"] = (f"El objeto ocupa el {round(base['objeto_campo_pct'])} % del campo: gradiente_restante es "
                            "orientativo. Decide con previa y estadisticas(bordes).")
    return _galeria(r, p, "modelo")


def _estirado_mtf(p, mediana=0.2, enlazado=True):
    """Estirado propio: punto negro a mediana − 2,8 MAD y tonos medios que llevan la mediana a 'mediana' (como el STF
    de las previas). Exacto y repetible; sirve de referencia cuando el estadístico de SASpro no llega a su objetivo."""
    return M.autoestirar(p, objetivo=float(mediana), enlazado=bool(enlazado))


LOCALES = {"estirado_mtf": _estirado_mtf}


def estirarCandidatos(ctx, vista=None, medianas=(0.15, 0.2), ghs=True, propio=True):
    """Paso NL1: estirado estadístico de SASpro (enlazado y por canal, varias medianas), GHS y un estirado MTF propio,
    medidos con los criterios de la ficha: cielo, ruido relativo, recortes en negro y en blanco. La vista no cambia.
    Un estirado estadístico que no llega a su mediana objetivo se descarta (en SASpro 1.24.2 algunas medianas dejan la
    imagen casi negra)."""
    d = _doc(ctx, vista)
    p = _p(d.image)
    if not M.lineal(p[:, ::8, ::8]):
        raise RuntimeError("La imagen ya parece estirada (mediana > 0,05).")
    lista = []
    for m in medianas or []:
        lista.append((f"estirado estadístico enlazado {m}", "stat_stretch", {"target_median": float(m), "linked": True}))
        if p.shape[0] == 3:
            lista.append((f"estirado estadístico por canal {m}", "stat_stretch",
                          {"target_median": float(m), "linked": False}))
        if propio:
            lista.append((f"estirado MTF propio enlazado {m}", "estirado_mtf", {"mediana": float(m), "enlazado": True}))
    if ghs:
        c = M.cielo(p)
        sp = float(c["cielo"])
        lista.append(("GHS (pivote en el cielo)", "ghs", {"alpha": 6.0, "beta": 1.5, "gamma": 1.0,
                                                          "pivot": min(max(sp, 0.0), 0.5), "lp": 0.0, "hp": 0.0}))

    def medir(q):
        m = M.cielo(q)
        cp = M.cielo_por_canal(q, m["_celdas"])
        r = M.sin_privado(m)
        if len(cp) == 3:
            r["dominante_cielo"] = _r(max(cp) - min(cp), 4)
        return r

    r = _comparar(ctx, d, "estirado", lista, medir)
    buenos = []
    for x in r["candidatos"]:
        med, obj = x["metricas"].get("mediana") or 0, (x.get("preset") or {}).get("target_median")
        if med < 0.02 or (obj and abs(med - obj) > 0.5 * obj):
            r["errores"].append(f"{x['metodo']}: no estira (mediana {med}"
                                + (f", objetivo {obj}" if obj else "") + "); descartado.")
        else:
            buenos.append(x)
    r["candidatos"] = buenos

    def nota(x):
        m = x["metricas"]
        castigo = 0.0
        castigo += max(0.0, (m["cero_pct"] or 0) - 0.05) * 10
        castigo += max(0.0, (m["alto_pct"] or 0) - 0.5) * 5
        castigo += abs((m["cielo"] or 0) - 0.12) * 5
        castigo += (m.get("dominante_cielo") or 0) * 20
        return castigo

    if r["candidatos"]:
        mejor = min(r["candidatos"], key=nota)
        r["recomendado"] = mejor["id"]
        m = mejor["metricas"]
        r["motivo"] = (f"{mejor['metodo']}: cielo {m['cielo']}, ruido relativo {m['ruido_rel']}, "
                       f"{m['cero_pct']} % a negro, {m['alto_pct']} % por encima de 0,95.")
    r["leyenda"] = ("cielo: nivel del fondo (la ficha pide ~0,08–0,15). ruido_rel: ruido / cielo. cero_pct y alto_pct: "
                    "recortes. dominante_cielo: diferencia entre canales en el cielo. La vista NO ha cambiado.")
    return _galeria(r, p)


def ruidoCandidatos(ctx, vista=None, fuerzas=None, usar_graxpert=False):
    """Pasos L14/NL6: Cosmic Clarity denoise a varias fuerzas y GraXpert denoise frente a no hacer nada: ruido del
    cielo y detalle que se pierde (< 10 %). La vista no cambia."""
    d = _doc(ctx, vista)
    p = _p(d.image)
    lineal = M.lineal(p[:, ::8, ::8])
    if fuerzas is None:                     # en no lineal, más suave (como en Siril)
        fuerzas = (0.3, 0.5, 0.7) if lineal else (0.15, 0.25, 0.35)
    c0 = M.cielo(p)
    z = M.zonas_objeto_cielo(p)
    L0 = M.lum(p)
    # Detalle (como en Siril, 10 nov 2026): energía de 2–8 px en la parte brillante del objeto. La medida de 1–4 px en
    # toda la imagen contaba el ruido como detalle y cualquier denoise «perdía» un 30–70 % (M31 en SASpro, 13 nov).
    zb = M.zona_brillante(L0, z)
    cpx = z["cielo_px"]
    e0 = M.energia_brillante(L0, zb, cpx) if zb is not None else None
    if e0 is not None and e0 <= 0:
        e0 = None
    lista = [(f"Cosmic Clarity denoise {f}", "cosmic_clarity",
              {"mode": "denoise", "denoise_luma": float(f), "denoise_color": float(f), "create_new_view": False,
               "gpu": True}) for f in fuerzas or []]
    if usar_graxpert:
        lista.append(("GraXpert denoise 0,5", "graxpert", {"op": "denoise", "strength": 0.5}))

    def medir(q):
        c = M.cielo(q)
        L = M.lum(q)
        e1 = M.energia_brillante(L, zb, cpx) if zb is not None else None
        perd = max(0.0, 100.0 * (1.0 - e1 / e0)) if e0 and e1 is not None else None
        return {"ruido_rel": c["ruido_rel"], "ruido_vs_antes": _r(c["ruido"] / max(c0["ruido"], 1e-9), 3),
                "detalle_perdido_pct": _r(perd, 1), "cielo": c["cielo"], **M.recortes(q)}

    r = _comparar(ctx, d, "ruido", lista, medir)
    # Recomendación (como en Siril): el que más ruido quita sin perder más del 2 % de detalle ni recortar; si ninguno,
    # el que menos detalle pierde entre los que bajan el ruido ≥ 20 % y pierden < 10 %. En no lineal no bajar de la mitad
    # del ruido (fondo plástico); en lineal, del 25 %.
    minimo = 0.25 if lineal else 0.5
    rec0 = M.recortes(p)
    for x in r["candidatos"]:
        m = x["metricas"]
        x["no_cumple"] = []
        if (m["ruido_vs_antes"] or 1) < minimo:
            x["no_cumple"].append(f"fondo muerto: deja el {round(100 * m['ruido_vs_antes'])} % del ruido (mínimo "
                                  f"{round(100 * minimo)} %)")
        if m["altos_pct"] - rec0["altos_pct"] > 0.01 or m["ceros_pct"] - rec0["ceros_pct"] > 0.01:
            x["no_cumple"].append("recortes nuevos")
    ok = [x for x in r["candidatos"] if not x["no_cumple"] and x["metricas"]["detalle_perdido_pct"] is not None]
    limpios = [x for x in ok if x["metricas"]["detalle_perdido_pct"] <= 2.0]
    medios = [x for x in ok if x["metricas"]["detalle_perdido_pct"] < 10 and x["metricas"]["ruido_vs_antes"] <= 0.8]
    mejor = (min(limpios, key=lambda x: x["metricas"]["ruido_vs_antes"]) if limpios
             else min(medios, key=lambda x: x["metricas"]["detalle_perdido_pct"]) if medios else None)
    if mejor:
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: deja el {round(100 * mejor['metricas']['ruido_vs_antes'])} % del ruido y "
                       f"pierde el {mejor['metricas']['detalle_perdido_pct']} % del detalle de 2–8 px del objeto.")
    else:
        r["motivo"] = ("Ningún candidato baja el ruido sin perder ≥ 10 % del detalle ni dejar el fondo muerto: mejor no "
                       "aplicar o probar más suave.")
    if e0 is None:
        r["aviso"] = ("En la parte brillante del objeto no hay detalle de 2–8 px por encima del ruido del cielo (o no hay "
                      "zona brillante): la pérdida de detalle no se puede medir. Mira un recorte 1:1 con previa(candidato).")
        sin_medida = [x for x in r["candidatos"] if not x["no_cumple"]]
        if sin_medida:                     # la pasada moderada: la que deja más cerca del 70 % del ruido
            mejor = min(sin_medida, key=lambda x: abs((x["metricas"]["ruido_vs_antes"] or 1) - 0.7))
            r["recomendado"] = mejor["id"]
            r["motivo"] = (f"{mejor['metodo']}: deja el {round(100 * mejor['metricas']['ruido_vs_antes'])} % del ruido "
                           "(pasada moderada; el detalle no se pudo medir: compruébalo en un recorte 1:1).")
    r["antes"] = {"ruido_rel": c0["ruido_rel"], "fase": "lineal" if lineal else "no lineal"}
    return _galeria(r, p, "diferencia")


def _wavescale_hdr(p, compresion=1.5, escalas=5, gamma_mascara=5.0):
    """WaveScale HDR de SASpro llamando a su función pura (setiastro.saspro.wavescale_hdr.compute_wavescale_hdr). El
    comando sin ventana (run_wavescale_hdr_via_preset) abre un diálogo con exec() que no se cierra tras aplicar y deja
    SASpro colgado (1.24.2)."""
    from setiastro.saspro.wavescale_hdr import compute_wavescale_hdr
    rgb = np.ascontiguousarray(np.moveaxis(p, 0, -1) if p.shape[0] == 3 else np.repeat(np.moveaxis(p, 0, -1), 3, -1))
    out = compute_wavescale_hdr(rgb.astype(np.float32), n_scales=int(escalas), compression_factor=float(compresion),
                                mask_gamma=float(gamma_mascara))
    out = out[0] if isinstance(out, tuple) else out
    q = np.moveaxis(np.asarray(out, dtype=np.float32), -1, 0)
    return np.clip(q if p.shape[0] == 3 else q[:1], 0, 1)


def nucleoCandidatos(ctx, vista=None, fuerzas=(0.25, 0.4, 0.55), hdr=(1.5, 2.5), radio=None, desde=None,
                     brillo_min=0.85, anillos_max=1.5):
    """NL5 núcleo de galaxia (no lineal, antes de saturar): compara comprimir el bulbo (propio, como en Siril) a varias
    fuerzas y WaveScale HDR de SASpro; mide meseta quemada, anillos, brillo y estructura del bulbo. La vista no cambia."""
    d = _doc(ctx, vista)
    p = _p(d.image)
    if M.lineal(p[:, ::8, ::8]):
        raise RuntimeError("La imagen parece lineal: el núcleo se trabaja después de estirar (y antes de saturar).")
    n = M.preparar_nucleo(p, radio, desde)
    m0 = M.medir_nucleo(p, n)
    lista = [(f"comprimir el bulbo ×{k:g}", "nucleo_propio", {"k": float(k)},
              (lambda q, k: M.comprimir_nucleo(q, n, k))) for k in (fuerzas or [])]
    lista += [(f"WaveScale HDR compresión {c:g}", "wavescale_hdr", {"compresion": float(c)},
               (lambda q, compresion: _wavescale_hdr(q, compresion))) for c in (hdr or [])]
    r = _comparar(ctx, d, "nucleo", lista, lambda q: M.medir_nucleo(q, n))
    for x in r["candidatos"]:
        m1, fal = x["metricas"], []
        if m0["brillo_bulbo"] and (m1["brillo_bulbo"] or 0) < brillo_min * m0["brillo_bulbo"]:
            fal.append(f"el bulbo se apaga: brillo {m1['brillo_bulbo']} < {brillo_min} × {m0['brillo_bulbo']}")
        if (m1["anillos_pct"] or 0) - (m0["anillos_pct"] or 0) > anillos_max:
            fal.append(f"anillos nuevos: el perfil sube hacia fuera un {m1['anillos_pct']} % (antes {m0['anillos_pct']} %)")
        if (m0["meseta_radio_px"] or 0) > 2 and (m1["meseta_radio_px"] or 0) >= m0["meseta_radio_px"]:
            fal.append("la meseta no baja")
        x["estructura_ganada_pct"] = (_r(100.0 * (m1["estructura_bulbo"] / m0["estructura_bulbo"] - 1), 1)
                                      if m0["estructura_bulbo"] and m1["estructura_bulbo"] else None)
        x["no_cumple"] = fal
    ok = [x for x in r["candidatos"] if not x["no_cumple"]]
    if ok:
        # La más suave que deja la meseta en su mínimo (M31 en SASpro, 13 nov 2026: las tres llegaban a 0 px y la
        # puntuación por estructura elegía ×0,55, con el bulbo gris y plano). Si ninguna la quita, como en Siril.
        m_min = min(x["metricas"]["meseta_radio_px"] or 0 for x in ok)
        bajan = [x for x in ok if (x["metricas"]["meseta_radio_px"] or 0) <= m_min + 1.0]
        if m_min < (m0["meseta_radio_px"] or 0):
            mejor = max(bajan, key=lambda x: x["metricas"]["brillo_bulbo"] or 0)
        else:
            def nota(x):
                caida = 100.0 * (1 - (x["metricas"]["brillo_bulbo"] or 0) / max(m0["brillo_bulbo"] or 1e-6, 1e-6))
                return (x["estructura_ganada_pct"] or 0) - 2.0 * (x["metricas"]["meseta_radio_px"] or 0) - 1.5 * max(caida, 0)
            mejor = max(ok, key=nota)
        mm = mejor["metricas"]
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: meseta {m0['meseta_radio_px']} → {mm['meseta_radio_px']} px, estructura del "
                       f"bulbo {mejor['estructura_ganada_pct']:+} %, brillo {m0['brillo_bulbo']} → {mm['brillo_bulbo']}, "
                       "sin anillos nuevos.")
    else:
        r["motivo"] = "Ninguno cumple (ver no_cumple): deja el núcleo como está o prueba otro umbral (desde) o radio."
    cy, cx = n["centro"]
    r.update(antes=m0, centro_px=[int(cx), int(cy)], umbral=_r(n["u"], 3), radio_base_px=n["r_b"])
    r["leyenda"] = ("meseta_radio_px: radio equivalente de lo que pasa de 0,95 en el bulbo (menos = menos quemado). "
                    "anillos_pct: mayor subida del perfil radial hacia fuera (halo o anillo artificial). brillo_bulbo: "
                    f"mediana en el bulbo (no debe caer por debajo del {int(brillo_min * 100)} %). estructura_bulbo: "
                    "detalle de 4 px en el bulbo. La vista NO ha cambiado: aplicarCandidato(id).")
    return _galeria(r, p, "diferencia")


def saturacionCandidatos(ctx, vista=None, cantidades=(0.25, 0.5, 0.75), proteger_cielo=True, dominante_max=5.0):
    """NL5 saturación: satura conservando la luminancia (propio) a varias cantidades; mide saturación del objeto y del
    cielo, dominante del cielo y recortes nuevos, y recomienda la mayor que cumple. La vista no cambia."""
    d = _doc(ctx, vista)
    p = _p(d.image)
    if p.shape[0] != 3:
        raise RuntimeError("La saturación necesita una imagen en color.")
    if M.lineal(p[:, ::8, ::8]):
        raise RuntimeError("La imagen parece lineal: la saturación va después de estirar.")
    z = M.zonas_objeto_cielo(p)
    cel = z["medidas"]["_celdas"]
    fondo = float(z["medidas"]["cielo"]) if proteger_cielo else None
    pmax0 = p.max(axis=0)
    cerca = M._caja((pmax0 >= 0.9).astype(np.float32), 3) > 0

    def medir(q):
        s = M.saturacion(q)
        rgb = M.cielo_por_canal(q, cel)
        dom = 100.0 * (max(rgb) - min(rgb)) / max(float(np.mean(rgb)), 1e-6)
        nuevos = (q.max(axis=0) >= 0.999) & (pmax0 < 0.9) & ~cerca
        return {"sat_objeto": _r(float(np.mean(s[z["obj_px"]])), 4) if z["obj_px"].any() else None,
                "sat_cielo": _r(float(np.mean(s[z["cielo_px"]])), 4) if z["cielo_px"].any() else None,
                "dominante_cielo_pct": _r(dom, 2), "recorte_nuevo_pct": _r(100.0 * float(nuevos.mean()), 4),
                **M.recortes(q)}

    m0 = medir(p)
    lista = [(f"saturar +{k:g}", "saturar_propio", {"k": float(k), "fondo": fondo},
              (lambda q, k, fondo: M.saturar(q, k, fondo))) for k in (cantidades or [])]
    r = _comparar(ctx, d, "saturacion", lista, medir)
    for x in r["candidatos"]:
        m, fal = x["metricas"], []
        go = (m["sat_objeto"] / m0["sat_objeto"] - 1) * 100 if m0["sat_objeto"] and m["sat_objeto"] else None
        gc = (m["sat_cielo"] / max(m0["sat_cielo"] or 0, 1e-6) - 1) * 100 if m["sat_cielo"] is not None else 0.0
        m.update(ganancia_objeto_pct=_r(go, 1), ganancia_cielo_pct=_r(gc, 1))
        if m["dominante_cielo_pct"] >= dominante_max:
            fal.append(f"dominante del cielo {m['dominante_cielo_pct']} % ≥ {dominante_max} %")
        if m["recorte_nuevo_pct"] > 0.01:
            fal.append(f"recorte alto nuevo fuera de lo ya brillante {m['recorte_nuevo_pct']} %")
        if m["ceros_pct"] - m0["ceros_pct"] > 0.05:
            fal.append("canales a 0 nuevos (colores fuera de rango)")
        if go is not None and gc > max(go, 5.0):
            fal.append("el cielo gana más color que el objeto")
        x["no_cumple"] = fal
    ok = [x for x in r["candidatos"] if not x["no_cumple"]]
    if ok:
        mejor = max(ok, key=lambda x: x["metricas"]["sat_objeto"] or 0)
        mm = mejor["metricas"]
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: el objeto gana un {mm['ganancia_objeto_pct']} % de saturación, el cielo queda "
                       f"con dominante {mm['dominante_cielo_pct']} % y sin recortes nuevos. Es la mayor que cumple: mírala "
                       "con previa antes de aplicarla.")
    else:
        r["motivo"] = "Ninguna cumple (ver no_cumple): no satures más o corrige antes la dominante del cielo."
    r["antes"] = m0
    if m0["dominante_cielo_pct"] >= dominante_max:
        r["aviso"] = f"El cielo ya tiene una dominante del {m0['dominante_cielo_pct']} %: saturar la amplifica."
    return _galeria(r, p)


def estirarEstrellas(ctx, vista, factores=(3.0, 5.0), color=1.0, p90_objetivo=0.10):
    """NL estrellas: estira la vista de solo estrellas. Compara Star Stretch de SASpro a varios factores y un arcsinh
    propio que lleva el p90 de los píxeles de estrella a ~p90_objetivo. La vista no cambia (aplicarCandidato)."""
    d = _doc(ctx, vista)
    p = _p(d.image)
    Lb = M.lum(p)
    mk = M.px_estrella(Lb)

    def asinh(q, p90):
        vals = q[:, mk].mean(axis=0)
        lo, hi = 0.0, float(np.log(1e5))
        for _ in range(30):
            s = float(np.exp((lo + hi) / 2))
            if float(np.percentile(np.arcsinh(s * vals) / np.arcsinh(s), 90)) < p90:
                lo = np.log(s)
            else:
                hi = np.log(s)
        s = float(np.exp((lo + hi) / 2))
        return (np.arcsinh(s * np.clip(q, 0, 1)) / np.arcsinh(s)).astype(np.float32)

    lista = [(f"Star Stretch {f:g}", "star_stretch", {"stretch_factor": float(f), "color_boost": float(color),
                                                      "scnr_green": False}) for f in (factores or [])]
    lista.append((f"arcsinh propio (p90 estrellas {p90_objetivo:g})", "asinh_propio", {"p90": float(p90_objetivo)}, asinh))

    def medir(q):
        L = M.lum(q)
        v = L[mk]
        return {"p50_estrellas": _r(float(np.percentile(v, 50)), 4), "p90_estrellas": _r(float(np.percentile(v, 90)), 4),
                "fondo": _r(float(np.median(L[~mk][::7])), 5), **M.recortes(q)}

    r = _comparar(ctx, d, "estrellas", lista, medir)
    if r["candidatos"]:
        mejor = min(r["candidatos"], key=lambda x: abs((x["metricas"]["p90_estrellas"] or 0) - p90_objetivo)
                    + 5 * (x["metricas"]["altos_pct"] or 0))
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: p90 de las estrellas {mejor['metricas']['p90_estrellas']}, "
                       f"{mejor['metricas']['altos_pct']} % a 1. Mira la previa: estrellas sin halos ni núcleos quemados.")
    r["leyenda"] = "p50/p90_estrellas: brillo de los píxeles de estrella. fondo: mediana fuera de ellas. La vista NO ha cambiado."
    return _galeria(r, p)


def recombinarEstrellas(ctx, estrellas, vista=None, metodo="screen", factor=1.0):
    """NL9: une la starless (vista) con la vista de estrellas (screen o suma), con deshacer en la starless.
    Ambas deben estar estiradas; si la de estrellas sigue lineal, estírala antes con estirarEstrellas."""
    d = _doc(ctx, vista)
    e = _doc(ctx, estrellas)
    if d is e:
        raise ValueError("'estrellas' y 'vista' son la misma vista.")
    a, b = _p(d.image), _p(e.image)
    if a.shape[1:] != b.shape[1:]:
        raise RuntimeError(f"La vista de estrellas mide {b.shape[2]}×{b.shape[1]} y la starless {a.shape[2]}×{a.shape[1]}.")
    if b.shape[0] != a.shape[0]:
        b = np.repeat(b, a.shape[0], axis=0) if b.shape[0] == 1 else b[:1].repeat(a.shape[0], axis=0)
    if metodo not in ("screen", "suma"):
        raise ValueError("metodo: screen o suma.")
    k = float(factor)
    if not 0 < k <= 2:
        raise ValueError("factor entre 0 y 2 (1 = estrellas tal cual; 0,5–0,6 para estrellas discretas).")
    Lb = M.lum(b)
    # ¿Estrellas lineales? p99,5 de la capa (en una capa de estrellas el ~90 % es 0 y la máscara por MAD no sirve).
    p995 = float(np.percentile(Lb.ravel()[::7], 99.5))
    if not M.lineal(a[:, ::8, ::8]) and p995 < 0.02:
        return {"aplicado": False, "p99_5_estrellas": _r(p995, 4),
                "aviso": "La vista de estrellas parece lineal (p99,5 < 0,02) y la starless está estirada: estira antes las "
                         "estrellas (estirarEstrellas)."}
    res = 1.0 - (1.0 - np.clip(a, 0, 1)) * (1.0 - np.clip(k * b, 0, 1)) if metodo == "screen" else a + k * b
    res = np.clip(res, 0, 1).astype(np.float32)
    cel = M.cielo(a)["_celdas"]
    f0, f1 = float(np.mean(M.cielo_por_canal(a, cel))), float(np.mean(M.cielo_por_canal(res, cel)))
    rec0, rec1 = M.recortes(a), M.recortes(res)
    d.apply_edit(_a_sas(res, d.image), metadata={}, step_name=f"SetiAstroPilot: recombinar estrellas ({metodo} ×{k:g})")
    r = {"aplicado": True, "vista": _nombre(d), "estrellas": _nombre(e), "metodo": metodo, "factor": k,
         "aporte_estrellas_pct": _r(100.0 * float((M.lum(res) - M.lum(a)).mean()) / max(float(M.lum(res).mean()), 1e-9), 2),
         "fondo_antes": _r(f0, 5), "fondo_despues": _r(f1, 5), "recortes_antes": rec0, "recortes_despues": rec1,
         "nota": "Con deshacer. Guarda la versión con guardarImagen."}
    if rec1["altos_pct"] - rec0["altos_pct"] > 0.05:
        r["aviso"] = "recorte alto nuevo (núcleos de estrella a 1): deshaz y baja factor"
    return r


def nitidezCandidatos(ctx, vista=None, cantidades=(0.3, 0.5), modo="Both", superficie=True):
    """L11/NL7 nitidez: compara Cosmic Clarity sharpen a varias cantidades. Mide el detalle fino del objeto, el ruido del
    cielo y los recortes. La vista no cambia."""
    d = _doc(ctx, vista)
    p = _p(d.image)
    z = M.zonas_objeto_cielo(p) if not M.lineal(p[:, ::8, ::8]) else None
    c0 = M.cielo(p)
    L0 = M.lum(p)
    obj = z["obj_px"] if z is not None and z["obj_px"].any() else None
    e0 = M.contraste_local(L0, obj, r=2) if obj is not None else M.energia_detalle(L0)
    lista = [(f"Cosmic Clarity sharpen {a:g}", "cosmic_clarity",
              {"mode": "sharpen", "sharpening_mode": modo, "auto_psf": True, "stellar_amount": float(a),
               "nonstellar_amount": float(a), "create_new_view": False}) for a in (cantidades or [])]

    def medir(q):
        c = M.cielo(q)
        L = M.lum(q)
        e = M.contraste_local(L, obj, r=2) if obj is not None else M.energia_detalle(L)
        return {"detalle_ganado_pct": _r(100.0 * (e / max(e0, 1e-12) - 1), 1),
                "ruido_vs_antes": _r(c["ruido"] / max(c0["ruido"], 1e-9), 3), **M.recortes(q)}

    r = _comparar(ctx, d, "nitidez", lista, medir)
    ok = [x for x in r["candidatos"] if (x["metricas"]["ruido_vs_antes"] or 9) <= 1.15
          and (x["metricas"]["altos_pct"] or 0) - M.recortes(p)["altos_pct"] <= 0.02]
    if ok:
        mejor = max(ok, key=lambda x: x["metricas"]["detalle_ganado_pct"] or 0)
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: +{mejor['metricas']['detalle_ganado_pct']} % de detalle fino con el ruido del "
                       f"cielo a ×{mejor['metricas']['ruido_vs_antes']}. Mira un recorte con previa (anillos, artefactos).")
    else:
        r["motivo"] = "Ninguno gana detalle sin subir el ruido del cielo más de un 15 % o quemar: mejor no aplicar."
    return _galeria(r, p, "diferencia")


def aplicarCandidato(ctx, id, vista=None):
    """Pone en la vista el candidato 'id' de la última comparación (exactamente el que se midió, con deshacer)."""
    a, datos = _cargar_candidato(id)
    d = _doc(ctx, vista) if vista else None
    if d is None and datos.get("uid"):
        d = ctx.get_document(datos["uid"])
        d = _base(d) if d is not None else None
    if d is None:
        d = _doc(ctx)
    if M.huella(d.image) != datos.get("huella_base"):
        raise RuntimeError("La vista ha cambiado desde la comparación (otra imagen o ya se aplicó algo): repite la comparación.")
    d.apply_edit(a.astype(np.float32, copy=False), metadata={}, step_name=f"SetiAstroPilot: {datos.get('nombre', id)}")
    m = M.cielo(_p(d.image))
    return {"aplicado": str(id), "metodo": datos.get("nombre"), "proceso": datos.get("proceso"),
            "preset": datos.get("preset"), "vista": _nombre(d), "medidas": M.sin_privado(m),
            "nota": "Guarda esta versión con guardarImagen (v1, v2…) antes del paso siguiente."}


# --- Pasos sencillos (un proceso de SASpro con lo que pide la guía) -----------------------------------------

def quitarVerde(ctx, vista=None, cantidad=1.0, modo="avg", metodo="propio"):
    """NL3 SCNR. metodo 'propio' (por defecto): el SCNR clásico, solo baja G hasta la media (avg) o el máximo (max) de
    R y B; no toca R ni B. metodo 'sas': Remove Green de SASpro con preserve_lightness, que en M31 subió R y B (cielo de
    G +4 % a G −3,5 %, magenta). Con deshacer; devuelve cielo por canal y dominante antes y después."""
    if metodo == "sas":
        return _con_color(ctx, vista, "remove_green", {"amount": float(cantidad), "mode": modo, "preserve_lightness": True})
    d = _doc(ctx, vista)
    p = _p(d.image)
    if p.shape[0] != 3:
        raise RuntimeError("SCNR necesita una imagen en color.")
    k = float(np.clip(cantidad, 0, 1))
    r_, g, b = p
    tope = np.maximum(r_, b) if modo == "max" else np.minimum(r_, b) if modo == "min" else 0.5 * (r_ + b)
    # El exceso de verde se mide suavizado (casi gaussiano, radio ~8 px): píxel a píxel, min(G, media) recorta la mitad
    # positiva del ruido y deja el cielo con G por debajo de R y B (M31: dominante del 2,8 % al 5,9 %, magenta; con caja
    # 5×5 aún 3,7 %). El verde verdadero (dominante o ruido de color grueso) es de escala grande y no se pierde.
    exceso = np.maximum(M.suave((g - tope).astype(np.float32), 16), 0)
    q = p.copy()
    q[1] = np.clip(g - k * exceso, 0, 1)
    antes = _color(d)
    d.apply_edit(_a_sas(q, d.image), metadata={}, step_name=f"SetiAstroPilot: SCNR {modo} {k:g}")
    return {"vista": _nombre(d), "metodo": "propio", "modo": modo, "cantidad": k,
            "verde_bajado_pct": _r(100.0 * float((g - q[1]).mean()) / max(float(g.mean()), 1e-9), 2),
            "antes": antes, "despues": _color(d), "nota": "Con deshacer."}


def _color(d):
    """Cielo por canal (celdas más oscuras), dominante del cielo y medianas por canal: para ver qué hizo un paso de color."""
    p = _p(d.image)[:, ::2, ::2]
    if p.shape[0] < 3:
        return None
    c = M.cielo(p)
    cie = M.cielo_por_canal(p, c["_celdas"])
    m = sum(cie) / 3 or 1e-9
    return {"cielo_RGB": [_r(x, 6) for x in cie], "dominante_cielo_pct": _r(100 * (max(cie) - min(cie)) / m, 1),
            "mediana_RGB": [_r(float(np.median(p[i, ::2, ::2])), 6) for i in range(3)]}


def _con_color(ctx, vista, proceso, preset):
    d = _doc(ctx, vista)
    antes = _color(d)
    r = procesoSAS(ctx, proceso, preset, vista)
    if antes:
        r["antes"], r["despues"] = antes, _color(d)
    return r


def neutralizarFondo(ctx, vista=None, rect=None):
    """Neutraliza el fondo (Background Neutralization). rect opcional [x0, y0, x1, y1] de cielo limpio."""
    d = _doc(ctx, vista)
    preset = {"mode": "auto"}
    if rect:
        h, w = d.image.shape[:2]
        x0, y0, x1, y1 = _rect(rect, w, h)
        preset = {"mode": "rect", "rect_norm": [x0 / w, y0 / h, (x1 - x0) / w, (y1 - y0) / h]}
    return _con_color(ctx, vista, "background_neutral", preset)


def calibrarColor(ctx, vista=None, modo="star", umbral=50.0):
    """L12 color: White Balance de SASpro (modo star: con las estrellas; auto; manual con ayudaProceso)."""
    return _con_color(ctx, vista, "white_balance", {"mode": modo, "threshold": float(umbral)})


def resolverAstrometria(ctx, vista=None, ra=None, dec=None, escala=None, solucionador="both"):
    """L8: plate solve de SASpro (ASTAP/astrometry.net según su configuración)."""
    preset = {"solver": solucionador}
    if ra is not None and dec is not None:
        preset.update(seed_mode="manual", ra=str(ra), dec=str(dec))
    if escala:
        preset["scale"] = float(escala)
    r = procesoSAS(ctx, "plate_solve", preset, vista)
    r["astrometria"] = _tiene_wcs(_doc(ctx, vista))
    r.pop("aviso", None)
    return r


def separarEstrellas(ctx, vista=None, motor="starnet", lineal=None):
    """L15: separa estrellas con StarNet o DarkStar (remove_stars) o SyQon (syqon_starless). Crea la vista de
    estrellas aparte y deja la starless en la vista."""
    d = _doc(ctx, vista)
    if lineal is None:
        lineal = M.lineal(_p(d.image)[:, ::8, ::8])
    antes = {id(x) for x in _docs(ctx)}
    if motor in ("starnet", "darkstar"):
        r = procesoSAS(ctx, "remove_stars", {"tool": motor, "linear": bool(lineal)}, vista)
    elif motor == "syqon":
        r = procesoSAS(ctx, "syqon_starless", {"starless_make_stars": True}, vista)
    else:
        raise ValueError("motor: starnet, darkstar o syqon.")
    r["vistas_nuevas"] = [_nombre(x) for x in _docs(ctx) if id(x) not in antes]
    # SASpro deja activa la vista nueva de estrellas: sin esto, las llamadas siguientes sin 'vista' irían a ella.
    r["vista_activa"] = _reactivar(ctx, d)
    return r


def cerrarVista(ctx, vista, sin_guardar=False):
    """Cierra una vista. Por seguridad sólo si no tiene pasos de deshacer (sin cambios), salvo sin_guardar: true; aun
    así SASpro podría preguntar si guardar, y un diálogo bloquearía el puente, así que la vista se marca como guardada
    antes. ScriptContext no tiene cerrar: se cierra su subventana."""
    d = _doc(ctx, vista)
    nombre = _nombre(d)
    n = _n_deshacer(d) or 0
    if n and not sin_guardar:
        raise RuntimeError(f"'{nombre}' tiene {n} pasos sin guardar: guárdala (guardarImagen) o pasa sin_guardar: true.")
    sw = None
    for f in ("_find_subwindow_for_doc",):
        try:
            sw = getattr(ctx, f)(d)
        except Exception:
            sw = None
    if isinstance(sw, tuple):                 # SASpro 1.24 devuelve (subventana, vista)
        sw = next((x for x in sw if hasattr(x, "close") and hasattr(x, "widget")), None) or \
            next((x for x in sw if hasattr(x, "close")), None)
    if sw is None:
        raise RuntimeError("No encuentro la ventana de esa vista en SASpro.")
    for marca in ("setModified", "set_modified"):
        try:
            getattr(d, marca)(False)
        except Exception:
            pass
    try:
        d.dirty = False
    except Exception:
        pass
    sw.close()
    abiertas = [_nombre(x) for x in _docs(ctx)]
    return {"cerrada": nombre, "abiertas": abiertas}


def activarVista(ctx, vista):
    """Pone activa una vista (las llamadas sin 'vista' trabajan sobre la activa)."""
    d = _doc(ctx, vista)
    a = _reactivar(ctx, d)
    if a != _nombre(d):
        raise RuntimeError(f"SASpro no ha activado '{_nombre(d)}' (activa: {a}). Indica 'vista' en cada llamada.")
    return {"vista_activa": a}


def _reactivar(ctx, d):
    """Vuelve a poner activa la vista d (uid o nombre). Devuelve el nombre de la vista activa al terminar."""
    uid = getattr(d, "uid", None)
    for clave in (uid, _nombre(d)):
        if not clave:
            continue
        try:
            ctx.activate_view(clave)
            break
        except Exception:
            continue
    a = _activo(ctx)
    return _nombre(_base(a)) if a is not None else None


LISTA = {
    "ping": ping,
    "vistas": vistas,
    "imagen": imagen,
    "cabecera": cabecera,
    "estadisticas": estadisticas,
    "previa": previa,
    "analizarMaster": analizarMaster,
    "registro": registro,
    "abrirImagen": abrirImagen,
    "guardarImagen": guardarImagen,
    "exportarFinal": exportarFinal,
    "deshacer": deshacer,
    "rehacer": rehacer,
    "duplicarVista": duplicarVista,
    "activarVista": activarVista,
    "cerrarVista": cerrarVista,
    "procesoSAS": procesoSAS,
    "ayudaProceso": ayudaProceso,
    "gradienteCandidatos": gradienteCandidatos,
    "estirarCandidatos": estirarCandidatos,
    "ruidoCandidatos": ruidoCandidatos,
    "nucleoCandidatos": nucleoCandidatos,
    "saturacionCandidatos": saturacionCandidatos,
    "nitidezCandidatos": nitidezCandidatos,
    "estirarEstrellas": estirarEstrellas,
    "recombinarEstrellas": recombinarEstrellas,
    "aplicarCandidato": aplicarCandidato,
    "quitarVerde": quitarVerde,
    "neutralizarFondo": neutralizarFondo,
    "calibrarColor": calibrarColor,
    "resolverAstrometria": resolverAstrometria,
    "separarEstrellas": separarEstrellas,
}
