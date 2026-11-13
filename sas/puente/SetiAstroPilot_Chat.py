# SetiAstroPilot (chat) — segundo lanzador para el menú Scripts de Seti Astro Suite Pro.
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# Copia ESTE fichero, junto a SetiAstroPilot.py, a la carpeta de scripts de SASpro (Scripts > Open Scripts Folder; en
# Windows %LOCALAPPDATA%\SASpro\scripts). Abre la ventana del chat siempre (aunque «Abrir el chat al lanzar» esté
# desmarcado) y, si el puente no está en marcha, lo arranca antes. El código está en el repo (sas/puente, sas/herramientas).

import importlib.util
import os
from pathlib import Path

SCRIPT_NAME = "SetiAstroPilot (chat)"
SCRIPT_GROUP = "AstroPilot"

REPO = os.environ.get("SETIASTROPILOT_REPO") or str(Path.home() / "astro-agente-repo")


def _cargar_puente():
    ruta = Path(REPO) / "sas" / "puente" / "puente.py"
    if not ruta.exists():
        raise FileNotFoundError(f"No encuentro {ruta}. Ajusta REPO en este script o SETIASTROPILOT_REPO.")
    nombre = f"setiastropilot_puente_{ruta.stat().st_mtime_ns}"
    spec = importlib.util.spec_from_file_location(nombre, ruta)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run(ctx):
    P = _cargar_puente()
    vivo = getattr(ctx.app, P.ATRIBUTO_APP, None)
    if vivo is None or vivo.parar.is_set():
        P.arrancar(ctx)                 # arranca el puente (y abre el chat si la casilla está marcada)
    P.abrir_chat(ctx, forzar=True)
