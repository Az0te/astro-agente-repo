# Limpieza de las tomas de un cometa antes de apilar (SirilAstroPilot y SetiAstroPilot: el mismo fichero en
# siril/herramientas y sas/herramientas). Copyright (c) 2026 Rafael Vidal. Licencia MIT.
# https://github.com/Az0te/astro-agente-repo
#
# Lemmon, 27-nov-2026 (33 CR3 de una Canon, sin flats). Rafael veía en el final, con el estirado de pantalla de SASpro:
#   - bandas horizontales en el cielo: el patrón de filas de la réflex, que ya está en el apilado;
#   - una mancha oscura redonda (~60 px, 2,4 % bajo el cielo): una mota de polvo del sensor, que sin flats no se corrige
#     y que en el apilado del cometa sale corrida en la dirección del movimiento;
#   - bordes oscuros: viñeteo y menos tomas en el borde (el cometa se mueve 110 × 43 px en la serie).
# Aquí:
#   quitar_bandas(p)        → resta a cada fila (y columna) de cada canal su desvío de la mediana, solo a escala fina
#                             (las bandas); lo grande (gradiente, cola) no cambia
#   detectar_motas(L, …)    → mapa de atenuación (1 = nada) de las motas oscuras, pequeñas y redondas del apilado de
#                             estrellas; dividir por él es un flat local
#   rect_cobertura(masks)   → el rectángulo mayor que tiene datos en todas las tomas (estrellas y cometa)
#   desfase_campo(pc, pe, libre) → cielo del cometa − cielo de las estrellas, suave (~200 px), para la unión por máscara
# Solo numpy y OpenCV (la venv de Siril no trae scipy).

import math

import numpy as np


def _cv2():
    import cv2
    return cv2


def _mad(x):
    x = x[np.isfinite(x)]
    if x.size == 0:
        return 0.0, 0.0
    m = float(np.median(x))
    return m, 1.4826 * float(np.median(np.abs(x - m)))


def _perfil(a, eje, mascara):
    """Mediana de a por filas (eje 1) o columnas (eje 0), sin los píxeles de la máscara (estrellas, cometa)."""
    b = np.where(mascara, np.nan, a)
    with np.errstate(all="ignore"):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            return np.nanmedian(b, axis=eje)


def _paso_alto(v, sigma):
    cv2 = _cv2()
    v = np.asarray(v, np.float64)
    ok = np.isfinite(v)
    if ok.sum() < 8:
        return np.zeros_like(v)
    v = np.where(ok, v, np.interp(np.arange(v.size), np.flatnonzero(ok), v[ok]))
    s = cv2.GaussianBlur(v.reshape(-1, 1), (1, 0), sigmaX=0.1, sigmaY=sigma, borderType=cv2.BORDER_REFLECT).ravel()
    return v - s


def quitar_bandas(p, sigma=40.0, columnas=True):
    """p (c, h, w) lineal. Por canal: perfil de filas (y columnas) con la mediana del cielo (sin lo que pasa de 3 σ),
    menos su versión suavizada (sigma filas): eso son las bandas, y se restan. Devuelve (p limpia, info)."""
    p = np.asarray(p, np.float32)
    c, h, w = p.shape
    out = p.copy()
    info = {"filas_rms": [], "columnas_rms": []}
    paso = 2 if w > 2000 else 1
    for k in range(c):
        a = out[k]
        m, s = _mad(a[::8, ::8])
        alto = ~np.isfinite(a) | (a > m + 3 * s)
        f = _paso_alto(_perfil(a[:, ::paso], 1, alto[:, ::paso]), sigma)
        a -= f[:, None].astype(np.float32)
        info["filas_rms"].append(float(np.std(f)))
        if columnas:
            g = _paso_alto(_perfil(a[::paso, :], 0, alto[::paso, :]), sigma)
            a -= g[None, :].astype(np.float32)
            info["columnas_rms"].append(float(np.std(g)))
        out[k] = a
    return out, info


def _mediana_bloques(L, S):
    h, w = L.shape
    hh, ww = h // S, w // S
    b = L[:hh * S, :ww * S].reshape(hh, S, ww, S).transpose(0, 2, 1, 3).reshape(hh, ww, S * S)
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmedian(b, axis=2).astype(np.float32)


def _desenfoque(x, peso, sigma):
    cv2 = _cv2()
    num = cv2.GaussianBlur((np.nan_to_num(x) * peso).astype(np.float32), (0, 0), sigma, borderType=cv2.BORDER_REFLECT)
    den = cv2.GaussianBlur(peso.astype(np.float32), (0, 0), sigma, borderType=cv2.BORDER_REFLECT)
    return num / np.maximum(den, 1e-6)


