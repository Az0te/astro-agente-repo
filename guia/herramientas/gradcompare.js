// gradcompare.js — Métricas para comparar correcciones de gradiente. PJSR, ECMAScript 5.
//
// Uso:
//   eval(File.readTextFile("<carpeta del repo>/guia/herramientas/gradcompare.js"));
// Funciona con el watcher clásico (ES5) y con el v8: las constantes de los procesos se leen con gcK(),
// porque en v8 están en el constructor (PixelMath.Gray) y en el motor clásico en .prototype.
//   var base = gcPrepare("master", 8);            // luminancia binada (mediana) del original
//   var m = gcMetrics(base, "GC_GraXpert_AI_s01", 8);   // métricas de una corrección
//   var p = gcPlaneMetrics(base);                 // control: plano robusto de grado 1
//   var c = gcStructCopy(base, "GC_GraXpert_SF_esc10_model");  // LA MEDIDA MÁS FIABLE (ver abajo)
//
// gcStructCopy: qué parte de la estructura de gran escala del original (sin estrellas y sin un gradiente
//   liso de grado 2) aparece copiada en el modelo de fondo. Devuelve {copy, corr}. corr > 0,5 = el modelo
//   reproduce la forma del objeto (se lo come); < 0,15 = modelo limpio. No necesita máscara del objeto,
//   así que sirve en nebulosas que llenan el campo y en nebulosas oscuras. Comprobarlo SIEMPRE a la vista
//   con el modelo menos su gradiente liso (estructura en el modelo = señal perdida).
// Las métricas eat/keep/flat/ring dependen de la máscara automática del objeto, que en campos llenos de
//   nebulosa o con estrellas muy brillantes marca estrellas o el campo entero (IC 63: 98 %): no fiarse ahí.
//
// Todo se mide sobre la luminancia (media de canales) binada con mediana (quita estrellas)
// y en las mismas unidades que la imagen. Métricas:
//   eat      fracción de la señal de gran escala del objeto que ha ido a parar al modelo
//            (0 = nada; 0,3 = se ha comido el 30 %). Regresión de (original − corregida, sin su plano)
//            sobre la señal del objeto que queda en la corregida.
//   contrast contraste objeto−cielo de la corregida respecto al del control de plano (1 = igual).
//   flat     rango de las medianas de cielo en una rejilla 8×8, en unidades de ruido del cielo binado.
//   ring     cielo junto al objeto menos cielo lejano, en unidades de ruido (negativo = anillo oscuro).
//   objFrac  fracción del campo marcada como objeto.


// Constante de un proceso en los dos motores de PJSR (v8: Clase.X; clásico: Clase.prototype.X).
function gcK(C, name) {
  if (C[name] !== undefined) return C[name];
  if (C.prototype && C.prototype[name] !== undefined) return C.prototype[name];
  throw new Error('Constante no encontrada: ' + name);
}

function gcLumBinned(viewId, bin) {
  var v = View.viewById(viewId);
  if (!v || v.isNull) throw new Error('No existe la vista ' + viewId);
  try { return gcLumBinnedNative(v, bin); }
  catch (e) { Console.warningln('gcLumBinned: binado nativo falló (' + e + '); uso JS'); return gcLumBinnedJS(v, bin); }
}

