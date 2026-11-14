"""Polinomio fuera del halo + crominancia, y diagnóstico de manchas (numpy, sin dependencias).

Para objetos grandes y difusos (galaxia grande, nebulosa extensa) la máscara del objeto se queda corta: el halo exterior
entra como «cielo», el polinomio se curva para seguirlo y deja manchas de color alrededor. Además lo que queda suele ser
una mancha de escala media casi en un solo canal (p. ej. un hueco en B), que no es señal: la señal real sólo suma luz.
  1. elipse del objeto (momentos del mayor trozo con señal de la máscara), agrandada ×1,1; las compañeras también;
     polinomio de grado 2 por canal ajustado SÓLO fuera de eso y restado en todo el campo;
  2. crominancia: medianas de R−G y B−G en cajas de cielo (≥ 60 % fuera de la elipse, rechazo de estrellas), superficie
     thin-plate suavizada con rechazo de cajas a 2,5σ, restada de R y B. La luminancia sólo recibe el polinomio.
Bajo el objeto la corrección es interpolada. Imagen: float32 (canales, alto, ancho), fila 0 arriba, 0–1.
(14 nov 2026; mismo método que la guía describe en lineal/09, escrito aparte para Siril y SASpro.)
"""
from collections import deque

import numpy as np

BIN = 8


