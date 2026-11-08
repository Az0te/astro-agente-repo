// PiCopilotLite.js — Versión mínima de PiCopilot como script PJSR (sin módulo ni DLL: no necesita firma).
// Copyright (c) 2026 Rafael Vidal. Licencia MIT.
//
// Chat con un modelo (Ollama local por HTTP, o Claude Code / Codex por línea de órdenes) que, cuando quiere
// actuar, devuelve un bloque ```javascript con código PJSR que usa las funciones de la guía
// (los .js de guia/herramientas). El script carga la guía en este mismo proceso y ejecuta ese código aquí.
//
// Lanzar: Script > Execute Script File... > PiCopilotLite.js
// Pruebas automáticas (para desarrollo):  PixInsight.exe -x=<ruta>/PiCopilotLite.js,--prueba[,<salida.json>[,claude|codex]]
//
// No usa MCP ni «PixInsight.exe -x=»: mientras el script corre, PixInsight está ocupado y esas peticiones
// se quedarían esperando.

#feature-id    PiCopilot > PiCopilotLite
#feature-info  Asistente de IA mínimo para PixInsight (Ollama / Claude CLI / Codex CLI) que ejecuta las funciones de la guía.

#engine v8

#include <pjsr/DataType.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/StdIcon.jsh>
// Sin <pjsr/Sizer.jsh>: con #engine v8 HorizontalSizer/VerticalSizer ya existen y ese include no compila.
#include <pjsr/FrameStyle.jsh>
#include <pjsr/TextAlign.jsh>

