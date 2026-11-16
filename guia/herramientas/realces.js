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
// Uso: el runner del MCP piastropilot y los scripts de PiAstroPilot lo incluyen con #include.
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

// nuevaVista: copia de la vista con ese id y se trabaja sobre ella (sin nuevaVista, sobre la propia vista, como antes).
// Qwen pasó nuevaVista a darkStructureEnhance y pidió el paso siguiente sobre una vista que no existía (7 nov 2026).
function rzTarget(viewId, o) {
  var v = rzView(viewId);
  if (!o || !o.nuevaVista) return v;
  var w = rzCopy(v, typeof o.nuevaVista === "string" ? o.nuevaVista : v.id + "_rz");
  w.keywords = v.window.keywords;
  if (v.window.hasAstrometricSolution) w.copyAstrometricSolution(v.window);
  w.show();
  return w.mainView;
}

// Opciones que la función no conoce: se devuelven para que el modelo vea que no hicieron nada.
function rzIgnoradas(o, known) {
  var r = [];
  if (o) for (var k in o) if (known.indexOf(k) < 0) r.push(k);
  return r.length ? r : undefined;
}

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
  var v = rzTarget(viewId, o); viewId = v.id;
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
  var ign = rzIgnoradas(o, ["layers", "scalingFunction", "median", "iterations", "keepMask", "nuevaVista"]);
  return { view: viewId, layers: nL, scalingFunction: sf.name, median: median, iterations: iters, mask: maskId,
           opciones_ignoradas: ign, aviso: ign ? "estas opciones no existen y no han hecho nada: " + ign.join(", ") +
           " (las de darkStructureEnhance son layers, scalingFunction, median, iterations, keepMask, nuevaVista)" : undefined };
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
  var v = rzTarget(viewId, o); viewId = v.id;
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
  var ign = rzIgnoradas(o, ["layers", "amount", "ssAmount", "maskAmount", "keepMask", "nuevaVista"]);
  return { view: viewId, layers: nL, amount: amount, ssAmount: ssAmount, maskAmount: maskAmount, mask: maskId,
           opciones_ignoradas: ign, aviso: ign ? "estas opciones no existen y no han hecho nada: " + ign.join(", ") +
           " (las de backgroundEnhance son layers, amount, ssAmount, maskAmount, keepMask, nuevaVista)" : undefined };
}

