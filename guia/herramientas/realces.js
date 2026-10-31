// realces.js — Algoritmos de cuatro scripts de PixInsight, ejecutables desde el watcher.
// PJSR, ECMAScript 5: funciona con el watcher clásico y con el v8.
//
// Un script no se puede lanzar desde el watcher ("Script instance recursively"). Aquí se reimplementan sus
// algoritmos con los mismos procesos y parámetros, sin copiar su código ni su interfaz. Créditos de los
// algoritmos originales:
//   starStretch          Star Stretch v2.6, Franklin Marek (SetiAstro, www.setiastro.com)
//   screenStarsCombine   ScreenStars 2.x, Mike Cranfield (CosmicPhotons)
//   screenStarsExtract
//   darkStructureEnhance DarkStructureEnhance 1.1, Carlos Sonnenstein y Oriol Lehmkuhl (PTeam)
//   backgroundEnhance    BackgroundEnhance, Juan M. Gómez (2010)
//
// Validación: con los mismos parámetros, el resultado es idéntico píxel a píxel (diferencia máxima 0) al
// de cada script original, en imágenes RGB lineales y no lineales (PixInsight 1.9.6).
//
// Uso: el watcher v8 lo incluye al arrancar, así que las funciones están disponibles en run_script.
// Con el watcher clásico:
//   eval(File.readTextFile("<carpeta del repo>/guia/herramientas/realces.js"));
//   starStretch("Stars", { amount: 2 });                       // capa de estrellas LINEAL
//   screenStarsCombine("Starless", "Stars", { newId: "Final" }); // recombinar estrellas (screen)
//   screenStarsExtract("Starry", "Starless");                  // separar estrellas (unscreen)
//   darkStructureEnhance("Starless", { median: 0.7 });         // imagen NO lineal
//   backgroundEnhance("Starless", { amount: 0.5 });            // imagen NO lineal
//
// Todas actúan sobre la vista indicada (con estado de historia), salvo screenStars*, que crean una
// imagen nueva. Devuelven un objeto con lo que han hecho.

function rzK(C, name) {
  if (C[name] !== undefined) return C[name];
  if (C.prototype && C.prototype[name] !== undefined) return C.prototype[name];
  throw new Error("Constante no encontrada: " + name);
}

function rzView(id) {
  var v = View.viewById(id);
  if (!v || v.isNull) throw new Error("No existe la vista " + id);
  return v;
}

function rzOpt(o, k, def) { return (o && o[k] !== undefined) ? o[k] : def; }

function rzUniqueId(base) {
  var id = base, n = 1;
  while (!ImageWindow.windowById(id).isNull) id = base + (++n);
  return id;
}

// Ventana auxiliar (oculta) con una copia de la imagen de la vista.
function rzCopy(view, id) {
  var img = view.image, src = view.window;
  var w = new ImageWindow(img.width, img.height, img.numberOfChannels, src.bitsPerSample, src.isFloatSample,
                          img.isColor, rzUniqueId(id));
  w.mainView.beginProcess(typeof UndoFlag_NoSwapFile !== "undefined" ? UndoFlag_NoSwapFile : UndoFlag.NoSwapFile);
  w.mainView.image.assign(img);
  w.mainView.endProcess();
  return w;
}

function rzMust(ok, what) { if (!ok) throw new Error(what + " no se ejecutó"); }

function rzIsGray(view) { return !view.image.isColor; }

