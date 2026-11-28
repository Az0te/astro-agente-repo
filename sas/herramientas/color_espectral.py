# SetiAstroPilot — calibración de color espectrofotométrica propia (L12), sin la ventana de SFCC.
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# SFCC y SSSC de SASpro sólo existen con ventana (SFCCDialog.fetch_stars / run_spcc, con avisos modales al final; no
# están en ops.commands de la 2.0.1). Esto hace el mismo cálculo sin ventana y con los mismos datos de SASpro:
#   1. estrellas de la imagen (máximos locales de la luminancia, sin saturadas ni pegadas), fotometría de apertura
#      por canal con el fondo de un anillo;
#   2. su posición en el cielo con la astrometría de la vista y el cruce con Gaia DR3 (G, BP−RP, Teff GSP-Phot);
#   3. para cada estrella, la plantilla de Pickles de SASP_data.fits más cercana en color, integrada en fotones por
#      las curvas reales de la cadena (filtros R, G, B × QE del sensor, de SASP_data.fits), frente a la misma
#      integral para la referencia de blanco (G2V por defecto);
#   4. las ganancias R/G y B/G que llevan cada estrella a su color esperado (mediana con rechazo 3σ MAD).
# Además da las ganancias que saldrían de suponer la estrella media blanca (lo que hace White Balance) para comparar.
# Con BP−RP observado la plantilla ya lleva el enrojecimiento interestelar (con el tipo espectral de SIMBAD no).
# Sólo consulta coordenadas del campo a Gaia (ESA o VizieR); se niega con la casilla Internet desmarcada.

import json
import math
import os
from pathlib import Path
import ssl
import urllib.parse
import urllib.request

import numpy as np

import herramientas as H

UA = "SetiAstroPilot/0.1 (astrophotography processing assistant)"
GAIA_ESA = "https://gea.esac.esa.int/tap-server/tap/sync"
GAIA_VIZIER = "https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync"

# Teff de las enanas de Pickles (Pecaut y Mamajek 2013, tabla de enanas) y su BP−RP (misma tabla).
_ENANAS = [("O5V", 41400, -0.35), ("O9V", 31500, -0.33), ("B0V", 31400, -0.32), ("B1V", 26000, -0.29),
           ("B3V", 17000, -0.22), ("B57V", 15000, -0.17), ("B8V", 12500, -0.11), ("B9V", 10700, -0.05),
           ("A0V", 9700, 0.00), ("A2V", 8840, 0.06), ("A3V", 8550, 0.09), ("A5V", 8080, 0.18),
           ("A7V", 7650, 0.26), ("F0V", 7220, 0.36), ("F2V", 6810, 0.47), ("F5V", 6510, 0.58),
           ("F6V", 6340, 0.62), ("F8V", 6170, 0.68), ("G0V", 5920, 0.74), ("G2V", 5770, 0.80),
           ("G5V", 5660, 0.84), ("G8V", 5490, 0.90), ("K0V", 5280, 0.98), ("K2V", 5040, 1.08),
           ("K3V", 4830, 1.17), ("K4V", 4600, 1.28), ("K5V", 4440, 1.38), ("K7V", 4050, 1.64),
           ("M0V", 3850, 1.84), ("M1V", 3660, 2.03), ("M2V", 3560, 2.19), ("M3V", 3430, 2.40),
           ("M4V", 3210, 2.77), ("M5V", 3060, 3.20)]

# Cadenas de filtros conocidas (nombres de SASP_data.fits).
CADENAS = {
    "astrodon_e": ("ASTRODON_E-SERIES_R", "ASTRODON_E-SERIES_G", "ASTRODON_E-SERIES_B"),
    "astrodon_i": ("ASTRODON_I-SERIES_R", "ASTRODON_I-SERIES_G", "ASTRODON_I-SERIES_B"),
}


def _sasp_data():
    cands = []
    try:
        import setiastro
        base = os.path.dirname(os.path.dirname(os.path.abspath(setiastro.__file__)))
        cands.append(os.path.join(base, "data", "SASP_data.fits"))
    except Exception:
        pass
    cands.append(r"C:\Program Files\SetiAstroSuitePro\_internal\data\SASP_data.fits")
    for c in cands:
        if os.path.exists(c):
            return c
    raise RuntimeError("No encuentro SASP_data.fits de SASpro (curvas de filtros y plantillas).")