// ---------------------------------------------------------------------------------------------------
// Contraste local: comparación de métodos sobre copias (Rafael, 8 nov 2026: comparar siempre). Imagen NO lineal
// (starless estirada). Candidatos por defecto:
//   - LocalHistogramEqualization radio 64 (slopeLimit 1,5, amount 0,35) y radio 128 (slopeLimit 2, amount 0,35).
//   - HDRMultiscaleTransform 6 capas sobre la luminosidad, con máscara de luminancia, mezclado al 50 % con la entrada.
//   - darkStructureEnhance (median 0,7).
// Medidas iguales para todos (rzMedidasContraste): contraste local = mediana del rango p10–p90 en celdas de 64 px con
// señal (la mitad más brillante), ruido del cielo (celdas más oscuras), nivel del cielo y píxeles quemados.
// Gana el que más sube el contraste local sin subir el ruido del cielo más de un 25 % (ruidoMax), sin mover el cielo
// más de 0,03 ni quemar más de un 0,05 % de píxeles. Si ninguno cumple, se recomienda dejar la imagen como está.
//   var r = contrasteCandidatos("Starless_st", { nuevaVista: "Starless_lc" });
function rzMedidasContraste(view) {
  var im = view.image, W = im.width, H = im.height, nc = im.numberOfChannels, R = new Rect(0, 0, W, H), n = W * H;
  var L = new Float32Array(n), buf = new Float32Array(n), alto = 0, total = 0;
  for (var c = 0; c < nc; ++c) {
    im.getSamples(buf, R, c);
    for (var i = 0; i < n; ++i) { L[i] += buf[i] / nc; if ((i & 3) === 0) { ++total; if (buf[i] >= 0.98) ++alto; } }
  }
  var S = 64, cells = [];
  for (var y0 = 0; y0 + S <= H; y0 += S)
    for (var x0 = 0; x0 + S <= W; x0 += S) {
      var v = [];
      for (var y = y0; y < y0 + S; y += 2) for (var x = x0; x < x0 + S; x += 2) v.push(L[y * W + x]);
      v.sort(function (a, b) { return a - b; });
      cells.push({ x: x0, y: y0, m: v[v.length >> 1], rango: v[Math.floor(0.9 * (v.length - 1))] - v[Math.floor(0.1 * (v.length - 1))] });
    }
  cells = cells.filter(function (c0) { return c0.m > 1e-6; });
  cells.sort(function (a, b) { return a.m - b.m; });
  var k = Math.max(5, Math.floor(cells.length * 0.10)), dif = [], sk = [];
  for (var j = 0; j < k; ++j) {
    var cc = cells[j];
    sk.push(cc.m);
    for (var yy = cc.y; yy < cc.y + S; yy += 2) for (var xx = cc.x; xx < cc.x + S - 1; xx += 2) dif.push(Math.abs(L[yy * W + xx + 1] - L[yy * W + xx]));
  }
  sk.sort(function (a, b) { return a - b; }); dif.sort(function (a, b) { return a - b; });
  var brillantes = cells.slice(cells.length >> 1).map(function (c1) { return c1.rango; }).sort(function (a, b) { return a - b; });
  return { contraste_local: +brillantes[brillantes.length >> 1].toFixed(5), cielo: +sk[sk.length >> 1].toFixed(4),
           ruido_cielo: +(dif[dif.length >> 1] / (0.6745 * Math.SQRT2)).toFixed(6), quemados_pct: +(100 * alto / total).toFixed(4) };
}

