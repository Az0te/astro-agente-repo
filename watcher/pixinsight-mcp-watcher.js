// Derivado de pixinsight-mcp, Copyright (c) 2026 Alain Escaffre (licencia MIT)
//   https://github.com/aescaffre/pixinsight-mcp
// Modificaciones Copyright (c) 2026 Rafael Vidal (licencia MIT): pausa y parada por fichero,
// boton Pause/Abort de la consola, aviso de cuelgues (current.json), verificacion de
// PixelMath, describe_process, rutas de Windows para ImageSolver.
//
// PixInsight MCP Watcher Script
// Runs inside PixInsight's PJSR engine (ECMAScript 5)
// Polls the bridge directory for commands, executes them, writes results.

// ============================================================================
// ImageSolver Library (loaded at preprocessor time for plate solving)
// ============================================================================

#define __PJSR_USE_STAR_DETECTOR_V2

#include <pjsr/BRQuadTree.jsh>
#include <pjsr/ColorSpace.jsh>
#include <pjsr/DataType.jsh>
#include <pjsr/FrameStyle.jsh>
#include <pjsr/LinearTransformation.jsh>
#include <pjsr/NumericControl.jsh>
#include <pjsr/SectionBar.jsh>
#include <pjsr/Sizer.jsh>
#include <pjsr/StarDetector.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/StdCursor.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/TextAlign.jsh>
#include <pjsr/UndoFlag.jsh>
#include <pjsr/PropertyType.jsh>
#include <pjsr/PropertyAttribute.jsh>
#include <pjsr/RBFType.jsh>
#include <pjsr/APASSFlag.jsh>
#include <pjsr/GaiaFlag.jsh>
#include <pjsr/ReadTextOptions.jsh>

#define TITLE           "Image Solver"
#define SETTINGS_MODULE "SOLVER"
#define STAR_CSV_FILE   (File.systemTempDirectory + "/stars-mcp.csv")

// Include AdP dependencies then ImageSolver in library mode.
// Ruta de instalacion de PixInsight: si la tuya no es la de por defecto,
// cambia "C:/Program Files/PixInsight" en el bloque #else.
#ifeq __PI_PLATFORM__ MACOSX
#include "/Applications/PixInsight/src/scripts/AdP/Projections.js"
#include "/Applications/PixInsight/src/scripts/AdP/WCSmetadata.jsh"
#include "/Applications/PixInsight/src/scripts/AdP/AstronomicalCatalogs.jsh"
#include "/Applications/PixInsight/src/scripts/AdP/CommonUIControls.js"
#include "/Applications/PixInsight/src/scripts/AdP/SearchCoordinatesDialog.js"
#include "/Applications/PixInsight/src/scripts/AdP/CatalogDownloader.js"

#define USE_SOLVER_LIBRARY
#include "/Applications/PixInsight/src/scripts/AdP/ImageSolver.js"
#else
#include "C:/Program Files/PixInsight/src/scripts/AdP/Projections.js"
#include "C:/Program Files/PixInsight/src/scripts/AdP/WCSmetadata.jsh"
#include "C:/Program Files/PixInsight/src/scripts/AdP/AstronomicalCatalogs.jsh"
#include "C:/Program Files/PixInsight/src/scripts/AdP/CommonUIControls.js"
#include "C:/Program Files/PixInsight/src/scripts/AdP/SearchCoordinatesDialog.js"
#include "C:/Program Files/PixInsight/src/scripts/AdP/CatalogDownloader.js"

#define USE_SOLVER_LIBRARY
#include "C:/Program Files/PixInsight/src/scripts/AdP/ImageSolver.js"
#endif

#define SETTINGS_MODULE_SCRIPT "SOLVER"

// ============================================================================
// Configuration
// ============================================================================

var BRIDGE_DIR = File.homeDirectory + "/.pixinsight-mcp/bridge";
var COMMANDS_DIR = BRIDGE_DIR + "/commands";
var RESULTS_DIR = BRIDGE_DIR + "/results";
var LOGS_DIR = BRIDGE_DIR + "/logs";
var POLL_INTERVAL_MS = 1000;
var WATCHER_VERSION = "0.4.13";
// Archivo con el comando en curso (lo lee el servidor MCP para avisar de cuelgues).
var CURRENT_FILE = BRIDGE_DIR + "/current.json";
// Minutos sin comandos tras los cuales el watcher se detiene solo (0 = nunca).
var IDLE_TIMEOUT_MIN = 0;

// ============================================================================
// File Helpers (PJSR File API)
// ============================================================================

function readTextFile(path) {
   var lines = File.readLines(path);
   return lines.join("\n");
}

function writeTextFile(path, text) {
   File.writeTextFile(path, text);
}

function deleteFile(path) {
   if (File.exists(path)) {
      File.remove(path);
   }
}

function ensureDirectory(path) {
   if (!File.directoryExists(path)) {
      File.createDirectory(path, true);
   }
}

function listJsonFiles(dirPattern) {
   try {
      return searchDirectory(dirPattern);
   } catch (e) {
      return [];
   }
}

function getTimestamp() {
   var d = new Date();
   return d.toISOString();
}

// ============================================================================
// Command Handlers
// ============================================================================