var PL_VERSION = "0.1.0";
var PL_CLAVE = "PiCopilotLite";
var PL_RUTA_SCRIPT = File.extractDrive(#__FILE__) + File.extractDirectory(#__FILE__);   // .../picopilot/script
var PL_TMP = File.systemTempDirectory + "/PiCopilotLite";
var PL_MAX_CORRECCIONES = 3;
// Ojo: el preprocesador de PJSR toma la barra-asterisco y la doble barra como comentarios aunque estén dentro de
// cadenas, regex o comentarios de línea. No escribirlas seguidas en este fichero (trocear las cadenas).
var PL_URL_OLLAMA = "http:/" + "/localhost:11434";
var PL_PRESUPUESTO_HISTORIAL = 24000;   // caracteres de conversación que se mandan al modelo (los últimos)

// ---------------------------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------------------------

function plPadre(ruta) {
   var r = ruta.replace(/[\\\/]+$/, "");
   var i = Math.max(r.lastIndexOf("/"), r.lastIndexOf("\\"));
   return i > 0 ? r.substring(0, i) : r;
}

function plEsWindows() { return CoreApplication.platform == "MSWindows" || CoreApplication.platform == "Windows"; }

function plCarpeta(d) { if (!File.directoryExists(d)) File.createDirectory(d, true); return d; }

function plRecortar(s, n) { s = String(s); return s.length > n ? s.substring(0, n) + " …[recortado]" : s; }

function plEventos() { CoreApplication.processEvents(); }

function plDormir(ms) { if (typeof msleep === "function") msleep(ms); else Thread.msleep(ms); }

function plGlobal() { return (0, eval)("this"); }

// Texto JSON sólo con ASCII (NetworkTransfer.post recibe un String y así no dependemos de cómo lo codifica).
function plJsonAscii(o) {
   return JSON.stringify(o).replace(/[\u0080-\uffff]/g, function (c) {
      return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
   });
}

// ---------------------------------------------------------------------------------------------------------------
// Ajustes (Settings de PixInsight, claves "PiCopilotLite/...")
// ---------------------------------------------------------------------------------------------------------------

function plRutaClaudePorDefecto() {
   var c = File.homeDirectory + "/.local/bin/claude" + (plEsWindows() ? ".exe" : "");
   return File.exists(c) ? c : "claude";
}

function plRutaCodexPorDefecto() {
   if (plEsWindows()) {
      var a = File.homeDirectory + "/AppData/Roaming/npm/codex.cmd";
      if (File.exists(a)) return a;
   }
   return "codex";
}

function PLAjustes() {
   this.proveedor = "ollama";             // ollama | claude | codex
   this.modeloOllama = "qwen38-32k";
   this.modeloClaude = "";                // vacío = el que tenga configurado la CLI
   this.modeloCodex = "";
   this.ollamaUrl = PL_URL_OLLAMA;
   this.temperatura = 0.2;
   this.pensar = false;                   // "think" de Ollama (los qwen3 tardan mucho más pensando)
   this.rutaClaude = plRutaClaudePorDefecto();
   this.rutaCodex = plRutaCodexPorDefecto();
   this.guia = plPadre(plPadre(PL_RUTA_SCRIPT)) + "/guia";
   this.ejecutarSinPreguntar = false;

   var CAMPOS = { proveedor: DataType_String, modeloOllama: DataType_String, modeloClaude: DataType_String,
                  modeloCodex: DataType_String, ollamaUrl: DataType_String, temperatura: DataType_String,
                  pensar: DataType_Boolean, rutaClaude: DataType_String, rutaCodex: DataType_String,
                  guia: DataType_String, ejecutarSinPreguntar: DataType_Boolean };

   this.cargar = function () {
      for (var k in CAMPOS) {
         var v = Settings.read(PL_CLAVE + "/" + k, CAMPOS[k]);
         if (Settings.lastReadOK && v !== null && v !== undefined) {
            if (k == "temperatura") { var t = parseFloat(String(v).replace(",", ".")); if (isFinite(t)) this[k] = t; }
            else this[k] = v;
         }
      }
   };

   this.guardar = function () {
      for (var k in CAMPOS)
         Settings.write(PL_CLAVE + "/" + k, CAMPOS[k], k == "temperatura" ? String(this[k]) : this[k]);
   };

   this.modelo = function () {
      return this.proveedor == "claude" ? this.modeloClaude : this.proveedor == "codex" ? this.modeloCodex : this.modeloOllama;
   };

   this.ponerModelo = function (m) {
      if (this.proveedor == "claude") this.modeloClaude = m;
      else if (this.proveedor == "codex") this.modeloCodex = m;
      else this.modeloOllama = m;
   };
}

// ---------------------------------------------------------------------------------------------------------------
// Carga de la guía en este proceso: constantes de los .jsh, herramientas y funciones propias del runner MCP
// ---------------------------------------------------------------------------------------------------------------

var PL_ORDEN_GUIA = ["procesos", "gradcompare", "analisis", "alineado", "preproceso", "bandaestrecha", "boost", "color",
                     "combinacion", "deconvolucion", "realces", "estirado", "estrellas", "exportar", "graxpert",
                     "gradiente", "hdr", "lineal", "mascaras", "nucleo", "recombinacion", "ruido"];
var plGuiaCargada = null;   // carpeta de la guía cargada

// Los #define de los .jsh de pjsr (UndoFlag_NoSwapFile, DataType_Float...) sólo existen en el preprocesador; el código que
// se ejecuta con eval no los ve. Se leen de los ficheros y se definen como variables globales.
function plDefinirConstantesJsh() {
   var dirs = [CoreApplication.dirPath + "/../include/pjsr", "C:/Program Files/PixInsight/include/pjsr",
               "/Applications/PixInsight/include/pjsr", "/opt/PixInsight/include/pjsr"], g = plGlobal(), n = 0;
   for (var i = 0; i < dirs.length; ++i) {
      if (!File.directoryExists(dirs[i])) continue;
      var fs = searchDirectory(dirs[i] + "/" + "*.jsh", false);
      for (var j = 0; j < fs.length; ++j) {
         var lineas = File.readTextFile(fs[j]).split(/\r?\n/);
         for (var k = 0; k < lineas.length; ++k) {
            var m = /^#define\s+([A-Za-z_]\w*)\s+(-?(?:0x[0-9A-Fa-f]+|\d+(?:\.\d+)?(?:[eE][-+]?\d+)?))\b/.exec(lineas[k]);
            if (m && g[m[1]] === undefined) { g[m[1]] = Number(m[2]); ++n; }
         }
      }
      break;
   }
   return n;
}

function plQuitarDirectivas(texto) {
   return texto.split(/\r?\n/).map(function (l) { return /^\s*#/.test(l) ? "" : l; }).join("\n");
}

function plCargarGuia(guia) {
   if (plGuiaCargada === guia) return [];
   var g = plGlobal(), avisos = [];
   plDefinirConstantesJsh();
   g.PICOPILOT_GUIA = guia;
   g.GUIA_HERRAMIENTAS = guia + "/herramientas";
   // Funciones propias del runner del MCP (vistas, estadisticas, previa, abrirImagen...): se reutilizan tal cual.
   var runner = plPadre(guia) + "/mcp/pjsr/picopilot-runner.js";
   if (File.exists(runner)) {
      try {
         var src = plQuitarDirectivas(File.readTextFile(runner)).replace(/^\s*pprMain\(\);\s*$/m, "");
         (0, eval)(src);
      } catch (e) { avisos.push("runner: " + e); }
   } else avisos.push("No encuentro " + runner + " (sin vistas/estadisticas/previa...).");
   g.PICOPILOT_GUIA = guia;   // el runner pone su ruta por defecto
   g.GUIA_HERRAMIENTAS = guia + "/herramientas";
   for (var i = 0; i < PL_ORDEN_GUIA.length; ++i) {
      var f = guia + "/herramientas/" + PL_ORDEN_GUIA[i] + ".js";
      if (!File.exists(f)) { avisos.push("Falta " + f); continue; }
      try { (0, eval)(plQuitarDirectivas(File.readTextFile(f))); }
      catch (e) { avisos.push(PL_ORDEN_GUIA[i] + ".js: " + e); }
   }
   // Nombres cortos para las funciones del runner (los mismos que las herramientas del MCP).
   if (typeof g.pprVistas === "function") {
      g.ping = function () { return g.pprPing(); };
      g.vistas = function () { return g.pprVistas(); };
      g.estadisticas = function (vista, o) { return g.pprEstadisticas(vista, o || {}); };
      g.historial = function (vista, o) { return g.pprHistorial(vista, o || {}); };
      g.previa = function (vista, o) { return g.pprPrevia(vista, o || {}); };
      g.abrirImagen = function (fichero) { return g.pprAbrir(fichero); };
      g.guardarImagen = function (vista, fichero, sobrescribir) { return g.pprGuardar(vista, fichero, sobrescribir === true); };
      g.cerrarVista = function (vista, descartar) { return g.pprCerrar(vista, descartar === true); };
   }
   plGuiaCargada = guia;
   return avisos;
}

// ---------------------------------------------------------------------------------------------------------------
// Contexto para el modelo
// ---------------------------------------------------------------------------------------------------------------

var PL_FIRMAS_RUNNER = {
   ping: "ping()", vistas: "vistas()", estadisticas: "estadisticas(vista, {rect, bordes})",
   historial: "historial(vista, {parametros})", previa: "previa(vista, opciones)", abrirImagen: "abrirImagen(fichero)",
   guardarImagen: "guardarImagen(vista, fichero, sobrescribir)", cerrarVista: "cerrarVista(vista, descartar)"
};
// No disponibles en la versión Lite (necesitan BlindSolver o son el run_script del MCP).
var PL_EXCLUIDAS = { run_script: 1, resolverAstrometria: 1 };

function plFirma(nombre) {
   if (PL_FIRMAS_RUNNER[nombre]) return PL_FIRMAS_RUNNER[nombre];
   var L = plGlobal().LISTA;
   if (L && typeof L[nombre] === "function") {
      var m = /return\s+(\w+)\(([^;]*)\);/.exec(String(L[nombre]));
      if (m) return m[1] + "(" + m[2].replace(/a\.(\w+)(\s*\|\|\s*\{\})?/g, "$1") + ")";
   }
   return nombre + "(vista, opciones)";
}

function plListaFunciones(guia) {
   var f = guia + "/herramientas/manifiesto.json";
   if (!File.exists(f)) return "(no encuentro " + f + ")";
   var man = JSON.parse(File.readTextFile(f)), out = [];
   (man.funciones || []).forEach(function (x) {
      if (PL_EXCLUIDAS[x.nombre]) return;
      var d = String(x.descripcion || "");
      var p = d.indexOf(". ");
      if (p > 0 && p < 220) d = d.substring(0, p + 1);
      out.push("- " + plFirma(x.nombre) + " [" + x.nivel + "]: " + plRecortar(d, 220));
   });
   return out.join("\n");
}

function plListaVentanas() {
   var ws = ImageWindow.windows, act = ImageWindow.activeWindow, out = [];
   for (var i = 0; i < ws.length; ++i) {
      var w = ws[i], im = w.mainView.image, meds = [];
      for (var c = 0; c < Math.min(3, im.numberOfChannels); ++c) {
         im.selectedChannel = c; meds.push(im.median());
      }
      im.resetSelections();
      var lineal = meds.every(function (m) { return m < 0.05; });
      out.push("- " + w.mainView.id + (!act.isNull && act.mainView.id == w.mainView.id ? " (activa)" : "") + ": " +
               im.width + "x" + im.height + ", " + im.numberOfChannels + " canal(es), mediana " +
               meds.map(function (m) { return m.toFixed(4); }).join("/") + " → " +
               (lineal ? "parece lineal" : "parece estirada"));
   }
   return out.length ? out.join("\n") : "(no hay imágenes abiertas)";
}

function plPromptSistema(aj) {
   return "Eres PiCopilot Lite, un asistente experto en procesado de astrofotografía que trabaja dentro de PixInsight. " +
   "Respondes siempre en español, de forma clara y concisa. Eres fiel a los datos: no inventas parámetros ni " +
   "resultados; si algo no lo has medido o no está en la guía, lo dices.\n\n" +
   "Cuando quieras actuar sobre PixInsight, devuelve UN único bloque ```javascript con código PJSR (ECMAScript 5) " +
   "que se ejecutará en el propio PixInsight con las funciones de la guía ya cargadas (no uses #include ni " +
   "eval de ficheros). Para devolver información al chat usa chat(texto) (también se ve en la consola); el valor de " +
   "la última expresión del script también se devuelve. Si no hace falta ejecutar nada, responde sin bloque de código. " +
   "Si no está claro sobre qué vista trabajar, pregunta antes de escribir el script.\n\n" +
   "Reglas de la guía:\n" +
   "- Trabaja siempre sobre copias: no modifiques las vistas originales (las funciones de nivel «copias» ya crean vistas nuevas).\n" +
   "- No supongas qué objeto es por el nombre del fichero ni nombres objetos concretos que no te haya dicho el usuario.\n" +
   "- Antes de estirar, pregunta al usuario el tipo de objeto (galaxia, nebulosa de emisión, cúmulo...) si no lo sabes.\n" +
   "- Mide antes y después (estadisticas) y no borres ni sobrescribas ficheros del usuario.\n" +
   "- Usa los ids exactos de la lista de ventanas; las funciones devuelven objetos: pásalos por chat(JSON.stringify(r, null, 1)).\n" +
   "- PJSR: console.writeln (console.log no existe); ImageWindow.windows es un array; ImageWindow.windowById(id).\n\n" +
   "Funciones disponibles (nombre(argumentos) [nivel]: descripción):\n" + plListaFunciones(aj.guia) + "\n\n" +
   "Ventanas abiertas ahora en PixInsight:\n" + plListaVentanas();
}

// ---------------------------------------------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------------------------------------------

// Cuerpo del hilo de red: debe ser autocontenido (cada Thread tiene su propio motor de JavaScript).
function plHiloRed(job) {
   var recibido = new ByteArray;
   var t = new NetworkTransfer;
   t.setURL(job.url);
   t.setConnectionTimeout(job.conexion || 10);
   if (job.cuerpo) t.setCustomHTTPHeaders(["Content-Type: application/json"]);
   t.onDownloadDataAvailable = function (d) { recibido.add(d); return !Thread.current.isAborted; };
   t.onTransferProgress = function () { return !Thread.current.isAborted; };
   var ok = job.cuerpo ? t.post(job.cuerpo) : t.download();
   return { ok: ok, codigo: t.responseCode, error: t.errorInformation, texto: recibido.utf8ToString() };
}

// Petición HTTP sin congelar el diálogo. estado.cancelado la aborta. Devuelve { ok, codigo, error, texto }.
function plHttp(job, estado, limiteS) {
   if (typeof Thread === "undefined") return plHiloRed(job);
   var th = new Thread(plHiloRed, job, { pooled: false }), t0 = Date.now();
   th.start();
   while (th.isActive) {
      plEventos();
      plDormir(40);
      if ((estado && estado.cancelado) || (limiteS && Date.now() - t0 > limiteS * 1000)) {
         th.abort(); th.wait();
         return { ok: false, codigo: 0, error: estado && estado.cancelado ? "cancelado" : "tiempo agotado", texto: "" };
      }
   }
   if (th.error && String(th.error).length) return { ok: false, codigo: 0, error: String(th.error), texto: "" };
   return th.result;
}

function plOllamaModelos(aj) {
   var r = plHttp({ url: aj.ollamaUrl.replace(/[\/]+$/, "") + "/api/tags", conexion: 3 }, null, 6);
   if (!r.ok || r.codigo != 200) throw new Error("Ollama no responde en " + aj.ollamaUrl + (r.error ? " (" + r.error + ")" : ""));
   return (JSON.parse(r.texto).models || []).map(function (m) { return m.name; });
}

function plOllamaChat(aj, sistema, mensajes, estado) {
   var cuerpo = { model: aj.modeloOllama, stream: false, think: !!aj.pensar,
                  options: { temperature: aj.temperatura },
                  messages: [{ role: "system", content: sistema }].concat(mensajes) };
   var r = plHttp({ url: aj.ollamaUrl.replace(/[\/]+$/, "") + "/api/chat", cuerpo: plJsonAscii(cuerpo), conexion: 10 }, estado, 0);
   if (!r.ok || r.codigo != 200) {
      var det = r.texto ? " " + plRecortar(r.texto, 400) : "";
      throw new Error("Ollama: " + (r.error || "HTTP " + r.codigo) + det);
   }
   var j = JSON.parse(r.texto);
   if (j.error) throw new Error("Ollama: " + j.error);
   return String(j.message && j.message.content || "").replace(new RegExp("<think>[\\s\\S]*?</think>\\s" + "*", "g"), "").trim();
}

// Lanza una CLI con el prompt por stdin (fichero) y la salida a fichero, sin congelar el diálogo.
function plEjecutarCli(programa, args, ficheroEntrada, ficheroSalida, estado) {
   var dir = plCarpeta(PL_TMP), ferr = dir + "/stderr.txt";
   [ficheroSalida, ferr].forEach(function (f) { if (File.exists(f)) File.remove(f); });
   // Los .cmd/.bat de npm (codex.cmd) no se pueden lanzar directamente.
   if (plEsWindows() && /\.(cmd|bat)$/i.test(programa)) { args = ["/c", programa].concat(args); programa = "cmd.exe"; }
   var P = new ExternalProcess;
   P.workingDirectory = dir;
   P.redirectStandardInput(ficheroEntrada);
   P.redirectStandardOutput(ficheroSalida);
   P.redirectStandardError(ferr);
   var fallo = null;
   P.onError = function (codigo) { if (fallo === null) fallo = codigo; };
   P.start(programa, args);
   var t0 = Date.now();
   while (P.isStarting && Date.now() - t0 < 15000) { plEventos(); plDormir(20); }
   plEventos();
   if (fallo === 0 || (!P.isRunning && Date.now() - t0 >= 15000))   // 0 = FailedToStart
      throw new Error("No se pudo lanzar " + programa + " (revisa la ruta en Ajustes).");
   while (P.isRunning) {
      plEventos();
      plDormir(80);
      if (estado.cancelado) {
         try { if (plEsWindows() && P.pid) ExternalProcess.execute("taskkill", ["/F", "/T", "/PID", String(P.pid)]); } catch (e) {}
         try { P.kill(); } catch (e) {}
         throw new Error("cancelado");
      }
   }
   var err = File.exists(ferr) ? File.readTextFile(ferr) : "";
   if (P.exitCode != 0)
      throw new Error(File.extractName(programa) + " terminó con código " + P.exitCode + (err ? ": " + plRecortar(err.trim(), 800) : ""));
   return err;
}

// Conversación en texto plano para las CLI (no tienen historial propio entre llamadas).
function plConversacionTexto(mensajes) {
   return mensajes.map(function (m) {
      return (m.role == "user" ? "### Usuario" : "### PiCopilot") + "\n" + m.content;
   }).join("\n\n") + "\n\n### PiCopilot\n";
}

function plClaudeChat(aj, sistema, mensajes, estado) {
   var dir = plCarpeta(PL_TMP), fs = dir + "/sistema.txt", fe = dir + "/prompt.txt", fo = dir + "/respuesta.txt";
   File.writeTextFile(fs, sistema);
   File.writeTextFile(fe, "Continúa esta conversación respondiendo al último mensaje del usuario.\n\n" + plConversacionTexto(mensajes));
   // Sin MCP ni herramientas: sólo texto. PixInsight está ocupado con este script y no podría atender al MCP.
   var args = ["-p", "--output-format", "text", "--strict-mcp-config", "--tools", "", "--system-prompt-file", fs];
   if (aj.modeloClaude) args.push("--model", aj.modeloClaude);
   plEjecutarCli(aj.rutaClaude, args, fe, fo, estado);
   return File.readTextFile(fo).trim();
}

function plCodexChat(aj, sistema, mensajes, estado) {
   var dir = plCarpeta(PL_TMP), fe = dir + "/prompt.txt", fo = dir + "/salida_codex.txt", fu = dir + "/respuesta.txt";
   if (File.exists(fu)) File.remove(fu);
   File.writeTextFile(fe, "INSTRUCCIONES (no ejecutes órdenes ni edites ficheros; sólo responde con texto):\n" + sistema +
      "\n\nCONVERSACIÓN — responde al último mensaje del usuario:\n\n" + plConversacionTexto(mensajes));
   var args = ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "-C", dir, "-o", fu];
   if (aj.modeloCodex) args.push("-m", aj.modeloCodex);
   args.push("-");
   plEjecutarCli(aj.rutaCodex, args, fe, fo, estado);
   if (File.exists(fu)) return File.readTextFile(fu).trim();
   return File.readTextFile(fo).trim();
}

// Los últimos mensajes que caben en el presupuesto (siempre al menos el último).
function plRecortarHistorial(mensajes) {
   var out = [], total = 0;
   for (var i = mensajes.length - 1; i >= 0; --i) {
      total += mensajes[i].content.length;
      if (out.length && total > PL_PRESUPUESTO_HISTORIAL) break;
      out.unshift(mensajes[i]);
   }
   while (out.length > 1 && out[0].role != "user") out.shift();
   return out;
}

function plPreguntar(aj, mensajes, estado) {
   var sistema = plPromptSistema(aj), m = plRecortarHistorial(mensajes);
   if (aj.proveedor == "claude") return plClaudeChat(aj, sistema, m, estado);
   if (aj.proveedor == "codex") return plCodexChat(aj, sistema, m, estado);
   return plOllamaChat(aj, sistema, m, estado);
}

// ---------------------------------------------------------------------------------------------------------------
// Ejecución del script del modelo
// ---------------------------------------------------------------------------------------------------------------

function plExtraerScript(texto) {
   var m = /```(?:javascript|js|pjsr)?[ \t]*\r?\n([\s\S]*?)```/i.exec(texto);
   return m ? m[1].trim() : null;
}

function plEjecutarScript(aj, codigo) {
   var avisos = plCargarGuia(aj.guia), g = plGlobal(), salida = [];
   avisos.forEach(function (a) { console.warningln("[PiCopilotLite] " + a); });
   g.chat = function () {
      var t = Array.prototype.slice.call(arguments).map(function (x) {
         return typeof x === "string" ? x : JSON.stringify(x, null, 1);
      }).join(" ");
      salida.push(t);
      console.writeln(t);
   };
   var limpio = plQuitarDirectivas(codigo), t0 = Date.now();
   console.noteln("[PiCopilotLite] Ejecutando script del modelo…");
   try {
      var v = (0, eval)(limpio);
      var txt = salida.join("\n");
      if (v !== undefined && typeof v !== "function") {
         var s; try { s = typeof v === "string" ? v : JSON.stringify(v, null, 1); } catch (e) { s = String(v); }
         if (s !== undefined) txt += (txt ? "\n" : "") + "Valor devuelto: " + s;
      }
      return { ok: true, texto: plRecortar(txt || "(sin salida)", 6000), segundos: (Date.now() - t0) / 1000 };
   } catch (e) {
      var linea = e && e.lineNumber ? " (línea " + e.lineNumber + ")" : "";
      return { ok: false, texto: plRecortar((salida.length ? salida.join("\n") + "\n" : "") + "ERROR: " +
               (e && e.message ? e.message : String(e)) + linea, 6000), segundos: (Date.now() - t0) / 1000 };
   }
}

// ---------------------------------------------------------------------------------------------------------------
// Diálogo
// ---------------------------------------------------------------------------------------------------------------

// Con #engine v8, Dialog es una clase: hay que heredar con «class ... extends» y super().
class PLDialogo extends Dialog {
   constructor(aj) {
      super();
      plConstruirDialogo.call(this, aj);
   }
}

function plConstruirDialogo(aj) {
   var self = this;
   this.aj = aj;
   this.mensajes = [];            // { role: "user" | "assistant", content }
   this.registro = "";
   this.pendiente = null;         // script de la última respuesta, sin ejecutar
   this.ultimoError = null;
   this.correcciones = 0;
   this.estado = null;            // { cancelado } mientras se espera al modelo

   this.windowTitle = "PiCopilot Lite " + PL_VERSION;
   this.userResizable = true;

   // --- Pestaña Prompt ---
   var pPrompt = new Control(this);
   this.historialBox = new TextBox(pPrompt);
   this.historialBox.readOnly = true;
   this.historialBox.setScaledMinSize(640, 360);
   this.entrada = new TextBox(pPrompt);
   this.entrada.setScaledMinHeight(70);
   this.entrada.toolTip = "Escribe tu pregunta o petición y pulsa Enviar.";

   this.bEnviar = new PushButton(pPrompt);
   this.bEnviar.text = "Enviar";
   this.bEnviar.onClick = function () { self.enviar(); };
   this.bCancelar = new PushButton(pPrompt);
   this.bCancelar.text = "Cancelar";
   this.bCancelar.enabled = false;
   this.bCancelar.onClick = function () { if (self.estado) self.estado.cancelado = true; };
   this.cAuto = new CheckBox(pPrompt);
   this.cAuto.text = "Ejecutar sin preguntar";
   this.cAuto.checked = aj.ejecutarSinPreguntar;
   this.cAuto.onCheck = function (c) { aj.ejecutarSinPreguntar = c; };
   this.bEjecutar = new PushButton(pPrompt);
   this.bEjecutar.text = "Ejecutar script";
   this.bEjecutar.enabled = false;
   this.bEjecutar.onClick = function () { self.ejecutarPendiente(); };
   this.bCorregir = new PushButton(pPrompt);
   this.bCorregir.text = "Pedir corrección";
   this.bCorregir.toolTip = "Reenvía el error al modelo para que corrija el script.";
   this.bCorregir.enabled = false;
   this.bCorregir.onClick = function () { self.pedirCorreccion(); };
   this.bVer = new PushButton(pPrompt);
   this.bVer.text = "Ver script";
   this.bVer.enabled = false;
   this.bVer.onClick = function () { self.anotar("Script pendiente", self.pendiente || "(ninguno)"); };
   this.bLimpiar = new PushButton(pPrompt);
   this.bLimpiar.text = "Nueva conversación";
   this.bLimpiar.onClick = function () {
      self.mensajes = []; self.registro = ""; self.historialBox.text = ""; self.ponerPendiente(null);
      self.ultimoError = null; self.correcciones = 0; self.bCorregir.enabled = false;
   };
   this.estadoLbl = new Label(pPrompt);
   this.estadoLbl.text = "";

   var filaB = new HorizontalSizer;
   filaB.spacing = 6;
   filaB.add(this.bEnviar); filaB.add(this.bCancelar); filaB.addSpacing(12);
   filaB.add(this.cAuto); filaB.add(this.bEjecutar); filaB.add(this.bVer); filaB.add(this.bCorregir);
   filaB.addStretch(); filaB.add(this.bLimpiar);
   pPrompt.sizer = new VerticalSizer;
   pPrompt.sizer.margin = 6; pPrompt.sizer.spacing = 6;
   pPrompt.sizer.add(this.historialBox, 100);
   pPrompt.sizer.add(this.entrada);
   pPrompt.sizer.add(filaB);
   pPrompt.sizer.add(this.estadoLbl);

   // --- Pestaña Modelo ---
   var pModelo = new Control(this);
   var PROV = [["ollama", "Ollama (local, HTTP)"], ["claude", "Claude Code (CLI)"], ["codex", "Codex (CLI)"]];
   this.cProv = new ComboBox(pModelo);
   PROV.forEach(function (p) { self.cProv.addItem(p[1]); });
   this.cProv.currentItem = Math.max(0, PROV.map(function (p) { return p[0]; }).indexOf(aj.proveedor));
   this.cModelo = new ComboBox(pModelo);
   this.cModelo.editEnabled = true;
   this.cModelo.setScaledMinWidth(280);
   this.cModelo.onEditTextUpdated = function () { aj.ponerModelo(self.cModelo.editText.trim()); };
   this.cModelo.onItemSelected = function (i) { aj.ponerModelo(self.cModelo.itemText(i)); };
   this.bTags = new PushButton(pModelo);
   this.bTags.text = "Leer modelos de Ollama";
   this.bTags.onClick = function () { self.rellenarModelos(true); };
   this.cPensar = new CheckBox(pModelo);
   this.cPensar.text = "Dejar pensar al modelo (think de Ollama; más lento)";
   this.cPensar.checked = aj.pensar;
   this.cPensar.onCheck = function (c) { aj.pensar = c; };
   this.notaModelo = new Label(pModelo);
   this.notaModelo.wordWrapping = true;
   this.cProv.onItemSelected = function (i) { aj.proveedor = PROV[i][0]; self.rellenarModelos(false); };

   var fP = new HorizontalSizer; fP.spacing = 6;
   var l1 = new Label(pModelo); l1.text = "Proveedor:"; l1.setScaledMinWidth(90); l1.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   fP.add(l1); fP.add(this.cProv); fP.addStretch();
   var fM = new HorizontalSizer; fM.spacing = 6;
   var l2 = new Label(pModelo); l2.text = "Modelo:"; l2.setScaledMinWidth(90); l2.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   fM.add(l2); fM.add(this.cModelo); fM.add(this.bTags); fM.addStretch();
   pModelo.sizer = new VerticalSizer;
   pModelo.sizer.margin = 8; pModelo.sizer.spacing = 8;
   pModelo.sizer.add(fP); pModelo.sizer.add(fM); pModelo.sizer.add(this.cPensar); pModelo.sizer.add(this.notaModelo);
   pModelo.sizer.addStretch();

   // --- Pestaña Ajustes ---
   var pAj = new Control(this);
   function fila(etiqueta, valor, tip) {
      var e = new Edit(pAj); e.text = String(valor); e.toolTip = tip || "";
      var l = new Label(pAj); l.text = etiqueta; l.setScaledMinWidth(150); l.textAlignment = TextAlign_Right | TextAlign_VertCenter;
      var s = new HorizontalSizer; s.spacing = 6; s.add(l); s.add(e, 100);
      pAj.sizer.add(s);
      return e;
   }
   pAj.sizer = new VerticalSizer;
   pAj.sizer.margin = 8; pAj.sizer.spacing = 6;
   this.eUrl = fila("URL de Ollama:", aj.ollamaUrl);
   this.eTemp = fila("Temperatura:", String(aj.temperatura).replace(".", ","), "0 = determinista. Sólo para Ollama.");
   this.eClaude = fila("Ejecutable claude:", aj.rutaClaude);
   this.eCodex = fila("Ejecutable codex:", aj.rutaCodex);
   this.eGuia = fila("Carpeta de la guía:", aj.guia, "Carpeta guia/ del repositorio (con herramientas/ y manifiesto.json).");
   this.bGuardar = new PushButton(pAj);
   this.bGuardar.text = "Guardar ajustes";
   this.bGuardar.onClick = function () { self.leerAjustes(); aj.guardar(); self.estadoLbl.text = "Ajustes guardados."; };
   var fG = new HorizontalSizer; fG.addStretch(); fG.add(this.bGuardar);
   pAj.sizer.add(fG);
   pAj.sizer.addStretch();

   this.tabs = new TabBox(this);
   this.tabs.addPage(pPrompt, "Prompt");
   this.tabs.addPage(pModelo, "Modelo");
   this.tabs.addPage(pAj, "Ajustes");

   this.bCerrar = new PushButton(this);
   this.bCerrar.text = "Cerrar";
   this.bCerrar.onClick = function () { if (self.estado) self.estado.cancelado = true; self.ok(); };
   var fC = new HorizontalSizer; fC.addStretch(); fC.add(this.bCerrar);
   this.sizer = new VerticalSizer;
   this.sizer.margin = 8; this.sizer.spacing = 8;
   this.sizer.add(this.tabs, 100);
   this.sizer.add(fC);
   this.onHide = function () { self.leerAjustes(); aj.guardar(); };
   this.adjustToContents();

   // --- Lógica ---
   this.leerAjustes = function () {
      aj.ollamaUrl = this.eUrl.text.trim() || PL_URL_OLLAMA;
      var t = parseFloat(this.eTemp.text.replace(",", "."));
      if (isFinite(t)) aj.temperatura = Math.max(0, Math.min(2, t));
      aj.rutaClaude = this.eClaude.text.trim() || "claude";
      aj.rutaCodex = this.eCodex.text.trim() || "codex";
      var g = this.eGuia.text.trim().replace(/\\/g, "/").replace(/[\/]+$/, "");
      if (g) aj.guia = g;
      var m = this.cModelo.editText.trim();
      if (m || aj.proveedor != "ollama") aj.ponerModelo(m);
   };

   this.rellenarModelos = function (avisar) {
      var actual = aj.modelo(), lista = [];
      this.cModelo.clear();
      this.bTags.enabled = aj.proveedor == "ollama";
      this.cPensar.enabled = aj.proveedor == "ollama";
      if (aj.proveedor == "ollama") {
         this.leerAjustes(); aj.ponerModelo(actual);
         try { lista = plOllamaModelos(aj); this.notaModelo.text = lista.length + " modelos en Ollama."; }
         catch (e) { this.notaModelo.text = String(e.message || e); if (avisar) this.estadoLbl.text = this.notaModelo.text; }
      } else if (aj.proveedor == "claude") {
         lista = ["", "sonnet", "opus", "haiku"];
         this.notaModelo.text = "Vacío = el modelo por defecto de Claude Code. Se lanza «claude -p» sin herramientas ni MCP.";
      } else {
         lista = [""];
         this.notaModelo.text = "Vacío = el modelo por defecto de Codex. Se lanza «codex exec» en modo solo lectura.";
      }
      if (lista.indexOf(actual) < 0) lista.unshift(actual);
      lista.forEach(function (m) { self.cModelo.addItem(m); });
      this.cModelo.currentItem = lista.indexOf(actual);
      this.cModelo.editText = actual;
   };

   this.anotar = function (quien, texto) {
      this.registro += "── " + quien + " ──\n" + texto + "\n\n";
      this.historialBox.text = this.registro;
      try { this.historialBox.caretPosition = this.registro.length; } catch (e) {}
      plEventos();
   };

   this.ponerPendiente = function (s) {
      this.pendiente = s;
      this.bEjecutar.enabled = !!s && !this.estado;
      this.bVer.enabled = !!s;
   };

   this.ocupado = function (si) {
      this.bEnviar.enabled = !si; this.bCancelar.enabled = si; this.bCorregir.enabled = false;
      this.bEjecutar.enabled = !si && !!this.pendiente; this.cProv.enabled = !si;
   };

   this.consultar = function () {
      this.leerAjustes();
      this.estado = { cancelado: false };
      this.ocupado(true);
      var nombre = { ollama: "Ollama", claude: "Claude", codex: "Codex" }[aj.proveedor] + (aj.modelo() ? " · " + aj.modelo() : "");
      this.estadoLbl.text = "Esperando a " + nombre + "…";
      var t0 = Date.now(), resp = null;
      try {
         resp = plPreguntar(aj, this.mensajes, this.estado);
      } catch (e) {
         this.anotar("Error", String(e.message || e));
      }
      var cancelado = this.estado.cancelado;
      this.estado = null;
      this.ocupado(false);
      this.estadoLbl.text = resp !== null ? "Respuesta en " + ((Date.now() - t0) / 1000).toFixed(1) + " s." : (cancelado ? "Cancelado." : "");
      if (resp === null) { this.mensajes.pop(); return; }   // la pregunta no obtuvo respuesta: no queda en el historial
      this.mensajes.push({ role: "assistant", content: resp });
      this.anotar("PiCopilot (" + nombre + ")", resp);
      var s = plExtraerScript(resp);
      this.ponerPendiente(s);
      if (s && this.cAuto.checked) this.ejecutarPendiente();
   };

   this.enviar = function () {
      if (this.estado) return;
      var t = this.entrada.text.trim();
      if (!t) return;
      this.entrada.text = "";
      this.correcciones = 0;
      this.ultimoError = null;
      this.mensajes.push({ role: "user", content: t });
      this.anotar("Tú", t);
      this.consultar();
   };

   this.ejecutarPendiente = function () {
      if (!this.pendiente || this.estado) return;
      var s = this.pendiente;
      this.ponerPendiente(null);
      this.estadoLbl.text = "Ejecutando script…";
      plEventos();
      var r = plEjecutarScript(aj, s);
      this.anotar(r.ok ? "Resultado (" + r.segundos.toFixed(1) + " s)" : "Error al ejecutar", r.texto);
      // El resultado entra en la conversación para que el modelo lo tenga en cuenta en el siguiente turno.
      this.mensajes.push({ role: "user", content: (r.ok ? "Resultado de ejecutar tu script:\n" : "Tu script ha fallado:\n") + r.texto });
      this.mensajes.push({ role: "assistant", content: r.ok ? "Visto." : "Entendido, lo reviso si me lo pides." });
      if (r.ok) {
         this.correcciones = 0; this.ultimoError = null; this.estadoLbl.text = "Script ejecutado.";
      } else {
         this.ultimoError = r.texto;
         var quedan = this.correcciones < PL_MAX_CORRECCIONES;
         this.bCorregir.enabled = quedan;
         this.estadoLbl.text = quedan ? "El script ha fallado. Puedes pedir una corrección al modelo." :
                               "El script ha fallado " + PL_MAX_CORRECCIONES + " veces seguidas; revisa la petición.";
         if (quedan && this.cAuto.checked) this.pedirCorreccion();
      }
   };

   this.pedirCorreccion = function () {
      if (!this.ultimoError || this.estado || this.correcciones >= PL_MAX_CORRECCIONES) return;
      ++this.correcciones;
      this.mensajes.pop(); this.mensajes.pop();   // sustituye el par «ha fallado / entendido» por la petición de corrección
      var t = "El script ha fallado con este error:\n" + this.ultimoError +
              "\nCorrígelo y devuelve el script completo en un único bloque ```javascript.";
      this.mensajes.push({ role: "user", content: t });
      this.anotar("Corrección " + this.correcciones + "/" + PL_MAX_CORRECCIONES, "Reenviando el error al modelo…");
      this.consultar();
   };

   this.rellenarModelos(false);
   this.anotar("PiCopilot Lite", "Hola. Pregúntame por tus imágenes o pídeme un paso de procesado. Cuando proponga un " +
               "script, pulsa «Ejecutar script» (o marca «Ejecutar sin preguntar»).\nGuía: " + aj.guia);
}

// ---------------------------------------------------------------------------------------------------------------
// Pruebas sin diálogo:  PixInsight.exe -x=<ruta>/PiCopilotLite.js,--prueba[,<salida.json>]
// ---------------------------------------------------------------------------------------------------------------

function plPrueba(salida, cli) {
   var r = { version: PL_VERSION, inicio: new Date().toISOString(), pasos: {} };
   function paso(nombre, f) {
      var t0 = Date.now();
      r.enCurso = nombre;
      File.writeTextFile(salida, JSON.stringify(r, null, 1));   // si algo se cuelga, se sabe en qué paso
      try { r.pasos[nombre] = { ok: true, resultado: f() }; }
      catch (e) { r.pasos[nombre] = { ok: false, error: String(e && e.message ? e.message : e) }; }
      r.pasos[nombre].ms = Date.now() - t0;
      console.writeln("[PiCopilotLite prueba] " + nombre + ": " + JSON.stringify(r.pasos[nombre]).substring(0, 400));
   }
   var aj = new PLAjustes();
   aj.cargar();
   paso("ajustes", function () {
      var antes = aj.temperatura;
      aj.temperatura = 0.35; aj.guardar();
      var b = new PLAjustes(); b.cargar();
      aj.temperatura = antes; aj.guardar();
      if (b.temperatura !== 0.35) throw new Error("se leyó " + b.temperatura);
      return { guia: aj.guia, proveedor: aj.proveedor, modelo: aj.modelo(), claude: aj.rutaClaude, codex: aj.rutaCodex };
   });
   paso("dialogo", function () {
      // Abre el diálogo y simula al usuario: guardar ajustes, preguntar con «Ejecutar sin preguntar» y cerrar.
      var d = new PLDialogo(aj), tm = new Timer, out = {};
      tm.interval = 1.5; tm.periodic = false;
      tm.onTimeout = function () {
         try {
            d.bGuardar.onClick();
            out.estado = d.estadoLbl.text;
            d.cAuto.checked = true;
            d.entrada.text = "¿Qué imágenes tengo abiertas? Usa vistas().";
            d.enviar();
            out.registro = d.registro;
         } catch (e) { out.error = String(e); }
         d.ok();
      };
      tm.start();
      d.execute();
      d.cAuto.checked = false; aj.ejecutarSinPreguntar = false; aj.guardar();
      return out;
   });
   paso("guia", function () {
      var avisos = plCargarGuia(aj.guia), g = plGlobal();
      return { avisos: avisos, funciones: ["vistas", "estadisticas", "analizarMaster", "gradienteCandidatos", "estirarStarless", "reducirRuido"]
               .map(function (n) { return n + ":" + typeof g[n]; }) };
   });
   paso("prompt", function () { var s = plPromptSistema(aj); return { caracteres: s.length, inicioVentanas: s.substring(s.indexOf("Ventanas abiertas")) }; });
   paso("ollamaModelos", function () { return plOllamaModelos(aj); });
   var respuesta = null;
   paso("ollamaChat", function () {
      var a = new PLAjustes(); a.cargar(); a.proveedor = "ollama";
      respuesta = plPreguntar(a, [{ role: "user", content: "Lista las ventanas abiertas en PixInsight con la función vistas()." }], { cancelado: false });
      return { respuesta: plRecortar(respuesta, 1500), script: plExtraerScript(respuesta) };
   });
   paso("ejecutarTrivial", function () {
      return plEjecutarScript(aj, "var r = vistas();\nchat('Ventanas: ' + r.total);\nr.vistas.map(function (v) { return v.id; });");
   });
   paso("ejecutarScriptDelModelo", function () {
      var s = respuesta && plExtraerScript(respuesta);
      if (!s) return "la respuesta no traía script";
      return plEjecutarScript(aj, s);
   });
   paso("ejecutarError", function () { return plEjecutarScript(aj, "noExiste(1);"); });
   if (cli) paso("cliChat_" + cli, function () {
      var a = new PLAjustes(); a.cargar(); a.proveedor = cli;
      var t = plPreguntar(a, [{ role: "user", content: "Lista las ventanas abiertas en PixInsight con la función vistas()." }], { cancelado: false });
      return { respuesta: plRecortar(t, 1500), script: plExtraerScript(t) };
   });
   delete r.enCurso;
   r.fin = new Date().toISOString();
   File.writeTextFile(salida, JSON.stringify(r, null, 1));
   console.noteln("[PiCopilotLite prueba] resultados en " + salida);
}

function plMain() {
   var args = (typeof jsArguments !== "undefined") ? jsArguments : [];
   if (args.length && String(args[0]) == "--prueba") {
      plPrueba(args.length > 1 && String(args[1]) ? String(args[1]) : plCarpeta(PL_TMP) + "/prueba.json",
               args.length > 2 ? String(args[2]) : null);   // tercer argumento opcional: claude | codex
      return;
   }
   var aj = new PLAjustes();
   aj.cargar();
   var d = new PLDialogo(aj);
   d.execute();
   aj.guardar();
}

try {
   plMain();
} catch (e) {
   var plMsg = "[PiCopilotLite] error: " + (e && e.message ? e.message : e) + (e && e.lineNumber ? " (línea " + e.lineNumber + ")" : "") +
               (e && e.stack ? "\n" + e.stack : "");
   console.criticalln(plMsg);
   try { File.writeTextFile(plCarpeta(PL_TMP) + "/error.txt", plMsg); } catch (x) {}
}