function contrasteCandidatos(viewId, o) {
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);
  o = o || {};
  var src = rzView(viewId), t0 = Date.now();
  if (rzMedian(src) < 0.05) throw new Error("La imagen parece lineal (mediana " + rzMedian(src).toFixed(4) + "): el contraste local va después del estirado");
  // Imagen grande (> 8 MP): comparar en un recorte con cielo y señal (rdElegirRecorte, ruido.js) y aplicar sólo el ganador
  // a la imagen entera, con sus mismos parámetros (los radios de LHE son en píxeles: valen igual en el recorte).
  var nLhe = (o.lhe || [1, 2]).length + (o.hdrmt !== false ? 1 : 0) + (o.dse !== false ? 1 : 0);
  if (o.recorte !== false && nLhe > 1 && src.image.width * src.image.height > (o.recorteMP || 8) * 1e6 && typeof rdElegirRecorte === "function") {
    var rc = rdElegirRecorte(src, o.ladoRecorte || 2000);
    var wr = new ImageWindow(rc.width, rc.height, src.image.numberOfChannels, 32, true, src.image.isColor, viewId + "_rec");
    wr.mainView.beginProcess(); wr.mainView.image.assign(src.image, rc); wr.mainView.endProcess();
    var oR = {}; for (var kr in o) oR[kr] = o[kr];
    oR.recorte = false; oR.cerrar = true; oR.nuevaVista = wr.mainView.id + "_lc";
    var enRec;
    try { enRec = contrasteCandidatos(wr.mainView.id, oR); }
    finally { var wl = ImageWindow.windowById(oR.nuevaVista); if (!wl.isNull) wl.forceClose(); wr.forceClose(); }
    var gana = enRec.comparados.filter(function (c) { return c.elegido; })[0];
    if (!gana || !gana.sel) { enRec.vista = null; enRec.original = viewId; enRec.comparado_en = { recorte: [rc.x0, rc.y0, rc.x1, rc.y1] }; return enRec; }
    var oF = {}; for (var kf in o) oF[kf] = o[kf];
    oF.recorte = false; oF.lhe = gana.sel.lhe || []; oF.hdrmt = gana.sel.hdrmt === undefined ? false : gana.sel.hdrmt;
    oF.dse = gana.sel.dse === undefined ? false : gana.sel.dse;
    var tF = Date.now(), fin = contrasteCandidatos(viewId, oF);
    fin.comparados = enRec.comparados;
    fin.comparado_en = { recorte: [rc.x0, rc.y0, rc.x1, rc.y1], nota: "métodos comparados en un recorte de " + rc.width + "×" + rc.height +
                         " px; el ganador (" + gana.metodo + ") se aplicó a la imagen entera en " + Math.round((Date.now() - tF) / 1000) + " s" };
    fin.motivo = "En el recorte: " + enRec.motivo + " En la imagen entera: " + fin.motivo;
    fin.segundos = Math.round((Date.now() - t0) / 1000);
    return fin;
  }
  var base = rzMedidasContraste(src), ruidoMax = o.ruidoMax || 1.25, cands = [];
  function copia(suf) { var w = rzCopy(src, viewId + suf); w.keywords = src.window.keywords; w.show(); return w; }
  function medir(etiqueta, w, t1, sel) {
    var m = rzMedidasContraste(w.mainView), f = [];
    var gc = m.contraste_local / Math.max(base.contraste_local, 1e-9), gr = m.ruido_cielo / Math.max(base.ruido_cielo, 1e-9);
    if (gr > ruidoMax) f.push("sube el ruido del cielo ×" + gr.toFixed(2) + " (máx. ×" + ruidoMax + ")");
    if (Math.abs(m.cielo - base.cielo) > 0.03) f.push("mueve el cielo de " + base.cielo + " a " + m.cielo);
    if (m.quemados_pct - base.quemados_pct > 0.05) f.push("quema " + (m.quemados_pct - base.quemados_pct).toFixed(3) + " % más de píxeles");
    cands.push({ etiqueta: etiqueta, sel: sel, vista: w.mainView.id, medidas: m, contraste_x: +gc.toFixed(3), ruido_x: +gr.toFixed(3), fallos: f,
                 segundos: Math.round((Date.now() - t1) / 1000),
                 previa: typeof pxPrevia === "function" ? pxPrevia(w.mainView.id, "lc_" + w.mainView.id, { estirar: false }) : null });
  }
  (o.lhe || [{ radius: 64, slopeLimit: 1.5, amount: 0.35 }, { radius: 128, slopeLimit: 2.0, amount: 0.35 }]).forEach(function (p, i) {
    var t1 = Date.now();
    try {
      var w = copia("_lhe" + p.radius);
      var P = new LocalHistogramEqualization;
      P.radius = p.radius; P.slopeLimit = p.slopeLimit; P.amount = p.amount; P.circularKernel = true;
      rzMust(P.executeOn(w.mainView), "LocalHistogramEqualization");
      medir("LHE radio " + p.radius + ", pendiente " + p.slopeLimit + ", amount " + p.amount, w, t1, { lhe: [p] });
    } catch (e) { cands.push({ etiqueta: "LHE radio " + p.radius, error: String(e && e.message ? e.message : e) }); }
  });
  if (o.hdrmt !== false) {
    var t2 = Date.now();
    try {
      var hm = o.hdrmt || {}, capas = hm.capas || 6, mezcla = (hm.mezcla !== undefined) ? hm.mezcla : 0.5;
      var wh = copia("_hdrmt");
      var aux = rzCopy(src, "rzTmpHDRMT");
      var Hd = new HDRMultiscaleTransform;
      Hd.numberOfLayers = capas; Hd.numberOfIterations = 1; Hd.toLightness = true; Hd.luminanceMask = true; Hd.deringing = true;
      rzMust(Hd.executeOn(aux.mainView, false), "HDRMultiscaleTransform");
      var PM = new PixelMath;
      PM.expression = "$T*" + (1 - mezcla) + " + " + aux.mainView.id + "*" + mezcla; PM.useSingleExpression = true;
      PM.truncate = true; PM.truncateLower = 0; PM.truncateUpper = 1; PM.createNewImage = false;
      rzMust(PM.executeOn(wh.mainView), "PixelMath (mezcla HDRMT)");
      aux.forceClose();
      medir("HDRMT " + capas + " capas, luminosidad, mezcla " + mezcla, wh, t2, { hdrmt: { capas: capas, mezcla: mezcla } });
    } catch (e) { cands.push({ etiqueta: "HDRMT", error: String(e && e.message ? e.message : e) }); }
  }
  if (o.dse !== false) {
    var t3 = Date.now();
    try {
      var d = darkStructureEnhance(viewId, { median: (o.dse && o.dse.median) || 0.7, nuevaVista: viewId + "_dse" });
      medir("DarkStructureEnhance median " + d.median, ImageWindow.windowById(d.view), t3, { dse: { median: d.median } });
    } catch (e) { cands.push({ etiqueta: "DarkStructureEnhance", error: String(e && e.message ? e.message : e) }); }
  }
  var ok = cands.filter(function (c) { return c.medidas && !c.fallos.length && c.contraste_x > 1.0; });
  var best = ok.reduce(function (a, c) { return a === null || c.contraste_x > a.contraste_x ? c : a; }, null);
  var nombre = (typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_lc"), vista = null;
  cands.forEach(function (c) {
    if (!c.vista) return;
    var w = ImageWindow.windowById(c.vista);
    if (w.isNull) return;
    if (c === best) {
      if (c.vista !== nombre) { var old = ImageWindow.windowById(nombre); if (!old.isNull) old.forceClose(); w.mainView.id = nombre; }
      vista = w.mainView.id;
    } else if (o.cerrar !== false) w.forceClose();
  });
  // El contraste local sube el cielo (LHE: de 0,070 a 0,078 en M31, 13 nov 2026; la final de Opus quedó 0,008 por encima
  // del objetivo). Se devuelve el cielo a su nivel de entrada con un ajuste lineal que deja fijo el blanco:
  // (x − c1)·(1 − c0)/(1 − c1) + c0. mantenerCielo: false para no hacerlo.
  var cieloRestaurado = null;
  if (vista && o.mantenerCielo !== false && best && Math.abs(best.medidas.cielo - base.cielo) > 0.002) {
    var c1 = best.medidas.cielo, c0 = base.cielo, Pc = new PixelMath;
    Pc.expression = "max(0, ($T - " + c1 + ")*" + ((1 - c0) / (1 - c1)).toFixed(6) + " + " + c0 + ")";
    Pc.useSingleExpression = true; Pc.createNewImage = false; Pc.truncate = true; Pc.truncateLower = 0; Pc.truncateUpper = 1;
    if (Pc.executeOn(View.viewById(vista))) cieloRestaurado = { antes: c1, despues: rzMedidasContraste(View.viewById(vista)).cielo, objetivo: c0 };
  }
  return {
    vista: vista, original: viewId, entrada: base, cielo_restaurado: cieloRestaurado || undefined,
    comparados: cands.map(function (c) {
      if (!c.medidas) return { metodo: c.etiqueta, error: c.error, elegido: false };
      return { metodo: c.etiqueta, sel: c.sel, contraste_ganado_pct: +(100 * (c.contraste_x - 1)).toFixed(1), ruido_rel: c.ruido_x,
               contraste_x: c.contraste_x, ruido_cielo_x: c.ruido_x, cielo: c.medidas.cielo,
               quemados_pct: c.medidas.quemados_pct, cumple: !c.fallos.length, fallos: c.fallos.join("; ") || undefined,
               segundos: c.segundos, elegido: c === best, previa: c.previa || undefined };
    }),
    recomendado: best ? best.etiqueta : "ninguno: dejar la imagen como está",
    motivo: best ? best.etiqueta + ": sube el contraste local ×" + best.contraste_x + " con el ruido del cielo ×" + best.ruido_x + "." :
                   "Ningún método sube el contraste local sin pasarse de ruido, cielo o quemados: la imagen se queda como está.",
    segundos: Math.round((Date.now() - t0) / 1000),
    control: {
      revisar_a_ojo: ["halos oscuros alrededor de zonas brillantes (LHE con radio pequeño)", "aspecto artificial o «HDR» de la nebulosa",
                      "estructuras oscuras exageradas (DarkStructureEnhance)"],
      nota: "contraste_x = contraste local (rango p10–p90 en celdas de 64 px con señal) frente a la entrada; ruido_cielo_x = ruido del " +
            "cielo frente a la entrada. Lo de revisar_a_ojo no lo mide esta función."
    }
  };
}

