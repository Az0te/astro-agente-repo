# Lanza el puente de SetiAstroPilot con un SASpro falso (sin la aplicación), para probar el MCP y las herramientas.
# Uso (desde la raíz del repo):  python sas/pruebas/puente_falso.py
# SAS_FALSO_TAM=1600x1100 cambia el tamaño de la imagen sintética. El bucle del final hace de temporizador de Qt.
import os
import sys
import time
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI / "falso"))
sys.path.insert(0, str(AQUI.parent / "puente"))

import sas_falso as F  # noqa: E402
import puente  # noqa: E402

w, h = (int(x) for x in os.environ.get("SAS_FALSO_TAM", "1600x1100").split("x"))
app = F.App()
ctx = F.Ctx(app)
app.doc_manager.open_array(F.imagen_sintetica(w, h), {"file_path": str(Path.home() / "falso" / "M_falsa.fits"),
                                                      "original_header": {"OBJECT": "Falsa", "FOCALLEN": 400.0,
                                                                          "XPIXSZ": 3.76, "EXPTIME": 300.0}},
                           "M_falsa")
p = puente.Puente(ctx)
p.arrancar(temporizador=False)
try:
    while not p.parar.is_set():
        p._tic()
        time.sleep(0.02)
finally:
    p.detener()
    time.sleep(0.5)
