# SetiAstroPilot — puente entre el servidor MCP y Seti Astro Suite Pro (SASpro).
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# Mismo diseño que el puente de Siril (siril/puente/SirilAstroPilot.py), adaptado a SASpro:
# - SASpro ejecuta los scripts DENTRO de su proceso, en el hilo de la interfaz (Qt). El script lanzador
#   (SetiAstroPilot.py, en la carpeta de scripts de SASpro) llama a arrancar(ctx) y vuelve enseguida.
# - Un servidor TCP en 127.0.0.1 recibe las peticiones en hilos aparte y las deja en una cola.
# - Un QTimer en el hilo de la interfaz saca los trabajos de la cola y los ejecuta uno detrás de otro: todo lo que
#   toca documentos, vistas o ctx.run_command se hace en el hilo de Qt, como cuando el usuario pulsa un botón.
# - Cada petición lleva un token y el nombre de una herramienta: solo se ejecutan las de herramientas.LISTA.
#   No hay eval ni código libre.

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

VERSION = "0.1.0"
AQUI = Path(__file__).resolve().parent
CARPETA_H = AQUI.parent / "herramientas"
if str(CARPETA_H) not in sys.path:
    sys.path.insert(0, str(CARPETA_H))

import herramientas as H  # noqa: E402  (después de ajustar sys.path)

DATOS = Path.home() / ".setiastropilot"
PUERTO = int(os.environ.get("SETIASTROPILOT_PUERTO", "48733"))
HIST_MAX = 50
ATRIBUTO_APP = "_setiastropilot_puente"     # el puente vivo se guarda en la ventana principal de SASpro


def preparar_datos() -> str:
    DATOS.mkdir(exist_ok=True)
    (DATOS / "previas").mkdir(exist_ok=True)
    (DATOS / "trabajo").mkdir(exist_ok=True)
    rt = DATOS / "token"
    if not rt.exists():
        rt.write_text(secrets.token_hex(24), encoding="utf-8")
    return rt.read_text(encoding="utf-8").strip()


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


def _resumen(r, n=1500):
    try:
        t = json.dumps(r, default=a_json, ensure_ascii=False)
    except Exception:
        t = str(r)
    return t if len(t) <= n else t[:n] + "…"


class Trabajo:
    def __init__(self, id_, nombre, args):
        self.id = id_
        self.nombre = nombre
        self.args = args or {}
        self.inicio = None
        self.hecho = threading.Event()
        self.respuesta = None


# Parámetros que son enumeraciones: minúsculas, sin acentos y con «_» por espacios (igual que en Siril).
ENUMS = {"tipo", "metodo", "metodos", "modo", "motor", "referencia", "catalogo", "motores"}


def _normalizar_enum(v):
    if isinstance(v, str):
        import unicodedata
        s = "".join(c for c in unicodedata.normalize("NFD", v.strip().lower()) if unicodedata.category(c) != "Mn")
        return "_".join(s.split())
    if isinstance(v, (list, tuple)):
        return [_normalizar_enum(x) for x in v]
    return v


def _filtrar_args(fn, args):
    """Parámetros desconocidos: error con sugerencia si parecen una errata; si no, se ignoran con aviso."""
    import difflib
    import inspect
    sig = inspect.signature(fn)
    if any(p.kind == p.VAR_KEYWORD for p in sig.parameters.values()):
        return args, []
    validos = [n for n in sig.parameters if n != "ctx"]
    buenos, ignorados = {}, []
    for k, v in (args or {}).items():
        if k not in validos and isinstance(k, str):
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


def _sello_herramientas():
    try:
        return max(f.stat().st_mtime for f in list(CARPETA_H.glob("*.py")) + [CARPETA_H / "manifiesto.json"]
                   if f.exists())
    except ValueError:
        return 0.0


