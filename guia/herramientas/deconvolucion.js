// deconvolucion.js — BlurXTerminator completo (Paso 13 lineal) con la rejilla de la ficha y medidas. PJSR, ECMAScript 5.
//
// Uso (en el nivel superior del script):
//   eval(File.readTextFile("<ruta de guia>/herramientas/deconvolucion.js"));
//   var r = bxtCandidatos("MasterLight_spcc", { tipo: "nebulosa" });   // rejilla en un recorte, no toca la imagen
//   JSON.stringify(r);   // variantes con FWHM, ringing, gusanos y contraste; recomendada
//   // y después, con el valor elegido:
//   var a = bxtAplicar("MasterLight_spcc", { nonstellar: 0.45, stars: 0.30, nuevaVista: "MasterLight_bxt" });
//
// Opciones de bxtCandidatos:
//   tipo        "nebulosa" (por defecto) | "galaxia" | "cumulo" | "snr_bajo": fija el rango de partida de la ficha
//   nonstellar  lista de valores a probar (por defecto 0,25 / 0,45 / 0,65; galaxia 0,20 / 0,30 / 0,40...)
//   stars       sharpen stars (por defecto el de la tabla para el tipo)
//   halos       adjust star halos (0; −0,30 sólo con blue bloat y sin ringing)
//   recorte     lado del recorte (1500); centrado en la zona con más señal extensa
// Medidas por variante (sobre la luminancia del recorte):
//   fwhm_px     FWHM mediano de estrellas aisladas no saturadas (momentos de segundo orden)
//   ringing     mínimo del perfil radial de la estrella más brillante no saturada respecto a su fondo, en fracción
//               del pico (< −0,01 = anillo oscuro)
//   gusanos     energía de alta frecuencia en el fondo (fuera de estrellas) respecto a BXT con nonstellar 0: > 1,3 = textura nueva
//   contraste   ídem en el objeto (detalle que añade el nonstellar). Si apenas pasa de 1, el nonstellar no aporta en estos datos
// Recomendación: el nonstellar más alto sin ringing y con gusanos ≤ 1,3; si ninguno, el más bajo.

var DC_RANGOS = {
  nebulosa: { stars: 0.30, ns: [0.25, 0.45, 0.65] },
  galaxia:  { stars: 0.18, ns: [0.20, 0.30, 0.40] },
  cumulo:   { stars: 0.25, ns: [0.00, 0.10, 0.20] },
  snr_bajo: { stars: 0.15, ns: [0.10, 0.20, 0.25] }
};

function dcLum(view, R) {
  var im = view.image, n = R.width * R.height, L = new Float32Array(n), b = new Float32Array(n), nc = im.numberOfChannels;
  for (var c = 0; c < nc; ++c) { im.getSamples(b, R, c); for (var i = 0; i < n; ++i) L[i] += b[i] / nc; }
  return L;
}

function dcStats(a) {
  var s = [];
  for (var i = 0; i < a.length; i += 7) s.push(a[i]);
  s.sort(function (x, y) { return x - y; });
  var med = s[s.length >> 1], d = [];
  for (var j = 0; j < s.length; j += 2) d.push(Math.abs(s[j] - med));
  d.sort(function (x, y) { return x - y; });
  return { med: med, sigma: 1.4826 * d[d.length >> 1] };
}

// Estrellas: máximos locales aislados, no saturados, muy por encima del fondo. FWHM por momentos.
function dcStars(L, W, H, st) {
  var out = [], thr = st.med + 25 * st.sigma, r = 6;
  for (var y = r; y < H - r; y += 1)
    for (var x = r; x < W - r; x += 1) {
      var k = y * W + x, p = L[k];
      if (p < thr || p > 0.85) continue;
      var isMax = true;
      for (var dy = -3; dy <= 3 && isMax; ++dy) for (var dx = -3; dx <= 3; ++dx) if ((dx || dy) && L[k + dy * W + dx] > p) { isMax = false; break; }
      if (!isMax) continue;
      var sw = 0, sxx = 0, syy = 0;
      for (var dy2 = -r; dy2 <= r; ++dy2)
        for (var dx2 = -r; dx2 <= r; ++dx2) {
          var w = L[k + dy2 * W + dx2] - st.med;
          if (w <= 0) continue;
          sw += w; sxx += w * dx2 * dx2; syy += w * dy2 * dy2;
        }
      if (sw <= 0) continue;
      var sig = Math.sqrt(0.5 * (sxx + syy) / sw);
      out.push({ x: x, y: y, p: p, fwhm: 2.3548 * sig });
      x += r;
    }
  return out;
}

