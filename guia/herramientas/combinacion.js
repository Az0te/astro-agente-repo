// combinacion.js — Paso 10 lineal: combinar dos masters del mismo canal, e inyectar Hα en el rojo de la RGB.
// PJSR, ECMAScript 5. Trabaja sobre copias: no modifica las vistas de entrada.
//
// Uso (cargar en el nivel superior del script, nunca dentro de una función):
//   eval(File.readTextFile("<ruta de guia>/herramientas/combinacion.js"));
//   JSON.stringify(combinarMismoCanal("Ha_mono", "Ha_dualband", { nuevaVista: "Ha_comb" }));
//   JSON.stringify(inyectarHa("RGB_starless", "Ha_CS", { tipo: "nebulosa", nuevaVista: "RGB_Ha" }));
//
// combinarMismoCanal(a, b): dos masters del mismo canal, alineados (Paso 5). Mide el ruido de cada uno (MRS) y su
//   escala de señal; ajusta el peor al mejor con LinearFit y los suma pesando por 1/σ² (sin rechazo). Controles:
//   ruido del resultado frente al mejor solo (debe bajar) y nitidez (tamaño medio de las estrellas de StarDetector; si el resultado lo empeora
//   más de un 10 % se avisa: entonces usarlo sólo para la señal difusa).
// inyectarHa(rgb, ha): RGB y Hα lineales, alineados, sin estrellas y con el continuo ya restado (Paso 16) si es posible.
//   LinearFit del Hα al canal R; máscara de nebulosa desde el Hα (estirado automático, clipLow 0,06, suavizada);
//   R' = (1 − α·M)·R + α·M·Hα con α 0,4 en nebulosas y 0,25 en galaxias (opción alfa). G y B no cambian.
//   Controles: dominante del cielo antes y después (medianas R/G/B en las celdas más oscuras: no debe enrojecer),
//   % del campo bajo la máscara y cuánto cambia el R en la nebulosa.

function cbView(x) {
  if (x && typeof x === "object" && x.id !== undefined) return x;
  var v = View.viewById(String(x));
  if (!v || v.isNull) throw new Error("No existe la vista " + x);
  return v;
}

function cbNewId(id) { var n = id; for (var k = 2; !ImageWindow.windowById(n).isNull; ++k) n = id + "_" + k; return n; }

function cbCopy(v, id, gray) {
  var im = v.image, nc = gray ? 1 : im.numberOfChannels;
  var w = new ImageWindow(im.width, im.height, nc, 32, true, nc > 1, cbNewId(id));
  w.mainView.beginProcess();
  if (gray && im.numberOfChannels > 1) { im.selectedChannel = 0; w.mainView.image.assign(im); im.resetSelections(); }
  else w.mainView.image.assign(im);
  w.mainView.endProcess();
  if (v.window.hasAstrometricSolution) try { w.copyAstrometricSolution(v.window); } catch (e) { }
  return w;
}

// Ruido gaussiano (MRS) del canal c.
function cbNoise(im, c) {
  im.selectedChannel = c || 0;
  var n = NaN;
  try { var r = im.noiseMRS(4); n = r[0]; } catch (e) { }
  if (!isFinite(n) || n <= 0) n = im.MAD() * 1.4826;
  im.resetSelections();
  return n;
}

// FWHM medio (px) de las estrellas detectadas; null si no hay StarDetector.
function cbFWHM(v) {
  try {
    if (typeof StarDetector === "undefined") return null;
    var D = new StarDetector; var s = D.stars(v.image);
    if (!s || s.length < 20) return null;
    var f = [];
    for (var i = 0; i < Math.min(s.length, 400); ++i) if (s[i].size) f.push(s[i].size);
    if (!f.length) return null;
    f.sort(function (a, b) { return a - b; }); return f[f.length >> 1];
  } catch (e) { return null; }
}

