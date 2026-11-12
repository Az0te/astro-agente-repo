# SirilAstroPilot — preprocesado y apilado (pasos 2–4 lineales) con comandos de Siril 1.4.
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# inventarioSubs: lee las cabeceras (sin abrir las imágenes) y agrupa lights, darks, flats, bias y darks de flats.
# revisarCalibracion: comprueba que cada grupo de lights tiene su calibración compatible.
# apilarCandidatos: en una carpeta de trabajo propia (~/.sirilastropilot/apilado/<proyecto>, con enlaces a los
#   ficheros del usuario, que no se tocan) hace masters, calibra, debayeriza (OSC), registra, mide cada sub y descarta
#   los peores, y apila comparando métodos de rechazo con y sin pesos. Mide cada master y recomienda; deja el elegido
#   cargado y guardado (sin sobrescribir).
# Comandos (command_list.h de Siril 1.4): cd, convert, calibrate, register, seqapplyreg, stack, load.

import os
import re
import shutil
import time
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

import herramientas as H

APILADO = H.DATOS / "apilado"
EXT_FITS = (".fit", ".fits", ".fts")
EXT_RAW = (".cr2", ".cr3", ".nef", ".arw", ".dng", ".raf", ".orf", ".rw2", ".pef")
_r = H._r


# --- Cabeceras ------------------------------------------------------------------------------------------------

def _cabecera(ruta, max_bloques=40):
    """Cabecera FITS leída a mano (bloques de 2880 bytes, tarjetas de 80): sin dependencias y sin leer la imagen."""
    out = {}
    with open(ruta, "rb") as f:
        for _ in range(max_bloques):
            b = f.read(2880)
            if len(b) < 2880:
                break
            for i in range(0, 2880, 80):
                tarjeta = b[i:i + 80].decode("ascii", "replace")
                clave = tarjeta[:8].strip()
                if clave == "END":
                    return out
                if tarjeta[8:10] != "= ":
                    continue
                v = tarjeta[10:].split("/", 1)[0].strip() if not tarjeta[10:].strip().startswith("'") else tarjeta[10:].lstrip()
                if v.startswith("'"):
                    v = v[1:].split("'", 1)[0].strip()
                else:
                    try:
                        v = float(v) if any(ch in v for ch in ".eE") else int(v)
                    except ValueError:
                        v = v.strip()
                out[clave] = v
    return out


TIPOS_IMG = (("darkflat", ("dark flat", "darkflat", "flatdark", "flat dark")), ("bias", ("bias", "offset")),
             ("flat", ("flat",)), ("dark", ("dark",)), ("light", ("light", "science", "object")))
CARPETAS = (("darkflat", ("darkflat", "flatdark", "dark_flat", "flat_dark", "darkflats", "flatdarks")),
            ("bias", ("bias", "biases", "offset", "offsets")), ("flat", ("flat", "flats")),
            ("dark", ("dark", "darks")), ("light", ("light", "lights")))


def _tipo(cab, ruta):
    it = str(cab.get("IMAGETYP") or cab.get("FRAME") or cab.get("FRAMETYP") or "").lower()
    for t, claves in TIPOS_IMG:
        if any(k in it for k in claves):
            return t
    partes = [p.lower() for p in Path(ruta).parts]
    for t, claves in CARPETAS:
        if any(p in claves or any(p.startswith(k) for k in claves) for p in partes):
            return t
    return None


def _noche(fecha):
    try:
        d = datetime.fromisoformat(str(fecha)[:19])
        return (d - timedelta(hours=12)).strftime("%Y-%m-%d")
    except ValueError:
        return None


