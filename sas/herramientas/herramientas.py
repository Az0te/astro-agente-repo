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


def _doc(ctx, vista=None):
    if vista:
        d = ctx.get_document(str(vista))
        if d is None:
            d = ctx.get_document_by_view_name(str(vista))
        if d is None:
            nombres = ", ".join(_nombre(x) for x in _docs(ctx)) or "ninguna"
            raise RuntimeError(f"No hay ninguna vista '{vista}'. Abiertas: {nombres}.")
    else:
        d = ctx.base_document() or ctx.active_document()
        if d is None:
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


def _jpg(p, ruta, calidad=90):
    """(canales, alto, ancho) 0–1 -> JPG. PIL (va con SASpro) o, si no está, QImage."""
    a = (np.clip(p, 0, 1) * 255 + 0.5).astype(np.uint8)
    a = np.ascontiguousarray(a[0] if a.shape[0] == 1 else np.moveaxis(a, 0, -1))
    try:
        from PIL import Image
        Image.fromarray(a).save(ruta, "JPEG", quality=calidad)
    except ImportError:
        from PyQt6.QtGui import QImage
        h, w = a.shape[:2]
        fmt = QImage.Format.Format_Grayscale8 if a.ndim == 2 else QImage.Format.Format_RGB888
        QImage(a.data, w, h, a.strides[0], fmt).save(str(ruta), "JPG", calidad)
    return str(ruta)


