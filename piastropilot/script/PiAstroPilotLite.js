// PiAstroPilotLite.js — Versión mínima de PiAstroPilot como script PJSR (sin módulo ni DLL: no necesita firma).
// Copyright (c) 2026 Rafael Vidal. Licencia MIT.
//
// Chat con un modelo (Ollama local por HTTP, o Claude Code / Codex por línea de órdenes) que, cuando quiere
// actuar, devuelve un bloque ```json con llamadas a funciones de la guía (nombre y parámetros, sin código).
// El script valida cada llamada contra guia/herramientas/manifiesto.json y la ejecuta con la lista blanca del
// runner (LISTA). El modelo nunca escribe código de PixInsight y aquí no se ejecuta nada que haya escrito él.
//
// Lanzar: Script > Execute Script File... > PiAstroPilotLite.js
// Pruebas automáticas (para desarrollo):  PixInsight.exe -x=<ruta>/PiAstroPilotLite.js,--prueba[,<salida.json>[,claude|codex]]
//
// No usa MCP ni «PixInsight.exe -x=»: mientras el script corre, PixInsight está ocupado y esas peticiones
// se quedarían esperando.

#feature-id    PiAstroPilot > PiAstroPilotLite
#feature-info  Asistente de IA mínimo para PixInsight (Ollama / Claude CLI / Codex CLI) que ejecuta las funciones de la guía.

#engine v8

#include <pjsr/DataType.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/StdIcon.jsh>
// Sin <pjsr/Sizer.jsh>: con #engine v8 HorizontalSizer/VerticalSizer ya existen y ese include no compila.
#include <pjsr/FrameStyle.jsh>
#include <pjsr/TextAlign.jsh>

// Motor de BlindSolver en modo librería (como piastropilot-runner.js): lo usan blindSolve, resolverAstrometria,
// bxtCorrectOnly y alinearMasters. Las clases quedan globales y las funciones de la guía las ven.
#define VERSION "1.0.0"
#define TITLE "BlindSolver"
#define SETTINGS_MODULE "BlindSolver"
#include <pjsr/astrometry/AstrometricMetadata.js>
#include <pjsr/astrometry/UtilityControls.js>
#include <pjsr/utility/ScriptErrors.js>
// Relativo a la carpeta include de PixInsight: vale en Windows, macOS y Linux y en cualquier carpeta de instalación.
#include <../src/scripts/BlindSolver/BlindSolverEngine.js>

