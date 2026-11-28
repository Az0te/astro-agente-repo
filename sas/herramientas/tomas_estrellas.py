# Calidad de las estrellas toma a toma y apilado de la capa de estrellas con pesos (SirilAstroPilot y SetiAstroPilot: el
# mismo fichero en siril/herramientas y sas/herramientas). Copyright (c) 2026 Rafael Vidal. Licencia MIT.
# https://github.com/Az0te/astro-agente-repo
#
# Lemmon, 27-nov-2026: en 17 de las 33 tomas cada estrella salía desdoblada (pares a ~5 px, todos en la misma dirección
# dentro de la toma: un salto de la montura o viento durante la exposición). En el apilado esas copias caen en
# direcciones distintas y no se ven como dobles fijas, pero ensanchan y ovalan las estrellas. Aquí:
#   medir_toma(L)        → pares de estrellas cercanos (2,5–10 px), cuántos saldrían por azar, si se concentran en una
#                          dirección (toma desdoblada), FWHM y excentricidad por momentos
#   reducir_pesos(...)   → winsorized 3/3 con un peso por toma (las desdobladas pesan menos)
#   medir_capa(p)        → FWHM, excentricidad, ruido fino del cielo y desplazamiento de color de una capa apilada
#   alinear_canales(p)   → mueve R y B (subpíxel) para que sus centroides coincidan con los de G en las estrellas:
#                          dispersión atmosférica (cometa bajo) o cromática lateral que deja un borde azul/rojo
#   nucleos_grandes(p)   → núcleos quemados de las estrellas grandes con el tono del anillo y tono radial simétrico
#   recortes(...)        → mosaico de las mismas estrellas brillantes y un trozo de cielo, al 100 %, con un estirado común
# Solo numpy y OpenCV (la venv de Siril no trae scipy).

import math
import warnings

import numpy as np


def _cv2():
    import cv2
    return cv2


