# SyQon Studio (syqon-cli) para SirilAstroPilot y SetiAstroPilot: el mismo fichero en siril/herramientas y sas/herramientas.
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# syqon-cli es el programa de línea de comandos de SyQon Studio (1.2.0, 22 nov 2026). Se escribe la imagen en un FITS
# temporal de 32 bits, se lanza el modelo y se lee el resultado. Trabaja con arrays (canales, alto, ancho) 0–1 en el orden
# de filas de quien llama y no toca ninguna imagen: quien llama mide, compara y aplica con deshacer.
#
# Lo comprobado con un recorte de 1500 px del master RGB de IC 405 (22 nov 2026):
# - SyQon escribe la salida con ROWORDER = TOP-DOWN, pero si voltea o no las filas depende de la entrada: un FITS de
#   Siril salió volteado y uno escrito con astropy, no. No se fía de la cabecera: se compara la salida con la entrada
#   (correlación de la luminancia reducida, tal cual y volteada) y se deja en el orden de la entrada.
# - prism-essential (ruido) solo admite lineal (en no lineal sale con código 2). Reduce el ruido a la mitad.
# - axiom-mini (estrellas) solo vale sobre imagen ESTIRADA con --domain nonlinear: en lineal, con --axiom-stretch auto
#   la starless sale plana, y con identity deja una rejilla magenta y la capa de estrellas solo en verde.
# - deep-gradient (gradiente) necesita internet (descarga una referencia del cielo de SyQon) y corre en CPU.
# - parallax-nano (corrección/deconvolución) recorta a 1,0 en lineal desde la etapa de corrección: se ofrece con
#   --application 0,5 y se descarta si satura más píxeles que la original.
# - Deja ficheros .syq-export-* en la carpeta de salida: se trabaja en una carpeta temporal que se borra entera.
# Códigos de salida: 0 bien (stdout = ruta de salida), 2 dominio u opción no válida, 3 ruta, 4 licencia o modelo no
# disponible, 5/6 fallo del modelo.

import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

GRATIS = ("axiom-mini", "prism-essential", "parallax-nano", "deep-gradient")
CODIGOS = {0: "bien", 2: "dominio u opción no válida", 3: "ruta no válida", 4: "licencia o modelo no disponible",
           5: "fallo del modelo", 6: "fallo del modelo"}
_ESTADO = {}


class ErrorSyQon(RuntimeError):
    def __init__(self, msg, codigo=None):
        super().__init__(msg)
        self.codigo = codigo


def _sin_ventana():
    return {"creationflags": 0x08000000} if sys.platform == "win32" else {}      # CREATE_NO_WINDOW


def exe():
    """Ruta de syqon-cli: variable SYQON_EXE, registro (HKCU App Paths\\syqon-cli.exe), la carpeta de instalación por
    defecto (%LOCALAPPDATA%\\Programs\\SyQon Studio) o el PATH. None si no está."""
    cands = [os.environ.get("SYQON_EXE")]
    if sys.platform == "win32":
        try:
            import winreg
            for raiz in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
                try:
                    with winreg.OpenKey(raiz, r"Software\Microsoft\Windows\CurrentVersion\App Paths\syqon-cli.exe") as k:
                        cands.append(str(winreg.QueryValueEx(k, "")[0]))
                except OSError:
                    pass
        except Exception:
            pass
        la = os.environ.get("LOCALAPPDATA")
        if la:
            cands.append(str(Path(la) / "Programs" / "SyQon Studio" / "syqon-cli.exe"))
    else:
        cands += ["/Applications/SyQon Studio.app/Contents/MacOS/syqon-cli", "/usr/local/bin/syqon-cli"]
    cands.append(shutil.which("syqon-cli") or "")
    for c in cands:
        if c and Path(c).is_file():
            return str(c)
    return None


def estado(refrescar=False):
    """Versión y modelos (syqon-cli --version / --list-models). 'disponible' = el programa responde. La lista dice la clase
    de licencia (free, included, paid...), no si la cuenta tiene acceso: eso solo se sabe al lanzar (código 4)."""
    if _ESTADO and not refrescar:
        return dict(_ESTADO)
    e = exe()
    r = {"exe": e, "disponible": False, "modelos": {}}
    if e:
        try:
            v = subprocess.run([e, "--version"], capture_output=True, text=True, encoding="utf-8", errors="replace",
                               timeout=60, **_sin_ventana())
            r["version"] = (v.stdout or v.stderr).strip().splitlines()[-1] if (v.stdout or v.stderr).strip() else None
            r["disponible"] = v.returncode == 0
            lm = subprocess.run([e, "--list-models"], capture_output=True, text=True, encoding="utf-8", errors="replace",
                                timeout=60, **_sin_ventana())
            for linea in (lm.stdout or "").splitlines():
                m = re.match(r"\s*([a-z0-9][a-z0-9-]*)\s+(.+?)\s+·\s+(.*)$", linea)
                if m:
                    r["modelos"][m.group(1)] = {"licencia": m.group(2).strip(), "nombre": m.group(3).strip()}
        except Exception as ex:
            r["error"] = str(ex)[:200]
    if not r["disponible"]:
        r["nota"] = "SyQon Studio no está instalado (o syqon-cli no responde): los candidatos de SyQon se omiten."
    _ESTADO.clear()
    _ESTADO.update(r)
    return dict(r)