class Puente:
    """Servidor + cola + temporizador de Qt. Uno por proceso de SASpro."""

    def __init__(self, ctx):
        self.ctx = ctx
        self.token = preparar_datos()
        self.cola: "queue.Queue[Trabajo]" = queue.Queue()
        self.parar = threading.Event()
        self.actual = None
        self.ocupado = False          # evita reentrar si una herramienta abre un QEventLoop propio
        self.historial: list = []
        self.sello = _sello_herramientas()
        self.H = H
        self.srv = None
        self.timer = None

    # --- registro en la consola de SASpro ---
    def log(self, msg):
        try:
            self.ctx.log(f"[SetiAstroPilot] {msg}")
        except Exception:
            print("[SetiAstroPilot]", msg, flush=True)

    # --- servidor TCP (hilos aparte: nunca tocan Qt) ---
    def _manejador(self):
        puente = self

        class Manejador(socketserver.StreamRequestHandler):
            def enviar(self, d):
                try:
                    self.wfile.write((json.dumps(d, default=a_json, ensure_ascii=False) + "\n").encode("utf-8"))
                except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
                    print("[SetiAstroPilot] el cliente cerró antes de recibir la respuesta (queda en el historial)",
                          flush=True)

            def handle(self):
                try:
                    p = json.loads(self.rfile.readline(1 << 20).decode("utf-8"))
                except Exception:
                    return self.enviar({"estado": "error", "error": "Petición no válida (JSON)."})
                if not secrets.compare_digest(str(p.get("token", "")), puente.token):
                    return self.enviar({"estado": "error", "error": "Token incorrecto."})
                nombre = str(p.get("herramienta", ""))
                if nombre == "__estado":
                    t = puente.actual
                    return self.enviar({"estado": "ok", "resultado": {
                        "version": VERSION,
                        "ejecutando": {"herramienta": t.nombre, "id": t.id,
                                       "desde_s": round(time.time() - t.inicio, 1)} if t else None,
                        "en_cola": puente.cola.qsize(),
                    }})
                if nombre == "__historial":
                    n = max(1, min(HIST_MAX, int((p.get("args") or {}).get("n", 20) or 20)))
                    return self.enviar({"estado": "ok", "resultado": puente.historial[-n:]})
                if nombre == "__detener":
                    puente.parar.set()
                    return self.enviar({"estado": "ok", "resultado": "El puente se detiene."})
                # Una herramienta recién añadida aún no está en la LISTA cargada: si los ficheros han cambiado, se deja
                # pasar y _ejecutar recarga y vuelve a comprobar la lista en el hilo de Qt.
                if nombre not in puente.H.LISTA and _sello_herramientas() <= puente.sello:
                    return self.enviar({"estado": "error", "error": f"Herramienta no permitida: {nombre}"})
                t = Trabajo(p.get("id"), nombre, p.get("args"))
                puente.cola.put(t)
                t.hecho.wait()
                self.enviar({"id": t.id, **t.respuesta})

        return Manejador

    def _servidor(self):
        import socket

        class Servidor(socketserver.ThreadingTCPServer):
            daemon_threads = True
            # En Windows SO_REUSEADDR deja abrir dos puentes en el mismo puerto: allí, puerto en exclusiva. En macOS y
            # Linux sí hace falta, o el puerto queda ocupado (TIME_WAIT) un rato tras relanzar el puente.
            allow_reuse_address = not hasattr(socket, "SO_EXCLUSIVEADDRUSE")

            def server_bind(self):
                if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                    self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                super().server_bind()

        return Servidor(("127.0.0.1", PUERTO), self._manejador())

    # --- recarga en caliente de herramientas/ (como en Siril) ---
    def _recargar_si_cambio(self):
        global H
        sello = _sello_herramientas()
        if sello <= self.sello:
            return
        carpeta = str(CARPETA_H.resolve()).lower()
        viejos = {n: m for n, m in sys.modules.items()
                  if str(getattr(m, "__file__", "") or "").lower().startswith(carpeta)}
        for n in viejos:
            del sys.modules[n]
        try:
            import herramientas as nuevo
            H = self.H = nuevo
            self.sello = sello
            self.log(f"Herramientas recargadas ({len(nuevo.LISTA)}) tras un cambio en los ficheros.")
        except Exception as e:
            sys.modules.update(viejos)
            self.sello = sello
            self.log(f"No he podido recargar las herramientas ({type(e).__name__}: {e}); sigue el código anterior.")

    # --- ejecución en el hilo de Qt ---
    def _tic(self):
        if self.parar.is_set():
            self.detener()
            return
        if self.ocupado:
            return
        try:
            t = self.cola.get_nowait()
        except queue.Empty:
            return
        self.ocupado = True
        try:
            self._ejecutar(t)
        finally:
            self.ocupado = False

    def _ejecutar(self, t: Trabajo):
        t.inicio = time.time()
        self.actual = t
        try:
            self._recargar_si_cambio()
            fn = self.H.LISTA.get(t.nombre)
            if fn is None:
                raise ValueError(f"Herramienta no permitida: {t.nombre}")
            self.log(f"{t.nombre} {json.dumps(t.args, ensure_ascii=False, default=a_json)[:300]}")
            args, ignorados = _filtrar_args(fn, t.args)
            r = fn(self.ctx, **args)
            if ignorados and isinstance(r, dict):
                r["parametros_ignorados"] = ignorados
            t.respuesta = {"estado": "ok", "resultado": r}
        except TypeError as e:
            t.respuesta = {"estado": "error", "error": f"Parámetros no válidos para {t.nombre}: {e}"}
            self.log(f"{t.nombre}: {e}")
        except (RuntimeError, ValueError, FileNotFoundError, FileExistsError, KeyError) as e:
            t.respuesta = {"estado": "error", "error": f"{type(e).__name__}: {e}"}
            self.log(f"{t.nombre}: {e}")
        except Exception as e:
            t.respuesta = {"estado": "error", "error": f"{type(e).__name__}: {e}"}
            self.log(f"{t.nombre}: {e}\n{traceback.format_exc()}")
        finally:
            self.actual = None
        t.respuesta.update(herramienta=t.nombre, duracion_ms=int((time.time() - t.inicio) * 1000))
        self.historial.append({"hora": time.strftime("%H:%M:%S", time.localtime(t.inicio)), "herramienta": t.nombre,
                               "args": _resumen(t.args, 300), "estado": t.respuesta.get("estado"),
                               "duracion_s": round(t.respuesta["duracion_ms"] / 1000, 1),
                               "resultado": _resumen(t.respuesta.get("resultado", t.respuesta.get("error")))})
        del self.historial[:-HIST_MAX]
        t.hecho.set()

    # --- arranque y parada ---
    def arrancar(self, temporizador=True):
        self.srv = self._servidor()
        threading.Thread(target=self.srv.serve_forever, daemon=True, name="SetiAstroPilot-servidor").start()
        (DATOS / "puente.json").write_text(json.dumps({
            "version": VERSION, "puerto": PUERTO, "pid": os.getpid(), "inicio": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }), encoding="utf-8")
        if temporizador:
            from PyQt6.QtCore import QTimer
            self.timer = QTimer(self.ctx.app)
            self.timer.setInterval(50)
            self.timer.timeout.connect(self._tic)
            self.timer.start()
        self.log(f"{VERSION} escuchando en 127.0.0.1:{PUERTO}. Herramientas: {len(self.H.LISTA)}.")

    def detener(self):
        self.parar.set()
        if self.timer is not None:
            try:
                self.timer.stop()
            except Exception:
                pass
            self.timer = None
        # Libera a los que esperan en la cola.
        while True:
            try:
                t = self.cola.get_nowait()
            except queue.Empty:
                break
            t.respuesta = {"estado": "error", "error": "El puente se ha detenido."}
            t.hecho.set()
        if self.srv is not None:
            threading.Thread(target=self._cerrar_servidor, args=(self.srv,), daemon=True).start()
            self.srv = None
        try:
            pj = DATOS / "puente.json"
            if json.loads(pj.read_text(encoding="utf-8")).get("pid") == os.getpid():
                pj.unlink()
        except (OSError, ValueError):
            pass
        self.log("Puente detenido.")

    @staticmethod
    def _cerrar_servidor(srv):
        srv.shutdown()          # no se puede llamar desde el hilo de serve_forever ni bloquear el de Qt
        srv.server_close()


def arrancar(ctx):
    """Lo llama el lanzador desde el menú Scripts de SASpro. Vuelve enseguida: el puente sigue vivo con SASpro."""
    app = ctx.app
    viejo = getattr(app, ATRIBUTO_APP, None)
    if viejo is not None:
        try:
            viejo.detener()
            time.sleep(0.3)
        except Exception:
            pass
        ctx.log("[SetiAstroPilot] Había un puente anterior: se ha detenido y se arranca el nuevo.")
    p = Puente(ctx)
    try:
        p.arrancar()
    except OSError as e:
        ctx.log(f"[SetiAstroPilot] El puerto {PUERTO} está ocupado ({e}). ¿Hay otro SASpro con el puente abierto?")
        raise RuntimeError(f"SetiAstroPilot: el puerto {PUERTO} está ocupado ({e}).")
    setattr(app, ATRIBUTO_APP, p)
    return p