var PL_VERSION = "0.1.0";
var PL_CLAVE = "PiAstroPilotLite";
var PL_RUTA_SCRIPT = File.extractDrive(#__FILE__) + File.extractDirectory(#__FILE__);   // .../piastropilot/script
var PL_TMP = File.systemTempDirectory + "/PiAstroPilotLite";
var PL_MAX_CORRECCIONES = 3;
var PL_ESPERA_WBPP_MIN = 180;   // espera máxima de estadoWBPP a que termine WBPP
var PL_MAX_SERIE = 60;   // tope de pasos seguidos en una serie («hasta el final»)
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

function plEsMac() { return /mac|darwin|osx/i.test(String(CoreApplication.platform)); }

function plCarpeta(d) { if (!File.directoryExists(d)) File.createDirectory(d, true); return d; }

function plRecortar(s, n) { s = String(s); return s.length > n ? s.substring(0, n) + " …[recortado]" : s; }

function plEventos() { CoreApplication.processEvents(); }

function plDormir(ms) {
   if (typeof System !== "undefined" && typeof System.msleep === "function") System.msleep(ms);
   else if (typeof msleep === "function") msleep(ms); else Thread.msleep(ms);
}

function plGlobal() { return (0, eval)("this"); }

// Texto JSON sólo con ASCII (NetworkTransfer.post recibe un String y así no dependemos de cómo lo codifica).
function plJsonAscii(o) {
   return JSON.stringify(o).replace(/[\u0080-\uffff]/g, function (c) {
      return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
   });
}

// ---------------------------------------------------------------------------------------------------------------
// Idioma de la ventana (Rafael, 9 nov 2026): español o inglés, como el módulo. El código escribe los textos en español
// y plT() los traduce si el idioma es inglés: primero la frase entera y, si no está, los trozos de PL_TR_TROZOS
// (para los textos que se montan con variables). Lo que no esté traducido sale en español.
// ---------------------------------------------------------------------------------------------------------------

var PL_EN = false;

var PL_TR = {
   "Escribe tu pregunta o petición y pulsa Enviar.": "Type your question or request and press Send.",
   "Enviar": "Send",
   "Cancelar": "Cancel",
   ["Permitir búsquedas externas. Claude: WebSearch y WebFetch. Todos los modelos: SIMBAD, Wikipedia, páginas web " +
   "e imágenes de catálogo (web.js). Sin marcar, nada sale a internet."]:
      "Allow external lookups. Claude: WebSearch and WebFetch. All models: SIMBAD, Wikipedia, web pages and catalog " +
      "images (web.js). Unchecked, nothing goes out to the internet.",
   "Nueva conversación": "New conversation",
   "Limpiar": "Clear",
   "Vacía la ventana y borra las miniaturas temporales. El modelo conserva el contexto de la conversación.":
      "Empties the window and deletes the temporary thumbnails. The model keeps the conversation context.",
   "Tokens de la conversación: entrada → salida (y coste con Claude). Se reinicia con «Nueva conversación».":
      "Conversation tokens: input → output (and cost with Claude). Reset with «New conversation».",
   "Leer en voz alta": "Read aloud",
   "Lee cada respuesta del modelo con la voz de Windows (sin los bloques de llamadas).":
      "Reads each model reply with the Windows voice (without the call blocks).",
   "Leer": "Read",
   "Lee en voz alta la última respuesta del modelo.": "Reads the last model reply aloud.",
   "Parar voz": "Stop voice",
   "Velocidad de la voz (-10 lenta, 0 normal, 10 rápida).": "Voice speed (-10 slow, 0 normal, 10 fast).",
   "Dictar": "Dictate",
   ["Abre el dictado de Windows (Win + H) con el cursor en el prompt: lo que dices se escribe ahí. " +
   "Necesita internet (lo procesa Microsoft). Para cerrarlo, Win + H o Esc."]:
      "Opens Windows dictation (Win + H) with the cursor in the prompt: what you say is typed there. " +
      "Needs internet (Microsoft processes it). To close it, Win + H or Esc.",
   "Velocidad:": "Speed:",
   "Dossier PDF": "PDF dossier",
   "Guarda la conversación (respuestas, fichas de resultados y miniaturas) como PDF en la carpeta de dossieres (Ajustes).":
      "Saves the conversation (replies, result cards and thumbnails) as a PDF in the dossier folder (Settings).",
   "Informe .md": ".md report",
   ["Guarda un informe Markdown con las funciones usadas, los errores con sus llamadas y la conversación, para " +
   "recopilar procesados y mejorar la guía."]:
      "Saves a Markdown report with the functions used, the errors with their calls and the conversation, to " +
      "collect processing sessions and improve the guide.",
   "Leer modelos de Ollama": "Read Ollama models",
   "Dejar pensar al modelo (think de Ollama; más lento)": "Let the model think (Ollama think; slower)",
   "Proveedor:": "Provider:",
   "Modelo:": "Model:",
   "Umbral N: si la puntuación del paso es mayor que N se usa el modelo inferior; si es igual o menor, el superior. Por defecto 95.":
      "Threshold N: if the step score is greater than N the lower model is used; if equal or lower, the upper one. Default 95.",
   "Modelo inferior:": "Lower model:",
   "Modelo superior:": "Upper model:",
   "Ajuste tuyo de la puntuación del paso seleccionado (se suma al valor base). Se guarda en los ajustes de PixInsight, no en el json.":
      "Your adjustment of the selected step score (added to the base value). Saved in PixInsight settings, not in the json.",
   "Valores por defecto": "Defaults",
   "N = 95, sin ajustes, sonnet / opus (Codex: su modelo por defecto).": "N = 95, no adjustments, sonnet / opus (Codex: its default model).",
   "Ajuste del paso seleccionado:": "Adjustment of the selected step:",
   "URL de Ollama:": "Ollama URL:",
   "Temperatura:": "Temperature:",
   "0 = determinista. Sólo para Ollama.": "0 = deterministic. Ollama only.",
   "Ejecutable claude:": "claude executable:",
   "Ejecutable codex:": "codex executable:",
   "Carpeta de la guía:": "Guide folder:",
   "Carpeta guia/ del repositorio (con herramientas/ y manifiesto.json).": "The repository's guia/ folder (with herramientas/ and manifiesto.json).",
   "Carpeta de dossieres:": "Dossier folder:",
   "Donde se guardan el dossier PDF y el informe .md de la conversación.": "Where the PDF dossier and the .md report of the conversation are saved.",
   "Idioma:": "Language:",
   "Idioma de la ventana y de las respuestas del modelo.": "Language of the window and of the model replies.",
   "Guardar ajustes": "Save settings",
   "Cerrar": "Close",
   "Prompt": "Prompt", "Modelo": "Model", "Ajustes": "Settings",
   "Paso": "Step", "Base": "Base", "Ajuste": "Adjustment", "Puntuación": "Score",
   "Tú": "You",
  
   "(ninguno)": "(none)",
   "Ajustes guardados.": "Settings saved.",
   "Idioma cambiado.": "Language changed.",
   "No hay conversación que guardar.": "There is no conversation to save.",
   "Generando el dossier en PDF…": "Generating the PDF dossier…",
   "Dictado cancelado.": "Dictation cancelled.",
   "Escuchando… (parar)": "Listening… (stop)",
   "Habla ahora: el dictado termina cuando dejas de hablar unos segundos.": "Speak now: dictation ends when you stop talking for a few seconds.",
   "No he oído nada (¿micrófono?).": "I heard nothing (microphone?).",
   "Dictado añadido al prompt: revísalo y pulsa Enviar.": "Dictation added to the prompt: check it and press Send.",
   "Dictado de Windows abierto: haz clic en el prompt si el cursor no está ahí y habla. Para cerrarlo, Win + H o Esc.":
      "Windows dictation open: click in the prompt if the cursor is not there and speak. To close it, Win + H or Esc.",
   "Ejecutando llamadas…": "Running calls…",
   "Llamadas ejecutadas.": "Calls run.",
   "Cumple": "Pass", "No cumple": "Fail", "Resultado de las llamadas": "Calls result",
   "Cancelado.": "Cancelled.",
   "Llamadas repetidas. Pido otra corrección.": "Repeated calls. Asking for another fix.",
   "Llamadas repetidas; revisa la petición.": "Repeated calls; check the request.",
   "Las llamadas han fallado. Pido la corrección al modelo.": "The calls failed. Asking the model for a fix.",
   "Dictado de macOS: haz clic en el prompt y pulsa dos veces la tecla Fn (o 🌐); habla y pulsa Enviar.":
      "macOS dictation: click in the prompt and press the Fn key (or 🌐) twice; speak and press Send.",
   "Dictado: no hay dictado del sistema en Linux; escribe el prompt.": "Dictation: there is no system dictation on Linux; type the prompt.",
};

// Trozos de textos montados con variables (de más largo a más corto al aplicarlos).
var PL_TR_TROZOS = [
   ["Informe guardado: ", "Report saved: "], ["No se pudo guardar el informe: ", "Could not save the report: "],
   ["Dossier guardado: ", "Dossier saved: "], [" (y la página en .html)", " (and the page as .html)"],
   ["No se pudo crear el PDF (", "Could not create the PDF ("], ["); queda la página en ", "); the page is left at "],
   ["No se pudo lanzar la voz: ", "Could not start the voice: "], ["No se pudo abrir el dictado de Windows: ", "Could not open Windows dictation: "],
   ["No se pudo lanzar el dictado: ", "Could not start dictation: "], ["Dictado: ", "Dictation: "],
   ["Esperando a ", "Waiting for "], ["Respuesta en ", "Reply in "],
   ["Las llamadas han fallado ", "The calls failed "], [" veces seguidas; revisa la petición.", " times in a row; check the request."], ["Haz ahora este paso: ", "Do this step now: "],
   ["Conversación: ", "Conversation: "], [" respuestas", " replies"], [" respuesta", " reply"], [" en ", " in "],
   ["  (los pesos N no se aplican)", "  (N weights do not apply)"], ["(por defecto de la CLI)", "(CLI default)"],
   ["Prompt libre: modelo superior", "Free prompt: upper model"], ["paso sin valor en la tabla: modelo superior", "step with no value in the table: upper model"],
   ["elegido a mano", "chosen by hand"], ["modelo por defecto de la CLI", "CLI default model"],
   [" modelos en Ollama.", " models in Ollama."],
   [" = elige inferior o superior según el paso (tabla de abajo). ", " = picks lower or upper depending on the step (table below). "],
   [" = elige inferior o superior según el paso. ", " = picks lower or upper depending on the step. "],
   ["Vacío = el modelo por defecto de Claude Code. Se lanza «claude -p» sin herramientas ni MCP.", "Empty = Claude Code's default model. Runs «claude -p» without tools or MCP."],
   ["Vacío = el modelo por defecto de Codex. Se lanza «codex exec» en modo solo lectura.", "Empty = Codex's default model. Runs «codex exec» in read-only mode."],
   [". Como en el módulo, el Prompt libre usa el modelo superior; la tabla decide en los pasos.", ". As in the module, the free Prompt uses the upper model; the table decides in the steps."],
   ["  (Ahora el modelo está fijado a mano: la tabla no se aplica.)", "  (The model is now set by hand: the table does not apply.)"],
   ["superior (sin valor)", "upper (no value)"], ["por defecto", "default"], ["inferior", "lower"], ["superior", "upper"],
   ["Modelo: ", "Model: "], ["Pesos N (Claude / Codex en «", "N weights (Claude / Codex in «"]
];
PL_TR_TROZOS.sort(function (a, b) { return b[0].length - a[0].length; });

function plT(s) {
   if (!PL_EN || s === null || s === undefined) return s;
   s = String(s);
   if (Object.prototype.hasOwnProperty.call(PL_TR, s)) return PL_TR[s];
   PL_TR_TROZOS.forEach(function (t) { if (s.indexOf(t[0]) >= 0) s = s.split(t[0]).join(t[1]); });
   return s;
}

// Clases de controles de la ventana: plConstruirDialogo las tapa con versiones que apuntan cada control creado, para
// poder traducir sus textos al cambiar de idioma.
var PL_CLASES = { Label: Label, PushButton: PushButton, CheckBox: CheckBox, GroupBox: GroupBox, Edit: Edit,
                  TextBox: TextBox, SpinBox: SpinBox, ComboBox: ComboBox };

// ---------------------------------------------------------------------------------------------------------------
// Ajustes (Settings de PixInsight, claves "PiAstroPilotLite/...")
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
   // 64k con OLLAMA_KV_CACHE_TYPE=q8_0: medido el 13 nov 2026 en la RX 7900 XTX, cabe en VRAM
   // (16,6 GB frente a 16,3 GB) y genera casi igual de rápido; con 32k los prompts largos se recortaban.
   this.modeloOllama = "qwen38-64k";
   this.modeloClaude = PL_AUTO;           // auto = pesos N; vacío = el que tenga configurado la CLI
   this.modeloCodex = PL_AUTO;
   // Pesos N (como «Configurar IA» del módulo): puntuación > N → modelo inferior; <= N → superior.
   this.umbralN = 95;
   this.claudeInferior = "sonnet";
   this.claudeSuperior = "opus";
   this.codexInferior = "";               // Codex: vacío = su modelo por defecto (igual que el módulo)
   this.codexSuperior = "";
   this.ajustesPesos = "";                // "paso=delta;..." (mismo formato que AIAdjustments del módulo)
   this.ollamaUrl = PL_URL_OLLAMA;
   this.temperatura = 0.2;
   this.pensar = false;                   // "think" de Ollama (los qwen3 tardan mucho más pensando)
   this.rutaClaude = plRutaClaudePorDefecto();
   this.rutaCodex = plRutaCodexPorDefecto();
   this.guia = plPadre(plPadre(PL_RUTA_SCRIPT)) + "/guia";
   this.internet = true;                  // Claude: WebSearch y WebFetch; todos: simbad/wikipedia/leerWeb/imagenCatalogo
   this.voz = false;                      // leer en voz alta cada respuesta del modelo
   this.vozVelocidad = 0;                 // -10 (lenta) … 10 (rápida)
   this.dictadoAntiguo = false;           // true = reconocedor antiguo de Windows (SAPI, sin internet); false = Win + H
   this.carpetaInformes = File.homeDirectory + "/PiAstroPilotLite/dossiers";   // dossieres PDF e informes .md
   this.idioma = "es";                    // es | en: textos de la ventana y de las respuestas del modelo

   var CAMPOS = { proveedor: DataType_UCString, modeloOllama: DataType_UCString, modeloClaude: DataType_UCString,
                  modeloCodex: DataType_UCString, ollamaUrl: DataType_UCString, temperatura: DataType_UCString,
                  pensar: DataType_Boolean, rutaClaude: DataType_UCString, rutaCodex: DataType_UCString,
                  guia: DataType_UCString, umbralN: DataType_Int32,
                  claudeInferior: DataType_UCString, claudeSuperior: DataType_UCString, codexInferior: DataType_UCString,
                  codexSuperior: DataType_UCString, ajustesPesos: DataType_UCString, internet: DataType_Boolean,
                  voz: DataType_Boolean, vozVelocidad: DataType_Int32, dictadoAntiguo: DataType_Boolean,
                  carpetaInformes: DataType_UCString, idioma: DataType_UCString };

   this.cargar = function () {
      for (var k in CAMPOS) {
         var v = Settings.read(PL_CLAVE + "/" + k, CAMPOS[k]);
         if (Settings.lastReadOK && v !== null && v !== undefined) {
            if (k == "temperatura") { var t = parseFloat(String(v).replace(",", ".")); if (isFinite(t)) this[k] = t; }
            else this[k] = v;
         }
      }
      if (this.modeloOllama == "qwen38-32k") this.modeloOllama = "qwen38-64k";   // ajuste guardado del antiguo valor por defecto
      PL_EN = this.idioma == "en";
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

   this.ajuste = function (paso) {
      var a = plLeerAjustesPesos(this.ajustesPesos);
      return a[paso] || 0;
   };

   this.ponerAjuste = function (paso, delta) {
      var a = plLeerAjustesPesos(this.ajustesPesos), s = "";
      a[paso] = delta;
      for (var k in a) if (a[k]) s += k + "=" + a[k] + ";";
      this.ajustesPesos = s;
   };
}

// ---------------------------------------------------------------------------------------------------------------
// Pesos N: elección entre modelo inferior (Sonnet) y superior (Opus), copiada del módulo (PiAstroPilotConfig::TierModel)
// ---------------------------------------------------------------------------------------------------------------

var PL_AUTO = "auto (pesos N)";

// Pasos de la guía, con las mismas etiquetas y claves que los botones del módulo.
var PL_PASOS = [
   ["Análisis del objeto", "lineal/01-analisis-del-objeto.md"], ["Inventario", "lineal/02-inventario.md"],
   ["Blink / SubframeSel.", "lineal/03-blink-subframeselector.md"], ["Preprocesado", "lineal/04-preprocesado.md"],
   ["StarAlignment + crop", "lineal/05-staralignment-crop.md"], ["HDRComposition", "lineal/06-hdr-composition.md"],
   ["Extracción de canales", "lineal/07-extraccion-canales.md"], ["Plate Solve", "lineal/08-plate-solve.md"],
   ["Corrección de Gradiente", "lineal/09-correccion-gradiente.md"], ["Combinación RGB / NB", "lineal/10-combinacion-rgb-nb.md"],
   ["BXT Correct Only", "lineal/11-bxt-correct-only.md"], ["SPCC", "lineal/12-spcc.md"],
   ["BXT completo", "lineal/13-bxt-completo.md"], ["NoiseX suave", "lineal/14-noisex-suave.md"],
   ["StarX + NXT starless", "lineal/15-starx.md"], ["LinearFit / continuo", "lineal/16-linearfit-continuo.md"],
   ["Checkpoint", "lineal/17-checkpoint.md"],
   ["Estirado", "no-lineal/01-estirado.md"], ["LRGB / Paleta", "no-lineal/02-lrgb-paleta.md"],
   ["SCNR", "no-lineal/03-scnr.md"], ["Máscaras", "no-lineal/04-mascaras.md"], ["Boost", "no-lineal/05-boost.md"],
   ["NoiseX", "no-lineal/06-noisex.md"], ["Nitidez", "no-lineal/07-nitidez.md"], ["Estrellas", "no-lineal/08-estrellas.md"],
   ["Recombinación", "no-lineal/09-recombinacion.md"], ["Recorte y exportación", "no-lineal/10-recorte-exportacion.md"],
   ["Dossier", "no-lineal/11-dossier.md"], ["Resolución completa", "completa"]
];

// Respaldo si no existe guia/porcentajes_skill.json (la misma tabla que PiAstroPilotConfig::BuiltinScore).
var PL_PESOS_INTERNOS = {
   "lineal/01-analisis-del-objeto.md": 86, "lineal/02-inventario.md": 97, "lineal/03-blink-subframeselector.md": 92,
   "lineal/04-preprocesado.md": 84, "lineal/05-staralignment-crop.md": 84, "lineal/06-hdr-composition.md": 100,
   "lineal/07-extraccion-canales.md": 100, "lineal/08-plate-solve.md": 100, "lineal/09-correccion-gradiente.md": 87,
   "lineal/10-combinacion-rgb-nb.md": 95, "lineal/11-bxt-correct-only.md": 95, "lineal/12-spcc.md": 95,
   "lineal/13-bxt-completo.md": 95, "lineal/14-noisex-suave.md": 95, "lineal/15-starx.md": 95,
   "lineal/16-linearfit-continuo.md": 95, "lineal/17-checkpoint.md": 95, "no-lineal/01-estirado.md": 95,
   "no-lineal/02-lrgb-paleta.md": 95, "no-lineal/03-scnr.md": 89, "no-lineal/04-mascaras.md": 89,
   "no-lineal/05-boost.md": 89, "no-lineal/06-noisex.md": 89, "no-lineal/07-nitidez.md": 89,
   "no-lineal/08-estrellas.md": 89, "no-lineal/09-recombinacion.md": 89, "no-lineal/10-recorte-exportacion.md": 89,
   "no-lineal/11-dossier.md": 80, "completa": 80
};

function plLeerAjustesPesos(s) {
   var a = {};
   String(s || "").split(";").forEach(function (it) {
      var i = it.lastIndexOf("=");
      if (i > 0) { var d = parseInt(it.substring(i + 1), 10); if (isFinite(d) && d) a[it.substring(0, i)] = d; }
   });
   return a;
}

// Tabla base: se lee de <guía>/porcentajes_skill.json en cada uso (como PiAstroPilotConfig::LoadScores): se quita el
// "(...)" de la clave, se añade ".md" a las que llevan carpeta y, si un paso sale varias veces, se toma el menor.
// Devuelve { tabla: {clave: valor}, fuente }.
function plPesosBase(guia) {
   var f = guia + "/porcentajes_skill.json";
   try {
      if (File.exists(f)) {
         var procs = JSON.parse(File.readTextFile(f)).procesos, t = {}, n = 0;
         for (var k in procs) {
            var v = procs[k] && procs[k].sonnet_vs_opus;
            if (typeof v !== "number") continue;
            var c = k, p = c.indexOf("(");
            if (p >= 0) c = c.substring(0, p);
            c = c.trim();
            if (c.indexOf("/") >= 0 && !/\.md$/.test(c)) c += ".md";
            v = Math.round(v);
            t[c] = t[c] === undefined ? v : Math.min(t[c], v);
            ++n;
         }
         if (n) return { tabla: t, fuente: f };
      }
   } catch (e) {}
   return { tabla: PL_PESOS_INTERNOS, fuente: "tabla interna (no se pudo leer " + f + ")" };
}

// Modelo que se pasa a la CLI y por qué. paso = clave del paso ("" = prompt libre).
function plElegirModelo(aj, paso) {
   if (aj.proveedor == "ollama") return { modelo: aj.modeloOllama, porque: "" };
   var elegido = aj.modelo();
   if (elegido != PL_AUTO) return { modelo: elegido, porque: elegido ? "elegido a mano" : "modelo por defecto de la CLI" };
   var bajo = aj.proveedor == "claude" ? aj.claudeInferior : aj.codexInferior;
   var alto = aj.proveedor == "claude" ? aj.claudeSuperior : aj.codexSuperior;
   if (!paso) return { modelo: alto, porque: "Prompt libre: modelo superior" };
   var base = plPesosBase(aj.guia).tabla[paso];
   if (base === undefined) return { modelo: alto, porque: "paso sin valor en la tabla: modelo superior" };
   var nota = base + aj.ajuste(paso), bajoGana = nota > aj.umbralN;
   return { modelo: bajoGana ? bajo : alto, porque: nota + (bajoGana ? " > " : " <= ") + aj.umbralN };
}

// ---------------------------------------------------------------------------------------------------------------
// Carga de la guía en este proceso: constantes de los .jsh, herramientas y funciones propias del runner MCP
// ---------------------------------------------------------------------------------------------------------------

var PL_ORDEN_GUIA = ["procesos", "gradcompare", "analisis", "alineado", "preproceso", "bandaestrecha", "boost", "color",
                     "combinacion", "deconvolucion", "realces", "estirado", "estrellas", "exportar", "graxpert",
                     "gradiente", "hdr", "lineal", "mascaras", "nucleo", "recombinacion", "ruido", "web"];
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

// En PixInsight 1.9.6 (v8) las constantes de los procesos están en el constructor (ScreenTransferFunction.SeparateChannels)
// y Clase.prototype.CONSTANTE da undefined (luego «Invalid argument type»). Los modelos escriben a menudo la forma antigua:
// se copian al prototipo para que las dos funcionen.
function plConstantesEnPrototipo() {
   var g = plGlobal(), n = 0;
   Object.getOwnPropertyNames(g).forEach(function (k) {
      if (!/^[A-Z]/.test(k)) return;
      var C;
      try { C = g[k]; if (typeof C !== "function" || !C.prototype) return; } catch (e) { return; }
      try {
         Object.getOwnPropertyNames(C).forEach(function (p) {
            try {
               if (/^[A-Z]/.test(p) && typeof C[p] === "number" && C.prototype[p] === undefined) { C.prototype[p] = C[p]; ++n; }
            } catch (e) {}
         });
      } catch (e) {}
   });
   return n;
}

// Sello de la guía: fechas del runner y de los ficheros de herramientas. Si cambia (un arreglo de la guía), se recarga sin
// cerrar el Lite (11 nov 2026: un arreglo de ruido.js no llegaba al Lite abierto).
function plSelloGuia(guia) {
   var s = [], fs = [plPadre(guia) + "/mcp/pjsr/piastropilot-runner.js"];
   for (var i = 0; i < PL_ORDEN_GUIA.length; ++i) fs.push(guia + "/herramientas/" + PL_ORDEN_GUIA[i] + ".js");
   for (var j = 0; j < fs.length; ++j) {
      try { s.push(File.exists(fs[j]) ? new FileInfo(fs[j]).lastModified.getTime() : 0); } catch (e) { s.push(0); }
   }
   return guia + "|" + s.join(",");
}

function plCargarGuia(guia) {
   var sello = plSelloGuia(guia);
   if (plGuiaCargada === sello) return [];
   var g = plGlobal(), avisos = [];
   plDefinirConstantesJsh();
   plConstantesEnPrototipo();
   // El runner se carga con eval y ahí no existen los #define: blindSolve usa este nombre como variable.
   // (Troceado para que el preprocesador no lo sustituya aquí.)
   g["SETTINGS" + "_MODULE"] = "BlindSolver";
   g.PIASTROPILOT_GUIA = guia;
   g.GUIA_HERRAMIENTAS = guia + "/herramientas";
   // Funciones propias del runner del MCP (vistas, estadisticas, previa, abrirImagen...): se reutilizan tal cual.
   var runner = plPadre(guia) + "/mcp/pjsr/piastropilot-runner.js";
   if (File.exists(runner)) {
      try {
         var src = plQuitarDirectivas(File.readTextFile(runner)).replace(/^\s*pprMain\(\);\s*$/m, "");
         (0, eval)(src);
      } catch (e) { avisos.push("runner: " + e); }
   } else avisos.push("No encuentro " + runner + " (sin vistas/estadisticas/previa...).");
   g.PIASTROPILOT_GUIA = guia;   // el runner pone su ruta por defecto
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
      // En la carpeta de miniaturas del chat (se borra con «Limpiar»), con el sufijo del recorte para no pisar la entera.
      g.previa = function (vista, o) {
         o = o || {};
         if (!o.fichero) {
            var cp = {}; for (var k in o) cp[k] = o[k];
            cp.fichero = plCarpetaPrevias() + "/" + vista + (o.rect ? "_" + [].concat(o.rect).join("_") : "") + "_" + Date.now() + ".jpg";
            o = cp;
         }
         return g.pprPrevia(vista, o);
      };
      g.abrirImagen = function (fichero) { return g.pprAbrir(fichero); };
      g.guardarImagen = function (vista, fichero, sobrescribir) { return g.pprGuardar(vista, fichero, sobrescribir === true); };
      g.cerrarVista = function (vista, descartar) { return g.pprCerrar(vista, descartar === true); };
   }
   plEnvolverFunciones(g, guia);
   plGuiaCargada = sello;
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
// Nivel «libre» (código arbitrario): no existe ninguna función así y, si apareciera, no se ofrece ni se ejecuta.
var PL_NIVEL_EXCLUIDO = "libre";

// Manifiesto de la guía (nombre, nivel, paso, parámetros), leído una vez por ruta.
var plManifiestoCache = { ruta: null, porNombre: null, lista: null };
function plManifiesto(guia) {
   var f = guia + "/herramientas/manifiesto.json";
   if (plManifiestoCache.ruta === f) return plManifiestoCache;
   var lista = [], porNombre = {};
   try {
      (JSON.parse(File.readTextFile(f)).funciones || []).forEach(function (x) {
         if (x.nivel === PL_NIVEL_EXCLUIDO) return;
         lista.push(x); porNombre[x.nombre] = x;
      });
   } catch (e) {}
   plManifiestoCache = { ruta: f, porNombre: porNombre, lista: lista };
   return plManifiestoCache;
}

// «nombre {vista*, opciones}»: parámetros del manifiesto; * = obligatorio.
function plFirmaLlamada(x) {
   var pr = (x.params && x.params.properties) || {}, req = (x.params && x.params.required) || [];
   var ps = Object.keys(pr).map(function (k) { return k + (req.indexOf(k) >= 0 ? "*" : ""); });
   return x.nombre + " {" + ps.join(", ") + "}";
}

// «Lineal: 1 Análisis del objeto, 2 Inventario, …; No lineal: 1 Estirado, …» a partir de PL_PASOS (mismo orden que el módulo).
function plOrdenPasos() {
   var lin = [], nol = [];
   PL_PASOS.forEach(function (p) {
      var m = /^(lineal|no-lineal)\/(\d+)-/.exec(p[1]);
      if (!m) return;
      (m[1] == "lineal" ? lin : nol).push(parseInt(m[2], 10) + " " + p[0]);
   });
   return "- Lineal: " + lin.join(", ") + ".\n- No lineal: " + nol.join(", ") + ".";
}

function plListaFunciones(guia) {
   var man = plManifiesto(guia), out = [];
   if (!man.lista.length) return "(no encuentro " + guia + "/herramientas/manifiesto.json)";
   man.lista.forEach(function (x) {
      var d = String(x.resumen || x.descripcion || "");
      var p = d.indexOf(". ");
      if (p > 0 && p < 220) d = d.substring(0, p + 1);
      var mp = /^(lineal|no-lineal)\/(\d+)-/.exec(String(x.paso || ""));
      var paso = mp ? " (Paso " + parseInt(mp[2], 10) + (mp[1] == "lineal" ? " lineal" : " no lineal") + ")" : "";
      out.push("- " + plFirmaLlamada(x) + " [" + x.nivel + "]" + paso + ": " + plRecortar(d, 220) + plDetalleObjetos(x, 220));
   });
   return out.join("\n");
}

// Lo que va DENTRO de los parámetros objeto (calibracion, wbpp, opciones…): sin esto el modelo sólo veía
// «revisarCalibracion {calibracion*}» y no sabía qué claves poner (13 nov 2026; por el MCP sí las ve).
function plDetalleObjetos(x, max) {
   var pr = (x.params && x.params.properties) || {}, s = "";
   for (var k in pr) if (pr[k] && pr[k].type == "object" && pr[k].description)
      s += " · " + k + " = " + (max ? plRecortar(pr[k].description, max) : pr[k].description);
   return s;
}

// Ayuda completa de los parámetros de una función, para los mensajes de error.
function plAyudaParametros(nombre, man) {
   var x = man && man.porNombre[nombre];
   if (!x) return "";
   var pr = (x.params && x.params.properties) || {}, req = (x.params && x.params.required) || [], l = [];
   for (var k in pr) l.push("  - " + k + (req.indexOf(k) >= 0 ? " (obligatorio)" : "") + (pr[k].type ? " [" + pr[k].type + "]" : "") +
                            (pr[k].description ? ": " + pr[k].description : ""));
   return l.length ? "\nParámetros de " + nombre + ":\n" + l.join("\n") : "";
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

// Ids exactos de las vistas abiertas, en una línea (barato: sin estadísticas). Se añade a cada petición y a los errores
// para que el modelo no invente ids.
function plResumenVistas() {
   var ws = ImageWindow.windows, act = ImageWindow.activeWindow, out = [];
   for (var i = 0; i < ws.length; ++i) {
      var id = ws[i].mainView.id, pv = [];
      try { pv = ws[i].previews.map(function (p) { return p.id; }); } catch (e) {}
      out.push("\"" + id + "\"" + (!act.isNull && act.mainView.id == id ? " (activa)" : "") +
               (pv.length ? " [previas: " + pv.join(", ") + "]" : ""));
   }
   return out.length ? out.join(", ") : "ninguna";
}

// Las funciones de la guía reciben el id de la vista como texto. Si el modelo pasa una ventana (ImageWindow) o una
// vista (View), se cambia por su id; si la ventana no existe (isNull) se avisa con las vistas que sí hay.
function plIdDe(x) {
   if (!x || typeof x !== "object") return x;
   var esVentana = false, esVista = false;
   try { esVentana = typeof x.isNull === "boolean" && x.mainView !== undefined; } catch (e) {}
   try { esVista = !esVentana && typeof x.id === "string" && x.image !== undefined; } catch (e) {}
   if (esVentana) {
      if (x.isNull) throw new Error("Has pasado una ventana que no existe (ImageWindow.windowById devuelve una ventana " +
                                    "con isNull == true cuando el id no existe). Vistas abiertas: " + plResumenVistas() + ".");
      return x.mainView.id;
   }
   return esVista ? x.id : x;
}

function plEnvolverFunciones(g, guia) {
   var nombres = Object.keys(PL_FIRMAS_RUNNER);
   plManifiesto(guia).lista.forEach(function (x) { nombres.push(x.nombre); });
   nombres.forEach(function (n) {
      var f = g[n];
      if (typeof f !== "function" || f.plOriginal) return;
      var e = function () { return f.apply(this, Array.prototype.slice.call(arguments).map(plIdDe)); };
      e.plOriginal = f;
      g[n] = e;
   });
}

function plPromptSistema(aj) {
   return "Eres PiAstroPilot Lite, un asistente experto en procesado de astrofotografía que trabaja dentro de PixInsight. " +
   (PL_EN ? "IDIOMA: el usuario tiene la ventana en inglés. Responde SIEMPRE en inglés (la guía y estas reglas están en " +
            "español: tradúcelo tú), de forma clara y concisa, y escribe la línea del paso siguiente como «Next step: ...» " +
            "en lugar de «Siguiente paso: ...». Los nombres de las funciones y de los campos de la guía no se traducen. " :
            "Respondes siempre en español, de forma clara y concisa. ") +
   "Eres fiel a los datos: no inventas parámetros ni " +
   "resultados; si algo no lo has medido o no está en la guía, lo dices.\n\n" +
   "Cómo actuar sobre PixInsight: NUNCA escribas código (ni PJSR, ni JavaScript, ni PixelMath suelto). Sólo puedes pedir " +
   "funciones de la lista «Funciones disponibles». Para pedirlas, devuelve UN único bloque ```json con este formato:\n" +
   "```json\n{\"llamadas\": [{\"funcion\": \"analizarMaster\", \"parametros\": {\"vista\": \"id_real\"}}]}\n```\n" +
   "- \"funcion\" es el nombre exacto de la lista; \"parametros\" usa sólo los nombres de parámetro de esa función " +
   "(los marcados con * son obligatorios). Las opciones van dentro de \"opciones\" como un objeto.\n" +
   "- Puedes pedir varias llamadas en el mismo bloque sólo si no dependen unas de otras (por ejemplo analizarMaster y " +
   "documentarObjeto sobre la misma vista). Si una necesita lo que devuelve otra, pide la primera, espera el resultado y " +
   "pide la siguiente en otra respuesta.\n" +
   "- Las llamadas se validan contra el manifiesto de la guía y se ejecutan tal cual; el resultado te llega en el mensaje siguiente.\n" +
   "- Si ninguna función sirve para lo que pide el usuario, dilo y propón qué hacer; no lo sustituyas por otra cosa.\n" +
   "- Si no hace falta actuar, responde sin bloque. Si no está claro sobre qué vista trabajar, pregunta antes de pedir llamadas.\n\n" +
   "Reglas de la guía (skill astro-procesado: núcleo común guia/SKILL.md, neutro para PixInsight y Siril, y su Anexo J " +
   "para PixInsight, guia/anexos/J-pixinsight.md):\n" +
   "- Fiel a los datos: toda estructura débil se confirma antes de realzarla y no aplicar un paso es un resultado válido.\n" +
   "- Si falla un paso esencial (gradiente, SPCC, BXT, estirado), para y avisa: nada de apaños (curvas en vez de SPCC, " +
   "PixelMath en vez de estirado, UnsharpMask en vez de BXT). El color sale de SPCC (calibrarColor), nunca de multiplicar canales.\n" +
   "- Orden lineal: gradiente → BXT correct only → SPCC → BXT completo → separación de estrellas → reducción de ruido principal " +
   "sobre la starless en lineal. Nunca reducir ruido antes de BXT.\n" +
   "- Trabaja siempre sobre copias: no modifiques las vistas originales (las funciones de nivel «copias» ya crean vistas nuevas).\n" +
   "- La guía describe las técnicas con nombres neutros; en PixInsight son: visualización automática = STF, estirado adaptativo " +
   "multiescala = MAS, contraste local por ecualización adaptativa = LHE, compresión multiescala HDR = HDRMT, modelo de fondo con " +
   "base de referencia = MGC, ajuste lineal = LinearFit, fórmula por píxel = PixelMath, preprocesado automático = WBPP.\n" +
   "- No supongas qué objeto es por el nombre del fichero ni nombres objetos concretos que no te haya dicho el usuario.\n" +
   "- Antes de estirar, pregunta al usuario el tipo de objeto (galaxia, nebulosa de emisión, cúmulo...) si no lo sabes.\n" +
   "- Mide antes y después (estadisticas) y no borres ni sobrescribas ficheros del usuario.\n" +
   "- Las medidas usan los nombres neutros de la guía: copia_objeto, objeto_quitado_pct y gradiente_restante (gradiente), " +
   "separacion (estirado), ruido_rel (ruido), contraste_ganado_pct (contraste). Los nombres antiguos que aún aparezcan " +
   "(gcStructCopy, come_objeto_pct, fondoResidual, senal_debil_en_ruidos) son lo mismo.\n\n" +
   "Vistas e ids (lo más importante):\n" +
   "- Usa sólo los ids de la lista «Vistas abiertas», escritos exactamente igual (mayúsculas y guiones bajos incluidos). " +
   "Nunca inventes ni completes un id. Los ejemplos de la guía usan ids genéricos (MasterLight y parecidos): sustitúyelos " +
   "siempre por un id real de la lista.\n" +
   "- Si el usuario nombra una vista, búscala en la lista; si habla de «la imagen en pantalla» o no dice cuál, usa la marcada " +
   "como (activa). Si no está en la lista o hay dudas, pregunta sin pedir llamadas.\n" +
   "- Si una llamada falla, cambia lo que causó el error (id, parámetro, valor): no repitas la misma llamada.\n" +
   "- Encadena las vistas: cada función devuelve el id de lo que ha creado (vista; separarEstrellas: starless y " +
   "estrellas; estirarCapas: starless.vista, y la capa de estrellas sigue LINEAL hasta el Paso 8; gradienteVarias: corregidas). El paso siguiente trabaja " +
   "sobre ese id (o el que salga en «Vistas abiertas»), nunca sobre el original ni sobre un nombre inventado. Si una función ya " +
   "aplica el ganador de su comparación (…Candidatos), no lo apliques otra vez.\n" +
   "- Compara siempre: si la guía tiene una función que prueba varios candidatos y recomienda uno (gradienteCandidatos o " +
   "gradienteVarias, ruidoCandidatos, bxtCandidatos, estirarCandidatos, contrasteCandidatos, nucleoCandidatos...), úsala en vez de aplicar un solo método o valor, y enseña la tabla " +
   "de la comparación (comparados / candidatos) en tu resumen.\n" +
   "- Pasos en los que ELIGE EL USUARIO (Rafael, 11 nov 2026): estirarEstrellasCandidatos (Paso 8: la capa de estrellas se estira AQUÍ, justo " +
   "antes de recombinar, nunca en el Paso 1; tres candidatos: recomendada, +20 % de tamaño y +10 % de saturación, +50 % y +20 %), " +
   "colorCandidatos (Paso 5: saturación, equilibrio y contraste) y nitidezCandidatos (Paso 7). Enseña la tabla con la recomendada, " +
   "para con «PARO:» y sigue con la vista que elija el usuario; cierra las demás con cerrarVista.\n" +
   "- Mientras esta ventana está abierta el usuario NO puede tocar PixInsight ni abrir ficheros. Ve las imágenes sólo como " +
   "miniaturas en el chat: cada previa {vista} y cada comparación sale como imagen en la ficha del resultado. Si quieres que " +
   "mire algo, pide previa (con opciones.rect para un recorte al 100 %) y dile que mire la miniatura; nunca le mandes a abrir " +
   "una carpeta, un JPG ni una vista.\n" +
   (aj.proveedor == "claude" ? "- Tú también puedes VER las previas: lee el .jpg con la herramienta Read (ruta completa del resultado) " +
   "antes de opinar sobre manchas, color, halos o estrellas, y di lo que ves; no digas que no puedes ver imágenes.\n" : "") +
   "- Color: guarda siempre la versión neutra; si el usuario quiere más de un solo color, saturarTono; derivaColor {vista, opciones: " +
   "{referencia}} mide si el tono del objeto ha girado entre dos pasos (> 10° = deriva).\n\n" +
   (aj.internet ?
   "Información de internet (objeto, filtros, cámaras, telescopios, qué señal tiene la nebulosa, problemas típicos):\n" +
   (aj.proveedor == "claude" ? "- Tienes WebSearch y WebFetch: úsalos directamente y cita las fuentes.\n" : "") +
   "- Con llamadas: simbad {objeto} da el tipo de objeto, coordenadas y tamaño; wikipedia {texto, opciones} el resumen " +
   "de un artículo; leerWeb {url} el texto de una página; imagenCatalogo {posicion, opciones} abre una imagen de catálogo " +
   "(DSS2, Hα, WISE...) para saber qué señal esperar. Cita la fuente que devuelven y no inventes lo que no traigan.\n" +
   "- Cuando el usuario pida analizar la imagen, pide en el mismo bloque analizarMaster y documentarObjeto sobre esa vista " +
   "(documentarObjeto identifica el objeto por OBJECT o por la astrometría y da su tipo, un resumen, la emisión esperada, las estrellas brillantes del campo " +
   "y los problemas que pueden dar). En tu resumen junta las medidas de la imagen con esa información: qué objeto es, qué tipo, qué emite " +
   "(y si el filtro usado lo capta), qué estrellas pueden dar halos o reflejos y qué pasos de la guía conviene vigilar.\n\n" :
   "- Las búsquedas en internet están desactivadas: al analizar la imagen usa sólo analizarMaster.\n\n") +
   "Recomendar el paso siguiente:\n" +
   "- Cuando respondas sin llamadas (información, dudas, resúmenes), termina con una línea «Siguiente paso: <qué hacer y con " +
   "qué función de la guía>.» con lo que recomiendas según el orden de la guía y lo que ya se ha hecho en esta conversación " +
   "(por ejemplo, si una imagen aún no se ha analizado, lo primero es analizarla). Si hay alternativas razonables, añade " +
   "líneas que empiecen por «Paso N: ...». El chat las muestra como enlaces que el usuario pulsa para que lo hagas.\n\n" +
   "Orden de los pasos de la guía (no saltes ni cambies el orden al recomendar el siguiente; si uno no aplica, dilo y pasa al siguiente):\n" +
   plOrdenPasos() + "\n" +
   "Con varios masters (RGB + banda estrecha o dual band), el número de paso no es el orden: alinear (5) → desmezclar (7) → " +
   "gradiente de cada capa (9) → deconvolución de corrección de la RGB (11) → color de la RGB SOLA (12) → combinar (10) → " +
   "deconvolución completa (13) → separar estrellas (15) → ruido de la starless (15) → estirar. Combinar antes del color " +
   "sesga los factores y deja el cielo teñido. El cielo se neutraliza sobre la starless lineal (las funciones de estirado " +
   "lo hacen solas).\n\n" +
   "Funciones disponibles (nombre {parámetros, * = obligatorio} [nivel]: descripción):\n" + plListaFunciones(aj.guia) + "\n\n" +
   "Vistas abiertas ahora en PixInsight (id: tamaño, canales, mediana):\n" + plListaVentanas();
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
   return { texto: String(j.message && j.message.content || "").replace(new RegExp("<think>[\\s\\S]*?</think>\\s" + "*", "g"), "").trim(),
            uso: { entrada: j.prompt_eval_count || 0, salida: j.eval_count || 0, cache: j.prompt_eval_cached_count || 0, coste: 0 } };
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
      return (m.role == "user" ? "### Usuario" : "### PiAstroPilot") + "\n" + m.content;
   }).join("\n\n") + "\n\n### PiAstroPilot\n";
}

