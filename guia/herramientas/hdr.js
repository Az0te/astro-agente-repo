// hdr.js — Paso 6 lineal: HDRComposition de una toma larga y una (o varias) cortas, con umbral medido y controles.
// PJSR, ECMAScript 5.
//
// Uso (cargar en el nivel superior del script, nunca dentro de una función):
//   eval(File.readTextFile("<ruta de guia>/herramientas/hdr.js"));
//   JSON.stringify(componerHDR(["<master largo>", "<master corto>"], { nuevaVista: "HDR" }));
//
// Entrada: ficheros (o vistas abiertas) ya alineados y recortados igual (Paso 5), de la misma noche o preprocesado.
// Se ordenan de mayor a menor exposición (EXPTIME de la cabecera; si falta, por el brillo de las estrellas).
// Qué hace:
//   1. Mide la meseta de saturación por canal de cada toma salvo la más corta (percentil 99,99 % de los píxeles
//      brillantes): con LocalNormalization no saturan a 1 (IC 63: 0,89–0,96).
//   2. Umbral de binarización = 0,9 × la meseta más baja (por defecto; opción umbral): en OSC hay que sustituir en
//      cuanto se satura cualquier canal. Suavizado 7 y crecimiento 1 (opciones suavizado, crecimiento).
//   3. HDRComposition (executeGlobal) → vista nueva con el resultado y sus máscaras.
//   4. Controles: n−1 máscaras; % del campo sustituido; razón de flujo larga/corta en estrellas no saturadas;
//      escalón en la transición (HDR frente a la corta escalada, donde la máscara está entre 0,2 y 0,8); si la corta
//      también satura en los núcleos (haría falta un grupo más corto).
// Devuelve { vista, mascaras, umbral, mesetas, sustituido_pct, razon_flujo, escalon_pct, corta_saturada_px,
//            no_cumple, control: { medido, revisar_a_ojo } }.

function hdrOpen(x, id) {
  // Vista abierta (id o View) o fichero: devuelve { win, view, tmp } (tmp = la abrimos nosotros y hay que cerrarla).
  if (x && typeof x === "object" && x.id !== undefined) return { win: x.window, view: x, tmp: false };
  var s = String(x).replace(/\\/g, "/");
  if (!File.exists(s)) {
    var v = View.viewById(s);
    if (v && !v.isNull) return { win: v.window, view: v, tmp: false };
    throw new Error("No existe la vista ni el fichero " + s);
  }
  var w = ImageWindow.open(s, id || "hdrIN", "verbosity 0", true)[0];
  return { win: w, view: w.mainView, tmp: true, path: s };
}

function hdrExp(o) {
  var k = o.win.keywords;
  for (var i = 0; i < k.length; ++i) if (k[i].name == "EXPTIME" || k[i].name == "EXPOSURE") { var e = parseFloat(k[i].strippedValue); if (isFinite(e)) return e; }
  try { var p = o.view.propertyValue("Instrument:ExposureTime"); if (p) return parseFloat(p); } catch (e) { }
  var m = (o.path || o.view.id).match(/(\d+(?:\.\d+)?)\s*s(?![a-z])/i) || (o.path || o.view.id).match(/[^0-9](\d{2,3})(?:_|\.|$)/);
  return m ? parseFloat(m[1]) : NaN;
}

// Meseta de saturación de un canal: percentil 99,99 de una muestra de los píxeles más brillantes.
function hdrPlateau(im, c) {
  im.selectedChannel = c;
  var mx = im.maximum(), W = im.width, H = im.height, row = new Float32Array(W), vals = [];
  for (var y = 0; y < H; y += 2) {
    im.getSamples(row, new Rect(0, y, W, y + 1), c);
    for (var x = 0; x < W; ++x) if (row[x] > 0.5 * mx) vals.push(row[x]);
  }
  im.resetSelections();
  if (vals.length < 20) return { meseta: mx, n: vals.length };
  vals.sort(function (a, b) { return a - b; });
  // La meseta es el valor donde se acumulan los saturados: el percentil 99 de los brillantes.
  return { meseta: vals[Math.floor(0.99 * (vals.length - 1))], maximo: mx, n: vals.length };
}