function handleListOpenImages(command) {
   var windows = ImageWindow.windows;
   var images = [];
   for (var i = 0; i < windows.length; ++i) {
      var w = windows[i];
      var v = w.mainView;
      var img = v.image;
      images.push({
         id: v.id,
         filePath: w.filePath || null,
         width: img.width,
         height: img.height,
         channels: img.numberOfChannels,
         isColor: img.isColor,
         bitDepth: img.bitsPerSample
      });
   }
   return {
      status: "success",
      outputs: { images: images },
      message: "Found " + images.length + " open image(s)"
   };
}

function handleOpenImage(command) {
   var filePath = command.parameters.filePath;
   if (!File.exists(filePath)) {
      throw new Error("File not found: " + filePath);
   }
   var windows = ImageWindow.open(filePath);
   if (windows.length === 0) {
      throw new Error("Failed to open image: " + filePath);
   }
   var w = windows[0];
   w.show();
   var v = w.mainView;
   var img = v.image;
   return {
      status: "success",
      outputs: {
         id: v.id,
         width: img.width,
         height: img.height,
         channels: img.numberOfChannels
      },
      message: "Opened " + v.id
   };
}

function handleSaveImage(command) {
   var viewId = command.parameters.viewId;
   var filePath = command.parameters.filePath;
   var overwrite = command.parameters.overwrite || false;

   var window = findWindowByViewId(viewId);
   if (!window) {
      throw new Error(notFoundMessage("Image", viewId));
   }
   if (!filePath) throw new Error("save_image: falta filePath");
   filePath = String(filePath).replace(/\\/g, "/");
   if (File.exists(filePath) && !overwrite) {
      throw new Error("File already exists (set overwrite=true): " + filePath);
   }
   // Crear la carpeta de destino si no existe (PixInsight no la crea y falla en silencio)
   var slash = filePath.lastIndexOf("/");
   if (slash > 0) {
      var dir = filePath.substring(0, slash);
      if (!File.directoryExists(dir)) {
         try { File.createDirectory(dir, true); } catch (e) {
            throw new Error("No se pudo crear la carpeta " + dir + ": " + e);
         }
      }
   }
   var ok = window.saveAs(filePath, false, false, false, false);
   if (ok === false || !File.exists(filePath)) {
      throw new Error("PixInsight no guardo el fichero: " + filePath +
                      " (revisa la consola: ruta, formato o permisos)");
   }
   return {
      status: "success",
      outputs: { filePath: filePath },
      message: "Saved " + viewId + " to " + filePath
   };
}

function handleCloseImage(command) {
   var viewId = command.parameters.viewId;
   var window = findWindowByViewId(viewId);
   if (!window) {
      throw new Error(notFoundMessage("Image", viewId));
   }
   window.forceClose();
   return {
      status: "success",
      outputs: {},
      message: "Closed " + viewId
   };
}

function handleGetImageStatistics(command) {
   var viewId = command.parameters.viewId;
   var window = findWindowByViewId(viewId);
   if (!window) {
      throw new Error(notFoundMessage("Image", viewId));
   }
   var img = window.mainView.image;
   var stats = [];
   var channelNames = img.isColor ? ["Red", "Green", "Blue"] : ["Gray"];

   for (var c = 0; c < img.numberOfChannels; ++c) {
      img.selectedChannel = c;
      stats.push({
         channel: c,
         channelName: c < channelNames.length ? channelNames[c] : "Channel_" + c,
         mean: img.mean(),
         median: img.median(),
         stdDev: img.stdDev(),
         min: img.minimum(),
         max: img.maximum()
      });
   }
   img.resetSelections();

   return {
      status: "success",
      outputs: { statistics: stats },
      message: "Statistics for " + viewId + " (" + stats.length + " channel(s))"
   };
}

// ============================================================================
// Process Execution Handlers
// ============================================================================

// Huella barata de una vista: media por canal + suma ponderada de ~4000 muestras.
// Sirve para saber si un proceso cambio la imagen de verdad.
function viewSignature(view) {
   var img = view.image;
   var sig = [];
   for (var c = 0; c < img.numberOfChannels; ++c) {
      img.selectedChannel = c;
      sig.push(img.mean());
   }
   img.resetSelections();
   var stepX = Math.max(1, Math.floor(img.width / 64));
   var stepY = Math.max(1, Math.floor(img.height / 64));
   var acc = 0;
   for (var y = 0; y < img.height; y += stepY)
      for (var x = 0; x < img.width; x += stepX)
         for (var k = 0; k < img.numberOfChannels; ++k)
            acc += img.sample(x, y, k) * (1 + ((x * 7 + y * 13 + k) % 97));
   sig.push(acc);
   return sig;
}

function sameSignature(a, b) {
   if (a.length !== b.length) return false;
   for (var i = 0; i < a.length; ++i)
      if (a[i] !== b[i]) return false;
   return true;
}

