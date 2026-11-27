# SirilAstroPilot — paso de núcleo para galaxias (no lineal, después de estirar y antes de saturar).
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# Escrito desde cero (11 nov 2026). El bulbo de una galaxia estirada queda como una meseta blanca: el estirado global
# no puede a la vez levantar el disco débil y dejar rango para el núcleo. Aquí la luminancia se parte en base (media en
# ventana del tamaño del bulbo) y detalle; dentro de una máscara suave del bulbo se resta una parte de la base por encima
# del umbral (rango comprimido) y se refuerza el detalle, y se mezcla con la imagen. Fuera de la máscara nada cambia.
# Medidas: meseta (radio equivalente de lo que pasa de 0,95), anillos (subidas del perfil radial hacia fuera), brillo
# del bulbo y estructura dentro del bulbo, antes y después.

import time

import numpy as np

import herramientas as H
import pasos as P

_r = P._r if hasattr(P, "_r") else (lambda x, n=3: None if x is None else round(float(x), n))


def _pico(B, borde=None):
    """Posición del máximo de la base, lejos de los bordes."""
    b = borde or max(16, min(B.shape) // 20)
    C = B.copy()
    C[:b] = C[-b:] = 0
    C[:, :b] = C[:, -b:] = 0
    return np.unravel_index(int(np.argmax(C)), C.shape)


def _perfil(L, centro, rmax, paso=2):
    """Mediana de L en anillos de 'paso' px alrededor de 'centro', hasta rmax."""
    y0, x0 = centro
    y1, y2 = max(0, y0 - rmax), min(L.shape[0], y0 + rmax + 1)
    x1, x2 = max(0, x0 - rmax), min(L.shape[1], x0 + rmax + 1)
    sub = L[y1:y2, x1:x2]
    yy, xx = np.mgrid[y1:y2, x1:x2]
    rr = np.hypot(yy - y0, xx - x0)
    out = []
    for r in range(0, rmax, paso):
        m = (rr >= r) & (rr < r + paso)
        if m.sum() < 4:
            break
        out.append(float(np.median(sub[m])))
    return np.array(out)


def _anillos(prof):
    """Mayor subida del perfil radial hacia fuera (un anillo o halo oscuro dentro), en % del pico."""
    if len(prof) < 4 or prof[0] <= 0:
        return 0.0
    minimo = np.minimum.accumulate(prof)
    return float(100.0 * np.max(prof - minimo) / prof[0])


def _medidas(L, mascara, centro, rmax):
    """Meseta, brillo, estructura del bulbo y anillos."""
    meseta = float(np.sqrt(((L >= 0.95) & (mascara > 0.05)).sum() / np.pi))
    dentro = mascara > 0.5
    brillo = float(np.median(L[dentro])) if dentro.any() else None
    estructura = P._contraste_local(L, dentro, r=4) if dentro.any() else None
    return {"meseta_radio_px": _r(meseta, 1), "brillo_bulbo": _r(brillo, 4), "estructura_bulbo": _r(estructura, 5),
            "anillos_pct": _r(_anillos(_perfil(L, centro, rmax)), 2)}


def nucleoCandidatos(siril, fuerzas=(0.25, 0.4, 0.55), desde=None, radio=None, tipo=None, brillo_min=0.85,
                     anillos_max=1.5):
    """Paso de núcleo (galaxias, no lineal, antes de saturar): compara comprimir el bulbo a varias fuerzas. La imagen no
    cambia: aplicarCandidato(id)."""
    info = H._info(siril)
    crudo = P._crudo(siril)
    p = P._pantalla(crudo, info)
    if P._lineal(p):
        raise RuntimeError("La imagen parece lineal: el núcleo se trabaja después de estirar (y antes de saturar).")
    x = P._de_siril(crudo)                             # orden de filas de Siril: el candidato se guarda igual
    L = P._lum(x)
    W = max(L.shape)
    r_b = int(radio or max(6, round(W / 160)))          # ventana de la base: del orden del bulbo
    B = P._suave(L, 2 * r_b)                           # casi gaussiano: una caja dejaba un borde visible
    centro = _pico(B)
    pico = float(B[centro])
    u = float(desde) if desde is not None else max(0.45, min(0.80, pico - 0.30))
    if pico <= u + 0.03:
        raise RuntimeError(f"No hay núcleo brillante que comprimir (pico de la base {pico:.2f}, umbral {u:.2f}): no aplica.")
    t = np.clip((B - u) / max(pico - u, 1e-6), 0, 1)
    mascara = P._suave((t * t * (3 - 2 * t)).astype(np.float32), max(2, r_b))
    rmax = int(min(W // 6, max(40, 6 * r_b)))
    m0 = _medidas(L, mascara, centro, rmax)
    huella = P._huella(crudo)
    grupo = "nucleo"
    P._limpiar_grupo(grupo)
    cy = int(centro[0]) if info["top_down"] else int(L.shape[0] - 1 - centro[0])
    r = {"centro_px": [int(centro[1]), cy], "umbral": _r(u, 3), "radio_base_px": r_b,
         "bulbo_pct_imagen": _r(100.0 * float((mascara > 0.5).mean()), 3), "antes": m0, "candidatos": [], "errores": []}
    D = L - B
    for n, k in enumerate(fuerzas, 1):
        t0 = time.perf_counter()
        nombre = f"comprimir el bulbo ×{k:g}"
        try:
            Lo = L - k * mascara * np.maximum(B - u, 0) + 0.5 * k * mascara * D
            Lo = np.clip(Lo, 0, 1)
            if x.shape[0] == 3:
                # pedestal 0,05 (25 nov 2026, como Recombine Luminance de SASpro): sin ruido de color en lo oscuro
                f = (Lo + 0.05) / np.maximum(L + 0.05, 1e-6)
                q = (x + 0.05) * f[None] - 0.05
                mx = q.max(axis=0)
                q = np.where(mx > 1, q / np.maximum(mx, 1e-6), q)
            else:
                q = Lo[None]
            q = np.clip(q, 0, 1).astype(np.float32)
            L1 = P._lum(q)
            m1 = _medidas(L1, mascara, centro, rmax)
            fal = []
            if m0["brillo_bulbo"] and m1["brillo_bulbo"] < brillo_min * m0["brillo_bulbo"]:
                fal.append(f"el bulbo se apaga: brillo {m1['brillo_bulbo']} < {brillo_min} × {m0['brillo_bulbo']}")
            if m1["anillos_pct"] - m0["anillos_pct"] > anillos_max:
                fal.append(f"anillos nuevos: el perfil sube hacia fuera un {m1['anillos_pct']} % (antes {m0['anillos_pct']} %)")
            if m0["meseta_radio_px"] and m1["meseta_radio_px"] >= m0["meseta_radio_px"] and m0["meseta_radio_px"] > 2:
                fal.append("la meseta no baja")
            ganancia = (100.0 * (m1["estructura_bulbo"] / m0["estructura_bulbo"] - 1)
                        if m0["estructura_bulbo"] and m1["estructura_bulbo"] else None)
            res = P._a_siril(q if x.shape[0] == 3 else q[0], crudo.dtype)
            res = res.reshape(crudo.shape)
            cid = P._guardar_candidato(grupo, n, res, {"nombre": nombre, "comando": nombre, "huella_base": huella})
            r["candidatos"].append({"id": cid, "metodo": nombre, "medidas": m1,
                                    "estructura_ganada_pct": _r(ganancia, 1), "no_cumple": fal,
                                    "segundos": _r(time.perf_counter() - t0, 1)})
        except Exception as e:
            r["errores"].append(f"{nombre}: {e}")
    ok = [x for x in r["candidatos"] if not x["no_cumple"]]
    if ok:
        # más estructura, menos meseta, y penaliza apagar el bulbo (×0,75 dejaba un bulbo gris y plano, M31)
        def nota(x):
            caida = 100.0 * (1 - (x["medidas"]["brillo_bulbo"] or 0) / max(m0["brillo_bulbo"] or 1e-6, 1e-6))
            return (x["estructura_ganada_pct"] or 0) - 2.0 * (x["medidas"]["meseta_radio_px"] or 0) - 1.5 * max(caida, 0)
        mejor = max(ok, key=nota)
        r["recomendado"] = mejor["id"]
        mm = mejor["medidas"]
        r["motivo"] = (f"{mejor['metodo']}: meseta {m0['meseta_radio_px']} → {mm['meseta_radio_px']} px, estructura del bulbo "
                       f"+{mejor['estructura_ganada_pct']} %, brillo {m0['brillo_bulbo']} → {mm['brillo_bulbo']}, sin anillos nuevos.")
    else:
        r["recomendado"] = None
        r["motivo"] = "Ninguno cumple (ver no_cumple): deja el núcleo como está o prueba otro umbral (desde) o radio."
    r["leyenda"] = ("meseta_radio_px: radio equivalente de lo que pasa de 0,95 en el bulbo (menos = menos quemado). "
                    "anillos_pct: mayor subida del perfil radial hacia fuera, en % del pico (un halo o anillo artificial). "
                    "brillo_bulbo: mediana dentro del bulbo (no debe caer por debajo del "
                    f"{int(brillo_min * 100)} %). estructura_bulbo: detalle de 4 px dentro del bulbo. Va antes de saturar. "
                    "La imagen NO ha cambiado: aplicarCandidato(id).")
    P._asegurar_restaurado(siril, crudo, huella, r)
    P._galeria(r, info, p, "diferencia")
    return r


# --- Compresión HDR multiescala (27 nov 2026) --------------------------------------------------------------------
# Rafael activó el script HDR_multiscale de Siril (GPL) y pidió tenerlo como candidato. Escrito DESDE CERO, sin mirar ni
# copiar su código: es la idea clásica de compresión de rango por escalas (como HDRMultiscaleTransform en PixInsight).
# La luminancia se descompone con la transformada à trous (núcleo B3 1-4-6-4-1, «con agujeros»); en las zonas brillantes
# (máscara suave sobre la capa residual) se comprime la residual con una curva racional y se refuerzan algo las capas de
# detalle, así la estructura de dentro de la zona quemada se ve. Fuera de la máscara no cambia nada. Sirve para cualquier
# objeto con zonas brillantes (núcleos, nebulosas brillantes como el Trapecio), no sólo bulbos de galaxia.

def _atrous(L, niveles):
    """Capas de detalle w_1..w_n y residual c_n de la transformada à trous B3 (bordes por reflexión)."""
    k = np.array([1, 4, 6, 4, 1], np.float32) / 16.0
    c = L.astype(np.float32)
    capas = []
    for j in range(niveles):
        h = 2 ** j
        pad = 2 * h
        s = c
        for eje in (0, 1):
            sp = np.pad(s, [(pad, pad) if e == eje else (0, 0) for e in (0, 1)], mode="reflect")
            n = s.shape[eje]
            acc = np.zeros_like(s)
            for i, kv in enumerate(k):
                ini = i * h
                acc += kv * (sp[ini:ini + n] if eje == 0 else sp[:, ini:ini + n])
            s = acc
        capas.append(c - s)
        c = s
    return capas, c


def _medidas_hdr(L, mascara):
    dentro = mascara > 0.5
    return {"quemado_pct": _r(100.0 * float((L[dentro] >= 0.95).mean()) if dentro.any() else 0.0, 2),
            "brillo_zona": _r(float(np.median(L[dentro])) if dentro.any() else None, 4),
            "estructura_zona": _r(P._contraste_local(L, dentro, r=4) if dentro.any() else None, 5)}


def hdrCandidatos(siril, fuerzas=(0.3, 0.5, 0.8), desde=None, niveles=None, tipo=None, brillo_min=0.75):
    """Compresión HDR multiescala (no lineal, tras estirar, antes de saturar): compara varias fuerzas. La imagen no
    cambia: aplicarCandidato(id)."""
    info = H._info(siril)
    crudo = P._crudo(siril)
    p = P._pantalla(crudo, info)
    if P._lineal(p):
        raise RuntimeError("La imagen parece lineal: la compresión HDR va después de estirar (y antes de saturar).")
    x = P._de_siril(crudo)
    L = P._lum(x)
    W = max(L.shape)
    n = int(niveles or max(5, min(8, int(np.log2(W / 48)))))      # residual del orden de 1/30–1/50 del lado
    capas, R = _atrous(L, n)
    u = float(desde) if desde is not None else max(0.5, float(np.percentile(R, 99.0)) - 0.25)
    techo = float(R.max())
    if techo <= u + 0.03:
        raise RuntimeError(f"No hay zonas brillantes que comprimir (máximo de la escala grande {techo:.2f}, umbral "
                           f"{u:.2f}): no aplica.")
    t = np.clip((R - u) / max(techo - u, 1e-6), 0, 1)
    mascara = P._suave((t * t * (3 - 2 * t)).astype(np.float32), 2 ** max(1, n - 3))
    m0 = _medidas_hdr(L, mascara)
    huella = P._huella(crudo)
    grupo = "hdr"
    P._limpiar_grupo(grupo)
    r = {"umbral": _r(u, 3), "niveles": n, "zona_pct_imagen": _r(100.0 * float((mascara > 0.5).mean()), 3),
         "antes": m0, "candidatos": [], "errores": []}
    medias = sum(capas[1:max(2, n - 1)])                           # detalle medio (sin la capa más fina, que es ruido)
    for i, k in enumerate(fuerzas, 1):
        t0 = time.perf_counter()
        nombre = f"compresión HDR multiescala ×{k:g}"
        try:
            # curva racional sobre lo que la residual pasa del umbral: f(0)=0, pendiente 1 en 0, se aplana arriba
            e = np.maximum(R - u, 0)
            e_c = e / (1.0 + 4.0 * k * e / max(techo - u, 1e-6))
            Lo = L + mascara * (e_c - e) + 0.6 * k * mascara * medias
            Lo = np.clip(Lo, 0, 1)
            if x.shape[0] == 3:
                f = (Lo + 0.05) / np.maximum(L + 0.05, 1e-6)
                q = (x + 0.05) * f[None] - 0.05
                mx = q.max(axis=0)
                q = np.where(mx > 1, q / np.maximum(mx, 1e-6), q)
            else:
                q = Lo[None]
            q = np.clip(q, 0, 1).astype(np.float32)
            L1 = P._lum(q)
            m1 = _medidas_hdr(L1, mascara)
            fal = []
            if m0["brillo_zona"] and m1["brillo_zona"] < brillo_min * m0["brillo_zona"]:
                fal.append(f"la zona brillante se apaga: {m1['brillo_zona']} < {brillo_min} × {m0['brillo_zona']}")
            if m0["estructura_zona"] and m1["estructura_zona"] and m1["estructura_zona"] < m0["estructura_zona"]:
                fal.append("no gana estructura en la zona brillante")
            if m0["quemado_pct"] is not None and m1["quemado_pct"] is not None and m1["quemado_pct"] > m0["quemado_pct"] + 0.05:
                fal.append(f"quema más: {m0['quemado_pct']} → {m1['quemado_pct']} % de la zona por encima de 0,95")
            ganancia = (100.0 * (m1["estructura_zona"] / m0["estructura_zona"] - 1)
                        if m0["estructura_zona"] and m1["estructura_zona"] else None)
            res = P._a_siril(q if x.shape[0] == 3 else q[0], crudo.dtype).reshape(crudo.shape)
            cid = P._guardar_candidato(grupo, i, res, {"nombre": nombre, "comando": nombre, "huella_base": huella})
            r["candidatos"].append({"id": cid, "metodo": nombre, "medidas": m1, "estructura_ganada_pct": _r(ganancia, 1),
                                    "no_cumple": fal, "segundos": _r(time.perf_counter() - t0, 1)})
        except Exception as e:
            r["errores"].append(f"{nombre}: {e}")
    ok = [c for c in r["candidatos"] if not c["no_cumple"]]
    if ok:
        def nota(c):
            caida = 100.0 * (1 - (c["medidas"]["brillo_zona"] or 0) / max(m0["brillo_zona"] or 1e-6, 1e-6))
            return (c["estructura_ganada_pct"] or 0) - 1.0 * (c["medidas"]["quemado_pct"] or 0) - 1.5 * max(caida, 0)
        mejor = max(ok, key=nota)
        mm = mejor["medidas"]
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: quemado {m0['quemado_pct']} → {mm['quemado_pct']} %, estructura de la zona "
                       f"brillante +{mejor['estructura_ganada_pct']} %, brillo {m0['brillo_zona']} → {mm['brillo_zona']}.")
    else:
        r["recomendado"] = None
        r["motivo"] = "Ninguno cumple (ver no_cumple): deja la imagen como está o prueba otro umbral (desde)."
    r["leyenda"] = ("quemado_pct: % de la zona brillante por encima de 0,95. estructura_zona: detalle de 4 px dentro de la "
                    f"zona. brillo_zona: mediana dentro (no debe caer por debajo del {int(brillo_min * 100)} %). En galaxias "
                    "compáralo con nucleoCandidatos. Va antes de saturar. La imagen NO ha cambiado: aplicarCandidato(id).")
    P._asegurar_restaurado(siril, crudo, huella, r)
    P._galeria(r, info, p, "diferencia")
    return r


LISTA_NUCLEO = {"nucleoCandidatos": nucleoCandidatos, "hdrCandidatos": hdrCandidatos}
