// estirado.js — Estirado del Paso 1 no lineal en una sola llamada: starless con GHS hasta el fondo objetivo y capa de
// estrellas con starStretch. PJSR, ECMAScript 5.
//
// Uso (en el nivel superior del script):
//   eval(File.readTextFile("<ruta de guia>/herramientas/estirado.js"));
//   var r = estirarCapas("Starless", "Stars", { fondo: 0.20 });   // las dos capas
//   var r = estirarStarless("Starless", { fondo: 0.20, nuevaVista: "Starless_st_v1" });
//   JSON.stringify(r);   // { vista, pasadas: [{D, b, SP, LP, HP, mediana}], mediana, minimo, maximo, recorte, ... }
//
// Opciones: fondo (mediana objetivo; 0,15–0,25 en nebulosas de emisión, 0,10 en galaxias; por defecto 0,20),
// nuevaVista (copia donde se estira; por defecto <vista>_st), canal ("RGB" por defecto o "Col" para conservar el
// tono), tolerancia (0,02).
//
// Qué hace, siguiendo la ficha del Paso 1 no lineal:
// - Trabaja sobre una copia; no toca la original. Se niega si la imagen ya parece estirada (mediana > 0,05).
// - Fase 1 "levantar el pie": D 2,5, b 12, SP = mediana, LP 0, HP 0,95.
// - Si el fondo aún no llega, segunda pasada con SP = nueva mediana, b 8, LP 0, HP 0,92 y el D que lleva la mediana
//   al objetivo, buscado por bisección sobre una copia reducida ×4 (rápido) y aplicado después a la imagen completa.
// - Mide al final mediana, mínimo, máximo y píxeles recortados (= 0 o ≥ 0,999).
// No hace las fases 3 y 4 (altas luces y núcleos): son ajustes finos que dependen del objeto.

function esK(C, name) {
  if (C[name] !== undefined) return C[name];
  if (C.prototype && C.prototype[name] !== undefined) return C.prototype[name];
  throw new Error("Constante no encontrada: " + name);
}

function esMedian(view) {
  var im = view.image, s = 0;
  for (var c = 0; c < im.numberOfChannels; ++c) { im.selectedChannel = c; s += im.median(); }
  im.resetSelections();
  return s / im.numberOfChannels;
}

function esCopy(srcId, newId, factor) {
  var src = ImageWindow.windowById(srcId), im = src.mainView.image;
  var id = newId;
  for (var n = 2; !ImageWindow.windowById(id).isNull; ++n) id = newId + "_" + n;
  var w = new ImageWindow(im.width, im.height, im.numberOfChannels, 32, true, im.isColor, id);
  w.mainView.beginProcess();
  w.mainView.image.assign(im);
  w.mainView.endProcess();
  if (factor && factor > 1) {
    var R = new IntegerResample;
    R.zoomFactor = -factor;
    R.downsamplingMode = esK(IntegerResample, "Average");
    if (!R.executeOn(w.mainView)) throw new Error("IntegerResample falló");
  } else if (src.hasAstrometricSolution) {
    w.copyAstrometricSolution(src);
  }
  return w;
}

function esGHS(view, D, b, SP, LP, HP, canal) {
  var P = new GeneralizedHyperbolicStretch;
  P.stretchType = esK(GeneralizedHyperbolicStretch, "ST_GeneralisedHyperbolic");
  P.stretchChannel = esK(GeneralizedHyperbolicStretch, canal === "Col" ? "SC_Colour" : "SC_RGB");
  P.stretchFactor = D;
  P.localIntensity = b;
  P.symmetryPoint = SP;
  P.shadowProtection = LP;
  P.highlightProtection = HP;
  if (!P.executeOn(view)) throw new Error("GHS falló (D " + D + ", b " + b + ")");
}

