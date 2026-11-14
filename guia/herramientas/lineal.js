// lineal.js — Pasos cortos de la guía en una sola llamada, con sus controles. PJSR, ECMAScript 5.
//   resolverAstrometria (Paso 8 lineal), bxtCorrectOnly (Paso 11), checkpointLineal (Paso 17), quitarVerde (Paso 3
//   no lineal). Usan funciones de color.js y deconvolucion.js, que se cargan solas desde la guía (PIASTROPILOT_GUIA u
//   opción guia) si no están cargadas.
//
// Uso (en el nivel superior del script):
//   eval(File.readTextFile("<ruta de guia>/herramientas/lineal.js"));
//   var a = resolverAstrometria("MasterLight");                       // necesita blindSolve (watcher v8 o PiAstroPilot)
//   var b = bxtCorrectOnly("MasterLight", { nuevaVista: "MasterLight_bxtco" });
//   var c = checkpointLineal("MasterLight_dn", { carpeta: carpetaVersion, objeto: nombreObjeto, version: "v1" });
//   var d = quitarVerde("Starless_st", { nuevaVista: "Starless_sinverde" });

function lnNeed(fnName, file, o) {
  var ok = false;
  try { ok = (typeof eval(fnName) === "function"); } catch (e) { ok = false; }
  if (ok) return;
  var g = (o && o.guia) || (typeof PIASTROPILOT_GUIA === "string" ? PIASTROPILOT_GUIA : null);
  if (!g) throw new Error("Falta herramientas/" + file + ": cárgalo con eval antes de lineal.js");
  eval.call(null, File.readTextFile(g + "/herramientas/" + file));
}

function lnId(v) { return (v && typeof v === "object" && v.id !== undefined) ? v.id : v; }

function lnCopy(viewId, newId) {
  var src = ImageWindow.windowById(viewId);
  if (src.isNull) throw new Error("No existe la vista " + viewId);
  var im = src.mainView.image; im.resetSelections();
  var id = newId;
  for (var n = 2; !ImageWindow.windowById(id).isNull; ++n) id = newId + "_" + n;
  var w = new ImageWindow(im.width, im.height, im.numberOfChannels, 32, true, im.isColor, id);
  w.mainView.beginProcess(); w.mainView.image.assign(im); w.mainView.endProcess();
  if (src.hasAstrometricSolution) w.copyAstrometricSolution(src);
  w.show();
  return w;
}

// FWHM por canal (momentos de segundo orden sobre las mismas estrellas, detectadas en la luminancia).
function lnFwhmPorCanal(view, base) {
  lnNeed("dcMeasure", "deconvolucion.js");
  var im = view.image, W = im.width, H = im.height, R = new Rect(0, 0, W, H), n = W * H, out = [];
  var L = dcLum(view, R), st = base ? base.st : dcStats(L), stars = base ? base.stars : dcStars(L, W, H, st);
  var b = new Float32Array(n);
  for (var c = 0; c < im.numberOfChannels; ++c) {
    im.getSamples(b, R, c);
    var sc = dcStats(b), f = [];
    for (var i = 0; i < stars.length && f.length < 300; ++i) { var v = dcFwhmAt(b, W, stars[i], sc.med); if (v !== null) f.push(v); }
    f.sort(function (p, q) { return p - q; });
    out.push(f.length ? +f[f.length >> 1].toFixed(2) : null);
  }
  var bright = null;
  for (var j = 0; j < stars.length; ++j) if (!bright || stars[j].p > bright.p) bright = stars[j];
  return { st: st, stars: stars, fwhm: out, ringing: bright ? +dcRinging(L, W, H, bright, st.med).toFixed(3) : null };
}

// ---------------------------------------------------------------------------------------------------
// Centro [AR, Dec] en grados de la solución astrométrica de una ventana (null si no hay o no se puede calcular).
function lnCentro(w) {
  if (!w.hasAstrometricSolution) return null;
  try {
    var im = w.mainView.image, q = w.imageToCelestial(new Point(im.width / 2, im.height / 2));
    return q ? [+q.x.toFixed(4), +q.y.toFixed(4)] : null;
  } catch (e) { return null; }
}

function lnDistancia(a, b) {
  var r = Math.PI / 180, c = Math.sin(a[1] * r) * Math.sin(b[1] * r) + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.cos((a[0] - b[0]) * r);
  return Math.acos(Math.max(-1, Math.min(1, c))) / r;
}