// luminancia con PixelMath a una imagen gris nueva, IntegerResample con mediana y lectura de las muestras
function gcLumBinnedNative(v, bin) {
  var id = 'gc_tmp_lum';
  var old = View.viewById(id); if (old && !old.isNull) old.window.forceClose();
  var nc = v.image.numberOfChannels;
  var PM = new PixelMath;
  PM.expression = nc >= 3 ? '($T[0]+$T[1]+$T[2])/3' : '$T';
  PM.useSingleExpression = true;
  PM.createNewImage = true; PM.showNewImage = false; PM.newImageId = id;
  PM.newImageWidth = 0; PM.newImageHeight = 0;
  PM.newImageColorSpace = gcK(PixelMath, 'Gray');
  PM.newImageSampleFormat = gcK(PixelMath, 'f32');
  PM.rescale = false; PM.truncate = false;
  if (!PM.executeOn(v, false)) throw new Error('PixelMath no se ejecutó');
  var g = View.viewById(id);
  if (!g || g.isNull) throw new Error('no se creó ' + id);
  try {
    var IR = new IntegerResample;
    IR.zoomFactor = -bin;
    IR.downsamplingMode = gcK(IntegerResample, 'Median');
    if (!IR.executeOn(g, false)) throw new Error('IntegerResample no se ejecutó');
    var im = g.image, w = im.width, h = im.height;
    var out = new Float32Array(w * h), row = new Float32Array(w);
    for (var y = 0; y < h; y++) {
      im.getSamples(row, new Rect(0, y, w, y + 1), 0);
      for (var x = 0; x < w; x++) out[y * w + x] = row[x];
    }
    return { a: out, w: w, h: h };
  } finally { g.window.forceClose(); }
}

function gcLumBinnedJS(v, bin) {
  var im = v.image;
  var W = im.width, H = im.height, nc = im.numberOfChannels;
  var w = Math.floor(W / bin), h = Math.floor(H / bin);
  var out = new Float32Array(w * h);
  var row = new Float32Array(W);
  var block = [];
  var rows = [];
  for (var by = 0; by < h; by++) {
    rows.length = 0;
    for (var k = 0; k < bin; k++) {
      var y = by * bin + k;
      var acc = new Float32Array(W);
      for (var c = 0; c < nc; c++) {
        im.getSamples(row, new Rect(0, y, W, y + 1), c);
        for (var x2 = 0; x2 < W; x2++) acc[x2] += row[x2] / nc;
      }
      rows.push(acc);
    }
    for (var bx = 0; bx < w; bx++) {
      block.length = 0;
      for (var r = 0; r < bin; r++) {
        var rr = rows[r];
        for (var q = 0; q < bin; q++) block.push(rr[bx * bin + q]);
      }
      block.sort(function (a, b) { return a - b; });
      out[by * w + bx] = 0.5 * (block[(block.length - 1) >> 1] + block[block.length >> 1]);
    }
    if ((by & 15) == 0) processEvents();
  }
  return { a: out, w: w, h: h };
}

function gcMedian(arr) {
  var b = Array.prototype.slice.call(arr);
  b.sort(function (x, y) { return x - y; });
  var n = b.length;
  if (n == 0) return NaN;
  return 0.5 * (b[(n - 1) >> 1] + b[n >> 1]);
}

function gcMAD(arr, med) {
  var d = new Float32Array(arr.length);
  for (var i = 0; i < arr.length; i++) d[i] = Math.abs(arr[i] - med);
  return 1.4826 * gcMedian(d);
}