function handleRunPixelMath(command) {
   var prm = command.parameters;
   var P = new PixelMath;
   P.expression = prm.expression || "";
   P.expression1 = prm.expression1 || "";
   P.expression2 = prm.expression2 || "";
   P.useSingleExpression = prm.useSingleExpression !== false;
   P.symbols = prm.symbols || "";
   if (prm.rescale !== undefined) P.rescale = prm.rescale;
   if (prm.truncate !== undefined) P.truncate = prm.truncate;
   P.createNewImage = prm.createNewImage || false;
   if (prm.newImageId) {
      P.newImageId = prm.newImageId;
   }

   var shortExpr = P.expression.length > 120 ? P.expression.substring(0, 120) + "..." : P.expression;
   var ok;
   var verified = "";

   if (command.targetView) {
      var view = findViewById(command.targetView);
      if (!view) throw new Error(notFoundMessage("View", command.targetView));
      var before = P.createNewImage ? null : viewSignature(view);
      var nWindows = ImageWindow.windows.length;
      ok = P.executeOn(view);
      if (ok === false)
         throw new Error("PixelMath devolvio false (no se aplico). Revisa la consola de PixInsight. Expresion: " + shortExpr);
      if (P.createNewImage) {
         if (prm.newImageId && findViewById(prm.newImageId) == null)
            throw new Error("PixelMath no creo la imagen '" + prm.newImageId + "'. Expresion: " + shortExpr);
         if (!prm.newImageId && ImageWindow.windows.length <= nWindows)
            throw new Error("PixelMath no creo ninguna imagen nueva. Expresion: " + shortExpr);
         verified = " (imagen nueva creada)";
      } else {
         if (sameSignature(before, viewSignature(view))) {
            if (!prm.allowNoChange)
               throw new Error("PixelMath termino sin cambiar " + command.targetView +
                  ". Posibles causas: simbolos sin declarar en 'symbols', funcion inexistente (no hay pow(), usa exp(b*ln(a))), " +
                  "o la formula da el mismo resultado. Usa allowNoChange=true si es intencionado. Expresion: " + shortExpr);
            verified = " (sin cambios, permitido)";
         } else {
            verified = " (verificado: la imagen cambio)";
         }
      }
   } else {
      ok = P.executeGlobal();
      if (ok === false)
         throw new Error("PixelMath devolvio false (no se aplico). Expresion: " + shortExpr);
   }
   return {
      status: "success",
      outputs: { verified: verified },
      message: "PixelMath executed" + verified + ": " + shortExpr
   };
}

function handleRemoveGradient(command) {
   var P = new AutomaticBackgroundExtractor;
   P.polyDegree = command.parameters.polyDegree || 4;
   P.tolerance = command.parameters.tolerance || 1.0;

   var view = findViewById(command.targetView);
   if (!view) throw new Error(notFoundMessage("View", command.targetView));
   mustExecute(P, view);
   return {
      status: "success",
      outputs: {},
      message: "Gradient removed from " + command.targetView + " (ABE, degree " + P.polyDegree + ")"
   };
}

// Aplica un proceso y lanza un error si PixInsight no lo ejecuto (executeOn devuelve false
// cuando el proceso falla: p. ej. SPCC sin solucion astrometrica). Antes se respondia "success".
function mustExecute(P, view, name) {
   var ok = P.executeOn(view);
   if (ok === false)
      throw new Error((name || "El proceso") + " fallo sobre " + view.id +
                      " (PixInsight devolvio false; el motivo esta en la consola de PixInsight)");
   return ok;
}

function handleColorCalibrate(command) {
   var method = command.parameters.method || "spcc";
   var view = findViewById(command.targetView);
   if (!view) throw new Error(notFoundMessage("View", command.targetView));

   if ((method === "spcc" || method === "pcc") && !view.window.hasAstrometricSolution)
      throw new Error(method.toUpperCase() + ": " + view.id + " no tiene solucion astrometrica. " +
                      "Resolverla antes con ImageSolver (es un script: lo lanza el usuario pausando el watcher) " +
                      "o copiarla de una imagen con la misma geometria (copyAstrometricSolution).");
   if (method === "spcc") {
      mustExecute(new SpectrophotometricColorCalibration, view, "SPCC");
   } else if (method === "pcc") {
      mustExecute(new PhotometricColorCalibration, view, "PCC");
   } else {
      mustExecute(new ColorCalibration, view, "ColorCalibration");
   }
   return {
      status: "success",
      outputs: {},
      message: "Color calibrated " + command.targetView + " using " + method.toUpperCase()
   };
}

function handleRemoveGreenCast(command) {
   var P = new SCNR;
   P.colorToRemove = SCNR.prototype.Green;
   P.amount = command.parameters.amount !== undefined ? command.parameters.amount : 1.0;

   var view = findViewById(command.targetView);
   if (!view) throw new Error(notFoundMessage("View", command.targetView));
   mustExecute(P, view);
   return {
      status: "success",
      outputs: {},
      message: "Green cast removed from " + command.targetView
   };
}

