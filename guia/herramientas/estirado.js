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
// - Calibrado con una galaxia grande (4 nov 2026): el arcsinh aceptado tenía un ruido del cielo del 11,8 %; al fallo da bulbo 0,747 y
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
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);   // también vale la View o el resultado de otra función ({ vista: ... })
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
  cells = cells.filter(function (c0) { return c0.m > 1e-6; });   // fuera bordes negros del registro o recorte
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
  cells = cells.filter(function (c0) { return c0.m > 1e-6; });   // fuera bordes negros del registro o recorte
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
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);   // también vale la View o el resultado de otra función ({ vista: ... })
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
  var ops = [{ g: [2.5, 12, med0, 0, 0.95] }];   // registro exacto del estirado, para repetirlo en otra imagen
  var c = esCheck(v);
  pasadas.push({ n: 1, fase: 1, D: 2.5, b: 12, SP: +med0.toPrecision(4), HP: 0.95, cielo: c.cielo, ruido_rel: c.ruido_rel, p99: c.p99 });
  var prev = esCopy(v.id, "esPrev"), motivo = "máximo de pasadas", maxN = o.maxPasadas || 25, descartadas = 0;
  for (var n = 2; n <= maxN; ++n) {
    esAssign(prev.mainView, v);
    var sp = Math.max(c.cielo, 1e-5);
    esGHS(v, D, 6, sp, 0, 0.92, canal);
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
    ops.push({ g: [D, 6, sp, 0, 0.92] });
    if (bp > 0) ops.push({ bp: bp });
    c = c1;
  }
  prev.forceClose();
  ES_OPS[v.id] = { canal: canal, ops: ops };
  var meseta = esMeseta(v);

  var im = v.image, porCanal = [];
  for (var ch = 0; ch < im.numberOfChannels; ++ch) { im.selectedChannel = ch; porCanal.push(+im.median().toFixed(4)); }
  im.resetSelections();
  var sd = esSkyDominance(v), dom = sd.dominante_pct, noCumple = [];
  if (dom >= 5) {
    var nombres = ["rojo", "verde", "azul"], k = sd.canales.indexOf(Math.max.apply(null, sd.canales));
    noCumple.push("DOMINANTE DEL CIELO " + dom + " % hacia el " + nombres[k] + " (límite 5 %): no es aceptable; viene de la " +
                  "fase lineal (fondo tras el gradiente o SPCC) y hay que corregirla allí antes de seguir: neutralizarCielo (color.js) " +
                  "sobre la starless lineal, y volver a estirar");
  }
  if (Math.abs(c.cielo - cielo) > 0.02) noCumple.push("cielo " + c.cielo + " fuera del objetivo " + cielo);
  if (meseta.radio_px > 3)
    noCumple.push("NÚCLEO QUEMADO: meseta de " + meseta.radio_px + " px de radio con luminancia > 0,95 (con estructura: 0–3 px). " +
                  "Siguiente paso, antes de saturar: comprimirNucleo (nucleo.js) sobre esta starless. No volver a estirar ni subir curvas");
  return {
    vista: v.id, original: viewId, metodo: "al fallo (pasadas cortas de GHS + punto negro)", cielo_objetivo: cielo,
    pasadas: pasadas, pasadas_descartadas: descartadas, parada: motivo,
    no_cumple: noCumple,
    medidas: c, mediana_por_canal: porCanal, cielo_por_canal: sd.canales, dominante_cielo_pct: dom, meseta_nucleo: meseta,
    control: {
      medido: {
        cielo_en_objetivo: Math.abs(c.cielo - cielo) <= 0.02,
        ruido_del_cielo_bajo_el_limite: c.ruido_rel <= lim.ruido,
        sin_sombras_aplastadas: c.cero_pct <= lim.cero,
        sin_luces_quemadas: c.alto_pct <= lim.alto,
        sin_dominante_en_el_cielo: dom < 5,
        nucleo_con_estructura: meseta.radio_px <= 3
      },
      revisar_a_ojo: ["núcleos brillantes (galaxias): aunque la meseta sea pequeña, si se ven planos, comprimirNucleo (nucleo.js)",
                      "dientes de sierra al ampliar el histograma (posterización)",
                      "ruido del fondo al 100 %: si molesta, repetir con ruidoMax menor (0,12)"],
      nota: "Se estira hasta el fallo y se queda la pasada anterior: la imagen está todo lo estirada que permiten el ruido " +
            "y el recorte. 'parada' dice qué falló. Lo de revisar_a_ojo no lo mide esta función."
    }
  };
}
// ---------------------------------------------------------------------------------------------------
// Capa de estrellas LINEAL estirada sobre una copia. Por defecto (metodo "asinh") arcsinh que conserva el color:
// L = máx(R,G,B), f = asinh(k·L) / (asinh(k)·L), cada canal × f, k = 3000. Lo débil sube mucho y lo brillante casi nada:
// salen las estrellas débiles sin hinchar las brillantes. En una nebulosa oscura (7 nov 2026) starStretch amount 2 dejó
// el 0,8 % de aporte en la final y ~2 200 estrellas visibles; el arcsinh k 3000 de Opus, el 10 % y ~18 000.
// metodo "starstretch" (o pasar amount): Star Stretch de SetiAstro, amount 1–5; su curva k·x/((k−1)·x+1) con k = 3^amount
// sube lo débil sólo ×9 con amount 2 (×345 el arcsinh): se pierden las estrellas débiles.
//   var e = estirarEstrellas("Stars", { nuevaVista: "Stars_st" });                       // arcsinh k 3000
//   var e = estirarEstrellas("Stars", { nuevaVista: "Stars_st", k: 1000 });              // menos estrellas débiles
//   var e = estirarEstrellas("Stars", { nuevaVista: "Stars_st", metodo: "starstretch", amount: 2, saturacion: 1 });
function esStarCurve(x, A) { var k = Math.pow(3, A); return k * x / ((k - 1) * x + 1); }

