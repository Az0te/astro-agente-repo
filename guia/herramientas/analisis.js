// analisis.js — Datos del Paso 1 lineal (análisis del objeto) en una sola llamada. PJSR, ECMAScript 5.
//
// Uso (en el nivel superior del script):
//   eval(File.readTextFile("<ruta de guia>/herramientas/analisis.js"));
//   var a = analizarMaster("MasterLight");
//   JSON.stringify(a);
//
// Devuelve lo que pide la checklist del paso para poder decidir, sin interpretarlo:
//   cabecera   OBJECT, FILTER, INSTRUME, TELESCOP, FOCALLEN, XPIXSZ, XBINNING, EXPTIME, RA, DEC (lo que exista)
//   imagen     ancho, alto, canales, bits, color, astrometría, procesos en el historial
//   escala     "/px a partir de XPIXSZ, binning y FOCALLEN; si faltan, de la solución astrométrica
//   canales    mediana, MAD, mínimo, máximo y píxeles > 0,95 y > 0,99 por canal
//   lineal     true si todas las medianas están por debajo de 0,05 (control del paso)
//   saturada   posición y valor del píxel más brillante (estrella más brillante probable)
//   campo      fracción del campo con señal extensa por encima del cielo (estimación con una rejilla
//              de medianas de 64×64 px: celdas > cielo + 3·dispersión del cielo). > 0,5 = el objeto llena el campo.
//              Mide la señal CLARA en lineal: la nebulosa débil suele extenderse bastante más, así que un
//              valor bajo (p. ej. 0,3) no demuestra que el objeto no llene el campo; mirar la imagen estirada.
// La interpretación (tipo de objeto, banda estrecha, HDR, polvo/IFN, muestreo) la hace quien lo llama.

function anKeyword(win, name) {
  var k = win.keywords;
  for (var i = 0; i < k.length; ++i)
    if (k[i].name === name) return String(k[i].value).replace(/^'+|'+$/g, "").trim();
  return null;
}

function anMedian(arr) {
  var a = Array.prototype.slice.call(arr).sort(function (x, y) { return x - y; });
  var n = a.length;
  return n ? (n % 2 ? a[(n - 1) / 2] : 0.5 * (a[n / 2 - 1] + a[n / 2])) : NaN;
}