def _exif_tiff(ruta):
    """EXIF mínimo de RAW con estructura TIFF (CR2, NEF, ARW, DNG, PEF, ORF, RW2): cámara, exposición, ISO, fecha y
    tamaño. Sin dependencias; lee sólo los primeros 256 kB. Devuelve claves con nombres FITS."""
    import struct
    with open(ruta, "rb") as f:
        b = f.read(262144)
    if b[:2] not in (b"II", b"MM"):
        return {}
    e = "<" if b[:2] == b"II" else ">"
    TAM = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8}
    out = {}

    def valor(tipo, n, off_dato):
        if tipo == 2:
            return b[off_dato:off_dato + n].split(b"\0", 1)[0].decode("ascii", "replace").strip()
        if tipo == 3:
            return struct.unpack_from(e + "H", b, off_dato)[0]
        if tipo == 4:
            return struct.unpack_from(e + "I", b, off_dato)[0]
        if tipo in (5, 10):
            num, den = struct.unpack_from(e + ("II" if tipo == 5 else "ii"), b, off_dato)
            return num / den if den else None
        return None

    def ifd(off, visto):
        if off in visto or off + 2 > len(b):
            return
        visto.add(off)
        n = struct.unpack_from(e + "H", b, off)[0]
        for i in range(min(n, 400)):
            p = off + 2 + 12 * i
            if p + 12 > len(b):
                return
            tag, tipo, cnt = struct.unpack_from(e + "HHI", b, p)
            t = TAM.get(tipo, 1) * cnt
            dato = p + 8 if t <= 4 else struct.unpack_from(e + "I", b, p + 8)[0]
            if dato + max(t, 1) > len(b):
                continue
            v = valor(tipo, cnt, dato)
            if tag == 0x0110 and v:
                out["INSTRUME"] = v
            elif tag == 0x829A and v:
                out["EXPTIME"] = float(v)
            elif tag == 0x8827 and v:
                out["GAIN"] = int(v)                        # ISO: en DSLR hace de gain para agrupar
            elif tag in (0x9003, 0x0132) and v and "DATE-OBS" not in out:
                out["DATE-OBS"] = re.sub(r"^(\d{4}):(\d\d):(\d\d) ", r"\1-\2-\3T", str(v))
            elif tag in (0x8769, 0x014A) and v:             # sub-IFD de EXIF y sub-IFDs de la imagen
                ifd(int(v), visto)
        siguiente = struct.unpack_from(e + "I", b, off + 2 + 12 * min(n, 400))[0] if off + 6 + 12 * n <= len(b) else 0
        if siguiente:
            ifd(siguiente, visto)

    try:
        ifd(struct.unpack_from(e + "I", b, 4)[0], set())
    except struct.error:
        pass
    if out.get("INSTRUME"):
        out.setdefault("BAYERPAT", "RAW")
    return out


def _ficha(ruta):
    suf = ruta.suffix.lower()
    cab = _cabecera(ruta) if suf in EXT_FITS else (_exif_tiff(ruta) if suf in EXT_RAW else {})
    if cab.get("GAIN") is None and cab.get("ISOSPEED") is not None:
        cab["GAIN"] = cab.get("ISOSPEED")                  # FITS de DSLR: ISO en vez de gain
    exp = cab.get("EXPTIME", cab.get("EXPOSURE"))
    temp = cab.get("CCD-TEMP", cab.get("SET-TEMP"))
    return {
        "fichero": str(ruta), "tipo": _tipo(cab, ruta), "filtro": str(cab.get("FILTER") or "").strip() or None,
        "exp": _r(exp, 3) if isinstance(exp, (int, float)) else None,
        "gain": cab.get("GAIN"), "offset": cab.get("OFFSET"), "temp": _r(temp, 1) if isinstance(temp, (int, float)) else None,
        "bin": cab.get("XBINNING", 1), "tam": f"{cab.get('NAXIS1')}x{cab.get('NAXIS2')}" if cab.get("NAXIS1") else None,
        "noche": _noche(cab.get("DATE-OBS")) if cab.get("DATE-OBS") else None,
        "bayer": cab.get("BAYERPAT") or None, "camara": cab.get("INSTRUME"), "raw": ruta.suffix.lower() in EXT_RAW,
        "capas": int(cab.get("NAXIS3", 1) or 1) if cab.get("NAXIS", 2) == 3 else 1,
        "apilados": cab.get("STACKCNT") if isinstance(cab.get("STACKCNT"), (int, float)) else None,
    }


def _clave(f, campos):
    return tuple(f.get(c) for c in campos)


CAMPOS = {"light": ("filtro", "exp", "gain", "offset", "bin", "tam", "capas", "noche"),
          "dark": ("exp", "gain", "offset", "bin", "tam", "capas"), "flat": ("filtro", "gain", "bin", "tam", "capas", "noche"),
          "bias": ("gain", "offset", "bin", "tam", "capas"), "darkflat": ("exp", "gain", "bin", "tam", "capas")}


# Subcarpetas de procesados (de Siril, de otros programas o del usuario) y ficheros que son salidas, no subs.
# Por prefijo: «procesado_siril», «process_old», «stacked_v2»… (11 nov 2026: las versiones guardadas por el chat en
# procesado_siril entraron como lights de 3 capas y calibrate falló).
CARPETAS_PROCESADO = re.compile(r"(?i)^(_|\.|process|procesad|proc$|proc[_\- ]|masters?($|[_\- ])|output|salida|resultado|"
                                r"stack|apilad|integra|calibrat|registr|debayer|logs?$|preview|previa|export|final)")
FICHEROS_SALIDA = re.compile(r"(?i)^(pp_|r_pp_|r_|bkg_|master|stacked|integration|result)|_stacked|_integration|autosave")


