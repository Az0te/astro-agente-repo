# SirilAstroPilot — puente entre el servidor MCP y Siril.
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# Se lanza una vez desde el menú de scripts de Siril y se queda escuchando en 127.0.0.1.
# Cada petición lleva un token y el nombre de una herramienta con sus parámetros: solo se
# ejecutan las de la lista blanca (herramientas.LISTA). No hay eval ni código libre.
# Todas las llamadas a Siril se hacen desde un único hilo, una detrás de otra.

import json
import os
import queue
import secrets
import socketserver
import sys
import threading
import time
import traceback
from pathlib import Path

import sirilpy as s

VERSION = "0.1.0"
AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI.parent / "herramientas"))

import herramientas as H  # noqa: E402  (después de ajustar sys.path)

DATOS = Path.home() / ".sirilastropilot"
PUERTO = int(os.environ.get("SIRILASTROPILOT_PUERTO", "48731"))


def preparar_datos() -> str:
    DATOS.mkdir(exist_ok=True)
    (DATOS / "previas").mkdir(exist_ok=True)
    rt = DATOS / "token"
    if not rt.exists():
        rt.write_text(secrets.token_hex(24), encoding="utf-8")
    return rt.read_text(encoding="utf-8").strip()


TOKEN = preparar_datos()


class Trabajo:
    def __init__(self, id_, nombre, args):
        self.id = id_
        self.nombre = nombre
        self.args = args or {}
        self.inicio = None
        self.hecho = threading.Event()
        self.respuesta = None


cola: "queue.Queue[Trabajo]" = queue.Queue()
parar = threading.Event()
actual = {"trabajo": None}
historial: list = []          # últimos trabajos (para el panel): nombre, args, estado, duración, resultado resumido
HIST_MAX = 50


def _resumen(r, n=1500):
    """Resultado acortado para el historial: el panel solo enseña lo principal."""
    try:
        t = json.dumps(r, default=a_json, ensure_ascii=False)
    except Exception:
        t = str(r)
    return t if len(t) <= n else t[:n] + "…"


def a_json(o):
    """numpy y otros tipos raros a algo serializable."""
    if hasattr(o, "item"):
        try:
            return o.item()
        except Exception:
            pass
    if hasattr(o, "tolist"):
        return o.tolist()
    return str(o)


class Manejador(socketserver.StreamRequestHandler):
    def enviar(self, d):
        try:
            self.wfile.write((json.dumps(d, default=a_json, ensure_ascii=False) + "\n").encode("utf-8"))
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            # El cliente (chat, CLI, MCP) ya cerró: el resultado queda en __historial; una línea, sin traza.
            print(f"[SirilAstroPilot] el cliente cerró antes de recibir la respuesta de {d.get('id') or 'la petición'} "
                  "(queda en el historial)", flush=True)

    def handle(self):
        try:
            p = json.loads(self.rfile.readline(1 << 20).decode("utf-8"))
        except Exception:
            return self.enviar({"estado": "error", "error": "Petición no válida (JSON)."})
        if not secrets.compare_digest(str(p.get("token", "")), TOKEN):
            return self.enviar({"estado": "error", "error": "Token incorrecto."})
        nombre = str(p.get("herramienta", ""))
        if nombre == "__estado":
            t = actual["trabajo"]
            return self.enviar({"estado": "ok", "resultado": {
                "version": VERSION,
                "ejecutando": {"herramienta": t.nombre, "id": t.id, "desde_s": round(time.time() - t.inicio, 1),
                               **({"progreso": H.PROGRESO["texto"]} if H.PROGRESO.get("texto") else {})} if t else None,
                "en_cola": cola.qsize(),
            }})
        if nombre == "__historial":
            n = max(1, min(HIST_MAX, int(p.get("args", {}).get("n", 20) or 20)))
            return self.enviar({"estado": "ok", "resultado": historial[-n:]})
        if nombre == "__detener":
            parar.set()
            return self.enviar({"estado": "ok", "resultado": "El puente se detiene."})
        if nombre not in H.LISTA:
            return self.enviar({"estado": "error", "error": f"Herramienta no permitida: {nombre}"})
        t = Trabajo(p.get("id"), nombre, p.get("args"))
        cola.put(t)
        t.hecho.wait()
        self.enviar({"id": t.id, **t.respuesta})


class Servidor(socketserver.ThreadingTCPServer):
    daemon_threads = True
    # En Windows SO_REUSEADDR deja que un segundo puente abra el mismo puerto sin error y las peticiones
    # siguen yendo al viejo: puerto en exclusiva.
    allow_reuse_address = False

    def server_bind(self):
        import socket
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def detener_anterior(siril) -> bool:
    """Si ya hay un puente escuchando (p. ej. de un lanzamiento anterior del script), le pide que se detenga."""
    import socket
    try:
        with socket.create_connection(("127.0.0.1", PUERTO), timeout=2) as c:
            c.sendall((json.dumps({"token": TOKEN, "herramienta": "__detener"}) + "\n").encode("utf-8"))
            c.recv(4096)
    except OSError:
        return False
    siril.log("[SirilAstroPilot] Había un puente anterior abierto: se le ha pedido que se detenga.")
    for _ in range(20):     # el anterior cierra el puerto en < 1 s
        time.sleep(0.25)
        try:
            socket.create_connection(("127.0.0.1", PUERTO), timeout=0.5).close()
        except OSError:
            return True
    return True


