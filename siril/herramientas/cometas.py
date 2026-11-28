# SirilAstroPilot — cometas: apilado en las estrellas y en el cometa, unión, color y Larson-Sekanina (análisis).
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# Escrito desde cero para Siril 1.4 (27 nov 2026). Mismos nombres de función y criterios neutros que las herramientas de
# cometas de SASpro (sas/herramientas/cometas.py), para que la guía sea común:
#   apilarCometa: calibra como apilarCandidatos, registra por estrellas (N de N), apila las estrellas, localiza el
#     núcleo en cada toma (sin estrellas: cada toma menos la mediana de todas), ajusta x(t), y(t) en línea recta con
#     DATE-OBS + EXPTIME/2, desplaza cada toma al núcleo de la toma central (matriz de traslación en el .seq y
#     seqapplyreg; comprobado con 2 tomas y, si no cuadra, desplazado con numpy), y saca candidatos del cometa
#     (rechazos de Siril y, propios, mediana / media 1-1 con máscara de estrellas por toma). Método A (quitaestrellas
#     sobre el mejor, núcleo protegido) y B (seqstarnet por toma) opcionales. Mide y recomienda.
#   combinarCometaEstrellas: cometa + estrellas del apilado de estrellas (suma lineal o pantalla con el mismo estirado).
#   transferirColorCometa: la calibración de color del apilado de estrellas (antes → después) aplicada al cometa.
#   larsonSekanina: solo análisis (2·I − rot(+α) − rot(−α) alrededor del núcleo), previas; la imagen no cambia.
# Siril no tiene comando de script para el registro de cometa (solo en la interfaz): por eso el núcleo y el
# desplazamiento se hacen aquí. Coordenadas como se ven en Siril: (0, 0) arriba a la izquierda.

import json
import math
import os
import re
import shutil
import time
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

import herramientas as H
import pasos as P
import apilado as A
import tomas_estrellas as TE
import limpieza_tomas as LT

_r = H._r
AVISO_VERDE = ("La coma de muchos cometas es verde de verdad (C2 y CN): no quites el verde (SCNR) en la coma; si hace "
               "falta, solo en el fondo con una máscara que la excluya.")
RECHAZOS_SIRIL = {"w33": ("rej", "w", "3", "3"), "w11": ("rej", "w", "1", "1"), "mad11": ("rej", "a", "1", "1"),
                  "mediana": ("med",)}
NOMBRES = {"w33": "winsorized 3/3", "w11": "winsorized 1/1", "mad11": "MAD 1/1", "mediana": "mediana",
           "mediana_mascara": "mediana + máscara de estrellas", "media11_mascara": "media 1/1 + máscara de estrellas"}


# --- Utilidades ----------------------------------------------------------------------------------------------------

def _cv2():
    try:
        import cv2
        return cv2
    except Exception:
        return None


def _fits():
    from astropy.io import fits
    return fits


def _hdu(hd):
    for h in hd:
        if h.data is not None and getattr(h.data, "ndim", 0) >= 2:
            return h
    raise ValueError("el FITS no tiene imagen")


def _escala_bitpix(bitpix):
    return {8: 255.0, 16: 65535.0, 32: 4294967295.0}.get(int(bitpix), 1.0)


def _leer(ruta, recorte=None):
    """FITS → (float32 0–1 (c, alto, ancho) con la fila 0 arriba, como se ve en Siril; cabecera). recorte = (x0, y0,
    x1, y1) en esas coordenadas: lee solo esa zona (hdu.section)."""
    fits = _fits()
    with fits.open(str(ruta), memmap=True) as hd:
        h = _hdu(hd)
        cab = h.header
        arriba = str(cab.get("ROWORDER", "")).upper().startswith("TOP")
        forma = h.data.shape if recorte is None else h.shape
        alto = forma[-2]
        if recorte is None:
            a = np.asarray(h.data, dtype=np.float32)
        else:
            x0, y0, x1, y1 = recorte
            f0, f1 = (y0, y1) if arriba else (alto - y1, alto - y0)
            a = np.asarray(h.section[..., f0:f1, x0:x1], dtype=np.float32)
        k = _escala_bitpix(cab.get("BITPIX", -32))
        if k != 1.0:
            a = a / np.float32(k)
        if a.ndim == 2:
            a = a[np.newaxis]
        if not arriba:
            a = a[:, ::-1, :]
        return np.ascontiguousarray(a), {k2: cab[k2] for k2 in cab.keys() if k2 and k2 not in ("COMMENT", "HISTORY")}


def _forma(ruta):
    fits = _fits()
    with fits.open(str(ruta), memmap=True) as hd:
        s = _hdu(hd).shape
    return (1,) + tuple(s) if len(s) == 2 else tuple(s)


CLAVES_CAB = ("DATE-OBS", "EXPTIME", "EXPOSURE", "INSTRUME", "TELESCOP", "FILTER", "OBJECT", "FOCALLEN", "XPIXSZ",
              "YPIXSZ", "GAIN", "ISOSPEED", "CCD-TEMP")


def _escribir(ruta, p, cab=None, extra=None):
    """(c, alto, ancho) 0–1 con la fila 0 arriba → FITS float32 de abajo arriba (el orden normal de Siril)."""
    fits = _fits()
    d = np.ascontiguousarray(np.asarray(p, np.float32)[:, ::-1, :])
    hdu = fits.PrimaryHDU(d[0] if d.shape[0] == 1 else d)
    for k in CLAVES_CAB:
        if cab and k in cab:
            try:
                hdu.header[k] = cab[k]
            except Exception:
                pass
    for k, v in (extra or {}).items():
        hdu.header[k] = v
    Path(ruta).parent.mkdir(parents=True, exist_ok=True)
    hdu.writeto(str(ruta), overwrite=True)
    return str(ruta)


def _lum(p):
    return p.mean(axis=0) if p.shape[0] > 1 else p[0]


def _mad(x):
    v = np.asarray(x, np.float64).ravel()
    v = v[np.isfinite(v)]
    if v.size == 0:
        return 0.0, 0.0
    m = float(np.median(v))
    return m, 1.4826 * float(np.median(np.abs(v - m)))


def _suave(x, s):
    x = np.asarray(x, np.float32)
    cv2 = _cv2()
    if cv2 is not None:
        return cv2.GaussianBlur(x, (0, 0), float(s))
    return P._gauss(x, float(s))


