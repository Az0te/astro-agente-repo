// color.js — Calibración de color con SPCC (Paso 12 lineal) en una sola llamada, con sus comprobaciones y medidas.
// PJSR, ECMAScript 5. Necesita herramientas/procesos.js (pxSPCC); si no está cargado lo carga de la guía.
//
// Uso (en el nivel superior del script):
//   eval(File.readTextFile("<ruta de guia>/herramientas/procesos.js"));
//   eval(File.readTextFile("<ruta de guia>/herramientas/color.js"));
//   var r = calibrarColor("MasterLight", { nuevaVista: "MasterLight_spcc", spcc: { /* filtros y QE del perfil */ } });
//   JSON.stringify(r);
//
// Opciones:
//   spcc        opciones de pxSPCC tal como las da el perfil (r, g, b, qe, narrowband...). Vacío = OSC sin filtro.
//   nuevaVista  copia donde se calibra (por defecto <vista>_spcc). La original no se toca.
//   guia        carpeta de la guía, si procesos.js no está cargado y no hay PIASTROPILOT_GUIA.
//   fondoAuto   false (por defecto): referencia de fondo = toda la imagen, como SPCC. true = el bloque de 512 px más
//               oscuro (EXPERIMENTAL: en una nebulosa dual band, nov 2026, empeoró el cielo de 1 a 17 sigmas; no usar sin comprobar).
// Comprueba antes: que exista la solución astrométrica (si no, Paso 8: blindSolve) y que la imagen sea lineal.
// Mide antes y después el cielo por canal en las zonas más oscuras y su diferencia en sigmas del ruido: en lineal,
// una diferencia de 1 % ya sale como dominante clara tras estirar (nebulosa dual band, nov 2026: 1,6 % en lineal → 19 % estirada).

function ccSky(view) {
  var im = view.image, W = im.width, H = im.height, S = 64, n = W * H, R = new Rect(0, 0, W, H);
  var ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (var c = 0; c < 3; ++c) im.getSamples(ch[c], R, c);
  var cells = [];
  for (var y0 = 0; y0 + S <= H; y0 += S)
    for (var x0 = 0; x0 + S <= W; x0 += S) {
      var v = [];
      for (var y = y0; y < y0 + S; y += 2) for (var x = x0; x < x0 + S; x += 2) { var k = y * W + x; v.push(ch[0][k] + ch[1][k] + ch[2][k]); }
      v.sort(function (a, b) { return a - b; });
      cells.push({ x: x0, y: y0, m: v[v.length >> 1] });
    }
  cells = cells.filter(function (c0) { return c0.m > 1e-6; });   // fuera bordes negros del registro o recorte
  cells.sort(function (a, b) { return a.m - b.m; });
  var kc = Math.max(5, Math.floor(cells.length * 0.10)), med = [], noise = [];
  for (var c2 = 0; c2 < 3; ++c2) {
    var vals = [], dif = [];
    for (var q = 0; q < kc; ++q) {
      var cc = cells[q];
      for (var yy = cc.y; yy < cc.y + S; yy += 2)
        for (var xx = cc.x; xx < cc.x + S - 1; xx += 2) {
          var i = yy * W + xx;
          vals.push(ch[c2][i]); dif.push(Math.abs(ch[c2][i + 1] - ch[c2][i]));
        }
    }
    vals.sort(function (a, b) { return a - b; }); dif.sort(function (a, b) { return a - b; });
    med.push(vals[vals.length >> 1]);
    noise.push(dif[dif.length >> 1] / (0.6745 * Math.SQRT2));
  }
  var sig = (noise[0] + noise[1] + noise[2]) / 3, mean = (med[0] + med[1] + med[2]) / 3;
  var spread = Math.max.apply(null, med) - Math.min.apply(null, med);
  var nombres = ["rojo", "verde", "azul"];
  return { cielo_por_canal: med.map(function (m) { return +m.toPrecision(4); }),
           ruido: +sig.toPrecision(3),
           diferencia_en_sigmas: +(spread / sig).toFixed(2),
           diferencia_pct: +(100 * spread / mean).toFixed(2),
           canal_alto: nombres[med.indexOf(Math.max.apply(null, med))] };
}