def _log_error(siril, t: Trabajo, e: Exception):
    try:
        siril.log(f"[SirilAstroPilot] {t.nombre}: {e}", s.LogColor.SALMON)
    except Exception:
        pass


def _filtrar_args(fn, args):
    """Parámetros que la función no conoce: si parecen una errata de uno que existe, error con la sugerencia; si no, se
    ignoran y se avisa en el resultado (los modelos pasan a veces 'tipo' a herramientas que no lo usan)."""
    import difflib
    import inspect
    sig = inspect.signature(fn)
    if any(p.kind == p.VAR_KEYWORD for p in sig.parameters.values()):
        return args, []
    validos = [n for n in sig.parameters if n != "siril"]
    buenos, ignorados = {}, []
    for k, v in (args or {}).items():
        if k not in validos and isinstance(k, str):      # «catálogo», «Método»: nombre sin acentos ni mayúsculas
            k2 = _normalizar_enum(k)
            if k2 in validos and k2 not in (args or {}):
                k = k2
        if k in validos:
            buenos[k] = _normalizar_enum(v) if k in ENUMS else v
            continue
        parecido = difflib.get_close_matches(k, validos, n=1, cutoff=0.8)
        if parecido:
            raise TypeError(f"parámetro desconocido '{k}': ¿quisiste decir '{parecido[0]}'?")
        ignorados.append(k)
    return buenos, [f"parámetro '{k}' ignorado (esta herramienta no lo usa)" for k in ignorados]


# Parámetros que son enumeraciones: los modelos locales escriben «Galaxia», «Nebulosa oscura», «NXT». Minúsculas, sin
# acentos y con «_» por espacios (11 nov 2026). No se tocan nombres propios (paletas, ficheros, sensores, filtros).
ENUMS = {"tipo", "metodo", "metodos", "modo", "motor", "referencia", "catalogo", "motores"}


def _normalizar_enum(v):
    if isinstance(v, str):
        import unicodedata
        s = "".join(c for c in unicodedata.normalize("NFD", v.strip().lower()) if unicodedata.category(c) != "Mn")
        return "_".join(s.split())
    if isinstance(v, (list, tuple)):
        return [_normalizar_enum(x) for x in v]
    return v


CARPETA_H = AQUI.parent / "herramientas"


def _sello_herramientas():
    """Fecha de modificación más reciente de los .py y el manifiesto de herramientas/."""
    try:
        return max(f.stat().st_mtime for f in list(CARPETA_H.glob("*.py")) + [CARPETA_H / "manifiesto.json"]
                   if f.exists())
    except ValueError:
        return 0.0


SELLO = {"h": _sello_herramientas()}


def _recargar_si_cambio(siril):
    """Recarga en caliente (11 nov 2026, Rafael: «¿cómo se puede arreglar?» tener que relanzar el puente tras cada
    cambio): si algún fichero de herramientas/ ha cambiado, entre dos trabajos se olvidan sus módulos (salvo chat, que
    sostiene la ventana) y se vuelve a importar herramientas. Si la importación falla, se queda el código anterior."""
    global H
    sello = _sello_herramientas()
    if sello <= SELLO["h"]:
        return
    carpeta = str(CARPETA_H.resolve()).lower()
    viejos = {n: m for n, m in sys.modules.items()
              if n != "chat" and str(getattr(m, "__file__", "") or "").lower().startswith(carpeta)}
    for n in viejos:
        del sys.modules[n]
    try:
        import herramientas as nuevo
        H = nuevo
        SELLO["h"] = sello
        siril.log(f"[SirilAstroPilot] Herramientas recargadas ({len(H.LISTA)}) tras un cambio en los ficheros.",
                  s.LogColor.GREEN)
    except Exception as e:
        sys.modules.update(viejos)                     # vuelve el código que funcionaba
        SELLO["h"] = sello                             # no reintentar hasta el próximo cambio
        siril.log(f"[SirilAstroPilot] No he podido recargar las herramientas ({type(e).__name__}: {e}); "
                  "sigue el código anterior.", s.LogColor.SALMON)