// ---------------------------------------------------------------------------------------------------
// Star Stretch: y = 3^A·x / ((3^A − 1)·x + 1), después saturación por tono (curva 0,4·s / 0,7·s / 0,4·s)
// y, opcionalmente, SCNR del verde. Para la capa de estrellas lineal, nunca para la starless.
// Opciones: amount (5 en el script; para muchas estrellas, 1–3), saturation (1), removeGreen (false).
function starStretch(viewId, o) {
  var v = rzView(viewId);
  var A = rzOpt(o, "amount", 5), s = rzOpt(o, "saturation", 1), green = rzOpt(o, "removeGreen", false);
  var PM = new PixelMath;
  PM.expression = "((3^" + A + ")*$T)/((3^" + A + " - 1)*$T + 1)";
  PM.useSingleExpression = true;
  rzMust(PM.executeOn(v), "Star Stretch (PixelMath)");
  if (!rzIsGray(v)) {
    var CS = new ColorSaturation;
    CS.HS = [[0.0, 0.40 * s], [0.5, 0.70 * s], [1.0, 0.40 * s]];
    CS.HSt = rzK(ColorSaturation, "AkimaSubsplines");
    CS.hueShift = 0;
    rzMust(CS.executeOn(v), "Star Stretch (ColorSaturation)");
    if (green) {
      var S = new SCNR;
      S.amount = 1.0;
      S.protectionMethod = rzK(SCNR, "AverageNeutral");
      S.colorToRemove = rzK(SCNR, "Green");
      S.preserveLightness = true;
      rzMust(S.executeOn(v), "Star Stretch (SCNR)");
    }
  }
  return { view: viewId, amount: A, saturation: s, removeGreen: green };
}

// ---------------------------------------------------------------------------------------------------
// ScreenStars. Si la starless está estirada (mediana > 0,005) y reverseStretch = true, las dos capas se
// llevan a un estado casi lineal con una MTF (mediana → 0,005), se combinan ahí y se vuelve a estirar con
// la MTF inversa: la combinación se hace "en lineal" aunque las capas estén estiradas.
var RZ_LINEAR = 0.005;

function rzScreenExpr(e1, e2, combine, reverse, med) {
  if (reverse && med > RZ_LINEAR) {
    var s = Math.mtf(RZ_LINEAR, med).toPrecision(5);
    return "E1 = mtf(" + s + ", " + e1 + ");\nE2 = mtf(" + s + ", " + e2 + ");\nmtf(~" + s + ", " + combine + ")";
  }
  return "E1 = " + e1 + ";\nE2 = " + e2 + ";\n" + combine;
}

function rzMedian(view) { view.image.resetSelections(); return view.image.median(); }

// Recombinar: screen 1 − (1−A)(1−B) (method "screen", por defecto) o suma (method "add").
// Opciones: method, reverseStretch (true), newId ("starry").
function screenStarsCombine(starlessId, starsId, o) {
  var sl = rzView(starlessId), st = rzView(starsId);
  var add = rzOpt(o, "method", "screen") === "add", rev = rzOpt(o, "reverseStretch", true);
  var med = rzMedian(sl);
  var PM = new PixelMath;
  PM.symbols = "E1, E2";
  PM.expression = rzScreenExpr(sl.id, st.id, add ? "(E1 + E2)" : "(E1 + E2 - E1*E2)", rev, med);
  PM.useSingleExpression = true;
  PM.createNewImage = true;
  PM.newImageId = rzUniqueId(rzOpt(o, "newId", "starry"));
  rzMust(PM.executeOn(sl), "ScreenStars (combinar)");
  return { created: PM.newImageId, reverseStretch: rev && med > RZ_LINEAR, starlessMedian: med };
}

// Separar: unscreen (A − B)/(1 − B) (method "screen", por defecto) o resta (method "add").
// Opciones: method, reverseStretch (true), newId ("stars").
function screenStarsExtract(starryId, starlessId, o) {
  var sy = rzView(starryId), sl = rzView(starlessId);
  var add = rzOpt(o, "method", "screen") === "add", rev = rzOpt(o, "reverseStretch", true);
  var med = rzMedian(sl);
  var PM = new PixelMath;
  PM.symbols = "E1, E2";
  PM.expression = rzScreenExpr(sy.id, sl.id, add ? "(E1 - E2)" : "rescale(E1, E2, 1)", rev, med);
  PM.useSingleExpression = true;
  PM.createNewImage = true;
  PM.newImageId = rzUniqueId(rzOpt(o, "newId", "stars"));
  rzMust(PM.executeOn(sy), "ScreenStars (separar)");
  return { created: PM.newImageId, reverseStretch: rev && med > RZ_LINEAR, starlessMedian: med };
}

