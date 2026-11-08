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

// Motor de BlindSolver en modo librería (como picopilot-runner.js): lo usan blindSolve, resolverAstrometria,
// bxtCorrectOnly y alinearMasters. Las clases quedan globales y el código del modelo, que se evalúa aquí, las ve.
#define VERSION "1.0.0"
#define TITLE "BlindSolver"
#define SETTINGS_MODULE "BlindSolver"
#include <pjsr/astrometry/AstrometricMetadata.js>
#include <pjsr/astrometry/UtilityControls.js>
#include <pjsr/utility/ScriptErrors.js>
#ifeq __PI_PLATFORM__ MACOSX
#include "/Applications/PixInsight/src/scripts/BlindSolver/BlindSolverEngine.js"
#else
#include "C:/Program Files/PixInsight/src/scripts/BlindSolver/BlindSolverEngine.js"
#endif

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
   this.ejecutarSinPreguntar = false;
   this.internet = true;                  // Claude: WebSearch y WebFetch; todos: simbad/wikipedia/leerWeb/imagenCatalogo

   var CAMPOS = { proveedor: DataType_UCString, modeloOllama: DataType_UCString, modeloClaude: DataType_UCString,
                  modeloCodex: DataType_UCString, ollamaUrl: DataType_UCString, temperatura: DataType_UCString,
                  pensar: DataType_Boolean, rutaClaude: DataType_UCString, rutaCodex: DataType_UCString,
                  guia: DataType_UCString, ejecutarSinPreguntar: DataType_Boolean, umbralN: DataType_Int32,
                  claudeInferior: DataType_UCString, claudeSuperior: DataType_UCString, codexInferior: DataType_UCString,
                  codexSuperior: DataType_UCString, ajustesPesos: DataType_UCString, internet: DataType_Boolean };

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
// Pesos N: elección entre modelo inferior (Sonnet) y superior (Opus), copiada del módulo (PiCopilotConfig::TierModel)
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

// Respaldo si no existe guia/porcentajes_skill.json (la misma tabla que PiCopilotConfig::BuiltinScore).
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

// Tabla base: se lee de <guía>/porcentajes_skill.json en cada uso (como PiCopilotConfig::LoadScores): se quita el
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

function plContratoApi(guia) {
   var f = guia + "/anexos/A-contrato-api-pjsr.md";
   try { return File.exists(f) ? plRecortar(File.readTextFile(f), 12000) : ""; } catch (e) { return ""; }
}

