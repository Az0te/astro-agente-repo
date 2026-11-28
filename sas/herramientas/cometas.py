# SetiAstroPilot — cometas: apilado en las estrellas y en el cometa, unión de los dos, color y Larson-Sekanina.
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
# (27 nov 2026, SASpro 2.0.1.)
#
# El modo cometa de SASpro vive dentro del Stacking Suite (ventanas y clics). Aquí se usan sus piezas sin ventana de
# setiastro.saspro.comet_stacking (_log_big_blob, _star_suppress, _refine_centroid, _protect_core_mask) y
# convo.larson_sekanina, cada una con una alternativa propia por si la API interna cambia. El apilado es propio y por
# franjas sobre ficheros en disco: stack_comet_aligned de SASpro carga todas las tomas en memoria (33 tomas de 24 MP en
# color son unos 9,5 GB).
#
# Flujo de apilarCometa:
#   tomas (FITS/XISF/TIFF o RAW) → calibrar (dark/flat opcionales) → debayer → alinear por estrellas (astroalign) →
#   normalizar → apilado de estrellas (winsorized 3/3) → núcleo en cada toma (seguimiento + ajuste lineal en el tiempo)
#   → candidatos del cometa (cada toma desplazada al núcleo de la de referencia, estrellas fuera con máscara) → métricas,
#   previas con el MISMO estirado y recomendado.

import datetime as _dt
import json
import math
import shutil
import time
import warnings
from pathlib import Path

import numpy as np

import herramientas as H
import medidas as M
import multicapa as _multicapa
import rc as _rc
import tomas_estrellas as TE
import limpieza_tomas as LT

_r = H._r

EXTS = {".fit", ".fits", ".fts", ".tif", ".tiff", ".xisf", ".cr2", ".cr3", ".nef", ".arw", ".dng", ".raf", ".orf",
        ".rw2", ".pef"}
RAW = {".cr2", ".cr3", ".nef", ".arw", ".dng", ".raf", ".orf", ".rw2", ".pef"}
AVISO_VERDE = ("El verde de la coma es real (emisión de C2 y CN): no quites verde (SCNR/quitarVerde) en la imagen del "
               "cometa. Si hace falta en el fondo, solo con máscara que excluya la coma y la cola.")


# --- Utilidades ------------------------------------------------------------------------------------------------

def _eventos():
    """Deja respirar a la interfaz de SASpro en los bucles largos (el puente no ejecuta otra herramienta mientras)."""
    try:
        from PyQt6.QtWidgets import QApplication
        QApplication.processEvents()
    except Exception:
        pass


def _cs():
    try:
        from setiastro.saspro import comet_stacking as cs
        return cs
    except Exception:
        return None


def _cv2():
    import cv2
    return cv2


def _cab_get(cab, k):
    try:
        v = cab.get(k) if cab is not None and hasattr(cab, "get") else None
    except Exception:
        v = None
    return None if v in (None, "") else v


def _tiempo(cab, meta, ruta):
    """Instante central de la toma (s desde 1970, UTC): DATE-OBS + EXPTIME/2. Si no hay fecha, la del fichero."""
    for fuente in (cab, (meta or {}).get("original_header"), meta or {}):
        f = _cab_get(fuente, "DATE-OBS") or _cab_get(fuente, "DATE_OBS")
        if f:
            try:
                s = str(f).strip().replace("Z", "")
                if "T" not in s and " " in s:
                    s = s.replace(" ", "T", 1)
                t = _dt.datetime.fromisoformat(s).replace(tzinfo=_dt.timezone.utc).timestamp()
                exp = _cab_get(fuente, "EXPTIME") or _cab_get(fuente, "EXPOSURE") or 0
                return t + float(exp or 0) / 2.0, "DATE-OBS"
            except (ValueError, TypeError):
                pass
    return Path(ruta).stat().st_mtime, "fecha del fichero"


