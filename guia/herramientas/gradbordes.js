// gradbordes.js — Manchas del cielo y gradiente de bordes. PJSR, ECMAScript 5.
//
// Lo carga gradiente.js (necesita gcPrepare, gcBlur, gcMedian, gcMAD, gcMtf, gcK de gradcompare.js y grChanBinned,
// grFreeId de gradiente.js).
//
// Idea (Rafael, 14 nov 2026): un polinomio quita el gradiente general perdiendo muy poca señal, pero suele quedar
// gradiente cerca de los bordes; GraXpert lo quita, pero se lleva algo más de objeto. Así que:
//   1. polinomio (gradiente general);
//   2. buscar manchas (grManchas): dónde queda brillo o color desigual en el cielo, en bordes o en el centro;
//   3. gradiente de bordes (grBordes): un modelo del cielo hecho SÓLO con píxeles de cielo (la máscara del objeto y
//      las estrellas quedan fuera del ajuste, el hueco se rellena con el cielo de alrededor) y aplicado con un peso
//      que vale 1 en el borde y baja suavemente a 0 hacia el interior: el centro, donde suele estar el objeto, no se toca;
//   4. buscar manchas otra vez y comparar con polinomio + GraXpert.
// La máscara se usa para AJUSTAR el modelo, nunca para aplicar la corrección: restar a través de una máscara deja el
// gradiente debajo del objeto y un escalón en el borde de la máscara.

// Media ponderada local: blur(a·m) / blur(m). Rellena los huecos (objeto, estrellas) con el cielo de alrededor.
function gbNormBlur(a, m, w, h, r) {
  var n = w * h, am = new Float32Array(n), mf = new Float32Array(n), i;
  for (i = 0; i < n; i++) { mf[i] = m[i] ? 1 : 0; am[i] = m[i] ? a[i] : 0; }
  var A = gcBlur(am, w, h, r, 3), M = gcBlur(mf, w, h, r, 3), out = new Float32Array(n), hueco = false;
  for (i = 0; i < n; i++) { if (M[i] > 0.02) out[i] = A[i] / M[i]; else { out[i] = NaN; hueco = true; } }
  if (hueco) {   // huecos más grandes que el radio (objeto grande): segunda pasada con radio triple
    var A2 = gcBlur(am, w, h, 3 * r, 3), M2 = gcBlur(mf, w, h, 3 * r, 3), med = gcMedian(gcPickF(a, m));
    for (i = 0; i < n; i++) if (!isFinite(out[i])) out[i] = M2[i] > 1e-4 ? A2[i] / M2[i] : med;
  }
  return out;
}

function gcPickF(a, m) { var v = []; for (var i = 0; i < a.length; i += 2) if (m[i]) v.push(a[i]); return v; }

// Peso de bordes: 1 hasta "lleno" (fracción del lado menor) del borde, coseno hasta 0 en "ancho".
function gbPesoBordes(w, h, ancho, lleno) {
  var W = new Float32Array(w * h), L = Math.min(w, h), d1 = Math.max(1, ancho * L), d0 = Math.min(lleno * L, d1 - 1);
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    var d = Math.min(x + 0.5, w - x - 0.5, y + 0.5, h - y - 0.5);
    W[y * w + x] = d <= d0 ? 1 : d >= d1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * (d - d0) / (d1 - d0)));
  }
  return W;
}

// Máscara binada de una vista (blanco = objeto a proteger) con la geometría de la base.
function gbMascaraUsuario(maskId, base) {
  var mk = grChanBinned(maskId, 0, base.bin);
  if (mk.w != base.O.w || mk.h != base.O.h) throw new Error("la máscara " + maskId + " no tiene el tamaño de la imagen");
  var out = new Uint8Array(mk.a.length);
  for (var i = 0; i < out.length; i++) out[i] = mk.a[i] > 0.5 ? 1 : 0;
  return out;
}