def _fondo(L, S=16):
    cv2 = _cv2()
    h, w = L.shape
    hs, ws = max(1, h // S), max(1, w // S)
    peq = cv2.resize(L, (ws, hs), interpolation=cv2.INTER_AREA)
    peq = cv2.medianBlur(np.ascontiguousarray(peq, np.float32), 5)
    return cv2.resize(peq, (w, h), interpolation=cv2.INTER_LINEAR)


def _ruido(r):
    d = np.diff(r[::2, ::2], axis=1).ravel()
    d = d[np.isfinite(d)]
    if d.size == 0:
        return 1e-7
    return max(float(1.4826 * np.median(np.abs(d - np.median(d))) / math.sqrt(2)), 1e-9)


def _estrellas(L, max_n=3000, sigmas=10.0, borde=20, med=7):
    """Picos de estrellas no saturadas: (posiciones y, x con centroide; amplitud; fwhm; excentricidad)."""
    cv2 = _cv2()
    L = np.asarray(L, np.float32)
    # zona con datos: en las tomas registradas el borde queda a 0 (o NaN) y el escalón entre el relleno y el cielo,
    # interpolado, da falsas «estrellas» en fila cada 4 px (Lemmon en Siril: 26 de 33 tomas marcadas como desdobladas)
    hay = np.isfinite(L) & (L != 0)
    L = np.where(hay, L, 0.0).astype(np.float32)
    if not hay.all():
        L = np.where(hay, L, float(np.median(L[hay])) if hay.any() else 0.0).astype(np.float32)
        hay = cv2.erode(hay.astype(np.uint8), np.ones((2 * borde + 1, 2 * borde + 1), np.uint8)).astype(bool)
    r = L - _fondo(L)
    s = _ruido(r)
    mx = cv2.dilate(r, np.ones((5, 5), np.uint8))
    tope = 0.97 * float(np.nanmax(L))
    pk = (r == mx) & (r > sigmas * s) & (L < tope) & hay
    pk[:borde], pk[-borde:], pk[:, :borde], pk[:, -borde:] = False, False, False, False
    ys, xs = np.nonzero(pk)
    if ys.size == 0:
        return np.zeros((0, 2)), np.zeros(0), np.zeros(0), np.zeros(0), s
    amp = r[ys, xs]
    o = np.argsort(amp)[::-1][:max_n]
    ys, xs, amp = ys[o], xs[o], amp[o]
    yy, xx = np.mgrid[-med:med + 1, -med:med + 1]
    W = r[ys[:, None, None] + yy[None], xs[:, None, None] + xx[None]].astype(np.float64)
    ring = np.concatenate([W[:, 0, :], W[:, -1, :], W[:, :, 0], W[:, :, -1]], axis=1)
    W = np.clip(W - np.median(ring, axis=1)[:, None, None], 0, None)
    t = W.sum((1, 2))
    ok = t > 0
    W, t, ys, xs, amp = W[ok], t[ok], ys[ok], xs[ok], amp[ok]
    cy = (W * yy).sum((1, 2)) / t
    cx = (W * xx).sum((1, 2)) / t
    syy = (W * (yy - cy[:, None, None]) ** 2).sum((1, 2)) / t
    sxx = (W * (xx - cx[:, None, None]) ** 2).sum((1, 2)) / t
    sxy = (W * (yy - cy[:, None, None]) * (xx - cx[:, None, None])).sum((1, 2)) / t
    tr, de = sxx + syy, np.sqrt(np.maximum((sxx - syy) ** 2 / 4 + sxy ** 2, 0))
    l1, l2 = tr / 2 + de, np.maximum(tr / 2 - de, 1e-6)
    fw = 2.3548 * np.sqrt(np.sqrt(l1 * l2))
    ec = np.sqrt(np.clip(1 - l2 / np.maximum(l1, 1e-6), 0, 1))
    pos = np.stack([ys + cy, xs + cx], 1)
    return pos, amp, fw, ec, s


def _pares(pos, area, rmin=2.5, rmax=10.0):
    """Vecino más cercano de cada estrella entre rmin y rmax: número de pares, los esperados por azar, histograma de la
    dirección (12 casillas de 15°) y separación mediana."""
    n = len(pos)
    if n < 10:
        return 0, 0.0, [0] * 12, None
    dmin = np.full(n, np.inf)
    jmin = np.zeros(n, int)
    for a in range(0, n, 1000):
        d = np.hypot(pos[a:a + 1000, None, 0] - pos[None, :, 0], pos[a:a + 1000, None, 1] - pos[None, :, 1])
        d[np.arange(d.shape[0]), np.arange(a, a + d.shape[0])] = np.inf
        jmin[a:a + 1000] = d.argmin(1)
        dmin[a:a + 1000] = d.min(1)
    par = (dmin >= rmin) & (dmin <= rmax)
    v = pos[jmin[par]] - pos[par]
    v[v[:, 0] < 0] *= -1
    ang = np.degrees(np.arctan2(v[:, 0], v[:, 1])) % 180
    hist = np.histogram(ang, bins=12, range=(0, 180))[0].tolist()
    dens = n / max(area, 1)
    esper = n * (1 - math.exp(-dens * math.pi * (rmax ** 2 - rmin ** 2)))
    return int(par.sum()), float(esper), hist, (float(np.median(dmin[par])) if par.any() else None)


def medir_toma(L):
    """Una toma (luminancia): estrellas, FWHM y excentricidad medianas, pares y si está desdoblada (pares > 3 veces los
    del azar + 10 y más de la mitad en una dirección, tres casillas de 15° seguidas)."""
    pos, amp, fw, ec, _ = _estrellas(L)
    if len(pos) < 20:
        return {"estrellas": int(len(pos)), "desdoblada": False, "nota": "pocas estrellas para medir"}
    sel = (amp > np.percentile(amp, 30)) & (amp < np.percentile(amp, 95))
    npar, esper, hist, sep = _pares(pos, L.size)
    h3 = [hist[i] + hist[(i + 1) % 12] + hist[(i + 2) % 12] for i in range(12)]
    i3 = int(np.argmax(h3))
    frac = h3[i3] / max(npar, 1)
    # fracción de estrellas con copia: los pares que sobran sobre el azar, por estrella (Lemmon: 0,27–0,35 en las tomas
    # muy desdobladas, 0,06–0,07 en las leves, ≤ 0,015 en las limpias)
    fd = max(0.0, npar - esper) / len(pos) if frac > 0.5 else 0.0
    return {"estrellas": int(len(pos)), "fwhm_px": round(float(np.median(fw[sel])), 2),
            "excentricidad": round(float(np.median(ec[sel])), 3), "pares": npar, "pares_azar": round(esper, 1),
            "direccion_pares_grados": (i3 + 1) * 15 if npar else None, "fraccion_en_direccion": round(frac, 2),
            "separacion_px": round(sep, 2) if sep else None, "fraccion_desdoblada": round(fd, 3),
            "desdoblada": bool(fd > 0.05)}


def pesos_tomas(medidas, peso_min=0.3, f0=0.03, f1=0.15):
    """Peso por toma según su fracción de estrellas desdobladas: 1 hasta f0, peso_min desde f1, lineal en medio."""
    out = []
    for m in medidas:
        f = float(m.get("fraccion_desdoblada") or 0.0)
        out.append(round(float(1.0 - (1.0 - peso_min) * np.clip((f - f0) / (f1 - f0), 0, 1)), 3))
    return out


def reducir_pesos(cubo, pesos, lo=3.0, hi=3.0):
    """Winsorized lo/hi (como Siril y _reducir_cubo 'w33') con un peso por toma en la media de las aceptadas. cubo
    (N, ...) con NaN donde no hay dato; pesos (N,). Las tomas con peso 0 no entran ni en el rechazo."""
    w = np.asarray(pesos, np.float32)
    keep = w > 0
    cubo, w = cubo[keep], w[keep]
    with warnings.catch_warnings(), np.errstate(all="ignore"):
        warnings.simplefilter("ignore", RuntimeWarning)
        med = np.nanmedian(cubo, 0)
        sd = 1.4826 * np.nanmedian(np.abs(cubo - med), 0)
        for _ in range(3):
            wz = np.clip(cubo, med - 1.5 * sd, med + 1.5 * sd)
            med = np.nanmean(wz, 0)
            sd = 1.134 * np.nanstd(wz, 0)
        sd = np.maximum(sd, 1e-7)
        ok = (cubo >= med - lo * sd) & (cubo <= med + hi * sd)
        wb = w.reshape((-1,) + (1,) * (cubo.ndim - 1))
        sw = np.where(ok, wb, 0).sum(0)
        s = np.where(ok, cubo * wb, 0).sum(0)
        out = np.where(sw > 0, s / np.maximum(sw, 1e-9), med)
        rech = 1.0 - float(ok.sum()) / max(1, int(np.isfinite(cubo).sum()))
    return out.astype(np.float32), rech


def _desplaz_color(p, pos, amp, n=200, med=6):
    """Mediana del desplazamiento (dy, dx) del centroide de R y de B respecto a G en las estrellas más brillantes."""
    if p.shape[0] < 3 or len(pos) == 0:
        return None
    yy, xx = np.mgrid[-med:med + 1, -med:med + 1]
    o = np.argsort(amp)[::-1][:n]
    ys = np.round(pos[o, 0]).astype(int)
    xs = np.round(pos[o, 1]).astype(int)
    h, w = p.shape[1:]
    ok = (ys > med) & (xs > med) & (ys < h - med - 1) & (xs < w - med - 1)
    ys, xs = ys[ok], xs[ok]
    cen = []
    for k in range(3):
        W = np.nan_to_num(p[k][ys[:, None, None] + yy[None], xs[:, None, None] + xx[None]].astype(np.float64))
        ring = np.concatenate([W[:, 0, :], W[:, -1, :]], axis=1)
        W = np.clip(W - np.median(ring, axis=1)[:, None, None], 0, None)
        t = np.maximum(W.sum((1, 2)), 1e-12)
        cen.append(np.stack([(W * yy).sum((1, 2)) / t, (W * xx).sum((1, 2)) / t], 1))
    dR, dB = np.median(cen[0] - cen[1], 0), np.median(cen[2] - cen[1], 0)
    return {"R_menos_G_px": [round(float(dR[0]), 3), round(float(dR[1]), 3)],
            "B_menos_G_px": [round(float(dB[0]), 3), round(float(dB[1]), 3)]}


def medir_capa(p, excluir=None):
    """Capa de estrellas apilada (c, h, w): FWHM y excentricidad medianas, pares en exceso, ruido fino del cielo y
    desplazamiento de color. excluir: (x, y, radio) zona que no cuenta (la coma)."""
    p = np.asarray(p, np.float32)
    L = np.nan_to_num(p.mean(0) if p.shape[0] > 1 else p[0], nan=0.0)
    pos, amp, fw, ec, s = _estrellas(L)
    if excluir is not None and len(pos):
        x, y, r = excluir
        lejos = np.hypot(pos[:, 1] - x, pos[:, 0] - y) > r
        pos, amp, fw, ec = pos[lejos], amp[lejos], fw[lejos], ec[lejos]
    if len(pos) < 20:
        return {"estrellas": int(len(pos))}
    sel = (amp > np.percentile(amp, 30)) & (amp < np.percentile(amp, 95))
    npar, esper, _, _ = _pares(pos, L.size)
    cv2 = _cv2()
    hp = L - cv2.GaussianBlur(L, (0, 0), 2)
    v = hp[::2, ::2].ravel()
    m = float(np.median(v))
    ruido = 1.4826 * float(np.median(np.abs(v - m)))
    out = {"estrellas": int(len(pos)), "fwhm_px": round(float(np.median(fw[sel])), 3),
           "excentricidad": round(float(np.median(ec[sel])), 3),
           "excentricidad_p90": round(float(np.percentile(ec[sel], 90)), 3),
           "pares_exceso": round(npar / max(esper, 1), 2), "ruido_fino": float(f"{ruido:.4g}")}
    dc = _desplaz_color(p, pos, amp)
    if dc:
        out["color"] = dc
    out.update(artefacto_nucleo(p, excluir))
    return out


def _niveles(p, excluir=None):
    """Nivel de recorte de cada canal: su máximo fuera de la zona 'excluir' (x, y, r)."""
    q = np.nan_to_num(np.asarray(p, np.float32), nan=0.0)
    if excluir is not None:
        h, w = q.shape[1:]
        x, y, r = excluir
        ya, yb, xa, xb = max(0, int(y - r)), min(h, int(y + r)), max(0, int(x - r)), min(w, int(x + r))
        q = q.copy()
        q[:, ya:yb, xa:xb] = 0
    return np.maximum(q.reshape(q.shape[0], -1).max(1), 1e-9)


def _saturados(p, umbral=0.25, excluir=None):
    """Máscara de píxeles con algún canal por encima de umbral · su nivel de recorte (núcleos quemados en todas o en
    parte de las tomas) y la imagen M = máx_k canal_k / nivel_k."""
    lv = _niveles(p, excluir)
    M = (np.nan_to_num(np.asarray(p, np.float32), nan=0.0) / lv[:, None, None].astype(np.float32)).max(0)
    return lv, M, M >= umbral


def reparar_nucleos(p, excluir=None, pico=0.35, umbral=0.25, tope=0.8, max_area=6000):
    """Núcleos quemados de la capa de estrellas lineal (Lemmon, 27-nov). La cámara recorta cada canal a un nivel
    distinto y, con el balance de blancos y el apilado (quemado en unas tomas y en otras no), el centro de las estrellas
    brillantes pierde sobre todo verde: núcleo 0,43/0,33/0,24 frente a 0,29/0,50/0,21 en el anillo. Al calibrar el
    color y estirar sale un disco blanco-azulado o rosado, descentrado, con una mancha roja al lado. Aquí, en cada
    estrella con algún canal por encima de 'pico' · su nivel de recorte: núcleo = la zona conexa con algún canal por
    encima de 'umbral' · nivel; color = el del anillo que lo rodea (fondo local restado); intensidad
    I = máx_k (canal_k − fondo_k) / color_k, real donde ningún canal llega a 0,9 · su nivel. Donde alguno llega (los
    datos solo dan una cota por debajo) se rellena con una cúpula: sigue el valor y la pendiente de la estrella en el
    borde de la zona recortada y sube hasta el centro (parábola en la distancia al borde). Al final, una rodilla
    x/(1+x) desde 0,6 · 'tope' que nunca se aplana del todo (el BlurX recorta lo que pasa de 1, y la calibración
    multiplica el azul por ~2,4: 'tope' 0,8 deja margen).
    28-nov: antes el núcleo era fondo + color · máx_k (canal_k / color_k) con una rodilla tanh: como todos los canales
    están recortados, eso da una MESETA plana de ~9 px; el BlurX afila sus bordes y recorta a 1, y al calibrar cada
    canal recorta a un radio distinto: anillos de color y puntos oscuros en el centro de las estrellas grandes y
    medianas (Rafael, 28-nov). La cúpula no tiene meseta ni bordes. Fuera de los núcleos no cambia nada; el borde se
    funde. excluir: (x, y, r) zona que no se toca (la coma). Devuelve (capa, informe)."""
    cv2 = _cv2()
    p = np.asarray(p, np.float32)
    if p.ndim != 3 or p.shape[0] < 3:
        return p, None
    lv, M, sat = _saturados(p, umbral, excluir)
    h, w = M.shape
    n, lab, st, _ = cv2.connectedComponentsWithStats(sat.astype(np.uint8), connectivity=8)
    q = p.copy()
    k3 = np.ones((3, 3), np.uint8)
    hechos, saltados = 0, 0
    for i in range(1, n):
        x0, y0, bw, bh, area = st[i]
        if area > max_area:
            saltados += 1
            continue
        ya, yb, xa, xb = max(0, y0 - 12), min(h, y0 + bh + 12), max(0, x0 - 12), min(w, x0 + bw + 12)
        nuc = lab[ya:yb, xa:xb] == i
        if float(M[ya:yb, xa:xb][nuc].max()) < pico:
            continue
        yc, xc = y0 + bh / 2, x0 + bw / 2
        if excluir is not None and math.hypot(xc - excluir[0], yc - excluir[1]) < excluir[2]:
            continue
        c = np.nan_to_num(p[:, ya:yb, xa:xb]).astype(np.float64)
        borde = np.ones(nuc.shape, bool)
        borde[3:-3, 3:-3] = False
        fondo = np.median(c[:, borde], axis=1)
        d = c - fondo[:, None, None]
        n8 = nuc.astype(np.uint8)
        r1 = cv2.dilate(n8, k3, iterations=1).astype(bool)
        r3 = cv2.dilate(n8, k3, iterations=3).astype(bool)
        libre = ~sat[ya:yb, xa:xb]
        anillo = cv2.dilate(n8, k3, iterations=5).astype(bool) & ~r1 & libre
        if anillo.sum() < 10:
            saltados += 1
            continue
        col = np.median(d[:, anillo], axis=1)
        if not np.all(col > 0):
            saltados += 1
            continue
        col = col / col.max()
        I = np.clip((d / col[:, None, None]).max(0), 0, None)
        # recortado de verdad (algún canal ≥ 0,9 · su nivel): ahí los datos solo dan una cota por debajo; fuera, I es real
        T = nuc & (M[ya:yb, xa:xb] >= 0.9)
        Icore = I.copy()
        if T.any():
            t8 = T.astype(np.uint8)
            e1 = cv2.dilate(t8, k3, iterations=1).astype(bool) & ~T
            e3 = cv2.dilate(t8, k3, iterations=3).astype(bool) & ~cv2.dilate(t8, k3, iterations=2).astype(bool)
            Ie = float(np.median(I[e1])) if e1.any() else float(I[T].min())
            g = max(0.0, (Ie - float(np.median(I[e3]))) / 2.0) if e3.sum() >= 3 else 0.0
            D = cv2.distanceTransform(np.pad(t8, 1), cv2.DIST_L2, 5)[1:-1, 1:-1].astype(np.float64)
            Dm = max(float(D.max()), 1.0)
            u = np.clip(D / Dm, 0, 1)
            Pmax = max(tope - float(fondo.max()), 1e-3)
            P = max(Ie + (g + 0.5 * Ie) * Dm, 1.05 * float(I[T].max()))
            P = min(P, 2.0 * Pmax)
            cup = Ie + (P - Ie) * (2 * u - u * u)
            Icore[T] = np.maximum(I[T], cup[T])
        # rodilla suave sin meseta: x/(1+x) sobre 0,6·máx (nunca se aplana del todo; el perfil sigue en punta)
        Pmax = max(tope - float(fondo.max()), 1e-3)
        ak = 0.6 * Pmax
        x = np.maximum(Icore - ak, 0) / (Pmax - ak)
        Icore = np.where(Icore > ak, ak + (Pmax - ak) * x / (1 + x), Icore)
        nuevo = col[:, None, None] * Icore[None] + fondo[:, None, None]
        peso = np.clip(cv2.GaussianBlur(r1.astype(np.float32), (0, 0), 0.8) * 1.6, 0, 1)
        peso[nuc] = 1.0
        q[:, ya:yb, xa:xb] = (peso[None] * nuevo + (1 - peso[None]) * c).astype(np.float32)
        hechos += 1
    return q, {"nucleos": hechos, "saltados": saltados, "niveles": [round(float(v), 4) for v in lv],
               "px": int(sat.sum())}


def proteger_nucleos_nxt(antes, despues, t1=0.15, t2=0.35, max_area=3000):
    """Núcleos de estrella tras NoiseXTerminator (Lemmon, 28-nov). NXT toma los núcleos brillantes por ruido y los
    rehace: un núcleo calibrado de 0,84–0,91 sale a 1,00–2,00 y cada canal distinto (puntos azules, anillos rojos, arcos
    verdes tras estirar), y entrar a la mitad no lo evita. En un núcleo la señal ya es alta y no hace falta quitar ruido:
    donde el canal mayor de la entrada pasa de t1 (lineal) se vuelve a la entrada, del todo a partir de t2, con borde
    suave. Solo en manchas compactas (≤ max_area px): el núcleo de una galaxia o una nebulosa brillante sí se limpia.
    Devuelve (despues arreglado, n.º de núcleos)."""
    import cv2
    a = np.asarray(antes, dtype=np.float32)
    d = np.asarray(despues, dtype=np.float32)
    if a.shape != d.shape or a.ndim != 3:
        return d, 0
    m = a.max(0)
    sem = (m > t1).astype(np.uint8)
    if not sem.any():
        return d, 0
    n, lab, st, _ = cv2.connectedComponentsWithStats(sem, connectivity=8)
    ok = np.zeros(n, bool)
    ok[1:] = st[1:, cv2.CC_STAT_AREA] <= max_area
    sel = ok[lab]
    if not sel.any():
        return d, 0
    w = np.clip((m - t1) / (t2 - t1), 0, 1)
    w = np.where(cv2.dilate(sel.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool), w, 0)
    w = np.maximum(w, cv2.GaussianBlur(cv2.dilate((w > 0).astype(np.float32), np.ones((3, 3), np.uint8)), (0, 0), 1.0) * 0.5)
    w = np.clip(w, 0, 1).astype(np.float32)
    return (w[None] * a + (1 - w[None]) * d).astype(np.float32), int(ok[1:].sum())


def proteger_nucleos_deconv(antes, despues, umbral=0.9, max_area=20000):
    """Núcleos tras BlurXTerminator (Lemmon, 28-nov). Aunque entre por debajo de 1, BlurX concentra el flujo: un núcleo
    de 0,75 sale por encima de 1, y cada canal con su propio pico (centro rojo con un hueco en el verde: 1,00 0,95 1,00).
    Recortado, o con una rodilla tanh, queda una meseta de otro color que, al calibrar (azul ×2,4), recorta cada canal a
    un radio distinto: anillos de color y puntos en el centro de las estrellas grandes y medianas. Aquí, donde la salida
    llega a 'umbral' en algún canal (escala de la entrada; despues SIN recortar, puede pasar de 1): intensidad = suma de
    canales de BlurX (la forma y la FWHM son las suyas; el hueco de un canal lo tapa otro) y color = el del núcleo de
    ANTES (uno solo en toda la estrella), con una rodilla x/(1+x) desde 0,6 que la deja por debajo de 0,95 sin
    aplanarla. Devuelve (despues arreglado, núcleos)."""
    cv2 = _cv2()
    a = np.nan_to_num(np.asarray(antes, np.float32))
    b = np.nan_to_num(np.asarray(despues, np.float32))
    if a.ndim != 3 or a.shape[0] != 3 or a.shape != b.shape:
        return b, 0
    sat = (b.max(0) >= umbral).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(sat, connectivity=8)
    if n <= 1:
        return b, 0
    q = b.copy()
    h, w = sat.shape
    k3 = np.ones((3, 3), np.uint8)
    hechos = 0
    for i in range(1, n):
        x0, y0, bw, bh, area = st[i]
        if area > max_area:
            continue
        ya, yb, xa, xb = max(0, y0 - 12), min(h, y0 + bh + 12), max(0, x0 - 12), min(w, x0 + bw + 12)
        T = (lab[ya:yb, xa:xb] == i).astype(np.uint8)
        ca, cb = a[:, ya:yb, xa:xb].astype(np.float64), b[:, ya:yb, xa:xb].astype(np.float64)
        borde = np.ones(T.shape, bool)
        borde[3:-3, 3:-3] = False
        fa, fb = np.median(ca[:, borde], axis=1), np.median(cb[:, borde], axis=1)
        da, db = np.clip(ca - fa[:, None, None], 0, None), np.clip(cb - fb[:, None, None], 0, None)
        Td = cv2.dilate(T, k3, iterations=2).astype(bool)
        col = da[:, Td].sum(1)
        if not np.all(col > 0):
            continue
        col = col / col.max()
        I = db.sum(0) / col.sum()
        ak, P = 0.6, 0.95
        x = np.maximum(I - ak, 0) / (P - ak)
        I = np.where(I > ak, ak + (P - ak) * x / (1 + x), I)
        nu = col[:, None, None] * I[None] + fb[:, None, None]
        wgt = np.clip(cv2.GaussianBlur(cv2.dilate(T, k3, iterations=1).astype(np.float32), (0, 0), 1.0) * 1.5, 0, 1)
        wgt[T.astype(bool)] = 1.0
        q[:, ya:yb, xa:xb] = (wgt[None] * nu + (1 - wgt[None]) * cb).astype(np.float32)
        hechos += 1
    return q, hechos


def nucleos_grandes(p, excluir=None, umbral=0.85, max_area=3000, lista=None):
    """Núcleos quemados de las estrellas GRANDES en la capa lineal ya con el color calibrado (Lemmon, 28-nov: «el centro
    de las estrellas grandes sigue viéndose con artefactos»). La cámara recorta cada canal a un nivel distinto y el
    balance de color multiplica R y B, así que en el centro quemado un canal queda en su tope y los otros no: núcleo
    verde (G quemado), punto rosa o azul, anillos. Allí no hay dato real del color. Se rehace, estrella a estrella:
      - núcleo (hasta r_sat + 2 px): luminancia = la medida o la de un Moffat ajustado a las alas no quemadas (la
        mayor), con el tono (r, g, b normalizados) del anillo no quemado de alrededor;
      - de r_sat + 2 a 3·r_sat + 8 px: el tono de cada anillo de 1 px es su mediana alrededor de la estrella (quita los
        arcos de color de un solo lado, como el borde verde que deja el desbayerizado del recorte), con la suma de
        canales medida;
      - rampa de 3 px hacia la imagen tal cual. Ningún píxel pasa de 1 (se divide por su máximo, el tono no cambia).
    Detecta las quemadas con algún canal ≥ umbral · su nivel de recorte (fuera de 'excluir' = (x, y, r), el cometa).
    Con lista (la que devuelve una llamada anterior) repara las mismas estrellas en otra capa (apilado y solo estrellas).
    Devuelve (capa, lista)."""
    cv2 = _cv2()
    q = np.nan_to_num(np.asarray(p, np.float32), nan=0.0).copy()
    if q.ndim != 3 or q.shape[0] < 3:
        return q, []
    h, w = q.shape[1:]
    if lista is None:
        _, _, S = _saturados(q, umbral, excluir)
        k, _, st, cen = cv2.connectedComponentsWithStats(S.astype(np.uint8))
        lista = []
        for i in range(1, k):
            area = int(st[i, 4])
            if area < 3 or area > max_area:
                continue
            x, y = float(cen[i][0]), float(cen[i][1])
            if excluir is not None and math.hypot(x - excluir[0], y - excluir[1]) < excluir[2]:
                continue
            rs = math.sqrt(area / math.pi)
            lista.append((x, y, rs))
    nivel = _niveles(q, excluir)
    for x, y, rs in lista:
        Re = 3 * rs + 8
        R = int(math.ceil(Re + 4))
        x0, y0 = int(round(x)), int(round(y))
        if x0 < R or y0 < R or x0 >= w - R or y0 >= h - R:
            continue
        sl = (slice(None), slice(y0 - R, y0 + R + 1), slice(x0 - R, x0 + R + 1))
        blq = q[sl]
        f = np.median(np.concatenate([blq[:, 0], blq[:, -1], blq[:, :, 0], blq[:, :, -1]], 1), axis=1)
        c = blq - f[:, None, None]
        yy, xx = np.mgrid[-R:R + 1, -R:R + 1]
        r = np.hypot(xx - (x - x0), yy - (y - y0))
        Y = c.mean(0)
        ani = (r > rs + 2) & (r <= rs + 5)
        v = np.clip(c[:, ani], 1e-9, None)
        tono = np.median(v / v.sum(0, keepdims=True), axis=1)
        # Moffat a las alas no quemadas (rejilla: sin scipy)
        Mq = (blq / nivel[:, None, None]).max(0)
        alas = (Mq < 0.6 * umbral) & (r > rs) & (r < R)
        mof = None
        if alas.sum() >= 10:
            ra, ya = r[alas], Y[alas]
            best = None
            for a in np.geomspace(0.5, 30, 40):
                for b in (0.8, 1.0, 1.3, 1.6, 2.0, 2.5, 3.0, 4.0):
                    g = 1 / (1 + (ra / a) ** 2) ** b
                    A = float((g * ya).sum() / max(float((g * g).sum()), 1e-12))
                    e = float(((A * g - ya) ** 2).sum())
                    if A > 0 and (best is None or e < best[0]):
                        best = (e, A, a, b)
            if best:
                _, A, a, b = best
                mof = A / (1 + (r / a) ** 2) ** b
        Yn = np.maximum(Y, mof) if mof is not None else Y
        cl = np.clip(c, 1e-9, None)
        cro = cl / cl.sum(0, keepdims=True)
        T = np.empty_like(c)
        for qq in range(int(Re) + 2):
            m = (r >= qq) & (r < qq + 1)
            if m.any():
                T[:, m] = np.median(cro[:, m], axis=1)[:, None]
        dentro = r <= rs + 2
        N = np.where(dentro[None], 3 * Yn[None] * tono[:, None, None], c.sum(0)[None] * T) + f[:, None, None]
        mx = N.max(0, keepdims=True)
        N = np.where(mx > 1, N / mx, N)
        wgt = np.clip((Re - r) / 3.0, 0, 1)[None].astype(np.float32)
        q[sl] = (wgt * N + (1 - wgt) * blq).astype(np.float32)
    return q, lista



def artefacto_nucleo(p, excluir=None, n=30):
    """Asimetría de color en el centro de las n estrellas más brillantes (quemadas incluidas: son las que fallan).
    nucleo_color: diferencia máxima de cromaticidad (r, g, b normalizados) entre el núcleo (≥ 80 % del pico) y el
    anillo (15–40 % del pico), fondo local restado; un núcleo quemado sale de otro color que la estrella.
    nucleo_rb_px: distancia entre los centroides del rojo y del azul en la estrella (≥ 15 % del pico): la mancha roja
    al lado del núcleo. Medianas y p90. Sirve en lineal y en estirada."""
    cv2 = _cv2()
    p = np.asarray(p, np.float32)
    if p.ndim != 3 or p.shape[0] < 3:
        return {}
    L = np.nan_to_num(p.mean(0), nan=0.0)
    h, w = L.shape
    bg = _fondo(L)
    Lr = L - bg
    mx = cv2.dilate(Lr, np.ones((15, 15), np.uint8))
    pk = (Lr == mx) & (Lr > 0)
    pk[:24], pk[-24:], pk[:, :24], pk[:, -24:] = False, False, False, False
    ys, xs = np.nonzero(pk)
    if excluir is not None and len(ys):
        lejos = np.hypot(xs - excluir[0], ys - excluir[1]) > excluir[2]
        ys, xs = ys[lejos], xs[lejos]
    if len(ys) < 5:
        return {}
    o = np.argsort(Lr[ys, xs])[::-1][:n]
    R = 12
    yy, xx = np.mgrid[-R:R + 1, -R:R + 1]
    dcol, drb = [], []
    for y, x in zip(ys[o], xs[o]):
        c = np.nan_to_num(p[:, y - R:y + R + 1, x - R:x + R + 1]).astype(np.float64)
        f = np.median(np.concatenate([c[:, 0], c[:, -1], c[:, :, 0], c[:, :, -1]], 1), axis=1)
        d = np.clip(c - f[:, None, None], 0, None)
        Ld = d.sum(0)
        pv = float(Ld.max())
        if pv <= 0:
            continue
        nu, an = d[:, Ld >= 0.8 * pv].sum(1), d[:, (Ld >= 0.15 * pv) & (Ld <= 0.4 * pv)].sum(1)
        if nu.sum() <= 0 or an.sum() <= 0:
            continue
        dcol.append(float(np.abs(nu / nu.sum() - an / an.sum()).max()))
        z = Ld >= 0.15 * pv
        cR, cB = d[0] * z, d[2] * z
        if cR.sum() > 0 and cB.sum() > 0:
            drb.append(float(math.hypot((cR * xx).sum() / cR.sum() - (cB * xx).sum() / cB.sum(),
                                        (cR * yy).sum() / cR.sum() - (cB * yy).sum() / cB.sum())))
    if not dcol:
        return {}
    return {"nucleo_color": round(float(np.median(dcol)), 3), "nucleo_color_p90": round(float(np.percentile(dcol, 90)), 3),
            "nucleo_rb_px": round(float(np.median(drb)), 3) if drb else None,
            "nucleo_rb_px_p90": round(float(np.percentile(drb, 90)), 3) if drb else None}


def nucleo_peor(k, ref, margen=0.03, factor=1.25):
    """True si la capa k tiene el artefacto de núcleo claramente peor que la de referencia (no puede ganar)."""
    a, b = k.get("nucleo_color_p90"), ref.get("nucleo_color_p90")
    c, d = k.get("nucleo_rb_px_p90"), ref.get("nucleo_rb_px_p90")
    peor = a is not None and b is not None and a > factor * b + margen
    peor |= c is not None and d is not None and c > factor * d + 0.15
    return bool(peor)


def alinear_canales(p, minimo=0.15):
    """Mueve R y B para que su centroide en las estrellas coincida con el de G (subpíxel, Lanczos). Devuelve (capa,
    desplazamientos medidos); no mueve un canal si su desplazamiento es menor que 'minimo' px. Las estrellas con algún
    canal quemado no cuentan en la medida (su meseta no tiene el centroide de la estrella)."""
    cv2 = _cv2()
    p = np.asarray(p, np.float32)
    if p.shape[0] < 3:
        return p, None
    L = np.nan_to_num(p.mean(0), nan=0.0)
    pos, amp, _, _, _ = _estrellas(L)
    _, _, sat = _saturados(p, 0.5)
    if sat.any() and len(pos):
        satd = cv2.dilate(sat.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
        yi = np.clip(np.round(pos[:, 0]).astype(int), 0, L.shape[0] - 1)
        xi = np.clip(np.round(pos[:, 1]).astype(int), 0, L.shape[1] - 1)
        libre = ~satd[yi, xi]
        pos, amp = pos[libre], amp[libre]
    dc = _desplaz_color(p, pos, amp)
    if not dc:
        return p, None
    q = p.copy()
    h, w = p.shape[1:]
    for k, clave in ((0, "R_menos_G_px"), (2, "B_menos_G_px")):
        dy, dx = dc[clave]
        if math.hypot(dy, dx) < minimo:
            continue
        Mx = np.float32([[1, 0, -dx], [0, 1, -dy]])
        q[k] = cv2.warpAffine(np.nan_to_num(p[k]), Mx, (w, h), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE)
    return np.clip(q, 0, None) if np.nanmin(p) >= 0 else q, dc


def elegir_estrellas(p, n=8, excluir=None, lado=40):
    """Posiciones (y, x) de n estrellas brillantes no saturadas y aisladas, lejos de 'excluir' (x, y, r), repartidas por
    el campo, y una caja de cielo sin estrellas para el ruido."""
    L = np.nan_to_num(p.mean(0) if p.shape[0] > 1 else p[0], nan=0.0)
    pos, amp, _, _, _ = _estrellas(L, max_n=1500)
    h, w = L.shape
    elegidas = []
    for k in np.argsort(amp)[::-1]:
        y, x = pos[k]
        if y < lado or x < lado or y > h - lado or x > w - lado:
            continue
        if excluir is not None and math.hypot(x - excluir[0], y - excluir[1]) < excluir[2]:
            continue
        if any(math.hypot(y - a, x - b) < 0.12 * min(h, w) for a, b in elegidas):
            continue
        elegidas.append((float(y), float(x)))
        if len(elegidas) >= n:
            break
    # cielo: la caja de 120 px con menos picos y fondo mediano, lejos de la coma
    mejor, cielo = None, None
    for yc in range(200, h - 200, 300):
        for xc in range(200, w - 200, 300):
            if excluir is not None and math.hypot(xc - excluir[0], yc - excluir[1]) < excluir[2] * 1.5:
                continue
            c = ((pos[:, 0] > yc - 60) & (pos[:, 0] < yc + 60) & (pos[:, 1] > xc - 60) & (pos[:, 1] < xc + 60)).sum()
            if mejor is None or c < mejor:
                mejor, cielo = c, (yc, xc)
    return elegidas, cielo


def recortes(capas, nombres, estrellas, cielo, ruta, lado=40, zoom=4, ref=0):
    """Mosaico: una fila por capa con las mismas estrellas (2·lado px, al 100 % ampliado ×zoom, vecino más próximo) y
    un trozo de cielo (120 px, ×2). Estirado común asinh con el negro y el blanco de la capa 'ref'."""
    cv2 = _cv2()
    p0 = np.nan_to_num(np.asarray(capas[ref], np.float32))
    L0 = p0.mean(0)
    negro = float(np.median(L0[::8, ::8]))
    blanco = float(np.percentile(np.concatenate([p0[:, int(y) - lado:int(y) + lado, int(x) - lado:int(x) + lado].ravel()
                                                 for y, x in estrellas]), 99.7)) if estrellas else float(L0.max())
    escala = 25.0

    def est(c):
        c = np.nan_to_num(c)
        z = np.arcsinh(np.clip((c - negro) / max(blanco - negro, 1e-9), 0, None) * escala) / math.asinh(escala)
        im = (np.clip(np.moveaxis(z, 0, -1), 0, 1) * 255).astype(np.uint8)
        return im[:, :, ::-1] if im.shape[2] == 3 else np.repeat(im, 3, 2)

    celda = 2 * lado * zoom
    filas = []
    for p, nom in zip(capas, nombres):
        p = np.asarray(p, np.float32)
        trozos = []
        for y, x in estrellas:
            y, x = int(round(y)), int(round(x))
            trozos.append(cv2.resize(est(p[:, y - lado:y + lado, x - lado:x + lado]), (celda, celda), interpolation=cv2.INTER_NEAREST))
        if cielo is not None:
            yc, xc = cielo
            c = p[:, yc - 60:yc + 60, xc - 60:xc + 60]
            # el cielo con su propio estirado fuerte (mismo para todas las capas) para ver el grano
            m = float(np.median(np.nan_to_num(np.asarray(capas[ref])[:, yc - 60:yc + 60, xc - 60:xc + 60])))
            sd = float(np.std(np.nan_to_num(np.asarray(capas[ref])[:, yc - 60:yc + 60, xc - 60:xc + 60]))) or 1e-6
            z = np.clip((np.nan_to_num(c) - (m - 3 * sd)) / (6 * sd), 0, 1)
            im = (np.moveaxis(z, 0, -1) * 255).astype(np.uint8)[:, :, ::-1]
            trozos.append(cv2.resize(im, (celda, celda), interpolation=cv2.INTER_NEAREST))
        fila = np.concatenate([np.pad(t, ((0, 0), (0, 6), (0, 0)), constant_values=24) for t in trozos], 1)
        cab = np.full((34, fila.shape[1], 3), 24, np.uint8)
        cv2.putText(cab, nom, (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (235, 235, 235), 1, cv2.LINE_AA)
        filas.append(np.concatenate([cab, fila], 0))
    img = np.concatenate([np.pad(f, ((0, 6), (0, 0), (0, 0)), constant_values=24) for f in filas], 0)
    cv2.imwrite(str(ruta), img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return str(ruta)
