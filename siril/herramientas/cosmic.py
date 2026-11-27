# Cosmic Clarity (motores de IA de SetiAstro: nitidez y ruido) para SirilAstroPilot.
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# 27 nov 2026 (Rafael): alternativa gratis a BlurX y NoiseX como un candidato más. No se copia nada de Cosmic Clarity: se
# usa el script «CosmicClarity_Native.py» que el usuario tiene instalado con los scripts de Siril (GPL-3, de Adrian
# Knagg-Baugh, que carga los modelos de SetiAstro con PyTorch) en un proceso aparte, con la misma Python de Siril. Ese
# script se importa como módulo (no se ejecuta su ventana) y se llaman sus funciones process_sharpen / process_denoise.
#
# Requisitos (si falta algo, hay() dice qué y la herramienta lo pone en «omitidos», sin error):
# - el script en %LOCALAPPDATA%\siril-scripts\processing\CosmicClarity_Native.py (o "cosmicclarity_script" en
#   ~/.sirilastropilot/config.json);
# - los modelos en %LOCALAPPDATA%\siril\cosmic_clarity (o "cosmicclarity_modelos" en config.json): se descargan abriendo
#   una vez Cosmic Clarity Native desde el menú Scripts de Siril (Download models);
# - PyTorch en la Python de Siril: lo instala ese mismo script la primera vez (aquí NO se instala nada: tardaría minutos
#   y descargaría más de un GB en mitad de una comparación).
#
# Arrays: (canales, alto, ancho) 0–1, como en syqon.py. Quien llama mide, compara y aplica con deshacer.

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

MODELOS = {
    "nitidez": ("deep_sharp_stellar_AI4", "deep_nonstellar_sharp_conditional_psf_AI4"),
    "ruido": ("deep_denoise_mono_AI4", "deep_denoise_color_AI4"),
    "estrellas": ("darkstar_color_AI4",),          # 27 nov 2026: Darkstar (quitar estrellas), color; mono si la capa lo es
}


class ErrorCosmic(RuntimeError):
    pass


def _config():
    try:
        return json.loads((Path.home() / ".sirilastropilot" / "config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def script():
    c = _config().get("cosmicclarity_script")
    cands = [c] if c else []
    base = os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))
    cands += [os.path.join(base, "siril-scripts", "processing", "CosmicClarity_Native.py"),
              str(Path.home() / ".local" / "share" / "siril-scripts" / "processing" / "CosmicClarity_Native.py"),
              str(Path.home() / "Library" / "Application Support" / "siril-scripts" / "processing" / "CosmicClarity_Native.py")]
    return next((x for x in cands if x and os.path.isfile(x)), None)


def modelos_dir():
    c = _config().get("cosmicclarity_modelos")
    if c:
        return Path(c)
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "siril" / "cosmic_clarity"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "siril" / "cosmic_clarity"
    return Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))) / "siril" / "cosmic_clarity"


def falta(modo):
    """None si se puede usar 'modo' (nitidez o ruido); si no, qué falta, en una frase."""
    if not script():
        return "no está el script CosmicClarity_Native.py de los scripts de Siril (actualiza los scripts en Siril)"
    d = modelos_dir()
    faltan = [m for m in MODELOS[modo] if not any((d / (m + e)).exists() for e in (".pth", ".pt", ".onnx"))]
    if faltan:
        return (f"faltan los modelos {', '.join(faltan)} en {d}: abre una vez Cosmic Clarity Native en el menú Scripts de "
                "Siril y descárgalos")
    if importlib.util.find_spec("torch") is None:
        return "falta PyTorch en la Python de Siril: abre una vez Cosmic Clarity Native en el menú Scripts de Siril"
    return None


def hay(modo):
    return falta(modo) is None


_RUNNER = r'''
import importlib.util, json, sys
import numpy as np
ent, sal, cfg = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
spec = importlib.util.spec_from_file_location("cosmicclarity_native_sap", cfg["script"])
cc = importlib.util.module_from_spec(spec)
sys.argv = [cfg["script"]]
spec.loader.exec_module(cc)
cc.set_models_dir_override(cfg["modelos"])
img = np.load(ent)
if cfg["modo"] == "nitidez":
    out = cc.process_sharpen(img, cfg["params"])
elif cfg["modo"] == "estrellas":
    out, _ = cc.process_darkstar(img, cfg["params"])
else:
    out = cc.process_denoise(img, cfg["params"])
np.save(sal, np.asarray(out, dtype=np.float32))
'''


def _correr(p, modo, params, timeout=1800):
    motivo = falta(modo)
    if motivo:
        raise ErrorCosmic(f"Cosmic Clarity: {motivo}.")
    p = np.clip(np.asarray(p, dtype=np.float32), 0, 1)
    mono = p.shape[0] == 1
    img = np.repeat(p, 3, axis=0) if mono else p
    img = np.ascontiguousarray(np.moveaxis(img, 0, -1))           # (alto, ancho, 3), como lo espera el script
    t0 = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="sap_cosmic_") as d:
        ent, sal, run = Path(d) / "entrada.npy", Path(d) / "salida.npy", Path(d) / "runner.py"
        np.save(ent, img)
        run.write_text(_RUNNER, encoding="utf-8")
        cfg = {"script": script(), "modelos": str(modelos_dir()), "modo": modo, "params": params}
        pr = subprocess.run([sys.executable, str(run), str(ent), str(sal), json.dumps(cfg)], capture_output=True,
                            text=True, timeout=timeout, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if pr.returncode != 0 or not sal.exists():
            raise ErrorCosmic(f"Cosmic Clarity ({modo}) falló (código {pr.returncode}): {(pr.stderr or pr.stdout)[-400:]}")
        q = np.load(sal)
    q = np.moveaxis(q, -1, 0).astype(np.float32)
    if mono:
        q = q.mean(axis=0, keepdims=True)
    return {"salida": np.clip(q, 0, 1), "segundos": round(time.perf_counter() - t0, 1),
            "comando": f"Cosmic Clarity {modo} {json.dumps(params, ensure_ascii=False)}"}


def nitidez(p, estrellas=0.5, nebulosa=0.5, modo="Both", timeout=1800):
    """Sharpen de Cosmic Clarity (estelar y no estelar, PSF automática). Con lineal el script estira y desestira solo."""
    return _correr(p, "nitidez", {"sharpening_mode": modo, "stellar_amount": float(estrellas),
                                  "nonstellar_amount": float(nebulosa), "auto_psf": True, "use_gpu": True}, timeout)


def ruido(p, fuerza=0.5, timeout=1800):
    """Denoise de Cosmic Clarity (modelo completo)."""
    return _correr(p, "ruido", {"denoise_mode": "full", "denoise_strength": float(fuerza), "use_gpu": True}, timeout)


def sin_estrellas(p, timeout=1800):
    """Darkstar de Cosmic Clarity: devuelve la STARLESS ('salida'). Con imagen lineal el script estira y desestira solo.
    Las estrellas (original − starless) las calcula quien llama, como con StarNet y StarX."""
    return _correr(p, "estrellas", {"darkstar_mode": "additive", "output_stars_only": False, "use_gpu": True}, timeout)