function esStarP90(sample, A) {
  var s = [];
  for (var i = 0; i < sample.length; ++i) { var y = esStarCurve(sample[i], A); if (y > 0.005) s.push(y); }
  if (!s.length) return 0;
  s.sort(function (a, b) { return a - b; });
  return s[Math.floor(0.9 * (s.length - 1))];
}

function esAsinh(x) { return Math.log(x + Math.sqrt(x * x + 1)); }
function esAsinhF(L, k) { return L > 1e-9 ? esAsinh(k * L) / (esAsinh(k) * L) : 0; }
function esAsinhP90(sample, k) {
  var s = [];
  for (var i = 0; i < sample.length; ++i) { var y = sample[i] * esAsinhF(sample[i], k); if (y > 0.005) s.push(y); }
  if (!s.length) return 0;
  s.sort(function (a, b) { return a - b; });
  return s[Math.floor(0.9 * (s.length - 1))];
}

function estirarEstrellas(viewId, o) {
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);   // también vale la View o el resultado de otra función ({ vista: ... })
  o = o || {};
  var sat = o.saturacion || 1;
  var metodo = String(o.metodo || (o.amount !== undefined ? "starstretch" : "asinh")).toLowerCase();
  if (metodo === "starstretch" && typeof starStretch !== "function" && typeof PICOPILOT_GUIA === "string")
    try { eval.call(null, File.readTextFile(PICOPILOT_GUIA + "/herramientas/realces.js")); } catch (e) { }
  if (metodo === "starstretch" && typeof starStretch !== "function") throw new Error("starStretch no está cargado (herramientas/realces.js)");
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

  var A = (o.amount !== undefined) ? o.amount : 2, K = o.k || 3000, curva = [];
  if (metodo === "starstretch") for (var a = 1; a <= 5.001; a += 1) curva.push({ amount: a, p90: +esStarP90(sample, a).toFixed(3) });
  else [300, 1000, 3000, 10000].forEach(function (kk) { curva.push({ k: kk, p90: +esAsinhP90(sample, kk).toFixed(3) }); });
  var w = esCopy(viewId, o.nuevaVista || (viewId + "_st"));
  w.show();
  if (metodo === "starstretch") starStretch(w.mainView.id, { amount: A, saturation: sat, removeGreen: !!o.quitarVerde });
  else {
    var wi = w.mainView.image, nc = wi.numberOfChannels, ch = [];
    for (var c1 = 0; c1 < nc; ++c1) { ch.push(new Float32Array(n)); wi.getSamples(ch[c1], R, c1); }
    for (var p = 0; p < n; ++p) { var f = esAsinhF(mxs[p], K); for (var c3 = 0; c3 < nc; ++c3) ch[c3][p] = Math.min(1, ch[c3][p] * f); }
    w.mainView.beginProcess();
    for (var c4 = 0; c4 < nc; ++c4) wi.setSamples(ch[c4], R, c4);
    w.mainView.endProcess();
  }

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
    vista: v.id, original: viewId, metodo: metodo === "starstretch" ? "starStretch" : "arcsinh que conserva el color",
    amount: metodo === "starstretch" ? A : undefined, k: metodo === "starstretch" ? undefined : K,
    saturacion: metodo === "starstretch" ? sat : "sin cambio (la satura el Paso 8)",
    p90_segun_amount: metodo === "starstretch" ? curva : undefined, p90_segun_k: metodo === "starstretch" ? undefined : curva,
    p90_estrellas: +p90.toFixed(3), mediana_fondo: med, maximo: +mx.toFixed(4),
    control: {
      medido: { fondo_a_cero: med.every(function (m) { return m < 0.01; }), nucleos_a_1_pct: +(100 * uno / (3 * n)).toFixed(4) },
      revisar_a_ojo: ["estrellas hinchadas o con anillos de color", "estrellas pálidas (subir saturación a 1,2–1,5)"],
      nota: (metodo === "starstretch" ? "p90_segun_amount dice cuánto subiría el p90 con cada amount. starStretch pierde las estrellas débiles: " +
            "si la final se queda sin estrellas, repetir sin amount (arcsinh). " : "p90_segun_k dice el p90 con cada k: si salen demasiadas " +
            "estrellas débiles o ruido entre ellas, bajar k (1000); si quedan débiles, subirlo (10000). ") +
            "Los núcleos a 1 se contienen en el Paso 8. Lo de revisar_a_ojo no lo mide esta función."
    }
  };
}

