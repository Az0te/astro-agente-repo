# SetiAstroPilot — inventario y apilado de subs (pasos 2–4 lineales) sin el Stacking Suite de SASpro.
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# inventarioSubs: lee las cabeceras (sin abrir las imágenes) y agrupa lights por filtro, exposición, gain, offset y
#   tamaño, y dentro de cada grupo por noche. Busca para cada grupo su master dark (en el árbol o en la biblioteca) y
#   para cada noche su master flat (en la raíz de la noche, por filtro) o los flats brutos para hacerlo.
# apilarCandidatos: un grupo (un filtro) por llamada. Calibra cada light (dark, flat, píxeles calientes del dark y
#   fríos del flat), mide estrellas, FWHM, excentricidad y cielo, descarta los peores por noche (k MAD, como mucho un
#   30 %), alinea por estrellas (astroalign de SASpro) contra la mejor toma o contra un master dado (así todos los
#   filtros salen en la misma rejilla), normaliza y apila por franjas con winsorized 3/3 y MAD 3/3 alrededor de la
#   mediana, con y sin pesos 1/σ². Mide cada candidato y recomienda como Siril: el de menos ruido con la FWHM a menos
#   de un 3 % de la mejor. Guarda FITS de 32 bits y abre el recomendado.
# Los ficheros del usuario no se tocan: las tomas calibradas y alineadas van a <salida>/_trabajo_apilado y se borran.

import math
import re
import shutil
import time
import warnings
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

import herramientas as H
import multicapa as _multicapa
import tomas_estrellas as TE
import cometas as _C

_r = H._r
EXT = (".fit", ".fits", ".fts", ".xisf")
BIBLIOTECA_DARKS = Path(r"D:\Astronomia\Master\MASTER DARKS")
CARPETAS_FUERA = ("rechazados", "_rechazados", "wbpp", "_trabajo_apilado", "apilado_cometa", "masters", "_python_malos",
                  "_flats_trabajo", "prev")
TIPOS = (("darkflat", ("dark flat", "darkflat", "flatdark", "flat dark")), ("bias", ("bias", "offset")),
         ("flat", ("flat",)), ("dark", ("dark",)), ("light", ("light", "science", "object")))
CARPETAS_TIPO = (("darkflat", ("darkflat", "flatdark", "darkflats", "flatdarks")), ("bias", ("bias", "biases")),
                 ("flat", ("flat", "flats")), ("dark", ("dark", "darks")), ("light", ("light", "lights")))


# --- Cabeceras ------------------------------------------------------------------------------------------------

def _num(v):
    try:
        return float(str(v).strip().strip("'"))
    except (TypeError, ValueError):
        return None


def _cab_fits(ruta):
    """Cabecera FITS a mano: {clave: [valores]} (sin leer la imagen)."""
    k = defaultdict(list)
    with open(ruta, "rb") as f:
        for _ in range(60):
            b = f.read(2880)
            if len(b) < 2880:
                break
            for i in range(0, 2880, 80):
                c = b[i:i + 80].decode("ascii", "replace")
                n = c[:8].strip()
                if n == "END":
                    return k
                if c[8:10] != "= ":
                    continue
                v = c[10:]
                if v.lstrip().startswith("'"):
                    m = re.match(r"\s*'((?:[^']|'')*)'", v)
                    v = m.group(1).replace("''", "'").strip() if m else v.strip()
                else:
                    v = v.split("/")[0].strip()
                k[n].append(v)
    return k


def _cab_xisf(ruta):
    k = defaultdict(list)
    with open(ruta, "rb") as f:
        c = f.read(16)
        if c[:8] != b"XISF0100":
            return k
        xml = f.read(int.from_bytes(c[8:12], "little")).decode("utf-8", "replace")
    for n, v in re.findall(r'<FITSKeyword name="([^"]+)" value="([^"]*)"', xml):
        v = v.replace("&apos;", "'").replace("&quot;", '"').replace("&amp;", "&").strip()
        k[n.upper()].append(v[1:-1].strip() if v.startswith("'") and v.endswith("'") else v)
    m = re.search(r'<Image\b[^>]*>', xml)
    if m:
        g = re.search(r'geometry="(\d+):(\d+):(\d+)"', m.group(0))
        if g:
            k["NAXIS1"].append(g.group(1))
            k["NAXIS2"].append(g.group(2))
            k["NAXIS3"].append(g.group(3))
        t = re.search(r'imageType="([^"]+)"', m.group(0))
        if t:
            k["IMAGETYP"].append(t.group(1))
    return k


def _cabecera(ruta):
    k = _cab_xisf(ruta) if str(ruta).lower().endswith(".xisf") else _cab_fits(ruta)
    return {n: v[0] for n, v in k.items()}, " ".join(k.get("IMAGETYP", [])).lower()


def _tipo(tipos_txt, ruta):
    nombre = Path(ruta).name.lower()
    master = nombre.startswith("master") or "master" in tipos_txt
    for t, claves in TIPOS:
        if any(c in tipos_txt for c in claves):
            return t, master
    for t, claves in TIPOS:
        if any(c.replace(" ", "") in nombre.replace(" ", "") for c in claves) and master:
            return t, master
    for p in [x.lower() for x in Path(ruta).parts[:-1]][::-1]:
        for t, claves in CARPETAS_TIPO:
            if p in claves:
                return t, master
    return None, master


