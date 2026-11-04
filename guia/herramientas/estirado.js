// estirado.js — Estirado del Paso 1 no lineal en una sola llamada: starless "al fallo" con pasadas cortas de GHS y capa
// de estrellas con starStretch. PJSR, ECMAScript 5.
//
// Uso (en el nivel superior del script):
//   eval(File.readTextFile("<ruta de guia>/herramientas/estirado.js"));
//   var r = estirarCapas("Starless", "Stars", { cielo: 0.10 });   // las dos capas
//   var r = estirarStarless("Starless", { cielo: 0.10, nuevaVista: "Starless_st_v1" });
//   JSON.stringify(r);
//
// Starless "al fallo" (por defecto), como se hace a mano: varias pasadas cortas mejor que una larga, estirar hasta que
// algo falla y quedarse con la anterior.
// - Fase 1 de la ficha (D 2,5, b 12, SP = mediana, HP 0,95) para levantar el pie.
// - Pasadas cortas de GHS (D 1, b 6, SP = cielo, LP 0, HP 0,92); tras cada una, punto negro para dejar el cielo en
//   'cielo' (0,10 por defecto). Se mide después de cada pasada.
// - Fallo: ruido del cielo > 15 % del cielo (ruidoMax), > 0,05 % de píxeles a 0 (ceroMax) o > 0,95 (altoMax). Si una
//   pasada falla se deshace y se prueba otra la mitad de corta; si ni la más corta (D 0,125) cabe, se queda la anterior.
// - Calibrado con M31 (4 nov 2026): el arcsinh aceptado tenía un ruido del cielo del 11,8 %; al fallo da bulbo 0,747 y
//   disco 0,238 frente a 0,751 y 0,214 del arcsinh; a fondo fijo 0,10 daba 0,45 y 0,13 (galaxia apagada).
// - "cielo" es la mediana de las celdas de 64 px más oscuras (10 %), no la mediana de la imagen: en nebulosas que llenan
//   el campo la mediana queda por encima.
// Modo antiguo: { modo: "fondo", fondo: 0.20 } estira hasta una mediana fija con una o dos pasadas (estirarAFondo).
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