// ---------------------------------------------------------------------------------------------------
// Registro del estirado "al fallo" de cada starless (vista estirada → { canal, ops }), para repetir EXACTAMENTE el mismo
// estirado sobre la imagen con estrellas y sacar la capa de estrellas con screenStarsExtract (como Opus en una galaxia grande).
var ES_OPS = {};

function esReplay(view, rec) {
  for (var i = 0; i < rec.ops.length; ++i) {
    var p = rec.ops[i];
    if (p.g) esGHS(view, p.g[0], p.g[1], p.g[2], p.g[3], p.g[4], rec.canal);
    else if (p.bp > 0) {
      var P = new PixelMath;
      P.expression = "max(0, ($T - " + p.bp + ") / (1 - " + p.bp + "))";
      P.useSingleExpression = true; P.createNewImage = false;
      P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1;
      if (!P.executeOn(view)) throw new Error("Punto negro (repetición del estirado) falló");
    }
  }
}

// Meseta del núcleo: radio equivalente (px) de los píxeles con luminancia > umbral en 256×256 px alrededor del punto más
// brillante (bloques de 16 px). Con estructura da 0–3 px; quemado, decenas (galaxia grande con Qwen, 7 nov 2026: 22 px; Opus v7: 1 px).
function esMeseta(view, thr) {
  thr = thr || 0.95;
  var im = view.image, W = im.width, H = im.height, n = W * H, nc = im.numberOfChannels, R = new Rect(0, 0, W, H);
  var L = new Float32Array(n), b = new Float32Array(n);
  for (var c = 0; c < nc; ++c) { im.getSamples(b, R, c); for (var i = 0; i < n; ++i) L[i] += b[i] / nc; }
  var best = -1, bx = 0, by = 0, tot = 0, k = 0, h = 128;
  for (var yy = 0; yy + 16 <= H; yy += 16) for (var xx = 0; xx + 16 <= W; xx += 16) {
    var s = 0; for (var y = yy; y < yy + 16; y += 2) for (var x = xx; x < xx + 16; x += 2) s += L[y * W + x];
    if (s > best) { best = s; bx = xx + 8; by = yy + 8; }
  }
  for (var y2 = Math.max(0, by - h); y2 < Math.min(H, by + h); ++y2)
    for (var x2 = Math.max(0, bx - h); x2 < Math.min(W, bx + h); ++x2) if (L[y2 * W + x2] > thr) ++k;
  for (var j = 0; j < n; ++j) if (L[j] > thr) ++tot;
  return { radio_px: +Math.sqrt(k / Math.PI).toFixed(1), pix_total: tot, centro: [bx, by], umbral: thr };
}