// ---------------------------------------------------------------------------------------------------
// DarkStructureEnhance. Máscara de estructuras oscuras = (gran escala de la imagen sin estrellas) − imagen,
// en gris, reescalada y suavizada; a través de ella, HistogramTransformation con medios = median
// (0,7 oscurece), repetido iterations veces. Imagen NO lineal.
// Opciones: layers (8), scalingFunction ("B3" 5×5 o "linear" 3×3; "B3" por defecto), median (0,7),
// iterations (1), keepMask (false: true deja la máscara abierta).
var RZ_SCALING = {
  linear: { name: "3x3 Linear Interpolation", size: 3,
            data: [0.29289322, 0.5, 0.29289322, 0.5, 1.0, 0.5, 0.29289322, 0.5, 0.29289322] },
  B3: { name: "5x5 B3 Spline", size: 5,
        data: [1/256, 1/64, 3/128, 1/64, 1/256, 1/64, 1/16, 3/32, 1/16, 1/64, 3/128, 3/32, 9/64, 3/32, 3/128,
               1/64, 1/16, 3/32, 1/16, 1/64, 1/256, 1/64, 3/128, 1/64, 1/256] }
};

// ATrousWaveletTransformV1 con las capas indicadas (true = capa conservada; la última es el residuo).
// dering: deringing en las capas conservadas (amount 1,0), como en la separación de estrellas del original.
function rzATWTv1(view, keep, sf, dering) {
  var L = [];
  for (var i = 0; i < keep.length; ++i)
    L.push(dering && keep[i] ? [true, true, 1.00, 3.00, 0.000, false, 0, 0.50, 2, 5, false, true, 1.00, 0.02]
                             : [keep[i], true, 1.00, 3.00, 0.000, false, 0, 0.50, 2, 5, false, false, 0.50, 0.02]);
  var W = new ATrousWaveletTransformV1;
  W.version = 257;
  W.layers = L;
  W.scaleDelta = 0;
  W.scalingFunctionData = sf.data;
  W.scalingFunctionKernelSize = sf.size;
  W.scalingFunctionName = sf.name;
  W.largeScaleFunction = rzK(ATrousWaveletTransformV1, "NoFunction");
  W.curveBreakPoint = 0.75;
  W.noiseThresholdingAmount = 0;
  W.noiseThreshold = 3;
  W.lowRange = 0; W.highRange = 0;
  W.previewMode = rzK(ATrousWaveletTransformV1, "Disabled");
  W.previewLayer = 0;
  W.toLuminance = true; W.toChrominance = true; W.linear = false;
  rzMust(W.executeOn(view, false), "ATrousWaveletTransformV1");
}