def _noche(ruta, cab):
    for p in Path(ruta).parts[::-1]:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", p):
            return p
    f = cab.get("DATE-OBS") or cab.get("DATE-LOC")
    try:
        return (datetime.fromisoformat(str(f)[:19]) - timedelta(hours=12)).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return "sin_fecha"


def _raiz_noche(ruta, noche):
    for i, p in enumerate(Path(ruta).parts):
        if p == noche:
            return Path(*Path(ruta).parts[:i + 1])
    return Path(ruta).parent


def _filtro(cab):
    return str(cab.get("FILTER") or cab.get("FILTER1") or "sin filtro").strip()


def _ficha(ruta):
    cab, tt = _cabecera(ruta)
    t, master = _tipo(tt, ruta)
    exp = _num(cab.get("EXPTIME") or cab.get("EXPOSURE"))
    return {"ruta": str(ruta), "tipo": t, "master": master, "filtro": _filtro(cab), "exp": exp,
            "gain": _num(cab.get("GAIN")), "offset": _num(cab.get("OFFSET")),
            "tam": (int(_num(cab.get("NAXIS1")) or 0), int(_num(cab.get("NAXIS2")) or 0)),
            "temp": _num(cab.get("CCD-TEMP") or cab.get("SET-TEMP")), "instrumento": str(cab.get("INSTRUME") or ""),
            "bayer": str(cab.get("BAYERPAT") or "").strip().upper() or None, "noche": _noche(ruta, cab), "cab": cab}


def _recorrer(carpeta):
    out = []
    for p in sorted(Path(carpeta).rglob("*")):
        if p.suffix.lower() not in EXT or not p.is_file():
            continue
        rel = [x.lower() for x in p.relative_to(carpeta).parts[:-1]]
        if any(x in CARPETAS_FUERA or x.startswith("_") or x.endswith("_wbpp") for x in rel):
            continue
        try:
            out.append(_ficha(p))
        except OSError:
            continue
    return out


def _clave(f):
    return (f["filtro"], round(f["exp"] or 0, 2), f["gain"], f["offset"], f["tam"], f["bayer"])


def _nombre_grupo(k):
    return f"{k[0]} {k[1]:g}s gain {k[2]:g} offset {k[3]:g} {k[4][0]}x{k[4][1]}" if k[2] is not None else \
        f"{k[0]} {k[1]:g}s {k[4][0]}x{k[4][1]}"


def _mismo_filtro(a, b):
    n = lambda s: re.sub(r"[\s_\-]+", "", str(s).lower())
    return n(a) == n(b) or n(a).startswith(n(b)) or n(b).startswith(n(a))


def _buscar_dark(k, darks, biblioteca):
    """Master dark de la misma exposición (±1 s), gain y tamaño: del árbol primero, luego de la biblioteca."""
    cand = [d for d in darks if d["master"] and d["exp"] is not None and abs(d["exp"] - k[1]) <= 1.0
            and (d["tam"] == k[4] or d["tam"] == (0, 0)) and (d["gain"] is None or k[2] is None or d["gain"] == k[2])]
    if not cand and biblioteca and Path(biblioteca).is_dir():
        lib = [_ficha(p) for p in sorted(Path(biblioteca).glob("*")) if p.suffix.lower() in EXT]
        cand = [d for d in lib if d["tipo"] in ("dark", None) and d["exp"] is not None and abs(d["exp"] - k[1]) <= 1.0
                and d["tam"] == k[4] and (d["gain"] is None or k[2] is None or d["gain"] == k[2])]
    return cand