function estirarAFondo(viewId, o) {
  if (viewId && typeof viewId === "object" && viewId.id !== undefined) viewId = viewId.id;   // también vale la View
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
        sin_dominante_en_el_cielo: dom < 5
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
// Estirado "al fallo".

// Medidas de la imagen para decidir el fallo: cielo (mediana de las celdas de 64 px más oscuras, 10 %), ruido del
// cielo (diferencias entre píxeles vecinos en esas celdas), percentiles de la luminancia y píxeles a 0 / > 0,95.
function esCheck(view) {
  var im = view.image, W = im.width, H = im.height, n = W * H, R = new Rect(0, 0, W, H), nc = im.numberOfChannels;
  var L = new Float32Array(n), buf = new Float32Array(n), cero = 0, alto = 0;
  for (var c = 0; c < nc; ++c) {
    im.getSamples(buf, R, c);
    for (var i = 0; i < n; ++i) { var x = buf[i]; L[i] += x / nc; if (x <= 0.0001) ++cero; if (x >= 0.95) ++alto; }
  }
  var S = 64, cells = [];
  for (var y0 = 0; y0 + S <= H; y0 += S)
    for (var x0 = 0; x0 + S <= W; x0 += S) {
      var v = [];
      for (var y = y0; y < y0 + S; y += 2) for (var x = x0; x < x0 + S; x += 2) v.push(L[y * W + x]);
      v.sort(function (a, b) { return a - b; });
      cells.push({ x: x0, y: y0, m: v[v.length >> 1] });
    }
  cells.sort(function (a, b) { return a.m - b.m; });
  var k = Math.max(5, Math.floor(cells.length * 0.10)), dif = [], sk = [];
  for (var j = 0; j < k; ++j) {
    var cc = cells[j];
    sk.push(cc.m);
    for (var yy = cc.y; yy < cc.y + S; ++yy) for (var xx = cc.x; xx < cc.x + S - 1; xx += 2) dif.push(Math.abs(L[yy * W + xx + 1] - L[yy * W + xx]));
  }
  sk.sort(function (a, b) { return a - b; }); dif.sort(function (a, b) { return a - b; });
  var cielo = sk[sk.length >> 1], ruido = dif[dif.length >> 1] / (0.6745 * Math.SQRT2), all = [];
  for (var q = 0; q < n; q += 17) all.push(L[q]);
  all.sort(function (a, b) { return a - b; });
  function pc(p) { return all[Math.floor(p * (all.length - 1))]; }
  return { cielo: +cielo.toFixed(4), ruido_rel: +(ruido / Math.max(cielo, 1e-6)).toFixed(3),
           mediana: +pc(0.5).toFixed(4), p90: +pc(0.9).toFixed(4), p99: +pc(0.99).toFixed(4), p999: +pc(0.999).toFixed(4),
           cero_pct: +(100 * cero / (n * nc)).toFixed(4), alto_pct: +(100 * alto / (n * nc)).toFixed(4) };
}

function esAssign(dst, src) { dst.beginProcess(); dst.image.assign(src.image); dst.endProcess(); }

// Punto negro que deja el cielo s en f: (x − bp)/(1 − bp).
function esBlackPoint(view, s, f) {
  var bp = (s - f) / (1 - f);
  if (bp <= 0) return 0;
  var P = new PixelMath;
  P.expression = "max(0, ($T - " + bp + ") / (1 - " + bp + "))";
  P.useSingleExpression = true; P.createNewImage = false;
  P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1;
  if (!P.executeOn(view)) throw new Error("Punto negro falló");
  return bp;
}

function esFallo(c, lim) {
  var f = [];
  if (c.ruido_rel > lim.ruido) f.push("ruido del cielo " + c.ruido_rel + " > " + lim.ruido);
  if (c.cero_pct > lim.cero) f.push("sombras a 0 " + c.cero_pct + " % > " + lim.cero + " %");
  if (c.alto_pct > lim.alto) f.push("luces > 0,95 " + c.alto_pct + " % > " + lim.alto + " %");
  return f;
}

// Dominante de color del CIELO: medianas por canal en el 10 % de celdas de 64 px más oscuras (no la mediana de la
// imagen, que en una nebulosa que llena el campo es la propia nebulosa y su color).
function esSkyDominance(view) {
  var im = view.image, W = im.width, H = im.height, S = 64, nc = im.numberOfChannels;
  if (nc < 3) return { dominante_pct: 0, canales: [] };
  var cells = [], blk = new Float32Array(S * S), lum = new Float32Array(S * S);
  for (var y0 = 0; y0 + S <= H; y0 += S)
    for (var x0 = 0; x0 + S <= W; x0 += S) {
      var R = new Rect(x0, y0, x0 + S, y0 + S); lum.fill(0);
      for (var c = 0; c < 3; ++c) { im.getSamples(blk, R, c); for (var i = 0; i < blk.length; i += 4) lum[i] += blk[i]; }
      var v = []; for (var j = 0; j < lum.length; j += 4) v.push(lum[j]);
      v.sort(function (a, b) { return a - b; });
      cells.push({ r: R, m: v[v.length >> 1] });
    }
  cells.sort(function (a, b) { return a.m - b.m; });
  var k = Math.max(5, Math.floor(cells.length * 0.10)), med = [];
  for (var ch = 0; ch < 3; ++ch) {
    var vals = [];
    for (var q = 0; q < k; ++q) { im.getSamples(blk, cells[q].r, ch); for (var t = 0; t < blk.length; t += 8) vals.push(blk[t]); }
    vals.sort(function (a, b) { return a - b; });
    med.push(vals[vals.length >> 1]);
  }
  var mean = (med[0] + med[1] + med[2]) / 3;
  return { dominante_pct: +(100 * (Math.max.apply(null, med) - Math.min.apply(null, med)) / mean).toFixed(1),
           canales: med.map(function (m) { return +m.toFixed(4); }) };
}
function estirarStarless(viewId, o) {
  if (viewId && typeof viewId === "object" && viewId.id !== undefined) viewId = viewId.id;   // también vale la View
  o = o || {};
  if (o.modo === "fondo") return estirarAFondo(viewId, o);
  var cielo = o.cielo || 0.10, D = o.paso || 1.0, canal = o.canal || "RGB";
  var lim = { ruido: o.ruidoMax || 0.15, cero: o.ceroMax || 0.05, alto: o.altoMax || 0.05 };
  var win = ImageWindow.windowById(viewId);
  if (win.isNull) throw new Error("No existe la vista " + viewId);
  var med0 = esMedian(win.mainView);
  if (med0 > 0.05) throw new Error("La imagen parece ya estirada (mediana " + med0.toFixed(4) + "): no repetir la fase 1");
  var w = esCopy(viewId, o.nuevaVista || (viewId + "_st"));
  w.show();
  var v = w.mainView, pasadas = [];
  esGHS(v, 2.5, 12, med0, 0, 0.95, canal);
  var c = esCheck(v);
  pasadas.push({ n: 1, fase: 1, D: 2.5, b: 12, SP: +med0.toPrecision(4), HP: 0.95, cielo: c.cielo, ruido_rel: c.ruido_rel, p99: c.p99 });
  var prev = esCopy(v.id, "esPrev"), motivo = "máximo de pasadas", maxN = o.maxPasadas || 25, descartadas = 0;
  for (var n = 2; n <= maxN; ++n) {
    esAssign(prev.mainView, v);
    esGHS(v, D, 6, Math.max(c.cielo, 1e-5), 0, 0.92, canal);
    var c1 = esCheck(v), bp = 0;
    if (c1.cielo > cielo) { bp = esBlackPoint(v, c1.cielo, cielo); c1 = esCheck(v); }
    var f = esFallo(c1, lim);
    if (f.length) {
      esAssign(v, prev.mainView);
      ++descartadas;
      if (D / 2 < (o.pasoMin || 0.12)) { motivo = "fallo con la pasada más corta (D " + D + "): " + f.join("; ") + "; se queda la anterior"; break; }
      D = D / 2;
      continue;
    }
    pasadas.push({ n: n, D: D, b: 6, SP: +c.cielo.toPrecision(3), HP: 0.92, punto_negro: +bp.toPrecision(3),
                   cielo: c1.cielo, ruido_rel: c1.ruido_rel, p99: c1.p99 });
    c = c1;
  }
  prev.forceClose();

  var im = v.image, porCanal = [];
  for (var ch = 0; ch < im.numberOfChannels; ++ch) { im.selectedChannel = ch; porCanal.push(+im.median().toFixed(4)); }
  im.resetSelections();
  var sd = esSkyDominance(v), dom = sd.dominante_pct, noCumple = [];
  if (dom >= 5) {
    var nombres = ["rojo", "verde", "azul"], k = sd.canales.indexOf(Math.max.apply(null, sd.canales));
    noCumple.push("DOMINANTE DEL CIELO " + dom + " % hacia el " + nombres[k] + " (límite 5 %): no es aceptable; viene de la " +
                  "fase lineal (fondo tras el gradiente o SPCC) y hay que corregirla allí antes de seguir");
  }
  if (Math.abs(c.cielo - cielo) > 0.02) noCumple.push("cielo " + c.cielo + " fuera del objetivo " + cielo);
  return {
    vista: v.id, original: viewId, metodo: "al fallo (pasadas cortas de GHS + punto negro)", cielo_objetivo: cielo,
    pasadas: pasadas, pasadas_descartadas: descartadas, parada: motivo,
    no_cumple: noCumple,
    medidas: c, mediana_por_canal: porCanal, cielo_por_canal: sd.canales, dominante_cielo_pct: dom,
    control: {
      medido: {
        cielo_en_objetivo: Math.abs(c.cielo - cielo) <= 0.02,
        ruido_del_cielo_bajo_el_limite: c.ruido_rel <= lim.ruido,
        sin_sombras_aplastadas: c.cero_pct <= lim.cero,
        sin_luces_quemadas: c.alto_pct <= lim.alto,
        sin_dominante_en_el_cielo: dom < 5
      },
      revisar_a_ojo: ["núcleos brillantes (galaxias): si se ven quemados, HDRMT en los pasos siguientes",
                      "dientes de sierra al ampliar el histograma (posterización)",
                      "ruido del fondo al 100 %: si molesta, repetir con ruidoMax menor (0,12)"],
      nota: "Se estira hasta el fallo y se queda la pasada anterior: la imagen está todo lo estirada que permiten el ruido " +
            "y el recorte. 'parada' dice qué falló. Lo de revisar_a_ojo no lo mide esta función."
    }
  };
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
  if (viewId && typeof viewId === "object" && viewId.id !== undefined) viewId = viewId.id;   // también vale la View
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
//   var r = estirarCapas("Starless", "Stars", { cielo: 0.10 });   // { starless: {...}, estrellas: {...} }
function estirarCapas(starlessId, starsId, o) {
  if (starlessId && typeof starlessId === "object" && starlessId.id !== undefined) starlessId = starlessId.id;   // también vale la View
  if (starsId && typeof starsId === "object" && starsId.id !== undefined) starsId = starsId.id;   // también vale la View
  o = o || {};
  var r = { starless: estirarStarless(starlessId, { cielo: o.cielo, ruidoMax: o.ruidoMax, modo: o.modo, fondo: o.fondo, canal: o.canal, nuevaVista: o.nuevaStarless, fase3: o.fase3 }) };
  if (starsId) r.estrellas = estirarEstrellas(starsId, { nuevaVista: o.nuevasEstrellas, amount: o.amount, saturacion: o.saturacion });
  return r;
}
