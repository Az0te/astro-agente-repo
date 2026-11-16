# SetiAstroPilot — modelo del cielo con máscara y gradiente de bordes (port de guia/herramientas/gradbordes.js).
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# Comparación de gradientes del 16 nov 2026 (M31 HDR 60/120 s e IC 1396):
#   - En una galaxia con cielo libre, encadenar el «modelo del cielo con máscara» sobre un método que no se coma el
#     objeto deja el cielo más plano y sin color: halo + crominancia + cielo con máscara = 0,6 % de galaxia, desnivel
#     0,007, color 0,002 (el ganador de PixInsight, MGC bordes + cielo con máscara, 1,1 % / 0,006 / 0,003). SRGC +
#     modelo de bordes: 0 % / 0,008 / 0,004.
#   - En una nebulosa que llena el campo (IC 1396) NO: las «cajas de cielo» son nebulosa y el modelo la aplana
#     (18–63 %). Por eso gradienteCandidatos sólo encadena cuando el objeto no llena el campo (ver allí).
# Idea: el modelo se AJUSTA sólo con cielo (cajas sin estrellas, sin halo, sin sus vecinas) y se APLICA en todo el
# campo; restar a través de una máscara dejaría el gradiente debajo del objeto y un escalón en su borde.
# Sólo numpy (como halo.py): el entorno de SASpro no garantiza scipy.

import numpy as np

B = 8          # binado de trabajo, como medidas.preparar_gradiente