def _grupos(carpeta, biblioteca=None, aprobados=None):
    fichas = _recorrer(carpeta)
    lights = [f for f in fichas if f["tipo"] == "light" and not f["master"]]
    darks = [f for f in fichas if f["tipo"] == "dark"]
    flats = [f for f in fichas if f["tipo"] == "flat"]
    darkflats = [f for f in fichas if f["tipo"] in ("darkflat",) or (f["tipo"] == "dark" and f["exp"] and f["exp"] < 15)]
    lista, noches_lista = None, set()
    if aprobados:
        txt = Path(aprobados).read_text(encoding="utf-8", errors="replace").splitlines()
        lista = {Path(x.strip().strip('"')).name.lower() for x in txt if x.strip()}
        for f in lights:
            if Path(f["ruta"]).name.lower() in lista:
                noches_lista.add(f["noche"])
    g = defaultdict(list)
    fuera_lista = 0
    for f in lights:
        if lista is not None and f["noche"] in noches_lista and Path(f["ruta"]).name.lower() not in lista:
            fuera_lista += 1
            continue
        g[_clave(f)].append(f)
    grupos = []
    for k, ls in sorted(g.items(), key=lambda kv: str(kv[0])):
        por_noche = defaultdict(list)
        for f in ls:
            por_noche[f["noche"]].append(f)
        dk = _buscar_dark(k, darks, biblioteca)
        noches = []
        for n, fs in sorted(por_noche.items()):
            raiz = _raiz_noche(fs[0]["ruta"], n)
            mf = [x for x in flats if x["master"] and x["noche"] == n and _mismo_filtro(x["filtro"], k[0])
                  and x["tam"] == k[4]]
            if not mf:                                       # masters de flat por nombre en la raíz de la noche
                mf = [x for x in flats if x["master"] and Path(x["ruta"]).parent == raiz
                      and _mismo_filtro(x["filtro"], k[0])]
            brutos = [x for x in flats if not x["master"] and x["noche"] == n and _mismo_filtro(x["filtro"], k[0])]
            noches.append({"noche": n, "raiz": str(raiz), "lights": fs, "flat": mf[0]["ruta"] if mf else None,
                           "flats_brutos": brutos,
                           "darkflats": [x for x in darkflats if x["noche"] == n and not x["master"]],
                           "darkflat_master": [x for x in darkflats if x["noche"] == n and x["master"]]})
        grupos.append({"clave": k, "nombre": _nombre_grupo(k), "filtro": k[0], "exp": k[1], "noches": noches,
                       "dark": dk[0]["ruta"] if dk else None, "n": len(ls)})
    return grupos, {"lights": len(lights), "fuera_de_aprobados": fuera_lista, "noches_con_lista": sorted(noches_lista),
                    "darks": len(darks), "flats": len(flats)}


def _resumen_grupo(g):
    no = []
    if not g["dark"]:
        no.append(f"{g['nombre']}: sin master dark de {g['exp']:g} s (ni en el árbol ni en la biblioteca)")
    for n in g["noches"]:
        if not n["flat"] and not n["flats_brutos"]:
            no.append(f"{g['nombre']}, noche {n['noche']}: sin master flat ni flats brutos de {g['filtro']}")
    return {"grupo": g["nombre"], "filtro": g["filtro"], "exposicion_s": g["exp"], "lights": g["n"],
            "horas": _r(g["n"] * g["exp"] / 3600, 2), "dark": Path(g["dark"]).name if g["dark"] else None,
            "noches": [{"noche": n["noche"], "lights": len(n["lights"]),
                        "flat": Path(n["flat"]).name if n["flat"] else (f"se hará con {len(n['flats_brutos'])} flats brutos"
                                                                        if n["flats_brutos"] else None)}
                       for n in g["noches"]], "no_cumple": no}


def inventarioSubs(ctx, carpeta, aprobados=None, biblioteca_darks=None):
    """L2: grupos de lights (filtro, exposición, gain, offset, tamaño) por noche, con su master dark y su master flat
    por noche. 'aprobados': txt con una ruta por línea; en las noches que salen en la lista solo entran esos lights."""
    if not Path(carpeta).is_dir():
        raise FileNotFoundError(f"No existe la carpeta {carpeta}.")
    grupos, cuenta = _grupos(carpeta, biblioteca_darks or BIBLIOTECA_DARKS, aprobados)
    res = [_resumen_grupo(g) for g in grupos]
    return {"carpeta": str(carpeta), "cuenta": cuenta, "grupos": res,
            "no_cumple": [x for g in res for x in g["no_cumple"]],
            "siguiente": "apilarCandidatos con filtro=<filtro> y planSolo=true para comprobar escalas; luego sin planSolo."}


# --- Calibración -------------------------------------------------------------------------------------------------

def _leer(ctx, ruta):
    p, cab, meta = _multicapa._leer(ctx, ruta)
    p = np.asarray(p, np.float32)
    if np.nanmax(p) > 2.0:                                   # ADU: a 0–1 como los lights
        p = p / 65535.0
    return np.ascontiguousarray(p), cab, meta


def _master_flat_bruto(ctx, noche, filtro, salida_raiz):
    """Master flat de una noche desde flats y darkflats brutos (sin probar con datos reales: IC 1805 traía masters)."""
    fl = noche["flats_brutos"]
    texp = fl[0]["exp"] or 0
    dfs = [x for x in noche["darkflats"] if x["exp"] is not None and abs(x["exp"] - texp) <= 0.1]
    mdf = None
    if dfs:
        cubo = np.stack([_leer(ctx, x["ruta"])[0][0] for x in dfs])
        mdf = np.nanmedian(cubo, 0).astype(np.float32)
        del cubo
    elif noche["darkflat_master"]:
        mdf = _leer(ctx, noche["darkflat_master"][0]["ruta"])[0][0]
    cubo = []
    for x in fl:
        a = _leer(ctx, x["ruta"])[0][0]
        if mdf is not None:
            a = a - mdf
        a /= max(float(np.median(a[::4, ::4])), 1e-9)
        cubo.append(a)
        _C._eventos()
    cubo = np.stack(cubo)
    out, _ = _C._reducir_cubo(cubo, "w33")
    ruta = Path(salida_raiz) / f"Master Flat {filtro} {texp:.2f}s {noche['noche']}.fits"
    _C._escribir_fits(ruta, out[np.newaxis], {"IMAGETYP": "Master Flat", "FILTER": filtro, "EXPTIME": texp,
                                              "NCOMBINE": len(fl)})
    return str(ruta), (f"master flat {filtro} de {noche['noche']} hecho con {len(fl)} flats"
                       f"{' y ' + str(len(dfs)) + ' darkflats' if dfs else (' y su master darkflat' if mdf is not None else ' SIN darkflat')}")


