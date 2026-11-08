// picopilot-runner.js — Ejecutor de peticiones del MCP picopilot dentro de PixInsight.
// Copyright (c) 2026 Rafael Vidal. Licencia MIT.
//
// El servidor MCP lo lanza en la instancia abierta con:
//    PixInsight.exe -x=<ruta>/picopilot-runner.js,<id>
// y deja la petición en ~/.picopilot/peticiones/<id>.json:
//    { "id": "<uuid>", "token": "<token>", "herramienta": "analizarMaster", "args": { "vista": "M31" } }
// El runner comprueba el token (~/.picopilot/token), ejecuta SOLO funciones de su lista blanca (LISTA, abajo),
// y escribe ~/.picopilot/resultados/<id>.json:
//    { "id", "estado": "ok" | "error", "resultado" | "error", "inicio", "duracion_ms", "runner" }
// No ejecuta código recibido: la guía se carga con #include y la petición solo trae nombre y parámetros.

#engine v8

#iflt __PI_BUILD__ 1707
#error picopilot-runner necesita PixInsight 1.9.6 o posterior.
#endif

#include <pjsr/ColorSpace.jsh>
#include <pjsr/DataType.jsh>
#include <pjsr/UndoFlag.jsh>

// BlindSolver de PixInsight (motor en modo librería) para resolverAstrometria y alinearMasters.
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

// Funciones de la guía (mismo repositorio), en orden de dependencias.
// Ojo: con #include el preprocesador toma "//" dentro de un regex (p. ej. /^\//) como comentario: usar [\/].
#include "../../guia/herramientas/procesos.js"
#include "../../guia/herramientas/gradcompare.js"
#include "../../guia/herramientas/analisis.js"
#include "../../guia/herramientas/alineado.js"
#include "../../guia/herramientas/preproceso.js"
#include "../../guia/herramientas/bandaestrecha.js"
#include "../../guia/herramientas/boost.js"
#include "../../guia/herramientas/color.js"
#include "../../guia/herramientas/combinacion.js"
#include "../../guia/herramientas/deconvolucion.js"
#include "../../guia/herramientas/realces.js"
#include "../../guia/herramientas/estirado.js"
#include "../../guia/herramientas/estrellas.js"
#include "../../guia/herramientas/exportar.js"
#include "../../guia/herramientas/graxpert.js"
#include "../../guia/herramientas/gradiente.js"
#include "../../guia/herramientas/hdr.js"
#include "../../guia/herramientas/lineal.js"
#include "../../guia/herramientas/mascaras.js"
#include "../../guia/herramientas/nucleo.js"
#include "../../guia/herramientas/recombinacion.js"
#include "../../guia/herramientas/ruido.js"
#include "../../guia/herramientas/web.js"

var PPR_VERSION = "0.3.0";
var PPR_DIR = File.homeDirectory + "/.picopilot";
// Rutas de la guía que usan algunas funciones para cargar dependencias; el servidor las manda en cada petición.
var PICOPILOT_GUIA = File.homeDirectory + "/astro-agente-repo/guia";
var GUIA_HERRAMIENTAS = PICOPILOT_GUIA + "/herramientas";

function pprEscribir(ruta, texto) {
   var tmp = ruta + ".tmp";
   File.writeTextFile(tmp, texto);
   if (File.exists(ruta)) File.remove(ruta);
   File.move(tmp, ruta);
}

function pprLeer(ruta) {
   return File.exists(ruta) ? File.readTextFile(ruta).trim() : null;
}

function pprVista(id) {
   if (typeof id !== "string" || !id) throw new Error("Falta el id de la vista.");
   var w = ImageWindow.windowById(id);
   if (w.isNull) {
      var ids = ImageWindow.windows.map(function (x) { return x.mainView.id; });
      throw new Error("No existe la vista '" + id + "'. Abiertas: " + (ids.length ? ids.join(", ") : "ninguna") + ".");
   }
   return w;
}

// ---------------------------------------------------------------------------------------------------------------
// Funciones propias del runner (no están en la guía)
// ---------------------------------------------------------------------------------------------------------------

function pprPing() {
   return { runner: PPR_VERSION, pixinsight: CoreApplication.versionMajor + "." + CoreApplication.versionMinor + "." +
            CoreApplication.versionRelease, build: __PI_BUILD__, ventanas: ImageWindow.windows.length };
}

