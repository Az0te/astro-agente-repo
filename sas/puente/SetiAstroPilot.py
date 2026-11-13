# SetiAstroPilot — lanzador para el menú Scripts de Seti Astro Suite Pro.
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# Copia ESTE fichero a la carpeta de scripts de SASpro (menú Scripts > Open Scripts Folder;
# en Windows %LOCALAPPDATA%\SASpro\scripts) y, si el repo no está en ~/astro-agente-repo, cambia REPO
# o define la variable de entorno SETIASTROPILOT_REPO. El resto del código se queda en el repo:
# este lanzador solo carga sas/puente/puente.py y arranca el puente.

import importlib.util
import os
from pathlib import Path

SCRIPT_NAME = "SetiAstroPilot (puente MCP)"
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
    _cargar_puente().arrancar(ctx)