function plClaudeChat(aj, sistema, mensajes, estado, modelo) {
   var dir = plCarpeta(PL_TMP), fs = dir + "/sistema.txt", fe = dir + "/prompt.txt", fo = dir + "/respuesta.txt";
   File.writeTextFile(fs, sistema);
   File.writeTextFile(fe, "Continúa esta conversación respondiendo al último mensaje del usuario.\n\n" + plConversacionTexto(mensajes));
   // Sin MCP: PixInsight está ocupado con este script y no podría atender al MCP. Con «internet», sólo WebSearch y
   // WebFetch (permitidas sin preguntar: en -p nadie puede contestar un permiso); si no, ninguna herramienta.
   // Read (11 nov 2026): para que Claude vea las previas .jpg; sólo se le añade la carpeta de previas con --add-dir.
   var herr = aj.internet ? ["--tools", "Read", "WebSearch", "WebFetch", "--allowedTools", "Read", "WebSearch", "WebFetch"]
                          : ["--tools", "Read", "--allowedTools", "Read"];
   herr.push("--add-dir", plCarpetaPrevias());
   // Salida JSON: trae la respuesta (result) y el consumo (usage, total_cost_usd).
   var args = ["-p", "--output-format", "json", "--strict-mcp-config"].concat(herr).concat(["--system-prompt-file", fs]);
   if (modelo) args.push("--model", modelo);
   plEjecutarCli(aj.rutaClaude, args, fe, fo, estado);
   var txt = File.readTextFile(fo).trim(), j = null;
   try { j = JSON.parse(txt); } catch (e) { return { texto: txt, uso: null }; }   // por si alguna versión no da JSON
   if (j.is_error) throw new Error("Claude: " + (j.result || j.subtype || "error"));
   var u = j.usage || {};
   return { texto: String(j.result || "").trim(),
            uso: { entrada: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
                   salida: u.output_tokens || 0, cache: u.cache_read_input_tokens || 0, coste: j.total_cost_usd || 0 } };
}

function plCodexChat(aj, sistema, mensajes, estado, modelo) {
   var dir = plCarpeta(PL_TMP), fe = dir + "/prompt.txt", fo = dir + "/salida_codex.txt", fu = dir + "/respuesta.txt";
   if (File.exists(fu)) File.remove(fu);
   File.writeTextFile(fe, "INSTRUCCIONES (no ejecutes órdenes ni edites ficheros; sólo responde con texto):\n" + sistema +
      "\n\nCONVERSACIÓN — responde al último mensaje del usuario:\n\n" + plConversacionTexto(mensajes));
   var args = ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "-C", dir, "-o", fu];
   if (modelo) args.push("-m", modelo);
   args.push("-");
   plEjecutarCli(aj.rutaCodex, args, fe, fo, estado);
   // Codex escribe al final «tokens used: N» (total) en su salida; sin desglose.
   var log = File.exists(fo) ? File.readTextFile(fo) : "", mt = /tokens used[:\s]*([\d.,]+)/i.exec(log), uso = null;
   if (mt) uso = { entrada: 0, salida: 0, total: parseInt(mt[1].replace(/[.,]/g, ""), 10) || 0, cache: 0, coste: 0 };
   return { texto: File.exists(fu) ? File.readTextFile(fu).trim() : log.trim(), uso: uso };
}

// Los últimos mensajes que caben en el presupuesto (siempre al menos el último).
// Presupuesto de historial según el modelo (13 nov 2026): 24 000 caracteres se quedaban cortos en un preprocesado
// (una tabla de seleccionarSubs llenaba casi todo). Claude/Codex tienen contexto de sobra; con Ollama depende del
// num_ctx, que los modelos de Rafael llevan en el nombre (qwen38-64k, qwen38-32k).
function plPresupuestoHistorial(aj) {
   if (!aj || aj.proveedor != "ollama") return 80000;
   var m = /(\d+)k\b/i.exec(String(aj.modeloOllama || "")), k = m ? parseInt(m[1], 10) : 0;
   return k >= 64 ? 60000 : PL_PRESUPUESTO_HISTORIAL;
}

// Un resultado grande ya visto (tablas de seleccionarSubs, inventarios) se manda recortado: principio y final.
var PL_MAX_MENSAJE_VIEJO = 8000;
function plRecortarViejo(m) {
   var c = m.content;
   if (c.length <= PL_MAX_MENSAJE_VIEJO) return m;
   return { role: m.role, content: c.substring(0, 5500) + "\n…[recortado en el historial: " + (c.length - 7500) +
            " caracteres]…\n" + c.substring(c.length - 2000) };
}