// plano robusto de grado 1 sobre una rejilla de medianas, con rechazo iterativo (o con una máscara)
function gcPlane(img, mask) {
  var w = img.w, h = img.h, a = img.a;
  var gx = 24, gy = 16, pts = [];
  for (var j = 0; j < gy; j++) for (var i = 0; i < gx; i++) {
    var x0 = Math.floor(i * w / gx), x1 = Math.floor((i + 1) * w / gx);
    var y0 = Math.floor(j * h / gy), y1 = Math.floor((j + 1) * h / gy);
    var v = [];
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) {
      var p = y * w + x;
      if (!mask || !mask[p]) v.push(a[p]);
    }
    if (v.length > 0.3 * (x1 - x0) * (y1 - y0)) pts.push([(x0 + x1) / 2 / w - 0.5, (y0 + y1) / 2 / h - 0.5, gcMedian(v), true]);
  }
  var c = [0, 0, 0];
  for (var it = 0; it < 6; it++) {
    var S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], T = [0, 0, 0], n = 0;
    for (var k = 0; k < pts.length; k++) {
      if (!pts[k][3]) continue;
      var f = [1, pts[k][0], pts[k][1]];
      for (var r = 0; r < 3; r++) { T[r] += f[r] * pts[k][2]; for (var s = 0; s < 3; s++) S[r][s] += f[r] * f[s]; }
      n++;
    }
    if (n < 4) break;
    c = gcSolve3(S, T);
    var res = [];
    for (var k2 = 0; k2 < pts.length; k2++) if (pts[k2][3]) res.push(pts[k2][2] - (c[0] + c[1] * pts[k2][0] + c[2] * pts[k2][1]));
    var sd = gcMAD(res, gcMedian(res));
    var changed = false;
    for (var k3 = 0; k3 < pts.length; k3++) {
      var e = Math.abs(pts[k3][2] - (c[0] + c[1] * pts[k3][0] + c[2] * pts[k3][1]));
      var keep = e <= 2 * sd || sd == 0;
      if (keep != pts[k3][3]) changed = true;
      pts[k3][3] = keep;
    }
    if (!changed) break;
  }
  var P = new Float32Array(w * h);
  for (var y2 = 0; y2 < h; y2++) for (var x2 = 0; x2 < w; x2++) P[y2 * w + x2] = c[0] + c[1] * ((x2 + 0.5) / w - 0.5) + c[2] * ((y2 + 0.5) / h - 0.5);
  return P;
}

