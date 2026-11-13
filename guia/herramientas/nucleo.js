// nucleo.js — Núcleo de galaxias (Paso 5 no lineal, antes de saturar): medida de la meseta quemada y HDRMultiscaleTransform
// mezclado con una máscara de bulbo. PJSR, ECMAScript 5.
//
// Uso (en el nivel superior del script):
//   eval(File.readTextFile("<ruta de guia>/herramientas/nucleo.js"));
//   var m = medirMeseta("Starless_st");                                     // sólo mide
//   var r = comprimirNucleo("Starless_st", { nuevaVista: "Starless_hdr" });   // HDRMT 7 capas al 60 % en el bulbo
//   JSON.stringify(r);
//
// Receta (Opus, galaxia grande, oct 2026): HDRMT de 7–8 capas mezclado al 60 % con una máscara de bulbo (luminancia de gran
// escala > 0,35). HDRMT a pleno y LHE de radio 200 sobre el bulbo dieron un anillo oscuro y un bulbo plano: evitarlo.
// El LHE del disco va aparte, con máscara de galaxia × (1 − bulbo). Comparación Qwen/Opus en una galaxia grande (7 nov 2026): sin este paso el
// núcleo y la galaxia satélite quedaron como una meseta de 22 px de radio por encima de 0,95; con él, 1 px.
// Opciones de comprimirNucleo:
//   capas 7, iteraciones 1, mezcla 0.6 (fracción de HDRMT dentro de la máscara)
//   mascaraDesde 0.35, mascaraAncho 0.25: máscara = clip((L_gran_escala − desde) / ancho)
//   bin 16 (escala de la luminancia de la máscara), nuevaVista, conservarMascara (false)
// Trabaja sobre una copia; no toca la original.

function nuK(C, name) {
  if (C[name] !== undefined) return C[name];
  if (C.prototype && C.prototype[name] !== undefined) return C.prototype[name];
  throw new Error("Constante no encontrada: " + name);
}

function nuId(v) {
  if (v && typeof v === "object") return (v.id !== undefined) ? v.id : (typeof v.vista === "string" ? v.vista : v);
  return v;
}

function nuCopy(viewId, newId, show) {
  var src = ImageWindow.windowById(viewId);
  if (src.isNull) throw new Error("No existe la vista " + viewId);
  var im = src.mainView.image; im.resetSelections();
  var id = newId;
  for (var n = 2; !ImageWindow.windowById(id).isNull; ++n) id = newId + "_" + n;
  var w = new ImageWindow(im.width, im.height, im.numberOfChannels, 32, true, im.isColor, id);
  w.mainView.beginProcess(); w.mainView.image.assign(im); w.mainView.endProcess();
  if (src.hasAstrometricSolution) w.copyAstrometricSolution(src);
  if (show) w.show();
  return w;
}

function nuLum(view) {
  var im = view.image, W = im.width, H = im.height, n = W * H, nc = im.numberOfChannels, R = new Rect(0, 0, W, H);
  var L = new Float32Array(n), b = new Float32Array(n);
  for (var c = 0; c < nc; ++c) { im.getSamples(b, R, c); for (var i = 0; i < n; ++i) L[i] += b[i] / nc; }
  return { L: L, W: W, H: H };
}

// Meseta: radio equivalente (px) de los píxeles con L > umbral en 256×256 px alrededor del punto más brillante (bloques de
// 16 px), y total de píxeles > umbral en toda la imagen. Con estructura: 0–3 px. Con `centro` ([x,y]) mide ahí, sin buscar
// el máximo: tras comprimir el núcleo, el punto más brillante puede pasar a ser otro (una galaxia satélite, una estrella).
function nuMeseta(a, thr, centro) {
  var L = a.L, W = a.W, H = a.H, best = -1, bx = 0, by = 0, k = 0, tot = 0, h = 128;
  if (centro) { bx = centro[0]; by = centro[1]; }
  else for (var yy = 0; yy + 16 <= H; yy += 16) for (var xx = 0; xx + 16 <= W; xx += 16) {
    var s = 0; for (var y = yy; y < yy + 16; y += 2) for (var x = xx; x < xx + 16; x += 2) s += L[y * W + x];
    if (s > best) { best = s; bx = xx + 8; by = yy + 8; }
  }
  for (var y2 = Math.max(0, by - h); y2 < Math.min(H, by + h); ++y2)
    for (var x2 = Math.max(0, bx - h); x2 < Math.min(W, bx + h); ++x2) if (L[y2 * W + x2] > thr) ++k;
  for (var j = 0; j < L.length; ++j) if (L[j] > thr) ++tot;
  return { radio_px: +Math.sqrt(k / Math.PI).toFixed(1), pix_total: tot, centro: [bx, by], umbral: thr };
}

