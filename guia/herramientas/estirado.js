// estirado.js — Estirado de la starless con GHS hasta el fondo objetivo, en una sola llamada. PJSR, ECMAScript 5.
//
// Uso (en el nivel superior del script):
//   eval(File.readTextFile("<ruta de guia>/herramientas/estirado.js"));
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
  return {
    vista: v.id, original: viewId, fondo_objetivo: fondo, pasadas: pasadas,
    mediana: +medF.toFixed(4), mediana_por_canal: porCanal, minimo: +mn.toFixed(4), maximo: +mx.toFixed(4),
    recorte_pct: { a_cero: +(100 * cero / total).toFixed(3), a_uno: +(100 * sat / total).toFixed(3) },
    en_objetivo: Math.abs(medF - fondo) <= 0.05
  };
}
