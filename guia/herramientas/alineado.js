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
//   3. Calcula el rectángulo donde TODOS los masters tienen datos (píxeles distintos de 0 en todos los canales) y
//      recorta todos a ese rectángulo, incluida la referencia. Guarda <nombre>_alin.xisf en salida.
//   4. Controles: fracción del campo que se conserva, bordes sin 0 tras el recorte, estrellas emparejadas por
//      StarAlignment, y si cada fichero conserva la astrometría (PixInsight 1.9.6+).
// Devuelve { referencia, rect, conservado_pct, ficheros: [{ entrada, salida, escala, reescalado, emparejadas, wcs }],
//            no_cumple, control: { medido, revisar_a_ojo } }.

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
  var v = w.mainView, im = v.image, stf = [];
  for (var c = 0; c < im.numberOfChannels; ++c) {
    im.selectedChannel = c;
    var med = im.median(), mad = im.MAD() * 1.4826, sh = Math.max(0, Math.min(1, med - 2.8 * mad));
    var m = med - sh, mt = Math.mtf(0.25, m);   // fondo a 0,25
    stf.push([sh, 1, mt, 0, 1]);   // c0 (sombras), c1 (luces), m (medios), r0, r1
  }
  im.resetSelections();
  if (im.numberOfChannels == 1) stf = [stf[0], stf[0], stf[0]];
  while (stf.length < 4) stf.push([0, 1, 0.5, 0, 1]);
  var S = new ScreenTransferFunction; S.STF = stf; S.executeOn(v, false);
  w.show();
  return v.id;
}

// PixInsight 1.9.6 conserva la astrometría LINEAL al recortar, reescalar o girar, pero la que lleva corrección de
// distorsión (splines) no se puede transformar: el proceso abre un diálogo "Some of these side effects could be
// irreversible. Proceed?" que deja el script esperando. Esto la reduce a su parte lineal (se queda en la ventana,
// no en el fichero): comprobado con IC 63 v4, tras IntegerResample ×2 coincide con una resolución nueva a 0,11 px.
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
  o = o || {};
  // Ficheros o carpetas (de una carpeta se toman sus .xisf, sin mapas de rechazo, pesos de drizzle ni ya alineados).
  var files = [];
  (lista instanceof Array ? lista : [lista]).forEach(function (x) {
    var p = String(x).replace(/\\/g, "/").replace(/\/$/, "");
    if (File.directoryExists(p))
      files = files.concat(alSearch(p + "/*.xisf", false).filter(function (f) {
        return !/rejection|drizzle_weights|_alin\.|LN_Reference|_modelo|_model/i.test(File.extractName(f)); }).sort());
    else files.push(p);
  });
  if (files.length < 1) throw new Error("No hay masters en " + lista + ": pasa ficheros .xisf o la carpeta que los contiene");
  files.forEach(function (f) { if (!File.exists(f)) throw new Error("No existe " + f); });
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
    for (var c = 0; c < im.numberOfChannels; ++c) {
      im.getSamples(buf, new Rect(0, 0, W, H), c);
      for (var i = 0; i < W * H; ++i) if (buf[i] <= 0) valid[i] = 0;
    }
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
  var margen = o.margen !== undefined ? o.margen : 4;   // unos píxeles más por la interpolación del borde
  x0 += margen; y0 += margen; x1 -= margen; y1 -= margen;
  r.rect = { x0: x0, y0: y0, x1: x1 + 1, y1: y1 + 1, ancho: x1 - x0 + 1, alto: y1 - y0 + 1 };
  r.conservado_pct = +(100 * (x1 - x0 + 1) * (y1 - y0 + 1) / (W * H)).toFixed(1);

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
  alSearch(tmp + "/*.xisf", false).forEach(function (f) { try { File.remove(f); } catch (x) { } });
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
  }
  return r;
}