function dcRinging(L, W, H, s, bg) {
  var prof = [], cnt = [];
  for (var i = 0; i <= 15; ++i) { prof.push(0); cnt.push(0); }
  for (var dy = -15; dy <= 15; ++dy)
    for (var dx = -15; dx <= 15; ++dx) {
      var x = s.x + dx, y = s.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      var rr = Math.round(Math.sqrt(dx * dx + dy * dy));
      if (rr > 15) continue;
      prof[rr] += L[y * W + x]; ++cnt[rr];
    }
  for (var j = 0; j <= 15; ++j) prof[j] /= Math.max(1, cnt[j]);
  var local = (prof[13] + prof[14] + prof[15]) / 3, mn = 0;
  for (var q = 2; q <= 12; ++q) mn = Math.min(mn, (prof[q] - local) / Math.max(1e-6, prof[0] - local));
  return mn;
}

// FWHM por momentos en una posición fija (para medir las MISMAS estrellas antes y después).
function dcFwhmAt(L, W, s, bg) {
  var r = 6, k = s.y * W + s.x, sw = 0, sxx = 0, syy = 0;
  for (var dy = -r; dy <= r; ++dy)
    for (var dx = -r; dx <= r; ++dx) {
      var w = L[k + dy * W + dx] - bg;
      if (w <= 0) continue;
      sw += w; sxx += w * dx * dx; syy += w * dy * dy;
    }
  return sw > 0 ? 2.3548 * Math.sqrt(0.5 * (sxx + syy) / sw) : null;
}

// Máscara de estrellas (radio 8 px) para que el detalle y los gusanos se midan fuera de ellas.
function dcStarMask(stars, W, H) {
  var m = new Uint8Array(W * H), r = 8;
  for (var i = 0; i < stars.length; ++i)
    for (var dy = -r; dy <= r; ++dy)
      for (var dx = -r; dx <= r; ++dx) {
        var x = stars[i].x + dx, y = stars[i].y + dy;
        if (x >= 0 && y >= 0 && x < W && y < H) m[y * W + x] = 1;
      }
  return m;
}

// Energía de alta frecuencia (|x − media 3×3|) fuera de las estrellas, en el fondo y en el objeto.
function dcHighFreq(L, W, H, st, mask) {
  var bgE = 0, bgN = 0, obE = 0, obN = 0, lo = st.med + 2 * st.sigma, hi = st.med + 6 * st.sigma;
  for (var y = 1; y < H - 1; y += 2)
    for (var x = 1; x < W - 1; x += 2) {
      var k = y * W + x;
      if (mask[k]) continue;
      var m = 0;
      for (var dy = -1; dy <= 1; ++dy) for (var dx = -1; dx <= 1; ++dx) m += L[k + dy * W + dx];
      var e = Math.abs(L[k] - m / 9);
      if (L[k] < lo) { bgE += e; ++bgN; } else if (L[k] > hi && L[k] < 0.5) { obE += e; ++obN; }
    }
  return { fondo: bgN ? bgE / bgN : 0, objeto: obN ? obE / obN : 0 };
}