// Medianas por canal en el 10 % de celdas de 64 px más oscuras (sin celdas vacías).
function cbSky(im) {
  var W = im.width, H = im.height, S = 64, cells = [];
  for (var y = 0; y + S <= H; y += S) for (var x = 0; x + S <= W; x += S) {
    var r = new Rect(x, y, x + S, y + S), m = [];
    for (var c = 0; c < im.numberOfChannels; ++c) { im.selectedChannel = c; im.selectedRect = r; m.push(im.median()); }
    var l = m.reduce(function (a, b) { return a + b; }, 0) / m.length;
    if (l > 0) cells.push({ l: l, m: m });
  }
  im.resetSelections();
  cells.sort(function (a, b) { return a.l - b.l; });
  var n = Math.max(1, Math.floor(cells.length * 0.1)), out = [];
  for (var c = 0; c < im.numberOfChannels; ++c) {
    var v = cells.slice(0, n).map(function (q) { return q.m[c]; }).sort(function (a, b) { return a - b; });
    out.push(v[v.length >> 1]);
  }
  return out;
}

// Clase de un master por su filtro (FILTER o nombre) y canales: L, R, G, B, Ha, OIII, SII, Hb o RGB (color).
function cbClase(w, path) {
  if (w.mainView.image.numberOfChannels >= 3) return "RGB";
  var f = "", k = w.keywords;
  for (var i = 0; i < k.length; ++i) if (k[i].name == "FILTER") f = k[i].strippedValue;
  var t = (f + " " + File.extractName(path || w.mainView.id)).toUpperCase().replace(/[^A-Z0-9]+/g, " ");
  if (/\b(HA|H ALPHA|HALPHA|H)\b/.test(t) || /\bHA\d/.test(t)) return "Ha";
  if (/\b(OIII|O3|OXY)\b/.test(t)) return "OIII";
  if (/\b(SII|S2)\b/.test(t)) return "SII";
  if (/\b(HB|HBETA|H BETA)\b/.test(t)) return "Hb";
  if (/\b(L|LUM|LUMINANCE|LUMINANCIA)\b/.test(t)) return "L";
  if (/\b(R|RED|ROJO)\b/.test(t)) return "R";
  if (/\b(G|GREEN|VERDE)\b/.test(t)) return "G";
  if (/\b(B|BLUE|AZUL)\b/.test(t)) return "B";
  return "?";
}