function componerHDR(lista, o) {
  o = o || {};
  // También una carpeta (o lista de carpetas) con los masters alineados: se toman sus .xisf (sin máscaras ni mapas).
  var items = [];
  (lista instanceof Array ? lista : [lista]).forEach(function (x) {
    var p = (typeof x === "string") ? x.replace(/\\/g, "/").replace(/\/$/, "") : x;
    if (typeof p === "string" && File.directoryExists(p))
      items = items.concat((File.searchDirectory ? File.searchDirectory(p + "/*.xisf", false) : searchDirectory(p + "/*.xisf", false))
        .filter(function (f) { return !/mask|mascara|rejection|drizzle_weights|LN_Reference|HDR/i.test(File.extractName(f)); }));
    else items.push(p);
  });
  lista = items;
  if (lista.length < 2) throw new Error("Pasa al menos dos masters alineados (larga y corta), o la carpeta que los contiene");
  var ins = lista.map(function (x, i) { return hdrOpen(x, "hdrIN" + i); });
  var W = ins[0].view.image.width, H = ins[0].view.image.height, nc = ins[0].view.image.numberOfChannels;
  ins.forEach(function (a) {
    if (a.view.image.width != W || a.view.image.height != H)
      throw new Error("Los masters no tienen el mismo tamaño: alinéalos y recórtalos igual antes (Paso 5, alinearMasters)");
  });
  ins.forEach(function (a) { a.exp = hdrExp(a); });
  if (ins.every(function (a) { return isFinite(a.exp); })) ins.sort(function (a, b) { return b.exp - a.exp; });
  var r = { exposiciones: ins.map(function (a) { return a.exp; }), no_cumple: [], control: { medido: [], revisar_a_ojo: [] } };

  // 1-2. Mesetas y umbral.
  var mes = [];
  for (var i = 0; i < ins.length - 1; ++i)
    for (var c = 0; c < nc; ++c) mes.push(+hdrPlateau(ins[i].view.image, c).meseta.toFixed(4));
  r.mesetas = mes;
  var umbral = o.umbral || +(0.9 * Math.min.apply(null, mes)).toFixed(3);
  r.umbral = umbral;

  // HDRComposition trabaja con ficheros: los de vistas (o ya abiertos) se guardan en temporales.
  var tmpDir = File.systemTempDirectory + "/picopilot_hdr", paths = [];
  if (!File.directoryExists(tmpDir)) File.createDirectory(tmpDir, true);
  ins.forEach(function (a, i) {
    if (a.path) { paths.push(a.path); return; }
    var p = tmpDir + "/hdr_in" + i + ".xisf";
    var w = new ImageWindow(W, H, nc, 32, true, nc > 1, "hdrTMP" + i);
    w.mainView.beginProcess(); w.mainView.image.assign(a.view.image); w.mainView.endProcess();
    w.saveAs(p, false, false, false, false); w.forceClose(); paths.push(p);
  });

  // 3. HDRComposition.
  var antes = ImageWindow.windows.map(function (w) { return w.mainView.id; });
  var P = new HDRComposition;
  P.images = paths.map(function (p) { return [true, p]; });
  P.maskBinarizingThreshold = umbral;
  P.maskSmoothness = o.suavizado || 7;
  P.maskGrowth = o.crecimiento !== undefined ? o.crecimiento : 1;
  P.generateMask = true;
  if (P.autoExposures !== undefined) P.autoExposures = true;
  if (!P.executeGlobal()) throw new Error("HDRComposition falló (ver la consola)");
  var nuevas = ImageWindow.windows.filter(function (w) { return antes.indexOf(w.mainView.id) < 0; });
  var hdrW = null, masks = [];
  nuevas.forEach(function (w) { if (/mask/i.test(w.mainView.id)) masks.push(w); else hdrW = w; });
  if (!hdrW) throw new Error("HDRComposition no creó la imagen HDR");
  var id = o.nuevaVista || "HDR";
  if (hdrW.mainView.id != id) { var free = id; for (var n = 2; !ImageWindow.windowById(free).isNull; ++n) free = id + "_" + n; hdrW.mainView.id = free; }
  if (ins[0].win.hasAstrometricSolution && !hdrW.hasAstrometricSolution) try { hdrW.copyAstrometricSolution(ins[0].win); } catch (e) { }
  r.vista = hdrW.mainView.id;
  r.mascaras = masks.map(function (w) { return w.mainView.id; });
  if (masks.length != ins.length - 1)
    r.no_cumple.push("Hay " + masks.length + " máscaras para " + ins.length + " imágenes (deben ser " + (ins.length - 1) +
                     "): bajar el umbral (\"cannot integrate further images\").");

  // 4. Controles con la primera máscara (larga ↔ siguiente), sobre luminancia media de canales, en filas alternas.
  var L = ins[0].view.image, S = ins[1].view.image, Hh = hdrW.mainView.image, M = masks.length ? masks[0].mainView.image : null;
  var buf = new Float32Array(W), sumL = new Float32Array(W), sumS = new Float32Array(W), sumH = new Float32Array(W), mrow = new Float32Array(W);
  var rLH = [], rSH = [], rLS = [], trans = [], sust = 0, tot = 0, sCorta = 0, mesS = [];
  for (var c = 0; c < nc; ++c) mesS.push(hdrPlateau(S, c).meseta);
  var mesSmin = Math.min.apply(null, mesS);
  for (var y = 0; y < H; y += 2) {
    for (var x = 0; x < W; ++x) { sumL[x] = 0; sumS[x] = 0; sumH[x] = 0; }
    var sCortaFila = new Uint8Array(W);
    for (var c = 0; c < nc; ++c) {
      L.getSamples(buf, new Rect(0, y, W, y + 1), c); for (var x = 0; x < W; ++x) sumL[x] += buf[x] / nc;
      S.getSamples(buf, new Rect(0, y, W, y + 1), c); for (var x = 0; x < W; ++x) { sumS[x] += buf[x] / nc; if (buf[x] >= 0.98 * mesS[c]) sCortaFila[x] = 1; }
      Hh.getSamples(buf, new Rect(0, y, W, y + 1), c); for (var x = 0; x < W; ++x) sumH[x] += buf[x] / nc;
    }
    if (M) M.getSamples(mrow, new Rect(0, y, W, y + 1), 0);
    for (var x = 0; x < W; x += 2) {
      var m = M ? mrow[x] : 0; ++tot; if (m > 0.5) ++sust; if (sCortaFila[x]) ++sCorta;
      if (m == 0 && sumL[x] > 0.05 && sumL[x] < 0.5 * umbral && sumS[x] > 0) { rLH.push(sumH[x] / sumL[x]); rLS.push(sumL[x] / sumS[x]); }
      if (m >= 0.99 && sumS[x] > 0.02) rSH.push(sumH[x] / sumS[x]);
      if (m > 0.2 && m < 0.8 && sumS[x] > 0.01) trans.push([sumH[x], sumS[x]]);
    }
  }
  function med(a) { if (!a.length) return NaN; var b = a.slice().sort(function (p, q) { return p - q; }); return b[b.length >> 1]; }
  var kS = med(rSH), kL = med(rLH);
  r.sustituido_pct = +(100 * sust / tot).toFixed(3);
  r.razon_flujo = isFinite(med(rLS)) ? +med(rLS).toFixed(3) : null;
  if (isFinite(r.razon_flujo) && ins.every(function (a) { return isFinite(a.exp); }))
    r.control.medido.push("Razón de flujo larga/corta " + r.razon_flujo + " (exposiciones " + (ins[0].exp / ins[1].exp).toFixed(2) + ").");
  if (trans.length > 50 && isFinite(kS)) {
    var dev = trans.map(function (t) { return t[0] / (kS * t[1]) - 1; });
    r.escalon_pct = +(100 * med(dev)).toFixed(1);
    if (Math.abs(r.escalon_pct) > 3)
      r.no_cumple.push("Escalón del " + r.escalon_pct + " % en la transición larga→corta: subir suavizado o crecimiento, o añadir un grupo intermedio.");
  } else r.escalon_pct = null;
  r.corta_saturada_px = sCorta * 4;
  if (sCorta * 4 > 50)
    r.control.revisar_a_ojo.push("La toma corta también satura en ~" + (sCorta * 4) + " px (núcleos más brillantes): haría falta un grupo más corto, o rellenarlos en el Paso 8 no lineal.");
  r.control.medido.push("Umbral " + umbral + " (0,9 × meseta mínima " + Math.min.apply(null, mes).toFixed(3) + "); sustituido " + r.sustituido_pct + " % del campo.");
  if (r.sustituido_pct > 5) r.control.revisar_a_ojo.push("Se sustituye más del 5 % del campo: ¿umbral demasiado bajo? Mirar la máscara " + (r.mascaras[0] || "") + ".");
  if (r.sustituido_pct == 0) r.no_cumple.push("La máscara no sustituye nada: la larga no satura por encima del umbral, o el umbral es demasiado alto.");
  r.control.revisar_a_ojo.push("Revisar al 100 % los bordes de la sustitución en las estrellas brillantes y los núcleos (sin anillos de color ni escalones).");

  ins.forEach(function (a) { if (a.tmp) a.win.forceClose(); });
  var tmpFiles = File.searchDirectory ? File.searchDirectory(tmpDir + "/*.xisf", false) : [];
  tmpFiles.forEach(function (f) { try { File.remove(f); } catch (e) { } });
  hdrW.show();
  return r;
}