def _binar(x, b=B):
    h, w = x.shape[0] // b * b, x.shape[1] // b * b
    return x[:h, :w].reshape(h // b, b, w // b, b).mean(axis=(1, 3))


def _caja(x, r):
    """Media en caja (2r+1)² con sumas acumuladas (bordes por repetición)."""
    if r <= 0:
        return x
    p = np.pad(x.astype(np.float64), r, mode="edge")
    c = p.cumsum(0).cumsum(1)
    c = np.pad(c, ((1, 0), (1, 0)))
    k = 2 * r + 1
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return (s / (k * k)).astype(np.float32)


def _blur3(x, r):
    for _ in range(3):
        x = _caja(x, r)
    return x


def _dilatar(m, it=1):
    for _ in range(it):
        o = m.copy()
        o[1:, :] |= m[:-1, :]; o[:-1, :] |= m[1:, :]; o[:, 1:] |= m[:, :-1]; o[:, :-1] |= m[:, 1:]
        m = o
    return m


def mascara_cielo(L):
    """gbCielo: máscara binada de cielo de verdad. Cajas de ~1/40 del lado menor; en cada una la mediana sin estrellas;
    superficie de grado 3 con rechazo asimétrico (+2σ fuera, que es halo; tolera bajadas hasta −4σ); fuera también las
    vecinas de las rechazadas. Devuelve (máscara, cajas de cielo, cajas totales)."""
    h, w = L.shape
    hp = L - _caja(L, 4)
    s = 1.4826 * float(np.median(np.abs(hp - np.median(hp)))) or 1e-12
    st = _dilatar(hp > 6 * s, 1)
    lado = max(4, round(min(w, h) / 40))
    nx, ny = max(8, round(w / lado)), max(6, round(h / lado))
    Z = np.full((ny, nx), np.nan)
    for j in range(ny):
        for i in range(nx):
            y0, y1, x0, x1 = j * h // ny, (j + 1) * h // ny, i * w // nx, (i + 1) * w // nx
            v = L[y0:y1, x0:x1][~st[y0:y1, x0:x1]]
            if v.size >= 0.3 * (y1 - y0) * (x1 - x0):
                Z[j, i] = np.median(v)
    ok = np.isfinite(Z)
    usable = ok.copy()
    yy, xx = np.mgrid[0:ny, 0:nx]
    X, Y = (xx + 0.5) / nx - 0.5, (yy + 0.5) / ny - 0.5
    T = np.stack([np.ones_like(X), X, Y, X * X, X * Y, Y * Y, X ** 3, X * X * Y, X * Y * Y, Y ** 3], -1)
    for _ in range(12):
        if ok.sum() < 15:
            break
        c, *_ = np.linalg.lstsq(T[ok], Z[ok], rcond=None)
        e = Z - T @ c
        sd = 1.4826 * float(np.median(np.abs(e[ok] - np.median(e[ok]))))
        nuevo = usable & (e <= 2 * sd) & (e >= -4 * sd)
        if (nuevo == ok).all():
            break
        ok = nuevo
    cajas = ok & ~_dilatar(usable & ~ok, 1)
    ys = np.minimum(np.arange(h) * ny // h, ny - 1)
    xs = np.minimum(np.arange(w) * nx // w, nx - 1)
    return cajas[ys][:, xs] & ~st, int(cajas.sum()), int(nx * ny)


def _norm_blur(a, m, r):
    """Media ponderada local blur(a·m)/blur(m): rellena objeto y estrellas con el cielo de alrededor."""
    mf = m.astype(np.float32)
    A, W = _blur3(a * mf, r), _blur3(mf, r)
    out = np.where(W > 0.02, A / np.maximum(W, 1e-9), np.nan)
    if np.isnan(out).any():
        A2, W2 = _blur3(a * mf, 3 * r), _blur3(mf, 3 * r)
        out = np.where(np.isnan(out), np.where(W2 > 1e-4, A2 / np.maximum(W2, 1e-9), np.median(a[m])), out)
    return out


def _peso_bordes(h, w, ancho=0.20, lleno=0.04):
    Yp, Xp = np.mgrid[0:h, 0:w]
    d = np.minimum(np.minimum(Xp + 0.5, w - Xp - 0.5), np.minimum(Yp + 0.5, h - Yp - 0.5))
    L = min(w, h)
    d1 = max(1.0, ancho * L)
    d0 = min(lleno * L, d1 - 1)
    return np.where(d <= d0, 1.0, np.where(d >= d1, 0.0, 0.5 * (1 + np.cos(np.pi * (d - d0) / (d1 - d0)))))


def _subir(m, H, W):
    """Modelo binado → resolución completa (bilineal; el modelo es muy liso)."""
    h, w = m.shape
    ys = np.clip((np.arange(H) + 0.5) / B - 0.5, 0, h - 1)
    xs = np.clip((np.arange(W) + 0.5) / B - 0.5, 0, w - 1)
    y0 = np.floor(ys).astype(int); x0 = np.floor(xs).astype(int)
    y1 = np.minimum(y0 + 1, h - 1); x1 = np.minimum(x0 + 1, w - 1)
    fy = (ys - y0)[:, None].astype(np.float32); fx = (xs - x0)[None, :].astype(np.float32)
    return (m[y0][:, x0] * (1 - fy) * (1 - fx) + m[y1][:, x0] * fy * (1 - fx)
            + m[y0][:, x1] * (1 - fy) * fx + m[y1][:, x1] * fy * fx)


def plano_oscuras(p, frac=0.25):
    """Plano (grado 1) por canal ajustado sólo en las celdas de 64 px más oscuras (fracción frac). Para nebulosas o
    polvo que llenan el campo: en IC 1396 (16 nov 2026) fue lo que más se pareció a SRGC (distancia Hα 2,6 frente a
    10,4 del plano en las cajas de cielo; OIII 0,88/1,07, SII 1,18/2,08, Hβ 1,02/1,73) sin aplanar nada."""
    p = np.asarray(p, dtype=np.float32)
    out = np.array(p, copy=True)
    k = max(1, round(64 / B))
    H, W = p.shape[1:]
    for c in range(p.shape[0]):
        Lb = _binar(p[c])
        h, w = Lb.shape[0] // k, Lb.shape[1] // k
        cel = np.median(Lb[:h * k, :w * k].reshape(h, k, w, k).transpose(0, 2, 1, 3).reshape(h, w, -1), axis=2)
        yy, xx = np.mgrid[0:h, 0:w]
        X, Y = (xx + 0.5) / w - 0.5, (yy + 0.5) / h - 0.5
        sel = cel <= np.percentile(cel, 100 * frac)
        A = np.stack([np.ones(sel.sum()), X[sel], Y[sel]], 1)
        z = cel[sel].astype(np.float64)
        keep = np.ones(len(z), bool)
        for _ in range(6):
            co, *_ = np.linalg.lstsq(A[keep], z[keep], rcond=None)
            r = z - A @ co
            s = 1.4826 * float(np.median(np.abs(r[keep] - np.median(r[keep]))))
            keep = np.abs(r) < 3 * max(s, 1e-12)
        Yf, Xf = np.mgrid[0:H, 0:W].astype(np.float32)
        Xf = (Xf + 0.5) / W - 0.5
        Yf = (Yf + 0.5) / H - 0.5
        out[c] = p[c] - (co[1] * Xf + co[2] * Yf).astype(np.float32)   # sin el término constante: conserva el nivel
    return out


def corregir(q, mascara, bordes=False):
    """q: (C, H, W) lineal. Resta el modelo del cielo con máscara (bordes=False: suavizado 1/15, en todo el campo) o el
    gradiente de bordes (bordes=True: suavizado 1/16, peso 1 hasta el 4 % del lado menor y 0 desde el 20 %)."""
    qb = np.stack([_binar(q[c]) for c in range(q.shape[0])])
    h, w = qb.shape[1:]
    r = max(3, round(min(w, h) / (16 if bordes else 15)))
    Wb = _peso_bordes(h, w) if bordes else np.ones((h, w))
    out = np.array(q, dtype=np.float32, copy=True)
    for c in range(q.shape[0]):
        S = _norm_blur(qb[c], mascara, r)
        sel = ((Wb < 0.01) & mascara) if bordes else mascara
        if sel.sum() < 20:
            sel = mascara
        ref = float(np.median(S[sel]))
        out[c] = q[c] - _subir(((S - ref) * Wb).astype(np.float32), *q.shape[1:])
    return out