function plRecortarHistorial(mensajes, presupuesto) {
   var out = [], total = 0, tope = presupuesto || PL_PRESUPUESTO_HISTORIAL;
   for (var i = mensajes.length - 1; i >= 0; --i) {
      var mi = (i < mensajes.length - 1 && !plEsPeticion(mensajes[i])) ? plRecortarViejo(mensajes[i]) : mensajes[i];
      total += mi.content.length;
      if (out.length && total > tope) break;
      out.unshift(mi);
   }
   while (out.length > 1 && out[0].role != "user") out.shift();
   // La última petición del usuario (no un resultado, una corrección ni «sigue») no se pierde nunca: con resultados
   // grandes (seleccionarSubs) el recorte la dejaba fuera y el modelo olvidaba rutas y objetivo (13 nov 2026).
   var peticion = null;
   for (var j = mensajes.length - 1; j >= 0 && !peticion; --j)
      if (plEsPeticion(mensajes[j])) peticion = mensajes[j];
   if (peticion && out.indexOf(peticion) < 0 && !out.some(function (o) { return o.content === peticion.content; }))
      out.unshift({ role: "user", content: "[Petición del usuario que sigue en marcha (recortada del historial)]\n" + peticion.content },
                  { role: "assistant", content: "Entendido; sigo con esa petición." });
   return out;
}
function plEsPeticion(m) {
   return m.role == "user" && !/^\s*(sigue|contin[uú]a|continue|go on)\b/i.test(m.content) &&
          !/^(Las llamadas han|Resultado de tus llamadas|Tus llamadas han fallado|\[Petición del usuario)/.test(m.content);
}

// paso = clave del paso de la guía elegido en la pestaña Prompt ("" = prompt libre); decide el modelo con pesos N.
// Devuelve { texto, modelo, porque }.
function plPreguntar(aj, mensajes, estado, paso) {
   var sistema = plPromptSistema(aj), m = plRecortarHistorial(mensajes, plPresupuestoHistorial(aj)), e = plElegirModelo(aj, paso || ""), t;
   // Recordatorio al final de la última petición (los modelos locales atienden más a lo último que leen); no se guarda.
   if (m.length && m[m.length - 1].role == "user") {
      m = m.slice();
      m[m.length - 1] = { role: "user", content: m[m.length - 1].content +
                          "\n\n[Vistas abiertas ahora, ids exactos: " + plResumenVistas() + "]" };
   }
   if (aj.proveedor == "claude") t = plClaudeChat(aj, sistema, m, estado, e.modelo);
   else if (aj.proveedor == "codex") t = plCodexChat(aj, sistema, m, estado, e.modelo);
   else t = plOllamaChat(aj, sistema, m, estado);
   return { texto: t.texto, uso: t.uso, modelo: e.modelo, porque: e.porque };
}

// «12.345 → 678 tokens (caché 9.000) · 0,021 $»
function plMiles(n) { return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
function plUsoTexto(u) {
   if (!u) return "";
   var s = u.total !== undefined && !u.entrada && !u.salida ? plMiles(u.total) + " tokens" :
           plMiles(u.entrada) + " → " + plMiles(u.salida) + " tokens" + (u.cache ? " (caché " + plMiles(u.cache) + ")" : "");
   if (u.coste) s += " · " + u.coste.toFixed(3).replace(".", ",") + " $";
   return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Ejecución de las llamadas del modelo (sólo funciones de la guía)
// ---------------------------------------------------------------------------------------------------------------

// Devuelve el texto JSON del primer bloque ```json de la respuesta que tenga «llamadas», o null.
// Un bloque ```javascript (código) no se acepta nunca: el modelo sólo puede pedir funciones de la guía.
function plExtraerLlamadas(texto) {
   var re = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi, m;
   while ((m = re.exec(String(texto))) !== null) {
      var t = m[1].trim();
      if (t.charAt(0) == "{" && /"llamadas"\s*:/.test(t)) return t;
   }
   return null;
}

function plTipoJson(v) { return v === null ? "null" : v instanceof Array ? "array" : typeof v; }

// Comprueba una llamada contra el manifiesto: función conocida, de la lista blanca del runner, parámetros conocidos,
// obligatorios presentes y tipos básicos. Devuelve el texto del error o null.
function plValidarLlamada(ll, man, L) {
   if (!ll || typeof ll !== "object") return "cada llamada debe ser un objeto {funcion, parametros}";
   var n = ll.funcion, x = man.porNombre[n];
   if (typeof n !== "string" || !x) return "«" + n + "» no es una función de la guía (mira la lista de funciones disponibles)";
   if (!L || typeof L[n] !== "function" || !L.hasOwnProperty(n)) return "«" + n + "» no está en la lista blanca del runner";
   var p = ll.parametros === undefined ? {} : ll.parametros;
   if (plTipoJson(p) !== "object") return n + ": \"parametros\" debe ser un objeto";
   var pr = (x.params && x.params.properties) || {}, req = (x.params && x.params.required) || [];
   for (var k in p) if (p.hasOwnProperty(k)) {
      if (!pr.hasOwnProperty(k)) return n + ": parámetro desconocido «" + k + "» (admite: " + (Object.keys(pr).join(", ") || "ninguno") + ")";
      var t = pr[k].type, tv = plTipoJson(p[k]);
      if (t && !(t == tv || (t == "number" && tv == "number") || (t == "integer" && tv == "number")))
         return n + ": «" + k + "» debe ser " + t + " y es " + tv;
   }
   for (var i = 0; i < req.length; ++i) if (p[req[i]] === undefined) return n + ": falta el parámetro obligatorio «" + req[i] + "»";
   return null;
}

// JSON de los modelos locales con los fallos de siempre arreglados (cierre final que falta, coma antes de un cierre,
// texto después del bloque); igual que pprJsonTolerante del runner. Si sigue sin ser válido, el error de siempre.
function plJsonTolerante(texto) {
   try { return JSON.parse(texto); } catch (e0) {
      var s = String(texto).trim().replace(/,\s*([}\]])/g, "$1"), pila = [], enCadena = false, escape = false, fin = -1;
      for (var i = 0; i < s.length; ++i) {
         var c = s.charAt(i);
         if (enCadena) { if (escape) escape = false; else if (c == "\\") escape = true; else if (c == "\"") enCadena = false; continue; }
         if (c == "\"") enCadena = true;
         else if (c == "{" || c == "[") pila.push(c == "{" ? "}" : "]");
         else if (c == "}" || c == "]") { if (pila.length && pila[pila.length - 1] == c) { pila.pop(); if (!pila.length) { fin = i; break; } } else break; }
      }
      if (fin >= 0) s = s.substring(0, fin + 1);
      else if (!enCadena) s = s.replace(/,\s*$/, "") + pila.reverse().join("");
      try { return JSON.parse(s); } catch (e1) { throw e0; }
   }
}

function plEjecutarLlamadas(aj, texto) {
   var avisos = plCargarGuia(aj.guia), g = plGlobal(), salida = [], t0 = Date.now();
   g.PIASTROPILOT_INTERNET = !!aj.internet;   // web.js lo respeta: sin la casilla, simbad/wikipedia/... no salen a internet
   g.PIASTROPILOT_PREVIAS = plCarpetaPrevias();   // las comparaciones de la guía dejan aquí una miniatura por candidato
   avisos.forEach(function (a) { console.warningln("[PiAstroPilotLite] " + a); });
   var lista;
   try {
      var o = plJsonTolerante(texto);
      lista = o && o.llamadas;
      if (!(lista instanceof Array) || !lista.length) throw new Error("falta la lista \"llamadas\"");
   } catch (e) {
      return { ok: false, texto: "ERROR: el bloque ```json no es válido (" + (e.message || e) + "). Formato: " +
               "{\"llamadas\": [{\"funcion\": \"…\", \"parametros\": {…}}]}", segundos: 0 };
   }
   var man = plManifiesto(aj.guia), L = g.LISTA;
   // Todas se validan antes de ejecutar ninguna.
   for (var i = 0; i < lista.length; ++i) {
      var err = plValidarLlamada(lista[i], man, L);
      if (err) return { ok: false, texto: "ERROR en la llamada " + (i + 1) + ": " + err + ". No se ha ejecutado nada." +
                        plAyudaParametros(lista[i] && lista[i].funcion, man) +
                        "\nVistas abiertas (ids exactos): " + plResumenVistas(), segundos: 0 };
   }
   for (var j = 0; j < lista.length; ++j) {
      var ll = lista[j], p = ll.parametros || {};
      // Enumeraciones sin distinguir mayúsculas ni acentos («NXT», «Galaxia»), con la función del runner. Si falla,
      // se sigue con los parámetros tal cual (11 nov 2026: un error aquí cortaba la serie sin respuesta al modelo).
      try { if (typeof g.pprNormalizarOpciones === "function") p = g.pprNormalizarOpciones(p); }
      catch (e) { console.warningln("[PiAstroPilotLite] normalizar parámetros: " + (e.message || e)); }
      console.noteln("[PiAstroPilotLite] " + ll.funcion + " " + JSON.stringify(p));
      try {
         var v = L[ll.funcion](p), s;
         // WBPP va en otra instancia y tarda decenas de minutos: si no ha terminado, se espera aquí (mirando cada
         // 30 s, hasta PL_ESPERA_WBPP_MIN) en vez de devolver «sin terminar» al modelo, que en una serie de pasos
         // gastaba un paso y una consulta en cada vistazo (13 nov 2026).
         if (ll.funcion == "estadoWBPP") {
            var tW = Date.now();
            while (v && typeof v === "object" && v.terminado === false && Date.now() - tW < PL_ESPERA_WBPP_MIN * 60000) {
               for (var w = 0; w < 300; ++w) { plEventos(); plDormir(100); }
               v = L[ll.funcion](p);
            }
            if (v && typeof v === "object") v.esperado_min = Math.round((Date.now() - tW) / 6000) / 10;
         }
         try { s = typeof v === "string" ? v : JSON.stringify(v === undefined ? null : v, null, 1); } catch (x) { s = String(v); }
         salida.push(ll.funcion + ":\n" + s);
      } catch (e) {
         var linea = e && e.lineNumber ? " (línea " + e.lineNumber + ")" : "";
         if (plGlobal().PL_DEPURAR && e && e.stack) linea += "\n" + e.stack;
         var vistas = "";
         try { if (String(e).indexOf("Vistas abiertas") < 0) vistas = "\nVistas abiertas (ids exactos): " + plResumenVistas(); } catch (x) {}
         return { ok: false, texto: plRecortar((salida.length ? salida.join("\n\n") + "\n\n" : "") + "ERROR en " + ll.funcion + ": " +
                  (e && e.message ? e.message : String(e)) + linea + plAyudaParametros(ll.funcion, man) + vistas, 6000),
                  segundos: (Date.now() - t0) / 1000 };
      }
   }
   // 20000 caracteres (antes 6000 cortaba análisis + ficha del objeto; el módulo manda hasta 30000 a interpretar).
   return { ok: true, texto: plRecortar(salida.join("\n\n") || "(sin salida)", 20000), segundos: (Date.now() - t0) / 1000 };
}

// ---------------------------------------------------------------------------------------------------------------
// Diálogo
// ---------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------
// Chat en HTML (WebView), con el mismo aspecto que el módulo (PiAstroPilotRender.cpp): Markdown de las respuestas
// (tablas, negritas, enlaces, código) y fichas con los datos de los resultados de las llamadas.
// ---------------------------------------------------------------------------------------------------------------

var PL_CSS =
   "body{margin:0;padding:10px 12px;background:#232629;color:#d8dadc;font:13px/1.45 'Segoe UI',Tahoma,sans-serif}" +
   ".msg{margin:10px 0}" +
   ".who{font-size:11px;color:#8a9199;margin-bottom:3px}.who b{color:#c8ccd0}" +
   ".user .bubble{background:#2f4f73;color:#eef4fb;border-radius:10px 10px 2px 10px;padding:7px 11px;margin-left:15%;white-space:pre-wrap}" +
   ".user .who{text-align:right}" +
   ".asst .bubble{background:#2b2f33;border:1px solid #3a4046;border-left:3px solid #6aa6e8;border-radius:6px;padding:8px 12px}" +
   "h2,h3,h4,h5{margin:10px 0 5px;color:#9cc7f5}h2{font-size:16px}h3{font-size:14.5px}h4{font-size:13.5px}h5{font-size:13px}" +
   "p{margin:5px 0}b{color:#ffffff}i{color:#e8d9a8}a{color:#79b8ff}" +
   "a.step{text-decoration:underline;cursor:pointer;color:#7fd0ff;font-weight:600}a.step.done{color:#8a9199}" +
   "code{font-family:Consolas,Menlo,monospace;font-size:12px;background:#1b1d1f;color:#e6c07b;padding:1px 4px;border-radius:3px}" +
   "pre.code{background:#1b1d1f;border:1px solid #33383d;border-radius:5px;padding:6px 9px;overflow-x:auto;white-space:pre}" +
   "pre.code code{background:none;padding:0;color:#c9d1d9}.lang{font-size:10px;color:#7d8590;margin-bottom:3px}" +
   "table{border-collapse:collapse;margin:6px 0;font-size:12.5px}" +
   "th,td{border:1px solid #3d444b;padding:3px 8px;text-align:left;vertical-align:top}" +
   "th{background:#30363c;color:#cfd6dd;font-weight:600}tr:nth-child(even) td{background:#272b2f}" +
   "table.kv th{width:1%;white-space:nowrap}" +
   ".num{color:#7ee0b8;font-family:Consolas,monospace}" +
   "ul,ol{margin:4px 0 4px 20px;padding:0}li{margin:2px 0}.sub{margin-left:18px;color:#b9bec4}" +
   "blockquote{border-left:3px solid #556;margin:5px 0;padding:2px 10px;color:#aab}" +
   "hr{border:none;border-top:1px solid #3a4046;margin:8px 0}" +
   ".info{font-size:11.5px;color:#8a9199;margin:6px 0}" +
   ".info.err{color:#ff8f8f}.info.plan{color:#ffd479;font-weight:600}" +
   ".card{background:#262a2e;border:1px solid #3a4046;border-radius:6px;padding:8px 12px;margin:6px 0}" +
   ".cardtitle{font-weight:600;margin-bottom:6px;color:#dfe3e7}" +
   ".badge{display:inline-block;font-size:11px;padding:1px 7px;border-radius:9px;margin-right:4px}" +
   ".badge.ok{background:#1f5134;color:#9ff0c0}.badge.bad{background:#5a2024;color:#ffb1b1}" +
   "ul.nc,ul.med,ul.ojo{list-style:none;margin:4px 0;padding:0}" +
   "ul.nc li{color:#ff9a9a}ul.med li{color:#9fe3b7}ul.ojo li{color:#ffd58a}" +
   ".ico{display:inline-block;width:18px}" +
   ".ok{color:#7ee0a0}.bad{color:#ff8f8f}.muted{color:#6c737a}" +
   "details{margin-top:6px}summary{cursor:pointer;color:#7d8590;font-size:11px}" +
   ".grid{margin:6px 0;font-size:0}.row{white-space:nowrap}" +
   "figure{display:inline-block;vertical-align:top;margin:0 1% 8px 0;width:48.5%;font-size:12px;background:#1b1d1f;border:1px solid #33383d;" +
   "border-radius:5px;overflow:hidden;box-sizing:border-box;white-space:normal}" +
   "figure img{display:block;width:100%;height:auto}figcaption{font-size:11px;color:#c8ccd0;padding:3px 6px}" +
   "figure.rec{border:2px solid #4fbf7a}";

function plEsc(s) {
   return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Formato en línea: `código`, **negrita**, *cursiva*, [enlace](url). Sobre el texto ya escapado.
function plInline(raw) {
   var s = plEsc(raw), out = "", i = 0, n = s.length, bold = false, ital = false;
   while (i < n) {
      var c = s.charAt(i);
      if (c == "`") {
         var j = s.indexOf("`", i + 1);
         if (j >= 0) { out += "<code>" + s.substring(i + 1, j) + "</code>"; i = j + 1; continue; }
      }
      if (c == "*" && s.charAt(i + 1) == "*") { out += bold ? "</b>" : "<b>"; bold = !bold; i += 2; continue; }
      if (c == "*" && (ital || (i + 1 < n && s.charAt(i + 1) != " "))) { out += ital ? "</i>" : "<i>"; ital = !ital; ++i; continue; }
      if (c == "[") {
         var a = s.indexOf("](", i), b = a >= 0 ? s.indexOf(")", a) : -1;
         if (a >= 0 && b >= 0) {
            out += "<a href=\"" + s.substring(a + 2, b) + "\">" + s.substring(i + 1, a) + "</a>";
            i = b + 1; continue;
         }
      }
      out += c; ++i;
   }
   if (ital) out += "</i>";
   if (bold) out += "</b>";
   return out;
}

// Enlaces de paso (como el módulo): «Siguiente paso: ...», «Paso siguiente: ...», «Next step: ...» y las líneas que
// empiezan por «Paso N ...» se pintan como enlace. Al pulsarlo, la página deja «mensaje|texto» en window.plClick y el
// diálogo lo recoge con su temporizador: ejecuta las llamadas pendientes de ese mensaje o le pide el paso al modelo.
function plAncla(objetivo, despues) {
   var plano = objetivo.split("**").join("").split("`").join("").trim();
   if (!plano) return "";
   return "<a class=\"step\" href=\"#\" data-m=\"@M@\" data-paso=\"" + plEsc(plano) + "\" onclick=\"return plPaso(this)\">" +
          plInline(objetivo) + "</a>" + plInline(despues);
}

function plInlinePaso(raw) {
   var bajo = raw.toLowerCase(), claves = ["siguiente paso:", "paso siguiente:", "siguiente paso (", "next step:"];
   for (var k = 0; k < claves.length; ++k) {
      var p = bajo.indexOf(claves[k]);
      if (p < 0) continue;
      var e = p + claves[k].length;
      if (claves[k].charAt(claves[k].length - 1) == "(") --e;   // «Siguiente paso (Paso 11): ...»
      var antes = raw.substring(0, e), resto = raw.substring(e);
      if (resto.indexOf("**") == 0) { antes += "**"; resto = resto.substring(2); }   // el rótulo en negrita queda fuera
      var punto = resto.indexOf(". ");
      var a = plAncla(punto >= 0 ? resto.substring(0, punto + 1) : resto, punto >= 0 ? resto.substring(punto + 1) : "");
      if (a) return plInline(antes) + a;
   }
   var t = raw.trim(), s = 0;
   while (t.charAt(s) == "*") ++s;
   if (/^Paso \d/.test(t.substring(s))) {
      var d = t.indexOf(". ");
      var b = plAncla(d >= 0 ? t.substring(0, d + 1) : t, d >= 0 ? t.substring(d + 1) : "");
      if (b) return b;
   }
   return plInline(raw);
}

function plEsFilaTabla(l) { var t = l.trim(); return t.length > 2 && t.charAt(0) == "|" && t.charAt(t.length - 1) == "|"; }
function plEsSepTabla(l) { return plEsFilaTabla(l) && /^[\s|:\-]+$/.test(l.trim()); }
function plCeldas(l) { var t = l.trim(); return t.substring(1, t.length - 1).split("|").map(function (c) { return c.trim(); }); }

function plMarkdown(md) {
   var lineas = String(md).replace(/\r\n/g, "\n").split("\n"), out = "", para = "", enCodigo = false, enUl = false, enOl = false;
   function vaciarPara() { if (para) { out += "<p>" + para + "</p>"; para = ""; } }
   function cerrarListas() { if (enUl) { out += "</ul>"; enUl = false; } if (enOl) { out += "</ol>"; enOl = false; } }
   for (var i = 0; i < lineas.length; ++i) {
      var linea = lineas[i], t = linea.trim();
      if (t.indexOf("```") == 0) {
         vaciarPara(); cerrarListas();
         if (!enCodigo) {
            var leng = t.substring(3).trim();
            out += "<pre class=\"code\"><div class=\"lang\">" + plEsc(leng || "código") + "</div><code>";
            enCodigo = true;
         } else { out += "</code></pre>"; enCodigo = false; }
         continue;
      }
      if (enCodigo) { out += plEsc(linea) + "\n"; continue; }
      if (!t) { vaciarPara(); cerrarListas(); continue; }
      if (plEsFilaTabla(t) && i + 1 < lineas.length && plEsSepTabla(lineas[i + 1])) {
         vaciarPara(); cerrarListas();
         out += "<table><tr>" + plCeldas(t).map(function (c) { return "<th>" + plInlinePaso(c) + "</th>"; }).join("") + "</tr>";
         for (i += 2; i < lineas.length && plEsFilaTabla(lineas[i]); ++i)
            out += "<tr>" + plCeldas(lineas[i]).map(function (c) { return "<td>" + plInlinePaso(c) + "</td>"; }).join("") + "</tr>";
         --i;
         out += "</table>";
         continue;
      }
      if (t.charAt(0) == "#") {
         vaciarPara(); cerrarListas();
         var nivel = 0;
         while (nivel < t.length && t.charAt(nivel) == "#") ++nivel;
         var h = Math.max(1, Math.min(4, nivel)) + 1;
         out += "<h" + h + ">" + plInlinePaso(t.substring(nivel).trim()) + "</h" + h + ">";
         continue;
      }
      if (t == "---" || t == "***") { vaciarPara(); cerrarListas(); out += "<hr>"; continue; }
      if (/^[-*•] /.test(t)) {
         vaciarPara();
         if (enOl) { out += "</ol>"; enOl = false; }
         if (!enUl) { out += "<ul>"; enUl = true; }
         out += "<li>" + plInlinePaso(t.substring(2).trim()) + "</li>";
         continue;
      }
      var m = /^(\d+)[.)] (.*)$/.exec(t);
      if (m) {
         vaciarPara();
         if (enUl) { out += "</ul>"; enUl = false; }
         if (!enOl) { out += "<ol>"; enOl = true; }
         out += "<li>" + plInlinePaso(m[2].trim()) + "</li>";
         continue;
      }
      if (t.charAt(0) == ">") { vaciarPara(); cerrarListas(); out += "<blockquote>" + plInlinePaso(t.substring(1).trim()) + "</blockquote>"; continue; }
      if ((enUl || enOl) && /^(  |\t)/.test(linea)) { out += "<div class=\"sub\">" + plInlinePaso(t) + "</div>"; continue; }
      cerrarListas();
      if (para) para += "<br>";
      para += plInlinePaso(t);
   }
   if (enCodigo) out += "</code></pre>";
   vaciarPara(); cerrarListas();
   return out;
}

// --- Fichas de resultados (objetos JSON que devuelven las funciones de la guía) ---

function plHumano(k) { k = String(k).replace(/_/g, " "); return k.charAt(0).toUpperCase() + k.substring(1); }
function plEsEscalar(v) { return v === null || typeof v !== "object"; }

function plValorHtml(v) {
   if (v === null || v === undefined) return "<span class=\"muted\">&mdash;</span>";
   if (typeof v === "boolean") return v ? "<span class=\"ok\">sí</span>" : "<span class=\"bad\">no</span>";
   if (typeof v === "number") return "<span class=\"num\">" + (Math.abs(v) < 1e6 && v % 1 ? Number(v.toPrecision(6)) : v) + "</span>";
   return typeof v === "string" ? plEsc(v) : plEsc(JSON.stringify(v));
}

function plListaHtml(arr, cls, icono) {
   if (!Array.isArray(arr) || !arr.length) return "";
   return "<ul class=\"" + cls + "\">" + arr.map(function (e) {
      return "<li><span class=\"ico\">" + icono + "</span>" + plEsc(plEsEscalar(e) ? e : JSON.stringify(e)) + "</li>";
   }).join("") + "</ul>";
}

// Array de objetos → tabla (columnas: claves escalares y las de los objetos anidados, máx. 10; filas máx. 40).
// Campos con rutas de miniaturas: se pintan como imágenes (plMiniaturas), no como columnas de texto.
function plEsCampoPrevia(k) { return /^(previa|previa_modelo|previa_recorte|jpg|sel|clave)$/.test(k); }   // también datos internos (sel, clave)

function plRutaFichero(p) { return "file:" + "/" + "/" + "/" + String(p).replace(/\\/g, "/"); }

// Rejilla de miniaturas de un resultado: cada objeto con «previa» (y «previa_modelo» al lado, como el gradiente quitado)
// es una fila; el elegido va con borde verde. Sin repetir ficheros (candidatos y comparados llevan las mismas).
function plMiniaturas(r) {
   var vistos = {}, filas = [];
   (function recorrer(o) {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) { o.forEach(recorrer); return; }
      // previa {vista} devuelve la ruta en «fichero» (11 nov 2026: no salía en el chat y el usuario no podía verla).
      var img = o.previa || o.jpg || (typeof o.fichero === "string" && /\.(jpe?g|png)$/i.test(o.fichero) ? o.fichero : null);
      if (typeof img === "string" && !vistos[img] && File.exists(img)) {
         vistos[img] = true;
         var rotulo = o.metodo ? o.metodo + (o.parametros ? " " + o.parametros : "") : (o.paleta || o.etiqueta || o.vista || "");
         var extra = [];
         // Nombres neutros de la guía; los antiguos (fondoResidual, come_objeto_pct, senal_debil_en_ruidos) por compatibilidad.
         var mt = o.metricas || {};
         var resto = isFinite(mt.gradiente_restante) ? mt.gradiente_restante : mt.fondoResidual;
         var quitado = isFinite(mt.objeto_quitado_pct) ? mt.objeto_quitado_pct : mt.come_objeto_pct;
         if (isFinite(resto)) extra.push("deja " + Math.round(100 * resto) + " % del gradiente");
         if (isFinite(quitado)) extra.push("se lleva " + quitado + " % del objeto");
         if (o.deja_gradiente_pct !== undefined && o.deja_gradiente_pct !== null) extra.push("deja " + o.deja_gradiente_pct + " % del gradiente");
         if (o.ruido_baja_pct !== undefined) extra.push("ruido −" + o.ruido_baja_pct + " %");
         else if (isFinite(o.ruido_rel)) extra.push("ruido ×" + o.ruido_rel);
         if (isFinite(o.contraste_ganado_pct)) extra.push("contraste +" + o.contraste_ganado_pct + " %");
         else if (o.contraste_x !== undefined) extra.push("contraste ×" + o.contraste_x);
         var sep = o.separacion !== undefined ? o.separacion : o.senal_debil_en_ruidos;
         if (sep !== undefined) extra.push("señal débil " + sep + " ruidos");
         if (typeof o.resumen === "string" && o.resumen) extra.push(o.resumen);
         var mod = typeof o.previa_modelo === "string" && File.exists(o.previa_modelo) ? o.previa_modelo : null;
         var rec100 = typeof o.previa_recorte === "string" && File.exists(o.previa_recorte) ? o.previa_recorte : null;
         if (mod) vistos[mod] = true;
         if (rec100) vistos[rec100] = true;
         filas.push({ img: img, mod: mod || rec100, pie: mod ? "Gradiente quitado (modelo)" : "Recorte al 100 %",
                      rotulo: rotulo + (extra.length ? " · " + extra.join(", ") : ""), elegido: !!o.elegido });
      }
      for (var k in o) if (!plEsCampoPrevia(k)) recorrer(o[k]);
   })(r);
   if (!filas.length) return "";
   function fig(src, txt, rec) {
      return "<figure" + (rec ? " class=\"rec\"" : "") + "><img src=\"" + plEsc(plRutaFichero(src)) + "\"><figcaption>" + plEsc(txt) + "</figcaption></figure>";
   }
   return "<div class=\"grid\">" + filas.map(function (f) {
      return "<div class=\"row\">" + fig(f.img, (f.elegido ? "★ ELEGIDO · " : "") + f.rotulo, f.elegido) +
             (f.mod ? fig(f.mod, f.pie, false) : "") + "</div>";
   }).join("") + "</div>";
}