function estirarStarless(viewId, o) {
  o = o || {};
  var fondo = o.fondo || 0.20, tol = o.tolerancia || 0.02, canal = o.canal || "RGB";
  var win = ImageWindow.windowById(viewId);
  if (win.isNull) throw new Error("No existe la vista " + viewId);
  var med0 = esMedian(win.mainView);
  if (med0 > 0.05) throw new Error("La imagen parece ya estirada (mediana " + med0.toFixed(4) + "): no repetir la fase 1");

  var w = esCopy(viewId, o.nuevaVista || (viewId + "_st"));
  w.show();
  var v = w.mainView, pasadas = [];

  // Fase 1: levantar el pie.
  esGHS(v, 2.5, 12, med0, 0, 0.95, canal);
  var med1 = esMedian(v);
  pasadas.push({ fase: 1, D: 2.5, b: 12, SP: +med0.toPrecision(4), LP: 0, HP: 0.95, mediana: +med1.toFixed(4) });

  // Fase 2: bisección del D sobre una copia reducida hasta llegar al fondo objetivo.
  if (med1 < fondo - tol) {
    var small = esCopy(v.id, "esTmpBase", 4), lo = 0.1, hi = 8, D = 3;
    for (var it = 0; it < 14; ++it) {
      D = 0.5 * (lo + hi);
      var t = esCopy(small.mainView.id, "esTmpTry");
      esGHS(t.mainView, D, 8, med1, 0, 0.92, canal);
      var m = esMedian(t.mainView);
      t.forceClose();
      if (Math.abs(m - fondo) < 0.005) break;
      if (m < fondo) lo = D; else hi = D;
    }
    small.forceClose();
    esGHS(v, D, 8, med1, 0, 0.92, canal);
    var med2 = esMedian(v);
    pasadas.push({ fase: 2, D: +D.toFixed(3), b: 8, SP: +med1.toPrecision(4), LP: 0, HP: 0.92, mediana: +med2.toFixed(4) });
  }

  // Fase 3 (altas luces), sólo si hacen falta: más del 0,05 % de los píxeles por encima de 0,95.
  var f3 = (o.fase3 === undefined) ? "auto" : o.fase3, alto = esHigh(v, 0.95);
  if (f3 === true || (f3 === "auto" && alto > 0.05)) {
    var medA = esMedian(v);
    esGHS(v, 0.7, 0, medA, 0.06, 0.85, canal);
    var medB = esMedian(v);
    pasadas.push({ fase: 3, D: 0.7, b: 0, SP: +medA.toPrecision(4), LP: 0.06, HP: 0.85, mediana: +medB.toFixed(4),
                   motivo: "altas luces: " + alto.toFixed(3) + " % de píxeles > 0,95" });
  }

  // Medidas finales.
  var im = v.image, W = im.width, H = im.height, buf = new Float32Array(W * H), cero = 0, sat = 0, mn = 1, mx = 0;
  var porCanal = [];
  for (var c = 0; c < im.numberOfChannels; ++c) {
    im.getSamples(buf, new Rect(0, 0, W, H), c);
    for (var i = 0; i < buf.length; ++i) { var x = buf[i]; if (x <= 0) ++cero; if (x >= 0.999) ++sat; if (x < mn) mn = x; if (x > mx) mx = x; }
    im.selectedChannel = c;
    porCanal.push(+im.median().toFixed(4));
  }
  im.resetSelections();
  var total = W * H * im.numberOfChannels, medF = esMedian(v);
  var dom = 0;
  if (porCanal.length === 3) dom = 100 * (Math.max.apply(null, porCanal) - Math.min.apply(null, porCanal)) / medF;
  var aCero = 100 * cero / total, aUno = 100 * sat / total;
  return {
    vista: v.id, original: viewId, fondo_objetivo: fondo, pasadas: pasadas,
    mediana: +medF.toFixed(4), mediana_por_canal: porCanal, minimo: +mn.toFixed(4), maximo: +mx.toFixed(4),
    recorte_pct: { a_cero: +aCero.toFixed(3), a_uno: +aUno.toFixed(3) },
    dominante_fondo_pct: +dom.toFixed(1),
    altas_luces_pct_095: +esHigh(v, 0.95).toFixed(3),
    en_objetivo: Math.abs(medF - fondo) <= 0.05,
    control: {
      medido: {
        fondo_en_objetivo: Math.abs(medF - fondo) <= 0.02,
        sin_sombras_aplastadas: aCero < 0.1,
        sin_luces_quemadas: aUno < 0.01,
        sin_dominante_en_el_fondo: dom < 5
      },
      revisar_a_ojo: ["histograma con dos cúpulas (exceso de b): deshacer y bajar b ~40 % o D ~50 %",
                      "dientes de sierra al ampliar el histograma (posterización)",
                      "detalle de la nebulosa y señal débil: si se ve plano, probar MAS o subir un poco el fondo"],
      nota: "dominante_fondo_pct = diferencia entre las medianas de los canales respecto a la mediana (< 5 % = neutro). " +
            "Lo de revisar_a_ojo no lo mide esta función."
    }
  };
}

function esHigh(view, thr) {
  var im = view.image, W = im.width, H = im.height, buf = new Float32Array(W * H), n = 0;
  for (var c = 0; c < im.numberOfChannels; ++c) {
    im.getSamples(buf, new Rect(0, 0, W, H), c);
    for (var i = 0; i < buf.length; i += 4) if (buf[i] > thr) ++n;
  }
  return 100 * n / (W * H * im.numberOfChannels / 4);
}