def _recorrer(carpeta, excluir=None):
    raiz = H._ruta(carpeta, "carpeta")
    if not raiz.is_dir():
        raise FileNotFoundError(f"No existe la carpeta {raiz}.")
    excl = [str(x).strip().strip("\\/").lower() for x in (excluir or []) if str(x).strip()]
    fichas, saltados, carpetas_saltadas = [], 0, set()
    for p in raiz.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in EXT_FITS + EXT_RAW:
            continue
        rel = p.relative_to(raiz)
        dirs = [x for x in rel.parts[:-1]]
        rel_txt = "/".join(dirs).lower()
        malo = next((d for d in dirs if CARPETAS_PROCESADO.match(d)), None)
        if not malo:
            malo = next((e for e in excl if rel_txt == e.replace("\\", "/") or rel_txt.startswith(e.replace("\\", "/") + "/")
                         or e in [d.lower() for d in dirs]), None)
        if malo or FICHEROS_SALIDA.search(p.stem):
            saltados += 1
            carpetas_saltadas.add(str(Path(*dirs)) if dirs else p.name)
            continue
        try:
            f = _ficha(p)
        except (OSError, ValueError):
            saltados += 1
            continue
        if (f.get("apilados") or 0) > 1:            # un master o una versión procesada (STACKCNT), no un sub
            saltados += 1
            carpetas_saltadas.add(f"{Path(*dirs) if dirs else '.'}/{p.name} (apilado)")
            continue
        fichas.append(f)
    return raiz, fichas, {"n": saltados, "donde": sorted(carpetas_saltadas)[:20]}


def _agrupar(fichas):
    grupos = {}
    for f in fichas:
        if not f["tipo"]:
            continue
        k = (f["tipo"],) + _clave(f, CAMPOS[f["tipo"]])
        g = grupos.setdefault(k, {"tipo": f["tipo"], **{c: f.get(c) for c in CAMPOS[f["tipo"]]}, "n": 0, "temps": [],
                                  "ficheros": []})
        g["n"] += 1
        g["ficheros"].append(f["fichero"])
        if f.get("temp") is not None:
            g["temps"].append(f["temp"])
    out = []
    for g in grupos.values():
        t = g.pop("temps")
        g["temp"] = _r(float(np.median(t)), 1) if t else None
        g["temp_rango"] = _r(max(t) - min(t), 1) if t else None
        out.append(g)
    return sorted(out, key=lambda g: (["light", "flat", "dark", "darkflat", "bias"].index(g["tipo"]), str(g.get("filtro")), -g["n"]))


def _id_grupo(g):
    partes = [g["tipo"], g.get("filtro") or "", f"{g['exp']:g}s" if g.get("exp") else "", g.get("noche") or ""]
    return re.sub(r"[^\w.-]+", "_", "_".join(p for p in partes if p))


def inventarioSubs(siril, carpeta, excluir=None):
    """Paso 2 lineal: lee las cabeceras de una carpeta (y subcarpetas) y agrupa lights, darks, flats, bias y darks de
    flats por filtro, exposición, gain, offset, binning, tamaño y noche. No abre imágenes ni cambia nada. Se saltan las
    subcarpetas de procesados (_*, process, masters, output…), las salidas (pp_, r_, master, stacked…) y las de 'excluir'."""
    raiz, fichas, saltados = _recorrer(carpeta, excluir)
    grupos = _agrupar(fichas)
    sin_tipo = [f["fichero"] for f in fichas if not f["tipo"]]
    filtros = sorted({g["filtro"] for g in grupos if g["tipo"] == "light" and g.get("filtro")})
    avisos = []
    if sin_tipo:
        avisos.append(f"{len(sin_tipo)} ficheros sin tipo (ni IMAGETYP ni carpeta reconocible): p. ej. {Path(sin_tipo[0]).name}")
    for g in grupos:
        if g.get("temp_rango") and g["temp_rango"] > 2 and g["tipo"] in ("light", "dark"):
            avisos.append(f"{_id_grupo(g)}: la temperatura varía {g['temp_rango']} °C dentro del grupo")
    raros = [f for f in filtros if not re.fullmatch(r"(?i)(L|R|G|B|Ha|H-?alpha|OIII|O3|SII|S2|Hb|UVIR|UV-?IR|IR-?cut|"
                                                     r"no ?filter|none|clear|dual.*|tri.*|quad.*|L-?\w+|\w*band\w*)", f)]
    if raros:
        avisos.append(f"nombres de filtro poco habituales (revisa que no sean el mismo con otro nombre): {', '.join(raros)}")
    camaras = sorted({str(f["camara"]) for f in fichas if f.get("camara")})
    return {"carpeta": str(raiz), "ficheros": len(fichas), "saltados": saltados, "camaras": camaras,
            "osc": any(f.get("bayer") for f in fichas), "filtros": filtros,
            "grupos": [{"id": _id_grupo(g), **{k: v for k, v in g.items() if k != "ficheros"}} for g in grupos],
            "avisos": avisos}


# --- Revisión de la calibración -------------------------------------------------------------------------------