function dcMeasure(view, R, base) {
  var W = R.width, H = R.height, L = dcLum(view, R), st = base ? base.st : dcStats(L);
  var stars = base ? base.stars : dcStars(L, W, H, st);
  var mask = base ? base.mask : dcStarMask(stars, W, H);
  var f = [];
  for (var i = 0; i < stars.length && f.length < 400; ++i) { var v = dcFwhmAt(L, W, stars[i], st.med); if (v !== null) f.push(v); }
  f.sort(function (a, b) { return a - b; });
  var bright = null;
  for (var j = 0; j < stars.length; ++j) if (!bright || stars[j].p > bright.p) bright = stars[j];
  return { st: st, stars: stars, mask: mask, estrellas: stars.length, fwhm_px: f.length ? +f[f.length >> 1].toFixed(2) : null,
           ringing: bright ? +dcRinging(L, W, H, bright, st.med).toFixed(3) : null, hf: dcHighFreq(L, W, H, st, mask) };
}
// Recorte representativo: el bloque con más señal extensa (mediana alta) sin tocar los bordes.
function dcCropRect(view, S) {
  var im = view.image, W = im.width, H = im.height;
  if (W <= S || H <= S) return new Rect(0, 0, W, H);
  var best = null, step = S >> 1, b = new Float32Array(64 * 64);
  for (var y0 = step >> 1; y0 + S <= H - (step >> 1); y0 += step)
    for (var x0 = step >> 1; x0 + S <= W - (step >> 1); x0 += step) {
      var cx = x0 + (S >> 1) - 32, cy = y0 + (S >> 1) - 32;
      im.getSamples(b, new Rect(cx, cy, cx + 64, cy + 64), 0);
      var v = []; for (var i = 0; i < b.length; i += 4) v.push(b[i]);
      v.sort(function (p, q) { return p - q; });
      var m = v[v.length >> 1];
      if (!best || m > best.m) best = { x: x0, y: y0, m: m };
    }
  return best ? new Rect(best.x, best.y, best.x + S, best.y + S) : new Rect(0, 0, S, S);
}

function dcCropWindow(view, R, id) {
  var im = view.image; im.resetSelections();
  var old = ImageWindow.windowById(id); if (!old.isNull) old.forceClose();
  var w = new ImageWindow(R.width, R.height, im.numberOfChannels, 32, true, im.isColor, id);
  w.mainView.beginProcess(); w.mainView.image.assign(im, R); w.mainView.endProcess();
  return w;
}

function dcBXT(view, stars, ns, halos) {
  var B = new BlurXTerminator;
  B.correct_only = false;
  B.auto_nonstellar_psf = true;
  B.sharpen_stars = stars;
  B.adjust_star_halos = halos;
  B.sharpen_nonstellar = ns;
  B.overlap = 0.20;
  if (!B.executeOn(view)) throw new Error("BXT falló (nonstellar " + ns + ")");
}

