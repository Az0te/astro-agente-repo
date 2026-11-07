// alineado.js — Paso 5 lineal: registrar los masters sobre una referencia común y recortarlos a la zona común.
// PJSR, ECMAScript 5.
//
// Uso (cargar en el nivel superior del script, nunca dentro de una función):
//   eval(File.readTextFile("<ruta de guia>/herramientas/alineado.js"));
//   JSON.stringify(alinearMasters(["<master 1>", "<master 2>", ...], { referencia: "<master de referencia>", salida: "<carpeta>" }));
//   (también vale una carpeta o una lista de carpetas con los masters .xisf). Referencia: la de mejor resolución y
//   SNR (la L o el Hα de la mono); si no se da, la de escala más fina (y, a igual escala, la de más píxeles).
//
// Qué hace, sobre ficheros (no toca los originales):
//   1. Lee escala (astrometría, o píxel y focal de la cabecera) y tamaño de cada master. Si una escala difiere más de
//      un 3 % de la de la referencia, la reescala antes con Resample (Lanczos-3): registrar escalas distintas falló.
//   2. StarAlignment en modo fichero contra la referencia (por defecto, la primera de la lista), con corrección de
//      distorsión (thin plate splines) y Lanczos-3: una sola interpolación.
//   3. Calcula el rectángulo donde TODOS los masters tienen datos (ni 0 ni el relleno constante de WBPP) y
//      recorta todos a ese rectángulo, incluida la referencia. Guarda <nombre>_alin.xisf en salida.
//   4. Controles: fracción del campo que se conserva, bordes sin 0 tras el recorte, estrellas emparejadas por
//      StarAlignment, y si cada fichero conserva la astrometría (PixInsight 1.9.6+).
// Devuelve { referencia, rect, conservado_pct, franjas_borde_px, ficheros: [{ entrada, salida, escala, reescalado,
//            emparejadas, wcs }], vistas (ids _alin abiertos, la referencia primero), vista (la referencia alineada),
//            astrometria { resuelta, copiada_a } (con blindSolve: resuelve la referencia y la copia a las demás),
//            no_cumple, control: { medido, revisar_a_ojo } }.

// Píxeles sin datos (1 = vacío): a 0 o negativos en algún canal (cuña de StarAlignment), o con el valor de relleno de
// WBPP, que NO es 0 sino una constante igual en todos los canales (nebulosa dual band, 6 nov 2026: 0,0008361; antes sólo se
// buscaban ceros y la cuña se quedaba). Misma función que en analisis.js.
function mascaraSinDatos(im) {
  var W = im.width, H = im.height, nc = im.numberOfChannels, n = W * H, empty = new Uint8Array(n), cb = new Float32Array(n);
  var fills = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]].map(function (xy) {
    var t = []; for (var c = 0; c < nc; ++c) t.push(im.sample(xy[0], xy[1], c)); return t;
  });
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
  // Sólo cuenta lo vacío que llega al borde (una cuña es una racha desde el borde en su fila o columna). Los píxeles a 0
  // sueltos del interior (una raya desmezclada y recortada a 0, nebulosa dual band 6 nov 2026) no son cuñas: sin esto el SII del
  // S2Hb daba "izquierda 5133 px".
  var edge = new Uint8Array(n), x, y;
  for (y = 0; y < H; ++y) {
    for (x = 0; x < W && empty[y * W + x]; ++x) edge[y * W + x] = 1;
    for (x = W - 1; x >= 0 && empty[y * W + x]; --x) edge[y * W + x] = 1;
  }
  for (x = 0; x < W; ++x) {
    for (y = 0; y < H && empty[y * W + x]; ++y) edge[y * W + x] = 1;
    for (y = H - 1; y >= 0 && empty[y * W + x]; --y) edge[y * W + x] = 1;
  }
  return edge;
}