def detectar_motas(L, excluir=None, S=8, diam=(36, 320), sigma_min=5.5, prof_min=0.008, borde=0.08):
    """Motas oscuras del apilado de estrellas L (h, w), lineal. Fondo por bloques de S px (mediana, sin estrellas),
    fondo grande (σ ≈ 200 px) sin las motas, y las zonas redondas que quedan por debajo más de sigma_min σ y de
    prof_min (fracción). excluir: (x, y, r) del cometa (la cola y la coma dejan huecos «oscuros» a su lado).
    Devuelve (A, lista) con A (h, w) la atenuación (≤ 1, 1 fuera de las motas) o (None, []) si no hay."""
    cv2 = _cv2()
    L = np.asarray(L, np.float32)
    h, w = L.shape
    B = _mediana_bloques(L, S)
    bh, bw = B.shape
    B = cv2.medianBlur(np.ascontiguousarray(B), 5)
    peso = np.isfinite(B).astype(np.float32)
    yy, xx = np.mgrid[0:bh, 0:bw]
    lejos = np.ones((bh, bw), bool)
    if excluir is not None:
        ex, ey, er = excluir
        lejos &= np.hypot(xx * S + S / 2 - ex, yy * S + S / 2 - ey) > er
    mb = int(round(borde * max(bh, bw)))
    lejos[:mb], lejos[-mb:], lejos[:, :mb], lejos[:, -mb:] = False, False, False, False
    sg = 200.0 / S
    G = _desenfoque(B, peso, sg)
    malas = np.zeros((bh, bw), bool)
    for _ in range(3):
        R = B / np.maximum(G, 1e-9) - 1.0
        _, s = _mad(R[lejos & ~malas])
        malas = R < -max(sigma_min * s, prof_min)
        G = _desenfoque(B, peso * (~cv2.dilate(malas.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)), sg)
    R = B / np.maximum(G, 1e-9) - 1.0
    _, s = _mad(R[lejos])
    cand = (R < -max(sigma_min * s, prof_min)) & lejos
    n, lab, st, cen = cv2.connectedComponentsWithStats(cand.astype(np.uint8), 8)
    A_b = np.zeros((bh, bw), np.float32)
    motas = []
    amin = math.pi * (diam[0] / S / 2) ** 2 * 0.5
    amax = math.pi * (diam[1] / S / 2) ** 2
    for i in range(1, n):
        x0, y0, ww_, hh_, area = st[i]
        if area < amin or area > amax:
            continue
        if area / float(ww_ * hh_) < 0.45 or max(ww_, hh_) > 2.2 * min(ww_, hh_):
            continue                                        # alargada: borde de la cola o de un gradiente, no mota
        comp = lab == i
        anillo = cv2.dilate(comp.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool) & \
            ~cv2.dilate(comp.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
        ra = R[anillo & np.isfinite(R)]
        if ra.size and np.median(ra) > 2 * s:
            continue                                        # rodeada de señal (hueco junto a la cola)
        prof = float(-np.min(R[comp]))
        d = 2 * math.sqrt(area / math.pi) * S
        # una mota es un hueco con el cielo más claro EN TODAS las direcciones; una esquina con viñeteo o un arco de
        # luz difusa deja el «hueco» abierto hacia un lado (Lemmon: dos falsas motas simétricas en las esquinas de
        # abajo, que al «corregirlas» dejaron un parche claro de +25 %)
        rb = d / S / 2
        bx, by = cen[i]
        rr = np.hypot(xx - bx, yy - by)
        ang = np.degrees(np.arctan2(yy - by, xx - bx)) % 360
        c = np.nanmedian(B[rr < 0.6 * rb])
        anillo2 = (rr > 1.6 * rb) & (rr < 2.6 * rb)
        sect = []
        for a0 in range(0, 360, 45):
            v = B[anillo2 & (ang >= a0) & (ang < a0 + 45)]
            v = v[np.isfinite(v)]
            sect.append(float(np.median(v)) / max(float(c), 1e-9) - 1.0 if v.size else -1.0)
        if min(sect) < 0.3 * prof:
            continue                                        # abierta hacia un lado: gradiente o viñeteo, no mota
        d = 2 * math.sqrt(area / math.pi) * S
        motas.append({"x": round(float(cen[i][0] * S + S / 2), 1), "y": round(float(cen[i][1] * S + S / 2), 1),
                      "diametro_px": round(d, 1), "profundidad_pct": round(100 * prof, 2),
                      "sigmas": round(prof / max(s, 1e-9), 1)})
        zona = cv2.dilate(comp.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
        A_b[zona] = np.minimum(A_b[zona], R[zona])
    if not motas:
        return None, []
    # atenuación suave: R dentro de las motas (≤ 0), suavizada y llevada a 0 en el borde de la zona
    A_b = cv2.GaussianBlur(np.minimum(A_b, 0), (0, 0), 1.0)
    A = cv2.resize(A_b, (w, h), interpolation=cv2.INTER_CUBIC)
    A = np.clip(1.0 + np.minimum(A, 0), 0.5, 1.0).astype(np.float32)
    return A, motas


def validos_toma(a, S=4):
    """Máscara (h/S, w/S) de dónde la toma alineada tiene datos (no NaN), a escala 1/S."""
    a = np.asarray(a)
    v = np.isfinite(a[0, ::S, ::S]) if a.ndim == 3 else np.isfinite(a[::S, ::S])
    return v


def desplazar_mascara(m, dx, dy, S=4):
    """Máscara de datos desplazada (dx, dy) px a escala completa (salida(x, y) = entrada(x − dx, y − dy))."""
    cv2 = _cv2()
    Mx = np.array([[1, 0, dx / S], [0, 1, dy / S]], np.float64)
    r = cv2.warpAffine(m.astype(np.uint8), Mx, (m.shape[1], m.shape[0]), flags=cv2.INTER_NEAREST,
                       borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return r.astype(bool)


def rect_cobertura(m, S=4, margen=16):
    """Mayor rectángulo (aprox.) dentro de la máscara m (True = datos en todas las tomas), a escala 1/S: se encoge el
    lado con más huecos hasta que no queda ninguno. Devuelve (x0, y0, x1, y1) a escala completa, con 'margen' px."""
    m = np.asarray(m, bool)
    hh, ww = m.shape
    y0, y1, x0, x1 = 0, hh, 0, ww
    while y1 - y0 > 8 and x1 - x0 > 8:
        sub = ~m[y0:y1, x0:x1]
        if not sub.any():
            break
        lados = {"arr": sub[0].mean(), "aba": sub[-1].mean(), "izq": sub[:, 0].mean(), "der": sub[:, -1].mean()}
        lado = max(lados, key=lados.get)
        if lados[lado] == 0:
            # huecos solo en el interior: no se recorta por ellos
            break
        if lado == "arr":
            y0 += 1
        elif lado == "aba":
            y1 -= 1
        elif lado == "izq":
            x0 += 1
        else:
            x1 -= 1
    return (x0 * S + margen, y0 * S + margen, x1 * S - margen, y1 * S - margen)


def desfase_campo(pc, pe, libre, S=8, sigma_px=200.0):
    """(c, h, w): cometa − estrellas en el cielo libre, por bloques de S px (mediana), suavizado con sigma_px y rellenado
    donde no hay cielo libre (bajo la máscara del cometa) con la media ponderada de alrededor; sin el desfase medio
    (eso va aparte). Devuelve (D, [p1, p99] de D)."""
    cv2 = _cv2()
    c, h, w = pc.shape
    hh, ww = h // S, w // S
    lb = libre[:hh * S, :ww * S].reshape(hh, S, ww, S).mean(axis=(1, 3)) > 0.5
    D = np.empty((c, h, w), np.float32)
    sg = sigma_px / S
    for k in range(c):
        dif = (pc[k] - pe[k])[:hh * S, :ww * S].reshape(hh, S, ww, S).transpose(0, 2, 1, 3).reshape(hh, ww, S * S)
        db = np.median(dif, axis=2).astype(np.float32)
        wgt = lb.astype(np.float32)
        num = cv2.GaussianBlur(db * wgt, (0, 0), sg, borderType=cv2.BORDER_REFLECT)
        den = cv2.GaussianBlur(wgt, (0, 0), sg, borderType=cv2.BORDER_REFLECT)
        sm = num / np.maximum(den, 1e-6)
        # bajo máscaras anchas el peso cae: se completa con un suavizado mayor
        num2 = cv2.GaussianBlur(db * wgt, (0, 0), 3 * sg, borderType=cv2.BORDER_REFLECT)
        den2 = cv2.GaussianBlur(wgt, (0, 0), 3 * sg, borderType=cv2.BORDER_REFLECT)
        a = np.clip(den / 0.3, 0, 1)
        sm = a * sm + (1 - a) * num2 / np.maximum(den2, 1e-6)
        sm -= float(np.median(db[lb])) if lb.any() else 0.0
        D[k] = cv2.resize(sm, (w, h), interpolation=cv2.INTER_CUBIC)
    sub = D[:, ::16, ::16]
    return D, [round(float(np.percentile(sub, 1)), 6), round(float(np.percentile(sub, 99)), 6)]
