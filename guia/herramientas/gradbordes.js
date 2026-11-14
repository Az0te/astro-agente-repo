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

// Los modelos con valores negativos se guardan desplazados GB_DESPLAZ mientras se remuestrean: Resample recorta a
// [0, 1] y se perdía la mitad negativa del modelo (14 nov 2026: la corrección de color sólo restaba donde era positiva).
var GB_DESPLAZ = 0.5;
function gbQuitarDesplaz(view) {
  var P = new PixelMath;
  P.expression = "$T - " + GB_DESPLAZ; P.useSingleExpression = true;
  P.rescale = false; P.truncate = false; P.createNewImage = false;
  if (!P.executeOn(view, false)) throw new Error("PixelMath (quitar desplazamiento) falló");
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
    for (i = 0; i < n; i++) D[i] = GB_DESPLAZ + (S[i] - ref) * Wb[i];
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
  gbQuitarDesplaz(mw.mainView);
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

// ---------------------------------------------------------------------------------------------------------------
// Polinomio fuera del halo + crominancia (14 nov 2026, estudio de la mancha amarilla de una galaxia grande).
// Lo que se vio: la máscara del objeto se queda corta en un objeto grande y difuso; el halo exterior real entra como
// «cielo», el polinomio se curva para seguirlo y crea manchas de color. Además, lo que queda suele ser una mancha de
// escala media casi en un solo canal (aquí, un hueco en B): no es señal, porque la señal real sólo suma luz.
// Remedio:
//   1. elipse del objeto a partir de la máscara (momentos de su mayor trozo), agrandada haloOpts.escala veces (1,1 por
//      defecto); los otros trozos grandes con señal (compañeras) también se agrandan. El polinomio de grado 2 por canal se ajusta
//      SÓLO fuera de todo eso (cielo de verdad) y se resta en todo el campo;
//   2. crominancia: medianas de R−G y B−G en cajas de cielo de verdad (≥ 60 % de la caja), superficie thin-plate
//      suavizada con rechazo de cajas a 2,5σ, restada de R y de B. La luminancia sólo recibe el polinomio, así que no
//      puede comerse halo débil ni IFN.
// Bajo el objeto la corrección es interpolada: no se puede verificar ahí.

// Trozos conexos (8 vecinos) de una máscara binada. Devuelve [{n, sx, sy, sxx, syy, sxy}] ordenados de mayor a menor.
function ghTrozos(m, w, h, R) {
  var lab = new Int32Array(w * h), pila = new Int32Array(w * h), out = [], id = 0;
  for (var s = 0; s < w * h; s++) {
    if (!m[s] || lab[s]) continue;
    id++; var top = 0, t = { n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, sr: 0, borde: false };
    pila[top++] = s; lab[s] = id;
    while (top) {
      var p = pila[--top], x = p % w, y = (p - x) / w;
      t.n++; t.sx += x; t.sy += y; t.sxx += x * x; t.syy += y * y; t.sxy += x * y;
      if (R) t.sr += R[p]; if (x === 0 || y === 0 || x === w - 1 || y === h - 1) t.borde = true;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        var q = yy * w + xx; if (m[q] && !lab[q]) { lab[q] = id; pila[top++] = q; }
      }
    }
    out.push(t);
  }
  out.sort(function (a, b) { return b.n - a.n; });
  return out;
}

// Elipse de un trozo (coordenadas binadas): centro, semiejes de la elipse uniforme equivalente y ángulo.
function ghElipse(t) {
  var cx = t.sx / t.n, cy = t.sy / t.n, vxx = t.sxx / t.n - cx * cx, vyy = t.syy / t.n - cy * cy, vxy = t.sxy / t.n - cx * cy;
  var tr = (vxx + vyy) / 2, d = Math.sqrt(Math.max(0, (vxx - vyy) * (vxx - vyy) / 4 + vxy * vxy));
  return { cx: cx, cy: cy, a: 2 * Math.sqrt(tr + d), b: 2 * Math.sqrt(Math.max(1e-6, tr - d)), ang: 0.5 * Math.atan2(2 * vxy, vxx - vyy) };
}

