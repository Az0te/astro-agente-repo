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

import halo as _halo
import cielo as _cielo
import rc as _rc
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


def _sas_al_menos(*minimo):
    """True si SASpro es al menos la versión 'minimo' (p. ej. 1, 24, 5). En 1.24.5 llegaron los arreglos que pidió
    Rafael (16 nov 2026): save_document, close_document, stat_stretch y WaveScale sin ventana, ra_deg y halo_b_gon.
    Si no se sabe la versión, False (se usan los caminos de siempre)."""
    v = _version_sas()
    if not v:
        return False
    nums = [int(x) for x in re.findall(r"\d+", str(v))[:3]]
    while len(nums) < 3:
        nums.append(0)
    return tuple(nums) >= tuple(minimo)


def ping(ctx):
    """Comprueba que el puente y SASpro responden."""
    v_sas = _version_sas()
    d = _activo(ctx)
    act = _nombre(_base(d)) if d is not None else None
    e = _rc.estado()
    rc = {"version": e.get("version"), "productos": sorted(k for k, v in e["productos"].items() if v["valida"])} \
        if e.get("disponible") else None
    return {"herramientas": VERSION, "saspro": v_sas, "vistas_abiertas": len(_docs(ctx)), "vista_activa": act,
            "rc_astro": rc}


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
        "estrellas_pct": _r(_pct_estrellas(d), 3),
    }


def _textos_registro(ctx):
    """Texto de los paneles de registro de SASpro: «System Log» y «Consola / Estado» (QDockWidget con un QPlainTextEdit,
    QTextEdit o QListWidget dentro). En 1.24.2 no hay atributo directo en la ventana: se buscan los paneles."""
    textos = {}
    for attr in ("console", "log_widget", "_console", "_log_widget", "log_view"):
        w = getattr(ctx.app, attr, None)
        f = getattr(w, "toPlainText", None) if w is not None else None
        if callable(f):
            try:
                textos[attr] = f()
            except Exception:
                pass
    try:
        from PyQt6.QtWidgets import QDockWidget, QListWidget, QPlainTextEdit, QTextEdit
        for dock in ctx.app.findChildren(QDockWidget):
            titulo = dock.windowTitle() or dock.objectName() or "panel"
            if not re.search(r"(?i)log|consola|console|registro", titulo):
                continue
            partes = []
            for w in dock.findChildren(QPlainTextEdit) + dock.findChildren(QTextEdit):
                try:
                    partes.append(w.toPlainText())
                except Exception:
                    pass
            for w in dock.findChildren(QListWidget):
                try:
                    partes.append("\n".join(w.item(i).text() for i in range(w.count())))
                except Exception:
                    pass
            if any(partes):
                textos[titulo] = "\n".join(p for p in partes if p)
    except Exception:
        pass
    return textos


def registro(ctx, n=40, solo_errores=False, filtro=None, panel=None):
    """Últimas líneas de los registros de SASpro (System Log y Consola / Estado). panel: parte del título."""
    textos = _textos_registro(ctx)
    if panel:
        textos = {k: v for k, v in textos.items() if str(panel).lower() in k.lower()}
    texto = "\n".join(textos.values())
    if not texto:
        return {"lineas": [], "aviso": "No he encontrado los paneles de registro de SASpro.", "paneles": list(textos)}
    ls = [l for l in texto.splitlines() if l.strip()]
    if solo_errores:
        ls = [l for l in ls if re.search(r"(?i)error|fail|warn|aviso|traceback|exception", l)]
    if filtro:
        ls = [l for l in ls if str(filtro).lower() in l.lower()]
    return {"paneles": list(textos), "lineas": ls[-max(1, min(500, int(n))):]}


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
    # SASpro 1.24.5: save_document guarda como «Guardar como» (cabecera actual y astrometría). Si no existe, el camino de
    # siempre (cabecera fusionada con wcs_header).
    if hasattr(ctx, "save_document"):
        try:
            ctx.save_document(str(p), doc=d, bit_depth=bits)
            if p.exists():
                try:
                    import multicapa
                    multicapa._anotar_origen(str(p), [x for x in (m.get("file_path"), _nombre(d)) if x])
                except Exception:
                    pass
                return {"fichero": str(p), "formato": fmt, "bits": bits, "bytes": p.stat().st_size, "vista": _nombre(d),
                        "metodo": "save_document"}
        except TypeError:
            pass                                   # firma distinta: camino de siempre
    cab = _cabecera_para_guardar(m, np.shape(img)[:2])
    # En SASpro la cabecera está en metadata["fits_header"] (no en "original_header") y la astrometría en "wcs_header".
    # Antes se pasaba original_header (None) y el fichero salía con 7 palabras clave: sin OBJECT, exposición ni WCS
    # (M31, 13 nov 2026). image_meta no se pasa en XISF: con ella SASpro copia las palabras de la XISF original y
    # descarta la solución astrométrica; sin ella las escribe desde la cabecera, WCS incluido.
    ctx.save_image(img, str(p), original_format=fmt, bit_depth=bits, original_header=cab,
                   is_mono=(np.ndim(img) == 2), image_meta=None if fmt == "xisf" else m.get("xisf_meta"),
                   file_meta=m.get("file_meta"))
    if not p.exists():
        raise RuntimeError(f"SASpro no ha escrito {p}.")
    try:                                # procedencia: el fichero nuevo sale de la vista (y de su fichero de origen)
        import multicapa
        multicapa._anotar_origen(str(p), [x for x in (m.get("file_path"), _nombre(d)) if x])
    except Exception:
        pass
    return {"fichero": str(p), "formato": fmt, "bits": bits, "bytes": p.stat().st_size, "vista": _nombre(d),
            "palabras_cabecera": len(cab) if cab is not None else 0,
            "astrometria_guardada": bool(cab is not None and "CTYPE1" in cab)}


def _cabecera_para_guardar(m, forma=(0, 0)):
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
    # PLTSOLVD (lo usa Siril para saber si hay astrometría) sólo con un WCS completo: CRPIX dentro de la imagen.
    # Los de WBPP traen RA/DEC sin CRPIX y no valen (14 nov 2026).
    try:
        cx = float(h.get("CRPIX1")) if h.get("CRPIX1") is not None else None
        cy = float(h.get("CRPIX2")) if h.get("CRPIX2") is not None else None
        ancho, alto = forma[1], forma[0]
        if cx is not None and cy is not None and 1 < cx < ancho and 1 < cy < alto and h.get("CTYPE1"):
            h["PLTSOLVD"] = (True, "SetiAstroPilot: WCS completo")
        elif "PLTSOLVD" in h:
            del h["PLTSOLVD"]
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
    "halo_b_gon",                      # comando en SASpro 1.24.5; antes, función interna (INTERNOS)
    "rc_bxt", "rc_nxt", "rc_sxt",      # RC Astro con su programa rc-astro (rc.py), no son comandos de SASpro
    "texture_clarity", "satchroma",    # funciones sin ventana de SASpro (INTERNOS)
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
    if cid in INTERNOS and not _hay_comando(cid):
        return INTERNOS[cid](doc, dict(preset or {}))
    return ctx.run_command(cid, dict(preset or {}), target_doc=doc)


def _hay_comando(cid):
    """True si el registro de comandos de esta SASpro tiene el id (halo_b_gon llegó en 1.24.5)."""
    try:
        from setiastro.saspro.ops.commands import get_spec
        return get_spec(cid) is not None
    except Exception:
        return False


def _halo_b_gon_interno(doc, preset):
    """Halo-B-Gon sin el comando (SASpro < 1.24.5): la misma función de cálculo que usa el comando
    (halobgon.compute_halo_b_gon, presente desde antes), con un paso de deshacer. Preset: reduction 0–3, linear."""
    from setiastro.saspro.halobgon import compute_halo_b_gon
    a = np.asarray(doc.image, dtype=np.float32)
    forma = a.shape
    mono = a.ndim == 2 or (a.ndim == 3 and a.shape[2] == 1)
    rgb = np.repeat(a.reshape(forma[0], forma[1], 1), 3, axis=2) if mono else a
    k = int(max(0, min(3, int(preset.get("reduction", 0)))))
    out = np.asarray(compute_halo_b_gon(np.clip(rgb, 0.0, 1.0), k, bool(preset.get("linear", False))), dtype=np.float32)
    if mono:
        out = out.mean(axis=2).reshape(forma)
    doc.apply_edit(np.clip(out, 0.0, 1.0).astype(np.float32, copy=False), metadata={},
                   step_name=f"Halo-B-Gon (reducción {k})")


def _rc_interno(producto):
    """RC Astro (rc-astro) sobre la vista, con un paso de deshacer. Preset: el de rc.correr (stars, nonstellar,
    correct_only, halos, denoise, color, iteraciones, modelo...). Con sxt deja la starless."""
    def f(doc, preset):
        q = _rc.correr(_p(doc.image), producto, **preset)
        if producto == "sxt":
            q = q[0]
        doc.apply_edit(_a_sas(q, doc.image), metadata={},
                       step_name=f"RC Astro {_rc.PRODUCTOS[producto]} {json.dumps(preset, ensure_ascii=False)}"[:120])
    return f


# Procesos de la lista blanca que no son comandos de SASpro (RC Astro) o que, si la SASpro instalada no los tiene como
# comando, se hacen con su función interna (Halo-B-Gon antes de 1.24.5).
def _texture_clarity(doc, preset):
    """Texture Clarity de SASpro sin ventana (texture_clarity_headless: aplica con apply_edit). Amounts −1–1, radios
    0,1–10 px, umbral 0–0,1, mask_strength 0–1 (1 = solo medios tonos)."""
    from setiastro.saspro.texture_clarity import texture_clarity_headless
    claves = ("texture_amount", "texture_radius", "unsharp_amount", "unsharp_radius", "unsharp_threshold",
              "clarity_amount", "clarity_radius", "mask_strength")
    texture_clarity_headless(doc, **{k: float(v) for k, v in preset.items() if k in claves})


def _satchroma(doc, preset):
    """SatChroma de SASpro sin ventana: points [[tono 0–1, ganancia 0–3], ...], strength, mode 0 (saturación HSV) o 1
    (croma Lab; SASpro lo lee como entero y, con texto, no aplica nada y devuelve False)."""
    from setiastro.saspro.satchroma_tool import apply_satchroma_headless
    preset = dict(preset)
    m = str(preset.get("mode", 0)).lower()
    preset["mode"] = 1 if ("chroma" in m or "lab" in m or m == "1") else 0
    if apply_satchroma_headless(doc, preset, None) is False:
        raise RuntimeError("SatChroma no se aplicó (mira el registro de SASpro).")


INTERNOS = {"halo_b_gon": _halo_b_gon_interno, "rc_bxt": _rc_interno("bxt"), "rc_nxt": _rc_interno("nxt"),
            "rc_sxt": _rc_interno("sxt"), "texture_clarity": _texture_clarity, "satchroma": _satchroma}


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