def _compatibles(light, grupos):
    def igual(a, b, tol=0.01):
        return a is None or b is None or abs(float(a) - float(b)) <= tol * max(1.0, abs(float(a)))
    darks = [g for g in grupos if g["tipo"] == "dark" and igual(g.get("exp"), light.get("exp")) and g.get("gain") == light.get("gain")
             and g.get("bin") == light.get("bin") and g.get("tam") == light.get("tam")]
    if light.get("temp") is not None:
        darks = sorted(darks, key=lambda g: abs((g.get("temp") if g.get("temp") is not None else 99) - light["temp"]))
    flats = [g for g in grupos if g["tipo"] == "flat" and g.get("filtro") == light.get("filtro") and g.get("bin") == light.get("bin")
             and g.get("tam") == light.get("tam")]
    flats = sorted(flats, key=lambda g: (g.get("noche") != light.get("noche"), -g["n"]))
    bias = [g for g in grupos if g["tipo"] == "bias" and g.get("gain") == light.get("gain") and g.get("bin") == light.get("bin")]
    dflats = [g for g in grupos if g["tipo"] == "darkflat" and flats and igual(g.get("exp"), flats[0].get("exp"))]
    return darks, flats, bias, dflats


def revisarCalibracion(siril, carpeta, excluir=None):
    """Paso 4 lineal: para cada grupo de lights, qué darks, flats y bias (o darks de flats) le corresponden y qué falta
    o no encaja (otra exposición, otro filtro, otra temperatura, otra noche)."""
    raiz, fichas, saltados = _recorrer(carpeta, excluir)
    grupos = _agrupar(fichas)
    out = []
    for lg in [g for g in grupos if g["tipo"] == "light"]:
        darks, flats, bias, dflats = _compatibles(lg, grupos)
        faltas, avisos = [], []
        if not darks:
            faltas.append(f"darks de {lg.get('exp')} s, gain {lg.get('gain')}")
        elif lg.get("temp") is not None and darks[0].get("temp") is not None and abs(darks[0]["temp"] - lg["temp"]) > 2:
            avisos.append(f"darks a {darks[0]['temp']} °C y lights a {lg['temp']} °C (> 2 °C)")
        if not flats:
            faltas.append(f"flats del filtro {lg.get('filtro')}")
        elif flats[0].get("noche") and lg.get("noche") and flats[0]["noche"] != lg["noche"]:
            avisos.append(f"flats de otra noche ({flats[0]['noche']}): vale si no se tocó el tren óptico")
        if flats and not bias and not dflats:
            faltas.append("bias o darks de flats para calibrar los flats")
        if darks and darks[0]["n"] < 15:
            avisos.append(f"pocos darks ({darks[0]['n']}; mejor ≥ 20)")
        if flats and flats[0]["n"] < 15:
            avisos.append(f"pocos flats ({flats[0]['n']}; mejor ≥ 20)")
        out.append({"lights": _id_grupo(lg), "n": lg["n"], "darks": _id_grupo(darks[0]) if darks else None,
                    "flats": _id_grupo(flats[0]) if flats else None, "bias": _id_grupo(bias[0]) if bias else None,
                    "darks_de_flats": _id_grupo(dflats[0]) if dflats else None, "faltan": faltas, "avisos": avisos,
                    "listo": not faltas})
    return {"carpeta": str(raiz), "saltados": saltados, "grupos_lights": out,
            "resumen": f"{sum(1 for x in out if x['listo'])} de {len(out)} grupos de lights con calibración completa."}


# --- Apilado ----------------------------------------------------------------------------------------------------

def _enlazar(ficheros, destino, base, ordenar=True):
    """Enlaces duros a los ficheros del usuario (mismo disco: sin copiar ni tocar los originales); si no se puede, copia."""
    destino.mkdir(parents=True, exist_ok=True)
    for i, f in enumerate(sorted(ficheros) if ordenar else list(ficheros), 1):
        d = destino / f"{base}_{i:05d}{Path(f).suffix.lower()}"
        if d.exists():
            continue
        try:
            os.link(f, d)
        except OSError:
            shutil.copy2(f, d)


INTERMEDIOS = re.compile(r"(?i)^(process|unidos|(light|dark|flat|bias|darkflat)\d+)$")


def _limpiar_intermedios(trabajo, tambien_masters=False):
    """Borra lo que genera la propia herramienta dentro de su carpeta de trabajo (~/.sirilastropilot/apilado/<proyecto>):
    enlaces y copias de los subs, secuencias, calibradas y registradas. Deja el master final y los candidatos. Nunca
    toca nada fuera de APILADO. Devuelve los GB liberados."""
    trabajo = Path(trabajo).resolve()
    if APILADO.resolve() not in trabajo.parents or not trabajo.is_dir():
        return 0.0
    libres = 0
    subs = [d for d in trabajo.iterdir() if d.is_dir() and (INTERMEDIOS.match(d.name) or (tambien_masters and d.name == "masters"))]
    for d in subs:
        libres += sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
        shutil.rmtree(d, ignore_errors=True)
    return round(libres / 1e9, 1)


def _progreso(texto):
    H.PROGRESO["texto"] = texto
    H.PROGRESO["desde"] = time.time()