def hay(modelo=None):
    """True si syqon-cli responde y, con 'modelo', si ese modelo está en su lista y no ha dado ya código 4 en esta sesión."""
    e = estado()
    if not e["disponible"]:
        return False
    if modelo is None:
        return True
    if modelo not in e["modelos"] and e["modelos"]:
        return False
    return modelo not in _ESTADO.get("sin_licencia", ())


def de_pago(modelo):
    lic = (estado()["modelos"].get(modelo) or {}).get("licencia", "")
    return "paid" in lic.lower()


def _escribir(p, ruta):
    from astropy.io import fits
    a = np.clip(np.nan_to_num(np.asarray(p, dtype=np.float32)), 0.0, 1.0)
    fits.PrimaryHDU(a[0] if a.shape[0] == 1 else a).writeto(ruta, overwrite=True)


def _leer(ruta, canales):
    """Lee la salida tal como está guardada (sin hacer caso de ROWORDER: el orden se decide en _orientar)."""
    from astropy.io import fits
    with fits.open(ruta, memmap=False) as h:
        hdu = next(x for x in h if x.data is not None)
        a = np.asarray(hdu.data, dtype=np.float32)
    if a.ndim == 2:
        a = a[np.newaxis]
    if a.ndim == 3 and a.shape[0] not in (1, 3) and a.shape[-1] in (1, 3):
        a = np.moveaxis(a, -1, 0)
    if a.shape[0] != canales:
        if a.shape[0] == 3 and canales == 1:
            a = a.mean(axis=0, keepdims=True)
        elif a.shape[0] == 1 and canales == 3:
            a = np.repeat(a, 3, axis=0)
        else:
            raise ErrorSyQon(f"SyQon devolvió {a.shape[0]} canales y la imagen tiene {canales}.")
    return np.ascontiguousarray(np.nan_to_num(a))