// Color del núcleo (12 nov 2026, idea de pixinsight-mcp): saturación mediana (HSV: (máx − mín) / máx) de los píxeles del
// núcleo, L > 0,35 en un radio r alrededor del centro. < 0,04 = núcleo blanco (el estirado le quitó el color); en galaxias
// los núcleos con color dan 0,06–0,18. Sólo en imágenes en color; en gris devuelve null.
function nuSatNucleo(view, centro, r) {
  var im = view.image; if (im.numberOfChannels < 3) return null;
  var W = im.width, H = im.height, x0 = Math.max(0, centro[0] - r), y0 = Math.max(0, centro[1] - r);
  var x1 = Math.min(W, centro[0] + r), y1 = Math.min(H, centro[1] + r), R = new Rect(x0, y0, x1, y1), n = (x1 - x0) * (y1 - y0);
  var ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], s = [];
  for (var c = 0; c < 3; ++c) im.getSamples(ch[c], R, c);
  for (var i = 0; i < n; ++i) {
    var a = ch[0][i], b = ch[1][i], d = ch[2][i], mx = Math.max(a, b, d), mn = Math.min(a, b, d);
    var dx = x0 + i % (x1 - x0) - centro[0], dy = y0 + Math.floor(i / (x1 - x0)) - centro[1];
    if (dx * dx + dy * dy <= r * r && (a + b + d) / 3 > 0.35 && mx > 0) s.push((mx - mn) / mx);
  }
  if (s.length < 10) return null;
  s.sort(function (p, q) { return p - q; });
  return +s[s.length >> 1].toFixed(3);
}

// Textura fina del núcleo: mediana de |L − media 3×3| en los píxeles con L > 0,35 en un radio r. Comparada con la de la
// entrada da cuánto amplificó el paso el grano del núcleo; más de ×3 = núcleo «cocinado» (ruido y artefactos en el bulbo).
function nuTextura(a, centro, r) {
  var L = a.L, W = a.W, H = a.H, s = [];
  for (var y = Math.max(1, centro[1] - r); y < Math.min(H - 1, centro[1] + r); ++y)
    for (var x = Math.max(1, centro[0] - r); x < Math.min(W - 1, centro[0] + r); ++x) {
      var dx = x - centro[0], dy = y - centro[1], p = y * W + x;
      if (dx * dx + dy * dy > r * r || L[p] <= 0.35) continue;
      var m = (L[p - W - 1] + L[p - W] + L[p - W + 1] + L[p - 1] + L[p] + L[p + 1] + L[p + W - 1] + L[p + W] + L[p + W + 1]) / 9;
      s.push(Math.abs(L[p] - m));
    }
  if (s.length < 10) return null;
  s.sort(function (p, q) { return p - q; });
  return s[s.length >> 1];
}