def _medir_master(siril, ruta):
    """Ruido del fondo, estrellas (número, FWHM) y píxeles calientes sueltos del master, cargándolo en Siril."""
    siril.cmd("load", H._arg_cmd(Path(ruta)))
    info = H._info(siril)
    p = H._pixeles(siril, info)
    L = p.mean(axis=0)
    med = float(np.median(L[::4, ::4]))
    mad = 1.4826 * float(np.median(np.abs(L[::4, ::4] - med)))
    d = L[1:-1, 1:-1]
    vec = np.median(np.stack([L[:-2, 1:-1], L[2:, 1:-1], L[1:-1, :-2], L[1:-1, 2:]]), axis=0)
    calientes = int(((d - vec) > 10 * max(mad, 1e-7)).sum())
    est = H._estrellas(siril)
    return {"ruido_fondo": _r(mad, 7), "fondo": _r(med, 6), "estrellas": est.get("n"), "fwhm_px": est.get("fwhm_px_mediana"),
            "calientes_por_mp": _r(calientes / (L.size / 1e6), 1)}


def _fichero_seq(carpeta, seq):
    for nombre in (f"{seq}.seq", f"{seq}_.seq", f"{seq.rstrip('_')}_.seq"):
        if (Path(carpeta) / nombre).exists():
            return Path(carpeta) / nombre
    raise RuntimeError(f"No encuentro el fichero de secuencia de «{seq}» en {carpeta}")


def _regdata_seq(ruta):
    """Lee del .seq (texto) los datos de registro de cada imagen: líneas «R<capa> fwhm wfwhm redondez calidad fondo n H …».
    Los comandos por script no dejan la secuencia cargada en Siril, así que get_seq() no sirve aquí."""
    por_capa = {}
    for linea in Path(ruta).read_text(encoding="utf-8", errors="replace").splitlines():
        m = re.match(r"R(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)", linea)
        if m:
            capa = int(m.group(1))
            v = [float(x) for x in m.group(2, 3, 4, 5, 6)] + [int(float(m.group(7)))]
            por_capa.setdefault(capa, []).append(v)
    for capa in (1, 0, 2):                    # verde en OSC; la que tenga FWHM medidas
        filas = por_capa.get(capa) or []
        if filas and any(f[0] > 0 for f in filas):
            return filas
    return []


def _excluir_en_seq(ruta, indices):
    """Marca como no incluidas las imágenes (índices 0..n-1 en orden del .seq) y corrige el nº de seleccionadas."""
    lineas = Path(ruta).read_text(encoding="utf-8", errors="replace").splitlines()
    i_img, incl = 0, 0
    fuera = set(indices)
    for j, linea in enumerate(lineas):
        m = re.match(r"I\s+(\d+)\s+(\d+)(.*)$", linea)
        if m:
            sel = "0" if i_img in fuera else m.group(2)
            incl += sel == "1"
            lineas[j] = f"I {m.group(1)} {sel}{m.group(3)}"
            i_img += 1
    for j, linea in enumerate(lineas):
        if linea.startswith("S "):
            p = linea.split(" ")
            p[4] = str(incl)                      # S 'nombre' inicio n_imagenes n_seleccionadas …
            lineas[j] = " ".join(p)
            break
    Path(ruta).write_text("\n".join(lineas) + "\n", encoding="utf-8")


def _seleccion(ruta_seq, k=2.5, tramos=None):
    """Tras registrar: mide cada sub (FWHM ponderada, redondez, nº de estrellas, fondo) y excluye los que se alejan de la
    mediana más de k MAD hacia lo malo. Con varias noches (tramos = [(inicio, fin), …] en el orden del .seq) cada noche se
    juzga contra su propia mediana: si no, la noche de peor seeing entera saldría como «mala» (pasó el 11 nov 2026: 30 de
    43 subs de una noche fuera). Las diferencias entre noches ya las reparten los pesos. Devuelve la tabla y los índices."""
    datos = _regdata_seq(ruta_seq)
    if tramos and len(tramos) > 1:
        tablas, fuera_total = [], []
        for n, (a, b) in enumerate(tramos, 1):
            t, f = _seleccion_filas([(i, datos[i]) for i in range(a, min(b, len(datos)))], k)
            t["noche"] = n
            tablas.append(t)
            fuera_total += f
        return {"medidos": sum(t["medidos"] for t in tablas), "por_noche": tablas,
                "excluidos": [x for t in tablas for x in t["excluidos"]]}, fuera_total
    return _seleccion_filas(list(enumerate(datos)), k)


