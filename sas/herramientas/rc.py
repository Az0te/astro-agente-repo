# SetiAstroPilot — RC Astro (BlurXTerminator, NoiseXTerminator, StarXTerminator) con su programa de línea de comandos.
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# SASpro trae una ventana para RC Astro (setiastro.saspro.rcastro), pero su modo sin ventana abre un diálogo de progreso
# y mensajes, y pide la ruta del programa en sus preferencias. Aquí se llama directamente a rc-astro (el mismo programa
# que usa SASpro): se escribe la imagen en un FITS temporal de 32 bits, se lanza el producto y se lee el resultado.
# Trabaja con arrays (canales, alto, ancho) 0–1 y no toca ninguna vista: quien llama aplica el resultado con deshacer.
# (16 nov 2026; rc-astro 2.6.11, esquema 6.)

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

PRODUCTOS = {"bxt": "BlurXTerminator", "nxt": "NoiseXTerminator", "sxt": "StarXTerminator"}
_ESTADO = {}


def exe():
    """Ruta de rc-astro: variable RCASTRO_EXE, la que guardó SASpro (rcastro/exe_path), la de instalación por defecto o
    el PATH. None si no está."""
    cands = [os.environ.get("RCASTRO_EXE")]
    try:
        from PyQt6.QtCore import QSettings
        cands.append(str(QSettings().value("rcastro/exe_path", "") or ""))
    except Exception:
        pass
    if sys.platform == "win32":
        for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramW6432"), r"C:\Program Files"):
            if base:
                cands.append(str(Path(base) / "RC-Astro" / "CLI" / "rc-astro.exe"))
    else:
        cands += ["/Applications/RC-Astro/rc-astro", "/usr/local/bin/rc-astro", "/opt/rc-astro/rc-astro"]
    cands.append(shutil.which("rc-astro") or "")
    for c in cands:
        if c and Path(c).is_file():
            return str(c)
    return None


def _sin_ventana():
    return {"creationflags": 0x08000000} if sys.platform == "win32" else {}      # CREATE_NO_WINDOW


def estado(refrescar=False):
    """Versión del programa y licencia de cada producto (rc-astro --json). Se guarda en memoria."""
    if _ESTADO and not refrescar:
        return dict(_ESTADO)
    e = exe()
    r = {"exe": e, "disponible": False, "productos": {}}
    if e:
        try:
            out = subprocess.run([e, "--no-banner", "--json"], capture_output=True, text=True, timeout=60,
                                 **_sin_ventana()).stdout
            j = json.loads(out[out.find("{"):])
            r["version"] = j.get("cliVersion")
            r["esquema"] = j.get("schemaVersion")
            for p in j.get("products") or []:
                lic = p.get("license") or {}
                r["productos"][p.get("key")] = {"valida": bool(lic.get("valid")), "modelos": p.get("mlVersions"),
                                                "licencia": lic.get("status")}
            r["disponible"] = any(v["valida"] for v in r["productos"].values())
        except Exception as ex:
            r["error"] = str(ex)[:200]
    _ESTADO.clear()
    _ESTADO.update(r)
    return dict(r)


def hay(producto):
    """True si rc-astro está y el producto tiene licencia válida."""
    return bool(estado()["productos"].get(producto, {}).get("valida"))


def _host():
    try:
        from setiastro.saspro._generated.build_info import APP_VERSION
        return f"SASPro-{str(APP_VERSION).strip()}"
    except Exception:
        return "SASPro"


def _escribir(p, ruta):
    from astropy.io import fits
    a = np.clip(np.asarray(p, dtype=np.float32), 0.0, 1.0)
    fits.PrimaryHDU(a[0] if a.shape[0] == 1 else a).writeto(ruta, overwrite=True)


def rodilla_color(x, k=0.9):
    """Núcleos por encima de 1 sin recortar canal a canal: con 3 canales, el canal mayor pasa por una rodilla suave
    (k + (1 − k)·tanh) y los otros se escalan igual, así el núcleo conserva el color de la estrella. Recortar cada canal
    a 1 deja núcleos de otro color (Lemmon, 27-nov: disco blanco-azulado con una mancha roja al lado tras estirar)."""
    x = np.nan_to_num(np.asarray(x, dtype=np.float32))
    m = x.max(0) if x.shape[0] == 3 else x[0]
    sobre = m > k
    if sobre.any():
        m2 = np.where(sobre, k + (1 - k) * np.tanh((m - k) / (1 - k)), m)
        x = x * np.where(sobre, m2 / np.maximum(m, 1e-9), 1.0)[None].astype(np.float32)
    return np.clip(x, 0.0, 1.0)


def _leer(ruta, canales, recortar=True):
    from astropy.io import fits
    with fits.open(ruta, memmap=False) as h:
        a = np.asarray(h[0].data, dtype=np.float32)
    if a.ndim == 2:
        a = a[np.newaxis]
    if a.ndim == 3 and a.shape[0] not in (1, 3) and a.shape[-1] in (1, 3):
        a = np.moveaxis(a, -1, 0)
    if a.shape[0] != canales:
        raise RuntimeError(f"rc-astro devolvió {a.shape[0]} canales y la imagen tiene {canales}.")
    return np.clip(np.nan_to_num(a), 0.0, 1.0) if recortar else np.clip(np.nan_to_num(a), 0.0, None)