function handleStretchImage(command) {
   var method = command.parameters.method || "auto";
   var view = findViewById(command.targetView);
   if (!view) throw new Error(notFoundMessage("View", command.targetView));

   if (method === "auto") {
      var P = new AutoHistogram;
      mustExecute(P, view);
   } else if (method === "stf") {
      // Autoestirado tipo STF APLICADO A LA IMAGEN (antes solo cambiaba la visualizacion y el
      // agente seguia como si la imagen estuviera estirada). Punto negro por canal (cada canal de
      // un master OSC sin calibrar tiene su propio pedestal; uno comun deja un canal a 0) y los
      // mismos medios en los tres canales.
      var tb = command.parameters.targetBackground || 0.25;
      if (!(tb > 0 && tb < 0.5)) throw new Error("targetBackground fuera de rango (0, 0.5): " + tb);
      var im = view.image, nC = im.numberOfChannels, c0s = [], sx = 0;
      for (var c = 0; c < nC; ++c) {
         im.selectedChannel = c;
         var med = im.median(), madn = 1.4826 * im.MAD(med);
         if (med > 0.1) {
            im.resetSelections();
            throw new Error("stretch_image stf: la imagen ya no es lineal (mediana del canal " + c + " = " +
                            med.toFixed(3) + "). Estirarla otra vez la quema: usa curvas suaves o GHS con LP.");
         }
         var c0 = Math.max(0, med - 2.8 * madn);
         c0s.push(c0);
         sx += (med - c0) / (1 - c0);
      }
      im.resetSelections();
      var x = sx / nC;
      if (!(x > 0)) throw new Error("stretch_image stf: no se pudo calcular el estirado (mediana <= punto negro)");
      // MTF(m, x) = (m-1)x / ((2m-1)x - m); buscamos m tal que MTF(m, x) = tb
      var mt = (x * (tb - 1)) / ((2 * tb - 1) * x - tb);
      var H = new HistogramTransformation;
      var rows = [];
      for (var k = 0; k < 3; ++k) rows.push([nC > 1 ? c0s[k] : 0, nC > 1 ? mt : 0.5, 1.0, 0, 1.0]);
      rows.push(nC > 1 ? [0, 0.5, 1.0, 0, 1.0] : [c0s[0], mt, 1.0, 0, 1.0]);
      rows.push([0, 0.5, 1.0, 0, 1.0]);
      H.H = rows;
      mustExecute(H, view, "HistogramTransformation (autoestirado)");
      var c0txt = [];
      for (var q = 0; q < c0s.length; ++q) c0txt.push(c0s[q].toExponential(3));
      return {
         status: "success",
         outputs: { shadows: c0s, midtones: mt },
         message: "Autoestirado aplicado a " + command.targetView + " (fondo objetivo " + tb +
                  ", sombras por canal " + c0txt.join("/") + ", medios " + mt.toExponential(3) +
                  "). La imagen ya NO es lineal. Ojo: el punto negro por canal neutraliza el fondo; " +
                  "no sustituye a la calibracion de color (SPCC)."
      };
   } else {
      // Manual HistogramTransformation
      var P = new HistogramTransformation;
      var sc = command.parameters.shadowsClipping || 0.0;
      var mt = command.parameters.midtones || 0.5;
      if (!(sc >= 0 && sc < 1)) throw new Error("shadowsClipping fuera de rango [0,1): " + sc);
      if (!(mt > 0 && mt < 1)) throw new Error("midtones fuera de rango (0,1): " + mt);
      // No recortar a negro mas de la mitad de la imagen: punto negro por debajo de la mediana
      var img = view.image;
      for (var c = 0; c < img.numberOfChannels; ++c) {
         img.selectedChannel = c;
         var med = img.median();
         if (sc >= med) {
            img.resetSelections();
            throw new Error("shadowsClipping " + sc + " >= mediana del canal " + c + " (" +
                            med.toExponential(3) + "): recortaria a negro mas de la mitad de la imagen");
         }
      }
      img.resetSelections();
      // Filas de H: [c0 (sombras), m (medios), c1 (luces), r0, r1]; filas R, G, B, RGB/K, alfa
      P.H = [
         [0, 0.5, 1.0, 0, 1.0],
         [0, 0.5, 1.0, 0, 1.0],
         [0, 0.5, 1.0, 0, 1.0],
         [sc, mt, 1.0, 0, 1.0],
         [0, 0.5, 1.0, 0, 1.0]
      ];
      mustExecute(P, view);
   }
   return {
      status: "success",
      outputs: {},
      message: "Stretched " + command.targetView + " using " + method + " method" +
               (method === "manual" ? " (sombras " + command.parameters.shadowsClipping + ", medios " + command.parameters.midtones + ")" : "")
   };
}

function handleApplyCurves(command) {
   var P = new CurvesTransformation;
   var curvePoints = command.parameters.curvePoints || [[0, 0], [1, 1]];
   var channel = command.parameters.channel || "rgb";

   // CurvesTransformation uses arrays like: [ [x0,y0], [x1,y1], ... ]
   // Channel mapping: R=0, G=1, B=2, RGB/K=3, alpha=4, L=5, a=6, b=7, c=8, H=9, S=10
   var channelMap = {
      "red": "R", "green": "G", "blue": "B", "rgb": "K",
      "lightness": "L", "saturation": "S"
   };

   // Set the curve for the selected channel
   var ch = channelMap[channel] || "K";
   P[ch] = curvePoints;

   var view = findViewById(command.targetView);
   if (!view) throw new Error(notFoundMessage("View", command.targetView));
   mustExecute(P, view);
   return {
      status: "success",
      outputs: {},
      message: "Curves applied to " + command.targetView + " (" + channel + " channel)"
   };
}