def _binar(x, b):
    if b <= 1:
        return np.asarray(x, np.float32)
    h, w = x.shape[0] // b * b, x.shape[1] // b * b
    return x[:h, :w].reshape(h // b, b, w // b, b).mean(axis=(1, 3)).astype(np.float32)


def _desplazar(c, dx, dy):
    """Canal 2D desplazado (dx, dy) píxeles (subpíxel, Lanczos4 con cv2; bilineal si no); fuera de la imagen, 0."""
    c = np.asarray(c, np.float32)
    cv2 = _cv2()
    if cv2 is not None:
        M = np.float32([[1, 0, dx], [0, 1, dy]])
        return cv2.warpAffine(c, M, (c.shape[1], c.shape[0]), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT,
                              borderValue=0)
    ix, iy = int(np.floor(dx)), int(np.floor(dy))
    fx, fy = dx - ix, dy - iy
    out = np.zeros_like(c)
    for oy, wy in ((iy, 1 - fy), (iy + 1, fy)):
        for ox, wx in ((ix, 1 - fx), (ix + 1, fx)):
            if wx * wy == 0:
                continue
            out += wx * wy * _mover_entero(c, ox, oy)
    return out


def _mover_entero(m, dx, dy, relleno=0):
    """m desplazado un número entero de píxeles: out(y, x) = m(y − dy, x − dx)."""
    out = np.full_like(m, relleno)
    h, w = m.shape
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    if abs(dy) < h and abs(dx) < w:
        out[yd, xd] = m[ys, xs]
    return out


def _dilatar(m, r):
    cv2 = _cv2()
    if cv2 is not None and r > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
        return cv2.dilate(m.astype(np.uint8), k) > 0
    return P._dilatar(m, r) if r > 0 else m


def _apertura(x, r):
    """Apertura en gris (erosión + dilatación, disco de radio r): quita las manchas más pequeñas que el disco (estrellas)
    y deja las extensas (la coma)."""
    x = np.asarray(x, np.float32)
    if r <= 0:
        return x
    cv2 = _cv2()
    if cv2 is not None:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
        return cv2.morphologyEx(x, cv2.MORPH_OPEN, k)
    from numpy.lib.stride_tricks import sliding_window_view as _ven
    def _filtro(a, f):
        z = np.pad(a, r, mode="edge")
        return f(_ven(z, (2 * r + 1, 2 * r + 1)), axis=(-2, -1)).astype(np.float32)
    return _filtro(_filtro(x, np.min), np.max)


def _margen(h, w, minimo=8):
    """Margen sin buscar el núcleo: el marco que deja el registro y las estrellas brillantes cortadas por el borde
    ganan a la coma, que es difusa (prueba SAS con el Lemmon, 27-nov: semilla en y=2 sobre una estrella cortada)."""
    return max(minimo, int(0.04 * min(h, w)))


def _tiempo(cab):
    """Mitad de la exposición: DATE-OBS (inicio) + EXPTIME/2. None si no hay fecha."""
    d = str(cab.get("DATE-OBS") or "").strip().rstrip("Z")
    if not d:
        return None
    try:
        t = datetime.fromisoformat(d[:26])
    except ValueError:
        return None
    exp = cab.get("EXPTIME", cab.get("EXPOSURE"))
    if isinstance(exp, (int, float)) and exp > 0:
        t += timedelta(seconds=float(exp) / 2)
    return t


def _jpg(q, ruta):
    Path(ruta).parent.mkdir(parents=True, exist_ok=True)
    return P._jpg(np.clip(np.nan_to_num(q, nan=0.0), 0, 1), ruta)


def _reducida(p, lado=1400):
    paso = max(1, int(np.ceil(max(p.shape[1], p.shape[2]) / lado)))
    return np.nan_to_num(p[:, ::paso, ::paso].astype(np.float32), nan=0.0)


def _lineal(p):
    q = _reducida(p, 600)
    return bool(P._lineal(q) or float(np.percentile(q, 99)) < 0.3)


def _centroide(D, x, y, r):
    """Centroide de lo que pasa de la mitad del máximo en un radio r alrededor de (x, y) (tres vueltas)."""
    h, w = D.shape
    for _ in range(3):
        x0, x1 = max(0, int(x - r)), min(w, int(x + r) + 1)
        y0, y1 = max(0, int(y - r)), min(h, int(y + r) + 1)
        z = D[y0:y1, x0:x1]
        if z.size == 0:
            break
        yy, xx = np.mgrid[y0:y1, x0:x1]
        dentro = (xx - x) ** 2 + (yy - y) ** 2 <= r * r
        pico = float(z[dentro].max()) if dentro.any() else 0.0
        wgt = np.where(dentro, np.clip(z - 0.5 * pico, 0, None), 0)
        s = float(wgt.sum())
        if s <= 0:
            break
        x, y = float((wgt * xx).sum() / s), float((wgt * yy).sum() / s)
    return x, y


def _pico(D, x=None, y=None, R=None, borde=8):
    """Máximo de D (en todo D o en un radio R alrededor de (x, y)), lejos del borde."""
    h, w = D.shape
    Z = np.full_like(D, -np.inf)
    Z[borde:h - borde, borde:w - borde] = D[borde:h - borde, borde:w - borde]
    if x is not None:
        yy, xx = np.ogrid[:h, :w]
        Z = np.where((xx - x) ** 2 + (yy - y) ** 2 <= R * R, Z, -np.inf)
    i = int(np.argmax(Z))
    return float(i % w), float(i // w), float(Z.flat[i])


def _ajuste(t, x, y, peso=None):
    """Recta robusta x(t), y(t): dos vueltas quitando lo que se aleja más de max(1 px, 4 MAD). Devuelve (fx, fy, rms,
    índices fuera)."""
    t, x, y = (np.asarray(v, np.float64) for v in (t, x, y))
    ok = np.ones(t.size, bool) if peso is None else np.asarray(peso, bool)
    if ok.sum() < 2:
        ok = np.ones(t.size, bool)
    for _ in range(3):
        if ok.sum() < 2:
            break
        cx = np.polyfit(t[ok], x[ok], 1) if np.ptp(t[ok]) > 0 else np.array([0.0, np.median(x[ok])])
        cy = np.polyfit(t[ok], y[ok], 1) if np.ptp(t[ok]) > 0 else np.array([0.0, np.median(y[ok])])
        res = np.hypot(x - np.polyval(cx, t), y - np.polyval(cy, t))
        s = 1.4826 * float(np.median(res[ok]))
        nuevo = res <= max(1.0, 4 * s)
        if (nuevo == ok).all():
            break
        ok = nuevo if nuevo.sum() >= max(2, 0.5 * t.size) else ok
    rms = float(np.sqrt(np.mean(res[ok] ** 2))) if ok.any() else 0.0
    return (lambda tt: np.polyval(cx, tt)), (lambda tt: np.polyval(cy, tt)), rms, [int(i) for i in np.nonzero(~ok)[0]]


# --- Secuencias de Siril ----------------------------------------------------------------------------------------------

def _leer_seq(ruta):
    lineas = Path(ruta).read_text(encoding="utf-8", errors="replace").splitlines()
    nombre, largo, imgs = None, 5, []
    for l in lineas:
        if l.startswith("S "):
            m = re.match(r"S\s+'([^']*)'\s+(-?\d+)\s+(\d+)\s+(\d+)\s+(\d+)", l)
            if m:
                nombre, largo = m.group(1), int(m.group(5)) or 5
        elif l.startswith("I "):
            p = l.split()
            imgs.append((int(p[1]), p[2] == "1"))
    return lineas, nombre, largo, imgs


def _ficheros_seq(carpeta, seq):
    """[(nº de fichero, incluida, ruta)] de la secuencia, en el orden del .seq."""
    ruta = A._fichero_seq(carpeta, seq)
    _, nombre, largo, imgs = _leer_seq(ruta)
    out = []
    for num, inc in imgs:
        cand = [f for f in Path(carpeta).glob(f"{nombre}{num:0{largo}d}.*") if f.suffix.lower() in A.EXT_FITS + (".fz",)]
        out.append((num, inc, cand[0] if cand else None))
    return out


def _escribir_seq(ruta, lineas, desplaz, incluir=None, referencia=None):
    """Copia del .seq con la matriz H de cada imagen cambiada por una traslación (desplaz[i] = (hx, hy), en el orden
    de las líneas I). incluir: conjunto de índices que quedan seleccionados (el resto, no). Si no hay líneas R, se
    añaden para la capa 1 (verde en color, la que usa Siril por defecto)."""
    out, i_img, n_sel, capas_r = [], 0, 0, {}
    for l in lineas:
        if l.startswith("I "):
            p = l.split()
            sel = p[2] if incluir is None else ("1" if i_img in incluir else "0")
            n_sel += sel == "1"
            p[2] = sel
            out.append(" ".join(p))
            i_img += 1
        elif re.match(r"R\d+\s", l):
            capa = l.split()[0]
            k = capas_r.get(capa, 0)
            capas_r[capa] = k + 1
            hx, hy = desplaz[k] if k < len(desplaz) else (0.0, 0.0)
            cabeza = l.split(" H ")[0] if " H " in l else l
            out.append(f"{cabeza} H 1 0 {hx:.6f} 0 1 {hy:.6f} 0 0 1")
        else:
            out.append(l)
    if not capas_r:
        ultima_i = max(j for j, l in enumerate(out) if l.startswith("I "))
        nuevas = [f"R1 0 0 0 0 0 0 H 1 0 {hx:.6f} 0 1 {hy:.6f} 0 0 1" for hx, hy in desplaz]
        out = out[:ultima_i + 1] + nuevas + out[ultima_i + 1:]
    for j, l in enumerate(out):
        if l.startswith("S "):
            p = l.split(" ")
            p[4] = str(n_sel)
            if referencia is not None and len(p) > 6:
                p[6] = str(int(referencia))
            out[j] = " ".join(p)
            break
    Path(ruta).write_text("\n".join(out) + "\n", encoding="utf-8")


def _borrar_seq(carpeta, prefijo):
    for f in Path(carpeta).glob(f"{prefijo}*"):
        try:
            f.unlink()
        except OSError:
            pass


# --- Núcleo ------------------------------------------------------------------------------------------------------------

def _seguir_grueso(Lb, horas, b, nucleo=None, nucleo_final=None):
    """Núcleo en cada toma (binada ×b): cada toma menos la mediana de todas (las estrellas, quietas tras el registro, se
    van; el cometa, que se mueve, queda), suavizada; el máximo. Con nucleo / nucleo_final (px de la imagen completa) se
    busca cerca de ellos. Devuelve posiciones (en px binados), relación señal/ruido y el residuo D de cada toma."""
    n = len(Lb)
    fondo = np.median(np.stack(Lb), axis=0)
    D = [_suave(L - fondo, 2.0) for L in Lb]
    _, ruido = _mad(np.concatenate([d[::3, ::3].ravel() for d in D]))
    ruido = max(ruido, 1e-9)
    h, w = Lb[0].shape
    xs, ys, snr = np.zeros(n), np.zeros(n), np.zeros(n)
    a0 = (nucleo[0] / b, nucleo[1] / b) if nucleo else None
    a1 = (nucleo_final[0] / b, nucleo_final[1] / b) if nucleo_final else None
    t0, t1 = horas[0], horas[-1]
    for i in range(n):
        if a0 and a1:
            f = (horas[i] - t0) / (t1 - t0) if t1 > t0 else 0.0
            px, py = a0[0] + f * (a1[0] - a0[0]), a0[1] + f * (a1[1] - a0[1])
            R = 30 / b + 0.1 * np.hypot(a1[0] - a0[0], a1[1] - a0[1])
        elif a0 and i == 0:
            px, py, R = a0[0], a0[1], 60 / b
        elif a0:
            if i >= 2 and horas[i - 1] > horas[i - 2]:
                v = ((xs[i - 1] - xs[i - 2]) / (horas[i - 1] - horas[i - 2]), (ys[i - 1] - ys[i - 2]) / (horas[i - 1] - horas[i - 2]))
            else:
                v = (0.0, 0.0)
            dt = horas[i] - horas[i - 1]
            px, py = xs[i - 1] + v[0] * dt, ys[i - 1] + v[1] * dt
            R = 0.15 * max(h, w) if i == 1 else max(30 / b, 3 * np.hypot(v[0], v[1]) * dt + 10 / b)
        else:
            px = py = R = None
        if px is None:                    # búsqueda libre: lejos del borde y sin restos compactos de estrellas
            x, y, v = _pico(_apertura(D[i], max(2, int(round(12 / b)))), borde=_margen(h, w))
        else:
            x, y, v = _pico(D[i], px, py, R)
        xs[i], ys[i], snr[i] = x, y, v / ruido
    return xs, ys, snr, D, ruido


def _radio_coma(D, x, y, ruido, rmax):
    """Radio (px de D) donde el perfil radial medio de D baja de 2 σ."""
    h, w = D.shape
    yy, xx = np.indices(D.shape)
    rr = np.hypot(xx - x, yy - y).astype(np.int32)
    lim = int(min(rmax, max(h, w)))
    sel = rr < lim
    perfil = np.bincount(rr[sel].ravel(), weights=D[sel].ravel(), minlength=lim) / np.maximum(
        np.bincount(rr[sel].ravel(), minlength=lim), 1)
    bajo = np.nonzero(perfil < 2 * ruido)[0]
    return float(bajo[0]) if bajo.size else float(lim)


def _localizar(frames, horas, nucleo, nucleo_final, forma, b=None):
    """Núcleo en cada toma registrada por estrellas, en px de la imagen completa. 1) grueso, binado; 2) fino, en una caja
    a resolución completa alrededor de la trayectoria (caja − mediana de las cajas de todas las tomas)."""
    c, h, w = forma
    b = b or max(1, int(round(max(h, w) / 1500)))
    Lb = []
    for i, f in enumerate(frames):
        A._progreso(f"núcleo: leyendo toma {i + 1}/{len(frames)}")
        p, _ = _leer(f)
        Lb.append(_binar(_lum(p), b))
        del p
    xs, ys, snr, D, ruido = _seguir_grueso(Lb, horas, b, nucleo, nucleo_final)
    buenos = snr > 5
    if buenos.sum() < max(2, int(np.ceil(0.6 * len(frames)))):
        raise RuntimeError(
            f"No encuentro el núcleo en bastantes tomas ({int(buenos.sum())} de {len(frames)} con señal/ruido > 5). "
            "Pasa 'nucleo': [x, y] de la primera toma y 'nucleo_final': [x, y] de la última (px como se ven en Siril, "
            "en las tomas registradas r_…). Si el cometa casi no se mueve en la sesión, no hace falta alinear en él: "
            "basta el apilado normal (apilarCandidatos).")
    fx, fy, rms_g, fuera_g = _ajuste(horas, xs, ys, buenos)
    ir = int(np.argmin(np.abs(np.asarray(horas) - np.median(horas))))
    rc_b = _radio_coma(D[ir], fx(horas[ir]), fy(horas[ir]), ruido, 400 / b)
    r_coma = float(np.clip(rc_b * b, 10, 400))
    # caja fina alrededor de la trayectoria
    px_all, py_all = fx(np.asarray(horas)) * b + b / 2, fy(np.asarray(horas)) * b + b / 2
    m = int(max(48, 2 * r_coma))
    x0, x1 = max(0, int(px_all.min()) - m), min(w, int(px_all.max()) + m)
    y0, y1 = max(0, int(py_all.min()) - m), min(h, int(py_all.max()) + m)
    movimiento = float(np.hypot(np.ptp(px_all), np.ptp(py_all)))
    if (x1 - x0) * (y1 - y0) * len(frames) > 4e8:          # caja enorme (> 1,6 GB): se queda la posición gruesa
        X, Y = px_all.copy(), py_all.copy()
        X[buenos], Y[buenos] = xs[buenos] * b + b / 2, ys[buenos] * b + b / 2
        return X, Y, {"r_coma": r_coma, "binado": b, "fino": False, "movimiento_px": movimiento, "snr": snr}
    C = []
    for i, f in enumerate(frames):
        A._progreso(f"núcleo fino: toma {i + 1}/{len(frames)}")
        p, _ = _leer(f, (x0, y0, x1, y1))
        C.append(_lum(p))
    C = np.stack(C)
    fondo = np.median(C, axis=0)
    X, Y, snr_f = np.zeros(len(frames)), np.zeros(len(frames)), np.zeros(len(frames))
    for i in range(len(frames)):
        if movimiento > 4 * 6:                            # se mueve más que el núcleo: diferencia con la mediana
            Di = _suave(C[i] - fondo, 1.5)
        else:                                            # casi quieto: la toma sola, sin su fondo local
            Di = _suave(C[i], 1.5) - _suave(C[i], 25)
        ex, ey = px_all[i] - x0, py_all[i] - y0
        x, y, v = _pico(Di, ex, ey, 3 * b + 6, borde=2)
        x, y = _centroide(Di, x, y, 5)
        _, s = _mad(Di[::2, ::2])
        X[i], Y[i], snr_f[i] = x + x0, y + y0, v / max(s, 1e-9)
    return X, Y, {"r_coma": r_coma, "binado": b, "fino": True, "movimiento_px": movimiento, "snr": snr_f}


def _corr_fase(a, b):
    """Desplazamiento (dx, dy) tal que a(x, y) ≈ b(x − dx, y − dy), por correlación de fase (subpíxel con parábola)."""
    a = a - float(np.median(a))
    b = b - float(np.median(b))
    win = np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1])).astype(np.float32)
    Fa, Fb = np.fft.rfft2(a * win), np.fft.rfft2(b * win)
    R = Fa * np.conj(Fb)
    r = np.fft.irfft2(R / np.maximum(np.abs(R), 1e-12), s=a.shape)
    iy, ix = np.unravel_index(int(np.argmax(r)), r.shape)
    h, w = r.shape

    def fino(m, c, n):
        y0, y1, y2 = m(c - 1), m(c), m(c + 1)
        d = y0 - 2 * y1 + y2
        return c + (0.5 * (y0 - y2) / d if d != 0 else 0.0)

    fx = fino(lambda k: r[iy, k % w], ix, w)
    fy = fino(lambda k: r[k % h, ix], iy, h)
    return (fx - w if fx > w / 2 else fx), (fy - h if fy > h / 2 else fy)


def _comprobar_traslacion(salida, origen, esperado, lado=1024):
    """Cuánto se aparta (px) el desplazamiento real de 'salida' respecto a 'origen' del esperado (dx, dy). Lo dominan las
    estrellas: no depende de que el núcleo destaque."""
    _, h, w = _forma(origen)
    l = min(lado, h, w)
    x0, y0 = (w - l) // 2, (h - l) // 2
    a = _lum(_leer(salida, (x0, y0, x0 + l, y0 + l))[0])
    b = _lum(_leer(origen, (x0, y0, x0 + l, y0 + l))[0])
    mx, my = _corr_fase(a, b)
    return float(np.hypot(mx - esperado[0], my - esperado[1]))


