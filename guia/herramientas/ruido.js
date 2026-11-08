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
//   metodo      "nxt" (por defecto) | "hibrido" (MLDenoise + NXT 0,95: ML − suave(ML) + suave(NXT), caja de radio 3;
//               sólo mono y con modelo .xmlm; si no se puede, cae a NXT 0,95 y lo dice)
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

function rdQuality(before, after) {
  var a = rdLum(before), b = rdLum(after), cells = rdCells(a);
  var sorted = cells.filter(function (c0) { return c0.m > 1e-6; }).sort(function (p, q) { return p.m - q.m; });   // fuera bordes negros
  var sky = sorted.slice(0, Math.max(5, Math.floor(sorted.length * 0.10)));
  var na = rdNoise(a, sky), nb = rdNoise(b, sky), skyLevel = sky[sky.length >> 1].m;
  var faint = cells.filter(function (c) { return c.m > skyLevel + 3 * na && c.m < skyLevel + 20 * na; });
  if (faint.length < 20) faint = sorted.slice(Math.floor(sorted.length * 0.3), Math.floor(sorted.length * 0.6));
  var ca = rdContrast(a, faint), cb = rdContrast(b, faint);
  return { ruido_antes: +na.toPrecision(3), ruido_despues: +nb.toPrecision(3),
           ruido_baja_pct: +(100 * (1 - nb / na)).toFixed(1),
           contraste_zona_debil_pct: +(100 * (cb / ca - 1)).toFixed(1),
           residual_estructura: +rdResidual(a, b).toFixed(2), celdas_zona_debil: faint.length,
           moteado_color_antes: rdMoteado(before, sky, na), moteado_color_despues: rdMoteado(after, sky, nb) };
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

function rdNXT(view, o) {
  var N = new NoiseXTerminator;
  var d = (o.denoise !== undefined) ? o.denoise : 0.50;
  N.denoise = d; N.denoise_intensity = d;
  N.detail = (o.detail !== undefined) ? o.detail : 0.15;
  N.iterations = o.iterations || 2;
  if (o.croma !== undefined) { N.enable_color_separation = true; N.denoise_color = o.croma; }
  else { N.enable_color_separation = false; N.denoise_color = d; }
  if (!N.executeOn(view)) throw new Error("NXT falló");
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

function reducirRuido(viewId, o) {
  // Qwen pasó r.starless.vista (undefined) tras separarEstrellas (7 nov 2026): starless y estrellas son ids (texto).
  if (viewId === undefined || viewId === null || viewId === "") throw new Error("Falta la vista (undefined). separarEstrellas devuelve r.starless y r.estrellas como ids de texto: usa reducirRuido(r.starless, ...)");
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);   // también vale la View o el resultado de otra función ({ vista: ... })
  o = o || {};
  var src = View.viewById(viewId);
  if (!src || src.isNull) throw new Error("No existe la vista " + viewId);
  var metodo = o.metodo || "nxt", aviso = null, t0 = Date.now();
  var mono = src.image.numberOfChannels === 1;
  if (metodo === "hibrido" && (!mono || typeof MLDenoise !== "function" || !o.modelo || !File.exists(o.modelo))) {
    aviso = "híbrido no disponible (" + (!mono ? "imagen RGB: MLDenoise sólo mono" : typeof MLDenoise !== "function" ?
            "MLDenoise no está instalado" : "falta el modelo .xmlm del perfil") + "): se usa NXT " + (mono ? "0,95" : "0,50");
    // RGB: 0,95 deja manchas de color (galaxia grande, 7 nov 2026) y 0,70 tras el NXT suave del Paso 14 subió el moteado
    // de 0,25 a 0,63 (nebulosa oscura, 7 nov 2026): 0,50.
    metodo = "nxt"; o.denoise = mono ? 0.95 : 0.50;
  }
  var w = rdCopy(viewId, (typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_dn")), v = w.mainView;
  if (metodo === "nxt") rdNXT(v, o);
  else {
    var W = src.image.width, H = src.image.height, R = new Rect(0, 0, W, H);
    var ml = rdCopy(viewId, "rdTmpML"), nx = rdCopy(viewId, "rdTmpNX");
    var M = new MLDenoise; M.modelPath = o.modelo; M.amount = 1.0; M.useCache = false;
    if (!M.executeOn(ml.mainView)) throw new Error("MLDenoise falló");
    rdNXT(nx.mainView, { denoise: 0.95, detail: 0.15, iterations: 2 });
    var m = new Float32Array(W * H), x = new Float32Array(W * H), out = new Float32Array(W * H);
    ml.mainView.image.getSamples(m, R, 0); nx.mainView.image.getSamples(x, R, 0);
    var bm = rdBox(m, W, H, 3), bx = rdBox(x, W, H, 3);
    for (var i = 0; i < out.length; ++i) out[i] = m[i] - bm[i] + bx[i];
    v.beginProcess(); v.image.setSamples(out, R, 0); v.endProcess();
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
  if (q.moteado_color_antes !== null && q.moteado_color_despues !== null && q.moteado_color_despues - q.moteado_color_antes > 0.3)
    noCumple.push("este denoise SUBE el moteado de color de " + q.moteado_color_antes + " a " + q.moteado_color_despues + ": " +
                  (linealSrc ? "repetir sobre la misma entrada con menos denoise (0,50); si la entrada ya pasó por el NXT suave del Paso 14, " +
                               "basta con 0,50 o menos (galaxia grande, 7 nov 2026: 0,50 + 0,70 subió el moteado de 0,35 a 0,92)"
                             : "no aplicar este NXT"));
  return {
    vista: v.id, original: viewId, metodo: metodo === "nxt" ? "NoiseXTerminator" : "híbrido MLDenoise + NXT",
    parametros: metodo === "nxt" ? { denoise: (o.denoise !== undefined) ? o.denoise : 0.50, detail: (o.detail !== undefined) ? o.detail : 0.15,
                                    iterations: o.iterations || 2, croma: (o.croma !== undefined) ? o.croma : null } : { modelo: o.modelo },
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

// Compara varios niveles de denoise sobre la MISMA entrada y se queda con el mejor que cumpla los controles
// (Rafael, 8 nov 2026: «queremos siempre que compare para sacar los mejores resultados»).
//   ruidoCandidatos(vista, { niveles: [0.3, 0.5, 0.7], detail, iterations, principal: true, nuevaVista, cerrar })
// Niveles por defecto: lineal 0,30 / 0,50 / 0,70; estirada 0,15 / 0,30 / 0,45. Elección: entre los que cumplen
// (sin no_cumple), el que más baja el ruido sin pasar del 80 % (con principal: true, preferiblemente en 50–80 %);
// si ninguno cumple, el de menos avisos y menos denoise. La elegida queda como nuevaVista (<vista>_dn por defecto) y
// las demás se cierran (cerrar: false para conservarlas). Devuelve la tabla de la comparación en «comparados».
function ruidoCandidatos(viewId, o) {
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);
  o = o || {};
  var src = View.viewById(viewId);
  if (!src || src.isNull) throw new Error("No existe la vista " + viewId);
  var lineal = src.image.median() < 0.05, t0 = Date.now();
  var niveles = o.niveles || (lineal ? [0.30, 0.50, 0.70] : [0.15, 0.30, 0.45]);
  var cands = [];
  niveles.forEach(function (d) {
    var op = {};
    for (var k in o) if (k !== "niveles" && k !== "nuevaVista" && k !== "cerrar" && k !== "principal") op[k] = o[k];
    op.metodo = "nxt"; op.denoise = d; op.nuevaVista = viewId + "_dn" + Math.round(100 * d);
    try { cands.push({ denoise: d, r: reducirRuido(viewId, op) }); }
    catch (e) { cands.push({ denoise: d, error: String(e && e.message ? e.message : e) }); }
  });
  var ok = cands.filter(function (c) { return c.r && !c.r.no_cumple.length; }), best = null;
  function baja(c) { return c.r.medidas.ruido_baja_pct; }
  function mas(l) { return l.reduce(function (a, c) { return a === null || baja(c) > baja(a) ? c : a; }, null); }
  function menos(l) { return l.reduce(function (a, c) { return a === null || baja(c) < baja(a) ? c : a; }, null); }
  if (ok.length) {
    var enRango = ok.filter(function (c) { return baja(c) <= 80 && (!o.principal || baja(c) >= 50); });
    var hasta80 = ok.filter(function (c) { return baja(c) <= 80; });
    best = enRango.length ? mas(enRango) : hasta80.length ? mas(hasta80) : menos(ok);
  } else {
    var conR = cands.filter(function (c) { return c.r; });
    best = conR.reduce(function (a, c) {
      return a === null || c.r.no_cumple.length < a.r.no_cumple.length ||
             (c.r.no_cumple.length === a.r.no_cumple.length && c.denoise < a.denoise) ? c : a;
    }, null);
  }
  var comparados = cands.map(function (c) {
    if (!c.r) return { denoise: c.denoise, error: c.error, elegido: false };
    var m = c.r.medidas;
    return { denoise: c.denoise, ruido_baja_pct: m.ruido_baja_pct, contraste_zona_debil_pct: m.contraste_zona_debil_pct,
             residual_estructura: m.residual_estructura, moteado_color: m.moteado_color_despues,
             cumple: !c.r.no_cumple.length, elegido: c === best };
  });
  var nombre = (typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_dn"), vista = null;
  cands.forEach(function (c) {
    if (!c.r) return;
    var w = ImageWindow.windowById(c.r.vista);
    if (w.isNull) return;
    if (c === best) {
      if (c.r.vista !== nombre) {
        var old = ImageWindow.windowById(nombre);
        if (!old.isNull) old.forceClose();
        w.mainView.id = nombre;
      }
      vista = w.mainView.id;
    } else if (o.cerrar !== false) w.forceClose();
  });
  var r = {
    vista: vista, original: viewId, comparados: comparados,
    recomendado: best ? "denoise " + best.denoise : null,
    motivo: !best ? "Ningún nivel se pudo aplicar: ver comparados." :
            (best.r.no_cumple.length ? "Ningún nivel cumple los controles: se queda el de menos avisos y menos denoise (" + best.denoise + "). " :
             "Cumple los controles y baja el ruido un " + baja(best) + " % (" + best.denoise + "). ") +
            "Comparados: " + niveles.join(", ") + ".",
    medidas: best ? best.r.medidas : null, no_cumple: best ? best.r.no_cumple : ["ningún nivel se pudo aplicar"],
    segundos: Math.round((Date.now() - t0) / 1000),
    control: best ? best.r.control : undefined
  };
  return r;
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
