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
           ruido_croma: dev[dev.length >> 1], sobre_098_pct: 100 * hi / n };   // 3 canales × n/3 muestras
}

function bsCopy(view, id) {
  var im = view.image; im.resetSelections();
  var old = ImageWindow.windowById(id); if (!old.isNull) old.forceClose();
  var w = new ImageWindow(im.width, im.height, im.numberOfChannels, 32, true, im.isColor, id);
  w.mainView.beginProcess(); w.mainView.image.assign(im); w.mainView.endProcess();
  return w;
}

function bsSaturate(view, mid) {
  var C = new CurvesTransformation;
  C.S = [[0, 0], [0.5, mid], [1, 1]];
  C.St = bsK(CurvesTransformation, "AkimaSubsplines");
  if (!C.executeOn(view)) throw new Error("Curva de saturación falló (" + mid + ")");
}

function saturarAlFallo(viewId, o) {
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);   // también vale la View o el resultado de otra función ({ vista: ... })
  o = o || {};
  var src = View.viewById(viewId);
  if (!src || src.isNull) throw new Error("No existe la vista " + viewId);
  if (src.image.numberOfChannels !== 3) throw new Error("La saturación necesita una imagen RGB");
  src.image.resetSelections();
  if (src.image.median() < 0.02) throw new Error("La imagen parece lineal: el boost va después del estirado");
  var pasos = o.pasos || [0.58, 0.63, 0.68, 0.73, 0.78], t0 = Date.now();
  var base = bsSky(src), pruebas = [], gan = null, motivo = "llegó al último paso sin fallo";
  for (var i = 0; i < pasos.length; ++i) {
    var w = bsCopy(src, "bsTmp");
    bsSaturate(w.mainView, pasos[i]);
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
              segundos: Math.round((Date.now() - t0) / 1000) };
  if (gan === null) {
    res.vista = null;
    res.no_cumple = ["ni la saturación más suave pasa: no saturar (o saturación selectiva con máscara); revisar la dominante del cielo antes"];
  } else {
    var id = o.nuevaVista || (viewId + "_sat");
    for (var n = 2; !ImageWindow.windowById(id).isNull; ++n) id = (o.nuevaVista || (viewId + "_sat")) + "_" + n;
    var fw = bsCopy(src, id);
    if (src.window.hasAstrometricSolution) fw.copyAstrometricSolution(src.window);
    bsSaturate(fw.mainView, gan);
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
          "del cielo sin resolver (la saturación la amplifica). Lo de revisar_a_ojo no lo mide esta función."
  };
  return res;
}
