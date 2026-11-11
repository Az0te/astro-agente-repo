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
  var P = new PixelMath;
  P.expression = "CIEL($T)"; P.useSingleExpression = true; P.createNewImage = true; P.newImageId = id;
  P.newImageColorSpace = (PixelMath.Gray !== undefined) ? PixelMath.Gray : PixelMath.prototype.Gray;
  P.newImageSampleFormat = (PixelMath.f32 !== undefined) ? PixelMath.f32 : PixelMath.prototype.f32;
  P.truncate = true;
  if (!P.executeOn(view)) throw new Error("Máscara de luminancia falló");
  var mw = ImageWindow.windowById(id), mi = mw.mainView.image;
  var med = mi.median(), sig = 1.4826 * mi.MAD(), a = Math.max(0, med - 1.5 * sig), b = Math.max(a + 1e-3, mi.maximum());
  var Q = new PixelMath;
  Q.expression = "pow(max(0, min(1, ($T - " + a + ") / " + (b - a) + ")), 0.5)"; Q.useSingleExpression = true; Q.createNewImage = false; Q.truncate = true;
  if (!Q.executeOn(mw.mainView)) throw new Error("Máscara de luminancia (reescalado) falló");
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
  var claves = o.candidatos || ["neutra", "equilibrada", "viva", "calida", "fria", "contraste_suave", "contraste_medio"];
  // Saturación al fallo de la guía (punto medio de la curva S de saturación).
  var mid = o.puntoMedio, sf = null;
  if (mid === undefined) {
    sf = saturarAlFallo(viewId, { tipo: o.tipo, nuevaVista: "bsTmpFallo" });
    mid = sf.punto_medio_elegido;
    if (sf.vista) { var wf = ImageWindow.windowById(sf.vista); if (!wf.isNull) wf.forceClose(); }
  }
  var masc = null;
  var receta = {
    neutra:          { etiqueta: "neutra (sin saturar)", hacer: function (v) { } },
    equilibrada:     { etiqueta: "equilibrada: saturación al fallo" + (mid ? " (" + mid + ")" : " (no satura: ni la más suave pasa)"),
                       hacer: function (v) { if (mid) bsSaturate(v, mid, null); } },
    viva:            { etiqueta: "viva: saturación " + ((mid || 0.58) + 0.05).toFixed(2) + " con máscara de luminancia",
                       hacer: function (v) { if (!masc) masc = bsMascara(src); bsSaturate(v, (mid || 0.58) + 0.05, masc); } },
    calida:          { etiqueta: "cálida: equilibrada + rojo +0,015 / azul −0,015 en medios tonos",
                       hacer: function (v) { if (mid) bsSaturate(v, mid, null); bsCurvas(v, { R: bsCurvaCanal(base0.cielo_rgb[0], 0.015), B: bsCurvaCanal(base0.cielo_rgb[2], -0.015) }); } },
    fria:            { etiqueta: "fría: equilibrada + rojo −0,015 / azul +0,015 en medios tonos",
                       hacer: function (v) { if (mid) bsSaturate(v, mid, null); bsCurvas(v, { R: bsCurvaCanal(base0.cielo_rgb[0], -0.015), B: bsCurvaCanal(base0.cielo_rgb[2], 0.015) }); } },
    contraste_suave: { etiqueta: "equilibrada + curva S suave (±0,02)", hacer: function (v) { if (mid) bsSaturate(v, mid, null); bsCurvas(v, { K: bsCurvaS(cielo, 0.02) }); } },
    contraste_medio: { etiqueta: "equilibrada + curva S media (±0,04)", hacer: function (v) { if (mid) bsSaturate(v, mid, null); bsCurvas(v, { K: bsCurvaS(cielo, 0.04) }); } }
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
    vista: rec ? rec.vista : null, original: viewId, punto_medio_saturacion: mid || null,
    saturacion_al_fallo: sf ? { pruebas: sf.pruebas, parada: sf.parada } : undefined,
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