// Cielo para el ajuste: fuera del objeto y de las estrellas. Si queda poco (objeto que llena el campo), sólo sin estrellas.
function gbCielo(base) {
  if (base.gbCielo) return base.gbCielo;
  if (!base.starExcl) base.starExcl = gcStarExcl(base);
  // Cielo por cajas, como las muestras de DBE (14 nov 2026): rejilla de cajas (~1/40 del lado menor); en cada una, la
  // mediana de la luminancia sin estrellas. Se ajusta una superficie de grado 3 a las medianas con rechazo iterativo
  // (asimétrico: lo que queda por ENCIMA es objeto o halo y se rechaza antes) y se descartan también las cajas vecinas
  // de las rechazadas, para que el borde del halo no cuente como cielo. Con píxeles sueltos (umbral por percentiles)
  // el halo débil de una galaxia grande entraba como cielo y salía como manchas amarillas.
  var w = base.O.w, h = base.O.h, n = w * h, i, x, y, k, L = base.O.a, st = base.starExcl, us = base.usuario;
  var lado = Math.max(4, Math.round(Math.min(w, h) / 40)), nx = Math.max(8, Math.round(w / lado)), ny = Math.max(6, Math.round(h / lado));
  var cajas = [];
  for (var j = 0; j < ny; j++) for (var q = 0; q < nx; q++) {
    var x0 = Math.floor(q * w / nx), x1 = Math.floor((q + 1) * w / nx), y0 = Math.floor(j * h / ny), y1 = Math.floor((j + 1) * h / ny), v = [], u = 0;
    for (y = y0; y < y1; y++) for (x = x0; x < x1; x++) { k = y * w + x; if (us && us[k]) u++; else if (!st[k]) v.push(L[k]); }
    var ok = v.length >= 0.3 * (x1 - x0) * (y1 - y0) && u < 0.1 * (x1 - x0) * (y1 - y0);
    cajas.push({ i: q, j: j, x: (x0 + x1) / 2 / w - 0.5, y: (y0 + y1) / 2 / h - 0.5, z: ok ? gcMedian(v) : NaN, ok: ok, usable: ok });
  }
  function terms(px, py) { return [1, px, py, px * px, px * py, py * py, px * px * px, px * px * py, px * py * py, py * py * py]; }
  var nt = 10, coef = null;
  for (var it = 0; it < 12; it++) {
    var A = [], bb = [], r, c2, cnt = 0;
    for (r = 0; r < nt; r++) { var row = []; for (c2 = 0; c2 < nt; c2++) row.push(0); A.push(row); bb.push(0); }
    cajas.forEach(function (cj) { if (!cj.ok) return; var t = terms(cj.x, cj.y);
      for (var r1 = 0; r1 < nt; r1++) { bb[r1] += t[r1] * cj.z; for (var r2 = 0; r2 < nt; r2++) A[r1][r2] += t[r1] * t[r2]; } cnt++; });
    if (cnt < nt + 5) break;
    coef = gcSolveN(A, bb);
    var res = [];
    cajas.forEach(function (cj) { if (cj.ok) { var t = terms(cj.x, cj.y), f = 0; for (var r1 = 0; r1 < nt; r1++) f += coef[r1] * t[r1]; res.push(cj.z - f); } });
    var sd = gcMAD(res, gcMedian(res)), cambio = false;
    cajas.forEach(function (cj) { if (!cj.usable) return; var t = terms(cj.x, cj.y), f = 0; for (var r1 = 0; r1 < nt; r1++) f += coef[r1] * t[r1];
      var e = cj.z - f, keep = sd == 0 || (e <= 2 * sd && e >= -4 * sd); if (keep != cj.ok) cambio = true; cj.ok = keep; });
    if (!cambio) break;
  }
  // Vecinas de las rechazadas (no las inutilizables por estrellas): fuera también.
  var rech = cajas.map(function (cj) { return cj.usable && !cj.ok; }), cielo = cajas.map(function (cj) { return cj.ok; });
  cajas.forEach(function (cj, idx) {
    if (!cj.ok) return;
    for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) {
      var ii = cj.i + di, jj = cj.j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      if (rech[jj * nx + ii]) { cielo[idx] = false; return; }
    }
  });
  var m = new Uint8Array(n), c = 0;
  for (y = 0; y < h; y++) { var jy = Math.min(ny - 1, Math.floor(y * ny / h));
    for (x = 0; x < w; x++) { k = y * w + x; var ix = Math.min(nx - 1, Math.floor(x * nx / w));
      m[k] = (cielo[jy * nx + ix] && !st[k]) ? 1 : 0; c += m[k]; } }
  var ncielo = cielo.filter(function (z) { return z; }).length;
  base.gbCielo = { m: m, frac: c / n, cajas_cielo: ncielo, cajas: nx * ny,
                   nota: "cielo por cajas: " + ncielo + " de " + (nx * ny) + " cajas (" + Math.round(100 * ncielo / (nx * ny)) + " %)" };
  return base.gbCielo;
}