function pprVistas() {
   var activa = ImageWindow.activeWindow, r = [];
   var ws = ImageWindow.windows;
   for (var i = 0; i < ws.length; ++i) {
      var w = ws[i], im = w.mainView.image, e = {
         id: w.mainView.id, ancho: im.width, alto: im.height, canales: im.numberOfChannels,
         color: im.isColor, fichero: w.filePath || null
      };
      try { e.astrometria = !!w.hasAstrometricSolution; } catch (x) {}
      try { e.modificada = !!w.modified; } catch (x) {}
      if (!activa.isNull && activa.mainView.id === e.id) { e.activa = true; r.unshift(e); } else r.push(e);
   }
   return { vistas: r, total: r.length };
}

// Estadísticas por canal de toda la imagen o de un rectángulo [x0, y0, x1, y1] (x1/y1 excluidos).
function pprMedirZona(im, rect) {
   var r = [], nombres = im.isColor ? ["R", "G", "B"] : ["K"];
   for (var c = 0; c < im.numberOfChannels; ++c) {
      im.resetSelections();
      if (rect) im.selectedRect = rect;
      im.selectedChannel = c;
      r.push({ canal: nombres[c] || ("c" + c), mediana: im.median(), mad: im.MAD(), media: im.mean(),
               minimo: im.minimum(), maximo: im.maximum() });
   }
   im.resetSelections();
   return r;
}

function pprRect(im, z) {
   var a = z instanceof Array ? z : [z.x0, z.y0, z.x1, z.y1];
   var x0 = Math.max(0, Math.round(+a[0])), y0 = Math.max(0, Math.round(+a[1]));
   var x1 = Math.min(im.width, Math.round(+a[2])), y1 = Math.min(im.height, Math.round(+a[3]));
   if (!(x1 > x0 && y1 > y0)) throw new Error("Rectángulo vacío o fuera de la imagen: " + JSON.stringify(a));
   return new Rect(x0, y0, x1, y1);
}

//   o.rect:   [x0, y0, x1, y1] mide sólo esa zona.
//   o.bordes: ancho en px; mide franjas izquierda/derecha/arriba/abajo y el centro, y da la caída de cada borde
//             respecto al centro (mediana del borde / mediana del centro − 1, por canal).
function pprEstadisticas(id, o) {
   o = o || {};
   var im = pprVista(id).mainView.image, W = im.width, H = im.height;
   var res = { vista: id, ancho: W, alto: H };
   if (o.rect) {
      var rc = pprRect(im, o.rect);
      res.rect = [rc.x0, rc.y0, rc.x1, rc.y1];
      res.canales = pprMedirZona(im, rc);
   } else
      res.canales = pprMedirZona(im, null);
   res.lineal = res.canales.every(function (x) { return x.mediana < 0.05; });
   if (o.bordes) {
      var b = Math.max(1, Math.min(Math.round(+o.bordes), Math.floor(Math.min(W, H) / 4)));
      var zonas = {
         izquierda: [0, b, b, H - b], derecha: [W - b, b, W, H - b],
         arriba: [0, 0, W, b], abajo: [0, H - b, W, H],
         centro: [Math.floor(W / 4), Math.floor(H / 4), Math.floor(3 * W / 4), Math.floor(3 * H / 4)]
      };
      var med = {};
      for (var k in zonas) med[k] = pprMedirZona(im, pprRect(im, zonas[k]));
      res.bordes = { ancho_px: b, zonas: {} };
      for (var k2 in zonas) {
         var z = { rect: zonas[k2], canales: med[k2] };
         if (k2 != "centro")
            z.caida = med[k2].map(function (x, c) {
               var m = med.centro[c].mediana;
               return m > 0 ? Math.round((x.mediana / m - 1) * 1000) / 1000 : null;
            });
         res.bordes.zonas[k2] = z;
      }
   }
   return res;
}