def _seleccion_filas(pares, k):
    filas = []
    for i, (fw, wfw, ro, _cal, bg, ne) in pares:
        if fw <= 0:
            continue
        filas.append({"i": i, "wfwhm": wfw or fw, "redondez": ro, "estrellas": ne, "fondo": bg})
    if len(filas) < 5:
        return {"medidos": len(filas), "excluidos": [], "nota": "pocos subs medidos: no se descarta ninguno"}, []

    def lim(campo, malo_alto):
        v = np.array([f[campo] for f in filas])
        m = float(np.median(v))
        s = 1.4826 * float(np.median(np.abs(v - m))) or 1e-9
        return (m + k * s) if malo_alto else (m - k * s), m

    l_fw, m_fw = lim("wfwhm", True)
    l_ro, m_ro = lim("redondez", False)
    l_ne, m_ne = lim("estrellas", False)
    l_bg, m_bg = lim("fondo", True)
    fuera = []
    for f in filas:
        motivos = []
        if f["wfwhm"] > l_fw:
            motivos.append("FWHM")
        if f["redondez"] < l_ro:
            motivos.append("redondez")
        if f["estrellas"] < l_ne:
            motivos.append("pocas estrellas (¿nubes?)")
        if f["fondo"] > l_bg:
            motivos.append("fondo alto (¿luna, nubes?)")
        if motivos:
            fuera.append({"sub": f["i"] + 1, "motivo": ", ".join(motivos), "wfwhm": _r(f["wfwhm"], 2),
                          "estrellas": f["estrellas"], "fondo": _r(f["fondo"], 5)})
    if len(fuera) > 0.3 * len(filas):              # nunca más de un 30 %: se quedan los peores por FWHM
        fuera = sorted(fuera, key=lambda x: -x["wfwhm"])[: int(0.3 * len(filas))]
    return {"medidos": len(filas), "medianas": {"wfwhm": _r(m_fw, 2), "redondez": _r(m_ro, 3), "estrellas": int(m_ne),
                                                 "fondo": _r(m_bg, 5)},
            "limites": {"wfwhm_max": _r(l_fw, 2), "redondez_min": _r(l_ro, 3), "estrellas_min": int(l_ne), "fondo_max": _r(l_bg, 5)},
            "excluidos": fuera}, [x["sub"] - 1 for x in fuera]


RECHAZOS = {"w": "winsorized sigma", "g": "ESD generalizado", "l": "ajuste lineal", "s": "sigma", "p": "percentil", "a": "MAD"}


def _compatibles_entre_si(gs):
    return len({(g.get("filtro"), g.get("exp"), g.get("gain"), g.get("offset"), g.get("bin"), g.get("tam"), g.get("capas"))
                for g in gs}) == 1