function darkStructureEnhance(viewId, o) {
  var v = rzView(viewId);
  var nL = rzOpt(o, "layers", 8), sf = RZ_SCALING[rzOpt(o, "scalingFunction", "B3")];
  var median = rzOpt(o, "median", 0.7), iters = rzOpt(o, "iterations", 1), keepMask = rzOpt(o, "keepMask", false);
  if (!sf) throw new Error("scalingFunction debe ser \"B3\" o \"linear\"");
  var nStar = 6, i, keep;

  // 1. Pequeñas escalas (estrellas): capas 1–6 sin residuo.
  var aux = rzCopy(v, "DSE_aux");
  keep = []; for (i = 0; i < nStar; ++i) keep.push(true); keep.push(false);
  rzATWTv1(aux.mainView, keep, sf, true);

  // 2. Imagen sin estrellas, con pesos de luminancia iguales.
  var mask = rzCopy(v, "DSE_mask"), mv = mask.mainView;
  var RGB = new RGBWorkingSpace;
  RGB.channels = [[0.333333, 0.648431, 0.330856], [0.333333, 0.321152, 0.597871], [0.333333, 0.155886, 0.066044]];
  RGB.gamma = 2.2; RGB.sRGBGamma = true; RGB.applyGlobalRGBWS = false;
  rzMust(RGB.executeOn(mv, false), "RGBWorkingSpace");
  var PM = new PixelMath;
  PM.expression = "$T - " + aux.mainView.id; PM.useSingleExpression = true;
  PM.truncate = true; PM.truncateLower = 0; PM.truncateUpper = 1; PM.createNewImage = false;
  rzMust(PM.executeOn(mv, false), "PixelMath (quitar estrellas)");
  aux.forceClose();

  // 3. Gran escala: sólo el residuo tras nL capas.
  keep = []; for (i = 0; i < nL; ++i) keep.push(false); keep.push(true);
  rzATWTv1(mv, keep, sf);

  // 4. Estructuras oscuras = gran escala − imagen; gris; reescalar.
  var PM2 = new PixelMath;
  PM2.expression = mv.id + " - " + v.id; PM2.useSingleExpression = true;
  PM2.truncate = true; PM2.truncateLower = 0; PM2.truncateUpper = 1; PM2.createNewImage = false;
  rzMust(PM2.executeOn(mv, false), "PixelMath (estructuras oscuras)");
  if (mv.image.isColor) rzMust((new ConvertToGrayscale).executeOn(mv, false), "ConvertToGrayscale");
  var R = new Rescale; R.mode = rzK(Rescale, "RGBK");
  rzMust(R.executeOn(mv, false), "Rescale");

  // 5. Reducción de ruido de la máscara (capa 2, recursiva, 5 iteraciones).
  var NR = new ATrousWaveletTransformV1;
  NR.version = 257;
  NR.layers = [[false, true, 1.00, 3.00, 0.000, false, rzK(ATrousWaveletTransformV1, "Recursive"), 1.00, 5, 5, false, false, 0.50, 0.02],
               [true, true, 1.00, 3.00, 0.000, true, rzK(ATrousWaveletTransformV1, "Recursive"), 1.00, 5, 5, false, false, 0.50, 0.02],
               [true, true, 1.00, 3.00, 0.000, false, rzK(ATrousWaveletTransformV1, "Recursive"), 0.50, 2, 5, false, false, 0.50, 0.02]];
  NR.scaleDelta = 0;
  NR.scalingFunctionData = [0.292893, 0.5, 0.292893, 0.5, 1, 0.5, 0.292893, 0.5, 0.292893];
  NR.scalingFunctionKernelSize = 3;
  NR.scalingFunctionName = RZ_SCALING.linear.name;
  NR.largeScaleFunction = rzK(ATrousWaveletTransformV1, "NoFunction");
  NR.toLuminance = true; NR.toChrominance = false; NR.linear = false;
  rzMust(NR.executeOn(mv, false), "ATrousWaveletTransformV1 (ruido de la máscara)");

  // 6. Oscurecer a través de la máscara.
  var HT = new HistogramTransformation;
  HT.H = [[0, 0.5, 1, 0, 1], [0, 0.5, 1, 0, 1], [0, 0.5, 1, 0, 1], [0, median, 1, 0, 1], [0, 0.5, 1, 0, 1]];
  var tw = v.window;
  for (i = 0; i < iters; ++i) {
    tw.mask = mask; tw.maskInverted = false; tw.maskEnabled = true;
    try { rzMust(HT.executeOn(v), "HistogramTransformation"); } finally { tw.removeMask(); }
  }
  var maskId = mv.id;
  if (keepMask) mask.show(); else { mask.forceClose(); maskId = null; }
  return { view: viewId, layers: nL, scalingFunction: sf.name, median: median, iterations: iters, mask: maskId };
}

