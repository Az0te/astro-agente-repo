# SirilAstroPilot — consultas a internet (SIMBAD, Wikipedia, una página web) para documentar el objeto.
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# Sólo HTTPS con verificación de certificado (contexto por defecto de ssl). Desactivadas si existe el fichero
# ~/.sirilastropilot/sin-internet (lo pone y lo quita la casilla «Internet» del chat). No se envía nada del usuario:
# sólo el nombre o las coordenadas del objeto, o la URL que se pida.

import html
import json
import re
import ssl
import urllib.parse
import urllib.request

import herramientas as H

UA = "SirilAstroPilot/0.1 (astrophotography processing assistant)"
SIN_INTERNET = H.DATOS / "sin-internet"
TAP = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"
SESAME = "https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?"
TAPVIZIER = "https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync"
_r = H._r


def _permitido():
    if SIN_INTERNET.exists():
        raise RuntimeError("Internet está desactivado (casilla «Internet» del chat sin marcar). No reintentar: seguir sin "
                           "consultar o pedírselo al usuario.")


def _get(url, timeout=20, maximo=2_000_000):
    if not url.lower().startswith("https://"):
        raise ValueError("Sólo direcciones https://.")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "es,en"})
    with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as f:
        datos = f.read(maximo)
        cs = f.headers.get_content_charset() or "utf-8"
    return datos.decode(cs, errors="replace")


def _tap(adql, url=TAP, timeout=12):
    q = urllib.parse.urlencode({"request": "doQuery", "lang": "adql", "format": "json", "query": adql})
    d = json.loads(_get(f"{url}?{q}", timeout=timeout))
    cols = [c["name"] for c in d.get("metadata", [])]
    return [dict(zip(cols, fila)) for fila in d.get("data", [])]


def _txt(x):
    return str(x).replace("'", "''")


# Qué señal cabe esperar según el tipo de SIMBAD (criterio de la guía, Paso 1 lineal).
EMISION = [
    (("HII", "HII region"), "región HII: Hα fuerte, [OIII] y [SII]; la banda estrecha o dual band rinde mucho"),
    (("PN", "Planetary"), "nebulosa planetaria: [OIII] y Hα; núcleo brillante y halo débil"),
    (("SNR", "SuperNova Remnant"), "resto de supernova: Hα, [SII] y [OIII] en filamentos"),
    (("RNe", "Reflection"), "nebulosa de reflexión: continuo azul de las estrellas; banda ancha, nada en banda estrecha"),
    (("DNe", "Dark"), "nebulosa oscura: polvo en absorción; banda ancha y mucha integración; cuidado con el gradiente"),
    (("ISM", "Cld", "MoC", "Cloud"), "nube/medio interestelar: polvo y algo de Hα; banda ancha"),
    (("G", "GiG", "GiP", "Sy", "Sbrst", "AGN", "Galaxy", "LSB", "EmG", "BiC", "IG"),
     "galaxia: banda ancha; Hα sólo en sus regiones HII; núcleo con mucho rango dinámico"),
    (("OpC", "GlC", "Cl*", "Cluster"), "cúmulo estelar: banda ancha; el color de las estrellas manda"),
]


def _emision(tipo):
    t = tipo or ""
    for claves, texto in EMISION:
        if any(t == k or t.startswith(k) or k.lower() in t.lower() for k in claves):
            return texto
    return None


