# SetiAstroPilot — utilidades con funciones sin ventana de SASpro: alinear por estrellas, Cosmetic Correction, quitar
# el pedestal y medir las estrellas (FWHM, excentricidad).
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
# (16 nov 2026, SASpro 1.24.4.)

import numpy as np

import herramientas as H
import medidas as M

_r = H._r


def _nueva(ctx, d, arr_p, nombre):
    """Vista nueva con la imagen (canales, alto, ancho) y los metadatos de d (sin fichero)."""
    m = dict(H._meta(d))
    m.pop("file_path", None)
    m.update(display_name=nombre, mono=arr_p.shape[0] == 1)
    img = arr_p[0] if arr_p.shape[0] == 1 else np.moveaxis(arr_p, 0, -1)
    nv = ctx.open_new_document(np.ascontiguousarray(img, dtype=np.float32), metadata=m, name=nombre)
    return H._nombre(H._base(nv)) if nv is not None else nombre


def alinearPorEstrellas(ctx, vistas, referencia=None):
    """L5 sin astrometría: alinea vistas contra la de referencia emparejando estrellas (astroalign de SASpro: triángulos
    y voto, con rotación, escala y espejo). Cada vista alineada sale en una vista nueva <nombre>_alin del tamaño de la
    referencia (0 donde no hay datos). Para masters con astrometría es mejor alinearMasters."""
    from setiastro.saspro.astroalign import apply_transform, find_transform
    if isinstance(vistas, str):
        vistas = [v.strip() for v in vistas.split(";") if v.strip()]
    if not vistas:
        raise ValueError("Faltan las vistas.")
    ref = H._doc(ctx, referencia or vistas[0])
    pr = H._p(ref.image)
    Lr = M.lum(pr)
    filas = []
    for v in vistas:
        d = H._doc(ctx, v)
        if d is ref:
            continue
        p = H._p(d.image)
        try:
            T, (s, t) = find_transform(M.lum(p), Lr)
        except Exception as e:
            filas.append({"vista": H._nombre(d), "error": str(e)[:200]})
            continue
        canales, hueco = [], None
        for c in range(p.shape[0]):
            a, fp = apply_transform(T, p[c], Lr, fill_value=0.0)
            canales.append(np.asarray(a, dtype=np.float32))
            hueco = fp if hueco is None else (hueco | fp)
        q = np.clip(np.stack(canales), 0, 1)
        nombre = _nueva(ctx, d, q, f"{H._nombre(d)}_alin")
        fila = {"vista": H._nombre(d), "alineada": nombre, "estrellas_emparejadas": int(len(s)),
                "sin_datos_pct": _r(100.0 * float(np.mean(hueco)), 2) if hueco is not None else None}
        for k, attr in (("escala", "scale"), ("rotacion_grados", "rotation")):
            try:
                val = float(np.ravel(getattr(T, attr))[0])
                fila[k] = _r(np.degrees(val) if attr == "rotation" else val, 4)
            except Exception:
                pass
        try:
            tx, ty = (float(x) for x in np.ravel(T.translation)[:2])
            fila["desplazamiento_px"] = [_r(tx, 2), _r(ty, 2)]
        except Exception:
            pass
        filas.append(fila)
    H._reactivar(ctx, ref)
    return {"referencia": H._nombre(ref), "vistas": filas,
            "nota": "Revisa con previa un recorte de estrellas en una esquina (sin dobles ni estelas). Los bordes sin "
                    "datos se recortan después (zona común)."}


def correccionCosmetica(ctx, vista=None, hot_sigma=None, cold_sigma=None, protect_sigma=None, calientes=True,
                        frios=True, bayer=None):
    """L2/L7: Cosmetic Correction de SASpro sobre la vista (píxeles calientes y fríos), con deshacer. Sin parámetros usa
    los de SASpro. bayer (RGGB, BGGR...) solo para un master OSC sin debayer. Devuelve cuántos píxeles cambiaron."""
    from setiastro.saspro.cosmetic_correction import cosmetic_correction_headless
    d = H._doc(ctx, vista)
    a0 = np.array(d.image, dtype=np.float32, copy=True)
    kw = {"correct_hot": bool(calientes), "correct_cold": bool(frios)}
    for k, v in (("hot_sigma", hot_sigma), ("cold_sigma", cold_sigma), ("protect_sigma", protect_sigma),
                 ("bayer_pattern", bayer)):
        if v is not None:
            kw[k] = v
    cosmetic_correction_headless(d, **kw)
    a1 = np.asarray(d.image, dtype=np.float32)
    cambio = np.abs(a1 - a0) > 1e-6
    if cambio.ndim == 3:
        cambio = cambio.any(axis=2)
    return {"vista": H._nombre(d), "pixeles_cambiados": int(cambio.sum()),
            "pixeles_cambiados_ppm": _r(1e6 * float(cambio.mean()), 1), "parametros": kw,
            "nota": "Si cambian más de unos cientos de ppm, baja la sensibilidad (sube hot_sigma/cold_sigma)."}