function plTablaObjetos(arr) {
   var cols = [];
   arr.forEach(function (e) {
      if (!e || typeof e !== "object") return;
      for (var k in e) {
         if (plEsCampoPrevia(k)) continue;
         var v = e[k];
         if (v && typeof v === "object" && !Array.isArray(v)) {
            for (var k2 in v) if (plEsEscalar(v[k2]) && cols.indexOf(k + "." + k2) < 0 && cols.length < 10) cols.push(k + "." + k2);
         } else if (cols.indexOf(k) < 0 && cols.length < 10) cols.push(k);
      }
   });
   var h = "<table><tr>" + cols.map(function (c) { return "<th>" + plEsc(plHumano(c.substring(c.indexOf(".") + 1))) + "</th>"; }).join("") + "</tr>";
   for (var n = 0; n < arr.length; ++n) {
      if (n >= 40) { h += "<tr><td colspan=\"" + cols.length + "\" class=\"muted\">&hellip; " + (arr.length - 40) + " filas más</td></tr>"; break; }
      h += "<tr>" + cols.map(function (c) {
         var p = c.indexOf("."), e = arr[n] || {}, v = p < 0 ? e[c] : (e[c.substring(0, p)] || {})[c.substring(p + 1)];
         return "<td>" + (plEsEscalar(v) ? plValorHtml(v) : plEsc(JSON.stringify(v))) + "</td>";
      }).join("") + "</tr>";
   }
   return h + "</table>";
}

function plFilasDatos(obj, prefijo, acc, prof) {
   for (var k in obj) {
      if (prof == 0 && (k == "no_cumple" || k == "control")) continue;
      if (plEsCampoPrevia(k)) continue;
      var nombre = prefijo ? prefijo + " · " + k : plHumano(k), v = obj[k];
      if (plEsEscalar(v)) acc.filas += "<tr><th>" + plEsc(nombre) + "</th><td>" + plValorHtml(v) + "</td></tr>";
      else if (!Array.isArray(v) && prof < 2) plFilasDatos(v, nombre, acc, prof + 1);
      else if (Array.isArray(v) && v.length && v[0] && typeof v[0] === "object") acc.extra += "<h4>" + plEsc(nombre) + "</h4>" + plTablaObjetos(v);
      else if (Array.isArray(v)) {
         var l = v.slice(0, 30).map(function (x) { return plEsEscalar(x) ? plValorHtml(x) : plEsc(JSON.stringify(x)); }).join(", ");
         acc.filas += "<tr><th>" + plEsc(nombre) + "</th><td>" + (v.length ? l + (v.length > 30 ? " &hellip;" : "") : "<span class=\"muted\">&mdash;</span>") + "</td></tr>";
      } else acc.filas += "<tr><th>" + plEsc(nombre) + "</th><td>" + plEsc(JSON.stringify(v)) + "</td></tr>";
   }
}

function plFicha(r, json) {
   var h = "<div class=\"card\"><div class=\"cardtitle\">";
   var nc = r && r.no_cumple, ctl = (r && r.control) || {};
   if (Array.isArray(nc)) h += nc.length ? "<span class=\"badge bad\">" + plT("No cumple") + "</span> " : "<span class=\"badge ok\">" + plT("Cumple") + "</span> ";
   h += plT("Resultado de las llamadas") + "</div>";
   h += plListaHtml(nc, "nc", "&#10007;") + plListaHtml(ctl.medido, "med", "&#10003;") + plListaHtml(ctl.revisar_a_ojo, "ojo", "&#128065;");
   h += plMiniaturas(r);
   var acc = { filas: "", extra: "" };
   if (Array.isArray(r)) acc.extra = r.length && r[0] && typeof r[0] === "object" ? plTablaObjetos(r) :
                                     "<p>" + r.map(function (x) { return plValorHtml(x); }).join(", ") + "</p>";
   else plFilasDatos(r, "", acc, 0);
   if (acc.filas) h += "<table class=\"kv\">" + acc.filas + "</table>";
   h += acc.extra;
   h += "<details><summary>JSON</summary><pre class=\"code\"><code>" + plEsc(json) + "</code></pre></details>";
   return h + "</div>";
}