# --- Estrellas y métricas ----------------------------------------------------------------------------------------------

def _mascara_estrellas(Ls, tray, r_banda):
    """Estrellas del apilado de estrellas: paso alto > 5 σ, agrandadas 4 px (12 px las muy brillantes), sin la banda de
    la trayectoria del núcleo (ahí el apilado de estrellas tiene las copias del núcleo, no estrellas)."""
    hp = Ls - _suave(Ls, 4)
    _, s = _mad(hp[::2, ::2])
    s = max(s, 1e-9)
    m = _dilatar(hp > 5 * s, 4) | _dilatar(hp > 60 * s, 12)
    h, w = Ls.shape
    yy, xx = np.ogrid[:h, :w]
    (ax, ay), (bx, by) = tray
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy
    t = np.clip(((xx - ax) * vx + (yy - ay) * vy) / L2, 0, 1) if L2 > 0 else 0.0
    d = np.hypot(xx - (ax + t * vx), yy - (ay + t * vy))
    return m & (d > r_banda)


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


def _metricas(p, xy, r_coma, mascara=None, mov=None):
    """Mismos criterios que en SASpro: ruido del cielo (MAD del paso alto), restos de estrellas fuera de la coma
    (píxeles del paso alto > 6 σ por MP, en una caja de 0,3 × el lado menor alrededor del núcleo) y señal de coma +
    cola (lo que pasa del cielo tras suavizar, sin los restos)."""
    L = np.nan_to_num(_lum(p), nan=0.0)
    h, w = L.shape
    cielo, _ = _mad(L[::4, ::4])
    hp = L - _suave(L, 2)
    _, ruido = _mad(hp[::2, ::2])
    ruido = max(ruido, 1e-8)
    R = int(min(h, w) * 0.3)
    x, y = int(round(xy[0])), int(round(xy[1]))
    x0, x1, y0, y1 = max(0, x - R), min(w, x + R), max(0, y - R), min(h, y + R)
    z, zh = L[y0:y1, x0:x1], hp[y0:y1, x0:x1]
    yy, xx = np.ogrid[y0:y1, x0:x1]
    lejos = (xx - xy[0]) ** 2 + (yy - xy[1]) ** 2 > (1.5 * r_coma) ** 2
    restos = (zh > 6 * ruido) & lejos
    senal = np.clip(_suave(z, 6) - cielo, 0, None)
    est = mascara[y0:y1, x0:x1] if mascara is not None else np.zeros_like(restos)
    return {"ruido_fondo": _r(ruido, 7), "cielo": _r(cielo, 6),
            "restos_estrellas_por_mp": _r(float(restos.sum()) / max(z.size / 1e6, 1e-6), 1),
            **(_trazos(L, xy, r_coma, mov) if mov is not None else {}),
            "senal_coma_cola": float(senal[~(restos | est)].sum())}


def _quitar_estrellas(siril, p, motor="auto"):
    """(starless, texto). StarX (rc-astro) o StarNet2 por sus ejecutables; si no hay ninguno, apertura morfológica
    propia (aproximada, deja halos)."""
    lineal = _lineal(p)
    motores = [motor] if motor != "auto" else ["starx", "starnet2", "propio"]
    ultimo = None
    for m in motores:
        try:
            if m == "starx" and P._rcastro_exe():
                out, _ = P._rcastro(siril, np.clip(p, 0, 1).astype(np.float32), "sxt", [])
                return np.asarray(out["salida"], np.float32).reshape(p.shape), "StarXTerminator (rc-astro)"
            if m == "starnet2" and P._starnet2_exe(siril):
                sl, _, _ = P._separar_starnet2(siril, None, np.clip(p, 0, 1).astype(np.float32), lineal, False)
                return np.asarray(sl, np.float32).reshape(p.shape), "StarNet2"
            if m == "propio":
                cv2 = _cv2()
                if cv2 is None:
                    raise RuntimeError("sin cv2")
                k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
                sl = np.stack([cv2.GaussianBlur(cv2.morphologyEx(ch, cv2.MORPH_OPEN, k), (0, 0), 2) for ch in p])
                return np.minimum(sl, p).astype(np.float32), "apertura morfológica propia (sin StarX ni StarNet2; aproximada)"
        except Exception as e:
            if motor != "auto":
                raise
            ultimo = e
            continue
    raise RuntimeError(f"No hay quitaestrellas disponible ({ultimo or motor}).")


# --- apilarCometa ------------------------------------------------------------------------------------------------------

def _plan(raiz, lights, osc, max_tomas):
    fs = sorted(Path(f) for g in lights for f in g["ficheros"])
    n = len(fs) if not max_tomas else min(len(fs), int(max_tomas))
    mts = sorted(_hora_exif(f) or f.stat().st_mtime for f in fs)
    dur_h = (mts[-1] - mts[0]) / 3600 if len(mts) > 1 else 0.0
    mp = None
    tam = next((g.get("tam") for g in lights if g.get("tam")), None)
    if tam and "x" in str(tam):
        a, b2 = (int(v) for v in str(tam).split("x"))
        mp = a * b2 / 1e6
    if mp is None:
        mp = float(np.median([f.stat().st_size for f in fs])) / 1e6        # RAW: ~1 MB por megapíxel
    c = 3 if osc else 1
    gb = n * mp * 1e6 * (2 + 4 * c * 3) / 1e9 + 2 * mp * 1e6 * 4 * c * 10 / 1e9
    return {"tomas": n, "de": len(fs), "osc": osc, "duracion_h_aprox": _r(dur_h, 2),
            "megapixeles_aprox": _r(mp, 1), "disco_gb_aprox": _r(gb, 1), "minutos_aprox": _r(n * mp * 0.012 + 3, 0)}


def _hora_exif(f):
    """Hora EXIF de un RAW (primera fecha «AAAA:MM:DD HH:MM:SS» de los primeros 256 KB; en CR3/CR2/NEF es la de la
    toma). Para el plan: la fecha del fichero es la de la copia (Lemmon 27-nov: el plan decía 0,02 h en vez de 0,58)."""
    import re
    from datetime import datetime
    if Path(f).suffix.lower() in (".fit", ".fits", ".fts", ".xisf"):
        return None
    try:
        with open(f, "rb") as fh:
            m = re.search(rb"(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})", fh.read(262144))
        return datetime(*(int(g) for g in m.groups())).timestamp() if m else None
    except Exception:
        return None


