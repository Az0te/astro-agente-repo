// gradiente.js — Comparativa de correcciones de gradiente en una sola llamada. PJSR, ECMAScript 5.
//
// Uso (cargar en el nivel superior del script, nunca dentro de una función):
//   eval(File.readTextFile("<ruta de guia>/herramientas/gradiente.js"));
//   var r = gradienteCandidatos("MasterLight", {
//     graxpert: [10, 8],                                   // escalas sample_free (sustracción)
//     mgc: [2048],                                         // escalas de MGC; [] para no probar MGC
//     spfc: { qe: "...", gray: "..." },                    // opciones de pxSPFC (perfil)
//     mars: "<ruta .xmars del perfil>",                    // opcional en 1.9.6+: sin ella, la base configurada en MGC
//     mgcOpts: { structureSeparation: 2, modelSmoothness: 2.5 },
//     mgcBorde: true,                                      // 1.9.6+: cada escala también con edgeCorrection (false = no)
//     dossier: "C:/ruta/dossier.json"                      // opcional: escribe el dossier de PiAstroPilot
//     halo: true, haloOpts: { escala: 1.1 },                 // polinomio fuera del halo (+ crominancia); false = no
//   });
//   JSON.stringify(r);   // { vista, candidatos: [{vista, modelo, metodo, parametros, metricas, notas}],
//                        //   intermedias, recomendado, motivo, errores }
//
// Qué hace:
// - No modifica la vista original. GraXpert se ejecuta sobre ella con replaceImage = false y sus salidas se
//   renombran a GC_GX<escala> (corregida) y GC_GX<escala>_modelo. MGC se aplica a una copia GC_MGC<escala>
//   (con la astrometría copiada) tras SPFC; su modelo pasa a GC_MGC<escala>_modelo.
// - Mide cada modelo con gcStructCopy (gradcompare.js): corr < 0,15 = modelo limpio; > 0,5 = se come el objeto.
// - Mide también el gradiente que queda (fondoResidual, rejilla 4x3 relativa al original) y recomienda, entre los que dejan <= 30 % del gradiente, el que menos copia el objeto. Si un candidato falla, se anota en "errores" y se sigue con el resto.
// - Requiere solución astrométrica en la vista (blindSolve, Paso 8) para MGC; GraXpert no la necesita.
//
// Las herramientas gradcompare.js y procesos.js se cargan desde la misma carpeta que este fichero. Si se
// usa desde otra ubicación, definir antes del eval: var GUIA_HERRAMIENTAS = "<ruta>/guia/herramientas";

var GR_DIR = (typeof GUIA_HERRAMIENTAS !== "undefined") ? GUIA_HERRAMIENTAS
           : File.homeDirectory + "/astro-agente-repo/guia/herramientas";
if (typeof gcPrepare !== "function") eval(File.readTextFile(GR_DIR + "/gradcompare.js"));
if (typeof pxMGC !== "function") eval(File.readTextFile(GR_DIR + "/procesos.js"));
// Siempre se recarga: PixInsight conserva las funciones globales entre ejecuciones del runner y con la guarda se quedaba
// la versión vieja de gradbordes.js (14 nov 2026).
eval(File.readTextFile(GR_DIR + "/gradbordes.js"));

function grIds() {
  var ids = [], ws = ImageWindow.windows;
  for (var i = 0; i < ws.length; ++i) ids.push(ws[i].mainView.id);
  return ids;
}

function grNew(before) {
  var now = grIds(), out = [];
  for (var i = 0; i < now.length; ++i) if (before.indexOf(now[i]) < 0) out.push(now[i]);
  return out;
}

// Nombre libre: id, id_2, id_3...
function grFreeId(id) {
  if (ImageWindow.windowById(id).isNull) return id;
  for (var n = 2; ; ++n) if (ImageWindow.windowById(id + "_" + n).isNull) return id + "_" + n;
}

function grRename(oldId, newId) {
  var w = ImageWindow.windowById(oldId);
  if (w.isNull) throw new Error("No existe la vista " + oldId);
  var id = grFreeId(newId);
  w.mainView.id = id;
  return id;
}

// GraXpert (proceso de PixInsight) sobre una vista, sin modificarla. escala: número (sample_free) o "IA".
function grGraXpert(srcId, escala, nombre, ref) {
  var before = grIds(), G = new GraXpert, v = View.viewById(srcId);
  G.backgroundExtraction = true;
  G.backgroundExtractionSampleFree = escala !== "IA";
  if (escala !== "IA") G.sampleFreeScale = escala;
  G.correction = "Subtraction"; G.createBackground = true; G.replaceImage = false;
  if (!G.executeOn(v)) throw new Error("GraXpert devolvió false");
  var nuevas = grNew(before), corr = null, mod = null;
  for (var k = 0; k < nuevas.length; ++k) {
    if (nuevas[k].indexOf("background_extraction") >= 0) corr = nuevas[k];
    else if (nuevas[k].indexOf("background") >= 0) mod = nuevas[k];
  }
  if (!corr || !mod) throw new Error("no encuentro las salidas de GraXpert (nuevas: " + nuevas.join(", ") + ")");
  corr = grRename(corr, nombre); mod = grRename(mod, nombre + "_modelo");
  try { ImageWindow.windowById(corr).keywords = (ref || v.window).keywords; } catch (e) { }
  return { corr: corr, mod: mod };
}

function grDuplicate(srcId, newId) {
  var src = ImageWindow.windowById(srcId);
  var im = src.mainView.image;
  var id = grFreeId(newId);
  var w = new ImageWindow(im.width, im.height, im.numberOfChannels, 32, true, im.isColor, id);
  w.mainView.beginProcess();
  w.mainView.image.assign(im);
  w.mainView.endProcess();
  if (src.hasAstrometricSolution) w.copyAstrometricSolution(src);
  try { w.keywords = src.keywords; } catch (e) { }   // FILTER y demás: combinarMasters clasifica por FILTER
  w.show();
  return w.mainView.id;
}

// Rango de las medianas del fondo en una rejilla 4x3 (media de canales): cuánto gradiente queda.
function grGridRange(viewId) {
  var im = ImageWindow.windowById(viewId).mainView.image;
  var nx = 4, ny = 3, cw = Math.floor(im.width / nx), ch = Math.floor(im.height / ny), meds = [];
  for (var y = 0; y < ny; ++y)
    for (var x = 0; x < nx; ++x) {
      var s = 0;
      for (var c = 0; c < im.numberOfChannels; ++c) {
        im.selectedChannel = c;
        im.selectedRect = new Rect(x * cw, y * ch, (x + 1) * cw, (y + 1) * ch);
        s += im.median();
      }
      meds.push(s / im.numberOfChannels);
    }
  im.resetSelections();
  return Math.max.apply(null, meds) - Math.min.apply(null, meds);
}

// Un canal binado (mediana) con las mismas dimensiones que la luminancia de gcPrepare.
function grChanBinned(viewId, c, bin) {
  var v = View.viewById(viewId), id = "gr_tmp_ch";
  var old = View.viewById(id); if (old && !old.isNull) old.window.forceClose();
  var PM = new PixelMath;
  PM.expression = v.image.numberOfChannels >= 3 ? "$T[" + c + "]" : "$T";
  PM.useSingleExpression = true; PM.createNewImage = true; PM.showNewImage = false; PM.newImageId = id;
  PM.newImageWidth = 0; PM.newImageHeight = 0; PM.rescale = false; PM.truncate = false;
  PM.newImageColorSpace = gcK(PixelMath, "Gray"); PM.newImageSampleFormat = gcK(PixelMath, "f32");
  if (!PM.executeOn(v, false)) throw new Error("PixelMath (canal) no se ejecutó");
  var g = View.viewById(id);
  try {
    var IR = new IntegerResample; IR.zoomFactor = -bin; IR.downsamplingMode = gcK(IntegerResample, "Median");
    IR.executeOn(g, false);
    var im = g.image, w = im.width, h = im.height, a = new Float32Array(w * h);
    im.getSamples(a, new Rect(0, 0, w, h), 0);
    return { a: a, w: w, h: h };
  } finally { g.window.forceClose(); }
}