def _iso(t):
    return _dt.datetime.fromtimestamp(t, _dt.timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


def _patron(cab, meta):
    for fuente in (cab, (meta or {}).get("original_header"), meta or {}):
        for k in ("BAYERPAT", "CFA_PATTERN", "BAYER", "bayer_pattern", "CFA"):
            v = _cab_get(fuente, k)
            if v and str(v).strip().upper() in ("RGGB", "BGGR", "GRBG", "GBRG"):
                return str(v).strip().upper()
    return None


def _debayer_propio(m, patron):
    """Bilineal normalizado (sin la ambigüedad de nombres de OpenCV): cada color se interpola desde sus píxeles."""
    cv2 = _cv2()
    h, w = m.shape
    pos = {"RGGB": "RGGB", "BGGR": "BGGR", "GRBG": "GRBG", "GBRG": "GBRG"}[patron]
    k = np.array([[1, 2, 1], [2, 4, 2], [1, 2, 1]], np.float32)
    out = np.empty((3, h, w), np.float32)
    for ci, col in enumerate("RGB"):
        mask = np.zeros((h, w), np.float32)
        for j, letra in enumerate(pos):
            if letra == col:
                mask[j // 2::2, j % 2::2] = 1.0
        num = cv2.filter2D(m * mask, -1, k, borderType=cv2.BORDER_REFLECT)
        den = cv2.filter2D(mask, -1, k, borderType=cv2.BORDER_REFLECT)
        out[ci] = num / np.maximum(den, 1e-6)
    return out


def _debayer(m, patron):
    try:
        from setiastro.saspro.debayer import debayer_array
        rgb = np.asarray(debayer_array(np.ascontiguousarray(m, dtype=np.float32), patron), dtype=np.float32)
        if rgb.ndim == 3 and rgb.shape[-1] == 3:
            return np.moveaxis(rgb, -1, 0).copy(), "SASpro debayer_array"
        if rgb.ndim == 3 and rgb.shape[0] == 3:
            return rgb, "SASpro debayer_array"
    except Exception:
        pass
    return _debayer_propio(np.asarray(m, np.float32), patron), "bilineal propio"


def _leer_master(ctx, ruta):
    if not ruta:
        return None
    p, _, _ = _multicapa._leer(ctx, ruta)
    return p


def _cargar_toma(ctx, ruta, dark=None, flat=None, patron_forzado=None):
    """Fichero -> (p (c,h,w) float32, cabecera, meta, info). Mosaico Bayer: dark, flat y debayer."""
    p, cab, meta = _multicapa._leer(ctx, ruta)
    info = {}
    mosaico = p.shape[0] == 1 and (Path(ruta).suffix.lower() in RAW or _patron(cab, meta) or patron_forzado)
    if dark is not None:
        if dark.shape != p.shape:
            raise ValueError(f"El master dark ({dark.shape}) no tiene la forma de la toma ({p.shape}).")
        p = p - dark
        info["dark"] = True
    if flat is not None:
        if flat.shape != p.shape:
            raise ValueError(f"El master flat ({flat.shape}) no tiene la forma de la toma ({p.shape}).")
        f = flat / max(float(np.median(flat)), 1e-9)
        p = p / np.maximum(f, 0.05)
        info["flat"] = True
    if mosaico:
        pat = patron_forzado or _patron(cab, meta) or "RGGB"
        info["patron"] = pat if (patron_forzado or _patron(cab, meta)) else "RGGB (supuesto: la cabecera no lo dice)"
        p, info["debayer"] = _debayer(p[0], pat)
    return np.ascontiguousarray(p, dtype=np.float32), cab, meta, info


def _lum(p):
    L = M.lum(p) if p.ndim == 3 else p
    return np.nan_to_num(np.asarray(L, np.float32), nan=0.0)


def _mad(x):
    x = x[np.isfinite(x)]
    if x.size == 0:
        return 0.0, 0.0
    med = float(np.median(x))
    return med, 1.4826 * float(np.median(np.abs(x - med)))


def _codigo(cod):
    c = str(cod).lower().replace("/", "").replace(" ", "")
    if c in ("mediana", "median"):
        return "mediana", 0, 0
    if c in ("media", "mean"):
        return "media", 0, 0
    tipo = "mad" if c.startswith("mad") else "w" if c.startswith("w") else None
    dig = c[3:] if tipo == "mad" else c[1:]
    if tipo is None or len(dig) < 2:
        raise ValueError(f"Rechazo no válido: {cod} (w33, w11, mad11, mediana, media…).")
    if "-" in dig or len(dig) > 2:
        a, b = (dig.split("-") + ["3"])[:2] if "-" in dig else (dig[:len(dig) // 2], dig[len(dig) // 2:])
        return tipo, float(a), float(b)
    return tipo, float(dig[0]), float(dig[1])


def _nombre_rechazo(cod):
    t, lo, hi = _codigo(cod)
    if t == "mediana":
        return "mediana"
    if t == "media":
        return "media sin rechazo"
    return f"{'winsorized sigma' if t == 'w' else 'MAD'} {lo:g}/{hi:g}"


def _reducir_cubo(cubo, cod):
    """cubo (N, ...) con NaN donde no hay dato. Devuelve (resultado, fracción rechazada)."""
    t, lo, hi = _codigo(cod)
    with warnings.catch_warnings(), np.errstate(all="ignore"):
        warnings.simplefilter("ignore", RuntimeWarning)
        if t == "mediana":
            return np.nanmedian(cubo, 0).astype(np.float32), 0.0
        if t == "media":
            return np.nanmean(cubo, 0).astype(np.float32), 0.0
        med = np.nanmedian(cubo, 0)
        sd = 1.4826 * np.nanmedian(np.abs(cubo - med), 0)
        if t == "w":                                   # como Siril: sigma winsorizada (Huber) y luego rechazo
            for _ in range(3):
                wz = np.clip(cubo, med - 1.5 * sd, med + 1.5 * sd)
                med = np.nanmean(wz, 0)
                sd = 1.134 * np.nanstd(wz, 0)
        sd = np.maximum(sd, 1e-7)
        ok = (cubo >= med - lo * sd) & (cubo <= med + hi * sd)
        n = ok.sum(0)
        s = np.where(ok, cubo, 0.0).sum(0)
        out = np.where(n > 0, s / np.maximum(n, 1), med)
        validos = np.isfinite(cubo).sum()
        rech = 1.0 - float(n.sum()) / max(1, int(validos))
    return out.astype(np.float32), rech


def _filas_por_franja(n, c, w, presupuesto=1.5e8):
    return int(max(16, min(4096, presupuesto // max(1, n * c * w * 4))))


def _bloque(f, y0, y1, dx=0.0, dy=0.0, valor=np.nan, interp=None):
    """Filas [y0, y1) de la toma f (c, h, w) desplazada (dx, dy): salida(x, y) = entrada(x − dx, y − dy)."""
    cv2 = _cv2()
    c, h, w = f.shape
    if abs(dx) < 1e-6 and abs(dy) < 1e-6:
        return np.array(f[:, y0:y1, :], dtype=np.float32, copy=True)
    s0, s1 = int(math.floor(y0 - dy)) - 5, int(math.ceil(y1 - dy)) + 5
    a0, a1 = max(0, s0), min(h, s1)
    out = np.full((c, y1 - y0, w), valor, np.float32)
    if a1 <= a0:
        return out
    blk = np.asarray(f[:, a0:a1, :], dtype=np.float32)
    Mx = np.array([[1, 0, dx], [0, 1, a0 + dy - y0]], np.float64)
    fl = cv2.INTER_LANCZOS4 if interp is None else interp
    for k in range(c):
        out[k] = cv2.warpAffine(blk[k], Mx, (w, y1 - y0), flags=fl, borderMode=cv2.BORDER_CONSTANT, borderValue=float(valor))
    return out


def _escribir_fits(ruta, p, cab_extra):
    from astropy.io import fits
    hdr = fits.Header()
    for k, v in cab_extra.items():
        try:
            hdr[k[:8]] = v
        except Exception:
            pass
    fits.writeto(str(ruta), np.asarray(p[0] if p.shape[0] == 1 else p, np.float32), hdr, overwrite=True)
    return str(ruta)


def _abrir(ctx, p, nombre, meta_ref, extra=None):
    m = {}
    for k in ("original_header", "bit_depth", "cometa"):
        if meta_ref and meta_ref.get(k) is not None:
            m[k] = meta_ref[k]
    m.update(extra or {})
    m.update(display_name=nombre, mono=p.shape[0] == 1, is_mono=p.shape[0] == 1)
    img = p[0] if p.shape[0] == 1 else np.moveaxis(p, 0, -1)
    nv = ctx.open_new_document(np.ascontiguousarray(img, dtype=np.float32), metadata=m, name=nombre)
    d = H._base(nv) if nv is not None else H._doc(ctx, nombre)
    return d


def _guardar_meta(ruta, meta):
    """Trayectoria del núcleo junto al fichero (<fichero>.json, como en Siril): la unión y Larson-Sekanina la leen."""
    try:
        Path(ruta).with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        pass


def _meta_cometa(doc):
    """Trayectoria del núcleo de una vista: en sus metadatos ('cometa') o en el .json junto a su fichero."""
    m = H._meta(doc)
    if isinstance(m.get("cometa"), dict):
        return m["cometa"]
    fp = m.get("file_path")
    if fp:
        try:
            return json.loads(Path(fp).with_suffix(".json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
    return None


def _params(q):
    return H._params_estirado(np.nan_to_num(q, nan=0.0))


def _previa(p, ps, ruta, lado=1400):
    q = H._reducir(np.nan_to_num(p, nan=0.0), lado)
    return H._jpg(H._estirar_con(q, ps), ruta, 85, lado)


def _recorte(p, xy, ps, ruta, lado=700):
    h, w = p.shape[1], p.shape[2]
    x, y = int(round(xy[0])), int(round(xy[1]))
    y0, x0 = max(0, min(h - lado, y - lado // 2)), max(0, min(w - lado, x - lado // 2))
    z = np.nan_to_num(np.asarray(p[:, y0:y0 + lado, x0:x0 + lado], np.float32), nan=0.0)
    return H._jpg(H._estirar_con(z, ps), ruta, 90)


class _T:
    def __init__(self, dx, dy):
        self.params = np.array([[1, 0, dx], [0, 1, dy], [0, 0, 1]], np.float64)


def _traslacion(src, ref):
    """Alternativa a astroalign: traslación por correlación de fase sobre la escala fina (estrellas)."""
    cv2 = _cv2()
    a = src - cv2.GaussianBlur(src, (0, 0), 8)
    b = ref - cv2.GaussianBlur(ref, (0, 0), 8)
    (dx, dy), resp = cv2.phaseCorrelate(b.astype(np.float64), a.astype(np.float64))
    if resp < 0.02:
        raise RuntimeError(f"correlación de fase débil ({resp:.3f})")
    return _T(-dx, -dy), (np.zeros(int(resp * 1000)), None)


# --- Núcleo ----------------------------------------------------------------------------------------------------

def _semilla_auto(L):
    """Coma más fuerte (mancha grande) quitando antes las estrellas. (x, y, sigma) en píxeles de L."""
    cv2 = _cv2()
    f = 4
    h, w = L.shape
    Ld = np.nan_to_num(cv2.resize(L, (w // f, h // f), interpolation=cv2.INTER_AREA).astype(np.float32), nan=0.0)
    hd, wd = Ld.shape
    # margen sin buscar: el marco que deja el alineado y las estrellas brillantes cortadas por el borde ganan al LoG
    # a la coma, que es difusa (Lemmon, 27-nov: semilla en y=2 sobre una estrella cortada). Se rellena con la mediana.
    mg = max(8, int(0.04 * min(hd, wd)))
    med = float(np.median(Ld[mg:-mg, mg:-mg]))
    Ld[:mg], Ld[-mg:], Ld[:, :mg], Ld[:, -mg:] = med, med, med, med

    # búsqueda propia: estrellas fuera con una apertura (se van las manchas menores que el disco), cielo restado y
    # LoG a escalas de coma. Una estrella brillante no sobrevive a la apertura; la coma sí.
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    S = cv2.morphologyEx(cv2.medianBlur(Ld, 5), cv2.MORPH_OPEN, k)
    S = S - cv2.GaussianBlur(S, (0, 0), 64)
    mejor = None
    for sg in (4.0, 8.0, 16.0):
        B = cv2.GaussianBlur(S, (0, 0), sg)
        Lp = -cv2.Laplacian(B, cv2.CV_32F) * sg * sg
        Lp[:mg], Lp[-mg:], Lp[:, :mg], Lp[:, -mg:] = 0, 0, 0, 0
        y, x = divmod(int(np.argmax(Lp)), Lp.shape[1])
        if mejor is None or Lp[y, x] > mejor[0]:
            mejor = (Lp[y, x], x, y, sg)
    _, x, y, sg = mejor
    # la de SASpro solo si cae en la misma coma (si no, suele ser una estrella brillante que su supresión no quita)
    cs = _cs()
    if cs is not None:
        try:
            S2 = cs._star_suppress(Ld)
            try:
                cx, cy, sg2 = cs._log_big_blob(S2)
            except TypeError:
                cx, cy, sg2 = cs._log_big_blob(S2, (2.0, 4.0, 8.0, 16.0))
            if math.hypot(float(cx) - x, float(cy) - y) <= max(2 * sg, 6):
                return float(cx) * f + f / 2, float(cy) * f + f / 2, float(sg2) * f, "SASpro _log_big_blob"
            return x * f + f / 2, y * f + f / 2, sg * f, "LoG propio (SASpro discrepaba)"
        except Exception:
            pass
    return x * f + f / 2, y * f + f / 2, sg * f, "LoG propio"


def _centroide(B, x, y, r):
    cs = _cs()
    if cs is not None:
        try:
            cx, cy = cs._refine_centroid(B, float(x), float(y), int(r))
            if np.isfinite(cx) and np.isfinite(cy) and abs(cx - x) <= 2 * r and abs(cy - y) <= 2 * r:
                return float(cx), float(cy)
        except Exception:
            pass
    h, w = B.shape
    for _ in range(3):
        x0, x1 = max(0, int(x - r)), min(w, int(x + r) + 1)
        y0, y1 = max(0, int(y - r)), min(h, int(y + r) + 1)
        z = B[y0:y1, x0:x1]
        z = np.clip(z - np.median(z), 0, None)
        s = float(z.sum())
        if s <= 0:
            break
        yy, xx = np.mgrid[y0:y1, x0:x1]
        x, y = float((z * xx).sum() / s), float((z * yy).sum() / s)
    return x, y


def _buscar_nucleo(L, mascara, x, y, radio, sigma=3.0):
    """Máximo de la luminancia suavizada (estrellas tapadas con la mediana local) en un círculo de 'radio' y centroide."""
    cv2 = _cv2()
    h, w = L.shape
    m = int(radio + 4 * sigma + 4)
    x0, x1 = max(0, int(x) - m), min(w, int(x) + m + 1)
    y0, y1 = max(0, int(y) - m), min(h, int(y) + m + 1)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    z = L[y0:y1, x0:x1].copy()
    if mascara is not None:
        mk = mascara[y0:y1, x0:x1]
        if mk.any():
            z[mk] = float(np.median(z[~mk])) if (~mk).any() else 0.0
    B = cv2.GaussianBlur(z, (0, 0), sigma)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    fuera = (xx - x) ** 2 + (yy - y) ** 2 > radio * radio
    Bb = B.copy()
    Bb[fuera] = -np.inf
    j = int(np.argmax(Bb))
    py, px = divmod(j, B.shape[1])
    cx, cy = _centroide(B, px, py, max(3, int(round(1.5 * sigma))))
    return cx + x0, cy + y0, float(B[py, px] - np.median(B))


def _ajuste(ts, xs, ys, pesos=None):
    """Ajuste lineal robusto x(t), y(t). Devuelve (fx, fy, residuo_rms_px, atipicos)."""
    ts, xs, ys = np.asarray(ts, float), np.asarray(xs, float), np.asarray(ys, float)
    if len(ts) == 1:
        return (lambda t: xs[0] + 0 * np.asarray(t, float)), (lambda t: ys[0] + 0 * np.asarray(t, float)), 0.0, []
    ok = np.ones(len(ts), bool)
    for _ in range(3):
        ax = np.polyfit(ts[ok], xs[ok], 1)
        ay = np.polyfit(ts[ok], ys[ok], 1)
        res = np.hypot(xs - np.polyval(ax, ts), ys - np.polyval(ay, ts))
        lim = max(1.5, 3 * 1.4826 * float(np.median(res[ok])))
        nuevo = res <= lim
        if ok.sum() - (~nuevo & ok).sum() < 2 or (nuevo == ok).all():
            break
        ok = nuevo
    rms = float(np.sqrt(np.mean(res[ok] ** 2)))
    return (lambda t: np.polyval(ax, t)), (lambda t: np.polyval(ay, t)), rms, [int(i) for i in np.nonzero(~ok)[0]]


def _mascara_estrellas(Lmin, sem, r_coma):
    """Estrellas fijas: compactas en el mínimo de las tomas alineadas (el cometa se mueve y casi no queda). Se deja
    fuera un disco alrededor del núcleo por si se mueve poco."""
    cv2 = _cv2()
    hp = Lmin - cv2.GaussianBlur(Lmin, (0, 0), 6)
    _, s = _mad(hp[::4, ::4])
    s = max(s, 1e-7)
    debil = (hp > 5 * s).astype(np.uint8)
    fuerte = (hp > 60 * s).astype(np.uint8)
    k1 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    k2 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21))
    m = cv2.dilate(debil, k1) | cv2.dilate(fuerte, k2)
    h, w = m.shape
    yy, xx = np.ogrid[:h, :w]
    m[(xx - sem[0]) ** 2 + (yy - sem[1]) ** 2 <= r_coma ** 2] = 0
    return m.astype(bool)


# --- Trazos de estrellas, máscara profunda y máscara suave del cometa (27-nov, Lemmon) ------------------------------
# Rafael vio en los dos finales «estrellas movidas»: trazos cortos y paralelos en todo el cielo. Son estrellas débiles
# que el rechazo deja pasar en el apilado alineado al núcleo: una o dos tomas de 33 por píxel suben la media (y hasta la
# mediana) una fracción de σ, invisible por píxel —los restos medían 0 en todos los candidatos— pero el ojo junta los
# 117 px del recorrido. Se miden en la dirección del movimiento y se quitan con una máscara de estrellas sacada del
# apilado de ESTRELLAS (√N más profundo) y, al unir, con el fondo del apilado de estrellas fuera de la coma y la cola.

def _linea(n, ang):
    """Núcleo de convolución: segmento de n píxeles en la dirección ang (grados), suma 1."""
    k = np.zeros((n, n), np.float32)
    c = n // 2
    dx, dy = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    for t in np.linspace(-c, c, 4 * n):
        k[int(round(c + t * dy)), int(round(c + t * dx))] = 1
    return k / k.sum()


def _trazos(L, xy, r_coma, mov):
    """Trazos de estrellas en una imagen alineada al núcleo (L lineal o estirada). Media a lo largo de la dirección del
    movimiento (segmento del largo del recorrido) frente a la misma media en perpendicular, en el cielo lejos de la
    coma: trazos_por_mp son los píxeles por MP por encima de 5 σ a lo largo menos los de la perpendicular (lo que no
    tiene dirección se anula); anisotropia_trazos, la dispersión a lo largo entre la de la perpendicular (1 = nada)."""
    cv2 = _cv2()
    largo = math.hypot(float(mov[0]), float(mov[1]))
    if largo < 6:
        return {"trazos_por_mp": 0.0, "anisotropia_trazos": 1.0}
    ang = math.degrees(math.atan2(float(mov[1]), float(mov[0])))
    b = 2
    L = np.nan_to_num(np.asarray(L, np.float32), nan=0.0)
    h, w = L.shape
    Lb = cv2.resize(L, (w // b, h // b), interpolation=cv2.INTER_AREA)
    hp = Lb - cv2.GaussianBlur(Lb, (0, 0), 6)
    med, s = _mad(hp[::2, ::2])
    s = max(s, 1e-12)
    hp = np.clip(hp - med, -4 * s, 4 * s)                  # las estrellas fuertes no dominan la media
    n = max(9, int(min(largo, 400) / b) | 1)
    A = cv2.filter2D(hp, -1, _linea(n, ang))
    Pp = cv2.filter2D(hp, -1, _linea(n, ang + 90))
    yy, xx = np.mgrid[:Lb.shape[0], :Lb.shape[1]]
    fuera = np.hypot(xx - xy[0] / b, yy - xy[1] / b) > max(3 * r_coma, 150) / b
    fuera[:n], fuera[-n:], fuera[:, :n], fuera[:, -n:] = False, False, False, False
    if fuera.sum() < 1000:
        return {"trazos_por_mp": 0.0, "anisotropia_trazos": 1.0}
    ma, sa = _mad(A[fuera][::3])
    mq, sq = _mad(Pp[fuera][::3])
    sq = max(sq, 1e-12)
    na = int(((A - ma > 5 * sq) & fuera).sum())
    nq = int(((Pp - mq > 5 * sq) & fuera).sum())
    mp = float(fuera.sum()) * b * b / 1e6
    return {"trazos_por_mp": _r(max(0, na - nq) * b * b / mp, 1), "anisotropia_trazos": _r(sa / sq, 3)}


def _distancia_segmento(h, w, tray):
    yy, xx = np.ogrid[:h, :w]
    (ax, ay), (bx, by) = tray
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy
    t = np.clip(((xx - ax) * vx + (yy - ay) * vy) / L2, 0, 1) if L2 > 0 else 0.0
    return np.hypot(xx - (ax + t * vx), yy - (ay + t * vy)).astype(np.float32)


def _mascara_estrellas_prof(Ls, tray, r_banda):
    """Estrellas del apilado de ESTRELLAS (√N más profundo que una toma o que el mínimo de las tomas): paso alto > 4 σ,
    agrandadas según el brillo (3, 6, 12 y 22 px: el anillo de las brillantes también deja trazo), sin la banda de la
    trayectoria del núcleo (ahí el apilado de estrellas tiene las copias del núcleo, no estrellas)."""
    cv2 = _cv2()
    Ls = np.nan_to_num(np.asarray(Ls, np.float32), nan=0.0)
    hp = Ls - cv2.GaussianBlur(Ls, (0, 0), 4)
    _, s = _mad(hp[::2, ::2])
    s = max(s, 1e-9)
    m = np.zeros(Ls.shape, bool)
    for k, r in ((4, 3), (25, 6), (150, 12), (1000, 22)):
        sel = (hp > k * s).astype(np.uint8)
        if sel.any():
            m |= cv2.dilate(sel, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))) > 0
    if tray is not None:
        m &= _distancia_segmento(*Ls.shape, tray) > r_banda
    return m


def _mascara_coma_cola(Lc, xy, r_coma, tray=None, k=2.5):
    """Máscara suave (0–1) de la coma y la cola en el apilado del cometa (lineal o estirado): luminancia binada ×8,
    mediana 5×5 (fuera estrellas y restos), umbral cielo + k σ y solo lo que está unido al núcleo (un resto de
    gradiente suelto no entra), agrandada ~30 px y difuminada; más un disco que cubre la coma y todo el recorrido del
    núcleo (donde el apilado de estrellas tiene las copias del núcleo)."""
    cv2 = _cv2()
    b = 8
    L = np.nan_to_num(np.asarray(Lc, np.float32), nan=0.0)
    h, w = L.shape
    Lb = cv2.resize(L, (w // b, h // b), interpolation=cv2.INTER_AREA)
    Lb = cv2.GaussianBlur(cv2.medianBlur(Lb, 5), (0, 0), 1.5)
    sky, s = _mad(Lb)
    s = max(s, 1e-12)
    z = (Lb - sky) / s
    yy, xx = np.mgrid[:Lb.shape[0], :Lb.shape[1]]
    d = np.hypot(xx - xy[0] / b, yy - xy[1] / b)
    r_disco = max(2.0 * r_coma, 60.0)
    if tray is not None:
        (ax, ay), (bx, by) = tray
        r_disco = max(r_disco, 0.5 * math.hypot(bx - ax, by - ay) + r_coma)
    nl, lab = cv2.connectedComponents((z > k).astype(np.uint8), connectivity=8)
    unidas = np.unique(lab[(d <= r_disco / b) & (z > k)])
    sel = np.isin(lab, unidas[unidas > 0])
    # solo en la dirección de la cola (cuña de ±50° alrededor del eje de su parte brillante): a 2,5 σ un resto de
    # gradiente o de viñeteo pegado a la coma entraba entero (Siril, Lemmon 27-nov: media esquina inferior izquierda
    # dentro de la máscara y con el cielo del apilado del cometa, con sus trazos)
    rd = r_disco / b
    hi = np.isin(lab, unidas[unidas > 0]) & (z > 3 * k) & (d > rd)
    if int(hi.sum()) > 20:
        wv = z[hi] - 3 * k
        ux, uy = float(((xx[hi] - xy[0] / b) * wv).sum()), float(((yy[hi] - xy[1] / b) * wv).sum())
        nu = math.hypot(ux, uy)
        if nu > 0:
            cosang = ((xx - xy[0] / b) * ux + (yy - xy[1] / b) * uy) / (nu * np.maximum(d, 1e-6))
            sel &= (cosang >= math.cos(math.radians(50))) | (d <= 1.5 * rd)
    t = np.where(sel, np.clip((z - k) / k, 0, 1), 0).astype(np.float32)
    t = cv2.dilate(t, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    disco = np.clip(1 - (d - r_disco / b) / max(r_disco / (2 * b), 2), 0, 1).astype(np.float32)
    t = cv2.GaussianBlur(np.maximum(t, disco), (0, 0), 3)
    m = cv2.resize(t, (w, h), interpolation=cv2.INTER_LINEAR)
    return np.clip(m, 0, 1).astype(np.float32), _r(r_disco, 1)


def _coma_quemada(p, xy, r_coma):
    """% de píxeles de la coma (disco de r_coma alrededor del núcleo) con algún canal ≥ 0,98: objetivo < 0,5 %."""
    h, w = p.shape[1], p.shape[2]
    r = int(max(8, r_coma))
    x, y = int(round(xy[0])), int(round(xy[1]))
    x0, x1, y0, y1 = max(0, x - r), min(w, x + r + 1), max(0, y - r), min(h, y + r + 1)
    if x1 <= x0 or y1 <= y0:
        return None
    z = np.nan_to_num(p[:, y0:y1, x0:x1], nan=0.0).max(axis=0)
    yy, xx = np.ogrid[y0:y1, x0:x1]
    dentro = (xx - xy[0]) ** 2 + (yy - xy[1]) ** 2 <= r * r
    return _r(100 * float((z[dentro] >= 0.98).mean()), 2)

def control_final(p, meta=None, cielo=None):
    """Control de entrega de un cometa (Lemmon, 27-nov: cielo gris, esquinas negras recortadas y coma quemada): cielo
    > 0,13 (objetivo ~0,10, elegido por Rafael el 28-nov para enseñar el polvo y la cola débil), píxeles a 0 por canal (> 0,01 %) y coma quemada (> 0,5 % de la coma a ≥ 0,98, con la trayectoria)."""
    av, out = [], {}
    if cielo is not None:
        out["cielo"] = _r(cielo, 4)
        if cielo > 0.13:
            av.append(f"Cielo gris para un cometa ({cielo:.3f} > 0,13; objetivo ~0,10): fondoCandidatos(tipo='cometa', cielos=[0.10]) antes de exportar.")
        elif cielo < 0.06:
            av.append(f"Cielo oscuro para un cometa ({cielo:.3f}; objetivo ~0,10): se pierden el polvo de fondo y la cola débil. fondoCandidatos(tipo='cometa', cielos=[0.10]).")
    z = [100.0 * float((p[k] <= 0).mean()) for k in range(p.shape[0])]
    out["ceros_canal_pct"] = [_r(v, 4) for v in z]
    if max(z) > 0.01:
        av.append(f"Fondo recortado a 0: {max(z):.3f} % en un canal (objetivo < 0,01 %): esquinas o cielo negros; "
                  "rehaz el fondo con fondoCandidatos(tipo='cometa') o corrige el viñeteo (gradienteCandidatos con excluir).")
    if meta and meta.get("nucleo_ref"):
        q = _coma_quemada(p, meta["nucleo_ref"], float(meta.get("r_coma") or 30))
        out["coma_quemada_pct"] = q
        if q is not None and q > 0.5:
            av.append(f"Coma quemada: {q} % de la coma a ≥ 0,98 (objetivo < 0,5 %): rehaz el estirado con protección de "
                      "luces (nucleoCandidatos / HDR en la coma).")
    out["avisos"] = av
    return out


# --- Métricas del cometa ---------------------------------------------------------------------------------------

def _metricas(p, xy, r_coma, mask_est, mov=None):
    """Ruido del cielo, restos de estrellas fuera del núcleo, trazos de estrellas en la dirección del movimiento (todo
    el cielo lejos de la coma) y señal de coma + cola en una caja alrededor del núcleo."""
    cv2 = _cv2()
    L = _lum(p)
    h, w = L.shape
    sky, _ = _mad(L[::4, ::4])
    hp = L - cv2.GaussianBlur(L, (0, 0), 2)
    _, ruido = _mad(hp[::2, ::2])
    ruido = max(ruido, 1e-8)
    R = int(min(h, w) * 0.3)
    x, y = int(round(xy[0])), int(round(xy[1]))
    x0, x1, y0, y1 = max(0, x - R), min(w, x + R), max(0, y - R), min(h, y + R)
    z, zh = L[y0:y1, x0:x1], hp[y0:y1, x0:x1]
    yy, xx = np.ogrid[y0:y1, x0:x1]
    lejos = (xx - xy[0]) ** 2 + (yy - xy[1]) ** 2 > (1.5 * r_coma) ** 2
    restos = (zh > 6 * ruido) & lejos
    mp = z.size / 1e6
    # señal de la coma y la cola: lo que sobra sobre el cielo tras suavizar, sin contar los restos de estrellas
    B = cv2.GaussianBlur(z, (0, 0), 6)
    senal = np.clip(B - sky, 0, None)
    est = mask_est[y0:y1, x0:x1] if mask_est is not None else np.zeros_like(restos)
    senal = float(senal[~(restos | est)].sum())
    tz = _trazos(L, xy, r_coma, mov) if mov is not None else {}
    return {"ruido_fondo": _r(ruido, 7), "cielo": _r(sky, 6), "restos_estrellas_por_mp": _r(float(restos.sum()) / max(mp, 1e-6), 1),
            **tz, "senal_coma_cola": senal}


# --- apilarCometa ----------------------------------------------------------------------------------------------

def _lista_tomas(carpeta, max_tomas=None):
    c = Path(carpeta)
    if not c.is_dir():
        raise FileNotFoundError(f"No existe la carpeta {carpeta}.")
    fs = sorted(f for f in c.iterdir() if f.is_file() and f.suffix.lower() in EXTS)
    if not fs:
        raise FileNotFoundError(f"No hay tomas ({', '.join(sorted(EXTS))}) en {carpeta}.")
    if max_tomas:
        n = int(max_tomas)
        if n < len(fs):                               # repartidas por toda la serie, no las primeras
            idx = np.unique(np.round(np.linspace(0, len(fs) - 1, n)).astype(int))
            fs = [fs[i] for i in idx]
    return fs


def apilarCometa(ctx, carpeta, nucleo=None, referencia=None, rechazos=("w33", "w11", "mad11", "mediana"),
                 mascara_estrellas=True, quitar_restos=False, metodo_b=False, master_dark=None, master_flat=None,
                 patron=None, radio_nucleo=None, planSolo=False, max_tomas=None, nombre=None, salida=None,
                 estrellas_pesos=True, quitar_bandas=True, corregir_motas=True, recortar_bordes=True):
    """Cometa (L5/L8 con tomas): apila las tomas de 'carpeta' dos veces, en las estrellas y en el cometa, sin el Stacking
    Suite. Calibra si se dan master_dark/master_flat, hace el debayer de los RAW/OSC, alinea por estrellas
    (astroalign), sigue el núcleo toma a toma y lo ajusta a una recta en el tiempo (DATE-OBS + EXPTIME/2), y saca
    candidatos del cometa con varios rechazos (las estrellas, fuera con máscara). Abre dos vistas: <nombre>_estrellas
    y <nombre>_cometa (el recomendado; aplicarCandidato para otro). planSolo enseña el plan sin apilar."""
    t_inicio = time.perf_counter()
    fs = _lista_tomas(carpeta, max_tomas)
    nombre = H._seguro(nombre or f"cometa_{Path(carpeta).name}")
    if isinstance(rechazos, str):
        rechazos = [x.strip() for x in rechazos.replace(";", ",").split(",") if x.strip()]
    rechazos = list(dict.fromkeys(rechazos or ["w33"]))
    for cod in rechazos:
        _codigo(cod)
    pasos, avisos = [], [AVISO_VERDE]
    dark = _leer_master(ctx, master_dark)
    flat = _leer_master(ctx, master_flat)
    if dark is None and flat is None:
        avisos.append("Sin master dark ni flat: las tomas van sin calibrar (viñeteo y polvo siguen ahí). Si los hay, "
                      "pásalos en master_dark/master_flat (de la misma cámara, ganancia y temperatura).")

    # --- plan: primera, central y última -----------------------------------------------------------------------
    if planSolo:
        muestra = sorted({0, len(fs) // 2, len(fs) - 1})
        filas, tcarga, ts = [], [], []
        for i in muestra:
            t0 = time.perf_counter()
            p, cab, meta, info = _cargar_toma(ctx, fs[i], dark, flat, patron)
            tcarga.append(time.perf_counter() - t0)
            t, fuente = _tiempo(cab, meta, fs[i])
            ts.append(t)
            filas.append({"toma": fs[i].name, "forma": list(p.shape), "instante_utc": _iso(t),
                          "fuente_hora": fuente, **info, "mediana": _r(float(np.median(p[:, ::8, ::8])), 5)})
            _eventos()
        c, h, w = p.shape
        gb = len(fs) * c * h * w * 4 / 1e9
        libre = shutil.disk_usage(H.TRABAJO.parent if H.TRABAJO.parent.exists() else Path.home()).free / 1e9
        seg = float(np.mean(tcarga)) * len(fs) * 2.5 + len(fs) * 3
        dur = _r((max(ts) - min(ts)) / 60, 1) if len(ts) > 1 else None
        return {"plan": True, "tomas": len(fs), "carpeta": str(carpeta), "muestra": filas, "duracion_serie_min": dur,
                "disco_necesario_gb": _r(gb * (2 if metodo_b else 1), 1), "disco_libre_gb": _r(libre, 1),
                "tiempo_estimado_min": _r(seg / 60, 1), "rechazos": [_nombre_rechazo(x) for x in rechazos],
                "calibracion": {"dark": bool(dark is not None), "flat": bool(flat is not None)},
                "avisos": avisos,
                "siguiente": "Si el plan cuadra, repite sin planSolo. Con muchas tomas, prueba antes con max_tomas: 4."}

    # --- 1. cargar, calibrar, debayer y guardar en disco --------------------------------------------------------
    trab = H.TRABAJO / f"tomas_{nombre}"
    if trab.exists():
        shutil.rmtree(trab, ignore_errors=True)
    trab.mkdir(parents=True, exist_ok=True)
    tomas, info0, meta_ref = [], None, None
    bandas = []
    for i, f in enumerate(fs):
        p, cab, meta, info = _cargar_toma(ctx, f, dark, flat, patron)
        if quitar_bandas:
            # patrón de filas y columnas de la réflex (Lemmon, 27-nov: bandas horizontales en el cielo del final)
            p, ib = LT.quitar_bandas(p)
            bandas.append(ib)
        t, fuente = _tiempo(cab, meta, f)
        if i == 0:
            info0, forma = info, p.shape
            libre = shutil.disk_usage(trab).free
            if libre < len(fs) * p.nbytes * (2.2 if metodo_b else 1.1):
                raise RuntimeError(f"Poco disco libre en {trab}: {libre / 1e9:.1f} GB y hacen falta unos "
                                   f"{len(fs) * p.nbytes * (2 if metodo_b else 1) / 1e9:.1f} GB.")
        if p.shape != forma:
            avisos.append(f"{f.name}: forma {p.shape} distinta de {forma}; queda fuera.")
            continue
        ruta = trab / f"t{i:03d}.npy"
        np.save(ruta, p)
        tomas.append({"fichero": f.name, "t": t, "fuente_hora": fuente, "bruta": ruta, "meta": meta})
        _eventos()
    if len(tomas) < 2:
        raise RuntimeError("Hacen falta al menos 2 tomas válidas.")
    tomas.sort(key=lambda x: x["t"])
    if any(x["fuente_hora"] != "DATE-OBS" for x in tomas):
        avisos.append("Alguna toma no trae DATE-OBS: su hora sale de la fecha del fichero (la velocidad puede fallar).")
    pasos.append(f"{len(tomas)} tomas leídas" + (f" (debayer {info0.get('debayer')}, patrón {info0.get('patron')})" if info0.get("debayer") else ""))
    if bandas:
        fr = float(np.median([np.mean(b["filas_rms"]) for b in bandas]))
        co = float(np.median([np.mean(b["columnas_rms"]) for b in bandas])) if bandas[0]["columnas_rms"] else 0.0
        pasos.append(f"Bandas de filas y columnas quitadas en cada toma (rms mediano {fr:.3g} y {co:.3g})")

    # --- 2. referencia y alineado por estrellas -----------------------------------------------------------------
    if referencia:
        iref = next((i for i, x in enumerate(tomas) if x["fichero"] == str(referencia) or Path(x["fichero"]).stem == str(referencia)), None)
        if iref is None:
            raise ValueError(f"La referencia {referencia} no está entre las tomas.")
    else:
        iref = len(tomas) // 2
    ref = tomas[iref]
    meta_ref = ref["meta"]
    cv2 = _cv2()
    pr = np.load(ref["bruta"], mmap_mode="r")
    c, h, w = pr.shape
    Lr = _lum(np.asarray(pr))
    try:
        from setiastro.saspro.astroalign import find_transform
        motor_alin = "astroalign de SASpro"
    except Exception:
        find_transform = _traslacion
        motor_alin = "correlación de fase propia (solo traslación)"
        avisos.append("No está astroalign de SASpro: alineado solo por traslación (correlación de fase).")
    fallos = []
    for x in tomas:
        dst = trab / f"a_{Path(x['bruta']).stem}.npy"
        if x is ref:
            a = np.asarray(pr, np.float32)
            x["estrellas_emparejadas"] = None
        else:
            src = np.load(x["bruta"], mmap_mode="r")
            try:
                T, (s, _) = find_transform(_lum(np.asarray(src)), Lr)
                Mx = np.asarray(T.params, np.float64)[:2]
                x["estrellas_emparejadas"] = int(len(s))
            except Exception as e:
                fallos.append(f"{x['fichero']}: {str(e)[:120]}")
                x["fallo"] = True
                continue
            a = np.empty((c, h, w), np.float32)
            for k in range(c):
                a[k] = cv2.warpAffine(np.asarray(src[k], np.float32), Mx, (w, h), flags=cv2.INTER_LANCZOS4,
                                      borderMode=cv2.BORDER_CONSTANT, borderValue=float("nan"))
            x["desplazamiento_estrellas_px"] = [_r(float(Mx[0, 2]), 1), _r(float(Mx[1, 2]), 1)]
        np.save(dst, a)
        x["alineada"] = dst
        try:
            Path(x["bruta"]).unlink()
        except OSError:
            pass
        _eventos()
    n_total = len(tomas)
    tomas = [x for x in tomas if not x.get("fallo")]
    n = len(tomas)
    pasos.append(f"Alineadas por estrellas {n} de {n_total} con {motor_alin} (referencia {ref['fichero']})")
    if fallos:
        avisos.append(f"Solo se alinearon {n} de {n_total} tomas: " + "; ".join(fallos))
    if n < 2:
        raise RuntimeError("Menos de 2 tomas alineadas: " + "; ".join(fallos))
    iref = tomas.index(ref)

    # --- 3. normalización (aditiva con escala, por canal, contra la referencia) -------------------------------------
    estad = []
    for x in tomas:
        a = np.load(x["alineada"], mmap_mode="r")
        estad.append([_mad(np.asarray(a[k, ::4, ::4])) for k in range(c)])
    for i, x in enumerate(tomas):
        x["norm"] = [(estad[iref][k][1] / max(estad[i][k][1], 1e-9), estad[i][k][0], estad[iref][k][0]) for k in range(c)]

    A_mota = None                                   # flat local de las motas (se mide tras apilar las estrellas)

    def leer(x, y0, y1, dx=0.0, dy=0.0, cual="alineada"):
        b = _bloque(np.load(x[cual], mmap_mode="r"), y0, y1, dx, dy)
        if A_mota is not None:
            b /= _bloque(A_mota[np.newaxis], y0, y1, dx, dy, valor=1.0, interp=cv2.INTER_LINEAR)[0]
        for k, (s, m0, m1) in enumerate(x["norm"]):
            b[k] = (b[k] - m0) * s + m1
        return b

    # --- 3b. calidad de las estrellas toma a toma (tomas desdobladas por un salto de la montura o viento) ----------
    variantes_est = {}
    if estrellas_pesos:
        for x in tomas:
            x["calidad"] = TE.medir_toma(_lum(np.asarray(np.load(x["alineada"], mmap_mode="r"))))
            _eventos()
        pesos = TE.pesos_tomas([x["calidad"] for x in tomas])
        limpias = [0.0 if x["calidad"].get("desdoblada") else 1.0 for x in tomas]
        desd = [x["fichero"] for x in tomas if x["calidad"].get("desdoblada")]
        if desd:
            variantes_est["pesos"] = (f"winsorized 3/3 con peso por toma (desdobladas hasta 0,3)", pesos)
            if sum(limpias) >= max(5, n // 4):
                variantes_est["limpias"] = (f"winsorized 3/3 solo con las {int(sum(limpias))} tomas limpias", limpias)
            avisos.append(f"{len(desd)} de {n} tomas con las estrellas desdobladas (pares en una dirección: salto de la "
                          f"montura o viento): {', '.join(desd)}. Se apilan también variantes de la capa de estrellas "
                          "con pesos y solo con las limpias (el cometa sigue con todas).")
        for x, wt in zip(tomas, pesos):
            x["calidad"]["peso"] = wt

    # --- 4. apilado de estrellas (winsorized 3/3) y mínimo para la máscara --------------------------------------
    filas = _filas_por_franja(n, c, w)
    est = np.empty((c, h, w), np.float32)
    est_v = {k: np.empty((c, h, w), np.float32) for k in variantes_est}
    Lmin = np.empty((h, w), np.float32)
    rech_est = []
    for y0 in range(0, h, filas):
        y1 = min(h, y0 + filas)
        cubo = np.stack([leer(x, y0, y1) for x in tomas])
        est[:, y0:y1], rr = _reducir_cubo(cubo, "w33")
        for k, (_, wts) in variantes_est.items():
            est_v[k][:, y0:y1], _ = TE.reducir_pesos(cubo, wts)
        rech_est.append(rr)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            Lmin[y0:y1] = np.nan_to_num(np.nanmin(cubo.mean(1), 0), nan=0.0)
        _eventos()
    pasos.append(f"Apilado de estrellas: winsorized 3/3, {n} tomas, rechazo {100 * float(np.mean(rech_est)):.1f} %")
    Lest = _lum(est)

    # --- 5. núcleo ---------------------------------------------------------------------------------------------
    if nucleo:
        sx, sy = float(nucleo[0]), float(nucleo[1])
        sg, fuente_sem = float(radio_nucleo or 20) / 3, "dado"
    else:
        sx, sy, sg, fuente_sem = _semilla_auto(Lest)
    r_coma = float(radio_nucleo or np.clip(3 * sg, 25, 300))
    mest = _mascara_estrellas(Lmin, (sx, sy), r_coma)
    orden = sorted(range(n), key=lambda i: abs(tomas[i]["t"] - tomas[iref]["t"]))
    conocidos = {}
    for i in orden:
        x = tomas[i]
        La = _lum(leer(x, 0, h))
        if len(conocidos) >= 2:
            ks = sorted(conocidos)
            fx, fy, _, _ = _ajuste([tomas[k]["t"] for k in ks], [conocidos[k][0] for k in ks], [conocidos[k][1] for k in ks])
            px, py = float(fx(x["t"])), float(fy(x["t"]))
            radio = max(12.0, 0.4 * r_coma)
        elif conocidos:
            k = next(iter(conocidos))
            px, py = conocidos[k][:2]
            radio = max(20.0, 0.8 * r_coma)
        else:
            px, py, radio = sx, sy, max(25.0, r_coma)
        b = _buscar_nucleo(La, mest, px, py, radio, sigma=3.0)
        if b is None:
            avisos.append(f"{x['fichero']}: no encuentro el núcleo cerca de ({px:.0f}, {py:.0f}).")
            continue
        conocidos[i] = b
        _eventos()
    if len(conocidos) < 2:
        raise RuntimeError("No he podido seguir el núcleo en al menos 2 tomas. Pasa nucleo: [x, y] en la imagen de "
                           "estrellas (vista <nombre>_estrellas tras un primer intento, o mira la previa).")
    ks = sorted(conocidos)
    fx, fy, rms, atip = _ajuste([tomas[k]["t"] for k in ks], [conocidos[k][0] for k in ks], [conocidos[k][1] for k in ks])
    tref = tomas[iref]["t"]
    xr, yr = float(fx(tref)), float(fy(tref))
    t0_, t1_ = tomas[0]["t"], tomas[-1]["t"]
    dx_tot, dy_tot = float(fx(t1_) - fx(t0_)), float(fy(t1_) - fy(t0_))
    horas = max((t1_ - t0_) / 3600, 1e-9)
    vel = math.hypot(dx_tot, dy_tot) / horas
    for i, x in enumerate(tomas):
        x["nucleo_medido"] = [_r(conocidos[i][0], 2), _r(conocidos[i][1], 2)] if i in conocidos else None
        x["nucleo_ajuste"] = [_r(float(fx(x["t"])), 2), _r(float(fy(x["t"])), 2)]
        x["desplazamiento_cometa"] = (xr - float(fx(x["t"])), yr - float(fy(x["t"])))
    pasos.append(f"Núcleo ({fuente_sem}): {math.hypot(dx_tot, dy_tot):.1f} px en {horas * 60:.1f} min "
                 f"({vel:.1f} px/h), residuo del ajuste {rms:.2f} px")
    if rms > 2.0:
        avisos.append(f"El núcleo no sigue bien una recta (residuo {rms:.1f} px): revisa las previas del recorte o da "
                      "nucleo: [x, y]. Un residuo alto suele ser una estrella confundida con el núcleo.")
    if atip:
        avisos.append("Medidas atípicas del núcleo (se usa el ajuste): " + ", ".join(tomas[ks[j]]["fichero"] for j in atip))
    if math.hypot(dx_tot, dy_tot) < 1.0:
        avisos.append("El cometa apenas se mueve en esta serie (< 1 px): el apilado del cometa es casi igual al de "
                      "estrellas y la máscara de estrellas no se puede usar bien.")

    # trayectoria del núcleo en el apilado de estrellas y máscara de estrellas profunda: la del mínimo de las tomas solo
    # ve las estrellas más brillantes que el ruido de UNA toma, y las débiles dejaban trazos en el cielo (Lemmon, 27-nov)
    # motas de polvo (sin flats): flat local medido en el apilado de estrellas; las estrellas se dividen ya y el cometa
    # al leer cada toma (la mota va con el sensor: en el cometa sale corrida en la dirección del movimiento)
    motas = []
    if corregir_motas and flat is None:
        A_mota, motas = LT.detectar_motas(Lest, excluir=(xr, yr, max(600.0, 6 * r_coma)))
        if A_mota is not None:
            est /= A_mota[np.newaxis]
            for k in est_v:
                est_v[k] /= A_mota[np.newaxis]
            Lest = _lum(est)
            pasos.append(f"{len(motas)} mota(s) oscura(s) corregida(s) con un flat local: " + "; ".join(
                f"({m['x']:.0f}, {m['y']:.0f}) {m['diametro_px']:.0f} px, −{m['profundidad_pct']} %" for m in motas))
    # cobertura: el rectángulo con datos en todas las tomas, en estrellas y en el cometa (el cometa se mueve)
    rect = None
    if recortar_bordes:
        cov = None
        for x in tomas:
            v = LT.validos_toma(np.load(x["alineada"], mmap_mode="r"))
            vv = v & LT.desplazar_mascara(v, *x["desplazamiento_cometa"])
            cov = vv if cov is None else cov & vv
        rect = LT.rect_cobertura(cov)
        pasos.append(f"Recorte por cobertura de las {n} tomas (estrellas y cometa) y 16 px de margen: x {rect[0]}–{rect[2]}, "
                     f"y {rect[1]}–{rect[3]} ({rect[2] - rect[0]} × {rect[3] - rect[1]} px de {w} × {h})")
    tray = ((float(fx(t0_)), float(fy(t0_))), (float(fx(t1_)), float(fy(t1_))))
    meta_c = {"nucleo_ref": [_r(xr, 2), _r(yr, 2)], "trayectoria": [[_r(v, 2) for v in a] for a in tray],
              "r_coma": _r(r_coma, 1), "velocidad_px_h": _r(vel, 3), "tomas": n}
    mov = (dx_tot, dy_tot)
    if mascara_estrellas:
        mest = mest | _mascara_estrellas_prof(Lest, tray, max(12.0, r_coma / 2))
        pasos.append(f"Máscara de estrellas del apilado de estrellas (> 4 σ, agrandada según el brillo, sin la banda del "
                     f"núcleo): {100 * float(mest.mean()):.1f} % del campo")

    # --- 6. candidatos del cometa ----------------------------------------------------------------------------------
    if metodo_b:
        if not _rc.hay("sxt"):
            avisos.append("metodo_b necesita StarXTerminator (rc-astro): se omite.")
            metodo_b = False
        else:
            for x in tomas:
                a = np.load(x["alineada"])
                a = np.nan_to_num(a, nan=0.0)
                sl, _ = _rc.correr(np.clip(a, 0, 1), "sxt", unscreen=False)
                np.save(trab / f"sl_{Path(x['alineada']).stem}.npy", np.asarray(sl, np.float32))
                x["sin_estrellas"] = trab / f"sl_{Path(x['alineada']).stem}.npy"
                _eventos()
            pasos.append(f"Método B: StarX en cada toma ({n})")
    nmin = 1 if n < 3 else max(2, n // 3)
    variantes = [(cod, "alineada", bool(mascara_estrellas)) for cod in rechazos]
    if metodo_b:
        variantes.append((rechazos[0], "sin_estrellas", False))
    res = {v: np.empty((c, h, w), np.float32) for v in variantes}
    relleno = {v: 0 for v in variantes}
    rech = {v: [] for v in variantes}
    mest_f = mest.astype(np.float32)[np.newaxis]
    filas = _filas_por_franja(n, c, w, 1.0e8)
    for y0 in range(0, h, filas):
        y1 = min(h, y0 + filas)
        cubos = {}
        for cual in {v[1] for v in variantes}:
            cubos[cual] = np.stack([leer(x, y0, y1, *x["desplazamiento_cometa"], cual=cual) for x in tomas])
        if mascara_estrellas:
            mk = np.stack([_bloque(mest_f, y0, y1, *x["desplazamiento_cometa"], valor=0.0, interp=cv2.INTER_LINEAR)[0] > 0.3
                           for x in tomas])                     # (N, filas, w)
        for v in variantes:
            cod, cual, usa_m = v
            cubo = cubos[cual]
            if usa_m:
                cm = cubo.copy()
                cm[np.broadcast_to(mk[:, np.newaxis], cm.shape)] = np.nan
                out, rr = _reducir_cubo(cm, cod)
                pocos = np.isfinite(cm[:, 0]).sum(0) < nmin
                if pocos.any():
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore", RuntimeWarning)
                        out[:, pocos] = np.nanmedian(cubo[:, :, pocos], 0)
                    relleno[v] += int(pocos.sum())
            else:
                out, rr = _reducir_cubo(cubo, cod)
            res[v][:, y0:y1] = out
            rech[v].append(rr)
        _eventos()

    # --- 7. métricas, método A, candidatos y previas ----------------------------------------------------------------
    H._limpiar_grupo("cometa")
    previas = H.TRABAJO / f"previas_{nombre}"
    previas.mkdir(parents=True, exist_ok=True)
    cands = []
    for v, p in res.items():
        cod, cual, usa_m = v
        met = _metricas(p, (xr, yr), r_coma, mest, mov)
        nombre_c = _nombre_rechazo(cod) + (" + máscara de estrellas" if usa_m else "") + (" (método B: StarX por toma)" if cual == "sin_estrellas" else "")
        cands.append({"p": p, "metodo": nombre_c, "rechazo": cod, "metodo_b": cual == "sin_estrellas",
                      "rechazado_pct": _r(100 * float(np.mean(rech[v])), 2),
                      "pixeles_con_pocas_tomas_pct": _r(100 * relleno[v] / (h * w), 3) if usa_m else None, **met})
    if quitar_restos:
        if _rc.hay("sxt"):
            base = max(cands, key=lambda k: (k["senal_coma_cola"], -k["restos_estrellas_por_mp"]))
            p0 = np.clip(np.nan_to_num(base["p"], nan=0.0), 0, 1)
            sl, _ = _rc.correr(p0, "sxt", unscreen=False)
            sl = np.asarray(sl, np.float32).reshape(p0.shape)
            cs = _cs()
            r_n, soft = max(6.0, r_coma / 4), max(6.0, r_coma / 3)
            try:
                core = np.asarray(cs._protect_core_mask(h, w, xr, yr, r_n, soft), np.float32)
            except Exception:
                yy, xx = np.ogrid[:h, :w]
                dd = np.hypot(xx - xr, yy - yr)
                core = np.clip(1 - (dd - r_n) / max(soft, 1e-6), 0, 1).astype(np.float32)
            pa = core[np.newaxis] * p0 + (1 - core[np.newaxis]) * sl
            met = _metricas(pa, (xr, yr), r_coma, mest, mov)
            cands.append({"p": pa, "metodo": base["metodo"] + " + StarX (núcleo protegido)", "rechazo": base["rechazo"],
                          "metodo_a": True, "rechazado_pct": base["rechazado_pct"], **met})
            pasos.append("Método A: StarX sobre el mejor apilado del cometa, con el núcleo protegido")
        else:
            avisos.append("quitar_restos necesita StarXTerminator (rc-astro): se omite.")
    smax = max(k["senal_coma_cola"] for k in cands) or 1.0
    for k in cands:
        k["senal_coma_cola_rel_pct"] = _r(100 * k["senal_coma_cola"] / smax, 1)
    buenos = [k for k in cands if k["senal_coma_cola"] >= 0.95 * smax] or cands
    # primero los trazos (lo que se ve en el cielo; los restos compactos medían 0 en todos con trazos a la vista)
    tmin = min(k.get("trazos_por_mp", 0) for k in buenos)
    buenos = [k for k in buenos if k.get("trazos_por_mp", 0) <= tmin * 1.2 + 20]
    rmin = min(k["restos_estrellas_por_mp"] for k in buenos)
    # empate solo si la diferencia de restos es pequeña (3 %); con un margen mayor el "menos restos" del motivo
    # acababa en el candidato con más restos (Lemmon, 27-nov)
    empatados = [k for k in buenos if k["restos_estrellas_por_mp"] <= rmin * 1.03 + 0.5]
    rec = min(empatados, key=lambda k: k["ruido_fondo"])
    if len(empatados) > 1:
        motivo = (f"Trazos de estrellas {rec.get('trazos_por_mp')}/MP (mínimo {tmin}) y restos casi iguales "
                  f"({rmin}–{max(k['restos_estrellas_por_mp'] for k in empatados)}/MP) entre los que conservan ≥ 95 % de "
                  f"la señal de coma y cola; gana el de menos ruido de fondo")
    else:
        motivo = (f"Menos trazos ({rec.get('trazos_por_mp')}/MP) y restos de estrellas ({rec['restos_estrellas_por_mp']}/MP) "
                  f"entre los que conservan ≥ 95 % de la señal de coma y cola")
    # capa de estrellas: todas / con pesos / solo limpias (+ canales alineados al verde), medidas fuera de la coma
    zona = (xr, yr, max(400.0, 4 * r_coma))
    cand_est = [{"id": "todas", "metodo": "winsorized 3/3, todas las tomas", "p": est}]
    cand_est += [{"id": k, "metodo": nom, "p": est_v[k]} for k, (nom, _) in variantes_est.items()]
    for k in cand_est:
        k.update(TE.medir_capa(k["p"], zona))
        _eventos()
    r0 = cand_est[0]
    aceptables = [k for k in cand_est if k.get("ruido_fino", 1) <= 1.35 * r0.get("ruido_fino", 1)
             and not TE.nucleo_peor(k, r0)] or [r0]
    mejor = min(aceptables, key=lambda k: k.get("excentricidad", 1) + 0.5 * k.get("fwhm_px", 99) / max(r0.get("fwhm_px", 1), 1e-6))
    pa, dc = TE.alinear_canales(mejor["p"])
    if dc:
        dRB = math.hypot(dc["B_menos_G_px"][0] - dc["R_menos_G_px"][0], dc["B_menos_G_px"][1] - dc["R_menos_G_px"][1])
        if dRB > 0.25:
            ka = {"id": mejor["id"] + "_alineada", "metodo": mejor["metodo"] + " + R y B alineados al verde", "p": pa,
                  "desplazamiento_corregido": dc}
            ka.update(TE.medir_capa(pa, zona))
            cand_est.append(ka)
            if TE.nucleo_peor(ka, mejor):
                pasos.append("Capa de estrellas: alinear R y B empeora el centro de las estrellas brillantes; no se adopta")
            else:
                mejor = ka
                pasos.append(f"Capa de estrellas: R y B desplazados {dRB:.2f} px entre sí (dispersión atmosférica o cromática); "
                         "alineados al verde")
    # núcleos quemados: el centro de las estrellas brillantes pierde verde (quemado en unas tomas y en otras no) y, tras
    # calibrar y estirar, sale un disco blanco-azulado o rosado con una mancha roja al lado (Lemmon, 27-nov). Después de
    # alinear (la alineación no mide en estrellas quemadas): el núcleo toma el color del anillo que lo rodea.
    pr, inf = TE.reparar_nucleos(mejor["p"], excluir=zona)
    if inf and inf.get("nucleos"):
        kr = {"id": mejor["id"] + "_nucleos", "metodo": mejor["metodo"] + " + núcleos quemados reparados", "p": pr,
              "nucleos_reparados": inf}
        kr.update(TE.medir_capa(pr, zona))
        cand_est.append(kr)
        if not TE.nucleo_peor(kr, mejor):
            pasos.append(f"Capa de estrellas: {inf['nucleos']} núcleos quemados reparados con el color de su "
                         f"anillo (asimetría de color del núcleo p90 {mejor.get('nucleo_color_p90')} → "
                         f"{kr.get('nucleo_color_p90')})")
            mejor = kr
    est_rec = mejor["p"]
    if rect is not None:
        x0r, y0r, x1r, y1r = rect
        recorta = lambda a: np.ascontiguousarray(a[:, y0r:y1r, x0r:x1r])
        est_rec, est = recorta(est_rec), recorta(est)
        for k in cand_est:
            k["p"] = recorta(k["p"])
        for k in cands:
            k["p"] = recorta(k["p"])
        xr, yr = xr - x0r, yr - y0r
        zona = (xr, yr, zona[2])
        tray = tuple((a[0] - x0r, a[1] - y0r) for a in tray)
        meta_c.update(nucleo_ref=[_r(xr, 2), _r(yr, 2)], trayectoria=[[_r(v, 2) for v in a] for a in tray],
                      recorte=[int(v) for v in rect])
    pasos.append(f"Capa de estrellas recomendada: {mejor['metodo']} (FWHM {mejor.get('fwhm_px')} px, excentricidad "
                 f"{mejor.get('excentricidad')}, ruido ×{mejor.get('ruido_fino', 0) / max(r0.get('ruido_fino', 1e-9), 1e-9):.2f} frente a todas)")
    # vistas: estrellas y cometa (el recomendado); los candidatos se guardan con la huella de la vista del cometa
    v_est = _abrir(ctx, est_rec, f"{nombre}_estrellas", meta_ref, {"cometa": meta_c})
    v_com = _abrir(ctx, rec["p"], f"{nombre}_cometa", meta_ref, {"cometa": meta_c})
    huella, uid = M.huella(v_com.image), getattr(v_com, "uid", None)
    ps = _params(H._reducir(np.nan_to_num(rec["p"], nan=0.0), 1400))
    salida = Path(salida) if salida else Path(carpeta) / "apilado_cometa"
    salida.mkdir(parents=True, exist_ok=True)
    cab_fits = {"NCOMBINE": n, "COMETFR": n, "DATE-OBS": _iso(tref),
                "CMTX": _r(xr, 2), "CMTY": _r(yr, 2), "CMTVELPH": _r(vel, 3)}
    ficheros = {"estrellas": _escribir_fits(salida / f"{nombre}_estrellas.fits", est_rec, cab_fits)}
    _guardar_meta(ficheros["estrellas"], meta_c)
    estrellas_cands = []
    if len(cand_est) > 1:
        sel_e, cielo_e = TE.elegir_estrellas(est, excluir=zona)
        mosaico = TE.recortes([k["p"] for k in cand_est], [k["id"] for k in cand_est], sel_e, cielo_e,
                              previas / "estrellas_candidatos_100.jpg")
        for k in cand_est:
            f = _escribir_fits(salida / f"{nombre}_estrellas_{k['id']}.fits", k["p"], {**cab_fits, "COMMENT": k["metodo"]})
            _guardar_meta(f, meta_c)
            estrellas_cands.append({**{kk: vv for kk, vv in k.items() if kk != "p"}, "fichero": f,
                                    "recomendada": k is mejor})
        ficheros["estrellas_candidatos_100"] = mosaico
    salida_c = []
    for j, k in enumerate(cands, 1):
        a = H._a_sas(np.nan_to_num(k["p"], nan=0.0), v_com.image)
        cid = H._guardar_candidato("cometa", j, a, {"nombre": k["metodo"], "huella_base": huella, "uid": uid,
                                                    "proceso": "apilarCometa"})
        fila = {"id": cid, **{kk: vv for kk, vv in k.items() if kk not in ("p", "senal_coma_cola")},
                "previa": _previa(k["p"], ps, previas / f"{cid}.jpg"),
                "previa_nucleo_100": _recorte(k["p"], (xr, yr), ps, previas / f"{cid}_nucleo.jpg")}
        salida_c.append(fila)
        if k is rec:
            rec_id = cid
            ficheros["cometa"] = _escribir_fits(salida / f"{nombre}_cometa.fits", k["p"], {**cab_fits, "COMMENT": k["metodo"]})
            _guardar_meta(ficheros["cometa"], meta_c)
    prev_est = {"previa": _previa(est_rec, ps, previas / "estrellas.jpg"),
                "previa_nucleo_100": _recorte(est_rec, (xr, yr), ps, previas / "estrellas_nucleo.jpg")}
    shutil.rmtree(trab, ignore_errors=True)
    H._reactivar(ctx, v_com)
    return {"tomas": f"{n} de {n_total}", "referencia": ref["fichero"], "pasos": pasos, "avisos": avisos,
            "nucleo": {"semilla": [_r(sx, 1), _r(sy, 1)], "fuente": fuente_sem, "en_referencia": [_r(xr, 2), _r(yr, 2)],
                       "radio_coma_px": _r(r_coma, 1), "desplazamiento_total_px": [_r(dx_tot, 2), _r(dy_tot, 2)],
                       "velocidad_px_h": _r(vel, 2), "residuo_ajuste_px": _r(rms, 3),
                       "por_toma": [{"toma": x["fichero"], "medido": x["nucleo_medido"], "ajuste": x["nucleo_ajuste"],
                                     "estrellas_emparejadas": x.get("estrellas_emparejadas")} for x in tomas],
                       "trayectoria": meta_c["trayectoria"]},
            "estrellas": {"vista": H._nombre(v_est), **prev_est, "candidatos": estrellas_cands,
                          "calidad_por_toma": [{"toma": x["fichero"], **x.get("calidad", {})} for x in tomas] if estrellas_pesos else None},
            "candidatos": salida_c, "recomendado": rec_id,
            "motivo": motivo, "vista_cometa": H._nombre(v_com), "ficheros": ficheros, "previas": str(previas),
            "segundos": _r(time.perf_counter() - t_inicio, 1),
            "leyenda": "ruido_fondo: MAD de la escala fina (menos es mejor). restos_estrellas_por_mp: píxeles de restos "
                       "compactos fuera del núcleo por megapíxel (menos es mejor). trazos_por_mp: estrellas que dejan "
                       "segmentos en la dirección del movimiento (lo primero que se mira; menos es mejor). senal_coma_cola_rel_pct: señal de coma y "
                       "cola frente al mejor (un rechazo agresivo puede comerse la cola). Todas las previas con el mismo estirado.",
            "siguiente": "Mira las previas. Fondo (gradiente) en las dos vistas, luego calibrarColor en la de estrellas y "
                         "transferirColorCometa al cometa, y al final combinarCometaEstrellas."}


# --- combinarCometaEstrellas -----------------------------------------------------------------------------------

def _solo_estrellas(p):
    """Capa de estrellas de p: StarX (original − starless) o, sin rc-astro, apertura morfológica (aproximada)."""
    if _rc.hay("sxt"):
        sl, _ = _rc.correr(np.clip(p, 0, 1), "sxt", unscreen=False)
        sl = np.asarray(sl, np.float32).reshape(p.shape)
        return np.clip(p - sl, 0, None), sl, "StarXTerminator (original − starless)"
    cv2 = _cv2()
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    sl = np.stack([cv2.morphologyEx(ch, cv2.MORPH_OPEN, k) for ch in p])
    sl = np.stack([cv2.GaussianBlur(ch, (0, 0), 2) for ch in sl])
    return np.clip(p - sl, 0, None), sl, "apertura morfológica propia (sin rc-astro; aproximada, deja halos)"


def combinarCometaEstrellas(ctx, cometa, estrellas, modo="mascara", estrellas_solo=False, mezcla=1.0, lineal=None,
                            radio_nucleo=None, umbral_cola=2.5, nombre=None, nucleos_grandes=True):
    """Cometa (L-final): une el apilado del cometa (estrellas fuera) con las estrellas del apilado de estrellas, en una
    vista nueva. modo 'mascara' (lineal, el de por defecto): el cometa SOLO dentro de una máscara suave de coma y cola
    (umbral cielo + umbral_cola σ sobre el cometa binado y sin estrellas, unida al núcleo y difuminada) con la capa de
    estrellas encima; fuera, el apilado de estrellas tal cual (su fondo no tiene los trazos de las estrellas débiles
    que deja el apilado alineado al núcleo). Sale lineal: se estira una sola vez y cometa y estrellas comparten cielo.
    'suma' (lineal: cometa + estrellas sin fondo), 'pantalla' (estira los dos con el MISMO estirado y une A + B − A·B)
    o 'pantalla_sas' (blend_screen_stretched de SASpro). estrellas_solo si la vista de estrellas ya es solo la capa de
    estrellas. Mide cuánto tapa la cola, los trazos que quedan en el cielo y la coma quemada. nucleos_grandes (lineal, por
    defecto sí): rehace el centro quemado de las estrellas grandes con el tono de su anillo y quita los arcos de color de
    un lado (TE.nucleos_grandes) en el apilado de estrellas y en la capa de estrellas antes de unir."""
    dc, de = H._doc(ctx, cometa), H._doc(ctx, estrellas)
    pc, pe = H._p(dc.image), H._p(de.image)
    if pc.shape != pe.shape:
        raise ValueError(f"Las dos vistas deben tener la misma forma (cometa {pc.shape}, estrellas {pe.shape}); vienen "
                         "del mismo apilarCometa y no se recortan por separado.")
    avisos = [AVISO_VERDE]
    meta_c = _meta_cometa(dc) or _meta_cometa(de)
    if estrellas_solo:
        capa, fuente = pe, "la vista ya es solo estrellas"
    else:
        capa, _, fuente = _solo_estrellas(pe)
    mezcla = float(mezcla)
    # En el apilado de estrellas el núcleo sale repetido (una copia por toma) y el quitaestrellas lo toma por estrellas:
    # la capa de estrellas se apaga en TODO el recorrido del núcleo (con la trayectoria) para no pegar esas copias sobre
    # la coma ni a su lado (Siril, 27-nov: «mancha fantasma del núcleo junto a la cola» sin la trayectoria).
    Lc0 = _lum(pc)
    if meta_c and meta_c.get("nucleo_ref"):
        nx, ny = (float(v) for v in meta_c["nucleo_ref"])
        r_coma = float(meta_c.get("r_coma") or 30)
        tray = meta_c.get("trayectoria")
        nsg = r_coma / 3
        fuente_n = "trayectoria de apilarCometa"
    else:
        nx, ny, nsg, _ = _semilla_auto(Lc0)
        nx, ny = _centroide(_cv2().GaussianBlur(Lc0, (0, 0), 3), nx, ny, max(4, int(nsg)))
        r_coma, tray, fuente_n = float(np.clip(3 * nsg, 25, 300)), None, "buscado (sin trayectoria guardada)"
        avisos.append("Sin la trayectoria del núcleo (metadatos 'cometa' o .json junto al fichero): núcleo buscado a "
                      "ciegas y la capa de estrellas solo se apaga en un disco. Abre los apilados de apilarCometa.")
    h, w = pc.shape[1], pc.shape[2]
    r_n = float(radio_nucleo or np.clip(1.5 * nsg, 12, 150))
    d_n = _distancia_segmento(h, w, tray) if tray else _distancia_segmento(h, w, ((nx, ny), (nx, ny)))
    apaga = np.clip((d_n - r_n) / max(r_n / 2, 4), 0, 1).astype(np.float32)
    capa = capa * apaga[np.newaxis]
    del d_n
    # lineal: un RAW sin restar el nivel de negro tiene el cielo por encima de 0,05 y M.lineal lo da por estirado
    # (27-nov, Lemmon: «p99 < 0,3» tomaba por lineal el cometa ya estirado a mediana 0,15 —p99 0,28— y lo estiraba otra
    # vez: anillo de viñeteo y restos de estrellas. Un RAW con nivel de negro tiene el p99 pegado a la mediana; uno
    # estirado, no.)
    sub = pc[:, ::8, ::8]
    p50, p99 = float(np.median(sub)), float(np.percentile(sub, 99))
    lin = bool(lineal) if lineal is not None else (M.lineal(sub) or (p99 - p50) < 0.25 * p50)
    extra = {}
    # Núcleos quemados de las estrellas grandes (Lemmon, 28-nov: núcleo verde, punto rosa o azul y anillos en las
    # estrellas grandes aun con proteger_nucleos_nxt): sin dato real del color en el centro → tono del anillo.
    if nucleos_grandes and lin:
        exc = (nx, ny, max(3 * r_coma, 150.0))
        pe, lista_ng = TE.nucleos_grandes(pe, excluir=exc)
        capa, _ = TE.nucleos_grandes(capa, excluir=exc, lista=lista_ng)
        extra["nucleos_grandes"] = len(lista_ng)
        antes_ng = TE.artefacto_nucleo(H._p(de.image), excluir=exc)
        extra["nucleo_color_p90_antes_despues"] = [antes_ng.get("nucleo_color_p90"),
                                                    TE.artefacto_nucleo(pe, excluir=exc).get("nucleo_color_p90")]
    if modo == "mascara":
        if not lin:
            avisos.append("El modo máscara es para los dos apilados lineales (antes de estirar): así comparten cielo.")
        m, r_disco = _mascara_coma_cola(Lc0, (nx, ny), r_coma, tray, float(umbral_cola))
        # el apilado de estrellas al nivel del cometa, canal a canal, en el cielo libre (sin cometa ni estrellas)
        Le = _lum(capa)
        _, se = _mad(Le[::4, ::4])
        libre = (m < 0.01) & (Le < 3 * max(se, 1e-9))
        des = [float(np.median(pc[k][libre][::7]) - np.median(pe[k][libre][::7])) for k in range(pc.shape[0])]
        # Desfase que cambia por el campo (Lemmon, 27-nov: el gradiente del cometa, con la cola excluida, dejaba su cielo
        # algo más oscuro a un lado de la cola y la máscara lo enseñaba como un bloque de borde recto arriba). Se mide
        # cometa − estrellas en el cielo libre, suavizado (~200 px) y rellenado bajo la máscara, y se le resta al
        # cometa: dentro y fuera de la máscara queda el cielo de la capa de estrellas.
        D, d_rango = LT.desfase_campo(pc, pe, libre)
        pe_aj = pe + np.asarray(des, np.float32)[:, None, None]
        pc_aj = pc - D
        mm = m[np.newaxis]
        out = np.clip(mm * (pc_aj + mezcla * capa) + (1 - mm) * pe_aj, 0, 1)
        del pc_aj, D
        como = (f"máscara de coma y cola (cielo + {float(umbral_cola):g} σ, unida al núcleo; disco {r_disco} px): "
                "cometa + estrellas dentro, apilado de estrellas fuera (lineal)")
        extra.update({"mascara_cometa_pct": _r(100 * float(m.mean()), 1), "desfase_cielo_estrellas": [_r(v, 6) for v in des],
                 "desfase_campo_p1_p99": d_rango})
        H.PREVIAS.mkdir(parents=True, exist_ok=True)
        extra["previa_mascara"] = H._jpg(np.repeat(H._reducir(m[np.newaxis], 1400), 3, 0),
                                         H.PREVIAS / f"{H._seguro(nombre or 'cometa')}_mascara.jpg", 85, 1400)
        del pe_aj, mm
    elif modo == "suma":
        if not lin:
            avisos.append("La suma es para imágenes lineales; con estiradas se pasa de brillo. Usa modo pantalla.")
        out = np.clip(pc + mezcla * capa, 0, 1)
        como = "suma lineal"
    elif modo == "pantalla_sas":
        from setiastro.saspro.comet_stacking import blend_screen_stretched
        r = blend_screen_stretched(np.moveaxis(pc, 0, -1), np.moveaxis(capa, 0, -1), 0.25, mezcla)
        out = H._p(np.asarray(r, np.float32))
        como = "pantalla de SASpro (blend_screen_stretched, mediana objetivo 0,25)"
    elif modo == "pantalla":
        if lin:
            # estirado ENLAZADO (mismos parámetros en R, G y B, de la luminancia): uno por canal neutraliza el cielo y
            # borra la calibración de color (Lemmon, 27-nov: la combinada salía igual antes y después de calibrar)
            # punto negro: el menor de los tres canales (ninguno se recorta aunque haya dominante); tonos medios: los
            # que llevan la luminancia a 0,25 con ese punto negro
            q = np.nan_to_num(H._reducir(pc, 1400), nan=0.0)
            c0 = min(c for c, _ in _params(q))
            mn = (float(np.median(_lum(q))) - c0) / (1 - c0)
            ps = [(c0, float(M.mtf(0.25, np.float64(mn))) if mn > 0 else 0.5)] * pc.shape[0]
            A = H._estirar_con(pc, ps)
            B = np.clip(H._estirar_con(capa + np.float32(c0), ps), 0, 1)
            como = "pantalla tras el mismo estirado enlazado (el del cometa)"
        else:
            A, B = pc, capa
            como = "pantalla (imágenes ya estiradas)"
        B = mezcla * B
        out = np.clip(A + B - A * B, 0, 1)
    else:
        raise ValueError("modo: mascara, suma, pantalla o pantalla_sas.")
    # tapado de la cola: fracción de la señal de la cola que queda bajo estrellas fuertes
    cv2 = _cv2()
    Lc = _lum(pc)
    sky, s = _mad(Lc[::4, ::4])
    cola = cv2.GaussianBlur(Lc, (0, 0), 6) > sky + 3 * max(s, 1e-7)
    Le = _lum(capa)
    tapa = Le > 5 * max(s, 1e-7)                 # estrellas por encima de 5 sigmas del cielo del cometa
    tapado = float((cola & tapa).sum()) / max(1, int(cola.sum()))
    if tapado > 0.05:
        avisos.append(f"Las estrellas tapan el {100 * tapado:.1f} % de la coma y la cola: prueba mezcla < 1 o reduce "
                      "las estrellas antes (reducirEstrellasCandidatos sobre la vista de estrellas).")
    mov = None
    if tray:
        (ax, ay), (bx, by) = tray
        mov = (bx - ax, by - ay)
    tz = _trazos(_lum(out), (nx, ny), r_coma, mov) if mov else {}
    quem = _coma_quemada(out, (nx, ny), r_coma)
    if quem is not None and quem > 0.5:
        avisos.append(f"Coma quemada: {quem} % de sus píxeles a ≥ 0,98 (objetivo < 0,5 %). Si la imagen ya está "
                      "estirada, rehaz el estirado con protección de luces (nucleoCandidatos/componerHDR en la coma).")
    nombre = H._seguro(nombre or f"{H._nombre(dc)}_con_estrellas")
    meta_out = dict(H._meta(dc))
    if meta_c:
        meta_out["cometa"] = meta_c
    d = _abrir(ctx, out, nombre, meta_out)
    H.PREVIAS.mkdir(parents=True, exist_ok=True)
    q = H._reducir(out, 1400)
    previa = H._jpg(M.autoestirar(q) if M.lineal(q) else q, H.PREVIAS / f"{nombre}.jpg", 85, 1400)
    return {"vista": H._nombre(d), "modo": como, "estrellas": fuente, "mezcla": mezcla, "lineal": lin,
            "nucleo": [_r(nx, 1), _r(ny, 1)], "nucleo_de": fuente_n, "sin_estrellas_radio_px": _r(r_n, 1),
            "cola_tapada_pct": _r(100 * tapado, 2), "recortados_pct": _r(100 * float((out >= 0.999).mean()), 3),
            **tz, "coma_quemada_pct": quem, **extra, "previa": previa, "avisos": avisos,
            "siguiente": ("Lineal: estira la unión una sola vez (estirarCandidatos) y mira coma_quemada_pct en la "
                          "estirada (< 0,5 %).") if modo == "mascara" else None}


# --- transferirColorCometa ---------------------------------------------------------------------------------------

def transferirColorCometa(ctx, vista, estrellas_antes, estrellas_despues, forzar=False):
    """Cometa (L12): lleva al apilado del cometa la calibración de color hecha en el de estrellas. Ajusta por canal
    despues = a·antes + b (robusto, sin saturadas) entre las dos versiones del apilado de estrellas y lo aplica a
    'vista' con deshacer. estrellas_antes: copia del apilado de estrellas sin calibrar (duplicarVista antes de
    calibrarColor). Se niega si el ajuste no es lineal (la de después ya estaba estirada), salvo forzar."""
    d = H._doc(ctx, vista)
    pa, pd = H._p(H._doc(ctx, estrellas_antes).image), H._p(H._doc(ctx, estrellas_despues).image)
    p = H._p(d.image)
    if pa.shape != pd.shape:
        raise ValueError("estrellas_antes y estrellas_despues deben tener la misma forma.")
    if pa.shape[0] != 3 or p.shape[0] != 3:
        raise ValueError("Hace falta color (3 canales) en las tres vistas.")
    paso = max(1, int(math.sqrt(pa.shape[1] * pa.shape[2] / 400000)))
    A, B = pa[:, ::paso, ::paso].reshape(3, -1), pd[:, ::paso, ::paso].reshape(3, -1)
    ok = np.all(np.isfinite(A) & np.isfinite(B) & (A < 0.9) & (B < 0.9) & (A > 0), axis=0)
    filas, out = [], np.empty_like(p)
    for k, nombre in enumerate("RGB"):
        x, y = A[k, ok].astype(np.float64), B[k, ok].astype(np.float64)
        sel = np.ones(x.size, bool)
        for _ in range(4):
            a, b = np.polyfit(x[sel], y[sel], 1)
            res = y - (a * x + b)
            s = 1.4826 * np.median(np.abs(res[sel]))
            sel = np.abs(res) <= max(3 * s, 1e-6)
        r2 = 1 - float(np.var(res[sel])) / max(float(np.var(y[sel])), 1e-20)
        filas.append({"canal": nombre, "a": _r(a, 5), "b": _r(b, 6), "r2": _r(r2, 5), "puntos": int(sel.sum())})
        out[k] = a * p[k] + b
    if not forzar and min(f["r2"] for f in filas) < 0.98:
        raise RuntimeError("La calibración de las estrellas no es lineal (R² < 0,98): " + json.dumps(filas, ensure_ascii=False) +
                           ". ¿Se estiró o se cambió algo más entre antes y después? Repite con la copia correcta, o forzar.")
    d.apply_edit(H._a_sas(np.clip(out, 0, 1), d.image), metadata={}, step_name="SetiAstroPilot: color del cometa (de las estrellas)")
    return {"vista": H._nombre(d), "ajuste": filas, "avisos": [AVISO_VERDE],
            "nota": "Mismo color que el apilado de estrellas: ya se pueden unir con combinarCometaEstrellas."}


# --- larsonSekanina ----------------------------------------------------------------------------------------------

def _ls_propio(L, cx, cy, ang, radial):
    cv2 = _cv2()
    h, w = L.shape
    out = 2 * L
    for s in (1, -1):
        Mr = cv2.getRotationMatrix2D((float(cx), float(cy)), s * float(ang), 1.0)
        out = out - cv2.warpAffine(L, Mr, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    if radial:
        f = 1.0 + float(radial) / max(h, w)
        Ms = cv2.getRotationMatrix2D((float(cx), float(cy)), 0.0, f)
        out = out + (L - cv2.warpAffine(L, Ms, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT))
    return out


def larsonSekanina(ctx, vista=None, centro=None, angulos=(5, 10, 20), paso_radial=0, operador="Subtract", abrir=False):
    """Cometa (solo análisis): filtro de Larson-Sekanina (gradiente rotacional alrededor del núcleo) para ver chorros,
    capas y la estructura de la cola. Saca una previa por ángulo; NO es para la imagen final (crea artefactos).
    centro [x, y] del núcleo (si no, se busca). Usa convo.larson_sekanina de SASpro y, si falla, uno propio."""
    d = H._doc(ctx, vista)
    p = H._p(d.image)
    L = _lum(p)
    if centro:
        cx, cy = float(centro[0]), float(centro[1])
        fuente = "dado"
    else:
        sx, sy, sg, _ = _semilla_auto(L)
        cx, cy = _centroide(_cv2().GaussianBlur(L, (0, 0), 3), sx, sy, max(4, int(sg)))
        fuente = "automático"
    # entrada 0–1 estirada (el filtro de SASpro pide float32 0..1; en lineal casi todo es negro)
    Le = M.autoestirar(L[np.newaxis])[0].astype(np.float32) if M.lineal(p[:, ::8, ::8]) else np.clip(L, 0, 1).astype(np.float32)
    carpeta = H.PREVIAS
    carpeta.mkdir(parents=True, exist_ok=True)
    filas = []
    for ang in ([angulos] if isinstance(angulos, (int, float)) else list(angulos)):
        try:
            from setiastro.saspro.convo import larson_sekanina
            r = np.asarray(larson_sekanina(Le, (cx, cy), float(paso_radial), float(ang), str(operador)), np.float32)
            if r.ndim == 3:
                r = r.mean(axis=-1)
            motor = "SASpro convo.larson_sekanina"
        except Exception as e:
            r = _ls_propio(Le, cx, cy, ang, paso_radial)
            motor = f"propio ({type(e).__name__})"
        lo, hi = np.percentile(r, (0.5, 99.5))
        v = np.clip((r - lo) / max(hi - lo, 1e-9), 0, 1)[np.newaxis]
        nombre = H._seguro(f"{H._nombre(d)}_LS_{ang:g}")
        fila = {"angulo": ang, "motor": motor, "previa": H._jpg(v, carpeta / f"{nombre}.jpg", 88, 1600)}
        h, w = v.shape[1:]
        lado = min(800, h, w)
        y0, x0 = int(max(0, min(h - lado, cy - lado // 2))), int(max(0, min(w - lado, cx - lado // 2)))
        # el recorte con SU escala: con la de toda la imagen (casi todo ruido) la coma se satura en blanco y no se ven
        # chorros ni envolturas (Lemmon, 27-nov)
        z = r[y0:y0 + lado, x0:x0 + lado]
        zlo, zhi = np.percentile(z, (0.5, 99.9))
        vz = np.clip((z - zlo) / max(zhi - zlo, 1e-9), 0, 1)[np.newaxis]
        fila["previa_nucleo"] = H._jpg(vz, carpeta / f"{nombre}_nucleo.jpg", 90)
        if abrir:
            fila["vista"] = H._nombre(_abrir(ctx, v, nombre, H._meta(d)))
        filas.append(fila)
    H._reactivar(ctx, d)
    return {"vista": H._nombre(d), "centro": [_r(cx, 2), _r(cy, 2)], "centro_fuente": fuente, "operador": operador,
            "paso_radial": paso_radial, "resultados": filas,
            "nota": "Solo para estudiar la estructura (chorros, envolturas, desconexiones de la cola). No lo mezcles en la "
                    "imagen final: inventa simetrías alrededor del núcleo."}


LISTA_COMETAS = {"apilarCometa": apilarCometa, "combinarCometaEstrellas": combinarCometaEstrellas,
                 "transferirColorCometa": transferirColorCometa, "larsonSekanina": larsonSekanina}