// ---------------------------------------------------------------------------------------------------
// BackgroundEnhance. Gran escala de la imagen sin estructuras pequeñas, sumada con peso amount a través de
// una máscara invertida de luminancia suavizada (protege lo brillante). Imagen NO lineal.
// Opciones: layers (8), amount (0,5), ssAmount (0,9: cuánto se atenúan las estructuras pequeñas),
// maskAmount (0,6), keepMask (false).
function rzATWT(view, keep) {
  var L = [];
  for (var i = 0; i < keep.length; ++i) L.push([keep[i], true, 0.000, false, 3.000, 0.50, 1]);
  var W = new ATrousWaveletTransform;
  W.layers = L;
  W.scaleDelta = 0;
  W.scalingFunctionData = [0.2928932, 0.5, 0.2928932, 0.5, 1, 0.5, 0.2928932, 0.5, 0.2928932];
  W.scalingFunctionKernelSize = 3;
  W.scalingFunctionNoiseSigma = [0.8095, 0.2688, 0.1176, 0.0568, 0.0283, 0.0141, 0.0071, 0.0036, 0.0018, 0.0009];
  W.scalingFunctionNoiseLayers = 10;
  W.scalingFunctionName = "3x3 Linear Interpolation";
  W.largeScaleFunction = rzK(ATrousWaveletTransform, "NoFunction");
  W.curveBreakPoint = 0.75;
  W.noiseThresholding = false;
  W.deringing = false;
  W.lowRange = 0; W.highRange = 0;
  W.previewMode = rzK(ATrousWaveletTransform, "Disabled");
  W.toLuminance = true; W.toChrominance = true; W.linear = false;
  rzMust(W.executeOn(view), "ATrousWaveletTransform");
}

function rzCurveK(view, points) {
  var C = new CurvesTransformation;
  C.K = points;
  C.Kt = rzK(CurvesTransformation, "AkimaSubsplines");
  rzMust(C.executeOn(view), "CurvesTransformation");
}

function backgroundEnhance(viewId, o) {
  var v = rzView(viewId);
  var nL = rzOpt(o, "layers", 8), amount = rzOpt(o, "amount", 0.5);
  var ssAmount = rzOpt(o, "ssAmount", 0.9), maskAmount = rzOpt(o, "maskAmount", 0.6), keepMask = rzOpt(o, "keepMask", false);
  var i, keep;

  // 1. Estructuras pequeñas (capas 1–nL, sin residuo), realzadas con la curva K.
  var ss = rzCopy(v, "BE_SS");
  keep = []; for (i = 0; i < 8; ++i) keep.push(i < nL); keep.push(false);
  rzATWT(ss.mainView, keep);
  rzCurveK(ss.mainView, [[0, 0], [1 - ssAmount, ssAmount], [1, 1]]);

  // 2. Imagen con las estructuras pequeñas atenuadas, y de ella sólo la gran escala (residuo tras 6 capas).
  var ls = rzCopy(v, "BE_LS");
  var PM = new PixelMath;
  PM.expression = ls.mainView.id + "*~" + ss.mainView.id; PM.useSingleExpression = true;
  PM.truncate = true; PM.truncateLower = 0; PM.truncateUpper = 1; PM.createNewImage = false;
  rzMust(PM.executeOn(ls.mainView), "PixelMath (atenuar estructuras pequeñas)");
  ss.forceClose();
  rzATWT(ls.mainView, [false, false, false, false, false, false, true]);

  // 3. Máscara: luminancia, curva y gran escala.
  var mk = rzCopy(v, "BE_Mask");
  if (mk.mainView.image.isColor) rzMust((new ConvertToGrayscale).executeOn(mk.mainView), "ConvertToGrayscale");
  rzCurveK(mk.mainView, [[0, 0], [0.25, 0], [(1 - maskAmount) + 0.25, maskAmount], [1, 1]]);
  rzATWT(mk.mainView, [false, false, false, false, false, false, true]);

  // 4. Imagen + amount·gran escala, a través de la máscara invertida.
  var PM2 = new PixelMath;
  PM2.expression = "$T + " + ls.mainView.id + "*" + amount; PM2.useSingleExpression = true;
  PM2.truncate = true; PM2.truncateLower = 0; PM2.truncateUpper = 1; PM2.createNewImage = false;
  var tw = v.window;
  tw.mask = mk; tw.maskInverted = true; tw.maskEnabled = true;
  try { rzMust(PM2.executeOn(v), "PixelMath (realce de fondo)"); } finally { tw.removeMask(); }
  ls.forceClose();
  var maskId = mk.mainView.id;
  if (keepMask) mk.show(); else { mk.forceClose(); maskId = null; }
  return { view: viewId, layers: nL, amount: amount, ssAmount: ssAmount, maskAmount: maskAmount, mask: maskId };
}