// Coeficientes de un polinomio de grado 1 o 2 ajustado fuera del objeto (rejilla de medianas, rechazo a 2,5σ).
// Coordenadas normalizadas X, Y en [−0,5, 0,5], iguales a resolución completa y binada.
function grPolyCoef(img, excl, grado) {
  var w = img.w, h = img.h, a = img.a, gx = 32, gy = 22, pts = [];
  for (var j = 0; j < gy; j++) for (var i = 0; i < gx; i++) {
    var x0 = Math.floor(i * w / gx), x1 = Math.floor((i + 1) * w / gx), y0 = Math.floor(j * h / gy), y1 = Math.floor((j + 1) * h / gy), v = [];
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { var p = y * w + x; if (!excl[p] && a[p] > 0) v.push(a[p]); }
    if (v.length > 0.5 * (x1 - x0) * (y1 - y0)) pts.push({ x: (x0 + x1) / 2 / w - 0.5, y: (y0 + y1) / 2 / h - 0.5, z: gcMedian(v), ok: true });
  }
  var nt = grado >= 2 ? 6 : 3;
  // Si el objeto llena el campo no quedan celdas de cielo y el polinomio salía a cero (no corregía nada y parecía un
  // candidato más, con fondoResidual 1; IC 63, 8 nov 2026): se dice como error del candidato.
  if (pts.length < nt + 2)
    throw new Error("no quedan celdas de cielo fuera del objeto para ajustarlo (" + pts.length + " de " + (gx * gy) + "): el objeto llena el campo");
  function terms(x, y) { return grado >= 2 ? [1, x, y, x * x, x * y, y * y] : [1, x, y]; }
  var c = []; for (var q0 = 0; q0 < nt; q0++) c.push(0);
  for (var it = 0; it < 6; it++) {
    var A = [], b = [], k, r, q, n = 0;
    for (r = 0; r < nt; r++) { var row = []; for (q = 0; q < nt; q++) row.push(0); A.push(row); b.push(0); }
    for (k = 0; k < pts.length; k++) {
      if (!pts[k].ok) continue;
      var t = terms(pts[k].x, pts[k].y);
      for (r = 0; r < nt; r++) { b[r] += t[r] * pts[k].z; for (q = 0; q < nt; q++) A[r][q] += t[r] * t[q]; }
      n++;
    }
    if (n < nt + 2) break;
    c = gcSolveN(A, b);
    var res = [];
    for (k = 0; k < pts.length; k++) if (pts[k].ok) { var tt = terms(pts[k].x, pts[k].y), f = 0; for (r = 0; r < nt; r++) f += c[r] * tt[r]; res.push(pts[k].z - f); }
    var sd = gcMAD(res, gcMedian(res)), changed = false;
    for (k = 0; k < pts.length; k++) {
      var t2 = terms(pts[k].x, pts[k].y), f2 = 0; for (r = 0; r < nt; r++) f2 += c[r] * t2[r];
      var keep = sd == 0 || Math.abs(pts[k].z - f2) <= 2.5 * sd;
      if (keep != pts[k].ok) changed = true;
      pts[k].ok = keep;
    }
    if (!changed) break;
  }
  return c;
}

// Expresión de PixelMath del polinomio a resolución completa.
function grPolyExpr(c) {
  var X = "((x()+0.5)/w()-0.5)", Y = "((y()+0.5)/h()-0.5)", s = c[0].toExponential(8) + " + " + c[1].toExponential(8) + "*" + X + " + " + c[2].toExponential(8) + "*" + Y;
  if (c.length >= 6) s += " + " + c[3].toExponential(8) + "*" + X + "*" + X + " + " + c[4].toExponential(8) + "*" + X + "*" + Y + " + " + c[5].toExponential(8) + "*" + Y + "*" + Y;
  return s;
}

// fondoResidual: rango de las medianas del CIELO (rejilla 8×8 fuera del objeto, gcScore.flat) de la corregida frente
// al original. Antes era la rejilla 4×3 de toda la imagen, que en objetos grandes (galaxia grande) medía la galaxia y no el
// gradiente, y hacía ganar a GraXpert aunque se comiera parte de ella (5 nov 2026).
// come_objeto_pct: señal del objeto que se lleva el modelo (gcScore.eat), en % de la señal del objeto.
function grMeasure(base, modelId, correctedId, range0) {
  var m = gcStructCopy(base, modelId), s = gcMetrics(base, correctedId);
  if (base.flat0 === undefined) { var s0 = gcScore(base, base.O.a, "original"); base.flat0 = s0.flat; base.vis0 = s0.visible; }
  var fr = s.flat / base.flat0, fuente = "cielo fuera del objeto (rejilla 8x8)";
  // Si el objeto llena el campo no quedan celdas de cielo y la medida sale NaN (8 nov 2026, nebulosa que ocupa todo):
  // entonces se usa la rejilla 4x3 de toda la imagen frente al original (range0), que al menos compara los candidatos.
  if (!isFinite(fr) && range0 > 0) {
    try { fr = grGridRange(correctedId) / range0; fuente = "rejilla 4x3 de toda la imagen (el objeto llena el campo)"; } catch (e) { }
  }
  // Nombres neutros de la guía (los mismos en todos los programas): copia_objeto, objeto_quitado_pct, gradiente_restante.
  // gcStructCopy, fondoResidual y come_objeto_pct se mantienen como alias durante una versión (nov 2026).
  var corr = +m.corr.toFixed(3), resto = isFinite(fr) ? +fr.toFixed(3) : NaN, come = +(100 * s.eat).toFixed(1);
  // gradiente_visible (12 nov 2026): desnivel de las esquinas del cielo ya estirado (gcVisible); < 0,008 plano, > 0,015 se ve.
  var vis = isFinite(s.visible) ? +s.visible.toFixed(4) : NaN;
  return { copia_objeto: corr, objeto_quitado_pct: come, gradiente_restante: resto, fondo_medido_en: fuente, copia: m.copy,
           gradiente_visible: vis, gradiente_visible_antes: isFinite(base.vis0) ? +base.vis0.toFixed(4) : NaN,
           se_ve: !isFinite(vis) ? "sin medir" : vis < 0.008 ? "plano" : vis <= 0.015 ? "leve" : "se ve",
           gcStructCopy: corr, fondoResidual: resto, come_objeto_pct: come };
}

// 12 nov 2026 (Rafael): con 2+ masters se alinea y recorta SIEMPRE, salvo que ya vengan alineados: mismo tamaño, sin bordes
// sin datos y las estrellas en el mismo sitio. Eso se comprueba aquí; si se cumple, sigue sin pedir el Paso 5.
// Luminancia del centro (2n×2n px, binada ×2), con paso alto (menos su media 5×5) y recortada a [0, p99,9]: quedan las estrellas.
function grLumCentro(id, n) {
  var im = View.viewById(id).image, W = im.width, H = im.height, s = 2 * n;
  var w = Math.min(s, W) & ~1, h = Math.min(s, H) & ~1, x0 = (W - w) >> 1, y0 = (H - h) >> 1, nc = im.numberOfChannels;
  var buf = new Float32Array(w * h), L = new Float32Array(w * h), i, x, y;
  for (var c = 0; c < nc; ++c) { im.getSamples(buf, new Rect(x0, y0, x0 + w, y0 + h), c); for (i = 0; i < L.length; ++i) L[i] += buf[i] / nc; }
  var bw = w >> 1, bh = h >> 1, B = new Float32Array(bw * bh);
  for (y = 0; y < bh; ++y) for (x = 0; x < bw; ++x) {
    var p = 2 * y * w + 2 * x; B[y * bw + x] = 0.25 * (L[p] + L[p + 1] + L[p + w] + L[p + w + 1]);
  }
  var A = new Float32Array(bw * bh), muestra = [];
  for (y = 0; y < bh; ++y) for (x = 0; x < bw; ++x) {
    var s5 = 0, k = 0;
    for (var yy = Math.max(0, y - 2); yy <= Math.min(bh - 1, y + 2); ++yy) for (var xx = Math.max(0, x - 2); xx <= Math.min(bw - 1, x + 2); ++xx) { s5 += B[yy * bw + xx]; ++k; }
    var d = B[y * bw + x] - s5 / k; A[y * bw + x] = d > 0 ? d : 0;
    if (((y * bw + x) % 7) === 0) muestra.push(A[y * bw + x]);
  }
  muestra.sort(function (a, b) { return a - b; });
  var tope = muestra[Math.floor(0.999 * (muestra.length - 1))] || 1;
  for (i = 0; i < A.length; ++i) if (A[i] > tope) A[i] = tope;
  return { a: A, w: bw, h: bh };
}

