// mascaras.js — Máscaras del Paso 4 no lineal en una sola llamada, con su cobertura medida. PJSR, ECMAScript 5.
//
// Uso (en el nivel superior del script):
//   eval(File.readTextFile("<ruta de guia>/herramientas/mascaras.js"));
//   var m = crearMascara("Starless_st", { tipo: "luminancia", gamma: 2.0 });   // LHE (1,5 para HDRMT)
//   var c = crearMascara("Starless_st", { tipo: "cielo" });                    // cielo: rampa de 1,5σ a 5σ, suavizada
//   var f = crearMascara("Starless_st", { tipo: "fondo_lhe" });                // 1 − clip((L64 − 0,20)/0,25)
//   var k = crearMascara("Starless_st", { tipo: "color", tono: "rojo" });       // por tono (rojo, cian, azul... o grados)
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
    var g = o.gamma || 2.0, mid = mkUnique((typeof o.nuevaVista === "string" && o.nuevaVista) || ("mask_L_g" + Math.round(g * 10)));
    if (o.normalizar) {
      // Luminancia llevada a 0–1 (mín–máx) antes de la gamma: en imágenes con poco rango la máscara sí separa lo brillante.
      w = mkGray(v, lum, mid);
      var Rz = new Rescale; Rz.mode = (Rescale.RGBK !== undefined) ? Rescale.RGBK : Rescale.prototype.RGBK; Rz.executeOn(w.mainView);
      var Pg = new PixelMath; Pg.useSingleExpression = true; Pg.expression = "exp(" + g + "*ln(max($T, 1e-5)))";
      Pg.truncate = true; Pg.truncateLower = 0; Pg.truncateUpper = 1; Pg.executeOn(w.mainView);
    } else
      w = mkGray(v, "exp(" + g + "*ln(max(" + lum + ", 1e-5)))", mid);
    desc = "luminancia" + (o.normalizar ? " normalizada" : "") + " con gamma " + g + ": L^γ (γ > 1 baja medios y sombras). Donde la máscara es alta el proceso actúa; " +
           "para que actúe en medios y sombras y proteja lo brillante, aplicarla invertida (maskInverted = true)";
  } else if (tipo === "cielo") {
    var s = mkSky(v), lo = s.cielo + 1.5 * s.sigma, hi = s.cielo + 5 * s.sigma;
    w = mkGray(v, "1 - min(max((" + lum + " - " + lo + ") / " + (hi - lo) + ", 0), 1)", mkUnique((typeof o.nuevaVista === "string" && o.nuevaVista) || "mask_cielo"));
    mkBlur(w, o.bin || 8);
    desc = "cielo: 1 en el fondo (por debajo de cielo + 1,5σ), 0 en la señal (por encima de 5σ), suavizada";
  } else if (tipo === "fondo_lhe") {
    w = mkGray(v, lum, mkUnique((typeof o.nuevaVista === "string" && o.nuevaVista) || "mask_fondo_lhe"));
    mkBlur(w, o.bin || 32);   // L64 ≈ luminancia suavizada a ~64 px
    var P = new PixelMath; P.useSingleExpression = true; P.expression = "1 - min(max(($T - 0.20) / 0.25, 0), 1)";
    P.createNewImage = false; P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1; P.executeOn(w.mainView);
    desc = "fondo para LHE (nebulosa de emisión y reflexión): 1 − clip((L64 − 0,20)/0,25); protege la nebulosa brillante";
  } else if (tipo === "color") {
    // Máscara por tono (lámina «ajustes locales»): 1 en los píxeles del tono pedido con color claro, 0 en el resto. Para
    // ajustes locales por color (zonas de Hα rojas, regiones azules, OIII cian) con aplicarConMascara.
    if (v.image.numberOfChannels !== 3) throw new Error("La máscara por color necesita una imagen RGB");
    var tonos = { rojo: 0, naranja: 30, amarillo: 60, verde: 120, cian: 180, azul: 240, magenta: 300 };
    var tono = typeof o.tono === "number" ? o.tono : tonos[String(o.tono || "").toLowerCase()];
    if (tono === undefined) throw new Error("tono desconocido: " + o.tono + " (" + Object.keys(tonos).join(", ") + " o grados)");
    var ancho = o.ancho || 30, im = v.image, W = im.width, H = im.height, n = W * H, R = new Rect(0, 0, W, H);
    var ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], m = new Float32Array(n);
    for (var c = 0; c < 3; ++c) im.getSamples(ch[c], R, c);
    for (var i = 0; i < n; ++i) {
      var r = ch[0][i], g = ch[1][i], b = ch[2][i], mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
      if (d <= 0 || mx <= 0) continue;
      var h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360;
      var dh = Math.abs(h - tono) % 360; if (dh > 180) dh = 360 - dh;
      if (dh >= ancho) continue;
      var croma = d / mx, pesoC = Math.max(0, Math.min(1, (croma - 0.05) / 0.15));   // sin color claro (cielo, núcleos): 0
      m[i] = pesoC * 0.5 * (1 + Math.cos(Math.PI * dh / ancho));
    }
    var mid2 = mkUnique((typeof o.nuevaVista === "string" && o.nuevaVista) || ("mask_color_" + String(o.tono)));
    w = new ImageWindow(W, H, 1, 32, true, false, mid2);
    w.mainView.beginProcess(); w.mainView.image.setSamples(m, R, 0); w.mainView.endProcess();
    if (o.bin !== 0) mkBlur(w, o.bin || 4);
    desc = "color: 1 en el tono " + tono + "° (± " + ancho + "°) con croma > 0,2, 0 en el resto y en lo casi gris (cielo neutro, núcleos), suavizada";
  } else throw new Error("Tipo de máscara desconocido: " + tipo + " (luminancia | cielo | fondo_lhe | color)");
  w.show();
  var cov = mkCoverage(w, v);
  return { vista: w.mainView.id, original: viewId, tipo: tipo, descripcion: desc, cobertura: cov,
           como_aplicar: "ImageWindow.windowById(\"" + viewId + "\").mask = ImageWindow.windowById(\"" + w.mainView.id + "\");",
           control: { medido: cov,
                      revisar_a_ojo: ["ver la máscara con STF: cubre lo que debe (núcleo protegido, fondo incluido, estrellas si el proceso las daña)",
                                      "bordes de máscara (escalones, halos, costuras) en la imagen final"],
                      nota: "La zona más oscura no siempre es cielo limpio (IFN, polvo). Lo de revisar_a_ojo no lo mide esta función." } };
}