def simbad(siril, objeto):
    """Tipo, coordenadas, tamaño y magnitud de un objeto según SIMBAD (resuelto con Sesame)."""
    _permitido()
    nombre = str(objeto or "").strip()
    if not nombre or len(nombre) > 80:
        raise ValueError("objeto: nombre del catálogo, p. ej. «M 31» o «IC 1396».")
    xml = _get(SESAME + urllib.parse.quote(nombre))
    bloque = xml.split("<Resolver", 2)[1] if "<Resolver" in xml else ""
    m = re.search(r"<oname>(.*?)</oname>", bloque)
    if not m:
        return {"encontrado": False, "objeto": nombre}
    principal = html.unescape(m.group(1))
    def campo(et):
        x = re.search(rf"<{et}>([^<]+)</{et}>", bloque)
        return x.group(1) if x else None
    v = re.search(r'<mag band="V">\s*<v>([\d.+-]+)</v>', bloque)
    tipo = campo("otype")
    r = {"encontrado": True, "objeto": nombre, "id_simbad": principal, "tipo": tipo,
         "ra_grados": _r(float(campo("jradeg")), 5) if campo("jradeg") else None,
         "dec_grados": _r(float(campo("jdedeg")), 5) if campo("jdedeg") else None,
         "mag_v": _r(float(v.group(1)), 2) if v else None, "tamano_arcmin": None, "fuente": "SIMBAD vía Sesame (CDS)"}
    try:                                         # tamaño: sólo si la TAP de SIMBAD contesta
        filas = _tap(f"SELECT TOP 1 galdim_majaxis, galdim_minaxis FROM basic WHERE main_id = '{_txt(principal)}'", timeout=8)
        if filas and filas[0].get("galdim_majaxis"):
            r["tamano_arcmin"] = [_r(filas[0]["galdim_majaxis"], 2), _r(filas[0]["galdim_minaxis"], 2)]
    except Exception:
        r["nota"] = "Tamaño no disponible (el servicio de consultas de SIMBAD no ha contestado)."
    e = _emision(tipo)
    if e:
        r["senal_esperada"] = e
    return r


def wikipedia(siril, texto, idioma="es"):
    """Resumen del artículo de Wikipedia (en el idioma pedido y, si no hay, en inglés)."""
    _permitido()
    q = str(texto or "").strip()
    if not q or len(q) > 120:
        raise ValueError("texto: nombre del objeto, cámara, telescopio o filtro.")
    # Títulos exactos (con redirecciones): el texto tal cual y, para Messier, «Messier N». Nada de páginas de
    # desambiguación ni de resultados de búsqueda cuyo título no contenga la designación («IC 1396» en es daba el
    # «Catálogo Collinder», 10 nov 2026).
    titulos = [q]
    m = re.fullmatch(r"(?i)m\s*(\d{1,3})", q)
    if m:                                        # «M 31» en es redirige a una autopista: Messier primero
        titulos.insert(0, f"Messier {m.group(1)}")
    norm = re.sub(r"\s+", "", q).lower()

    def resumen(base, titulo):
        try:
            d = json.loads(_get(f"{base}/api/rest_v1/page/summary/" + urllib.parse.quote(titulo.replace(" ", "_"))))
        except Exception:
            return None
        return None if d.get("type") == "disambiguation" or not d.get("extract") else d

    for lang in dict.fromkeys([str(idioma or "es")[:2], "en"]):
        base = f"https://{lang}.wikipedia.org"
        d = next((x for x in (resumen(base, t) for t in titulos) if x), None)
        if d is None:
            s = json.loads(_get(f"{base}/w/api.php?" + urllib.parse.urlencode(
                {"action": "query", "list": "search", "srsearch": q, "srlimit": 5, "format": "json"})))
            for res in s.get("query", {}).get("search", []):
                if norm in re.sub(r"\s+", "", res["title"]).lower():
                    d = resumen(base, res["title"])
                    if d:
                        break
        if d:
            return {"titulo": d.get("title"), "resumen": (d.get("extract") or "")[:2500], "idioma": lang,
                    "url": d.get("content_urls", {}).get("desktop", {}).get("page")}
    return {"encontrado": False, "texto": q}


def leerWeb(siril, url, maximo=8000):
    """Texto limpio de una página https (sin scripts, estilos ni etiquetas), recortado."""
    _permitido()
    t = _get(str(url))
    t = re.sub(r"(?is)<(script|style|noscript|svg|head)[^>]*>.*?</\1>", " ", t)
    t = re.sub(r"(?s)<[^>]+>", " ", t)
    t = re.sub(r"\s+", " ", html.unescape(t)).strip()
    n = max(500, min(20000, int(maximo)))
    return {"url": url, "caracteres": len(t), "texto": t[:n] + ("…" if len(t) > n else "")}