// Correlación normalizada de A y B desplazada (dx, dy), en la zona común (margen 4).
function grNCC(A, B, dx, dy) {
  var w = A.w, h = A.h, m = 4, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
  for (var y = m; y < h - m; ++y) for (var x = m; x < w - m; ++x) {
    var a = A.a[y * w + x], b = B.a[(y + dy) * w + (x + dx)];
    sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; ++n;
  }
  var va = saa - sa * sa / n, vb = sbb - sb * sb / n;
  return (va > 0 && vb > 0) ? (sab - sa * sb / n) / Math.sqrt(va * vb) : 0;
}

// ¿Están las estrellas de idB en el mismo sitio que las de idA? Pico de correlación en desplazamiento 0 y claramente por
// encima de los desplazamientos de 3–4 px binados (girada o a otra escala no hay pico).
function grEstrellasCoinciden(idA, idB) {
  var A = grLumCentro(idA, 512), B = grLumCentro(idB, 512), best = -2, bx = 0, by = 0, anillo = -2, c0 = 0;
  for (var dy = -4; dy <= 4; ++dy) for (var dx = -4; dx <= 4; ++dx) {
    var c = grNCC(A, B, dx, dy);
    if (c > best) { best = c; bx = dx; by = dy; }
    if (dx === 0 && dy === 0) c0 = c;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= 3 && c > anillo) anillo = c;
  }
  return { coinciden: bx === 0 && by === 0 && c0 > 0.3 && c0 > 2 * Math.max(anillo, 0.01),
           desplazamiento_px: [2 * bx, 2 * by], correlacion: +c0.toFixed(3), correlacion_lejos: +anillo.toFixed(3) };
}

// 8 nov 2026: con dos masters abiertos, Qwen desmezcló y corrigió el gradiente sin pasar por alinearMasters (Paso 5).
// Si la vista es un master abierto desde disco (tiene fichero y no es un _alin) y hay otro master así abierto, se para,
// salvo que ya coincidan (mismo tamaño, sin bordes sin datos, estrellas en el mismo sitio). Devuelve null o la comprobación.
function grExigirAlineado(id, o) {
  if (o && (o.sinAlinear || o.alineados)) return null;
  var w = ImageWindow.windowById(id);
  if (w.isNull || !w.filePath || /_alin/i.test(id + " " + w.filePath)) return null;
  var otros = [], ws = ImageWindow.windows;
  for (var i = 0; i < ws.length; ++i) {
    var x = ws[i];
    if (x.mainView.id === id || !x.filePath || /_alin/i.test(x.mainView.id + " " + x.filePath)) continue;
    if (/\.(xisf|fits?|fts)$/i.test(x.filePath) && x.mainView.image.width > 1000) otros.push(x.mainView.id);
  }
  if (!otros.length) return null;
  var motivos = [], detalle = {}, im0 = w.mainView.image;
  try {
    [id].concat(otros).forEach(function (x) {
      if (typeof bordesSinDatos !== "function") throw new Error("falta bordesSinDatos (analisis.js)");
      if (bordesSinDatos(x).hay) motivos.push(x + " tiene bordes sin datos");
    });
    otros.forEach(function (x) {
      var im = View.viewById(x).image;
      if (im.width !== im0.width || im.height !== im0.height) {
        motivos.push(x + " tiene otro tamaño (" + im.width + "×" + im.height + " frente a " + im0.width + "×" + im0.height + ")");
        return;
      }
      var c = grEstrellasCoinciden(id, x);
      detalle[x] = c;
      if (!c.coinciden) motivos.push("las estrellas de " + x + " no coinciden con las de " + id + " (" + JSON.stringify(c) + ")");
    });
  } catch (e) { motivos.push("no se pudo comprobar si ya están alineados (" + e + ")"); }
  if (!motivos.length)
    return { masters: [id].concat(otros), ya_alineados: true, detalle: detalle,
             nota: "Mismo tamaño, sin bordes sin datos y estrellas en el mismo sitio: se salta el alineado (Paso 5)." };
  throw new Error("Hay " + (otros.length + 1) + " masters abiertos sin alinear (" + [id].concat(otros).join(", ") + "): " + motivos.join("; ") +
                  ". Primero el Paso 5: alinearMasters([\"" + [id].concat(otros).join("\", \"") + "\"]) y después todo sobre las vistas _alin " +
                  "que devuelve (r.vistas). Si el otro master es de otro proyecto y el usuario lo confirma, repetir con { sinAlinear: true }.");
}