function handleDenoise(command) {
   var P = new MultiscaleLinearTransform;
   var layers = command.parameters.layers || 4;
   var strength = command.parameters.strength || [];
   // Fila: [enabled, biasEnabled, bias, noiseReductionEnabled,
   //        noiseReductionThreshold, noiseReductionAmount, noiseReductionIterations]
   // La ultima columna es un entero (iteraciones), no un booleano.
   var layerConfig = [];
   for (var i = 0; i < layers; ++i) {
      var amount = (i < strength.length && typeof strength[i] === "number") ? strength[i] : 1.0;
      amount = Math.max(0, Math.min(1, amount));
      layerConfig.push([true, true, 0.000, amount > 0, 3.000, amount, 1]);
   }
   // Capa residual, sin reduccion de ruido
   layerConfig.push([true, true, 0.000, false, 3.000, 1.00, 1]);
   P.layers = layerConfig;

   var view = findViewById(command.targetView);
   if (!view) throw new Error(notFoundMessage("View", command.targetView));
   mustExecute(P, view);
   var amounts = [];
   for (var j = 0; j < layers; ++j) amounts.push(layerConfig[j][5]);
   return {
      status: "success",
      outputs: {},
      message: "Denoised " + command.targetView + " (MLT, " + layers +
               " layers, amounts " + amounts.join("/") + ")"
   };
}

function handleSharpen(command) {
   var P = new UnsharpMask;
   var sigma = command.parameters.sigma || 2.0;
   var amount = command.parameters.amount || 0.8;
   // Rangos que admite UnsharpMask en PixInsight 1.9.5
   if (!(sigma >= 0.1 && sigma <= 250)) throw new Error("sigma fuera de rango [0.1, 250]: " + sigma);
   if (!(amount >= 0.1 && amount <= 1.0)) throw new Error("amount fuera de rango [0.1, 1.0]: " + amount +
      " (UnsharpMask no admite mas de 1.0; para mas efecto, repetir con amount menor o subir sigma)");
   P.sigma = sigma;
   P.amount = amount;

   var view = findViewById(command.targetView);
   if (!view) throw new Error(notFoundMessage("View", command.targetView));
   mustExecute(P, view);
   return {
      status: "success",
      outputs: {},
      message: "Sharpened " + command.targetView + " (sigma: " + P.sigma + ", amount: " + P.amount + ")"
   };
}

function handleDeconvolve(command) {
   var P = new Deconvolution;
   var sigma = command.parameters.psfSigma || 2.5;
   var iters = command.parameters.iterations || 50;
   if (!(sigma > 0 && sigma <= 50)) throw new Error("psfSigma fuera de rango (0, 50]: " + sigma);
   iters = Math.round(iters);
   if (!(iters >= 1 && iters <= 500)) throw new Error("iterations fuera de rango [1, 500]: " + iters);
   // PSF parametrica gaussiana (psfShape 2). En PI 1.9.5 los nombres son psfMode/psfSigma/
   // numberOfIterations; P.iterations es otra tabla (no el numero de iteraciones).
   P.algorithm = Deconvolution.prototype.RichardsonLucy;
   P.psfMode = Deconvolution.prototype.Parametric;
   P.psfSigma = sigma;
   P.psfShape = 2.0;
   P.psfAspectRatio = 1.0;
   P.numberOfIterations = iters;
   // Deringing activado por defecto para no crear anillos oscuros en estrellas
   P.deringing = command.parameters.deringing !== false;
   P.deringingDark = 0.1;
   P.deringingBright = 0.0;
   P.toLuminance = true;

   var view = findViewById(command.targetView);
   if (!view) throw new Error(notFoundMessage("View", command.targetView));
   mustExecute(P, view);
   return {
      status: "success",
      outputs: {},
      message: "Deconvolved " + command.targetView + " (RL, PSF gaussiana sigma " + sigma + ", " + iters + " iteraciones, deringing " + (P.deringing ? "si" : "no") + ")"
   };
}

function handleCombineLRGB(command) {
   var P = new LRGBCombination;
   P.channelL = [true, command.parameters.luminanceViewId];
   P.channelR = [false, ""];
   P.channelG = [false, ""];
   P.channelB = [false, ""];
   P.luminanceWeight = command.parameters.luminanceWeight || 1.0;

   // Execute on the RGB image
   var view = findViewById(command.targetView);
   if (!view) throw new Error(notFoundMessage("View", command.targetView));
   mustExecute(P, view);
   return {
      status: "success",
      outputs: {},
      message: "LRGB combined onto " + command.targetView
   };
}

function handleBlendNarrowband(command) {
   var P = new PixelMath;
   var nbView = command.parameters.narrowbandViewId;
   var strength = command.parameters.blendStrength || 1.0;
   var mode = command.parameters.blendMode || "max";
   var channel = command.parameters.targetChannel || "red";

   // Build PixelMath expression based on blend mode
   var expr;
   if (mode === "max") {
      expr = "max($T, " + nbView + " * " + strength + ")";
   } else if (mode === "screen") {
      expr = "~(~$T * ~(" + nbView + " * " + strength + "))";
   } else if (mode === "add") {
      expr = "$T + " + nbView + " * " + strength;
   } else {
      // Custom fallback: simple max
      expr = "max($T, " + nbView + " * " + strength + ")";
   }

   if (channel === "red") {
      P.expression = expr;
      P.expression1 = "$T";
      P.expression2 = "$T";
      P.useSingleExpression = false;
   } else if (channel === "all" || channel === "luminance") {
      P.expression = expr;
      P.useSingleExpression = true;
   } else {
      P.expression = expr;
      P.useSingleExpression = true;
   }
   P.createNewImage = false;

   var view = findViewById(command.targetView);
   if (!view) throw new Error(notFoundMessage("View", command.targetView));
   mustExecute(P, view);
   return {
      status: "success",
      outputs: {},
      message: "Blended " + nbView + " into " + command.targetView + " (" + mode + ", strength: " + strength + ")"
   };
}

