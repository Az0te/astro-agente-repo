// boost.js — Saturación "empujando hasta el rechazo" (Paso 5 no lineal) en una sola llamada. PJSR, ECMAScript 5.
//
// Uso (en el nivel superior del script):
//   eval(File.readTextFile("<ruta de guia>/herramientas/boost.js"));
//   var r = saturarAlFallo("Starless_st", { tipo: "nebulosa", nuevaVista: "Starless_sat" });
//   JSON.stringify(r);
//
// Método de la ficha (aescaffre): curva S de saturación con el punto medio en 0,58 → 0,63 → 0,68 → 0,73 → 0,78, cada
// prueba desde la imagen de partida; se queda la última que no falla. Fallo, medido en cada prueba:
//   - canales > 0,98: aumentan más de un 0,01 % de los píxeles respecto a la partida
//   - fondo teñido: la dominante del cielo (zonas más oscuras) pasa de 8 % o sube más de 4 puntos (provisional: con 5 %
//     galaxia grande, con el cielo a 3 %, no pasaba de 0,58)
//   - ruido de color amplificado: el ruido de croma del cielo crece más de 1,5 veces
// Rangos esperados: nebulosas 0,70–0,78; galaxias 0,63–0,70. Opciones: tipo, pasos (lista de puntos medios),
// nuevaVista. No toca la original. Si ni la primera pasa, no satura y lo dice ("no aplicar es un resultado válido").

function bsK(C, name) {
  if (C[name] !== undefined) return C[name];
  if (C.prototype && C.prototype[name] !== undefined) return C.prototype[name];
  throw new Error("Constante no encontrada: " + name);
}

// Cielo (10 % de celdas de 64 px más oscuras): dominante por canal y ruido de croma (MAD de R−G y B−G respecto a la
// mediana de la celda).
function bsSky(view) {
  var im = view.image, W = im.width, H = im.height, n = W * H, R = new Rect(0, 0, W, H), S = 64;
  var ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (var c = 0; c < 3; ++c) im.getSamples(ch[c], R, c);
  var cells = [];
  for (var y0 = 0; y0 + S <= H; y0 += S)
    for (var x0 = 0; x0 + S <= W; x0 += S) {
      var v = [];
      for (var y = y0; y < y0 + S; y += 4) for (var x = x0; x < x0 + S; x += 4) { var k = y * W + x; v.push(ch[0][k] + ch[1][k] + ch[2][k]); }
      v.sort(function (a, b) { return a - b; });
      cells.push({ x: x0, y: y0, m: v[v.length >> 1] });
    }
  cells = cells.filter(function (c0) { return c0.m > 1e-6; });   // fuera bordes negros del registro o recorte
  cells.sort(function (a, b) { return a.m - b.m; });
  var kc = Math.max(5, Math.floor(cells.length * 0.10)), vals = [[], [], []], dev = [];
  for (var q = 0; q < kc; ++q) {
    var cc = cells[q], rg = [], bg = [];
    for (var yy = cc.y; yy < cc.y + S; yy += 2)
      for (var xx = cc.x; xx < cc.x + S; xx += 2) {
        var i = yy * W + xx;
        for (var c2 = 0; c2 < 3; ++c2) vals[c2].push(ch[c2][i]);
        rg.push(ch[0][i] - ch[1][i]); bg.push(ch[2][i] - ch[1][i]);
      }
    rg.sort(function (a, b) { return a - b; }); bg.sort(function (a, b) { return a - b; });
    var mr = rg[rg.length >> 1], mb = bg[bg.length >> 1];
    for (var j = 0; j < rg.length; ++j) dev.push(Math.abs(rg[j] - mr) + Math.abs(bg[j] - mb));
  }
  var med = vals.map(function (a) { a.sort(function (p, q) { return p - q; }); return a[a.length >> 1]; });
  dev.sort(function (a, b) { return a - b; });
  var mean = (med[0] + med[1] + med[2]) / 3, hi = 0;
  for (var c3 = 0; c3 < 3; ++c3) for (var t = 0; t < n; t += 3) if (ch[c3][t] > 0.98) ++hi;
  return { dominante_pct: +(100 * (Math.max.apply(null, med) - Math.min.apply(null, med)) / mean).toFixed(1),
           ruido_croma: dev[dev.length >> 1], sobre_098_pct: 100 * hi / n,   // 3 canales × n/3 muestras
           cielo: mean, cielo_rgb: med };
}

function bsCopy(view, id) {
  var im = view.image; im.resetSelections();
  var old = ImageWindow.windowById(id); if (!old.isNull) old.forceClose();
  var w = new ImageWindow(im.width, im.height, im.numberOfChannels, 32, true, im.isColor, id);
  w.mainView.beginProcess(); w.mainView.image.assign(im); w.mainView.endProcess();
  return w;
}

// Máscara de luminancia (8 nov 2026: «enfatiza el color de la nebulosa»): protege el cielo para que la saturación se
// lleve a la nebulosa sin teñir el fondo. 0 en el cielo (mediana − 1,5·σ de la luminancia), 1 en lo más brillante, raíz
// para suavizar la transición.
function bsMascara(view) {
  var id = "bsMascaraLum";
  var old = ImageWindow.windowById(id); if (!old.isNull) old.forceClose();
  // Si la anterior sigue abierta (puesta como máscara de otra vista no se cierra), PixelMath crearía «bsMascaraLum1» y
  // windowById(id) devolvería la vieja: se busca un id libre.
  for (var n = 1; !ImageWindow.windowById(id).isNull; ++n) id = "bsMascaraLum" + n;
  var P = new PixelMath;
  P.expression = "CIEL($T)"; P.useSingleExpression = true; P.createNewImage = true; P.newImageId = id;
  P.newImageColorSpace = (PixelMath.Gray !== undefined) ? PixelMath.Gray : PixelMath.prototype.Gray;
  P.newImageSampleFormat = (PixelMath.f32 !== undefined) ? PixelMath.f32 : PixelMath.prototype.f32;
  P.truncate = true;
  if (!P.executeOn(view)) throw new Error("Máscara de luminancia falló");
  var mw = ImageWindow.windowById(id), mi = mw.mainView.image;
  var med = mi.median(), sig = 1.4826 * mi.MAD(), a = Math.max(0, med - 1.5 * sig), b = Math.max(a + 1e-3, mi.maximum());
  // En dos pasos: con «pow(max(0, min(1, …)), 0.5)» PixelMath de 1.9.6 devuelve false (probado el 15 nov 2026: la nitidez
  // fallaba siempre en Lite). Primero el reescalado lineal (truncate lo deja en 0–1) y después la raíz.
  var Q = new PixelMath;
  Q.expression = "($T - " + a.toFixed(6) + ") / " + (b - a).toFixed(6); Q.useSingleExpression = true; Q.createNewImage = false;
  Q.truncate = true; Q.truncateLower = 0; Q.truncateUpper = 1;
  if (!Q.executeOn(mw.mainView)) throw new Error("Máscara de luminancia (reescalado) falló");
  var Q2 = new PixelMath;
  Q2.expression = "sqrt($T)"; Q2.useSingleExpression = true; Q2.createNewImage = false; Q2.truncate = true;
  if (!Q2.executeOn(mw.mainView)) throw new Error("Máscara de luminancia (raíz) falló");
  return mw;
}

