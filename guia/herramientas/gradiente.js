// gradiente.js — Comparativa de correcciones de gradiente en una sola llamada. PJSR, ECMAScript 5.
//
// Uso (cargar en el nivel superior del script, nunca dentro de una función):
//   eval(File.readTextFile("<ruta de guia>/herramientas/gradiente.js"));
//   var r = gradienteCandidatos("MasterLight", {
//     graxpert: [10, 8],                                   // escalas sample_free (sustracción)
//     mgc: [2048],                                         // escalas de MGC; [] para no probar MGC
//     spfc: { qe: "...", gray: "..." },                    // opciones de pxSPFC (perfil)
//     mars: "<ruta .xmars del perfil>",                    // opcional en 1.9.6+: sin ella, la base configurada en MGC
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
  try { w.keywords = src.keywords; } catch (e) { }   // FILTER y demás: combinarMasters clasifica por FILTER
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

// Un canal binado (mediana) con las mismas dimensiones que la luminancia de gcPrepare.
function grChanBinned(viewId, c, bin) {
  var v = View.viewById(viewId), id = "gr_tmp_ch";
  var old = View.viewById(id); if (old && !old.isNull) old.window.forceClose();
  var PM = new PixelMath;
  PM.expression = v.image.numberOfChannels >= 3 ? "$T[" + c + "]" : "$T";
  PM.useSingleExpression = true; PM.createNewImage = true; PM.showNewImage = false; PM.newImageId = id;
  PM.newImageWidth = 0; PM.newImageHeight = 0; PM.rescale = false; PM.truncate = false;
  PM.newImageColorSpace = gcK(PixelMath, "Gray"); PM.newImageSampleFormat = gcK(PixelMath, "f32");
  if (!PM.executeOn(v, false)) throw new Error("PixelMath (canal) no se ejecutó");
  var g = View.viewById(id);
  try {
    var IR = new IntegerResample; IR.zoomFactor = -bin; IR.downsamplingMode = gcK(IntegerResample, "Median");
    IR.executeOn(g, false);
    var im = g.image, w = im.width, h = im.height, a = new Float32Array(w * h);
    im.getSamples(a, new Rect(0, 0, w, h), 0);
    return { a: a, w: w, h: h };
  } finally { g.window.forceClose(); }
}

// Coeficientes de un polinomio de grado 1 o 2 ajustado fuera del objeto (rejilla de medianas, rechazo a 2,5σ).
// Coordenadas normalizadas X, Y en [−0,5, 0,5], iguales a resolución completa y binada.
function grPolyCoef(img, excl, grado) {
  var w = img.w, h = img.h, a = img.a, gx = 32, gy = 22, pts = [];
  for (var j = 0; j < gy; j++) for (var i = 0; i < gx; i++) {
    var x0 = Math.floor(i * w / gx), x1 = Math.floor((i + 1) * w / gx), y0 = Math.floor(j * h / gy), y1 = Math.floor((j + 1) * h / gy), v = [];
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { var p = y * w + x; if (!excl[p] && a[p] > 0) v.push(a[p]); }
    if (v.length > 0.5 * (x1 - x0) * (y1 - y0)) pts.push({ x: (x0 + x1) / 2 / w - 0.5, y: (y0 + y1) / 2 / h - 0.5, z: gcMedian(v), ok: true });
  }
  var nt = grado >= 2 ? 6 : 3;
  function terms(x, y) { return grado >= 2 ? [1, x, y, x * x, x * y, y * y] : [1, x, y]; }
  var c = []; for (var q0 = 0; q0 < nt; q0++) c.push(0);
  for (var it = 0; it < 6; it++) {
    var A = [], b = [], k, r, q, n = 0;
    for (r = 0; r < nt; r++) { var row = []; for (q = 0; q < nt; q++) row.push(0); A.push(row); b.push(0); }
    for (k = 0; k < pts.length; k++) {
      if (!pts[k].ok) continue;
      var t = terms(pts[k].x, pts[k].y);
      for (r = 0; r < nt; r++) { b[r] += t[r] * pts[k].z; for (q = 0; q < nt; q++) A[r][q] += t[r] * t[q]; }
      n++;
    }
    if (n < nt + 2) break;
    c = gcSolveN(A, b);
    var res = [];
    for (k = 0; k < pts.length; k++) if (pts[k].ok) { var tt = terms(pts[k].x, pts[k].y), f = 0; for (r = 0; r < nt; r++) f += c[r] * tt[r]; res.push(pts[k].z - f); }
    var sd = gcMAD(res, gcMedian(res)), changed = false;
    for (k = 0; k < pts.length; k++) {
      var t2 = terms(pts[k].x, pts[k].y), f2 = 0; for (r = 0; r < nt; r++) f2 += c[r] * t2[r];
      var keep = sd == 0 || Math.abs(pts[k].z - f2) <= 2.5 * sd;
      if (keep != pts[k].ok) changed = true;
      pts[k].ok = keep;
    }
    if (!changed) break;
  }
  return c;
}

