# Estirado hiperbólico en luminancia que conserva el color (SirilAstroPilot y SetiAstroPilot: el mismo fichero en
# siril/herramientas y sas/herramientas). Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# Idea (pública; inspirada en el planteamiento de VeraLux HyperMetric Stretch, de Riccardo Paterniti, que es GPL-3 y del
# que NO se ha copiado código, estructura ni constantes): estirar solo la luminancia con una curva hiperbólica cuyo
# parámetro de intensidad se busca para dejar el cielo en un nivel objetivo, y aplicar a cada canal el mismo factor que a
# la luminancia, de modo que el color de cada píxel (las proporciones entre canales) no cambia. La «protección» es el
# exponente b de la familia hiperbólica generalizada (GHS): con b alto la curva sube rápido en las sombras y se aplana
# antes en las luces, que quedan menos comprimidas contra el blanco.
#
#   f(t) = (1 − (1 + b·D·t)^(−1/b)) / (1 − (1 + b·D)^(−1/b)),   t = luminancia lineal tras el punto negro (0–1)
#   canal_c' = canal_c · f(L) / L  (y si algún canal pasa de 1, el píxel entero se baja en proporción: mismo tono)
#
# Con color < 1 se mezcla con el estirado de cada canal por separado (f aplicada canal a canal), que es más neutro en el
# cielo ruidoso; 1 = color de la lineal tal cual.

import numpy as np


def _f(t, D, b):
    t = np.clip(t, 0.0, 1.0)
    return (1.0 - np.power(1.0 + b * D * t, -1.0 / b)) / (1.0 - (1.0 + b * D) ** (-1.0 / b))


def _cielo_lum(L, S=64):
    """Mediana de las celdas de S px más oscuras (10 %) de la luminancia."""
    h, w = (L.shape[0] // S) * S, (L.shape[1] // S) * S
    if h == 0 or w == 0:
        return float(np.percentile(L, 10))
    C = np.median(L[:h, :w].reshape(h // S, S, w // S, S).transpose(0, 2, 1, 3).reshape(h // S, w // S, -1), axis=2)
    v = np.sort(C.ravel())
    return float(np.median(v[:max(3, v.size // 10)]))


def resolver_D(t_cielo, objetivo, b):
    """D tal que f(t_cielo) = objetivo (bisección en escala logarítmica)."""
    lo, hi = np.log(1e-3), np.log(1e8)
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        if _f(t_cielo, np.exp(mid), b) < objetivo:
            lo = mid
        else:
            hi = mid
    return float(np.exp(0.5 * (lo + hi)))


def estirar(p, cielo=0.10, proteccion=1.5, color=1.0, sigmas_negro=6.0):
    """p: (canales, alto, ancho) lineal 0–1. Devuelve (imagen estirada, detalle). El cielo de la luminancia queda en
    'cielo'; el punto negro común se pone 'sigmas_negro' ruidos por debajo del cielo (sin recortar sombras)."""
    p = np.asarray(p, dtype=np.float32)
    if p.ndim == 2:
        p = p[None]
    L = p.mean(axis=0)
    cs = _cielo_lum(L)
    # ruido del cielo: diferencias entre vecinos (robusto a la señal lisa)
    d = np.diff(L[::2, ::2], axis=1)
    ruido = float(1.4826 * np.median(np.abs(d - np.median(d))) / np.sqrt(2))
    bp = max(0.0, cs - sigmas_negro * ruido)
    esc = 1.0 / max(1.0 - bp, 1e-6)
    t = np.clip((L - bp) * esc, 0.0, 1.0)
    b = float(proteccion)
    D = resolver_D(max((cs - bp) * esc, 1e-7), float(cielo), b)
    k = _f(t, D, b) / np.maximum(t, 1e-7)
    x = np.clip((p - bp) * esc, 0.0, None)
    q = x * k[None]
    if color < 1.0 and p.shape[0] > 1:
        q = color * q + (1.0 - color) * _f(x, D, b)
    m = q.max(axis=0)
    q = np.where(m[None] > 1.0, q / np.maximum(m, 1e-7)[None], q)
    detalle = {"D": round(D, 3), "proteccion_b": b, "color": float(color), "punto_negro": round(bp, 6),
               "cielo_lineal": round(cs, 6), "cielo_objetivo": float(cielo)}
    return np.clip(q, 0.0, 1.0).astype(np.float32), detalle