// Primer JSON (objeto o array) que empieza al principio de una línea o tras «Valor devuelto: ».
function plBuscarJson(texto) {
   var re = /(^|\n|Valor devuelto: )([{\[])/g, m;
   while ((m = re.exec(texto)) !== null) {
      var ini = m.index + m[1].length, cierre = m[2] == "{" ? "}" : "]", fin = texto.lastIndexOf(cierre);
      while (fin > ini) {
         try {
            var v = JSON.parse(texto.substring(ini, fin + 1));
            if (v && typeof v === "object") return { ini: ini, fin: fin + 1, valor: v };
         } catch (e) {}
         fin = texto.lastIndexOf(cierre, fin - 1);
      }
   }
   return null;
}

function plInfo(texto, error) {
   var j = plBuscarJson(texto);
   if (j) {
      var json = texto.substring(j.ini, j.fin), antes = texto.substring(0, j.ini).replace(/Valor devuelto: $/, "").trim();
      var despues = texto.substring(j.fin).trim();
      // El valor devuelto suele repetir lo que ya se mandó con chat(): no se pinta dos veces.
      var rep = /^Valor devuelto: /.test(despues) ? plBuscarJson(despues) : null;
      if (rep && JSON.stringify(rep.valor) == JSON.stringify(j.valor) && !despues.substring(rep.fin).trim()) despues = "";
      return (antes ? plInfo(antes, error) : "") + plFicha(j.valor, json) + (despues ? plInfo(despues, error) : "");
   }
   return "<div class=\"info" + (error ? " err" : "") + "\">" + plEsc(texto).replace(/\n/g, "<br>") + "</div>";
}

// Colores claros para el dossier en PDF (se imprime mejor que el tema oscuro del chat).
var PL_CSS_CLARO =
   "body{background:#ffffff;color:#1d2125}.who{color:#5f6770}.who b{color:#1d2125}" +
   ".user .bubble{background:#e7f0fb;color:#0e2a47}.asst .bubble{background:#f7f8fa;border:1px solid #d6dbe0;border-left:3px solid #2f6fb7}" +
   "h2,h3,h4,h5{color:#1f5394}b{color:#000}i{color:#6b5300}a{color:#1f5394}a.step{color:#1f5394}" +
   "code{background:#eef1f4;color:#7a3e00}pre.code{background:#f3f5f7;border-color:#d6dbe0}pre.code code{color:#1d2125}" +
   "th,td{border-color:#cfd5db}th{background:#e9edf1;color:#1d2125}tr:nth-child(even) td{background:#f6f8fa}" +
   ".num{color:#0b6b4a}.info{color:#5f6770}.info.err{color:#b3261e}.card{background:#fbfcfd;border-color:#d6dbe0}" +
   ".cardtitle{color:#1d2125}ul.nc li{color:#b3261e}ul.med li{color:#1b7a3d}ul.ojo li{color:#8a5a00}" +
   "figure{background:#f3f5f7;border-color:#d6dbe0}figcaption{color:#333}.portada{border-bottom:2px solid #2f6fb7;margin-bottom:12px;padding-bottom:8px}" +
   ".portada h1{font-size:20px;margin:0 0 4px;color:#1f5394}.portada p{margin:2px 0;color:#444}details{display:none}" +
   ".msg,.card,figure,table{page-break-inside:avoid}";

function plPagina(entradas, op) {
   op = op || {};
   var h = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>" + PL_CSS + (op.claro ? PL_CSS_CLARO : "") + "</style><script>var plClick='';" +
           "function plPaso(a){plClick=a.getAttribute('data-m')+'|'+a.getAttribute('data-paso');a.className='step done';return false;}" +
           "</script></head><body>" + (op.cabecera || "");
   entradas.forEach(function (e, indice) {
      var quien = "<div class=\"who\">" + plEsc(e.hora) + " &middot; <b>" + plEsc(e.titulo) + "</b></div>";
      if (e.tipo == "user") h += "<div class=\"msg user\">" + quien + "<div class=\"bubble\">" + plEsc(e.texto) + "</div></div>";
      else if (e.tipo == "asst") h += "<div class=\"msg asst\">" + quien + "<div class=\"bubble\">" +
                                      plMarkdown(e.texto).split("data-m=\"@M@\"").join("data-m=\"" + indice + "\"") + "</div></div>";
      else h += "<div class=\"msg\">" + quien + plInfo(e.texto, e.tipo == "err") + "</div>";
   });
   return h + "<div id=\"fin\"></div>" + (op.claro ? "" : "<script>window.scrollTo(0, document.body.scrollHeight);</script>") + "</body></html>";
}

// ---------------------------------------------------------------------------------------------------------------
// Dossier (PDF) e informe (Markdown) de la conversación (Rafael, 9 nov 2026): el dossier para guardar el procesado; el
// informe, con lo útil y los errores, para recopilar procesados y mejorar la guía.
// ---------------------------------------------------------------------------------------------------------------

function plDosDig(n) { return ("0" + n).slice(-2); }
function plSello() { var d = new Date(); return d.getFullYear() + "-" + plDosDig(d.getMonth() + 1) + "-" + plDosDig(d.getDate()) + "_" + plDosDig(d.getHours()) + plDosDig(d.getMinutes()); }

// Objeto y vista principal para el nombre y la portada: OBJECT de la vista activa (o la primera), si lo hay.
function plDatosImagen() {
   var w = ImageWindow.activeWindow;
   if (w.isNull && ImageWindow.windows.length) w = ImageWindow.windows[0];
   if (w.isNull) return { vista: "", objeto: "" };
   var obj = "";
   try { w.keywords.forEach(function (k) { if (k.name == "OBJECT") obj = k.strippedValue; }); } catch (e) {}
   return { vista: w.mainView.id, objeto: obj };
}

// Funciones de la guía que aparecen en las llamadas de la conversación (por el manifiesto).
function plFuncionesUsadas(entradas, guia) {
   var nombres = [], usadas = {};
   try { JSON.parse(File.readTextFile(guia + "/herramientas/manifiesto.json")).funciones.forEach(function (f) { nombres.push(f.nombre); }); } catch (e) {}
   entradas.forEach(function (e) {
      if (e.tipo != "asst") return;
      var s = plExtraerLlamadas(e.texto);
      if (s) nombres.forEach(function (n) { if (new RegExp("\"funcion\"\\s*:\\s*\"" + n + "\"").test(s)) usadas[n] = (usadas[n] || 0) + 1; });
   });
   return usadas;
}

function plInformeMd(entradas, aj, uso) {
   var di = plDatosImagen(), usadas = plFuncionesUsadas(entradas, aj.guia), errores = [], md = [];
   var ok = entradas.filter(function (e) { return e.tipo == "info" && /^Resultado/.test(e.titulo); }).length;
   for (var i = 0; i < entradas.length; ++i) if (entradas[i].tipo == "err" && /^Error al ejecutar/.test(entradas[i].titulo)) {
      var script = null;
      for (var j = i - 1; j >= 0 && !script; --j) if (entradas[j].tipo == "asst") script = plExtraerLlamadas(entradas[j].texto);
      errores.push({ error: entradas[i].texto, script: script });
   }
   md.push("# Informe de procesado — PiAstroPilot Lite", "",
           "- Fecha: " + plSello().replace("_", " "), "- Objeto (OBJECT): " + (di.objeto || "—") + " · vista: " + (di.vista || "—"),
           "- Modelo: " + aj.proveedor + " · " + (aj.modelo() || "por defecto"), "- Llamadas correctas: " + ok + " · con error: " + errores.length,
           "- Tokens: " + (uso ? plUsoTexto(uso.entrada || uso.salida ? uso : { total: uso.total, coste: uso.coste }) : "—"), "",
           "## Funciones de la guía usadas", "");
   var ks = Object.keys(usadas);
   md.push(ks.length ? ks.map(function (k) { return "- `" + k + "` ×" + usadas[k]; }).join("\n") : "(ninguna)", "");
   md.push("## Errores (para mejorar la guía)", "");
   if (!errores.length) md.push("(ninguno)", "");
   errores.forEach(function (e, n) {
      md.push("### Error " + (n + 1), "", "```", plRecortar(e.error, 1500), "```", "");
      if (e.script) md.push("Llamadas que lo provocaron:", "", "```json", plRecortar(e.script, 3000), "```", "");
   });
   md.push("## Conversación", "");
   entradas.forEach(function (e) {
      if (e.tipo == "user") md.push("### " + e.hora + " · Tú", "", e.texto, "");
      else if (e.tipo == "asst") md.push("### " + e.hora + " · " + e.titulo, "", e.texto, "");
      else md.push("### " + e.hora + " · " + e.titulo, "", "```", plRecortar(e.texto, 4000), "```", "");
   });
   md.push("## Notas del usuario", "", "(qué salió bien, qué hubo que corregir a mano, qué cambiarías en la guía)", "");
   return md.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Voz (accesibilidad, Rafael 8 nov 2026): leer las respuestas en voz alta y dictar el prompt, con las voces y el
// reconocedor de Windows (System.Speech, sin internet). Cada cosa va en un PowerShell aparte: PixInsight no se bloquea.
// ---------------------------------------------------------------------------------------------------------------

var PL_PS_HABLAR =
   "param($f, $rate, $cultura)\r\n" +
   "Add-Type -AssemblyName System.Speech\r\n" +
   "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer\r\n" +
   "try { $s.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::NotSet, [System.Speech.Synthesis.VoiceAge]::NotSet, 0, [Globalization.CultureInfo]$cultura) } catch {}\r\n" +
   "$s.Rate = [int]$rate\r\n" +
   "$s.Speak([IO.File]::ReadAllText($f, [Text.Encoding]::UTF8))\r\n";

// Dicta frases seguidas hasta un silencio (8 s sin empezar a hablar, 2,5 s tras la última frase) o 90 s en total.
var PL_PS_DICTAR =
   "param($salida, $cultura)\r\n" +
   "Add-Type -AssemblyName System.Speech\r\n" +
   "$texto = @()\r\n" +
   "try {\r\n" +
   "  $r = New-Object System.Speech.Recognition.SpeechRecognitionEngine([Globalization.CultureInfo]$cultura)\r\n" +
   "  $r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))\r\n" +
   "  $r.SetInputToDefaultAudioDevice()\r\n" +
   "  $r.EndSilenceTimeout = [TimeSpan]::FromSeconds(1.2)\r\n" +
   "  $r.InitialSilenceTimeout = [TimeSpan]::FromSeconds(8)\r\n" +
   "  $fin = (Get-Date).AddSeconds(90)\r\n" +
   "  while ((Get-Date) -lt $fin) {\r\n" +
   "    $res = $r.Recognize()\r\n" +
   "    if (-not $res) { break }\r\n" +
   "    $texto += $res.Text\r\n" +
   "    $r.InitialSilenceTimeout = [TimeSpan]::FromSeconds(2.5)\r\n" +
   "  }\r\n" +
   "} catch { $texto = @('ERROR: ' + $_.Exception.Message) }\r\n" +
   "[IO.File]::WriteAllText($salida, ($texto -join ' '), [Text.Encoding]::UTF8)\r\n";

// Dictado moderno de Windows 11 (Win + H, en línea, mucho mejor que el reconocedor antiguo; Rafael 8 nov 2026): se pone
// el foco en el prompt y se pulsa Win + H desde un PowerShell aparte; Windows escribe directamente en el cuadro.
var PL_PS_WINH =
   "Add-Type -Namespace PL -Name Teclas -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte b, byte s, uint f, System.UIntPtr e);'\r\n" +
   "Start-Sleep -Milliseconds 200\r\n" +
   "[PL.Teclas]::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero)\r\n" +
   "[PL.Teclas]::keybd_event(0x48, 0, 0, [UIntPtr]::Zero)\r\n" +
   "[PL.Teclas]::keybd_event(0x48, 0, 2, [UIntPtr]::Zero)\r\n" +
   "[PL.Teclas]::keybd_event(0x5B, 0, 2, [UIntPtr]::Zero)\r\n";

// Texto para leer: sin bloques de código, sin símbolos de Markdown, enlaces por su texto y tablas como frases.
function plTextoParaVoz(md) {
   var t = String(md).replace(/\r\n/g, "\n");
   t = t.replace(/```[\s\S]*?```/g, " (Te he preparado las llamadas.) ");
   t = t.split("\n").map(function (l) {
      var s = l.trim();
      if (/^\|?[\s|:\-]+\|?$/.test(s) && s.indexOf("-") >= 0) return "";            // separador de tabla
      if (s.charAt(0) == "|") return s.replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); }).join(", ") + ".";
      return s.replace(/^#+\s*/, "").replace(/^[-*•]\s+/, "").replace(/^>\s*/, "");
   }).join("\n");
   t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/https?:[^\s)]+/g, "").replace(/[*_`#]/g, "").replace(/\s*\n\s*/g, ". ").replace(/\.\s*\./g, ".");
   return t.replace(/\s+/g, " ").trim();
}

function plPowerShell(script, args) {
   var dir = plCarpeta(PL_TMP), f = dir + "/" + script.nombre + ".ps1";
   File.writeTextFile(f, script.codigo);
   var P = new ExternalProcess;
   P.workingDirectory = dir;
   P.start("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", f].concat(args));
   return P;
}

function plParar(P) {
   if (!P) return;
   try { if (P.isRunning && plEsWindows() && P.pid) ExternalProcess.execute("taskkill", ["/F", "/T", "/PID", String(P.pid)]); } catch (e) {}
   try { if (P.isRunning) P.kill(); } catch (e) {}
}

// Carpeta de miniaturas y página del chat. Se vacía al abrir el script, con «Limpiar» y con «Nueva conversación»
// (como el módulo). La página se carga desde un fichero: así las miniaturas (file:) se ven y no hay límite de tamaño.
function plCarpetaPrevias() { return plCarpeta(plCarpeta(PL_TMP) + "/previas"); }

function plBorrarTemporales() {
   try {
      var d = plCarpetaPrevias();
      searchDirectory(d + "/*.jpg", false).forEach(function (f) { try { File.remove(f); } catch (e) {} });
      searchDirectory(plCarpeta(PL_TMP) + "/chat*.html", false).forEach(function (f) { try { File.remove(f); } catch (e) {} });
   } catch (e) {}
}

// Cada página va a un fichero nuevo: el visor mantiene abierto el que está cargando y reescribirlo fallaba con
// «El proceso no tiene acceso al archivo» (Win32 32). Los anteriores se borran si se puede; si no, al limpiar.
var plPaginaN = 0, plPaginaAnterior = null;
function plMostrarPagina(wv, html) {
   var f = plCarpeta(PL_TMP) + "/chat_" + (++plPaginaN) + ".html";
   try { File.writeTextFile(f, html); }
   catch (e) { wv.setHTML(html); return; }   // sin fichero, al menos el texto (sin miniaturas)
   wv.loadContent(f);
   if (plPaginaAnterior) try { File.remove(plPaginaAnterior); } catch (e) {}
   plPaginaAnterior = f;
}

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
   // Controles con texto: se apuntan al crearlos para traducirlos (plAplicarIdioma).
   var controles = this.controlesTexto = [];
   function apuntado(nombre) {
      var K = PL_CLASES[nombre];
      return function (padre) { var c = arguments.length ? new K(padre) : new K(); controles.push({ c: c, clase: nombre }); return c; };
   }
   var Label = apuntado("Label"), PushButton = apuntado("PushButton"), CheckBox = apuntado("CheckBox"),
       GroupBox = apuntado("GroupBox"), Edit = apuntado("Edit"), TextBox = apuntado("TextBox"),
       SpinBox = apuntado("SpinBox"), ComboBox = apuntado("ComboBox");
   this.mensajes = [];            // { role: "user" | "assistant", content }
   this.registro = "";            // copia en texto plano del chat (pruebas)
   this.entradas = [];            // { tipo: user | asst | info | err, titulo, texto, hora } para el HTML
   this.pendiente = null;        // llamadas de la última respuesta, sin ejecutar
   this.ultimoError = null;
   this.correcciones = 0;
   this.estado = null;            // { cancelado } mientras se espera al modelo

   this.windowTitle = "PiAstroPilot Lite " + PL_VERSION;
   this.userResizable = true;

   // --- Pestaña Prompt ---
   var pPrompt = new Control(this);
   this.historialBox = new WebView(pPrompt);
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
   this.cInternet = new CheckBox(pPrompt);
   this.cInternet.text = "Internet";
   this.cInternet.toolTip = "Permitir búsquedas externas. Claude: WebSearch y WebFetch. Todos los modelos: SIMBAD, Wikipedia, páginas web " +
                            "e imágenes de catálogo (web.js). Sin marcar, nada sale a internet.";
   this.cInternet.checked = aj.internet;
   this.cInternet.onCheck = function (c) { aj.internet = c; aj.guardar(); };
   this.bLimpiar = new PushButton(pPrompt);
   this.bLimpiar.text = "Nueva conversación";
   this.bLimpiar.onClick = function () {
      self.mensajes = []; self.registro = ""; self.entradas = []; plBorrarTemporales();
      self.bienvenida(); self.ponerPendiente(null);
      self.ultimoError = null; self.correcciones = 0;
      self.usoSesion = null; self.actualizarUso();
   };
   this.bVaciar = new PushButton(pPrompt);
   this.bVaciar.text = "Limpiar";
   this.bVaciar.toolTip = "Vacía la ventana y borra las miniaturas temporales. El modelo conserva el contexto de la conversación.";
   this.bVaciar.onClick = function () {
      self.registro = ""; self.entradas = []; plBorrarTemporales();
      self.bienvenida();
   };
   this.estadoLbl = new Label(pPrompt);
   this.estadoLbl.text = plT("");
   // Modelo que se usará. Como en el módulo, el prompt libre no tiene paso: con «auto (pesos N)» va al modelo superior.
   this.eleccionLbl = new Label(pPrompt);
   this.usoLbl = new Label(pPrompt);
   this.usoLbl.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   this.usoLbl.toolTip = "Tokens de la conversación: entrada → salida (y coste con Claude). Se reinicia con «Nueva conversación».";
   var filaP = new HorizontalSizer; filaP.spacing = 6;
   filaP.add(this.eleccionLbl, 100); filaP.add(this.usoLbl);
   this.actualizarUso = function () {
      var S = this.usoSesion;
      this.usoLbl.text = plT(S && S.respuestas ? "Conversación: " + plUsoTexto(S.entrada || S.salida ? S : { total: S.total, coste: S.coste }) +
                                             " en " + S.respuestas + (S.respuestas == 1 ? " respuesta" : " respuestas") : "");
   };

   var filaB = new HorizontalSizer;
   filaB.spacing = 6;
   filaB.add(this.bEnviar); filaB.add(this.bCancelar); filaB.addSpacing(12);
   filaB.add(this.cInternet);
   filaB.addStretch(); filaB.add(this.bVaciar); filaB.add(this.bLimpiar);
   pPrompt.sizer = new VerticalSizer;
   pPrompt.sizer.margin = 6; pPrompt.sizer.spacing = 6;
   pPrompt.sizer.add(this.historialBox, 100);
   pPrompt.sizer.add(filaP);
   pPrompt.sizer.add(this.entrada);
   pPrompt.sizer.add(filaB);

   // Voz: leer respuestas y dictar el prompt.
   this.cVoz = new CheckBox(pPrompt);
   this.cVoz.text = "Leer en voz alta";
   this.cVoz.toolTip = "Lee cada respuesta del modelo con la voz de Windows (sin los bloques de llamadas).";
   this.cVoz.checked = aj.voz;
   this.cVoz.onCheck = function (c) { aj.voz = c; aj.guardar(); if (!c) self.pararVoz(); };
   this.bLeer = new PushButton(pPrompt);
   this.bLeer.text = "Leer";
   this.bLeer.toolTip = "Lee en voz alta la última respuesta del modelo.";
   this.bLeer.onClick = function () { self.leerUltima(); };
   this.bParar = new PushButton(pPrompt);
   this.bParar.text = "Parar voz";
   this.bParar.onClick = function () { self.pararVoz(); };
   this.sVel = new SpinBox(pPrompt);
   this.sVel.minValue = -10; this.sVel.maxValue = 10; this.sVel.value = aj.vozVelocidad;
   this.sVel.toolTip = "Velocidad de la voz (-10 lenta, 0 normal, 10 rápida).";
   this.sVel.onValueUpdated = function (v) { aj.vozVelocidad = v; aj.guardar(); };
   this.bDictar = new PushButton(pPrompt);
   this.bDictar.text = "Dictar";
   this.bDictar.toolTip = "Abre el dictado de Windows (Win + H) con el cursor en el prompt: lo que dices se escribe ahí. " +
                          "Necesita internet (lo procesa Microsoft). Para cerrarlo, Win + H o Esc.";
   this.bDictar.onClick = function () { self.dictar(); };
   var filaV = new HorizontalSizer; filaV.spacing = 6;
   var lVel = new Label(pPrompt); lVel.text = "Velocidad:"; lVel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   filaV.add(this.bDictar); filaV.addSpacing(12); filaV.add(this.cVoz); filaV.add(this.bLeer); filaV.add(this.bParar);
   filaV.addSpacing(8); filaV.add(lVel); filaV.add(this.sVel); filaV.addStretch();
   // Dossier e informe de la conversación.
   this.bDossier = new PushButton(pPrompt);
   this.bDossier.text = "Dossier PDF";
   this.bDossier.toolTip = "Guarda la conversación (respuestas, fichas de resultados y miniaturas) como PDF en la carpeta de dossieres (Ajustes).";
   this.bDossier.onClick = function () { self.crearDossier(); };
   this.bInforme = new PushButton(pPrompt);
   this.bInforme.text = "Informe .md";
   this.bInforme.toolTip = "Guarda un informe Markdown con las funciones usadas, los errores con sus llamadas y la conversación, para " +
                           "recopilar procesados y mejorar la guía.";
   this.bInforme.onClick = function () { self.crearInforme(); };
   filaV.add(this.bDossier); filaV.add(this.bInforme);
   pPrompt.sizer.add(filaV);
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
   this.cModelo.onEditTextUpdated = function () { aj.ponerModelo(self.cModelo.editText.trim()); if (self.eleccionLbl) self.actualizarEleccion(); };
   this.cModelo.onItemSelected = function (i) { aj.ponerModelo(self.cModelo.itemText(i)); if (self.eleccionLbl) self.rellenarPesos(); };
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

   // Pesos N (Claude / Codex con «auto (pesos N)»), como «Configurar IA» del módulo.
   var gPesos = new GroupBox(pModelo);
   gPesos.title = "Pesos N (Claude / Codex en «" + PL_AUTO + "»)";
   this.sN = new SpinBox(gPesos);
   this.sN.minValue = 0; this.sN.maxValue = 100; this.sN.value = aj.umbralN;
   this.sN.toolTip = "Umbral N: si la puntuación del paso es mayor que N se usa el modelo inferior; si es igual o menor, el superior. Por defecto 95.";
   this.sN.onValueUpdated = function (v) { aj.umbralN = v; self.rellenarPesos(); };
   this.eInf = new Edit(gPesos); this.eInf.setScaledMinWidth(120);
   this.eSup = new Edit(gPesos); this.eSup.setScaledMinWidth(120);
   this.eInf.onEditCompleted = function () { self.leerAjustes(); self.rellenarPesos(); };
   this.eSup.onEditCompleted = function () { self.leerAjustes(); self.rellenarPesos(); };
   var fN = new HorizontalSizer; fN.spacing = 6;
   var lN = new Label(gPesos); lN.text = "N:"; lN.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   var lI = new Label(gPesos); lI.text = "Modelo inferior:"; lI.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   var lS = new Label(gPesos); lS.text = "Modelo superior:"; lS.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   fN.add(lN); fN.add(this.sN); fN.addSpacing(12); fN.add(lI); fN.add(this.eInf); fN.addSpacing(12); fN.add(lS); fN.add(this.eSup); fN.addStretch();
   this.tPesos = new TreeBox(gPesos);
   this.tPesos.numberOfColumns = 5;
   this.tPesos.headerVisible = true;
   this.tPesos.rootDecoration = false;
   this.tPesos.alternateRowColor = true;
   ["Paso", "Base", "Ajuste", "Puntuación", "Modelo"].forEach(function (h, i) { self.tPesos.setHeaderText(i, h); });
   this.tPesos.setScaledMinHeight(260);
   this.tPesos.onCurrentNodeUpdated = function () {
      var n = self.tPesos.currentNode;
      if (n) { self.sAjuste.enabled = true; self.sAjuste.value = aj.ajuste(n.clave); }
   };
   this.sAjuste = new SpinBox(gPesos);
   this.sAjuste.minValue = -100; this.sAjuste.maxValue = 100; this.sAjuste.enabled = false;
   this.sAjuste.toolTip = "Ajuste tuyo de la puntuación del paso seleccionado (se suma al valor base). Se guarda en los ajustes de PixInsight, no en el json.";
   this.sAjuste.onValueUpdated = function (v) {
      var n = self.tPesos.currentNode;
      if (!n) return;
      aj.ponerAjuste(n.clave, v);
      self.rellenarPesos(n.clave);
   };
   this.bResetPesos = new PushButton(gPesos);
   this.bResetPesos.text = "Valores por defecto";
   this.bResetPesos.toolTip = "N = 95, sin ajustes, sonnet / opus (Codex: su modelo por defecto).";
   this.bResetPesos.onClick = function () {
      aj.umbralN = 95; aj.ajustesPesos = ""; aj.claudeInferior = "sonnet"; aj.claudeSuperior = "opus";
      aj.codexInferior = ""; aj.codexSuperior = "";
      self.sN.value = 95; self.rellenarPesos();
   };
   this.fuentePesos = new Label(gPesos);
   this.fuentePesos.wordWrapping = true;
   var fA = new HorizontalSizer; fA.spacing = 6;
   var lA = new Label(gPesos); lA.text = "Ajuste del paso seleccionado:"; lA.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   fA.add(lA); fA.add(this.sAjuste); fA.addStretch(); fA.add(this.bResetPesos);
   gPesos.sizer = new VerticalSizer;
   gPesos.sizer.margin = 6; gPesos.sizer.spacing = 6;
   gPesos.sizer.add(fN); gPesos.sizer.add(this.tPesos, 100); gPesos.sizer.add(fA); gPesos.sizer.add(this.fuentePesos);
   pModelo.sizer.add(gPesos, 100);
   pModelo.sizer.addStretch();
   this.gPesos = gPesos;

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
   this.eInformes = fila("Carpeta de dossieres:", aj.carpetaInformes, "Donde se guardan el dossier PDF y el informe .md de la conversación.");
   this.cIdioma = new ComboBox(pAj);
   this.cIdioma.addItem("Español"); this.cIdioma.addItem("English");
   this.cIdioma.currentItem = aj.idioma == "en" ? 1 : 0;
   this.cIdioma.toolTip = "Idioma de la ventana y de las respuestas del modelo.";
   this.cIdioma.onItemSelected = function (i) { self.cambiarIdioma(i == 1 ? "en" : "es"); };
   var lIdioma = new Label(pAj); lIdioma.text = "Idioma:"; lIdioma.setScaledMinWidth(150); lIdioma.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   var fIdioma = new HorizontalSizer; fIdioma.spacing = 6; fIdioma.add(lIdioma); fIdioma.add(this.cIdioma); fIdioma.addStretch();
   pAj.sizer.add(fIdioma);
   this.bGuardar = new PushButton(pAj);
   this.bGuardar.text = "Guardar ajustes";
   this.bGuardar.onClick = function () { self.leerAjustes(); aj.guardar(); self.estadoLbl.text = plT("Ajustes guardados."); };
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
   this.onHide = function () {
      if (self.tEnlaces) self.tEnlaces.stop();
      if (self.tDictado) self.tDictado.stop();
      plParar(self.pVoz); plParar(self.pDictado);
      self.leerAjustes(); aj.guardar();
   };
   // Idioma: los textos fijos se guardan en español la primera vez y se traducen con plT. Los que cambian solos
   // (estado, tokens, modelo elegido, notas) se traducen donde se escriben y se rehacen aquí.
   var dinamicos = [this.estadoLbl, this.usoLbl, this.eleccionLbl, this.notaModelo, this.fuentePesos];
   this.aplicarIdioma = function () {
      controles.forEach(function (o) {
         if (!o.es) o.es = { text: /^(Label|PushButton|CheckBox)$/.test(o.clase) && dinamicos.indexOf(o.c) < 0 ? o.c.text : null,
                             toolTip: o.c.toolTip, title: o.clase == "GroupBox" ? o.c.title : null };
         if (o.es.text) o.c.text = plT(o.es.text);
         if (o.es.toolTip) o.c.toolTip = plT(o.es.toolTip);
         if (o.es.title) o.c.title = plT(o.es.title);
      });
      ["Prompt", "Modelo", "Ajustes"].forEach(function (t, i) { self.tabs.setPageLabel(i, plT(t)); });
      ["Paso", "Base", "Ajuste", "Puntuación", "Modelo"].forEach(function (h, i) { self.tPesos.setHeaderText(i, plT(h)); });
   };
   this.cambiarIdioma = function (idioma) {
      aj.idioma = idioma; PL_EN = idioma == "en"; aj.guardar();
      this.aplicarIdioma();
      if (!this.estado) { this.rellenarModelos(false); this.actualizarUso(); }
      if (!this.conversacion().length) { this.entradas = []; this.registro = ""; this.bienvenida(); }
      this.estadoLbl.text = plT("Idioma cambiado.");
   };
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
      var ci = this.eInformes.text.trim().replace(/\\/g, "/").replace(/[\/]+$/, "");
      if (ci) aj.carpetaInformes = ci;
      var m = this.cModelo.editText.trim();
      if (m || aj.proveedor != "ollama") aj.ponerModelo(m);
      aj.umbralN = this.sN.value;
      if (aj.proveedor == "codex") { aj.codexInferior = this.eInf.text.trim(); aj.codexSuperior = this.eSup.text.trim(); }
      else if (aj.proveedor == "claude") {
         aj.claudeInferior = this.eInf.text.trim() || "sonnet"; aj.claudeSuperior = this.eSup.text.trim() || "opus";
      }
   };

   // Lite no tiene botones de paso: todo es prompt libre (en el módulo, StartJob de Prompt sin clave de paso).
   this.pasoActual = function () { return ""; };

   // Línea bajo el chat con el modelo que se usará para el paso elegido y por qué.
   this.actualizarEleccion = function () {
      var e = plElegirModelo(aj, this.pasoActual());
      this.eleccionLbl.text = plT(aj.proveedor == "ollama" ? "Ollama · " + aj.modeloOllama + "  (los pesos N no se aplican)" :
         "Modelo: " + (e.modelo || "(por defecto de la CLI)") + (e.porque ? "  —  " + e.porque : ""));
   };

   // Tabla de pesos con la puntuación (base + ajuste) y el modelo que saldría con N.
   this.rellenarPesos = function (seleccionar) {
      var pb = plPesosBase(aj.guia), bajo, alto;
      var cod = aj.proveedor == "codex";
      bajo = cod ? aj.codexInferior : aj.claudeInferior; alto = cod ? aj.codexSuperior : aj.claudeSuperior;
      this.eInf.text = bajo; this.eSup.text = alto;
      var activos = aj.proveedor != "ollama";
      this.eInf.enabled = this.eSup.enabled = activos;
      this.gPesos.visible = activos;   // con Ollama no se aplican: se oculta la tabla
      this.tPesos.clear();
      var sel = null;
      PL_PASOS.forEach(function (p) {
         var n = new TreeBoxNode(self.tPesos), base = pb.tabla[p[1]], aju = aj.ajuste(p[1]);
         n.clave = p[1];
         n.setText(0, p[0]);
         n.setText(1, base === undefined ? "—" : String(base));
         n.setText(2, aju ? (aju > 0 ? "+" : "") + aju : "");
         if (base === undefined) { n.setText(3, "—"); n.setText(4, plT("superior (sin valor)")); }
         else {
            var nota = base + aju, inf = nota > aj.umbralN;
            n.setText(3, String(nota));
            n.setText(4, plT((inf ? "inferior" : "superior") + " (" + ((inf ? bajo : alto) || "por defecto") + ")"));
         }
         if (seleccionar && p[1] == seleccionar) sel = n;
      });
      for (var c = 0; c < 5; ++c) this.tPesos.adjustColumnWidthToContents(c);
      if (sel) this.tPesos.currentNode = sel; else this.sAjuste.enabled = false;
      this.fuentePesos.text = plT("Base: " + pb.fuente + ". Como en el módulo, el Prompt libre usa el modelo superior; la tabla decide en los pasos." +
                              (aj.modelo() == PL_AUTO || !activos ? "" : "  (Ahora el modelo está fijado a mano: la tabla no se aplica.)"));
      this.actualizarEleccion();
   };

   this.rellenarModelos = function (avisar) {
      var actual = aj.modelo(), lista = [];
      this.cModelo.clear();
      this.bTags.enabled = aj.proveedor == "ollama";
      this.cPensar.enabled = aj.proveedor == "ollama";
      if (aj.proveedor == "ollama") {
         this.leerAjustes(); aj.ponerModelo(actual);
         try { lista = plOllamaModelos(aj); this.notaModelo.text = plT(lista.length + " modelos en Ollama."); }
         catch (e) { this.notaModelo.text = plT(String(e.message || e)); if (avisar) this.estadoLbl.text = plT(this.notaModelo.text); }
      } else if (aj.proveedor == "claude") {
         lista = [PL_AUTO, "", "sonnet", "opus", "haiku"];
         this.notaModelo.text = plT("«" + PL_AUTO + "» = elige inferior o superior según el paso (tabla de abajo). " +
                                "Vacío = el modelo por defecto de Claude Code. Se lanza «claude -p» sin herramientas ni MCP.");
      } else {
         lista = [PL_AUTO, ""];
         this.notaModelo.text = plT("«" + PL_AUTO + "» = elige inferior o superior según el paso. Vacío = el modelo por " +
                                "defecto de Codex. Se lanza «codex exec» en modo solo lectura.");
      }
      if (lista.indexOf(actual) < 0) lista.unshift(actual);
      lista.forEach(function (m) { self.cModelo.addItem(m); });
      this.cModelo.currentItem = lista.indexOf(actual);
      this.cModelo.editText = actual;
      this.rellenarPesos();
   };

   // tipo: user (tu mensaje), asst (respuesta del modelo, en Markdown), err (error) o info (resultados y avisos).
   this.anotar = function (quien, texto, tipo) {
      this.registro += "── " + quien + " ──\n" + texto + "\n\n";
      var d = new Date(), hora = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
      this.entradas.push({ tipo: tipo || "info", titulo: quien, texto: String(texto), hora: hora });
      plMostrarPagina(this.historialBox, plPagina(this.entradas));
      plEventos();
   };

   // --- Dossier e informe ---
   this.baseInforme = function () {
      this.leerAjustes();
      var di = plDatosImagen(), nombre = plSello() + "_" + (di.objeto || di.vista || "piastropilot").replace(/[^A-Za-z0-9_-]+/g, "_");
      return plCarpeta(aj.carpetaInformes) + "/" + nombre;
   };
   this.conversacion = function () { return this.entradas.filter(function (e) { return !e.bienvenida; }); };
   this.crearInforme = function () {
      if (!this.conversacion().length) { this.estadoLbl.text = plT("No hay conversación que guardar."); return null; }
      var f = this.baseInforme() + ".md";
      try { File.writeTextFile(f, plInformeMd(this.conversacion(), aj, this.usoSesion)); this.estadoLbl.text = plT("Informe guardado: " + f); return f; }
      catch (e) { this.estadoLbl.text = plT("No se pudo guardar el informe: " + (e.message || e)); return null; }
   };
   this.crearDossier = function (alTerminar) {
      if (!this.conversacion().length) { this.estadoLbl.text = plT("No hay conversación que guardar."); return; }
      var base = this.baseInforme(), di = plDatosImagen(), S = this.usoSesion;
      var cab = "<div class=\"portada\"><h1>Dossier de procesado" + (di.objeto ? " — " + plEsc(di.objeto) : "") + "</h1>" +
                "<p>" + plEsc(plSello().replace("_", " ")) + " · vista " + plEsc(di.vista || "—") + " · modelo " + plEsc(aj.proveedor + " " + (aj.modelo() || "")) +
                (S && S.respuestas ? " · " + plEsc(plUsoTexto(S.entrada || S.salida ? S : { total: S.total, coste: S.coste })) : "") + "</p>" +
                "<p>PiAstroPilot Lite " + PL_VERSION + " · guía " + plEsc(aj.guia) + "</p></div>";
      var html = plPagina(this.conversacion(), { claro: true, cabecera: cab }), fh = base + ".html", fp = base + ".pdf";
      File.writeTextFile(fh, html);
      // Un visor aparte (oculto) carga la página desde fichero, para que salgan las miniaturas, y la guarda en PDF.
      if (!this.wvPdf) { this.wvPdf = new WebView(this); this.wvPdf.setFixedSize(900, 1200); this.wvPdf.hide(); }
      var wv = this.wvPdf;
      this.estadoLbl.text = plT("Generando el dossier en PDF…");
      wv.onLoadFinished = function () {
         var t = new Timer; t.interval = 1; t.periodic = false;
         t.onTimeout = function () {
            try { wv.saveAsPDF(fp); self.estadoLbl.text = plT("Dossier guardado: " + fp + " (y la página en .html)"); }
            catch (e) { self.estadoLbl.text = plT("No se pudo crear el PDF (" + (e.message || e) + "); queda la página en " + fh); }
            if (alTerminar) alTerminar(fp);
         };
         t.start();
      };
      wv.loadContent(fh);
   };

   // --- Voz ---
   this.pVoz = null; this.pDictado = null; this.tDictado = null;
   this.hablar = function (texto) {
      this.pararVoz();
      var t = plTextoParaVoz(texto);
      if (!t) return;
      var f = plCarpeta(PL_TMP) + "/voz.txt", vel = aj.vozVelocidad || 0;
      File.writeTextFile(f, t);
      try {
         if (plEsWindows()) this.pVoz = plPowerShell({ nombre: "hablar", codigo: PL_PS_HABLAR }, [f, String(vel), "es-ES"]);
         else {
            // macOS: «say» (voz del sistema; palabras por minuto). Linux: «spd-say» de speech-dispatcher, si está instalado.
            var P = new ExternalProcess;
            if (plEsMac()) P.start("/usr/bin/say", ["-r", String(Math.round(175 + 15 * vel)), "-f", f]);
            else P.start("spd-say", ["-w", "-l", "es", "-r", String(10 * vel), t]);
            this.pVoz = P;
         }
      }
      catch (e) { this.estadoLbl.text = plT("No se pudo lanzar la voz: " + (e.message || e)); }
   };
   this.pararVoz = function () { plParar(this.pVoz); this.pVoz = null; };
   this.leerUltima = function () {
      for (var i = this.entradas.length - 1; i >= 0; --i)
         if (this.entradas[i].tipo == "asst") { this.hablar(this.entradas[i].texto); return; }
   };
   this.dictar = function () {
      if (!plEsWindows()) {   // en macOS se abre a mano; en Linux no hay dictado del sistema
         this.estadoLbl.text = plT(plEsMac() ? "Dictado de macOS: haz clic en el prompt y pulsa dos veces la tecla Fn (o 🌐); habla y pulsa Enviar."
                                         : "Dictado: no hay dictado del sistema en Linux; escribe el prompt.");
         return;
      }
      if (!aj.dictadoAntiguo) {   // dictado de Windows 11 (Win + H): escribe en el prompt
         this.pararVoz();
         // PJSR no tiene focus(): se prueba con las propiedades que existen; si no, basta con hacer clic en el prompt.
         try { this.childToFocus = this.entrada; } catch (e) {}
         try { this.entrada.hasFocus = true; } catch (e) {}
         try { plPowerShell({ nombre: "dictado_windows", codigo: PL_PS_WINH }, []); }
         catch (e) { this.estadoLbl.text = plT("No se pudo abrir el dictado de Windows: " + (e.message || e)); return; }
         this.estadoLbl.text = plT("Dictado de Windows abierto: haz clic en el prompt si el cursor no está ahí y habla. Para cerrarlo, Win + H o Esc.");
         return;
      }
      if (this.pDictado && this.pDictado.isRunning) {   // segunda pulsación: parar y quedarse con lo que haya
         plParar(this.pDictado); this.pDictado = null;
         if (this.tDictado) this.tDictado.stop();
         this.bDictar.text = plT("Dictar"); this.estadoLbl.text = plT("Dictado cancelado.");
         return;
      }
      this.pararVoz();
      var out = plCarpeta(PL_TMP) + "/dictado.txt";
      if (File.exists(out)) File.remove(out);
      try { this.pDictado = plPowerShell({ nombre: "dictar", codigo: PL_PS_DICTAR }, [out, "es-ES"]); }
      catch (e) { this.estadoLbl.text = plT("No se pudo lanzar el dictado: " + (e.message || e)); return; }
      this.bDictar.text = plT("Escuchando… (parar)");
      this.estadoLbl.text = plT("Habla ahora: el dictado termina cuando dejas de hablar unos segundos.");
      if (!this.tDictado) {
         this.tDictado = new Timer; this.tDictado.interval = 0.3; this.tDictado.periodic = true;
         this.tDictado.onTimeout = function () {
            var P = self.pDictado;
            if (P && P.isRunning) return;
            self.tDictado.stop(); self.pDictado = null; self.bDictar.text = plT("Dictar");
            var txt = File.exists(out) ? File.readTextFile(out).replace(/^﻿/, "").trim() : "";
            if (txt.indexOf("ERROR:") == 0) { self.estadoLbl.text = plT("Dictado: " + txt); return; }
            if (!txt) { self.estadoLbl.text = plT("No he oído nada (¿micrófono?)."); return; }
            var actual = self.entrada.text.trim();
            self.entrada.text = actual ? actual + " " + txt : txt;
            self.estadoLbl.text = plT("Dictado añadido al prompt: revísalo y pulsa Enviar.");
         };
      }
      this.tDictado.start();
   };

   this.ponerPendiente = function (s) {
      this.pendiente = s;
   };

   this.ocupado = function (si) {
      this.bEnviar.enabled = !si; this.bCancelar.enabled = si;
      this.cProv.enabled = !si;
   };

   this.consultar = function () {
      var interpretando = this.interpretando;   // interpretación de un resultado: sus llamadas no se ejecutan solas
      this.interpretando = false;
      this.leerAjustes();
      this.estado = { cancelado: false };
      this.ocupado(true);
      var e0 = plElegirModelo(aj, this.pasoEnviado || "");
      var nombre = { ollama: "Ollama", claude: "Claude", codex: "Codex" }[aj.proveedor] +
                   " · " + (e0.modelo || "modelo por defecto") + (e0.porque ? " — " + e0.porque : "");
      this.estadoLbl.text = plT("Esperando a " + nombre + "…");
      var t0 = Date.now(), resp = null;
      try {
         resp = plPreguntar(aj, this.mensajes, this.estado, this.pasoEnviado || "");
         var uso = resp.uso;
         resp = resp.texto;
         // Consumo: el de esta respuesta va en su título y el total de la conversación en la línea de abajo del chat.
         if (uso) {
            var S = this.usoSesion || (this.usoSesion = { entrada: 0, salida: 0, total: 0, coste: 0, respuestas: 0 });
            S.entrada += uso.entrada || 0; S.salida += uso.salida || 0; S.coste += uso.coste || 0;
            S.total += uso.total !== undefined ? uso.total : (uso.entrada || 0) + (uso.salida || 0); ++S.respuestas;
            this.usoUltimo = uso;
         } else this.usoUltimo = null;
      } catch (e) {
         this.anotar("Error", String(e.message || e), "err");
      }
      var cancelado = this.estado.cancelado;
      this.estado = null;
      this.ocupado(false);
      this.estadoLbl.text = plT(resp !== null ? "Respuesta en " + ((Date.now() - t0) / 1000).toFixed(1) + " s" +
                            (this.usoUltimo ? " · " + plUsoTexto(this.usoUltimo) : "") + "." : (cancelado ? "Cancelado." : ""));
      this.actualizarUso();
      if (resp === null) {   // la pregunta no obtuvo respuesta: no queda en el historial
         var q = this.mensajes.pop();
         // Si era la interpretación, el resultado de las llamadas sí se queda para el turno siguiente.
         if (interpretando && q) this.mensajes.push({ role: "user", content: q.content }, { role: "assistant", content: "Visto." });
         return;
      }
      this.mensajes.push({ role: "assistant", content: resp });
      this.anotar("PiAstroPilot (" + nombre + ")" + (this.usoUltimo ? " · " + plUsoTexto(this.usoUltimo) : ""), resp, "asst");
      if (this.cVoz.checked) this.hablar(resp);
      var s = plExtraerLlamadas(resp);
      // Si la corrección trae las mismas llamadas que ya fallaron, no se ejecutan otra vez: se piden otras.
      if (s && this.scriptFallido && s.replace(/\s+/g, "") == this.scriptFallido.replace(/\s+/g, "")) {
         this.ponerPendiente(null);
         this.repetido = true;
         this.anotar("Aviso", "El modelo ha devuelto las mismas llamadas que ya fallaron; no las ejecuto.", "err");
         var quedan = this.correcciones < PL_MAX_CORRECCIONES;
         this.estadoLbl.text = plT(quedan ? "Llamadas repetidas. Pido otra corrección." : "Llamadas repetidas; revisa la petición.");
         if (quedan) this.pedirCorreccion();
         return;
      }
      this.ponerPendiente(s);
      if (cancelado) this.serie = false;
      if (interpretando && this.serie) {
         if (/(^|\n)\s*\**PARO:/i.test(resp) || !s) {
            this.serie = false;
            this.anotar("Serie de pasos", "Terminada (" + (this.pasosSerie || 0) + " pasos): " +
                        (s ? "" : "el modelo ha parado; contesta a lo que pregunta y escribe «sigue» para continuar."));
         } else if ((this.pasosSerie || 0) >= PL_MAX_SERIE) {
            this.serie = false;
            this.anotar("Serie de pasos", "Tope de " + PL_MAX_SERIE + " pasos: escribe «sigue hasta el final» para continuar.");
         } else {
            ++this.pasosSerie;
            this.anotar("Serie de pasos", "Paso " + this.pasosSerie + ": ejecuto el siguiente sin esperar (Cancelar para parar).");
            this.ejecutarPendiente();
            return;
         }
      }
      // Las llamadas se ejecutan solas (Rafael, 9 nov 2026). Las de una interpretación (el paso siguiente) esperan al
      // enlace «Siguiente paso», para que el usuario revise cada resultado antes de seguir (salvo en una serie de pasos).
      if (s && !interpretando) this.ejecutarPendiente();
   };

   this.enviar = function () {
      if (this.estado) return;
      var t = this.entrada.text.trim();
      if (!t) return;
      this.entrada.text = "";
      this.enviarTexto(t);
   };

   this.enviarTexto = function (t) {
      this.correcciones = 0;
      this.ultimoError = null;
      this.scriptFallido = null; this.repetido = false;
      this.pasoEnviado = this.pasoActual();   // las correcciones siguientes usan el mismo paso
      // Serie de pasos SIEMPRE (Rafael, 11 nov 2026: como si «Ejecutar sin preguntar» estuviera marcada): tras cada
      // resultado, el paso siguiente que pide el modelo para cumplir la petición se ejecuta solo. Paradas: «PARO:», el
      // modelo no pide llamadas (petición de un paso o una pregunta), Cancelar, 3 fallos seguidos, exportar o el tope.
      // «sigue» continúa la misma serie (mismo objetivo y cuenta de pasos).
      if (/^\s*(sigue|contin[uú]a|continue|go on)\b/i.test(t) && this.objetivoSerie) this.serie = true;
      else { this.serie = true; this.pasosSerie = 0; this.objetivoSerie = t; }
      this.mensajes.push({ role: "user", content: t });
      this.anotar(plT("Tú"), t, "user");
      this.consultar();
   };

   this.ejecutarPendiente = function () {
      if (!this.pendiente || this.estado) return;
      var s = this.pendiente;
      this.ponerPendiente(null);
      this.estadoLbl.text = plT("Ejecutando llamadas…");
      plEventos();
      var r = plEjecutarLlamadas(aj, s);
      this.anotar(r.ok ? "Resultado (" + r.segundos.toFixed(1) + " s)" : "Error al ejecutar", r.texto, r.ok ? "info" : "err");
      if (this.serie && r.ok && /"exportarFinal"/.test(s)) {   // exportado: fin del procesado
         this.serie = false;
         this.anotar("Serie de pasos", "Terminada tras exportar (" + (this.pasosSerie || 0) + " pasos).");
      }
      // Como en el módulo: un resultado con datos se manda al modelo para que lo interprete y recomiende el paso
      // siguiente, con las líneas «Siguiente paso: ...» que el chat pinta como enlaces.
      if (r.ok && r.texto != "(sin salida)") {
         this.correcciones = 0; this.ultimoError = null; this.scriptFallido = null;
         var enSerie = this.serie && (this.pasosSerie || 0) < PL_MAX_SERIE;
         this.mensajes.push({ role: "user", content: "Las llamadas han terminado sin errores. Resultado:\n" + r.texto +
            (enSerie
              ? "\nSERIE DE PASOS EN MARCHA (el usuario pidió: «" + this.objetivoSerie + "»; pasos hechos en la serie: " +
                this.pasosSerie + "). Haz el resumen del paso CORTO (como mucho 10 líneas: «Medido» y «Revisar a ojo»). " +
                "Después, en la misma respuesta, pide las llamadas del SIGUIENTE paso que falte (UNO solo, en el ORDEN DE LA " +
                "GUÍA, con los ids de vista que acaba de devolver este resultado) en un único bloque ```json: se ejecutarán sin " +
                "esperar al usuario, así que no le preguntes si sigue. Si un no_cumple ya dice el arreglo de la guía (aplicar una " +
                "función o volver a un paso anterior), pídelo tú en el bloque ```json SIN parar ni preguntar. Si ya están hechos " +
                "todos los pasos pedidos, o hay una decisión que es del usuario (tipo de objeto dudoso, paleta, elegir entre los " +
                "candidatos de estirarEstrellasCandidatos, colorCandidatos o nitidezCandidatos, un arreglo de la " +
                "guía que ya falló dos veces), NO pidas llamadas: escribe una línea que empiece por «PARO:» con el motivo."
              : "\nAhora, sin pedir ninguna llamada, interpreta estos datos según la guía y da el resumen del paso. No inventes " +
                "datos que no estén en el resultado. Separa los controles en dos listas: «Medido» (sólo lo que el resultado " +
                "demuestra, con su valor) y «Revisar a ojo» (lo que el resultado no mide); nunca des por bueno algo de la segunda.\n" +
                "Termina con una línea «Siguiente paso: <qué hacer y con qué función de la guía>.» con el paso siguiente en el ORDEN DE LA GUÍA " +
                "(lista «Orden de los pasos» del principio) y la función exacta de ese paso según la lista de funciones (cada función dice su paso), " +
                "y si hay alternativas razonables, una lista de líneas que empiecen por «Paso N: ...» (N = número del paso en la guía). " +
                "Cada una es un enlace que el usuario pulsará para que la hagas.") });
         this.anotar("Interpretar el resultado", "Pidiendo al modelo que interprete el resultado y recomiende el paso siguiente…");
         this.interpretando = true;
         this.consultar();
         return;
      }
      // El resultado entra en la conversación para que el modelo lo tenga en cuenta en el siguiente turno.
      this.mensajes.push({ role: "user", content: (r.ok ? "Resultado de tus llamadas:\n" : "Tus llamadas han fallado:\n") + r.texto });
      this.mensajes.push({ role: "assistant", content: r.ok ? "Visto." : "Entendido, lo reviso si me lo pides." });
      if (r.ok) {
         this.correcciones = 0; this.ultimoError = null; this.scriptFallido = null; this.estadoLbl.text = plT("Llamadas ejecutadas.");
      } else {
         this.ultimoError = r.texto;
         this.scriptFallido = s;
         var quedan = this.correcciones < PL_MAX_CORRECCIONES;
         this.estadoLbl.text = plT(quedan ? "Las llamadas han fallado. Pido la corrección al modelo." :
                               "Las llamadas han fallado " + PL_MAX_CORRECCIONES + " veces seguidas; revisa la petición.");
         if (!quedan && this.serie) {
            this.serie = false;
            this.anotar("Serie de pasos", "Parada: " + PL_MAX_CORRECCIONES + " fallos seguidos. Escribe «sigue» cuando lo revises.");
         }
         if (quedan) this.pedirCorreccion();
      }
   };

   this.pedirCorreccion = function () {
      if (!this.ultimoError || this.estado || this.correcciones >= PL_MAX_CORRECCIONES) return;
      ++this.correcciones;
      // Sustituye el par «ha fallado / entendido» (o «corrección / llamadas repetidas») por la petición de corrección.
      this.mensajes.pop(); this.mensajes.pop();
      var t = "Las llamadas han fallado con este error:\n" + this.ultimoError +
              (this.repetido ? "\nTu última respuesta repetía exactamente las mismas llamadas. Pide otras que " +
                               "quiten la causa del error." : "") +
              "\nRevisa los ids (sólo los de la lista de vistas abiertas, tal cual), los nombres de las funciones y de sus " +
              "parámetros. Corrígelo y devuelve las llamadas en un único bloque ```json, sin código.";
      this.repetido = false;
      this.mensajes.push({ role: "user", content: t });
      this.anotar("Corrección " + this.correcciones + "/" + PL_MAX_CORRECCIONES, "Reenviando el error al modelo…");
      this.consultar();
   };

   // Enlaces de paso: un temporizador lee window.plClick de la página («mensaje|texto»).
   this.pasoPulsado = function (v) {
      var barra = String(v || "").indexOf("|");
      if (barra < 0) return;
      var texto = String(v).substring(barra + 1).trim(), indice = parseInt(String(v).substring(0, barra), 10);
      if (!texto) return;
      if (this.estado) { this.anotar("Aviso", "Espera a que termine lo que está en marcha antes de pulsar otro paso."); return; }
      var ultimo = -1;
      for (var i = 0; i < this.entradas.length; ++i) if (this.entradas[i].tipo == "asst") ultimo = i;
      // El enlace del último mensaje con llamadas sin ejecutar son esas llamadas: se ejecutan tal cual.
      if (indice === ultimo && this.pendiente) { this.anotar("Paso", ">>> Ejecuto el paso: " + texto); this.ejecutarPendiente(); return; }
      this.enviarTexto(plT("Haz ahora este paso: ") + texto);
   };
   this.historialBox.onScriptResultAvailable = function (r) {
      var v = r === undefined || r === null ? "" : String(r);
      if (v && v.indexOf("|") > 0) self.pasoPulsado(v);
   };
   this.tEnlaces = new Timer;
   this.tEnlaces.interval = 0.3;
   this.tEnlaces.periodic = true;
   this.tEnlaces.onTimeout = function () {
      if (self.estado) return;
      try { self.historialBox.evaluateScript("(function(){var x=(typeof plClick==='string')?plClick:'';plClick='';return x;})();"); } catch (e) {}
   };
   this.tEnlaces.start();

   plBorrarTemporales();   // al abrir: miniaturas de sesiones anteriores fuera
   this.rellenarModelos(false);
   this.bienvenida = function () {   // no entra en el dossier ni en el informe
      this.anotar("PiAstroPilot Lite", plBienvenida(aj), "asst");
      this.entradas[this.entradas.length - 1].bienvenida = true;
   };
   this.aplicarIdioma();
   this.bienvenida();
}