def _binar_mediana(x, b=BIN):
    h, w = x.shape[0] // b * b, x.shape[1] // b * b
    return np.median(x[:h, :w].reshape(h // b, b, w // b, b).transpose(0, 2, 1, 3).reshape(h // b, w // b, -1), axis=2)


def _mad(v):
    m = np.median(v)
    return float(m), 1.4826 * float(np.median(np.abs(v - m)))


def _caja(a, r):
    """Media en caja (2r+1) con bordes recortados, separable (sumas acumuladas)."""
    def eje(x, ax):
        x = np.moveaxis(x, ax, 0)
        c = np.cumsum(np.pad(x, [(1, 0)] + [(0, 0)] * (x.ndim - 1)), axis=0)
        n = x.shape[0]
        i = np.arange(n)
        lo, hi = np.clip(i - r, 0, n), np.clip(i + r + 1, 0, n)
        s = (c[hi] - c[lo]) / (hi - lo).reshape((-1,) + (1,) * (x.ndim - 1))
        return np.moveaxis(s, 0, ax)
    return eje(eje(a.astype(np.float64), 0), 1)


def _suave(a, r, n=3):
    for _ in range(n):
        a = _caja(a, r)
    return a


def _poli2_terminos(X, Y):
    return np.stack([np.ones_like(X), X, Y, X * X, X * Y, Y * Y], -1)


def _rejilla_poli(a, excl, gx=32, gy=22, grado=2):
    """Coeficientes de un polinomio robusto (medianas de celdas con > 50 % libres, rechazo 2,5σ). X, Y en [−0,5, 0,5]."""
    h, w = a.shape
    pts = []
    for j in range(gy):
        y0, y1 = j * h // gy, (j + 1) * h // gy
        for i in range(gx):
            x0, x1 = i * w // gx, (i + 1) * w // gx
            libre = ~excl[y0:y1, x0:x1]
            v = a[y0:y1, x0:x1][libre & (a[y0:y1, x0:x1] > 0)]
            if v.size > 0.5 * (x1 - x0) * (y1 - y0):
                pts.append(((x0 + x1) / 2 / w - 0.5, (y0 + y1) / 2 / h - 0.5, float(np.median(v))))
    nt = 6 if grado >= 2 else 3
    if len(pts) < nt + 2:
        raise RuntimeError(f"no quedan celdas de cielo fuera del objeto ({len(pts)} de {gx * gy})")
    P = np.array(pts)
    A = _poli2_terminos(P[:, 0], P[:, 1])[:, :nt]
    ok = np.ones(len(P), bool)
    c = np.zeros(nt)
    for _ in range(6):
        c = np.linalg.lstsq(A[ok], P[ok, 2], rcond=None)[0]
        res = P[:, 2] - A @ c
        _, sd = _mad(res[ok])
        nuevo = np.abs(res) <= 2.5 * sd if sd > 0 else ok
        if (nuevo == ok).all():
            break
        ok = nuevo
    return c


def _eval_poli(c, h, w):
    X = (np.arange(w) + 0.5) / w - 0.5
    Y = (np.arange(h) + 0.5) / h - 0.5
    XX, YY = np.meshgrid(X, Y)
    return (_poli2_terminos(XX, YY)[..., :len(c)] @ c).astype(np.float32)


def _trozos(m):
    """Trozos conexos (8 vecinos) de una máscara: lista de dicts con momentos, ordenada de mayor a menor."""
    h, w = m.shape
    lab = np.zeros(m.shape, np.int32)
    out = []
    ys, xs = np.nonzero(m)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]:
            continue
        k = len(out) + 1
        lab[y0, x0] = k
        q = deque([(y0, x0)])
        px = []
        while q:
            y, x = q.pop()
            px.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and m[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = k
                        q.append((yy, xx))
        p = np.array(px)
        out.append({"n": len(p), "y": p[:, 0], "x": p[:, 1],
                    "borde": bool((p[:, 0] == 0).any() or (p[:, 1] == 0).any() or (p[:, 0] == h - 1).any() or (p[:, 1] == w - 1).any())})
    out.sort(key=lambda t: -t["n"])
    return out


def _elipse(t):
    cx, cy = t["x"].mean(), t["y"].mean()
    vxx, vyy = ((t["x"] - cx) ** 2).mean(), ((t["y"] - cy) ** 2).mean()
    vxy = ((t["x"] - cx) * (t["y"] - cy)).mean()
    tr, d = (vxx + vyy) / 2, np.sqrt(max(0.0, (vxx - vyy) ** 2 / 4 + vxy ** 2))
    return {"cx": cx, "cy": cy, "a": 2 * np.sqrt(tr + d), "b": 2 * np.sqrt(max(1e-6, tr - d)),
            "ang": 0.5 * np.arctan2(2 * vxy, vxx - vyy)}


def preparar(p, b=BIN):
    """Canales binados por mediana, máscara del objeto (lo que sobresale del fondo liso) y estrellas."""
    ch = np.stack([_binar_mediana(p[c], b) for c in range(3)]).astype(np.float64)
    L = ch.mean(0)
    h, w = L.shape
    excl = np.zeros(L.shape, bool)
    for _ in range(3):        # fondo liso de grado 2 sin el objeto; objeto = lo que sobresale > 3σ (suavizado)
        c = _rejilla_poli(L, excl)
        R = L - _eval_poli(c, h, w)
        Rl = _suave(R, 3)
        med, sd = _mad(Rl[~excl][::3])
        obj = Rl - med > 3 * sd
        excl = _suave(obj.astype(float), max(4, round(min(h, w) / 40)), 2) > 0.01
    # estrellas: lo que sobresale > 4σ del entorno a escala fina
    hf = L - _suave(L, 3, 2)
    _, s = _mad(hf[::3, ::3].ravel())
    estrellas = _suave((hf > 4 * s).astype(float), 3, 2) > 0.02
    tz = _trozos(obj)
    tz = [t for t in tz if R[t["y"], t["x"]].sum() > 0]
    minimo = max(30, 0.002 * h * w)
    trozos = tz[:1] + [t for t in tz[1:] if not t["borde"] and t["n"] >= minimo][:5]
    return {"ch": ch, "bin": b, "w": w, "h": h, "obj": obj, "R": R, "estrellas": estrellas, "trozos": trozos}


def _no_cielo(base, k, elipse=None, circulos=()):
    h, w, b = base["h"], base["w"], base["bin"]
    out = np.zeros((h, w), bool)
    els = []
    if elipse:
        a0 = elipse["a"] / b
        els.append({"cx": elipse["x"] / b, "cy": elipse["y"] / b, "a": a0 * k / 2, "b": a0 * elipse.get("q", 1) * k / 2,
                    "ang": np.radians(elipse.get("angulo", 0))})
    for j, t in enumerate(base["trozos"]):
        if j == 0 and elipse:
            continue
        e = _elipse(t)
        els.append({**e, "a": e["a"] * k, "b": e["b"] * k})
    for c in circulos:
        els.append({"cx": c["x"] / b, "cy": c["y"] / b, "a": c["r"] / b, "b": c["r"] / b, "ang": 0.0})
    YY, XX = np.mgrid[0:h, 0:w]
    for e in els:
        dx, dy = XX - e["cx"], YY - e["cy"]
        u = dx * np.cos(e["ang"]) + dy * np.sin(e["ang"])
        v = -dx * np.sin(e["ang"]) + dy * np.cos(e["ang"])
        out |= (u / e["a"]) ** 2 + (v / e["b"]) ** 2 <= 1
    return out, els


def _med_rech(v):
    """Mediana con rechazo de lo que sobresale por arriba (estrellas): 4 vueltas a 2σ."""
    m = np.median(v)
    for _ in range(4):
        sd = 1.4826 * np.median(np.abs(v - m))
        u = v[v <= m + 2 * sd]
        if u.size == v.size or u.size < 5:
            break
        v, m = u, np.median(u)
    return float(m)


def _tps(P, z, lam):
    n = len(z)
    D2 = ((P[:, None, :] - P[None, :, :]) ** 2).sum(-1)
    with np.errstate(divide="ignore", invalid="ignore"):
        K = np.where(D2 > 0, 0.5 * D2 * np.log(D2), 0.0)
    A = np.zeros((n + 3, n + 3))
    A[:n, :n] = K + lam * np.eye(n)
    A[:n, n] = 1; A[:n, n + 1] = P[:, 0]; A[:n, n + 2] = P[:, 1]
    A[n, :n] = 1; A[n + 1, :n] = P[:, 0]; A[n + 2, :n] = P[:, 1]
    c = np.linalg.solve(A, np.concatenate([z, np.zeros(3)]))

    def f(Q):
        d2 = ((Q[:, None, :] - P[None, :, :]) ** 2).sum(-1)
        with np.errstate(divide="ignore", invalid="ignore"):
            k = np.where(d2 > 0, 0.5 * d2 * np.log(d2), 0.0)
        return k @ c[:n] + c[n] + Q[:, 0] * c[n + 1] + Q[:, 1] * c[n + 2]
    return f


def _tps_robusta(P, z, lam):
    keep = np.ones(len(z), bool)
    f = None
    for _ in range(3):
        if keep.sum() < 12:
            break
        f = _tps(P[keep], z[keep], lam)
        r = z - f(P)
        m, sd = _mad(r[keep])
        keep = np.abs(r - m) < 2.5 * sd if sd > 0 else keep
    return f, int(keep.sum())


def _ampliar(m, H, W):
    """Rejilla gruesa -> tamaño completo, bilineal con centros de píxel alineados."""
    hc, wc = m.shape
    ys = np.clip((np.arange(H) + 0.5) * hc / H - 0.5, 0, hc - 1)
    xs = np.clip((np.arange(W) + 0.5) * wc / W - 0.5, 0, wc - 1)
    y0 = np.floor(ys).astype(int); x0 = np.floor(xs).astype(int)
    y1 = np.minimum(y0 + 1, hc - 1); x1 = np.minimum(x0 + 1, wc - 1)
    fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
    top = m[y0][:, x0] * (1 - fx) + m[y0][:, x1] * fx
    bot = m[y1][:, x0] * (1 - fx) + m[y1][:, x1] * fx
    return (top * (1 - fy) + bot * fy).astype(np.float32)


def calcular(p, escala=1.1, elipse=None, circulos=(), cajas=21, suavizado=0.005, croma=True, base=None):
    """Devuelve (poly, poly+croma o None, info). p: (3, alto, ancho) float32 0–1."""
    if p.shape[0] < 3:
        raise RuntimeError("hace falta una imagen en color")
    base = base or preparar(p)
    if not base["trozos"] and not elipse:
        raise RuntimeError("no hay máscara del objeto")
    ch, h, w, b = base["ch"], base["h"], base["w"], base["bin"]
    lado = max(4, round(min(w, h) / cajas))
    nx, ny = w // lado, h // lado
    sel = None
    for k in [escala] + [e for e in (1.0,) if e < escala]:
        nc, els = _no_cielo(base, k, elipse, circulos)
        celdas = sum(1 for j in range(22) for i in range(32)
                     if (~nc[j * h // 22:(j + 1) * h // 22, i * w // 32:(i + 1) * w // 32]).mean() > 0.5)
        cj = []
        for by in range(ny):
            for bx in range(nx):
                sl = (slice(by * lado, (by + 1) * lado), slice(bx * lado, (bx + 1) * lado))
                libre = ~nc[sl]
                ok = libre & ~base["estrellas"][sl]
                if libre.mean() >= 0.6 and ok.mean() >= 0.25:
                    cj.append(((bx + 0.5) * lado, (by + 0.5) * lado, *[_med_rech(ch[c][sl][ok]) for c in range(3)]))
        sel = (k, nc, els, celdas, cj)
        if celdas >= 40 and len(cj) >= 30:
            break
    k, nc, els, celdas, cj = sel
    if celdas < 12:
        raise RuntimeError(f"no queda cielo fuera del halo del objeto ({celdas} celdas)")
    H, W = p.shape[1:]
    coefs = [_rejilla_poli(ch[c], nc) for c in range(3)]
    poly = np.stack([p[c] - _eval_poli(coefs[c], H, W) + np.float32(coefs[c][0]) for c in range(3)]).astype(np.float32)
    e0 = els[0] if els else None
    info = {"escala": k, "celdas_cielo": celdas, "cajas": len(cj),
            "elipse": None if e0 is None else {"centro_px": [round(e0["cx"] * b), round(e0["cy"] * b)],
                                               "semiejes_px": [round(e0["a"] * b), round(e0["b"] * b)],
                                               "angulo": round(float(np.degrees(e0["ang"])))}}
    if not croma or len(cj) < 15:
        if croma:
            info["aviso"] = f"pocas cajas de cielo ({len(cj)}): sin crominancia"
        return poly, None, info
    C = np.array(cj)
    X, Y = C[:, 0], C[:, 1]
    pol = [(_poli2_terminos(X / w - 0.5, Y / h - 0.5) @ coefs[c]) for c in range(3)]
    zR = (C[:, 2] - pol[0]) - (C[:, 3] - pol[1])
    zB = (C[:, 4] - pol[2]) - (C[:, 3] - pol[1])
    esc = 1.5 / max(w, h)
    P = np.stack([X, Y], -1) * esc
    fR, uR = _tps_robusta(P, zR, suavizado)
    fB, uB = _tps_robusta(P, zB, suavizado)
    if fR is None or fB is None:
        info["aviso"] = "no se pudo ajustar la crominancia"
        return poly, None, info
    wc, hc = max(8, round(w / 4)), max(8, round(h / 4))
    gx, gy = np.meshgrid((np.arange(wc) + 0.5) * w / wc, (np.arange(hc) + 0.5) * h / hc)
    Q = np.stack([gx.ravel(), gy.ravel()], -1) * esc
    MR = fR(Q).reshape(hc, wc); MB = fB(Q).reshape(hc, wc)
    MR -= np.median(MR); MB -= np.median(MB)
    out = poly.copy()
    out[0] -= _ampliar(MR, H, W)
    out[2] -= _ampliar(MB, H, W)
    info["cajas_usadas"] = min(uR, uB)
    return poly, out, info


def diagnosticar(p, escala=1.1, umbral=0.1, zonas=4, elipse=None, circulos=(), base=None):
    """Para las zonas peores del cielo: R, G, B en % del cielo de cada canal, tipo y veredicto."""
    base = base or preparar(p)
    ch, h, w, b = base["ch"], base["h"], base["w"], base["bin"]
    nc, els = _no_cielo(base, escala, elipse, circulos)
    sobre = base["obj"] & (_suave(base["R"], 3) > 0)
    sob = _suave(sobre.astype(float), max(4, round(min(w, h) / 40)), 2) > 0.01
    cielo = ~nc & ~base["estrellas"] & ~sob
    r = max(3, round(min(w, h) / 30))
    S = []
    for c in range(3):
        num = _suave(np.where(cielo, ch[c], 0.0), r)
        den = _suave(cielo.astype(float), r)
        Sc = np.where(den > 0.02, num / np.maximum(den, 1e-9), np.nan)
        lv = float(np.nanmedian(Sc[cielo]))
        S.append(100 * (Sc - lv) / abs(lv or 1e-12))
    lado = max(4, round(min(w, h) / 8))
    el = els[0] if els else None
    cx0, cy0 = (el["cx"], el["cy"]) if el else (w / 2, h / 2)

    def valor(cx, cy):
        x0, y0 = max(0, round(cx - lado / 2)), max(0, round(cy - lado / 2))
        sl = (slice(y0, min(h, y0 + lado), 2), slice(x0, min(w, x0 + lado), 2))
        m = cielo[sl] & np.isfinite(S[0][sl])
        if m.sum() < 0.15 * lado * lado / 4:
            return None
        return [float(np.median(S[q][sl][m])) for q in range(3)]

    celdas = []
    for y in range(h // lado):
        for x in range(w // lado):
            px, py = (x + 0.5) * lado, (y + 0.5) * lado
            v = valor(px, py)
            if v:
                celdas.append((max(abs(q) for q in v), px, py, v))
    celdas.sort(key=lambda t: -t[0])
    nomY = ["arriba", "centro-arriba", "centro-abajo", "abajo"]
    nomX = ["izquierda", "centro-izquierda", "centro", "centro-derecha", "derecha"]
    nom = "RGB"
    res, usados = [], []
    for m, px, py, v in celdas:
        if len(res) >= zonas or m < umbral:
            break
        if any(abs(ux - px) <= lado and abs(uy - py) <= lado for ux, uy in usados):
            continue
        usados.append((px, py))
        orden = sorted(range(3), key=lambda q: -abs(v[q]))
        d = orden[0]
        un_canal = abs(v[orden[1]]) < 0.5 * abs(v[d])
        mismo = all(q * v[d] > 0 for q in v)
        re = sim = None
        if el:
            dx, dy = px - el["cx"], py - el["cy"]
            u = dx * np.cos(el["ang"]) + dy * np.sin(el["ang"])
            vv = -dx * np.sin(el["ang"]) + dy * np.cos(el["ang"])
            re = float(np.sqrt((u / el["a"]) ** 2 + (vv / el["b"]) ** 2) * escala)
            sv = valor(2 * cx0 - px, 2 * cy0 - py)
            if sv:
                sim = bool(sv[d] * v[d] > 0 and abs(sv[d]) > 0.4 * abs(v[d]))
        if v[d] < 0:
            tipo = "hueco"
            ver = ("Más oscuro que el cielo" + (f" y casi sólo en {nom[d]}" if un_canal else "") +
                   ": no es señal (la señal real sólo suma luz). Artefacto del fondo o de los planos; se puede corregir.")
        elif un_canal:
            tipo = "exceso en un canal"
            ver = (f"Exceso casi sólo en {nom[d]}: casi seguro un artefacto (luz parásita, planos), no un halo, que saldría "
                   "en los tres canales. Se puede corregir (crominancia).")
        elif mismo and re is not None and re < 1.8 and sim:
            tipo = "halo probable"
            ver = ("Exceso en los tres canales, cerca del objeto y repetido al otro lado: probablemente halo real del "
                   "objeto. No quitarlo; agrandar la máscara del objeto.")
        else:
            tipo = "exceso sin forma de halo"
            ver = "Exceso en varios canales que no sigue al objeto: gradiente que queda, nube o polvo. Mirar el mapa antes de decidir."
        res.append({"zona": f"{nomY[min(3, int(py / h * 4))]} {nomX[min(4, int(px / w * 5))]}",
                    "centro_px": [round(px * b), round(py * b)],
                    "R_pct": round(v[0], 3), "G_pct": round(v[1], 3), "B_pct": round(v[2], 3),
                    "distancia_objeto": None if re is None else round(re, 2), "simetrica": sim, "tipo": tipo, "veredicto": ver})
    art = sum(1 for z in res if z["tipo"] in ("hueco", "exceso en un canal"))
    resumen = (f"No quedan manchas por encima de {umbral} % del cielo." if not res else
               f"{art} de {len(res)} zonas son artefactos de color (hueco o un solo canal): usar «polinomio fuera del halo + crominancia»."
               if art else "Las manchas que quedan parecen halo o gradiente: revisar la máscara del objeto y el mapa.")
    return {"zonas": res, "umbral_pct": umbral, "resumen": resumen,
            "nota": "Valores en % del cielo de cada canal (superficie lisa, sin objeto agrandado ni estrellas). "
                    "distancia_objeto: 1 = borde de la máscara del objeto agrandada."}


def preferir_por_diagnostico(diag, candidatos, recomendado, tope):
    """Si el diagnóstico de la recomendada ve artefactos de color (hueco o un solo canal) y hay un candidato
    «+ crominancia» que no se come el objeto (objeto_quitado ≤ tope, |copia_objeto| < 0,3), devuelve (id, motivo);
    si no, None. La crominancia quita justo esas manchas sin tocar la luminancia (14 nov 2026)."""
    zonas = (diag or {}).get("zonas") or []
    art = [z for z in zonas if z.get("tipo") in ("hueco", "exceso en un canal")]
    if not art:
        return None
    for x in candidatos:
        if x.get("id") == recomendado or "crominancia" not in str(x.get("metodo", "")).lower():
            continue
        m = x.get("metricas") or {}
        come = m.get("objeto_quitado_pct")
        if come is None or abs(come) > tope or abs(m.get("copia_objeto") or 0) >= 0.3:
            continue
        motivo = (f"{len(art)} de {len(zonas)} manchas que deja la recomendada por medidas son artefactos de color "
                  f"({', '.join(sorted(set(z['tipo'] for z in art)))}): se recomienda «{x['metodo']}», que las quita sin "
                  f"llevarse el objeto ({come} %, corr {m.get('copia_objeto')}).")
        return x["id"], motivo
    return None
