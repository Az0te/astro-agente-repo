"""Panel de IA local para los chats de Siril y SASpro (23 nov 2026; el mismo que el del Lite de PixInsight).

Sólo con Ollama o RDNA-FAST (llama-server). Muestra el modelo cargado (cuantización, parámetros, tamaño, contexto), el %
del modelo en la GPU (size_vram / size de /api/ps), la memoria dedicada de la gráfica y su carga (contadores de Windows
con Get-Counter; con Ollama y llama-server en la RX 7900 la carga sale en el motor «compute 0»), el contexto usado
(tokens de la última respuesta) frente al contexto del modelo y al tope del historial, el estado y los tok/s.
Avisos: parte del modelo en la CPU, dos modelos cargados, Ollama cargado a la vez que RDNA-FAST, contexto casi lleno.
Botón «Descargar modelo» (keep_alive 0).

Las lecturas van en un hilo aparte (urllib con 2 s de plazo y un PowerShell cada ~5 s) y el panel sólo pinta lo último
leído: nunca frena ni rompe el chat; lo que no se puede leer sale como «—». No carga modelos.
Variable de entorno ASTROPILOT_PANEL=0: panel apagado. El fichero es idéntico en siril/herramientas y sas/herramientas.
"""
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime

from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtWidgets import QGridLayout, QGroupBox, QHBoxLayout, QLabel, QProgressBar, QPushButton, QVBoxLayout

GIB = 1024 ** 3
ULTIMO = {}            # última respuesta local: {proveedor, modelo, entrada, salida, tps, hora}

PS_GPU = r"""$ErrorActionPreference = 'SilentlyContinue'
$inv = [Globalization.CultureInfo]::InvariantCulture
$s = (Get-Counter -Counter '\GPU Engine(*)\Utilization Percentage','\GPU Adapter Memory(*)\Dedicated Usage').CounterSamples
$mem = @{}; $eng = @{}
foreach ($c in $s) {
  $p = $c.Path
  if ($p -match 'adapter memory\((luid_[^)]*?)_phys') { $mem[$matches[1]] = [double]$c.CookedValue }
  elseif ($p -match '(luid_\w+?_\w+?)_phys.*engtype_([^)]+)\)') { $k = $matches[1] + '|' + $matches[2]; $eng[$k] = [double]$eng[$k] + $c.CookedValue }
}
$luid = ($mem.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key
$uso = 0.0; $tipo = ''
foreach ($e in $eng.GetEnumerator()) { $l, $t = $e.Key -split '\|'; if ($l -eq $luid -and $e.Value -gt $uso) { $uso = $e.Value; $tipo = $t } }
$tot = 0.0
Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*' | ForEach-Object { $q = $_.'HardwareInformation.qwMemorySize'; if ($q -and [double]$q -gt $tot) { $tot = [double]$q } }
'{"gpu":' + ([math]::Round([math]::Min(100.0, $uso), 1)).ToString($inv) + ',"motor":"' + $tipo + '","vram":' + ([double]$mem[$luid]).ToString('0', $inv) + ',"total":' + $tot.ToString('0', $inv) + '}'
"""


def anotar(proveedor, modelo, entrada, salida, tps=0.0):
    """Lo llama el motor tras cada respuesta local (Ollama: prompt_eval_count/eval_count; llama-server: usage)."""
    try:
        tps = float(tps or 0)
    except (TypeError, ValueError):
        tps = 0.0
    ULTIMO.clear()
    ULTIMO.update(proveedor=proveedor, modelo=str(modelo or ""), entrada=int(entrada or 0), salida=int(salida or 0),
                  tps=tps if tps > 0 else 0.0, hora=time.time())


def _get(url, timeout=2.0):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as f:
            return f.read().decode("utf-8") if f.status == 200 else None
    except Exception:
        return None


