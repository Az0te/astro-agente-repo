// ruido.js — NoiseXTerminator / MLDenoise y StarXTerminator con los controles de las fichas, en una sola llamada.
// PJSR, ECMAScript 5.
//
// Uso (en el nivel superior del script):
//   eval(File.readTextFile("<ruta de guia>/herramientas/ruido.js"));
//   // Paso 14 lineal (NXT suave antes de SXT):
//   var r = reducirRuido("MasterLight_bxt", { denoise: 0.50, detail: 0.15, iterations: 2, nuevaVista: "MasterLight_nxt" });
//   // Paso 15 lineal (separar estrellas y denoise principal de la starless):
//   var s = separarEstrellas("MasterLight_nxt", { nuevaVista: "Starless" });     // starless + estrellas, comprobado
//   var d = reducirRuido(s.starless, { metodo: "hibrido", modelo: "<.xmlm del perfil>", nuevaVista: "Starless_dn" });
//   // Paso 6 no lineal (denoise final suave sobre la starless estirada):
//   var f = reducirRuido("Starless_st", { denoise: 0.30, detail: 0.15, nuevaVista: "Starless_nxt" });
//
// reducirRuido(vista, opciones), sobre una copia:
//   metodo      "mascara" (NXT fuerte, lineal 0,80 / estirada 0,45, sólo donde hay poca señal; lo brillante queda igual)
//               | frecuencias: { hf, lf, hfColor, lfColor, escala } con metodo "nxt" (separación de color y de frecuencias)
//               | "nxt" (por defecto) | "hibrido" (MLDenoise + NXT 0,95: ML − suave(ML) + suave(NXT), caja de radio 3;
//               sólo mono y con modelo .xmlm; si no se puede, cae a NXT 0,95 y lo dice) | "ml" (MLDenoise solo, también
//               RGB; amount 1,0) | "tgv" (MultiscaleTGVDenoise de PixInsight 1.9.6; strength 0,5)
//   modelo      .xmlm de MLDenoise; si no se da, la primera ruta .xmlm de perfil.md
// Para comparar métodos y niveles y quedarse con el mejor: ruidoCandidatos (abajo).
//   denoise     NXT (0,50 por defecto); detail (0,15); iterations (2)
//   croma       si se da, separación de color: luminancia = denoise, croma = este valor (p. ej. 0,90 con lum 0,40)
// Medidas (las de las fichas): ruido del cielo antes/después (debe bajar 50–80 % en el denoise principal, poco en
// el suave, nunca a cero), contraste de las zonas débiles (no debe bajar más de ~5 %) y estructura en la imagen
// residual (antes − después): ~1–2 = sólo ruido; > 2 = se ha llevado señal (filamentos, bordes).

function rdLum(view) {
  var im = view.image, W = im.width, H = im.height, n = W * H, R = new Rect(0, 0, W, H), nc = im.numberOfChannels;
  var L = new Float32Array(n), b = new Float32Array(n);
  for (var c = 0; c < nc; ++c) { im.getSamples(b, R, c); for (var i = 0; i < n; ++i) L[i] += b[i] / nc; }
  return { L: L, W: W, H: H };
}

// Celdas de 32 px: mediana de cada una; cielo = 10 % más oscuras; zona débil = entre cielo + 3σ y cielo + 20σ.
function rdCells(a) {
  var S = 32, cells = [];
  for (var y0 = 0; y0 + S <= a.H; y0 += S)
    for (var x0 = 0; x0 + S <= a.W; x0 += S) {
      var v = [];
      for (var y = y0; y < y0 + S; y += 2) for (var x = x0; x < x0 + S; x += 2) v.push(a.L[y * a.W + x]);
      v.sort(function (p, q) { return p - q; });
      cells.push({ x: x0, y: y0, m: v[v.length >> 1] });
    }
  return cells;
}

function rdNoise(a, cells) {
  // σ del cielo como en la ficha: dispersión (MAD) de los píxeles respecto a la mediana de su celda, en las celdas del
  // cielo. Incluye todas las escalas hasta 32 px (no sólo el ruido píxel a píxel, que NXT borra casi entero).
  var dev = [];
  for (var q = 0; q < cells.length; ++q) {
    var c = cells[q];
    for (var y = c.y; y < c.y + 32; y += 2) for (var x = c.x; x < c.x + 32; x += 2) dev.push(Math.abs(a.L[y * a.W + x] - c.m));
  }
  dev.sort(function (p, q) { return p - q; });
  return 1.4826 * dev[dev.length >> 1];
}
// Contraste de la zona débil: dispersión (p90 − p10) de las medias de bloques de 8 px dentro de esas celdas.
function rdContrast(a, cells) {
  var m = [];
  for (var q = 0; q < cells.length; ++q) {
    var c = cells[q];
    for (var by = c.y; by < c.y + 32; by += 8)
      for (var bx = c.x; bx < c.x + 32; bx += 8) {
        var s = 0;
        for (var y = by; y < by + 8; ++y) for (var x = bx; x < bx + 8; ++x) s += a.L[y * a.W + x];
        m.push(s / 64);
      }
  }
  m.sort(function (p, q) { return p - q; });
  return m.length ? m[Math.floor(0.9 * (m.length - 1))] - m[Math.floor(0.1 * (m.length - 1))] : 0;
}

// Estructura de la residual: dispersión de las medias de bloques de 16 px frente a lo que daría ruido puro (σ/16).
function rdResidual(a, b) {
  var W = a.W, H = a.H, means = [], all = 0, all2 = 0, n = 0;
  for (var by = 0; by + 16 <= H; by += 16)
    for (var bx = 0; bx + 16 <= W; bx += 16) {
      var s = 0;
      for (var y = by; y < by + 16; ++y) for (var x = bx; x < bx + 16; ++x) {
        var d = a.L[y * W + x] - b.L[y * W + x]; s += d;
        if ((x & 3) === 0 && (y & 3) === 0) { all += d; all2 += d * d; ++n; }
      }
      means.push(s / 256);
    }
  var mu = all / n, sd = Math.sqrt(Math.max(0, all2 / n - mu * mu)), mm = 0, mm2 = 0;
  for (var i = 0; i < means.length; ++i) { mm += means[i]; mm2 += means[i] * means[i]; }
  mm /= means.length;
  var sdm = Math.sqrt(Math.max(0, mm2 / means.length - mm * mm));
  return sd > 0 ? sdm / (sd / 16) : 0;
}