// Franja de borde con datos pero distinta del interior (menos subs por el dithering o la rotación entre noches, o la
// interpolación junto a la cuña): no está vacía, pero su fondo o su RUIDO se apartan de los de dentro. nebulosa dual band (6 nov 2026):
// HaO3, franja a la derecha 0–16 px un 21 % más oscura que sube hasta ~60 px; SO3, franjas más claras y más ruidosas en
// esquinas (cuñas triangulares). Por cada borde, en 12 tramos (una cuña sólo ocupa parte del borde), perfil de líneas de
// 2 px desde el borde hacia dentro: mediana (fondo) y MAD (ruido). La franja acaba en un ESCALÓN del perfil frente a la
// tendencia interior (los gradientes y la nebulosa son suaves a 8 px); tras el escalón se sigue la rampa hasta el doble.
// Umbrales: fondo max(8σ, 1,5 %); ruido max(8σ, 15 %). Trabaja dentro de rect {x0,y0,x1,y1} (x1,y1 exclusivos).
function bandaBorde(im, rect, maxD) {
  maxD = maxD || 300;
  var NT = 12, r = rect || { x0: 0, y0: 0, x1: im.width, y1: im.height }, W = r.x1 - r.x0, H = r.y1 - r.y0, nc = im.numberOfChannels;
  var res = { arriba: 0, abajo: 0, izquierda: 0, derecha: 0 };
  if (W < 3 * (maxD + 60) || H < 3 * (maxD + 60)) return res;
  function lineRect(lado, k, s) {
    if (lado == "arriba" || lado == "abajo") {
      var a = r.x0 + Math.floor(s * W / NT), b = r.x0 + Math.floor((s + 1) * W / NT), y = lado == "arriba" ? r.y0 + k : r.y1 - 2 - k;
      return new Rect(a, y, b, y + 2);
    }
    var c = r.y0 + Math.floor(s * H / NT), d = r.y0 + Math.floor((s + 1) * H / NT), x = lado == "izquierda" ? r.x0 + k : r.x1 - 2 - k;
    return new Rect(x, c, x + 2, d);
  }
  // Profundidad de la franja en un perfil (índices de 2 px), o -1.
  function franja(prof, rel) {
    var i0 = Math.floor(prof.length / 2), sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0, i;
    for (i = i0; i < prof.length; i++) { sx += i; sy += prof[i]; sxx += i * i; sxy += i * prof[i]; n++; }
    var bb = (n * sxy - sx * sy) / (n * sxx - sx * sx), aa = (sy - bb * sx) / n, rs = [], st = [];
    for (i = i0; i < prof.length; i++) rs.push(Math.abs(prof[i] - (aa + bb * i)));
    rs.sort(function (p, q) { return p - q; });
    var lvl = Math.abs(aa + bb * i0);
    for (i = 3; i < prof.length - 3; i++) st.push({ i: i, d: (prof[i] + prof[i + 1] + prof[i + 2]) / 3 - (prof[i - 1] + prof[i - 2] + prof[i - 3]) / 3 });
    var inner = st.filter(function (q) { return q.i >= i0; }).map(function (q) { return Math.abs(q.d); }).sort(function (p, q) { return p - q; });
    var sig = 1.4826 * inner[inner.length >> 1], best = null, last = -1;
    st.forEach(function (q) { if (q.i < i0 && (!best || Math.abs(q.d) > Math.abs(best.d))) best = q; });
    if (best && Math.abs(best.d) > Math.max(8 * sig, rel * lvl)) {
      last = 2 * best.i + 6;
      var sdev = 1.4826 * rs[rs.length >> 1], tdev = Math.max(6 * sdev, rel * lvl), quiet = 0, cap = 2 * last;
      for (i = 0; i < i0 && 2 * i < cap; i++) {
        if (Math.abs(prof[i] - (aa + bb * i)) > tdev) { if (2 * i + 6 > last) last = Math.min(cap, 2 * i + 6); quiet = 0; }
        else if (++quiet >= 6) break;
      }
    } else if (Math.abs(prof[0] - aa) > Math.max(8 * sig, 2 * rel * lvl)) last = 8;   // franja de 0–6 px
    return last;
  }
  // Una estrella brillante junto al borde (su halo) da un escalón en UN tramo; una cuña de apilado ocupa varios seguidos.
  // Sólo cuenta un tramo si alguno de sus vecinos también tiene franja.
  ["arriba", "abajo", "izquierda", "derecha"].forEach(function (lado) {
    var dep = [];
    for (var s = 0; s < NT; s++) {
      var ds = -1;
      for (var ch = 0; ch < nc; ch++) {
        var pm = [], pn = [];
        im.selectedChannel = ch;
        for (var k = 0; k <= maxD + 60; k += 2) { im.selectedRect = lineRect(lado, k, s); var m = im.median(); pm.push(m); pn.push(im.MAD(m)); }
        ds = Math.max(ds, franja(pm, 0.015), franja(pn, 0.15));
      }
      dep.push(ds);
    }
    for (var q = 0; q < NT; q++) {
      // Profundidad apoyada por un vecino: min(la del tramo, la mayor de sus vecinos). Así el halo de una estrella en un
      // tramo no alarga la franja (HaO3 derecha: 58, 132 por la estrella, 24 → 58).
      var vec = Math.max(q > 0 ? dep[q - 1] : -1, q < NT - 1 ? dep[q + 1] : -1), dq = (q == 0 || q == NT - 1) ? dep[q] : Math.min(dep[q], vec);   // en las esquinas la punta de la cuña ocupa un solo tramo
      if (dq > res[lado]) res[lado] = dq;
    }  });
  im.resetSelections();
  return res;
}