def _gpu():
    if sys.platform != "win32":
        return None
    try:
        p = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", PS_GPU],
                           capture_output=True, text=True, timeout=8, creationflags=0x08000000)   # CREATE_NO_WINDOW
        m = re.search(r"\{[^{}]*\}", p.stdout or "")
        d = json.loads(m.group(0)) if m else None
        return d if d and d.get("vram", 0) > 0 else None
    except Exception:
        return None


def _n(x, d=0, en=False):
    s = f"{x:.{d}f}"
    return s if en else s.replace(".", ",")


def _miles(n, en=False):
    s = f"{int(round(n)):,}"
    return s if en else s.replace(",", ".")


class PanelLocal(QGroupBox):
    """proveedor() → "ollama" | "rdna" | None (otro: panel oculto); modelo() → modelo de Ollama elegido;
    ocupado() → el chat espera al modelo; tope() → tokens máximos del historial; en() → textos en inglés."""

    def __init__(self, proveedor, modelo, ocupado, tope, url_ollama, url_rdna, en=lambda: False, parent=None):
        super().__init__(parent)
        self.f_prov, self.f_modelo, self.f_ocupado, self.f_tope, self.f_en = proveedor, modelo, ocupado, tope, en
        self.url_ollama = url_ollama.rstrip("/")
        self.url_rdna = re.sub(r"/v1$", "", url_rdna.rstrip("/"))
        self.apagado = os.environ.get("ASTROPILOT_PANEL", "") == "0"
        self.datos, self.gpu, self.cargados = {}, None, []
        self.hilo, self.t_gpu, self.fallos_gpu = None, 0.0, 0

        self.l_modelo = QLabel()
        self.l_modelo.setWordWrap(True)
        self.l_modelo.setTextFormat(Qt.TextFormat.RichText)
        self.l_gpu = QLabel()
        self.l_gpu.setTextFormat(Qt.TextFormat.RichText)
        self.l_gpu.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        self.l_gpu.setMinimumWidth(110)
        f1 = QHBoxLayout()
        f1.addWidget(self.l_modelo, 1)
        f1.addWidget(self.l_gpu)

        rejilla = QGridLayout()                         # rejilla: las dos barras empiezan y acaban igual
        rejilla.setColumnStretch(1, 1)

        def fila(i):
            t, b, v = QLabel(), QProgressBar(), QLabel()
            b.setRange(0, 1000)
            b.setTextVisible(False)
            b.setFixedHeight(10)
            rejilla.addWidget(t, i, 0)
            rejilla.addWidget(b, i, 1)
            rejilla.addWidget(v, i, 2)
            return t, b, v
        self.t_mem, self.b_mem, self.v_mem = fila(0)
        self.t_ctx, self.b_ctx, self.v_ctx = fila(1)
        self.l_carga = QLabel()
        self.l_carga.setTextFormat(Qt.TextFormat.RichText)
        self.b_descargar = QPushButton()
        self.b_descargar.clicked.connect(self.descargar)
        f4 = QHBoxLayout()
        f4.addWidget(self.l_carga, 1)
        f4.addWidget(self.b_descargar)
        caja = QVBoxLayout()
        caja.setContentsMargins(8, 4, 8, 4)
        caja.setSpacing(3)
        for f in (f1, rejilla, f4):
            caja.addLayout(f)
        self.setLayout(caja)

        self.timer = QTimer(self)
        self.timer.timeout.connect(self.tick)
        self.setVisible(self.local() is not None)
        if not self.apagado:
            self.timer.start(2500)
            self.tick()

    def tx(self, es, en):
        return en if self.f_en() else es

    def local(self):
        if self.apagado:
            return None
        try:
            return self.f_prov()
        except Exception:
            return None

    # --- lecturas (hilo aparte)
    def _leer(self, prov):
        d = {"prov": prov, "ps": _get(self.url_ollama + "/api/ps")}
        if prov == "rdna":
            d["props"] = _get(self.url_rdna + "/props")
            d["slots"] = _get(self.url_rdna + "/slots")
        self.datos = d
        if self.fallos_gpu < 3 and time.time() - self.t_gpu >= 4.5:
            self.t_gpu = time.time()
            g = _gpu()
            if g:
                g["hora"] = time.time()
                self.gpu, self.fallos_gpu = g, 0
            else:
                self.fallos_gpu += 1

    def tick(self):
        prov = self.local()
        if self.isVisible() != (prov is not None):
            self.setVisible(prov is not None)
        if prov is None:
            return
        if self.hilo is None or not self.hilo.is_alive():
            self.hilo = threading.Thread(target=self._leer, args=(prov,), daemon=True)
            self.hilo.start()
        try:
            self.pintar(prov)
        except Exception as e:
            self.l_carga.setText("—")
            print(f"[panel local] {type(e).__name__}: {e}")

    def pintar(self, prov):
        tx, en = self.tx, self.f_en()
        n = lambda x, d=0: _n(x, d, en)
        gb = lambda b: n(b / GIB, 1) + " GB"
        esc = lambda s: str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        rojo, ambar, verde = "#e0453a", "#d99a20", "#3fa34d"
        D = self.datos if self.datos.get("prov") == prov else {}
        G = self.gpu if self.gpu and time.time() - self.gpu["hora"] < 20 else None
        ocupado = bool(self.f_ocupado())
        avisos, partes, nombre, ctx, pct, estado = [], [], "", 0, None, ""
        try:
            ps = (json.loads(D["ps"]).get("models") or []) if D.get("ps") else None
        except Exception:
            ps = None
        self.cargados = [x.get("name") or x.get("model") for x in ps or []]
        en_vram = sum(x.get("size_vram") or 0 for x in ps or [])
        if prov == "ollama":
            self.setTitle(tx("IA local · Ollama", "Local AI · Ollama"))
            quiero = str(self.f_modelo() or "")
            m = next((x for x in ps or [] if (x.get("name") or "") in (quiero, quiero + ":latest")
                      or (x.get("name") or "").split(":")[0] == quiero), None)
            if ps is None:
                nombre = esc(quiero or "—")
                avisos.append((rojo, tx("Ollama no responde en ", "Ollama does not answer at ") + self.url_ollama))
            elif m is None and ps:
                m = ps[0]
                avisos.append((ambar, tx("El cargado no es el elegido (", "The loaded model is not the chosen one (") + esc(quiero) + ")"))
            if m:
                nombre = esc(m.get("name") or m.get("model"))
                det = m.get("details") or {}
                for k in ("quantization_level", "parameter_size"):
                    if det.get(k):
                        partes.append(esc(det[k]))
                ctx = m.get("context_length") or 0
                if m.get("size"):
                    partes.append(gb(m["size"]))
                    pct = round(100 * (m.get("size_vram") or 0) / m["size"])
                if pct is not None and pct < 100:
                    avisos.append((rojo, n(100 - pct) + tx(" % del modelo va en la CPU: será lento",
                                                           " % of the model runs on the CPU: it will be slow")))
                estado = tx("generando", "generating") if ocupado else tx("en reposo", "idle")
                try:
                    exp = datetime.fromisoformat(re.sub(r"(\.\d{6})\d+", r"\1", m.get("expires_at") or ""))
                    mins = (exp.timestamp() - time.time()) / 60
                    if not ocupado and mins > 525600:
                        estado += tx(" · no se descarga", " · never unloads")
                    elif not ocupado and mins > 0:
                        estado += tx(" · se descarga en ", " · unloads in ") + f"{int(mins) + 1} min"
                except Exception:
                    pass
            elif ps is not None:
                nombre = esc(quiero or "—")
                estado = tx("cargando el modelo…", "loading the model…") if ocupado else \
                    tx("sin modelo cargado (se carga al enviar)", "no model loaded (loads on send)")
            if not ctx:
                mk = re.search(r"(\d+)k\b", nombre, re.I)
                ctx = int(mk.group(1)) * 1024 if mk else 0
            if ps and len(ps) >= 2:
                avisos.append((rojo, tx(f"Hay {len(ps)} modelos cargados (", f"There are {len(ps)} models loaded (") +
                               esc(", ".join(self.cargados)) + tx("): no caben juntos; descarga uno",
                                                                  "): they do not fit together; unload one")))
        else:
            self.setTitle("RDNA-FAST (llama-server)")
            try:
                pr = json.loads(D["props"]) if D.get("props") else None
            except Exception:
                pr = None
            try:
                sl = json.loads(D["slots"]) if D.get("slots") else None
            except Exception:
                sl = None
            ruta = str((pr or {}).get("model_path") or "")
            base = re.sub(r"^.*[\\/]", "", ruta)
            nombre = esc(str(self.f_modelo() or "") or re.sub(r"\.gguf$", "", base, flags=re.I) or "llama-server")
            q = re.search(r"(?:^|[-_.])((?:UD-)?(?:I?Q\d(?:_[A-Z0-9]+)*|BF16|F16|F32))(?=[-_.]|$)", base, re.I)
            if q:
                partes.append(esc(q.group(1).upper()))
            try:
                if ruta and os.path.isfile(ruta):
                    partes.append(gb(os.path.getsize(ruta)))
            except OSError:
                pass
            if pr:
                ctx = (pr.get("default_generation_settings") or {}).get("n_ctx") or pr.get("n_ctx") or 0
            if isinstance(sl, list) and sl and isinstance(sl[0], dict) and sl[0].get("n_ctx"):
                ctx = sl[0]["n_ctx"]
            procesando = isinstance(sl, list) and any(isinstance(s, dict) and s.get("is_processing") for s in sl)
            if not pr:
                avisos.append((rojo, tx("llama-server no responde en ", "llama-server does not answer at ") + self.url_rdna))
                estado = "—"
            else:
                estado = tx("generando", "generating") if procesando or ocupado else tx("en reposo", "idle")
            if ps:
                avisos.append((rojo, tx("Ollama tiene cargado ", "Ollama has loaded ") + esc(", ".join(self.cargados)) +
                               tx(": no caben los dos en la gráfica", ": both do not fit in the GPU")))
        if ctx:
            partes.append(tx("contexto ", "context ") + f"{round(ctx / 1024)}k")
        # /api/ps no dice si el modelo trabaja: con la GPU cargada y el chat sin esperar, es otra petición u otro programa.
        if not ocupado and G and G.get("gpu", 0) >= 30 and estado.startswith(("en reposo", "idle")):
            estado = tx("GPU ocupada por otra petición u otro programa", "GPU busy with another request or program")

        # Contexto: tokens de la última respuesta (entrada con la caché + salida) frente al contexto y al tope del historial.
        U = ULTIMO if ULTIMO.get("proveedor") == prov else {}
        usados = U.get("entrada", 0) + U.get("salida", 0)
        try:
            tope = int(self.f_tope() or 0)
        except Exception:
            tope = 0
        fc = usados / ctx if ctx and usados else 0.0
        ft = U.get("entrada", 0) / tope if tope else 0.0
        self.b_ctx.setValue(int(min(1.0, fc) * 1000))
        self._color(self.b_ctx, rojo if fc > 0.95 else ambar if fc > 0.8 or ft > 0.8 else verde)
        self.v_ctx.setText((_miles(usados, en) if usados else "—") + tx(" de ", " of ") + (f"{round(ctx / 1024)}k" if ctx else "—") +
                           (f" ({n(100 * fc)} %)" if fc else "") +
                           (tx(" · tope historial ", " · history cap ") + f"{round(tope / 1000)}k" if tope else ""))
        self.v_ctx.setToolTip(tx("Tokens de la última respuesta (entrada con la caché + salida) frente al contexto del modelo. "
                                 "Al pasar el tope del historial, el chat compacta los mensajes viejos.",
                                 "Tokens of the last reply (input incl. cache + output) against the model context. Past the "
                                 "history cap, the chat compacts old messages."))
        if fc > 0.8 or ft > 0.8:
            avisos.append((ambar, tx("Contexto casi lleno: pronto se compacta el historial",
                                     "Context nearly full: the history will be compacted soon")))

        # Memoria dedicada de la gráfica (todos los programas); sin contador, la de los modelos de Ollama.
        usada = G["vram"] if G else en_vram
        total = G["total"] if G and G.get("total", 0) > 4 * GIB else 24 * GIB
        self.b_mem.setValue(int(min(1.0, usada / total) * 1000))
        self._color(self.b_mem, ambar if usada / total > 0.98 else verde)
        self.v_mem.setText((gb(usada) if G or usada else "—") + tx(" de ", " of ") + n(total / GIB) + " GB" +
                           ("" if G else tx(" (sólo modelos)", " (models only)")))
        self.v_mem.setToolTip(tx("Memoria dedicada usada en la gráfica (todos los programas), del contador de Windows.",
                                 "Dedicated GPU memory in use (all programs), from the Windows counter."))

        self.l_modelo.setText(f"<b>{nombre or '—'}</b>" + (" · " + " · ".join(partes) if partes else "") +
                              "".join(f'<br><span style="color:{c}">⚠ {t}</span>' for c, t in avisos))
        color = "#888888" if pct is None else verde if pct >= 100 else rojo
        self.l_gpu.setText(f'<div align="right"><span style="font-size:20pt; font-weight:600; color:{color}">'
                           f'{"—" if pct is None else n(pct) + " %"}</span><br>{tx("en la GPU", "on the GPU")}</div>')
        self.l_gpu.setToolTip(tx("Parte del modelo cargada en la gráfica (size_vram / size de /api/ps).",
                                 "Part of the model loaded on the GPU (size_vram / size from /api/ps).") if prov == "ollama" else
                              tx("llama-server no lo dice: con -ngl 99 va entero en la gráfica.",
                                 "llama-server does not report it: with -ngl 99 it is fully on the GPU."))
        carga = [tx("Carga: ", "Load: ") + (f"GPU {n(G['gpu'])} %" + (f" ({esc(G['motor'])})" if G.get("motor") else "")
                                            if G else "GPU —"), estado]
        if U.get("tps"):
            carga.append(n(U["tps"], 1) + tx(" tok/s en la última respuesta", " tok/s in the last reply"))
        self.l_carga.setText(" · ".join(s for s in carga if s))
        self.t_mem.setText(tx("Memoria", "Memory"))
        self.t_ctx.setText(tx("Contexto", "Context"))
        self.b_descargar.setVisible(bool(self.cargados))
        self.b_descargar.setEnabled(not ocupado)
        self.b_descargar.setText(tx("Descargar modelos" if len(self.cargados) > 1 else "Descargar modelo",
                                    "Unload models" if len(self.cargados) > 1 else "Unload model"))
        self.b_descargar.setToolTip(tx("Saca de la gráfica lo que tiene cargado Ollama (keep_alive 0): ",
                                       "Unloads what Ollama has loaded (keep_alive 0): ") + ", ".join(self.cargados))

    @staticmethod
    def _color(barra, color):
        barra.setStyleSheet("QProgressBar{border:0;background:rgba(128,128,128,80)}"
                            f"QProgressBar::chunk{{background:{color}}}")

    def descargar(self):
        """Botón: descarga de Ollama lo que tenga cargado (keep_alive 0), en un hilo. No con una petición en marcha."""
        if self.f_ocupado():
            return
        nombres = list(self.cargados)
        self.b_descargar.setEnabled(False)

        def hacer():
            for nm in nombres:
                try:
                    req = urllib.request.Request(self.url_ollama + "/api/generate",
                                                 data=json.dumps({"model": nm, "keep_alive": 0}).encode("utf-8"),
                                                 headers={"Content-Type": "application/json"})
                    urllib.request.urlopen(req, timeout=30).read()
                except Exception:
                    pass
        threading.Thread(target=hacer, daemon=True).start()

    def parar(self):
        self.timer.stop()