def _opciones(producto, op):
    """Opciones de la línea de comandos a partir de un dict con nombres de la herramienta."""
    a = []
    if producto == "bxt":
        if op.get("correct_only"):
            a.append("--correct-only")
        else:
            a += ["--sharpen-stars", f"{float(op.get('stars', 0.30)):g}",
                  "--sharpen-nonstellar", f"{float(op.get('nonstellar', 0.45)):g}"]
        if op.get("halos"):
            a += ["--adjust-star-halos", f"{float(op['halos']):g}"]
        if op.get("psf"):                                   # diámetro PSF no estelar a mano
            a += ["--no-auto-nonstellar-psf", "--nonstellar-diameter", f"{float(op['psf']):g}"]
    elif producto == "nxt":
        a += ["--denoise", f"{float(op.get('denoise', 0.6)):g}"]
        if op.get("color") is not None:
            a += ["--denoise-color", f"{float(op['color']):g}"]
        if op.get("iteraciones"):
            a += ["--iterations", f"{float(op['iteraciones']):g}"]
        if op.get("escala"):
            a += ["--frequency-scale", f"{float(op['escala']):g}"]
    elif producto == "sxt":
        a.append("--stars")
        if op.get("unscreen"):
            a.append("--unscreen")
    if op.get("modelo"):
        a += ["--ml-version", f"{float(op['modelo']):g}"]
    return a


def correr(p, producto, timeout=1800, **op):
    """Lanza un producto sobre p (canales, alto, ancho). Devuelve el resultado; con sxt, (sin_estrellas, estrellas)."""
    if producto not in PRODUCTOS:
        raise ValueError(f"Producto desconocido: {producto} (bxt, nxt o sxt).")
    e = exe()
    if not e:
        raise RuntimeError("No encuentro rc-astro (RC Astro CLI). Instálalo desde rc-astro.com o pon su ruta en la "
                           "variable RCASTRO_EXE.")
    if not hay(producto):
        raise RuntimeError(f"{PRODUCTOS[producto]} no tiene licencia válida en rc-astro (rc-astro license).")
    p = np.asarray(p, dtype=np.float32)
    tmp = Path(tempfile.mkdtemp(prefix="sap_rcastro_"))
    try:
        ent, sal = tmp / "entrada.fits", tmp / f"salida.fits"
        # BlurX concentra el flujo y sube los núcleos por encima de 1, y rc-astro recorta su salida a 1 canal a canal:
        # entra a la mitad y, a la vuelta, los núcleos que pasan de 1 van por una rodilla que conserva el color
        holgura = 0.5 if producto == "bxt" else 1.0
        _escribir(p * np.float32(holgura) if holgura != 1.0 else p, ent)
        cmd = [e, "--no-banner", producto, str(ent), "-o", str(sal), "--overwrite", "--depth", "32F",
               *_opciones(producto, op)]
        if op.get("dispositivo"):
            cmd += ["--device", str(op["dispositivo"])]
        if (estado().get("esquema") or 0) >= 6:
            cmd += ["--host", _host()]
        t0 = time.perf_counter()
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=str(tmp), **_sin_ventana())
        if r.returncode != 0 or not sal.exists():
            msg = (r.stderr or r.stdout or "").strip().splitlines()[-3:]
            raise RuntimeError(f"rc-astro {producto} falló (código {r.returncode}): {' | '.join(msg)[:400]}")
        res = _leer(sal, p.shape[0], recortar=holgura == 1.0)
        if holgura != 1.0:
            res = res / np.float32(holgura)
            # 28-nov (Lemmon): BlurX sube cada canal del núcleo a su manera; donde pasa de 0,9 el núcleo toma el color
            # de la entrada y una rodilla sin meseta (si no, anillos de color al calibrar)
            if producto == "bxt" and p.ndim == 3 and p.shape[0] == 3:
                try:
                    import tomas_estrellas as _TE
                    res, _ESTADO["nucleos_protegidos"] = _TE.proteger_nucleos_deconv(p, res)
                except Exception as ex:  # noqa: BLE001
                    _ESTADO["nucleos_protegidos"] = f"error: {ex}"
            res = rodilla_color(res)
        if producto == "nxt" and p.ndim == 3 and res.shape == p.shape:
            # 28-nov (Lemmon): NXT rehace los núcleos brillantes (0,9 → 1,0–2,0, cada canal distinto): vuelven a la entrada
            try:
                import tomas_estrellas as _TE
                res, _ESTADO["nucleos_protegidos_nxt"] = _TE.proteger_nucleos_nxt(p, res)
            except Exception as ex:  # noqa: BLE001
                _ESTADO["nucleos_protegidos_nxt"] = f"error: {ex}"
        if res.shape != p.shape:
            raise RuntimeError(f"rc-astro devolvió {res.shape} y la imagen es {p.shape}.")
        _ESTADO["ultimo_segundos"] = round(time.perf_counter() - t0, 1)
        if producto == "sxt":
            est = sorted(tmp.glob("salida*stars*.fits"))
            estrellas = _leer(est[0], p.shape[0]) if est else np.clip(p - res, 0.0, 1.0)
            return res, estrellas
        return res
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
