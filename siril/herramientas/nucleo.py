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
                f = Lo / np.maximum(L, 1e-6)
                q = x * f[None]
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


LISTA_NUCLEO = {"nucleoCandidatos": nucleoCandidatos}