function gradienteCandidatos(viewId, o) {
  // Con una lista de vistas (Qwen, 7 nov 2026: fallaba con "windowById(): String expected" y repetía el mismo script).
  if (viewId instanceof Array) return gradienteVarias(viewId, o);
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);   // también vale la View o el resultado de otra función ({ vista: ... })
  o = o || {};
  var yaAlineados = grExigirAlineado(viewId, o);
  // Por defecto se comparan los tres métodos (no hay uno preferido: se aplica el que mejor mida en cada imagen).
  var scalesGX = o.graxpert || [10, 8];
  var scalesMGC = o.mgc || [1024, 2048];
  // polinomio: lista de grados ([1, 2] por defecto); true = [1, 2], false = ninguno, un número = ese grado
  // (6 nov 2026: con polinomio: true no se generaba ninguno).
  var gradosPoly = o.polinomio === false ? [] : (o.polinomio === undefined || o.polinomio === true) ? [1, 2] :
                   (typeof o.polinomio === "number" ? [o.polinomio] : o.polinomio);
  var bin = o.bin || 8;
  var r = { vista: viewId, candidatos: [], intermedias: [], recomendado: "", motivo: "", errores: [] };
  if (yaAlineados) r.alineado = yaAlineados;

  var win = ImageWindow.windowById(viewId);
  if (win.isNull) throw new Error("No existe la vista " + viewId);
  var hasWCS = win.hasAstrometricSolution;

  // Cuñas sin datos (masters sin alinear/recortar): el modelo de fondo intenta ajustar el relleno y falsea todo.
  if (typeof bordesSinDatos !== "function") eval(File.readTextFile(GR_DIR + "/analisis.js"));
  var bd = bordesSinDatos(win.mainView);
  if (bd.hay && !o.ignorarBordes)
    throw new Error("La imagen tiene bordes sin datos (arriba " + bd.arriba + ", abajo " + bd.abajo + ", izquierda " + bd.izquierda +
                    ", derecha " + bd.derecha + " px): alinear y recortar primero (Paso 5, alinearMasters; con un solo master, " +
                    "recortar esos bordes con Crop). La corrección de gradiente va después.");

  // Base para gcStructCopy (luminancia binada del original); las vistas auxiliares que cree son intermedias.
  var before = grIds();
  var base = gcPrepare(viewId, bin);
  r.intermedias = r.intermedias.concat(grNew(before));
  var range0 = grGridRange(viewId);   // gradiente del original en la rejilla 4x3
  // Máscara propia (14 nov 2026): vista en la que blanco = objeto. Sólo saca esas zonas del AJUSTE de los modelos
  // (polinomio, bordes) y de las medidas de cielo; la corrección se aplica siempre a toda la imagen.
  if (o.mascara) {
    base.usuario = gbMascaraUsuario(o.mascara, base);
    for (var iu = 0; iu < base.usuario.length; ++iu) if (base.usuario[iu]) base.excl[iu] = 1;
    r.mascara = o.mascara;
  }

  // GraXpert sample_free, sustracción, sobre la original sin modificarla.
  for (var i = 0; i < scalesGX.length; ++i) {
    var s = scalesGX[i];
    try {
      before = grIds();
      var G = new GraXpert;
      G.backgroundExtraction = true;
      G.backgroundExtractionSampleFree = true;
      G.sampleFreeScale = s;
      G.correction = "Subtraction";
      G.createBackground = true;
      G.replaceImage = false;
      if (!G.executeOn(win.mainView)) throw new Error("GraXpert devolvió false");
      var nuevas = grNew(before), corr = null, mod = null;
      for (var k = 0; k < nuevas.length; ++k) {
        if (nuevas[k].indexOf("background_extraction") >= 0) corr = nuevas[k];
        else if (nuevas[k].indexOf("background") >= 0) mod = nuevas[k];
      }
      if (!corr || !mod) throw new Error("no encuentro las salidas de GraXpert (nuevas: " + nuevas.join(", ") + ")");
      corr = grRename(corr, "GC_GX" + s);
      try { ImageWindow.windowById(corr).keywords = win.keywords; } catch (e) { }
      mod = grRename(mod, "GC_GX" + s + "_modelo");
      r.candidatos.push({ vista: corr, modelo: mod, metodo: "GraXpert", parametros: "sample_free escala " + s + ", sustracción",
                          metricas: grMeasure(base, mod, corr, range0),
                          notas: ImageWindow.windowById(corr).hasAstrometricSolution ? "Conserva la astrometría." : "Sin astrometría: repetir blindSolve." });
    } catch (e) {
      r.errores.push("GraXpert escala " + s + ": " + e);
    }
  }

  // GraXpert con su modelo de IA (no sample_free), sobre la original sin modificarla (8 nov 2026). graxpertIA: false
  // para no probarlo.
  if (o.graxpertIA !== false) {
    try {
      before = grIds();
      var GI = new GraXpert;
      GI.backgroundExtraction = true;
      GI.backgroundExtractionSampleFree = false;
      GI.correction = "Subtraction";
      GI.createBackground = true;
      GI.replaceImage = false;
      if (!GI.executeOn(win.mainView)) throw new Error("GraXpert IA devolvió false");
      var nuevasI = grNew(before), corrI = null, modI = null;
      for (var ki = 0; ki < nuevasI.length; ++ki) {
        if (nuevasI[ki].indexOf("background_extraction") >= 0) corrI = nuevasI[ki];
        else if (nuevasI[ki].indexOf("background") >= 0) modI = nuevasI[ki];
      }
      if (!corrI || !modI) throw new Error("no encuentro las salidas de GraXpert IA (nuevas: " + nuevasI.join(", ") + ")");
      corrI = grRename(corrI, "GC_GXIA");
      try { ImageWindow.windowById(corrI).keywords = win.keywords; } catch (e) { }
      modI = grRename(modI, "GC_GXIA_modelo");
      r.candidatos.push({ vista: corrI, modelo: modI, metodo: "GraXpert", parametros: "modelo de IA, sustracción",
                          metricas: grMeasure(base, modI, corrI, range0),
                          notas: ImageWindow.windowById(corrI).hasAstrometricSolution ? "Conserva la astrometría." : "Sin astrometría: repetir blindSolve." });
    } catch (e) {
      r.errores.push("GraXpert IA: " + e);
    }
  }

  // GradientCorrection (proceso nativo de PixInsight): automático, sin astrometría ni MARS, con protección de las
  // estructuras. Sobre una copia; genera el modelo de gradiente. gradientCorrection: false para no probarlo; gcOpts
  // para cambiar sus parámetros (scale, smoothness, protection...).
  if (o.gradientCorrection !== false) {
    try {
      var gid = grDuplicate(viewId, "GC_GCORR");
      before = grIds();
      var GCP = new GradientCorrection;
      GCP.generateGradientModel = true;
      if (o.gcOpts) for (var kg in o.gcOpts) GCP[kg] = o.gcOpts[kg];
      if (!GCP.executeOn(View.viewById(gid))) throw new Error("GradientCorrection devolvió false");
      var ng = grNew(before), gmod = null;
      for (var qg = 0; qg < ng.length; ++qg) if (ng[qg].indexOf("model") >= 0) gmod = ng[qg];
      if (!gmod) throw new Error("GradientCorrection no creó el modelo de gradiente");
      gmod = grRename(gmod, gid + "_modelo");
      r.candidatos.push({ vista: gid, modelo: gmod, metodo: "GradientCorrection", parametros: "scale " + GCP.scale + ", protección " + (GCP.protection ? "sí" : "no"),
                          metricas: grMeasure(base, gmod, gid, range0), notas: "Proceso nativo de PixInsight; no necesita astrometría." });
    } catch (e) {
      r.errores.push("GradientCorrection: " + e);
    }
  }

  // MGC (SPFC previo) sobre copias. Necesita WCS y la base MARS. Con PixInsight 1.9.6+ cada escala se prueba
  // también con corrección de bordes (edgeCorrection), salvo mgcBorde: false.
  var conBorde = o.mgcBorde !== false && (new MultiscaleGradientCorrection).edgeCorrection !== undefined;
  var mgcRuns = [];
  for (var j0 = 0; j0 < scalesMGC.length; ++j0) {
    mgcRuns.push({ g: scalesMGC[j0], borde: false });
    if (conBorde) mgcRuns.push({ g: scalesMGC[j0], borde: true });
  }
  // Solución astrométrica equivocada (p. ej. heredada al combinar): SPFC busca en otra zona del cielo y MARS no
  // encuentra referencias. Se compara el centro con las coordenadas de la cabecera (RA/DEC u OBJCTRA/OBJCTDEC).
  var wcsMal = mgcRuns.length && hasWCS ? grWCSLejos(win) : null;
  if (wcsMal) r.errores.push("MGC: " + wcsMal);
  for (var j = 0; j < mgcRuns.length; ++j) {
    var g = mgcRuns[j].g, borde = mgcRuns[j].borde;
    try {
      if (!hasWCS) throw new Error("la vista no tiene solución astrométrica (Paso 8: blindSolve)");
      if (wcsMal) continue;
      var id = grDuplicate(viewId, "GC_MGC" + g + (borde ? "_borde" : ""));
      var v = View.viewById(id);
      if (!pxSPFC(o.spfc || {}).executeOn(v)) throw new Error("SPFC devolvió false");
      var mo = { mars: o.mars, gradientScale: g, showGradientModel: true };
      if (o.mgcOpts) for (var key in o.mgcOpts) mo[key] = o.mgcOpts[key];
      // Factores de escala automáticos (1.9.6+): con 1,0 fijo el modelo se llevaba el 3,4–3,9 % de una galaxia grande;
      // con automáticos (ajuste a MARS, correlación 0,98–0,99) no se lleva nada (14 nov 2026).
      if (mo.autoScaleFactors === undefined) mo.autoScaleFactors = true;
      if (borde) mo.edgeCorrection = true;
      before = grIds();
      var PM = pxMGC(mo);
      if (!PM.executeOn(v)) throw new Error("MGC devolvió false");
      var ajusteMARS = [];   // por canal: [canal, factor de escala, correlación con MARS] (1.9.6+)
      try { for (var cd = 0; cd < PM.channelData.length; ++cd) { var rw = PM.channelData[cd];
        ajusteMARS.push([rw[0], +(+rw[5]).toFixed(3), +(+rw[6]).toFixed(3)]); } } catch (eCD) { }
      var nm = grNew(before), mmod = null;
      for (var q = 0; q < nm.length; ++q) if (nm[q].indexOf("gradient_model") >= 0 || nm[q].indexOf("model") >= 0) mmod = nm[q];
      if (!mmod) throw new Error("MGC no creó el modelo de gradiente");
      mmod = grRename(mmod, id + "_modelo");
      var sinMARS = ajusteMARS.length && ajusteMARS.every(function (a) { return a[2] === 0; });
      r.candidatos.push({ vista: id, modelo: mmod, metodo: "MGC", parametros: "SPFC + MGC gradientScale " + g + (borde ? ", corrección de bordes" : ""),
                          metricas: grMeasure(base, mmod, id, range0), ajuste_mars: ajusteMARS,
                          notas: "No neutraliza el color del fondo (GraXpert sí)." +
                                 (sinMARS ? " Correlación con MARS 0 en todos los canales: la base MARS puede no cubrir este campo." : "") });
    } catch (e) {
      r.errores.push("MGC escala " + g + (borde ? " con bordes" : "") + ": " + e +
                     (/false/.test(String(e)) ? " (si SPFC busca en otra zona del cielo o MARS no tiene referencias, la astrometría está mal: resolverAstrometria con forzar: true)" : ""));
    }
  }

  // ABE (AutomaticBackgroundExtractor) de PixInsight por sustracción, sobre una copia (14 nov 2026). Sólo para pruebas y
  // comparativas (Rafael: con MGC no hace falta): apagado salvo abe: [2, 4] (lista de grados) o abe: true (= [2, 4]).
  var gradosABE = !o.abe ? [] : (o.abe instanceof Array ? o.abe : typeof o.abe === "number" ? [o.abe] : [2, 4]);
  for (var ga = 0; ga < gradosABE.length; ++ga) {
    try {
      var aid = grDuplicate(viewId, "GC_ABE" + gradosABE[ga]);
      before = grIds();
      var AB = new AutomaticBackgroundExtractor;
      AB.polyDegree = gradosABE[ga];
      AB.targetCorrection = 1;   // 0 ninguna, 1 sustracción, 2 división (las constantes no tienen el mismo nombre en todas las versiones)
      AB.normalize = true; AB.discardModel = false; AB.replaceTarget = true;
      try { AB.modelImageSampleFormat = gcK(AutomaticBackgroundExtractor, "f32"); } catch (eF) { }
      if (o.abeOpts) for (var ka in o.abeOpts) AB[ka] = o.abeOpts[ka];
      if (!AB.executeOn(View.viewById(aid))) throw new Error("ABE devolvió false");
      var na = grNew(before), amod = null;
      for (var qa = 0; qa < na.length; ++qa) if (na[qa].indexOf("ABE") >= 0 || na[qa].indexOf("background") >= 0) amod = na[qa];
      if (!amod) throw new Error("ABE no creó el modelo (nuevas: " + na.join(", ") + ")");
      amod = grRename(amod, aid + "_modelo");
      r.candidatos.push({ vista: aid, modelo: amod, metodo: "ABE", parametros: "grado " + gradosABE[ga] + ", sustracción",
                          metricas: grMeasure(base, amod, aid, range0), notas: "Muestras automáticas de PixInsight; no necesita astrometría." });
    } catch (e) {
      r.errores.push("ABE grado " + gradosABE[ga] + ": " + e);
    }
  }

  // Polinomio robusto (grado 1 = plano, grado 2) por canal, ajustado fuera del objeto: no puede comerse formas.
  // En galaxia grande (oct 2026) el grado 2 ganó a GraXpert, que se comía el 8,5 % de la galaxia.
  var nch = win.mainView.image.numberOfChannels;
  for (var gp = 0; gp < gradosPoly.length; ++gp) {
    var grado = gradosPoly[gp];
    try {
      var exprs = [];
      for (var ch = 0; ch < Math.min(3, nch); ++ch) exprs.push(grPolyExpr(grPolyCoef(grChanBinned(viewId, ch, bin), base.excl, grado)));
      var pid = grDuplicate(viewId, "GC_POLY" + grado), mid = grFreeId(pid + "_modelo");
      // Modelo (para medirlo y verlo) y corrección: $T − modelo + valor del modelo en el centro (mantiene el nivel).
      var PMm = new PixelMath;
      PMm.useSingleExpression = (nch < 3); PMm.expression = exprs[0];
      if (nch >= 3) { PMm.expression1 = exprs[1]; PMm.expression2 = exprs[2]; }
      PMm.createNewImage = true; PMm.showNewImage = true; PMm.newImageId = mid; PMm.newImageWidth = 0; PMm.newImageHeight = 0;
      PMm.rescale = false; PMm.truncate = false; PMm.newImageSampleFormat = gcK(PixelMath, "f32");
      PMm.newImageColorSpace = nch >= 3 ? gcK(PixelMath, "RGB") : gcK(PixelMath, "Gray");
      if (!PMm.executeOn(win.mainView)) throw new Error("PixelMath del modelo falló");
      var PMc = new PixelMath, cen = function (e) { return "(" + e.split(" + ")[0] + ")"; };
      PMc.useSingleExpression = (nch < 3); PMc.expression = "$T - (" + exprs[0] + ") + " + cen(exprs[0]);
      if (nch >= 3) { PMc.expression1 = "$T - (" + exprs[1] + ") + " + cen(exprs[1]); PMc.expression2 = "$T - (" + exprs[2] + ") + " + cen(exprs[2]); }
      PMc.rescale = false; PMc.truncate = false; PMc.createNewImage = false;
      if (!PMc.executeOn(View.viewById(pid))) throw new Error("PixelMath de la corrección falló");
      r.candidatos.push({ vista: pid, modelo: mid, metodo: "Polinomio", parametros: "grado " + grado + " ajustado fuera del objeto, por canal",
                          metricas: grMeasure(base, mid, pid, range0), notas: "No puede crear ni borrar formas; deja el gradiente que no sea liso." });
    } catch (e) {
      r.errores.push("Polinomio grado " + grado + ": " + e);
    }
  }

  // Polinomio fuera del halo (+ crominancia) (14 nov 2026): para objetos grandes y difusos cuyo halo exterior se sale de
  // la máscara. Ver grHalo en gradbordes.js. halo: false para no probarlo; haloOpts para la geometría.
  if (o.halo !== false && nch >= 3) {
    try {
      var gh = grHalo(viewId, base, o);
      var mth = grModeloCadena(viewId, gh.poly, gh.poly + "_modelo");
      var chp = { vista: gh.poly, modelo: mth, metodo: "Polinomio fuera del halo",
                  parametros: "grado " + (o.haloOpts && o.haloOpts.grado || 2) + " por canal, ajustado fuera del objeto agrandado ×" + gh.escala +
                              (gh.geometria ? " (" + gh.geometria + ")" : "") + "; " + gh.celdas + " celdas de cielo",
                  metricas: grMeasure(base, mth, gh.poly, range0),
                  notas: "La máscara del objeto agrandada saca el halo débil del ajuste: el polinomio no se curva para seguirlo." };
      r.candidatos.push(chp);
      if (gh.aviso) r.errores.push("Polinomio fuera del halo: " + gh.aviso);
      if (gh.depuracion) r.depuracion_halo = gh.depuracion;
      if (gh.croma) {
        r.intermedias.push(gh.modelo_croma);
        var mtc = grModeloCadena(viewId, gh.croma, gh.croma + "_modelo");
        r.candidatos.push({ vista: gh.croma, modelo: mtc, modelo_croma: gh.modelo_croma, metodo: "Polinomio fuera del halo + crominancia",
                            parametros: chp.parametros + " + superficie suave de R−G y B−G en " + gh.cajas_usadas + " cajas de cielo",
                            metricas: grMeasure(base, mtc, gh.croma, range0),
                            notas: "Quita manchas de color de escala media (p. ej. un hueco en un solo canal) sin tocar la luminancia; bajo el objeto, interpolado." });
      }
    } catch (e) { r.errores.push("Polinomio fuera del halo: " + e); }
  }

  // Cadenas (14 nov 2026, Rafael): polinomio (gradiente general) → buscar manchas → gradiente de bordes → buscar
  // manchas otra vez; y, para comparar, polinomio + GraXpert. Cada cadena es un candidato más, medido como los demás
  // con su modelo total (original − corregida).
  var gradosCadena = o.cadenas === false ? [] : (o.cadenas instanceof Array ? o.cadenas :
                     gradosPoly.indexOf(2) >= 0 ? [2] : gradosPoly.length ? [gradosPoly[gradosPoly.length - 1]] : []);
  r.cadena = [];
  gradosCadena.forEach(function (gc) {
    var cp = r.candidatos.filter(function (x) { return x.metodo === "Polinomio" && x.parametros.indexOf("grado " + gc) === 0; })[0];
    if (!cp) { r.errores.push("Cadenas: no hay candidato de polinomio de grado " + gc); return; }
    var mp; try { mp = cp.metricas.manchas = grManchas(cp.vista, base, o); } catch (e) { r.errores.push("Manchas de " + cp.vista + ": " + e); }
    if (mp) r.cadena.push("Polinomio " + gc + ": manchas " + mp.donde + " (brillo bordes " + mp.manchas_brillo_bordes + ", centro " +
                          mp.manchas_brillo_centro + "; color bordes " + mp.manchas_color_bordes + ", centro " + mp.manchas_color_centro + ")");
    // Gradiente de bordes: siempre se prueba (es barato); si tras la primera pasada siguen manchas en los bordes, una
    // segunda más fina y estrecha.
    if (o.bordes !== false) {
      var pasadas = [{ sufijo: "B", op: o.bordesOpts || {} },
                     { sufijo: "BB", op: o.bordesOpts2 || { escalaBordes: 24, anchoBordes: 0.12, llenoBordes: 0.03 } }];
      var srcB = cp.vista;
      for (var pb = 0; pb < pasadas.length; ++pb) {
        try {
          var gb = grBordes(srcB, base, "GC_POLY" + gc + pasadas[pb].sufijo, pasadas[pb].op);
          r.intermedias.push(gb.modelo);
          var mt = grModeloCadena(viewId, gb.vista, gb.vista + "_modelo_total");
          var cb = { vista: gb.vista, modelo: mt, modelo_bordes: gb.modelo, metodo: "Polinomio + bordes",
                     parametros: "grado " + gc + " + gradiente de bordes" + (pb ? " (2 pasadas)" : "") + ", ancho " + gb.ancho,
                     metricas: grMeasure(base, mt, gb.vista, range0),
                     notas: "El modelo de bordes se ajusta sólo en el cielo (sin objeto ni estrellas) y vale 0 en el interior." };
          cb.metricas.manchas = grManchas(gb.vista, base, o);
          r.candidatos.push(cb);
          r.cadena.push(cb.metodo + (pb ? " ×2" : "") + ": manchas " + cb.metricas.manchas.donde + " (brillo bordes " +
                        cb.metricas.manchas.manchas_brillo_bordes + ", color bordes " + cb.metricas.manchas.manchas_color_bordes +
                        "), objeto quitado " + cb.metricas.objeto_quitado_pct + " %");
          var d = cb.metricas.manchas.donde;
          if (d !== "bordes" && d !== "todo") break;
          srcB = gb.vista;
        } catch (e) { r.errores.push("Bordes (pasada " + (pb + 1) + ") sobre " + srcB + ": " + e); break; }
      }
    }
    // Polinomio + cielo con máscara (14 nov 2026): el mismo modelo liso del cielo (sin objeto ni estrellas; bajo el objeto,
    // interpolado desde el cielo de alrededor) pero restado en TODO el campo, no sólo en los bordes. Ataca las manchas que
    // deja el polinomio entre los bordes y el objeto. cieloMascara: false para no probarlo; cieloOpts: { escalaBordes }.
    if (o.cieloMascara !== false) {
      try {
        var cmo = o.cieloOpts || {}; cmo.anchoBordes = 99; cmo.llenoBordes = 99; if (!cmo.escalaBordes) cmo.escalaBordes = 15;   // galaxia grande, 14 nov 2026: 1/10 quita 0,8 %, 1/15 1,0 %, 1/25 1,6 %
        var gm = grBordes(cp.vista, base, "GC_POLY" + gc + "M", cmo);
        r.intermedias.push(gm.modelo);
        var mtm = grModeloCadena(viewId, gm.vista, gm.vista + "_modelo_total");
        var cm = { vista: gm.vista, modelo: mtm, modelo_bordes: gm.modelo, metodo: "Polinomio + cielo con máscara",
                   parametros: "grado " + gc + " + modelo liso del cielo con máscara del objeto (suavizado 1/" + cmo.escalaBordes + ")",
                   metricas: grMeasure(base, mtm, gm.vista, range0),
                   notas: "Modelo ajustado sólo en el cielo y aplicado en todo el campo; bajo el objeto, interpolado." };
        cm.metricas.manchas = grManchas(gm.vista, base, o);
        r.candidatos.push(cm);
        r.cadena.push(cm.metodo + ": manchas " + cm.metricas.manchas.donde + " (brillo " + cm.metricas.manchas.manchas_brillo +
                      ", color " + cm.metricas.manchas.manchas_color + "), objeto quitado " + cm.metricas.objeto_quitado_pct + " %");
      } catch (e) { r.errores.push("Cielo con máscara sobre " + cp.vista + ": " + e); }
    }
    // Polinomio + GraXpert (suave): IA y sample_free 10 sobre la salida del polinomio.
    var gxCad = o.cadenaGraXpert === false ? [] : (o.cadenaGraXpert instanceof Array ? o.cadenaGraXpert : ["IA", 10]);
    gxCad.forEach(function (gs) {
      try {
        var gx = grGraXpert(cp.vista, gs, "GC_POLY" + gc + "_GX" + gs, win);
        r.intermedias.push(gx.mod);
        var mt2 = grModeloCadena(viewId, gx.corr, gx.corr + "_modelo_total");
        var cg = { vista: gx.corr, modelo: mt2, metodo: "Polinomio + GraXpert",
                   parametros: "grado " + gc + " + GraXpert " + (gs === "IA" ? "IA" : "sample_free escala " + gs),
                   metricas: grMeasure(base, mt2, gx.corr, range0), notas: "Segunda pasada de GraXpert sobre el polinomio." };
        cg.metricas.manchas = grManchas(gx.corr, base, o);
        r.candidatos.push(cg);
        r.cadena.push(cg.metodo + " " + gs + ": manchas " + cg.metricas.manchas.donde + ", objeto quitado " + cg.metricas.objeto_quitado_pct + " %");
      } catch (e) { r.errores.push("Polinomio + GraXpert " + gs + ": " + e); }
    });
  });
  // MGC con bordes → cielo con máscara (14 nov 2026): MGC quita el gradiente general y el de bordes sin comerse el objeto
  // (con factores de escala automáticos) y el modelo del cielo con máscara limpia las manchas que deja. En una galaxia
  // grande fue lo que dejó el cielo más uniforme; un plano intermedio lo empeoraba (cadenaMGCPlano: true para probarlo).
  // cadenaMGC: false para no probar la cadena.
  if (o.cadenaMGC !== false) {
    var mgcB = r.candidatos.filter(function (x) { return x.metodo === "MGC" && /bordes/.test(x.parametros); });
    if (!mgcB.length) mgcB = r.candidatos.filter(function (x) { return x.metodo === "MGC"; });
    mgcB.sort(function (a, b) { return (a.metricas.gradiente_visible || 9) - (b.metricas.gradiente_visible || 9); });
    if (mgcB.length) {
      var srcM = mgcB[0].vista, desc = mgcB[0].parametros;
      try {
        if (o.cadenaMGCPlano) {
          var p1 = grPlanoSobre(srcM, base, bin, srcM + "_P1");
          var mt1 = grModeloCadena(viewId, p1, p1 + "_modelo_total");
          var c1 = { vista: p1, modelo: mt1, metodo: "MGC + plano", parametros: desc + " + polinomio grado 1",
                     metricas: grMeasure(base, mt1, p1, range0), notas: "Plano robusto sobre la salida de MGC." };
          c1.metricas.manchas = grManchas(p1, base, o);
          r.candidatos.push(c1);
          r.cadena.push("MGC + plano: manchas " + c1.metricas.manchas.donde + " (brillo " + c1.metricas.manchas.manchas_brillo +
                        ", color " + c1.metricas.manchas.manchas_color + "), objeto quitado " + c1.metricas.objeto_quitado_pct + " %");
          srcM = p1; desc += " + polinomio grado 1";
        }
        if (o.cieloMascara !== false) {
          var cmo2 = {}; for (var kc in (o.cieloOpts || {})) cmo2[kc] = o.cieloOpts[kc];
          cmo2.anchoBordes = 99; cmo2.llenoBordes = 99; if (!cmo2.escalaBordes) cmo2.escalaBordes = 15;
          var gm2 = grBordes(srcM, base, srcM + "M", cmo2);
          r.intermedias.push(gm2.modelo);
          var mt3 = grModeloCadena(viewId, gm2.vista, gm2.vista + "_modelo_total");
          var c3 = { vista: gm2.vista, modelo: mt3, modelo_bordes: gm2.modelo, metodo: "MGC + cielo con máscara",
                     parametros: desc + " + cielo con máscara (1/" + cmo2.escalaBordes + ")",
                     metricas: grMeasure(base, mt3, gm2.vista, range0), notas: "Modelo del cielo con máscara sobre la salida de MGC." };
          c3.metricas.manchas = grManchas(gm2.vista, base, o);
          r.candidatos.push(c3);
          r.cadena.push(c3.metodo + ": manchas " + c3.metricas.manchas.donde + " (brillo " + c3.metricas.manchas.manchas_brillo +
                        ", color " + c3.metricas.manchas.manchas_color + "), objeto quitado " + c3.metricas.objeto_quitado_pct + " %");
        }
      } catch (e) { r.errores.push("Cadena MGC sobre " + srcM + ": " + e); }
    }
  }
  if (!r.cadena.length) delete r.cadena;
  // Manchas en todos los candidatos (las cadenas ya las tienen).
  if (o.manchas !== false) {
    try { r.manchas_original = grManchas(viewId, base, o); } catch (e) { r.errores.push("Manchas del original: " + e); }
    r.candidatos.forEach(function (c) {
      if (c.metricas && !c.metricas.manchas)
        try { c.metricas.manchas = grManchas(c.vista, base, o); } catch (e) { r.errores.push("Manchas de " + c.vista + ": " + e); }
    });
  }

  r.leyenda = "manchas: variación de brillo y color de gran escala que queda en el cielo, ya estirada (brillo < 0,03 no se ve, > 0,06 se ve; " +
              "color < 0,02 no se ve, > 0,04 se ve; nivel: no se ven / leves / se ven), en los bordes y en el centro; donde = dónde se ven. " +
              "copia_objeto: cuánto se parece el modelo de fondo al objeto (cerca de 0 = modelo limpio; > 0,5 = se come el objeto; " +
              "negativo = infla el objeto). objeto_quitado_pct: % de la señal del objeto que se lleva el modelo (menor = mejor). " +
              "gradiente_restante: fracción del gradiente del cielo que queda, medido fuera del objeto (menor = más plano). " +
              "gradiente_visible: desnivel entre esquinas del cielo tras un estirado automático (< 0,008 plano; > 0,015 se ve; " +
              "gradiente_visible_antes = el del original). Es la medida que cuenta cuando el objeto llena el campo. " +
              "Mejor: el que deja poco gradiente sin comerse el objeto. (gcStructCopy, come_objeto_pct y fondoResidual: " +
              "nombres antiguos de lo mismo, se quitarán.)";

  // Recomendación. Un buen modelo cumple dos cosas: quita el gradiente (fondoResidual = rango del fondo
  // corregido / rango del original) y no copia el objeto (|corr| pequeño; negativo = el modelo infla el objeto).
  // Prioridad, como en la guía: entre los que dejan <= 30 % del gradiente, el que menos copia (menor |corr|);
  // si ninguno lo consigue, el que menos gradiente deja con |corr| < 0,3; y si tampoco, el de menor |corr|.
  function pick(list, key) {
    var b = null;
    for (var i = 0; i < list.length; ++i) if (b === null || key(list[i]) < key(b)) b = list[i];
    return b;
  }
  // Una medida que no se pudo calcular (NaN) cuenta como la peor: con NaN, pick() se quedaba con el primero de la
  // lista (8 nov 2026, IC 63: ganó GraXpert 10 con «deja NaN %» sin comparar de verdad).
  function absCorr(x) { var c = Math.abs(x.metricas.gcStructCopy); return isFinite(c) ? c : Infinity; }
  // Sin cielo fuera del objeto (gradiente_restante NaN) se usa el gradiente visible tras estirar respecto al del original.
  function resid(x) {
    var f = x.metricas.fondoResidual; if (isFinite(f)) return f;
    var v = x.metricas.gradiente_visible, v0 = x.metricas.gradiente_visible_antes;
    return isFinite(v) && v0 > 0 ? v / v0 : Infinity;
  }
  function vis(x) { var v = x.metricas.gradiente_visible; return isFinite(v) ? v : Infinity; }
  function eat(x) { var e = x.metricas.come_objeto_pct; return isFinite(e) ? Math.abs(e) : 100; }
  // Primero, no comerse el objeto (≤ 3 % de su señal y modelo limpio); entre esos, el que deja el cielo más plano.
  function manchas(x) { var m = x.metricas.manchas; return m && m.se_ven !== undefined ? m.se_ven : null; }
  var safe = r.candidatos.filter(function (x) { return eat(x) <= 3 && absCorr(x) < 0.3; });
  // Entre los seguros, mejor uno cuyo cielo no se vea desnivelado al estirar (gradiente_visible ≤ 0,015), si lo hay.
  var noSeVe = safe.filter(function (x) { return vis(x) <= 0.015; });
  if (noSeVe.length) safe = noSeVe;
  var clean = r.candidatos.filter(function (x) { return absCorr(x) < 0.3; });
  // 14 nov 2026: entre los seguros sin manchas visibles, el que MENOS objeto se lleva (Rafael: perder la menor
  // información posible; el cielo ya está bien por definición). Si todos tienen manchas, el más plano, como antes.
  var sinManchas = safe.filter(function (x) { return manchas(x) === false; });
  var best = sinManchas.length ? pick(sinManchas, function (x) { return eat(x) + 0.01 * absCorr(x); })
           : safe.length ? pick(safe, resid) : clean.length ? pick(clean, eat) : pick(r.candidatos, absCorr);
  if (best) {
    var bc = best.metricas.gcStructCopy;
    r.recomendado = best.vista;
    r.motivo = best.metodo + " " + best.parametros + ": deja " +
               (isFinite(best.metricas.fondoResidual) ? Math.round(100 * best.metricas.fondoResidual) + " %" : "(sin medir)") +
               " del gradiente del cielo, se lleva el " + best.metricas.come_objeto_pct + " % del objeto, copia_objeto " + bc.toFixed(3) + " (" +
               (Math.abs(bc) < 0.15 ? "modelo limpio" : Math.abs(bc) > 0.5 ? "copia el objeto: revisar o probar plano robusto"
                                                                   : "intermedio: revisar el modelo a la vista") + ")" +
               (isFinite(best.metricas.gradiente_visible) ? "; tras estirar: " + best.metricas.se_ve + " (" + best.metricas.gradiente_visible +
                 (vis(best) > 0.015 ? "; se verá el desnivel: probar otro candidato o una segunda pasada suave" : "") + ")" : "") +
               (best.metricas.manchas ? "; manchas: " + best.metricas.manchas.donde : "") + ".";
  } else {
    r.motivo = "Ningún candidato se pudo medir: ver errores.";
  }
  // Diagnóstico de las manchas que quedan en la recomendada (14 nov 2026): canal, exceso o hueco y si siguen al objeto,
  // con un veredicto en una frase. diagnostico: false para no hacerlo.
  if (r.recomendado && o.diagnostico !== false && nch >= 3) {
    try { r.diagnostico_manchas = diagnosticoManchas(r.recomendado, { bin: bin, mascara: o.mascara }); }
    catch (e) { r.errores.push("Diagnóstico de manchas: " + e); }
  }
  // Miniaturas para el chat: la corregida (con STF) y, al lado, el modelo de gradiente quitado.
  r.candidatos.forEach(function (c) {
    var p = pxPrevia(c.vista, "grad_" + c.vista), pm = pxPrevia(c.modelo, "grad_" + c.modelo);
    if (p) c.previa = p;
    if (pm) c.previa_modelo = pm;
    if (c.vista === r.recomendado) c.elegido = true;
  });
  if (o.dossier) {
    var dir = File.extractDrive(o.dossier) + File.extractDirectory(o.dossier);
    if (!File.directoryExists(dir)) File.createDirectory(dir, true);
    File.writeTextFile(o.dossier, JSON.stringify({
      titulo: "Corrección de gradiente - " + viewId, vista: viewId,
      analisis: o.analisis || "", candidatos: r.candidatos, intermedias: r.intermedias,
      recomendado: r.recomendado, motivo: r.motivo, informe: "", errores: r.errores }, null, 2));
  }
  grPrevios.push(r);
  if (grPrevios.length > 1 && !o.noCompactar) grPrevios.forEach(function (g) { grCompactar(g, o); });
  return r;
}

