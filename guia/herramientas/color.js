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
//   guia        carpeta de la guía, si procesos.js no está cargado y no hay PICOPILOT_GUIA.
//   fondoAuto   false (por defecto): referencia de fondo = toda la imagen, como SPCC. true = el bloque de 512 px más
//               oscuro (EXPERIMENTAL: en IC 1396, nov 2026, empeoró el cielo de 1 a 17 sigmas; no usar sin comprobar).
// Comprueba antes: que exista la solución astrométrica (si no, Paso 8: blindSolve) y que la imagen sea lineal.
// Mide antes y después el cielo por canal en las zonas más oscuras y su diferencia en sigmas del ruido: en lineal,
// una diferencia de 1 % ya sale como dominante clara tras estirar (IC 1396, nov 2026: 1,6 % en lineal → 19 % estirada).

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
  if (viewId && typeof viewId === "object" && viewId.id !== undefined) viewId = viewId.id;   // también vale la View
  o = o || {};
  if (typeof pxSPCC !== "function") {
    var g = o.guia || (typeof PICOPILOT_GUIA === "string" ? PICOPILOT_GUIA : null);
    if (!g) throw new Error("Falta herramientas/procesos.js: cárgalo con eval antes de color.js");
    eval.call(null, File.readTextFile(g + "/herramientas/procesos.js"));
  }
  var src = ImageWindow.windowById(viewId);
  if (src.isNull) throw new Error("No existe la vista " + viewId);
  if (src.mainView.image.numberOfChannels !== 3) throw new Error("SPCC necesita una imagen RGB");
  if (!src.hasAstrometricSolution)
    throw new Error("La imagen no tiene solución astrométrica: SPCC fallaría. Hacer antes el Paso 8 (blindSolve)");
  var sim = src.mainView.image;
  sim.resetSelections();
  var med0 = sim.median();
  if (med0 > 0.05) throw new Error("La imagen parece estirada (mediana " + med0.toFixed(4) + "): SPCC sólo sobre datos lineales");

  var base = o.nuevaVista || (viewId + "_spcc"), id = base;
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
  return {
    vista: id, original: viewId, segundos: +seg.toFixed(1),
    filtros: { r: P.redFilterName, g: P.greenFilterName, b: P.blueFilterName, qe: P.deviceQECurveName,
               banda_estrecha: P.narrowbandMode, referencia_blanco: P.whiteReferenceName,
               neutralizar_fondo: P.neutralizeBackground,
               referencia_fondo: ref ? ("bloque más oscuro de " + ref.lado + " px en x " + ref.x + ", y " + ref.y) : (opts.backgroundReferenceViewId || "toda la imagen") },
    factores_balance_blancos: wb,
    cielo_antes: antes, cielo_despues: despues,
    no_cumple: visibles ? ["CIELO NO NEUTRO tras SPCC: el " + despues.canal_alto + " queda " + despues.diferencia_en_sigmas +
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