// Paso 10 en una llamada: carpeta o lista de masters alineados (Paso 5), hasta ~8 (LRGB = 4; SHO + RGB = 4–6).
// Clasifica cada uno y hace lo que toca en lineal:
//   - dos masters de la misma clase → combinarMismoCanal (pesos 1/σ²);
//   - R, G y B mono → ChannelCombination en una RGB;
//   - RGB (OSC o la de R,G,B) + Hα → inyectarHa (mejor si son starless y el Hα ya sin continuo, Paso 16);
//   - L, y OIII/SII/Hβ sin RGB → se dejan abiertos: LRGB y paletas se montan en el Paso 2 no lineal.
// Opciones: tipo ("nebulosa" | "galaxia"), alfa, inyectar (false para no meter el Hα), clases ({ "fichero": "Ha" } si
// el filtro no se reconoce). Devuelve las clases, lo hecho, las vistas abiertas y no_cumple.
function combinarMasters(lista, o) {
  o = o || {};
  var files = [];
  (lista instanceof Array ? lista : [lista]).forEach(function (x) {
    var p = String(x).replace(/\\/g, "/").replace(/\/$/, "");
    if (File.directoryExists(p))
      files = files.concat((File.searchDirectory ? File.searchDirectory(p + "/*.xisf", false) : searchDirectory(p + "/*.xisf", false))
        .filter(function (f) { return !/mask|mascara|rejection|drizzle_weights|LN_Reference/i.test(File.extractName(f)); }).sort());
    else files.push(p);
  });
  if (files.length < 2) throw new Error("Hacen falta al menos dos masters (o una carpeta con ellos) para combinar");
  cbNeeds();
  if (files.length > 8) throw new Error("Demasiados masters (" + files.length + "): pasa sólo los que se combinan (LRGB, Hα/OIII/SII con RGB...)");
  var r = { masters: [], hecho: [], vistas: [], no_cumple: [], control: { medido: [], revisar_a_ojo: [] } }, por = {}, W = 0, H = 0;
  files.forEach(function (f) {
    var abierta = null, ws = ImageWindow.windows;
    for (var i = 0; i < ws.length; ++i) if (ws[i].filePath == f) abierta = ws[i];
    var w = abierta || ImageWindow.open(f)[0];
    var cl = (o.clases && (o.clases[f] || o.clases[File.extractName(f)])) || cbClase(w, f);
    if (!W) { W = w.mainView.image.width; H = w.mainView.image.height; }
    if (w.mainView.image.width != W || w.mainView.image.height != H)
      throw new Error("Tamaños distintos (" + File.extractName(f) + "): alinear y recortar antes (Paso 5, alinearMasters)");
    var id = cbNewId(cl == "?" ? "M_" + File.extractName(f).replace(/[^A-Za-z0-9_]/g, "_").substring(0, 40) : cl);
    if (!abierta) w.mainView.id = id;
    w.show();
    (por[cl] = por[cl] || []).push(w.mainView.id);
    r.masters.push({ fichero: f, clase: cl, vista: w.mainView.id });
  });
  if (por["?"]) r.no_cumple.push("No se reconoce el filtro de: " + por["?"].join(", ") + ". Pásalo en clases: { \"<fichero>\": \"Ha\" | \"OIII\" | \"L\" | \"R\"... }.");

  // 1. Mismo canal: combinar de dos en dos.
  for (var cl in por) {
    if (cl == "?" || por[cl].length < 2) continue;
    var acc = por[cl][0];
    for (var i = 1; i < por[cl].length; ++i) {
      var c = combinarMismoCanal(acc, por[cl][i], { nuevaVista: cl + "_comb" });
      r.hecho.push("Dos " + cl + " combinados (pesos " + c.pesos.a + " / " + c.pesos.b + ", ruido −" + c.mejora_ruido_pct + " %) → " + c.vista);
      r.no_cumple = r.no_cumple.concat(c.no_cumple);
      acc = c.vista;
    }
    por[cl] = [acc];
  }
  // 2. R, G y B mono → RGB.
  if (por.R && por.G && por.B) {
    var CC = new ChannelCombination;
    CC.colorSpace = (ChannelCombination.RGB !== undefined) ? ChannelCombination.RGB : 0;
    CC.channels = [[true, por.R[0]], [true, por.G[0]], [true, por.B[0]]];
    var antes = ImageWindow.windows.map(function (w) { return w.mainView.id; });
    if (!CC.executeGlobal()) throw new Error("ChannelCombination falló");
    var nueva = ImageWindow.windows.filter(function (w) { return antes.indexOf(w.mainView.id) < 0; })[0];
    if (nueva) {
      nueva.mainView.id = cbNewId("RGB_comb");
      var src = ImageWindow.windowById(por.R[0]);
      if (src.hasAstrometricSolution) try { nueva.copyAstrometricSolution(src); } catch (e) { }
      por.RGB = [nueva.mainView.id];
      r.hecho.push("R, G y B combinados en " + nueva.mainView.id + " (falta SPCC, Paso 12).");
    }
  }
  // 3. Hα en la RGB.
  if (por.RGB && por.Ha && o.inyectar !== false) {
    var h = inyectarHa(por.RGB[0], por.Ha[0], { tipo: o.tipo, alfa: o.alfa, nuevaVista: por.RGB[0] + "_Ha" });
    r.hecho.push("Hα inyectado en el R de " + por.RGB[0] + " → " + h.vista + " (" + h.control.medido[0] + ")");
    r.no_cumple = r.no_cumple.concat(h.no_cumple);
    r.control.revisar_a_ojo = r.control.revisar_a_ojo.concat(h.control.revisar_a_ojo);
    r.inyeccion = { vista: h.vista, mascara: h.mascara, cielo_R_sobre_GB: h.cielo_R_sobre_GB, bajo_mascara_pct: h.bajo_mascara_pct, cambio_R_nebulosa_pct: h.cambio_R_nebulosa_pct };
  }
  // 4. Lo que se deja para la fase no lineal.
  if (por.L) r.control.medido.push("L (" + por.L[0] + "): la combinación LRGB se hace en el Paso 2 no lineal, con las dos ya estiradas.");
  var nb = ["Ha", "OIII", "SII", "Hb"].filter(function (c) { return por[c]; });
  if (nb.length && !por.RGB) r.control.medido.push("Banda estrecha sin RGB (" + nb.join(", ") + "): la paleta (HOO, SHO...) se monta en el Paso 2 no lineal; aquí no hay nada que combinar en lineal.");
  if (!r.hecho.length) r.control.medido.push("Nada que combinar en lineal con estos masters.");
  r.vistas = ImageWindow.windows.map(function (w) { return w.mainView.id; });
  return r;
}