// Expresión de PixelMath del polinomio a resolución completa.
function grPolyExpr(c) {
  var X = "((x()+0.5)/w()-0.5)", Y = "((y()+0.5)/h()-0.5)", s = c[0].toExponential(8) + " + " + c[1].toExponential(8) + "*" + X + " + " + c[2].toExponential(8) + "*" + Y;
  if (c.length >= 6) s += " + " + c[3].toExponential(8) + "*" + X + "*" + X + " + " + c[4].toExponential(8) + "*" + X + "*" + Y + " + " + c[5].toExponential(8) + "*" + Y + "*" + Y;
  return s;
}

// fondoResidual: rango de las medianas del CIELO (rejilla 8×8 fuera del objeto, gcScore.flat) de la corregida frente
// al original. Antes era la rejilla 4×3 de toda la imagen, que en objetos grandes (galaxia grande) medía la galaxia y no el
// gradiente, y hacía ganar a GraXpert aunque se comiera parte de ella (5 nov 2026).
// come_objeto_pct: señal del objeto que se lleva el modelo (gcScore.eat), en % de la señal del objeto.
function grMeasure(base, modelId, correctedId, range0) {
  var m = gcStructCopy(base, modelId), s = gcMetrics(base, correctedId);
  if (base.flat0 === undefined) base.flat0 = gcScore(base, base.O.a, "original").flat;
  return { gcStructCopy: +m.corr.toFixed(3), copia: m.copy, fondoResidual: +(s.flat / base.flat0).toFixed(3),
           come_objeto_pct: +(100 * s.eat).toFixed(1) };
}