// Moteado de color de gran escala: dispersión (MAD) entre las celdas del cielo de la mediana de R−G y B−G, en unidades
// del ruido del cielo de la luminancia. Antes del denoise el grano lo tapa (valor bajo); si tras el denoise pasa de ~1,
// las manchas de color de 100–300 px se ven más que el grano y salen al estirar (galaxia grande con NXT 0,95, Rafael 7 nov 2026).
function rdMoteado(view, sky, noise) {
  try {
    var im = view.image;
    if (im.numberOfChannels < 3 || !(noise > 0)) return null;
    var W = im.width, H = im.height, ch = [], comp = [[], []];
    for (var c = 0; c < 3; ++c) { var b = new Float32Array(W * H); im.getSamples(b, new Rect(0, 0, W, H), c); ch.push(b); }
    for (var q = 0; q < sky.length; ++q) {
      var cl = sky[q], rg = [], bg = [];
      for (var y = cl.y; y < cl.y + 32; y += 2) for (var x = cl.x; x < cl.x + 32; x += 2) {
        var i = y * W + x; rg.push(ch[0][i] - ch[1][i]); bg.push(ch[2][i] - ch[1][i]);
      }
      rg.sort(function (p, r) { return p - r; }); bg.sort(function (p, r) { return p - r; });
      comp[0].push(rg[rg.length >> 1]); comp[1].push(bg[bg.length >> 1]);
    }
    var mad = function (a) {
      var s = a.slice().sort(function (p, r) { return p - r; }), m = s[s.length >> 1];
      var d = s.map(function (v) { return Math.abs(v - m); }).sort(function (p, r) { return p - r; });
      return 1.4826 * d[d.length >> 1];
    };
    return +(Math.max(mad(comp[0]), mad(comp[1])) / noise).toFixed(2);
  } catch (e) { return null; }
}

function rdCambio(a, b) { return a === null || b === null || !(a > 0) ? null : +(100 * (b / a - 1)).toFixed(1); }

function rdQuality(before, after) {
  var a = rdLum(before), b = rdLum(after), cells = rdCells(a);
  var sorted = cells.filter(function (c0) { return c0.m > 1e-6; }).sort(function (p, q) { return p.m - q.m; });   // fuera bordes negros
  var sky = sorted.slice(0, Math.max(5, Math.floor(sorted.length * 0.10)));
  var na = rdNoise(a, sky), nb = rdNoise(b, sky), skyLevel = sky[sky.length >> 1].m;
  var faint = cells.filter(function (c) { return c.m > skyLevel + 3 * na && c.m < skyLevel + 20 * na; });
  if (faint.length < 20) faint = sorted.slice(Math.floor(sorted.length * 0.3), Math.floor(sorted.length * 0.6));
  var ca = rdContrast(a, faint), cb = rdContrast(b, faint);
  return { ruido_antes: +na.toPrecision(3), ruido_despues: +nb.toPrecision(3),
           ruido_baja_pct: +(100 * (1 - nb / na)).toFixed(1), ruido_rel: +(nb / na).toFixed(3),   // ruido_rel: nombre neutro de la guía
           contraste_zona_debil_pct: +(100 * (cb / ca - 1)).toFixed(1),
           residual_estructura: +rdResidual(a, b).toFixed(2), celdas_zona_debil: faint.length,
           moteado_color_antes: rdMoteado(before, sky, na), moteado_color_despues: rdMoteado(after, sky, nb),
           // Manchas de color en valor absoluto (las dos con el grano de ANTES): < 0 = el denoise las quita, > 0 = las crea.
           // moteado_color va en unidades del grano que queda y sube siempre que se quita grano aunque las manchas no cambien.
           manchas_color_cambio_pct: rdCambio(rdMoteado(before, sky, na), rdMoteado(after, sky, na)) };
}

