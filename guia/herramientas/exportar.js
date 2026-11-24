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
// sobrescribir (false: si el fichero existe, añade _2, _3...), calidad (JPG 1–100; por defecto la de PixInsight) o
// jpgMB (tamaño del JPG en MB: busca la calidad que se acerca sin pasarse). girar vale igual que girar180.

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

// Nivel del cielo de la imagen terminada: percentil 20 de las medianas de bloques de 64 px de la luminancia (media de
// canales). Lo mismo que el «cielo» de las funciones de fondo de Siril y SASpro, sin necesitar una máscara.
function exCielo(view) {
  var im = view.image, W = im.width, H = im.height, B = 64, meds = [], nc = im.numberOfChannels;
  var row = new Float32Array(B * B);
  for (var y0 = 0; y0 + B <= H; y0 += B) for (var x0 = 0; x0 + B <= W; x0 += B) {
    var acc = new Float32Array(B * B);
    for (var c = 0; c < nc; ++c) { im.getSamples(row, new Rect(x0, y0, x0 + B, y0 + B), c); for (var i = 0; i < B * B; i += 4) acc[i] += row[i] / nc; }
    var v = []; for (var j = 0; j < B * B; j += 4) v.push(acc[j]);
    v.sort(function (a, b) { return a - b; }); meds.push(v[v.length >> 1]);
  }
  if (!meds.length) return null;
  meds.sort(function (a, b) { return a - b; });
  return meds[Math.floor(0.2 * (meds.length - 1))];
}

// Gamut (lámina «gamut»): valores pegados a 0 o a 1 en algún canal antes y después de convertir a sRGB. Si la conversión
// recorta más del 0,05 % de los valores, hay colores fuera del gamut que el JPG/TIFF pierde.
function exRecortados(view) {
  var im = view.image, W = im.width, H = im.height, n = W * H, b = new Float32Array(n), k = 0, t = 0;
  for (var c = 0; c < im.numberOfChannels; ++c) {
    im.getSamples(b, new Rect(0, 0, W, H), c);
    for (var i = 0; i < n; i += 2) { ++t; if (b[i] <= 0 || b[i] >= 0.9999) ++k; }
  }
  return t ? 100 * k / t : 0;
}
function exGamut(antes, despues) {
  var a = exRecortados(antes), d = exRecortados(despues);
  return { recortados_antes_pct: +a.toFixed(4), recortados_srgb_pct: +d.toFixed(4), recortados_por_conversion_pct: +Math.max(0, d - a).toFixed(4) };
}

function exSave(win, path, hints) {
  if (!win.saveAs(path, false, false, false, false, hints || "")) throw new Error("No se pudo guardar " + path);
  var kb = 0; try { kb = Math.round(new FileInfo(path).size / 1024); } catch (e) { }
  return { fichero: path, kB: kb };
}

// JPG con calidad fija (o.calidad, 1–100) o con el tamaño pedido (o.jpgMB): busca la calidad por bisección entre 70 y
// 100 guardando y midiendo (17 nov 2026: Rafael pidió un JPG de 6 MB y salía de 1,7 con la calidad por defecto).
function exSaveJpg(win, path, o) {
  if (o.jpgMB > 0) {
    var objetivo = o.jpgMB * 1024, lo = 70, hi = 100, mejor = 70;
    while (lo <= hi) {
      var q = (lo + hi) >> 1;
      if (exSave(win, path, "quality " + q).kB <= objetivo) { mejor = q; lo = q + 1; } else hi = q - 1;
    }
    var r = exSave(win, path, "quality " + mejor);   // el fichero queda con la calidad elegida
    r.calidad = mejor;
    mejor = r;
    mejor.objetivo_MB = o.jpgMB;
    if (mejor.calidad >= 100 && mejor.kB < 0.9 * objetivo)
      mejor.aviso = "Con calidad 100 el JPG ocupa " + (mejor.kB / 1024).toFixed(1) + " MB: no llega a " + o.jpgMB + " MB (la imagen no da para más).";
    return mejor;
  }
  var cal = o.calidad > 0 ? Math.min(100, Math.round(o.calidad)) : 0, r2 = exSave(win, path, cal ? "quality " + cal : "");
  if (cal) r2.calidad = cal;
  return r2;
}

function exportarFinal(viewId, o) {
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);   // también vale la View o el resultado de otra función ({ vista: ... })
  o = o || {};
  // La descripción del manifiesto decía «girar» y el código sólo miraba girar180: el giro se perdía sin aviso (17 nov 2026).
  if (o.girar !== undefined && o.girar180 === undefined) o.girar180 = !!o.girar;
  var v = View.viewById(viewId);
  if (!v || v.isNull) throw new Error("No existe la vista " + viewId);
  if (!o.carpeta) throw new Error("Falta la carpeta de salida (opción carpeta)");
  var dir = o.carpeta.replace(/\\/g, "/").replace(/\/$/, "");
  if (!File.directoryExists(dir)) File.createDirectory(dir, true);
  var nombre = o.nombre || viewId, fmts = o.formatos || ["xisf", "tif", "jpg"], out = [], t0 = Date.now(), gamut = null;
  var checks = exChecks(v);
  // Fondo ajustado antes de entregar (IC 405, 20 nov 2026: Qwen exportó con el cielo gris en Siril y la nebulosa apagada
  // en PixInsight por saltarse fondo y contraste). forzar: true sólo si el usuario quiere ese cielo.
  var cielo = exCielo(v);
  checks.cielo = cielo === null ? null : +cielo.toFixed(4);
  // Suelo en 0,01 (24 nov 2026): el Natural de referencia de IC 1396 tiene el cielo en 0,013 y fondoCandidatos baja hasta 0,015.
  if (!o.forzar && cielo !== null && (cielo < 0.01 || cielo > 0.10))
    throw new Error("Cielo en " + cielo.toFixed(3) + " (fuera de 0,01–0,10): ajusta el fondo antes de exportar (fondo oscuro y neutro, " +
                    "con fondoCandidatos sin pasarle cielos) y repasa contraste y saturación. forzar: true sólo si el usuario quiere ese cielo.");

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
    gamut = exGamut(v, w.mainView);
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
    if (fmts.indexOf("jpg") >= 0) out.push(exSaveJpg(w, exUnique(dir + "/" + nombre + ".jpg", o.sobrescribir), o));
    w.forceClose();
  }
  var noCumple = [];
  if (checks.a_uno_pct > 0.05) noCumple.push("hay " + checks.a_uno_pct + " % de valores a 1: zonas quemadas (núcleos de estrellas o del objeto)");
  if (checks.filas_negras_en_bordes + checks.columnas_negras_en_bordes > 0)
    noCumple.push("bordes negros: " + checks.filas_negras_en_bordes + " filas y " + checks.columnas_negras_en_bordes + " columnas; recortar antes de exportar");
  if (gamut && gamut.recortados_por_conversion_pct > 0.05)
    noCumple.push("la conversión a sRGB recorta el " + gamut.recortados_por_conversion_pct + " % de los valores (colores fuera del gamut): bajar la " +
                  "saturación (Paso 5) o desaturar sólo ese tono (saturarTono con cantidad negativa) y volver a exportar");
  return {
    vista: viewId, carpeta: dir, ficheros: out, girada_180: !!o.girar180, icc: "sRGB IEC61966-2.1 (TIFF y JPG)", gamut: gamut,
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