// Estirado automático (el de la previa y gcVisible) a partir de la luminancia del cielo.
function gbEstirado(L, m) {
  var sky = gcPickF(L, m), med = gcMedian(sky), mad = gcMAD(sky, med), c0 = Math.max(Math.min(med - 2.8 * mad, med), -1);
  var esc = function (x) { return Math.min(1, Math.max(0, (x - c0) / (1 - c0))); };
  var xm = esc(med); if (!(xm > 0 && xm < 1)) return null;
  var mm = gcMtf(0.10, xm);
  return function (x) { return gcMtf(mm, esc(x)); };
}

function gbRango(v) {   // p97 − p3
  if (v.length < 20) return NaN;
  var b = v.slice(0).sort(function (a, c) { return a - c; });
  return b[Math.floor(0.97 * (b.length - 1))] - b[Math.floor(0.03 * (b.length - 1))];
}

// Manchas del cielo de una vista: variación de brillo y de color de gran escala que queda en el cielo, ya estirada
// (umbrales propios, más abajo: el rango incluye el halo débil del objeto). Separa bordes y centro.
//   manchas_brillo, manchas_color: en todo el cielo; *_bordes / *_centro: en la franja de bordes y en el interior;
//   donde: "bordes", "centro", "todo" o "nada"; peores: hasta 3 zonas con la mancha más fuerte.
function grManchas(viewId, base, o) {
  o = o || {};
  var w = base.O.w, h = base.O.h, n = w * h, i, c;
  var cielo = gbCielo(base), m = cielo.m;
  var nch = Math.min(3, View.viewById(viewId).image.numberOfChannels), ch = [];
  for (c = 0; c < nch; c++) {
    var b = grChanBinned(viewId, c, base.bin);
    if (b.w != w || b.h != h) throw new Error("Geometría distinta: " + viewId);
    ch.push(b.a);
  }
  var L = new Float32Array(n);
  for (i = 0; i < n; i++) { var s = 0; for (c = 0; c < nch; c++) s += ch[c][i]; L[i] = s / nch; }
  var st = gbEstirado(L, m);
  if (!st) return { manchas_brillo: NaN, manchas_color: NaN, donde: "sin medir", nota: "no se pudo estirar el cielo" };
  var r = Math.max(3, Math.round(Math.min(w, h) / (o.escalaManchas || 30)));
  // Superficies lisas del cielo (sin objeto ni estrellas), estiradas.
  var SL = gbNormBlur(L, m, w, h, r), sL = new Float32Array(n), sC = [];
  for (i = 0; i < n; i++) sL[i] = st(SL[i]);
  // Color: cada canal con su propio estirado (como tras calibrar el color, cielo neutro): con el de la luminancia, un
  // canal más oscuro que el resto quedaba por debajo del punto negro y salía constante (14 nov 2026).
  if (nch >= 3) for (c = 0; c < 3; c++) {
    var S = gbNormBlur(ch[c], m, w, h, r), sc = new Float32Array(n), stc = gbEstirado(ch[c], m) || st;
    for (i = 0; i < n; i++) sc[i] = stc(S[i]);
    sC.push(sc);
  }
  var Wb = gbPesoBordes(w, h, o.anchoBordes || 0.15, 0);
  var zonas = { todo: { L: [], C: [] }, bordes: { L: [], C: [] }, centro: { L: [], C: [] } };
  var cuR = [], cuB = [];
  for (i = 0; i < n; i++) if (m[i]) { if (sC.length) { cuR.push(sC[0][i] - sC[1][i]); cuB.push(sC[2][i] - sC[1][i]); } }
  var mR = cuR.length ? gcMedian(cuR) : 0, mB = cuB.length ? gcMedian(cuB) : 0;
  // Celdas 6×4 para decir dónde está la peor mancha.
  var gx = 6, gy = 4, celdas = [];
  for (i = 0; i < gx * gy; i++) celdas.push({ L: [], C: [] });
  for (var y = 0; y < h; y += 2) for (var x = 0; x < w; x += 2) {
    i = y * w + x; if (!m[i]) continue;
    var col = sC.length ? Math.max(Math.abs(sC[0][i] - sC[1][i] - mR), Math.abs(sC[2][i] - sC[1][i] - mB)) : 0;
    var z = Wb[i] > 0.5 ? "bordes" : "centro";
    zonas.todo.L.push(sL[i]); zonas[z].L.push(sL[i]);
    if (sC.length) { var dR = sC[0][i] - sC[1][i] - mR, dB = sC[2][i] - sC[1][i] - mB;
                     zonas.todo.C.push(dR); zonas.todo.C.push(dB); zonas[z].C.push(dR); zonas[z].C.push(dB); }
    var k = Math.min(gy - 1, Math.floor(y * gy / h)) * gx + Math.min(gx - 1, Math.floor(x * gx / w));
    celdas[k].L.push(sL[i]); celdas[k].C.push(col);
  }
  var medL = gcMedian(zonas.todo.L);
  // Mapa para mirarlo (o.mapas): superficie lisa del cielo de cada canal, estirada y con el contraste multiplicado por
  // o.mapaGanancia (10): gris medio = cielo medio; rojizo/amarillento/azulado = mancha de ese color. Lo que no es cielo
  // (objeto, estrellas; ahí el valor está interpolado) sale más oscuro.
  if (o.mapas) {
    var kg = o.mapaGanancia || 10, mapId = grFreeId("MAPA_" + viewId);
    var mw = new ImageWindow(w, h, 3, 32, true, true, mapId);
    mw.mainView.beginProcess();
    for (c = 0; c < 3; c++) {
      var src = sC.length ? sC[c] : sL, medc = gcMedian(gcPickF(src, m)), D = new Float32Array(n);
      for (i = 0; i < n; i++) { var val = 0.5 + kg * (src[i] - medc); if (!m[i]) val = 0.15 + 0.6 * (val - 0.15); D[i] = Math.min(1, Math.max(0, val)); }
      mw.mainView.image.setSamples(D, new Rect(0, 0, w, h), c);
    }
    mw.mainView.endProcess();
    mw.show();
  }
  function rd(v) { return isFinite(v) ? +v.toFixed(4) : NaN; }
  var res = {
    mapa: o.mapas ? mapId : undefined,
    manchas_brillo: rd(gbRango(zonas.todo.L)), manchas_color: sC.length ? rd(gbRango(zonas.todo.C)) : NaN,
    manchas_brillo_bordes: rd(gbRango(zonas.bordes.L)), manchas_brillo_centro: rd(gbRango(zonas.centro.L)),
    manchas_color_bordes: sC.length ? rd(gbRango(zonas.bordes.C)) : NaN, manchas_color_centro: sC.length ? rd(gbRango(zonas.centro.C)) : NaN,
    cielo_usado_pct: Math.round(100 * cielo.frac)
  };
  if (cielo.nota) res.nota = cielo.nota;
  res.cajas_cielo_pct = Math.round(100 * cielo.cajas_cielo / cielo.cajas);
  var nombresY = ["arriba", "centro-arriba", "centro-abajo", "abajo"], nombresX = ["izquierda", "izq.", "centro", "centro", "der.", "derecha"];
  var lista = [];
  celdas.forEach(function (cd, k) {
    if (cd.L.length < 10) return;
    var dl = gcMedian(cd.L) - medL, dc = cd.C.length ? gcMedian(cd.C) : 0;
    lista.push({ zona: nombresY[Math.floor(k / gx)] + " " + nombresX[k % gx], brillo: rd(dl), color: rd(dc), f: Math.max(Math.abs(dl), dc) });
  });
  lista.sort(function (a, b2) { return b2.f - a.f; });
  res.peores = lista.slice(0, 3).filter(function (q) { return q.f > 0.008; }).map(function (q) { delete q.f; return q; });
  // Umbrales (14 nov 2026, calibrados mirando los mapas de una galaxia grande): el rango p97−p3 del cielo liso incluye
  // el halo débil junto al objeto, así que no son las unidades de gradiente_visible. Brillo: < 0,03 no se ve, 0,03–0,06
  // leve, > 0,06 se ve; color: < 0,02, 0,02–0,04, > 0,04. Con 0,015 todos los candidatos «se veían», incluso los planos.
  // limiteManchas: número (mismo para los dos) o { brillo, color } = el umbral de «se ve»; el de «leve» es la mitad.
  var lm = o.limiteManchas, limB = typeof lm === "number" ? lm : (lm && lm.brillo) || 0.06, limC = typeof lm === "number" ? lm : (lm && lm.color) || 0.04;
  function supera(b2, c2, f) { return (isFinite(b2) && b2 > limB * f) || (isFinite(c2) && c2 > limC * f); }
  var vb = supera(res.manchas_brillo_bordes, res.manchas_color_bordes, 1), vc = supera(res.manchas_brillo_centro, res.manchas_color_centro, 1);
  res.donde = !vb && !vc ? "nada" : vb && !vc ? "bordes" : !vb && vc ? "centro" : "todo";
  res.se_ven = res.donde !== "nada";
  res.nivel = res.se_ven ? "se ven" : supera(res.manchas_brillo, res.manchas_color, 0.5) ? "leves" : "no se ven";
  return res;
}