function bsSaturate(view, mid, mascara) {
  if (mascara) { view.window.mask = mascara; view.window.maskVisible = false; view.window.maskInverted = false; view.window.maskEnabled = true; }
  var C = new CurvesTransformation;
  C.S = [[0, 0], [0.5, mid], [1, 1]];
  C.St = bsK(CurvesTransformation, "AkimaSubsplines");
  var ok = C.executeOn(view);
  if (mascara) view.window.removeMask();
  if (!ok) throw new Error("Curva de saturación falló (" + mid + ")");
}

// Color de la franja algo por encima del cielo (23 nov 2026, IC 405 con Qwen, pasada C1-d2): la variante «+ medios»
// dejaba el cielo neutro en el punto de anclaje (cielo_rgb 0,065/0,065/0,065) pero teñía de magenta el fondo débil justo
// por encima (R/G 1,12, B/G 1,12), y la saturación lo amplió. Medianas de R, G y B de los píxeles cuya luminancia está
// entre los percentiles 10 y 30 (muestreo cada 4 px), MENOS el cielo de cada canal: el color de la señal sobre el cielo.
// Con cocientes de valores absolutos el punto negro solo ya «teñía» (bajar el cielo de 0,10 a 0,05 subía R/G un 22 %
// en la pasada C1-d3 sin cambiar el color): restando el cielo, el punto negro deja el color igual (0,2 %) y la curva
// «+ medios» se ve (3–5 %). Devuelve R/G y B/G sobre el cielo y los absolutos.
function bsFranja(view, cielo, lo, hi) {
  var im = view.image, W = im.width, H = im.height, paso = 4, nc = im.numberOfChannels;
  if (nc < 3) return null;
  var fila = [new Float32Array(W), new Float32Array(W), new Float32Array(W)], R = [], G = [], B = [], L = [];
  for (var y = 0; y < H; y += paso) {
    for (var c = 0; c < 3; ++c) im.getSamples(fila[c], new Rect(0, y, W, y + 1), c);
    for (var x = 0; x < W; x += paso) { var r = fila[0][x], g = fila[1][x], bb = fila[2][x]; R.push(r); G.push(g); B.push(bb); L.push((r + g + bb) / 3); }
  }
  var orden = L.slice().sort(function (a, b) { return a - b; });
  var q1 = orden[Math.floor((lo || 0.10) * (orden.length - 1))], q3 = orden[Math.floor((hi || 0.30) * (orden.length - 1))];
  var r2 = [], g2 = [], b2 = [];
  for (var i = 0; i < L.length; ++i) if (L[i] >= q1 && L[i] <= q3) { r2.push(R[i]); g2.push(G[i]); b2.push(B[i]); }
  var med = function (a) { a.sort(function (p, q) { return p - q; }); return a.length ? a[a.length >> 1] : 0; };
  var mr = med(r2), mg = med(g2), mb = med(b2), c = (cielo && cielo.length === 3) ? cielo : [0, 0, 0];
  var dr = mr - c[0], dg = mg - c[1], db = mb - c[2];
  if (!(dg > 1e-4)) return null;   // la franja no se separa del cielo: no se puede juzgar el color
  return { R_G: +(dr / dg).toFixed(4), B_G: +(db / dg).toFixed(4), R_G_abs: +(mr / mg).toFixed(4), B_G_abs: +(mb / mg).toFixed(4),
           luminancia: [+q1.toFixed(4), +q3.toFixed(4)] };
}

