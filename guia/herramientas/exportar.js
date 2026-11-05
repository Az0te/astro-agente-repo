// exportar.js — Exportación final (Paso 10 no lineal) en una sola llamada. PJSR, ECMAScript 5.
//
// Uso (en el nivel superior del script):
//   eval(File.readTextFile("<ruta de guia>/herramientas/exportar.js"));
//   var r = exportarFinal("Final", { carpeta: "<carpeta de la versión>/final", nombre: "IC1396_v1" });
//   JSON.stringify(r);
//
// Hace, en este orden y sin tocar la vista:
//   1. Controles antes de exportar: % de píxeles saturados (> 0,98 y = 1) y bordes negros (filas/columnas a 0).
//   2. XISF 32 bits de la vista tal cual (con su solución astrométrica). Ojo: saveAs no guarda el historial de procesos.
//   3. Copia → ICCProfileTransformation a sRGB → (opcional) giro 180° con FastRotation → TIFF 16 bits y JPG.
//      El XISF no se gira. Desde PixInsight 1.9.6 FastRotation también conserva la astrometría (comprobado).
// Opciones: carpeta (obligatoria; se crea si no existe: saveAs a una carpeta inexistente abre un diálogo modal que
// bloquea PixInsight), nombre (por defecto el id de la vista), girar180 (false), formatos (["xisf", "tif", "jpg"]),
// sobrescribir (false: si el fichero existe, añade _2, _3...).

function exUnique(path, sobre) {
  if (sobre || !File.exists(path)) return path;
  var dot = path.lastIndexOf("."), base = path.substring(0, dot), ext = path.substring(dot);
  for (var n = 2; ; ++n) if (!File.exists(base + "_" + n + ext)) return base + "_" + n + ext;
}

function exCopy(view, id) {
  var im = view.image; im.resetSelections();
  var old = ImageWindow.windowById(id); if (!old.isNull) old.forceClose();
  var w = new ImageWindow(im.width, im.height, im.numberOfChannels, 32, true, im.isColor, id);
  w.mainView.beginProcess(); w.mainView.image.assign(im); w.mainView.endProcess();
  return w;
}

function exChecks(view) {
  var im = view.image, W = im.width, H = im.height, n = W * H, b = new Float32Array(n), sat = 0, uno = 0;
  var zeroRows = 0, zeroCols = 0, L = new Float32Array(n);
  for (var c = 0; c < im.numberOfChannels; ++c) {
    im.getSamples(b, new Rect(0, 0, W, H), c);
    for (var i = 0; i < n; ++i) { if (b[i] > 0.98) ++sat; if (b[i] >= 1) ++uno; L[i] += b[i]; }
  }
  var edge = function (isRow, idx) {
    var len = isRow ? W : H, z = 0;
    for (var k = 0; k < len; ++k) if (L[isRow ? idx * W + k : k * W + idx] <= 0) ++z;
    return z > 0.9 * len;
  };
  var mH = Math.min(50, H >> 1), mW = Math.min(50, W >> 1);   // sólo las 50 filas y columnas de cada borde
  for (var r = 0; r < mH; ++r) { if (edge(true, r)) ++zeroRows; if (edge(true, H - 1 - r)) ++zeroRows; }
  for (var x = 0; x < mW; ++x) { if (edge(false, x)) ++zeroCols; if (edge(false, W - 1 - x)) ++zeroCols; }
  var tot = n * im.numberOfChannels;
  return { saturados_098_pct: +(100 * sat / tot).toFixed(4), a_uno_pct: +(100 * uno / tot).toFixed(4),
           filas_negras_en_bordes: zeroRows, columnas_negras_en_bordes: zeroCols };
}

function exSave(win, path) {
  if (!win.saveAs(path, false, false, false, false)) throw new Error("No se pudo guardar " + path);
  var kb = 0; try { kb = Math.round(new FileInfo(path).size / 1024); } catch (e) { }
  return { fichero: path, kB: kb };
}