function medirMeseta(viewId, o) {
  viewId = nuId(viewId); o = o || {};
  var v = View.viewById(viewId);
  if (!v || v.isNull) throw new Error("No existe la vista " + viewId);
  var a = nuLum(v), m = nuMeseta(a, o.umbral || 0.95), r = o.radio || 64;
  m.vista = viewId;
  m.no_cumple = m.radio_px > 3 ? ["núcleo quemado: meseta de " + m.radio_px + " px (con estructura: 0–3 px); comprimirNucleo antes de saturar"] : [];
  // Núcleo blanco y núcleo cocinado (12 nov 2026). o.referencia = vista anterior al paso (misma geometría) para medir
  // cuánto se amplificó la textura del núcleo.
  m.saturacion_nucleo = nuSatNucleo(v, m.centro, r);
  // En una galaxia es no_cumple; en otro tipo (o sin tipo) sólo aviso: el punto más brillante puede ser una estrella blanca.
  if (m.saturacion_nucleo !== null && m.saturacion_nucleo < 0.04)
    (/galax/i.test(o.tipo || "") ? m.no_cumple : (m.avisos = m.avisos || [])).push("núcleo blanco: saturación mediana " + m.saturacion_nucleo + " (< 0,04; con color 0,06–0,18): recuperar su color " +
                     "con recuperarColorNucleo(vista, { lineal: <starless lineal, la misma imagen antes de estirar>, fuerza: 0,4 }) (ficha no-lineal 05, «Núcleo blanco»)");
  var ref = o.referencia ? View.viewById(nuId(o.referencia)) : null;
  if (ref && !ref.isNull && ref.image.width === v.image.width && ref.image.height === v.image.height) {
    var t0 = nuTextura(nuLum(ref), m.centro, r), t1 = nuTextura(a, m.centro, r);
    if (t0 > 0 && t1 !== null) {
      m.textura_nucleo_x = +(t1 / t0).toFixed(2);
      if (m.textura_nucleo_x > 3) m.no_cumple.push("núcleo cocinado: su textura fina sube ×" + m.textura_nucleo_x + " (máx. ×3) respecto a " +
                                                  nuId(o.referencia) + ": repetir el paso más suave o con máscara que proteja el núcleo");
    }
  }
  return m;
}

// Perfil radial (media de L en anillos de 4 px) hasta rMax, y caídas de más de 'salto' hacia dentro (anillo oscuro: un
// anillo más oscuro que el siguiente hacia fuera).
function nuPerfil(a, cx, cy, rMax, salto) {
  var L = a.L, W = a.W, H = a.H, nb = Math.max(2, Math.ceil(rMax / 4)), s = [], n = [];
  for (var i = 0; i < nb; ++i) { s.push(0); n.push(0); }
  for (var y = Math.max(0, cy - rMax); y < Math.min(H, cy + rMax); ++y)
    for (var x = Math.max(0, cx - rMax); x < Math.min(W, cx + rMax); ++x) {
      var r = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)), k = Math.floor(r / 4);
      if (k < nb) { s[k] += L[y * W + x]; ++n[k]; }
    }
  var p = [], anillos = [];
  for (var j = 0; j < nb; ++j) p.push(n[j] ? s[j] / n[j] : 0);
  for (var q = 1; q < nb - 1; ++q) if (p[q + 1] - p[q] > salto) anillos.push(4 * q);
  return { perfil: p, anillos_px: anillos };
}