// Capa de estrellas con el MISMO estirado que la starless: original lineal = starless + estrellas (SXT lineal es una suma
// exacta), se le repite el estirado registrado y se separa con screenStarsExtract. Las estrellas quedan con el mismo
// brillo relativo que tendrían en la imagen estirada entera. En galaxia grande (7 nov 2026) starStretch amount 2 dejó 269 estrellas
// detectables en la final frente a 13 721 con este método (Opus v7).
function estirarEstrellasExtraer(starlessLinId, starsLinId, starlessStId, o) {
  o = o || {};
  var rec = ES_OPS[starlessStId];
  if (!rec) throw new Error("no hay registro del estirado de " + starlessStId + " (sólo con el modo al fallo)");
  if (typeof screenStarsExtract !== "function" && typeof PICOPILOT_GUIA === "string")
    try { eval.call(null, File.readTextFile(PICOPILOT_GUIA + "/herramientas/realces.js")); } catch (e) { }
  if (typeof screenStarsExtract !== "function") throw new Error("screenStarsExtract no está cargado (herramientas/realces.js)");
  var stv = View.viewById(starsLinId);
  if (!stv || stv.isNull) throw new Error("No existe la vista " + starsLinId);
  if (esMedian(stv) > 0.05) throw new Error("la capa de estrellas parece ya estirada");
  var orig = esCopy(starlessLinId, "esTmpConEstrellas");
  var P = new PixelMath;
  P.expression = "$T + " + starsLinId; P.useSingleExpression = true; P.createNewImage = false;
  P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1;
  if (!P.executeOn(orig.mainView)) { orig.forceClose(); throw new Error("suma starless + estrellas falló"); }
  var r;
  try {
    esReplay(orig.mainView, rec);
    r = screenStarsExtract(orig.mainView.id, starlessStId, { newId: o.nuevaVista || (starsLinId + "_st") });
  } finally { orig.forceClose(); }
  var w = ImageWindow.windowById(r.created), v = w.mainView, sat = o.saturacion || 1;
  var slw = ImageWindow.windowById(starlessStId);
  if (!slw.isNull && slw.hasAstrometricSolution) w.copyAstrometricSolution(slw);
  w.show();
  if (sat > 1 && v.image.isColor) {   // misma saturación por tono que starStretch
    var CS = new ColorSaturation;
    CS.HS = [[0.0, 0.40 * sat], [0.5, 0.70 * sat], [1.0, 0.40 * sat]];
    CS.HSt = esK(ColorSaturation, "AkimaSubsplines");
    CS.hueShift = 0;
    if (!CS.executeOn(v)) throw new Error("Saturación de la capa de estrellas falló");
  }
  var im = v.image, W = im.width, H = im.height, n = W * H, R = new Rect(0, 0, W, H), buf = new Float32Array(n);
  var st = [], mx = 0, med = [], uno = 0, L = new Float32Array(n);
  for (var c = 0; c < im.numberOfChannels; ++c) {
    im.getSamples(buf, R, c);
    for (var k = 0; k < n; ++k) {
      var x = buf[k]; L[k] += x / im.numberOfChannels;
      if (x > mx) mx = x; if (x >= 0.999) ++uno; if (c === 0 && x > 0.005 && (k % 5) === 0) st.push(x);
    }
    im.selectedChannel = c; med.push(+im.median().toPrecision(3));
  }
  im.resetSelections();
  var pe = 0; for (var q = 0; q < n; ++q) if (L[q] > 0.02) ++pe;
  st.sort(function (a, b) { return a - b; });
  var p90 = st.length ? st[Math.floor(0.9 * (st.length - 1))] : 0, pePct = 100 * pe / n, noCumpleE = [];
  if (pePct > 10) noCumpleE.push("CAPA DE ESTRELLAS HINCHADA: el " + pePct.toFixed(1) + " % de los píxeles pasa de 0,02 (límite 10 %). " +
    "Con el estirado de una nebulosa débil, 'extraer' hincha las estrellas (nebulosa oscura, 7 nov 2026: 25 %): repetir estirarCapas SIN " +
    "estrellas \"extraer\" (starStretch). 'extraer' es para galaxias");
  return {
    vista: v.id, original: starsLinId, metodo: "mismo estirado que la starless + screenStarsExtract", saturacion: sat, no_cumple: noCumpleE,
    p90_estrellas: +p90.toFixed(3), pix_estrella_pct: +(100 * pe / n).toFixed(2), mediana_fondo: med, maximo: +mx.toFixed(4),
    control: {
      medido: { fondo_a_cero: med.every(function (m) { return m < 0.01; }), nucleos_a_1_pct: +(100 * uno / (3 * n)).toFixed(4) },
      revisar_a_ojo: ["halos o agujeros alrededor de las estrellas brillantes (si los hay, los estirados no coinciden)",
                      "núcleos de galaxias en la capa de estrellas (SXT a veces se los lleva: devolverlos a la starless)"],
      nota: "pix_estrella_pct = % de píxeles de la capa con luminancia > 0,02 (orientativo, sin calibrar; muy por debajo del 0,5 % en un campo con muchas estrellas = capa débil). " +
            "Los núcleos a 1 se contienen en el Paso 8. Lo de revisar_a_ojo no lo mide esta función."
    }
  };
}

