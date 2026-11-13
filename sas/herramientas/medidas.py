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
    if enlazado:
        meds = [float(np.median(q[c][::4, ::4])) for c in range(q.shape[0])]
        mads = [1.4826 * float(np.median(np.abs(q[c][::4, ::4] - meds[c]))) for c in range(q.shape[0])]
        med, mad = float(np.mean(meds)), float(np.mean(mads))
        pares = [(med, mad)] * q.shape[0]
    else:
        pares = []
        for c in range(q.shape[0]):
            x = q[c][::4, ::4]
            m = float(np.median(x))
            pares.append((m, 1.4826 * float(np.median(np.abs(x - m)))))
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
    M2 = ajuste_poli(M, v, 2)
    m_hp = (M - M2)[v]
    o_hp = base["O_hp"][v]
    corr = float(np.corrcoef(m_hp, o_hp)[0, 1]) if m_hp.std() > 1e-12 and o_hp.std() > 1e-12 else 0.0
    exceso = M - ajuste_poli(M, cie, 2)
    come = 100.0 * float(exceso[obj].sum()) / base["senal_obj"] if base["senal_obj"] > 0 and obj.any() else float("nan")
    irreg = rango_rejilla(C, cie) / base["rango0"] if base["rango0"] and base["rango0"] > 0 else float("nan")
    resid = amplitud_plano(C, cie, v) / base["plano0"] if base["plano0"] > 0 else float("nan")
    return {"copia_objeto": _r(corr, 3), "objeto_quitado_pct": _r(come, 1), "gradiente_restante": _r(resid, 3),
            "irregularidad_cielo": _r(irreg, 3), "negativos_pct": _r(100.0 * float((pc < 0).mean()), 3)}


def elegir_gradiente(c, objeto_campo_pct, tipo=None):
    """Mismo criterio que Siril: se tolera que el modelo se lleve ≤ 3 % del objeto (≤ 1 % en campos extensos)."""
    import re

    def absc(x): return abs(x["metricas"]["copia_objeto"] or 0)
    def resid(x): v = x["metricas"]["gradiente_restante"]; return v if v is not None else 9
    def eat(x): v = x["metricas"]["objeto_quitado_pct"]; return abs(v) if v is not None else 100

    extenso = objeto_campo_pct > 25 or bool(re.search(r"(?i)nebul|polvo|dust|ifn|oscur|extens|molecular", str(tipo or "")))
    tope = 1.0 if extenso else 3.0
    seguros = [x for x in c if eat(x) <= tope and absc(x) < 0.3]
    limpios = [x for x in c if absc(x) < 0.3]
    if seguros:
        r0 = min(resid(x) for x in seguros)
        margen = 0.15 if extenso else 0.05
        mejor = min([x for x in seguros if resid(x) <= r0 + margen], key=eat)
    else:
        mejor = min(limpios, key=eat) if limpios else min(c, key=absc) if c else None
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


def energia_detalle(L, banda=(1, 4)):
    """Energía de las escalas finas (diferencia de cajas) fuera del cielo: lo que un denoise no debería borrar."""
    a, b = banda
    d = _caja(L, a) - _caja(L, b)
    return float(np.mean(np.abs(d)))