// Borra la solución astrométrica y las palabras clave WCS (las de la cámara y el objeto se quedan).
function lnBorrarWCS(w) {
  try { w.clearAstrometricSolution(); } catch (e) { }
  var wcs = /^(CTYPE|CRVAL|CRPIX|CDELT|CROTA|CUNIT|CD\d_|PC\d_|PV\d_|A_|B_|AP_|BP_|LONPOLE|LATPOLE|EQUINOX|RADESYS|WCSAXES|PLTSOLVD|REFSPLIN|CTYPE)/i;
  try { w.keywords = w.keywords.filter(function (k) { return !wcs.test(k.name); }); } catch (e) { }
  try { w.mainView.properties.forEach(function (pr) { if (/^PCL:AstrometricSolution/.test(pr)) w.mainView.deleteProperty(pr); }); } catch (e) { }
}

// Paso 8: astrometría con blindSolve (único método de la guía).
function resolverAstrometria(viewId, o) {
  viewId = lnId(viewId); o = o || {};
  if (!viewId) throw new Error("resolverAstrometria necesita el id de una vista (texto); ha recibido " + viewId +
                               ". Tras alinearMasters usa r.vista o r.vistas[i] (y alinearMasters ya resuelve y copia la astrometría).");
  if (typeof blindSolve !== "function")
    throw new Error("blindSolve no está disponible: la función tiene que correr con el runner de piastropilot (MCP o panel PiAstroPilot)");
  var w = ImageWindow.windowById(viewId);
  if (w.isNull) throw new Error("No existe la vista " + viewId);
  // Una solución previa equivocada (p. ej. heredada al combinar) se conserva si no se borra antes: el resolvedor
  // dice «The existing astrometric solution has been preserved». Se borra si o.forzar o si el centro está lejos de la región.
  var p = o.pistas || {}, antes = lnCentro(w), borrada = false;
  if (w.hasAstrometricSolution && (o.forzar || (antes && p.regionRA !== undefined && p.regionDec !== undefined &&
      lnDistancia(antes, [+p.regionRA, +p.regionDec]) > (p.regionRadius !== undefined ? +p.regionRadius : 5)))) {
    lnBorrarWCS(w); borrada = true;
  }
  var t0 = Date.now(), r = blindSolve(viewId, p);
  var ok = ImageWindow.windowById(viewId).hasAstrometricSolution, cen = lnCentro(ImageWindow.windowById(viewId));
  var res = { vista: viewId, con_solucion: ok, segundos: +((Date.now() - t0) / 1000).toFixed(1), resultado: r,
              centro_antes: antes, centro: cen, solucion_previa_borrada: borrada,
              no_cumple: ok ? [] : ["sin solución astrométrica: repetir con pistas de escala (minScale/maxScale del perfil) o de región (regionRA/regionDec)"] };
  if (ok && cen && p.regionRA !== undefined && p.regionDec !== undefined &&
      lnDistancia(cen, [+p.regionRA, +p.regionDec]) > (p.regionRadius !== undefined ? +p.regionRadius : 5))
    res.no_cumple.push("el centro resuelto está lejos de la región indicada: repetir con forzar: true");
  res.control = { medido: { con_solucion_astrometrica: ok },
                  revisar_a_ojo: ["que la imagen resuelta sea la que tiene estrellas (nunca la starless)"],
                  nota: "Volver a resolver tras BXT o GraXpert si se pierde la solución (recortar y rotar la conservan desde 1.9.6)." };
  return res;
}