// Valores por tipo de objeto (o.tipo); lo que se pase explícito manda. Galaxia: galaxia grande OSC (Rafael, 7 nov 2026): con cielo
// 0,10 el fondo quedaba gris y las estrellas (amount 2, saturación 1) diminutas y pálidas; con estos, "mucho mejor ambas".
// estrellas "extraer": capa de estrellas con el mismo estirado (estirarEstrellasExtraer); amount sólo si hay que volver a
// starStretch. Comparación Qwen/Opus en una galaxia grande (7 nov 2026): con starStretch la final se quedó casi sin estrellas.
// nebulosa_oscura (polvo, LDN/LBN/vdB, sin emisión): cielo 0,12 y algo más de ruido permitido para separar el polvo del fondo.
// Con 0,15 el fondo quedó gris y sin zonas oscuras (7 nov 2026: cielo de la final 0,17 frente a 0,145 de la versión de
// referencia, mismo p90); el polvo lo sube el resto de pasadas, que no mueven el cielo.
// (nebulosa oscura, 7 nov 2026: con cielo 0,10 el cuerpo quedaba 0,009 sobre el cielo en la final; Opus con MAS a 0,17 + curvas con
// máscara, 0,051). Sin calibrar con más casos. Estrellas con starStretch, nunca "extraer".
var ES_TIPOS = {
  galaxia: { cielo: 0.07, ruidoMax: 0.12, saturacion: 1.3, estrellas: "extraer" },
  nebulosa_oscura: { cielo: 0.12, ruidoMax: 0.20 }   // estrellas con arcsinh k 3000 (con starStretch amount 2, aporte 0,7–0,8 %)
};

// Las dos capas del Paso 1 en una llamada.
//   var r = estirarCapas("Starless", "Stars", { cielo: 0.10 });   // { starless: {...}, estrellas: {...} }
//   var r = estirarCapas("Starless", "Stars", { tipo: "galaxia" });   // cielo 0,07, ruidoMax 0,12, estrellas "extraer", saturación 1,3
//   var r = estirarCapas("Starless", "Stars", { estrellas: "extraer" });   // estrellas con el mismo estirado que la starless
function estirarCapas(starlessId, starsId, o) {
  if (starlessId && typeof starlessId === "object") starlessId = (starlessId.id !== undefined) ? starlessId.id : (typeof starlessId.vista === "string" ? starlessId.vista : starlessId);   // también vale la View o el resultado de otra función ({ vista: ... })
  if (starsId && typeof starsId === "object") starsId = (starsId.id !== undefined) ? starsId.id : (typeof starsId.vista === "string" ? starsId.vista : starsId);   // también vale la View o el resultado de otra función ({ vista: ... })
  o = o || {};
  var t = ES_TIPOS[String(o.tipo || "").toLowerCase()];
  if (t) { var o2 = {}; for (var k in o) o2[k] = o[k]; for (var k2 in t) if (o2[k2] === undefined) o2[k2] = t[k2]; o = o2; }
  var r = { starless: estirarStarless(starlessId, { cielo: o.cielo, ruidoMax: o.ruidoMax, modo: o.modo, fondo: o.fondo, canal: o.canal, nuevaVista: o.nuevaStarless, fase3: o.fase3 }) };
  if (starsId) {
    var aviso = null;
    if (o.estrellas === "extraer") {
      try { r.estrellas = estirarEstrellasExtraer(starlessId, starsId, r.starless.vista, { nuevaVista: o.nuevasEstrellas, saturacion: o.saturacion }); }
      catch (e) { aviso = "no se pudo sacar la capa de estrellas con el mismo estirado (" + e.message + "): se usa starStretch"; }
    }
    if (!r.estrellas) {
      r.estrellas = estirarEstrellas(starsId, { nuevaVista: o.nuevasEstrellas, metodo: o.metodoEstrellas, k: o.k, amount: o.amount, saturacion: o.saturacion });
      if (aviso) r.estrellas.aviso = aviso;
    }
    if (r.estrellas.no_cumple && r.estrellas.no_cumple.length)
      r.no_cumple = (r.starless.no_cumple || []).concat(r.estrellas.no_cumple);
  }
  if (t) r.tipo = { nombre: String(o.tipo), valores: t };
  return r;
}