def _volteada(p, q, b=8):
    """True si q es p volteada arriba-abajo: correlación de la luminancia reducida ×b (sin la mediana) tal cual y volteada."""
    def red(x):
        L = np.asarray(x, dtype=np.float32).mean(axis=0)
        h, w = (L.shape[0] // b) * b, (L.shape[1] // b) * b
        L = L[:h, :w].reshape(h // b, b, w // b, b).mean(axis=(1, 3))
        L = L - np.median(L)
        return np.clip(L, None, np.percentile(L, 99.5))

    A, B = red(p), red(q)

    def cc(x, y):
        d = float(np.sqrt((x * x).sum() * (y * y).sum()))
        return float((x * y).sum()) / d if d > 0 else 0.0
    return cc(A, B[::-1, :]) > cc(A, B) + 0.05


def saturados(p, umbral=0.9999):
    """Píxeles (de cualquier canal) en ≥ umbral."""
    return int((np.asarray(p) >= umbral).any(axis=0).sum()) if np.ndim(p) == 3 else int((np.asarray(p) >= umbral).sum())


def correr(p, modelo, dominio="linear", timeout=1800, extra=(), estrellas=False, gradiente=False):
    """Lanza 'modelo' sobre p (canales, alto, ancho, 0–1). Devuelve {"salida", "estrellas"?, "gradiente"?, "comando",
    "segundos", "proveedor"}. Lanza ErrorSyQon con .codigo si el programa falla (4 = licencia o modelo no disponible)."""
    e = exe()
    if not e:
        raise ErrorSyQon("SyQon Studio no está instalado (no encuentro syqon-cli).", None)
    p = np.asarray(p, dtype=np.float32)
    tmp = Path(tempfile.mkdtemp(prefix="ap_syqon_"))
    try:
        ent, sal = tmp / "entrada.fits", tmp / "salida.fits"
        _escribir(p, ent)
        cmd = [e, "-m", modelo, "--domain", dominio, "--precision", "f32", "--overwrite", "--quiet",
               *[str(x) for x in extra]]
        if estrellas:
            cmd += ["--stars-output", str(tmp / "estrellas.fits")]
        if gradiente:
            cmd += ["--gradient-output", str(tmp / "gradiente.fits")]
        cmd += [str(ent), str(sal)]
        t0 = time.perf_counter()
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout,
                           cwd=str(tmp), **_sin_ventana())
        seg = round(time.perf_counter() - t0, 1)
        texto = " ".join(["syqon-cli", *[c for c in cmd[1:] if not c.startswith(str(tmp))]])
        if r.returncode != 0 or not sal.exists():
            msg = " | ".join([x for x in (r.stderr or r.stdout or "").strip().splitlines() if x.strip()][-3:])[:400]
            if r.returncode == 4:
                _ESTADO.setdefault("sin_licencia", set()).add(modelo)
            raise ErrorSyQon(f"SyQon {modelo}: código {r.returncode} ({CODIGOS.get(r.returncode, 'fallo')}): {msg}",
                             r.returncode)
        out = {"salida": _leer(sal, p.shape[0]), "comando": texto, "segundos": seg}
        if out["salida"].shape != p.shape:
            raise ErrorSyQon(f"SyQon devolvió {out['salida'].shape} y la imagen es {p.shape}.")
        voltear = _volteada(p, out["salida"])
        if estrellas and (tmp / "estrellas.fits").exists():
            out["estrellas"] = _leer(tmp / "estrellas.fits", p.shape[0])
        if gradiente and (tmp / "gradiente.fits").exists():
            out["gradiente"] = _leer(tmp / "gradiente.fits", p.shape[0])
        if voltear:
            for k in ("salida", "estrellas", "gradiente"):
                if k in out:
                    out[k] = np.ascontiguousarray(out[k][:, ::-1, :])
        out["volteada"] = voltear
        prov = re.findall(r"provider=(\w+)", r.stdout or "")
        if prov:
            out["proveedor"] = prov[-1]
        return out
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# --- Las cuatro variantes que usan los *Candidatos ----------------------------------------------------------

def ruido(p, timeout=1800):
    """prism-essential: solo lineal."""
    if float(np.median(p)) > 0.05:
        raise ErrorSyQon("prism-essential solo admite imagen lineal (en no lineal syqon-cli da código 2).", 2)
    return correr(p, "prism-essential", "linear", timeout)


def gradiente(p, timeout=1800):
    """deep-gradient sobre lineal; devuelve también el modelo de fondo ('gradiente'). Necesita internet."""
    return correr(p, "deep-gradient", "linear", timeout, gradiente=True)


def estrellas(p, timeout=1800):
    """axiom-mini sobre imagen ESTIRADA (--domain nonlinear). En lineal se niega (sale rota)."""
    if float(np.median(p)) < 0.05:
        raise ErrorSyQon("axiom-mini solo funciona sobre imagen estirada (en lineal deja la starless plana o con rejilla "
                         "magenta): estira primero.", 2)
    r = correr(p, "axiom-mini", "nonlinear", timeout, estrellas=True)
    if "estrellas" not in r:
        r["estrellas"] = np.clip(np.asarray(p, dtype=np.float32) - r["salida"], 0, 1)
    return r


def parallax(p, aplicacion=0.5, deblur=True, timeout=1800):
    """parallax-nano (experimental): corrección + reducción no, deblur opcional, mezclado con --application. Devuelve
    además los píxeles saturados de la entrada y de la salida y 'descartar' con el motivo si satura más."""
    lineal = float(np.median(p)) < 0.05
    extra = ["--correction", "true", "--reduction", "false", "--deblur", "true" if deblur else "false",
             "--application", f"{float(aplicacion):g}"]
    r = correr(p, "parallax-nano", "linear" if lineal else "nonlinear", timeout, extra=extra)
    s0, s1 = saturados(p), saturados(r["salida"])
    r["saturados_antes"], r["saturados_despues"] = s0, s1
    if s1 > s0 + max(10, s0 // 20):
        r["descartar"] = (f"parallax-nano satura {s1} píxeles (la original {s0}): recorta los núcleos a 1,0. "
                          "Experimental: descartado.")
    return r


def reducir(p, aplicacion=0.5, timeout=1800):
    """parallax-nano sólo con la reducción de estrellas (27 nov 2026): sin corrección ni deblur, mezclado con
    --application. Sobre imagen ESTIRADA con estrellas."""
    lineal = float(np.median(p)) < 0.05
    extra = ["--correction", "false", "--reduction", "true", "--deblur", "false",
             "--application", f"{float(aplicacion):g}"]
    return correr(p, "parallax-nano", "linear" if lineal else "nonlinear", timeout, extra=extra)