function combinarMismoCanal(a, b, o) {
  o = o || {};
  var va = cbView(a), vb = cbView(b);
  if (va.image.width != vb.image.width || va.image.height != vb.image.height)
    throw new Error("Tamaños distintos: alinear y recortar antes (Paso 5, alinearMasters)");
  var nA = cbNoise(va.image), nB = cbNoise(vb.image);
  // Mejor = menor ruido relativo a su señal (la mediana sobre el fondo la da LinearFit; aquí basta el ruido tras ajustar).
  var wa = cbCopy(va, "cbA", true), wb = cbCopy(vb, "cbB", true);
  var LF = new LinearFit; LF.referenceViewId = wa.mainView.id;
  if (!LF.executeOn(wb.mainView)) throw new Error("LinearFit falló");
  var nBf = cbNoise(wb.mainView.image);           // ruido de b en la escala de a
  var mejor = nA <= nBf ? "a" : "b";
  var pA = 1 / (nA * nA), pB = 1 / (nBf * nBf), kA = pA / (pA + pB), kB = pB / (pA + pB);
  var id = cbNewId(o.nuevaVista || (va.id + "_comb"));
  var PM = new PixelMath;
  PM.expression = kA.toFixed(6) + "*" + wa.mainView.id + " + " + kB.toFixed(6) + "*" + wb.mainView.id;
  PM.useSingleExpression = true; PM.createNewImage = true; PM.showNewImage = true; PM.newImageId = id;
  PM.newImageWidth = 0; PM.newImageHeight = 0; PM.rescale = false; PM.truncate = false;
  PM.newImageColorSpace = (PixelMath.Gray !== undefined) ? PixelMath.Gray : PixelMath.prototype.Gray;
  PM.newImageSampleFormat = (PixelMath.f32 !== undefined) ? PixelMath.f32 : PixelMath.prototype.f32;
  if (!PM.executeOn(wa.mainView)) throw new Error("PixelMath de la combinación falló");
  var out = ImageWindow.windowById(id);
  if (va.window.hasAstrometricSolution) try { out.copyAstrometricSolution(va.window); } catch (e) { }
  var nOut = cbNoise(out.mainView.image), nBest = Math.min(nA, nBf);
  var fA = cbFWHM(va), fB = cbFWHM(vb), fO = cbFWHM(out.mainView);
  wa.forceClose(); wb.forceClose();
  var r = { vista: id, pesos: { a: +kA.toFixed(3), b: +kB.toFixed(3) }, ruido: { a: nA, b_ajustado: nBf, resultado: nOut },
            mejora_ruido_pct: +(100 * (1 - nOut / nBest)).toFixed(1), tamano_estrellas_px: { a: fA, b: fB, resultado: fO },
            no_cumple: [], control: { medido: [], revisar_a_ojo: [] } };
  r.control.medido.push("Pesos 1/σ²: " + va.id + " " + r.pesos.a + ", " + vb.id + " " + r.pesos.b + "; ruido " + r.mejora_ruido_pct + " % menor que el mejor solo.");
  if (r.mejora_ruido_pct < 2) r.no_cumple.push("La combinación apenas baja el ruido (" + r.mejora_ruido_pct + " %): el segundo master no compensa; usar el mejor solo.");
  var fBest = mejor == "a" ? fA : fB;
  if (fO && fBest && fO > 1.1 * fBest) r.no_cumple.push("El tamaño de las estrellas empeora un " + Math.round(100 * (fO / fBest - 1)) + " %: usar el peor master sólo para la señal difusa (máscara o separación por escalas).");
  r.control.revisar_a_ojo.push("Comparar al 100 % con el mejor master solo: nitidez de estrellas y textura del ruido.");
  return r;
}