function gradienteCandidatos(viewId, o) {
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);   // también vale la View o el resultado de otra función ({ vista: ... })
  o = o || {};
  // Por defecto se comparan los tres métodos (no hay uno preferido: se aplica el que mejor mida en cada imagen).
  var scalesGX = o.graxpert || [10, 8];
  var scalesMGC = o.mgc || [1024, 2048];
  // polinomio: lista de grados ([1, 2] por defecto); true = [1, 2], false = ninguno, un número = ese grado
  // (6 nov 2026: con polinomio: true no se generaba ninguno).
  var gradosPoly = o.polinomio === false ? [] : (o.polinomio === undefined || o.polinomio === true) ? [1, 2] :
                   (typeof o.polinomio === "number" ? [o.polinomio] : o.polinomio);
  var bin = o.bin || 8;
  var r = { vista: viewId, candidatos: [], intermedias: [], recomendado: "", motivo: "", errores: [] };

  var win = ImageWindow.windowById(viewId);
  if (win.isNull) throw new Error("No existe la vista " + viewId);
  var hasWCS = win.hasAstrometricSolution;

  // Cuñas sin datos (masters sin alinear/recortar): el modelo de fondo intenta ajustar el relleno y falsea todo.
  if (typeof bordesSinDatos !== "function") eval(File.readTextFile(GR_DIR + "/analisis.js"));
  var bd = bordesSinDatos(win.mainView);
  if (bd.hay && !o.ignorarBordes)
    throw new Error("La imagen tiene bordes sin datos (arriba " + bd.arriba + ", abajo " + bd.abajo + ", izquierda " + bd.izquierda +
                    ", derecha " + bd.derecha + " px): alinear y recortar primero (Paso 5, alinearMasters; con un solo master, " +
                    "recortar esos bordes con Crop). La corrección de gradiente va después.");

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
      try { ImageWindow.windowById(corr).keywords = win.keywords; } catch (e) { }
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
      var id = grDuplicate(viewId, "GC_MGC" + g + (borde ? "_borde" : ""));
      var v = View.viewById(id);
      if (!pxSPFC(o.spfc || {}).executeOn(v)) throw new Error("SPFC devolvió false");
      var mo = { mars: o.mars, gradientScale: g, showGradientModel: true };
      if (o.mgcOpts) for (var key in o.mgcOpts) mo[key] = o.mgcOpts[key];
      if (borde) mo.edgeCorrection = true;
      before = grIds();
      var PM = pxMGC(mo);
      if (!PM.executeOn(v)) throw new Error("MGC devolvió false");
      var ajusteMARS = [];   // por canal: [canal, factor de escala, correlación con MARS] (1.9.6+)
      try { for (var cd = 0; cd < PM.channelData.length; ++cd) { var rw = PM.channelData[cd];
        ajusteMARS.push([rw[0], +(+rw[5]).toFixed(3), +(+rw[6]).toFixed(3)]); } } catch (eCD) { }
      var nm = grNew(before), mmod = null;
      for (var q = 0; q < nm.length; ++q) if (nm[q].indexOf("gradient_model") >= 0 || nm[q].indexOf("model") >= 0) mmod = nm[q];
      if (!mmod) throw new Error("MGC no creó el modelo de gradiente");
      mmod = grRename(mmod, id + "_modelo");
      r.candidatos.push({ vista: id, modelo: mmod, metodo: "MGC", parametros: "SPFC + MGC gradientScale " + g + (borde ? ", corrección de bordes" : ""),
                          metricas: grMeasure(base, mmod, id, range0), ajuste_mars: ajusteMARS,
                          notas: "No neutraliza el color del fondo (GraXpert sí)." });
    } catch (e) {
      r.errores.push("MGC escala " + g + (borde ? " con bordes" : "") + ": " + e);
    }
  }

  // Polinomio robusto (grado 1 = plano, grado 2) por canal, ajustado fuera del objeto: no puede comerse formas.
  // En galaxia grande (oct 2026) el grado 2 ganó a GraXpert, que se comía el 8,5 % de la galaxia.
  var nch = win.mainView.image.numberOfChannels;
  for (var gp = 0; gp < gradosPoly.length; ++gp) {
    var grado = gradosPoly[gp];
    try {
      var exprs = [];
      for (var ch = 0; ch < Math.min(3, nch); ++ch) exprs.push(grPolyExpr(grPolyCoef(grChanBinned(viewId, ch, bin), base.excl, grado)));
      var pid = grDuplicate(viewId, "GC_POLY" + grado), mid = grFreeId(pid + "_modelo");
      // Modelo (para medirlo y verlo) y corrección: $T − modelo + valor del modelo en el centro (mantiene el nivel).
      var PMm = new PixelMath;
      PMm.useSingleExpression = (nch < 3); PMm.expression = exprs[0];
      if (nch >= 3) { PMm.expression1 = exprs[1]; PMm.expression2 = exprs[2]; }
      PMm.createNewImage = true; PMm.showNewImage = true; PMm.newImageId = mid; PMm.newImageWidth = 0; PMm.newImageHeight = 0;
      PMm.rescale = false; PMm.truncate = false; PMm.newImageSampleFormat = gcK(PixelMath, "f32");
      PMm.newImageColorSpace = nch >= 3 ? gcK(PixelMath, "RGB") : gcK(PixelMath, "Gray");
      if (!PMm.executeOn(win.mainView)) throw new Error("PixelMath del modelo falló");
      var PMc = new PixelMath, cen = function (e) { return "(" + e.split(" + ")[0] + ")"; };
      PMc.useSingleExpression = (nch < 3); PMc.expression = "$T - (" + exprs[0] + ") + " + cen(exprs[0]);
      if (nch >= 3) { PMc.expression1 = "$T - (" + exprs[1] + ") + " + cen(exprs[1]); PMc.expression2 = "$T - (" + exprs[2] + ") + " + cen(exprs[2]); }
      PMc.rescale = false; PMc.truncate = false; PMc.createNewImage = false;
      if (!PMc.executeOn(View.viewById(pid))) throw new Error("PixelMath de la corrección falló");
      r.candidatos.push({ vista: pid, modelo: mid, metodo: "Polinomio", parametros: "grado " + grado + " ajustado fuera del objeto, por canal",
                          metricas: grMeasure(base, mid, pid, range0), notas: "No puede crear ni borrar formas; deja el gradiente que no sea liso." });
    } catch (e) {
      r.errores.push("Polinomio grado " + grado + ": " + e);
    }
  }

  r.leyenda = "gcStructCopy: cuánto se parece el modelo de fondo al objeto (cerca de 0 = modelo limpio; > 0,5 = se come el objeto; " +
              "negativo = infla el objeto). come_objeto_pct: % de la señal del objeto que se lleva el modelo (menor = mejor). " +
              "fondoResidual: fracción del gradiente del cielo que queda, medido fuera del objeto (menor = más plano). " +
              "Mejor: el que deja poco gradiente sin comerse el objeto.";

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
  function eat(x) { var e = x.metricas.come_objeto_pct; return isFinite(e) ? Math.abs(e) : 100; }
  // Primero, no comerse el objeto (≤ 3 % de su señal y modelo limpio); entre esos, el que deja el cielo más plano.
  var safe = r.candidatos.filter(function (x) { return eat(x) <= 3 && absCorr(x) < 0.3; });
  var clean = r.candidatos.filter(function (x) { return absCorr(x) < 0.3; });
  var best = safe.length ? pick(safe, resid) : clean.length ? pick(clean, eat) : pick(r.candidatos, absCorr);
  if (best) {
    var bc = best.metricas.gcStructCopy;
    r.recomendado = best.vista;
    r.motivo = best.metodo + " " + best.parametros + ": deja " + Math.round(100 * best.metricas.fondoResidual) +
               " % del gradiente del cielo, se lleva el " + best.metricas.come_objeto_pct + " % del objeto, corr " + bc.toFixed(3) + " (" +
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