function alSearch(p, r) { return File.searchDirectory ? File.searchDirectory(p, r) : searchDirectory(p, r); }

// Abre un fichero en PixInsight con un STF automático (sólo visual, no cambia los píxeles) y devuelve el id de la vista.
// Si ya hay una ventana con ese fichero, la reutiliza.
function abrirConSTF(path, id) {
  var ws = ImageWindow.windows, w = null;
  for (var i = 0; i < ws.length; ++i) if (ws[i].filePath == path) w = ws[i];
  if (!w) {
    w = ImageWindow.open(path)[0];
    if (id) { var n = id.replace(/[^A-Za-z0-9_]/g, "_"); if (/^[0-9]/.test(n)) n = "_" + n; if (ImageWindow.windowById(n).isNull) w.mainView.id = n; }
  }
  // STF enlazado (mismos parámetros en todos los canales): por canal desequilibra los colores.
  // Por canal sólo si los canales están muy desequilibrados (lineal sin calibrar color); si no, enlazado.
  var v = w.mainView, im = v.image, n = im.numberOfChannels, meds = [], mads = [], rows = [];
  for (var c = 0; c < n; ++c) { im.selectedChannel = c; meds.push(im.median()); mads.push(1.4826 * im.MAD()); }
  im.resetSelections();
  var mn = Math.min.apply(null, meds), mx = Math.max.apply(null, meds), link = mn > 0 && mx / mn < 1.25;
  var avg = function (a) { return a.reduce(function (p, q) { return p + q; }, 0) / a.length; };
  for (var c2 = 0; c2 < n; ++c2) {
    var md = link ? avg(meds) : meds[c2], ma = link ? avg(mads) : mads[c2], sh = Math.max(0, Math.min(1, md - 2.8 * ma));
    rows.push([sh, 1, Math.mtf(0.25, md - sh), 0, 1]);   // c0, c1, m, r0, r1
  }
  if (n == 1) rows = [rows[0], rows[0], rows[0]];
  while (rows.length < 4) rows.push([0, 1, 0.5, 0, 1]);
  var S = new ScreenTransferFunction; S.STF = rows; S.executeOn(v, false);
  w.show();
  return v.id;
}

// PixInsight 1.9.6 conserva la astrometría LINEAL al recortar, reescalar o girar, pero la que lleva corrección de
// distorsión (splines) no se puede transformar: el proceso abre un diálogo "Some of these side effects could be
// irreversible. Proceed?" que deja el script esperando. Esto la reduce a su parte lineal (se queda en la ventana,
// no en el fichero): comprobado con una nebulosa de emisión y reflexión, tras IntegerResample ×2 coincide con una resolución nueva a 0,11 px.
// Devuelve true si había splines y se quitaron.
function astrometriaLineal(win) {
  if (!win || win.isNull || !win.hasAstrometricSolution) return false;
  var v = win.mainView;
  var spl = v.properties.filter(function (p) {
    return /AstrometricSolution:(ControlPoints|DistortionModel|Generation|Grid|ProjectiveTransformation)/.test(p); });
  if (!spl.length) return false;
  spl.forEach(function (p) { try { v.deleteProperty(p); } catch (e) { } });
  try { win.regenerateAstrometricSolution(); } catch (e) { win.clearAstrometricSolution(); }
  return true;
}