def _reducir(p, lado):
    paso = max(1, int(np.ceil(max(p.shape[1], p.shape[2]) / max(64, int(lado)))))
    if paso == 1:
        return p
    h, w = p.shape[1] // paso * paso, p.shape[2] // paso * paso
    return p[:, :h, :w].reshape(p.shape[0], h // paso, paso, w // paso, paso).mean(axis=(2, 4))


def _seguro(nombre):
    return re.sub(r"[^\w\-.]+", "_", nombre).strip("_") or "imagen"


# --- Herramientas: lectura ---------------------------------------------------------------------------------

def ping(ctx):
    """Comprueba que el puente y SASpro responden."""
    try:
        from setiastro.saspro import __version__ as v_sas
    except Exception:
        v_sas = None
    act = None
    try:
        d = ctx.base_document() or ctx.active_document()
        act = _nombre(_base(d)) if d is not None else None
    except Exception:
        pass
    return {"herramientas": VERSION, "saspro": v_sas, "vistas_abiertas": len(_docs(ctx)), "vista_activa": act}


def vistas(ctx):
    """Vistas abiertas en SASpro: nombre, uid, tamaño, canales, fichero, pasos de deshacer, si está activa."""
    activa = None
    try:
        activa = _base(ctx.base_document() or ctx.active_document())
    except Exception:
        pass
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
    _jpg(q, ruta)
    return {"fichero": str(ruta), "ancho": int(q.shape[2]), "alto": int(q.shape[1]), "lineal": bool(lin),
            "autoestirado": bool(lin), "enlazado": bool(enlazado), "escala": _r(q.shape[2] / (x1 - x0), 3),
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
    ctx.save_image(img, str(p), original_format=fmt, bit_depth=bits, original_header=m.get("original_header"),
                   is_mono=(np.ndim(img) == 2), image_meta=m.get("image_meta"), file_meta=m.get("file_meta"))
    if not p.exists():
        raise RuntimeError(f"SASpro no ha escrito {p}.")
    return {"fichero": str(p), "formato": fmt, "bits": bits, "bytes": p.stat().st_size, "vista": _nombre(d)}


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
    return ctx.run_command(cid, dict(preset or {}), target_doc=doc)


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
    for n, (nombre, proceso, preset) in enumerate(lista, 1):
        t0 = time.perf_counter()
        try:
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


def estirarCandidatos(ctx, vista=None, medianas=(0.15, 0.25), ghs=True):
    """Paso NL1: estirado estadístico de SASpro (enlazado y por canal, varias medianas) y GHS, medidos con los
    criterios de la ficha: cielo, ruido relativo, recortes en negro y en blanco. La vista no cambia."""
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


def ruidoCandidatos(ctx, vista=None, fuerzas=(0.3, 0.5, 0.7), usar_graxpert=True):
    """Pasos L14/NL6: Cosmic Clarity denoise a varias fuerzas y GraXpert denoise frente a no hacer nada: ruido del
    cielo y detalle que se pierde (< 10 %). La vista no cambia."""
    d = _doc(ctx, vista)
    p = _p(d.image)
    c0 = M.cielo(p)
    det0 = M.energia_detalle(M.lum(p))
    lista = [(f"Cosmic Clarity denoise {f}", "cosmic_clarity",
              {"mode": "denoise", "denoise_luma": float(f), "denoise_color": float(f), "create_new_view": False})
             for f in fuerzas or []]
    if usar_graxpert:
        lista.append(("GraXpert denoise 0,5", "graxpert", {"op": "denoise", "strength": 0.5}))

    def medir(q):
        c = M.cielo(q)
        det = M.energia_detalle(M.lum(q))
        return {"ruido_rel": c["ruido_rel"], "ruido_vs_antes": _r(c["ruido"] / max(c0["ruido"], 1e-9), 3),
                "detalle_perdido_pct": _r(100.0 * (1 - det / max(det0, 1e-12)), 1), "cielo": c["cielo"]}

    r = _comparar(ctx, d, "ruido", lista, medir)
    buenos = [x for x in r["candidatos"] if (x["metricas"]["detalle_perdido_pct"] or 100) < 10]
    if buenos:
        mejor = min(buenos, key=lambda x: x["metricas"]["ruido_vs_antes"] or 9)
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: deja el {round(100 * mejor['metricas']['ruido_vs_antes'])} % del ruido y "
                       f"pierde el {mejor['metricas']['detalle_perdido_pct']} % del detalle (< 10 %).")
    else:
        r["motivo"] = "Ningún candidato baja el ruido sin perder ≥ 10 % del detalle: mejor no aplicar o probar más suave."
    r["antes"] = {"ruido_rel": c0["ruido_rel"]}
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

def quitarVerde(ctx, vista=None, cantidad=1.0, modo="avg"):
    """NL3 SCNR: Remove Green de SASpro (modo avg/max/min), conservando la luminosidad."""
    return procesoSAS(ctx, "remove_green", {"amount": float(cantidad), "mode": modo, "preserve_lightness": True}, vista)


def neutralizarFondo(ctx, vista=None, rect=None):
    """Neutraliza el fondo (Background Neutralization). rect opcional [x0, y0, x1, y1] de cielo limpio."""
    d = _doc(ctx, vista)
    preset = {"mode": "auto"}
    if rect:
        h, w = d.image.shape[:2]
        x0, y0, x1, y1 = _rect(rect, w, h)
        preset = {"mode": "rect", "rect_norm": [x0 / w, y0 / h, (x1 - x0) / w, (y1 - y0) / h]}
    return procesoSAS(ctx, "background_neutral", preset, vista)


def calibrarColor(ctx, vista=None, modo="star", umbral=50.0):
    """L12 color: White Balance de SASpro (modo star: con las estrellas; auto; manual con ayudaProceso)."""
    return procesoSAS(ctx, "white_balance", {"mode": modo, "threshold": float(umbral)}, vista)


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
    return r


LISTA = {
    "ping": ping,
    "vistas": vistas,
    "imagen": imagen,
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
    "procesoSAS": procesoSAS,
    "ayudaProceso": ayudaProceso,
    "gradienteCandidatos": gradienteCandidatos,
    "estirarCandidatos": estirarCandidatos,
    "ruidoCandidatos": ruidoCandidatos,
    "aplicarCandidato": aplicarCandidato,
    "quitarVerde": quitarVerde,
    "neutralizarFondo": neutralizarFondo,
    "calibrarColor": calibrarColor,
    "resolverAstrometria": resolverAstrometria,
    "separarEstrellas": separarEstrellas,
}
