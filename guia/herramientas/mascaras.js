// mascaras.js — Máscaras del Paso 4 no lineal en una sola llamada, con su cobertura medida. PJSR, ECMAScript 5.
//
// Uso (en el nivel superior del script):
//   eval(File.readTextFile("<ruta de guia>/herramientas/mascaras.js"));
//   var m = crearMascara("Starless_st", { tipo: "luminancia", gamma: 2.0 });   // LHE (1,5 para HDRMT)
//   var c = crearMascara("Starless_st", { tipo: "cielo" });                    // cielo: rampa de 1,5σ a 5σ, suavizada
//   var f = crearMascara("Starless_st", { tipo: "fondo_lhe" });                // 1 − clip((L64 − 0,20)/0,25)
//   // aplicar: ImageWindow.windowById("Starless_st").mask = ImageWindow.windowById(m.vista);
//
// Devuelve la vista de la máscara (gris) y su cobertura: % de píxeles con máscara > 0,5 (zona que recibirá el efecto)
// y valor medio de la máscara en el cielo y en la zona más brillante (para ver qué protege).

function mkId(v) { return (v && typeof v === "object" && v.id !== undefined) ? v.id : v; }

function mkUnique(id) {
  var out = id;
  for (var n = 2; !ImageWindow.windowById(out).isNull; ++n) out = id + "_" + n;
  return out;
}

function mkGray(view, expr, id) {
  var P = new PixelMath;
  P.useSingleExpression = true;
  P.expression = expr;
  P.createNewImage = true;
  P.newImageId = id;
  P.newImageColorSpace = (PixelMath.Gray !== undefined) ? PixelMath.Gray : PixelMath.prototype.Gray;
  P.newImageSampleFormat = (PixelMath.f32 !== undefined) ? PixelMath.f32 : PixelMath.prototype.f32;
  P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1;
  if (!P.executeOn(view)) throw new Error("PixelMath de la máscara falló");
  return ImageWindow.windowById(id);
}

function mkBlur(win, bin) {
  // Suavizado de gran escala: reducir ×bin, convolución pequeña y volver a ampliar (rápido incluso en imágenes grandes).
  var v = win.mainView, W = v.image.width, H = v.image.height;
  var I = new IntegerResample; I.zoomFactor = -bin; I.executeOn(v);
  var C = new Convolution; C.mode = (Convolution.Parametric !== undefined) ? Convolution.Parametric : Convolution.prototype.Parametric;
  C.sigma = 2; C.shape = 2; C.aspectRatio = 1; C.executeOn(v);
  var R = new Resample; R.xSize = W; R.ySize = H;
  R.mode = (Resample.AbsolutePixels !== undefined) ? Resample.AbsolutePixels : Resample.prototype.AbsolutePixels;
  R.absoluteMode = (Resample.ForceWidthAndHeight !== undefined) ? Resample.ForceWidthAndHeight : Resample.prototype.ForceWidthAndHeight;
  R.executeOn(v);
}

// Cielo (10 % de celdas de 64 px más oscuras) y su dispersión, en luminancia.
function mkSky(view) {
  var im = view.image, W = im.width, H = im.height, S = 64, nc = im.numberOfChannels, b = new Float32Array(S * S), cells = [];
  for (var y0 = 0; y0 + S <= H; y0 += S)
    for (var x0 = 0; x0 + S <= W; x0 += S) {
      var R = new Rect(x0, y0, x0 + S, y0 + S), L = new Float32Array(S * S);
      for (var c = 0; c < nc; ++c) { im.getSamples(b, R, c); for (var i = 0; i < b.length; ++i) L[i] += b[i] / nc; }
      var v = []; for (var j = 0; j < L.length; j += 4) v.push(L[j]);
      v.sort(function (p, q) { return p - q; });
      var md = v[v.length >> 1], d = v.map(function (x) { return Math.abs(x - md); }).sort(function (p, q) { return p - q; });
      cells.push({ m: md, s: 1.4826 * d[d.length >> 1] });
    }
  // Fuera las celdas vacías (bordes negros del registro o del recorte): no son cielo.
  cells = cells.filter(function (c) { return c.m > 1e-5 && c.s > 0; });
  if (cells.length < 10) throw new Error("No hay cielo medible (¿imagen vacía o con bordes negros enormes?)");
  cells.sort(function (a, b2) { return a.m - b2.m; });
  var k = Math.max(5, Math.floor(cells.length * 0.10)), ms = [], ss = [];
  for (var q = 0; q < k; ++q) { ms.push(cells[q].m); ss.push(cells[q].s); }
  ms.sort(function (a, b2) { return a - b2; }); ss.sort(function (a, b2) { return a - b2; });
  return { cielo: ms[ms.length >> 1], sigma: ss[ss.length >> 1], celdas: cells };
}