def _mapa_defectos(dark, flat_n):
    malos = np.zeros((dark if dark is not None else flat_n).shape[-2:], bool)
    n_cal = n_fri = 0
    if dark is not None:
        d = dark[0]
        med, sd = _C._mad(d[::2, ::2])
        cal = d > med + max(8 * sd, 4.0 / 65535)
        n_cal = int(cal.sum())
        malos |= cal
    if flat_n is not None:
        fri = flat_n[0] < 0.3
        n_fri = int(fri.sum())
        malos |= fri
    return malos, n_cal, n_fri


def _cosmetica(p, malos, mosaico):
    if not malos.any():
        return p
    cv2 = _C._cv2()
    if not mosaico:
        for k in range(p.shape[0]):
            m3 = cv2.medianBlur(np.ascontiguousarray(p[k]), 3)
            p[k][malos] = m3[malos]
        return p
    for dy in (0, 1):
        for dx in (0, 1):
            sub = np.ascontiguousarray(p[0, dy::2, dx::2])
            m3 = cv2.medianBlur(sub, 3)
            mk = malos[dy::2, dx::2]
            sub[mk] = m3[mk]
            p[0, dy::2, dx::2] = sub
    return p


def _calibrar(ctx, ruta, dark, flat_n, malos, mosaico, patron):
    p, cab, meta = _leer(ctx, ruta)
    crudo = float(np.median(p[0, ::8, ::8]))
    if dark is not None:
        p = p - dark
    if flat_n is not None:
        p = p / flat_n
    p = _cosmetica(p, malos, mosaico)
    if mosaico:
        p, _ = _C._debayer(p[0], patron or "RGGB")
    return np.ascontiguousarray(p, np.float32), cab, meta, crudo


# --- Métricas -----------------------------------------------------------------------------------------------------

def _medir(L):
    L = np.nan_to_num(np.asarray(L, np.float32), nan=0.0)
    pos, amp, fw, ec, s = TE._estrellas(L, max_n=8000)
    fondo = float(np.median(L[::8, ::8]))
    if len(pos) < 10:
        return {"estrellas": int(len(pos)), "fwhm": None, "exc": None, "fondo": fondo, "ruido": float(s)}
    sel = (amp > np.percentile(amp, 30)) & (amp < np.percentile(amp, 95))
    return {"estrellas": int(len(pos)), "fwhm": float(np.median(fw[sel])), "exc": float(np.median(ec[sel])),
            "fondo": fondo, "ruido": float(s)}


def _calientes_mp(L, sigma):
    """Píxeles aislados > 10 σ sobre la mediana 3×3 con los 8 vecinos < 3 σ, por megapíxel."""
    cv2 = _C._cv2()
    L = np.nan_to_num(np.asarray(L, np.float32), nan=0.0)
    r = L - cv2.medianBlur(L, 3)
    k = np.ones((3, 3), np.uint8)
    k[1, 1] = 0
    vec = cv2.dilate(r, k)
    n = int(((r > 10 * sigma) & (vec < 3 * sigma)).sum())
    return n / (L.size / 1e6)


def _seleccion(tomas, k, maximo):
    """Por noche: fuera las tomas a más de k MAD en FWHM, excentricidad, estrellas o fondo (las peores primero, como
    mucho 'maximo' de la noche)."""
    fuera = {}
    por = defaultdict(list)
    for t in tomas:
        por[t["noche"]].append(t)
    for n, ts in por.items():
        if len(ts) < 6:
            continue
        pts = []
        for t in ts:
            pts.append(0.0)
        for clave, signo in (("fwhm", 1), ("exc", 1), ("estrellas", -1), ("fondo", 1)):
            v = np.array([t["m"][clave] if t["m"][clave] is not None else np.nan for t in ts], float)
            if not np.isfinite(v).any():
                continue
            med = np.nanmedian(v)
            mad = 1.4826 * np.nanmedian(np.abs(v - med))
            if clave == "fondo":
                mad = max(mad, 0.05 * abs(med))
            elif clave == "exc":
                mad = max(mad, 0.03)
            else:
                mad = max(mad, 0.03 * abs(med))
            z = signo * (v - med) / mad
            for i, t in enumerate(ts):
                if np.isfinite(z[i]) and z[i] > k:
                    pts[i] = max(pts[i], float(z[i]))
                    t.setdefault("motivos", []).append(f"{clave} {z[i]:.1f} MAD")
                elif not np.isfinite(v[i]):
                    pts[i] = max(pts[i], 99.0)
                    t.setdefault("motivos", []).append("sin estrellas medibles")
        orden = sorted([i for i in range(len(ts)) if pts[i] > 0], key=lambda i: -pts[i])
        for i in orden[:int(maximo * len(ts))]:
            fuera[ts[i]["ruta"]] = ts[i]
    return fuera