// Núcleo blanco (ficha no-lineal 05): devuelve al núcleo estirado el color que tenía en lineal. En cada píxel del
// núcleo (máscara de luminancia con rampa desde 'desde' de ancho 'ancho'), mezcla al 'fuerza' (0,3–0,5) la versión con
// la misma luminancia estirada y las proporciones R:G:B de la lineal. La lineal tiene que ser la misma imagen antes de
// estirar (misma geometría): la starless lineal del checkpoint. Hasta el 13 nov 2026 la guía lo pedía y no había función
// (Opus se paró en M31 por eso).
function recuperarColorNucleo(viewId, o) {
  viewId = nuId(viewId); o = o || {};
  var v = View.viewById(viewId);
  if (!v || v.isNull) throw new Error("No existe la vista " + viewId);
  if (v.image.numberOfChannels !== 3) throw new Error("recuperarColorNucleo necesita una imagen RGB");
  v.image.resetSelections();
  if (v.image.median() < 0.02) throw new Error("La imagen parece lineal: esto va después de estirar");
  if (!o.lineal) throw new Error("Falta lineal: la vista (o el fichero) de la misma imagen antes de estirar, p. ej. la starless lineal del checkpoint");
  var linId = null, cerrarLin = null, lp = String(o.lineal).replace(/\\/g, "/");
  if (File.exists(lp)) {
    var ws = ImageWindow.open(lp, "nuLineal", "verbosity 0", true);
    for (var q = 1; q < ws.length; ++q) ws[q].forceClose();
    cerrarLin = ws[0]; linId = ws[0].mainView.id;
  } else {
    var lv = View.viewById(nuId(o.lineal));
    if (!lv || lv.isNull) throw new Error("No existe la vista ni el fichero lineal " + o.lineal);
    linId = lv.id;
  }
  var L = View.viewById(linId);
  try {
    if (L.image.width !== v.image.width || L.image.height !== v.image.height || L.image.numberOfChannels !== 3)
      throw new Error("La lineal no tiene la misma geometría (" + L.image.width + "x" + L.image.height + "): tiene que ser la misma imagen antes de estirar");
    var f = (o.fuerza !== undefined) ? o.fuerza : 0.4, desde = (o.desde !== undefined) ? o.desde : 0.35, ancho = o.ancho || 0.30;   // peso completo desde 0,65 (ficha 05)
    var a0 = nuLum(v), m0 = nuMeseta(a0, 0.95), sat0 = nuSatNucleo(v, m0.centro, 64);
    var w = nuCopy(viewId, (typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_colornucleo"), true), out = w.mainView;
    var Lt = "(($T[0]+$T[1]+$T[2])/3)", Ll = "max((" + linId + "[0]+" + linId + "[1]+" + linId + "[2])/3, 0.000001)";
    var m = "min(max((" + Lt + " - " + desde + ")/" + ancho + ", 0), 1)";
    var P = new PixelMath; P.useSingleExpression = false;
    var ex = function (c) { return "$T[" + c + "] + " + f + "*" + m + "*(" + Lt + "*" + linId + "[" + c + "]/" + Ll + " - $T[" + c + "])"; };
    P.expression = ex(0); P.expression1 = ex(1); P.expression2 = ex(2);
    P.createNewImage = false; P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1;
    if (!P.executeOn(out)) throw new Error("PixelMath del color del núcleo falló");
    var a1 = nuLum(out), m1 = nuMeseta(a1, 0.95, m0.centro), sat1 = nuSatNucleo(out, m0.centro, 64), noCumple = [];
    if (sat1 !== null && sat1 < 0.04) noCumple.push("el núcleo sigue blanco (saturación " + sat1 + "): subir fuerza (máx. 0,6) o bajar desde (0,45)");
    if (m1.radio_px > Math.max(3, m0.radio_px)) noCumple.push("la meseta sube a " + m1.radio_px + " px: bajar fuerza");
    return { vista: out.id, original: viewId, lineal: linId, fuerza: f, mascara: { desde: desde, ancho: ancho },
             saturacion_nucleo: { antes: sat0, despues: sat1 }, meseta: { antes: m0.radio_px, despues: m1.radio_px }, no_cumple: noCumple,
             control: { medido: { nucleo_con_color: sat1 === null || sat1 >= 0.04 },
                        revisar_a_ojo: ["núcleo al 100 %: color cálido creíble, sin anillo ni borde de la máscara en el bulbo"],
                        nota: "Es color medido en la lineal (proporciones R:G:B del propio núcleo), no inventado." } };
  } finally { if (cerrarLin) cerrarLin.forceClose(); }
}

function comprimirNucleo(viewId, o) {
  viewId = nuId(viewId); o = o || {};
  var src = View.viewById(viewId);
  if (!src || src.isNull) throw new Error("No existe la vista " + viewId);
  src.image.resetSelections();
  if (src.image.median() < 0.02) throw new Error("La imagen parece lineal: comprimirNucleo va después de estirar");
  if (typeof HDRMultiscaleTransform !== "function") throw new Error("HDRMultiscaleTransform no está disponible");
  var capas = o.capas || 7, iter = o.iteraciones || 1, mezcla = (o.mezcla !== undefined) ? o.mezcla : 0.6;
  var desde = (o.mascaraDesde !== undefined) ? o.mascaraDesde : 0.35, ancho = o.mascaraAncho || 0.25, bin = o.bin || 16;
  var W = src.image.width, H = src.image.height, t0 = Date.now();
  var a0 = nuLum(src), antes = nuMeseta(a0, 0.95), sat0 = nuSatNucleo(src, antes.centro, 64);

  // 1. Máscara de bulbo: luminancia de gran escala (binada ×bin y ampliada de nuevo), rampa desde 'desde' con 'ancho'.
  var P = new PixelMath;
  P.expression = src.image.numberOfChannels === 3 ? "($T[0]+$T[1]+$T[2])/3" : "$T";
  P.useSingleExpression = true; P.createNewImage = true;
  var mid = "nuMascaraBulbo"; for (var nn = 2; !ImageWindow.windowById(mid).isNull; ++nn) mid = "nuMascaraBulbo_" + nn;
  P.newImageId = mid; P.newImageColorSpace = nuK(PixelMath, "Gray"); P.newImageSampleFormat = nuK(PixelMath, "f32");
  P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1;
  if (!P.executeOn(src)) throw new Error("Luminancia de la máscara falló");
  var mw = ImageWindow.windowById(mid), mv = mw.mainView;
  var IR = new IntegerResample; IR.zoomFactor = -bin; IR.downsamplingMode = nuK(IntegerResample, "Average");
  if (!IR.executeOn(mv)) throw new Error("IntegerResample de la máscara falló");
  var RS = new Resample;
  RS.absoluteMode = nuK(Resample, "ForceWidthAndHeight"); RS.mode = nuK(Resample, "AbsolutePixels");
  RS.xSize = W; RS.ySize = H; RS.interpolation = nuK(Resample, "BicubicSpline");
  if (!RS.executeOn(mv)) throw new Error("Resample de la máscara falló");
  var PR = new PixelMath;
  PR.expression = "min(max(($T - " + desde + ") / " + ancho + ", 0), 1)";
  PR.useSingleExpression = true; PR.createNewImage = false; PR.truncate = true; PR.truncateLower = 0; PR.truncateUpper = 1;
  if (!PR.executeOn(mv)) throw new Error("Rampa de la máscara falló");
  var mb = new Float32Array(W * H), enBulbo = 0;
  mv.image.getSamples(mb, new Rect(0, 0, W, H), 0);
  for (var i = 0; i < mb.length; ++i) if (mb[i] > 0.5) ++enBulbo;
  var rBulbo = Math.sqrt(enBulbo / Math.PI);
  if (enBulbo === 0) {
    if (!o.conservarMascara) mw.forceClose(); else mw.show();
    return { vista: null, original: viewId, aplicado: false, meseta_antes: antes,
             no_cumple: ["la máscara de bulbo está vacía (ningún píxel de gran escala por encima de " + desde + "): bajar mascaraDesde " +
                         "(p. ej. 0,25) o no hace falta este paso"],
             control: { medido: { mascara_con_bulbo: false }, revisar_a_ojo: [], nota: "No aplicar es un resultado válido." } };
  }

  // 2. Compresión a pleno sobre una copia oculta: HDRMT (por defecto) o GradientHDRCompression (metodo "ghc";
  //    exponente del gradiente o.exponente, 0,6 por defecto: < 1 comprime).
  var metodo = o.metodo === "ghc" ? "ghc" : "hdrmt", hw = nuCopy(viewId, "nuTmpHDR", false);
  if (metodo === "ghc") {
    if (typeof GradientHDRCompression !== "function") { hw.forceClose(); mw.forceClose(); throw new Error("GradientHDRCompression no está disponible"); }
    var G2 = new GradientHDRCompression;
    G2.expGradient = (o.exponente !== undefined) ? o.exponente : 0.6;
    G2.logMaxGradient = (o.logMax !== undefined) ? o.logMax : 0; G2.logMinGradient = (o.logMin !== undefined) ? o.logMin : -7;
    G2.bRescale01 = true; G2.bPreserveColor = true;
    if (!G2.executeOn(hw.mainView)) { hw.forceClose(); mw.forceClose(); throw new Error("GradientHDRCompression falló"); }
  } else {
    var H2 = new HDRMultiscaleTransform;
    if (!("numberOfLayers" in H2) || !("numberOfIterations" in H2))
      { hw.forceClose(); mw.forceClose(); throw new Error("HDRMultiscaleTransform sin numberOfLayers/numberOfIterations en esta versión"); }
    H2.numberOfLayers = capas; H2.numberOfIterations = iter;
    if ("toLightness" in H2) H2.toLightness = true;
    if ("preserveHue" in H2) H2.preserveHue = true;
    if (!H2.executeOn(hw.mainView)) { hw.forceClose(); mw.forceClose(); throw new Error("HDRMultiscaleTransform falló"); }
  }

  // 3. Mezcla en la copia final: T + mezcla·M·(HDR − T).
  var w = nuCopy(viewId, (typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_nucleo"), true), v = w.mainView;
  var PM = new PixelMath;
  PM.expression = "$T + " + mezcla + "*" + mid + "*(" + hw.mainView.id + " - $T)";
  PM.useSingleExpression = true; PM.createNewImage = false; PM.truncate = true; PM.truncateLower = 0; PM.truncateUpper = 1;
  if (!PM.executeOn(v)) { hw.forceClose(); mw.forceClose(); throw new Error("Mezcla con la máscara falló"); }
  hw.forceClose();
  var maskId = mid;
  if (o.conservarMascara) mw.show(); else { mw.forceClose(); maskId = null; }

  // 4. Medidas: meseta, perfil radial (anillo oscuro) y brillo medio del bulbo.
  var a1 = nuLum(v), despues = nuMeseta(a1, 0.95, antes.centro), cx = antes.centro[0], cy = antes.centro[1];
  var otra = nuMeseta(a1, 0.95), dOtra = Math.max(Math.abs(otra.centro[0] - cx), Math.abs(otra.centro[1] - cy));
  otra = dOtra > 64 && otra.radio_px > 3 ? otra : null;
  var rMax = Math.max(16, Math.min(600, Math.round(rBulbo * 1.2)));
  var pa = nuPerfil(a0, cx, cy, rMax, 0.01), pd = nuPerfil(a1, cx, cy, rMax, 0.01);
  var nuevos = pd.anillos_px.filter(function (r) { return pa.anillos_px.indexOf(r) < 0; });
  var bm0 = 0, bm1 = 0, nb = 0;
  for (var j = 0; j < mb.length; j += 3) if (mb[j] > 0.5) { bm0 += a0.L[j]; bm1 += a1.L[j]; ++nb; }
  bm0 = nb ? bm0 / nb : 0; bm1 = nb ? bm1 / nb : 0;
  var baja = bm0 > 0 ? 100 * (1 - bm1 / bm0) : 0, noCumple = [];
  // Si la original no estaba quemada, la compresión es la que crea la meseta: no se comprime (Qwen 64k repitió con
  // mezcla 0,8 y capas 8, empeoró las dos veces y se paró; M31, 13 nov 2026).
  if (despues.radio_px > 3 && antes.radio_px <= 3)
    noCumple.push("la compresión CREA una meseta de " + despues.radio_px + " px y la original no estaba quemada (" + antes.radio_px +
                  " px): no comprimir; seguir con " + viewId + (sat0 !== null && sat0 < 0.04 ? " y, si el núcleo es blanco, recuperarColorNucleo" : "") + ". No repetir con más mezcla ni más capas");
  else if (despues.radio_px > 3) noCumple.push("el núcleo sigue quemado (meseta " + despues.radio_px + " px): repetir sobre la original con mezcla 0,8 o capas 8");
  if (nuevos.length) noCumple.push("anillo oscuro nuevo a " + nuevos.join(", ") + " px del centro: repetir con mezcla menor (0,4) o capas 6");
  if (otra) noCumple.push("otra meseta quemada de " + otra.radio_px + " px en [" + otra.centro.join(", ") + "] (¿galaxia satélite o estrella?): " +
    "si es una galaxia, repetir sobre la original con mascaraDesde 0,25 para que la máscara la incluya; si es una estrella, ignorar");
  if (baja > 30) noCumple.push("el bulbo pierde un " + baja.toFixed(0) + " % de brillo medio (> 30 %): queda plano; repetir con mezcla menor");
  // Núcleo cocinado o blanco (12 nov 2026): la compresión no debe multiplicar el grano del núcleo ni quitarle el color.
  var rt = Math.max(16, Math.min(300, Math.round(rBulbo))), tx0 = nuTextura(a0, antes.centro, rt), tx1 = nuTextura(a1, antes.centro, rt);
  var texX = (tx0 > 0 && tx1 !== null) ? +(tx1 / tx0).toFixed(2) : null, sat1 = nuSatNucleo(v, antes.centro, 64);
  if (texX !== null && texX > 3) noCumple.push("núcleo cocinado: la textura fina del bulbo sube ×" + texX + " (máx. ×3): repetir con mezcla menor (0,4) o capas 6");
  if (sat1 !== null && sat1 < 0.04 && (sat0 === null || sat0 >= 0.04))
    noCumple.push("el núcleo se queda blanco (saturación " + sat1 + " < 0,04; antes " + sat0 + "): mezcla menor o recuperarColorNucleo con la lineal");
  return {
    vista: v.id, original: viewId, aplicado: true,
    metodo: metodo === "ghc" ? "GradientHDRCompression (exponente " + ((o.exponente !== undefined) ? o.exponente : 0.6) + ")" : "HDRMultiscaleTransform",
    capas: capas, iteraciones: iter, mezcla: mezcla,
    mascara: { desde: desde, ancho: ancho, bin: bin, radio_bulbo_px: Math.round(rBulbo), vista: maskId },
    meseta_antes: antes, meseta_despues: despues, otra_meseta: otra,
    brillo_bulbo: { antes: +bm0.toFixed(3), despues: +bm1.toFixed(3), baja_pct: +baja.toFixed(1) },
    anillos_nuevos_px: nuevos, textura_nucleo_x: texX, saturacion_nucleo: { antes: sat0, despues: sat1 },
    segundos: Math.round((Date.now() - t0) / 1000), no_cumple: noCumple,
    control: {
      medido: { nucleo_con_estructura: despues.radio_px <= 3, sin_anillo_nuevo: nuevos.length === 0, bulbo_no_aplanado: baja <= 30,
                nucleo_no_cocinado: texX === null || texX <= 3, nucleo_con_color: sat1 === null || sat1 >= 0.04 || (sat0 !== null && sat0 < 0.04) },
      revisar_a_ojo: ["núcleo al 100 %: gradiente suave hacia el centro, sin anillo oscuro ni bulbo gris y plano",
                      "galaxias satélite: sus núcleos también con estructura",
                      "borde de la máscara: sin transición visible en el disco"],
      nota: "HDRMT a pleno o LHE de radio grande sobre el bulbo hacen anillo y bulbo plano (galaxia grande, oct 2026): por eso se mezcla al 60 %. " +
            "Después, saturación con saturarAlFallo; el LHE del disco, si se usa, con máscara que excluya el bulbo. " +
            "Lo de revisar_a_ojo no lo mide esta función."
    }
  };
}

// Compara HDRMultiscaleTransform y GradientHDRCompression con la misma máscara de bulbo y la misma mezcla (Rafael,
// 8 nov 2026: comparar siempre). Gana, entre los que cumplen, el que deja menos meseta y, a igualdad, el que menos
// aplana el bulbo. La elegida queda como nuevaVista (<vista>_nucleo); la otra se cierra (cerrar: false para conservarla).
//   var r = nucleoCandidatos("Starless_st", { exponentes: [0.6, 0.4], nuevaVista: "Starless_hdr" });
function nucleoCandidatos(viewId, o) {
  viewId = nuId(viewId); o = o || {};
  var t0 = Date.now(), cands = [], pruebas = [{ etiqueta: "HDRMT " + (o.capas || 7) + " capas", op: { metodo: "hdrmt" }, suf: "_nuc_hdrmt" }];
  (o.exponentes || [0.6]).forEach(function (e) {
    pruebas.push({ etiqueta: "GradientHDRCompression exponente " + e, op: { metodo: "ghc", exponente: e }, suf: "_nuc_ghc" + Math.round(100 * e) });
  });
  pruebas.forEach(function (p) {
    var op = {};
    for (var k in o) if (["exponentes", "nuevaVista", "cerrar"].indexOf(k) < 0) op[k] = o[k];
    for (var k2 in p.op) op[k2] = p.op[k2];
    op.nuevaVista = viewId + p.suf;
    try {
      var rn = comprimirNucleo(viewId, op);
      cands.push({ etiqueta: p.etiqueta, r: rn, previa: rn.vista && typeof pxPrevia === "function" ? pxPrevia(rn.vista, "nuc_" + rn.vista, { estirar: false }) : null });
    }
    catch (e) { cands.push({ etiqueta: p.etiqueta, error: String(e && e.message ? e.message : e) }); }
  });
  var conVista = cands.filter(function (c) { return c.r && c.r.aplicado; });
  if (!conVista.length) {
    var r0 = cands.filter(function (c) { return c.r; })[0];
    return { vista: null, original: viewId, aplicado: false, comparados: cands.map(function (c) { return { metodo: c.etiqueta, error: c.error, no_cumple: c.r ? c.r.no_cumple : undefined }; }),
             no_cumple: r0 ? r0.no_cumple : ["ningún método se pudo aplicar"] };
  }
  var ok = conVista.filter(function (c) { return !c.r.no_cumple.length; }), lista = ok.length ? ok : conVista;
  var best = lista.reduce(function (a, c) {
    if (a === null) return c;
    if (!ok.length && c.r.no_cumple.length !== a.r.no_cumple.length) return c.r.no_cumple.length < a.r.no_cumple.length ? c : a;
    var ma = a.r.meseta_despues.radio_px, mc = c.r.meseta_despues.radio_px;
    if (mc !== ma) return mc < ma ? c : a;
    return c.r.brillo_bulbo.baja_pct < a.r.brillo_bulbo.baja_pct ? c : a;
  }, null);
  // «Sin comprimir» también es un candidato (13 nov 2026, M31): el estirado no tenía meseta (0 px) y las tres compresiones
  // la creaban (5–8 px); Opus y Qwen 32k se pararon dos veces repitiendo el arreglo. Si el mejor comprimido deja más
  // meseta que la original y la original no está quemada, se recomienda no comprimir.
  var m0 = best.r.meseta_antes ? best.r.meseta_antes.radio_px : null;
  if (m0 !== null && m0 <= 3 && best.r.meseta_despues.radio_px > Math.max(3, m0)) {
    if (o.cerrar !== false) conVista.forEach(function (c) { var w = ImageWindow.windowById(c.r.vista); if (!w.isNull) w.forceClose(); });
    var sat0 = best.r.saturacion_nucleo ? best.r.saturacion_nucleo.antes : null;
    return {
      vista: viewId, original: viewId, aplicado: false, recomendado: "sin comprimir",
      comparados: cands.map(function (c) { return c.r ? { metodo: c.etiqueta, meseta_px: c.r.meseta_despues ? c.r.meseta_despues.radio_px : null, cumple: !c.r.no_cumple.length, elegido: false } : { metodo: c.etiqueta, error: c.error }; })
        .concat([{ metodo: "sin comprimir", meseta_px: m0, elegido: true }]),
      meseta_antes: best.r.meseta_antes,
      motivo: "La original no está quemada (meseta " + m0 + " px) y todas las compresiones crean meseta (la mejor " + best.r.meseta_despues.radio_px +
              " px): no se comprime; se sigue con " + viewId + ".",
      no_cumple: (sat0 !== null && sat0 < 0.04) ? ["núcleo blanco (saturación " + sat0 + "): recuperarColorNucleo(\"" + viewId + "\", { lineal: <starless lineal> }) antes de saturar"] : [],
      segundos: Math.round((Date.now() - t0) / 1000),
      control: { medido: { nucleo_con_estructura: true }, revisar_a_ojo: ["núcleo al 100 %: gradiente suave hacia el centro"], nota: "No comprimir es un resultado válido." }
    };
  }
  var nombre = (typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_nucleo"), vista = null;
  conVista.forEach(function (c) {
    var w = ImageWindow.windowById(c.r.vista);
    if (w.isNull) return;
    if (c === best) {
      if (c.r.vista !== nombre) { var old = ImageWindow.windowById(nombre); if (!old.isNull) old.forceClose(); w.mainView.id = nombre; }
      vista = w.mainView.id;
    } else if (o.cerrar !== false) w.forceClose();
  });
  return {
    vista: vista, original: viewId, aplicado: true,
    comparados: cands.map(function (c) {
      if (!c.r) return { metodo: c.etiqueta, error: c.error, elegido: false };
      return { metodo: c.etiqueta, meseta_px: c.r.meseta_despues ? c.r.meseta_despues.radio_px : null,
               bulbo_baja_pct: c.r.brillo_bulbo ? c.r.brillo_bulbo.baja_pct : null, anillos_nuevos: c.r.anillos_nuevos_px ? c.r.anillos_nuevos_px.length : null,
               textura_nucleo_x: c.r.textura_nucleo_x, saturacion_nucleo: c.r.saturacion_nucleo ? c.r.saturacion_nucleo.despues : null,
               cumple: !c.r.no_cumple.length, elegido: c === best, previa: c.previa || undefined };
    }),
    recomendado: best.etiqueta, meseta_antes: best.r.meseta_antes, meseta_despues: best.r.meseta_despues,
    motivo: best.etiqueta + (best.r.no_cumple.length ? ": ninguno cumple; es el de menos avisos." :
            ": deja la meseta en " + best.r.meseta_despues.radio_px + " px y el bulbo baja un " + best.r.brillo_bulbo.baja_pct + " %."),
    no_cumple: best.r.no_cumple, segundos: Math.round((Date.now() - t0) / 1000), control: best.r.control
  };
}