_CACHE = {}


def _curvas():
    if "h" not in _CACHE:
        from astropy.io import fits
        h = fits.open(_sasp_data(), memmap=False)
        tabla = {}
        for x in h[1:]:
            try:
                tabla.setdefault(x.name.upper(), (str(x.header.get("CTYPE", "")), np.asarray(x.data["WAVELENGTH"], float),
                                                  np.asarray(x.data[x.data.columns.names[1]], float)))
            except Exception:
                continue
        _CACHE["h"] = tabla
    return _CACHE["h"]


def listaCurvas(ctx, tipo=None, buscar=None):
    """Curvas de SASP_data.fits (filtros, sensores, plantillas SED), filtradas por tipo y texto."""
    t = _curvas()
    r = [k for k, v in t.items() if (not tipo or v[0].upper() == str(tipo).upper()) and
         (not buscar or str(buscar).upper() in k)]
    return {"curvas": sorted(r), "n": len(r)}


def _interp(nombre, wl):
    t = _curvas()
    k = str(nombre).upper()
    if k not in t:
        raise RuntimeError(f"No existe la curva '{nombre}' en SASP_data.fits (mira listaCurvas).")
    _, w, v = t[k]
    o = np.argsort(w)
    return np.interp(wl, w[o], v[o], left=0.0, right=0.0)


def _respuestas(filtros, sensor, lp=None):
    wl = np.arange(3500.0, 10500.0, 5.0)
    qe = _interp(sensor, wl) if sensor else np.ones_like(wl)
    extra = np.ones_like(wl)
    for x in (lp or []):
        if x:
            extra = extra * _interp(x, wl)
    return wl, [_interp(f, wl) * qe * extra for f in filtros]


_trap = getattr(np, "trapezoid", None) or getattr(np, "trapz")


def _integrales(sed, wl, resp):
    if isinstance(sed, tuple):  # espectro medido (wl_Å, flujo)
        o = np.argsort(sed[0])
        f = np.interp(wl, sed[0][o], sed[1][o], left=0.0, right=0.0)
    else:
        f = _interp(sed, wl)
    # fotones: F_λ · λ
    return np.array([_trap(f * r * wl, wl) for r in resp])


def _plantilla(bp_rp=None, teff=None):
    if bp_rp is not None and np.isfinite(bp_rp):
        i = int(np.argmin([abs(b - bp_rp) for _, _, b in _ENANAS]))
    elif teff is not None and np.isfinite(teff):
        i = int(np.argmin([abs(math.log(t) - math.log(teff)) for _, t, _ in _ENANAS]))
    else:
        return None
    return _ENANAS[i][0]


# ---------------------------------------------------------------- estrellas y fotometría

def _estrellas(p, max_n=1500, sat=0.92):
    """Máximos locales de la luminancia > 15σ del cielo, sin saturados (pico de algún canal ≥ sat del máximo del
    canal o ≥ 0,98), sin vecinas a menos de 12 px y lejos del borde. Devuelve x, y (float) y el pico."""
    from scipy import ndimage as ndi
    lum = p.mean(0)
    sub = lum[::4, ::4]
    med = float(np.median(sub))
    sig = 1.4826 * float(np.median(np.abs(sub - med))) or 1e-6
    suave = ndi.gaussian_filter(lum, 1.0)
    mx = ndi.maximum_filter(suave, size=9)
    pico = (suave == mx) & (suave > med + 15 * sig)
    ys, xs = np.nonzero(pico)
    H_, W_ = lum.shape
    borde = 20
    ok = (xs > borde) & (xs < W_ - borde) & (ys > borde) & (ys < H_ - borde)
    ys, xs = ys[ok], xs[ok]
    techo = [min(0.98, sat * float(p[c].max())) for c in range(p.shape[0])]
    picos_c = np.stack([ndi.maximum_filter(p[c], size=5)[ys, xs] for c in range(p.shape[0])])
    nosat = np.all(picos_c < np.array(techo)[:, None], axis=0)
    ys, xs = ys[nosat], xs[nosat]
    v = suave[ys, xs]
    # aisladas: nada más brillante que el 10 % de la estrella a menos de 12 px
    from scipy.spatial import cKDTree
    if len(xs) > 1:
        t = cKDTree(np.c_[xs, ys])
        pares = t.query_pairs(12.0)
        malas = set()
        for a, b in pares:
            malas.add(a)
            malas.add(b)
        keep = np.array([i not in malas for i in range(len(xs))])
        xs, ys, v = xs[keep], ys[keep], v[keep]
    o = np.argsort(-v)[:max_n]
    # centroide 5x5
    cx, cy = [], []
    for x, y in zip(xs[o], ys[o]):
        w = lum[y - 2:y + 3, x - 2:x + 3] - med
        w = np.clip(w, 0, None)
        s = w.sum() or 1.0
        gy, gx = np.mgrid[-2:3, -2:3]
        cx.append(x + float((w * gx).sum() / s))
        cy.append(y + float((w * gy).sum() / s))
    return np.array(cx), np.array(cy), v[o]