function alScale(path) {
  // Escala en "/px: de la astrometría si la hay; si no, de XPIXSZ, FOCALLEN y XBINNING.
  var w = ImageWindow.open(path, "alSCALE", "verbosity 0", true)[0];
  var r = { ancho: w.mainView.image.width, alto: w.mainView.image.height, canales: w.mainView.image.numberOfChannels, wcs: w.hasAstrometricSolution };
  var s = NaN;
  if (w.hasAstrometricSolution) {
    try { var M = w.mainView.propertyValue("PCL:AstrometricSolution:LinearTransformationMatrix");
          if (!M) M = w.mainView.propertyValue("AstrometricSolution:LinearTransformationMatrix");
          if (M) s = 3600 * Math.sqrt(Math.abs(M.at(0, 0) * M.at(1, 1) - M.at(0, 1) * M.at(1, 0))); } catch (e) { }
  }
  if (!isFinite(s)) {
    var k = w.keywords, px = NaN, fl = NaN, bin = 1;
    for (var i = 0; i < k.length; ++i) {
      if (k[i].name == "XPIXSZ") px = parseFloat(k[i].strippedValue);
      if (k[i].name == "FOCALLEN") fl = parseFloat(k[i].strippedValue);
      if (k[i].name == "XBINNING") bin = parseFloat(k[i].strippedValue) || 1;
    }
    // XPIXSZ suele venir ya multiplicado por el binning (N.I.N.A.); los masters con drizzle no lo reflejan.
    if (isFinite(px) && isFinite(fl) && fl > 0) s = 206.265 * px / fl;
  }
  r.escala = isFinite(s) ? +s.toFixed(4) : null;
  w.forceClose();
  return r;
}