// Paso 5 no lineal, nivel del fondo (15 nov 2026, IC 1396 con Qwen): el estirado deja el cielo en ~0,10 y los finales
// salían grises y planos (0,12) frente a la versión de Rafael (~0,02, con el 3 % del polvo más oscuro en negro). Punto
// negro por canal hasta cielo = t (y neutro), en copias; recomienda el más oscuro que no lleva a 0 más de o.cerosMax %.
//   fondoCandidatos("Final", { cielos: [0.08, 0.05, 0.03], cerosMax: 2, tinteMax: 0.03 })
// Cada variante «+ medios»/«+ rango» se descarta si aleja del neutro el color de la franja p10–p30 más de tinteMax o
// lo acerca al gris más de perdidaColorMax, y cualquiera si deja la señal sobre el cielo (mediana − cielo) por debajo
// del 85 % de la de entrada (se come la nebulosa).
function fondoCandidatos(viewId, o) {
  o = o || {};
  if (viewId && typeof viewId === "object") viewId = viewId.id || viewId.vista;
  var w0 = ImageWindow.windowById(viewId);
  if (w0.isNull) throw new Error("No existe la vista " + viewId);
  var v0 = w0.mainView;
  if (esMedian(v0) < 0.05) throw new Error("La imagen parece lineal: el nivel del fondo se ajusta después de estirar (y de recombinar).");
  var sd = esSkyDominance(v0), c0 = esCheck(v0);
  var s0 = sd.canales && sd.canales.length ? sd.canales : [c0.cielo];
  // Cielo final (24 nov 2026, Paleta5 de IC 1396: cielo 0,072 y objeto el doble de brillante que el Natural de Rafael,
  // con cielo 0,013): niveles 0,05–0,015 y hasta un 5 % de píxeles nuevos a 0 (a 0,035 ya se descartaba por un 2,08 %; el
  // Natural tiene un 6,6 % de píxeles con algún canal a 0, el polvo oscuro en negro). Si el cielo ya está en 0,035 o menos
  // (segunda llamada), no hace nada.
  var cerosMax = (o.cerosMax !== undefined) ? +o.cerosMax : 5, cielos = (o.cielos || [0.05, 0.035, 0.025, 0.015]).slice().sort(function (a, b) { return b - a; });
  var media00 = s0.reduce(function (a, b) { return a + b; }, 0) / s0.length;
  if (!o.cielos && media00 <= 0.035) return { vista: viewId, comparados: [], recomendado: null,
    motivo: "El cielo ya está oscuro (" + media00.toFixed(3) + " ≤ 0,035): no se toca. Sigue con " + viewId + ".", siguiente: "Sigue con " + viewId + "." };
  var cands = [];
  // Mediana de la imagen como medida de la nebulosa (en IC 1396 llena el campo).
  var m0 = esMedian(v0), variantes = [];
  // Tinte permitido en la franja p10–p30 frente a la entrada (la franja puede ser nebulosa con color propio: se compara
  // con la entrada, no con 1).
  var tinteMax = (o.tinteMax !== undefined) ? +o.tinteMax : 0.03, f0 = bsFranja(v0, s0), fPlano = {};
  var perdidaMax = (o.perdidaColorMax !== undefined) ? +o.perdidaColorMax : 0.10;
  // Señal sobre el cielo: la «+ medios» la lleva a max(la de entrada, o.senal = 0,10, la del Natural de Rafael) y no a la
  // mediana de entrada (con cielo 0,12 y mediana 0,20 devolvía la mediana a 0,20 con el cielo en 0,05: imagen lavada).
  var senalObj = (o.senal !== undefined) ? +o.senal : 0.10, senal0 = esMedian(v0) - media00;
  // «+ rango» (24 nov 2026, Natural de IC 1396 con Qwen frente a la de referencia de Rafael): la curva «+ medios» teñía la
  // franja débil (R/G de 2,3 a 1,6: la curva no lineal sube cada canal distinto), se quedó el punto negro solo y la imagen
  // salió comprimida y oscura (p90 0,16 y p98 0,21 frente a 0,27 y 0,37). «+ rango» es punto negro + punto blanco
  // lineal sobre el cielo, sin curva: el cielo queda en t, el p99 de la luminancia sube a o.blanco (0,40) con ganancia
  // ×1–×2 (o.gananciaMax) y, al ser lineal, no cambia el color de la franja; no debe quemar más de un 0,05 % nuevo.
  var blanco = (o.blanco !== undefined) ? +o.blanco : 0.40, rangoOn = o.rango !== false, gMax = (o.gananciaMax !== undefined) ? +o.gananciaMax : 2;
  cielos.forEach(function (t) { variantes.push([t, false]); variantes.push([t, true]); if (rangoOn) variantes.push([t, "rango"]); });
  variantes.forEach(function (vt) {
    var t = vt[0], rango = vt[1] === "rango", medios = vt[1] === true, gRango = null;
    var media0 = s0.reduce(function (a, b) { return a + b; }, 0) / s0.length;
    if (media0 <= t) return;   // un canal ya por debajo no se toca (bp 0)
    var bp = s0.map(function (s) { return Math.max(0, (s - t) / (1 - t)); });
    var w = esCopy(viewId, viewId + "_fondo" + String(t).replace(".", "") + (rango ? "r" : medios ? "m" : ""));
    var P = new PixelMath;
    var e = bp.map(function (b) { return "($T - " + b.toFixed(6) + ") / " + (1 - b).toFixed(6); });
    P.useSingleExpression = (e.length === 1); P.expression = e[0];
    if (e.length === 3) { P.expression1 = e[1]; P.expression2 = e[2]; }
    P.createNewImage = false; P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1;
    if (!P.executeOn(w.mainView)) { w.forceClose(); throw new Error("PixelMath del punto negro falló"); }
    if (medios) {
      // Curva que deja el cielo en t y devuelve la mediana de la nebulosa a la de antes (MTF sobre el tramo t–1): el
      // fondo baja sin apagar la nebulosa (15 nov 2026: con el punto negro solo la imagen quedaba oscura).
      var mObj = t + Math.max(senal0, Math.min(senalObj, m0 - t)), m1 = esMedian(w.mainView), x = (m1 - t) / (1 - t), y = (mObj - t) / (1 - t);
      if (x > 0 && x < y && y < 1) {
        var mt = x * (y - 1) / (2 * x * y - x - y), tt = t.toFixed(6), k = (1 - t).toFixed(6);
        var C = new PixelMath;
        C.expression = "iif($T > " + tt + ", " + tt + " + " + k + " * mtf(" + mt.toFixed(6) + ", ($T - " + tt + ") / " + k + "), $T)";
        C.useSingleExpression = true; C.createNewImage = false; C.truncate = true; C.truncateLower = 0; C.truncateUpper = 1;
        if (!C.executeOn(w.mainView)) { w.forceClose(); throw new Error("PixelMath de la curva de medios falló"); }
      }
    }
    if (rango) {
      var cR = esCheck(w.mainView);
      gRango = (cR.p99 > t + 0.02) ? Math.min(gMax, Math.max(1, (blanco - t) / (cR.p99 - t))) : 1;
      if (gRango > 1.02) {
        // Pivote en el cielo de cada canal y en toda la imagen (sin iif): con un pivote común y sólo por encima de t, el
        // codo en t cambiaba el color de la franja p10–p30 (un 6,6 % en la prueba); así es una recta por canal.
        var sR = esSkyDominance(w.mainView), piv = (sR.canales && sR.canales.length) ? sR.canales : [t], Gw = new PixelMath;
        var eG = piv.map(function (sc) { return sc.toFixed(6) + " + ($T - " + sc.toFixed(6) + ") * " + gRango.toFixed(4); });
        Gw.useSingleExpression = (eG.length === 1); Gw.expression = eG[0];
        if (eG.length === 3) { Gw.expression1 = eG[1]; Gw.expression2 = eG[2]; }
        Gw.createNewImage = false; Gw.truncate = true; Gw.truncateLower = 0; Gw.truncateUpper = 1;
        if (!Gw.executeOn(w.mainView)) { w.forceClose(); throw new Error("PixelMath del punto blanco falló"); }
      } else { w.forceClose(); return; }   // ya llega al blanco: sería igual que el punto negro solo
    }
    var c = esCheck(w.mainView), s1 = esSkyDominance(w.mainView);
    var cielo = s1.canales && s1.canales.length ? (s1.canales[0] + s1.canales[1] + s1.canales[2]) / 3 : c.cielo;
    var nuevos = c.cero_pct - c0.cero_pct, f1 = bsFranja(w.mainView, s1.canales), tinte = null;
    // La «+ medios» se compara con el punto negro solo del mismo nivel: así se mide sólo lo que tiñe la curva (en una
    // paleta de IC 1396, 23 nov 2026, el punto negro solo daba 5,5 % frente a la entrada por recortar a 0 parte de la
    // franja en un canal, sin teñir nada). El punto negro solo no se juzga por tinte.
    if (!medios && !rango) fPlano[t] = f1;
    var quemaNuevos = c.alto_pct - c0.alto_pct;
    var fRef = (medios || rango) ? fPlano[t] : null;
    // 24 nov 2026 (Paleta4 de IC 1396): las «+ rango» acercaban la franja al neutro (R/G 3,49 → 3,30; B/G 0,373 → 0,397),
    // es decir, le quitaban algo de color, y se descartaban todas por «tinte»: se quedó el punto negro solo a 0,035 y el
    // final salió oscuro (mediana 0,089 frente a 0,169). Ahora sólo es tinte lo que ALEJA un cociente del neutro (más de
    // tinteMax); acercarlo es pérdida de color, que la saturación devuelve, y se admite hasta o.perdidaColorMax (10 %).
    var alejado = null, perdida = null;
    if (fRef && f1) {
      tinte = Math.max(Math.abs(f1.R_G / fRef.R_G - 1), Math.abs(f1.B_G / fRef.B_G - 1));
      var dR = Math.abs(Math.log(f1.R_G)) - Math.abs(Math.log(fRef.R_G)), dB = Math.abs(Math.log(f1.B_G)) - Math.abs(Math.log(fRef.B_G));
      alejado = Math.exp(Math.max(0, dR, dB)) - 1; perdida = Math.exp(Math.max(0, -dR, -dB)) - 1;
    }
    var tine = alejado !== null && alejado > tinteMax, apaga = perdida !== null && perdida > perdidaMax;
    var senal1 = esMedian(w.mainView) - cielo, come = senal0 > 0.01 && senal1 < 0.85 * senal0;
    cands.push({ metodo: "cielo a " + t + (medios ? " + medios" : "") + (rango ? " + rango" : ""), vista: w.mainView.id, ganancia_rango: gRango === null ? undefined : +gRango.toFixed(3), p99: c.p99, cielo: +cielo.toFixed(4), mediana: +esMedian(w.mainView).toFixed(4), cielo_rgb: (s1.canales || []).map(function (x) { return +x.toFixed(4); }),
                 ceros_pct: +c.cero_pct.toFixed(3), ceros_nuevos_pct: +nuevos.toFixed(3), punto_negro: bp.map(function (b) { return +b.toFixed(5); }),
                 franja_p10_p30: f1, tinte_franja_pct: tinte === null ? null : +(100 * tinte).toFixed(1),
                 tinte_alejado_pct: alejado === null ? null : +(100 * alejado).toFixed(1), perdida_color_pct: perdida === null ? null : +(100 * perdida).toFixed(1),
                 mediana_frente_entrada: +(esMedian(w.mainView) / m0).toFixed(3),
                 no_cumple: (nuevos > cerosMax ? ["lleva a 0 un " + nuevos.toFixed(2) + " % más de píxeles (máx. " + cerosMax + ")"] : [])
                   .concat(rango && quemaNuevos > 0.05 ? ["el punto blanco quema un " + quemaNuevos.toFixed(3) + " % más de píxeles (≥ 0,95; máx. 0,05 %): baja «blanco»"] : [])
                   .concat(tine ? ["la variante «" + (rango ? "+ rango" : "+ medios") + "» tiñe el fondo débil (franja p10–p30, color sobre el cielo): R/G " + f1.R_G + " y B/G " + f1.B_G + " frente a " + fRef.R_G + " y " + fRef.B_G + " con el punto negro solo (aleja un cociente del neutro un " + (100 * alejado).toFixed(1) + " % > " + (100 * tinteMax) + " %)"] : [])
                   .concat(apaga ? ["la variante «" + (rango ? "+ rango" : "+ medios") + "» apaga el color del fondo débil: R/G " + f1.R_G + " y B/G " + f1.B_G + " frente a " + fRef.R_G + " y " + fRef.B_G + " (acerca al gris un " + (100 * perdida).toFixed(1) + " % > " + (100 * perdidaMax) + " %)"] : [])
                   .concat(come ? ["se come la nebulosa: señal sobre el cielo " + senal1.toFixed(3) + " < 85 % de la de entrada (" + senal0.toFixed(3) + ")"] : []),
                 senal_sobre_cielo: +senal1.toFixed(4),
                 cumple: nuevos <= cerosMax && !tine && !apaga && !come && !(rango && quemaNuevos > 0.05), previa: pxPrevia(w.mainView.id, "fondo_" + w.mainView.id, { estirar: false }) });
  });
  if (!cands.length) return { vista: viewId, comparados: [], recomendado: null,
                              motivo: "El cielo ya está en " + (s0.reduce(function (a, b) { return a + b; }, 0) / s0.length).toFixed(3) + ", igual o por debajo de los niveles pedidos." };
  var ok = cands.filter(function (c) { return c.cumple; });
  // Primero las «+ rango» que cumplen; si no hay, las «+ medios»; si no, el punto negro solo (en la prueba del 24 nov 2026
  // el punto negro solo a 0,035 era el más oscuro, pero dejaba la mediana de la nebulosa en 0,072 frente a 0,148: se la
  // comía; la «+ rango» a 0,05 la dejaba en 0,124). Dentro del grupo, el más oscuro; a casi igual cielo (±0,005: la curva
  // sube un poco las celdas de cielo), el que conserva los medios.
  function rangoDe(c) { return /rango$/.test(c.metodo) ? 2 : /medios$/.test(c.metodo) ? 1 : 0; }
  // 24 nov 2026: primero el cielo más oscuro que cumple (antes, primero el grupo «+ rango», luego «+ medios»: la Paleta5
  // se quedó con el cielo en 0,065); a casi igual cielo, «+ rango», luego «+ medios», luego el punto negro solo.
  var mejor = ok.length ? ok.reduce(function (a, c) {
    if (Math.abs(c.cielo - a.cielo) <= 0.005) return rangoDe(c) > rangoDe(a) ? c : a;
    return c.cielo < a.cielo ? c : a; }) : null;
  cands.forEach(function (c) { if (c !== mejor && o.cerrar !== false) { var ww = ImageWindow.windowById(c.vista); if (!ww.isNull) ww.forceClose(); } });
  return {
    vista: mejor ? mejor.vista : viewId, original: viewId, antes: { cielo_rgb: s0.map(function (x) { return +x.toFixed(4); }), ceros_pct: +c0.cero_pct.toFixed(3), franja_p10_p30: f0 },
    comparados: cands.map(function (c) { var x = {}; for (var k in c) x[k] = c[k]; x.elegido = c === mejor; return x; }),
    recomendado: mejor ? mejor.metodo : null,
    motivo: mejor ? mejor.metodo + ": el cielo más oscuro (" + mejor.cielo + ") y neutro sin llevar a 0 más de un " + cerosMax +
                    " % de los píxeles, sin teñir ni apagar el fondo débil (franja p10–p30) y con la mediana a " + mejor.mediana_frente_entrada + " de la de entrada. Un fondo demasiado negro se come la nebulosa débil: mira la previa." :
                    "Ninguno cumple (llevan a 0 demasiados píxeles o tiñen el fondo débil: ver no_cumple de cada uno): deja el fondo como está o pide otros niveles (cielos).",
    siguiente: "Sigue con " + (mejor ? mejor.vista : viewId) + " (exportarFinal)."
  };
}

