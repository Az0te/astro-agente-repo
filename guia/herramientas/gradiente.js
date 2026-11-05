// gradiente.js — Comparativa de correcciones de gradiente en una sola llamada. PJSR, ECMAScript 5.
//
// Uso (cargar en el nivel superior del script, nunca dentro de una función):
//   eval(File.readTextFile("<ruta de guia>/herramientas/gradiente.js"));
//   var r = gradienteCandidatos("MasterLight", {
//     graxpert: [10, 8],                                   // escalas sample_free (sustracción)
//     mgc: [2048],                                         // escalas de MGC; [] para no probar MGC
//     spfc: { qe: "...", gray: "..." },                    // opciones de pxSPFC (perfil)
//     mars: "<ruta .xmars del perfil>",                    // obligatoria si hay escalas de MGC
//     mgcOpts: { structureSeparation: 2, modelSmoothness: 2.5 },
//     mgcBorde: true,                                      // 1.9.6+: cada escala también con edgeCorrection (false = no)
//     dossier: "C:/ruta/dossier.json"                      // opcional: escribe el dossier de PiCopilot
//   });
//   JSON.stringify(r);   // { vista, candidatos: [{vista, modelo, metodo, parametros, metricas, notas}],
//                        //   intermedias, recomendado, motivo, errores }
//
// Qué hace:
// - No modifica la vista original. GraXpert se ejecuta sobre ella con replaceImage = false y sus salidas se
//   renombran a GC_GX<escala> (corregida) y GC_GX<escala>_modelo. MGC se aplica a una copia GC_MGC<escala>
//   (con la astrometría copiada) tras SPFC; su modelo pasa a GC_MGC<escala>_modelo.
// - Mide cada modelo con gcStructCopy (gradcompare.js): corr < 0,15 = modelo limpio; > 0,5 = se come el objeto.
// - Mide también el gradiente que queda (fondoResidual, rejilla 4x3 relativa al original) y recomienda, entre los que dejan <= 30 % del gradiente, el que menos copia el objeto. Si un candidato falla, se anota en "errores" y se sigue con el resto.
// - Requiere solución astrométrica en la vista (blindSolve, Paso 8) para MGC; GraXpert no la necesita.
//
// Las herramientas gradcompare.js y procesos.js se cargan desde la misma carpeta que este fichero. Si se
// usa desde otra ubicación, definir antes del eval: var GUIA_HERRAMIENTAS = "<ruta>/guia/herramientas";

var GR_DIR = (typeof GUIA_HERRAMIENTAS !== "undefined") ? GUIA_HERRAMIENTAS
           : File.homeDirectory + "/astro-agente-repo/guia/herramientas";
if (typeof gcPrepare !== "function") eval(File.readTextFile(GR_DIR + "/gradcompare.js"));
if (typeof pxMGC !== "function") eval(File.readTextFile(GR_DIR + "/procesos.js"));

function grIds() {
  var ids = [], ws = ImageWindow.windows;
  for (var i = 0; i < ws.length; ++i) ids.push(ws[i].mainView.id);
  return ids;
}

function grNew(before) {
  var now = grIds(), out = [];
  for (var i = 0; i < now.length; ++i) if (before.indexOf(now[i]) < 0) out.push(now[i]);
  return out;
}

// Nombre libre: id, id_2, id_3...
function grFreeId(id) {
  if (ImageWindow.windowById(id).isNull) return id;
  for (var n = 2; ; ++n) if (ImageWindow.windowById(id + "_" + n).isNull) return id + "_" + n;
}

function grRename(oldId, newId) {
  var w = ImageWindow.windowById(oldId);
  if (w.isNull) throw new Error("No existe la vista " + oldId);
  var id = grFreeId(newId);
  w.mainView.id = id;
  return id;
}

function grDuplicate(srcId, newId) {
  var src = ImageWindow.windowById(srcId);
  var im = src.mainView.image;
  var id = grFreeId(newId);
  var w = new ImageWindow(im.width, im.height, im.numberOfChannels, 32, true, im.isColor, id);
  w.mainView.beginProcess();
  w.mainView.image.assign(im);
  w.mainView.endProcess();
  if (src.hasAstrometricSolution) w.copyAstrometricSolution(src);
  w.show();
  return w.mainView.id;
}