// Máscara binada «no es cielo de verdad» para una escala k: objeto principal y compañeras agrandados. No incluye la
// exclusión normal (base.excl): ésta también marca restos de gradiente en los bordes y dejaba el campo sin cielo; las
// estrellas las quitan las medianas de las celdas y cajas. o.elipse = {x, y, a, q, angulo} en píxeles de la imagen completa (p. ej. del tamaño de catálogo)
// sustituye a la elipse calculada; o.excluirCirculos = [{x, y, r}] (imagen completa) añade zonas.
function ghNoCielo(base, k, fq, o) {
  var w = base.O.w, h = base.O.h, bin = base.bin, n = w * h, out = new Uint8Array(n), i, x, y;
  if (base.usuario) for (i = 0; i < n; i++) out[i] = base.usuario[i];
  var els = [];
  if (o.elipse) {
    var e = o.elipse, a0 = e.a / bin;
    els.push({ cx: e.x / bin, cy: e.y / bin, a: a0 * k / 2, b: a0 * (e.q || 1) * k / 2 * fq, ang: (e.angulo || 0) * Math.PI / 180 });
  }
  base.ghTrozos.forEach(function (t, j) {
    if (j === 0 && o.elipse) return;
    var el = ghElipse(t); els.push({ cx: el.cx, cy: el.cy, a: el.a * k, b: el.b * k * fq, ang: el.ang });
  });
  (o.excluirCirculos || []).forEach(function (c) { els.push({ cx: c.x / bin, cy: c.y / bin, a: c.r / bin, b: c.r / bin, ang: 0 }); });
  els.forEach(function (el) {
    var ca = Math.cos(el.ang), sa = Math.sin(el.ang), R = el.a + 1;
    var x0 = Math.max(0, Math.floor(el.cx - R)), x1 = Math.min(w - 1, Math.ceil(el.cx + R));
    var y0 = Math.max(0, Math.floor(el.cy - R)), y1 = Math.min(h - 1, Math.ceil(el.cy + R));
    for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
      var dx = x - el.cx, dy = y - el.cy, u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
      if ((u / el.a) * (u / el.a) + (v / el.b) * (v / el.b) <= 1) out[y * w + x] = 1;
    }
  });
  return { m: out, elipses: els };
}

// Mediana con rechazo de lo que sobresale por arriba (estrellas y sus halos): 4 vueltas a 2σ.
function ghMedRech(v) {
  var m = gcMedian(v);
  for (var it = 0; it < 4; it++) {
    var sd = gcMAD(v, m), lim = m + 2 * sd, u = [];
    for (var i = 0; i < v.length; i++) if (v[i] <= lim) u.push(v[i]);
    if (u.length === v.length || u.length < 5) break;
    v = u; m = gcMedian(v);
  }
  return m;
}

// Thin-plate spline suavizada (como scipy RBFInterpolator, kernel r²·log r, polinomio de grado 1).
function ghTPS(P, z, lambda) {
  var n = z.length, N = n + 3, A = [], b = [], i, j;
  function phi(r2) { return r2 > 0 ? 0.5 * r2 * Math.log(r2) : 0; }
  for (i = 0; i < N; i++) { var row = new Array(N); for (j = 0; j < N; j++) row[j] = 0; A.push(row); b.push(i < n ? z[i] : 0); }
  for (i = 0; i < n; i++) {
    for (j = 0; j < n; j++) { var dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1]; A[i][j] = phi(dx * dx + dy * dy); }
    A[i][i] += lambda;
    A[i][n] = A[n][i] = 1; A[i][n + 1] = A[n + 1][i] = P[i][0]; A[i][n + 2] = A[n + 2][i] = P[i][1];
  }
  var c = gcSolveN(A, b);
  return function (u, v) {
    var s = c[n] + c[n + 1] * u + c[n + 2] * v;
    for (var q = 0; q < n; q++) { var dx = u - P[q][0], dy = v - P[q][1]; s += c[q] * phi(dx * dx + dy * dy); }
    return s;
  };
}