// Gradiente de bordes sobre una vista ya corregida del gradiente general. Crea <nuevo> (corregida) y <nuevo>_modelo.
//   o.anchoBordes: fracción del lado menor donde actúa (0,20 por defecto; el peso baja de 1 a 0 entre "lleno" y "ancho").
//   o.llenoBordes: fracción con peso 1 (0,04).  o.escalaBordes: lado menor / radio del suavizado (16 = liso).
// El modelo de cada canal es el cielo liso (sin objeto ni estrellas) menos su nivel en el interior, por el peso de bordes:
// en el interior vale 0, así que no toca el objeto ni el nivel del fondo.
function grBordes(srcId, base, nuevo, o) {
  o = o || {};
  var w = base.O.w, h = base.O.h, n = w * h, i, c;
  var src = ImageWindow.windowById(srcId); if (src.isNull) throw new Error("No existe la vista " + srcId);
  var im = src.mainView.image, nch = im.numberOfChannels;
  var m = gbCielo(base).m;
  var r = Math.max(3, Math.round(Math.min(w, h) / (o.escalaBordes || 16)));
  var Wb = gbPesoBordes(w, h, o.anchoBordes || 0.20, o.llenoBordes !== undefined ? o.llenoBordes : 0.04);
  // Nivel de referencia: cielo del interior (donde el peso es 0).
  var mid = grFreeId(nuevo + "_modelo_bin");
  var mw = new ImageWindow(w, h, nch, 32, true, nch >= 3, mid);
  mw.mainView.beginProcess();
  for (c = 0; c < nch; c++) {
    var a = grChanBinned(srcId, c, base.bin).a, S = gbNormBlur(a, m, w, h, r), inn = [];
    for (i = 0; i < n; i += 2) if (Wb[i] < 0.01 && m[i]) inn.push(S[i]);
    if (inn.length < 20) for (inn = [], i = 0; i < n; i += 2) if (Wb[i] < 0.01) inn.push(S[i]);
    if (inn.length < 20) for (inn = [], i = 0; i < n; i += 2) if (m[i]) inn.push(S[i]);   // peso 1 en todo el campo
    var ref = gcMedian(inn), D = new Float32Array(n);
    for (i = 0; i < n; i++) D[i] = (S[i] - ref) * Wb[i];
    mw.mainView.image.setSamples(D, new Rect(0, 0, w, h), c);
  }
  mw.mainView.endProcess();
  // A resolución completa: el modelo es muy liso, basta un remuestreo bicúbico.
  var RS = new Resample;
  RS.mode = gcK(Resample, "AbsolutePixels"); RS.absoluteMode = gcK(Resample, "ForceWidthAndHeight");
  RS.xSize = im.width; RS.ySize = im.height;
  try { RS.interpolation = gcK(Resample, "BicubicSpline"); } catch (e) { }
  if (!RS.executeOn(mw.mainView, false)) { mw.forceClose(); throw new Error("Resample del modelo de bordes falló"); }
  var modelo = grFreeId(nuevo + "_modelo");
  mw.mainView.id = modelo;
  mw.show();
  // Corregida: copia de la fuente menos el modelo (canal a canal).
  var cid = grDuplicate(srcId, nuevo);
  var PM = new PixelMath;
  PM.expression = "$T - " + modelo; PM.useSingleExpression = true;
  PM.rescale = false; PM.truncate = false; PM.createNewImage = false;
  if (!PM.executeOn(View.viewById(cid))) throw new Error("PixelMath de la corrección de bordes falló");
  return { vista: cid, modelo: modelo, radio_bin: r, ancho: o.anchoBordes || 0.20 };
}

// Modelo total de una cadena (original − corregida), para medir copia_objeto igual que en los demás candidatos.
function grModeloCadena(origId, corrId, nuevo) {
  var mid = grFreeId(nuevo);
  var PM = new PixelMath, nch = View.viewById(origId).image.numberOfChannels;
  PM.expression = origId + " - " + corrId; PM.useSingleExpression = true;
  PM.createNewImage = true; PM.showNewImage = true; PM.newImageId = mid; PM.newImageWidth = 0; PM.newImageHeight = 0;
  PM.rescale = false; PM.truncate = false; PM.newImageSampleFormat = gcK(PixelMath, "f32");
  PM.newImageColorSpace = nch >= 3 ? gcK(PixelMath, "RGB") : gcK(PixelMath, "Gray");
  if (!PM.executeOn(View.viewById(origId))) throw new Error("PixelMath del modelo de la cadena falló");
  return mid;
}