function rdCopy(viewId, newId) {
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

// Pone el primer parámetro de la lista que exista en esta versión de NXT y lo anota en «hechos».
function rdSet(N, nombres, valor, hechos) {
  for (var i = 0; i < nombres.length; ++i)
    if (N[nombres[i]] !== undefined) { N[nombres[i]] = valor; hechos.push(nombres[i] + "=" + valor); return true; }
  return false;
}

// o.frecuencias = { hf, lf, hfColor, lfColor, escala }: separación de color y de frecuencias del manual de RC-Astro
// (NXT 2 / AI3): alta frecuencia = grano píxel a píxel; baja = manchas y ondulaciones. Valores de partida del manual:
// intensidad HF 0,80–0,90 y LF 0,50–0,70; color HF 0,90–1,0 y LF 1,0 («quita las manchas de color»). Devuelve los
// parámetros que se pudieron poner (los nombres cambian entre versiones de NXT).
function rdNXT(view, o) {
  var N = new NoiseXTerminator;
  var d = (o.denoise !== undefined) ? o.denoise : 0.50;
  if (o.frecuencias && o.frecuencias.hf !== undefined) d = o.frecuencias.hf;
  N.denoise = d; N.denoise_intensity = d;
  // 12 nov 2026 (Tarántula): con sólo denoise y denoise_intensity, NXT daba el mismo resultado con 0,1 y con 0,95. La
  // versión instalada guarda también la intensidad por frecuencia (denoise_intensity_high_freq / _low_freq,
  // denoise_high_freq / _low_freq) y la usa aunque la separación de frecuencias esté apagada: se ponen todas a d.
  rdSet(N, ["denoise_intensity_high_freq"], d, []); rdSet(N, ["denoise_intensity_low_freq"], d, []);
  rdSet(N, ["denoise_high_freq"], d, []); rdSet(N, ["denoise_low_freq"], d, []);
  N.detail = (o.detail !== undefined) ? o.detail : 0.15;
  N.iterations = o.iterations || 2;
  if (o.croma !== undefined) { N.enable_color_separation = true; N.denoise_color = o.croma; }
  else { N.enable_color_separation = false; N.denoise_color = d; }
  var hechos = null;
  if (o.frecuencias) {
    var f = o.frecuencias; hechos = ["denoise=" + d];
    N.enable_color_separation = true; N.denoise_color = f.hfColor; hechos.push("denoise_color=" + f.hfColor);
    // Nombres: los snake_case son los de la versión instalada en PCMesa (12 nov 2026); los camelCase, los que lee
    // pixinsight-mcp (aescaffre) de la tabla de cadenas del módulo de RC-Astro (otra versión). Se pone el que exista.
    rdSet(N, ["enable_frequency_separation", "enableFrequencySeparation"], true, hechos);
    rdSet(N, ["enable_color_separation", "enableColorSeparation"], true, hechos);
    rdSet(N, ["denoise_intensity_high_freq"], f.hf, hechos); rdSet(N, ["denoise_high_freq", "denoise_hf"], f.hf, hechos);
    rdSet(N, ["denoise_intensity_low_freq"], f.lf, hechos); rdSet(N, ["denoise_low_freq", "denoise_lf", "denoiseLf"], f.lf, hechos);
    rdSet(N, ["denoise_color_low_freq", "denoise_low_freq_color", "denoise_lf_color", "denoiseLfColor"], f.lfColor, hechos);
    rdSet(N, ["denoise_color_high_freq", "denoise_high_freq_color", "denoise_hf_color", "denoiseColor"], f.hfColor, hechos);
    rdSet(N, ["frequency_scale", "frequencyScale"], f.escala, hechos);
  }
  if (!N.executeOn(view)) throw new Error("NXT falló");
  return hechos;
}

// Máscara de «poca señal» (Jon Rista: reducir fuerte donde la relación señal/ruido es baja y proteger lo brillante):
// 1 en el cielo y la señal débil, 0 desde cielo + 20σ, con rampa desde cielo + 3σ, sobre la luminancia suavizada
// (caja de radio 4) y la máscara suavizada (radio 8) para que no haya escalones.
function rdMascaraSenal(view) {
  var a = rdLum(view), cells = rdCells(a), W = a.W, H = a.H, n = W * H;
  var srt = cells.filter(function (c) { return c.m > 1e-6; }).sort(function (p, q) { return p.m - q.m; });
  var sky = srt.slice(0, Math.max(5, Math.floor(srt.length * 0.10)));
  var sig = rdNoise(a, sky), cielo = sky[sky.length >> 1].m, lo = cielo + 3 * sig, hi = cielo + 20 * sig;
  var Ls = rdBox(a.L, W, H, 4), m = new Float32Array(n), cub = 0;
  for (var i = 0; i < n; ++i) { var t = (Ls[i] - lo) / Math.max(1e-9, hi - lo); m[i] = 1 - Math.min(1, Math.max(0, t)); }
  m = rdBox(m, W, H, 8);
  for (var j = 0; j < n; j += 7) if (m[j] > 0.5) ++cub;
  return { m: m, cobertura_pct: +(100 * cub / Math.ceil(n / 7)).toFixed(1) };
}

function rdBox(a, W, H, r) {
  var t = new Float32Array(W * H), o = new Float32Array(W * H), x, y, s, n, b;
  for (y = 0; y < H; y++) { s = 0; n = 0; b = y * W;
    for (x = 0; x < Math.min(r, W); x++) { s += a[b + x]; n++; }
    for (x = 0; x < W; x++) { if (x + r < W) { s += a[b + x + r]; n++; } if (x - r - 1 >= 0) { s -= a[b + x - r - 1]; n--; } t[b + x] = s / n; } }
  for (x = 0; x < W; x++) { s = 0; n = 0;
    for (y = 0; y < Math.min(r, H); y++) { s += t[y * W + x]; n++; }
    for (y = 0; y < H; y++) { if (y + r < H) { s += t[(y + r) * W + x]; n++; } if (y - r - 1 >= 0) { s -= t[(y - r - 1) * W + x]; n--; } o[y * W + x] = s / n; } }
  return o;
}

// Modelo .xmlm de MLDenoise: el de las opciones o, si no, la primera ruta .xmlm que aparezca en perfil.md (privado).
function rdModeloML(o) {
  var m = o && (o.modeloML || o.modelo);
  if (m && File.exists(m)) return m;
  try {
    var g = (typeof PIASTROPILOT_GUIA === "string") ? PIASTROPILOT_GUIA : null;
    if (g && File.exists(g + "/perfil.md")) {
      var x = /[A-Za-z]:[\\\/][^\s`"'<>|*?]*\.xmlm/.exec(File.readTextFile(g + "/perfil.md"));
      if (x && File.exists(x[0].replace(/\\/g, "/"))) return x[0].replace(/\\/g, "/");
    }
  } catch (e) { }
  return null;
}

function reducirRuido(viewId, o) {
  // Qwen pasó r.starless.vista (undefined) tras separarEstrellas (7 nov 2026): starless y estrellas son ids (texto).
  if (viewId === undefined || viewId === null || viewId === "") throw new Error("Falta la vista (undefined). separarEstrellas devuelve r.starless y r.estrellas como ids de texto: usa reducirRuido(r.starless, ...)");
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);   // también vale la View o el resultado de otra función ({ vista: ... })
  o = o || {};
  var src = View.viewById(viewId);
  if (!src || src.isNull) throw new Error("No existe la vista " + viewId);
  // 11 nov 2026: un modelo local pasó metodo "NXT" en mayúsculas; no casaba con ninguno, caía en la rama del híbrido sin
  // modelo (MLDenoise.modelPath vacío) y dejaba vistas temporales abiertas en cada intento.
  var metodo = String(o.metodo || "nxt").toLowerCase().replace(/[^a-z]/g, "");
  metodo = { noisex: "nxt", noisexterminator: "nxt", mldenoise: "ml", multiscaletgvdenoise: "tgv", tgvdenoise: "tgv",
             hybrid: "hibrido", mask: "mascara" }[metodo] || metodo;
  if (["nxt", "mascara", "ml", "tgv", "hibrido"].indexOf(metodo) < 0)
    throw new Error("metodo «" + o.metodo + "» no existe: usa \"nxt\", \"ml\", \"tgv\", \"mascara\" o \"hibrido\" (en minúsculas)");
  var aviso = null, t0 = Date.now();
  var mono = src.image.numberOfChannels === 1;
  if (metodo === "hibrido" && rdModeloML(o)) o.modelo = rdModeloML(o);
  // Híbrido (dosier IC 1396, 4 nov 2026): detalle fino de MLDenoise + lo grueso de NXT, canal a canal (también en RGB
  // desde el 9 nov; el moteado de color lo vigilan las medidas). Sólo sobre la starless: con estrellas deja puntos negros.
  if (metodo === "hibrido" && (typeof MLDenoise !== "function" || !o.modelo || !File.exists(o.modelo))) {
    aviso = "híbrido no disponible (" + (typeof MLDenoise !== "function" ?
            "MLDenoise no está instalado" : "falta el modelo .xmlm del perfil") + "): se usa NXT " + (mono ? "0,95" : "0,50");
    // RGB: 0,95 deja manchas de color (galaxia grande, 7 nov 2026) y 0,70 tras el NXT suave del Paso 14 subió el moteado
    // de 0,25 a 0,63 (nebulosa oscura, 7 nov 2026): 0,50.
    metodo = "nxt"; o.denoise = mono ? 0.95 : 0.50;
  }
  if (metodo === "ml" && !rdModeloML(o)) throw new Error("MLDenoise necesita un modelo .xmlm: pásalo en { modelo } o apunta su ruta en perfil.md");
  if (metodo === "tgv" && typeof MultiscaleTGVDenoise !== "function") throw new Error("MultiscaleTGVDenoise no está disponible (PixInsight 1.9.6 o posterior)");
  var w = rdCopy(viewId, (typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_dn")), v = w.mainView;
  var nxtHechos = null, mascaraInfo = null, linealIn = src.image.median() < 0.05;
  if (metodo === "nxt") {
    nxtHechos = rdNXT(v, o);
    if (o.frecuencias && !nxtHechos.some(function (h) { return /low_freq_color|color_low_freq|lf_color|LfColor/.test(h); }))
      aviso = (aviso ? aviso + "; " : "") + "esta versión de NXT no tiene croma de baja frecuencia: se aplicó sin ella (" + nxtHechos.join(", ") + ")";
  }
  else if (metodo === "mascara") {
    // NXT fuerte sólo donde hay poca señal; lo brillante (alta señal/ruido) se queda como estaba.
    var tmp = rdCopy(viewId, "rdTmpMK"), dMk = (o.denoise !== undefined) ? o.denoise : (linealIn ? 0.80 : 0.45);
    rdNXT(tmp.mainView, { denoise: dMk, detail: o.detail, iterations: o.iterations });
    var mk = rdMascaraSenal(src), Wm = src.image.width, Hm = src.image.height, Rm = new Rect(0, 0, Wm, Hm);
    var s0 = new Float32Array(Wm * Hm), s1 = new Float32Array(Wm * Hm);
    v.beginProcess();
    for (var cm = 0; cm < src.image.numberOfChannels; ++cm) {
      src.image.getSamples(s0, Rm, cm); tmp.mainView.image.getSamples(s1, Rm, cm);
      for (var im2 = 0; im2 < s0.length; ++im2) s0[im2] = s0[im2] * (1 - mk.m[im2]) + s1[im2] * mk.m[im2];
      v.image.setSamples(s0, Rm, cm);
    }
    v.endProcess();
    tmp.forceClose();
    mascaraInfo = { denoise: dMk, cobertura_pct: mk.cobertura_pct };
  }
  else if (metodo === "ml") {
    // MLDenoise solo (sin NXT): también en RGB. Lento: ~5 min en 22 MP (8 nov 2026).
    var M1 = new MLDenoise; M1.modelPath = rdModeloML(o); M1.amount = (o.amount !== undefined) ? o.amount : 1.0; M1.useCache = false;
    if (!M1.executeOn(v)) { w.forceClose(); throw new Error("MLDenoise falló"); }
  } else if (metodo === "tgv") {
    // MultiscaleTGVDenoise (PixInsight 1.9.6): modelo de ruido automático, por eso strength no tiene unidades.
    var T = new MultiscaleTGVDenoise;
    T.strength = (o.strength !== undefined) ? o.strength : 0.5;
    if (o.chrominance !== undefined) T.chrominance = o.chrominance;
    if (o.smoothness !== undefined) T.smoothness = o.smoothness;
    if (o.scales !== undefined) T.scales = o.scales;
    T.deepSky = (o.deepSky !== undefined) ? !!o.deepSky : src.image.median() < 0.05;   // modo cielo profundo sólo en lineal
    if (!T.executeOn(v)) { w.forceClose(); throw new Error("MultiscaleTGVDenoise falló"); }
  } else {
    var W = src.image.width, H = src.image.height, R = new Rect(0, 0, W, H);
    var ml = rdCopy(viewId, "rdTmpML"), nx = rdCopy(viewId, "rdTmpNX");
    try {   // si algo falla, no dejar las vistas temporales abiertas (se acumulaban en cada intento)
      var M = new MLDenoise; M.modelPath = String(o.modelo); M.amount = 1.0; M.useCache = false;
      if (!M.executeOn(ml.mainView)) throw new Error("MLDenoise falló");
      rdNXT(nx.mainView, { denoise: (o.denoiseGrueso !== undefined) ? o.denoiseGrueso : 0.95, detail: 0.15, iterations: 2 });
    } catch (eH) {
      ml.forceClose(); nx.forceClose(); w.forceClose();
      throw eH;
    }
    var m = new Float32Array(W * H), x = new Float32Array(W * H), out = new Float32Array(W * H);
    v.beginProcess();
    for (var ch = 0; ch < src.image.numberOfChannels; ++ch) {
      ml.mainView.image.getSamples(m, R, ch); nx.mainView.image.getSamples(x, R, ch);
      var bm = rdBox(m, W, H, 3), bx = rdBox(x, W, H, 3);
      for (var i = 0; i < out.length; ++i) out[i] = m[i] - bm[i] + bx[i];
      v.image.setSamples(out, R, ch);
    }
    v.endProcess();
    ml.forceClose(); nx.forceClose();
  }
  var q = rdQuality(src, v), noCumple = [];
  if (q.contraste_zona_debil_pct < -5) noCumple.push("el contraste de la zona débil baja " + (-q.contraste_zona_debil_pct) + " % (> 5 %): se ha llevado señal; bajar denoise");
  // residual_estructura es una proporción (bloques frente a ruido de la propia residual): NO baja al bajar denoise
  // (8 nov 2026, nebulosa que llena el campo: 2,59 con 0,50 y con 0,30) y Qwen se atascaba repitiendo. Sólo es fallo si
  // además se pierde contraste en la zona débil (> 3 %); si no, queda como aviso para mirarlo a ojo.
  if (q.residual_estructura > 2.0) {
    if (q.contraste_zona_debil_pct < -3)
      noCumple.push("la residual tiene estructura (" + q.residual_estructura + ") y el contraste de la zona débil baja " + (-q.contraste_zona_debil_pct) +
                    " %: se ha llevado filamentos o bordes; bajar denoise");
    else
      aviso = (aviso ? aviso + "; " : "") + "residual con algo de estructura (" + q.residual_estructura + ") pero el contraste se conserva (" +
              q.contraste_zona_debil_pct + " %): mirar a ojo la residual; NO repetir sólo por esta medida (es una proporción y no baja al bajar denoise)";
  }
  if (q.ruido_baja_pct > 95) noCumple.push("el ruido del cielo baja " + q.ruido_baja_pct + " %: fondo muerto, bajar denoise");
  var linealSrc = src.image.median() < 0.05;   // (src sin selección: rdQuality no la cambia)
  if (q.moteado_color_despues !== null && q.moteado_color_despues > 1.5) {
    if (linealSrc)
      noCumple.push("moteado de color " + q.moteado_color_despues + " (> 1,5): sin el grano se ven manchas de color grandes en el fondo y saldrán al " +
                    "estirar (galaxia grande OSC con NXT 0,95, 7 nov 2026); repetir sobre la MISMA entrada con menos denoise (0,50), no encadenar otro NXT");
    else
      noCumple.push("moteado de color " + q.moteado_color_despues + " (> 1,5) en la imagen estirada: MÁS NXT NO LO ARREGLA (lo sube: galaxia grande con Qwen, 7 nov " +
                    "2026, 1,45 → 2,03 con 0,30) ni tampoco SCNR. Quedarse con la entrada sin este NXT; las manchas vienen de la fase lineal " +
                    "(dominante o doble NXT lineal) o de saturar demasiado: bajar la saturación o volver al checkpoint. No hay otro límite que 1,5");
  }
  // Subida del moteado (14 nov 2026): moteado_color va en unidades del grano que queda, así que sube con CUALQUIER denoise
  // fuerte aunque las manchas no cambien (NXT 0,7 y la separación de frecuencias quedaban fuera por eso en una galaxia
  // grande). Es fallo si las manchas crecen de verdad (manchas_color_cambio_pct > 10) o si sube y además pasa de 1 (se verán).
  var subeMot = q.moteado_color_antes !== null && q.moteado_color_despues !== null && q.moteado_color_despues - q.moteado_color_antes > 0.3;
  if ((q.manchas_color_cambio_pct !== null && q.manchas_color_cambio_pct > 10) || (subeMot && q.moteado_color_despues > 1.0))
    noCumple.push("este denoise SUBE el moteado de color de " + q.moteado_color_antes + " a " + q.moteado_color_despues +
                  (q.manchas_color_cambio_pct !== null ? " (manchas " + (q.manchas_color_cambio_pct > 0 ? "+" : "") + q.manchas_color_cambio_pct + " %)" : "") + ": " +
                  (linealSrc ? "repetir sobre la misma entrada con menos denoise (0,50); si la entrada ya pasó por el NXT suave del Paso 14, " +
                               "basta con 0,50 o menos (galaxia grande, 7 nov 2026: 0,50 + 0,70 subió el moteado de 0,35 a 0,92)"
                             : "no aplicar este NXT"));
  return {
    vista: v.id, original: viewId,
    metodo: { nxt: o.frecuencias ? "NoiseXTerminator con separación de color y de frecuencias" : "NoiseXTerminator",
              mascara: "NoiseXTerminator sólo donde hay poca señal (máscara)", ml: "MLDenoise", tgv: "MultiscaleTGVDenoise" }[metodo] || "híbrido MLDenoise + NXT",
    parametros: metodo === "nxt" ? (o.frecuencias ? { frecuencias: o.frecuencias, aplicado: nxtHechos } :
                                  { denoise: (o.denoise !== undefined) ? o.denoise : 0.50, detail: (o.detail !== undefined) ? o.detail : 0.15,
                                    iterations: o.iterations || 2, croma: (o.croma !== undefined) ? o.croma : null }) :
                metodo === "mascara" ? { denoise: mascaraInfo.denoise, mascara_cobertura_pct: mascaraInfo.cobertura_pct,
                                         mascara: "1 en cielo y señal débil, 0 desde cielo + 20σ (rampa desde + 3σ), suavizada" } :
                metodo === "ml" ? { amount: (o.amount !== undefined) ? o.amount : 1.0 } :
                metodo === "tgv" ? { strength: (o.strength !== undefined) ? o.strength : 0.5 } : { modelo: o.modelo },
    aviso: aviso, segundos: Math.round((Date.now() - t0) / 1000), medidas: q, no_cumple: noCumple,
    control: {
      medido: { contraste_conservado: q.contraste_zona_debil_pct >= -5, residual_solo_ruido: q.residual_estructura <= 2.0,
                fondo_no_muerto: q.ruido_baja_pct <= 95 },
      revisar_a_ojo: ["aspecto de cera o plástico", "fondo moteado / piel de naranja (4–16 px)", "halos oscuros en estrellas (detail alto)",
                      "manchas de color grandes en el fondo (moteado_color_despues > 1: se verán al estirar)"],
      nota: "ruido_baja_pct: en el denoise principal (Paso 15) se espera 50–80 %; en las pasadas suaves (Pasos 14 y 6), poco. " +
            "residual_estructura ~1–2 = la imagen quitada es sólo ruido (el moteado de baja frecuencia la sube un poco). " +
            "moteado_color (RGB): manchas de color de gran escala del cielo en unidades del grano; por encima de ~1 se ven más que el grano " +
            "(orientativo, sin calibrar). Lo de revisar_a_ojo no lo mide esta función."
    }
  };
}

// Compara varios métodos y niveles de reducción de ruido sobre la MISMA entrada y se queda con el mejor que cumpla los
// controles (Rafael, 8 nov 2026: «queremos siempre que compare»; como mínimo NXT, MLDenoise y MultiscaleTGVDenoise).
//   ruidoCandidatos(vista, { metodos: ["nxt", "ml", "tgv"], niveles: [0.3, 0.5, 0.7], tgv: [0.5, 1.0], amount: 1.0,
//                            modelo: .xmlm, detail, iterations, principal: true, nuevaVista, cerrar })
// Por defecto: NXT a 0,30 / 0,50 / 0,70 (estirada 0,15 / 0,30 / 0,45), MLDenoise amount 1,0 (modelo de las opciones o
// de perfil.md; si no hay, se anota y se sigue) y MultiscaleTGVDenoise strength 0,5 y 1,0 (estirada: 0,25 y 0,5).
// MLDenoise es lento (~5 min en 22 MP): metodos: ["nxt", "tgv"] para no usarlo. Con principal: true (starless) se añade
// el híbrido ML fino + NXT grueso. Imágenes de más de 8 MP: se compara en un recorte de 2000 px (rdElegirRecorte) y
// sólo el ganador se aplica a la entera (recorte: false para comparar en la entera).
// Elección: entre los que cumplen (sin no_cumple), el que más baja el ruido sin pasar del 80 % (con principal: true,
// preferiblemente en 50–80 %); si ninguno cumple, el de menos avisos y, a igualdad, el más suave. La elegida queda como
// nuevaVista (<vista>_dn por defecto) y las demás se cierran (cerrar: false para conservarlas). La tabla de la
// comparación va en «comparados».
function ruidoCandidatos(viewId, o) {
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);
  o = o || {};
  var src = View.viewById(viewId);
  if (!src || src.isNull) throw new Error("No existe la vista " + viewId);
  var lineal = src.image.median() < 0.05, t0 = Date.now();
  var metodos = o.metodos || ["nxt", "frecuencias", "mascara", "ml", "tgv"], color = src.image.numberOfChannels >= 3;
  var pruebas = [];
  if (metodos.indexOf("nxt") >= 0)
    (o.niveles || (lineal ? [0.30, 0.50, 0.70] : [0.15, 0.30, 0.45])).forEach(function (d) {
      pruebas.push({ etiqueta: "NXT denoise " + d, op: { metodo: "nxt", denoise: d }, sufijo: "_nxt" + Math.round(100 * d) });
    });
  // NXT con separación de color y de frecuencias (manual de RC-Astro): la croma de baja frecuencia al 100 % ataca las
  // manchas de color grandes (moteado) que el NXT normal no quita. Sólo en color. Estirada: intensidad mucho más suave.
  if (metodos.indexOf("frecuencias") >= 0 && color) {
    var fr = lineal ? { hf: 0.85, lf: 0.60, hfColor: 0.95, lfColor: 1.0, escala: 5 } : { hf: 0.40, lf: 0.30, hfColor: 0.90, lfColor: 1.0, escala: 5 };
    pruebas.push({ etiqueta: "NXT frecuencias (int. " + fr.hf + "/" + fr.lf + ", color " + fr.hfColor + "/" + fr.lfColor + ")",
                   op: { metodo: "nxt", frecuencias: fr }, sufijo: "_nxtfrec" });
  }
  // NXT fuerte sólo donde hay poca señal (Jon Rista): protege lo brillante, que ya tiene buena relación señal/ruido.
  if (metodos.indexOf("mascara") >= 0)
    pruebas.push({ etiqueta: "NXT " + (lineal ? 0.80 : 0.45) + " sólo en zonas de poca señal (máscara)", op: { metodo: "mascara" }, sufijo: "_nxtmk" });
  if (metodos.indexOf("ml") >= 0) {
    var a = (o.amount !== undefined) ? o.amount : 1.0;
    pruebas.push({ etiqueta: "MLDenoise amount " + a, op: { metodo: "ml", amount: a }, sufijo: "_ml" });
  }
  if (metodos.indexOf("tgv") >= 0)
    (o.tgv || (lineal ? [0.5, 1.0] : [0.25, 0.5])).forEach(function (s) {
      pruebas.push({ etiqueta: "MultiscaleTGVDenoise strength " + s, op: { metodo: "tgv", strength: s }, sufijo: "_tgv" + Math.round(100 * s) });
    });
  // Híbrido ML fino + NXT grueso (el que ganó en el dosier de IC 1396): en el denoise principal de la starless
  // (principal: true) o si se pide en metodos. Nunca con estrellas.
  if (metodos.indexOf("hibrido") >= 0 || (o.principal && !o.metodos))
    pruebas.push({ etiqueta: "Híbrido MLDenoise fino + NXT 0.95 grueso", op: { metodo: "hibrido" }, sufijo: "_hib" });

  // Imagen grande: se compara en un recorte representativo y sólo el ganador se aplica a la imagen entera (MLDenoise
  // corre en CPU en Radeon: ~13 s por megapíxel; en 89 MP, ~20 min por candidato). recorte: false para comparar entera.
  var W0 = src.image.width, H0 = src.image.height, rec = null, base = viewId;
  if (o.recorte !== false && W0 * H0 > (o.recorteMP || 8) * 1e6) {
    rec = rdElegirRecorte(src, o.ladoRecorte || 2000);
    var wr = new ImageWindow(rec.width, rec.height, src.image.numberOfChannels, 32, true, src.image.isColor, viewId + "_rec");
    wr.mainView.beginProcess(); wr.mainView.image.assign(src.image, rec); wr.mainView.endProcess();
    base = wr.mainView.id;
  }
  var cands = [];
  pruebas.forEach(function (p, n) {
    var op = {};
    for (var k in o) if (["metodos", "niveles", "tgv", "nuevaVista", "cerrar", "principal", "recorte", "recorteMP", "ladoRecorte"].indexOf(k) < 0) op[k] = o[k];
    for (var k2 in p.op) op[k2] = p.op[k2];
    op.nuevaVista = base + p.sufijo;
    p.opCompleta = op;
    var t1 = Date.now();
    try {
      var rr = reducirRuido(base, op);
      cands.push({ etiqueta: p.etiqueta, orden: n, r: rr, op: p.opCompleta, segundos: Math.round((Date.now() - t1) / 1000),
                   previa: pxPrevia(rr.vista, "ruido_" + rr.vista) });
    }
    catch (e) { cands.push({ etiqueta: p.etiqueta, orden: n, error: String(e && e.message ? e.message : e) }); }
  });
  var ok = cands.filter(function (c) { return c.r && !c.r.no_cumple.length; }), best = null;
  // 12 nov 2026 (Tarántula): ganaba TGV 1,0 con residual_estructura 2,98 (residual_solo_ruido: false) frente a TGV 0,5 con
  // 1,98. Si algún candidato que cumple deja una residual de sólo ruido (≤ 2), se elige entre ésos.
  var soloRuido = ok.filter(function (c) { var re = c.r.medidas.residual_estructura; return re === null || re === undefined || re <= 2; });
  if (soloRuido.length) ok = soloRuido;
  function baja(c) { return c.r.medidas.ruido_baja_pct; }
  function mas(l) { return l.reduce(function (x, c) { return x === null || baja(c) > baja(x) ? c : x; }, null); }
  function menos(l) { return l.reduce(function (x, c) { return x === null || baja(c) < baja(x) ? c : x; }, null); }
  if (ok.length) {
    var enRango = ok.filter(function (c) { return baja(c) <= 80 && (!o.principal || baja(c) >= 50); });
    var hasta80 = ok.filter(function (c) { return baja(c) <= 80; });
    best = enRango.length ? mas(enRango) : hasta80.length ? mas(hasta80) : menos(ok);
  } else {
    best = cands.filter(function (c) { return c.r; }).reduce(function (x, c) {
      return x === null || c.r.no_cumple.length < x.r.no_cumple.length ||
             (c.r.no_cumple.length === x.r.no_cumple.length && baja(c) < baja(x)) ? c : x;
    }, null);
  }
  var comparados = cands.map(function (c) {
    if (!c.r) return { metodo: c.etiqueta, error: c.error, elegido: false };
    var m = c.r.medidas;
    return { metodo: c.etiqueta, ruido_rel: m.ruido_rel, ruido_baja_pct: m.ruido_baja_pct, contraste_zona_debil_pct: m.contraste_zona_debil_pct,
             residual_estructura: m.residual_estructura, moteado_color: m.moteado_color_despues,
             manchas_color_cambio_pct: m.manchas_color_cambio_pct,
             cumple: !c.r.no_cumple.length, no_cumple: c.r.no_cumple.length ? c.r.no_cumple : undefined, aviso: c.r.aviso || undefined,
             parametros: c.r.parametros && c.r.parametros.aplicado ? c.r.parametros.aplicado : undefined, segundos: c.segundos, elegido: c === best, previa: c.previa || undefined };
  });
  var nombre = (typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_dn"), vista = null, completa = null;
  cands.forEach(function (c) {
    if (!c.r) return;
    var w = ImageWindow.windowById(c.r.vista);
    if (w.isNull) return;
    if (c === best && !rec) {
      if (c.r.vista !== nombre) {
        var old = ImageWindow.windowById(nombre);
        if (!old.isNull) old.forceClose();
        w.mainView.id = nombre;
      }
      vista = w.mainView.id;
    } else if (o.cerrar !== false || rec) w.forceClose();
  });
  // Con recorte: el ganador se aplica ahora a la imagen entera y sus medidas son las de la imagen entera.
  if (rec) {
    var wr2 = ImageWindow.windowById(base); if (!wr2.isNull) wr2.forceClose();
    if (best) {
      var opF = {}; for (var kf in best.op) opF[kf] = best.op[kf];
      opF.nuevaVista = nombre;
      var old2 = ImageWindow.windowById(nombre); if (!old2.isNull) old2.forceClose();
      var tF = Date.now();
      completa = reducirRuido(viewId, opF);
      completa.segundos_imagen_entera = Math.round((Date.now() - tF) / 1000);
      vista = completa.vista;
    }
  }
  var fin = completa || (best ? best.r : null), avisoRec = null;
  // El moteado de color es de gran escala: un recorte no siempre lo ve (IC 1396, 9 nov 2026: 0,20 en el recorte y 0,77 en
  // la entera con MLDenoise). Si en la entera el ganador no cumple, se dice y se propone el siguiente que cumplía.
  if (completa && completa.no_cumple.length && !best.r.no_cumple.length) {
    var otros = ok.filter(function (c) { return c !== best; }).sort(function (a, b) { return baja(b) - baja(a); });
    avisoRec = "En el recorte cumplía, pero en la imagen entera no: " + completa.no_cumple.join("; ") +
               (otros.length ? ". Siguiente candidato que cumplía en el recorte: " + otros[0].etiqueta +
                " (repetir con metodos/niveles sólo de ese, o recorte: false para comparar en la imagen entera)." : ".");
  }
  return {
    vista: vista, original: viewId, comparados: comparados,
    comparado_en: rec ? { recorte: [rec.x0, rec.y0, rec.x1, rec.y1], nota: "candidatos medidos en un recorte de " + rec.width + "×" + rec.height +
                          " px (cielo y señal débil); el ganador se aplicó a la imagen entera" + (completa ? " en " + completa.segundos_imagen_entera + " s" : "") }
                      : "imagen entera",
    recomendado: best ? best.etiqueta : null,
    motivo: !best ? "Ningún candidato se pudo aplicar: ver comparados." :
            (best.r.no_cumple.length ? "Ningún candidato cumple los controles: se queda el de menos avisos y más suave (" + best.etiqueta + ")." :
             best.etiqueta + ": cumple los controles y baja el ruido un " + baja(best) + " %.") + (avisoRec ? " " + avisoRec : ""),
    medidas: fin ? fin.medidas : null, no_cumple: fin ? fin.no_cumple : ["ningún candidato se pudo aplicar"],
    segundos: Math.round((Date.now() - t0) / 1000),
    control: fin ? fin.control : undefined
  };
}

// Recorte representativo para comparar: el bloque de lado×lado con más contraste entre cielo y señal (mayor rango de
// medianas en sus cuatro cuartos), buscado en una rejilla de medio lado. Sin bordes vacíos (mediana > 0).
function rdElegirRecorte(view, lado) {
  var im = view.image, W = im.width, H = im.height, L = Math.min(lado, W, H), h = Math.max(64, Math.floor(L / 2));
  var nx = Math.floor(W / h), ny = Math.floor(H / h), med = [];
  for (var j = 0; j < ny; ++j) { med.push([]); for (var i = 0; i < nx; ++i) {
    im.selectedRect = new Rect(i * h, j * h, (i + 1) * h, (j + 1) * h);
    var s = 0; for (var c = 0; c < im.numberOfChannels; ++c) { im.selectedChannel = c; s += im.median(); }
    med[j].push(s / im.numberOfChannels);
  } }
  im.resetSelections();
  var best = null, bv = -1;
  for (var y = 0; y + 1 < ny; ++y) for (var x = 0; x + 1 < nx; ++x) {
    var q = [med[y][x], med[y][x + 1], med[y + 1][x], med[y + 1][x + 1]];
    if (Math.min.apply(null, q) <= 0) continue;
    var r = Math.max.apply(null, q) - Math.min.apply(null, q);
    if (r > bv) { bv = r; best = new Rect(x * h, y * h, x * h + 2 * h, y * h + 2 * h); }
  }
  return best || new Rect(Math.floor((W - L) / 2), Math.floor((H - L) / 2), Math.floor((W + L) / 2), Math.floor((H + L) / 2));
}

// StarXTerminator en lineal sobre una copia: starless + capa de estrellas, con las comprobaciones de la ficha.
function separarEstrellas(viewId, o) {
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);   // también vale la View o el resultado de otra función ({ vista: ... })
  o = o || {};
  var src = View.viewById(viewId);
  if (!src || src.isNull) throw new Error("No existe la vista " + viewId);
  src.image.resetSelections();
  var lineal = src.image.median() < 0.05;
  var w = rdCopy(viewId, (typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_starless")), v = w.mainView, t0 = Date.now();
  var before = []; ImageWindow.windows.forEach(function (x) { before.push(x.mainView.id); });
  var S = new StarXTerminator;
  S.stars = true; S.output_stars = true;
  S.unscreen = !lineal;            // lineal: suma exacta; no lineal: screen
  S.overlap = (o.overlap !== undefined) ? o.overlap : 0.20;
  if (!S.executeOn(v)) throw new Error("StarX falló");
  var starsId = null;
  ImageWindow.windows.forEach(function (x) { if (before.indexOf(x.mainView.id) < 0) starsId = x.mainView.id; });
  if (!starsId) throw new Error("No se encontró la capa de estrellas que crea StarX");
  if (typeof o.nuevasEstrellas === "string" && o.nuevasEstrellas && ImageWindow.windowById(o.nuevasEstrellas).isNull) {
    ImageWindow.windowById(starsId).mainView.id = o.nuevasEstrellas; starsId = o.nuevasEstrellas;
  }
  var seg = Math.round((Date.now() - t0) / 1000);
  // Comprobaciones: suma exacta (lineal) y que la capa de estrellas no se lleve estructura extensa.
  var a = rdLum(src), sl = rdLum(v), st = rdLum(View.viewById(starsId)), maxErr = 0, n = a.L.length;
  for (var i = 0; i < n; i += 3) {
    var rec = lineal ? sl.L[i] + st.L[i] : 1 - (1 - sl.L[i]) * (1 - st.L[i]);
    maxErr = Math.max(maxErr, Math.abs(rec - a.L[i]));
  }
  // Estructura extensa en la capa de estrellas: p20 de bloques de 32 px (entre estrellas la capa vale ~0; un filamento la levanta).
  var bm = [];
  for (var by = 0; by + 32 <= st.H; by += 32)
    for (var bx = 0; bx + 32 <= st.W; bx += 32) {
      var vv = [];
      for (var y = by; y < by + 32; y += 2) for (var x = bx; x < bx + 32; x += 2) vv.push(st.L[y * st.W + x]);
      vv.sort(function (p, q) { return p - q; });
      bm.push(vv[Math.floor(0.2 * (vv.length - 1))]);
    }
  bm.sort(function (p, q) { return p - q; });
  var slCells = rdCells(sl).map(function (c) { return c.m; }).sort(function (p, q) { return p - q; });
  var senal = slCells[Math.floor(0.9 * (slCells.length - 1))] - slCells[Math.floor(0.1 * (slCells.length - 1))];
  var ext = bm[Math.floor(0.99 * (bm.length - 1))], extPct = senal > 0 ? 100 * ext / senal : 0;
  var noCumple = [];
  if (lineal && maxErr > 1e-4) noCumple.push("starless + estrellas no reproduce el original (error máx " + maxErr.toExponential(2) + ")");
  // estructura_en_estrellas_pct es orientativa: en campos densos (Vía Láctea) el halo de estrellas débiles no resueltas
  // la sube sin que SXT se haya llevado nebulosa (nebulosa dual band, nov 2026: 19 %). No se usa como fallo; se revisa a ojo.
  return {
    starless: v.id, estrellas: starsId, original: viewId, lineal: lineal, overlap: S.overlap, segundos: seg,
    reconstruccion_error_max: +maxErr.toExponential(2), estructura_en_estrellas_pct: +extPct.toFixed(2), no_cumple: noCumple,
    control: {
      medido: { suma_exacta: !lineal || maxErr <= 1e-4 },
      revisar_a_ojo: ["diferencia original − starless (la capa de estrellas): sólo estrellas y halos, sin filamentos, polvo ni núcleos de galaxia (estructura_en_estrellas_pct alto lo sugiere, pero en campos densos es normal)",
                      "residuos de estrellas en la starless (manchas, agujeros)"],
      nota: "Siguiente: denoise principal sobre la starless con reducirRuido(starless, { metodo: 'hibrido', modelo }) " +
            "(mono) o NXT 0,70 (RGB; 0,95 deja manchas de color; 0,50 si la entrada ya pasó por el NXT suave del Paso 14). " +
            "Lo de revisar_a_ojo no lo mide esta función."
    }
  };
}
