# Registro de sesiones de modelos locales (Ollama) para un futuro ajuste fino.
#
# 19 nov 2026 (Rafael): guardar las sesiones del modelo local completas, en el formato de chat con herramientas de
# OpenAI (messages + tools), para poder entrenar un LoRA más adelante (también con Qwen 4). Sólo modelos locales y
# sólo en este PC: nada se sube a ningún sitio. Las APIs en la nube y Claude no se registran.
#
# Carpeta: ASTROPILOT_SESIONES o ~/.astropilot/sesiones, una subcarpeta por programa y otra por sesión:
#   <programa>/<AAAAMMDD_HHMMSS>_<modelo>/sesion.json   conversación completa + datos de la sesión
#   <programa>/<AAAAMMDD_HHMMSS>_<modelo>/previas/      JPG que devolvieron las herramientas
#   <programa>/_herramientas/<sha>.json                 esquema de herramientas (uno por versión, no por sesión)
# El contenido de cada resultado es el que vio el modelo. La nota (1–5) se pone después a mano en meta.nota.
# Límite de disco: 50 GB en total. Pasado el 90 % avisa; pasado el límite deja de copiar previas (el texto sigue).
# ASTROPILOT_REGISTRO=0 lo apaga.

import hashlib
import json
import os
import re
import shutil
import time
from pathlib import Path

FORMATO = "astropilot-sesion/1"
LIMITE_BYTES = int(float(os.environ.get("ASTROPILOT_SESIONES_GB", "50")) * 1024 ** 3)


def carpeta_base():
    return Path(os.environ.get("ASTROPILOT_SESIONES", Path.home() / ".astropilot" / "sesiones"))


def activo():
    return os.environ.get("ASTROPILOT_REGISTRO", "1") != "0"


def _tamano(carpeta):
    total = 0
    for raiz, _, ficheros in os.walk(carpeta):
        for f in ficheros:
            try:
                total += os.path.getsize(os.path.join(raiz, f))
            except OSError:
                pass
    return total


def commit_de(repo):
    """Commit del repositorio (leído de .git, sin llamar a git). '' si no se puede saber."""
    try:
        git = Path(repo) / ".git"
        cabeza = (git / "HEAD").read_text(encoding="utf-8").strip()
        if not cabeza.startswith("ref:"):
            return cabeza[:12]
        ref = cabeza[4:].strip()
        f = git / ref
        if f.exists():
            return f.read_text(encoding="utf-8").strip()[:12]
        for linea in (git / "packed-refs").read_text(encoding="utf-8").splitlines():
            if linea.endswith(" " + ref):
                return linea.split()[0][:12]
    except OSError:
        pass
    return ""


def _limpio(s):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s)[:40]