// Ajuste con rechazo: 3 vueltas, fuera las cajas a > 2,5σ del ajuste.
function ghTPSRobusta(P, z, lambda) {
  var keep = z.map(function () { return true; }), f = null;
  for (var it = 0; it < 3; it++) {
    var Pk = [], zk = [];
    for (var i = 0; i < z.length; i++) if (keep[i]) { Pk.push(P[i]); zk.push(z[i]); }
    if (zk.length < 12) break;
    f = ghTPS(Pk, zk, lambda);
    var res = z.map(function (zz, q) { return zz - f(P[q][0], P[q][1]); });
    var rk = res.filter(function (rr, q) { return keep[q]; }), med = gcMedian(rk), sd = gcMAD(rk, med);
    keep = res.map(function (rr) { return sd === 0 || Math.abs(rr - med) < 2.5 * sd; });
  }
  return { f: f, usadas: keep.filter(function (k) { return k; }).length };
}

// Cálculo (sin PixInsight, para poder probarlo aparte): elige la escala del halo, ajusta el polinomio por canal fuera de
// él y la superficie de crominancia, y devuelve los coeficientes y el modelo de crominancia en una rejilla gruesa.
function ghCalcular(base, ch, ho) {
  var w = base.O.w, h = base.O.h, n = w * h, i, x, y, c;
  if (!base.ghTrozos) {
    var mo = new Uint8Array(n); for (i = 0; i < n; i++) mo[i] = base.mask[i] || (base.usuario && base.usuario[i]) ? 1 : 0;
    // Objeto principal: el trozo más grande con señal (más brillante que el cielo; un objeto grande puede tocar el borde);
    // compañeras: otros trozos con señal de al menos 0,2 % del campo que no tocan el borde. Los que tocan el borde o son
    // más oscuros que el cielo son restos de gradiente, no objetos.
    var tz = ghTrozos(mo, w, h, base.R), minimo = Math.max(30, 0.002 * n);
    var pos = tz.filter(function (t) { return t.sr > 0; });
    base.ghTrozos = pos.length ? [pos[0]].concat(pos.slice(1).filter(function (t) { return !t.borde && t.n >= minimo; }).slice(0, 5)) : [];
  }
  if (!base.ghTrozos.length && !ho.elipse) throw new Error("no hay máscara del objeto");
  if (!base.starExcl) base.starExcl = gcStarExcl(base);
  var lado = Math.max(4, Math.round(Math.min(w, h) / (ho.cajas || 21))), nx = Math.floor(w / lado), ny = Math.floor(h / lado);
  // La máscara del objeto (3σ del fondo liso) ya llega a casi todo el halo visible: 1,1 lo cubre. Las cajas de color usan
  // la misma elipse: con más margen (1,25) se perdían las cajas de cielo de las esquinas, la superficie extrapolaba allí y
  // las manchas de color no bajaban (galaxia grande, 14 nov 2026: 1,0 → 0,015; 1,1 → 0,016; 1,25 → 0,034). Si deja poco
  // cielo (menos de 40 celdas del polinomio o 30 cajas), se prueba más pequeña.
  var escalas = [ho.escala || 1.1, 1.0].filter(function (e, j, l) { return j === 0 || e < l[0]; });
  var sel = null;
  for (var ie = 0; ie < escalas.length && !sel; ie++) {
    var nc = ghNoCielo(base, escalas[ie], 1, ho), nc2 = ghNoCielo(base, escalas[ie] * (ho.margenCroma || 1.0), 1, ho), celdas = 0, cajas = [];
    for (var j = 0; j < 22; j++) for (var q = 0; q < 32; q++) {
      var cx0 = Math.floor(q * w / 32), cx1 = Math.floor((q + 1) * w / 32), cy0 = Math.floor(j * h / 22), cy1 = Math.floor((j + 1) * h / 22), lib = 0;
      for (y = cy0; y < cy1; y++) for (x = cx0; x < cx1; x++) if (!nc.m[y * w + x]) lib++;
      if (lib > 0.5 * (cx1 - cx0) * (cy1 - cy0)) celdas++;
    }
    for (var by = 0; by < ny; by++) for (var bx = 0; bx < nx; bx++) {
      var vR = [], vG = [], vB = [], tot = lado * lado, libres = 0;
      for (y = by * lado; y < (by + 1) * lado; y++) for (x = bx * lado; x < (bx + 1) * lado; x++) {
        var p = y * w + x; if (nc2.m[p]) continue;
        libres++; if (ho.sinEstrellas !== false && base.starExcl[p]) continue;
        vR.push(ch[0].a[p]); vG.push(ch[1].a[p]); vB.push(ch[2].a[p]);
      }
      if (libres >= 0.6 * tot && vG.length >= 0.25 * tot)
        cajas.push({ x: (bx + 0.5) * lado, y: (by + 0.5) * lado, r: ghMedRech(vR), g: ghMedRech(vG), b: ghMedRech(vB) });
    }
    if ((celdas >= 40 && cajas.length >= 30) || ie === escalas.length - 1) sel = { k: escalas[ie], nc: nc, cajas: cajas, celdas: celdas };
  }
  if (sel.celdas < 12) throw new Error("no queda cielo fuera del halo del objeto (" + sel.celdas + " celdas)");
  var grado = ho.grado || 2, coefs = [];
  for (c = 0; c < 3; c++) coefs.push(grPolyCoef(ch[c], sel.nc.m, grado));
  var out = { escala: sel.k, elipses: sel.nc.elipses, celdas: sel.celdas, cajas: sel.cajas.length, coefs: coefs };
  if (ho.croma === false) return out;
  if (sel.cajas.length < 15) { out.aviso = "pocas cajas de cielo (" + sel.cajas.length + "): sin crominancia"; return out; }
  function pol(cf, xb, yb) { var X = xb / w - 0.5, Y = yb / h - 0.5, s = cf[0] + cf[1] * X + cf[2] * Y;
    if (cf.length >= 6) s += cf[3] * X * X + cf[4] * X * Y + cf[5] * Y * Y; return s; }
  var esc = 1.5 / Math.max(w, h), P = [], zR = [], zB = [];
  sel.cajas.forEach(function (cj) {
    var r = cj.r - pol(coefs[0], cj.x, cj.y), gg = cj.g - pol(coefs[1], cj.x, cj.y), b = cj.b - pol(coefs[2], cj.x, cj.y);
    P.push([cj.x * esc, cj.y * esc]); zR.push(r - gg); zB.push(b - gg);
  });
  var lam = ho.suavizado !== undefined ? ho.suavizado : 0.005, fR = ghTPSRobusta(P, zR, lam), fB = ghTPSRobusta(P, zB, lam);
  if (!fR.f || !fB.f) { out.aviso = "no se pudo ajustar la crominancia"; return out; }
  var wc = Math.max(8, Math.round(w / 4)), hc = Math.max(8, Math.round(h / 4)), MR = new Float32Array(wc * hc), MB = new Float32Array(wc * hc);
  for (y = 0; y < hc; y++) for (x = 0; x < wc; x++) {
    var u = (x + 0.5) * w / wc * esc, v = (y + 0.5) * h / hc * esc;
    MR[y * wc + x] = fR.f(u, v); MB[y * wc + x] = fB.f(u, v);
  }
  var mR = gcMedian(MR), mB = gcMedian(MB);
  for (i = 0; i < wc * hc; i++) { MR[i] -= mR; MB[i] -= mB; }   // grHalo les suma GB_DESPLAZ para remuestrearlos
  out.croma = { wc: wc, hc: hc, R: MR, B: MB, usadas: Math.min(fR.usadas, fB.usadas), P: P, zR: zR, zB: zB };
  return out;
}

