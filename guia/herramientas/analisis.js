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
             dispersion_cielo: +skyNoise.toPrecision(3), celdas: cells.length, desviacion_tipica_celdas: +dev.toPrecision(3) }
  };
}