// ---------------------------------------------------------------------------------------------------
// Paso 11: BlurX correct only sobre una copia, con FWHM por canal y ringing antes/después y comprobación de WCS.
function bxtCorrectOnly(viewId, o) {
  viewId = lnId(viewId); o = o || {};
  var src = View.viewById(viewId);
  if (!src || src.isNull) throw new Error("No existe la vista " + viewId);
  src.image.resetSelections();
  if (src.image.median() > 0.05) throw new Error("La imagen parece estirada: BXT correct only va en lineal");
  var antes = lnFwhmPorCanal(src);
  var w = lnCopy(viewId, (typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_bxtco")), v = w.mainView, t0 = Date.now();
  var B = new BlurXTerminator;
  B.correct_only = true;
  B.auto_nonstellar_psf = true;
  if (!B.executeOn(v)) throw new Error("BXT correct only falló");
  var seg = Math.round((Date.now() - t0) / 1000), despues = lnFwhmPorCanal(v, antes);
  var wcs = w.hasAstrometricSolution, resuelta = false;
  if (!wcs && typeof blindSolve === "function") { try { blindSolve(v.id); } catch (e) { } wcs = resuelta = w.hasAstrometricSolution; }
  var spread = function (a) { var f = a.filter(function (x) { return x !== null; }); return f.length ? +(Math.max.apply(null, f) - Math.min.apply(null, f)).toFixed(2) : null; };
  var noCumple = [];
  if (!wcs) noCumple.push("la copia no tiene solución astrométrica: resolver con blindSolve (Paso 8) antes de SPCC");
  if (despues.ringing !== null && despues.ringing < -0.01) noCumple.push("ringing en la estrella más brillante (" + despues.ringing + ")");
  return {
    vista: v.id, original: viewId, segundos: seg,
    fwhm_por_canal_antes: antes.fwhm, fwhm_por_canal_despues: despues.fwhm,
    diferencia_entre_canales_antes: spread(antes.fwhm), diferencia_entre_canales_despues: spread(despues.fwhm),
    ringing: despues.ringing, con_solucion_astrometrica: wcs, resuelta_de_nuevo: resuelta, no_cumple: noCumple,
    control: {
      medido: { fwhm_mas_parecido_entre_canales: spread(despues.fwhm) !== null && spread(despues.fwhm) <= spread(antes.fwhm),
                sin_ringing: despues.ringing === null || despues.ringing >= -0.01, con_solucion_astrometrica: wcs },
      revisar_a_ojo: ["perfil de una estrella brillante al 100 %: redonda, sin anillos ni halos de color"],
      nota: "Halos negativos (−0,30) sólo con blue bloat (FWHM azul claramente mayor) y comprobando anillos. Lo de revisar_a_ojo no lo mide esta función."
    }
  };
}

// ---------------------------------------------------------------------------------------------------
// Paso 17: informe del checkpoint lineal (tabla de la ficha) y, con 'carpeta', borrador de estado.md.
function checkpointLineal(viewId, o) {
  viewId = lnId(viewId); o = o || {};
  // Qwen copió "<objeto>" de un ejemplo como si fuera una ruta (7 nov 2026): se para con un error claro.
  ["carpeta", "objeto"].forEach(function (k) {
    if (o[k] && /[<>]/.test(String(o[k])))
      throw new Error("checkpointLineal: '" + k + "' = " + o[k] + " es un ejemplo, no un valor real. Usa la carpeta real " +
                      "del master (sin < >) y el nombre del objeto de OBJECT, del nombre del fichero o preguntado al usuario.");
  });
  lnNeed("ccSky", "color.js", o);
  var w = ImageWindow.windowById(viewId);
  if (w.isNull) throw new Error("No existe la vista " + viewId);
  var v = w.mainView, im = v.image, W = im.width, H = im.height, n = W * H, b = new Float32Array(n);
  im.resetSelections();
  var med = [], clip = [];
  for (var c = 0; c < im.numberOfChannels; ++c) {
    im.getSamples(b, new Rect(0, 0, W, H), c);
    var u = 0; for (var i = 0; i < n; ++i) if (b[i] >= 0.9999) ++u;
    clip.push(+(100 * u / n).toFixed(4));
    im.selectedChannel = c; med.push(+im.median().toPrecision(4));
  }
  im.resetSelections();
  var sky = im.numberOfChannels === 3 ? ccSky(v) : null, fw = lnFwhmPorCanal(v);
  // Núcleos: % > 0,93 en 128×128 y 32×32 alrededor del píxel más brillante de la luminancia suavizada (bloques de 16 px).
  var L = dcLum(v, new Rect(0, 0, W, H)), best = -1, bx = 0, by = 0;
  for (var yy = 0; yy + 16 <= H; yy += 16) for (var xx = 0; xx + 16 <= W; xx += 16) {
    var s = 0; for (var y = yy; y < yy + 16; y += 4) for (var x = xx; x < xx + 16; x += 4) s += L[y * W + x];
    if (s > best) { best = s; bx = xx + 8; by = yy + 8; }
  }
  var frac = function (half) {
    var t = 0, k = 0;
    for (var y = Math.max(0, by - half); y < Math.min(H, by + half); ++y) for (var x = Math.max(0, bx - half); x < Math.min(W, bx + half); ++x) { ++t; if (L[y * W + x] > 0.93) ++k; }
    return t ? +(100 * k / t).toFixed(2) : 0;
  };
  var hist = []; try { for (var h = 0; h < v.processing.length; ++h) hist.push(v.processing.at ? v.processing.at(h).processId() : String(v.processing[h])); } catch (e) { hist = ["(no disponible: " + e.message + ")"]; }
  var lineal = Math.max.apply(null, med) < 0.05;
  var n128 = frac(64), n32 = frac(16), noCumple = [];
  if (!lineal) noCumple.push("la imagen no parece lineal (mediana > 0,05)");
  if (!w.hasAstrometricSolution) noCumple.push("sin solución astrométrica");
  if (sky && sky.diferencia_en_sigmas > 0.5)
    noCumple.push("CIELO NO NEUTRO: " + sky.canal_alto + " " + sky.diferencia_en_sigmas + " sigmas por encima (límite 0,5). NO pasar a la fase no " +
                  "lineal así: al estirar y saturar sale como manchas de color (galaxia grande con Qwen, 7 nov 2026: 0,67 σ aceptados → fondo manchado). " +
                  "Corregir ahora con neutralizarCielo (color.js) sobre esta vista y repetir checkpointLineal");
  if (clip.some(function (x) { return x > 0.01; })) noCumple.push("canales recortados a 1: " + clip.join(" / ") + " %");
  if (fw.ringing !== null && fw.ringing < -0.01) noCumple.push("ringing (" + fw.ringing + ")");
  if (n128 > 2 || n32 > 10) noCumple.push("núcleo quemado: " + n128 + " % > 0,93 en 128 px, " + n32 + " % en 32 px");
  var res = {
    vista: viewId, lineal: lineal, medianas: med, recortado_a_1_pct: clip, cielo: sky,
    con_solucion_astrometrica: w.hasAstrometricSolution, fwhm_por_canal: fw.fwhm, ringing: fw.ringing,
    nucleo_093_pct: { "128px": n128, "32px": n32, centro: [bx, by] }, historial: hist, no_cumple: noCumple,
    control: {
      medido: { lineal: lineal, cielo_neutro: !sky || sky.diferencia_en_sigmas <= 0.5, sin_recorte: clip.every(function (x) { return x <= 0.01; }),
                con_solucion_astrometrica: w.hasAstrometricSolution, sin_ringing: fw.ringing === null || fw.ringing >= -0.01,
                nucleos_bien: n128 <= 2 && n32 <= 10 },
      revisar_a_ojo: ["estrellas redondas y sin halos anómalos", "sin moteado de color en el cielo", "el historial coincide con lo que se cree haber hecho"],
      nota: "Con 'carpeta', escribe estado.md para la fase no lineal (revísalo y complétalo). Lo de revisar_a_ojo no lo mide esta función."
    }
  };
  if (o.carpeta) {
    var dir = o.carpeta.replace(/\\/g, "/").replace(/\/$/, "");
    if (!File.directoryExists(dir)) File.createDirectory(dir, true);
    var md = "# Estado al final de la fase lineal: " + (o.objeto || viewId) + " " + (o.version || "") + "\n" +
      "- Vista final lineal: " + viewId + (o.fichero ? " (" + o.fichero + ")" : "") + "\n" +
      "- Medidas del checkpoint: medianas " + med.join(" / ") + "; recortado a 1 " + clip.join(" / ") + " %; WCS " + (w.hasAstrometricSolution ? "sí" : "no") +
      "; FWHM por canal " + fw.fwhm.join(" / ") + " px" + (sky ? "; cielo " + sky.diferencia_en_sigmas + " sigmas (" + sky.canal_alto + ")" : "") + "\n" +
      "- Historial: " + hist.join(", ") + "\n" +
      "- Avisos: " + (noCumple.length ? noCumple.join("; ") : "ninguno medido") + "\n" +
      "- Decisiones y notas: " + (o.notas || "<completar>") + "\n" +
      "- Siguiente: Paso 1 no lineal (estirado) sobre " + viewId + "\n";
    var path = dir + "/estado.md";
    if (File.exists(path) && !o.sobrescribir) path = dir + "/estado_" + Date.now() + ".md";
    File.writeTextFile(path, md);
    res.estado_md = path;
  }
  return res;
}

// ---------------------------------------------------------------------------------------------------
// Paso 3 no lineal: quitar el verde del CIELO sin tocar el OIII real del objeto, sólo si G del cielo supera en más de un
// 3 % a R y a B (la ficha dice G/R > 1,03; con el azul también alto, G/R engaña).
// Fórmula de la ficha: G − amount·max(G − max(R,B), 0) bajo una máscara de cielo (rampa de 1,5σ a 5σ sobre el cielo).
function quitarVerde(viewId, o) {
  viewId = lnId(viewId); o = o || {};
  lnNeed("ccSky", "color.js", o);
  var src = View.viewById(viewId);
  if (!src || src.isNull) throw new Error("No existe la vista " + viewId);
  if (src.image.numberOfChannels !== 3) throw new Error("Hace falta una imagen RGB");
  var antes = ccSky(src), cp = antes.cielo_por_canal, gr0 = cp[1] / cp[0], gmx = cp[1] / Math.max(cp[0], cp[2]);
  var umbral = o.umbral || 1.03;
  // Sólo hay verde que quitar si G supera a R Y a B: con B > G (cielo azulado) la fórmula no haría nada y la dominante es otra.
  if (gmx <= umbral && !o.forzar)
    return { vista: null, original: viewId, cielo_GR_antes: +gr0.toFixed(3), cielo_G_sobre_maxRB: +gmx.toFixed(3), aplicado: false,
             motivo: "el verde del cielo no domina (G / max(R,B) = " + gmx.toFixed(3) + " ≤ " + umbral + ")" +
                     (cp[2] > cp[1] && cp[2] > cp[0] ? "; la dominante es AZUL: no se corrige con SCNR, viene de la fase lineal" : "") +
                     ": no aplicar (SCNR no es una corrección de color)", no_cumple: [],
             control: { medido: { cielo_sin_verde: true }, revisar_a_ojo: [], nota: "No aplicar es un resultado válido." } };
  var w = lnCopy(viewId, (typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_sinverde")), v = w.mainView, amount = (o.amount !== undefined) ? o.amount : 0.85;
  var skyL = (antes.cielo_por_canal[0] + antes.cielo_por_canal[1] + antes.cielo_por_canal[2]) / 3, sg = antes.ruido;
  var mask = "min(max((" + (skyL + 5 * sg) + " - ($T[0]+$T[1]+$T[2])/3) / " + (3.5 * sg) + ", 0), 1)";
  var P = new PixelMath;
  P.useSingleExpression = false;
  P.expression = "$T[0]"; P.expression1 = "$T[1] - " + amount + " * max($T[1] - max($T[0], $T[2]), 0) * " + mask; P.expression2 = "$T[2]";
  P.createNewImage = false; P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1;
  if (!P.executeOn(v)) throw new Error("Neutralización de verde falló");
  var despues = ccSky(v), cq = despues.cielo_por_canal, gr1 = cq[1] / cq[0], gmx1 = cq[1] / Math.max(cq[0], cq[2]);
  // Objeto: G/R en el 10 % de celdas más brillantes, antes y después (el OIII real no debe cambiar).
  var obj = function (view) {
    var im = view.image, W = im.width, H = im.height, S = 64, r = new Float32Array(S * S), g = new Float32Array(S * S), bb = new Float32Array(S * S), cells = [];
    for (var y0 = 0; y0 + S <= H; y0 += S) for (var x0 = 0; x0 + S <= W; x0 += S) {
      var R = new Rect(x0, y0, x0 + S, y0 + S); im.getSamples(r, R, 0); im.getSamples(g, R, 1); im.getSamples(bb, R, 2);
      var sr = 0, sgg = 0; for (var i = 0; i < r.length; i += 4) { sr += r[i]; sgg += g[i]; }
      cells.push({ l: sr + sgg, gr: sr > 0 ? sgg / sr : 1 });
    }
    cells.sort(function (a, b2) { return b2.l - a.l; });
    var k = Math.max(5, Math.floor(cells.length * 0.10)), s = 0; for (var j = 0; j < k; ++j) s += cells[j].gr;
    return s / k;
  };
  var o0 = obj(src), o1 = obj(v), noCumple = [];
  if (gmx1 > 1.05) noCumple.push("el verde del cielo sigue dominando (G / max(R,B) = " + gmx1.toFixed(3) + "): subir amount o revisar la máscara");
  if (Math.abs(o1 - o0) > 0.02) noCumple.push("el color del objeto ha cambiado (G/R " + o0.toFixed(3) + " → " + o1.toFixed(3) + "): la máscara toca el objeto");
  return {
    vista: v.id, original: viewId, aplicado: true, amount: amount,
    cielo_GR_antes: +gr0.toFixed(3), cielo_GR_despues: +gr1.toFixed(3), cielo_G_sobre_maxRB_antes: +gmx.toFixed(3), cielo_G_sobre_maxRB_despues: +gmx1.toFixed(3), objeto_GR_antes: +o0.toFixed(3), objeto_GR_despues: +o1.toFixed(3),
    no_cumple: noCumple,
    control: {
      medido: { verde_del_cielo_quitado: gmx1 <= 1.05, objeto_intacto: Math.abs(o1 - o0) <= 0.02 },
      revisar_a_ojo: ["el OIII del objeto sigue verde-azulado", "las estrellas no han virado a magenta", "sin bordes de máscara en la transición cielo-nebulosa"],
      nota: "No en cometas (el verde de la coma es real) ni en HOO/SHO con Hα dominante. Lo de revisar_a_ojo no lo mide esta función."
    }
  };
}
