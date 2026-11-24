# Ruta del Paso 10 (24 nov 2026), igual que alRuta de PixInsight (guia/herramientas/alineado.js).
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# IC 1396 con Qwen: 7,8 h de banda estrecha y 23 min de RGB; la guía pedía la ruta de paleta y el modelo inyectó el Hα y
# el OIII en la RGB: salió roja y rosa, sin el turquesa del OIII. Con la banda estrecha >= 4 veces el tiempo de la ancha,
# la nebulosa sale de las capas como paleta y la RGB sólo da las estrellas. alinearMasters lo mide y lo anota; la
# inyección (combinarCandidatos) se niega en nebulosas salvo «motivo» y la paleta deja de negarse.
# Este fichero es el mismo en siril/herramientas y sas/herramientas.

import base64
import re
import struct
import time
from pathlib import Path

RATIO_PALETA = 4.0
_ESTRECHO = re.compile(r"dual|duo|tri.?band|quad|extreme|enhance|ultimate|\d+(\.\d+)?\s*nm\b|"
                       r"\b(ha|h-?alpha|o3|oiii|s2|sii|hb|h-?beta)\b", re.I)


def es_estrecho(filtro):
    f = str(filtro or "").replace("_", " ")
    if re.search(r"\bRGB\b", f, re.I):
        return False
    return bool(_ESTRECHO.search(f))


def _num(v):
    try:
        return float(str(v).strip().strip("'").strip())
    except ValueError:
        return None


def _claves_fits(ruta):
    """Palabras clave de la cabecera primaria de un FITS (sin leer los datos)."""
    k = {}
    with open(ruta, "rb") as f:
        while True:
            bloque = f.read(2880)
            if len(bloque) < 2880:
                break
            for i in range(0, 2880, 80):
                c = bloque[i:i + 80].decode("ascii", "replace")
                nombre = c[:8].strip()
                if nombre == "END":
                    return k
                if c[8:10] == "= ":
                    v = c[10:]
                    if v.lstrip().startswith("'"):
                        m = re.match(r"\s*'((?:[^']|'')*)'", v)
                        v = m.group(1).replace("''", "'").strip() if m else v
                    else:
                        v = v.split("/")[0].strip()
                    k.setdefault(nombre, v)
    return k


def _xisf(ruta):
    """(palabras clave, PCL:TotalExposureTime en segundos o None) de un XISF."""
    with open(ruta, "rb") as f:
        cab = f.read(16)
        if cab[:8] != b"XISF0100":
            return {}, None
        xml = f.read(int.from_bytes(cab[8:12], "little")).decode("utf-8", "replace")
    k = {}
    for n, v in re.findall(r'<FITSKeyword name="([^"]+)" value="([^"]*)"', xml):
        v = v.replace("&apos;", "'").replace("&quot;", '"').replace("&amp;", "&").strip()
        k.setdefault(n.upper(), v[1:-1].strip() if v.startswith("'") and v.endswith("'") else v)
    tot = None
    m = re.search(r'<Property id="PCL:TotalExposureTime"([^>]*)>', xml)
    if m:
        a = m.group(1)
        val = re.search(r'value="([^"]+)"', a)
        if val:
            tot = _num(val.group(1))
        else:
            b = re.search(r'location="inline:base64"', a)
            cuerpo = re.search(r'<Property id="PCL:TotalExposureTime"[^>]*>([^<]+)</Property>', xml)
            if b and cuerpo:
                raw = base64.b64decode(cuerpo.group(1).strip())
                vs = [x for x in struct.unpack(f"<{len(raw) // 8}d", raw) if x > 0]
                tot = sum(vs) / len(vs) if vs else None
    return k, tot


def exposicion_y_filtro(ruta):
    """(segundos de integración del master o None, filtro). Por orden: PCL:TotalExposureTime (PixInsight, uno por
    canal: la media), LIVETIME (Siril), TOTALEXP, EXPTIME × NCOMBINE o × STACKCNT."""
    ruta = Path(ruta)
    try:
        if ruta.suffix.lower() == ".xisf":
            k, tot = _xisf(ruta)
        else:
            k, tot = _claves_fits(ruta), None
    except OSError:
        return None, ""
    filtro = str(k.get("FILTER", "") or "")
    if not tot:
        for n in ("LIVETIME", "TOTALEXP", "TOTEXP"):
            x = _num(k.get(n)) if k.get(n) is not None else None
            if x and x > 0:
                tot = x
                break
    if not tot:
        exp = _num(k.get("EXPTIME", k.get("EXPOSURE"))) if k.get("EXPTIME", k.get("EXPOSURE")) is not None else None
        n = None
        for c in ("NCOMBINE", "STACKCNT"):
            if k.get(c) is not None:
                n = _num(k.get(c))
                break
        if exp and n and exp > 0 and n > 0:
            tot = exp * n
    return (float(tot) if tot else None), filtro


def calcular(ficheros):
    """Ruta del Paso 10 a partir de los masters: {ancha_min, estrecha_min, proporcion, ruta, nota, masters}."""
    ancha = estrecha = 0.0
    det, sin_tiempo = [], []
    for f in ficheros:
        p = Path(f)
        seg, filtro = exposicion_y_filtro(p)
        nb = es_estrecho(filtro or p.stem)
        det.append({"fichero": p.name, "filtro": filtro or None, "banda": "estrecha" if nb else "ancha",
                    "minutos": round(seg / 60, 1) if seg else None})
        if not seg:
            sin_tiempo.append(p.name)
            continue
        if nb:
            estrecha += seg
        else:
            ancha += seg
    r = {"ancha_min": round(ancha / 60, 1), "estrecha_min": round(estrecha / 60, 1), "masters": det, "ruta": None,
         "t": round(time.time())}
    if ancha > 0 and estrecha > 0:
        r["proporcion"] = round(estrecha / ancha, 1)
        r["ruta"] = "paleta" if r["proporcion"] >= RATIO_PALETA else "inyectar"
        r["nota"] = (f"Banda estrecha ×{r['proporcion']} la ancha: en una nebulosa de emisión, RUTA DE PALETA (Paso 10). "
                     "No se inyecta: cada capa de banda estrecha → gradiente → estrellas fuera → ruido → el mismo estirado → "
                     "paletasCandidatos; la RGB (calibrada de color) sólo da las estrellas. Inyectar en la RGB sólo si es "
                     "nebulosa de emisión Y reflexión (combinarCandidatos con motivo)."
                     if r["ruta"] == "paleta" else
                     f"Banda ancha suficiente (banda estrecha ×{r['proporcion']}): Hα (y OIII) inyectados en la RGB con "
                     "combinarCandidatos, o paleta si el usuario la pide.")
    if sin_tiempo:
        r["sin_tiempo"] = sin_tiempo
    return r


def mensaje_inyeccion(ruta):
    return (f"Ruta de paleta (Paso 10): al alinear había {ruta.get('estrecha_min')} min de banda estrecha frente a "
            f"{ruta.get('ancha_min')} min de RGB (×{ruta.get('proporcion')}). En una nebulosa de emisión NO se inyecta: la "
            "nebulosa sale de las capas de banda estrecha como paleta (cada capa sin estrellas → ruido → el mismo estirado → "
            "paletasCandidatos → aplicarCandidato) y la RGB sólo da las estrellas (recombinarEstrellas sobre la paleta). "
            "Si es una nebulosa de emisión Y reflexión (polvo azul que sólo da la RGB) o el usuario pidió color RGB, repite "
            "con motivo: «<por qué>».")