// Historial de procesos de una vista (lo que se le ha aplicado desde que se abrió o creó), para el dossier.
//   o.parametros: true = incluye el código fuente de cada instancia (recortado a o.maxCaracteres, 1500 por defecto).
function pprHistorial(id, o) {
   o = o || {};
   var v = pprVista(id).mainView, out = [], pc = null;
   try { pc = v.processing; } catch (e) { pc = null; }
   var n = pc ? (pc.length !== undefined ? pc.length : 0) : 0;
   for (var i = 0; i < n; ++i) {
      var p = pc.at(i), e = { n: i + 1, proceso: "?" };
      try { e.proceso = p.processId(); } catch (x) {}
      if (o.parametros) {
         try { var s = String(p.toSource("JavaScript", "P", 0)); var m = o.maxCaracteres || 1500;
               e.parametros = s.length > m ? s.substring(0, m) + " …" : s; } catch (x) {}
      }
      out.push(e);
   }
   var inicial = [];
   try { var ip = v.initialProcessing; for (var j = 0; ip && j < ip.length; ++j) inicial.push(ip.at(j).processId()); } catch (e2) {}
   return { vista: id, pasos: out.length, historial: out, procesado_inicial: inicial,
            nota: "historial = procesos aplicados a esta vista en esta sesión de PixInsight (PixelMath, GHS, BXT...). Las vistas " +
                  "creadas como copia por las funciones de la guía empiezan con historial vacío: su origen está en el resultado " +
                  "de cada función. procesado_inicial = lo que traía el fichero al abrirlo (si lo guardó PixInsight)." };
}

// Astrometría a ciegas con el motor de BlindSolver y los ajustes guardados en su diálogo. La guía la llama blindSolve.
//   pistas: { minScale, maxScale ("/px) | minField, maxField (grados) | regionRA, regionDec, regionRadius, timeLimit }
function blindSolve(viewId, pistas) {
   var w = viewId ? pprVista(String(viewId)) : ImageWindow.activeWindow;
   if (w.isNull) throw new Error("No hay ninguna imagen abierta.");
   var p = pistas || {}, cfg = new BlindSolverConfiguration(SETTINGS_MODULE);
   cfg.LoadSettings();
   if (p.minScale !== undefined || p.maxScale !== undefined) {
      cfg.fieldLimits = BlindSolverFieldLimits.ImageScale; cfg.minScale = +(p.minScale || 0); cfg.maxScale = +(p.maxScale || 0);
   } else if (p.minField !== undefined || p.maxField !== undefined) {
      cfg.fieldLimits = BlindSolverFieldLimits.ImageDiagonal; cfg.minField = +(p.minField || 0); cfg.maxField = +(p.maxField || 0);
   }
   if (p.regionRA !== undefined && p.regionDec !== undefined) {
      cfg.useRegion = true; cfg.regionRA = +p.regionRA; cfg.regionDec = +p.regionDec;
      if (p.regionRadius !== undefined) cfg.regionRadius = +p.regionRadius;
   }
   if (p.timeLimit !== undefined) cfg.timeLimit = +p.timeLimit;
   cfg.Validate();
   var e = cfg.FieldLimitsError();
   if (e.length) throw new Error(e);
   var motor = new BlindSolverEngine(cfg);
   motor.interactive = false;
   var t0 = Date.now(), sol = motor.solveWindow(w), r = { vista: w.mainView.id, segundos: (Date.now() - t0) / 1000,
      resuelta: w.hasAstrometricSolution };
   for (var k in sol) if (/^(number|string|boolean)$/.test(typeof sol[k])) r[k] = sol[k];
   return r;
}

// Previa JPG con estirado automático (STF: fondo a 0,25, sombras a mediana − 2,8·MAD normalizada), sin tocar la vista.
function pprMTF(m, x) { return x <= 0 ? 0 : x >= 1 ? 1 : (m - 1) * x / ((2 * m - 1) * x - m); }