function bxtCandidatos(viewId, o) {
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);   // también vale la View o el resultado de otra función ({ vista: ... })
  o = o || {};
  var v = View.viewById(viewId);
  if (!v || v.isNull) throw new Error("No existe la vista " + viewId);
  v.image.resetSelections();
  if (v.image.median() > 0.05) throw new Error("La imagen parece estirada: BXT va en lineal (después de SPCC)");
  var rg = DC_RANGOS[o.tipo || "nebulosa"] || DC_RANGOS.nebulosa;
  var nsList = o.nonstellar || rg.ns, stars = (o.stars !== undefined) ? o.stars : rg.stars, halos = o.halos || 0;
  var R = dcCropRect(v, o.recorte || 1500), t0 = Date.now();
  var CR = new Rect(0, 0, R.width, R.height);
  var w0 = dcCropWindow(v, R, "BXTc_original"), base = dcMeasure(w0.mainView, CR);
  // Referencia con nonstellar 0: gusanos y contraste se miden respecto a ella, para aislar el efecto del nonstellar
  // (frente a la original, el cambio lo dominan las estrellas y el correct only).
  var wr = dcCropWindow(v, R, "BXTc_ref0");
  dcBXT(wr.mainView, stars, 0, halos);
  var ref = dcMeasure(wr.mainView, CR, base);
  wr.forceClose();
  var variantes = [];
  for (var i = 0; i < nsList.length; ++i) {
    var id = "BXTc_ns" + Math.round(nsList[i] * 100);
    var w = dcCropWindow(v, R, id);
    dcBXT(w.mainView, stars, nsList[i], halos);
    var m = dcMeasure(w.mainView, CR, base);
    variantes.push({ vista: id, nonstellar: nsList[i], stars: stars, halos: halos,
                     fwhm_px: m.fwhm_px, ringing: m.ringing,
                     gusanos: ref.hf.fondo > 0 ? +(m.hf.fondo / ref.hf.fondo).toFixed(3) : null,
                     contraste: ref.hf.objeto > 0 ? +(m.hf.objeto / ref.hf.objeto).toFixed(3) : null });
    if (!o.dejarRecortes) w.forceClose();
  }
  if (!o.dejarRecortes) w0.forceClose();
  var rec = null;
  for (var j = variantes.length - 1; j >= 0; --j) {
    var c = variantes[j];
    if ((c.ringing === null || c.ringing >= -0.01) && (c.gusanos === null || c.gusanos <= 1.3)) { rec = c; break; }
  }
  var motivo = rec ? "nonstellar más alto sin ringing y sin textura nueva en el fondo" :
                     "todas tienen ringing o gusanos: se recomienda el valor más bajo y revisar a ojo";
  if (!rec) rec = variantes[0];
  return {
    original: viewId, recorte: [R.left, R.top, R.width, R.height], tipo: o.tipo || "nebulosa",
    sin_bxt: { fwhm_px: base.fwhm_px, estrellas_medidas: base.estrellas, ringing: base.ringing },
    variantes: variantes, recomendada: { nonstellar: rec.nonstellar, stars: rec.stars, halos: rec.halos, motivo: motivo },
    segundos: Math.round((Date.now() - t0) / 1000),
    control: {
      medido: { fwhm_baja: rec.fwhm_px !== null && base.fwhm_px !== null && rec.fwhm_px < base.fwhm_px,
                sin_ringing: rec.ringing === null || rec.ringing >= -0.01,
                sin_gusanos_medidos: rec.gusanos === null || rec.gusanos <= 1.3 },
      revisar_a_ojo: ["gusanos y textura 'crujiente' al 100 % en el objeto débil", "franjas de color en estrellas (canales desalineados)",
                      "núcleos saturados casi blancos (estrellas brillantes)"],
      nota: "Siguiente: bxtAplicar(vista, {nonstellar, stars, halos}) con la recomendada (o la que elija el usuario). " +
            "Si BXT crea gusanos, NXT los acentúa: bajar BXT, no subir NXT. Lo de revisar_a_ojo no lo mide esta función."
    }
  };
}

function bxtAplicar(viewId, o) {
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);   // también vale la View o el resultado de otra función ({ vista: ... })
  o = o || {};
  var src = ImageWindow.windowById(viewId);
  if (src.isNull) throw new Error("No existe la vista " + viewId);
  var im = src.mainView.image; im.resetSelections();
  var base = (typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_bxt"), id = base;
  for (var n = 2; !ImageWindow.windowById(id).isNull; ++n) id = base + "_" + n;
  var w = new ImageWindow(im.width, im.height, im.numberOfChannels, 32, true, im.isColor, id);
  w.mainView.beginProcess(); w.mainView.image.assign(im); w.mainView.endProcess();
  if (src.hasAstrometricSolution) w.copyAstrometricSolution(src);
  w.show();
  var t0 = Date.now();
  dcBXT(w.mainView, (o.stars !== undefined) ? o.stars : 0.30, (o.nonstellar !== undefined) ? o.nonstellar : 0.45, o.halos || 0);
  var R = new Rect(0, 0, im.width, im.height), seg = Math.round((Date.now() - t0) / 1000);
  var a = dcMeasure(src.mainView, R), d = dcMeasure(w.mainView, R, a);
  return { vista: id, original: viewId, nonstellar: o.nonstellar, stars: o.stars, halos: o.halos || 0, segundos: seg,
           fwhm_antes: a.fwhm_px, fwhm_despues: d.fwhm_px, ringing: d.ringing,
           alta_frecuencia_fondo_vs_original: a.hf.fondo > 0 ? +(d.hf.fondo / a.hf.fondo).toFixed(2) : null,
           nota: "alta_frecuencia_fondo_vs_original incluye el efecto de BXT en estrellas débiles y del correct only; los gusanos " +
                 "del nonstellar se juzgan con bxtCandidatos (respecto a nonstellar 0)." };
}