// Mensaje de inicio del Prompt (texto de Rafael, 9 nov 2026); también tras «Limpiar» y «Nueva conversación».
function plBienvenida(aj) {
   if (PL_EN)
      return "**PiAstroPilot Lite** is an artificial intelligence assistant specialised in astrophotography that works " +
             "inside PixInsight.\n\n" +
             "My goal is to guide you and run concrete steps of the processing guide, both in the **linear phase** " +
             "(calibration, alignment, corrections) and in the **non-linear** one (stretching, colour, sharpening, export).\n\n" +
             "### What exactly do I do?\n\n" +
             "- **I analyse:** I identify the object (SIMBAD/Wikipedia), check headers, measure statistics and detect " +
             "problems (edges, gradient, noise).\n" +
             "- **I run:** I can launch the guide's functions (WBPP, BXT, SPCC, StarXTerminator, method comparisons, etc.), " +
             "always working on copies and measuring results before and after. I never write code: I only ask for guide functions.\n" +
             "- **I recommend:** I propose the next logical step according to the guide, comparing methods when possible " +
             "(e.g. GraXpert vs. MGC for the gradient) and showing you the metrics.\n\n" +
             "### How do you use it?\n\n" +
             "- You tell me which image you have (or simply «the image on screen») and which object it is.\n" +
             "- I answer with information, an analysis or the guide functions I want to run.\n" +
             "- I always work on copies: I do not modify your original views unless you explicitly ask.\n" +
             "- The guide functions I ask for run on their own and I explain the result.\n" +
             "- If you ask for several steps or the full processing, I chain them without asking: after each result I run " +
             "the next one in the guide's order, and I only stop when it is done, when something needs your decision, or " +
             "if you press «Cancel». «go on» continues where I stopped.\n" +
             "- The «Next step» links run that step with one click.\n\n" +
             "Guide: `" + aj.guia + "`";
   return "**PiAstroPilot Lite** es un asistente de inteligencia artificial especializado en astrofotografía que funciona " +
          "dentro de PixInsight.\n\n" +
          "Mi objetivo es guiarte y ejecutar pasos concretos de la guía de procesado, tanto en la **fase lineal** " +
          "(calibración, alineación, correcciones) como en la **no lineal** (estirado, color, nitidez, exportación).\n\n" +
          "### ¿Qué hago exactamente?\n\n" +
          "- **Analizo:** identifico el objeto (SIMBAD/Wikipedia), reviso cabeceras, mido estadísticas y detecto " +
          "problemas (bordes, gradiente, ruido).\n" +
          "- **Ejecuto:** puedo lanzar las funciones de la guía (WBPP, BXT, SPCC, StarXTerminator, comparaciones de métodos, etc.), " +
          "siempre trabajando sobre copias y midiendo resultados antes y después. Nunca escribo código: sólo pido funciones de la guía.\n" +
          "- **Recomiendo:** te propongo el siguiente paso lógico según la guía, comparando métodos cuando sea posible " +
          "(ej. GraXpert vs. MGC para gradiente) y mostrándote las métricas.\n\n" +
          "### ¿Cómo se usa?\n\n" +
          "- Tú me dices qué imagen tienes (o simplemente «la imagen en pantalla») y qué objeto es.\n" +
          "- Yo te respondo con información, análisis o las funciones de la guía que quiero ejecutar.\n" +
          "- Siempre trabajo sobre copias: no modifico tus vistas originales sin que lo pidas explícitamente.\n" +
          "- Las funciones de la guía que pido se ejecutan solas y te explico el resultado.\n" +
          "- Si me pides varios pasos o el procesado completo, los encadeno sin preguntar: tras cada resultado hago el " +
          "siguiente en el orden de la guía y sólo paro al terminar, si algo necesita tu decisión o si pulsas «Cancelar». " +
          "«sigue» continúa donde me paré.\n" +
          "- Los enlaces «Siguiente paso» hacen ese paso con un clic.\n\n" +
          "Guía: `" + aj.guia + "`";
}