// ---------------------------------------------------------------------------------------------------------------
// aplicarConMascara: aplica una operación a través de una máscara y mide lo que ha pasado.
//
//   aplicarConMascara("Starless_st", { mascara: "mask_fondo_lhe", operacion: { tipo: "lhe", radio: 128, amount: 0.3 } });
//   aplicarConMascara("M31_st", { mascara: "mask_L_g20", invertir: true, objetivo: "fondo",
//                                 operacion: { tipo: "saturacion", factor: 1.3 }, fuerza: 0.8 });
//
// Resultado = original·(1 − k·m) + procesado·k·m, con m la máscara (invertida si se pide) y k la fuerza. Es lo
// mismo que hace PixInsight con una máscara en la ventana, pero en una copia nueva (<vista>_m), sin riesgo de dejar
// la máscara puesta o invertida, y con medidas:
//   - mascara: media en el cielo y en lo brillante, cobertura, % en transición y salto máximo por píxel (borde duro);
//   - efecto: cambio medio (luminancia) donde m > 0,8 y fuga donde m < 0,05 (debería ser ~0);
//   - objetivo ("fondo" | "brillante"): si se da, avisa cuando la máscara es mayor en la otra zona (¿invertida?).
// Operaciones: curvas { K: [[x, y], ...] } · saturacion { factor } · lhe { radio, amount, slope }.

function amCopy(view, id) {
  var im = view.image, src = view.window;
  var w = new ImageWindow(im.width, im.height, im.numberOfChannels, src.bitsPerSample, src.isFloatSample, im.isColor, id);
  w.mainView.beginProcess();
  w.mainView.image.assign(im);
  w.mainView.endProcess();
  return w;
}