function exportarFinal(viewId, o) {
  if (viewId && typeof viewId === "object" && viewId.id !== undefined) viewId = viewId.id;   // también vale la View
  o = o || {};
  var v = View.viewById(viewId);
  if (!v || v.isNull) throw new Error("No existe la vista " + viewId);
  if (!o.carpeta) throw new Error("Falta la carpeta de salida (opción carpeta)");
  var dir = o.carpeta.replace(/\\/g, "/").replace(/\/$/, "");
  if (!File.directoryExists(dir)) File.createDirectory(dir, true);
  var nombre = o.nombre || viewId, fmts = o.formatos || ["xisf", "tif", "jpg"], out = [], t0 = Date.now();
  var checks = exChecks(v);

  if (fmts.indexOf("xisf") >= 0) {
    var wx = exCopy(v, "exXISF");
    if (v.window.hasAstrometricSolution) wx.copyAstrometricSolution(v.window);
    out.push(exSave(wx, exUnique(dir + "/" + nombre + ".xisf", o.sobrescribir)));
    wx.forceClose();
  }
  if (fmts.indexOf("tif") >= 0 || fmts.indexOf("jpg") >= 0) {
    var w = exCopy(v, "exWEB");
    var icc = new ICCProfileTransformation;
    icc.targetProfile = "sRGB IEC61966-2.1";
    icc.toDefaultProfile = false;
    if (!icc.executeOn(w.mainView)) throw new Error("ICC sRGB falló");
    if (o.girar180) {
      var F = new FastRotation;
      F.mode = 0;   // Rotate180 (la constante no está expuesta en PJSR)
      if (!F.executeOn(w.mainView)) throw new Error("Giro de 180° falló");
    }
    if (fmts.indexOf("tif") >= 0) {
      var w16 = exCopy(w.mainView, "exTIF");
      var icc2 = new ICCProfileTransformation; icc2.targetProfile = "sRGB IEC61966-2.1"; icc2.toDefaultProfile = false;
      icc2.executeOn(w16.mainView);
      var SF = new SampleFormatConversion;
      SF.format = 1;   // ToInteger16 (0 = 8 bits, 1 = 16, 2 = 32 enteros, 3 = 32 coma flotante); la constante no está expuesta en PJSR
      if (!SF.executeOn(w16.mainView)) throw new Error("Conversión a 16 bits falló");
      out.push(exSave(w16, exUnique(dir + "/" + nombre + ".tif", o.sobrescribir)));
      w16.forceClose();
    }
    if (fmts.indexOf("jpg") >= 0) out.push(exSave(w, exUnique(dir + "/" + nombre + ".jpg", o.sobrescribir)));
    w.forceClose();
  }
  var noCumple = [];
  if (checks.a_uno_pct > 0.05) noCumple.push("hay " + checks.a_uno_pct + " % de valores a 1: zonas quemadas (núcleos de estrellas o del objeto)");
  if (checks.filas_negras_en_bordes + checks.columnas_negras_en_bordes > 0)
    noCumple.push("bordes negros: " + checks.filas_negras_en_bordes + " filas y " + checks.columnas_negras_en_bordes + " columnas; recortar antes de exportar");
  return {
    vista: viewId, carpeta: dir, ficheros: out, girada_180: !!o.girar180, icc: "sRGB IEC61966-2.1 (TIFF y JPG)",
    dimensiones: [v.image.width, v.image.height], controles: checks, no_cumple: noCumple,
    segundos: Math.round((Date.now() - t0) / 1000),
    control: {
      medido: { sin_zonas_quemadas: checks.a_uno_pct <= 0.05, sin_bordes_negros: checks.filas_negras_en_bordes + checks.columnas_negras_en_bordes === 0 },
      revisar_a_ojo: ["abrir el JPG en un visor externo y compararlo con PixInsight (si cambia el color, el ICC no va incrustado)",
                      "recortes al 100 % en fondo, núcleo de la estrella más brillante y zona de nebulosa"],
      nota: "El XISF no lleva el historial de procesos: anotar los parámetros en el dossier. Lo de revisar_a_ojo no lo mide esta función."
    }
  };
}