function saturarAlFallo(viewId, o) {
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);   // también vale la View o el resultado de otra función ({ vista: ... })
  o = o || {};
  var src = View.viewById(viewId);
  if (!src || src.isNull) throw new Error("No existe la vista " + viewId);
  if (src.image.numberOfChannels !== 3) throw new Error("La saturación necesita una imagen RGB");
  src.image.resetSelections();
  if (src.image.median() < 0.02) throw new Error("La imagen parece lineal: el boost va después del estirado");
  var mascara = o.mascara ? bsMascara(src) : null;
  var pasos = o.pasos || (mascara ? [0.63, 0.68, 0.73, 0.78, 0.83, 0.88] : [0.58, 0.63, 0.68, 0.73, 0.78]), t0 = Date.now();
  var base = bsSky(src), pruebas = [], gan = null, motivo = "llegó al último paso sin fallo";
  for (var i = 0; i < pasos.length; ++i) {
    var w = bsCopy(src, "bsTmp");
    bsSaturate(w.mainView, pasos[i], mascara);
    var m = bsSky(w.mainView), f = [];
    if (m.sobre_098_pct - base.sobre_098_pct > 0.01) f.push("canales > 0,98: +" + (m.sobre_098_pct - base.sobre_098_pct).toFixed(3) + " % de píxeles");
    if (m.dominante_pct > Math.max(8, base.dominante_pct + 4)) f.push("fondo teñido: dominante del cielo " + m.dominante_pct + " %");
    var rc = base.ruido_croma > 0 ? m.ruido_croma / base.ruido_croma : 1;
    if (rc > 1.5) f.push("ruido de color del cielo ×" + rc.toFixed(2));
    pruebas.push({ punto_medio: pasos[i], dominante_cielo_pct: m.dominante_pct, ruido_croma_x: +rc.toFixed(2),
                   sobre_098_pct: +m.sobre_098_pct.toFixed(4), fallo: f });
    w.forceClose();
    if (f.length) { motivo = "falla en " + pasos[i] + ": " + f.join("; ") + "; se queda la anterior"; break; }
    gan = pasos[i];
  }
  var res = { original: viewId, pruebas: pruebas, punto_medio_elegido: gan, parada: motivo,
              cielo_partida: { dominante_pct: base.dominante_pct, sobre_098_pct: +base.sobre_098_pct.toFixed(4) },
              segundos: Math.round((Date.now() - t0) / 1000), mascara_luminancia: !!mascara };
  if (mascara) mascara.forceClose();
  if (gan === null) {
    res.vista = null;
    res.no_cumple = ["ni la saturación más suave pasa: no saturar (o saturación selectiva con máscara); revisar la dominante del cielo antes"];
  } else {
    var id = (typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_sat");
    for (var n = 2; !ImageWindow.windowById(id).isNull; ++n) id = ((typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_sat")) + "_" + n;
    var fw = bsCopy(src, id);
    if (src.window.hasAstrometricSolution) fw.copyAstrometricSolution(src.window);
    bsSaturate(fw.mainView, gan, mascara);
    fw.show();
    res.vista = id;
    res.no_cumple = [];
  }
  var tipo = o.tipo || "nebulosa", rango = tipo === "galaxia" ? [0.63, 0.70] : [0.70, 0.78];
  res.control = {
    medido: { saturado_sin_fallo: gan !== null, dentro_del_rango_tipico: gan !== null && gan >= rango[0] && gan <= rango[1] },
    revisar_a_ojo: ["bandas de color y tonos antinaturales al 100 %", "anillos alrededor de estrellas y bordes de máscara",
                    "aspecto 'diseñado' en vez de 'observado' (si se ve, un paso menos)"],
    nota: "Rango típico para " + tipo + ": " + rango.join("–") + ". Si para antes, suele ser por ruido de color o dominante " +
          "del cielo sin resolver (la saturación la amplifica). " +
          (mascara ? "Con máscara de luminancia: el cielo queda protegido y la nebulosa se satura más. "
                   : "Para más color en la nebulosa sin teñir el cielo: repetir sobre la MISMA entrada con { mascara: true } (máscara de luminancia). ") +
          "Lo de revisar_a_ojo no lo mide esta función."
  };
  return res;
}

// ---------------------------------------------------------------------------------------------------
// Color para elegir (Rafael, 11 nov 2026: «dar al usuario la opción de seleccionar entre varias imágenes con diferente
// saturación, equilibrio, etc.») y medidas de color de las láminas de color (saturación, deriva, mapa de saturación).
//
// bsColorMedidas(view): tono y saturación del objeto y % de píxeles muy saturados.
//   - Objeto = píxeles con luminancia entre los percentiles 70 y 99,5 (fuera cielo y núcleos quemados).
//   - tono_grados: tono medio (HSV, media circular ponderada por la croma); saturacion_media: croma (máx − mín) / máx.
//   - muy_saturados_pct: % de píxeles con señal (máx > 0,15) y croma > 0,8: el «mapa de saturación» de las láminas,
//     donde los colores se van al borde del gamut. Umbral orientativo, sin calibrar.
function bsHue(r, g, b) {
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d <= 0) return -1;
  var h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; return h < 0 ? h + 360 : h;
}

function bsColorMedidas(view) {
  var im = view.image, W = im.width, H = im.height, n = W * H, R = new Rect(0, 0, W, H);
  var ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (var c = 0; c < 3; ++c) im.getSamples(ch[c], R, c);
  var paso = Math.max(1, Math.ceil(n / 1.5e6)), Ls = [];
  for (var i = 0; i < n; i += paso) Ls.push((ch[0][i] + ch[1][i] + ch[2][i]) / 3);
  Ls.sort(function (a, b) { return a - b; });
  var lo = Ls[Math.floor(0.70 * (Ls.length - 1))], hi = Ls[Math.floor(0.995 * (Ls.length - 1))];
  var sx = 0, sy = 0, sc = 0, nObj = 0, muy = 0, conSenal = 0;
  for (var j = 0; j < n; j += paso) {
    var r = ch[0][j], g = ch[1][j], b = ch[2][j], mx = Math.max(r, g, b), cr = mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0;
    if (mx > 0.15) { ++conSenal; if (cr > 0.8) ++muy; }
    var L = (r + g + b) / 3;
    if (L < lo || L > hi) continue;
    var h = bsHue(r, g, b);
    ++nObj; sc += cr;
    if (h >= 0) { sx += cr * Math.cos(h * Math.PI / 180); sy += cr * Math.sin(h * Math.PI / 180); }
  }
  var tono = Math.atan2(sy, sx) * 180 / Math.PI; if (tono < 0) tono += 360;
  return { tono_grados: +tono.toFixed(1), fuerza_tono: nObj ? +(Math.sqrt(sx * sx + sy * sy) / nObj).toFixed(3) : 0,
           saturacion_media: nObj ? +(sc / nObj).toFixed(3) : 0,
           muy_saturados_pct: conSenal ? +(100 * muy / conSenal).toFixed(2) : 0 };
}

function bsDifTono(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

// Deriva de color entre dos versiones de la misma imagen (lámina «por qué los colores se vuelven falsos»): tono medio del
// objeto, saturación y píxeles muy saturados en las dos. La saturación y las curvas de contraste cambian la croma pero
// no deberían girar el tono: un giro > 10° del tono del objeto entre dos pasos no lineales es una deriva (curvas por
// canal, máscara mal hecha, dominante). Del lineal al estirado algo de cambio es normal salvo con estirados que
// conservan el color. Umbral orientativo, sin calibrar.
//   var d = derivaColor("Starless_sat", { referencia: "Starless_st" });
function derivaColor(viewId, o) {
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);
  o = o || {};
  var refId = o.referencia && typeof o.referencia === "object" ? (o.referencia.id || o.referencia.vista) : o.referencia;
  var v = View.viewById(viewId), rv = refId ? View.viewById(refId) : null;
  if (!v || v.isNull) throw new Error("No existe la vista " + viewId);
  if (v.image.numberOfChannels !== 3) throw new Error("derivaColor necesita una imagen RGB");
  var m = bsColorMedidas(v), out = { vista: viewId, medidas: m, no_cumple: [] };
  if (rv && !rv.isNull) {
    if (rv.image.numberOfChannels !== 3) throw new Error("La referencia tiene que ser RGB");
    var mr = bsColorMedidas(rv), dt = bsDifTono(m.tono_grados, mr.tono_grados);
    out.referencia = refId; out.medidas_referencia = mr;
    out.deriva_tono_grados = +dt.toFixed(1);
    out.saturacion_x = mr.saturacion_media > 0 ? +(m.saturacion_media / mr.saturacion_media).toFixed(2) : null;
    out.muy_saturados_sube = +(m.muy_saturados_pct - mr.muy_saturados_pct).toFixed(2);
    if (dt > (o.toleranciaTono || 10) && mr.fuerza_tono > 0.05)
      out.no_cumple.push("DERIVA DE COLOR: el tono del objeto ha girado " + dt.toFixed(1) + "° (" + mr.tono_grados + "° → " + m.tono_grados + "°)");
  }
  if (m.muy_saturados_pct > (o.muySaturadosMax || 5))
    out.no_cumple.push("demasiado saturada: el " + m.muy_saturados_pct + " % de los píxeles con señal tiene croma > 0,8 (límite orientativo " + (o.muySaturadosMax || 5) + " %)");
  out.control = { nota: "tono_grados: 0 rojo, 60 amarillo, 120 verde, 180 cian, 240 azul, 300 magenta (HSV). fuerza_tono baja (< 0,05) = objeto casi " +
                        "neutro: el tono no significa nada. Umbrales orientativos, sin calibrar con varios casos." };
  return out;
}

// Curva por canal anclada en el cielo (el cielo no se mueve): [[0,0],[cielo,cielo],[0,5, 0,5 + d],[1,1]].
function bsCurvaCanal(cielo, d) {
  var c = Math.max(0.01, Math.min(0.3, cielo));
  return [[0, 0], [c, c], [0.5, Math.max(c + 0.01, Math.min(0.99, 0.5 + d))], [1, 1]];
}
// Curva S anclada en el cielo: baja el cuarto inferior y sube el superior de lo que hay por encima del cielo.
function bsCurvaS(cielo, d) {
  var c = Math.max(0.01, Math.min(0.3, cielo)), q1 = c + 0.25 * (1 - c), q3 = c + 0.75 * (1 - c);
  return [[0, 0], [c, c], [q1, Math.max(c + 0.005, q1 - d)], [q3, Math.min(0.995, q3 + d)], [1, 1]];
}

function bsCurvas(view, curvas) {
  var C = new CurvesTransformation, ak = bsK(CurvesTransformation, "AkimaSubsplines");
  for (var k in curvas) { C[k] = curvas[k]; C[k + "t"] = ak; }
  if (!C.executeOn(view)) throw new Error("CurvesTransformation falló");
}

// Galería de color del Paso 5 sobre la starless estirada (o la imagen final): copias con distinta saturación, equilibrio y
// contraste global para que el usuario elija mirando las previas. Ninguna se elige sola; la recomendada es la saturación
// al fallo de la guía (saturarAlFallo). Candidatos (claves de o.candidatos):
//   neutra           sin saturar (la versión de referencia que se guarda siempre)
//   equilibrada      saturación al fallo (saturarAlFallo); RECOMENDADA
//   viva             un paso más de saturación (+0,05), a través de la máscara de luminancia (el cielo no se tiñe)
//   calida / fria    equilibrada + curvas R y B suaves (±0,015 en medios tonos) ancladas en el cielo
//   contraste_suave / contraste_medio   equilibrada + curva S en RGB/K (±0,02 / ±0,04) anclada en el cielo
// Medidas de cada una: fallos de saturarAlFallo (canales > 0,98, fondo teñido, ruido de color ×1,5), tono del objeto y su
// deriva frente a la neutra, saturación media y % de píxeles muy saturados.
//   var r = colorCandidatos("Starless_st", { tipo: "nebulosa" });
function colorCandidatos(viewId, o) {
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);
  o = o || {};
  var src = View.viewById(viewId);
  if (!src || src.isNull) throw new Error("No existe la vista " + viewId);
  if (src.image.numberOfChannels !== 3) throw new Error("colorCandidatos necesita una imagen RGB");
  src.image.resetSelections();
  if (src.image.median() < 0.02) throw new Error("La imagen parece lineal: el color del Paso 5 va después del estirado");
  var t0 = Date.now(), base0 = bsSky(src), m0 = bsColorMedidas(src), cielo = base0.cielo;
  var pref = (typeof o.prefijo === "string" && o.prefijo) || (viewId + "_col");
  // Nebulosas: la recomendada satura a través de una máscara de luminancia (23 nov 2026, IC 405 con Qwen: sin máscara la
  // saturación al fallo paraba en 0,63–0,68 por el ruido de color del cielo y la nebulosa salía plana; con máscara, la
  // d2 llegó a 0,88 sin fallo y fue la más vistosa). La sin máscara queda como «discreta». Galaxias: como antes, salvo
  // { mascara: true }.
  var conMasc = (o.mascara !== undefined) ? !!o.mascara : String(o.tipo || "nebulosa").toLowerCase() !== "galaxia";
  var claves = o.candidatos || (conMasc ? ["neutra", "discreta", "equilibrada", "viva", "calida", "fria", "contraste_suave", "contraste_medio"]
                                       : ["neutra", "equilibrada", "viva", "calida", "fria", "contraste_suave", "contraste_medio"]);
  // Saturación al fallo de la guía (punto medio de la curva S de saturación), sin y (en nebulosas) con máscara.
  var mid = o.puntoMedio, sf = null, midM = null, sfM = null;
  if (mid === undefined) {
    sf = saturarAlFallo(viewId, { tipo: o.tipo, nuevaVista: "bsTmpFallo" });
    mid = sf.punto_medio_elegido;
    if (sf.vista) { var wf = ImageWindow.windowById(sf.vista); if (!wf.isNull) wf.forceClose(); }
  }
  if (conMasc) {
    sfM = saturarAlFallo(viewId, { tipo: o.tipo, mascara: true, nuevaVista: "bsTmpFalloM" });
    midM = sfM.punto_medio_elegido;
    if (sfM.vista) { var wfM = ImageWindow.windowById(sfM.vista); if (!wfM.isNull) wfM.forceClose(); }
  }
  var masc = null;
  var conMascara = function () { if (!masc) masc = bsMascara(src); return masc; };
  // La saturación «equilibrada» (base de cálida, fría y contraste): con máscara en nebulosas.
  var midEq = conMasc ? midM : mid;
  var satEq = function (v) { if (midEq) bsSaturate(v, midEq, conMasc ? conMascara() : null); };
  var avisos = [];
  if (base0.cielo > 0.08)
    avisos.push("el cielo está en " + base0.cielo.toFixed(3) + " (> 0,08): el fondo va ANTES de saturar (fondoCandidatos y aplicar el recomendado); " +
                "con el cielo gris la saturación para antes por el ruido de color del cielo");
  var receta = {
    neutra:          { etiqueta: "neutra (sin saturar)", hacer: function (v) { } },
    discreta:        { etiqueta: "discreta: saturación al fallo sin máscara" + (mid ? " (" + mid + ")" : " (no satura)"),
                       hacer: function (v) { if (mid) bsSaturate(v, mid, null); } },
    equilibrada:     { etiqueta: "equilibrada: saturación al fallo" + (conMasc ? " con máscara de luminancia" : "") +
                                 (midEq ? " (" + midEq + ")" : " (no satura: ni la más suave pasa)"),
                       hacer: satEq },
    viva:            { etiqueta: "viva: saturación " + ((midEq || 0.58) + 0.05).toFixed(2) + " con máscara de luminancia",
                       hacer: function (v) { bsSaturate(v, (midEq || 0.58) + 0.05, conMascara()); } },
    calida:          { etiqueta: "cálida: equilibrada + rojo +0,015 / azul −0,015 en medios tonos",
                       hacer: function (v) { satEq(v); bsCurvas(v, { R: bsCurvaCanal(base0.cielo_rgb[0], 0.015), B: bsCurvaCanal(base0.cielo_rgb[2], -0.015) }); } },
    fria:            { etiqueta: "fría: equilibrada + rojo −0,015 / azul +0,015 en medios tonos",
                       hacer: function (v) { satEq(v); bsCurvas(v, { R: bsCurvaCanal(base0.cielo_rgb[0], -0.015), B: bsCurvaCanal(base0.cielo_rgb[2], 0.015) }); } },
    contraste_suave: { etiqueta: "equilibrada + curva S suave (±0,02)", hacer: function (v) { satEq(v); bsCurvas(v, { K: bsCurvaS(cielo, 0.02) }); } },
    contraste_medio: { etiqueta: "equilibrada + curva S media (±0,04)", hacer: function (v) { satEq(v); bsCurvas(v, { K: bsCurvaS(cielo, 0.04) }); } }
  };
  var cands = [];
  for (var i = 0; i < claves.length; ++i) {
    var k = claves[i], rc = receta[k];
    if (!rc) { cands.push({ clave: k, error: "candidato desconocido (" + Object.keys(receta).join(", ") + ")" }); continue; }
    var c = { clave: k, etiqueta: rc.etiqueta };
    try {
      var id = pref + "_" + k;
      for (var n2 = 2; !ImageWindow.windowById(id).isNull; ++n2) id = pref + "_" + k + "_" + n2;
      var w = bsCopy(src, id);
      if (src.window.hasAstrometricSolution) w.copyAstrometricSolution(src.window);
      rc.hacer(w.mainView);
      w.show();
      var mc = bsSky(w.mainView), cm = bsColorMedidas(w.mainView), f = [];
      if (mc.sobre_098_pct - base0.sobre_098_pct > 0.01) f.push("canales > 0,98: +" + (mc.sobre_098_pct - base0.sobre_098_pct).toFixed(3) + " % de píxeles");
      if (mc.dominante_pct > Math.max(8, base0.dominante_pct + 4)) f.push("fondo teñido: dominante del cielo " + mc.dominante_pct + " %");
      var rcx = base0.ruido_croma > 0 ? mc.ruido_croma / base0.ruido_croma : 1;
      if (rcx > 1.5) f.push("ruido de color del cielo ×" + rcx.toFixed(2));
      var dt = bsDifTono(cm.tono_grados, m0.tono_grados);
      if (k !== "calida" && k !== "fria" && dt > 10 && m0.fuerza_tono > 0.05) f.push("el tono del objeto gira " + dt.toFixed(1) + "°");
      if (cm.muy_saturados_pct > Math.max(5, 2 * m0.muy_saturados_pct)) f.push("muy saturados " + cm.muy_saturados_pct + " % (orientativo)");
      c.vista = id;
      c.dominante_cielo_pct = mc.dominante_pct; c.ruido_croma_x = +rcx.toFixed(2); c.sobre_098_pct = +mc.sobre_098_pct.toFixed(4);
      c.cielo = +mc.cielo.toFixed(4); c.tono_grados = cm.tono_grados; c.deriva_tono_grados = +dt.toFixed(1);
      c.saturacion_media = cm.saturacion_media; c.muy_saturados_pct = cm.muy_saturados_pct;
      c.fallos = f; c.cumple = !f.length;
      c.previa = (typeof pxPrevia === "function") ? pxPrevia(id, id, { estirar: false }) : null;
      c.resumen = "saturación " + cm.saturacion_media + ", tono " + cm.tono_grados + "°" + (f.length ? " · NO CUMPLE: " + f.join("; ") : "");
    } catch (e) { c.error = String(e && e.message ? e.message : e); }
    c.recomendado = k === "equilibrada"; c.elegido = c.recomendado;
    cands.push(c);
  }
  if (masc) masc.forceClose();
  var rec = cands.filter(function (c) { return c.recomendado && c.vista; })[0] || null;
  return {
    vista: rec ? rec.vista : null, original: viewId, punto_medio_saturacion: midEq || null, con_mascara: conMasc,
    punto_medio_sin_mascara: conMasc ? (mid || null) : undefined, avisos: avisos.length ? avisos : undefined,
    saturacion_al_fallo: sf ? { pruebas: sf.pruebas, parada: sf.parada } : undefined,
    saturacion_al_fallo_con_mascara: sfM ? { pruebas: sfM.pruebas, parada: sfM.parada } : undefined,
    candidatos: cands, recomendado: rec ? rec.etiqueta : null,
    referencia: { tono_grados: m0.tono_grados, saturacion_media: m0.saturacion_media, muy_saturados_pct: m0.muy_saturados_pct,
                  dominante_cielo_pct: base0.dominante_pct },
    no_cumple: rec && rec.fallos ? rec.fallos : [],
    segundos: Math.round((Date.now() - t0) / 1000),
    siguiente: "El usuario elige una mirando las previas (la recomendada es la equilibrada); seguir con esa vista y cerrar las demás con cerrarVista. " +
               "Guardar también la neutra como referencia.",
    control: {
      revisar_a_ojo: ["bandas de color y tonos antinaturales al 100 %", "aspecto 'diseñado' en vez de 'observado'",
                      "color de las estrellas brillantes (blancas o de su color, no del tono de la nebulosa)"],
      nota: "La recomendada es la saturación al fallo de la guía; las demás son para elegir. Un candidato que no cumple se puede elegir, pero se " +
            "dice. Las curvas de equilibrio y contraste están ancladas en el cielo (no lo mueven). Lo de revisar_a_ojo no lo mide esta función."
    }
  };
}