function pprPrevia(id, o) {
   o = o || {};
   var w = pprVista(id), src = w.mainView.image, lado = o.lado || 1600;
   // o.rect = [x0, y0, x1, y1]: recorte (p. ej. al 100 % para revisar detalle, estrellas o anillos).
   var rc = o.rect ? pprRect(src, o.rect) : new Rect(0, 0, src.width, src.height);
   var suf = o.rect ? "_" + rc.x0 + "_" + rc.y0 : "";
   var dir = PPR_DIR + "/previas", f = o.fichero || (dir + "/" + id + suf + ".jpg");
   if (!File.directoryExists(File.extractDrive(f) + File.extractDirectory(f)))
      File.createDirectory(File.extractDrive(f) + File.extractDirectory(f), true);
   var nw = new ImageWindow(rc.width, rc.height, src.numberOfChannels, 32, true, src.isColor, "ppr_previa");
   try {
      var v = nw.mainView;
      v.beginProcess(UndoFlag_NoSwapFile); v.image.assign(src, rc); v.endProcess();
      var factor = Math.ceil(Math.max(rc.width, rc.height) / lado);
      if (factor > 1) {
         var IR = new IntegerResample;
         IR.zoomFactor = -factor;
         IR.downsamplingMode = pxK(IntegerResample, "Average");
         IR.executeOn(v, false);
      }
      var im = v.image, nc = im.isColor ? 3 : 1, c0 = [], mid = [];
      for (var c = 0; c < nc; ++c) {
         im.selectedChannel = c;
         var med = im.median(), mad = 1.4826 * im.MAD();
         c0.push(Math.max(0, Math.min(1, med - 2.8 * mad))); mid.push(med);
      }
      im.resetSelections();
      // Ya estirada (alguna mediana > 0,05): se guarda tal cual, salvo estirar: true.
      var lineal = mid.every(function (m) { return m < 0.05; });
      // Capa de estrellas (fondo a 0, lineal o estirada): con STF se quemaba entera (7 nov 2026); se guarda tal cual.
      if (Math.max.apply(null, mid) < 1e-4) lineal = false;
      var estirar = o.estirar === undefined || o.estirar === "auto" ? lineal : !!o.estirar;
      if (estirar && o.enlazado !== false && nc > 1) {
         var a = (c0[0] + c0[1] + c0[2]) / 3, b = (mid[0] + mid[1] + mid[2]) / 3;
         c0 = [a, a, a]; mid = [b, b, b];
      }
      var HT = new HistogramTransformation, H = [[0, 0.5, 1, 0, 1], [0, 0.5, 1, 0, 1], [0, 0.5, 1, 0, 1], [0, 0.5, 1, 0, 1], [0, 0.5, 1, 0, 1]];
      for (c = 0; c < nc; ++c)
         H[nc > 1 ? c : 3] = [c0[c], pprMTF(0.25, Math.max(1e-6, mid[c] - c0[c]) / (1 - c0[c])), 1, 0, 1];
      HT.H = H;
      if (estirar) HT.executeOn(v, false);
      if (File.exists(f)) File.remove(f);
      if (!nw.saveAs(f, false, false, false, false)) throw new Error("No se pudo guardar " + f);
      return { vista: id, fichero: f, ancho: v.image.width, alto: v.image.height, escala: factor > 1 ? "1/" + factor : "100 %",
               rect: o.rect ? [rc.x0, rc.y0, rc.x1, rc.y1] : null, estirada: estirar,
               enlazado: estirar ? o.enlazado !== false : null };
   } finally {
      nw.forceClose();
   }
}

function pprAbrir(f) {
   if (!f || !File.exists(f)) throw new Error("No existe el fichero " + f);
   var ws = ImageWindow.open(f), ids = [];
   for (var i = 0; i < ws.length; ++i) { ws[i].show(); ids.push(ws[i].mainView.id); }
   if (!ids.length) throw new Error("PixInsight no ha podido abrir " + f);
   return { fichero: f, vistas: ids };
}

function pprGuardar(id, f, sobrescribir) {
   var w = pprVista(id);
   if (!f) throw new Error("Falta la ruta del fichero.");
   if (File.exists(f) && !sobrescribir) throw new Error("Ya existe " + f + " (usa sobrescribir: true si es lo que quieres).");
   var d = File.extractDrive(f) + File.extractDirectory(f);
   if (!File.directoryExists(d)) File.createDirectory(d, true);   // a una carpeta inexistente, saveAs abre un diálogo modal
   if (!w.saveAs(f, false, false, false, false)) throw new Error("No se pudo guardar " + f);
   return { vista: id, fichero: f };
}

function pprCerrar(ids, descartar) {
   var lista = ids instanceof Array ? ids : [ids], r = { cerradas: [], no_cerradas: [] };
   lista.forEach(function (id) {
      var w = pprVista(id), mod = false;
      try { mod = !!w.modified; } catch (x) {}
      if (mod && !descartar) r.no_cerradas.push(id + " (tiene cambios sin guardar: descartar: true para cerrarla igualmente)");
      else { w.forceClose(); r.cerradas.push(id); }
   });
   return r;
}

function pprLibre(codigo) {
   if (!File.exists(PPR_DIR + "/permitir_libre"))
      throw new Error("run_script está desactivado. Para permitirlo, el usuario debe crear el fichero ~/.picopilot/permitir_libre.");
   if (typeof codigo !== "string" || !codigo) throw new Error("Falta el código.");
   return (0, eval)(codigo);
}