function plCargarGuia(guia) {
   if (plGuiaCargada === guia) return [];
   var g = plGlobal(), avisos = [];
   plDefinirConstantesJsh();
   plConstantesEnPrototipo();
   // El runner se carga con eval y ahí no existen los #define: blindSolve usa este nombre como variable.
   // (Troceado para que el preprocesador no lo sustituya aquí.)
   g["SETTINGS" + "_MODULE"] = "BlindSolver";
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
   plEnvolverFunciones(g, guia);
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
// No disponibles en la versión Lite (el run_script del MCP).
var PL_EXCLUIDAS = { run_script: 1 };

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
   try {
      var man = JSON.parse(File.readTextFile(guia + "/herramientas/manifiesto.json"));
      (man.funciones || []).forEach(function (x) { nombres.push(x.nombre); });
   } catch (e) {}
   nombres.forEach(function (n) {
      var f = g[n];
      if (typeof f !== "function" || f.plOriginal) return;
      var e = function () { return f.apply(this, Array.prototype.slice.call(arguments).map(plIdDe)); };
      e.plOriginal = f;
      g[n] = e;
   });
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
   "- Las funciones devuelven objetos: pásalos por chat(JSON.stringify(r, null, 1)).\n\n" +
   "Vistas e ids (lo más importante):\n" +
   "- Usa sólo los ids de la lista «Vistas abiertas», escritos exactamente igual (mayúsculas y guiones bajos incluidos). " +
   "Nunca inventes ni completes un id. Los ejemplos de la guía usan ids genéricos (MasterLight y parecidos): sustitúyelos " +
   "siempre por un id real de la lista.\n" +
   "- Si el usuario nombra una vista, búscala en la lista; si habla de «la imagen en pantalla» o no dice cuál, usa la marcada " +
   "como (activa). Si no está en la lista o hay dudas, pregunta sin escribir script.\n" +
   "- Las funciones de la guía reciben el id como texto, por ejemplo analizarMaster(\"id_real\"), no una ventana ni una vista.\n" +
   "- ImageWindow.windowById(id) nunca devuelve null: si el id no existe devuelve una ventana con isNull == true, así que " +
   "comprueba w.isNull (no !w). View.viewById(id) devuelve null si no existe. El id de una ventana es w.mainView.id " +
   "(no existe w.name). ImageWindow.windows es un array e ImageWindow.activeWindow es la ventana activa.\n" +
   "- PJSR: console.writeln para la consola (console.log no existe).\n" +
   "- Constantes de los procesos: en el constructor, Clase.CONSTANTE (por ejemplo PixelMath.RGB o " +
   "ScreenTransferFunction.SeparateChannels), no Clase.prototype.CONSTANTE.\n" +
   "- Antes de usar un proceso o una propiedad de PJSR que no esté en la guía ni en el contrato de abajo, no la inventes.\n" +
   "- Si un script falla, cambia el código que causó el error: no repitas el mismo script.\n" +
   "- Compara siempre: si la guía tiene una función que prueba varios candidatos y recomienda uno (gradienteCandidatos o " +
   "gradienteVarias, ruidoCandidatos, bxtCandidatos, estirarCandidatos, contrasteCandidatos, nucleoCandidatos...), úsala en vez de aplicar un solo método o valor, y enseña la tabla " +
   "de la comparación (comparados / candidatos) en tu resumen.\n\n" +
   (aj.internet ?
   "Información de internet (objeto, filtros, cámaras, telescopios, qué señal tiene la nebulosa, problemas típicos):\n" +
   (aj.proveedor == "claude" ? "- Tienes WebSearch y WebFetch: úsalos directamente y cita las fuentes.\n" : "") +
   "- Desde un script: simbad(\"IC 63\") da el tipo de objeto, coordenadas y tamaño; wikipedia(\"texto\", {idioma}) el resumen " +
   "de un artículo; leerWeb(url) el texto de una página; imagenCatalogo(\"IC 63\" o id de vista con astrometría, {survey: \"H-Alpha Comp\"}) " +
   "abre una imagen de catálogo (DSS2, Hα, WISE...) para saber qué señal esperar. Cita la fuente que devuelven y no inventes lo que no traigan.\n\n" : "") +
   "Recomendar el paso siguiente:\n" +
   "- Cuando respondas sin script (información, dudas, resúmenes), termina con una línea «Siguiente paso: <qué hacer y con " +
   "qué función de la guía>.» con lo que recomiendas según el orden de la guía y lo que ya se ha hecho en esta conversación " +
   "(por ejemplo, si una imagen aún no se ha analizado, lo primero es analizarla). Si hay alternativas razonables, añade " +
   "líneas que empiecen por «Paso N: ...». El chat las muestra como enlaces que el usuario pulsa para que lo hagas.\n\n" +
   "Funciones disponibles (nombre(argumentos) [nivel]: descripción):\n" + plListaFunciones(aj.guia) + "\n\n" +
   (plContratoApi(aj.guia) ? "Contrato de la API PJSR que debes respetar:\n<<<\n" + plContratoApi(aj.guia) + "\n>>>\n\n" : "") +
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

function plClaudeChat(aj, sistema, mensajes, estado, modelo) {
   var dir = plCarpeta(PL_TMP), fs = dir + "/sistema.txt", fe = dir + "/prompt.txt", fo = dir + "/respuesta.txt";
   File.writeTextFile(fs, sistema);
   File.writeTextFile(fe, "Continúa esta conversación respondiendo al último mensaje del usuario.\n\n" + plConversacionTexto(mensajes));
   // Sin MCP: PixInsight está ocupado con este script y no podría atender al MCP. Con «internet», sólo WebSearch y
   // WebFetch (permitidas sin preguntar: en -p nadie puede contestar un permiso); si no, ninguna herramienta.
   var herr = aj.internet ? ["--tools", "WebSearch", "WebFetch", "--allowedTools", "WebSearch", "WebFetch"] : ["--tools", ""];
   var args = ["-p", "--output-format", "text", "--strict-mcp-config"].concat(herr).concat(["--system-prompt-file", fs]);
   if (modelo) args.push("--model", modelo);
   plEjecutarCli(aj.rutaClaude, args, fe, fo, estado);
   return File.readTextFile(fo).trim();
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

// paso = clave del paso de la guía elegido en la pestaña Prompt ("" = prompt libre); decide el modelo con pesos N.
// Devuelve { texto, modelo, porque }.
function plPreguntar(aj, mensajes, estado, paso) {
   var sistema = plPromptSistema(aj), m = plRecortarHistorial(mensajes), e = plElegirModelo(aj, paso || ""), t;
   // Recordatorio al final de la última petición (los modelos locales atienden más a lo último que leen); no se guarda.
   if (m.length && m[m.length - 1].role == "user") {
      m = m.slice();
      m[m.length - 1] = { role: "user", content: m[m.length - 1].content +
                          "\n\n[Vistas abiertas ahora, ids exactos: " + plResumenVistas() + "]" };
   }
   if (aj.proveedor == "claude") t = plClaudeChat(aj, sistema, m, estado, e.modelo);
   else if (aj.proveedor == "codex") t = plCodexChat(aj, sistema, m, estado, e.modelo);
   else t = plOllamaChat(aj, sistema, m, estado);
   return { texto: t, modelo: e.modelo, porque: e.porque };
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
   g.PICOPILOT_INTERNET = !!aj.internet;   // web.js lo respeta: sin la casilla, simbad/wikipedia/... no salen a internet
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
      var vistas = "";
      try { if (String(e).indexOf("Vistas abiertas") < 0) vistas = "\nVistas abiertas (ids exactos): " + plResumenVistas(); } catch (x) {}
      return { ok: false, texto: plRecortar((salida.length ? salida.join("\n") + "\n" : "") + "ERROR: " +
               (e && e.message ? e.message : String(e)) + linea + vistas, 6000), segundos: (Date.now() - t0) / 1000 };
   }
}

// ---------------------------------------------------------------------------------------------------------------
// Diálogo
// ---------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------
// Chat en HTML (WebView), con el mismo aspecto que el módulo (PiCopilotRender.cpp): Markdown de las respuestas
// (tablas, negritas, enlaces, código) y fichas con los datos de los resultados de los scripts.
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
   "details{margin-top:6px}summary{cursor:pointer;color:#7d8590;font-size:11px}";

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
// diálogo lo recoge con su temporizador: ejecuta el script pendiente de ese mensaje o le pide el paso al modelo.
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
function plTablaObjetos(arr) {
   var cols = [];
   arr.forEach(function (e) {
      if (!e || typeof e !== "object") return;
      for (var k in e) {
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
   if (Array.isArray(nc)) h += nc.length ? "<span class=\"badge bad\">No cumple</span> " : "<span class=\"badge ok\">Cumple</span> ";
   h += "Resultado del script</div>";
   h += plListaHtml(nc, "nc", "&#10007;") + plListaHtml(ctl.medido, "med", "&#10003;") + plListaHtml(ctl.revisar_a_ojo, "ojo", "&#128065;");
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

function plPagina(entradas) {
   var h = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>" + PL_CSS + "</style><script>var plClick='';" +
           "function plPaso(a){plClick=a.getAttribute('data-m')+'|'+a.getAttribute('data-paso');a.className='step done';return false;}" +
           "</script></head><body>";
   entradas.forEach(function (e, indice) {
      var quien = "<div class=\"who\">" + plEsc(e.hora) + " &middot; <b>" + plEsc(e.titulo) + "</b></div>";
      if (e.tipo == "user") h += "<div class=\"msg user\">" + quien + "<div class=\"bubble\">" + plEsc(e.texto) + "</div></div>";
      else if (e.tipo == "asst") h += "<div class=\"msg asst\">" + quien + "<div class=\"bubble\">" +
                                      plMarkdown(e.texto).split("data-m=\"@M@\"").join("data-m=\"" + indice + "\"") + "</div></div>";
      else h += "<div class=\"msg\">" + quien + plInfo(e.texto, e.tipo == "err") + "</div>";
   });
   return h + "<div id=\"fin\"></div><script>window.scrollTo(0, document.body.scrollHeight);</script></body></html>";
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
   this.mensajes = [];            // { role: "user" | "assistant", content }
   this.registro = "";            // copia en texto plano del chat (pruebas)
   this.entradas = [];            // { tipo: user | asst | info | err, titulo, texto, hora } para el HTML
   this.pendiente = null;        // script de la última respuesta, sin ejecutar
   this.ultimoError = null;
   this.correcciones = 0;
   this.estado = null;            // { cancelado } mientras se espera al modelo

   this.windowTitle = "PiCopilot Lite " + PL_VERSION;
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
   this.cAuto = new CheckBox(pPrompt);
   this.cAuto.text = "Ejecutar sin preguntar";
   this.cAuto.checked = aj.ejecutarSinPreguntar;
   this.cAuto.onCheck = function (c) { aj.ejecutarSinPreguntar = c; };
   this.cInternet = new CheckBox(pPrompt);
   this.cInternet.text = "Internet";
   this.cInternet.toolTip = "Permitir búsquedas externas. Claude: WebSearch y WebFetch. Todos los modelos: SIMBAD, Wikipedia, páginas web " +
                            "e imágenes de catálogo (web.js). Sin marcar, nada sale a internet.";
   this.cInternet.checked = aj.internet;
   this.cInternet.onCheck = function (c) { aj.internet = c; aj.guardar(); };
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
   this.bVer.onClick = function () {
      self.anotar("Script pendiente", self.pendiente ? "```javascript\n" + self.pendiente + "\n```" : "(ninguno)", "asst");
   };
   this.bLimpiar = new PushButton(pPrompt);
   this.bLimpiar.text = "Nueva conversación";
   this.bLimpiar.onClick = function () {
      self.mensajes = []; self.registro = ""; self.entradas = []; self.historialBox.setHTML(plPagina([])); self.ponerPendiente(null);
      self.ultimoError = null; self.correcciones = 0; self.bCorregir.enabled = false;
   };
   this.estadoLbl = new Label(pPrompt);
   this.estadoLbl.text = "";
   // Modelo que se usará. Como en el módulo, el prompt libre no tiene paso: con «auto (pesos N)» va al modelo superior.
   this.eleccionLbl = new Label(pPrompt);
   var filaP = new HorizontalSizer; filaP.spacing = 6;
   filaP.add(this.eleccionLbl, 100);

   var filaB = new HorizontalSizer;
   filaB.spacing = 6;
   filaB.add(this.bEnviar); filaB.add(this.bCancelar); filaB.addSpacing(12);
   filaB.add(this.cAuto); filaB.add(this.cInternet); filaB.add(this.bEjecutar); filaB.add(this.bVer); filaB.add(this.bCorregir);
   filaB.addStretch(); filaB.add(this.bLimpiar);
   pPrompt.sizer = new VerticalSizer;
   pPrompt.sizer.margin = 6; pPrompt.sizer.spacing = 6;
   pPrompt.sizer.add(this.historialBox, 100);
   pPrompt.sizer.add(filaP);
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
   this.onHide = function () { if (self.tEnlaces) self.tEnlaces.stop(); self.leerAjustes(); aj.guardar(); };
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
      this.eleccionLbl.text = aj.proveedor == "ollama" ? "Ollama · " + aj.modeloOllama + "  (los pesos N no se aplican)" :
         "Modelo: " + (e.modelo || "(por defecto de la CLI)") + (e.porque ? "  —  " + e.porque : "");
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
         if (base === undefined) { n.setText(3, "—"); n.setText(4, "superior (sin valor)"); }
         else {
            var nota = base + aju, inf = nota > aj.umbralN;
            n.setText(3, String(nota));
            n.setText(4, (inf ? "inferior" : "superior") + " (" + ((inf ? bajo : alto) || "por defecto") + ")");
         }
         if (seleccionar && p[1] == seleccionar) sel = n;
      });
      for (var c = 0; c < 5; ++c) this.tPesos.adjustColumnWidthToContents(c);
      if (sel) this.tPesos.currentNode = sel; else this.sAjuste.enabled = false;
      this.fuentePesos.text = "Base: " + pb.fuente + ". Como en el módulo, el Prompt libre usa el modelo superior; la tabla decide en los pasos." +
                              (aj.modelo() == PL_AUTO || !activos ? "" : "  (Ahora el modelo está fijado a mano: la tabla no se aplica.)");
      this.actualizarEleccion();
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
         lista = [PL_AUTO, "", "sonnet", "opus", "haiku"];
         this.notaModelo.text = "«" + PL_AUTO + "» = elige inferior o superior según el paso (tabla de abajo). " +
                                "Vacío = el modelo por defecto de Claude Code. Se lanza «claude -p» sin herramientas ni MCP.";
      } else {
         lista = [PL_AUTO, ""];
         this.notaModelo.text = "«" + PL_AUTO + "» = elige inferior o superior según el paso. Vacío = el modelo por " +
                                "defecto de Codex. Se lanza «codex exec» en modo solo lectura.";
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
      this.historialBox.setHTML(plPagina(this.entradas));
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
      var interpretando = this.interpretando;   // interpretación de un resultado: su script no se ejecuta solo
      this.interpretando = false;
      this.leerAjustes();
      this.estado = { cancelado: false };
      this.ocupado(true);
      var e0 = plElegirModelo(aj, this.pasoEnviado || "");
      var nombre = { ollama: "Ollama", claude: "Claude", codex: "Codex" }[aj.proveedor] +
                   " · " + (e0.modelo || "modelo por defecto") + (e0.porque ? " — " + e0.porque : "");
      this.estadoLbl.text = "Esperando a " + nombre + "…";
      var t0 = Date.now(), resp = null;
      try {
         resp = plPreguntar(aj, this.mensajes, this.estado, this.pasoEnviado || "");
         resp = resp.texto;
      } catch (e) {
         this.anotar("Error", String(e.message || e), "err");
      }
      var cancelado = this.estado.cancelado;
      this.estado = null;
      this.ocupado(false);
      this.estadoLbl.text = resp !== null ? "Respuesta en " + ((Date.now() - t0) / 1000).toFixed(1) + " s." : (cancelado ? "Cancelado." : "");
      if (resp === null) {   // la pregunta no obtuvo respuesta: no queda en el historial
         var q = this.mensajes.pop();
         // Si era la interpretación, el resultado del script sí se queda para el turno siguiente.
         if (interpretando && q) this.mensajes.push({ role: "user", content: q.content }, { role: "assistant", content: "Visto." });
         return;
      }
      this.mensajes.push({ role: "assistant", content: resp });
      this.anotar("PiCopilot (" + nombre + ")", resp, "asst");
      var s = plExtraerScript(resp);
      // Si la corrección trae el mismo script que ya falló, no se ejecuta otra vez: se pide uno distinto.
      if (s && this.scriptFallido && s.replace(/\s+/g, "") == this.scriptFallido.replace(/\s+/g, "")) {
         this.ponerPendiente(null);
         this.repetido = true;
         this.anotar("Aviso", "El modelo ha devuelto el mismo script que ya falló; no lo ejecuto.", "err");
         var quedan = this.correcciones < PL_MAX_CORRECCIONES;
         this.bCorregir.enabled = quedan;
         this.estadoLbl.text = quedan ? "Script repetido. Puedes pedir otra corrección." : "Script repetido; revisa la petición.";
         if (quedan && this.cAuto.checked) this.pedirCorreccion();
         return;
      }
      this.ponerPendiente(s);
      if (s && this.cAuto.checked && !interpretando) this.ejecutarPendiente();
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
      this.mensajes.push({ role: "user", content: t });
      this.anotar("Tú", t, "user");
      this.consultar();
   };

   this.ejecutarPendiente = function () {
      if (!this.pendiente || this.estado) return;
      var s = this.pendiente;
      this.ponerPendiente(null);
      this.estadoLbl.text = "Ejecutando script…";
      plEventos();
      var r = plEjecutarScript(aj, s);
      this.anotar(r.ok ? "Resultado (" + r.segundos.toFixed(1) + " s)" : "Error al ejecutar", r.texto, r.ok ? "info" : "err");
      // Como en el módulo: un resultado con datos se manda al modelo para que lo interprete y recomiende el paso
      // siguiente, con las líneas «Siguiente paso: ...» que el chat pinta como enlaces.
      if (r.ok && r.texto != "(sin salida)") {
         this.correcciones = 0; this.ultimoError = null; this.scriptFallido = null;
         this.mensajes.push({ role: "user", content: "El script ha terminado sin errores. Resultado:\n" + r.texto +
            "\nAhora, sin escribir ningún script, interpreta estos datos según la guía y da el resumen del paso. No inventes " +
            "datos que no estén en el resultado. Separa los controles en dos listas: «Medido» (sólo lo que el resultado " +
            "demuestra, con su valor) y «Revisar a ojo» (lo que el resultado no mide); nunca des por bueno algo de la segunda.\n" +
            "Termina con una línea «Siguiente paso: <qué hacer y con qué función de la guía>.» con el paso que recomiendas, " +
            "y si hay alternativas razonables, una lista de líneas que empiecen por «Paso N: ...» (N = número del paso en la guía). " +
            "Cada una es un enlace que el usuario pulsará para que la hagas." });
         this.anotar("Interpretar el resultado", "Pidiendo al modelo que interprete el resultado y recomiende el paso siguiente…");
         this.interpretando = true;
         this.consultar();
         return;
      }
      // El resultado entra en la conversación para que el modelo lo tenga en cuenta en el siguiente turno.
      this.mensajes.push({ role: "user", content: (r.ok ? "Resultado de ejecutar tu script:\n" : "Tu script ha fallado:\n") + r.texto });
      this.mensajes.push({ role: "assistant", content: r.ok ? "Visto." : "Entendido, lo reviso si me lo pides." });
      if (r.ok) {
         this.correcciones = 0; this.ultimoError = null; this.scriptFallido = null; this.estadoLbl.text = "Script ejecutado.";
      } else {
         this.ultimoError = r.texto;
         this.scriptFallido = s;
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
      // Sustituye el par «ha fallado / entendido» (o «corrección / script repetido») por la petición de corrección.
      this.mensajes.pop(); this.mensajes.pop();
      var t = "El script ha fallado con este error:\n" + this.ultimoError +
              (this.repetido ? "\nTu última respuesta repetía exactamente ese mismo script. Escribe uno distinto que " +
                               "quite la causa del error." : "") +
              "\nRevisa los ids (sólo los de la lista de vistas abiertas, tal cual) y los tipos de los argumentos. " +
              "Corrígelo y devuelve el script completo en un único bloque ```javascript.";
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
      // El enlace del último mensaje con un script sin ejecutar es ese script: se ejecuta tal cual.
      if (indice === ultimo && this.pendiente) { this.anotar("Paso", ">>> Ejecuto el paso: " + texto); this.ejecutarPendiente(); return; }
      this.enviarTexto("Haz ahora este paso: " + texto);
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

   this.rellenarModelos(false);
   this.anotar("PiCopilot Lite", "Hola. Pregúntame por tus imágenes o pídeme un paso de procesado. Cuando proponga un " +
               "script, pulsa «Ejecutar script» (o marca «Ejecutar sin preguntar»). Los enlaces «Siguiente paso» " +
               "ejecutan ese paso con un clic.\nGuía: " + aj.guia, "asst");
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
            d.enviarTexto = function (t) { out.clic = t; };
            d.historialBox.evaluateScript("plClick='999|Paso de prueba';");
         } catch (e) { out.error = String(e); }
         var t2 = new Timer; t2.interval = 2; t2.periodic = false;
         t2.onTimeout = function () { d.ok(); };
         t2.start();
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
   paso("blindSolver", function () {
      // El código del modelo debe ver el motor de BlindSolver (incluido arriba) y blindSolve del runner.
      return plEjecutarScript(aj, "var c = new BlindSolverConfiguration(SETTINGS_MODULE); c.LoadSettings();\n" +
                              "[typeof BlindSolverEngine, typeof blindSolve, typeof resolverAstrometria].join(' ');");
   });
   paso("internetApagado", function () {
      // Con la casilla «Internet» desmarcada, las funciones de web.js no deben salir a internet.
      var antes = aj.internet; aj.internet = false;
      var r = plEjecutarScript(aj, "simbad('IC 63');");
      aj.internet = antes;
      if (r.ok) throw new Error("simbad funcionó con internet desactivado");
      return r.texto.substring(0, 160);
   });
   paso("prompt", function () { var s = plPromptSistema(aj); return { caracteres: s.length, inicioVentanas: s.substring(s.indexOf("Vistas abiertas ahora")) }; });
   paso("ollamaModelos", function () { return plOllamaModelos(aj); });
   var respuesta = null;
   paso("ollamaChat", function () {
      var a = new PLAjustes(); a.cargar(); a.proveedor = "ollama";
      respuesta = plPreguntar(a, [{ role: "user", content: "Lista las ventanas abiertas en PixInsight con la función vistas()." }], { cancelado: false }).texto;
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
      return { casos: casos, llamada: { modelo: r.modelo, porque: r.porque, respuesta: plRecortar(r.texto, 300) } };
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