// Referencia de fondo automática (EXPERIMENTAL, desactivada por defecto): el bloque de 512 px más oscuro. Sin
// referencia, SPCC neutraliza con el "fondo" de toda la imagen, que en una nebulosa que llena el campo incluye la
// propia nebulosa roja, y deja azuladas las zonas realmente oscuras.
function ccDarkestBlock(view, S) {
  var im = view.image, W = im.width, H = im.height, best = null, buf = new Float32Array(S * S), sum = new Float32Array(S * S);
  var step = S >> 1;
  for (var y0 = 0; y0 + S <= H; y0 += step)
    for (var x0 = 0; x0 + S <= W; x0 += step) {
      var R = new Rect(x0, y0, x0 + S, y0 + S); sum.fill(0);
      for (var c = 0; c < 3; ++c) { im.getSamples(buf, R, c); for (var i = 0; i < buf.length; i += 16) sum[i] += buf[i]; }
      var v = []; for (var j = 0; j < sum.length; j += 16) v.push(sum[j]);
      v.sort(function (a, b) { return a - b; });
      var m = v[v.length >> 1];
      if (!best || m < best.m) best = { x: x0, y: y0, m: m };
    }
  return best;
}

function ccMakeReference(view, S) {
  var b = ccDarkestBlock(view, S), im = view.image;
  im.resetSelections();
  var id = "ccFondoRef";
  var old = ImageWindow.windowById(id); if (!old.isNull) old.forceClose();
  var w = new ImageWindow(S, S, 3, 32, true, true, id);
  w.mainView.beginProcess(); w.mainView.image.assign(im, new Rect(b.x, b.y, b.x + S, b.y + S)); w.mainView.endProcess();
  return { window: w, x: b.x, y: b.y, lado: S };
}
function ccProperty(view, id) {
  try { var p = view.propertyValue(id); if (p !== undefined && p !== null) return p.toString ? p.toString() : p; } catch (e) { }
  return null;
}