# --- Integración ------------------------------------------------------------------------------------------------

def _reducir(cubo, tipo, lo, hi, pesos=None):
    """Winsorized (como Siril) o MAD alrededor de la mediana; media (con pesos) de las aceptadas."""
    with warnings.catch_warnings(), np.errstate(all="ignore"):
        warnings.simplefilter("ignore", RuntimeWarning)
        med = np.nanmedian(cubo, 0)
        sd = 1.4826 * np.nanmedian(np.abs(cubo - med), 0)
        if tipo == "w":
            for _ in range(3):
                wz = np.clip(cubo, med - 1.5 * sd, med + 1.5 * sd)
                med = np.nanmean(wz, 0)
                sd = 1.134 * np.nanstd(wz, 0)
        sd = np.maximum(sd, 1e-7)
        ok = (cubo >= med - lo * sd) & (cubo <= med + hi * sd)
        if pesos is None:
            n = ok.sum(0)
            out = np.where(n > 0, np.where(ok, cubo, 0.0).sum(0) / np.maximum(n, 1), med)
        else:
            wb = np.asarray(pesos, np.float32).reshape((-1,) + (1,) * (cubo.ndim - 1))
            sw = np.where(ok, wb, 0).sum(0)
            out = np.where(sw > 0, np.where(ok, cubo * wb, 0).sum(0) / np.maximum(sw, 1e-12), med)
        rech = 1.0 - float(ok.sum()) / max(1, int(np.isfinite(cubo).sum()))
    return out.astype(np.float32), rech


METODOS = {"w33": ("w", 3.0, 3.0, "winsorized sigma 3/3"), "mad33": ("mad", 3.0, 3.0, "sigma clip MAD 3/3 (mediana)")}


def _cabecera_salida(cab0, g, usadas, extra=None):
    h = {}
    for k in ("TELESCOP", "INSTRUME", "FOCALLEN", "XPIXSZ", "YPIXSZ", "XBINNING", "YBINNING", "GAIN", "OFFSET",
              "CCD-TEMP", "SET-TEMP", "RA", "DEC", "OBJCTRA", "OBJCTDEC", "OBJECT", "SITELAT", "SITELONG", "BAYERPAT"):
        v = cab0.get(k) if cab0 else None
        if v not in (None, ""):
            n = _num(v)
            h[k] = n if n is not None and k not in ("OBJCTRA", "OBJCTDEC", "OBJECT", "TELESCOP", "INSTRUME", "BAYERPAT") else str(v)
    h.update({"IMAGETYP": "Master Light", "FILTER": g["filtro"], "EXPTIME": float(g["exp"]), "NCOMBINE": len(usadas),
              "LIVETIME": float(g["exp"] * len(usadas)),
              "DATE-OBS": str(min((str(t["cab"].get("DATE-OBS") or "") for t in usadas), default="")),
              "STACKCNT": len(usadas)})
    h.update(extra or {})
    return h