def _fwhm(lum, xs, ys):
    """FWHM mediana (px) por momentos de segundo orden de las 60 primeras estrellas."""
    f = []
    for x, y in zip(xs[:60], ys[:60]):
        xi, yi = int(round(x)), int(round(y))
        w = lum[yi - 7:yi + 8, xi - 7:xi + 8].astype(float)
        if w.shape != (15, 15):
            continue
        w = np.clip(w - np.median(lum[yi - 15:yi + 16, xi - 15:xi + 16]), 0, None)
        s = w.sum()
        if s <= 0:
            continue
        gy, gx = np.mgrid[-7:8, -7:8]
        mx_, my_ = (w * gx).sum() / s, (w * gy).sum() / s
        var = ((w * ((gx - mx_) ** 2 + (gy - my_) ** 2)).sum() / s) / 2
        if var > 0:
            f.append(2.3548 * math.sqrt(var))
    return float(np.median(f)) if f else 3.0


def _fotometria(p, xs, ys, r, rin, rout):
    """Suma en un círculo de radio r menos la mediana del anillo rin–rout × área, por canal."""
    n = len(xs)
    out = np.full((p.shape[0], n), np.nan)
    R = int(math.ceil(rout)) + 1
    gy, gx = np.mgrid[-R:R + 1, -R:R + 1]
    for i, (x, y) in enumerate(zip(xs, ys)):
        xi, yi = int(round(x)), int(round(y))
        if yi - R < 0 or xi - R < 0 or yi + R + 1 > p.shape[1] or xi + R + 1 > p.shape[2]:
            continue
        d2 = (gx - (x - xi)) ** 2 + (gy - (y - yi)) ** 2
        ap = d2 <= r * r
        an = (d2 >= rin * rin) & (d2 <= rout * rout)
        for c in range(p.shape[0]):
            w = p[c, yi - R:yi + R + 1, xi - R:xi + R + 1]
            fondo = float(np.median(w[an]))
            out[c, i] = float(w[ap].sum() - fondo * ap.sum())
    return out


# ---------------------------------------------------------------- astrometría y Gaia

def _wcs(d):
    from astropy.wcs import WCS
    m = H._meta(d)
    h = H._cabecera_para_guardar(m, np.shape(d.image)[:2])
    if h is None or not h.get("CTYPE1"):
        raise RuntimeError("La vista no tiene astrometría: resolverAstrometria primero.")
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return WCS(h, naxis=2)