// ---------------------------------------------------------------------------------------------------------------
// Lista blanca: nombre de herramienta -> función que recibe el objeto args de la petición.
// Nada que no esté aquí se puede ejecutar.
// ---------------------------------------------------------------------------------------------------------------

var LISTA = {
   // Propias del runner
   ping:                 function (a) { return pprPing(); },
   vistas:               function (a) { return pprVistas(); },
   estadisticas:         function (a) { return pprEstadisticas(a.vista, a); },
   historial:            function (a) { return pprHistorial(a.vista, a); },
   previa:               function (a) { return pprPrevia(a.vista, a.opciones); },
   abrirImagen:          function (a) { return pprAbrir(a.fichero); },
   guardarImagen:        function (a) { return pprGuardar(a.vista, a.fichero, a.sobrescribir === true); },
   cerrarVista:          function (a) { return pprCerrar(a.vista, a.descartar === true); },
   run_script:           function (a) { return pprLibre(a.codigo); },
   // Fase lineal
   analizarMaster:       function (a) { return analizarMaster(a.vista); },
   bordesSinDatos:       function (a) { return bordesSinDatos(a.vista); },
   inventario:           function (a) { return inventario(a.carpeta, a.opciones || {}); },
   revisarCalibracion:   function (a) { return revisarCalibracion(a.calibracion || {}); },
   seleccionarSubs:      function (a) { return seleccionarSubs(a.subs, a.opciones || {}); },
   lanzarWBPP:           function (a) { return lanzarWBPP(a.wbpp || {}); },
   estadoWBPP:           function (a) { return estadoWBPP(a.salida, a.opciones || {}); },
   alinearMasters:       function (a) { return alinearMasters(a.masters, a.opciones || {}); },
   componerHDR:          function (a) { return componerHDR(a.masters, a.opciones || {}); },
   desmezclarDualBand:   function (a) { return desmezclarDualBand(a.vista, a.opciones || {}); },
   resolverAstrometria:  function (a) { return resolverAstrometria(a.vista, a.opciones || {}); },
   gradienteCandidatos:  function (a) { return gradienteCandidatos(a.vista, a.opciones || {}); },
   graxpertBGE:          function (a) { return graxpertBGE(a.vista, a.opciones || {}); },
   graxpertDenoise:      function (a) { return graxpertDenoise(a.vista, a.opciones || {}); },
   combinarMasters:      function (a) { return combinarMasters(a.masters, a.opciones || {}); },
   combinarMismoCanal:   function (a) { return combinarMismoCanal(a.a, a.b, a.opciones || {}); },
   inyectarHa:           function (a) { return inyectarHa(a.rgb, a.ha, a.opciones || {}); },
   bxtCorrectOnly:       function (a) { return bxtCorrectOnly(a.vista, a.opciones || {}); },
   calibrarColor:        function (a) { return calibrarColor(a.vista, a.opciones || {}); },
   neutralizarCielo:     function (a) { return neutralizarCielo(a.vista, a.opciones || {}); },
   bxtCandidatos:        function (a) { return bxtCandidatos(a.vista, a.opciones || {}); },
   bxtAplicar:           function (a) { return bxtAplicar(a.vista, a.opciones || {}); },
   reducirRuido:         function (a) { return reducirRuido(a.vista, a.opciones || {}); },
   ruidoCandidatos:      function (a) { return ruidoCandidatos(a.vista, a.opciones || {}); },
   estirarCandidatos:    function (a) { return estirarCandidatos(a.vista, a.opciones || {}); },
   contrasteCandidatos:  function (a) { return contrasteCandidatos(a.vista, a.opciones || {}); },
   nucleoCandidatos:     function (a) { return nucleoCandidatos(a.vista, a.opciones || {}); },
   simbad:               function (a) { return simbad(a.objeto, a.opciones || {}); },
   documentarObjeto:     function (a) { return documentarObjeto(a.vista, a.opciones || {}); },
   wikipedia:            function (a) { return wikipedia(a.texto, a.opciones || {}); },
   leerWeb:              function (a) { return leerWeb(a.url, a.opciones || {}); },
   imagenCatalogo:       function (a) { return imagenCatalogo(a.posicion, a.opciones || {}); },
   separarEstrellas:     function (a) { return separarEstrellas(a.vista, a.opciones || {}); },
   medirContinuo:        function (a) { return medirContinuo(a.nb, a.continuo, a.opciones || {}); },
   restarContinuo:       function (a) { return restarContinuo(a.nb, a.continuo, a.opciones || {}); },
   checkpointLineal:     function (a) { return checkpointLineal(a.vista, a.opciones || {}); },
   // Fase no lineal
   estirarCapas:         function (a) { return estirarCapas(a.starless, a.estrellas, a.opciones || {}); },
   estirarStarless:      function (a) { return estirarStarless(a.vista, a.opciones || {}); },
   estirarEstrellas:     function (a) { return estirarEstrellas(a.vista, a.opciones || {}); },
   previsualizarPaletas: function (a) { return previsualizarPaletas(a.ha, a.oiii, a.opciones || {}); },
   componerPaleta:       function (a) { return componerPaleta(a.capas, a.opciones || {}); },
   paletasDisponibles:   function (a) { return paletasDisponibles(); },
   quitarVerde:          function (a) { return quitarVerde(a.vista, a.opciones || {}); },
   crearMascara:         function (a) { return crearMascara(a.vista, a.opciones || {}); },
   comprimirNucleo:      function (a) { return comprimirNucleo(a.vista, a.opciones || {}); },
   medirMeseta:          function (a) { return medirMeseta(a.vista, a.opciones || {}); },
   saturarAlFallo:       function (a) { return saturarAlFallo(a.vista, a.opciones || {}); },
   prepararEstrellas:    function (a) { return prepararEstrellas(a.vista, a.opciones || {}); },
   recombinarEstrellas:  function (a) { return recombinarEstrellas(a.starless, a.estrellas, a.opciones || {}); },
   exportarFinal:        function (a) { return exportarFinal(a.vista, a.opciones || {}); },
   starStretch:          function (a) { return starStretch(a.vista, a.opciones || {}); },
   darkStructureEnhance: function (a) { return darkStructureEnhance(a.vista, a.opciones || {}); },
   backgroundEnhance:    function (a) { return backgroundEnhance(a.vista, a.opciones || {}); }
};