def apilarCandidatos(ctx, carpeta, salida, filtro=None, aprobados=None, referencia=None, planSolo=False,
                     metodos=("w33", "mad33"), pesos=True, seleccion=True, k_seleccion=2.5, max_descartes=0.3,
                     max_tomas=None, nombre=None, biblioteca_darks=None, abrir=True):
    """L3–L4 sin Stacking Suite: un grupo de lights (el de 'filtro') calibrado, medido, seleccionado, alineado y
    apilado con varios rechazos, con y sin pesos. 'referencia': master (FITS/XISF) o light al que alinear (para que
    todos los filtros salgan en la misma rejilla). planSolo: grupos, calibración elegida y niveles de la primera
    toma de cada noche, sin apilar."""
    t0 = time.time()
    if not Path(carpeta).is_dir():
        raise FileNotFoundError(f"No existe la carpeta {carpeta}.")
    grupos, cuenta = _grupos(carpeta, biblioteca_darks or BIBLIOTECA_DARKS, aprobados)
    if filtro:
        grupos = [g for g in grupos if _mismo_filtro(g["filtro"], filtro)]
    if not grupos:
        raise ValueError(f"No hay lights del filtro {filtro!r} en {carpeta}.")
    if len(grupos) > 1:
        if planSolo:
            pass
        else:
            raise ValueError("Hay varios grupos para ese filtro (exposición, gain o tamaño distintos): "
                             + "; ".join(g["nombre"] for g in grupos) + ". Apila uno por llamada.")
    avisos, pasos = [], []
    salida = Path(salida)
    salida.mkdir(parents=True, exist_ok=True)

    if planSolo:
        out = []
        for g in grupos:
            r = _resumen_grupo(g)
            dark = _leer(ctx, g["dark"])[0] if g["dark"] else None
            r["dark_mediana_adu"] = _r(float(np.median(dark[0, ::8, ::8])) * 65535, 1) if dark is not None else None
            for n, rn in zip(g["noches"], r["noches"]):
                p, _, _ = _leer(ctx, n["lights"][0]["ruta"])
                rn["light_mediana_adu"] = _r(float(np.median(p[0, ::8, ::8])) * 65535, 1)
                if dark is not None:
                    rn["light_menos_dark_adu"] = _r(float(np.median((p - dark)[0, ::8, ::8])) * 65535, 1)
                if n["flat"]:
                    f = _leer(ctx, n["flat"])[0]
                    m = float(np.median(f[0, ::4, ::4]))
                    fn = f[0] / m
                    hgt, wid = fn.shape
                    rn["flat_mediana"] = _r(m, 4)
                    rn["flat_esquina_centro"] = _r(float(np.median(fn[50:400, 50:400])), 3)
                    rn["flat_min"] = _r(float(np.min(fn)), 3)
                _C._eventos()
            seg = sum(len(n["lights"]) for n in g["noches"]) * 22
            r["tiempo_estimado_min"] = _r(seg / 60, 0)
            r["disco_trabajo_gb"] = _r(g["n"] * g["clave"][4][0] * g["clave"][4][1] * 4 * (3 if g["clave"][5] else 1) / 1e9, 1)
            out.append(r)
        return {"plan": out, "cuenta": cuenta, "no_cumple": [x for r in out for x in r["no_cumple"]],
                "duracion_s": _r(time.time() - t0, 1)}

    g = grupos[0]
    no = _resumen_grupo(g)["no_cumple"]
    if no:
        raise RuntimeError("No cumple: " + "; ".join(no))
    objeto = nombre or str(g["noches"][0]["lights"][0]["cab"].get("OBJECT") or Path(carpeta).name).strip()
    etiqueta = f"{objeto}_{g['filtro']}".replace(" ", "_")
    trab = salida / "_trabajo_apilado" / etiqueta
    if trab.exists():
        shutil.rmtree(trab, ignore_errors=True)
    trab.mkdir(parents=True, exist_ok=True)

    dark = _leer(ctx, g["dark"])[0]
    pasos.append(f"Master dark: {Path(g['dark']).name}")
    mosaico = bool(g["clave"][5])
    patron = g["clave"][5]

    # --- 1. calibración y medida, noche a noche ---------------------------------------------------------------
    tomas = []
    calibracion = []
    for n in g["noches"]:
        if n["flat"]:
            ruta_flat = n["flat"]
        else:
            ruta_flat, txt = _master_flat_bruto(ctx, n, g["filtro"], n["raiz"])
            pasos.append(txt)
        f = _leer(ctx, ruta_flat)[0]
        flat_n = f / max(float(np.median(f[:, ::4, ::4])), 1e-9)
        flat_n = np.maximum(flat_n, 0.05).astype(np.float32)
        malos, n_cal, n_fri = _mapa_defectos(dark, flat_n)
        calibracion.append({"noche": n["noche"], "flat": Path(ruta_flat).name, "calientes_del_dark": n_cal,
                            "frios_del_flat": n_fri, "lights": len(n["lights"])})
        ls = n["lights"]
        if max_tomas:
            ls = ls[::max(1, len(ls) // max(1, int(max_tomas)))][:int(max_tomas)]
        for li in ls:
            try:
                p, cab, meta, crudo = _calibrar(ctx, li["ruta"], dark, flat_n, malos, mosaico, patron)
            except Exception as e:
                avisos.append(f"{Path(li['ruta']).name}: no se pudo calibrar ({str(e)[:100]})")
                continue
            m = _medir(_C._lum(p))
            dst = trab / f"c_{len(tomas):04d}.npy"
            np.save(dst, p)
            tomas.append({"ruta": li["ruta"], "noche": n["noche"], "cab": li["cab"], "meta": meta, "m": m,
                          "crudo_adu": crudo * 65535, "npy": dst})
            _C._eventos()
        del flat_n, f
    pasos.append(f"Calibradas y medidas {len(tomas)} tomas ({_r((time.time() - t0) / 60, 1)} min)")

    # --- 2. selección ------------------------------------------------------------------------------------------
    fuera = {}
    if seleccion:
        cand = [t for t in tomas if not (aprobados and t["noche"] in cuenta["noches_con_lista"])]
        fuera = _seleccion(cand, k_seleccion, max_descartes)
        if cuenta["noches_con_lista"]:
            pasos.append(f"Noches {', '.join(cuenta['noches_con_lista'])}: solo los lights de la lista de aprobados, "
                         "sin otra selección")
    descartes = [{"toma": Path(t["ruta"]).name, "noche": t["noche"], "motivos": t.get("motivos", [])}
                 for t in fuera.values()]
    for t in tomas:
        if t["ruta"] in fuera:
            try:
                Path(t["npy"]).unlink()
            except OSError:
                pass
    tomas = [t for t in tomas if t["ruta"] not in fuera]
    pasos.append(f"Selección (k = {k_seleccion} MAD por noche, máx. {int(100 * max_descartes)} %): "
                 f"{len(descartes)} fuera, {len(tomas)} dentro")
    if len(tomas) < 3:
        raise RuntimeError(f"Quedan {len(tomas)} tomas tras la selección.")

    # --- 3. referencia y alineado --------------------------------------------------------------------------------
    cv2 = _C._cv2()
    from setiastro.saspro.astroalign import find_transform
    ref_txt = None
    if referencia:
        Lr = _C._lum(_leer(ctx, referencia)[0])
        ref_txt = Path(referencia).name
        iref = None
    else:
        def nota(t):
            m = t["m"]
            return (m["estrellas"] or 0) / max(m["fwhm"] or 99, 0.5) ** 2 / max(m["ruido"], 1e-9)
        iref = int(np.argmax([nota(t) for t in tomas]))
        Lr = _C._lum(np.load(tomas[iref]["npy"], mmap_mode="r"))
        ref_txt = Path(tomas[iref]["ruta"]).name
    h, w = Lr.shape
    c = 3 if mosaico else 1
    fallos = []
    for i, t in enumerate(tomas):
        src = np.load(t["npy"], mmap_mode="r")
        dst = trab / f"a_{i:04d}.npy"
        if i == iref and not referencia:
            a = np.asarray(src, np.float32)
            t["emparejadas"] = None
        else:
            try:
                T, (s, _) = find_transform(np.ascontiguousarray(_C._lum(np.asarray(src))), np.ascontiguousarray(Lr))
                Mx = np.asarray(T.params, np.float64)[:2]
                t["emparejadas"] = int(len(s))
            except Exception as e:
                fallos.append(f"{Path(t['ruta']).name}: {str(e)[:100]}")
                t["fallo"] = True
                _C._eventos()
                continue
            a = np.empty((c, h, w), np.float32)
            for k in range(c):
                a[k] = cv2.warpAffine(np.asarray(src[k], np.float32), Mx, (w, h), flags=cv2.INTER_LANCZOS4,
                                      borderMode=cv2.BORDER_CONSTANT, borderValue=float("nan"))
            t["giro_grados"] = _r(math.degrees(math.atan2(Mx[1, 0], Mx[0, 0])), 2)
        np.save(dst, a)
        del src
        try:
            Path(t["npy"]).unlink()
        except OSError:
            pass
        t["npy"] = dst
        _C._eventos()
    n_tot = len(tomas)
    tomas = [t for t in tomas if not t.get("fallo")]
    n = len(tomas)
    pasos.append(f"Alineadas {n} de {n_tot} con astroalign de SASpro contra {ref_txt}")
    if fallos:
        avisos.append(f"No se alinearon {len(fallos)}: " + "; ".join(fallos[:10]))
    if n < 3:
        raise RuntimeError("Menos de 3 tomas alineadas.")

    # --- 4. normalización y pesos ----------------------------------------------------------------------------------
    estad = []
    for t in tomas:
        a = np.load(t["npy"], mmap_mode="r")
        estad.append([_C._mad(np.asarray(a[k, ::4, ::4])) for k in range(c)])
    if referencia or iref is None:
        est_ref = [(float(np.median([e[k][0] for e in estad])), float(np.median([e[k][1] for e in estad])))
                   for k in range(c)]
    else:
        est_ref = estad[iref]
    for t, e in zip(tomas, estad):
        t["norm"] = [(est_ref[k][1] / max(e[k][1], 1e-9), e[k][0], est_ref[k][0]) for k in range(c)]
        sig = t["m"]["ruido"] * t["norm"][0][0]
        t["peso"] = 1.0 / max(sig, 1e-9) ** 2
    pmax = max(t["peso"] for t in tomas)
    for t in tomas:
        t["peso"] /= pmax

    # --- 5. integración por franjas -------------------------------------------------------------------------------
    variantes = []
    for cod in metodos:
        if cod not in METODOS:
            raise ValueError(f"Método {cod} no válido: {', '.join(METODOS)}.")
        variantes.append((cod, False))
        if pesos:
            variantes.append((cod, True))
    res = {v: np.empty((c, h, w), np.float32) for v in variantes}
    rech = {v: [] for v in variantes}
    filas = _C._filas_por_franja(n, c, w, 1.2e8)
    mm = [np.load(t["npy"], mmap_mode="r") for t in tomas]
    wts = np.array([t["peso"] for t in tomas], np.float32)
    for y0 in range(0, h, filas):
        y1 = min(h, y0 + filas)
        cubo = np.empty((n, c, y1 - y0, w), np.float32)
        for i, t in enumerate(tomas):
            b = np.asarray(mm[i][:, y0:y1, :], np.float32)
            for k, (s, m0, m1) in enumerate(t["norm"]):
                cubo[i, k] = (b[k] - m0) * s + m1
        for (cod, conp) in variantes:
            tipo, lo, hi, _ = METODOS[cod]
            out, rr = _reducir(cubo, tipo, lo, hi, wts if conp else None)
            res[(cod, conp)][:, y0:y1] = out
            rech[(cod, conp)].append(rr)
        _C._eventos()
    del mm, cubo
    pasos.append(f"Integración por franjas de {filas} filas: {len(variantes)} candidatos")

    # --- 6. medidas, recomendación y salida ------------------------------------------------------------------------
    sin_datos = ~np.isfinite(res[variantes[0]][0])
    cab0 = tomas[0]["cab"]
    candidatos = []
    cdir = salida / "candidatos_apilado"
    cdir.mkdir(exist_ok=True)
    for v in variantes:
        p = np.nan_to_num(res[v], nan=0.0)
        L = _C._lum(p)
        m = _medir(L)
        calientes = _calientes_mp(L, m["ruido"])
        neg = float((L[~sin_datos] < 0).mean()) if (~sin_datos).any() else 0.0
        candidatos.append({"metodo": METODOS[v[0]][3] + (" con pesos 1/σ²" if v[1] else ""), "clave": v,
                           "ruido_cielo": m["ruido"], "fwhm_px": m["fwhm"], "estrellas": m["estrellas"],
                           "calientes_por_mp": _r(calientes, 2), "rechazo_pct": _r(100 * float(np.mean(rech[v])), 2),
                           "negativos_pct": _r(100 * neg, 3)})
        _C._eventos()
    rmin = min(x["ruido_cielo"] for x in candidatos)
    fmin = min(x["fwhm_px"] or 99 for x in candidatos)
    hmin = min(x["calientes_por_mp"] for x in candidatos)
    ok = [x for x in candidatos if (x["fwhm_px"] or 99) <= 1.03 * fmin and x["calientes_por_mp"] <= max(1.5 * hmin, hmin + 2)]
    elegido = min(ok or candidatos, key=lambda x: x["ruido_cielo"])
    usadas = tomas
    rutas = {}
    for x in candidatos:
        x["ruido_rel"] = _r(x["ruido_cielo"] / rmin, 4)
        x["fwhm_px"] = _r(x["fwhm_px"], 2) if x["fwhm_px"] else None
        p = np.nan_to_num(res[x["clave"]], nan=0.0)
        extra = {"HISTORY": f"SetiAstroPilot apilarCandidatos: {x['metodo']}"}
        neg = x["negativos_pct"] / 100
        if neg > 0.001:
            ped = float(-np.percentile(p[:, ~sin_datos], 0.01))
            p = p + ped
            p[:, sin_datos] = 0.0
            extra["PEDESTAL"] = _r(ped * 65535, 1)
            x["pedestal_adu"] = extra["PEDESTAL"]
        cab = _cabecera_salida(cab0, g, usadas, extra)
        suf = f"{x['clave'][0]}{'_pesos' if x['clave'][1] else ''}"
        if x is elegido:
            ruta = salida / f"{etiqueta}_{len(usadas)}x{g['exp']:g}s.fits"
        else:
            ruta = cdir / f"{etiqueta}_{suf}.fits"
        _C._escribir_fits(ruta, p, cab)
        rutas[x["metodo"]] = str(ruta)
        x["fichero"] = str(ruta)
        if x is elegido:
            prev = salida / "prev"
            prev.mkdir(exist_ok=True)
            ps = _C._params(p)
            x["previa"] = _C._previa(p, ps, prev / f"{etiqueta}.jpg")
            if abrir:
                try:
                    _C._abrir(ctx, p, f"{etiqueta}_master", tomas[0]["meta"])
                except Exception as e:
                    avisos.append(f"No se pudo abrir el master como vista: {str(e)[:100]}")
        x["ruido_cielo"] = _r(x["ruido_cielo"] * 65535, 3)
        del x["clave"]
    # Soltar los mmap que quedan en variables (el último a_XXXX.npy se quedaba sin borrar en Windows: IC 1805 Ha, 28 nov)
    a = b = src = None
    import gc
    gc.collect()
    shutil.rmtree(trab, ignore_errors=True)
    try:
        (salida / "_trabajo_apilado").rmdir()
    except OSError:
        pass
    tabla_tomas = [{"toma": Path(t["ruta"]).name, "noche": t["noche"], "estrellas": t["m"]["estrellas"],
                    "fwhm": _r(t["m"]["fwhm"], 2) if t["m"]["fwhm"] else None,
                    "exc": _r(t["m"]["exc"], 3) if t["m"]["exc"] else None, "peso": _r(t["peso"], 3),
                    "emparejadas": t.get("emparejadas"), "giro": t.get("giro_grados")} for t in usadas]
    por_noche = defaultdict(int)
    for t in usadas:
        por_noche[t["noche"]] += 1
    return {"grupo": g["nombre"], "objeto": objeto, "recomendado": elegido["metodo"], "master": elegido["fichero"],
            "previa": elegido.get("previa"), "candidatos": candidatos, "usadas": len(usadas),
            "usadas_por_noche": dict(por_noche), "horas": _r(len(usadas) * g["exp"] / 3600, 2),
            "referencia": ref_txt, "calibracion": calibracion, "descartes": descartes, "pasos": pasos, "avisos": avisos,
            "tomas": tabla_tomas, "criterio": "menos ruido con FWHM ≤ 1,03 × la mejor y calientes ≤ máx(1,5 × mín, mín + 2)",
            "duracion_min": _r((time.time() - t0) / 60, 1)}


LISTA_APILADO = {"inventarioSubs": inventarioSubs, "apilarCandidatos": apilarCandidatos}