function amOperar(view, op) {
  var t = op.tipo;
  if (t === "curvas") {
    if (!op.K || op.K.length < 2) throw new Error("curvas: falta K, p. ej. [[0,0],[0.5,0.55],[1,1]]");
    var C = new CurvesTransformation; C.K = op.K;
    if (!C.executeOn(view)) throw new Error("CurvesTransformation falló");
    return "curvas K " + JSON.stringify(op.K);
  }
  if (t === "saturacion") {
    var f = op.factor || 1.2;
    if (view.image.numberOfChannels !== 3) throw new Error("saturacion: la vista no es de color");
    var P = new PixelMath; P.useSingleExpression = true;
    P.expression = "L = ($T[0]+$T[1]+$T[2])/3; L + " + f + "*($T - L)";
    P.symbols = "L"; P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1;
    if (!P.executeOn(view)) throw new Error("PixelMath de saturación falló");
    return "saturación ×" + f + " alrededor de la luminancia";
  }
  if (t === "lhe") {
    var H = new LocalHistogramEqualization;
    H.radius = op.radio || 64; H.slopeLimit = op.slope || 2.0; H.amount = (op.amount !== undefined) ? op.amount : 0.3;
    if (!H.executeOn(view)) throw new Error("LocalHistogramEqualization falló");
    return "LHE radio " + H.radius + ", slope " + H.slopeLimit + ", amount " + H.amount;
  }
  throw new Error("operacion.tipo desconocido: " + t + " (curvas | saturacion | lhe)");
}

function amStats(arr) {
  if (!arr.length) return { media: null, p99: null };
  var s = 0; for (var i = 0; i < arr.length; ++i) s += arr[i];
  arr.sort(function (a, b) { return a - b; });
  return { media: s / arr.length, p99: arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.99))] };
}