def _get(url, datos=None, timeout=60):
    if (H.DATOS / "sin-internet").exists():
        raise RuntimeError("Internet está desactivado (casilla «Internet» del chat sin marcar). No reintentar.")
    req = urllib.request.Request(url, data=datos, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as f:
        return f.read().decode("utf-8", errors="replace")


SIRIL_CAT = Path(os.environ.get("LOCALAPPDATA", "")) / "siril" / "siril_cat_healpix8_astro.dat"
_NSIDE = 256  # HEALPix nivel 8, esquema anidado


def _ang2pix_nest(ra, dec, nside=_NSIDE):
    """HEALPix anidado (algoritmo de Górski et al. 2005), vectorizado, sin healpy."""
    ra = np.radians(np.asarray(ra, float))
    z = np.sin(np.radians(np.asarray(dec, float)))
    za = np.abs(z)
    tt = np.mod(ra, 2 * np.pi) * (2 / np.pi)
    face = np.zeros(z.shape, np.int64)
    ix = np.zeros(z.shape, np.int64)
    iy = np.zeros(z.shape, np.int64)
    ec = za <= 2.0 / 3.0
    t1 = nside * (0.5 + tt[ec])
    t2 = nside * z[ec] * 0.75
    jp = (t1 - t2).astype(np.int64)
    jm = (t1 + t2).astype(np.int64)
    ifp, ifm = jp // nside, jm // nside
    face[ec] = np.where(ifp == ifm, ifp | 4, np.where(ifp < ifm, ifp, ifm + 8))
    ix[ec] = jm & (nside - 1)
    iy[ec] = nside - (jp & (nside - 1)) - 1
    po = ~ec
    ntt = np.minimum(3, tt[po].astype(np.int64))
    tp = tt[po] - ntt
    tmp = nside * np.sqrt(3 * (1 - za[po]))
    jp = np.minimum((tp * tmp).astype(np.int64), nside - 1)
    jm = np.minimum(((1 - tp) * tmp).astype(np.int64), nside - 1)
    norte = z[po] >= 0
    face[po] = np.where(norte, ntt, ntt + 8)
    ix[po] = np.where(norte, nside - jm - 1, jp)
    iy[po] = np.where(norte, nside - jp - 1, jm)

    def _esparcir(v):
        r = np.zeros_like(v)
        for b in range(int(math.log2(nside))):
            r |= ((v >> b) & 1) << (2 * b)
        return r
    return face * nside * nside + (_esparcir(ix) | (_esparcir(iy) << 1))


def _gaia_local(ra, dec, radio, gmax, gmin, top=6000):
    """Gaia DR3 del catálogo astrométrico local de Siril (siril_cat_healpix8_astro.dat, 95 M de estrellas, G < ~19):
    cabecera de 128 bytes, índice acumulado de 12·256² uint32 y registros de 16 bytes (ra, dec en int32 ·360/2³¹,
    movimiento propio, Teff en K y G·1000). No trae BP−RP: la plantilla sale de la Teff de Gaia (GSP-Phot)."""
    if not SIRIL_CAT.exists():
        return None
    npix = 12 * _NSIDE * _NSIDE
    idx = np.fromfile(SIRIL_CAT, dtype="<u4", count=npix, offset=128).astype(np.int64)
    paso = 0.05  # grados; el píxel HEALPix de nivel 8 mide ~0,23°
    cd = max(math.cos(math.radians(dec)), 0.05)
    dd = np.arange(-radio - paso, radio + 2 * paso, paso)
    rr = np.arange(-(radio + paso) / cd, (radio + 2 * paso) / cd, paso / cd)
    g_ra, g_de = np.meshgrid(ra + rr, np.clip(dec + dd, -90, 90))
    pix = np.unique(_ang2pix_nest(g_ra.ravel(), g_de.ravel()))
    dt = np.dtype([("ra", "<i4"), ("dec", "<i4"), ("pmra", "<i2"), ("pmdec", "<i2"), ("teff", "<i2"), ("g", "<u2")])
    base = 128 + npix * 4
    trozos = []
    with open(SIRIL_CAT, "rb") as f:
        for k in pix:
            i0 = int(idx[k - 1]) if k > 0 else 0
            n = int(idx[k]) - i0
            if n > 0:
                f.seek(base + i0 * dt.itemsize)
                trozos.append(np.frombuffer(f.read(n * dt.itemsize), dtype=dt))
    if not trozos:
        return []
    a = np.concatenate(trozos)
    sra = a["ra"].astype(float) * 360.0 / 2 ** 31 % 360.0
    sde = a["dec"].astype(float) * 360.0 / 2 ** 31
    g = a["g"].astype(float) / 1000.0
    te = a["teff"].astype(float)
    te[te <= 0] = np.nan
    r1, d1, r2, d2 = map(np.radians, (sra, sde, ra, dec))
    sep = np.degrees(np.arccos(np.clip(np.sin(d1) * np.sin(d2) + np.cos(d1) * np.cos(d2) * np.cos(r1 - r2), -1, 1)))
    ok = (sep <= radio) & (g >= gmin) & (g <= gmax) & np.isfinite(te)
    orden = np.argsort(g[ok])[:top]
    return [(float(x), float(y), float(m), float("nan"), float(t))
            for x, y, m, t in zip(sra[ok][orden], sde[ok][orden], g[ok][orden], te[ok][orden])]


SAS_XP = Path(os.environ.get("APPDATA", "")) / "SetiAstro" / "Seti Astro Suite Pro" / "gaia_library"


def _xp_local(ra, dec, radio, gmax, gmin):
    """Espectros XP medidos de Gaia DR3 de la biblioteca local de SASpro (gaia_library/gaia_xp_*.sqlite, por
    tramos de G; xp_sampled_mean_spectrum de 336 a 1020 nm cada 2 nm en W m⁻² nm⁻¹, float32 con zlib).
    Devuelve [(ra, dec, G, bp_rp, nan, (wl_Å, flujo))] o [] si no hay biblioteca."""
    import sqlite3
    import zlib
    if not SAS_XP.is_dir():
        return []
    cd = max(math.cos(math.radians(dec)), 0.05)
    r = []
    for f in sorted(SAS_XP.glob("gaia_xp_*.sqlite")):
        try:
            c = sqlite3.connect(f"file:{f.as_posix()}?mode=ro", uri=True)
            meta = dict(c.execute("select key, value from metadata").fetchall())
            w0, paso, n = float(meta["wavelength_start"]), float(meta["wavelength_step"]), int(meta["n_wavelengths"])
            wl = (w0 + paso * np.arange(n)) * 10.0
            filas = c.execute(
                "select s.ra, s.dec, s.phot_g_mean_mag, s.bp_rp, x.flux_compressed from sources s join spectra x "
                "on s.source_id = x.source_id where s.ra between ? and ? and s.dec between ? and ? and "
                "s.phot_g_mean_mag between ? and ?",
                (ra - radio / cd, ra + radio / cd, dec - radio, dec + radio, gmin, gmax)).fetchall()
            c.close()
        except Exception:
            continue
        for a, b, g, bprp, blob in filas:
            try:
                fl = np.frombuffer(zlib.decompress(blob), "<f4").astype(float)
            except Exception:
                continue
            if fl.size == wl.size and np.isfinite(fl).all():
                r.append((float(a), float(b), float(g), float(bprp) if bprp is not None else float("nan"),
                          float("nan"), (wl, fl)))
    return r


def _mezclar(xp, resto, tol_arcsec=1.5):
    """Las estrellas con espectro XP sustituyen a la misma estrella del catálogo sin espectro."""
    if not xp:
        return resto
    from scipy.spatial import cKDTree

    def _v(c):
        a, d = np.radians([x[0] for x in c]), np.radians([x[1] for x in c])
        return np.c_[np.cos(d) * np.cos(a), np.cos(d) * np.sin(a), np.sin(d)]
    t = cKDTree(_v(xp))
    if not resto:
        return list(xp)
    dist, _ = t.query(_v(resto), distance_upper_bound=np.radians(tol_arcsec / 3600))
    return list(xp) + [c for c, dd in zip(resto, dist) if not np.isfinite(dd)]


def _gaia(ra, dec, radio, gmax, gmin, top=6000):
    """Gaia DR3 del campo: [(ra, dec, G, bp_rp, teff)]. Primero el catálogo local de Siril; si no está, el archivo
    de la ESA y luego VizieR."""
    errores = []
    try:
        loc = _gaia_local(ra, dec, radio, gmax, gmin, top)
        try:
            xp = _xp_local(ra, dec, radio, gmax, gmin)
        except Exception as e:
            xp = []
            errores.append(f"espectros XP de SASpro: {str(e)[:120]}")
        if loc or xp:
            fuente = "local: " + " + ".join(x for x, v in (("espectros XP de SASpro", xp), ("catálogo de Siril", loc)) if v)
            return _mezclar(xp, [c + (None,) for c in (loc or [])]), fuente, errores
        if loc is not None:
            errores.append("catálogo local: sin estrellas en el campo")
    except Exception as e:
        errores.append(f"catálogo local: {str(e)[:120]}")
    q_esa = (f"SELECT TOP {top} ra, dec, phot_g_mean_mag, bp_rp, teff_gspphot FROM gaiadr3.gaia_source WHERE "
             f"1=CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra:.6f}, {dec:.6f}, {radio:.4f})) AND "
             f"phot_g_mean_mag BETWEEN {gmin} AND {gmax} AND bp_rp IS NOT NULL ORDER BY phot_g_mean_mag")
    q_viz = (f'SELECT TOP {top} RA_ICRS, DE_ICRS, Gmag, "BP-RP", Teff FROM "I/355/gaiadr3" WHERE '
             f"1=CONTAINS(POINT('ICRS', RA_ICRS, DE_ICRS), CIRCLE('ICRS', {ra:.6f}, {dec:.6f}, {radio:.4f})) AND "
             f'Gmag BETWEEN {gmin} AND {gmax} AND "BP-RP" IS NOT NULL ORDER BY Gmag')
    for nombre, url, q in (("ESA", GAIA_ESA, q_esa), ("VizieR", GAIA_VIZIER, q_viz)):
        try:
            datos = urllib.parse.urlencode({"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json",
                                            "QUERY": q}).encode()
            t = _get(url, datos)
            j = json.loads(t)
            filas = j.get("data", [])
            r = []
            for f in filas:
                try:
                    r.append(tuple(float(x) if x is not None else float("nan") for x in f[:5]) + (None,))
                except (TypeError, ValueError):
                    continue
            if r:
                return r, nombre, errores
            errores.append(f"{nombre}: sin estrellas")
        except Exception as e:
            errores.append(f"{nombre}: {str(e)[:120]}")
    raise RuntimeError("No pude consultar Gaia DR3 (" + "; ".join(errores) + "). Puede ser una caída del servicio: "
                       "probar más tarde.")


def _cruzar(wcs, xs, ys, cat, forma, tol_px):
    from scipy.spatial import cKDTree
    ra = np.array([c[0] for c in cat])
    de = np.array([c[1] for c in cat])
    px, py = wcs.all_world2pix(ra, de, 0)
    mejor = None
    for volteo in (False, True):
        yy = (forma[0] - 1 - py) if volteo else py
        ok = np.isfinite(px) & np.isfinite(yy)
        t = cKDTree(np.c_[px[ok], yy[ok]])
        dist, idx = t.query(np.c_[xs, ys], distance_upper_bound=tol_px)
        bien = np.isfinite(dist)
        if mejor is None or bien.sum() > mejor[0]:
            orig = np.nonzero(ok)[0]
            mejor = (int(bien.sum()), volteo, bien, np.where(bien, orig[np.minimum(idx, len(orig) - 1)], -1))
    return mejor


# ---------------------------------------------------------------- herramienta

def _robusta(v, k=3.0):
    v = np.asarray(v, float)
    v = v[np.isfinite(v) & (v > 0)]
    if len(v) == 0:
        return float("nan"), 0, float("nan")
    lv = np.log(v)
    for _ in range(5):
        m = np.median(lv)
        s = 1.4826 * np.median(np.abs(lv - m)) or 1e-6
        keep = np.abs(lv - m) <= k * s
        if keep.all():
            break
        lv = lv[keep]
    return float(np.exp(np.median(lv))), int(len(lv)), float(1.4826 * np.median(np.abs(lv - np.median(lv))))


def calibrarColorEspectral(ctx, vista=None, filtros="astrodon_e", sensor="IMX571", lp=None, blanco="G2V",
                           aplicar=True, g_max=14.5, g_min=7.0, min_estrellas=50, max_estrellas=1500,
                           neutralizar_cielo=True):
    """L12: calibración espectrofotométrica sin ventana (el cálculo de SFCC). filtros: 'astrodon_e', 'astrodon_i'
    o [R, G, B] con nombres de SASP_data.fits; sensor: curva QE ('IMX571' para ATR2600M/ASI2600); blanco: plantilla
    SED de referencia (G2V o A0V). Devuelve las ganancias [R, G, B] (G = 1), las de «estrella media blanca» (White
    Balance) para comparar, estrellas usadas y dispersión. aplicar=True las aplica con deshacer: (canal − cielo) ×
    ganancia + cielo común si neutralizar_cielo; si no, canal × ganancia."""
    d = H._doc(ctx, vista)
    p = H._p(d.image).astype(np.float32)
    if p.shape[0] != 3:
        raise RuntimeError("La calibración de color necesita una imagen RGB de tres canales.")
    fil = CADENAS.get(str(filtros).lower()) if isinstance(filtros, str) else tuple(filtros)
    if not fil or len(fil) != 3:
        raise RuntimeError(f"filtros: {list(CADENAS)} o [R, G, B] de listaCurvas(tipo='FILTER').")
    wcs = _wcs(d)
    forma = p.shape[1:]
    antes = H._color(d)

    xs, ys, _ = _estrellas(p, max_n=int(max_estrellas))
    if len(xs) < min_estrellas:
        raise RuntimeError(f"Sólo {len(xs)} estrellas aisladas y sin saturar en la imagen (mínimo {min_estrellas}).")
    fw = _fwhm(p.mean(0), xs, ys)
    r = max(3.0, 2.0 * fw)
    flujos = _fotometria(p, xs, ys, r, r + 4, r + 9)

    cy, cx = (forma[0] - 1) / 2, (forma[1] - 1) / 2
    ra0, de0 = (float(v) for v in wcs.all_pix2world([[cx, cy]], 0)[0])
    esq = wcs.all_pix2world([[0, 0], [forma[1] - 1, forma[0] - 1], [0, forma[0] - 1], [forma[1] - 1, 0]], 0)
    from astropy.coordinates import SkyCoord
    import astropy.units as u
    c0 = SkyCoord(ra0 * u.deg, de0 * u.deg)
    radio = float(max(c0.separation(SkyCoord(e[0] * u.deg, e[1] * u.deg)).deg for e in esq))
    escala = float(np.mean(np.abs(np.linalg.svd(wcs.pixel_scale_matrix, compute_uv=False)))) * 3600
    cat, fuente, avisos = _gaia(ra0, de0, radio * 1.02, g_max, g_min)
    n_cruce, volteo, bien, idx = _cruzar(wcs, xs, ys, cat, forma, tol_px=max(2.0, 3.0 / escala))

    wl, resp = _respuestas(fil, sensor, lp if isinstance(lp, (list, tuple)) else ([lp] if lp else []))
    ref = _integrales(blanco, wl, resp)
    ref = ref / ref[1]
    cache = {}
    kR, kB, plantillas = [], [], {}
    mR, mB = [], []
    tipo = []
    for i in np.nonzero(bien)[0]:
        F = flujos[:, i]
        if not np.all(np.isfinite(F)) or np.any(F <= 0):
            continue
        g = cat[idx[i]]
        if g[5] is not None:
            e = _integrales(g[5], wl, resp)
            if not (np.all(np.isfinite(e)) and e[1] > 0):
                continue
            e = (e / e[1]) / ref
            pl = "espectro XP"
        else:
            pl = _plantilla(g[3], g[4])
            if pl is None:
                continue
            if pl not in cache:
                e = _integrales(pl, wl, resp)
                cache[pl] = e / e[1]
            e = cache[pl] / ref                  # color esperado tras calibrar (G2V = 1, 1, 1)
        kR.append(e[0] / (F[0] / F[1]))
        kB.append(e[2] / (F[2] / F[1]))
        mR.append(F[1] / F[0])
        mB.append(F[1] / F[2])
        tipo.append(pl == "espectro XP")
        plantillas[pl] = plantillas.get(pl, 0) + 1
    # La plantilla por Teff es el color INTRÍNSECO de la estrella; el espectro XP es el observado, con el
    # enrojecimiento interestelar. En la Vía Láctea (IC 1805, E(B−V) ~0,8) la plantilla sale ~30 % más azul en R/G que
    # el XP de la misma estrella (medido el 28-11-2026 con 190 estrellas): si hay bastantes XP, sólo cuentan ésas.
    tipo = np.array(tipo, bool)
    n_xp = int(tipo.sum())
    solo_xp = n_xp >= max(30, int(min_estrellas) // 2)
    aviso_rojo = None
    if solo_xp:
        kR, kB = list(np.array(kR)[tipo]), list(np.array(kB)[tipo])
        for k in [k for k in plantillas if k != "espectro XP"]:
            plantillas.pop(k)
    elif len(tipo):
        aviso_rojo = (f"sólo {n_xp} estrellas con espectro XP: el resto usa plantillas por Teff, que no llevan el "
                      "enrojecimiento interestelar (en campos de la Vía Láctea el resultado sale demasiado rojo)")
    gR, nR, sR = _robusta(kR)
    gB, nB, sB = _robusta(kB)
    n_usadas = min(nR, nB)
    wbR, _, _ = _robusta(mR)
    wbB, _, _ = _robusta(mB)
    res = {"vista": H._nombre(d), "fuente_catalogo": f"Gaia DR3 ({fuente})", "avisos_catalogo": avisos,
           "filtros": list(fil), "sensor": sensor, "blanco": blanco,
           "estrellas_detectadas": int(len(xs)), "cruzadas_gaia": int(n_cruce), "usadas": int(n_usadas),
           "fwhm_px": H._r(fw, 2), "apertura_px": H._r(r, 1), "wcs_volteado": bool(volteo),
           "ganancias_RGB": [H._r(gR, 4), 1.0, H._r(gB, 4)],
           "dispersion_estrella_pct": [H._r(100 * (math.exp(sR) - 1), 1), 0.0, H._r(100 * (math.exp(sB) - 1), 1)],
           "ganancias_white_balance_RGB": [H._r(wbR, 4), 1.0, H._r(wbB, 4)],
           "diferencia_con_WB_pct": [H._r(100 * (gR / wbR - 1), 1), 0.0, H._r(100 * (gB / wbB - 1), 1)],
           "plantillas": dict(sorted(plantillas.items(), key=lambda kv: -kv[1])[:12]),
           "estrellas_espectro_xp": n_xp, "solo_espectros_xp": bool(solo_xp)}
    if aviso_rojo:
        res["aviso_enrojecimiento"] = aviso_rojo
    no = []
    min_ok = max(30, int(min_estrellas) // 2) if solo_xp else int(min_estrellas)
    if n_usadas < min_ok:
        no.append(f"sólo {n_usadas} estrellas con color de Gaia (mínimo {min_ok})")
    if not (np.isfinite(gR) and np.isfinite(gB)):
        no.append("ganancias no válidas")
    elif max(sR, sB) > math.log(1.25):
        no.append("dispersión entre estrellas > 25 %: fotometría o curvas dudosas")
    res["no_cumple"] = no
    if aplicar and not no:
        g = np.array([gR, 1.0, gB], np.float32)
        if neutralizar_cielo and antes:
            cie = np.array(antes["cielo_RGB"], np.float32)
            comun = float(cie[1])
            q = (p - cie[:, None, None]) * g[:, None, None] + comun
        else:
            q = p * g[:, None, None]
        recortado = float((q > 1).mean() * 100)
        q = np.clip(q, 0.0, 1.0)
        d.apply_edit(H._a_sas(q, d.image), metadata={},
                     step_name=f"SetiAstroPilot: color espectrofotométrico {fil[0].split('_')[0]} + {sensor} "
                               f"(R×{gR:.3f}, B×{gB:.3f})")
        H._anotar_color_lineal(ctx, vista)
        res["aplicada"] = True
        res["recortado_pct"] = H._r(recortado, 4)
        res["antes"], res["despues"] = antes, H._color(d)
    else:
        res["aplicada"] = False
    return res


LISTA_COLOR = {"calibrarColorEspectral": calibrarColorEspectral, "listaCurvas": listaCurvas}