function analizarMaster(viewId) {
  if (viewId && typeof viewId === "object" && viewId.id !== undefined) viewId = viewId.id;   // también vale la View
  var win = ImageWindow.windowById(viewId);
  if (win.isNull) throw new Error("No existe la vista " + viewId);
  var v = win.mainView, im = v.image, W = im.width, H = im.height, nc = im.numberOfChannels;

  var cab = {};
  ["OBJECT", "FILTER", "INSTRUME", "TELESCOP", "FOCALLEN", "XPIXSZ", "XBINNING", "EXPTIME", "RA", "DEC"].forEach(function (k) {
    var val = anKeyword(win, k);
    if (val !== null) cab[k] = val;
  });
  var escala = null, escalaFuente = null;
  if (cab.XPIXSZ && cab.FOCALLEN) {
    var bin = cab.XBINNING ? parseFloat(cab.XBINNING) : 1;
    escala = +(206.265 * parseFloat(cab.XPIXSZ) * bin / parseFloat(cab.FOCALLEN)).toFixed(3);
    escalaFuente = "cabecera";
  } else if (win.hasAstrometricSolution) {
    // Sin XPIXSZ/FOCALLEN: la escala sale de la solución astrométrica (resumen de PixInsight).
    try {
      var sum = String(win.astrometricSolutionSummary());
      var m = sum.match(/Resolution[^0-9]*([0-9.]+)\s*arcsec/i);
      if (m) { escala = +parseFloat(m[1]).toFixed(3); escalaFuente = "astrometría"; }
    } catch (e) {}
  }

  var canales = [], lum = new Float32Array(W * H), buf = new Float32Array(W * H);
  var maxV = -1, maxX = 0, maxY = 0;
  for (var c = 0; c < nc; ++c) {
    im.getSamples(buf, new Rect(0, 0, W, H), c);
    var n95 = 0, n99 = 0, mn = 1e9, mx = -1e9;
    for (var i = 0; i < buf.length; ++i) {
      var x = buf[i];
      if (x > 0.95) { ++n95; if (x > 0.99) ++n99; }
      if (x < mn) mn = x;
      if (x > mx) mx = x;
      lum[i] += x / nc;
      if (x > maxV) { maxV = x; maxX = i % W; maxY = Math.floor(i / W); }
    }
    im.selectedChannel = c;
    var med = im.median();
    canales.push({ canal: c, mediana: +med.toPrecision(4), MAD: +im.MAD(med).toPrecision(3), minimo: +mn.toPrecision(4),
                   maximo: +mx.toPrecision(4), pix_095: n95, pix_099: n99 });
  }
  im.resetSelections();

  // Rejilla de medianas de 64x64 px sobre la luminancia: cielo = percentil 10; dispersión = MAD de las celdas.
  var cs = 64, nx = Math.floor(W / cs), ny = Math.floor(H / cs), cells = [], tmp = new Float32Array(cs * cs);
  for (var gy = 0; gy < ny; ++gy)
    for (var gx = 0; gx < nx; ++gx) {
      var k = 0;
      for (var yy = gy * cs; yy < (gy + 1) * cs; yy += 2)
        for (var xx = gx * cs; xx < (gx + 1) * cs; xx += 2) tmp[k++] = lum[yy * W + xx];
      cells.push(anMedian(tmp.subarray(0, k)));
    }
  var sorted = cells.slice().sort(function (a, b) { return a - b; });
  var sky = sorted[Math.floor(0.1 * (sorted.length - 1))];
  var dev = anMedian(cells.map(function (m) { return Math.abs(m - sky); }));
  var lowHalf = sorted.slice(0, Math.floor(sorted.length / 2));
  var skyNoise = 1.4826 * anMedian(lowHalf.map(function (m) { return Math.abs(m - anMedian(lowHalf)); }));
  var above = 0;
  for (var j = 0; j < cells.length; ++j) if (cells[j] > sky + 3 * Math.max(skyNoise, 1e-9)) ++above;

  var lineal = true;
  for (var q = 0; q < canales.length; ++q) if (canales[q].mediana >= 0.05) lineal = false;

  var bordes = bordesSinDatos(v);
  var noCumple = [];
  if (bordes.hay)
    noCumple.push("bordes sin datos (cuñas del registro: arriba " + bordes.arriba + ", abajo " + bordes.abajo + ", izquierda " +
                  bordes.izquierda + ", derecha " + bordes.derecha + " px): alinear y recortar (Paso 5, alinearMasters) ANTES de " +
                  "gradiente, BXT, SPCC o cualquier otro paso; si es un solo master, recortar esos bordes");

  return {
    vista: viewId,
    cabecera: cab,
    imagen: { ancho: W, alto: H, canales: nc, bits: im.bitsPerSample, color: im.isColor,
              astrometria: win.hasAstrometricSolution, historial: v.processing.length },
    escala_arcsec_px: escala,
    escala_fuente: escalaFuente,
    canales: canales,
    lineal: lineal,
    saturada: { x: maxX, y: maxY, valor: +maxV.toPrecision(4) },
    campo: { fraccion_con_senal: +(above / cells.length).toFixed(3), cielo: +sky.toPrecision(4),
             dispersion_cielo: +skyNoise.toPrecision(3), celdas: cells.length, desviacion_tipica_celdas: +dev.toPrecision(3) },
    bordes_sin_datos: bordes,
    no_cumple: noCumple
  };
}