function calibrarColor(viewId, o) {
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);   // también vale la View o el resultado de otra función ({ vista: ... })
  o = o || {};
  if (typeof pxSPCC !== "function") {
    var g = o.guia || (typeof PIASTROPILOT_GUIA === "string" ? PIASTROPILOT_GUIA : null);
    if (!g) throw new Error("Falta herramientas/procesos.js: cárgalo con eval antes de color.js");
    eval.call(null, File.readTextFile(g + "/herramientas/procesos.js"));
  }
  var src = ImageWindow.windowById(viewId);
  if (src.isNull) throw new Error("No existe la vista " + viewId);
  if (src.mainView.image.numberOfChannels !== 3)
    throw new Error("SPCC necesita una imagen RGB. Las rayas desmezcladas (Hα, OIII, SII, Hβ) son mono: no llevan SPCC; " +
                    "su escala entre filtros la iguala combinarMismoCanal (LinearFit) y el color se decide en la paleta (Paso 2 no lineal)");
  // Master dual band en color sin modo banda estrecha: SPCC con curvas de banda ancha rompe la desmezcla (6 nov 2026,
  // Qwen lo aplicó a HaO3, S2O3 y S2Hb con "banda_estrecha: no").
  var filt = ""; src.keywords.forEach(function (k) { if (k.name === "FILTER") filt = String(k.value).toUpperCase(); });
  var esDual = /DUAL|HAO3|HA.?O3|S2.?O3|S2.?HB|SII.?OIII|L-?EXTREME|L-?ENHANCE|L-?ULTIMATE|ALP-?T/.test(filt.replace(/'/g, ""));
  if (esDual && !(o.spcc && o.spcc.narrowband) && !o.forzarBandaAncha)
    throw new Error("El master es dual band (FILTER " + filt.replace(/'/g, "").trim() + "): no se calibra con SPCC de banda ancha. " +
                    "Desmezclar antes (Paso 7, desmezclarDualBand); el SPCC va sólo sobre el RGB");
  if (!src.hasAstrometricSolution)
    throw new Error("La imagen no tiene solución astrométrica: SPCC fallaría. Hacer antes el Paso 8 (blindSolve)");
  var sim = src.mainView.image;
  sim.resetSelections();
  var med0 = sim.median();
  if (med0 > 0.05) throw new Error("La imagen parece estirada (mediana " + med0.toFixed(4) + "): SPCC sólo sobre datos lineales");

  var base = (typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_spcc"), id = base;
  for (var n = 2; !ImageWindow.windowById(id).isNull; ++n) id = base + "_" + n;
  var w = new ImageWindow(sim.width, sim.height, 3, 32, true, true, id);
  w.mainView.beginProcess(); w.mainView.image.assign(sim); w.mainView.endProcess();
  w.copyAstrometricSolution(src);
  w.show();
  var v = w.mainView, antes = ccSky(v), t0 = Date.now();

  var opts = {}, sp = o.spcc || {}, ref = null;
  for (var k in sp) opts[k] = sp[k];
  if (o.fondoAuto === true && !opts.backgroundReferenceViewId) {
    ref = ccMakeReference(v, o.ladoFondo || 512);
    opts.backgroundReferenceViewId = ref.window.mainView.id;
  }
  var P = pxSPCC(opts), ok = false;
  try { ok = P.executeOn(v); } finally { if (ref) ref.window.forceClose(); }
  if (!ok) throw new Error("SPCC falló (mira la consola: estrellas insuficientes, catálogo o filtros)");
  var seg = (Date.now() - t0) / 1000, despues = ccSky(v);

  var wb = ccProperty(v, "PCL:SPCC:WhiteBalanceFactors");
  var visibles = despues.diferencia_en_sigmas > 0.5;
  // 12 nov 2026 (Tarántula, LMC): con el campo lleno de nebulosa, las celdas «más oscuras» siguen siendo emisión (Hα roja)
  // y el «cielo no neutro» es señal real: se avisa, sin no_cumple. Misma medida que el estirado (esCeldasDebiles, > 60 %).
  var campoLleno = null;
  if (visibles && typeof esCeldasDebiles === "function") {
    try { campoLleno = esCeldasDebiles(v).fraccion_con_senal; } catch (e) { campoLleno = null; }
  }
  var lleno = campoLleno !== null && campoLleno > 0.6;
  return {
    vista: id, original: viewId, segundos: +seg.toFixed(1),
    filtros: { r: P.redFilterName, g: P.greenFilterName, b: P.blueFilterName, qe: P.deviceQECurveName,
               banda_estrecha: P.narrowbandMode, referencia_blanco: P.whiteReferenceName,
               neutralizar_fondo: P.neutralizeBackground,
               referencia_fondo: ref ? ("bloque más oscuro de " + ref.lado + " px en x " + ref.x + ", y " + ref.y) : (opts.backgroundReferenceViewId || "toda la imagen") },
    factores_balance_blancos: wb,
    cielo_antes: antes, cielo_despues: despues,
    campo_con_senal_pct: campoLleno !== null ? +(100 * campoLleno).toFixed(1) : undefined,
    aviso: lleno ? "El " + (100 * campoLleno).toFixed(0) + " % del campo tiene señal sobre el cielo: el «cielo» medido (" +
                   despues.canal_alto + " " + despues.diferencia_en_sigmas + " sigmas por encima) es probablemente emisión del objeto. " +
                   "No neutralizar sin un trozo de cielo limpio (neutralizarCielo con rect); si sólo se usan las estrellas de esta RGB, da igual" : undefined,
    no_cumple: (visibles && !lleno) ? ["CIELO NO NEUTRO tras SPCC: el " + despues.canal_alto + " queda " + despues.diferencia_en_sigmas +
                           " sigmas por encima (" + despues.diferencia_pct + " %); al estirar saldrá como dominante. Revisar " +
                           "gradiente, flats o la referencia de fondo antes de seguir"] : [],
    control: {
      medido: {
        con_solucion_astrometrica: true,
        lineal: true,
        spcc_aplicado: true,
        cielo_neutro: !visibles
      },
      revisar_a_ojo: ["color de las estrellas: variado (azules, blancas, amarillas, rojizas), no todas iguales",
                      "dominante en el objeto o en el fondo tras un estirado de prueba (STF)"],
      nota: "cielo_despues.diferencia_en_sigmas compara el cielo de los tres canales con el ruido: por debajo de 0,5 no se " +
            "notará al estirar. factores_balance_blancos los deja SPCC en la vista (null si esta versión no los guarda). " +
            "Lo de revisar_a_ojo no lo mide esta función."
    }
  };
}

// Neutralización fina del cielo (BackgroundNeutralization aditiva) sobre una imagen RGB LINEAL, en una copia.
// Para cuando SPCC deja el cielo ligeramente descompensado (diferencias < 1 % en lineal que salen como dominante del
// 5–20 % al estirar: nebulosa dual band y nebulosa oscura, nov 2026). Mide el cielo por canal en las mismas zonas que el control del
// estirado (el 10 % de celdas de 64 px más oscuras) o en el rectángulo que se le dé, y SUMA a cada canal lo que le
// falta para igualar al canal de cielo más alto: no resta nada (no recorta sombras) y no toca el balance de blancos de
// SPCC en las estrellas ni en el objeto más que ese desplazamiento constante, que es lo que hace BackgroundNeutralization.
// Uso:
//   var r = neutralizarCielo("Starless_dn", { nuevaVista: "Starless_bn" });
// Opciones:
//   nuevaVista  copia donde se corrige (por defecto <vista>_bn). La original no se toca.
//   rect        [x0, y0, x1, y1] zona de cielo limpio de referencia (por defecto, las celdas más oscuras).
//   pasadas     máximo de pasadas (por defecto 2: la segunda corrige el cambio de celdas tras la primera).
function ncCieloCanales(im, rect) {
  if (rect) {
    var R = new Rect(Math.max(0, rect[0]), Math.max(0, rect[1]), Math.min(im.width, rect[2]), Math.min(im.height, rect[3]));
    if (R.width < 8 || R.height < 8) throw new Error("rect demasiado pequeño o fuera de la imagen");
    var med = [];
    for (var c = 0; c < 3; ++c) { im.resetSelections(); im.selectedRect = R; im.selectedChannel = c; med.push(im.median()); }
    im.resetSelections();
    return med;
  }
  var W = im.width, H = im.height, S = 64, cells = [], blk = new Float32Array(S * S), lum = new Float32Array(S * S);
  for (var y0 = 0; y0 + S <= H; y0 += S)
    for (var x0 = 0; x0 + S <= W; x0 += S) {
      var Rc = new Rect(x0, y0, x0 + S, y0 + S); lum.fill(0);
      for (var c1 = 0; c1 < 3; ++c1) { im.getSamples(blk, Rc, c1); for (var i = 0; i < blk.length; i += 4) lum[i] += blk[i]; }
      var v = []; for (var j = 0; j < lum.length; j += 4) v.push(lum[j]);
      v.sort(function (a, b) { return a - b; });
      cells.push({ r: Rc, m: v[v.length >> 1] });
    }
  cells = cells.filter(function (c0) { return c0.m > 1e-6; });
  cells.sort(function (a, b) { return a.m - b.m; });
  var k = Math.max(5, Math.floor(cells.length * 0.10)), out = [];
  for (var ch = 0; ch < 3; ++ch) {
    var vals = [];
    for (var q = 0; q < k; ++q) { im.getSamples(blk, cells[q].r, ch); for (var t = 0; t < blk.length; t += 4) vals.push(blk[t]); }
    vals.sort(function (a, b) { return a - b; });
    out.push(vals[vals.length >> 1]);
  }
  return out;
}

function neutralizarCielo(viewId, o) {
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);
  o = o || {};
  var src = ImageWindow.windowById(viewId);
  if (src.isNull) throw new Error("No existe la vista " + viewId);
  var sim = src.mainView.image;
  if (sim.numberOfChannels !== 3) throw new Error("neutralizarCielo necesita una imagen RGB");
  sim.resetSelections();
  if (sim.median() > 0.05) throw new Error("La imagen parece estirada: la neutralización del cielo se hace en LINEAL");
  var base = (typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_bn"), id = base;
  for (var n = 2; !ImageWindow.windowById(id).isNull; ++n) id = base + "_" + n;
  var w = new ImageWindow(sim.width, sim.height, 3, 32, true, true, id);
  w.mainView.beginProcess(); w.mainView.image.assign(sim); w.mainView.endProcess();
  if (src.hasAstrometricSolution) w.copyAstrometricSolution(src);
  w.show();
  var v = w.mainView, im = v.image, nombres = ["rojo", "verde", "azul"];
  var pct = function (m) { var mean = (m[0] + m[1] + m[2]) / 3; return mean > 0 ? 100 * (Math.max.apply(null, m) - Math.min.apply(null, m)) / mean : 0; };
  var antes = ncCieloCanales(im, o.rect), cielo = antes, sumas = [0, 0, 0], pasadas = 0;
  for (var p = 0; p < (o.pasadas || 2) && pct(cielo) > 0.05; ++p) {
    var top = Math.max.apply(null, cielo), d = cielo.map(function (m) { return top - m; });
    var PM = new PixelMath;
    PM.useSingleExpression = false;
    PM.expression = "$T+" + d[0].toExponential(6);
    PM.expression1 = "$T+" + d[1].toExponential(6);
    PM.expression2 = "$T+" + d[2].toExponential(6);
    PM.createNewImage = false; PM.rescale = false; PM.truncate = true; PM.truncateLower = 0; PM.truncateUpper = 1;
    if (!PM.executeOn(v)) throw new Error("PixelMath falló al neutralizar el cielo");
    for (var c = 0; c < 3; ++c) sumas[c] += d[c];
    cielo = ncCieloCanales(im, o.rect); ++pasadas;
  }
  var dAntes = pct(antes), dDespues = pct(cielo);
  return {
    vista: id, original: viewId, pasadas: pasadas,
    referencia: o.rect ? ("rect " + JSON.stringify(o.rect)) : "10 % de celdas de 64 px más oscuras (las mismas que mide el estirado)",
    cielo_antes: antes.map(function (m) { return +m.toPrecision(5); }),
    cielo_despues: cielo.map(function (m) { return +m.toPrecision(5); }),
    canal_alto_antes: nombres[antes.indexOf(Math.max.apply(null, antes))],
    diferencia_lineal_pct_antes: +dAntes.toFixed(3), diferencia_lineal_pct_despues: +dDespues.toFixed(3),
    sumado_por_canal: sumas.map(function (s) { return +s.toPrecision(4); }),
    no_cumple: dDespues > 0.1 ? ["el cielo sigue " + dDespues.toFixed(2) + " % descompensado en lineal: revisar la referencia (rect de cielo limpio)"] : [],
    control: {
      medido: { lineal: true, cielo_igualado: dDespues <= 0.1 },
      revisar_a_ojo: ["el objeto no cambia de color (sólo se desplaza el fondo)", "estirado de prueba: cielo gris neutro"],
      nota: "Desplazamiento aditivo por canal, como BackgroundNeutralization. Va después de SPCC (y vale también sobre la " +
            "starless lineal, sin rehacer BXT ni SXT). Si el cielo de referencia contiene nebulosa o polvo, pasa un rect de " +
            "cielo limpio: si no, se neutraliza el color del polvo."
    }
  };
}