function mkCoverage(mask, view) {
  var im = mask.mainView.image, W = im.width, H = im.height, n = W * H, b = new Float32Array(n), on = 0;
  im.getSamples(b, new Rect(0, 0, W, H), 0);
  for (var i = 0; i < n; i += 5) if (b[i] > 0.5) ++on;
  // media de la máscara en el cielo (celdas más oscuras de la imagen) y en las más brillantes
  var src = view.image, S = 64, cells = [], L = new Float32Array(S * S), t = new Float32Array(S * S), nc = src.numberOfChannels;
  for (var y0 = 0; y0 + S <= H; y0 += S)
    for (var x0 = 0; x0 + S <= W; x0 += S) {
      var R = new Rect(x0, y0, x0 + S, y0 + S), s = 0, mm = 0; L.fill(0);
      for (var c = 0; c < nc; ++c) { src.getSamples(t, R, c); for (var j = 0; j < t.length; j += 4) s += t[j]; }
      im.getSamples(t, R, 0); for (var k = 0; k < t.length; k += 4) mm += t[k];
      cells.push({ l: s, m: mm / (t.length / 4) });
    }
  cells.sort(function (a, b2) { return a.l - b2.l; });
  var q = Math.max(5, Math.floor(cells.length * 0.05)), sk = 0, br = 0;
  for (var a = 0; a < q; ++a) { sk += cells[a].m; br += cells[cells.length - 1 - a].m; }
  return { cobertura_pct: +(100 * on / (n / 5)).toFixed(1), media_en_cielo: +(sk / q).toFixed(3), media_en_lo_brillante: +(br / q).toFixed(3) };
}

function crearMascara(viewId, o) {
  viewId = mkId(viewId); o = o || {};
  var v = View.viewById(viewId);
  if (!v || v.isNull) throw new Error("No existe la vista " + viewId);
  var tipo = o.tipo || "luminancia", lum = v.image.numberOfChannels === 3 ? "($T[0]+$T[1]+$T[2])/3" : "$T", w, desc;
  if (tipo === "luminancia") {
    var g = o.gamma || 2.0;
    w = mkGray(v, "exp(" + g + "*ln(max(" + lum + ", 1e-5)))", mkUnique(o.nuevaVista || ("mask_L_g" + Math.round(g * 10))));
    desc = "luminancia con gamma " + g + ": L^γ (γ > 1 baja medios y sombras). Donde la máscara es alta el proceso actúa; " +
           "para que actúe en medios y sombras y proteja lo brillante, aplicarla invertida (maskInverted = true)";
  } else if (tipo === "cielo") {
    var s = mkSky(v), lo = s.cielo + 1.5 * s.sigma, hi = s.cielo + 5 * s.sigma;
    w = mkGray(v, "1 - min(max((" + lum + " - " + lo + ") / " + (hi - lo) + ", 0), 1)", mkUnique(o.nuevaVista || "mask_cielo"));
    mkBlur(w, o.bin || 8);
    desc = "cielo: 1 en el fondo (por debajo de cielo + 1,5σ), 0 en la señal (por encima de 5σ), suavizada";
  } else if (tipo === "fondo_lhe") {
    w = mkGray(v, lum, mkUnique(o.nuevaVista || "mask_fondo_lhe"));
    mkBlur(w, o.bin || 32);   // L64 ≈ luminancia suavizada a ~64 px
    var P = new PixelMath; P.useSingleExpression = true; P.expression = "1 - min(max(($T - 0.20) / 0.25, 0), 1)";
    P.createNewImage = false; P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1; P.executeOn(w.mainView);
    desc = "fondo para LHE (nebulosa de emisión y reflexión): 1 − clip((L64 − 0,20)/0,25); protege la nebulosa brillante";
  } else throw new Error("Tipo de máscara desconocido: " + tipo + " (luminancia | cielo | fondo_lhe)");
  w.show();
  var cov = mkCoverage(w, v);
  return { vista: w.mainView.id, original: viewId, tipo: tipo, descripcion: desc, cobertura: cov,
           como_aplicar: "ImageWindow.windowById(\"" + viewId + "\").mask = ImageWindow.windowById(\"" + w.mainView.id + "\");",
           control: { medido: cov,
                      revisar_a_ojo: ["ver la máscara con STF: cubre lo que debe (núcleo protegido, fondo incluido, estrellas si el proceso las daña)",
                                      "bordes de máscara (escalones, halos, costuras) en la imagen final"],
                      nota: "La zona más oscura no siempre es cielo limpio (IFN, polvo). Lo de revisar_a_ojo no lo mide esta función." } };
}