// Cuñas sin datos en los bordes (masters registrados sin recortar): cuánto hay que recortar de cada borde para quedarse
// sin píxeles vacíos (mascaraSinDatos). Una cuña falsea el gradiente (el modelo intenta ajustar el relleno), las
// estadísticas y SPCC: se alinea y recorta (Paso 5) antes que nada.
function bordesSinDatos(viewId) {
  var v = (viewId && typeof viewId === "object") ? viewId : View.viewById(viewId);
  var im = v.image, W = im.width, H = im.height;
  var empty = mascaraSinDatos(im), x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1, rowBad = new Int32Array(H), colBad = new Int32Array(W), total = 0;
  for (var y = 0; y < H; ++y) for (var x = 0; x < W; ++x) if (empty[y * W + x]) { ++rowBad[y]; ++colBad[x]; ++total; }
  // Rectángulo con datos: se quita cada vez el borde con más píxeles vacíos (como alinearMasters).
  for (var guard = 0; guard < W + H && total > 0; ++guard) {
    var cand = [[rowBad[y0], 0], [rowBad[y1], 1], [colBad[x0], 2], [colBad[x1], 3]];
    cand.sort(function (a, b) { return b[0] - a[0]; });
    if (cand[0][0] == 0 || x1 - x0 < 16 || y1 - y0 < 16) break;
    var k = cand[0][1];
    if (k == 0 || k == 1) { var yy = k == 0 ? y0++ : y1--; for (var xq = x0; xq <= x1; ++xq) if (empty[yy * W + xq]) --colBad[xq]; }
    else { var xx = k == 2 ? x0++ : x1--; for (var yq = y0; yq <= y1; ++yq) if (empty[yq * W + xx]) --rowBad[yq]; }
  }
  var r = { arriba: y0, abajo: H - 1 - y1, izquierda: x0, derecha: W - 1 - x1, vacio_pct: +(100 * total / (W * H)).toFixed(2) };
  r.hay = r.vacio_pct > 0.05 && (r.arriba > 2 || r.abajo > 2 || r.izquierda > 2 || r.derecha > 2);
  r.recorte = { x0: x0, y0: y0, x1: x1 + 1, y1: y1 + 1 };
  return r;
}

// Píxeles sin datos (1 = vacío): a 0 o negativos en algún canal (cuña de StarAlignment), o con el valor de relleno de
// WBPP, que NO es 0 sino una constante igual en todos los canales (IC 1396, 6 nov 2026: 0,0008361). Candidatos de
// relleno = los valores de las 4 esquinas; un píxel real no repite en coma flotante el de una esquina en todos los canales.
function mascaraSinDatos(im) {
  var W = im.width, H = im.height, nc = im.numberOfChannels, n = W * H, empty = new Uint8Array(n), cb = new Float32Array(n);
  var fills = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]].map(function (xy) {
    var t = []; for (var c = 0; c < nc; ++c) t.push(im.sample(xy[0], xy[1], c)); return t;
  });
  // Sólo esquinas cuyos canales son iguales entre sí (relleno gris constante); en mono, cualquier esquina.
  fills = fills.filter(function (t) { for (var c = 1; c < t.length; ++c) if (Math.abs(t[c] - t[0]) > 1e-7) return false; return true; });
  var match = fills.map(function () { var m = new Uint8Array(n); for (var i = 0; i < n; ++i) m[i] = 1; return m; });
  for (var c = 0; c < nc; ++c) {
    im.getSamples(cb, new Rect(0, 0, W, H), c);
    for (var i = 0; i < n; ++i) {
      if (cb[i] <= 0) empty[i] = 1;
      for (var f = 0; f < fills.length; ++f) if (match[f][i] && Math.abs(cb[i] - fills[f][c]) > 1e-7) match[f][i] = 0;
    }
  }
  for (var f2 = 0; f2 < fills.length; ++f2) for (var j = 0; j < n; ++j) if (match[f2][j]) empty[j] = 1;
  return empty;
}
