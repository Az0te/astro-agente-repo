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

// Umbrales de manchas_color (grManchas), medidos en M31 (13 nov 2026): GraXpert IA 13, GraXpert 8 21, polinomio 2 38
// (manchas verdes y violetas que se veían en la miniatura), polinomio 1 53.
var GR_MANCHAS_LEVE = 20, GR_MANCHAS_SE_VEN = 30;
var GR_DIR = (typeof GUIA_HERRAMIENTAS !== "undefined") ? GUIA_HERRAMIENTAS
           : File.homeDirectory + "/astro-agente-repo/guia/herramientas";
if (typeof gcPrepare !== "function") eval(File.readTextFile(GR_DIR + "/gradcompare.js"));
if (typeof pxMGC !== "function") eval(File.readTextFile(GR_DIR + "/procesos.js"));

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
// Manchas de gran escala que deja la corrección (13 nov 2026, M31: el polinomio de grado 2 se llevaba menos objeto que
// nadie pero dejaba manchas verdes y violetas en el cielo; Opus las vio en la miniatura, los Qwen no pueden verlas).
// Celdas de 128 px del cielo (el 40 % más oscuro por luminancia, para no medir el objeto): mediana por celda de R−G,
// B−G y de la luminancia; dispersión robusta (MAD) entre celdas, en unidades del ruido por píxel del cielo, ×100 para
// leerlo cómodo. Plano = 0; cuanto más alto, más manchas al estirar. Un gradiente liso que quede también sube la de
// luminancia, por eso se lee junto con gradiente_restante.
function grManchas(viewId) {
  try {
    var v = View.viewById(viewId), im = v.image, W = im.width, H = im.height, nc = im.numberOfChannels, S = 128, st = 4;
    var nch = Math.min(3, nc), ch = [];
    for (var c = 0; c < nch; ++c) ch.push(new Float32Array(S * S));
    var med = function (a) { var s = a.slice().sort(function (p, q) { return p - q; }); return s[s.length >> 1]; };
    var mad = function (a) { var m = med(a); return 1.4826 * med(a.map(function (x) { return Math.abs(x - m); })); };
    var cells = [];
    for (var y0 = S; y0 + 2 * S <= H; y0 += S) for (var x0 = S; x0 + 2 * S <= W; x0 += S) {   // sin el borde exterior
      var L = [], rg = [], bg = [];
      for (var c2 = 0; c2 < nch; ++c2) im.getSamples(ch[c2], new Rect(x0, y0, x0 + S, y0 + S), c2);
      for (var y = 0; y < S; y += st) for (var x = 0; x < S; x += st) {
        var i = y * S + x, l = 0;
        for (var k = 0; k < ch.length; ++k) l += ch[k][i];
        L.push(l / ch.length);
        if (ch.length >= 3) { rg.push(ch[0][i] - ch[1][i]); bg.push(ch[2][i] - ch[1][i]); }
      }
      var mL = med(L);
      if (mL <= 0) continue;   // bordes sin datos
      cells.push({ L: mL, rg: rg.length ? med(rg) : 0, bg: bg.length ? med(bg) : 0, ruido: mad(L) });
    }
    if (cells.length < 12) return null;
    cells.sort(function (p, q) { return p.L - q.L; });
    var sky = cells.slice(0, Math.max(8, Math.floor(0.4 * cells.length)));
    var ruido = med(sky.map(function (c) { return c.ruido; }));
    if (!(ruido > 0)) return null;
    var col = ch.length >= 3 ? Math.max(mad(sky.map(function (c) { return c.rg; })), mad(sky.map(function (c) { return c.bg; }))) : 0;
    var lum = mad(sky.map(function (c) { return c.L; }));
    return { color: +(100 * col / ruido).toFixed(1), luminancia: +(100 * lum / ruido).toFixed(1), celdas: sky.length };
  } catch (e) { return null; }
}

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
  var mn = grManchas(correctedId);
  return { manchas_color: mn ? mn.color : null, manchas_luminancia: mn ? mn.luminancia : null, copia_objeto: corr, objeto_quitado_pct: come, gradiente_restante: resto, fondo_medido_en: fuente, copia: m.copy,
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
  for (var j = 0; j < mgcRuns.length; ++j) {
    var g = mgcRuns[j].g, borde = mgcRuns[j].borde;
    try {
      if (!hasWCS) throw new Error("la vista no tiene solución astrométrica (Paso 8: blindSolve)");
      var id = grDuplicate(viewId, "GC_MGC" + g + (borde ? "_borde" : ""));
      var v = View.viewById(id);
      if (!pxSPFC(o.spfc || {}).executeOn(v)) throw new Error("SPFC devolvió false");
      var mo = { mars: o.mars, gradientScale: g, showGradientModel: true };
      if (o.mgcOpts) for (var key in o.mgcOpts) mo[key] = o.mgcOpts[key];
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
      r.candidatos.push({ vista: id, modelo: mmod, metodo: "MGC", parametros: "SPFC + MGC gradientScale " + g + (borde ? ", corrección de bordes" : ""),
                          metricas: grMeasure(base, mmod, id, range0), ajuste_mars: ajusteMARS,
                          notas: "No neutraliza el color del fondo (GraXpert sí)." });
    } catch (e) {
      r.errores.push("MGC escala " + g + (borde ? " con bordes" : "") + ": " + e);
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

  // Segunda pasada (13 nov 2026, M31; Rafael: «el poly es el que menos señal se lleva pero deja manchas»): a cada
  // candidato que no se come el objeto pero deja manchas (manchas_color > GR_MANCHAS_LEVE) se le pasa encima GraXpert
  // (IA y sample_free 10), que limpia las manchas de gran escala; el resultado es otro candidato, medido contra el
  // original con el modelo total (original − final). segundaPasada: false para no hacerlo.
  if (o.segundaPasada !== false) {
    var primeros = r.candidatos.slice();
    primeros.forEach(function (c0) {
      var m0 = c0.metricas;
      if (!(m0.manchas_color > GR_MANCHAS_LEVE) || !(Math.abs(m0.come_objeto_pct) <= 3) || !(Math.abs(m0.gcStructCopy) < 0.3)) return;
      [{ ia: true, nombre: "GraXpert IA" }, { ia: false, s: 10, nombre: "GraXpert sample_free 10" }].forEach(function (sp) {
        try {
          before = grIds();
          var G2 = new GraXpert;
          G2.backgroundExtraction = true; G2.backgroundExtractionSampleFree = !sp.ia;
          if (!sp.ia) G2.sampleFreeScale = sp.s;
          G2.correction = "Subtraction"; G2.createBackground = true; G2.replaceImage = false;
          if (!G2.executeOn(View.viewById(c0.vista))) throw new Error("GraXpert devolvió false");
          var nv = grNew(before), c2 = null;
          for (var k2 = 0; k2 < nv.length; ++k2) {
            if (nv[k2].indexOf("background_extraction") >= 0) c2 = nv[k2];
            else { var wb = ImageWindow.windowById(nv[k2]); if (!wb.isNull) wb.forceClose(); }   // su modelo parcial
          }
          if (!c2) throw new Error("no encuentro la salida de GraXpert");
          c2 = grRename(c2, c0.vista + (sp.ia ? "_GXIA" : "_GX" + sp.s));
          try { ImageWindow.windowById(c2).keywords = win.keywords; } catch (e) { }
          // Modelo total = original − final (lo que se ha quitado entre las dos pasadas).
          var m2 = grFreeId(c2 + "_modelo"), PMt = new PixelMath;
          PMt.expression = "$T - " + c2; PMt.useSingleExpression = true; PMt.createNewImage = true; PMt.showNewImage = true;
          PMt.newImageId = m2; PMt.newImageWidth = 0; PMt.newImageHeight = 0; PMt.rescale = false; PMt.truncate = false;
          PMt.newImageSampleFormat = gcK(PixelMath, "f32");
          PMt.newImageColorSpace = nch >= 3 ? gcK(PixelMath, "RGB") : gcK(PixelMath, "Gray");
          if (!PMt.executeOn(win.mainView)) throw new Error("PixelMath del modelo total falló");
          r.candidatos.push({ vista: c2, modelo: m2, metodo: c0.metodo + " + " + sp.nombre,
                              parametros: c0.parametros + "; segunda pasada " + sp.nombre + " para quitar las manchas",
                              metricas: grMeasure(base, m2, c2, range0),
                              notas: "Segunda pasada sobre " + c0.vista + " (manchas_color " + m0.manchas_color + ")." });
        } catch (e) {
          r.errores.push("Segunda pasada " + sp.nombre + " sobre " + c0.vista + ": " + e);
        }
      });
    });
  }

  r.leyenda = "manchas_color / manchas_luminancia: manchas de gran escala del cielo (celdas de 128 px) en % del ruido por " +
              "píxel; ≤ " + GR_MANCHAS_LEVE + " limpio, hasta " + GR_MANCHAS_SE_VEN + " leve, más se ven al estirar (lo que un modelo sin " +
              "vista no puede ver en la miniatura). copia_objeto: cuánto se parece el modelo de fondo al objeto (cerca de 0 = modelo limpio; > 0,5 = se come el objeto; " +
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
  var safe = r.candidatos.filter(function (x) { return eat(x) <= 3 && absCorr(x) < 0.3; });
  // Entre los seguros, mejor uno cuyo cielo no se vea desnivelado al estirar (gradiente_visible ≤ 0,015), si lo hay.
  var noSeVe = safe.filter(function (x) { return vis(x) <= 0.015; });
  if (noSeVe.length) safe = noSeVe;
  // Y sin manchas: entre los seguros, los que dejan el cielo limpio (manchas_color ≤ leve); si ninguno, los que no
  // pasan de «se ven». El de menos manchas manda sobre el de menos gradiente cuando las del otro se verían.
  function manchas(x) { var m = x.metricas.manchas_color; return (m === null || m === undefined || !isFinite(m)) ? 0 : m; }
  var limpios = safe.filter(function (x) { return manchas(x) <= GR_MANCHAS_LEVE; });
  var leves = safe.filter(function (x) { return manchas(x) <= GR_MANCHAS_SE_VEN; });
  if (limpios.length) safe = limpios; else if (leves.length) safe = leves;
  var clean = r.candidatos.filter(function (x) { return absCorr(x) < 0.3; });
  var best = safe.length ? pick(safe, resid) : clean.length ? pick(clean, eat) : pick(r.candidatos, absCorr);
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
               (best.metricas.manchas_color !== null && best.metricas.manchas_color !== undefined ? "; manchas de color " + best.metricas.manchas_color +
                 (manchas(best) > GR_MANCHAS_SE_VEN ? " (se verán al estirar)" : manchas(best) > GR_MANCHAS_LEVE ? " (leves)" : " (cielo limpio)") : "") + ".";
    if (manchas(best) > GR_MANCHAS_SE_VEN)
      (r.no_cumple = r.no_cumple || []).push("El recomendado deja manchas de color en el cielo (" + best.metricas.manchas_color +
        " > " + GR_MANCHAS_SE_VEN + ") y ningún candidato seguro las quita: repetir gradienteCandidatos sobre " + best.vista +
        " (segunda pasada) o probar otras escalas ({ graxpert: [6, 12] }); no seguir con manchas que se verán al estirar.");
  } else {
    r.motivo = "Ningún candidato se pudo medir: ver errores.";
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
  // Se cierran los candidatos no recomendados y sus modelos (con la segunda pasada son ~20 vistas y los Qwen gastaban
  // 30–40 llamadas en cerrarlas una a una, M31 13 nov 2026). Sus medidas y miniaturas quedan en el resultado; para
  // aplicar otro, repetir con { dejarCandidatos: true }.
  if (!o.dejarCandidatos && r.recomendado) {
    var cerrados = 0;
    r.candidatos.forEach(function (c) {
      if (c.vista === r.recomendado) return;
      [c.vista, c.modelo].forEach(function (id) { if (!id) return; var w = ImageWindow.windowById(id); if (!w.isNull) { w.forceClose(); ++cerrados; } });
    });
    (r.intermedias || []).forEach(function (id) { var w = ImageWindow.windowById(id); if (!w.isNull) { w.forceClose(); ++cerrados; } });
    if (cerrados) r.nota_vistas = "Cerradas " + cerrados + " vistas de los demás candidatos y auxiliares; queda abierto el recomendado (" +
                                  r.recomendado + ") y su modelo. Para aplicar otro candidato: gradienteCandidatos(vista, { dejarCandidatos: true }).";
  }
  grPrevios.push(r);
  if (grPrevios.length > 1 && !o.noCompactar) grPrevios.forEach(function (g) { grCompactar(g, o); });
  return r;
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
  var best = g.candidatos.filter(function (c) { return c.vista === g.recomendado; })[0];
  // Tabla corta de la comparación (una fila por candidato): sin ella no se veía qué se había comparado (8 nov 2026).
  g.comparados = g.candidatos.map(function (c) {
    var m = c.metricas || {}, f = m.fondoResidual;
    var come = isFinite(m.come_objeto_pct) ? m.come_objeto_pct : null, corr = isFinite(m.gcStructCopy) ? m.gcStructCopy : null;
    return { metodo: c.metodo + " " + c.parametros, deja_gradiente_pct: isFinite(f) ? Math.round(100 * f) : null,
             gradiente_restante: isFinite(f) ? f : null, objeto_quitado_pct: come, copia_objeto: corr,
             gradiente_visible: isFinite(m.gradiente_visible) ? m.gradiente_visible : null,
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