// Saturación selectiva por tono (lámina «saturación y color grading»): sube (o baja) la saturación sólo de un tono, con
// ColorSaturation y una campana alrededor del tono pedido. Para cuando falta un solo color (Hα rojo, OIII cian) y la
// saturación global ya para por el cielo o por otro color. Tonos: rojo 0, naranja 30, amarillo 60, verde 120, cian 180,
// azul 240, magenta 300, o grados. cantidad 0,3 por defecto (−1 a 1; negativo desatura ese tono). En una copia.
//   var r = saturarTono("Starless_sat", { tono: "cian", cantidad: 0.3 });
var BS_TONOS = { rojo: 0, naranja: 30, amarillo: 60, verde: 120, cian: 180, azul: 240, magenta: 300 };
function saturarTono(viewId, o) {
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);
  o = o || {};
  var src = View.viewById(viewId);
  if (!src || src.isNull) throw new Error("No existe la vista " + viewId);
  if (src.image.numberOfChannels !== 3) throw new Error("saturarTono necesita una imagen RGB");
  src.image.resetSelections();
  if (src.image.median() < 0.02) throw new Error("La imagen parece lineal: la saturación va después del estirado");
  var t = o.tono, tono = typeof t === "number" ? t : BS_TONOS[String(t || "").toLowerCase()];
  if (tono === undefined) throw new Error("tono desconocido: " + t + " (" + Object.keys(BS_TONOS).join(", ") + " o grados)");
  var cant = o.cantidad !== undefined ? o.cantidad : 0.3, ancho = o.ancho || 30, pts = [];
  for (var h = 0; h <= 360.001; h += 15) {
    var d = bsDifTono(h, tono), y = d < ancho ? cant * 0.5 * (1 + Math.cos(Math.PI * d / ancho)) : 0;
    pts.push([+(h / 360).toFixed(4), +y.toFixed(4)]);
  }
  var base0 = bsSky(src), m0 = bsColorMedidas(src);
  var id = (typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_tono");
  for (var n = 2; !ImageWindow.windowById(id).isNull; ++n) id = ((typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_tono")) + "_" + n;
  var w = bsCopy(src, id);
  if (src.window.hasAstrometricSolution) w.copyAstrometricSolution(src.window);
  var masc = o.mascara ? bsMascara(src) : null;
  if (masc) { w.mask = masc; w.maskVisible = false; w.maskInverted = false; w.maskEnabled = true; }
  var CS = new ColorSaturation;
  CS.HS = pts; CS.HSt = bsK(ColorSaturation, "AkimaSubsplines"); CS.hueShift = 0;
  var ok = CS.executeOn(w.mainView);
  if (masc) { w.removeMask(); masc.forceClose(); }
  if (!ok) { w.forceClose(); throw new Error("ColorSaturation falló"); }
  w.show();
  var mc = bsSky(w.mainView), cm = bsColorMedidas(w.mainView), f = [];
  if (mc.sobre_098_pct - base0.sobre_098_pct > 0.01) f.push("canales > 0,98: +" + (mc.sobre_098_pct - base0.sobre_098_pct).toFixed(3) + " %");
  if (mc.dominante_pct > Math.max(8, base0.dominante_pct + 4)) f.push("fondo teñido: dominante del cielo " + mc.dominante_pct + " %");
  if (cm.muy_saturados_pct > Math.max(5, 2 * m0.muy_saturados_pct)) f.push("muy saturados " + cm.muy_saturados_pct + " % (orientativo)");
  return {
    vista: id, original: viewId, tono_grados: tono, cantidad: cant, ancho_grados: ancho, mascara_luminancia: !!o.mascara,
    antes: { saturacion_media: m0.saturacion_media, muy_saturados_pct: m0.muy_saturados_pct, dominante_cielo_pct: base0.dominante_pct },
    despues: { saturacion_media: cm.saturacion_media, muy_saturados_pct: cm.muy_saturados_pct, dominante_cielo_pct: mc.dominante_pct },
    no_cumple: f, previa: (typeof pxPrevia === "function") ? pxPrevia(id, id, { estirar: false }) : null,
    control: { revisar_a_ojo: ["bordes entre colores (bandas) y tonos vecinos arrastrados", "el cielo no debe cambiar de color"],
               nota: "Selectiva: no toca los demás tonos. Si el cielo tiene ese tono (dominante), usar { mascara: true }. Lo de revisar_a_ojo no lo mide esta función." }
  };
}