function handleRunScript(command) {
   var code = command.parameters.code;
   // Capture console output
   var consoleOutput = "";
   try {
      // Execute the code
      var result = eval(code);
      return {
         status: "success",
         outputs: { consoleOutput: String(result !== undefined ? result : "Script executed.") },
         message: "Script executed successfully"
      };
   } catch (e) {
      throw new Error("Script error: " + e.message + pjsrHint(String(e.message)));
   }
}

// Pistas para errores tipicos de PJSR escrito de memoria (sobre todo por modelos locales)
function pjsrHint(msg) {
   var h = [];
   if (/\.(process|execute|run|apply) is not a function/.test(msg))
      h.push("Los procesos se aplican con P.executeOn(ventana.mainView) (o P.executeGlobal()), no con .process(), .execute(), .run() ni .apply().");
   if (/is not defined/.test(msg))
      h.push("Esa funcion o variable no existe en PJSR. Usa ImageWindow.windowById(id) o View.viewById(id) " +
             "(comprobar .isNull), o findViewById(id) del watcher; para un proceso, describe_process.");
   if (/processing\[/.test(msg))
      h.push("view.processing no es un array: usa h.length y h.at(i) (h.at(i).toSource() da el codigo del paso).");
   if (/Parsing 32-bit floating point|whiteReferenceSpectrum/.test(msg))
      h.push("SPCC: whiteReferenceSpectrum es la tabla del espectro, no el nombre. Usa el icono del usuario " +
             "(ProcessInstance.fromIcon(\"SPCC_RGB\")); \"Average Spiral Galaxy\" ya es la referencia por defecto.");
   if (/copyAstrometricSolution is not a function/.test(msg))
      h.push("copyAstrometricSolution es de la VENTANA: ventanaDestino.copyAstrometricSolution(ventanaOrigen), " +
             "y solo entre imagenes con la misma geometria. SPCC exige ademas que la imagen siga LINEAL.");
   if (/undefined property \S*\.image\b/.test(msg) || /\.image is undefined/.test(msg))
      h.push("Una ventana no tiene .image: usa ventana.mainView.image.");
   if (/\.(clone|copy|duplicate) is not a function/.test(msg))
      h.push("Para duplicar una imagen: var w2 = new ImageWindow(img.width, img.height, img.numberOfChannels, 32, true, " +
             "img.isColor, \"Nombre_v3\"); w2.mainView.beginProcess(); w2.mainView.image.assign(img); " +
             "w2.mainView.endProcess(); w2.copyAstrometricSolution(ventanaOrigen); w2.show();");
   if (/null|isNull/.test(msg))
      h.push("windowById/viewById nunca devuelven null: comprobar .isNull.");
   if (/SyntaxError|unexpected token|missing ;/i.test(msg))
      h.push("PJSR es ECMAScript 5: solo var y function(){}; nada de let/const, flechas, plantillas ni clases.");
   if (/is not a function/.test(msg) && !h.length)
      h.push("Ese metodo no existe en ese objeto: no lo inventes. Metodos reales de Image: " +
             "selectedChannel = c y luego median(), mean(), MAD(), stdDev(), minimum(), maximum(); " +
             "resetSelections(); sample(x, y, c); getSamples(new Float32Array(n), rect, c); setSamples(...); " +
             "assign(otraImagen). Para procesos, describe_process.");
   if (!h.length) return "";
   var ids = openViewIds();
   return "\nPista: " + h.join(" ") + " Vistas abiertas: " + (ids.length ? ids.join(", ") : "ninguna") + ".";
}

// Lista constantes (p. ej. IntegerResample.prototype.Average) y parametros con su
// valor por defecto de cualquier proceso, tal como existen en esta version de PixInsight.
function handleDescribeProcess(command) {
   var name = String(command.parameters.process || "");
   if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
      throw new Error("Nombre de proceso no valido: " + name);
   var ctor;
   try { ctor = eval(name); } catch (e) { ctor = undefined; }
   if (typeof ctor !== "function") {
      var alias = {
         GHS: "GeneralizedHyperbolicStretch", GreenHyperbolicStretch: "GeneralizedHyperbolicStretch",
         GeneralisedHyperbolicStretch: "GeneralizedHyperbolicStretch",
         BXT: "BlurXTerminator", NXT: "NoiseXTerminator", SXT: "StarXTerminator",
         MAS: "MultiscaleAdaptiveStretch", HT: "HistogramTransformation",
         Curves: "CurvesTransformation", CurvesTransform: "CurvesTransformation",
         SPCC: "SpectrophotometricColorCalibration", SPFC: "SpectrophotometricFluxCalibration",
         MGC: "MultiscaleGradientCorrection", LHE: "LocalHistogramEqualization",
         HDRMT: "HDRMultiscaleTransform", MLT: "MultiscaleLinearTransform", MMT: "MultiscaleMedianTransform"
      };
      var hint = "";
      if (alias[name]) {
         var t; try { t = typeof eval(alias[name]); } catch (e2) { t = "undefined"; }
         hint = (t === "function") ? " Quizas quieres: " + alias[name] + "." :
                " El nombre real seria " + alias[name] + ", pero no esta instalado.";
      }
      throw new Error("Proceso desconocido: " + name + "." + hint +
                      " Ojo: los scripts (ImageSolver, DBXtract, GraXpert, AutoPalette...) no son procesos.");
   }

   var proto = ctor.prototype;
   var names = [];
   try { names = Object.getOwnPropertyNames(proto); } catch (e) {}
   for (var key in proto)
      if (names.indexOf(key) < 0) names.push(key);
   names.sort();

   var constants = {};
   for (var i = 0; i < names.length; ++i) {
      var k = names[i];
      var v;
      try { v = proto[k]; } catch (e) { continue; }
      if (typeof v === "number" && /^[A-Z]/.test(k) && k.length > 1)
         constants[k] = v;
   }
   // Los parametros no son enumerables; toSource() da la instancia por defecto como codigo.
   var parameters = "";
   try { parameters = (new ctor).toSource("JavaScript", "P"); } catch (e) {}
   if (parameters.length > 8000) parameters = parameters.substring(0, 8000) + "\n...";
   return {
      status: "success",
      outputs: { process: name, constants: constants, parameters: parameters },
      message: "Described " + name
   };
}

// ============================================================================
// Utility Functions
// ============================================================================

function findWindowByViewId(viewId) {
   var windows = ImageWindow.windows;
   for (var i = 0; i < windows.length; ++i) {
      if (windows[i].mainView.id === viewId) {
         return windows[i];
      }
      // Check previews too
      for (var j = 0; j < windows[i].previews.length; ++j) {
         if (windows[i].previews[j].id === viewId) {
            return windows[i];
         }
      }
   }
   return null;
}

function openViewIds() {
   var ids = [];
   var windows = ImageWindow.windows;
   for (var i = 0; i < windows.length; ++i) {
      ids.push(windows[i].mainView.id);
      for (var j = 0; j < windows[i].previews.length; ++j) ids.push(windows[i].previews[j].id);
   }
   return ids;
}

function notFoundMessage(kind, viewId) {
   var ids = openViewIds();
   return kind + " not found: " + viewId + ". Vistas abiertas: " +
          (ids.length ? ids.join(", ") : "ninguna") +
          ". Usa uno de estos IDs exactos (list_open_images los muestra).";
}

function findViewById(viewId) {
   var windows = ImageWindow.windows;
   for (var i = 0; i < windows.length; ++i) {
      if (windows[i].mainView.id === viewId) {
         return windows[i].mainView;
      }
      for (var j = 0; j < windows[i].previews.length; ++j) {
         if (windows[i].previews[j].id === viewId) {
            return windows[i].previews[j];
         }
      }
   }
   return null;
}

// ============================================================================
// Command Router
// ============================================================================

function dispatchCommand(command) {
   var tool = command.tool;

   // Internal commands
   if (tool === "list_open_images") return handleListOpenImages(command);
   if (tool === "open_image") return handleOpenImage(command);
   if (tool === "save_image") return handleSaveImage(command);
   if (tool === "close_image") return handleCloseImage(command);
   if (tool === "get_image_statistics") return handleGetImageStatistics(command);

   // Processing commands
   if (tool === "run_pixelmath") return handleRunPixelMath(command);
   if (tool === "remove_gradient") return handleRemoveGradient(command);
   if (tool === "color_calibrate") return handleColorCalibrate(command);
   if (tool === "remove_green_cast") return handleRemoveGreenCast(command);
   if (tool === "stretch_image") return handleStretchImage(command);
   if (tool === "apply_curves") return handleApplyCurves(command);
   if (tool === "denoise") return handleDenoise(command);
   if (tool === "sharpen") return handleSharpen(command);
   if (tool === "deconvolve") return handleDeconvolve(command);
   if (tool === "combine_lrgb") return handleCombineLRGB(command);
   if (tool === "blend_narrowband") return handleBlendNarrowband(command);

   // Script execution
   if (tool === "run_script") return handleRunScript(command);
   if (tool === "describe_process") return handleDescribeProcess(command);

   throw new Error("Unknown tool: " + tool);
}

// ============================================================================
// Main Polling Loop
// ============================================================================

function processNextCommand() {
   var files = listJsonFiles(COMMANDS_DIR + "/*.json");
   if (files.length === 0) {
      return false;
   }

   // Sort by filename (timestamp-based UUIDs give roughly chronological order)
   files.sort();

   // Process the first command
   var filePath = files[0];
   var commandJson, command;

   try {
      commandJson = readTextFile(filePath);
      command = JSON.parse(commandJson);
   } catch (e) {
      console.criticalln("[MCP Watcher] Failed to parse command file: " + filePath + " - " + e.message);
      deleteFile(filePath);
      return true;
   }

   var startTime = Date.now();
   var resultObj;
   var resultPath = RESULTS_DIR + "/" + command.id + ".json";

   // Marca "running" antes de ejecutar: si PixInsight se bloquea dentro del proceso,
   // el servidor MCP sabe que comando es y desde cuando, y puede avisar.
   var runningInfo = {
      id: command.id,
      timestamp: getTimestamp(),
      started: getTimestamp(),
      status: "running",
      tool: command.tool,
      process: command.process,
      targetView: command.targetView || null,
      duration_ms: 0
   };
   try {
      writeTextFile(resultPath, JSON.stringify(runningInfo));
      writeTextFile(CURRENT_FILE, JSON.stringify(runningInfo));
   } catch (eRun) {}
   // El comando ya esta recogido: se quita de la cola para que no se repita.
   deleteFile(filePath);

   try {
      console.writeln("[MCP Watcher] Executing: " + command.tool + " (id: " + command.id + ")");
      var handlerResult = dispatchCommand(command);
      resultObj = {
         id: command.id,
         timestamp: getTimestamp(),
         status: handlerResult.status,
         process: command.process,
         duration_ms: Date.now() - startTime,
         outputs: handlerResult.outputs || {},
         message: handlerResult.message || ""
      };
   } catch (e) {
      console.criticalln("[MCP Watcher] Error executing " + command.tool + ": " + e.message);
      resultObj = {
         id: command.id,
         timestamp: getTimestamp(),
         status: "error",
         process: command.process,
         duration_ms: Date.now() - startTime,
         error: {
            message: e.message,
            type: e.name || "Error",
            stack: e.stack || ""
         }
      };
   }

   // Write result
   try {
      writeTextFile(resultPath, JSON.stringify(resultObj));
      console.writeln("[MCP Watcher] Result written: " + resultObj.status +
         " (" + resultObj.duration_ms + "ms)");
   } catch (e) {
      console.criticalln("[MCP Watcher] Failed to write result: " + e.message);
   }
   deleteFile(CURRENT_FILE);

   return true;
}

function runWatcher() {
   // Ensure directories exist
   ensureDirectory(BRIDGE_DIR);
   ensureDirectory(COMMANDS_DIR);
   ensureDirectory(RESULTS_DIR);
   ensureDirectory(LOGS_DIR);

   var SHUTDOWN_FILE = BRIDGE_DIR + "/shutdown";
   var PAUSE_FILE = BRIDGE_DIR + "/pause";

   // Limpia senales antiguas para no arrancar ya parado o en pausa
   try { if (File.exists(SHUTDOWN_FILE)) File.remove(SHUTDOWN_FILE); } catch (e0) {}
   try { if (File.exists(PAUSE_FILE)) File.remove(PAUSE_FILE); } catch (e1) {}

   console.noteln("===========================================");
   console.noteln("  PixInsight MCP Watcher v" + WATCHER_VERSION);
   console.noteln("  Bridge: " + BRIDGE_DIR);
   console.noteln("  Polling every " + POLL_INTERVAL_MS + "ms");
   console.noteln("  Parar:     crear el archivo  " + SHUTDOWN_FILE);
   console.noteln("  Pausar:    crear el archivo  " + PAUSE_FILE + "  (borrarlo = reanudar)");
   console.noteln("  Tambien:   boton Pause/Abort de la consola, o mcp-stop.bat");
   console.noteln("===========================================");

   var commandCount = 0;
   var lastActivity = Date.now();
   var wasPaused = false;

   console.show();
   // Sin esto, console.abortRequested nunca se activa y el boton Pause/Abort de la consola queda desactivado.
   console.abortEnabled = true;

   // La senal de parada es "pegajosa": una vez detectada, sigue siendo true.
   // (Antes se consumia dentro de un bucle interno y el bucle externo no la veia.)
   var stopFlag = false;
   function shouldShutdown() {
      if (stopFlag) return true;
      if (console.abortRequested) { stopFlag = true; return true; }
      if (File.exists(SHUTDOWN_FILE)) {
         try { File.remove(SHUTDOWN_FILE); } catch (e) {}
         stopFlag = true;
         return true;
      }
      return false;
   }

   // Main loop - processEvents() keeps PixInsight UI responsive
   for (;;) {
      processEvents();

      if (shouldShutdown()) {
         console.warningln("[MCP Watcher] Shutdown requested. Stopping.");
         break;
      }

      // Pausa: no se ejecuta ningun comando mientras exista el archivo "pause"
      if (File.exists(PAUSE_FILE)) {
         if (!wasPaused) {
            console.warningln("[MCP Watcher] EN PAUSA. Borra el archivo 'pause' para reanudar.");
            wasPaused = true;
         }
         lastActivity = Date.now();
         msleep(50);
         continue;
      }
      if (wasPaused) {
         console.noteln("[MCP Watcher] Reanudado.");
         wasPaused = false;
         lastActivity = Date.now();
      }

      var processed = processNextCommand();
      if (processed) {
         commandCount++;
         lastActivity = Date.now();
         // Yield after command execution so UI can catch up
         for (var y = 0; y < 20; ++y) {
            processEvents();
            msleep(20);
            if (shouldShutdown()) break;
         }
      } else {
         if (IDLE_TIMEOUT_MIN > 0 &&
             (Date.now() - lastActivity) > IDLE_TIMEOUT_MIN * 60000) {
            console.warningln("[MCP Watcher] Parada por inactividad (" + IDLE_TIMEOUT_MIN + " min).");
            break;
         }
         // No commands - short sleeps, ~500 ms total before re-checking
         for (var i = 0; i < 25; ++i) {
            msleep(20);
            processEvents();
            if (shouldShutdown()) break;
         }
      }
   }

   console.noteln("[MCP Watcher] Stopped. Processed " + commandCount + " command(s). PixInsight libre.");
}

// ============================================================================
// Entry Point
// ============================================================================

runWatcher();