function inyectarHa(rgb, ha, o) {
  o = o || {};
  var vr = cbView(rgb), vh = cbView(ha);
  if (vr.image.numberOfChannels < 3) throw new Error(vr.id + " no es RGB");
  if (vr.image.width != vh.image.width || vr.image.height != vh.image.height)
    throw new Error("Tamaños distintos: alinear y recortar antes (Paso 5, alinearMasters)");
  var alfa = o.alfa !== undefined ? o.alfa : (o.tipo == "galaxia" ? 0.25 : 0.4), clip = o.clipLow !== undefined ? o.clipLow : 0.06;

  cbNeeds();
  // Hα ajustado al R (LinearFit sobre una copia gris del R).
  var wR = cbCopy(vr, "cbR", true), wH = cbCopy(vh, "cbHa", true), wM = null, wO = null;
  try {
  var LF = new LinearFit; LF.referenceViewId = wR.mainView.id;
  if (!LF.executeOn(wH.mainView)) throw new Error("LinearFit del Hα al R falló");

  // Máscara de nebulosa: Hα con estirado automático (fondo a 0,25), clipLow y suavizado.
  // Máscara en lineal, referida al CIELO (celdas más oscuras), no a la mediana: en nebulosas que llenan el campo
  // (IC 1396) la mediana ya es nebulosa. Empieza en cielo + clipLow·(p99,5 − cielo) y llega a 1 en el p99,5,
  // con raíz cuadrada para que la nebulosa débil entre con peso.
  var him = wH.mainView.image, mId = cbNewId("cbMask");
  var cielo = cbSky(him)[0], smp = [], rowH = new Float32Array(him.width);
  for (var yy = 0; yy < him.height; yy += 8) { him.getSamples(rowH, new Rect(0, yy, him.width, yy + 1), 0); for (var xx = 0; xx < him.width; xx += 8) smp.push(rowH[xx]); }
  smp.sort(function (p, q) { return p - q; });
  var x99 = smp[Math.floor(0.995 * (smp.length - 1))];
  var lo = cielo + clip * (x99 - cielo), hi = x99;
  var PM = new PixelMath;
  PM.expression = "sqrt(max(0, min(1, ($T - " + lo.toExponential(6) + ")/" + (hi - lo).toExponential(6) + ")))";
  PM.symbols = ""; PM.useSingleExpression = true; PM.createNewImage = true; PM.showNewImage = false; PM.newImageId = mId;
  PM.rescale = false; PM.truncate = true;
  PM.newImageColorSpace = (PixelMath.Gray !== undefined) ? PixelMath.Gray : PixelMath.prototype.Gray;
  PM.newImageSampleFormat = (PixelMath.f32 !== undefined) ? PixelMath.f32 : PixelMath.prototype.f32;
  if (!PM.executeOn(wH.mainView)) throw new Error("PixelMath de la máscara falló");
  wM = ImageWindow.windowById(mId);
  var C = new Convolution; C.mode = (Convolution.Parametric !== undefined) ? Convolution.Parametric : Convolution.prototype.Parametric;
  C.sigma = o.suavizado || 4; C.shape = 2; C.aspectRatio = 1;
  C.executeOn(wM.mainView);

  // Mezcla en el R de una copia.
  var id = cbNewId(o.nuevaVista || (vr.id + "_Ha"));
  wO = cbCopy(vr, id, false);
  var P2 = new PixelMath;
  P2.useSingleExpression = false; P2.symbols = "a, m";
  P2.expression = "a = " + alfa + "; m = " + mId + "; (1 - a*m)*$T + a*m*" + wH.mainView.id;
  P2.expression1 = "$T"; P2.expression2 = "$T"; P2.rescale = false; P2.truncate = true; P2.createNewImage = false;
  if (!P2.executeOn(wO.mainView)) throw new Error("PixelMath de la inyección falló");

  // Controles.
  var sky0 = cbSky(vr.image), sky1 = cbSky(wO.mainView.image);
  var rel = function (s) { var g = (s[1] + s[2]) / 2; return g > 0 ? s[0] / g : NaN; };
  var mim = wM.mainView.image, en = 0, tot = 0, row = new Float32Array(mim.width);
  for (var y = 0; y < mim.height; y += 4) { mim.getSamples(row, new Rect(0, y, mim.width, y + 1), 0); for (var x = 0; x < mim.width; x += 4) { ++tot; if (row[x] > 0.5) ++en; } }
  // Cuánto cambia el R donde la máscara pasa de 0,5.
  var rIn = vr.image, rOut = wO.mainView.image, b0 = new Float32Array(rIn.width), b1 = new Float32Array(rIn.width), s0 = 0, s1 = 0;
  for (var y = 0; y < mim.height; y += 4) {
    mim.getSamples(row, new Rect(0, y, mim.width, y + 1), 0);
    rIn.getSamples(b0, new Rect(0, y, rIn.width, y + 1), 0); rOut.getSamples(b1, new Rect(0, y, rIn.width, y + 1), 0);
    for (var x = 0; x < mim.width; x += 4) if (row[x] > 0.5) { s0 += b0[x]; s1 += Math.abs(b1[x] - b0[x]); }
  }
  var r = { vista: id, mascara: mId, alfa: alfa, clipLow: clip,
            cielo_R_sobre_GB: { antes: +rel(sky0).toFixed(4), despues: +rel(sky1).toFixed(4) },
            bajo_mascara_pct: +(100 * en / tot).toFixed(1), cambio_R_nebulosa_pct: s0 > 0 ? +(100 * s1 / s0).toFixed(1) : null,
            no_cumple: [], control: { medido: [], revisar_a_ojo: [] } };
  wR.forceClose(); wH.forceClose();
  wM.show();
  var d = 100 * (r.cielo_R_sobre_GB.despues / r.cielo_R_sobre_GB.antes - 1);
  r.control.medido.push("Cielo R/(G+B)/2: " + r.cielo_R_sobre_GB.antes + " → " + r.cielo_R_sobre_GB.despues + " (" + d.toFixed(1) + " %); máscara sobre el " + r.bajo_mascara_pct + " % del campo; el R cambia un " + r.cambio_R_nebulosa_pct + " % de media en la nebulosa (LinearFit iguala niveles: aporta estructura, no más rojo).");
  if (r.cambio_R_nebulosa_pct !== null && r.cambio_R_nebulosa_pct < 1)
    r.control.revisar_a_ojo.push("El Hα cambia el R menos de un 1 % en la nebulosa: con este alfa aporta poco; comparar a ojo si compensa, o subir alfa.");
  if (d > 3) r.no_cumple.push("El cielo enrojece un " + d.toFixed(1) + " %: subir clipLow o bajar alfa (sin máscara fina el fondo se vuelve rojo).");
  if (r.bajo_mascara_pct > 80) r.no_cumple.push("La máscara cubre el " + r.bajo_mascara_pct + " % del campo: subir clipLow para que no entre el cielo.");
  r.control.revisar_a_ojo.push("Comparar con la RGB sola al 100 % en una zona de Hα y en el fondo: sin textura distinta entre nebulosa y banda ancha, sin bordes de máscara, sin estrellas rojas.");
  return r;
  } catch (e) {   // si algo falla, no dejar ventanas temporales abiertas
    [wR, wH, wM, wO].forEach(function (w) { try { if (w && !w.isNull) w.forceClose(); } catch (x) { } });
    throw e;
  }
}

// Procesos que necesitan estas funciones: si falta alguno, se dice cuál (5 nov 2026: PixelMath había desaparecido
// de una sesión de PixInsight y el error "PixelMath is not defined" hizo que el modelo reescribiera todo a mano).
function cbNeeds() {
  var faltan = ["PixelMath", "LinearFit", "Convolution", "ChannelCombination"].filter(function (p) {
    try { return eval("typeof " + p) === "undefined"; } catch (e) { return true; } });
  if (faltan.length)
    throw new Error("Falta en PixInsight el proceso " + faltan.join(", ") + " (módulo desinstalado o sin cargar): " +
                    "reinstálalo en Process > Modules > Install Modules o reinicia PixInsight. No es un fallo del script: no lo reescribas.");
}