def ejecutar(siril, t: Trabajo):
    t.inicio = time.time()
    actual["trabajo"] = t
    try:
        _recargar_si_cambio(siril)
        if t.nombre not in H.LISTA:
            raise ValueError(f"Herramienta no permitida: {t.nombre}")
        siril.log(f"[SirilAstroPilot] {t.nombre} {json.dumps(t.args, ensure_ascii=False)[:300]}")
        args, ignorados = _filtrar_args(H.LISTA[t.nombre], t.args)
        r = H.LISTA[t.nombre](siril, **args)
        if ignorados and isinstance(r, dict):
            r["parametros_ignorados"] = ignorados
        t.respuesta = {"estado": "ok", "resultado": r}
    except TypeError as e:
        t.respuesta = {"estado": "error", "error": f"Parámetros no válidos para {t.nombre}: {e}"}
        _log_error(siril, t, e)
    except (RuntimeError, ValueError, FileNotFoundError, FileExistsError) as e:
        # Errores esperables (sin imagen, parámetro fuera de rango, comando no permitido...): sin traceback.
        t.respuesta = {"estado": "error", "error": f"{type(e).__name__}: {e}"}
        _log_error(siril, t, e)
    except Exception as e:
        t.respuesta = {"estado": "error", "error": f"{type(e).__name__}: {e}"}
        _log_error(siril, t, e)
        traceback.print_exc()
    finally:
        actual["trabajo"] = None
    t.respuesta.update(herramienta=t.nombre, duracion_ms=int((time.time() - t.inicio) * 1000))
    historial.append({"hora": time.strftime("%H:%M:%S", time.localtime(t.inicio)), "herramienta": t.nombre,
                      "args": _resumen(t.args, 300), "estado": t.respuesta.get("estado"),
                      "duracion_s": round(t.respuesta["duracion_ms"] / 1000, 1),
                      "resultado": _resumen(t.respuesta.get("resultado", t.respuesta.get("error")))})
    del historial[:-HIST_MAX]
    t.hecho.set()


def abrir_chat(siril) -> bool:
    """Abre la ventana del chat (herramientas/chat.py) en este proceso y corre el bucle de Qt hasta que se detenga el
    puente. Cerrar la ventana no detiene el puente. Devuelve False si no se abre (ajuste «sólo puente», variable
    SIRILASTROPILOT_SOLO_PUENTE=1 o PyQt6 no disponible)."""
    if os.environ.get("SIRILASTROPILOT_SOLO_PUENTE", "").strip() in ("1", "true", "si", "sí"):
        return False
    try:
        try:
            s.ensure_installed("PyQt6")
        except Exception:
            pass
        import chat
        if not chat.abrir_chat_al_lanzar():
            siril.log("[SirilAstroPilot] Sólo puente (el chat está desactivado en ~/.sirilastropilot/chat.json).")
            return False
        from PyQt6.QtCore import QTimer
        from PyQt6.QtWidgets import QApplication
    except Exception as e:
        siril.log(f"[SirilAstroPilot] Sin chat ({e}); el puente sigue para el MCP.", s.LogColor.SALMON)
        return False
    app = QApplication.instance() or QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)        # cerrar el chat no para el puente
    v = chat.Ventana()
    v.show()
    vigia = QTimer()
    vigia.timeout.connect(lambda: app.quit() if parar.is_set() else None)
    vigia.start(500)
    siril.log("[SirilAstroPilot] Chat abierto. Cerrar la ventana deja el puente funcionando; relanzar el script la vuelve a abrir.")
    app.exec()
    return True


def main():
    siril = s.SirilInterface()
    siril.connect()
    try:
        s.ensure_installed("pillow")
    except Exception as e:
        siril.log(f"[SirilAstroPilot] Aviso: no he podido instalar pillow ({e}); previa no funcionará.")

    detener_anterior(siril)
    try:
        srv = Servidor(("127.0.0.1", PUERTO), Manejador)
    except OSError as e:
        siril.error_messagebox(f"SirilAstroPilot: el puerto {PUERTO} está ocupado ({e}). ¿Ya hay un puente abierto?")
        return
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    (DATOS / "puente.json").write_text(json.dumps({
        "version": VERSION, "puerto": PUERTO, "pid": os.getpid(), "inicio": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }), encoding="utf-8")
    siril.log(f"[SirilAstroPilot] {VERSION} escuchando en 127.0.0.1:{PUERTO}. Herramientas: {len(H.LISTA)}.", s.LogColor.GREEN)

    # Todas las llamadas a Siril desde un único hilo de trabajo; el hilo principal queda para la ventana del chat (Qt).
    def trabajar():
        while not parar.is_set():
            try:
                t = cola.get(timeout=0.5)
            except queue.Empty:
                continue
            ejecutar(siril, t)

    trabajador = threading.Thread(target=trabajar, name="SirilAstroPilot-trabajo", daemon=True)
    trabajador.start()
    try:
        if not abrir_chat(siril):
            while not parar.is_set():           # sólo puente (para el MCP)
                parar.wait(0.5)
    finally:
        parar.set()
        trabajador.join(timeout=30)
        srv.shutdown()
        srv.server_close()
        # Solo borrar puente.json si es el nuestro: si otro puente nos ha sustituido, ya ha escrito el suyo.
        try:
            pj = DATOS / "puente.json"
            if json.loads(pj.read_text(encoding="utf-8")).get("pid") == os.getpid():
                pj.unlink()
        except (OSError, ValueError):
            pass
        siril.log("[SirilAstroPilot] Puente detenido.")


if __name__ == "__main__":
    main()