function alinearMasters(lista, o) {
  // Qwen la llamó como alinearMasters(null, [vistas]) (6 nov 2026): si la lista viene en el segundo argumento, se acepta.
  if ((lista === null || lista === undefined) && o instanceof Array) { lista = o; o = arguments[2]; }
  o = o || {};
  // Ficheros o carpetas (de una carpeta se toman sus .xisf, sin mapas de rechazo, pesos de drizzle ni ya alineados).
  // También ids de vistas abiertas (o View/ImageWindow): se usa su fichero si está guardado y sin cambios; si no, se
  // guarda una copia temporal. Qwen pasó los ids de los 4 masters abiertos y fallaba con "No existe <id>" (6 nov 2026).
  var vistaAFichero = function (x) {
    var id = (x && typeof x === "object") ? (x.mainView ? x.mainView.id : x.id) : String(x);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) return null;   // una ruta no es un id (windowById lanzaría un error)
    var w = ImageWindow.windowById(id);
    if (w.isNull) return null;
    var fp = String(w.filePath || "").replace(/\\/g, "/");
    if (fp && File.exists(fp) && !w.mainView.isModified && /\.xisf$/i.test(fp)) return fp;
    var dir = File.systemTempDirectory.replace(/\\/g, "/") + "/picopilot_alin";
    if (!File.directoryExists(dir)) File.createDirectory(dir, true);
    var out = dir + "/" + id + ".xisf";
    var c = new ImageWindow(1, 1, 1, 32, true, false, "alTMPV");
    c.mainView.beginProcess(); c.mainView.image.assign(w.mainView.image); c.mainView.endProcess();
    c.keywords = w.keywords; if (w.hasAstrometricSolution) c.copyAstrometricSolution(w);
    c.saveAs(out, false, false, false, false); c.forceClose();
    return out;
  };
  if (o.referencia) { var rv = vistaAFichero(o.referencia); if (rv) o.referencia = rv; }
  var files = [];
  (lista instanceof Array ? lista : [lista]).forEach(function (x) {
    var fv = vistaAFichero(x);
    if (fv) { files.push(fv); return; }
    var p = String(x).replace(/\\/g, "/").replace(/\/$/, "");
    if (File.directoryExists(p))
      files = files.concat(alSearch(p + "/" + "*.xisf", false).filter(function (f) {
        return !/rejection|drizzle_weights|_alin\.|LN_Reference|_modelo|_model/i.test(File.extractName(f)); }).sort());
    else files.push(p);
  });
  files = files.filter(function (f, i) { return files.indexOf(f) === i; });   // la misma imagen abierta dos veces, una sola vez
  if (files.length < 1) throw new Error("No hay masters en " + lista + ": pasa ficheros .xisf o la carpeta que los contiene");
  files.forEach(function (f) { if (!File.exists(f)) throw new Error("No existe " + f + ": pasa ids de vistas abiertas, ficheros .xisf o la carpeta que los contiene"); });
  var info = {}; files.forEach(function (f) { info[f] = alScale(f); });
  // Sin referencia: la de escala más fina ("/px menor; sin escala, la de más píxeles), para no perder resolución.
  var ref = o.referencia ? String(o.referencia).replace(/\\/g, "/") : files.slice().sort(function (a, b) {
    var sa = info[a].escala, sb = info[b].escala;
    if (sa && sb && Math.abs(sa / sb - 1) > 0.03) return sa - sb;
    return info[b].ancho * info[b].alto - info[a].ancho * info[a].alto;
  })[0];
  if (files.indexOf(ref) < 0) { files.unshift(ref); info[ref] = alScale(ref); }
  var salida = (o.salida || (File.extractDrive(ref) + File.extractDirectory(ref) + "/alineados")).replace(/\\/g, "/").replace(/\/$/, "");
  if (!File.directoryExists(salida)) File.createDirectory(salida, true);
  var tmp = salida + "/_tmp_alin";
  if (!File.directoryExists(tmp)) File.createDirectory(tmp, true);
  var r = { referencia: ref, salida: salida, ficheros: [], no_cumple: [], control: { medido: [], revisar_a_ojo: [] } };

  // 1. Escalas y reescalado previo si hace falta.
  var sRef = info[ref].escala, aRegistrar = [];
  files.forEach(function (f) {
    var e = { entrada: f, escala: info[f].escala, tamano: info[f].ancho + "x" + info[f].alto, reescalado: null };
    r.ficheros.push(e);
    if (f == ref) return;
    var fuente = f;
    if (sRef && info[f].escala && Math.abs(info[f].escala / sRef - 1) > 0.03) {
      var k = info[f].escala / sRef;   // >1: píxeles más grandes que la referencia → ampliar
      var w = ImageWindow.open(f, "alRES", "verbosity 0", true)[0];
      astrometriaLineal(w);   // sin esto, una solución con splines abre un diálogo y para el script
      var R = new Resample;
      R.xSize = k; R.ySize = k; R.mode = 0;   // relativo
      R.interpolation = 4;                    // Lanczos-3 (constante no expuesta en PJSR)
      if (!R.executeOn(w.mainView)) { w.forceClose(); throw new Error("Resample falló en " + f); }
      fuente = tmp + "/" + File.extractName(f) + "_res.xisf";
      w.saveAs(fuente, false, false, false, false); w.forceClose();
      e.reescalado = +k.toFixed(4);
    }
    aRegistrar.push({ e: e, f: fuente });
  });

  // 2. StarAlignment en modo fichero.
  if (aRegistrar.length) {
    var SA = new StarAlignment;
    SA.referenceImage = ref; SA.referenceIsFile = true;
    SA.targets = aRegistrar.map(function (a) { return [true, true, a.f]; });
    SA.outputDirectory = tmp; SA.outputPostfix = "_r"; SA.overwriteExistingFiles = true;
    SA.distortionCorrection = true;
    SA.pixelInterpolation = 4;   // Lanczos-3
    SA.generateDrizzleData = false;
    SA.onError = 0;              // seguir con el resto
    SA.executeGlobal();
    var od = SA.outputData || [];
    aRegistrar.forEach(function (a, i) {
      var out = tmp + "/" + File.extractName(a.f) + "_r.xisf";
      a.e.registrado = File.exists(out) ? out : null;
      try { if (od[i]) a.e.emparejadas = od[i][2]; } catch (x) { }
      if (!a.e.registrado) r.no_cumple.push("StarAlignment no registró " + File.extractName(a.e.entrada) + " (ver la consola).");
    });
  }

  // 3. Zona común: píxeles con datos en todos los masters y canales.
  var reg = [ref].concat(aRegistrar.filter(function (a) { return a.e.registrado; }).map(function (a) { return a.e.registrado; }));
  var W = info[ref].ancho, H = info[ref].alto, valid = new Uint8Array(W * H), buf = new Float32Array(W * H);
  for (var i = 0; i < W * H; ++i) valid[i] = 1;
  reg.forEach(function (f) {
    var w = ImageWindow.open(f, "alVAL", "verbosity 0", true)[0], im = w.mainView.image;
    if (im.width != W || im.height != H) { w.forceClose(); throw new Error("Tamaño distinto tras registrar: " + f); }
    var vac = mascaraSinDatos(im);   // 0 y también el relleno constante de WBPP (no es 0)
    for (var i = 0; i < W * H; ++i) if (vac[i]) valid[i] = 0;
    w.forceClose();
  });
  // Rectángulo: se quita cada vez el borde (fila o columna) con más píxeles sin datos, hasta que no quede ninguno.
  var x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1, rowBad = new Int32Array(H), colBad = new Int32Array(W);
  for (var y = 0; y < H; ++y) for (var x = 0; x < W; ++x) if (!valid[y * W + x]) { ++rowBad[y]; ++colBad[x]; }
  for (var guard = 0; guard < W + H; ++guard) {
    var cand = [[rowBad[y0], 0], [rowBad[y1], 1], [colBad[x0], 2], [colBad[x1], 3]];
    cand.sort(function (a, b) { return b[0] - a[0]; });
    if (cand[0][0] == 0) break;
    var k = cand[0][1];
    if (k == 0 || k == 1) { var yy = k == 0 ? y0++ : y1--; for (var x = x0; x <= x1; ++x) if (!valid[yy * W + x]) --colBad[x]; }
    else { var xx = k == 2 ? x0++ : x1--; for (var y = y0; y <= y1; ++y) if (!valid[y * W + xx]) --rowBad[y]; }
    if (x1 - x0 < 16 || y1 - y0 < 16) throw new Error("Los masters apenas se solapan: no hay zona común");
  }
  // Franjas de borde con datos pero distintas del interior (menos cobertura de apilado): se recortan también.
  // Dos pasadas: tras recortar la franja más ancha puede asomar otra más estrecha en otro master (nebulosa dual band SO3 abajo).
  var franja = { arriba: 0, abajo: 0, izquierda: 0, derecha: 0 };
  if (o.franjas !== false) {
    var abiertos = reg.map(function (f, i) { return ImageWindow.open(f, "alBAND" + i, "verbosity 0", true)[0]; });
    for (var pasada = 0; pasada < 2; ++pasada) {
      var b2 = { arriba: 0, abajo: 0, izquierda: 0, derecha: 0 };
      abiertos.forEach(function (w) {
        var b = bandaBorde(w.mainView.image, { x0: x0, y0: y0, x1: x1 + 1, y1: y1 + 1 });
        for (var kk in b2) if (b[kk] > b2[kk]) b2[kk] = b[kk];
      });
      if (pasada > 0) for (var k2 in b2) if (b2[k2] <= 8) b2[k2] = 0;   // segunda pasada: sólo franjas claras
      y0 += b2.arriba; y1 -= b2.abajo; x0 += b2.izquierda; x1 -= b2.derecha;
      for (var k3 in franja) franja[k3] += b2[k3];
    }
    abiertos.forEach(function (w) { w.forceClose(); });
  }
  var margen = o.margen !== undefined ? o.margen : 4;   // unos píxeles más por la interpolación del borde
  x0 += margen; y0 += margen; x1 -= margen; y1 -= margen;
  r.rect = { x0: x0, y0: y0, x1: x1 + 1, y1: y1 + 1, ancho: x1 - x0 + 1, alto: y1 - y0 + 1 };
  r.conservado_pct = +(100 * (x1 - x0 + 1) * (y1 - y0 + 1) / (W * H)).toFixed(1);
  r.franjas_borde_px = franja;   // recortado de más por franjas con menos cobertura (no vacías)

  // 4. Recorte y controles.
  var porSalida = {};
  r.ficheros.forEach(function (e) { porSalida[e.entrada == ref ? ref : e.registrado] = e; });
  reg.forEach(function (f) {
    var e = porSalida[f], w = ImageWindow.open(f, "alCROP", "verbosity 0", true)[0];
    if (astrometriaLineal(w)) e.splines_quitados = true;
    var C = new Crop; C.mode = 1;   // AbsolutePixels
    C.leftMargin = -x0; C.topMargin = -y0; C.rightMargin = -(W - 1 - x1); C.bottomMargin = -(H - 1 - y1);
    if (!C.executeOn(w.mainView)) { w.forceClose(); throw new Error("Crop falló en " + f); }
    var im = w.mainView.image, cero = 0, n = 0, row = new Float32Array(im.width);
    [0, im.height - 1].forEach(function (yy) { im.getSamples(row, new Rect(0, yy, im.width, yy + 1), 0); for (var i = 0; i < im.width; ++i) { ++n; if (row[i] <= 0) ++cero; } });
    e.salida = salida + "/" + File.extractName(e.entrada) + "_alin.xisf";
    e.wcs = w.hasAstrometricSolution;
    e.bordes_a_cero_pct = +(100 * cero / n).toFixed(2);
    w.saveAs(e.salida, false, false, false, false);
    w.forceClose();
    if (e.bordes_a_cero_pct > 0.5) r.no_cumple.push(File.extractName(e.entrada) + ": " + e.bordes_a_cero_pct + " % de píxeles a 0 en los bordes tras recortar.");
  });
  // Limpieza de temporales.
  alSearch(tmp + "/" + "*.xisf", false).forEach(function (f) { try { File.remove(f); } catch (x) { } });
  try { File.removeDirectory(tmp); } catch (x) { }
  r.ficheros.forEach(function (e) { delete e.registrado; });

  r.control.medido.push("Zona común: " + r.rect.ancho + "x" + r.rect.alto + " px (" + r.conservado_pct + " % del campo de la referencia).");
  if (r.conservado_pct < 70) r.no_cumple.push("Sólo se conserva el " + r.conservado_pct + " % del campo: los masters están muy desplazados o girados entre sí; ¿son del mismo encuadre?");
  r.ficheros.forEach(function (e) {
    if (e.emparejadas !== undefined && e.emparejadas < 50) r.control.revisar_a_ojo.push(File.extractName(e.entrada) + ": sólo " + e.emparejadas + " estrellas emparejadas; comparar estrellas de las esquinas.");
    if (!e.wcs) r.control.revisar_a_ojo.push(File.extractName(e.entrada) + ": sin astrometría tras alinear; resolver en el Paso 8.");
  });
  r.control.revisar_a_ojo.push("Comparar a ojo 3–4 estrellas de las esquinas entre los masters alineados (Blink).");
  // Abre los alineados con un STF automático y deja delante la referencia (abrir: false para no abrirlos).
  if (o.abrir !== false) {
    r.vistas = [];
    r.ficheros.forEach(function (e) { if (e.entrada != ref && e.salida) r.vistas.push(abrirConSTF(e.salida, File.extractName(e.salida))); });
    var eRef = r.ficheros.filter(function (e) { return e.entrada == ref; })[0];
    if (eRef && eRef.salida) r.vistas.unshift(abrirConSTF(eRef.salida, File.extractName(eRef.salida)));
    r.vista = r.vistas[0];   // la referencia alineada (los modelos la buscaban como r.vista)
    // Astrometría: se resuelve la referencia y se copia a las demás (misma rejilla tras alinear y recortar). Así no hay
    // que encadenar resolverAstrometria ni buscar ids en el resultado. astrometria: false para no hacerlo.
    if (o.astrometria !== false && typeof blindSolve === "function" && r.vista) {
      var wr = ImageWindow.windowById(r.vista);
      if (!wr.hasAstrometricSolution) { try { blindSolve(r.vista); } catch (x) { } }
      r.astrometria = { resuelta: wr.hasAstrometricSolution, copiada_a: [] };
      if (wr.hasAstrometricSolution) r.vistas.slice(1).forEach(function (id) {
        var wv = ImageWindow.windowById(id);
        try { wv.copyAstrometricSolution(wr); if (wv.hasAstrometricSolution) r.astrometria.copiada_a.push(id); } catch (x) { }
      });
      if (!wr.hasAstrometricSolution) r.no_cumple.push("No se pudo resolver la astrometría de " + r.vista + ": hacer el Paso 8 a mano.");
      else r.control.revisar_a_ojo = r.control.revisar_a_ojo.filter(function (t) { return !/sin astrometría/.test(t); });
    } else if (o.astrometria !== false && r.vista) {
      // Sin blindSolve (script ejecutado fuera de PiCopilot o del watcher): que se vea, no en silencio.
      r.astrometria = { resuelta: false, motivo: "blindSolve no está disponible en este script: resolver con resolverAstrometria(r.vista) y copiar con copyAstrometricSolution" };
      r.no_cumple.push("Astrometría sin resolver (blindSolve no disponible): Paso 8 sobre " + r.vista + " y copiar a las demás.");
    }
  }
  return r;
}