def apilarCandidatos(siril, carpeta, grupo=None, proyecto=None, rechazos=("w", "g", "l"), pesos=(False, True),
                     seleccionar=True, k=2.5, drizzle=False, excluir=None, conservar_intermedios=False):
    """Pasos 3–4 lineales: masters, calibración, debayer (OSC), registro, selección de subs y apilado comparando métodos
    de rechazo con y sin pesos. Varias noches juntas: cada una se calibra con lo suyo, se unen las calibradas y se
    registran y apilan contra una referencia común. Trabaja en ~/.sirilastropilot/apilado/<proyecto> con enlaces a los
    ficheros (los del usuario no se tocan). Deja cargado el master recomendado y lo guarda allí sin sobrescribir."""
    t0 = time.perf_counter()
    raiz, fichas, saltados = _recorrer(carpeta, excluir)
    grupos = _agrupar(fichas)
    lights = [g for g in grupos if g["tipo"] == "light"]
    if not lights:
        raise RuntimeError("No encuentro lights (IMAGETYP o carpeta «lights»). Mira inventarioSubs.")
    ids = {_id_grupo(g): g for g in lights}
    if isinstance(grupo, str) and grupo not in ("todos", "todas"):
        grupo = [grupo]
    if isinstance(grupo, (list, tuple)):
        falta = [x for x in grupo if x not in ids]
        if falta:
            raise ValueError(f"No hay grupo de lights «{falta[0]}». Grupos: {', '.join(ids)}")
        elegidos = [ids[x] for x in grupo]
    else:                                   # sin grupo (o «todos»): todas las noches si son compatibles entre sí
        elegidos = lights
    if not _compatibles_entre_si(elegidos):
        familias = {}
        for g in elegidos:
            familias.setdefault((g.get("filtro"), g.get("exp"), g.get("gain")), []).append(_id_grupo(g))
        raise ValueError("Los grupos de lights no se pueden apilar juntos (otro filtro, exposición o gain). Apila cada familia "
                         "por separado con 'grupo': " + " | ".join(", ".join(v) for v in familias.values()))
    osc = any(f.get("bayer") or f.get("raw") for f in fichas if any(f["fichero"] in g["ficheros"] for g in elegidos))
    base_nombre = _id_grupo(elegidos[0]) if len(elegidos) == 1 else f"{_id_grupo(elegidos[0]).rsplit('_', 1)[0]}_{len(elegidos)}noches"
    nombre = re.sub(r"[^\w.-]+", "_", proyecto or f"{raiz.name}_{base_nombre}")[:80]
    trabajo = APILADO / nombre
    _limpiar_intermedios(trabajo, tambien_masters=True)     # restos de un intento anterior (cortado o con otros subs)
    for sub in ("process", "masters", "candidatos", "unidos"):
        (trabajo / sub).mkdir(parents=True, exist_ok=True)
    r = {"grupos": [_id_grupo(g) for g in elegidos], "lights": sum(g["n"] for g in elegidos), "osc": osc, "trabajo": str(trabajo),
         "saltados": saltados, "pasos": [], "avisos": [], "calibracion": [], "candidatos": [], "errores": []}

    def cmd(*a):
        siril.cmd(*a)
        r["pasos"].append(" ".join(a))

    def cd(p):
        siril.cmd("cd", H._arg_cmd(Path(p)))

    hechos = {}                             # master ya hecho por grupo de calibración (darks compartidos entre noches)

    def master(g, tipo, extra=()):
        gid = _id_grupo(g)
        if gid in hechos:
            return hechos[gid]
        base = re.sub(r"\W+", "", f"{tipo}{len(hechos) + 1}")
        _progreso(f"{tipo}: master ({g['n']})")
        _enlazar(g["ficheros"], trabajo / base, base)
        cd(trabajo / base); cmd("convert", base, "-out=../process"); cd(trabajo / "process")
        seq = base
        if extra:
            cmd("calibrate", base, *extra)
            seq = "pp_" + base
        norma = "-norm=mul" if tipo == "flat" else "-nonorm"
        cmd("stack", seq, "rej", "3", "3", norma, f"-out=../masters/{base}_stacked")
        hechos[gid] = f"../masters/{base}_stacked"
        return hechos[gid]

    # 1) cada noche con su calibración
    for n_noche, lg in enumerate(elegidos, 1):
        darks, flats, bias, dflats = _compatibles(lg, grupos)
        cal = {"grupo": _id_grupo(lg), "darks": _id_grupo(darks[0]) if darks else None,
               "flats": _id_grupo(flats[0]) if flats else None}
        cal_flat = ()
        if dflats:
            cal_flat = (f"-dark={master(dflats[0], 'darkflat')}",)
        elif bias:
            cal_flat = (f"-bias={master(bias[0], 'bias')}",)
        args = []
        if darks:
            args += [f"-dark={master(darks[0], 'dark')}", "-cc=dark"]
            dt = (abs(darks[0]["temp"] - lg["temp"]) if darks[0].get("temp") is not None and lg.get("temp") is not None
                  else None)
            if dt is not None and dt > 2:
                if bias:                    # sin refrigerar: Siril escala el dark (necesita el bias para separar el offset)
                    args += [f"-bias={master(bias[0], 'bias')}", "-opt"]
                    cal["dark_escalado"] = f"-opt (darks {dt:g} °C más {'calientes' if darks[0]['temp'] > lg['temp'] else 'fríos'})"
                else:
                    r["avisos"].append(f"{cal['grupo']}: darks a {dt:g} °C de los lights y sin bias: no se pueden escalar "
                                       "(-opt); la corrección cosmética (-cc=dark) quita los calientes que queden")
        else:
            r["avisos"].append(f"{cal['grupo']}: sin darks")
        if flats:
            if not cal_flat:
                r["avisos"].append(f"{cal['grupo']}: flats sin bias ni darks de flats")
            args.append(f"-flat={master(flats[0], 'flat', cal_flat)}")
        else:
            r["avisos"].append(f"{cal['grupo']}: sin flats (viñeteo y polvo quedan en el master)")
        if osc:
            # Con drizzle, Bayer drizzle: las calibradas siguen CFA y el drizzle reparte cada fotosito en su canal
            # (más resolución de color que hacer drizzle sobre las ya debayerizadas).
            args += ["-cfa", "-equalize_cfa"] + ([] if drizzle else ["-debayer"])
        base = f"light{n_noche}"
        _progreso(f"noche {n_noche}/{len(elegidos)}: calibrar {lg['n']} lights")
        _enlazar(lg["ficheros"], trabajo / base, base)
        cd(trabajo / base); cmd("convert", base, "-out=../process"); cd(trabajo / "process")
        cmd("calibrate", base, *args)
        r["calibracion"].append(cal)
    # 2) una sola secuencia con todas las calibradas (enlaces + convert), registro contra una referencia común
    seq = "pp_light1"
    tramos = None
    if len(elegidos) > 1:
        calibradas, tramos = [], []
        for n_noche in range(1, len(elegidos) + 1):     # en orden de noche: los tramos de la selección salen de aquí
            de_noche = sorted((trabajo / "process").glob(f"pp_light{n_noche}_*.fit*"))
            tramos.append((len(calibradas), len(calibradas) + len(de_noche)))
            calibradas += de_noche
        if not calibradas:
            raise RuntimeError("No encuentro las calibradas de cada noche (pp_lightN_*.fit) para unirlas.")
        _enlazar([str(p) for p in calibradas], trabajo / "unidos", "todas", ordenar=False)
        cd(trabajo / "unidos"); cmd("convert", "todas", "-out=../process"); cd(trabajo / "process")
        seq = "todas"
    _progreso("registrar (dos pasadas)")
    cmd("register", seq, "-2pass")
    sel = {"excluidos": []}
    if seleccionar:
        _progreso("medir y seleccionar subs")
        try:
            ruta_seq = _fichero_seq(trabajo / "process", seq)
            sel, fuera = _seleccion(ruta_seq, k, tramos)
            if fuera:
                _excluir_en_seq(ruta_seq, fuera)
        except Exception as e:
            r["avisos"].append(f"selección no hecha: {str(e)[:150]}")
    r["seleccion"] = sel
    _progreso("aplicar el registro")
    if drizzle:
        # drizzle=True es ×2; un número es la escala. pixfrac 1 en OSC (Bayer drizzle: con menos quedan huecos de color).
        escala = 2.0 if drizzle is True else float(drizzle)
        pixfrac = 1.0 if osc else 0.9
        r["drizzle"] = {"escala": escala, "pixfrac": pixfrac, "bayer": osc}
        cmd("seqapplyreg", seq, "-filter-incl", "-drizzle", f"-scale={escala:g}", f"-pixfrac={pixfrac:g}")
    else:
        cmd("seqapplyreg", seq, "-filter-incl")
    # 3) candidatos
    n = 0
    for rej in rechazos:
        for peso in pesos:
            n += 1
            et = f"{RECHAZOS.get(rej, rej)}" + (" + pesos" if peso else "")
            salida = f"../candidatos/apilado_{n}_{rej}{'_w' if peso else ''}"
            _progreso(f"apilar {n}/{len(rechazos) * len(pesos)}: {et}")
            try:
                umbrales = ("0.3", "0.05") if rej == "g" else ("3", "3")   # ESD: fracción de atípicos y significación
                st = ["stack", f"r_{seq}", "rej", rej, *umbrales, "-norm=addscale", "-output_norm", "-32b"]
                if osc:
                    st.append("-rgb_equal")
                if peso:
                    st.append("-weight=wfwhm")
                st.append(f"-out={salida}")
                t1 = time.perf_counter()
                cmd(*st)
                ruta = (trabajo / "process" / salida).resolve().with_suffix(".fit")
                m = _medir_master(siril, ruta)
                r["candidatos"].append({"id": f"apilado_{n}", "metodo": et, "fichero": str(ruta), "metricas": m,
                                        "segundos": _r(time.perf_counter() - t1, 0)})
            except Exception as e:
                r["errores"].append(f"{et}: {e}")
    c = r["candidatos"]
    if c:
        fw = [x["metricas"]["fwhm_px"] for x in c if x["metricas"]["fwhm_px"]]
        fmin = min(fw) if fw else None
        hmin = min(x["metricas"]["calientes_por_mp"] for x in c)
        ok = [x for x in c if (fmin is None or (x["metricas"]["fwhm_px"] or 99) <= 1.03 * fmin)
              and x["metricas"]["calientes_por_mp"] <= max(1.5 * hmin, hmin + 2)]
        mejor = min(ok or c, key=lambda x: x["metricas"]["ruido_fondo"] or 1)
        r["recomendado"] = mejor["id"]
        r["motivo"] = (f"{mejor['metodo']}: el ruido de fondo más bajo ({mejor['metricas']['ruido_fondo']}) con la FWHM a menos "
                       f"de un 3 % de la mejor y sin más píxeles calientes sueltos que los demás.")
        siril.cmd("load", H._arg_cmd(Path(mejor["fichero"])))
        final = trabajo / f"master_{nombre}.fit"
        k2 = 2
        while final.exists():
            final = trabajo / f"master_{nombre}_{k2}.fit"
            k2 += 1
        siril.cmd("save", H._arg_cmd(final.with_suffix("")))
        r["master"] = str(final)
        if not conservar_intermedios:           # calibradas y registradas: decenas de GB que ya no hacen falta
            cd(trabajo)
            r["intermedios_borrados_gb"] = _limpiar_intermedios(trabajo)
    else:
        r["motivo"] = "Ningún apilado salió: ver errores y pasos."
    r["segundos"] = _r(time.perf_counter() - t0, 0)
    r["leyenda"] = ("ruido_fondo: MAD del fondo (menos es mejor); fwhm_px y estrellas: del master; calientes_por_mp: píxeles sueltos "
                    "muy por encima de sus vecinos (restos de calientes o de rayos). seleccion: subs descartados por FWHM, redondez, "
                    "estrellas o fondo (k MAD de la mediana; como mucho un 30 %), sobre todas las noches juntas. El master elegido "
                    "queda cargado y guardado en la carpeta de trabajo; los ficheros del usuario no se tocan.")
    _progreso("")
    return r


LISTA_APILADO = {"inventarioSubs": inventarioSubs, "revisarCalibracion": revisarCalibracion, "apilarCandidatos": apilarCandidatos}