// ---------------------------------------------------------------------------------------------------------------
// Pruebas sin diálogo:  PixInsight.exe -x=<ruta>/PiAstroPilotLite.js,--prueba[,<salida.json>]
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
      console.writeln("[PiAstroPilotLite prueba] " + nombre + ": " + JSON.stringify(r.pasos[nombre]).substring(0, 400));
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
      // Abre el diálogo y simula al usuario: guardar ajustes, preguntar y cerrar.
      var d = new PLDialogo(aj), tm = new Timer, out = {};
      tm.interval = 1.5; tm.periodic = false;
      tm.onTimeout = function () {
         try {
            d.bGuardar.onClick();
            out.estado = d.estadoLbl.text;
            d.entrada.text = "¿Qué imágenes tengo abiertas? Usa vistas().";
            d.enviar();
            out.registro = d.registro;
            // Pestaña Modelo con Claude en auto: tabla de pesos y elección para un paso.
            var prov = aj.proveedor, mod = aj.modeloClaude;
            d.cProv.currentItem = 1; d.cProv.onItemSelected(1);
            d.cModelo.editText = PL_AUTO; d.leerAjustes(); d.rellenarPesos();
            out.pesos = { filas: d.tPesos.numberOfChildren, fuente: d.fuentePesos.text, eleccionClaude: d.eleccionLbl.text };
            out.pesos.visibleClaude = d.gPesos.visible;
            aj.modeloClaude = mod;
            var ip = ["ollama", "claude", "codex"].indexOf(prov);
            d.cProv.currentItem = ip; d.cProv.onItemSelected(ip);
            out.pesos.visibleTrasVolver = d.gPesos.visible;
            out.pesos.eleccionOllama = d.eleccionLbl.text;
            // Enlace de paso: se simula el clic dejando plClick en la página; el temporizador debe recogerlo.
            out.enlaceHtml = plMarkdown("Siguiente paso: gradiente con gradienteCandidatos. Después, color.").indexOf("class=\"step\"") >= 0;
            out.entradasChat = d.entradas.map(function (e) { return e.tipo + ": " + e.titulo; });
            // Idioma: a inglés y vuelta al que hubiera.
            var idAntes = aj.idioma, ent = d.entradas, reg = d.registro;
            d.entradas = []; d.cambiarIdioma("en");
            out.idioma = { enviar: d.bEnviar.text, pestana: d.tabs.pageLabel(2), tooltip: d.bVaciar.toolTip, grupo: d.gPesos.title,
                           eleccion: d.eleccionLbl.text, bienvenida: d.entradas.length ? d.entradas[0].texto.substring(0, 60) : "",
                           prompt: plPromptSistema(aj).indexOf("Responde SIEMPRE en inglés") > 0 };
            d.cambiarIdioma(idAntes);
            out.idioma.vuelta = d.bEnviar.text + " / " + d.tabs.pageLabel(2) + " / " + d.gPesos.title;
            d.entradas = ent; d.registro = reg;
            // El foco del dictado no debe lanzar errores (PJSR no tiene focus()).
            try { d.childToFocus = d.entrada; } catch (e) { out.foco1 = String(e); }
            try { d.entrada.hasFocus = true; } catch (e) { out.foco2 = String(e); }
            d.enviarTexto = function (t) { out.clic = t; };
            // Informe .md y dossier PDF de la conversación de la prueba (en la carpeta temporal, no en la del usuario).
            var ciAntes = aj.carpetaInformes; d.eInformes.text = plCarpeta(PL_TMP) + "/dossiers";
            out.informe = d.crearInforme();
            d.crearDossier(function (fp) { out.dossier = fp; });   // saveAsPDF escribe el fichero un poco después
            d.eInformes.text = ciAntes;
            d.historialBox.evaluateScript("plClick='999|Paso de prueba';");
         } catch (e) { out.error = String(e); }
         var t2 = new Timer; t2.interval = 6; t2.periodic = false;   // tiempo para el clic simulado y el PDF
         t2.onTimeout = function () { if (out.dossier) out.dossierExiste = File.exists(out.dossier); d.ok(); };
         t2.start();
      };
      tm.start();
      d.execute();
      return out;
   });
   paso("guia", function () {
      var avisos = plCargarGuia(aj.guia), g = plGlobal();
      return { avisos: avisos, funciones: ["vistas", "estadisticas", "analizarMaster", "gradienteCandidatos", "estirarStarless", "reducirRuido"]
               .map(function (n) { return n + ":" + typeof g[n]; }) };
   });
   paso("blindSolver", function () {
      // Las funciones de la guía deben ver el motor de BlindSolver (incluido arriba) y blindSolve del runner.
      plCargarGuia(aj.guia);
      var c = new BlindSolverConfiguration(SETTINGS_MODULE); c.LoadSettings();
      return [typeof BlindSolverEngine, typeof plGlobal().blindSolve, typeof plGlobal().resolverAstrometria].join(" ");
   });
   paso("textoParaVoz", function () {
      var t = plTextoParaVoz("## Análisis\n**IC 63** es una [nebulosa](https:" + "/" + "/x.org).\n\n| Canal | Mediana |\n|---|---|\n| R | 0,0018 |\n\n" +
                             "```json\n{\"llamadas\": []}\n```\nSiguiente paso: gradiente.");
      if (/[*#|`]|llamadas|https/.test(t)) throw new Error("quedan símbolos o código: " + t);
      // Lanzar PowerShell como hacen la voz y el dictado (sin sonido: un script que sólo escribe un fichero).
      var f = plCarpeta(PL_TMP) + "/prueba_ps.txt";
      if (File.exists(f)) File.remove(f);
      var P = plPowerShell({ nombre: "prueba", codigo: "param($f)\r\nSet-Content -Path $f -Value 'ok'\r\n" }, [f]);
      for (var i = 0; i < 200 && P.isRunning; ++i) { plEventos(); plDormir(50); }
      if (!File.exists(f)) throw new Error("PowerShell no escribió el fichero");
      return t;
   });
   paso("internetApagado", function () {
      // Con la casilla «Internet» desmarcada, las funciones de web.js no deben salir a internet.
      var antes = aj.internet; aj.internet = false;
      var r = plEjecutarLlamadas(aj, '{"llamadas": [{"funcion": "simbad", "parametros": {"objeto": "IC 63"}}]}');
      aj.internet = antes;
      if (r.ok) throw new Error("simbad funcionó con internet desactivado");
      return r.texto.substring(0, 160);
   });
   paso("prompt", function () { var s = plPromptSistema(aj); return { caracteres: s.length, inicioVentanas: s.substring(s.indexOf("Vistas abiertas ahora")) }; });
   paso("ollamaModelos", function () { return plOllamaModelos(aj); });
   var respuesta = null;
   paso("ollamaChat", function () {
      var a = new PLAjustes(); a.cargar(); a.proveedor = "ollama";
      var rq = plPreguntar(a, [{ role: "user", content: "Lista las ventanas abiertas en PixInsight con la función vistas." }], { cancelado: false });
      respuesta = rq.texto;
      if (!rq.uso || !rq.uso.salida) throw new Error("Ollama no ha devuelto el consumo de tokens");
      return { respuesta: plRecortar(respuesta, 1500), llamadas: plExtraerLlamadas(respuesta), uso: plUsoTexto(rq.uso) };
   });
   paso("ejecutarTrivial", function () {
      return plEjecutarLlamadas(aj, '{"llamadas": [{"funcion": "vistas", "parametros": {}}]}');
   });
   paso("ejecutarLlamadasDelModelo", function () {
      var s = respuesta && plExtraerLlamadas(respuesta);
      if (!s) return "la respuesta no traía llamadas";
      return plEjecutarLlamadas(aj, s);
   });
   paso("rechazos", function () {
      // Nada fuera del manifiesto: función inexistente, parámetro desconocido, código y JSON mal formado.
      var r = {
         inexistente: plEjecutarLlamadas(aj, '{"llamadas": [{"funcion": "noExiste", "parametros": {}}]}'),
         parametro: plEjecutarLlamadas(aj, '{"llamadas": [{"funcion": "vistas", "parametros": {"codigo": "1"}}]}'),
         javascript: plExtraerLlamadas("```javascript\nvistas();\n```"),
         malformado: plEjecutarLlamadas(aj, "{llamadas: [")
      };
      if (r.inexistente.ok || r.parametro.ok || r.javascript !== null || r.malformado.ok) throw new Error("se aceptó algo que debía rechazarse");
      return { inexistente: r.inexistente.texto.substring(0, 120), parametro: r.parametro.texto.substring(0, 120) };
   });
   if (cli) paso("cliChat_" + cli, function () {
      var a = new PLAjustes(); a.cargar(); a.proveedor = cli;
      a.ponerModelo(PL_AUTO);
      // Pesos N sin llamar a la CLI: prompt libre, un paso > N, uno <= N, y un ajuste del usuario que lo cambia.
      var casos = {
         libre: plElegirModelo(a, ""),
         inventario: plElegirModelo(a, "lineal/02-inventario.md"),
         gradiente: plElegirModelo(a, "lineal/09-correccion-gradiente.md")
      };
      var antes = a.ajustesPesos;
      a.ponerAjuste("lineal/09-correccion-gradiente.md", 10);
      casos.gradienteMas10 = plElegirModelo(a, "lineal/09-correccion-gradiente.md");
      a.ajustesPesos = antes;
      // Llamada real con un paso de puntuación > N (debe ir al modelo inferior).
      var r = plPreguntar(a, [{ role: "user", content: "[Paso de la guía: Inventario (lineal/02-inventario.md)]\nResponde solo: OK" }],
                          { cancelado: false }, "lineal/02-inventario.md");
      return { casos: casos, llamada: { modelo: r.modelo, porque: r.porque, respuesta: plRecortar(r.texto, 300), uso: plUsoTexto(r.uso) } };
   });
   delete r.enCurso;
   r.fin = new Date().toISOString();
   File.writeTextFile(salida, JSON.stringify(r, null, 1));
   console.noteln("[PiAstroPilotLite prueba] resultados en " + salida);
}

// Pasada automática para comparar modelos (13 nov 2026): el mismo diálogo y el mismo bucle que usa el usuario, sin
// usuario. Manda la petición (leída de un fichero, por las comas) y, cada vez que la serie de pasos para sin haber
// exportado, manda «sigue hasta el final» (cada una cuenta como una intervención). No guarda ajustes: los del usuario
// quedan como estaban. Deja en <carpeta>: pasada.json (tiempo, tokens, coste, pasos, fallos), registro.txt e informe .md.
//   PixInsight.exe -n --automation-mode --no-focus-stealing
//      -r=<Lite>,--pasada,<ollama|claude|codex>,<modelo>,<carpeta>,<peticion.txt> --force-exit
var PL_MAX_SIGUE = 6;
function plPasada(proveedor, modelo, carpeta, ficheroPeticion, maxSigue) {
   // maxSigue: «sigue» automáticos como mucho (por defecto PL_MAX_SIGUE; 0 en una comparación por etapas, donde la
   // etapa acaba cuando el modelo para y cada etapa sigue desde la mejor salida de los dos modelos).
   var topeSigue = maxSigue !== undefined && maxSigue !== null && isFinite(parseInt(maxSigue, 10)) ? parseInt(maxSigue, 10) : PL_MAX_SIGUE;
   carpeta = plCarpeta(String(carpeta).replace(/\\/g, "/").replace(/[\/]+$/, ""));
   var peticion = String(File.readTextFile(ficheroPeticion)).replace(/^﻿/, "").trim();
   var aj = new PLAjustes();
   aj.cargar();
   aj.guardar = function () {};   // nada de lo que cambie la pasada llega a los ajustes guardados
   // La guía de al lado del script, no la de los ajustes: así una pasada puede correr desde una copia congelada del
   // repo aunque se cambie de rama a mitad (13 nov 2026: un cambio a main a mitad de la etapa 2 la invalidó).
   aj.guia = plPadre(plPadre(PL_RUTA_SCRIPT)) + "/guia";
   aj.proveedor = proveedor; aj.ponerModelo(modelo);
   aj.internet = false; aj.voz = false;
   aj.carpetaInformes = carpeta;
   var out = { proveedor: proveedor, modelo: modelo, peticion: peticion, inicio: new Date().toISOString(), sigue: 0 };
   var fJson = carpeta + "/pasada.json";
   function guardar(d) {
      if (d) {
         var reg = d.registro;
         out.uso = d.usoSesion || null;
         out.pasosSerie = d.pasosSerie || 0;
         out.respuestas = d.entradas.filter(function (e) { return e.tipo == "asst" && !e.bienvenida; }).length;
         out.ejecuciones = (reg.match(/── Resultado \(/g) || []).length;
         out.fallosEjecucion = (reg.match(/── Error al ejecutar ──/g) || []).length;
         out.correcciones = (reg.match(/── Corrección \d/g) || []).length;
         out.errores = (reg.match(/── Error ──/g) || []).length;
         out.paros = (reg.match(/(^|\n)\s*\**PARO:/g) || []).length;
         out.exportado = /Terminada tras exportar/.test(reg);
         try { File.writeTextFile(carpeta + "/registro.txt", reg); } catch (e) {}
      }
      out.segundos = Math.round((Date.now() - t0) / 100) / 10;
      File.writeTextFile(fJson, JSON.stringify(out, null, 1));
   }
   var t0 = Date.now();
   guardar(null);
   var d = new PLDialogo(aj), tm = new Timer;
   tm.interval = 1.5; tm.periodic = false;
   tm.onTimeout = function () {
      try {
         d.cModelo.editText = modelo;
         d.leerAjustes();
         out.temperatura = aj.temperatura;
         out.modeloEfectivo = aj.modelo();
         var texto = peticion;
         for (var v = 0; v <= topeSigue; ++v) {
            d.enviarTexto(texto);
            guardar(d);
            if (out.exportado) break;
            texto = "sigue hasta el final";
            if (v < topeSigue) ++out.sigue;
         }
         out.informe = d.crearInforme();
      } catch (e) { out.error = String(e && e.message ? e.message : e); }
      out.fin = new Date().toISOString();
      guardar(d);
      console.noteln("[PiAstroPilotLite pasada] resultados en " + fJson);
      d.ok();
   };
   tm.start();
   d.execute();
}

function plMain() {
   var args = (typeof Runtime !== "undefined" && Runtime.jsArguments) ? Runtime.jsArguments :
              (typeof jsArguments !== "undefined") ? jsArguments : [];
   // Llamadas de la guía sin chat (mismo validador y runner que el chat):  -r=<Lite>,--llamadas,<llamadas.json>,<salida.txt>
   if (args.length >= 3 && String(args[0]) == "--llamadas") {
      var ajL = new PLAjustes(); ajL.cargar(); ajL.guardar = function () {};
      plGlobal().PL_DEPURAR = true;   // sin chat: los errores llevan la pila
      var rL = plEjecutarLlamadas(ajL, String(File.readTextFile(String(args[1]))));
      File.writeTextFile(String(args[2]), (rL.ok ? "OK" : "ERROR") + "\n" + rL.texto);
      return;
   }
   if (args.length >= 5 && String(args[0]) == "--pasada") {
      plPasada(String(args[1]), String(args[2]), String(args[3]), String(args[4]), args.length > 5 ? String(args[5]) : null);
      return;
   }
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
   var plMsg = "[PiAstroPilotLite] error: " + (e && e.message ? e.message : e) + (e && e.lineNumber ? " (línea " + e.lineNumber + ")" : "") +
               (e && e.stack ? "\n" + e.stack : "");
   console.criticalln(plMsg);
   try { File.writeTextFile(plCarpeta(PL_TMP) + "/error.txt", plMsg); } catch (x) {}
}