// Rango de las medianas del fondo en una rejilla 4x3 (media de canales): cuánto gradiente queda.
function grGridRange(viewId) {
  var im = ImageWindow.windowById(viewId).mainView.image;
  var nx = 4, ny = 3, cw = Math.floor(im.width / nx), ch = Math.floor(im.height / ny), meds = [];
  for (var y = 0; y < ny; ++y)
    for (var x = 0; x < nx; ++x) {
      var s = 0;
      for (var c = 0; c < im.numberOfChannels; ++c) {
        im.selectedChannel = c;
        im.selectedRect = new Rect(x * cw, y * ch, (x + 1) * cw, (y + 1) * ch);
        s += im.median();
      }
      meds.push(s / im.numberOfChannels);
    }
  im.resetSelections();
  return Math.max.apply(null, meds) - Math.min.apply(null, meds);
}

function grMeasure(base, modelId, correctedId, range0) {
  var m = gcStructCopy(base, modelId);
  return { gcStructCopy: m.corr, copia: m.copy, fondoResidual: grGridRange(correctedId) / range0 };
}

function gradienteCandidatos(viewId, o) {
  if (viewId && typeof viewId === "object" && viewId.id !== undefined) viewId = viewId.id;   // también vale la View
  o = o || {};
  var scalesGX = o.graxpert || [10, 8];
  var scalesMGC = o.mgc || [];
  var bin = o.bin || 8;
  var r = { vista: viewId, candidatos: [], intermedias: [], recomendado: "", motivo: "", errores: [] };

  var win = ImageWindow.windowById(viewId);
  if (win.isNull) throw new Error("No existe la vista " + viewId);
  var hasWCS = win.hasAstrometricSolution;

  // Base para gcStructCopy (luminancia binada del original); las vistas auxiliares que cree son intermedias.
  var before = grIds();
  var base = gcPrepare(viewId, bin);
  r.intermedias = r.intermedias.concat(grNew(before));
  var range0 = grGridRange(viewId);   // gradiente del original en la rejilla 4x3

  // GraXpert sample_free, sustracción, sobre la original sin modificarla.
  for (var i = 0; i < scalesGX.length; ++i) {
    var s = scalesGX[i];
    try {
      before = grIds();
      var G = new GraXpert;
      G.backgroundExtraction = true;
      G.backgroundExtractionSampleFree = true;
      G.sampleFreeScale = s;
      G.correction = "Subtraction";
      G.createBackground = true;
      G.replaceImage = false;
      if (!G.executeOn(win.mainView)) throw new Error("GraXpert devolvió false");
      var nuevas = grNew(before), corr = null, mod = null;
      for (var k = 0; k < nuevas.length; ++k) {
        if (nuevas[k].indexOf("background_extraction") >= 0) corr = nuevas[k];
        else if (nuevas[k].indexOf("background") >= 0) mod = nuevas[k];
      }
      if (!corr || !mod) throw new Error("no encuentro las salidas de GraXpert (nuevas: " + nuevas.join(", ") + ")");
      corr = grRename(corr, "GC_GX" + s);
      mod = grRename(mod, "GC_GX" + s + "_modelo");
      r.candidatos.push({ vista: corr, modelo: mod, metodo: "GraXpert", parametros: "sample_free escala " + s + ", sustracción",
                          metricas: grMeasure(base, mod, corr, range0),
                          notas: ImageWindow.windowById(corr).hasAstrometricSolution ? "Conserva la astrometría." : "Sin astrometría: repetir blindSolve." });
    } catch (e) {
      r.errores.push("GraXpert escala " + s + ": " + e);
    }
  }

  // MGC (SPFC previo) sobre copias. Necesita WCS y la base MARS. Con PixInsight 1.9.6+ cada escala se prueba
  // también con corrección de bordes (edgeCorrection), salvo mgcBorde: false.
  var conBorde = o.mgcBorde !== false && (new MultiscaleGradientCorrection).edgeCorrection !== undefined;
  var mgcRuns = [];
  for (var j0 = 0; j0 < scalesMGC.length; ++j0) {
    mgcRuns.push({ g: scalesMGC[j0], borde: false });
    if (conBorde) mgcRuns.push({ g: scalesMGC[j0], borde: true });
  }
  for (var j = 0; j < mgcRuns.length; ++j) {
    var g = mgcRuns[j].g, borde = mgcRuns[j].borde;
    try {
      if (!hasWCS) throw new Error("la vista no tiene solución astrométrica (Paso 8: blindSolve)");
      if (!o.mars) throw new Error("falta la ruta de la base MARS (opción mars, está en el perfil)");
      var id = grDuplicate(viewId, "GC_MGC" + g + (borde ? "_borde" : ""));
      var v = View.viewById(id);
      if (!pxSPFC(o.spfc || {}).executeOn(v)) throw new Error("SPFC devolvió false");
      var mo = { mars: o.mars, gradientScale: g, showGradientModel: true };
      if (o.mgcOpts) for (var key in o.mgcOpts) mo[key] = o.mgcOpts[key];
      if (borde) mo.edgeCorrection = true;
      before = grIds();
      if (!pxMGC(mo).executeOn(v)) throw new Error("MGC devolvió false");
      var nm = grNew(before), mmod = null;
      for (var q = 0; q < nm.length; ++q) if (nm[q].indexOf("gradient_model") >= 0 || nm[q].indexOf("model") >= 0) mmod = nm[q];
      if (!mmod) throw new Error("MGC no creó el modelo de gradiente");
      mmod = grRename(mmod, id + "_modelo");
      r.candidatos.push({ vista: id, modelo: mmod, metodo: "MGC", parametros: "SPFC + MGC gradientScale " + g + (borde ? ", corrección de bordes" : ""),
                          metricas: grMeasure(base, mmod, id, range0), notas: "No neutraliza el color del fondo (GraXpert sí)." });
    } catch (e) {
      r.errores.push("MGC escala " + g + (borde ? " con bordes" : "") + ": " + e);
    }
  }

  // Recomendación. Un buen modelo cumple dos cosas: quita el gradiente (fondoResidual = rango del fondo
  // corregido / rango del original) y no copia el objeto (|corr| pequeño; negativo = el modelo infla el objeto).
  // Prioridad, como en la guía: entre los que dejan <= 30 % del gradiente, el que menos copia (menor |corr|);
  // si ninguno lo consigue, el que menos gradiente deja con |corr| < 0,3; y si tampoco, el de menor |corr|.
  function pick(list, key) {
    var b = null;
    for (var i = 0; i < list.length; ++i) if (b === null || key(list[i]) < key(b)) b = list[i];
    return b;
  }
  function absCorr(x) { return Math.abs(x.metricas.gcStructCopy); }
  function resid(x) { return x.metricas.fondoResidual; }
  var flat = r.candidatos.filter(function (x) { return resid(x) <= 0.3; });
  var clean = r.candidatos.filter(function (x) { return absCorr(x) < 0.3; });
  var best = flat.length ? pick(flat, absCorr) : clean.length ? pick(clean, resid) : pick(r.candidatos, absCorr);  if (best) {
    var bc = best.metricas.gcStructCopy;
    r.recomendado = best.vista;
    r.motivo = best.metodo + " " + best.parametros + ": deja " + Math.round(100 * best.metricas.fondoResidual) +
               " % del gradiente del original con corr " + bc.toFixed(3) + " (" +
               (Math.abs(bc) < 0.15 ? "modelo limpio" : Math.abs(bc) > 0.5 ? "copia el objeto: revisar o probar plano robusto"
                                                                   : "intermedio: revisar el modelo a la vista") + ").";
  } else {
    r.motivo = "Ningún candidato se pudo medir: ver errores.";
  }
  if (o.dossier) {
    var dir = File.extractDrive(o.dossier) + File.extractDirectory(o.dossier);
    if (!File.directoryExists(dir)) File.createDirectory(dir, true);
    File.writeTextFile(o.dossier, JSON.stringify({
      titulo: "Corrección de gradiente - " + viewId, vista: viewId,
      analisis: o.analisis || "", candidatos: r.candidatos, intermedias: r.intermedias,
      recomendado: r.recomendado, motivo: r.motivo, informe: "", errores: r.errores }, null, 2));
  }
  return r;
}