// ---------------------------------------------------------------------------------------------------------------

function pprMain() {
   var id = (typeof jsArguments !== "undefined" && jsArguments.length) ? String(jsArguments[0]) : "";
   if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      console.warningln("[picopilot] runner lanzado sin id de petición válido; no hago nada.");
      return;
   }
   var rutaPet = PPR_DIR + "/peticiones/" + id + ".json";
   var rutaRes = PPR_DIR + "/resultados/" + id + ".json";
   var t0 = Date.now(), inicio = new Date().toISOString();
   var res = { id: id, runner: PPR_VERSION, inicio: inicio };
   try {
      var txt = pprLeer(rutaPet);
      if (txt === null) throw new Error("No existe la petición " + id + ".");
      var pet = JSON.parse(txt);
      try { File.remove(rutaPet); } catch (x) {}
      var token = pprLeer(PPR_DIR + "/token");
      if (!token || pet.token !== token) throw new Error("Token no válido: petición rechazada.");
      var f = LISTA.hasOwnProperty(pet.herramienta) ? LISTA[pet.herramienta] : null;
      if (!f) throw new Error("'" + pet.herramienta + "' no está en la lista blanca del runner.");
      res.herramienta = pet.herramienta;
      pprEscribir(PPR_DIR + "/en_curso.json", JSON.stringify({ id: id, herramienta: pet.herramienta, inicio: inicio }));
      console.noteln("[picopilot] " + pet.herramienta + " " + JSON.stringify(pet.args || {}));
      if (typeof pet.guia === "string" && pet.guia) { PICOPILOT_GUIA = pet.guia; GUIA_HERRAMIENTAS = pet.guia + "/herramientas"; }
      res.resultado = f(pet.args || {});
      try { JSON.stringify(res.resultado); } catch (x) { res.resultado = String(res.resultado); }
      if (res.resultado === undefined) res.resultado = null;
      res.estado = "ok";
   } catch (e) {
      res.estado = "error";
      res.error = String(e && e.message ? e.message : e);
      console.warningln("[picopilot] error: " + res.error);
   }
   res.duracion_ms = Date.now() - t0;
   try { File.remove(PPR_DIR + "/en_curso.json"); } catch (x) {}
   pprEscribir(rutaRes, JSON.stringify(res));
}

pprMain();