// ---------------------------------------------------------------------------------------------------
// Capa de estrellas LINEAL con starStretch (Star Stretch de SetiAstro) sobre una copia. amount por defecto 2 (campos
// con muchas estrellas: 1–3; con pocas, hasta 5). Como la curva de starStretch es punto a punto, devuelve también el
// p90 de los píxeles de estrella (> 0,005) que daría cada amount, calculado sobre una muestra sin tocar la imagen,
// para poder decidir si conviene otro amount.
//   var e = estirarEstrellas("Stars", { nuevaVista: "Stars_st", amount: 2, saturacion: 1 });
function esStarCurve(x, A) { var k = Math.pow(3, A); return k * x / ((k - 1) * x + 1); }

function esStarP90(sample, A) {
  var s = [];
  for (var i = 0; i < sample.length; ++i) { var y = esStarCurve(sample[i], A); if (y > 0.005) s.push(y); }
  if (!s.length) return 0;
  s.sort(function (a, b) { return a - b; });
  return s[Math.floor(0.9 * (s.length - 1))];
}

function estirarEstrellas(viewId, o) {
  o = o || {};
  var sat = o.saturacion || 1;
  if (typeof starStretch !== "function" && typeof PICOPILOT_GUIA === "string")
    try { eval.call(null, File.readTextFile(PICOPILOT_GUIA + "/herramientas/realces.js")); } catch (e) { }
  if (typeof starStretch !== "function") throw new Error("starStretch no está cargado (herramientas/realces.js)");
  var win = ImageWindow.windowById(viewId);
  if (win.isNull) throw new Error("No existe la vista " + viewId);
  var med0 = esMedian(win.mainView);
  if (med0 > 0.05) throw new Error("La capa de estrellas parece ya estirada (mediana " + med0.toFixed(4) + ")");

  // Muestra: máximo de canal de 1 de cada 3 píxeles (luminancia conservadora).
  var im = win.mainView.image, W = im.width, H = im.height, R = new Rect(0, 0, W, H), n = W * H;
  var mxs = new Float32Array(n), buf = new Float32Array(n);
  for (var c = 0; c < im.numberOfChannels; ++c) {
    im.getSamples(buf, R, c);
    for (var i = 0; i < n; ++i) if (buf[i] > mxs[i]) mxs[i] = buf[i];
  }
  var sample = [];
  for (var j = 0; j < n; j += 3) sample.push(mxs[j]);

  var A = (o.amount !== undefined) ? o.amount : 2, curva = [];
  for (var a = 1; a <= 5.001; a += 1) curva.push({ amount: a, p90: +esStarP90(sample, a).toFixed(3) });
  var w = esCopy(viewId, o.nuevaVista || (viewId + "_st"));
  w.show();
  starStretch(w.mainView.id, { amount: A, saturation: sat, removeGreen: !!o.quitarVerde });

  // Medidas.
  var v = w.mainView, vi = v.image, st = [], mx = 0, med = [], uno = 0;
  for (var c2 = 0; c2 < vi.numberOfChannels; ++c2) {
    vi.getSamples(buf, R, c2);
    for (var k = 0; k < n; ++k) { var x = buf[k]; if (x > mx) mx = x; if (x >= 0.999) ++uno; if (c2 === 0 && x > 0.005 && (k % 5) === 0) st.push(x); }
    vi.selectedChannel = c2; med.push(+vi.median().toPrecision(3));
  }
  vi.resetSelections();
  st.sort(function (p, r) { return p - r; });
  var p90 = st.length ? st[Math.floor(0.9 * (st.length - 1))] : 0;
  return {
    vista: v.id, original: viewId, amount: A, saturacion: sat, p90_segun_amount: curva,
    p90_estrellas: +p90.toFixed(3), mediana_fondo: med, maximo: +mx.toFixed(4),
    control: {
      medido: { fondo_a_cero: med.every(function (m) { return m < 0.01; }), nucleos_a_1_pct: +(100 * uno / (3 * n)).toFixed(4) },
      revisar_a_ojo: ["estrellas hinchadas o con anillos de color", "estrellas pálidas (subir saturación a 1,2–1,5)"],
      nota: "p90_segun_amount dice cuánto subiría el p90 con cada amount: si las estrellas quedan débiles para el campo, " +
            "repetir con un amount mayor (hasta 3 en campos densos, 5 con pocas estrellas). Los núcleos a 1 se " +
            "contienen en el Paso 8. Lo de revisar_a_ojo no lo mide esta función."
    }
  };
}

// Las dos capas del Paso 1 en una llamada.
//   var r = estirarCapas("Starless", "Stars", { fondo: 0.20 });   // { starless: {...}, estrellas: {...} }
function estirarCapas(starlessId, starsId, o) {
  o = o || {};
  var r = { starless: estirarStarless(starlessId, { fondo: o.fondo, canal: o.canal, nuevaVista: o.nuevaStarless, fase3: o.fase3 }) };
  if (starsId) r.estrellas = estirarEstrellas(starsId, { nuevaVista: o.nuevasEstrellas, amount: o.amount, saturacion: o.saturacion });
  return r;
}