// Plano robusto (grado 1) por canal ajustado fuera del objeto sobre la vista srcId; devuelve el id de la copia corregida.
function grPlanoSobre(srcId, base, bin, nombre) {
  var src = View.viewById(srcId), nch = src.image.numberOfChannels, exprs = [];
  for (var ch = 0; ch < Math.min(3, nch); ++ch) exprs.push(grPolyExpr(grPolyCoef(grChanBinned(srcId, ch, bin), base.excl, 1)));
  var pid = grDuplicate(srcId, nombre), cen = function (e) { return "(" + e.split(" + ")[0] + ")"; };
  var P = new PixelMath;
  P.useSingleExpression = (nch < 3); P.expression = "$T - (" + exprs[0] + ") + " + cen(exprs[0]);
  if (nch >= 3) { P.expression1 = "$T - (" + exprs[1] + ") + " + cen(exprs[1]); P.expression2 = "$T - (" + exprs[2] + ") + " + cen(exprs[2]); }
  P.rescale = false; P.truncate = false; P.createNewImage = false;
  if (!P.executeOn(View.viewById(pid))) throw new Error("PixelMath del plano falló");
  return pid;
}

// Devuelve un aviso si el centro de la solución astrométrica está a más de 5° de las coordenadas de la cabecera.
function grWCSLejos(w) {
  function kw(n) { for (var i = 0; i < w.keywords.length; ++i) if (w.keywords[i].name == n) return w.keywords[i].strippedValue; return null; }
  function sexa(t, h) { var a = String(t).trim().split(/[\s:]+/).map(parseFloat); if (a.some(isNaN)) return NaN;
    var sg = /^-/.test(String(t).trim()) ? -1 : 1, v = Math.abs(a[0]) + (a[1] || 0) / 60 + (a[2] || 0) / 3600; return sg * v * (h ? 15 : 1); }
  try {
    var ra = parseFloat(kw("RA")), de = parseFloat(kw("DEC"));
    if (isNaN(ra) || isNaN(de)) { ra = sexa(kw("OBJCTRA"), true); de = sexa(kw("OBJCTDEC"), false); }
    if (isNaN(ra) || isNaN(de)) return null;
    var im = w.mainView.image, q = w.imageToCelestial(new Point(im.width / 2, im.height / 2));
    var r = Math.PI / 180, c = Math.sin(de * r) * Math.sin(q.y * r) + Math.cos(de * r) * Math.cos(q.y * r) * Math.cos((ra - q.x) * r);
    var d = Math.acos(Math.max(-1, Math.min(1, c))) / r;
    return d > 5 ? "la solución astrométrica está a " + d.toFixed(1) + "° de las coordenadas de la cabecera (centro " + q.x.toFixed(2) +
                   ", " + q.y.toFixed(2) + "): repetir resolverAstrometria con forzar: true y pistas de región; MGC no se prueba" : null;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------------------------------------------
// Varias vistas (RGB y líneas desmezcladas). Qwen pasó gradienteCandidatos a 7 vistas en un script, en bucle
// (7 nov 2026, dos veces): 8 min, 56 vistas abiertas (memoria) y ~25 000 caracteres de resultado que llenaron su
// contexto. grCompactar deja la recomendada como <vista>_gc (conserva FILTER), cierra los demás candidatos y modelos
// y cambia el resultado (el mismo objeto) por un resumen corto.
function grCompactar(g, o) {
  if (!g || g.compacto) return g;
  o = o || {};
  var id = g.vista, keep = null;
  if (g.recomendado) keep = grRename(g.recomendado, id + "_gc");
  if (o.cerrar !== false)
    g.candidatos.forEach(function (c) {
      [c.vista, c.modelo].forEach(function (v) {
        if (v && v !== g.recomendado) { var w = ImageWindow.windowById(v); if (!w.isNull) w.forceClose(); }
      });
    });
  if (o.cerrar !== false && g.intermedias)
    g.intermedias.forEach(function (v) { var w = ImageWindow.windowById(v); if (!w.isNull) w.forceClose(); });
  var best = g.candidatos.filter(function (c) { return c.vista === g.recomendado; })[0];
  // Tabla corta de la comparación (una fila por candidato): sin ella no se veía qué se había comparado (8 nov 2026).
  g.comparados = g.candidatos.map(function (c) {
    var m = c.metricas || {}, f = m.fondoResidual;
    var come = isFinite(m.come_objeto_pct) ? m.come_objeto_pct : null, corr = isFinite(m.gcStructCopy) ? m.gcStructCopy : null;
    return { metodo: c.metodo + " " + c.parametros, deja_gradiente_pct: isFinite(f) ? Math.round(100 * f) : null,
             gradiente_restante: isFinite(f) ? f : null, objeto_quitado_pct: come, copia_objeto: corr,
             gradiente_visible: isFinite(m.gradiente_visible) ? m.gradiente_visible : null,
             manchas: m.manchas ? m.manchas.donde : null,
             come_objeto_pct: come, corr: corr, elegido: c === best,
             previa: c.previa, previa_modelo: c.previa_modelo };
  });
  g.compacto = true;
  g.corregida = keep;
  g.recomendado = keep;
  g.metodo = best ? best.metodo + " " + best.parametros : "—";
  g.deja_gradiente_pct = best && isFinite(best.metricas.fondoResidual) ? Math.round(100 * best.metricas.fondoResidual) : null;
  g.come_objeto_pct = best ? best.metricas.come_objeto_pct : null;
  g.objeto_quitado_pct = g.come_objeto_pct;
  g.gradiente_restante = best && isFinite(best.metricas.fondoResidual) ? best.metricas.fondoResidual : null;
  delete g.candidatos; delete g.intermedias; delete g.leyenda;
  if (!g.errores || !g.errores.length) delete g.errores;
  return g;
}

// Resultados de gradienteCandidatos en este script: desde la segunda llamada se compactan todos (el bucle de Qwen).
var grPrevios = [];

// Uso: JSON.stringify(gradienteVarias(["master_RGB_alin", "Ha_raw", "OIII_raw"]));
// Las corregidas se llaman <vista>_gc y están en r.vista_corregida (original -> corregida).
// Si ya se compararon y sólo hay que quedarse con un candidato, NO repite la comparación (7 nov: Qwen llamó
// gradienteVarias(original, candidato) y rehízo los candidatos 8 min): gradienteVarias("Ha_raw", "GC_POLY2_2") o
// gradienteVarias({"Ha_raw": "GC_POLY2_2", ...}) renombra el candidato a <vista>_gc; si <vista>_gc ya existe, lo reutiliza.
function grAdoptar(id, cand) {
  if (!ImageWindow.windowById(id + "_gc").isNull) return id + "_gc";
  if (!cand || ImageWindow.windowById(cand).isNull)
    throw new Error("No existe " + id + "_gc ni el candidato " + cand + ": usa gradienteVarias([\"" + id + "\"]) para compararlos");
  return grRename(cand, id + "_gc");
}

function gradienteVarias(lista, o) {
  var mapa = null;
  if (typeof o === "string") { mapa = {}; mapa[lista] = o; o = {}; }
  else if (lista && !(lista instanceof Array) && typeof lista === "object") { mapa = lista; }
  o = o || {};
  var r = { vistas: {}, vista_corregida: {}, corregidas: [], errores: [],
            control: { revisar_a_ojo: ["el modelo de cada vista recomendada (repetir gradienteCandidatos sólo en esa vista para verlo)"] } };
  if (mapa) {
    Object.keys(mapa).forEach(function (id) {
      try {
        var c = grAdoptar(id, mapa[id]);
        r.vista_corregida[id] = c; r.corregidas.push(c);
      } catch (e) { r.errores.push(id + ": " + e.message); }
    });
  } else {
    if (!(lista instanceof Array)) lista = [lista];
    lista.forEach(function (id) {
      try {
        if (!ImageWindow.windowById(id + "_gc").isNull && !o.repetir) {
          r.vista_corregida[id] = id + "_gc"; r.corregidas.push(id + "_gc");
          r.vistas[id] = { corregida: id + "_gc", nota: "ya estaba corregida (repetir: true para compararla otra vez)" };
          return;
        }
        var g = grCompactar(gradienteCandidatos(id, o), o);
        r.vistas[id] = g;
        if (g.corregida) { r.vista_corregida[id] = g.corregida; r.corregidas.push(g.corregida); }
      } catch (e) {
        r.errores.push(id + ": " + e.message);
      }
    });
  }
  if (r.corregidas.length === 1) r.vista = r.corregidas[0];
  r.siguiente = "Sigue con las vistas de r.corregidas (<vista>_gc).";
  if (!r.errores.length) delete r.errores;
  return r;
}