def documentarObjeto(siril, objeto=None, idioma="es"):
    """Ficha del objeto de la imagen cargada: lo identifica por OBJECT (o por la astrometría), y junta tipo, tamaño,
    señal esperada, resumen de Wikipedia y estrellas brillantes del campo (posibles halos y reflejos)."""
    _permitido()
    k = siril.get_image_keywords() if siril.is_image_loaded() else None
    nombre = objeto or (getattr(k, "object", None) or "").strip() or None
    r = {"identificado_por": None}
    if nombre:
        # «IC 1396 sin filtro» → «IC 1396»: prueba el texto entero y luego quita palabras por la derecha.
        partes = nombre.split()
        for n in range(len(partes), 0, -1):
            s = simbad(siril, " ".join(partes[:n]))
            if s.get("encontrado"):
                r.update(identificado_por="OBJECT" if not objeto else "objeto", simbad=s)
                break
    ra = dec = None
    if k is not None and getattr(k, "pltsolvd", False) and k.ra is not None:
        ra, dec = float(k.ra), float(k.dec)
    if "simbad" not in r and ra is not None:
        try:
            filas = _tap("SELECT TOP 1 main_id FROM basic WHERE otype IN ('HII','PN','SNR','RNe','DNe','G','GiG','GiP','OpC','GlC','ISM') "
                     f"AND CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra}, {dec}, 0.5)) = 1 "
                         f"ORDER BY DISTANCE(POINT('ICRS', ra, dec), POINT('ICRS', {ra}, {dec}))")
            if filas:
                r.update(identificado_por="astrometría", simbad=simbad(siril, filas[0]["main_id"]))
        except Exception:
            r["nota_astrometria"] = "El servicio de consultas de SIMBAD no contesta: no puedo identificar por coordenadas."
    if "simbad" not in r:
        r["aviso"] = "No identifico el objeto: ni OBJECT reconocible ni astrometría. Pide el nombre al usuario."
        return r
    s = r["simbad"]
    try:
        r["wikipedia"] = wikipedia(siril, s["id_simbad"], idioma)
    except Exception as e:
        r["wikipedia"] = {"error": str(e)[:200]}
    c_ra, c_dec = (ra, dec) if ra is not None else (s.get("ra_grados"), s.get("dec_grados"))
    radio = 1.0
    if k is not None and getattr(k, "focal_length", None) and getattr(k, "pixel_size_x", None):
        info = H._info(siril)
        escala = 206.265 * k.pixel_size_x * max(1, k.binning_x or 1) / k.focal_length
        radio = min(3.0, 0.5 * escala * max(info["ancho"], info["alto"]) / 3600)
    if c_ra is not None:
        try:                                     # catálogo de estrellas brillantes (Yale, V/50) en VizieR
            filas = _tap('SELECT TOP 8 Name, RAJ2000, DEJ2000, Vmag FROM "V/50/catalog" WHERE Vmag < 7 AND '
                         f"1 = CONTAINS(POINT('ICRS', RAJ2000, DEJ2000), CIRCLE('ICRS', {c_ra}, {c_dec}, {radio:.3f})) "
                         "ORDER BY Vmag", url=TAPVIZIER, timeout=12)
        except Exception:
            filas = None
            r["estrellas_brillantes"] = "no disponible (el servicio de catálogos de VizieR no contesta)"
        if filas is not None:
            r["estrellas_brillantes"] = [{"id": (f.get("Name") or "").strip(), "mag_v": _r(f.get("Vmag"), 1),
                                          "ra": _r(f.get("RAJ2000"), 4), "dec": _r(f.get("DEJ2000"), 4)} for f in filas]
        r["radio_busqueda_grados"] = _r(radio, 2)
        if filas and any((f.get("Vmag") or 9) < 4 for f in filas):
            r["nota_estrellas"] = "Hay estrellas de mag < 4 en el campo: vigilar halos, reflejos y núcleos saturados (Paso 8 no lineal)."
    return r


LISTA_WEB = {"simbad": simbad, "wikipedia": wikipedia, "leerWeb": leerWeb, "documentarObjeto": documentarObjeto}