def _variantes_estrellas(frames, nombres, f_est, zona, avisos, pasos):
    """Capa de estrellas: mide cada toma registrada (estrellas desdobladas por un salto de la montura o viento) y, si
    hay desdobladas, apila en numpy (winsorized 3/3, normalización aditiva con escala contra la toma central) con pesos
    y solo con las limpias; las lleva al nivel del apilado de Siril (todas), las mide fuera de la coma y prueba a
    alinear R y B al verde. Devuelve (candidatos con 'p', recomendado, calidad por toma)."""
    n = len(frames)
    calidad, estad = [], []
    for i, f in enumerate(frames):
        A._progreso(f"estrellas: midiendo la toma {i + 1}/{n}")
        p, _ = _leer(f)
        p = np.where(p == 0, np.nan, p)                      # bordes sin dato del registro
        calidad.append(TE.medir_toma(np.nan_to_num(_lum(p), nan=0.0)))
        est_c = []
        for ch in p:
            v = ch[::4, ::4]
            v = v[np.isfinite(v)]
            m = float(np.median(v))
            est_c.append((m, float(1.4826 * np.median(np.abs(v - m))) or 1e-9))
        estad.append(est_c)
        del p
    pesos = TE.pesos_tomas(calidad)
    for c_, w_, nm in zip(calidad, pesos, nombres):
        c_["peso"], c_["toma"] = w_, nm
    pe, _ = _leer(f_est)
    cand = [{"id": "todas", "metodo": "winsorized 3/3 de Siril, todas las tomas", "p": pe}]
    desd = [nm for c_, nm in zip(calidad, nombres) if c_.get("desdoblada")]
    if desd:
        limpias = [0.0 if c_.get("desdoblada") else 1.0 for c_ in calidad]
        var = {"pesos": ("winsorized 3/3 con peso por toma (desdobladas hasta 0,3)", pesos)}
        if sum(limpias) >= max(5, n // 4):
            var["limpias"] = (f"winsorized 3/3 solo con las {int(sum(limpias))} tomas limpias", limpias)
        var["_uniforme"] = ("numpy, todas (referencia de nivel)", [1.0] * n)
        avisos.append(f"{len(desd)} de {n} tomas con las estrellas desdobladas (pares en una dirección: salto de la "
                      f"montura o viento): {', '.join(desd)}. Se apilan también variantes de la capa de estrellas con "
                      "pesos y solo con las limpias (el cometa sigue con todas).")
        iref = n // 2
        c, h, w = pe.shape
        filas = max(16, int(6e8 / max(1, n * c * w * 4)))
        out = {k: np.empty((c, h, w), np.float32) for k in var}
        for y0 in range(0, h, filas):
            y1 = min(h, y0 + filas)
            A._progreso(f"estrellas: apilado con pesos, filas {y0}/{h}")
            cubo = np.empty((n, c, y1 - y0, w), np.float32)
            for i, f in enumerate(frames):
                b, _ = _leer(f, recorte=(0, y0, w, y1))
                b = np.where(b == 0, np.nan, b)
                for k in range(c):
                    (m0, s0), (m1, s1) = estad[i][k], estad[iref][k]
                    b[k] = (b[k] - m0) * (s1 / s0) + m1
                cubo[i] = b
            for k, (_, wts) in var.items():
                out[k][:, y0:y1], _ = TE.reducir_pesos(cubo, wts)
            del cubo
        # al nivel del apilado de Siril (normalización y -rgb_equal distintos): fondo y escala por canal
        u = out.pop("_uniforme")
        var.pop("_uniforme")
        for k in range(c):
            a, b = u[k, ::4, ::4], pe[k, ::4, ::4]
            ma, mb = float(np.nanmedian(a)), float(np.nanmedian(b))
            sa = float(1.4826 * np.nanmedian(np.abs(a - ma))) or 1e-9
            sb = float(1.4826 * np.nanmedian(np.abs(b - mb))) or 1e-9
            for q in out.values():
                q[k] = (q[k] - ma) * (sb / sa) + mb
        del u
        cand += [{"id": k, "metodo": nom, "p": np.nan_to_num(out[k], nan=0.0)} for k, (nom, _) in var.items()]
    for k in cand:
        A._progreso(f"estrellas: midiendo la capa {k['id']}")
        k.update(TE.medir_capa(k["p"], zona))
    r0 = cand[0]
    acept = [k for k in cand if k.get("ruido_fino", 1) <= 1.35 * r0.get("ruido_fino", 1)
             and not TE.nucleo_peor(k, r0)] or [r0]
    mejor = min(acept, key=lambda k: k.get("excentricidad", 1) + 0.5 * k.get("fwhm_px", 99) / max(r0.get("fwhm_px", 1), 1e-6))
    pa, dc = TE.alinear_canales(mejor["p"])
    if dc:
        dRB = math.hypot(dc["B_menos_G_px"][0] - dc["R_menos_G_px"][0], dc["B_menos_G_px"][1] - dc["R_menos_G_px"][1])
        if dRB > 0.25:
            ka = {"id": mejor["id"] + "_alineada", "metodo": mejor["metodo"] + " + R y B alineados al verde", "p": pa,
                  "desplazamiento_corregido": dc}
            ka.update(TE.medir_capa(pa, zona))
            cand.append(ka)
            if TE.nucleo_peor(ka, mejor):
                pasos.append("Capa de estrellas: alinear R y B empeora el centro de las estrellas brillantes; no se adopta")
            else:
                mejor = ka
                pasos.append(f"Capa de estrellas: R y B desplazados {dRB:.2f} px entre sí (dispersión atmosférica o "
                         "cromática); alineados al verde")
    # núcleos quemados: el centro de las estrellas brillantes pierde verde (quemado en unas tomas y en otras no) y, tras
    # calibrar y estirar, sale un disco blanco-azulado o rosado con una mancha roja al lado (Lemmon, 27-nov). Después de
    # alinear (la alineación no mide en estrellas quemadas): el núcleo toma el color del anillo que lo rodea.
    pr, inf = TE.reparar_nucleos(mejor["p"], excluir=zona)
    if inf and inf.get("nucleos"):
        kr = {"id": mejor["id"] + "_nucleos", "metodo": mejor["metodo"] + " + núcleos quemados reparados", "p": pr,
              "nucleos_reparados": inf}
        kr.update(TE.medir_capa(pr, zona))
        cand.append(kr)
        if not TE.nucleo_peor(kr, mejor):
            pasos.append(f"Capa de estrellas: {inf['nucleos']} núcleos quemados reparados con el color de su "
                         f"anillo (asimetría de color del núcleo p90 {mejor.get('nucleo_color_p90')} → "
                         f"{kr.get('nucleo_color_p90')})")
            mejor = kr
    pasos.append(f"Capa de estrellas recomendada: {mejor['metodo']} (FWHM {mejor.get('fwhm_px')} px, excentricidad "
                 f"{mejor.get('excentricidad')}, ruido ×{mejor.get('ruido_fino', 0) / max(r0.get('ruido_fino', 1e-9), 1e-9):.2f} "
                 "frente a todas)")
    return cand, mejor, calidad


def apilarCometa(siril, carpeta, nucleo=None, nucleo_final=None, rechazos=("w33", "w11", "mad11", "mediana"),
                 mascara_estrellas=True, quitar_restos=False, motor="auto", metodo_b=False, grupo=None, proyecto=None,
                 excluir=None, max_tomas=None, planSolo=False, conservar_intermedios=False, estrellas_pesos=True,
                 quitar_bandas=True, corregir_motas=True, recortar_bordes=True):
    """Cometa: calibra y registra por estrellas como apilarCandidatos, apila las estrellas, sigue el núcleo y apila
    en el cometa comparando rechazos (de Siril y con máscara de estrellas por toma). Deja cargado el cometa recomendado
    y guarda el de estrellas y el del cometa en la carpeta de trabajo. nucleo / nucleo_final: [x, y] en la primera y la
    última toma registradas (si no, se busca solo). quitar_restos: método A (quitaestrellas sobre el mejor, núcleo
    protegido). metodo_b: seqstarnet en cada toma (lento). planSolo: el plan, sin tocar Siril. quitar_bandas: resta el
    patrón de filas y columnas de cada toma registrada; corregir_motas (sin flats): divide las tomas por el mapa de las
    motas oscuras del apilado de estrellas; recortar_bordes: recorta los dos apilados a la zona con datos en todas las
    tomas, en las estrellas y en el cometa."""
    t0 = time.perf_counter()
    raiz, fichas, saltados = A._recorrer(carpeta, excluir)
    grupos = A._agrupar(fichas)
    lights = [g for g in grupos if g["tipo"] == "light"]
    nota_tipo = None
    if not lights:                                   # carpeta solo con las tomas (CR3 sin IMAGETYP): son los lights
        sin = [f for f in fichas if not f["tipo"]]
        if not sin:
            raise RuntimeError("No encuentro tomas en la carpeta. Mira inventarioSubs.")
        for f in sin:
            f["tipo"] = "light"
        grupos = A._agrupar(fichas)
        lights = [g for g in grupos if g["tipo"] == "light"]
        nota_tipo = f"{len(sin)} ficheros sin tipo (ni IMAGETYP ni carpeta «lights»): tomados como lights."
    if grupo:
        ids = {A._id_grupo(g): g for g in lights}
        gs = [grupo] if isinstance(grupo, str) else list(grupo)
        if any(x not in ids for x in gs):
            raise ValueError(f"Grupos de lights: {', '.join(ids)}")
        lights = [ids[x] for x in gs]
    if not A._compatibles_entre_si(lights):
        raise ValueError("Hay lights de filtros o exposiciones distintas: elige uno con 'grupo' (inventarioSubs).")
    osc = any(f.get("bayer") or f.get("raw") for f in fichas if any(f["fichero"] in g["ficheros"] for g in lights))
    if max_tomas and int(max_tomas) < sum(g["n"] for g in lights):     # repartidas por toda la serie
        todos = sorted(f for g in lights for f in g["ficheros"])
        idx = set(np.unique(np.round(np.linspace(0, len(todos) - 1, int(max_tomas))).astype(int)).tolist())
        quedan = {todos[i] for i in idx}
        for g in lights:
            g["ficheros"] = [f for f in g["ficheros"] if f in quedan]
            g["n"] = len(g["ficheros"])
        lights = [g for g in lights if g["n"]]
    avisos = [AVISO_VERDE] + ([nota_tipo] if nota_tipo else [])
    plan = _plan(raiz, lights, osc, None)
    cal = []
    for lg in lights:
        darks, flats, bias, dflats = A._compatibles(lg, grupos)
        cal.append({"grupo": A._id_grupo(lg), "darks": bool(darks), "flats": bool(flats), "bias": bool(bias or dflats)})
    if planSolo:
        libre = shutil.disk_usage(str(A.APILADO.parent if A.APILADO.parent.exists() else Path.home())).free / 1e9
        return {"plan": plan, "calibracion": cal, "disco_libre_gb": _r(libre, 1), "avisos": avisos + (
            ["Poco disco libre para las copias de trabajo."] if libre < plan["disco_gb_aprox"] * 1.2 else []),
            "pasos": ["calibrar (como apilarCandidatos) y registrar por estrellas (register -2pass, seqapplyreg); comprobar N de N",
                      "apilado de estrellas (winsorized 3/3)",
                      "núcleo en cada toma (toma − mediana de todas) y recta x(t), y(t) con DATE-OBS + EXPTIME/2",
                      "desplazar cada toma al núcleo de la toma central (traslación en el .seq + seqapplyreg; numpy si no cuadra)",
                      f"candidatos del cometa: {', '.join(NOMBRES.get(x, x) for x in rechazos)}"
                      + (" y mediana / media 1-1 con máscara de estrellas" if mascara_estrellas else ""),
                      "medir (ruido, restos de estrellas, señal de coma y cola), recomendar y dejarlo cargado"]
            + (["método A: quitaestrellas sobre el mejor, núcleo protegido"] if quitar_restos else [])
            + (["método B: seqstarnet en cada toma (lento)"] if metodo_b else []),
            "nota": "La velocidad del cometa se mide tras registrar (DATE-OBS de las tomas); aquí la duración sale de las "
                    "fechas de los ficheros."}

    nombre = re.sub(r"[^\w.-]+", "_", proyecto or f"cometa_{raiz.name}")[:80]
    trabajo = A.APILADO / nombre
    A._limpiar_intermedios(trabajo, tambien_masters=True)
    for sub in ("process", "masters", "candidatos", "unidos"):
        (trabajo / sub).mkdir(parents=True, exist_ok=True)
    proc = trabajo / "process"
    r = {"grupos": [A._id_grupo(g) for g in lights], "lights": sum(g["n"] for g in lights), "osc": osc,
         "trabajo": str(trabajo), "saltados": saltados, "pasos": [], "avisos": avisos, "calibracion": [], "errores": []}

    def cmd(*a):
        siril.cmd(*a)
        r["pasos"].append(" ".join(a))

    def cd(p):
        siril.cmd("cd", H._arg_cmd(Path(p)))

    # 1) calibrar y registrar por estrellas
    seq, _ = A._preparar(siril, trabajo, lights, grupos, osc, False, r, cmd, cd)
    A._progreso("registrar por estrellas (dos pasadas)")
    cmd("register", seq, "-2pass")
    cmd("seqapplyreg", seq, "-filter-incl")
    regs = [x for x in _ficheros_seq(proc, f"r_{seq}") if x[1] and x[2]]
    r["alineadas"] = f"{len(regs)} de {r['lights']}"
    if len(regs) < r["lights"]:
        avisos.append(f"Solo {len(regs)} de {r['lights']} tomas se registraron por estrellas: las demás no entran.")
    if len(regs) < 3:
        raise RuntimeError(f"Hacen falta al menos 3 tomas registradas ({r['alineadas']}).")
    frames = [x[2] for x in regs]
    nums_r = [x[0] for x in regs]
    cabs = [A._cabecera(f) for f in frames]
    tiempos = [_tiempo(c) for c in cabs]
    if any(t is None for t in tiempos):
        orig = sorted(f for g in lights for f in g["ficheros"])
        mt = [os.path.getmtime(f) for f in orig]
        tiempos = [datetime.fromtimestamp(mt[min(x[0] - 1, len(mt) - 1)]) for x in regs]
        avisos.append("Las tomas no traen DATE-OBS: uso la fecha de los ficheros originales (menos precisa).")
    orden = sorted(range(len(frames)), key=lambda i: tiempos[i])
    frames = [frames[i] for i in orden]
    tiempos = [tiempos[i] for i in orden]
    t_ref = tiempos[len(tiempos) // 2]
    horas = [(t - t_ref).total_seconds() / 3600 for t in tiempos]
    if max(horas) - min(horas) <= 0:
        raise RuntimeError("Todas las tomas tienen la misma hora: no se puede medir la velocidad del cometa.")
    forma = _forma(frames[0])

    # 2) estrellas
    A._progreso("apilado de estrellas")
    # sin -output_norm: reescala cada apilado a [0, 1] por su máximo y deja estrellas y candidatos en escalas distintas
    # (Lemmon 27-nov: cielo 0,0015 en estrellas, 0,12 en w33 y 0,032 en la mediana; la señal de la mediana salía al 25 %)
    st = ["stack", f"r_{seq}", "rej", "w", "3", "3", "-norm=addscale", "-32b"] + (["-rgb_equal"] if osc else [])
    cmd(*st, "-out=../candidatos/estrellas")
    f_est = (trabajo / "candidatos" / "estrellas.fit")
    if not f_est.exists():
        f_est = next((trabajo / "candidatos").glob("estrellas.fit*"))

    # 3) núcleo
    X, Y, info_n = _localizar(frames, horas, nucleo, nucleo_final, forma)
    fx, fy, rms, fuera = _ajuste(horas, X, Y)
    xr, yr = float(fx(0.0)), float(fy(0.0))
    vel = float(np.hypot(fx(1.0) - fx(0.0), fy(1.0) - fy(0.0)))
    usar_recta = rms <= 1.0
    PX = np.array([fx(t) if (usar_recta or i in fuera) else X[i] for i, t in enumerate(horas)])
    PY = np.array([fy(t) if (usar_recta or i in fuera) else Y[i] for i, t in enumerate(horas)])
    dx, dy = xr - PX, yr - PY
    r_coma = info_n["r_coma"]
    r["nucleo"] = {"referencia": [_r(xr, 1), _r(yr, 1)], "toma_referencia": frames[len(frames) // 2].name,
                   "velocidad_px_h": _r(vel, 2), "movimiento_total_px": _r(float(np.hypot(np.ptp(PX), np.ptp(PY))), 1),
                   "residuo_rms_px": _r(rms, 2), "fuera_de_la_recta": [frames[i].name for i in fuera],
                   "posiciones": "recta ajustada" if usar_recta else "medidas (el movimiento no es recto)",
                   "radio_coma_px": _r(r_coma, 0), "medida_fina": info_n["fino"]}
    if fuera:
        avisos.append(f"{len(fuera)} tomas con el núcleo lejos de la recta (¿estrella, rayo o nube?): se usa la recta.")
    if not usar_recta:
        avisos.append(f"El núcleo se aparta de la línea recta {rms:.1f} px (rms): se usa la posición medida en cada toma.")
    mov = r["nucleo"]["movimiento_total_px"]
    fwhm = 3.0
    if mov < fwhm:
        avisos.append(f"El cometa se mueve {mov} px en toda la sesión (menos que una estrella): el apilado normal ya sirve.")
    tray = ((float(PX[0]), float(PY[0])), (float(PX[-1]), float(PY[-1])))

    # 3b) limpieza de las tomas registradas (Lemmon, 27-nov, 33 CR3 sin flats): las bandas de filas de la réflex y una
    # mota de polvo (2 %, ~55 px) que en el apilado del cometa sale corrida. Se reescriben las r_ (las estrellas y el
    # cometa salen de ellas) y se rehace el apilado de estrellas. Además, la cobertura: dónde hay datos en todas las
    # tomas, alineadas a las estrellas y desplazadas al núcleo.
    hay_flats = any(c["flats"] for c in cal)
    A_mota, cobertura, rect = None, None, None
    if corregir_motas and not hay_flats:
        try:
            pe0, _ = _leer(f_est)
            A_mota, motas = LT.detectar_motas(_lum(pe0), excluir=(xr, yr, max(600.0, 6 * r_coma)))
            del pe0
            r["motas"] = motas
            if motas:
                r["pasos"].append("motas oscuras (flat local): " + ", ".join(
                    f"({m['x']:.0f}, {m['y']:.0f}) {m['diametro_px']:.0f} px −{m['profundidad_pct']} %" for m in motas))
        except Exception as e:
            r["errores"].append(f"motas: {str(e)[:200]}")
            A_mota = None
    if quitar_bandas or A_mota is not None or recortar_bordes:
        bandas = []
        for i, f in enumerate(frames):
            A._progreso(f"limpiar tomas {i + 1}/{len(frames)}")
            p, cab = _leer(f)
            vacio = np.all(p <= 0, axis=0)
            if recortar_bordes:
                v = ~vacio[::4, ::4]
                c_i = v & LT.desplazar_mascara(v, float(dx[i]), float(dy[i]))
                cobertura = c_i if cobertura is None else (cobertura & c_i)
            if not (quitar_bandas or A_mota is not None):
                continue
            if quitar_bandas:
                p[:, vacio] = np.nan
                p, ib = LT.quitar_bandas(p)
                bandas.append(ib)
            if A_mota is not None:
                p /= A_mota[np.newaxis]
            p = np.nan_to_num(p, nan=0.0)
            p[:, vacio] = 0.0
            _escribir(f, np.clip(p, 0, None), cab)
            del p
        if bandas:
            fr = np.mean([np.mean(b["filas_rms"]) for b in bandas])
            co = np.mean([np.mean(b["columnas_rms"]) for b in bandas]) if bandas[0]["columnas_rms"] else 0.0
            r["pasos"].append(f"bandas restadas por toma: filas {fr:.2e}, columnas {co:.2e} (rms medio)")
        if quitar_bandas or A_mota is not None:
            A._progreso("apilado de estrellas (tomas limpias)")
            try:
                cmd(*st, "-out=../candidatos/estrellas_limpias")
                f_est = next((trabajo / "candidatos").glob("estrellas_limpias.fit*"))
            except Exception as e:
                r["errores"].append(f"apilado de estrellas con las tomas limpias: {str(e)[:200]}")
        if cobertura is not None:
            rect = LT.rect_cobertura(cobertura)
            r["pasos"].append(f"recorte por cobertura de las tomas: x {rect[0]}–{rect[2]}, y {rect[1]}–{rect[3]}")
    cand_est, mejor_e, calidad_tomas = None, None, None
    if estrellas_pesos:
        try:
            orig = sorted(f for g in lights for f in g["ficheros"])
            noms = [Path(orig[nums_r[orden[i]] - 1]).name if 0 < nums_r[orden[i]] <= len(orig) else frames[i].name
                    for i in range(len(frames))]
            cand_est, mejor_e, calidad_tomas = _variantes_estrellas(frames, noms, f_est, (xr, yr, max(400.0, 4 * r_coma)),
                                                                   avisos, r["pasos"])
        except Exception as e:
            r["errores"].append(f"capa de estrellas con pesos: {str(e)[:200]}")

    # 4) desplazar al núcleo: traslación en el .seq (Siril), comprobada en la primera y la última toma; si no, numpy
    A._progreso("desplazar las tomas al núcleo")
    ruta_r = A._fichero_seq(proc, f"r_{seq}")
    lineas, _, _, imgs = _leer_seq(ruta_r)
    nums = [x[0] for x in regs]
    pos_seq = {num: k for k, (num, _inc) in enumerate(imgs)}
    k_de = [pos_seq[nums[orden[i]]] for i in range(len(frames))]      # índice en el .seq de cada toma (orden temporal)
    k_ref = k_de[len(frames) // 2]
    seq_cm, como = None, None
    if mov >= fwhm:
        for sx, sy in ((1, -1), (-1, 1), (1, 1), (-1, -1)):
            desp = [(0.0, 0.0)] * len(imgs)
            for i, k in enumerate(k_de):
                desp[k] = (sx * float(dx[i]), sy * float(dy[i]))
            try:
                _escribir_seq(ruta_r, lineas, desp, incluir={k_de[0], k_ref, k_de[-1]}, referencia=k_ref)
                _borrar_seq(proc, "cmp_")
                cmd("seqapplyreg", f"r_{seq}", "-filter-incl", "-prefix=cmp_")
                salidas = sorted(f for f in proc.glob(f"cmp_r_{seq}_*") if f.suffix.lower() in A.EXT_FITS)
                errores = []
                idx_t = {t: i for i, t in enumerate(tiempos)}
                orden_prueba = sorted({0, len(frames) // 2, len(frames) - 1})
                for j, f in enumerate(salidas):          # cada salida con su toma: por DATE-OBS, si no por orden
                    i = idx_t.get(_tiempo(A._cabecera(f)), orden_prueba[min(j, len(orden_prueba) - 1)])
                    errores.append(_comprobar_traslacion(f, frames[i], (float(dx[i]), float(dy[i]))))
                ok = len(salidas) >= 2 and max(errores) <= 0.5
                r.setdefault("prueba_traslacion", []).append({"signos": [sx, sy], "error_px": [_r(e, 2) for e in errores]})
            except Exception as e:
                r["errores"].append(f"prueba de seqapplyreg ({sx}, {sy}): {str(e)[:150]}")
                ok = False
            _borrar_seq(proc, "cmp_")
            if ok:
                _escribir_seq(ruta_r, lineas, desp, incluir=None, referencia=k_ref)
                _borrar_seq(proc, "cm_")
                cmd("seqapplyreg", f"r_{seq}", "-filter-incl", "-prefix=cm_")
                seq_cm, como = f"cm_r_{seq}", f"traslación en el .seq y seqapplyreg (signos {sx:+d}, {sy:+d})"
                break
        Path(ruta_r).write_text("\n".join(lineas) + "\n", encoding="utf-8")
    if seq_cm is None:                                   # numpy: cada toma desplazada y una secuencia nueva
        dnp = trabajo / "cm_np"
        shutil.rmtree(dnp, ignore_errors=True)
        dnp.mkdir(parents=True)
        for i, f in enumerate(frames):
            A._progreso(f"desplazar (numpy) {i + 1}/{len(frames)}")
            p, cab = _leer(f)
            q = np.stack([_desplazar(ch, float(dx[i]), float(dy[i])) for ch in p]) if mov >= fwhm else p
            _escribir(dnp / f"cmnp_{i + 1:05d}.fit", np.clip(q, 0, None), cab)
            del p, q
        cd(dnp); cmd("convert", "cmnp", "-out=../process"); cd(proc)
        seq_cm, como = "cmnp", "numpy (Lanczos4)" if _cv2() else "numpy (bilineal)"
        shutil.rmtree(dnp, ignore_errors=True)
    r["desplazamiento"] = como
    cm_files = [x[2] for x in _ficheros_seq(proc, seq_cm) if x[1] and x[2]]
    # cada fichero desplazado ↔ su desplazamiento: por DATE-OBS si se puede, si no por orden
    t_cm = [_tiempo(A._cabecera(f)) for f in cm_files]
    if all(t is not None for t in t_cm) and len(set(t_cm)) == len(t_cm):
        idx_t = {t: i for i, t in enumerate(tiempos)}
        mapa = [idx_t.get(t) for t in t_cm]
    else:
        mapa = list(range(len(cm_files)))
    if len(cm_files) != len(frames) or any(m is None for m in mapa):
        avisos.append(f"Tomas desplazadas: {len(cm_files)} de {len(frames)}.")
        mapa = [m if m is not None else i for i, m in enumerate(mapa)]
    r["en_el_cometa"] = f"{len(cm_files)} de {len(frames)}"

    # 5) candidatos del cometa: rechazos de Siril
    cands = []
    for k, cod in enumerate(rechazos, 1):
        if cod not in RECHAZOS_SIRIL:
            r["errores"].append(f"rechazo desconocido: {cod} (w33, w11, mad11, mediana)")
            continue
        args = list(RECHAZOS_SIRIL[cod]) + ["-norm=addscale"] + (["-32b"] + (["-rgb_equal"] if osc else [])
                                                                if cod != "mediana" else ["-32b"])
        A._progreso(f"cometa: apilado {k} ({NOMBRES[cod]})")
        salida = f"../candidatos/cometa_{k}_{cod}"
        try:
            cmd("stack", seq_cm, *args, f"-out={salida}")
            f = next((trabajo / "candidatos").glob(f"cometa_{k}_{cod}.fit*"))
            cands.append({"id": f"cometa_{k}", "metodo": NOMBRES[cod], "rechazo": cod, "fichero": str(f)})
        except Exception as e:
            r["errores"].append(f"{NOMBRES[cod]}: {str(e)[:200]}")

    # 6) propios: máscara de estrellas por toma (las estrellas del apilado de estrellas, movidas con cada toma)
    pe, cab_e = _leer(f_est)
    Ls = _lum(pe)
    # máscara por brillo (4 σ y 3/6/12/22 px) en vez de 5 σ y 4/12 px: el anillo de las brillantes también dejaba trazo
    mest = _mascara_estrellas_prof(Ls, tray, max(12.0, r_coma / 2))
    mov = (tray[1][0] - tray[0][0], tray[1][1] - tray[0][1])
    if mascara_estrellas:
        try:
            cands += _apilar_con_mascara(cm_files, mapa, dx, dy, mest, trabajo, len(cands), avisos)
        except Exception as e:
            r["errores"].append(f"apilado con máscara de estrellas: {str(e)[:200]}")

    # 7) método B: seqstarnet en cada toma registrada y el mismo desplazamiento
    if metodo_b:
        try:
            A._progreso("método B: seqstarnet (lento)")
            cmd("seqstarnet", f"r_{seq}", "-stretch")
            sl_files = sorted(f for f in proc.glob(f"starless_r_{seq}_*") if f.suffix.lower() in A.EXT_FITS)
            dnp = trabajo / "cm_b"
            shutil.rmtree(dnp, ignore_errors=True)
            dnp.mkdir(parents=True)
            t_sl = [_tiempo(A._cabecera(f)) for f in sl_files]
            idx_t = {t: i for i, t in enumerate(tiempos)}
            for j, f in enumerate(sl_files):
                i = idx_t.get(t_sl[j], j)
                p, cab = _leer(f)
                q = np.stack([_desplazar(ch, float(dx[i]), float(dy[i])) for ch in p])
                _escribir(dnp / f"cmb_{j + 1:05d}.fit", np.clip(q, 0, None), cab)
            cd(dnp); cmd("convert", "cmb", "-out=../process"); cd(proc)
            shutil.rmtree(dnp, ignore_errors=True)
            for cod in ("w33", "mediana"):
                k = len(cands) + 1
                args = list(RECHAZOS_SIRIL[cod]) + ["-norm=addscale", "-32b"]
                cmd("stack", "cmb", *args, f"-out=../candidatos/cometa_{k}_B_{cod}")
                f = next((trabajo / "candidatos").glob(f"cometa_{k}_B_{cod}.fit*"))
                cands.append({"id": f"cometa_{k}", "metodo": NOMBRES[cod] + " (método B: seqstarnet por toma)",
                              "rechazo": cod, "fichero": str(f), "metodo_b": True})
        except Exception as e:
            r["errores"].append(f"método B (seqstarnet): {str(e)[:200]}")
    if not cands:
        raise RuntimeError("Ningún apilado del cometa salió: " + "; ".join(r["errores"])[:600])

    # 8) medir, método A y recomendar
    for c in cands:
        p, _ = _leer(c["fichero"])
        c.update(_metricas(p, (xr, yr), r_coma, mest, mov))
        borde = float((np.all(p[:, ::4, ::4] <= 0, axis=0)).mean())
        if borde > 0.001:
            c["sin_datos_pct"] = _r(100 * borde, 2)
        del p
    if quitar_restos:
        base = max(cands, key=lambda k: (k["senal_coma_cola"], -k["restos_estrellas_por_mp"]))
        try:
            p, cab = _leer(base["fichero"])
            sl, motor_txt = _quitar_estrellas(siril, p, motor)
            h_, w_ = p.shape[1:]
            yy, xx = np.ogrid[:h_, :w_]
            rn, suave = max(6.0, r_coma / 4), max(6.0, r_coma / 3)
            nuc = np.clip(1 - (np.hypot(xx - xr, yy - yr) - rn) / suave, 0, 1).astype(np.float32)
            pa = nuc[np.newaxis] * p + (1 - nuc[np.newaxis]) * np.minimum(sl, p)
            k = len(cands) + 1
            f = _escribir(trabajo / "candidatos" / f"cometa_{k}_A.fit", pa, cab)
            c = {"id": f"cometa_{k}", "metodo": base["metodo"] + f" + {motor_txt} (núcleo protegido)",
                 "rechazo": base["rechazo"], "fichero": f, "metodo_a": True}
            c.update(_metricas(pa, (xr, yr), r_coma, mest, mov))
            cands.append(c)
            r["pasos"].append(f"método A: {motor_txt} sobre {base['id']}, núcleo protegido (radio {rn:.0f} px)")
        except Exception as e:
            r["errores"].append(f"método A: {str(e)[:200]}")
    smax = max(k["senal_coma_cola"] for k in cands) or 1.0
    for k in cands:
        k["senal_coma_cola_rel_pct"] = _r(100 * k["senal_coma_cola"] / smax, 1)
    buenos = [k for k in cands if k["senal_coma_cola"] >= 0.95 * smax] or cands
    # primero los trazos: winsorized 3/3 salía recomendado con 0 restos y el cielo lleno de trazos (Lemmon, 27-nov:
    # 6100 trazos/MP frente a 58 de la mediana con máscara)
    tmin = min(k.get("trazos_por_mp", 0) for k in buenos)
    buenos = [k for k in buenos if k.get("trazos_por_mp", 0) <= tmin * 1.2 + 20]
    rmin = min(k["restos_estrellas_por_mp"] for k in buenos)
    # empate solo con diferencias pequeñas (3 %): con el 10 % el "menos restos" del motivo acababa en el candidato con
    # más restos (prueba SAS con el Lemmon, 27-nov)
    empatados = [k for k in buenos if k["restos_estrellas_por_mp"] <= rmin * 1.03 + 0.5]
    rec = min(empatados, key=lambda k: k["ruido_fondo"])
    r["recomendado"] = rec["id"]
    if len(empatados) > 1:
        r["motivo"] = (f"{rec['metodo']}: trazos de estrellas {rec.get('trazos_por_mp')}/MP (mínimo {tmin}), restos casi iguales ({rmin}–"
                       f"{max(k['restos_estrellas_por_mp'] for k in empatados)}/MP) entre los que conservan ≥ 95 % de la "
                       "señal de coma y cola; gana el de menos ruido de fondo")
    else:
        r["motivo"] = (f"{rec['metodo']}: menos trazos ({rec.get('trazos_por_mp')}/MP) y restos de estrellas ({rec['restos_estrellas_por_mp']}/MP) entre los que "
                       "conservan ≥ 95 % de la señal de coma y cola")

    # 9) previas con el MISMO estirado (el del recomendado), guardar y dejar cargado el cometa
    prev = trabajo / "previas"
    shutil.rmtree(prev, ignore_errors=True)
    prev.mkdir(parents=True)
    p_rec, cab_rec = _leer(rec["fichero"])
    ps = P._params_estirado(_reducida(p_rec))

    def previas(p, base, ps=ps):
        q = _reducida(p)
        out = {"previa": _jpg(P._estirar_con(q, ps) if _lineal(p) else q, prev / f"{base}.jpg")}
        h_, w_ = p.shape[1:]
        x0, y0 = int(np.clip(xr - 350, 0, max(0, w_ - 700))), int(np.clip(yr - 350, 0, max(0, h_ - 700)))
        z = np.nan_to_num(p[:, y0:y0 + 700, x0:x0 + 700], nan=0.0)
        out["previa_nucleo"] = _jpg(P._estirar_con(z, ps) if _lineal(p) else z, prev / f"{base}_nucleo.jpg")
        return out

    for c in cands:
        try:
            p = p_rec if c is rec else _leer(c["fichero"])[0]
            c.update(previas(p, c["id"]))
        except Exception as e:
            c["previa_error"] = str(e)[:120]
    # las estrellas con su propio estirado: el cielo del cometa no es el de las estrellas (con el del cometa salía negra)
    pe_rec = mejor_e["p"] if mejor_e else pe
    r["estrellas"] = previas(pe_rec, "estrellas", P._params_estirado(_reducida(pe_rec)))
    meta = {"nucleo_ref": [xr, yr], "trayectoria": [list(tray[0]), list(tray[1])], "r_coma": r_coma,
            "velocidad_px_h": vel, "tomas": len(frames), "hora_ref": t_ref.isoformat()}
    final_c, final_e = trabajo / f"master_cometa_{nombre}.fit", trabajo / f"master_estrellas_{nombre}.fit"
    n2 = 2
    while final_c.exists() or final_e.exists():
        final_c, final_e = trabajo / f"master_cometa_{nombre}_{n2}.fit", trabajo / f"master_estrellas_{nombre}_{n2}.fit"
        n2 += 1
    shutil.copy2(rec["fichero"], final_c)
    if mejor_e is None or mejor_e["id"] == "todas":
        shutil.copy2(f_est, final_e)
    else:
        _escribir(final_e, mejor_e["p"], cab_e)
    if cand_est and len(cand_est) > 1:
        try:
            sel_e, cielo_e = TE.elegir_estrellas(pe, excluir=(xr, yr, max(400.0, 4 * r_coma)))
            r["estrellas"]["candidatos_100"] = TE.recortes([k["p"] for k in cand_est], [k["id"] for k in cand_est],
                                                           sel_e, cielo_e, prev / "estrellas_candidatos_100.jpg")
        except Exception as e:
            r["errores"].append(f"mosaico de estrellas: {str(e)[:150]}")
        lista = []
        for k in cand_est:
            f = trabajo / f"estrellas_{k['id']}_{nombre}.fit"
            if k["id"] == "todas":
                shutil.copy2(f_est, f)
            else:
                _escribir(f, k["p"], cab_e)
            f.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
            lista.append({**{kk: vv for kk, vv in k.items() if kk != "p"}, "fichero": str(f), "recomendada": k is mejor_e})
        r["estrellas"]["candidatos"] = lista
    if calidad_tomas:
        r["estrellas"]["calidad_por_toma"] = calidad_tomas
    if rect:
        x0, y0, x1, y1 = rect
        recortados = [final_c, final_e] + [Path(k["fichero"]) for k in (r["estrellas"].get("candidatos") or [])]
        for f in dict.fromkeys(recortados):
            try:
                p, cab = _leer(f)
                _escribir(f, p[:, y0:y1, x0:x1], cab)
                del p
            except Exception as e:
                r["errores"].append(f"recorte de {Path(f).name}: {str(e)[:150]}")
        meta.update(nucleo_ref=[xr - x0, yr - y0],
                    trayectoria=[[tray[0][0] - x0, tray[0][1] - y0], [tray[1][0] - x0, tray[1][1] - y0]],
                    recorte=[x0, y0, x1, y1])
        r["nucleo"]["referencia_recortada"] = [_r(xr - x0, 1), _r(yr - y0, 1)]
        for k in (r["estrellas"].get("candidatos") or []):
            Path(k["fichero"]).with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False, indent=1),
                                                               encoding="utf-8")
    for f in (final_c, final_e):
        f.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    siril.cmd("load", H._arg_cmd(final_c))
    r["master_cometa"], r["master_estrellas"] = str(final_c), str(final_e)
    r["candidatos"] = [{k: v for k, v in c.items() if k != "senal_coma_cola"} | {"senal_coma_cola": _r(c["senal_coma_cola"], 3)}
                       for c in cands]
    r["estrellas"]["fichero"] = str(final_e)
    if not conservar_intermedios:
        cd(trabajo)
        r["intermedios_borrados_gb"] = A._limpiar_intermedios(trabajo)
    r["segundos"] = _r(time.perf_counter() - t0, 0)
    r["siguiente"] = ("Cargado: el cometa recomendado (master_cometa_…). Para otro candidato, abrirImagen con su 'fichero'. "
                      "Procesa los dos apilados por separado (gradiente, color con transferirColorCometa) y únelos con "
                      "combinarCometaEstrellas.")
    r["leyenda"] = ("ruido_fondo: MAD del paso alto (menos es mejor); trazos_por_mp: estrellas que dejan segmentos en la "
                    "dirección del movimiento del cometa (lo primero que se mira; menos es mejor); restos_estrellas_por_mp: píxeles de estrellas que "
                    "quedan fuera de la coma (menos es mejor); senal_coma_cola_rel_pct: señal de coma y cola frente al que "
                    "más conserva. Recomendado: el de menos restos entre los que conservan ≥ 95 % de la señal; empate (3 %) "
                    "→ menos ruido.")
    A._progreso("")
    return r


def _apilar_con_mascara(cm_files, mapa, dx, dy, mest, trabajo, n0, avisos):
    """Mediana y media 1/1 propias, con las estrellas de cada toma fuera (NaN) y los bordes sin datos (0) fuera. Píxeles
    con menos de max(2, 30 %) tomas válidas: mediana sin máscara. Normalización por toma y canal (mediana y MAD)."""
    import warnings
    warnings.filterwarnings("ignore", message="All-NaN slice", category=RuntimeWarning)
    warnings.filterwarnings("ignore", message="Mean of empty slice", category=RuntimeWarning)
    n = len(cm_files)
    c, h, w = _forma(cm_files[0])
    need = n * c * h * w * 4
    libre = shutil.disk_usage(str(trabajo)).free
    if need > 0.8 * libre:
        avisos.append(f"Sin disco para el apilado con máscara ({need / 1e9:.1f} GB): se omite.")
        return []
    ruta_cubo = trabajo / "cubo.dat"
    cubo = np.memmap(ruta_cubo, dtype=np.float32, mode="w+", shape=(n, c, h, w))
    stats = np.zeros((n, c, 2))
    for j, f in enumerate(cm_files):
        A._progreso(f"máscara de estrellas: toma {j + 1}/{n}")
        p, _ = _leer(f)
        cubo[j] = p
        for k in range(c):
            v = p[k, ::4, ::4]
            stats[j, k] = _mad(v[v > 0])
        del p
    ref = stats[n // 2]
    nmin = max(2, int(np.ceil(0.3 * n)))
    sal_med = np.zeros((c, h, w), np.float32)
    sal_mean = np.zeros((c, h, w), np.float32)
    pocos = 0
    paso = max(8, int(1.5e8 / max(1, n * c * w * 4)))
    sh = [(int(round(dx[mapa[j]])), int(round(dy[mapa[j]]))) for j in range(n)]
    for y0 in range(0, h, paso):
        y1 = min(h, y0 + paso)
        A._progreso(f"máscara de estrellas: filas {y0}/{h}")
        X = np.array(cubo[:, :, y0:y1, :], dtype=np.float32)
        datos = np.any(X > 0, axis=1, keepdims=True)
        for j in range(n):
            for k in range(c):
                s = stats[j, k, 1] if stats[j, k, 1] > 0 else 1.0
                X[j, k] = (X[j, k] - stats[j, k, 0]) * (ref[k, 1] / s if ref[k, 1] > 0 else 1.0) + ref[k, 0]
        Xs = np.where(datos, X, np.nan)
        med0 = np.nanmedian(Xs, axis=0)
        M = np.zeros((n, 1, y1 - y0, w), bool)
        for j in range(n):
            ex, ey = sh[j]
            ya, yb = y0 - ey, y1 - ey                    # filas de la máscara que caen aquí
            m = np.zeros((y1 - y0, w), bool)
            a, b2 = max(ya, 0), min(yb, h)
            if a < b2:
                m[a - ya:b2 - ya] = _mover_entero(mest[a:b2], ex, 0)
            M[j, 0] = m
        Xm = np.where(M, np.nan, Xs)
        val = np.sum(np.isfinite(Xm[:, 0]), axis=0)
        med = np.nanmedian(Xm, axis=0)
        dev = np.abs(Xm - med[np.newaxis])
        sig = 1.4826 * np.nanmedian(dev, axis=0)
        dentro = dev <= np.maximum(sig, 1e-6)[np.newaxis]
        mean = np.nanmean(np.where(dentro, Xm, np.nan), axis=0)
        pocos_px = val < nmin
        pocos += int(pocos_px.sum())
        med = np.where(pocos_px[np.newaxis], med0, med)
        mean = np.where(pocos_px[np.newaxis] | ~np.isfinite(mean), med, mean)
        sal_med[:, y0:y1] = np.nan_to_num(med, nan=0.0)
        sal_mean[:, y0:y1] = np.nan_to_num(mean, nan=0.0)
    del cubo
    try:
        ruta_cubo.unlink()
    except OSError:
        pass
    out = []
    for k, (cod, a) in enumerate((("mediana_mascara", sal_med), ("media11_mascara", sal_mean)), n0 + 1):
        f = _escribir(trabajo / "candidatos" / f"cometa_{k}_{cod}.fit", np.clip(a, 0, None))
        out.append({"id": f"cometa_{k}", "metodo": NOMBRES[cod], "rechazo": cod, "fichero": f,
                    "pixeles_con_pocas_tomas_pct": _r(100 * pocos / (h * w), 3)})
    return out


# --- combinarCometaEstrellas -------------------------------------------------------------------------------------------

def _meta_de(ruta):
    try:
        return json.loads(Path(ruta).with_suffix(".json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _estirado_enlazado(q, params_estirado):
    """(punto negro, tonos medios) comunes a R, G y B: el punto negro, el MENOR de los de cada canal (ninguno se recorta
    aunque haya dominante); los tonos medios, los que llevan la luminancia a 0,25 con ese punto negro."""
    c0 = min(c for c, _ in params_estirado(q))
    L = _lum(q)
    med = float(np.median(L))
    mn = (med - c0) / (1 - c0)
    return c0, (float(P._mtf(0.25, np.float64(mn))) if mn > 0 else 0.5)


def _nucleo_auto(L):
    """Núcleo en un apilado del cometa: en la imagen binada ×4, apertura (fuera estrellas y restos) y máximo de la
    diferencia de gaussianas (8 − 40 px) lejos del borde; después se afina a resolución completa."""
    b = 4
    Lb = _binar(np.nan_to_num(L, nan=0.0), b)
    mg = _margen(*Lb.shape, minimo=4)
    Lb[:mg], Lb[-mg:], Lb[:, :mg], Lb[:, -mg:] = (float(np.median(Lb[mg:-mg, mg:-mg])),) * 4   # el suavizado no la mete
    Lb = _apertura(Lb, 3)
    D = _suave(Lb, 2) - _suave(Lb, 10)
    x, y, _ = _pico(D, borde=mg)
    x, y = x * b + b / 2, y * b + b / 2
    D2 = _suave(L, 2)
    D2 = D2 - float(np.median(D2[::4, ::4]))
    h, w = D2.shape
    x0, x1, y0, y1 = max(0, int(x) - 3 * b), min(w, int(x) + 3 * b + 1), max(0, int(y) - 3 * b), min(h, int(y) + 3 * b + 1)
    j = int(np.argmax(D2[y0:y1, x0:x1]))
    y, x = y0 + j // (x1 - x0), x0 + j % (x1 - x0)
    return _centroide(D2, float(x), float(y), 6)


def combinarCometaEstrellas(siril, cometa, estrellas, modo="mascara", estrellas_solo=False, mezcla=1.0, lineal=None,
                            radio_nucleo=None, motor="auto", umbral_cola=2.5, nombre=None, factor_estrellas=1.0,
                            tamano_estrellas=1.0):
    """Cometa (final): une el apilado del cometa con las estrellas del apilado de estrellas (los dos de apilarCometa,
    misma geometría). modo 'mascara' (lineal, por defecto): el cometa SOLO dentro de una máscara suave de coma y cola
    (cielo + umbral_cola σ sobre el cometa binado y sin estrellas, unida al núcleo, difuminada) con la capa de estrellas
    encima; fuera, el apilado de estrellas tal cual (sin los trazos de las estrellas débiles que deja el apilado
    alineado al núcleo). Sale lineal: se estira una sola vez y cometa y estrellas comparten cielo. 'suma' (lineal:
    cometa + capa de estrellas) o 'pantalla' (los dos con el MISMO estirado, el del cometa, y A + B − A·B). La capa de estrellas sale con StarX / StarNet2 (original − starless), salvo
    estrellas_solo, y se apaga a lo largo de la trayectoria del núcleo (allí el apilado de estrellas tiene copias del
    núcleo). factor_estrellas multiplica la capa de estrellas en TODA la imagen (dentro y fuera de la máscara; 1,35 =
    estrellas un 35 % más brillantes); los núcleos que pasarían de 1 bajan por una rodilla que conserva su color en vez
    de recortarse canal a canal. tamano_estrellas (> 1) agranda las estrellas sin dilatar: sube las alas con una curva
    de potencia en la luminancia de la capa (pico igual, color igual) hasta que el área de estrella sobre el umbral
    (3 σ del cielo) sea tamano_estrellas veces la de partida, contando también factor_estrellas. Deja el resultado cargado (con deshacer) y lo guarda junto al cometa. Mide cuánto
    tapa la cola y el aporte de las estrellas."""
    fc, fe = H._ruta(cometa, "cometa"), H._ruta(estrellas, "estrellas")
    pc, cab = _leer(fc)
    pe, _ = _leer(fe)
    if pc.shape != pe.shape:
        raise ValueError(f"Los dos apilados deben tener la misma forma (cometa {pc.shape}, estrellas {pe.shape}): usa los "
                         "de apilarCometa sin recortarlos por separado.")
    avisos = [AVISO_VERDE]
    if estrellas_solo:
        capa, fuente = pe, "el fichero ya es solo estrellas"
    else:
        sl, fuente = _quitar_estrellas(siril, pe, motor)
        dif = pe - sl
        capa = np.empty_like(dif)
        for k in range(dif.shape[0]):             # sin el ruido del cielo que se lleva el quitaestrellas (si no, el
            m, s_ = _mad(dif[k, ::2, ::2])         # cielo con estrellas queda más claro que la banda del núcleo)
            capa[k] = np.clip(dif[k] - m - 2 * s_, 0, None)
        fuente = f"{fuente}: original − starless, sin el ruido del cielo (> 2 σ)"
    meta = _meta_de(fc) or _meta_de(fe)
    h, w = pc.shape[1:]
    yy, xx = np.ogrid[:h, :w]
    if meta and meta.get("trayectoria"):
        (ax, ay), (bx, by) = meta["trayectoria"]
        rn = float(radio_nucleo or np.clip(meta.get("r_coma", 30) / 2, 12, 150))
        nx, ny = meta["nucleo_ref"]
        de_donde = "trayectoria de apilarCometa"
    else:
        nx, ny = _nucleo_auto(_lum(pc))
        ax = bx = nx
        ay = by = ny
        rn = float(radio_nucleo or 30)
        de_donde = "núcleo buscado en el cometa (sin la trayectoria: el apilado no es de apilarCometa)"
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy
    t = np.clip(((xx - ax) * vx + (yy - ay) * vy) / L2, 0, 1) if L2 > 0 else 0.0
    d = np.hypot(xx - (ax + t * vx), yy - (ay + t * vy))
    apaga = np.clip((d - rn) / max(rn / 2, 4), 0, 1).astype(np.float32)
    capa = capa * apaga[np.newaxis]
    fe_0 = float(factor_estrellas)
    tam = float(tamano_estrellas)
    _, s_cielo = _mad(_lum(pe)[::4, ::4])
    umbral_area = 3 * max(s_cielo, 1e-9)
    Lcapa = _lum(capa)
    area0 = float((Lcapa > umbral_area).mean())
    gamma = 1.0
    if tam > 1.0 and area0 > 0:
        # alas tipo asinh: L' = ref·(L/ref)^γ por debajo de ref (p99,9 de las estrellas), igual por encima; los canales
        # se escalan con L'/L (mismo color). γ por bisección hasta área(γ)·(con factor) = tam·área de partida.
        ref = float(np.percentile(Lcapa[Lcapa > umbral_area], 99.9)) if (Lcapa > umbral_area).any() else 1.0
        sub = Lcapa[::3, ::3]
        def area(g):
            Lg = np.where(sub < ref, ref * np.power(np.clip(sub / ref, 0, None), g), sub)
            return float((fe_0 * Lg > umbral_area).mean()) / max(float((sub > umbral_area).mean()), 1e-12)
        lo, hi = 0.3, 1.0
        if area(lo) < tam:
            gamma = lo
        else:
            for _ in range(25):
                mid = 0.5 * (lo + hi)
                lo, hi = (mid, hi) if area(mid) > tam else (lo, mid)
            gamma = hi
        Lg = np.where(Lcapa < ref, ref * np.power(np.clip(Lcapa / ref, 0, None), gamma), Lcapa)
        with np.errstate(divide="ignore", invalid="ignore"):
            esc = np.where(Lcapa > 1e-9, Lg / np.maximum(Lcapa, 1e-9), 0.0).astype(np.float32)
        capa = capa * esc[np.newaxis]
        del Lg, esc
    # p99 < 0,3 tomaba por lineal un cometa ya estirado (cielo 0,10, p99 0,28) y lo volvía a estirar: anillo de viñeteo y
    # trazos de estrellas (Lemmon en SAS, 27-nov). Lineal = la señal apenas sube sobre el cielo.
    if lineal is not None:
        lin = bool(lineal)
    else:
        q_ = _reducida(pc, 600)
        p50, p99 = float(np.median(q_)), float(np.percentile(q_, 99))
        lin = bool(P._lineal(q_) or (p99 - p50) < 0.25 * p50)
    mezcla = float(mezcla)
    fe_ = float(factor_estrellas)
    if fe_ <= 0:
        raise ValueError("factor_estrellas debe ser > 0 (1 = sin cambio, 1,35 = +35 %).")
    r_coma = float((meta or {}).get("r_coma") or 3 * rn)
    tray = meta.get("trayectoria") if meta else None
    extra = {}
    if modo == "mascara":
        if not lin:
            avisos.append("El modo máscara es para los dos apilados lineales (antes de estirar): así comparten cielo.")
        mk, r_disco = _mascara_coma_cola(_lum(pc), (nx, ny), r_coma, tray, float(umbral_cola))
        Le = _lum(capa)
        _, se = _mad(Le[::4, ::4])
        libre = (mk < 0.01) & (Le < 3 * max(se, 1e-9))
        des = [float(np.median(pc[k][libre][::7]) - np.median(pe[k][libre][::7])) for k in range(pc.shape[0])]
        # desfase que cambia por el campo (Lemmon, 27-nov: bloque de borde recto arriba, donde la cola sale): se le
        # resta al cometa la diferencia suave cometa − estrellas del cielo libre (ver limpieza_tomas.desfase_campo)
        D, d_rango = LT.desfase_campo(pc, pe, libre)
        mm = mk[np.newaxis]
        out = (mm * (pc - D + mezcla * fe_ * capa)
               + (1 - mm) * (pe + np.float32(fe_ - 1) * capa + np.asarray(des, np.float32)[:, None, None]))
        del D
        como = (f"máscara de coma y cola (cielo + {float(umbral_cola):g} σ, unida al núcleo; disco {r_disco} px): "
                "cometa + estrellas dentro, apilado de estrellas fuera (lineal)")
        extra = {"mascara_cometa_pct": _r(100 * float(mk.mean()), 1), "desfase_cielo_estrellas": [_r(v, 6) for v in des],
                 "desfase_campo_p1_p99": d_rango}
        H.PREVIAS.mkdir(parents=True, exist_ok=True)
        extra["previa_mascara"] = _jpg(np.repeat(_reducida(mk[np.newaxis]), 3, 0),
                                       H.PREVIAS / f"{re.sub(r'[^\w.-]+', '_', nombre or fc.stem)}_mascara.jpg")
        del mm
    elif modo == "suma":
        if not lin:
            avisos.append("La suma es para imágenes lineales; con estiradas se pasa de brillo: usa modo pantalla.")
        out = pc + mezcla * fe_ * capa
        como = "suma lineal"
    elif modo == "pantalla":
        if lin:
            # estirado ENLAZADO (los mismos parámetros en R, G y B, de la luminancia): uno por canal neutraliza el cielo
            # y borra la calibración de color (prueba SAS con el Lemmon, 27-nov: la combinada salía igual antes y
            # después de calibrar)
            c0, m = _estirado_enlazado(_reducida(pc), P._params_estirado)
            ps = [(c0, m)] * pc.shape[0]
            Aa = P._estirar_con(pc, ps)
            Bb = np.clip(P._estirar_con(fe_ * capa + np.float32(c0), ps), 0, 1)
            como = "pantalla tras el mismo estirado enlazado (el del cometa)"
        else:
            Aa, Bb = pc, np.clip(fe_ * capa, 0, 1)
            como = "pantalla (imágenes ya estiradas)"
        out = np.clip(Aa + mezcla * Bb - Aa * mezcla * Bb, 0, 1)
    else:
        raise ValueError("modo: mascara, suma o pantalla.")
    # núcleos por encima de 1 (factor_estrellas > 1): rodilla en el canal mayor y los otros escalados igual, sin
    # cambiar el color del núcleo (recortar canal a canal lo vuelve blanco o de otro tono)
    sobre_1 = int((out.max(0) > 1.0).sum())
    if out.shape[0] == 3:
        m_ = out.max(0)
        s_k = m_ > 0.9
        if s_k.any():
            m2 = np.where(s_k, 0.9 + 0.1 * np.tanh((m_ - 0.9) / 0.1), m_)
            out = out * np.where(s_k, m2 / np.maximum(m_, 1e-9), 1.0)[None].astype(np.float32)
    out = np.clip(out, 0, 1).astype(np.float32)
    Le_ = _lum(fe_ * capa)
    aporte = float(Le_.sum()) / max(1e-9, float(np.clip(_lum(out) - float(np.median(_lum(out)[::4, ::4])), 0, None).sum()))
    extra["factor_estrellas"] = fe_
    extra["tamano_estrellas"] = {"pedido": tam, "gamma_alas": _r(gamma, 3), "area_partida_pct": _r(100 * area0, 3),
                                 "area_final_pct": _r(100 * float((Le_ > umbral_area).mean()), 3),
                                 "ratio": _r(float((Le_ > umbral_area).mean()) / max(area0, 1e-12), 3)}
    extra["aporte_estrellas_pct"] = _r(100 * aporte, 2)
    extra["nucleos_sobre_1_px"] = sobre_1
    Lc = _lum(pc)
    cielo, s = _mad(Lc[::4, ::4])
    cola = _suave(Lc, 6) > cielo + 3 * max(s, 1e-7)
    tapa = _lum(capa) > 5 * max(s, 1e-7)
    tapado = float((cola & tapa).sum()) / max(1, int(cola.sum()))
    if tapado > 0.05:
        avisos.append(f"Las estrellas tapan el {100 * tapado:.1f} % de la coma y la cola: prueba mezcla < 1 o reduce las "
                      "estrellas antes (reducirEstrellasCandidatos sobre el apilado de estrellas).")
    nombre = re.sub(r"[^\w.-]+", "_", nombre or f"{fc.stem}_con_estrellas")
    destino = fc.parent / f"{nombre}.fit"
    k = 2
    while destino.exists():
        destino = fc.parent / f"{nombre}_{k}.fit"
        k += 1
    siril.cmd("load", H._arg_cmd(fc))
    info = H._info(siril)
    crudo = P._crudo(siril)
    import multicapa as _mc
    P._poner(siril, _mc._a_crudo(out, info, crudo), "SirilAstroPilot: cometa + estrellas")
    siril.cmd("save", H._arg_cmd(destino.with_suffix("")))
    if meta:
        destino.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    tz = _trazos(_lum(out), (nx, ny), r_coma, (vx, vy)) if L2 > 0 else {}
    quem = _coma_quemada(out, (nx, ny), r_coma)
    if quem is not None and quem > 0.5:
        avisos.append(f"Coma quemada: {quem} % de sus píxeles a ≥ 0,98 (objetivo < 0,5 %). Si ya está estirada, rehaz "
                      "el estirado con protección de luces (nucleoCandidatos / hdrCandidatos en la coma).")
    prev = H.PREVIAS
    prev.mkdir(parents=True, exist_ok=True)
    q = _reducida(out)
    return {"fichero": str(destino), "modo": como, "estrellas": fuente, "mezcla": mezcla, "lineal": lin,
            "sin_estrellas": {"de": de_donde, "radio_px": _r(rn, 1)}, "cola_tapada_pct": _r(100 * tapado, 2),
            "recortados_pct": _r(100 * float((out >= 0.999).mean()), 3), **tz, "coma_quemada_pct": quem, **extra,
            "previa": _jpg(P._autoestirar(q) if _lineal(out) else q, prev / f"{destino.stem}.jpg"), "avisos": avisos,
            "nota": "Queda cargado y guardado (sin sobrescribir)."
                    + (" Lineal: estíralo una sola vez (estirarCandidatos) y mira que la coma no se queme." if modo == "mascara" else "")}


# --- transferirColorCometa ---------------------------------------------------------------------------------------------

def transferirColorCometa(siril, estrellas_antes, estrellas_despues, cometa=None, forzar=False):
    """Cometa (paso 12): lleva al apilado del cometa la calibración de color hecha en el de estrellas. Ajusta por canal
    despues = a·antes + b (robusto, sin saturadas) entre el apilado de estrellas antes y después de calibrarColor, y
    lo aplica al cometa ('cometa' = fichero; si no, la imagen cargada), con deshacer. Se niega si el ajuste no es lineal
    (R² < 0,98: la de después ya estaba estirada o cambió algo más), salvo forzar."""
    pa, _ = _leer(H._ruta(estrellas_antes, "estrellas_antes"))
    pd, _ = _leer(H._ruta(estrellas_despues, "estrellas_despues"))
    if pa.shape != pd.shape:
        raise ValueError("estrellas_antes y estrellas_despues deben tener la misma forma.")
    if cometa:
        siril.cmd("load", H._arg_cmd(H._ruta(cometa, "cometa")))
    info = H._info(siril)
    crudo = P._crudo(siril)
    p = P._pantalla(crudo, info)
    if pa.shape[0] != 3 or p.shape[0] != 3:
        raise ValueError("Hace falta color (3 canales) en los tres.")
    paso = max(1, int(np.sqrt(pa.shape[1] * pa.shape[2] / 400000)))
    Aa, Bb = pa[:, ::paso, ::paso].reshape(3, -1), pd[:, ::paso, ::paso].reshape(3, -1)
    ok = np.all(np.isfinite(Aa) & np.isfinite(Bb) & (Aa < 0.9) & (Bb < 0.9) & (Aa > 0), axis=0)
    filas, out = [], np.empty_like(p)
    for k, canal in enumerate("RGB"):
        x, y = Aa[k, ok].astype(np.float64), Bb[k, ok].astype(np.float64)
        sel = np.ones(x.size, bool)
        for _ in range(4):
            a, b = np.polyfit(x[sel], y[sel], 1)
            res = y - (a * x + b)
            s = 1.4826 * np.median(np.abs(res[sel]))
            sel = np.abs(res) <= max(3 * s, 1e-7)
        r2 = 1 - float(np.var(res[sel])) / max(float(np.var(y[sel])), 1e-20)
        filas.append({"canal": canal, "a": _r(a, 5), "b": _r(b, 6), "r2": _r(r2, 5), "puntos": int(sel.sum())})
        out[k] = a * p[k] + b
    if not forzar and min(f["r2"] for f in filas) < 0.98:
        raise RuntimeError("La calibración de las estrellas no es lineal (R² < 0,98): " + json.dumps(filas, ensure_ascii=False)
                           + ". ¿Se estiró o se cambió algo más entre antes y después? Repite con los ficheros correctos, o forzar.")
    import multicapa as _mc
    P._poner(siril, _mc._a_crudo(np.clip(out, 0, 1), info, crudo), "SirilAstroPilot: color del cometa (de las estrellas)")
    return {"ajuste": filas, "avisos": [AVISO_VERDE],
            "nota": "Mismo color que el apilado de estrellas. Guárdalo con guardarImagen y únelo con combinarCometaEstrellas."}


# --- larsonSekanina ------------------------------------------------------------------------------------------------------

def _rotar(L, cx, cy, ang):
    """L girada 'ang' grados alrededor de (cx, cy) (bilineal, bordes por reflejo)."""
    cv2 = _cv2()
    h, w = L.shape
    if cv2 is not None:
        M = cv2.getRotationMatrix2D((float(cx), float(cy)), float(ang), 1.0)
        return cv2.warpAffine(L, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    a = np.radians(ang)
    yy, xx = np.indices((h, w), dtype=np.float32)
    xs = np.cos(a) * (xx - cx) - np.sin(a) * (yy - cy) + cx
    ys = np.sin(a) * (xx - cx) + np.cos(a) * (yy - cy) + cy
    xs, ys = np.clip(xs, 0, w - 1.001), np.clip(ys, 0, h - 1.001)
    x0, y0 = xs.astype(np.int32), ys.astype(np.int32)
    fx, fy = xs - x0, ys - y0
    return ((1 - fx) * (1 - fy) * L[y0, x0] + fx * (1 - fy) * L[y0, x0 + 1] + (1 - fx) * fy * L[y0 + 1, x0]
            + fx * fy * L[y0 + 1, x0 + 1]).astype(np.float32)


def larsonSekanina(siril, centro=None, angulos=(5, 10, 20), operador="resta", fichero=None):
    """Cometa (solo análisis): filtro de Larson-Sekanina (gradiente rotacional alrededor del núcleo) para ver chorros,
    capas y la estructura de la cola. Una previa por ángulo; la imagen NO cambia y el resultado NO es para la final
    (crea artefactos). centro [x, y] del núcleo (si no, el de apilarCometa o se busca). operador: resta
    (2·I − rot(+α) − rot(−α)) o division (I / media de las dos giradas). fichero: si no, la imagen cargada."""
    if fichero:
        p, _ = _leer(H._ruta(fichero, "fichero"))
        nombre = Path(fichero).stem
        meta = _meta_de(fichero)
    else:
        info = H._info(siril)
        p = H._pixeles(siril, info)
        nombre = Path(str(info.get("fichero") or "imagen")).stem
        meta = _meta_de(info["fichero"]) if info.get("fichero") else None
    L = _lum(p).astype(np.float32)
    if centro:
        cx, cy, fuente = float(centro[0]), float(centro[1]), "dado"
    elif meta and meta.get("nucleo_ref"):
        cx, cy, fuente = float(meta["nucleo_ref"][0]), float(meta["nucleo_ref"][1]), "de apilarCometa"
    else:
        cx, cy = _nucleo_auto(L)
        fuente = "buscado (máximo suavizado): pasa 'centro' si no es el núcleo"
    cielo, sig = _mad(L[::4, ::4])
    sin_datos = _dilatar((L <= 0) | (L < cielo - 6 * max(sig, 1e-7)), 3)     # bordes sin datos o con pocas tomas
    if sin_datos.any():                               # bordes sin datos: con el cielo, para que no salgan bordes falsos
        L = np.where(sin_datos, float(np.median(L[~sin_datos])) if (~sin_datos).any() else 0.0, L).astype(np.float32)
    Le = P._autoestirar(L[np.newaxis])[0] if _lineal(p) else np.clip(L, 0, 1)
    Le = Le.astype(np.float32)
    h, w = Le.shape
    yy, xx = np.ogrid[:h, :w]
    zona = ((xx - cx) ** 2 + (yy - cy) ** 2 <= (0.45 * min(h, w)) ** 2) & ~_dilatar(sin_datos, 8)
    if operador not in ("resta", "division"):
        raise ValueError("operador: resta o division.")
    H.PREVIAS.mkdir(parents=True, exist_ok=True)
    filas = []
    for ang in ([angulos] if isinstance(angulos, (int, float)) else list(angulos)):
        mas, menos = _rotar(Le, cx, cy, ang), _rotar(Le, cx, cy, -ang)
        if operador == "resta":
            r = 2 * Le - mas - menos
        else:
            r = Le / np.maximum((mas + menos) / 2, 1e-4) - 1
        lo, hi = np.percentile(r[zona] if zona.any() else r, (0.5, 99.5))
        v = np.clip((r - lo) / max(hi - lo, 1e-9), 0, 1)[np.newaxis]
        base = re.sub(r"[^\w.-]+", "_", f"{nombre}_LS_{ang:g}")
        fila = {"angulo": ang, "previa": _jpg(_reducida(v, 1600), H.PREVIAS / f"{base}.jpg")}
        x0, y0 = int(np.clip(cx - 300, 0, max(0, w - 600))), int(np.clip(cy - 300, 0, max(0, h - 600)))
        # el recorte con SU escala: con la de la zona grande la coma se satura en blanco y no se ven chorros ni capas
        # (prueba SAS con el Lemmon, 27-nov)
        z = r[y0:y0 + 600, x0:x0 + 600]
        zlo, zhi = np.percentile(z, (0.5, 99.9))
        vz = np.clip((z - zlo) / max(zhi - zlo, 1e-9), 0, 1)[np.newaxis]
        fila["previa_nucleo"] = _jpg(vz, H.PREVIAS / f"{base}_nucleo.jpg")
        filas.append(fila)
    return {"centro": [_r(cx, 1), _r(cy, 1)], "centro_de": fuente, "operador": operador, "angulos": filas,
            "nota": "Solo análisis: chorros y capas de la coma, y la estructura de la cola. La imagen cargada no cambia."}


LISTA_COMETAS = {"apilarCometa": apilarCometa, "combinarCometaEstrellas": combinarCometaEstrellas,
                 "transferirColorCometa": transferirColorCometa, "larsonSekanina": larsonSekanina}