// Candidatos «polinomio fuera del halo» (corregida GC_POLY2H) y «+ crominancia» (GC_POLY2HC).
//   o.halo: false para no probarlo; o.haloOpts: { escala (1,1), margenCroma (1,0), elipse, excluirCirculos, cajas (21 por lado menor),
//   suavizado (0,005), grado (2), croma (true) }.
function grHalo(viewId, base, o) {
  var ho = o.haloOpts || {}, bin = base.bin, c;
  var win = ImageWindow.windowById(viewId), im = win.mainView.image, W = im.width, H = im.height;
  if (im.numberOfChannels < 3) throw new Error("hace falta una imagen en color");
  var ch = []; for (c = 0; c < 3; c++) ch.push(grChanBinned(viewId, c, bin));
  var k = ghCalcular(base, ch, ho);
  var el0 = k.elipses[0], g = function (v) { return Math.round(v * bin); };
  var geom = el0 ? "elipse centro (" + g(el0.cx) + ", " + g(el0.cy) + "), semiejes " + g(el0.a) + " × " + g(el0.b) + " px, " +
                   Math.round(el0.ang * 180 / Math.PI) + "°" + (k.elipses.length > 1 ? ", " + (k.elipses.length - 1) + " zonas más" : "") : "";
  var exprs = k.coefs.map(grPolyExpr), grado = k.coefs[0].length >= 6 ? 2 : 1;
  var pid = grDuplicate(viewId, "GC_POLY" + grado + "H"), cen = function (e) { return "(" + e.split(" + ")[0] + ")"; };
  var PMc = new PixelMath;
  PMc.useSingleExpression = false;
  PMc.expression = "$T - (" + exprs[0] + ") + " + cen(exprs[0]);
  PMc.expression1 = "$T - (" + exprs[1] + ") + " + cen(exprs[1]);
  PMc.expression2 = "$T - (" + exprs[2] + ") + " + cen(exprs[2]);
  PMc.rescale = false; PMc.truncate = false; PMc.createNewImage = false;
  if (!PMc.executeOn(View.viewById(pid))) throw new Error("PixelMath del polinomio fuera del halo falló");
  var out = { poly: pid, escala: k.escala, geometria: geom, celdas: k.celdas, cajas: k.cajas, aviso: k.aviso };
  if (!k.croma) return out;
  var cr = k.croma, mid = grFreeId(pid + "C_croma");
  var mw = new ImageWindow(cr.wc, cr.hc, 3, 32, true, true, mid);
  mw.mainView.beginProcess();
  function desplaz(M) { var D = new Float32Array(M.length); for (var q = 0; q < M.length; q++) D[q] = M[q] + GB_DESPLAZ; return D; }
  mw.mainView.image.setSamples(desplaz(cr.R), new Rect(0, 0, cr.wc, cr.hc), 0);
  mw.mainView.image.setSamples(desplaz(new Float32Array(cr.wc * cr.hc)), new Rect(0, 0, cr.wc, cr.hc), 1);
  mw.mainView.image.setSamples(desplaz(cr.B), new Rect(0, 0, cr.wc, cr.hc), 2);
  mw.mainView.endProcess();
  var RS = new Resample;
  RS.mode = gcK(Resample, "AbsolutePixels"); RS.absoluteMode = gcK(Resample, "ForceWidthAndHeight");
  RS.xSize = W; RS.ySize = H;
  try { RS.interpolation = gcK(Resample, "BicubicSpline"); } catch (e) { }
  if (!RS.executeOn(mw.mainView, false)) { mw.forceClose(); throw new Error("Resample del modelo de crominancia falló"); }
  gbQuitarDesplaz(mw.mainView);
  mw.show();
  var cid = grDuplicate(pid, pid + "C");
  var PM = new PixelMath;
  PM.expression = "$T - " + mid; PM.useSingleExpression = true;
  PM.rescale = false; PM.truncate = false; PM.createNewImage = false;
  if (!PM.executeOn(View.viewById(cid))) throw new Error("PixelMath de la crominancia falló");
  out.croma = cid; out.modelo_croma = mid; out.cajas_usadas = cr.usadas;
  if (ho.depurar) out.depuracion = { w: base.O.w, h: base.O.h, P: cr.P, zR: cr.zR, zB: cr.zB, coefs: k.coefs,
                                     muestraR: [cr.R[0], cr.R[Math.floor(cr.R.length / 2)]], muestraB: [cr.B[0], cr.B[Math.floor(cr.B.length / 2)]] };
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnóstico de manchas (14 nov 2026). Lo que hicieron los modelos que acertaron con la mancha amarilla, convertido en
// medidas: antes de decidir si una mancha es señal o artefacto, mirar (1) en qué canal está, (2) si es un exceso o un
// hueco respecto al cielo (la señal real sólo suma luz) y (3) si sigue al objeto (cerca de él y repetida al otro lado,
// como un halo) o no. Devuelve las zonas peores con un veredicto en una frase.
//   Valores en % del nivel de cielo de cada canal, sobre superficies lisas del cielo (sin objeto agrandado ni estrellas).
function ghDiagnosticar(base, ch, o) {
  o = o || {};
  var w = base.O.w, h = base.O.h, n = w * h, i, c, x, y;
  if (!base.ghTrozos) ghCalcular(base, ch, { croma: false });
  if (!base.starExcl) base.starExcl = gcStarExcl(base);
  var nc = ghNoCielo(base, o.escala || 1.1, 1, o), cielo = new Uint8Array(n), el = nc.elipses[0];
  // Fuera también lo que sobresale del fondo liso (compañeras, nebulosas pequeñas), ensanchado; los huecos NO se quitan:
  // son justo lo que se busca.
  var Rl = gcBlur(base.R, w, h, 3, 3), sobre = new Float32Array(n);
  for (i = 0; i < n; i++) sobre[i] = base.mask[i] && Rl[i] > 0 ? 1 : 0;
  var sob = gcBlur(sobre, w, h, Math.max(4, Math.round(Math.min(w, h) / 40)), 2);
  for (i = 0; i < n; i++) cielo[i] = !nc.m[i] && !base.starExcl[i] && sob[i] < 0.01 ? 1 : 0;
  var r = Math.max(3, Math.round(Math.min(w, h) / (o.escalaManchas || 30))), S = [], nivel = [];
  for (c = 0; c < 3; c++) {
    var Sc = gbNormBlur(ch[c].a, cielo, w, h, r), lv = gcMedian(gcPickF(Sc, cielo));
    for (i = 0; i < n; i++) Sc[i] = 100 * (Sc[i] - lv) / Math.abs(lv || 1e-12);
    S.push(Sc); nivel.push(lv);
  }
  // Celdas de ~1/8 del lado menor; en cada una, la mediana de cada canal en el cielo.
  var lado = Math.max(4, Math.round(Math.min(w, h) / 8)), gx = Math.floor(w / lado), gy = Math.floor(h / lado), celdas = [];
  function valor(cx, cy) {   // mediana por canal en una celda centrada en (cx, cy); null si casi no hay cielo
    var x0 = Math.max(0, Math.round(cx - lado / 2)), y0 = Math.max(0, Math.round(cy - lado / 2)), v = [[], [], []];
    for (var yy = y0; yy < Math.min(h, y0 + lado); yy += 2) for (var xx = x0; xx < Math.min(w, x0 + lado); xx += 2) {
      var p = yy * w + xx; if (!cielo[p]) continue; for (var q = 0; q < 3; q++) v[q].push(S[q][p]); }
    return v[0].length < 0.15 * lado * lado / 4 ? null : v.map(gcMedian);
  }
  var cx0 = el ? el.cx : w / 2, cy0 = el ? el.cy : h / 2;
  for (y = 0; y < gy; y++) for (x = 0; x < gx; x++) {
    var px = (x + 0.5) * lado, py = (y + 0.5) * lado, v = valor(px, py);
    if (!v) continue;
    var m = Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2]));
    celdas.push({ x: px, y: py, v: v, m: m });
  }
  celdas.sort(function (a, b) { return b.m - a.m; });
  var umbral = o.umbral || 0.1, nombresY = ["arriba", "centro-arriba", "centro-abajo", "abajo"], nombresX = ["izquierda", "centro-izquierda", "centro", "centro-derecha", "derecha"];
  var nom = ["R", "G", "B"], zonas = [], usados = [];
  for (var k = 0; k < celdas.length && zonas.length < (o.zonas || 4); k++) {
    var cd = celdas[k]; if (cd.m < umbral) break;
    if (usados.some(function (u) { return Math.abs(u.x - cd.x) <= lado && Math.abs(u.y - cd.y) <= lado; })) continue;
    usados.push(cd);
    var v2 = cd.v, ord = [0, 1, 2].sort(function (a, b) { return Math.abs(v2[b]) - Math.abs(v2[a]); }), d = ord[0];
    var unCanal = Math.abs(v2[ord[1]]) < 0.5 * Math.abs(v2[d]);
    var mismoSigno = v2.every(function (q) { return q * v2[d] > 0; });
    // Distancia al objeto (radio elíptico / semieje del objeto) y simetría respecto a su centro.
    var re = NaN, sim = null;
    if (el) {
      var dx = cd.x - el.cx, dy = cd.y - el.cy, ca = Math.cos(el.ang), sa = Math.sin(el.ang), u = dx * ca + dy * sa, vv = -dx * sa + dy * ca;
      re = Math.sqrt((u / el.a) * (u / el.a) + (vv / el.b) * (vv / el.b)) * (o.escala || 1.1);
      var sv = valor(2 * cx0 - cd.x, 2 * cy0 - cd.y);
      if (sv) sim = sv[d] * v2[d] > 0 && Math.abs(sv[d]) > 0.4 * Math.abs(v2[d]);
    }
    var tipo, ver;
    if (v2[d] < 0) {
      tipo = "hueco"; ver = "Más oscuro que el cielo" + (unCanal ? " y casi sólo en " + nom[d] : "") +
        ": no es señal (la señal real sólo suma luz). Artefacto del fondo o de los planos; se puede corregir.";
    } else if (unCanal) {
      tipo = "exceso en un canal"; ver = "Exceso casi sólo en " + nom[d] + ": casi seguro un artefacto (luz parásita, planos), no un halo, que saldría en los tres canales. Se puede corregir (crominancia).";
    } else if (mismoSigno && re < 1.8 && sim) {
      tipo = "halo probable"; ver = "Exceso en los tres canales, cerca del objeto y repetido al otro lado: probablemente halo real del objeto. No quitarlo; agrandar la máscara del objeto.";
    } else {
      tipo = "exceso sin forma de halo"; ver = "Exceso en varios canales que no sigue al objeto: gradiente que queda, nube o polvo. Mirar el mapa antes de decidir.";
    }
    zonas.push({ zona: nombresY[Math.min(3, Math.floor(cd.y / h * 4))] + " " + nombresX[Math.min(4, Math.floor(cd.x / w * 5))],
                 centro_px: [Math.round(cd.x * base.bin), Math.round(cd.y * base.bin)],
                 R_pct: +v2[0].toFixed(3), G_pct: +v2[1].toFixed(3), B_pct: +v2[2].toFixed(3),
                 distancia_objeto: isFinite(re) ? +re.toFixed(2) : null, simetrica: sim, tipo: tipo, veredicto: ver });
  }
  var res = { zonas: zonas, umbral_pct: umbral,
              nota: "Valores en % del cielo de cada canal (superficie lisa, sin objeto agrandado ni estrellas). distancia_objeto: 1 = borde de la máscara del objeto agrandada." };
  var huecos = zonas.filter(function (z) { return z.tipo === "hueco" || z.tipo === "exceso en un canal"; }).length;
  res.resumen = !zonas.length ? "No quedan manchas por encima de " + umbral + " % del cielo." :
    huecos ? huecos + " de " + zonas.length + " zonas son artefactos de color (hueco o un solo canal): usar «polinomio fuera del halo + crominancia»." :
    "Las manchas que quedan parecen halo o gradiente: revisar la máscara del objeto y el mapa.";
  return res;
}

// Para una vista (normalmente ya corregida de gradiente). o: { escala, umbral (0,1 %), zonas (4), bin (8), mascara }.
function diagnosticoManchas(viewId, o) {
  o = o || {};
  var base = gcPrepare(viewId, o.bin || 8);
  if (o.mascara) base.usuario = gbMascaraUsuario(o.mascara, base);
  var nchv = View.viewById(viewId).image.numberOfChannels;
  if (nchv < 3) throw new Error("hace falta una imagen en color");
  var ch = []; for (var c = 0; c < 3; c++) ch.push(grChanBinned(viewId, c, base.bin));
  var r = ghDiagnosticar(base, ch, o);
  r.vista = viewId;
  return r;
}