def _params_estirado(q, objetivo=0.25, sombras=-2.8):
    """Punto negro y tonos medios por canal (como el autoestirado), para aplicar el MISMO estirado a varias imágenes.
    Sin fondo medible (capa de solo estrellas) queda en identidad."""
    ps = []
    for c in range(q.shape[0]):
        x = np.asarray(q[c], dtype=np.float32)
        med = float(np.median(x))
        mad = 1.4826 * float(np.median(np.abs(x - med)))
        c0 = min(max(0.0, med + sombras * mad), 0.99)
        mn = (med - c0) / (1 - c0)
        ps.append((c0, float(M.mtf(objetivo, np.float64(mn))) if mn > 0 else 0.5))
    return ps


def _estirar_con(q, ps):
    out = np.empty(q.shape, dtype=np.float32)
    for c in range(q.shape[0]):
        c0, m = ps[min(c, len(ps) - 1)]
        out[c] = M.mtf(m, np.clip((np.asarray(q[c], dtype=np.float32) - c0) / (1 - c0), 0, 1))
    return out


def _galeria(r, base_p, modo=None, lado=800, original=True):
    """Miniaturas de cada candidato (<id>.jpg) y de lo que quita (<id>_quita.jpg), más la imagen de partida
    (r["original"]). Si es lineal, TODAS con el mismo estirado (el de la de partida; en gradiente, el del recomendado,
    porque la de partida tiene otro fondo) para que las diferencias se vean de verdad. Con modo 'diferencia' (ruido,
    nitidez, deconvolución, núcleo, contraste) añade un recorte al 100 % del centro (previa_recorte)."""
    b = _reducir(base_p, lado).astype(np.float32)
    cands = r.get("candidatos", [])
    lineal = M.lineal(b)
    zona = None
    if modo == "diferencia":
        h, w = base_p.shape[1], base_p.shape[2]
        y0, x0 = max(0, h // 2 - 300), max(0, w // 2 - 300)
        zona = (slice(y0, y0 + 600), slice(x0, x0 + 600))
    grupo = cands[0]["id"].rsplit("_", 1)[0] if cands and cands[0].get("id") else "galeria"
    ps = ps_orig = None
    try:
        if lineal:
            ps_orig = ps = _params_estirado(b)
            if modo == "modelo" and cands:
                ref = next((c for c in cands if c.get("id") == r.get("recomendado")), cands[0])
                ps = _params_estirado(_reducir(_p(np.load(TRABAJO / f"{ref['id']}.npy", mmap_mode="r")), lado))
        if original:                            # en paletas la de partida no es comparable
            ver = (lambda q: _estirar_con(q, ps_orig)) if lineal else (lambda q: q)
            o = {"metodo": "Original (de partida)", "previa": _jpg(ver(b), TRABAJO / f"{grupo}_original.jpg", 85)}
            if zona:
                o["previa_recorte"] = _jpg(ver(np.asarray(base_p[:, zona[0], zona[1]], dtype=np.float32)),
                                           TRABAJO / f"{grupo}_original_100.jpg", 90)
            r["original"] = o
    except Exception as e:
        r["original_error"] = str(e)[:120]
    escala_modelo = None
    for c in cands:
        try:
            completo = _p(np.load(TRABAJO / f"{c['id']}.npy", mmap_mode="r"))
            q = _reducir(completo, lado)
            lin = M.lineal(q)                   # tras estirar, los candidatos ya no son lineales: se ven tal cual
            c["previa"] = _jpg(_estirar_con(q, ps) if (ps and lin) else (M.autoestirar(q) if lin else q),
                               TRABAJO / f"{c['id']}.jpg", 85)
            if zona:
                z = np.asarray(completo[:, zona[0], zona[1]], dtype=np.float32)
                c["previa_recorte"] = _jpg(_estirar_con(z, ps_orig) if (ps_orig and lin) else z, TRABAJO / f"{c['id']}_100.jpg", 90)
            if modo:
                dlt = b - q
                if modo == "modelo":            # misma escala en todos para comparar cuánto quita cada uno
                    if escala_modelo is None:
                        escala_modelo = (np.percentile(dlt, 1, axis=(1, 2), keepdims=True),
                                         np.percentile(dlt, 99, axis=(1, 2), keepdims=True))
                    lo, hi = escala_modelo
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


_HALO_CACHE = {}


def _halo_candidato(p, croma=False, **op):
    """Polinomio fuera del halo (croma=False) o + crominancia (croma=True), con halo.py; los dos salen del mismo cálculo."""
    clave = (p.shape, float(p[:, ::97, ::97].sum()), json.dumps(op, sort_keys=True))
    if clave not in _HALO_CACHE:
        _HALO_CACHE.clear()
        _HALO_CACHE[clave] = _halo.calcular(p, **op)
    poly, cro, info = _HALO_CACHE[clave]
    if croma and cro is None:
        raise RuntimeError(info.get("aviso", "sin crominancia"))
    return cro if croma else poly


def _srgc_survey(p, survey):
    """Referencia de SRGC: la que se pida o, por defecto, NSNS RGB en color y NSNS visual en mono. En capas de banda
    estrecha conviene pasar la de su raya: «NSNS Ha (north) — mono», «NSNS [OIII] (north) — mono»,
    «NSNS [SII] (north) — mono» (nombres exactos; uno desconocido cae en la referencia por defecto de SASpro)."""
    if survey:
        return str(survey)
    return "NSNS RGB continuum (north) — colour" if p.shape[0] >= 3 else "NSNS visual continuum (north) — mono"


def gradienteCandidatos(ctx, vista=None, polinomio=(1, 2), rbf=True, usar_graxpert=True, muestras=120, tipo=None,
                        halo=True, halo_opciones=None, diagnostico=True, srgc=None, srgc_survey=None, cadenas=True):
    """Paso 9 lineal: compara ABE (polinomio 1 y 2, y con RBF), GraXpert IA, el polinomio fuera del halo
    (+ crominancia), SRGC (si la vista tiene astrometría) y las cadenas con nuestro modelo del cielo con máscara o de
    bordes; mide y recomienda. La vista no cambia."""
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
    # 14 nov 2026 (halo.py): objetos grandes y difusos cuya máscara se queda corta; la crominancia quita manchas de color
    # de escala media sin tocar la luminancia. Cálculo propio en numpy.
    if halo and p.shape[0] >= 3:
        op = dict(halo_opciones or {})
        lista.append(("Polinomio fuera del halo", "halo", {**op, "croma": False}, _halo_candidato))
        lista.append(("Polinomio fuera del halo + crominancia", "halo", {**op, "croma": True}, _halo_candidato))
    # SRGC (Survey Reference Gradient Correction de SASpro), como en el vídeo de Seti Astro: 500 muestras y exclusión
    # del 15 % (con el 50 % por defecto estropeaba el color de M31). Necesita astrometría e internet. Comparación del
    # 16 nov 2026: en M31 no se lleva nada de galaxia; en IC 1396 es, con el polinomio 1, lo único que no aplana la nebulosa.
    # Plano en las celdas más oscuras (cielo.plano_oscuras): para nebulosas o polvo que llenan el campo.
    lista.append(("Polinomio celdas oscuras", "oscuras", {"frac": 0.25}, _cielo.plano_oscuras))
    usar_srgc = srgc if srgc is not None else _tiene_wcs(d)
    if usar_srgc:
        lista.append(("SRGC (referencia " + _srgc_survey(p, srgc_survey) + ", 500 muestras, exclusión 15 %)", "srgc",
                      {"survey": _srgc_survey(p, srgc_survey), "degree": 1, "work_long_side": 1024, "samples": 500,
                       "exclude": 15}))
    r = _comparar(ctx, d, "gradiente", lista, lambda q: M.medir_gradiente(base, q))
    if _HALO_CACHE:
        r["halo"] = next(iter(_HALO_CACHE.values()))[2]
        _HALO_CACHE.clear()
    if usar_srgc and not any(c["proceso"] == "srgc" for c in r["candidatos"]):
        r["errores"].append("SRGC no se pudo probar (¿sin internet o sin astrometría válida?).")
    # Cadenas con nuestro modelo del cielo con máscara / de bordes (cielo.py) sobre los candidatos que respetan el
    # objeto. En M31 empataron con el ganador de PixInsight; en una nebulosa que llena el campo aplanan, y entonces el
    # freno de aplanado (medidas.aplanado_gradiente) las saca de la recomendación.
    if cadenas and r["candidatos"]:
        try:
            masc, ncc, ntot = _cielo.mascara_cielo(M.binar(M.lum(p), _cielo.B))
            r["cielo_cajas"] = f"{ncc} de {ntot} cajas de cielo"
            fuentes = [("Polinomio fuera del halo + crominancia", False), ("ABE polinomio 1", False), ("SRGC", True),
                       ("SRGC", "oscuras")]
            n = len(lista)
            for prefijo, bordes in fuentes:
                c0 = next((c for c in r["candidatos"] if c["metodo"].startswith(prefijo)), None)
                if c0 is None:
                    continue
                n += 1
                t0 = time.perf_counter()
                q0 = _p(_cargar_candidato(c0["id"])[0])
                if bordes == "oscuras":      # SRGC + plano en celdas oscuras: lo más cercano a SRGC con algo menos de desnivel
                    q, nombre = _cielo.plano_oscuras(q0), c0["metodo"].split(" (")[0] + " + polinomio celdas oscuras"
                else:
                    q = _cielo.corregir(q0, masc, bordes=bordes)
                    nombre = c0["metodo"].split(" (")[0] + (" + bordes" if bordes else " + cielo con máscara")
                m = M.medir_gradiente(base, q)
                cid = _guardar_candidato("gradiente", n, _a_sas(q, d.image),
                                         {"nombre": nombre, "proceso": "cielo.py", "preset": {"sobre": c0["id"], "bordes": bordes},
                                          "huella_base": M.huella(d.image), "uid": getattr(d, "uid", None), "metricas": m})
                r["candidatos"].append({"id": cid, "metodo": nombre, "proceso": "cielo.py",
                                        "preset": {"sobre": c0["id"], "bordes": bordes}, "metricas": m,
                                        "segundos": _r(time.perf_counter() - t0, 1)})
        except Exception as e:
            r["errores"].append(f"cadenas con el modelo del cielo: {e}")
    r["recomendado"], r["criterio"], r["motivo"] = M.elegir_gradiente(r["candidatos"], base["objeto_campo_pct"], tipo)
    # Qué es cada mancha que queda en la recomendada: canal, exceso o hueco, si sigue al objeto, y veredicto.
    if diagnostico and r["recomendado"] and p.shape[0] >= 3:
        try:
            r["diagnostico_manchas"] = _halo.diagnosticar(_p(_cargar_candidato(r["recomendado"])[0]))
            # Si las manchas que deja son artefactos de color y la crominancia es segura, se recomienda esa.
            tope = M.tope_gradiente(base["objeto_campo_pct"], tipo)[1]
            cambio = _halo.preferir_por_diagnostico(r["diagnostico_manchas"], r["candidatos"], r["recomendado"], tope)
            if cambio:
                r["recomendado_por_medidas"] = r["recomendado"]
                r["diagnostico_manchas_por_medidas"] = r["diagnostico_manchas"]
                r["recomendado"], r["motivo"] = cambio[0], cambio[1] + " Por medidas era " + r["motivo"]
                r["diagnostico_manchas"] = _halo.diagnosticar(_p(_cargar_candidato(r["recomendado"])[0]))
        except Exception as e:
            r["errores"].append(f"diagnóstico de manchas: {e}")
    r["objeto_campo_pct"] = _r(base["objeto_campo_pct"], 1)
    r["leyenda"] = ("copia_objeto: cuánto se parece el modelo al objeto (cerca de 0 = limpio; > 0,5 se come el objeto). "
                    "objeto_quitado_pct: % de la señal del objeto que se lleva el modelo. gradiente_restante: fracción "
                    "del gradiente del cielo que queda (menor = más plano). La vista NO ha cambiado: aplicarCandidato(id).")
    if base["objeto_campo_pct"] > 40:
        r["aviso_campo"] = (f"El objeto ocupa el {round(base['objeto_campo_pct'])} % del campo: gradiente_restante es "
                            "orientativo. Decide con previa y estadisticas(bordes).")
    # Rafael (16 nov 2026): revisar bien los recortes antes del gradiente. Con varios masters alineados, si esta vista no
    # sale de unos que pasaron revisarRecorte, aviso fuerte (las franjas de cobertura parcial tuercen el modelo).
    try:
        import multicapa
        rv = multicapa.recorte_revisado(multicapa._fuente(ctx, d))
        if rv is False:
            r["AVISO_RECORTE"] = ("¡ANTES DEL GRADIENTE, revisarRecorte! Esta vista viene de masters alineados sin el recorte "
                                  "revisado: las franjas de los bordes con menos subs tuercen el modelo (IC 1396: esquina "
                                  "cian). Haz revisarRecorte(ficheros de los alineados) y usa los *_rec.")
            r["recomendado"] = None
            r["motivo"] = "Sin recomendación hasta revisar el recorte (AVISO_RECORTE). " + str(r.get("motivo") or "")
    except Exception:
        pass
    return _galeria(r, p, "modelo")


def diagnosticoManchas(ctx, vista=None, escala=1.1, umbral=0.1, zonas=4):
    """Qué es cada mancha que queda en el cielo de una vista en color: R, G, B en % del cielo de cada canal, exceso o
    hueco, distancia al objeto y simetría, y veredicto. La señal real sólo suma luz: un hueco o una mancha en un solo
    canal es un artefacto. No cambia nada."""
    p = _p(_doc(ctx, vista).image)
    if p.shape[0] < 3:
        raise RuntimeError("hace falta una imagen en color")
    r = _halo.diagnosticar(p, escala=float(escala), umbral=float(umbral), zonas=int(zonas))
    r["vista"] = _nombre(_doc(ctx, vista))
    return r


def _estirado_mtf(p, mediana=0.2, enlazado=True):
    """Estirado propio: punto negro a mediana − 2,8 MAD y tonos medios que llevan la mediana a 'mediana' (como el STF
    de las previas). Exacto y repetible; sirve de referencia cuando el estadístico de SASpro no llega a su objetivo."""
    return M.autoestirar(p, objetivo=float(mediana), enlazado=bool(enlazado))


def _estirado_sas_directo(p, mediana=0.2, enlazado=True):
    """Estirado estadístico de SASpro llamando a su función (imageops.stretch.stretch_color_image / stretch_mono_image)
    sin el comando sin ventana, que en 1.24.2 deja algunas imágenes negras a mediana 0,2–0,3."""
    import inspect
    from setiastro.saspro.imageops import stretch as S
    a = np.ascontiguousarray(np.moveaxis(p, 0, -1) if p.shape[0] == 3 else p[0]).astype(np.float32)
    fn = S.stretch_color_image if a.ndim == 3 else S.stretch_mono_image
    kw = {"linked": bool(enlazado), "normalize": False, "apply_curves": False, "curves_boost": 0.0,
          "blackpoint_sigma": 5.0, "no_black_clip": False, "hdr_compress": False}
    acepta = inspect.signature(fn).parameters
    kw = {k: v for k, v in kw.items() if k in acepta}
    out = fn(a, float(mediana), **kw) if "target_median" not in acepta else fn(a, target_median=float(mediana), **kw)
    out = np.asarray(out[0] if isinstance(out, tuple) else out, dtype=np.float32)
    return np.clip(np.moveaxis(out, -1, 0) if out.ndim == 3 else out[None], 0, 1)


LOCALES = {"estirado_mtf": _estirado_mtf, "estirado_sas_directo": _estirado_sas_directo,
           # RC Astro: el cálculo va en rc-astro sobre una copia, así que en las comparaciones no toca la vista
           "rc_bxt": lambda p, **op: _rc.correr(p, "bxt", **op),
           "rc_nxt": lambda p, **op: _rc.correr(p, "nxt", **op)}


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
    # SASpro 1.24.5: el estirado estadístico sin ventana ya llega a su mediana si se pasa normalize=False (con Normalize
    # reescala para que el máximo sea 1) y acepta el punto negro; antes dejaba la imagen casi negra o se pasaba.
    nuevo = _sas_al_menos(1, 24, 5)
    extra = {"normalize": False, "no_black_clip": False, "blackpoint_sigma": 5.0} if nuevo else {}
    for m in medianas or []:
        lista.append((f"estirado estadístico enlazado {m}", "stat_stretch", {"target_median": float(m), "linked": True, **extra}))
        if p.shape[0] == 3:
            lista.append((f"estirado estadístico por canal {m}", "stat_stretch",
                          {"target_median": float(m), "linked": False, **extra}))
        if propio:
            lista.append((f"estirado MTF propio enlazado {m}", "estirado_mtf", {"mediana": float(m), "enlazado": True}))
            lista.append((f"estadístico de SASpro, función directa, enlazado {m}", "estirado_sas_directo",
                          {"mediana": float(m), "enlazado": True}))
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
        # Con 1.24.5 el estadístico debe caer en su mediana: se descarta si se desvía más de un 20 %.
        tol = 0.2 if nuevo else 0.5
        if med < 0.02 or (obj and abs(med - obj) > tol * obj):
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


def ruidoCandidatos(ctx, vista=None, fuerzas=None, usar_graxpert=False, usar_nxt=None, nxt_fuerzas=None):
    """Pasos L14/NL6: Cosmic Clarity denoise a varias fuerzas, NoiseXTerminator (RC Astro, si está) y GraXpert denoise
    frente a no hacer nada: ruido del cielo y detalle que se pierde (< 10 %). La vista no cambia."""
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
    # Capas débiles (OIII, SII, Hβ de dual band; IC 1396, 14 nov 2026): si el detalle de la zona brillante apenas sobresale
    # del ruido del cielo en la misma escala, la «pérdida» es sobre todo ruido quitado y no se aplicaba ningún denoise
    # (35–73 %): la paleta salía granulosa. Entonces no se mide y se recomienda la pasada moderada (como en Siril).
    if e0 is not None and cpx.any() and e0 < 0.5 * M.energia_brillante(L0, cpx):
        e0 = None
    lista = [(f"Cosmic Clarity denoise {f}", "cosmic_clarity",
              {"mode": "denoise", "denoise_luma": float(f), "denoise_color": float(f), "create_new_view": False,
               "gpu": True}) for f in fuerzas or []]
    if usar_nxt is None:
        usar_nxt = _rc.hay("nxt")
    if usar_nxt:
        if nxt_fuerzas is None:
            nxt_fuerzas = (0.5, 0.7) if lineal else (0.3, 0.5)
        lista += [(f"NoiseXTerminator {f:g}", "rc_nxt", {"denoise": float(f)}) for f in nxt_fuerzas]
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
    # SASpro 1.24.5: el comando sin ventana ya termina (devuelve True o lanza error). Se añade como candidato más; si el
    # nombre de algún parámetro no coincide, sale en errores y queda el cálculo con la función pura de arriba.
    if _sas_al_menos(1, 24, 5):
        lista += [(f"WaveScale HDR (comando de SASpro) compresión {c:g}", "wavescale_hdr",
                   {"compression_factor": float(c), "n_scales": 5, "mask_gamma": 5.0}) for c in (hdr or [])]
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


def _con_luminancia(p, L1):
    """Pone la luminancia L1 conservando el color (canales × L1/L, sin pasar de 1)."""
    L = M.lum(p)
    if p.shape[0] == 1:
        return np.clip(L1[None], 0, 1).astype(np.float32)
    q = p * (L1 / np.maximum(L, 1e-6))[None]
    mx = q.max(axis=0)
    q = np.where(mx > 1, q / np.maximum(mx, 1e-6), q)
    return np.clip(q, 0, 1).astype(np.float32)


def _clahe(p, mezcla=0.25, rejilla=8, limite=0.01):
    """CLAHE en la luminancia (skimage, va con SASpro), mezclado con la original. El CLAHE de skimage solo, aun con
    clip_limit bajo, iguala el histograma de cada zona: en IC 1396 subía el cielo de 0,10 a 0,18 y el ruido × 3,3
    (14 nov 2026). Una parte (mezcla) del resultado da el realce local sin levantar el fondo."""
    from skimage.exposure import equalize_adapthist
    L = np.clip(M.lum(p), 0, 1)
    k = (max(8, L.shape[0] // int(rejilla)), max(8, L.shape[1] // int(rejilla)))
    C = equalize_adapthist(L, kernel_size=k, clip_limit=float(limite)).astype(np.float32)
    # Sólo la banda de escalas medias (4–64 px) del CLAHE: su fondo grueso cambia el nivel del cielo y su escala fina
    # amplifica el ruido (con toda la banda fina, ruido del cielo × 1,8 a 25 %).
    det_c = M.suave(C, 4) - M.suave(C, 64)
    det_l = M.suave(L, 4) - M.suave(L, 64)
    L1 = L + float(mezcla) * (det_c - det_l)
    return _con_luminancia(p, L1)


def _ondiculas(p, pesos=(1.0, 1.15, 1.3, 1.3, 1.1)):
    """Realce por escalas (pirámide de cajas, como wavelet + wrecons de Siril): capa i = caja(2^(i-1)) − caja(2^i);
    se multiplica cada capa por su peso y se suma el resto."""
    L = M.lum(p)
    capas, prev = [], L
    for i, _ in enumerate(pesos):
        b = M._caja(L, 2 ** i) if i > 0 else M._caja(L, 1)
        capas.append(prev - b)
        prev = b
    L1 = prev + sum(w * c for w, c in zip(pesos, capas))
    return _con_luminancia(p, L1)


def _enfoque(p, sigma=2.0, cantidad=0.3):
    """Máscara de enfoque en la luminancia (σ en px, cantidad como en Siril)."""
    L = M.lum(p)
    return _con_luminancia(p, L + float(cantidad) * (L - M.suave(L, 2 * float(sigma))))


def _escala_grande(p, cantidad=0.5, fino=16, grueso=256):
    """Contraste de escala grande (propio): realza sólo la banda fino–grueso px de la luminancia (estructura de la
    nebulosa: pilares, bordes, nubes), sin tocar el grano fino ni el nivel medio. Es lo que daba el relieve del final de
    PixInsight de IC 1396: contraste de 32–256 px 0,139 frente a 0,107 con la misma suavidad de grano (15 nov 2026)."""
    L = M.lum(p)
    banda = M.suave(L, fino) - M.suave(L, grueso)
    # Sin máscara oscurecía las nubes oscuras junto a la nebulosa hasta 0 (+0,7 % de píxeles a negro) y teñía el cielo
    # (dominante 5 → 8,6 %): el realce va pesado por la señal suavizada, de 0 en el cielo a 1 un poco por encima.
    s = M.suave(L, 32)
    cielo = float(np.percentile(s[::8, ::8], 10))
    rango = max(float(np.percentile(s[::8, ::8], 60)) - cielo, 1e-4)
    w = np.clip((s - cielo) / rango, 0, 1)
    w = w * w * (3 - 2 * w)
    L1 = L + float(cantidad) * banda * w
    return _con_luminancia(p, np.maximum(L1, 0.6 * L))


CONTRASTE = {
    "clahe_suave": ("CLAHE (25 % del detalle local)", lambda q: _clahe(q, 0.25)),
    "clahe_medio": ("CLAHE (50 % del detalle local)", lambda q: _clahe(q, 0.5)),
    "ondiculas": ("ondículas: escalas 2–4 × 1,15–1,3", _ondiculas),
    "enfoque": ("máscara de enfoque σ 2, 0,3", _enfoque),
    "grande_suave": ("escala grande 16–256 px × 1,5", lambda q: _escala_grande(q, 0.5)),
    "grande_fuerte": ("escala grande 16–256 px × 2", lambda q: _escala_grande(q, 1.0)),
}


def _multiescala(p, ganancias=(1.0, 1.2, 1.25, 1.15), sigma=1.0):
    """Descomposición multiescala de SASpro (multiscale_decompose / multiscale_reconstruct, funciones puras): capas de
    detalle × ganancia (la primera, la más fina, en 1 para no subir el ruido) y residuo intacto."""
    from setiastro.saspro.multiscale_decomp import multiscale_decompose, multiscale_reconstruct
    img = p[0] if p.shape[0] == 1 else np.moveaxis(p, 0, -1)
    det, res = multiscale_decompose(np.ascontiguousarray(img, dtype=np.float32), len(ganancias), float(sigma))
    det = [np.asarray(x, dtype=np.float32) * float(g) for x, g in zip(det, ganancias)]
    out = np.asarray(multiscale_reconstruct(det, res), dtype=np.float32)
    out = out[np.newaxis] if out.ndim == 2 else np.moveaxis(out, -1, 0)
    return np.clip(out, 0, 1)


LOCALES["multiescala"] = _multiescala

# Contraste con procesos de SASpro sin ventana (se prueban en la vista y se deshacen, como los comandos).
CONTRASTE_SAS = {
    "claridad_suave": ("Texture Clarity: claridad 0,25 (r 3)", "texture_clarity",
                       {"clarity_amount": 0.25, "clarity_radius": 3.0, "mask_strength": 1.0}),
    "claridad_media": ("Texture Clarity: claridad 0,5 (r 3)", "texture_clarity",
                       {"clarity_amount": 0.5, "clarity_radius": 3.0, "mask_strength": 1.0}),
    "textura": ("Texture Clarity: textura 0,3 (r 1)", "texture_clarity",
                {"texture_amount": 0.3, "texture_radius": 1.0, "mask_strength": 1.0}),
    "multiescala": ("multiescala de SASpro: capas 2–4 × 1,2–1,25", "multiescala", {}),
}


def contrasteCandidatos(ctx, vista=None, metodos=("clahe_suave", "clahe_medio", "ondiculas", "enfoque", "grande_suave",
                                                  "grande_fuerte", "claridad_suave", "claridad_media", "multiescala"),
                        ruido_max=None, tipo=None):
    """Contraste local (no lineal, antes de saturar): compara CLAHE, realce de escalas medias por ondículas y máscara
    de enfoque (propios, como en Siril), y Texture Clarity y la descomposición multiescala de SASpro. Mide el contraste
    local en el objeto, el ruido del cielo, la dominante y los recortes, y recomienda el de más contraste por ruido
    añadido. La vista no cambia."""
    d = _doc(ctx, vista)
    p = _p(d.image)
    if M.lineal(p[:, ::8, ::8]):
        raise RuntimeError("La imagen parece lineal: el contraste local va después de estirar.")
    if ruido_max is None:                                  # en galaxias el fondo admite menos ruido nuevo (M31, Siril)
        ruido_max = 1.10 if str(tipo or "") == "galaxia" else 1.25
    z = M.zonas_objeto_cielo(p)
    cel = z["medidas"]["_celdas"]
    obj = z["obj_px"]
    k0 = M.contraste_local(M.lum(p), obj)
    r0 = float(z["medidas"]["ruido"])
    rec0 = M.recortes(p)

    def dom(q):
        if q.shape[0] != 3:
            return 0.0
        rgb = M.cielo_por_canal(q, cel)
        return 100.0 * (max(rgb) - min(rgb)) / max(float(np.mean(rgb)), 1e-6)

    dom0 = dom(p)

    def medir(q):
        L = M.lum(q)
        k1 = M.contraste_local(L, obj)
        c = M.cielo(q)
        t = M.textura(L, obj)
        return {"contraste_ganado_pct": _r(100 * (k1 / k0 - 1), 1) if k0 and k1 else None,
                "ruido_rel": _r(float(c["ruido"]) / max(r0, 1e-9), 3), "dominante_cielo_pct": _r(dom(q), 2),
                "cielo": c["cielo"], "grano": t.get("grano"), "contraste_grande": t.get("contraste_grande"),
                "suavidad": t.get("suavidad"), **M.recortes(q)}

    lista = []
    for mt in metodos or []:
        if mt in CONTRASTE:
            nombre, f = CONTRASTE[mt]
            lista.append((nombre, mt, {}, (lambda q, f=f: f(q))))
        elif mt in CONTRASTE_SAS:
            lista.append(CONTRASTE_SAS[mt])
    r = _comparar(ctx, d, "contraste", lista, medir)
    for x in r["candidatos"]:
        m, fal = x["metricas"], []
        if m["ruido_rel"] > ruido_max:
            fal.append(f"ruido del cielo × {m['ruido_rel']} > {ruido_max}")
        if m["altos_pct"] - rec0["altos_pct"] > 0.01 or m["ceros_pct"] - rec0["ceros_pct"] > 0.05:
            fal.append("recortes nuevos")
        if m["dominante_cielo_pct"] - dom0 > 1.0:
            fal.append(f"el cielo gana color: dominante {_r(dom0, 1)} → {m['dominante_cielo_pct']} %")
        x["no_cumple"] = fal
    ok = [x for x in r["candidatos"] if not x["no_cumple"] and (x["metricas"]["contraste_ganado_pct"] or 0) > 0]
    if ok:
        mejor = max(ok, key=lambda x: (x["metricas"]["contraste_ganado_pct"] / 100.0) / max(x["metricas"]["ruido_rel"], 1.0))
        mm = mejor["metricas"]
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: +{mm['contraste_ganado_pct']} % de contraste local en el objeto con el ruido del "
                       f"cielo × {mm['ruido_rel']} y sin recortes nuevos (el mejor contraste por ruido añadido). Míralo con previa.")
    else:
        r["motivo"] = "Ninguno sube el contraste sin pasarse de ruido o recortar: no aplicar contraste local."
    r["antes"] = {"contraste_objeto": _r(k0, 5), "dominante_cielo_pct": _r(dom0, 2)}
    r["leyenda"] = ("contraste_ganado_pct: estructura de escala media (≈ 33 px) en el objeto, después / antes − 1. ruido_rel: "
                    f"ruido del cielo después / antes (límite {ruido_max}). La vista NO ha cambiado: aplicarCandidato(id).")
    return _galeria(r, p, "diferencia")


def _fwhm_estrellas(L, n=300):
    """FWHM mediana (px) de estrellas aisladas no saturadas, por momentos de segundo orden en una ventana de 15 px."""
    hp = L - M._caja(L, 5)
    s = 1.4826 * float(np.median(np.abs(hp[::4, ::4] - np.median(hp[::4, ::4]))))
    cand = hp > 20 * max(s, 1e-9)
    cand[:16, :] = cand[-16:, :] = False
    cand[:, :16] = cand[:, -16:] = False
    ys, xs = np.nonzero(cand)
    v = hp[ys, xs]
    pico = np.ones(len(ys), bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx:
                pico &= v >= hp[ys + dy, xs + dx]
    ys, xs = ys[pico], xs[pico]
    orden = np.argsort(-hp[ys, xs])
    yy, xx = np.mgrid[-7:8, -7:8]
    f = []
    for j in orden[len(orden) // 10:]:                      # sin el 10 % más brillante (saturadas, halos)
        y, x = ys[j], xs[j]
        w = L[y - 7:y + 8, x - 7:x + 8]
        if w.max() > 0.95:
            continue
        w = np.clip(w - np.median(L[y - 15:y + 16, x - 15:x + 16]), 0, None)
        t = float(w.sum())
        if t <= 0:
            continue
        cy, cx = float((w * yy).sum() / t), float((w * xx).sum() / t)
        var = float((w * ((yy - cy) ** 2 + (xx - cx) ** 2)).sum() / t) / 2
        if var > 0:
            f.append(2.3548 * np.sqrt(var))
        if len(f) >= n:
            break
    return float(np.median(f)) if f else None, len(f)


def _min3(x):
    """Mínimo en 3×3 (erosión en grises) sin scipy."""
    p = np.pad(x, 1, mode="edge")
    h, w = x.shape
    m = p[1:h + 1, 1:w + 1].copy()
    for dy in (0, 1, 2):
        for dx in (0, 1, 2):
            np.minimum(m, p[dy:dy + h, dx:dx + w], out=m)
    return m


def _reducir_estrellas(p, cantidad=0.5, pasadas=1, gamma=1.0, color=1.0):
    """Reducción de estrellas (propia) sobre una capa de SOLO estrellas ya estirada: erosión 3×3 (una o dos pasadas)
    mezclada con la original según 'cantidad', gamma > 1 que apaga los halos y las estrellas débiles, y color > 1 que
    separa los canales de la luminancia (las del RGB salían casi blancas frente a las de PixInsight; 15 nov 2026)."""
    q = np.empty_like(p)
    for i in range(p.shape[0]):
        e = p[i]
        for _ in range(int(pasadas)):
            e = _min3(e)
        c = (1 - float(cantidad)) * p[i] + float(cantidad) * e
        q[i] = np.power(np.clip(c, 0, 1), float(gamma)) if gamma != 1.0 else c
    if color != 1.0 and q.shape[0] == 3:
        L = q.mean(axis=0, keepdims=True)
        q = L + (q - L) * float(color)
    return np.clip(q, 0, 1).astype(np.float32)


LOCALES["reducir_estrellas"] = _reducir_estrellas


def reducirEstrellasCandidatos(ctx, vista=None, fwhm_objetivo=None, area_objetivo=None):
    """NL9: estrellas más pequeñas y discretas (lo que hace BXT en PixInsight) sobre la capa de SOLO estrellas ya
    estirada, antes de recombinar: erosión 3×3 a varias cantidades y gamma que apaga halos y débiles. Mide FWHM, % de
    píxeles de estrella (> 0,05) y brillo p90. Con fwhm_objetivo / area_objetivo (p. ej. los de compararFinales del
    final de PixInsight) recomienda el más cercano; si no, la erosión media. La vista no cambia."""
    d = _doc(ctx, vista)
    p = _p(d.image)
    if M.lineal(p[:, ::8, ::8]) and float(np.percentile(p[:, ::8, ::8], 99.9)) < 0.05:
        raise RuntimeError("La capa de estrellas parece lineal: estírala antes (estirarEstrellas).")
    L0 = M.lum(p)
    if float((L0 > 0.05).mean()) > 0.4:
        raise RuntimeError("La vista no parece una capa de SOLO estrellas (> 40 % de píxeles encendidos).")
    lista = [
        ("erosión 3×3 al 50 %", "reducir_estrellas", {"cantidad": 0.5}),
        ("erosión 3×3 al 100 %", "reducir_estrellas", {"cantidad": 1.0}),
        ("erosión 3×3 ×2 al 70 %", "reducir_estrellas", {"cantidad": 0.7, "pasadas": 2}),
        ("erosión 3×3 al 50 % + gamma 1,3", "reducir_estrellas", {"cantidad": 0.5, "gamma": 1.3}),
        ("gamma 1,5 (apaga halos y débiles)", "reducir_estrellas", {"cantidad": 0.0, "gamma": 1.5}),
        ("gamma 1,3 + color ×2,5 (como las de PixInsight)", "reducir_estrellas",
         {"cantidad": 0.0, "gamma": 1.3, "color": 2.5}),
    ]

    def medir(q):
        L = M.lum(q)
        fw, n = _fwhm_estrellas(L)
        on = L > 0.05
        return {"fwhm_px": _r(fw, 2), "estrellas_medidas": n, "area_pct": _r(100.0 * float(on.mean()), 3),
                "p90_estrellas": _r(float(np.percentile(L[on], 90)), 3) if on.any() else None}

    r = _comparar(ctx, d, "estrellas_red", lista, medir)
    r["antes"] = medir(p)

    def dist(x):
        m, s = x["metricas"], 0.0
        if fwhm_objetivo and m["fwhm_px"]:
            s += abs(m["fwhm_px"] / float(fwhm_objetivo) - 1)
        if area_objetivo and m["area_pct"] is not None:
            s += abs(m["area_pct"] / max(float(area_objetivo), 1e-6) - 1)
        return s

    if r["candidatos"]:
        if fwhm_objetivo or area_objetivo:
            mejor = min(r["candidatos"], key=dist)
            r["motivo"] = f"{mejor['metodo']}: el más cercano al objetivo (FWHM {fwhm_objetivo}, área {area_objetivo} %)."
        else:
            mejor = r["candidatos"][0]
            r["motivo"] = f"{mejor['metodo']}: reducción moderada (sin objetivo). Mira la previa: sin anillos negros."
        r["recomendado"] = mejor["id"]
    r["leyenda"] = ("fwhm_px: tamaño de las estrellas no saturadas. area_pct: píxeles de estrella encendidos (> 0,05): "
                    "baja con halos más pequeños y menos débiles. La vista NO ha cambiado: aplicarCandidato(id).")
    return _galeria(r, p)


def _anillos_estrellas(L, n_max=400):
    """Máscara de anillo (3–12 px) alrededor de las estrellas brillantes (> p99,9), sin tocar otras estrellas."""
    umbral = float(np.percentile(L[::4, ::4], 99.9))
    nucleo = (L >= umbral).astype(np.float32)
    cerca = M._caja(nucleo, 3) > 0
    lejos = M._caja(nucleo, 12) > 0
    return lejos & ~cerca


def _halo_b_gon_mascara(p, reduction=1, linear=False, crecer=12, suavizar=4):
    """Halo-B-Gon solo alrededor de las estrellas. Su curva oscurece toda la imagen (M31, 16 nov 2026: el cielo de
    0,117 a 0,037 con reducción 1) y en la ventana de SASpro se usa con una máscara de estrellas: aquí, máscara de
    estrellas (paso alto > 5σ) crecida 'crecer' px para cubrir el halo y suavizada."""
    from setiastro.saspro.halobgon import compute_halo_b_gon
    rgb = np.repeat(p[0][..., None], 3, axis=2) if p.shape[0] == 1 else np.moveaxis(p, 0, -1)
    res = np.asarray(compute_halo_b_gon(np.clip(np.ascontiguousarray(rgb), 0, 1), int(reduction), bool(linear)),
                     dtype=np.float32)
    res = res.mean(axis=2)[None] if p.shape[0] == 1 else np.moveaxis(res, -1, 0)
    # La curva baja también el fondo: dentro de la máscara eso deja anillos oscuros (M31: 1–12 % del anillo bajo el
    # cielo). Se le devuelve el fondo de escala grande de la original, así solo baja el exceso de las estrellas y halos.
    res = np.stack([res[c] - M.suave(res[c], 64) + M.suave(p[c], 64) for c in range(p.shape[0])])
    L = M.lum(p)
    hp = L - M._caja(L, 5)
    v = hp[::4, ::4]
    s = 1.4826 * float(np.median(np.abs(v - np.median(v))))
    m = (M._caja((hp > 5 * max(s, 1e-9)).astype(np.float32), int(crecer)) > 0).astype(np.float32)
    m = np.clip(M.suave(m, 2 * int(suavizar)), 0, 1)[None]
    return np.clip(p * (1 - m) + res * m, 0, 1).astype(np.float32)


LOCALES["halo_b_gon_mascara"] = _halo_b_gon_mascara


def halosCandidatos(ctx, vista=None, reducciones=(1, 2, 3), lineal=False, cielo_max_pct=2.0):
    """NL halos de estrellas: Halo-B-Gon de SASpro (su función de cálculo) a varias reducciones (0–3), solo dentro de
    una máscara de estrellas crecida, frente a no hacer nada. Mide el
    brillo del halo en un anillo de 3–12 px alrededor de las estrellas brillantes (sobre el cielo), la FWHM, los anillos
    oscuros (píxeles del anillo por debajo del cielo − 3σ: corrección pasada) y el cambio del cielo. Recomienda la mayor
    reducción sin anillos oscuros nuevos ni cambio del cielo > cielo_max_pct %. La vista no cambia."""
    d = _doc(ctx, vista)
    p = _p(d.image)
    if not lineal and M.lineal(p[:, ::8, ::8]):
        raise RuntimeError("La imagen parece lineal: pasa lineal: true o estírala antes.")
    L0 = M.lum(p)
    anillo = _anillos_estrellas(L0)
    if anillo.sum() < 200:
        raise RuntimeError("No hay estrellas brillantes suficientes para medir halos.")
    c0 = M.cielo(p)

    def medir(q):
        L = M.lum(q)
        c = M.cielo(q)
        cie, rui = float(c["cielo"]), float(c["ruido"])
        fw, _ = _fwhm_estrellas(L)
        halo = float(np.median(L[anillo])) - cie
        oscuro = 100.0 * float((L[anillo] < cie - 3 * max(rui, 1e-6)).mean())
        return {"halo": _r(halo, 5), "fwhm_px": _r(fw, 2), "anillo_oscuro_pct": _r(oscuro, 2), "cielo": c["cielo"]}

    lista = [(f"Halo-B-Gon reducción {int(k)} (máscara de estrellas)", "halo_b_gon_mascara",
              {"reduction": int(k), "linear": bool(lineal)}) for k in (reducciones or [])]
    r = _comparar(ctx, d, "halos", lista, medir)
    m0 = medir(p)
    r["antes"] = m0
    for x in r["candidatos"]:
        m, fal = x["metricas"], []
        if m0["halo"] and m["halo"] is not None:
            m["halo_baja_pct"] = _r(100.0 * (1 - m["halo"] / m0["halo"]), 1) if m0["halo"] > 0 else None
        if (m["anillo_oscuro_pct"] or 0) - (m0["anillo_oscuro_pct"] or 0) > 1.0:
            fal.append(f"anillos oscuros alrededor de las estrellas ({m['anillo_oscuro_pct']} % del anillo bajo el cielo)")
        if c0["cielo"] and abs(float(m["cielo"]) / float(c0["cielo"]) - 1) * 100 > cielo_max_pct:
            fal.append(f"el cielo cambia más de un {cielo_max_pct:g} %")
        x["no_cumple"] = fal
    ok = [x for x in r["candidatos"] if not x["no_cumple"]]
    if ok:
        mejor = max(ok, key=lambda x: (x.get("preset") or {}).get("reduction", 0))
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: el halo baja un {mejor['metricas'].get('halo_baja_pct')} %, sin anillos oscuros "
                       "nuevos ni cambio del cielo. Míralo a 1:1 en estrellas brillantes.")
    else:
        r["recomendado"] = None
        r["motivo"] = "Ninguna reducción cumple (ver no_cumple): deja los halos o prueba reducciones menores."
    r["leyenda"] = ("halo: brillo medio del anillo de 3–12 px alrededor de las estrellas brillantes sobre el cielo. "
                    "anillo_oscuro_pct: parte del anillo por debajo del cielo − 3σ (halo quitado de más). "
                    "La vista NO ha cambiado: aplicarCandidato(id).")
    return _galeria(r, p)


def compararFinales(ctx, vistas):
    """Mide varias vistas ya estiradas (finales de distintos programas o versiones) con los mismos criterios: cielo,
    ruido relativo, dominante del cielo, contraste local y saturación del objeto, recortes, % de píxeles de estrella y
    FWHM de las estrellas. Solo lectura. Para comparar PixInsight / Siril / SASpro."""
    if isinstance(vistas, str):
        vistas = [v.strip() for v in vistas.split(";") if v.strip()]
    filas = []
    for v in vistas:
        d = _doc(ctx, v)
        p = _p(d.image)
        z = M.zonas_objeto_cielo(p)
        c = z["medidas"]
        L = M.lum(p)
        dom = None
        if p.shape[0] == 3:
            rgb = M.cielo_por_canal(p, c["_celdas"])
            dom = _r(100.0 * (max(rgb) - min(rgb)) / max(float(np.mean(rgb)), 1e-6), 2)
        fw, nfw = _fwhm_estrellas(L)
        filas.append({"vista": _nombre(d), "tam": [int(p.shape[2]), int(p.shape[1])], "lineal": M.lineal(p[:, ::8, ::8]),
                      "cielo": c["cielo"], "ruido_rel": c["ruido_rel"], "dominante_cielo_pct": dom,
                      "contraste_local_objeto": _r(M.contraste_local(L, z["obj_px"]), 5),
                      "sat_objeto": _r(float(M.saturacion(p)[z["obj_px"]].mean()), 3) if p.shape[0] == 3 and z["obj_px"].any() else None,
                      "p99": c["p99"], "estrellas_pct": _r(float(z["est_px"].mean() * 100), 2),
                      "fwhm_px": _r(fw, 2), "estrellas_medidas": nfw, **M.recortes(p),
                      **M.textura(L, z["obj_px"])})
    return {"filas": filas,
            "leyenda": "cielo: nivel del fondo. ruido_rel: ruido/cielo. dominante_cielo_pct: diferencia entre canales en el "
                       "cielo. contraste_local_objeto: estructura de escala media en el objeto. fwhm_px: tamaño de las "
                       "estrellas no saturadas (a la escala de cada imagen: un drizzle ×2 da el doble)."}


def _punto_negro(p, bp):
    bp = np.asarray(bp, dtype=np.float32).reshape(-1, 1, 1)
    return np.clip((p - bp) / np.maximum(1 - bp, 1e-6), 0, 1).astype(np.float32)


def _punto_negro_medios(p, bp, t, obj_px, m_obj):
    """Punto negro y después una curva que deja el cielo en t (lo que está por debajo no cambia) y devuelve la mediana
    del objeto a la de antes (MTF sobre el tramo t–1): el fondo se oscurece sin apagar la nebulosa, como el punto negro
    + curva en S de la versión de referencia de IC 1396 (15 nov 2026: el punto negro solo dejaba la nebulosa oscura)."""
    q = _punto_negro(p, bp)
    L = M.lum(q)
    m1 = float(np.median(L[obj_px])) if obj_px.any() else float(np.median(L))
    x, y = (m1 - t) / (1 - t), (m_obj - t) / (1 - t)
    if not (0 < x < y < 1):
        return q
    mt = x * (y - 1) / (2 * x * y - x - y)              # MTF(mt, x) = y
    u = np.clip((q - t) / (1 - t), 0, 1)
    v = (mt - 1) * u / ((2 * mt - 1) * u - mt)
    return np.where(q > t, t + (1 - t) * v, q).astype(np.float32)


def fondoCandidatos(ctx, vista=None, cielos=(0.08, 0.065, 0.05), ceros_max=2.0):
    """NL5 fondo: punto negro por canal para dejar el cielo en varios niveles (más oscuro = más profundidad y
    contraste) y neutro; mide píxeles nuevos a 0, cielo y ruido, y recomienda el más oscuro que no recorta más del
    ceros_max % de los píxeles. La vista no cambia. IC 1396 (15 nov 2026): los finales con el cielo en 0,12–0,13
    salían grises y planos frente a la versión de Rafael (cielo ~0,02 con punto negro y curva)."""
    d = _doc(ctx, vista)
    p = _p(d.image)
    if M.lineal(p[:, ::8, ::8]):
        raise RuntimeError("La imagen parece lineal: el nivel del fondo se ajusta después de estirar (y de recombinar).")
    z = M.zonas_objeto_cielo(p)
    cel = z["medidas"]["_celdas"]
    s0 = M.cielo_por_canal(p, cel) if p.shape[0] == 3 else [float(z["medidas"]["cielo"])]
    rec0 = M.recortes(p)
    r0 = float(z["medidas"]["ruido"])
    obj_px = z["obj_px"] if z["obj_px"].any() else np.ones(p.shape[1:], bool)
    m_obj = float(np.median(M.lum(p)[obj_px]))

    def medir(q):
        c = M.cielo(q)
        rgb = M.cielo_por_canal(q, cel) if q.shape[0] == 3 else [c["cielo"]]
        return {"cielo": _r(float(np.mean(rgb)), 4), "cielo_rgb": [_r(x, 4) for x in rgb],
                "objeto_mediana": _r(float(np.median(M.lum(q)[obj_px])), 4),
                "ruido_rel": _r(float(c["ruido"]) / max(r0, 1e-9), 3), **M.recortes(q)}

    lista = []
    for t in sorted(cielos or [], reverse=True):
        # Basta con que el cielo medio esté por encima: un canal ya por debajo no se toca (bp 0). Antes se saltaba el
        # nivel si cualquier canal estaba por debajo y con [0,094, 0,075, 0,06] sólo quedaban 0,05 y 0,03 (IC 1396).
        if float(np.mean(s0)) <= t:
            continue
        bp = [max(0.0, (s - t) / (1 - t)) for s in s0]
        lista.append((f"cielo a {t:g}", "punto_negro", {"bp": bp}, (lambda q, bp: _punto_negro(q, bp))))
        lista.append((f"cielo a {t:g} + medios", "punto_negro_medios", {"bp": bp, "t": float(t)},
                      (lambda q, bp, t: _punto_negro_medios(q, bp, t, obj_px, m_obj))))
    if not lista:
        return {"vista": _nombre(d), "candidatos": [], "recomendado": None,
                "motivo": f"El cielo ya está en {_r(float(np.mean(s0)), 3)}, igual o por debajo de los niveles pedidos."}
    r = _comparar(ctx, d, "fondo", lista, medir)
    for x in r["candidatos"]:
        m = x["metricas"]
        # ceros_pct cuenta también los que ya estaban a 0: Qwen lo leyó como recorte del candidato y no aplicó el
        # recomendado (IC 1396, 15 nov 2026). Lo que decide es ceros_nuevos_pct.
        m["ceros_nuevos_pct"] = _r(m["ceros_pct"] - rec0["ceros_pct"], 3)
        x["no_cumple"] = ([f"recorta a 0 un {m['ceros_nuevos_pct']} % más (máx {ceros_max} %)"]
                          if m["ceros_nuevos_pct"] > ceros_max else [])
    ok = [x for x in r["candidatos"] if not x["no_cumple"]]
    if ok:
        # El más oscuro; a igual cielo, el que conserva los medios del objeto (+ medios).
        mejor = min(ok, key=lambda x: (x["metricas"]["cielo"], 0 if x["metodo"].endswith("+ medios") else 1))
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: el cielo más oscuro (de {_r(float(np.mean(s0)), 3)} a {mejor['metricas']['cielo']}), "
                       f"la mediana del objeto en {mejor['metricas']['objeto_mediana']} (antes {_r(m_obj, 4)}) "
                       f"y neutro (mismo nivel en R, G y B); lleva a 0 sólo un {mejor['metricas']['ceros_nuevos_pct']} % más de "
                       f"los píxeles (ya en porcentaje: menos de {max(1, int(np.ceil(mejor['metricas']['ceros_nuevos_pct'])))} de "
                       f"cada 100; límite {ceros_max} %, la referencia de IC 1396 tiene un 3 % en negro): APLÍCALO salvo que "
                       "la previa muestre la nebulosa débil comida.")
    else:
        r["motivo"] = "Todos recortan demasiado: deja el fondo como está o pide un nivel más alto."
    r["antes"] = {"cielo_rgb": [_r(x, 4) for x in s0]}
    return _galeria(r, p, None)


def saturacionCandidatos(ctx, vista=None, cantidades=(0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 2.5), proteger_cielo=True,
                         dominante_max=5.0, ceros_max=0.5, satchroma=(0.25, 0.5), sat_max=0.80):
    """NL5 saturación: satura conservando la luminancia (propio) a varias cantidades y con SatChroma de SASpro (croma
    Lab, ganancia uniforme 1 + k); mide saturación del objeto y del cielo, dominante del cielo y recortes nuevos, y
    recomienda la mayor que cumple. La vista no cambia."""
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
    lista += [(f"SatChroma croma ×{1 + k:g}", "satchroma",
               {"mode": 1, "strength": 1.0,
                "points": [[i / 6.0, 1.0 + float(k)] for i in range(7)]}) for k in (satchroma or [])]
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
        if m["ceros_pct"] - m0["ceros_pct"] > ceros_max:   # 15 nov 2026: con 0,05 fallaba todo tras bajar el fondo (polvo negro a 0)
            fal.append("canales a 0 nuevos (colores fuera de rango)")
        if go is not None and gc > max(go, 5.0):
            fal.append("el cielo gana más color que el objeto")
        x["no_cumple"] = fal
    ok = [x for x in r["candidatos"] if not x["no_cumple"]]
    # Techo de saturación del objeto (IC 405, 19 nov 2026): «la mayor que cumple» llevó a +1 (sat 0,87) y el rojo salió
    # pasado; las referencias de Rafael quedan en 0,45–0,65 medidas en el JPG y Opus eligió +0,75 (≈ 0,80 aquí).
    if any((x["metricas"]["sat_objeto"] or 0) <= sat_max for x in ok):
        ok = [x for x in ok if (x["metricas"]["sat_objeto"] or 0) <= sat_max]
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
        r["aviso"] = (f"El cielo ya tiene una dominante del {m0['dominante_cielo_pct']} %: saturar la amplifica. Corrígela "
                      "antes con fondoCandidatos (cielo oscuro y neutro, 0,05–0,08) y vuelve a saturar; tras una paleta la "
                      "dominante del cielo es normal y fondoCandidatos la quita (IC 405, 19 nov 2026: sin ese paso no se saturó).")
    return _galeria(r, p)


def estirarEstrellas(ctx, vista, factores=(3.0, 5.0), color=1.0, p90_objetivo=0.07, p90_variantes=(0.05, 0.10)):
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
    # IC 1396 (15 nov 2026): Star Stretch 3 y 5 dejaban las estrellas casi invisibles (p90 0,0006–0,006) y el único
    # arcsinh (p90 0,10) hinchaba HD 206267 y daba un 8 % de aporte. Varios arcsinh y el objetivo en 0,07.
    for p90 in sorted({float(p90_objetivo), *[float(x) for x in (p90_variantes or [])]}):
        lista.append((f"arcsinh propio (p90 estrellas {p90:g})", "asinh_propio", {"p90": p90}, asinh))

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


def recombinarEstrellas(ctx, estrellas, vista=None, metodo="screen", factor=1.0, forzar=False):
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
    pct = _pct_estrellas(d)
    # 1 %: una starless con contraste de escala grande daba 0,6 % y se negaba (IC 1396 c7); con estrellas sale > 3 %.
    if pct > 1.0 and not forzar:
        # IC 1396 (14 nov 2026): la paleta salía de capas con estrellas y se recombinaron otra vez: estrellas dobles.
        return {"aplicado": False, "estrellas_en_vista_pct": _r(pct, 2),
                "aviso": f"'{_nombre(d)}' ya tiene estrellas ({pct:.1f} % de píxeles de estrella; una starless da < 0,5 %): "
                         "recombinar las duplicaría. forzar: true si de verdad quieres sumarlas."}
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


# Rangos de partida de BlurXTerminator por tipo de campo (los mismos que bxtCandidatos de PixInsight,
# guia/herramientas/deconvolucion.js).
BXT_RANGOS = {"nebulosa": {"stars": 0.30, "ns": (0.25, 0.45, 0.65)},
              "galaxia": {"stars": 0.18, "ns": (0.20, 0.30, 0.40)},
              "cumulo": {"stars": 0.25, "ns": (0.00, 0.10, 0.20)},
              "snr_bajo": {"stars": 0.15, "ns": (0.10, 0.20, 0.25)}}


def deconvolucionCandidatos(ctx, vista=None, tipo="nebulosa", nonstellar=None, stars=None, halos=0.0,
                            correct_only=True):
    """L11/L13 deconvolución con BlurXTerminator (RC Astro, con su programa rc-astro), en lineal: solo corrección y
    una rejilla de nonstellar (rango por tipo de campo, como bxtCandidatos de PixInsight) frente a no hacer nada. Mide
    FWHM de las estrellas, anillos oscuros alrededor de las brillantes (ringing), «gusanos» (alta frecuencia del cielo
    frente a BXT con nonstellar 0) y contraste fino del objeto. Recomienda el nonstellar más alto sin ringing nuevo y
    con gusanos ≤ 1,3. La vista no cambia (aplicarCandidato)."""
    if not _rc.hay("bxt"):
        e = _rc.estado()
        raise RuntimeError("BlurXTerminator no está disponible: " + (
            "no encuentro rc-astro (RC Astro CLI)." if not e.get("exe") else "sin licencia válida en rc-astro."))
    d = _doc(ctx, vista)
    p = _p(d.image)
    if not M.lineal(p[:, ::8, ::8]):
        raise RuntimeError("La imagen parece estirada: BlurXTerminator va en lineal (después del color).")
    rg = BXT_RANGOS.get(str(tipo), BXT_RANGOS["nebulosa"])
    ns_lista = [float(x) for x in (nonstellar or rg["ns"])]
    st = float(rg["stars"] if stars is None else stars)
    L0 = M.lum(p)
    z = M.zonas_objeto_cielo(p)
    cpx, obj = z["cielo_px"], (z["obj_px"] if z["obj_px"].any() else None)
    anillo = _anillos_estrellas(L0)
    c0 = M.cielo(p)

    def hf(L, m):
        if m is None or not m.any():
            return None
        return float(np.sqrt(np.mean((L - M._caja(L, 1))[m] ** 2)))

    def medir(q):
        L = M.lum(q)
        c = M.cielo(q)
        cie, rui = float(c["cielo"]), float(c["ruido"])
        fw, nfw = _fwhm_estrellas(L)
        osc = 100.0 * float((L[anillo] < cie - 3 * max(rui, 1e-9)).mean()) if anillo.any() else None
        return {"fwhm_px": _r(fw, 2), "estrellas_medidas": nfw, "anillo_oscuro_pct": _r(osc, 2),
                "hf_cielo": _r(hf(L, cpx), 7), "hf_objeto": _r(hf(L, obj), 7),
                "ruido_vs_antes": _r(c["ruido"] / max(c0["ruido"], 1e-12), 3)}

    lista = []
    if correct_only:
        lista.append(("BXT solo corrección", "rc_bxt", {"correct_only": True}))
    ref_preset = {"stars": st, "nonstellar": 0.0, "halos": float(halos)}
    lista.append((f"BXT estrellas {st:g}, no estelar 0 (referencia)", "rc_bxt", ref_preset))
    lista += [(f"BXT estrellas {st:g}, no estelar {ns:g}", "rc_bxt", {"stars": st, "nonstellar": ns, "halos": float(halos)})
              for ns in ns_lista if ns > 0]
    r = _comparar(ctx, d, "deconv", lista, medir)
    m0 = medir(p)
    r["antes"] = m0
    ref = next((x for x in r["candidatos"] if x["preset"] == ref_preset), None)
    for x in r["candidatos"]:
        m, fal = x["metricas"], []
        if ref is not None and not x["preset"].get("correct_only"):
            rm = ref["metricas"]
            m["gusanos"] = _r(m["hf_cielo"] / rm["hf_cielo"], 3) if rm.get("hf_cielo") else None
            m["contraste"] = _r(m["hf_objeto"] / rm["hf_objeto"], 3) if rm.get("hf_objeto") else None
            if (m["gusanos"] or 0) > 1.3:
                fal.append(f"gusanos: alta frecuencia del cielo ×{m['gusanos']} frente a no estelar 0 (máx. 1,3)")
        if m0["anillo_oscuro_pct"] is not None and (m["anillo_oscuro_pct"] or 0) - m0["anillo_oscuro_pct"] > 1.0:
            fal.append(f"ringing: anillos oscuros alrededor de las estrellas ({m['anillo_oscuro_pct']} % del anillo)")
        if m0["fwhm_px"] and m["fwhm_px"] and m["fwhm_px"] > m0["fwhm_px"] * 1.02:
            fal.append("la FWHM no baja")
        x["no_cumple"] = fal
    ok = [x for x in r["candidatos"] if not x["no_cumple"]]
    con_ns = [x for x in ok if not x["preset"].get("correct_only")]
    mejor = (max(con_ns, key=lambda x: x["preset"].get("nonstellar", 0)) if con_ns else
             next((x for x in ok if x["preset"].get("correct_only")), None))
    if mejor:
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: FWHM {m0['fwhm_px']} → {mejor['metricas']['fwhm_px']} px, sin ringing nuevo"
                       + ("" if mejor["preset"].get("correct_only") else
                          f" y gusanos ×{mejor['metricas'].get('gusanos')}")
                       + ". Míralo a 1:1 en el objeto débil (textura «crujiente») y en estrellas brillantes.")
    else:
        r["motivo"] = "Ninguno cumple (ver no_cumple): prueba nonstellar más bajo, o solo corrección, y revisa a ojo."
    r["leyenda"] = ("fwhm_px: FWHM mediana de estrellas aisladas. anillo_oscuro_pct: parte del anillo de 3–12 px alrededor "
                    "de las brillantes por debajo del cielo − 3σ (ringing). gusanos / contraste: alta frecuencia del "
                    "cielo / del objeto frente a BXT con no estelar 0 (> 1,3 en el cielo = textura nueva). Si BXT crea "
                    "gusanos, NoiseX los acentúa: bajar BXT, no subir el denoise. La vista NO ha cambiado: "
                    "aplicarCandidato(id).")
    r["rc_astro"] = {k: v for k, v in _rc.estado().items() if k in ("version", "exe")}
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
        # IC 1396 (14 nov 2026): Qwen comparó el gradiente de cinco capas seguidas y luego aplicó los cinco; cada comparación
        # del mismo tipo sustituye los candidatos de la anterior y fallaron cuatro.
        otra = datos.get("uid") and getattr(d, "uid", None) and datos.get("uid") != d.uid
        if otra:
            v = ctx.get_document(datos["uid"])
            raise RuntimeError(f"El candidato '{id}' es de la última comparación, hecha sobre "
                               f"'{_nombre(_base(v)) if v is not None else datos['uid']}', no sobre esta vista: cada "
                               "comparación del mismo tipo sustituye a la anterior. Compara y aplica vista por vista "
                               "(comparación → aplicarCandidato → siguiente vista).")
        raise RuntimeError("La vista ha cambiado desde la comparación (otra imagen o ya se aplicó algo): repite la comparación.")
    d.apply_edit(a.astype(np.float32, copy=False), metadata={}, step_name=f"SetiAstroPilot: {datos.get('nombre', id)}")
    m = M.cielo(_p(d.image))
    return {"aplicado": str(id), "metodo": datos.get("nombre"), "proceso": datos.get("proceso"),
            "preset": datos.get("preset"), "vista": _nombre(d), "medidas": M.sin_privado(m),
            "nota": "Guarda esta versión con guardarImagen (v1, v2…) antes del paso siguiente."}


# --- Pasos sencillos (un proceso de SASpro con lo que pide la guía) -----------------------------------------

def quitarPatron2px(ctx, vista=None):
    """L7/L14: quita el patrón fijo de periodo 2 px (filas, columnas y diagonal alternas: resto de la matriz Bayer de un
    master OSC) de cada canal de la vista, con deshacer. Sirve para capas ya separadas o ya sin ruido: tras un denoise
    fuerte la malla pasa del 1 % al 15 % de la escala fina (IC 1396, 15 nov 2026). desmezclarDualBand ya lo hace."""
    d = _doc(ctx, vista)
    p = _p(d.image)
    q = np.empty_like(p)
    pct = []
    for i in range(p.shape[0]):
        pt = M.patron_2px(p[i])
        hp = p[i] - M._caja(p[i], 1)
        pct.append(_r(100.0 * float(np.std(pt[::3, ::3])) / max(float(np.std(hp[::3, ::3])), 1e-12), 2))
        q[i] = np.clip(p[i] - pt, 0, 1)
    d.apply_edit(_a_sas(q, d.image), metadata={}, step_name="SetiAstroPilot: quitar patrón de 2 px")
    return {"vista": _nombre(d), "patron_pct_escala_fina": pct,
            "nota": "Con deshacer. Por encima del ~5 % la malla se ve a 1:1; por debajo del 1 % no se nota."}


def quitarVerde(ctx, vista=None, cantidad=1.0, modo="avg", metodo="propio", forzar=False):
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
    antes0 = _color(d)
    cie = antes0["cielo_RGB"] if antes0 else None
    if cie and cie[1] <= (max(cie[0], cie[2]) if modo == "max" else 0.5 * (cie[0] + cie[2])) and not forzar:
        # IC 1396 (14 nov 2026): el cielo ya tenía G por debajo de R y B y el SCNR subió la dominante de 1,2 a 2,1 %.
        return {"vista": _nombre(d), "aplicado": False, "antes": antes0,
                "aviso": "El cielo no tiene exceso de verde (G ≤ media de R y B): no hace falta SCNR. forzar: true para "
                         "aplicarlo igualmente (p. ej. verde sólo en la nebulosa)."}
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


def _pct_estrellas(d):
    """% de píxeles de estrella (picos compactos > 5σ): ~0 en una starless."""
    p = _p(d.image)[:, ::2, ::2]
    return float(M.zonas_objeto_cielo(p)["est_px"].mean() * 100.0)


def _gemelas_con_estrellas(ctx, d):
    """Otras vistas abiertas del mismo tamaño y con estrellas. Primero las imágenes completas (master, versiones con
    estrellas) y al final las de sólo estrellas: en M31 el resolvedor Gaia no encontró nada en la capa de estrellas
    lineal y sí en la imagen completa."""
    forma = np.shape(d.image)[:2]
    cands = [x for x in _docs(ctx) if x is not d and np.shape(x.image)[:2] == forma]
    cands = [x for x in cands if _pct_estrellas(x) > 0.5]
    cands.sort(key=lambda x: (1 if ("estrell" in _nombre(x).lower() or "stars" in _nombre(x).lower()) else 0))
    return cands


def _a_grados(v, es_ra):
    """RA/Dec en cualquier formato habitual -> grados (float) o None. Un número va en grados (como RA, DEC y CRVAL en
    FITS); un texto sexagesimal ('00h42m44s', '0 42 44.3', '00:42:44') va en horas para la RA y en grados para la Dec
    ('+41d16m09s', '+41°16′09″'). SASpro rechazaba '00h42m44s' («RA/Dec fields are invalid/empty»)."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().lower()
    try:
        return float(s)
    except ValueError:
        pass
    signo = -1.0 if s.startswith("-") else 1.0
    nums = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", s)]
    if not nums:
        return None
    g = nums[0] + (nums[1] / 60 if len(nums) > 1 else 0) + (nums[2] / 3600 if len(nums) > 2 else 0)
    return g * 15.0 if es_ra else signo * g


def _sexagesimal(grados, es_ra):
    """Grados -> 'HH:MM:SS.ss' (RA, en horas) o '±DD:MM:SS.s' (Dec). SASpro acepta la RA «en horas o grados» y un
    número ≤ 24 lo toma por horas: 10,68° se leía como 10,68 h = 160° y la pasada con semilla fallaba (M31)."""
    v = (grados / 15.0) % 24.0 if es_ra else abs(grados)
    h = int(v)
    m = int((v - h) * 60)
    s = (v - h - m / 60.0) * 3600.0
    if s >= 59.995:
        s, m = 0.0, m + 1
    if m >= 60:
        m, h = 0, h + 1
    if es_ra:
        return f"{h % 24:02d}:{m:02d}:{s:05.2f}"
    return f"{'-' if grados < 0 else '+'}{h:02d}:{m:02d}:{s:04.1f}"


def _copiar_wcs(origen, destino):
    mo, md = _meta(origen), _meta(destino)
    for k in ("wcs", "wcs_header", "sip_wcs", "original_wcs"):
        if mo.get(k) is not None:
            md[k] = mo[k]
    h, w = md.get("fits_header") or md.get("original_header"), mo.get("wcs_header")
    if h is not None and w is not None:
        try:
            for k in w.keys():
                if k not in ("SIMPLE", "BITPIX", "NAXIS", "NAXIS1", "NAXIS2", "NAXIS3", "EXTEND", "COMMENT", "HISTORY", ""):
                    h[k] = w[k]
        except Exception:
            pass


def resolverAstrometria(ctx, vista=None, ra=None, dec=None, escala=None, solucionador="gaia_only", ciega=False):
    """L8: plate solve de SASpro. Por defecto con su índice Gaia local (gaia_only): ASTAP y astrometry.net sólo si se
    piden y están configurados en SASpro. Semilla: ra/dec/escala dados, o los de la cabecera (RA/DEC u OBJCTRA/OBJCTDEC,
    FOCALLEN + XPIXSZ); ciega: true sin semilla. Una starless no tiene estrellas: se resuelve la vista gemela con
    estrellas (misma forma) y se copia su astrometría."""
    d = _doc(ctx, vista)
    if solucionador not in ("gaia_only", "both", "astap_only", "astrometry_only"):
        raise ValueError("solucionador: gaia_only, both, astap_only o astrometry_only.")
    pct = _pct_estrellas(d)
    objetivos = [d]
    if pct < 0.5:                 # M31: starless 0,05–0,19 %, con estrellas 3,6–4,7 %
        objetivos = _gemelas_con_estrellas(ctx, d)
        if not objetivos:
            raise RuntimeError(f"'{_nombre(d)}' no tiene estrellas ({pct:.3f} % de píxeles de estrella: ¿starless?) y no hay "
                               "otra vista abierta del mismo tamaño con estrellas: abre la de estrellas o el master y "
                               "resuelve ese (se copia la astrometría).")
    fallos, r = [], None
    for objetivo in objetivos:
        cab = _cabecera(objetivo) or _cabecera(d)
        esc = escala if escala is not None else _escala(cab)
        ra1, dec1 = ra, dec
        if not ciega and (ra1 is None or dec1 is None):
            ra1 = ra1 if ra1 is not None else cab.get("RA") or cab.get("OBJCTRA") or cab.get("CRVAL1")
            dec1 = dec1 if dec1 is not None else cab.get("DEC") or cab.get("OBJCTDEC") or cab.get("CRVAL2")
        preset = {"solver": solucionador}
        ra_g, dec_g = _a_grados(ra1, True), _a_grados(dec1, False)
        if ciega or ra_g is None or dec_g is None:
            preset["seed_mode"] = "none"
        elif _sas_al_menos(1, 24, 5):
            # 1.24.5: unidades explícitas (una RA decimal ≤ 24 sin unidad se sigue leyendo en horas, como en el diálogo).
            preset.update(seed_mode="manual", ra_deg=float(ra_g), dec_deg=float(dec_g))
        else:
            preset.update(seed_mode="manual", ra=_sexagesimal(ra_g, True), dec=_sexagesimal(dec_g, False))
        if esc:
            preset["scale"] = float(esc)
        try:
            r = procesoSAS(ctx, "plate_solve", preset, getattr(objetivo, "uid", None) or _nombre(objetivo))
            break
        except Exception as e:
            fallos.append(f"'{_nombre(objetivo)}' (estrellas {_pct_estrellas(objetivo):.2f} %, semilla "
                          f"{preset.get('seed_mode')}, escala {esc}): {e}")
    if r is None:
        pista = ("" if escala else " Sin escala la resolución ciega casi nunca encuentra: pasa escala (\"/px, de "
                 "analizarMaster o de FOCALLEN y XPIXSZ).")
        raise RuntimeError("No se ha podido resolver. " + " | ".join(fallos) + pista)
    r_extra = {}
    if objetivo is not d:
        r_extra = {"resuelta_en": _nombre(objetivo), "nota": "La vista no tiene estrellas: se resolvió una gemela con "
                                                             "estrellas y se copió su astrometría."}
    if fallos:
        r_extra["intentos_fallidos"] = fallos
    if objetivo is not d and _tiene_wcs(objetivo):
        _copiar_wcs(objetivo, d)
    r.update(r_extra, semilla=preset.get("seed_mode"), escala_usada=_r(escala, 3) if escala else None,
             vista=_nombre(d), astrometria=_tiene_wcs(d))
    r.pop("aviso", None)
    return r


def separarEstrellas(ctx, vista=None, motor="starnet", lineal=None, unscreen=False):
    """L15: separa estrellas con StarNet o DarkStar (remove_stars), SyQon (syqon_starless) o StarXTerminator de RC Astro
    (motor starx). Crea la vista de estrellas aparte y deja la starless en la vista."""
    d = _doc(ctx, vista)
    if lineal is None:
        lineal = M.lineal(_p(d.image)[:, ::8, ::8])
    antes = {id(x) for x in _docs(ctx)}
    if motor in ("starx", "sxt", "starxterminator"):
        t0 = time.perf_counter()
        sl, est = _rc.correr(_p(d.image), "sxt", unscreen=bool(unscreen))
        d.apply_edit(_a_sas(sl, d.image), metadata={}, step_name="RC Astro StarXTerminator (sin estrellas)")
        m = dict(_meta(d))
        m.pop("file_path", None)
        nombre = f"{_nombre(d)}_estrellas"
        m["display_name"] = nombre
        ctx.open_new_document(_a_sas(est, d.image), metadata=m, name=nombre)
        r = {"proceso": "rc_sxt", "vista": _nombre(d), "segundos": _r(time.perf_counter() - t0, 1), "cambio": True,
             "estrellas": "pantalla (unscreen)" if unscreen else "original − sin estrellas"}
        r["vistas_nuevas"] = [_nombre(x) for x in _docs(ctx) if id(x) not in antes]
        r["vista_activa"] = _reactivar(ctx, d)
        return r
    if motor in ("starnet", "darkstar"):
        r = procesoSAS(ctx, "remove_stars", {"tool": motor, "linear": bool(lineal)}, vista)
    elif motor == "syqon":
        r = procesoSAS(ctx, "syqon_starless", {"starless_make_stars": True}, vista)
    else:
        raise ValueError("motor: starnet, darkstar, syqon o starx.")
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
    # SASpro 1.24.5: ctx.close_document(doc, force). Con force no pregunta (la comprobación de cambios ya está arriba).
    if hasattr(ctx, "close_document"):
        try:
            ctx.close_document(d, force=True)
            return {"cerrada": nombre, "abiertas": [_nombre(x) for x in _docs(ctx)], "metodo": "close_document"}
        except TypeError:
            pass                                   # firma distinta: se sigue con el cierre de la subventana
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
    "diagnosticoManchas": diagnosticoManchas,
    "estirarCandidatos": estirarCandidatos,
    "ruidoCandidatos": ruidoCandidatos,
    "nucleoCandidatos": nucleoCandidatos,
    "contrasteCandidatos": contrasteCandidatos,
    "compararFinales": compararFinales,
    "saturacionCandidatos": saturacionCandidatos,
    "fondoCandidatos": fondoCandidatos,
    "nitidezCandidatos": nitidezCandidatos,
    "deconvolucionCandidatos": deconvolucionCandidatos,
    "estirarEstrellas": estirarEstrellas,
    "recombinarEstrellas": recombinarEstrellas,
    "aplicarCandidato": aplicarCandidato,
    "quitarVerde": quitarVerde,
    "quitarPatron2px": quitarPatron2px,
    "reducirEstrellasCandidatos": reducirEstrellasCandidatos,
    "halosCandidatos": halosCandidatos,
    "neutralizarFondo": neutralizarFondo,
    "calibrarColor": calibrarColor,
    "resolverAstrometria": resolverAstrometria,
    "separarEstrellas": separarEstrellas,
}

# Consultas a internet (SIMBAD, Wikipedia, una página): en web.py, como en Siril. Se niegan si la casilla Internet del
# chat está desmarcada (~/.setiastropilot/sin-internet).
import web as _web  # noqa: E402  (web importa este módulo: va al final)

LISTA.update(_web.LISTA_WEB)

# Varios masters (alinear por astrometría, dual band, combinar con el RGB): en multicapa.py, como en Siril.
import multicapa as _multicapa  # noqa: E402

LISTA.update(_multicapa.LISTA_MULTICAPA)

# Máscaras y PixelMath: en mascaras.py.
import mascaras as _mascaras  # noqa: E402

LISTA.update(_mascaras.LISTA_MASCARAS)

# Alinear por estrellas, Cosmetic Correction, pedestal y FWHM: en utilidades.py.
import utilidades as _utilidades  # noqa: E402

LISTA.update(_utilidades.LISTA_UTILIDADES)