def quitarPedestal(ctx, vista=None, modo="percentile", pct=0.1, por_canal=True):
    """L lineal: resta el pedestal de la vista como Pedestal Removal de SASpro, con deshacer. modo: min (el
    mínimo de cada canal), percentile (el percentil pct, por defecto 0,1: no lo decide un píxel muerto) o
    first_nonzero. Devuelve lo restado por canal."""
    # Mismo criterio que Pedestal Removal de SASpro (_pedestal_scalar), hecho aquí: su remove_pedestal_array falla con
    # imágenes en color en 1.24.4 («inhomogeneous shape»).
    if modo not in ("min", "percentile", "first_nonzero"):
        raise ValueError("modo: min, percentile o first_nonzero.")
    d = H._doc(ctx, vista)
    p = H._p(d.image)

    def valor(x):
        if modo == "percentile":
            return float(np.percentile(x, float(pct)))
        if modo == "first_nonzero":
            nz = x[x > 0]
            return float(nz.min()) if nz.size else 0.0
        return float(x.min())

    restado = [valor(p[c]) for c in range(p.shape[0])] if por_canal else [valor(p)] * p.shape[0]
    q = np.clip(p - np.array(restado, dtype=np.float32)[:, None, None], 0, 1).astype(np.float32)
    d.apply_edit(H._a_sas(q, d.image), metadata={}, step_name=f"Pedestal Removal ({modo})")
    return {"vista": H._nombre(d), "restado": [_r(x, 6) for x in restado],
            "ceros_pct": M.recortes(q)["ceros_pct"], "mediana": _r(float(np.median(q[:, ::4, ::4])), 5)}


def medirEstrellas(ctx, vista=None, sigma=5.0):
    """Mide las estrellas de la vista: número, FWHM y excentricidad medianas con SEP (la medida de SASpro) y la FWHM
    por momentos de SetiAstroPilot. Con FOCALLEN y XPIXSZ en la cabecera, también en segundos de arco. Solo lectura."""
    from setiastro.saspro.star_metrics import measure_stars_sep
    d = H._doc(ctx, vista)
    p = H._p(d.image)
    L = M.lum(p)
    lo, hi = float(np.percentile(L[::4, ::4], 0.1)), float(L.max())
    Ln = np.clip((L - lo) / max(hi - lo, 1e-9), 0, 1).astype(np.float32)
    r = {"vista": H._nombre(d)}
    try:
        n, fw, ecc = measure_stars_sep(Ln, thresh_sigma=float(sigma))
        r.update(estrellas=int(n), fwhm_px=_r(float(fw), 2), excentricidad=_r(float(ecc), 3))
    except Exception as e:
        r["sep_error"] = str(e)[:200]
    fw2, n2 = H._fwhm_estrellas(L)
    r.update(fwhm_momentos_px=_r(fw2, 2), estrellas_momentos=n2)
    cab = H._cabecera(d) or {}
    try:
        esc = 206.265 * float(cab.get("XPIXSZ")) / float(cab.get("FOCALLEN"))
        r["escala_arcsec_px"] = _r(esc, 3)
        if r.get("fwhm_px"):
            r["fwhm_arcsec"] = _r(r["fwhm_px"] * esc, 2)
    except (TypeError, ValueError, ZeroDivisionError):
        pass
    if r.get("excentricidad") is not None and r["excentricidad"] > 0.6:
        r["aviso"] = "Excentricidad > 0,6: estrellas alargadas (guiado, inclinación del sensor o óptica)."
    return r


LISTA_UTILIDADES = {"alinearPorEstrellas": alinearPorEstrellas, "correccionCosmetica": correccionCosmetica,
                    "quitarPedestal": quitarPedestal, "medirEstrellas": medirEstrellas}
