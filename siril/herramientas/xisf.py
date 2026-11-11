# SirilAstroPilot — lectura propia de XISF y paso a FITS.
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# 11 nov 2026: Siril 1.4 leyó un master XISF desplazado 1440 px en horizontal (los datos empezaban en otro byte de la
# sección de datos): cuñas y una franja vacía en medio que no existen. Aquí se lee el XISF según su especificación
# (cabecera XML con la geometría, el formato de muestra y la posición de los datos; sin compresión) y se escribe un FITS
# de 32 bits en coma flotante con las palabras clave del XISF, que Siril abre bien. Si el XISF está comprimido o no es
# como se espera, se devuelve None y se usa el fichero tal cual.

import re
from pathlib import Path

import numpy as np

_TIPOS = {"Float32": "<f4", "Float64": "<f8", "UInt16": "<u2", "UInt32": "<u4", "UInt8": "u1"}
_ESCALA = {"UInt16": 65535.0, "UInt32": 4294967295.0, "UInt8": 255.0}


def _tarjeta(clave, valor, comentario=""):
    clave = clave.upper()[:8]
    if isinstance(valor, str):
        v = "'" + valor.replace("'", "''")[:68] + "'"
        t = f"{clave:<8}= {v:<20}"
    else:
        t = f"{clave:<8}= {valor:>20}"
    if comentario:
        t += " / " + comentario
    return t[:80].ljust(80)


def xisf_a_fits(ruta, destino=None):
    """Convierte un XISF sin compresión a FITS (float32, filas de abajo arriba como manda FITS). Devuelve la ruta del FITS
    o None si no se puede (comprimido, varias imágenes, formato raro)."""
    ruta = Path(ruta)
    with open(ruta, "rb") as f:
        cab = f.read(16)
        if cab[:8] != b"XISF0100":
            return None
        n = int.from_bytes(cab[8:12], "little")
        xml = f.read(n).decode("utf-8", "replace")
    m = re.search(r"<Image\b[^>]*>", xml)
    if not m or "compression=" in m.group(0):
        return None
    im = m.group(0)
    geo = re.search(r'geometry="(\d+):(\d+)(?::(\d+))?"', im)
    loc = re.search(r'location="attachment:(\d+):(\d+)"', im)
    fmt = re.search(r'sampleFormat="(\w+)"', im)
    if not geo or not loc or not fmt or fmt.group(1) not in _TIPOS:
        return None
    W, H, C = int(geo.group(1)), int(geo.group(2)), int(geo.group(3) or 1)
    off, tam = int(loc.group(1)), int(loc.group(2))
    dt = np.dtype(_TIPOS[fmt.group(1)])
    if tam != W * H * C * dt.itemsize:
        return None
    with open(ruta, "rb") as f:
        f.seek(off)
        a = np.frombuffer(f.read(tam), dtype=dt).reshape(C, H, W)     # XISF: canal a canal, filas de arriba abajo
    a = a.astype(np.float32)
    if fmt.group(1) in _ESCALA:
        a = a / np.float32(_ESCALA[fmt.group(1)])
    a = a[:, ::-1, :]                                                  # FITS: primera fila = abajo
    tarjetas = [_tarjeta("SIMPLE", "T"), _tarjeta("BITPIX", -32), _tarjeta("NAXIS", 3 if C > 1 else 2),
                _tarjeta("NAXIS1", W), _tarjeta("NAXIS2", H)]
    if C > 1:
        tarjetas.append(_tarjeta("NAXIS3", C))
    tarjetas[0] = "SIMPLE  =                    T".ljust(80)
    vistas = {"SIMPLE", "BITPIX", "NAXIS", "NAXIS1", "NAXIS2", "NAXIS3", "BZERO", "BSCALE", "END", "EXTEND", "ROWORDER"}
    for k, v, c in re.findall(r'<FITSKeyword name="([^"]+)" value="([^"]*)" comment="([^"]*)"', xml):
        if k.upper() in vistas or not re.fullmatch(r"[A-Z0-9_-]{1,8}", k.upper()):
            continue
        v = v.replace("&apos;", "'").replace("&quot;", '"').replace("&amp;", "&")
        if v.startswith("'") and v.endswith("'"):
            tarjetas.append(_tarjeta(k, v[1:-1].strip(), c[:40]))
        elif re.fullmatch(r"[+-]?\d+(\.\d*)?([eE][+-]?\d+)?|T|F", v):
            tarjetas.append(f"{k.upper()[:8]:<8}= {v:>20}" + (f" / {c}" if c else ""))
        vistas.add(k.upper())
    tarjetas = [t[:80].ljust(80) for t in tarjetas] + ["END".ljust(80)]
    texto = "".join(tarjetas).encode("ascii", "replace")
    texto += b" " * ((-len(texto)) % 2880)
    datos = np.ascontiguousarray(a, dtype=">f4").tobytes()
    datos += b"\0" * ((-len(datos)) % 2880)
    destino = Path(destino) if destino else ruta.with_suffix(".fit")
    k = 2
    while destino.exists():
        destino = destino.with_name(f"{ruta.stem}_{k}.fit")
        k += 1
    destino.write_bytes(texto + datos)
    return destino