function aplicarConMascara(viewId, o) {
  viewId = mkId(viewId); o = o || {};
  var v = View.viewById(viewId);
  if (!v || v.isNull) throw new Error("No existe la vista " + viewId);
  var mId = mkId(o.mascara), mv = View.viewById(mId);
  if (!mId || !mv || mv.isNull) throw new Error("Falta la máscara (opciones.mascara = id de una vista gris; ver crearMascara)");
  if (mv.image.width !== v.image.width || mv.image.height !== v.image.height)
    throw new Error("La máscara (" + mv.image.width + "×" + mv.image.height + ") no tiene el tamaño de la vista (" +
                    v.image.width + "×" + v.image.height + ")");
  if (mv.image.numberOfChannels !== 1) throw new Error("La máscara debe ser gris (1 canal)");
  var op = o.operacion || {}, k = (o.fuerza !== undefined) ? o.fuerza : 1.0, inv = o.invertir === true;
  if (!(k > 0 && k <= 1)) throw new Error("fuerza debe estar entre 0 y 1");

  // 1. Operación sobre una copia oculta, sin máscara.
  var proc = amCopy(v, mkUnique(viewId + "_proc_tmp")), desc;
  try { desc = amOperar(proc.mainView, op); } catch (e) { proc.forceClose(); throw e; }

  // 2. Mezcla a través de la máscara en otra copia (la que se entrega).
  var outId = mkUnique((typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_m"));
  var out = amCopy(v, outId), mexpr = inv ? "(1 - " + mId + ")" : mId;
  var P = new PixelMath; P.useSingleExpression = true;
  P.expression = "$T*(1 - " + k + "*" + mexpr + ") + " + proc.mainView.id + "*" + k + "*" + mexpr;
  P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1;
  var ok = P.executeOn(out.mainView);
  proc.forceClose();
  if (!ok) { out.forceClose(); throw new Error("PixelMath de la mezcla falló"); }

  // 3. Medidas sobre una rejilla de píxeles (paso s).
  var W = v.image.width, Hh = v.image.height, nc = v.image.numberOfChannels, s = Math.max(2, Math.round(Math.sqrt(W * Hh / 2.0e6)));
  var row0 = new Float32Array(W), row1 = new Float32Array(W), rowm = new Float32Array(W), prevm = null;
  var dHigh = [], dLow = [], dMid = [], nTrans = 0, nTot = 0, saltos = [];
  for (var y = 0; y < Hh; y += s) {
    var R = new Rect(0, y, W, y + 1);
    mv.image.getSamples(rowm, R, 0);
    var d = new Float32Array(W);
    for (var c = 0; c < nc; ++c) {
      v.image.getSamples(row0, R, c); out.mainView.image.getSamples(row1, R, c);
      for (var x = 0; x < W; x += s) d[x] += Math.abs(row1[x] - row0[x]) / nc;
    }
    for (var x2 = 0; x2 < W; x2 += s) {
      var m = inv ? 1 - rowm[x2] : rowm[x2]; ++nTot;
      if (m > 0.8) dHigh.push(d[x2]); else if (m < 0.05) dLow.push(d[x2]); else dMid.push(d[x2]);
      if (m > 0.05 && m < 0.95) ++nTrans;
      if (x2 >= s) saltos.push(Math.abs(rowm[x2] - rowm[x2 - s]) / s);
      if (prevm) saltos.push(Math.abs(rowm[x2] - prevm[x2]) / s);
    }
    prevm = new Float32Array(rowm);
  }
  var eH = amStats(dHigh), eL = amStats(dLow), sal = amStats(saltos);
  var cov = mkCoverage(mv.window, v);
  if (inv) cov = { cobertura_pct: +(100 - cov.cobertura_pct).toFixed(1), media_en_cielo: +(1 - cov.media_en_cielo).toFixed(3),
                   media_en_lo_brillante: +(1 - cov.media_en_lo_brillante).toFixed(3) };
  var fugaRel = (eH.media > 0 && eL.media !== null) ? 100 * eL.media / eH.media : null;
  var med = {
    mascara: { media_en_cielo: cov.media_en_cielo, media_en_lo_brillante: cov.media_en_lo_brillante, cobertura_pct: cov.cobertura_pct,
               transicion_pct: +(100 * nTrans / nTot).toFixed(1), salto_p99_por_px: sal.p99 !== null ? +sal.p99.toFixed(4) : null },
    efecto: { cambio_medio_zona_m_alta: eH.media !== null ? +eH.media.toFixed(5) : null, pix_zona_m_alta_pct: +(100 * dHigh.length / nTot).toFixed(1),
              fuga_media_zona_m_baja: eL.media !== null ? +eL.media.toFixed(6) : null, fuga_p99: eL.p99 !== null ? +eL.p99.toFixed(5) : null,
              fuga_rel_pct: fugaRel !== null ? +fugaRel.toFixed(2) : null, pix_zona_m_baja_pct: +(100 * dLow.length / nTot).toFixed(1) }
  };
  var nc2 = [];
  if (eH.media === null || dHigh.length < 50) nc2.push("casi no hay zona con máscara > 0,8: el efecto apenas se aplica en ningún sitio");
  else if (eH.media < 1e-4) nc2.push("el efecto es casi nulo donde la máscara está activa (operación demasiado suave)");
  if (fugaRel !== null && fugaRel > 5 && eL.media > 2e-4) nc2.push("fuga: donde la máscara protege (< 0,05) el cambio es el " + fugaRel.toFixed(1) + " % del efecto; la máscara no llega a 0");
  if (sal.p99 !== null && sal.p99 > 0.05) nc2.push("borde duro: la máscara salta " + sal.p99.toFixed(3) + " por píxel (p99); suavizarla para no crear escalones");
  if (dLow.length < 0.001 * nTot)
    nc2.push("la máscara no protege nada: en ningún sitio baja de 0,05; lo brillante recibe el " + Math.round(100 * cov.media_en_lo_brillante) +
             " % del efecto (para proteger, una máscara con más contraste: luminancia con normalizar, otra gamma o fondo_lhe)");
  if (Math.abs(cov.media_en_cielo - cov.media_en_lo_brillante) < 0.3)
    nc2.push("la máscara apenas distingue el cielo de lo brillante (" + cov.media_en_cielo + " frente a " + cov.media_en_lo_brillante + ")");
  if (o.objetivo === "fondo" && cov.media_en_cielo < cov.media_en_lo_brillante) nc2.push("objetivo fondo pero la máscara es mayor en lo brillante: ¿falta invertir?");
  if (o.objetivo === "brillante" && cov.media_en_lo_brillante < cov.media_en_cielo) nc2.push("objetivo brillante pero la máscara es mayor en el cielo: ¿falta invertir?");
  out.show();
  return { vista: outId, original: viewId, mascara: mId, invertida: inv, fuerza: k, operacion: desc,
           formula: "original·(1 − k·m) + procesado·k·m", medidas: med, no_cumple: nc2,
           control: { revisar_a_ojo: ["bordes de la zona tratada al 100 % (escalones, halos claros u oscuros)",
                                      "comparar con la original en las mismas zonas (previa con el mismo rect)"],
                      nota: "La fuga mide si la máscara llega a 0 donde debe proteger; un borde duro (> 0,05/px) se ve como escalón." } };
}