// ---------------------------------------------------------------------------------------------------
// Paso 7 no lineal: nitidez para elegir (lámina «sharpening y denoise final»; Rafael, 11 nov 2026). Sobre la STARLESS
// estirada (sin estrellas no hay halos oscuros alrededor de ellas) y a través de una máscara de luminancia que protege el
// cielo. Tres niveles de máscara de enfoque (UnsharpMask en luminancia): suave (σ 1,5, amount 0,3), equilibrado (σ 2,
// 0,5) y acentuado (σ 2,5, 0,7). Mide en cada uno el detalle fino (laplaciana en las celdas con señal), el ruido y el
// nivel del cielo y los quemados. Recomienda el más fuerte que no sube el ruido del cielo más de un 10 % (ruidoMax), no
// mueve el cielo ni quema; si ninguno cumple, no aplicar («casi siempre basta con lo que hizo la deconvolución»). Valores
// de partida sin calibrar con casos: el usuario elige mirando el recorte al 100 %.
//   var r = nitidezCandidatos("Starless_nxt");
function rzDetalleFino(view) {
  var im = view.image, W = im.width, H = im.height, nc = im.numberOfChannels, n = W * H, R = new Rect(0, 0, W, H);
  var L = new Float32Array(n), b = new Float32Array(n);
  for (var c = 0; c < nc; ++c) { im.getSamples(b, R, c); for (var i = 0; i < n; ++i) L[i] += b[i] / nc; }
  var S = 64, cells = [];
  for (var y0 = 1; y0 + S < H; y0 += S) for (var x0 = 1; x0 + S < W; x0 += S) {
    var s = 0, k = 0; for (var y = y0; y < y0 + S; y += 4) for (var x = x0; x < x0 + S; x += 4) { s += L[y * W + x]; ++k; }
    cells.push({ x: x0, y: y0, m: s / k });
  }
  cells.sort(function (a, b2) { return b2.m - a.m; });
  var top = cells.slice(0, Math.max(5, Math.floor(cells.length * 0.3))), v = [];
  top.forEach(function (cc) {
    for (var y = cc.y; y < cc.y + S; y += 2) for (var x = cc.x; x < cc.x + S; x += 2) {
      var p = y * W + x; v.push(Math.abs(4 * L[p] - L[p - 1] - L[p + 1] - L[p - W] - L[p + W]));
    }
  });
  v.sort(function (a, b2) { return a - b2; });
  var cx = top[0].x + S / 2, cy = top[0].y + S / 2, h = Math.min(400, W >> 1, H >> 1);
  var x1 = Math.max(0, Math.min(W - 2 * h, cx - h)), y1 = Math.max(0, Math.min(H - 2 * h, cy - h));
  return { detalle_fino: v.length ? v[v.length >> 1] : 0, rect: [x1, y1, x1 + 2 * h, y1 + 2 * h] };
}

