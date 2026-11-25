# SetiAstroPilot — medidas en numpy (criterios de la guía), sin depender de SASpro.
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# Copia de las funciones puras de siril/herramientas (herramientas.py y pasos.py): mismos umbrales y mismas
# métricas, para que SASpro, Siril y PixInsight se puedan comparar. Todas trabajan con arrays float32 0–1 de forma
# (canales, alto, ancho), fila 0 arriba. Si se corrige algo aquí, corregirlo también en Siril.

import hashlib
import math

import numpy as np

CANALES = ("R", "G", "B")


def _r(x, n=6):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return x
    if math.isnan(x) or math.isinf(x):
        return None
    return round(x, n)


def huella(a):
    """Huella rápida de un array para saber si la imagen ha cambiado desde una comparación."""
    a = np.asarray(a)
    v = np.ascontiguousarray(a.reshape(-1)[:: max(1, a.size // 200000)])
    return hashlib.sha1(v.tobytes()).hexdigest()[:16] + f"_{a.shape}_{a.dtype}"


def est(a):
    """Estadísticas de un canal (2D 0–1). MAD sin normalizar, como en la guía."""
    v = a.ravel()
    med = float(np.median(v))
    return {"mediana": _r(med), "mad": _r(np.median(np.abs(v - med))),
            "media": _r(v.mean()), "min": _r(v.min()), "max": _r(v.max())}


def lum(p):
    return p.mean(axis=0) if p.shape[0] > 1 else p[0]


def lineal(p):
    return float(np.median(lum(p))) < 0.05


def binar(x, b):
    h, w = x.shape[0] // b * b, x.shape[1] // b * b
    return x[:h, :w].reshape(h // b, b, w // b, b).mean(axis=(1, 3))


def mtf(m, x):
    """Función de tonos medios: lleva m a 0,5 (0 → 0, 1 → 1)."""
    return np.where(x <= 0, 0.0, np.where(x >= 1, 1.0, (m - 1) * x / ((2 * m - 1) * x - m)))


def autoestirar(q, objetivo=0.25, sombras=-2.8, enlazado=False):
    """Autoestirado (STF): punto negro a mediana − 2,8 MAD y tonos medios para llevar la mediana a 'objetivo'.
    Por canal salvo enlazado=True (mismos parámetros para los tres, conserva el color)."""
    q = np.asarray(q, dtype=np.float32)
    out = np.empty_like(q)

    def med_mad(x):
        x = x.ravel()
        m = float(np.median(x))
        s = 1.4826 * float(np.median(np.abs(x - m)))
        if s <= 1e-9:                      # imagen de solo estrellas: fondo a 0 -> se mide en los píxeles con señal
            pos = x[x > 1e-6]
            if pos.size > 100:
                m = float(np.median(pos))
                s = 1.4826 * float(np.median(np.abs(pos - m)))
                m = max(0.0, m - 2.8 * s) + 1e-6  # que el fondo quede en negro y las estrellas débiles se vean
        return m, s

    if enlazado:
        pp = [med_mad(q[c][::4, ::4]) for c in range(q.shape[0])]
        med, mad = float(np.mean([a for a, _ in pp])), float(np.mean([b for _, b in pp]))
        pares = [(med, mad)] * q.shape[0]
    else:
        pares = [med_mad(q[c][::4, ::4]) for c in range(q.shape[0])]
    for c, (med, mad) in enumerate(pares):
        c0 = min(max(0.0, med + sombras * mad), 0.99)
        y = np.clip((q[c] - c0) / (1 - c0), 0, 1)
        mn = (med - c0) / (1 - c0)
        out[c] = mtf(float(mtf(objetivo, np.float64(mn))) if mn > 0 else 0.5, y)
    return out


def zonas_vacias(L, mediana):
    """Ancho de las zonas sin datos (cuñas tras alinear) en cada lado: p95 y máximo por lado, y % del campo."""
    umbral = max(1e-6, 0.25 * mediana)
    datos = L > umbral

    def hasta_dato(m, eje):
        hay = m.any(axis=eje)
        n = np.argmax(m, axis=eje)[hay]
        return n if n.size else np.zeros(1, dtype=int)

    medidas = {"izquierda": hasta_dato(datos, 1), "derecha": hasta_dato(datos[:, ::-1], 1),
               "arriba": hasta_dato(datos, 0), "abajo": hasta_dato(datos[::-1, :], 0)}
    p95 = {lado: int(np.percentile(v, 95)) for lado, v in medidas.items()}
    maximo = {lado: int(v.max()) for lado, v in medidas.items()}
    return p95, maximo, _r(100.0 * float((~datos).mean()), 3)


def celdas(L, S=64):
    """Medianas de celdas S×S (submuestreadas a 1 de cada 2 píxeles)."""
    h, w = L.shape[0] // S * S, L.shape[1] // S * S
    c = L[:h:2, :w:2].reshape(h // S, S // 2, w // S, S // 2).transpose(0, 2, 1, 3).reshape(h // S, w // S, -1)
    return np.median(c, axis=2)


def cielo(p, S=64):
    """Criterios de la ficha de estirado: cielo, ruido relativo, percentiles y píxeles a 0 / > 0,95."""
    L = lum(p)
    m = celdas(L, S)
    ys, xs = np.nonzero(m > 1e-6)
    vals = m[ys, xs]
    if vals.size == 0:
        raise RuntimeError("La imagen no tiene datos (todo a 0).")
    orden = np.argsort(vals)
    k = max(min(5, len(vals)), int(len(vals) * 0.10))
    sel = orden[:k]
    c = float(np.median(vals[sel]))
    dif = []
    for j in sel:
        y0, x0 = ys[j] * S, xs[j] * S
        blk = L[y0:y0 + S, x0:x0 + S]
        dif.append(np.abs(blk[:, 1::2] - blk[:, 0:-1:2]).ravel())
    ruido = float(np.median(np.concatenate(dif))) / (0.6745 * np.sqrt(2)) if dif else 0.0
    pc = np.percentile(L.ravel()[::17], [50, 90, 99, 99.9])
    n = p.size
    return {
        "cielo": _r(c, 4), "ruido": _r(ruido, 6), "ruido_rel": _r(ruido / max(c, 1e-6), 3),
        "mediana": _r(pc[0], 4), "p90": _r(pc[1], 4), "p99": _r(pc[2], 4), "p999": _r(pc[3], 4),
        "cero_pct": _r(100.0 * float((p <= 0.0001).sum()) / n, 4),
        "alto_pct": _r(100.0 * float((p >= 0.95).sum()) / n, 4),
        "_celdas": (ys[sel], xs[sel], S),
    }


def cielo_por_canal(p, cel):
    ys, xs, S = cel
    r = []
    for c in range(p.shape[0]):
        v = np.concatenate([p[c, y * S:(y + 1) * S:2, x * S:(x + 1) * S:2].ravel() for y, x in zip(ys, xs)])
        r.append(float(np.median(v)))
    return r


def sin_privado(d):
    return {k: v for k, v in d.items() if not k.startswith("_")}


# --- Gradiente (ficha lineal 09) ----------------------------------------------------------------------------

def ajuste_poli(Z, mascara, grado=2):
    h, w = Z.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    xx, yy = xx / w - 0.5, yy / h - 0.5
    terminos = [np.ones_like(xx)]
    for g in range(1, grado + 1):
        for i in range(g + 1):
            terminos.append(xx ** (g - i) * yy ** i)
    A = np.stack([t[mascara] for t in terminos], axis=1)
    coef, *_ = np.linalg.lstsq(A, Z[mascara].astype(np.float64), rcond=None)
    return sum(c * t for c, t in zip(coef, terminos))


def rango_rejilla(Z, cie):
    h, w = Z.shape
    m = []
    for f in range(3):
        for c in range(4):
            sub = Z[f * h // 3:(f + 1) * h // 3, c * w // 4:(c + 1) * w // 4]
            mk = cie[f * h // 3:(f + 1) * h // 3, c * w // 4:(c + 1) * w // 4]
            if mk.sum() > 20:
                m.append(float(np.median(sub[mk])))
    return (max(m) - min(m)) if len(m) >= 2 else float("nan")


def amplitud_plano(Z, cie, valido):
    P = ajuste_poli(Z, cie, 1)[valido]
    return float(np.percentile(P, 98) - np.percentile(P, 2))


def preparar_gradiente(p, b=8):
    L = binar(lum(p), b)
    med = float(np.median(L))
    valido = L > max(1e-6, 0.25 * med)
    v = L[valido]
    m2 = float(np.median(v))
    sig = 1.4826 * float(np.median(np.abs(v - m2)))
    plano = ajuste_poli(L, valido & (L < m2 + 2 * sig), 1)
    res = L - plano
    s2 = 1.4826 * float(np.median(np.abs(res[valido] - np.median(res[valido]))))
    obj = valido & (res > 3 * s2)
    o = obj.copy()
    o[1:, :] |= obj[:-1, :]; o[:-1, :] |= obj[1:, :]; o[:, 1:] |= obj[:, :-1]; o[:, :-1] |= obj[:, 1:]
    k = max(1, 64 // b)
    hc, wc = res.shape[0] // k, res.shape[1] // k
    rc = res[:hc * k, :wc * k].reshape(hc, k, wc, k).transpose(0, 2, 1, 3).reshape(hc, wc, -1)
    vc = valido[:hc * k, :wc * k].reshape(hc, k, wc, k).all(axis=(1, 3))
    medc = np.median(rc, axis=2)
    cel = np.zeros_like(vc)
    if vc.sum() >= 8:
        cel = vc & (medc <= np.percentile(medc[vc], 25))
    oscuras = np.zeros_like(valido)
    oscuras[:hc * k, :wc * k] = np.repeat(np.repeat(cel, k, 0), k, 1)
    cie = oscuras & valido
    if cie.sum() < 50:
        cie = valido & ~o
    lleno = None
    if cel.any():
        q = medc[cel]
        s_q = 1.4826 * float(np.median(np.abs(q - np.median(q))))
        lleno = 100.0 * float((medc[vc] > float(np.max(q)) + 5 * max(s_q, 1e-9)).mean())
    O2 = ajuste_poli(L, cie, 2)
    return {"L": L, "valido": valido, "obj": o, "cielo": cie, "rango0": rango_rejilla(L, cie),
            "plano0": amplitud_plano(L, cie, valido),
            "objeto_campo_pct": lleno if lleno is not None else 100.0 * float(o.sum()) / max(int(valido.sum()), 1),
            "senal_obj": float((L - O2)[o].sum()), "O_hp": L - O2, "b": b}


def medir_gradiente(base, pc):
    """copia_objeto, objeto_quitado_pct, gradiente_restante, irregularidad_cielo, negativos_pct."""
    C = binar(lum(pc), base["b"])
    M = base["L"] - C
    v, cie, obj = base["valido"], base["cielo"], base["obj"]
    # Algunos programas reescalan toda la imagen al corregir (el ABE de SASpro normaliza a máximo 1: × 0,998). Ese
    # factor uniforme deja en M una copia α·L de toda la imagen, estrellas incluidas, y la correlación sale ≈ 1 aunque el
    # modelo sea un polinomio limpio. Se ajusta M = α·L + polinomio de grado 2 y se quita α·L antes de correlacionar.
    alfa = escala_uniforme(M, base["L"], v)
    Ms = M - alfa * base["L"]
    M2 = ajuste_poli(Ms, v, 2)
    m_hp = (Ms - M2)[v]
    o_hp = base["O_hp"][v]
    corr = float(np.corrcoef(m_hp, o_hp)[0, 1]) if m_hp.std() > 1e-12 and o_hp.std() > 1e-12 else 0.0
    exceso = M - ajuste_poli(M, cie, 2)
    come = 100.0 * float(exceso[obj].sum()) / base["senal_obj"] if base["senal_obj"] > 0 and obj.any() else float("nan")
    irreg = rango_rejilla(C, cie) / base["rango0"] if base["rango0"] and base["rango0"] > 0 else float("nan")
    resid = amplitud_plano(C, cie, v) / base["plano0"] if base["plano0"] > 0 else float("nan")
    # Estructura de escala grande que queda (dispersión de la imagen corregida sin su plano): un modelo que se come la
    # nebulosa extensa la baja. IC 1396 c8 (16 nov 2026): el polinomio 2 dejó el OIII un 23 % más plano que el 1 y el
    # estirado a mediana 0,20 lo amplificó más (más grano). Igual que _medir_gradiente de Siril.
    rc = C - ajuste_poli(C, v, 1)
    est = 1.4826 * float(np.median(np.abs(rc[v] - np.median(rc[v])))) if v.any() else float("nan")
    return {"copia_objeto": _r(corr, 3), "objeto_quitado_pct": _r(come, 1), "gradiente_restante": _r(resid, 3),
            "irregularidad_cielo": _r(irreg, 3), "negativos_pct": _r(100.0 * float((pc < 0).mean()), 3),
            "escala_pct": _r(100.0 * alfa, 2), "estructura_grande": _r(est, 8)}


def aplanado_gradiente(c, extenso, umbral=5.0):
    """Cuánto más aplana cada modelo la estructura grande que el polinomio 1 (aplanado_vs_p1_pct). En campos con objeto
    extenso, los que aplanan > 'umbral' % más no se recomiendan (se devuelven sus ids). Igual que en Siril."""
    import re as _re
    ref = next((x for x in c if _re.search(r"polinomio 1\b", str(x.get("metodo", ""))) and
                x["metricas"].get("estructura_grande")), None)
    fuera = []
    if ref is None:
        return fuera
    e0 = float(ref["metricas"]["estructura_grande"])
    for x in c:
        e = x["metricas"].get("estructura_grande")
        if e is None or e0 <= 0:
            continue
        ap = 100.0 * (1.0 - float(e) / e0)
        x["metricas"]["aplanado_vs_p1_pct"] = _r(ap, 1)
        if extenso and ap > umbral:
            fuera.append(x["id"])
            x.setdefault("no_cumple", []).append(f"aplana la estructura grande un {_r(ap, 1)} % más que el polinomio 1 "
                                                  f"(> {umbral:g} %): se lleva nebulosa extensa")
    return fuera


def escala_uniforme(M, L, valido):
    """Reescalado uniforme α que el programa aplica a toda la imagen, medido SOLO en las escalas de las estrellas
    (L − media en caja 5×5): un modelo de fondo, aunque se coma el halo del objeto, es liso a esa escala y no entra
    en α; un factor global sí, porque copia cada estrella. Se limita a |α| ≤ 5 %."""
    sl = (L - _caja(L, 2))[valido].astype(np.float64)
    sm = (M - _caja(M, 2))[valido].astype(np.float64)
    den = float((sl * sl).sum())
    return float(np.clip((sl * sm).sum() / den, -0.05, 0.05)) if den > 0 else 0.0


def tope_gradiente(objeto_campo_pct, tipo=None):
    """(extenso, tope): % del objeto que se tolera que se lleve el modelo (≤ 1 % en campos extensos, si no ≤ 3 %)."""
    import re
    extenso = objeto_campo_pct > 25 or bool(re.search(r"(?i)nebul|polvo|dust|ifn|oscur|extens|molecular", str(tipo or "")))
    return extenso, (1.0 if extenso else 3.0)


def elegir_gradiente(c, objeto_campo_pct, tipo=None):
    """Mismo criterio que Siril: se tolera que el modelo se lleve ≤ 3 % del objeto (≤ 1 % en campos extensos)."""

    def absc(x): return abs(x["metricas"]["copia_objeto"] or 0)
    def resid(x): v = x["metricas"]["gradiente_restante"]; return v if v is not None else 9
    def eat(x): v = x["metricas"]["objeto_quitado_pct"]; return abs(v) if v is not None else 100

    import re as _re
    extenso, tope = tope_gradiente(objeto_campo_pct, tipo)
    # El freno de aplanado es para nebulosas y polvo que llenan el campo (IC 1396). En una galaxia con cielo libre (M31,
    # 16 nov 2026) cualquier buena corrección «aplana» frente al polinomio 1 porque quita gradiente que el plano deja:
    # el freno sacaba a SRGC, al halo + crominancia y a las cadenas, y sólo quedaba el polinomio 1.
    galaxia = bool(_re.search(r"(?i)galax", str(tipo or "")))
    fuera = set(aplanado_gradiente(c, extenso and not galaxia))
    c = [x for x in c if x["id"] not in fuera] or c
    seguros = [x for x in c if eat(x) <= tope and absc(x) < 0.3]
    limpios = [x for x in c if absc(x) < 0.3]
    if seguros:
        r0 = min(resid(x) for x in seguros)
        margen = 0.15 if extenso else 0.05
        cerca = [x for x in seguros if resid(x) <= r0 + margen]
        # A «se lleva» parecido (≤ 0,5 puntos) gana el que deja menos gradiente: en M31 el polinomio 1 (0 %) ganaba por
        # el orden de la lista dejando el 22 % del gradiente frente al 8 % del de fuera del halo (14 nov 2026).
        e0 = min(eat(x) for x in cerca)
        # Lo que queda en el cielo: el plano (gradiente_restante) y también las manchas (irregularidad_cielo, rango en
        # rejilla 4×3). Con sólo el plano, en M31 el halo + crominancia (0,078 / 0,111) ganaba a su cadena con el modelo
        # del cielo con máscara (0,084 / 0,051), que deja el cielo la mitad de desnivelado y sin color (16 nov 2026).
        def queda(x):
            ir = x["metricas"].get("irregularidad_cielo")
            return max(resid(x), ir) if ir is not None and objeto_campo_pct <= 40 else resid(x)
        mejor = min([x for x in cerca if eat(x) <= e0 + 0.5], key=queda)
    else:
        mejor = min(limpios, key=eat) if limpios else min(c, key=absc) if c else None
    # Nebulosa o polvo que llena el campo (IC 1396, 16 nov 2026): las medidas de cielo de arriba usan celdas que aquí son
    # nebulosa y no ven la diferencia. Lo que más se pareció a SRGC fue SRGC + plano en celdas oscuras y, sin SRGC, el
    # plano en celdas oscuras; si no se comen nada, se prefieren.
    # Pero no si deja bastante más gradiente que el mejor por medidas: en las capas débiles de IC 1396 (OIII, SII, Hβ,
    # 25 nov 2026) el plano en celdas oscuras dejaba el 83–123 % del gradiente (más que el original) y el polinomio 1,
    # sin llevarse nada del objeto, el 15–57 %.
    if extenso and not galaxia:
        r_mejor = resid(mejor) if mejor else 9
        for nombre in ("SRGC + polinomio celdas oscuras", "Polinomio celdas oscuras"):
            x = next((x for x in c if x.get("metodo") == nombre and eat(x) <= tope and absc(x) < 0.3
                      and resid(x) < 1 and resid(x) <= r_mejor + 0.15), None)
            if x is not None:
                mejor = x
                break
    criterio = (f"campo con objeto extenso o polvo: se tolera que el modelo se lleve ≤ {tope:g} % del objeto"
                if extenso else f"se tolera que el modelo se lleve ≤ {tope:g} % del objeto")
    if not mejor:
        return None, criterio, "Ningún candidato se pudo medir: ver errores."
    mm = mejor["metricas"]
    motivo = (f"{mejor['metodo']}: deja {round(100 * resid(mejor))} % del gradiente del cielo, se lleva el "
              f"{mm['objeto_quitado_pct']} % del objeto, corr {mm['copia_objeto']} "
              f"({'modelo limpio' if absc(mejor) < 0.15 else 'copia el objeto: revisar' if absc(mejor) > 0.5 else 'intermedio: revisar el modelo'}).")
    return mejor["id"], criterio, motivo


# --- Ruido y detalle ----------------------------------------------------------------------------------------

def _caja(x, r):
    """Media en caja (2r+1)² con sumas acumuladas."""
    if r <= 0:
        return x
    p = np.pad(x, r, mode="reflect").astype(np.float64)
    c = p.cumsum(0).cumsum(1)
    c = np.pad(c, ((1, 0), (1, 0)))
    k = 2 * r + 1
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return (s / (k * k)).astype(np.float32)


def suave(x, r):
    """Desenfoque casi gaussiano (tres cajas de radio r/2), como _suave de Siril."""
    k = max(1, int(round(r / 2)))
    return _caja(_caja(_caja(x, k), k), k)


def recortes(p):
    n = p.size
    return {"altos_pct": _r(100.0 * float((p >= 0.999).sum()) / n, 4), "ceros_pct": _r(100.0 * float((p <= 0.0).sum()) / n, 4)}


def saturacion(p):
    """Saturación HSV por píxel: (máx − mín) / máx."""
    mx, mn = p.max(axis=0), p.min(axis=0)
    return np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0.0).astype(np.float32)


def contraste_local(L, m, r=16):
    """σ de la estructura de escala media (L − caja de 2r+1 px) dentro de la máscara."""
    if m is None or not m.any():
        return None
    d = (L - _caja(L, r))[m]
    return float(np.sqrt(np.mean(d ** 2)))


def px_estrella(Lb):
    """Píxeles de estrella de una capa de estrellas: > mediana + 5σ (MAD); al menos el 0,5 % más brillante."""
    v = Lb.ravel()[::7]
    med = float(np.median(v))
    sig = 1.4826 * float(np.median(np.abs(v - med)))
    m = Lb > med + 5 * max(sig, 1e-6)
    if m.mean() < 0.005:
        m = Lb >= np.percentile(v, 99.5)
    return m


def zonas_objeto_cielo(p, S=64):
    """Píxeles de cielo (celdas más oscuras) y de objeto (cuartil alto de celdas, > cielo + ruido), sin estrellas."""
    c = cielo(p, S)
    L = lum(p)
    m = celdas(L, S)
    ys, xs, _ = c["_celdas"]
    cie = np.zeros(m.shape, dtype=bool)
    cie[ys, xs] = True
    val = m > 1e-6
    obj = val & (m >= np.percentile(m[val], 75)) & (m > c["cielo"] + c["ruido"]) & ~cie
    hp = L - _caja(L, 5)
    est = hp > max(5 * max(c["ruido"], 1e-6), float(np.percentile(hp.ravel()[::7], 99.5)))
    est = _caja(est.astype(np.float32), 2) > 0

    def a_px(mc):
        out = np.zeros(L.shape, dtype=bool)
        h, w = mc.shape[0] * S, mc.shape[1] * S
        out[:h, :w] = np.repeat(np.repeat(mc, S, 0), S, 1)
        return out

    return {"medidas": c, "cielo_px": a_px(cie) & ~est, "obj_px": a_px(obj) & ~est, "obj_c": obj, "celdas_m": m,
            "est_px": est, "S": S, "a_px": a_px}


def pct_estrellas(p):
    """% de píxeles de estrella para decidir si una imagen es starless: picos > 5σ (o > p99,5 del paso alto) que forman
    grupo (≥ 3 píxeles en su 3×3). Los picos sueltos de ruido, la rejilla de 2 px y los anillos que deja StarX en lineal
    no cuentan: en IC 1396 (25 nov 2026) contar todos los picos dio un 2,1 % en una starless (0,18 % así) y
    recombinarEstrellas rechazó las estrellas buenas. Con estrellas: 2,3–2,4 %."""
    c = cielo(p)
    L = lum(p)
    hp = L - _caja(L, 5)
    est = hp > max(5 * max(c["ruido"], 1e-6), float(np.percentile(hp.ravel()[::7], 99.5)))
    est &= _caja(est.astype(np.float32), 1) * 9 >= 2.5
    return float((_caja(est.astype(np.float32), 2) > 0).mean() * 100.0)


def estrellas_fuertes_mp(p):
    """Estrellas fuertes por megapíxel de p (ya submuestreada 1 de cada 2): máximos locales 5×5 del paso alto (L − caja₅)
    más de 80 veces por encima del ruido LOCAL (σ desde |diferencia de vecinos| en 31 px). Para saber si una imagen ya
    está sin estrellas en lineal, donde pct_estrellas falla: prueba en vivo en Siril (IC 1396, 25 nov 2026) con la
    starless lineal de StarX, 2,1 % (igual que con estrellas). Así: con estrellas 175–255/MP, starless lineales y
    estiradas 0. Igual que _estrellas_fuertes_mp de Siril y rdEstrellasFuertesMP de PixInsight."""
    L = lum(p).astype(np.float32)
    hp = L - _caja(L, 5)
    d = np.abs(np.diff(hp, axis=1))
    d = np.concatenate([d, d[:, -1:]], axis=1)
    z = hp / (_caja(d, 15) * (0.8862 / np.sqrt(2)) + 1e-9)
    a = np.pad(hp, ((0, 0), (2, 2)), mode="edge")
    m = np.maximum.reduce([a[:, i:i + hp.shape[1]] for i in range(5)])
    a = np.pad(m, ((2, 2), (0, 0)), mode="edge")
    m = np.maximum.reduce([a[i:i + hp.shape[0]] for i in range(5)])
    return int(((hp >= m) & (z > 80)).sum()) / (L.size * 4 / 1e6)


def zona_brillante(L, z):
    """Parte brillante del objeto (celdas de objeto entre la mediana y el p97: disco, sin núcleo) sin estrellas. Ahí el
    detalle de 2–8 px domina sobre el ruido (como _zona_brillante de Siril)."""
    oc, m = z["obj_c"], z["celdas_m"]
    if not oc.any():
        return None
    v = m[oc]
    sel = oc & (m >= np.percentile(v, 50)) & (m <= np.percentile(v, 97))
    px = z["a_px"](sel) & ~z["est_px"]
    return px if px.sum() > 2000 else None


def energia_brillante(L, px, cielo_px=None):
    """Energía de la banda 2–8 px (caja 5 − caja 17) en la zona brillante: el detalle que un denoise no debe borrar.
    Con cielo_px se le resta la del cielo en la misma banda (el ruido que queda tras promediar): en una starless
    estirada el ruido sigue pesando en 2–8 px y, sin restarlo, quitar ruido contaba como perder detalle (M31, SASpro)."""
    D = _caja(L, 2) - _caja(L, 8)
    e = float(np.mean(D[px] ** 2))
    if cielo_px is not None and cielo_px.any():
        e -= float(np.mean(D[cielo_px] ** 2))
    return e


# --- Núcleo de galaxias (como siril/herramientas/nucleo.py) ------------------------------------------------

def _pico(B, borde=None):
    b = borde or max(16, min(B.shape) // 20)
    C = B.copy()
    C[:b] = C[-b:] = 0
    C[:, :b] = C[:, -b:] = 0
    return np.unravel_index(int(np.argmax(C)), C.shape)


def _perfil(L, centro, rmax, paso=2):
    y0, x0 = centro
    y1, y2 = max(0, y0 - rmax), min(L.shape[0], y0 + rmax + 1)
    x1, x2 = max(0, x0 - rmax), min(L.shape[1], x0 + rmax + 1)
    sub = L[y1:y2, x1:x2]
    yy, xx = np.mgrid[y1:y2, x1:x2]
    anillo = (np.hypot(yy - y0, xx - x0) // paso).astype(np.int64).ravel()
    v = sub.ravel()
    n = rmax // paso
    dentro = anillo < n
    anillo, v = anillo[dentro], v[dentro]
    # Mediana por anillo de una vez: ordenar por (anillo, valor) y tomar el elemento central de cada grupo.
    orden = np.lexsort((v, anillo))
    anillo, v = anillo[orden], v[orden]
    cuenta = np.bincount(anillo, minlength=n)
    inicio = np.concatenate(([0], np.cumsum(cuenta)[:-1]))
    out = []
    for i in range(n):
        if cuenta[i] < 4:
            break
        out.append(float(v[inicio[i] + cuenta[i] // 2]))
    return np.array(out)


def _anillos(prof):
    if len(prof) < 4 or prof[0] <= 0:
        return 0.0
    return float(100.0 * np.max(prof - np.minimum.accumulate(prof)) / prof[0])


def preparar_nucleo(p, radio=None, desde=None):
    """Base del bulbo, centro, umbral y máscara suave. Error si no hay núcleo brillante."""
    L = lum(p)
    W = max(L.shape)
    r_b = int(radio or max(6, round(W / 160)))
    B = suave(L, 2 * r_b)
    centro = _pico(B)
    pico = float(B[centro])
    u = float(desde) if desde is not None else max(0.45, min(0.80, pico - 0.30))
    if pico <= u + 0.03:
        raise RuntimeError(f"No hay núcleo brillante que comprimir (pico de la base {pico:.2f}, umbral {u:.2f}): no aplica.")
    t = np.clip((B - u) / max(pico - u, 1e-6), 0, 1)
    mascara = suave((t * t * (3 - 2 * t)).astype(np.float32), max(2, r_b))
    return {"L": L, "B": B, "centro": centro, "u": u, "r_b": r_b, "mascara": mascara,
            "rmax": int(min(W // 6, max(40, 6 * r_b)))}


def medir_nucleo(q, n):
    L = lum(q)
    mk = n["mascara"]
    dentro = mk > 0.5
    return {"meseta_radio_px": _r(np.sqrt(((L >= 0.95) & (mk > 0.05)).sum() / np.pi), 1),
            "brillo_bulbo": _r(float(np.median(L[dentro])) if dentro.any() else None, 4),
            "estructura_bulbo": _r(contraste_local(L, dentro, r=4), 5),
            "anillos_pct": _r(_anillos(_perfil(L, n["centro"], n["rmax"])), 2)}


def comprimir_nucleo(p, n, k):
    """Resta k·(base − umbral) dentro de la máscara del bulbo y refuerza su detalle; color por L'/L sin pasar de 1."""
    L, B, mk, u = n["L"], n["B"], n["mascara"], n["u"]
    Lo = np.clip(L - k * mk * np.maximum(B - u, 0) + 0.5 * k * mk * (L - B), 0, 1)
    if p.shape[0] == 3:
        # con pedestal de 0,05 (como _con_luminancia): sin él el cociente amplifica el ruido de color de lo oscuro
        q = (p + 0.05) * ((Lo + 0.05) / np.maximum(L + 0.05, 1e-6))[None] - 0.05
        mx = q.max(axis=0)
        q = np.where(mx > 1, q / np.maximum(mx, 1e-6), q)
    else:
        q = Lo[None]
    return np.clip(q, 0, 1).astype(np.float32)


def mascara_luminancia(p):
    """Máscara de luminancia como la de PixInsight (guia/herramientas/boost.js, bsMascara): luminancia reescalada de
    mediana − 1,5 σ (0) al máximo (1) y raíz cuadrada. 0 en el cielo, 1 en lo brillante, suave entre medias. En IC 405
    con Qwen (23 nov 2026) la saturación a través de ella llegó a 0,88 sin fallo; sin máscara paraba en 0,63–0,68 por
    el ruido de color del cielo y la nebulosa salía plana."""
    L = lum(p)
    s = L[::4, ::4]
    med = float(np.median(s))
    sig = 1.4826 * float(np.median(np.abs(s - med)))
    a = max(0.0, med - 1.5 * sig)
    b = max(a + 1e-3, float(L.max()))
    return np.sqrt(np.clip((L - a) / (b - a), 0, 1)).astype(np.float32)


def saturar(p, k, fondo=None, mascara=False):
    """Satura conservando la luminancia: c' = L + (1 + k)·(c − L). Con fondo (nivel de cielo), el aumento se reduce
    en el cielo (peso que sube de 0 en el cielo a 1 en cielo + 0,1). Con mascara=True, el peso es la máscara de
    luminancia (mascara_luminancia, como en PixInsight) por la rampa del cielo."""
    L = lum(p)[None]
    g = 1.0 + float(k)
    # Máscara × rampa del cielo (24 nov 2026, previas Natural y SHO de IC 1396 a igual ganancia del objeto, +35 %): la
    # máscara sola subía la saturación del cielo un 6–8 % (en el cielo vale ~0,2); la rampa sola, un 1,8 %; las dos
    # juntas, un 0,9 %, y llevan más saturación a lo brillante.
    if mascara:
        w = mascara_luminancia(p)
        if fondo is not None:
            w = w * np.clip((L[0] - fondo) / 0.1, 0, 1)
        g = 1.0 + float(k) * w[None]
    elif fondo is not None:
        w = np.clip((L - fondo) / 0.1, 0, 1)
        g = 1.0 + float(k) * w
    # Tope por píxel: ningún canal sale de 0–1 (a +2,5 el canal débil iba a 0 en el 1,9 % de IC 1396; 15 nov 2026).
    # Igual que _saturar_propio de Siril.
    d = p - L
    with np.errstate(divide="ignore", invalid="ignore"):
        tope = np.where(d < 0, L / np.maximum(-d, 1e-9), np.where(d > 0, (1 - L) / np.maximum(d, 1e-9), np.inf)).min(axis=0)
    g = np.minimum(g, np.maximum(0.98 * tope, 1.0)[None])
    return np.clip(L + g * d, 0, 1).astype(np.float32)


def cobertura_ruido(x, b=16, umbral=1.25, pct=98.0, max_bloques=40):
    """Cobertura por el RUIDO, en lineal y antes del gradiente: con menos subs el ruido sube (∝ 1/√N). Ruido local (MAD
    del paso alto en bloques b×b) relativo al del centro; por borde, píxeles desde el borde con ruido > umbral × centro
    (percentil 'pct' de las filas/columnas). IC 1396 (16 nov 2026): el S2O3 tenía 96–128 px a la derecha y 80 abajo con
    más ruido; el gradiente se ajustaba mal ahí y la esquina salía cian. Igual que _cobertura_ruido de Siril."""
    x = np.asarray(x, dtype=np.float32)
    # Binado 2×2 antes de medir: el remuestreo del alineado (bilineal o Lanczos con un giro) suaviza el ruido de píxel
    # distinto en cada zona del campo, y el ruido a escala de 1 px cambiaba del ×1,56 arriba al ×0,87 abajo en un
    # master alineado sin franjas (IC 405, 19 nov 2026). Binado, la cobertura sale como en el master sin alinear.
    x = x[:x.shape[0] // 2 * 2, :x.shape[1] // 2 * 2].reshape(x.shape[0] // 2, 2, x.shape[1] // 2, 2).mean(axis=(1, 3))
    b2, b = b, max(1, b // 2)
    hp = x - _caja(x, 1)
    h, w = hp.shape
    hb, wb = h // b, w // b
    blk = np.abs(hp[:hb * b, :wb * b]).reshape(hb, b, wb, b)
    m = np.median(blk, axis=(1, 3)) * 1.4826
    m = m / max(float(np.median(m[hb // 4:3 * hb // 4, wb // 4:3 * wb // 4])), 1e-12)
    vistas = {"izquierda": m, "derecha": m[:, ::-1], "arriba": m.T, "abajo": m[::-1, :].T}
    out = {}
    for lado, a in vistas.items():
        alto = a[:, :max_bloques] > umbral
        corr = np.where(alto.all(axis=1), max_bloques, np.argmin(alto, axis=1))
        # Filas con ruido alto en todo el tramo (640 px) son señal, no cobertura: nebulosa brillante o el halo de una
        # estrella que llega al borde (ruido de la propia señal). IC 405 (19 nov 2026): un 2–3 % de filas así daba 640 px
        # por lado (el tope) y el recorte salía <70 %; sin ellas, 96/176/192/128 px, como se ve en el perfil de ruido.
        llenas = corr >= max_bloques
        uso = corr[~llenas] if llenas.mean() < 0.5 else corr
        out[lado] = int(np.percentile(uso, pct)) * b2
    return out


def franjas_borde(p, anchos=(8, 32, 64), interior=(200, 400)):
    """Estadística de los bordes: media y σ por canal en franjas de 8/32/64 px de cada lado frente a una franja interior
    (200–400 px hacia dentro), y dominante de color de cada franja. Para ver bordes con menos señal, más ruido o color."""
    p = np.asarray(p, dtype=np.float32)
    c, h, w = p.shape
    # σ = ruido robusto (MAD del paso alto), no la desviación típica: las estrellas y la nebulosa la inflaban (16 nov 2026).
    hp = np.stack([p[i] - _caja(p[i], 1) for i in range(c)])
    vistas = {"izquierda": (p, hp), "derecha": (p[:, :, ::-1], hp[:, :, ::-1]),
              "arriba": (np.swapaxes(p, 1, 2), np.swapaxes(hp, 1, 2)),
              "abajo": (np.swapaxes(p[:, ::-1, :], 1, 2), np.swapaxes(hp[:, ::-1, :], 1, 2))}

    def mad(x):
        return 1.4826 * np.median(np.abs(x - np.median(x, axis=1, keepdims=True)), axis=1)

    out = {}
    for lado, (a, ah) in vistas.items():
        i0, i1 = min(interior[0], a.shape[2] // 3), min(interior[1], a.shape[2] // 2)
        mr = np.median(a[:, :, i0:i1].reshape(c, -1), axis=1)
        sr = mad(ah[:, :, i0:i1].reshape(c, -1))
        filas = {}
        for an in anchos:
            mf = np.median(a[:, :, :an].reshape(c, -1), axis=1)
            sf = mad(ah[:, :, :an].reshape(c, -1))
            dom = 100.0 * float(np.ptp(mf / np.maximum(mr, 1e-9))) if c == 3 else 0.0
            filas[f"{an}px"] = {"media_rel": [_r(float(v), 3) for v in mf / np.maximum(mr, 1e-9)],
                                "sigma_rel": [_r(float(v), 3) for v in sf / np.maximum(sr, 1e-9)],
                                "dominante_pct": _r(dom, 1)}
        out[lado] = filas
    return out


def cuna_cobertura(L, r=16, banda=(300, 600), umbral=0.5, max_px=600, pct=98.0):
    """Cuñas de cobertura parcial en cada borde (zona donde un master tiene menos subs o un canal no llega: la señal cae
    pero no a 0, así que la máscara de datos no la ve). Por cada fila/columna, píxeles desde el borde en que la imagen
    suavizada está por debajo de 'umbral' × su nivel en la banda 300–600 px hacia dentro; por lado, el percentil 'pct'.
    IC 1396 c7 de Siril (16 nov 2026): el HaO3 caía a la mitad en 62–83 px arriba a la derecha y la esquina salía cian.
    Igual que _cuna_cobertura de Siril. Devuelve {lado: px} en la orientación del array."""
    s = suave(np.asarray(L, dtype=np.float32), r)
    vistas = {"izquierda": s, "derecha": s[:, ::-1], "arriba": s.T, "abajo": s[::-1, :].T}
    out = {}
    for lado, a in vistas.items():
        n = a.shape[1]
        b0, b1 = min(banda[0], n // 3), min(banda[1], n // 2)
        ref = np.median(a[:, b0:b1], axis=1)
        mp = min(max_px, b0)
        bajo = a[:, :mp] < umbral * np.maximum(ref, 1e-9)[:, None]
        corrida = np.where(bajo.all(axis=1), mp, np.argmin(bajo, axis=1))
        out[lado] = int(np.percentile(corrida, pct))
    return out


def patron_2px(x, r=12):
    """Patrón fijo de periodo 2 px (filas, columnas y diagonal alternas: resto de la matriz Bayer de un master OSC
    debayerizado), estimado con la segunda diferencia (no ve la estructura suave) y promediado en una ventana. En IC 1396
    era el 1 % de la escala fina del master y el 15 % tras un denoise fuerte: salía como una malla fina (15 nov 2026).
    Se resta: x − patron_2px(x). Igual que _patron_2px de Siril.
    Junto a una estrella brillante la segunda diferencia del perfil empinado, con signo alterno y promediada en la
    ventana, no da 0: la versión anterior restaba allí una malla FALSA (IC 1396, 25 nov 2026: el master desmezclado no
    tenía malla, razón de Nyquist 1, y tras restar esto 1193; era la cuadrícula de los anillos). Ahora la media es
    ponderada y deja fuera los píxeles con segunda diferencia > 4σ (y 2 px alrededor): allí el patrón se toma del
    entorno, que es lo que es un patrón fijo; si no hay entorno válido, 0."""
    x = np.asarray(x, dtype=np.float32)
    h, w = x.shape
    sx = np.where(np.arange(w) % 2, -1.0, 1.0)[None, :].astype(np.float32)
    sy = np.where(np.arange(h) % 2, -1.0, 1.0)[:, None].astype(np.float32)
    total = np.zeros_like(x)
    for m, eje in ((sx, 1), (sy, 0), (sx * sy, None)):
        if eje is None:
            d = x - 0.25 * (np.roll(x, 1, 0) + np.roll(x, -1, 0) + np.roll(x, 1, 1) + np.roll(x, -1, 1))
        else:
            d = x - 0.5 * (np.roll(x, 1, eje) + np.roll(x, -1, eje))
        dm = d[::3, ::3]
        sig = 1.4826 * float(np.median(np.abs(dm - np.median(dm)))) + 1e-12
        malo = (np.abs(d) > 4.0 * sig).astype(np.float32)
        peso = (_caja(malo, 2) < 1e-3).astype(np.float32)
        num = suave(d * m * peso, 2 * r)
        den = suave(peso, 2 * r)
        est = np.where(den > 0.25, num / np.maximum(den, 1e-6), 0.0).astype(np.float32)
        total += est * 0.5 * m
    return total


def patron_2px_relativo(x, r=3):
    """x sin el patrón de 2 px proporcional a la señal: alrededor de las estrellas brillantes de una capa de dual band
    (OSC) la malla crece con la estrella y patron_2px (ventana de 12 px, aditivo) no la ve. Se estima sobre x / fondo
    suave y se vuelve a multiplicar. Delante de StarX evita los anillos con malla de las estrellas brillantes (IC 1396
    Natural9, 25 nov 2026: malla ×3–4 alrededor de la estrella → ×1 con esto)."""
    from scipy.ndimage import gaussian_filter
    x = np.asarray(x, dtype=np.float32)
    s = gaussian_filter(x, 2.0) + 1e-5
    y = x / s
    return np.clip((y - patron_2px(y, r)) * s, 0.0, 1.0).astype(np.float32)


def textura(L, obj, cielo_px=None):
    """Textura del objeto en una imagen estirada, por escalas (lo que hace «suave y con contraste»):
    grano = σ de la escala fina (L − caja 3×3) en el objeto, relativo a su nivel; contraste_medio = σ de la banda 4–32 px;
    contraste_grande = σ de la banda 32–256 px; suavidad = contraste_grande / grano (más = más suave y con más relieve).
    Para comparar finales (IC 1396: meta de Rafael, la textura del final de PixInsight, 14 nov 2026)."""
    if obj is None or not obj.any():
        return {}
    nivel = max(float(np.median(L[obj])), 1e-6)
    fino = (L - _caja(L, 1))[obj]
    s4, s32, s256 = suave(L, 8), suave(L, 64), suave(L, 512)
    medio = (s4 - s32)[obj]
    grande = (s32 - s256)[obj]
    g = float(np.std(fino)) / nivel
    cm = float(np.std(medio)) / nivel
    cg = float(np.std(grande)) / nivel
    return {"grano": _r(g, 4), "contraste_medio": _r(cm, 4), "contraste_grande": _r(cg, 4),
            "suavidad": _r(cg / max(g, 1e-9), 2)}


def energia_detalle(L, banda=(1, 4)):
    """Energía de las escalas finas (diferencia de cajas) fuera del cielo: lo que un denoise no debería borrar."""
    a, b = banda
    d = _caja(L, a) - _caja(L, b)
    return float(np.mean(np.abs(d)))


def residual_estructura(L0, L1, b=16, zona=None):
    """Estructura de lo que quita un denoise (L0 − L1): dispersión de las medias de bloques de b px frente a la que daría
    ruido puro (σ/b). ~1–2 = solo ruido; más = se lleva forma del objeto. Con 'zona' (bool), solo los bloques que caen
    mayoritariamente en ella. No depende de cuánta textura fina deje el denoise (por eso sirve también con NoiseX).
    (25 nov 2026, escrito para SASpro con la idea de la medida de PixInsight.)"""
    d = (np.asarray(L0, np.float32) - np.asarray(L1, np.float32))
    h, w = d.shape[0] // b * b, d.shape[1] // b * b
    if h == 0 or w == 0:
        return None
    blo = d[:h, :w].reshape(h // b, b, w // b, b)
    medias = blo.mean(axis=(1, 3))
    sd = float(d[:h:4, :w:4].std())
    if zona is not None:
        z = np.asarray(zona, bool)[:h, :w].reshape(h // b, b, w // b, b).mean(axis=(1, 3)) > 0.5
        if z.sum() < 20:
            return None
        medias = medias[z]
    if sd <= 0:
        return None
    return float(medias.std()) / (sd / b)