function gcSolve3(A, b) {
  var M = [[A[0][0], A[0][1], A[0][2], b[0]], [A[1][0], A[1][1], A[1][2], b[1]], [A[2][0], A[2][1], A[2][2], b[2]]];
  for (var i = 0; i < 3; i++) {
    var p = i;
    for (var r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    var t = M[i]; M[i] = M[p]; M[p] = t;
    for (var r2 = 0; r2 < 3; r2++) if (r2 != i) {
      var f = M[r2][i] / M[i][i];
      for (var c = i; c < 4; c++) M[r2][c] -= f * M[i][c];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

// desenfoque de caja separable, radio r, repetido 'n' veces (≈ gaussiana)
function gcBlur(a, w, h, r, n) {
  var src = new Float32Array(a), tmp = new Float32Array(w * h);
  for (var it = 0; it < (n || 3); it++) {
    for (var y = 0; y < h; y++) {
      var s = 0, cnt = 0, off = y * w;
      for (var x = -r; x < w; x++) {
        var xa = x + r; if (xa < w) { s += src[off + xa]; cnt++; }
        var xr = x - r - 1; if (xr >= 0) { s -= src[off + xr]; cnt--; }
        if (x >= 0) tmp[off + x] = s / cnt;
      }
    }
    for (var x2 = 0; x2 < w; x2++) {
      var s2 = 0, c2 = 0;
      for (var y2 = -r; y2 < h; y2++) {
        var ya = y2 + r; if (ya < h) { s2 += tmp[ya * w + x2]; c2++; }
        var yr = y2 - r - 1; if (yr >= 0) { s2 -= tmp[yr * w + x2]; c2--; }
        if (y2 >= 0) src[y2 * w + x2] = s2 / c2;
      }
    }
  }
  return src;
}

// polinomio de grado 2 ajustado sólo fuera de la máscara (rejilla de medianas, rechazo a 2,5σ)
function gcPoly2(img, excl) {
  var w = img.w, h = img.h, a = img.a;
  var gx = 32, gy = 22, pts = [];
  for (var j = 0; j < gy; j++) for (var i = 0; i < gx; i++) {
    var x0 = Math.floor(i * w / gx), x1 = Math.floor((i + 1) * w / gx);
    var y0 = Math.floor(j * h / gy), y1 = Math.floor((j + 1) * h / gy);
    var v = [];
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { var p = y * w + x; if (!excl[p]) v.push(a[p]); }
    if (v.length > 0.5 * (x1 - x0) * (y1 - y0)) pts.push({ x: (x0 + x1) / 2 / w - 0.5, y: (y0 + y1) / 2 / h - 0.5, z: gcMedian(v), ok: true });
  }
  function terms(x, y) { return [1, x, y, x * x, x * y, y * y]; }
  var c = [0, 0, 0, 0, 0, 0];
  for (var it = 0; it < 6; it++) {
    var A = [], b = [], k, r, q;
    for (r = 0; r < 6; r++) { A.push([0, 0, 0, 0, 0, 0]); b.push(0); }
    var n = 0;
    for (k = 0; k < pts.length; k++) {
      if (!pts[k].ok) continue;
      var t = terms(pts[k].x, pts[k].y);
      for (r = 0; r < 6; r++) { b[r] += t[r] * pts[k].z; for (q = 0; q < 6; q++) A[r][q] += t[r] * t[q]; }
      n++;
    }
    if (n < 8) break;
    c = gcSolveN(A, b);
    var res = [];
    for (k = 0; k < pts.length; k++) if (pts[k].ok) { var tt = terms(pts[k].x, pts[k].y), f = 0; for (r = 0; r < 6; r++) f += c[r] * tt[r]; res.push(pts[k].z - f); }
    var sd = gcMAD(res, gcMedian(res)), changed = false;
    for (k = 0; k < pts.length; k++) {
      var t2 = terms(pts[k].x, pts[k].y), f2 = 0; for (r = 0; r < 6; r++) f2 += c[r] * t2[r];
      var keep = sd == 0 || Math.abs(pts[k].z - f2) <= 2.5 * sd;
      if (keep != pts[k].ok) changed = true;
      pts[k].ok = keep;
    }
    if (!changed) break;
  }
  var P = new Float32Array(w * h);
  for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) {
    var X = (xx + 0.5) / w - 0.5, Y = (yy + 0.5) / h - 0.5;
    P[yy * w + xx] = c[0] + c[1] * X + c[2] * Y + c[3] * X * X + c[4] * X * Y + c[5] * Y * Y;
  }
  return P;
}

function gcSolveN(A, b) {
  var n = b.length, M = [], i, r, c;
  for (i = 0; i < n; i++) M.push(A[i].slice(0).concat([b[i]]));
  for (i = 0; i < n; i++) {
    var p = i;
    for (r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    var t = M[i]; M[i] = M[p]; M[p] = t;
    if (M[i][i] == 0) continue;
    for (r = 0; r < n; r++) if (r != i) { var f = M[r][i] / M[i][i]; for (c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
  }
  var x = [];
  for (i = 0; i < n; i++) x.push(M[i][i] != 0 ? M[i][n] / M[i][i] : 0);
  return x;
}

// base: luminancia binada del original, señal del objeto y máscaras
function gcPrepare(viewId, bin) {
  var O = gcLumBinned(viewId, bin || 8);
  var w = O.w, h = O.h, n = w * h, i;
  var excl = new Uint8Array(n), mask = new Uint8Array(n);
  var P, R = new Float32Array(n), Rl, noise = 0, sdl = 0, med = 0;
  for (var pass = 0; pass < 3; pass++) {
    P = gcPoly2(O, excl);
    for (i = 0; i < n; i++) R[i] = O.a[i] - P[i];
    Rl = gcBlur(R, w, h, 3, 3);
    // ruido fino y ruido de baja frecuencia, medidos sólo en el cielo
    var hf = [], lf = [];
    for (i = 0; i < n; i += 3) if (!excl[i]) { hf.push(R[i] - Rl[i]); lf.push(Rl[i]); }
    noise = gcMAD(hf, gcMedian(hf));
    med = gcMedian(lf); sdl = gcMAD(lf, med);
    for (i = 0; i < n; i++) mask[i] = (Math.abs(Rl[i] - med) > 3 * sdl) ? 1 : 0;
    // exclusión del ajuste = máscara ensanchada (alas del objeto)
    var mf = new Float32Array(n);
    for (i = 0; i < n; i++) mf[i] = mask[i];
    var bd = gcBlur(mf, w, h, Math.max(4, Math.round(Math.min(w, h) / 40)), 2);
    for (i = 0; i < n; i++) excl[i] = (mask[i] || bd[i] > 0.01) ? 1 : 0;
  }
  // zonas: junto al objeto (anillo de ancho ~1/15 del campo fuera de la exclusión) y cielo lejano
  var ef = new Float32Array(n), cnt = 0, cex = 0;
  for (i = 0; i < n; i++) { ef[i] = excl[i]; cnt += mask[i]; cex += excl[i]; }
  var rN = Math.max(4, Math.round(Math.min(w, h) / 25));
  var bn = gcBlur(ef, w, h, rN, 2);
  var near = new Uint8Array(n), far = new Uint8Array(n), nf = 0;
  for (i = 0; i < n; i++) { near[i] = (!excl[i] && bn[i] > 0.01) ? 1 : 0; far[i] = (!excl[i] && !near[i]) ? 1 : 0; nf += far[i]; }
  if (nf < 0.03 * n) Console.warningln('gcPrepare: poco cielo lejano (' + (100 * nf / n).toFixed(1) + ' %); el anillo es poco fiable');
  var sig = gcMeanMask(R, mask);
  return { id: viewId, bin: bin || 8, O: O, excl: excl, mask: mask, near: near, far: far, noise: noise, sdl: sdl,
    objFrac: cnt / n, exclFrac: cex / n, signal: sig, R: R };
}

function gcMeanMask(a, m) { var s = 0, c = 0; for (var i = 0; i < a.length; i++) if (m[i]) { s += a[i]; c++; } return c ? s / c : NaN; }

function gcPick(a, m) { var v = []; for (var i = 0; i < a.length; i++) if (m[i]) v.push(a[i]); return v; }

// métricas de una corrección: C = luminancia binada de la corregida
//   eat:  señal del objeto que hay en el modelo (O − C), medida como abombamiento del modelo bajo la máscara
//         respecto a un polinomio de grado 2 ajustado en el cielo, dividido por la señal del objeto.
//   keep: señal del objeto que queda en la corregida (mismo método), dividida por la del original.
//   flat: rango de medianas de cielo (rejilla 8×8) de la corregida, en % de la señal del objeto.
//   ring: cielo junto al objeto − cielo lejano en la corregida, en % de la señal del objeto (negativo = anillo oscuro).
function gcScore(base, C, label) {
  var O = base.O, w = O.w, h = O.h, n = w * h, i;
  var D = new Float32Array(n);
  for (i = 0; i < n; i++) D[i] = O.a[i] - C[i];
  var Pd = gcPoly2({ a: D, w: w, h: h }, base.excl);
  var Pc = gcPoly2({ a: C, w: w, h: h }, base.excl);
  var dm = 0, cm = 0, k = 0;
  for (i = 0; i < n; i++) if (base.mask[i]) { dm += D[i] - Pd[i]; cm += C[i] - Pc[i]; k++; }
  dm /= k; cm /= k;
  var eat = dm / base.signal, keep = cm / base.signal;
  var cells = [];
  for (var gy = 0; gy < 8; gy++) for (var gx = 0; gx < 8; gx++) {
    var v = [];
    for (var y = Math.floor(gy * h / 8); y < Math.floor((gy + 1) * h / 8); y++)
      for (var x = Math.floor(gx * w / 8); x < Math.floor((gx + 1) * w / 8); x++) { var p = y * w + x; if (!base.excl[p]) v.push(C[p]); }
    if (v.length > 30) cells.push(gcMedian(v));
  }
  cells.sort(function (a, b) { return a - b; });
  var flat = cells.length > 1 ? (cells[cells.length - 1] - cells[0]) / Math.abs(base.signal) : NaN;
  var nearV = gcPick(C, base.near), farV = gcPick(C, base.far);
  var ring = (nearV.length && farV.length) ? (gcMedian(nearV) - gcMedian(farV)) / Math.abs(base.signal) : NaN;
  return { label: label, eat: eat, keep: keep, flat: flat, ring: ring, cells: cells.length };
}

// control: plano robusto de grado 1 (no puede comerse formas)
function gcPlaneMetrics(base) {
  var n = base.O.a.length, C = new Float32Array(n);
  var P = gcPlane(base.O, base.excl);
  for (var i = 0; i < n; i++) C[i] = base.O.a[i] - P[i];
  return gcScore(base, C, 'plano_g1');
}

function gcMetrics(base, viewId, bin) {
  var C = gcLumBinned(viewId, bin || base.bin);
  if (C.w != base.O.w || C.h != base.O.h) throw new Error('Geometría distinta: ' + viewId);
  return gcScore(base, C.a, viewId);
}

function gcFormat(s) {
  return s.label + ': come ' + (100 * s.eat).toFixed(1) + '%  conserva ' + (100 * s.keep).toFixed(0) + '%  cielo ' +
    (100 * s.flat).toFixed(1) + '%  anillo ' + (100 * s.ring).toFixed(1) + '%';
}

// --- estructura copiada en el modelo (probada en M31, LDN 1235, IC 1396 e IC 63, oct 2026) ---
function gcStarExcl(base) {
  var w = base.O.w, h = base.O.h, n = w * h, i;
  var Ob = gcBlur(base.O.a, w, h, 3, 2), hfv = [];
  for (i = 0; i < n; i += 3) hfv.push(base.O.a[i] - Ob[i]);
  var sd = gcMAD(hfv, gcMedian(hfv));
  var star = new Float32Array(n);
  for (i = 0; i < n; i++) star[i] = (base.O.a[i] - Ob[i] > 4 * sd) ? 1 : 0;
  var sb = gcBlur(star, w, h, 3, 2), excl = new Uint8Array(n);
  for (i = 0; i < n; i++) excl[i] = sb[i] > 0.02 ? 1 : 0;
  return excl;
}

function gcStructCopy(base, modelViewId) {
  var w = base.O.w, h = base.O.h, n = w * h, i, k;
  if (!base.starExcl) base.starExcl = gcStarExcl(base);
  var excl = base.starExcl;
  if (!base.Orl) {
    var Po = gcPoly2(base.O, excl), Or = new Float32Array(n);
    for (i = 0; i < n; i++) Or[i] = base.O.a[i] - Po[i];
    base.Orl = gcBlur(Or, w, h, 6, 3);
  }
  var Orl = base.Orl;
  var M = gcLumBinned(modelViewId, base.bin);
  if (M.w != w || M.h != h) throw new Error('Geometría distinta: ' + modelViewId);
  var Pm = gcPoly2(M, excl), Mr = new Float32Array(n);
  for (i = 0; i < n; i++) Mr[i] = M.a[i] - Pm[i];
  var Mrl = gcBlur(Mr, w, h, 6, 3);
  var mo = 0, mm = 0, c = 0;
  for (i = 0; i < n; i++) if (!excl[i]) { mo += Orl[i]; mm += Mrl[i]; c++; }
  mo /= c; mm /= c;
  var sOO = 0, sMM = 0, sMO = 0;
  for (i = 0; i < n; i++) if (!excl[i]) { var a = Mrl[i] - mm, b = Orl[i] - mo; sMO += a * b; sMM += a * a; sOO += b * b; }
  return { label: modelViewId, copy: sMO / sOO, corr: sMO / Math.sqrt(sOO * sMM) };
}