function nitidezCandidatos(viewId, o) {
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);
  o = o || {};
  var src = rzView(viewId), t0 = Date.now();
  if (rzMedian(src) < 0.05) throw new Error("La imagen parece lineal: la nitidez va sobre la starless estirada (Paso 7 no lineal)");
  var niveles = o.niveles || [{ etiqueta: "suave", sigma: 1.5, amount: 0.3 }, { etiqueta: "equilibrado", sigma: 2.0, amount: 0.5 },
                              { etiqueta: "acentuado", sigma: 2.5, amount: 0.7 }];
  var ruidoMax = o.ruidoMax || 1.10, base = rzMedidasContraste(src), df0 = rzDetalleFino(src), cands = [];
  var masc = (o.mascara !== false && typeof bsMascara === "function") ? bsMascara(src) : null;
  function previaRec(id) {
    if (typeof PIASTROPILOT_PREVIAS !== "string" || !PIASTROPILOT_PREVIAS || typeof pprPrevia !== "function") return null;
    try { return pprPrevia(id, { fichero: PIASTROPILOT_PREVIAS + "/" + id + "_100.jpg", lado: 800, rect: df0.rect, estirar: false }).fichero; } catch (e) { return null; }
  }
  niveles.forEach(function (nv) {
    var c = { etiqueta: nv.etiqueta + " (σ " + nv.sigma + ", amount " + nv.amount + ")" };
    try {
      var id = viewId + "_nit_" + nv.etiqueta;
      for (var n2 = 2; !ImageWindow.windowById(id).isNull; ++n2) id = viewId + "_nit_" + nv.etiqueta + "_" + n2;
      var w = rzCopy(src, id); w.show();
      if (masc) { w.mask = masc; w.maskVisible = false; w.maskInverted = false; w.maskEnabled = true; }
      var U = new UnsharpMask;
      U.sigma = nv.sigma; U.amount = nv.amount; U.useLuminance = true; U.linear = false; U.deringing = false;
      var ok = U.executeOn(w.mainView);
      if (masc) w.removeMask();
      rzMust(ok, "UnsharpMask");
      var m = rzMedidasContraste(w.mainView), df = rzDetalleFino(w.mainView), f = [];
      var gr = m.ruido_cielo / Math.max(base.ruido_cielo, 1e-9);
      if (gr > ruidoMax) f.push("sube el ruido del cielo ×" + gr.toFixed(2) + " (máx. ×" + ruidoMax + ")");
      if (Math.abs(m.cielo - base.cielo) > 0.01) f.push("mueve el cielo de " + base.cielo + " a " + m.cielo);
      if (m.quemados_pct - base.quemados_pct > 0.02) f.push("quema " + (m.quemados_pct - base.quemados_pct).toFixed(3) + " % más de píxeles");
      c.vista = id; c.detalle_x = +(df.detalle_fino / Math.max(df0.detalle_fino, 1e-9)).toFixed(2); c.ruido_x = +gr.toFixed(3);
      c.cielo = m.cielo; c.fallos = f; c.cumple = !f.length; c.fuerza = nv.amount;
      c.previa = typeof pxPrevia === "function" ? pxPrevia(id, id, { estirar: false }) : null;
      c.previa_recorte = previaRec(id);
      c.resumen = "detalle ×" + c.detalle_x + ", ruido ×" + c.ruido_x + (f.length ? " · NO CUMPLE: " + f.join("; ") : "");
    } catch (e) { c.error = String(e && e.message ? e.message : e); }
    cands.push(c);
  });
  if (masc) masc.forceClose();
  var ok2 = cands.filter(function (c) { return c.vista && c.cumple; });
  var best = ok2.reduce(function (a, c) { return a === null || c.fuerza > a.fuerza ? c : a; }, null);
  cands.forEach(function (c) { c.recomendado = c === best; c.elegido = c === best; });
  return {
    vista: best ? best.vista : null, original: viewId, candidatos: cands, recomendado: best ? best.etiqueta : "no aplicar nitidez",
    entrada: { ruido_cielo: base.ruido_cielo, cielo: base.cielo, detalle_fino: +df0.detalle_fino.toPrecision(3) },
    recorte_previa: df0.rect, no_cumple: [], segundos: Math.round((Date.now() - t0) / 1000),
    siguiente: "El usuario elige uno (o ninguno: la original sigue siendo válida) mirando el recorte al 100 %; seguir con esa vista y cerrar las demás.",
    control: {
      revisar_a_ojo: ["bordes 'ilustrados' o halos claros en los bordes de la nebulosa", "grano del fondo amplificado al 100–200 %",
                      "comparar con la original: más microcontraste no es más resolución"],
      nota: "Sobre la starless: las estrellas no se enfocan (se recombinan en el Paso 9). detalle_x = laplaciana mediana en el 30 % de celdas " +
            "más brillantes frente a la original. Niveles sin calibrar con varios casos. Lo de revisar_a_ojo no lo mide esta función."
    }
  };
}