class RegistroSesion:
    def __init__(self, programa, modelo, repo, idioma="es", emitir=None):
        self.base = carpeta_base()
        self.dir_prog = self.base / programa
        self.dir = self.dir_prog / f"{time.strftime('%Y%m%d_%H%M%S')}_{_limpio(modelo)}"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.n_llamada = 0
        self.ultimas_llamadas = []
        self.tools_sha = {}
        self.copiar_previas = True
        self.datos = {
            "formato": FORMATO,
            "meta": {"programa": programa, "modelo": modelo, "commit": commit_de(repo), "idioma": idioma,
                     "inicio": time.strftime("%Y-%m-%dT%H:%M:%S"), "fin": None, "turnos": 0, "llamadas": 0,
                     "errores": 0, "empujones": 0, "seguir": 0, "segundos": 0.0, "tokens_entrada": 0,
                     "tokens_salida": 0, "hasta_final": False, "exportado": False,
                     "nota": None, "usar": None, "comentario": ""},
            "tools_ref": None,
            "messages": [],
        }
        usado = _tamano(self.base)
        if usado > LIMITE_BYTES:
            self.copiar_previas = False
            if emitir:
                emitir({"tipo": "aviso", "texto": f"Registro de sesiones: {usado / 1024 ** 3:.1f} GB, por encima del "
                                                   f"límite; esta sesión se guarda sin previas ({self.base})."})
        elif usado > 0.9 * LIMITE_BYTES and emitir:
            emitir({"tipo": "aviso", "texto": f"Registro de sesiones: {usado / 1024 ** 3:.1f} GB de "
                                               f"{LIMITE_BYTES / 1024 ** 3:.0f} GB ({self.base})."})

    # --- lo que entra -------------------------------------------------------------------------------------------

    def sistema(self, texto):
        """El prompt de sistema; si cambia a mitad (casillas), se añade el nuevo donde cambió."""
        previos = [m for m in self.datos["messages"] if m["role"] == "system"]
        if not previos or previos[-1]["content"] != texto:
            self.datos["messages"].append({"role": "system", "content": texto})

    def herramientas(self, tools):
        txt = json.dumps(tools, ensure_ascii=False, sort_keys=True)
        sha = self.tools_sha.get(txt)
        if not sha:
            sha = hashlib.sha256(txt.encode("utf-8")).hexdigest()[:16]
            self.tools_sha[txt] = sha
            d = self.dir_prog / "_herramientas"
            d.mkdir(exist_ok=True)
            f = d / f"{sha}.json"
            if not f.exists():
                f.write_text(json.dumps(tools, ensure_ascii=False, indent=1), encoding="utf-8")
        ref = f"_herramientas/{sha}.json"
        if self.datos["tools_ref"] is None:
            self.datos["tools_ref"] = ref
        elif self.datos["tools_ref"] != ref:     # cambió a mitad (internet): queda anotado en el mensaje siguiente
            self.datos["tools_ref"] = ref
            self.datos["messages"].append({"role": "system", "_tools_ref": ref, "content": ""})

    def usuario(self, texto, tipo=None):
        """tipo: None (lo escribió el usuario), 'empujon' o 'seguir' (los añade el chat)."""
        m = {"role": "user", "content": texto}
        if tipo:
            m["_tipo"] = tipo
            self.datos["meta"]["empujones" if tipo == "empujon" else "seguir"] += 1
        else:
            self.datos["meta"]["turnos"] += 1
        self.datos["messages"].append(m)

    def asistente(self, m):
        """Mensaje de Ollama ({content, thinking, tool_calls}) pasado al formato de OpenAI."""
        out = {"role": "assistant", "content": m.get("content") or ""}
        if (m.get("thinking") or "").strip():
            out["reasoning_content"] = m["thinking"]
        llamadas = []
        for ll in m.get("tool_calls") or []:
            fn = ll.get("function", {})
            args = fn.get("arguments")
            if not isinstance(args, str):
                args = json.dumps(args if args is not None else {}, ensure_ascii=False)
            self.n_llamada += 1
            llamadas.append({"id": ll.get("id") or f"call_{self.n_llamada}", "type": "function",
                             "function": {"name": fn.get("name", ""), "arguments": args}})
        if llamadas:
            out["tool_calls"] = llamadas
        self.ultimas_llamadas = llamadas
        self.datos["messages"].append(out)

    def resultado(self, i, nombre, contenido, estado, texto_completo="", segundos=None):
        """Respuesta de la herramienta i-ésima del último mensaje del asistente; copia sus previas JPG."""
        idc = self.ultimas_llamadas[i]["id"] if i < len(self.ultimas_llamadas) else f"call_x{i}"
        m = {"role": "tool", "tool_call_id": idc, "name": nombre, "content": contenido, "_estado": estado}
        if segundos is not None:
            m["_segundos"] = segundos
        previas = self._copiar(texto_completo) if self.copiar_previas else []
        if previas:
            m["_previas"] = previas
        self.datos["meta"]["llamadas"] += 1
        if estado != "ok":
            self.datos["meta"]["errores"] += 1
        if nombre == "exportarFinal" and estado == "ok":
            self.datos["meta"]["exportado"] = True
        self.datos["messages"].append(m)

    def _copiar(self, txt):
        rutas = []
        for p in re.findall(r'"([^"]+?\.jpe?g)"', txt.replace("\\\\", "\\")):
            if p not in rutas:
                rutas.append(p)
        hechas = []
        if not rutas:
            return hechas
        d = self.dir / "previas"
        d.mkdir(exist_ok=True)
        for p in rutas:
            try:
                origen = Path(p)
                if not origen.is_file():
                    continue
                destino = d / f"{self.n_llamada:04d}_{_limpio(origen.stem)}{origen.suffix.lower()}"
                shutil.copyfile(origen, destino)
                hechas.append(f"previas/{destino.name}")
            except OSError:
                pass
        return hechas

    # --- guardar ------------------------------------------------------------------------------------------------

    def sumar(self, **cuentas):
        """Suma al final de cada turno (tokens, segundos)."""
        for k, v in cuentas.items():
            self.datos["meta"][k] = round(self.datos["meta"].get(k, 0) + (v or 0), 1)

    def guardar(self, **meta):
        self.datos["meta"].update({k: v for k, v in meta.items() if v is not None})
        self.datos["meta"]["fin"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        tmp = self.dir / "sesion.json.tmp"
        try:
            tmp.write_text(json.dumps(self.datos, ensure_ascii=False, indent=1), encoding="utf-8")
            os.replace(tmp, self.dir / "sesion.json")
        except OSError:
            pass


# --- Métricas objetivas de la sesión (para el informe; Rafael, 19 nov 2026) ----------------------------------------
# Se alimentan de los eventos del chat, así que cuentan con todos los motores (Ollama, APIs, Claude, Codex). No llevan
# rutas ni nada personal: van en el informe para comparar envíos de otros usuarios (formato astropilot-metricas/1).

class Metricas:
    def __init__(self):
        self.inicio = time.time()
        self.d = {"turnos": 0, "llamadas": 0, "llamadas_ok": 0, "errores": 0, "repetidas_tras_error": 0,
                  "empujones": 0, "seguir": 0, "vacias": 0, "mal_formadas": 0, "detenidas": 0,
                  "segundos_modelo_y_herramientas": 0.0, "segundos_herramientas": 0.0,
                  "tokens_entrada": 0, "tokens_salida": 0, "exportado": False}
        self.por_funcion = {}
        self._ultima = None              # (nombre, args) de la última llamada
        self._ultima_error = None        # (nombre, args) de la última que falló

    def evento(self, ev):
        t, d = ev.get("tipo"), self.d
        if t == "herramienta":
            clave = (ev.get("nombre", ""), json.dumps(ev.get("args") or {}, sort_keys=True, ensure_ascii=False))
            d["llamadas"] += 1
            if self._ultima_error == clave:
                d["repetidas_tras_error"] += 1
            self._ultima = clave
            self.por_funcion.setdefault(clave[0], {"pedidas": 0, "ok": 0, "error": 0})["pedidas"] += 1
        elif t == "resultado":
            f = self.por_funcion.setdefault(ev.get("nombre", ""), {"pedidas": 0, "ok": 0, "error": 0})
            d["segundos_herramientas"] += float(ev.get("segundos") or 0)
            if ev.get("estado") == "ok":
                d["llamadas_ok"] += 1
                f["ok"] += 1
                self._ultima_error = None
                if ev.get("nombre") == "exportarFinal":
                    d["exportado"] = True
            else:
                d["errores"] += 1
                f["error"] += 1
                self._ultima_error = self._ultima
        elif t == "aviso":
            txt = (ev.get("texto") or "").lower()
            if "empujón" in txt:
                d["empujones"] += 1
            elif "sigue " in txt and "sin exportar" in txt:
                d["seguir"] += 1
            elif "no respondió" in txt:
                d["vacias"] += 1
            elif "mal formada" in txt:
                d["mal_formadas"] += 1
            elif ev.get("clave") == "detenido":
                d["detenidas"] += 1
        elif t == "fin":
            d["turnos"] += 1
            d["segundos_modelo_y_herramientas"] += float(ev.get("segundos") or 0)
            d["tokens_entrada"] += int(ev.get("tokens_entrada") or 0)
            d["tokens_salida"] += int(ev.get("tokens_salida") or 0)

    def datos(self, programa, modelo, repo):
        d = dict(self.d)
        pct = lambda a, b: round(100.0 * a / b, 1) if b else None
        d.update({"formato": "astropilot-metricas/1", "programa": programa, "modelo": modelo,
                  "commit_guia": commit_de(repo), "fecha": time.strftime("%Y-%m-%d %H:%M"),
                  "minutos": round((time.time() - self.inicio) / 60, 1),
                  "llamadas_ok_pct": pct(d["llamadas_ok"], d["llamadas"]),
                  "segundos_modelo_y_herramientas": round(d["segundos_modelo_y_herramientas"]),
                  "segundos_herramientas": round(d["segundos_herramientas"]),
                  "por_funcion": self.por_funcion})
        return d

    def html(self, programa, modelo, repo):
        """Tabla para el informe + el bloque JSON que se lee de forma automática."""
        import html as _h
        d = self.datos(programa, modelo, repo)
        v = lambda x: "—" if x is None else _h.escape(str(x))
        filas = [("Modelo", modelo), ("Guía (commit)", d["commit_guia"] or "—"), ("Duración", f"{d['minutos']} min"),
                 ("Turnos", d["turnos"]),
                 ("Llamadas correctas", f"{v(d['llamadas_ok_pct'])} % de {d['llamadas']}"),
                 ("Errores · repetidas tras error", f"{d['errores']} · {d['repetidas_tras_error']}"),
                 ("Empujones · «sigue» · vacías · mal formadas", f"{d['empujones']} · {d['seguir']} · {d['vacias']} · {d['mal_formadas']}"),
                 ("Tiempo en herramientas", f"{d['segundos_herramientas']} s de {d['segundos_modelo_y_herramientas']} s"),
                 ("Tokens (entrada → salida)", f"{d['tokens_entrada']} → {d['tokens_salida']}"),
                 ("Exportado", "sí" if d["exportado"] else "no")]
        tabla = "".join(f"<tr><th align='left'>{_h.escape(a)}</th><td>{b if isinstance(b, str) and '%' in b else _h.escape(str(b))}</td></tr>"
                        for a, b in filas)
        return (f"<h3>Métricas de la sesión (datos objetivos)</h3><table border='1' cellpadding='3' "
                f"style='border-collapse:collapse'>{tabla}</table>"
                f"<details><summary>Datos para comparar (JSON)</summary><pre id='astropilot-metricas'>"
                f"{_h.escape(json.dumps(d, ensure_ascii=False, indent=1))}</pre></details>")


def exportar_anonima(sesion_json, destino):
    """Copia de la sesión registrada para enviarla: sin prompt de sistema (puede llevar el perfil del usuario), sin
    previas y con las carpetas de usuario cambiadas por <USUARIO>. El usuario decide si la manda."""
    try:
        datos = json.loads(Path(sesion_json).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    datos["messages"] = [{k: v for k, v in m.items() if k != "_previas"}
                         for m in datos.get("messages", []) if m.get("role") != "system"]
    txt = json.dumps(datos, ensure_ascii=False, indent=1)
    txt = re.sub(r"([A-Za-z]:(?:\\\\|\\|/)+(?:Users|Usuarios|Documents and Settings)(?:\\\\|\\|/)+)[^\\/\"]+",
                 lambda m: m.group(1) + "<USUARIO>", txt, flags=re.I)
    txt = re.sub(r"(/(?:Users|home)/)[^/\"]+", lambda m: m.group(1) + "<USUARIO>", txt)
    home = str(Path.home())
    for forma in {home, home.replace("\\", "\\\\"), home.replace("\\", "/")}:
        if len(forma) > 3:
            txt = txt.replace(forma, "<HOME>")
    try:
        Path(destino).write_text(txt, encoding="utf-8")
        return str(destino)
    except OSError:
        return None
