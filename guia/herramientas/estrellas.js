// estrellas.js — Preparación de la capa de estrellas para la recombinación (Paso 8 no lineal) en una sola
// llamada. PJSR, ECMAScript 5.
//
// Uso (en el nivel superior del script):
//   eval(File.readTextFile("<ruta de guia>/herramientas/estrellas.js"));
//   var r = prepararEstrellas("Stars_st", { nuevaVista: "Stars_v1" });
//   JSON.stringify(r);   // { vista, pasos: [...], antes: {...}, despues: {...}, control: {...} }
//
// Entrada: la capa de estrellas YA ESTIRADA (estirarEstrellas, Paso 8), sin la starless. estirarEstrellasCandidatos la llama sola.
// Opciones (por defecto, lo que dice la ficha):
//   limpieza   0.005   umbral de residuos de SXT: iif($T < limpieza, 0, $T)
//   suelo      true    punto negro por canal = mediana + 2·MAD, reescalando para no tocar los núcleos
//   saturacion true    curva de saturación [[0,0],[0.40,0.65],[0.70,0.90],[1,1]]
//   maximo     0.97    techo de los núcleos (control: < 0,98), con compresión suave por encima de 'rodilla'
//   rodilla    0.80    a partir de aquí se comprimen las luces hasta 'maximo' (sin recorte brusco)
//   halosMagenta false G = iif(min(R,B) > G, min(R,B), G)
//   atenuar    0       si > 0, multiplica por (1 − atenuar) las estrellas por encima de 0,02 (0,35 = −35 %)
// No usa erosión ni MorphologicalTransformation (hacen anillos). No toca la original.

function stK(C, name) {
  if (C[name] !== undefined) return C[name];
  if (C.prototype && C.prototype[name] !== undefined) return C.prototype[name];
  throw new Error("Constante no encontrada: " + name);
}

function stPM(view, exprs) {
  var P = new PixelMath;
  if (exprs.length === 1) { P.useSingleExpression = true; P.expression = exprs[0]; }
  else { P.useSingleExpression = false; P.expression = exprs[0]; P.expression1 = exprs[1]; P.expression2 = exprs[2]; }
  P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1;
  P.createNewImage = false;
  if (!P.executeOn(view)) throw new Error("PixelMath falló: " + exprs.join(" | "));
}

// Medidas por canal: mediana, MAD, máximo, píxeles >= 0,98 y p90 de los píxeles de estrella (> 0,005).
function stMeasure(view) {
  var im = view.image, W = im.width, H = im.height, buf = new Float32Array(W * H), out = [];
  for (var c = 0; c < im.numberOfChannels; ++c) {
    im.getSamples(buf, new Rect(0, 0, W, H), c);
    var st = [], hi = 0, mx = 0;
    for (var i = 0; i < buf.length; ++i) {
      var x = buf[i];
      if (x >= 0.98) ++hi;
      if (x > mx) mx = x;
      if (x > 0.005 && (i % 7) === 0) st.push(x);
    }
    st.sort(function (a, b) { return a - b; });
    im.selectedChannel = c;
    var med = im.median();
    out.push({ mediana: +med.toPrecision(4), MAD: +im.MAD(med).toPrecision(3), maximo: +mx.toFixed(4), pix_098: hi,
               p90_estrellas: st.length ? +st[Math.floor(0.9 * (st.length - 1))].toFixed(4) : null });
  }
  im.resetSelections();
  return out;
}

// Brillo total (suma de la luminancia, muestreada) y % de píxeles con luminancia > 0,02.
function stFlux(view) {
  var im = view.image, W = im.width, H = im.height, n = W * H, buf = new Float32Array(n), s = 0;
  for (var c = 0; c < im.numberOfChannels; ++c) { im.getSamples(buf, new Rect(0, 0, W, H), c); for (var i = 0; i < n; i += 3) s += buf[i]; }
  return s;
}

function stStarPct(view) {
  var im = view.image, W = im.width, H = im.height, n = W * H, buf = new Float32Array(n), L = new Float32Array(n), k = 0;
  for (var c = 0; c < im.numberOfChannels; ++c) { im.getSamples(buf, new Rect(0, 0, W, H), c); for (var i = 0; i < n; ++i) L[i] += buf[i] / im.numberOfChannels; }
  for (var j = 0; j < n; ++j) if (L[j] > 0.02) ++k;
  return +(100 * k / n).toFixed(2);
}

function prepararEstrellas(viewId, o) {
  if (viewId && typeof viewId === "object") viewId = (viewId.id !== undefined) ? viewId.id : (typeof viewId.vista === "string" ? viewId.vista : viewId);   // también vale la View o el resultado de otra función ({ vista: ... })
  o = o || {};
  var lim = (o.limpieza !== undefined) ? o.limpieza : 0.005;
  var maxT = o.maximo || 0.97, knee = o.rodilla || 0.80;
  var src = ImageWindow.windowById(viewId);
  if (src.isNull) throw new Error("No existe la vista " + viewId);
  var sim = src.mainView.image;
  if (sim.numberOfChannels !== 3) throw new Error("La capa de estrellas debe ser RGB");
  // 8 nov 2026: Qwen la pasó sobre la paleta saturada (nebulosa entera) y la recombinó encima: estrellas dobles. Una capa de
  // estrellas estirada tiene el fondo casi a 0; con mediana > 0,05 no es una capa de estrellas.
  sim.resetSelections();
  if (!o.forzar && sim.median() > 0.05)
    throw new Error(viewId + " no es una capa de estrellas (mediana " + sim.median().toFixed(3) + "; una capa de estrellas estirada tiene el fondo casi a 0): " +
                    "pasa la capa de estrellas RGB estirada (r.estrellas.vista de estirarCapas), nunca la starless, la paleta ni la imagen saturada");
  // Capa LINEAL (sin estirar): fondo ~1e-6 (una estirada lo tiene ~1e-3). Qwen pasó la «_stars» en vez de la «_stars_estiradas».
  var stMedMax = 0; for (var c0 = 0; c0 < 3; ++c0) { sim.selectedChannel = c0; stMedMax = Math.max(stMedMax, sim.median()); } sim.resetSelections();
  if (!o.forzar && stMedMax < 2e-5) {
    var cands = []; ["_estiradas", "_estirada", "_st", "_stretched"].forEach(function (suf) { if (!ImageWindow.windowById(viewId + suf).isNull) cands.push(viewId + suf); });
    throw new Error(viewId + " es la capa de estrellas LINEAL (sin estirar: mediana " + stMedMax.toExponential(1) + "). Pasa la estirada (r.estrellas.vista de estirarCapas)" +
                    (cands.length ? ": " + cands.join(" o ") : "; o mejor, estirarEstrellasCandidatos con esta capa lineal (Paso 8: la estira y saca los candidatos)"));
  }

  var id = (typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_prep");
  for (var n = 2; !ImageWindow.windowById(id).isNull; ++n) id = ((typeof o.nuevaVista === "string" && o.nuevaVista) || (viewId + "_prep")) + "_" + n;
  var w = new ImageWindow(sim.width, sim.height, 3, 32, true, true, id);
  w.mainView.beginProcess(); w.mainView.image.assign(sim); w.mainView.endProcess();
  if (src.hasAstrometricSolution) w.copyAstrometricSolution(src);
  w.show();
  var v = w.mainView, pasos = [], antes = stMeasure(v), flujo0 = stFlux(v), flujoQuitado = 0;

  // 1. Residuos de SXT. Si la limpieza se llevara más del 10 % del brillo de la capa, no son residuos sino estrellas
  // débiles (capa estirada poco): no se limpia y se avisa.
  if (lim > 0) {
    var tmp = new ImageWindow(sim.width, sim.height, 3, 32, true, true, "stTmpLimpieza");
    tmp.mainView.beginProcess(); tmp.mainView.image.assign(v.image); tmp.mainView.endProcess();
    stPM(tmp.mainView, ["iif($T < " + lim + ", 0, $T)"]);
    flujoQuitado = flujo0 > 0 ? 100 * (1 - stFlux(tmp.mainView) / flujo0) : 0;
    if (flujoQuitado > 10 && !o.forzarLimpieza && o.limpieza === undefined) {   // campo denso de estrellas débiles: umbral más bajo
      var lim2 = 0.002;
      tmp.mainView.beginProcess(); tmp.mainView.image.assign(v.image); tmp.mainView.endProcess();
      stPM(tmp.mainView, ["iif($T < " + lim2 + ", 0, $T)"]);
      var q2 = flujo0 > 0 ? 100 * (1 - stFlux(tmp.mainView) / flujo0) : 0;
      if (q2 <= 10) { pasos.push("limpieza < " + lim + " se llevaba el " + flujoQuitado.toFixed(1) + " %: se usa < " + lim2); lim = lim2; flujoQuitado = q2; }
    }
    if (flujoQuitado <= 10 || o.forzarLimpieza) {
      v.beginProcess(); v.image.assign(tmp.mainView.image); v.endProcess();
      pasos.push("limpieza < " + lim + " (quita el " + flujoQuitado.toFixed(1) + " % del brillo)");
    } else pasos.push("limpieza NO aplicada: se llevaría el " + flujoQuitado.toFixed(1) + " % del brillo (estrellas débiles, no residuos)");
    tmp.forceClose();
  }

  // 2. Suelo por canal (mediana + 2·MAD), reescalando para que los núcleos no cambien.
  if (o.suelo !== false) {
    var m = stMeasure(v), ex = [], floors = [];
    for (var c = 0; c < 3; ++c) {
      var f = m[c].mediana + 2 * m[c].MAD;
      floors.push(+f.toPrecision(3));
      ex.push(f > 0 ? "max(0, ($T - " + f + ") / (1 - " + f + "))" : "$T");
    }
    if (floors[0] > 0 || floors[1] > 0 || floors[2] > 0) { stPM(v, ex); pasos.push("suelo R/G/B " + floors.join(" / ")); }
    else pasos.push("suelo: no hace falta (fondo ya a 0)");
  }

  // 3. Halos magenta (opcional).
  if (o.halosMagenta) { stPM(v, ["$T", "iif(min($T[0], $T[2]) > $T, min($T[0], $T[2]), $T)", "$T"]); pasos.push("halos magenta"); }

  // 4. Color: curva de saturación de la ficha.
  if (o.saturacion !== false) {
    var C = new CurvesTransformation;
    C.S = [[0, 0], [0.40, 0.65], [0.70, 0.90], [1, 1]];
    C.St = stK(CurvesTransformation, "AkimaSubsplines");
    if (!C.executeOn(v)) throw new Error("Curva de saturación falló");
    pasos.push("saturación [[0,0],[0.40,0.65],[0.70,0.90],[1,1]]");
  }

  // 5. Atenuación (opcional), nunca erosión.
  if (o.atenuar && o.atenuar > 0) {
    stPM(v, ["iif($T > 0.02, $T * " + (1 - o.atenuar) + ", $T)"]);
    pasos.push("atenuación " + Math.round(100 * o.atenuar) + " %");
  }

  // 6. Techo de núcleos con compresión suave por encima de la rodilla (sin recorte brusco).
  stPM(v, ["iif($T > " + knee + ", " + knee + " + ($T - " + knee + ") * " + ((maxT - knee) / (1 - knee)) + ", $T)"]);
  pasos.push("luces comprimidas por encima de " + knee + " hasta " + maxT);

  var despues = stMeasure(v), ok = true, noCumple = [], pe = stStarPct(v);
  for (var k = 0; k < 3; ++k) if (despues[k].maximo >= 0.98 || despues[k].mediana > 0.001) ok = false;
  var p90 = Math.max(despues[0].p90_estrellas || 0, despues[1].p90_estrellas || 0, despues[2].p90_estrellas || 0);
  if (!ok) noCumple.push("fondo de la capa no está a cero o hay núcleos ≥ 0,98");
  var aviso = null;
  if (flujoQuitado > 10 && !o.forzarLimpieza)
    aviso = "limpieza no aplicada (se llevaría el " + flujoQuitado.toFixed(1) + " % del brillo: muchas estrellas débiles); el suelo por canal " +
            "ya deja el fondo a 0. Sólo en GALAXIAS: si no se usó tipo \"galaxia\" al estirar las estrellas, repetir estirarEstrellasCandidatos con él. En nebulosas, seguir";
  if (pe < 0.3)
    noCumple.push("capa de estrellas casi vacía: sólo el " + pe + " % de los píxeles pasa de 0,02. Galaxia: repetir estirarEstrellasCandidatos con " +
                  "{ tipo: \"galaxia\" }. Nebulosa: arcsinh con k 10000, o el candidato con estrellas más grandes; no recombinar así");
  if (pe > 10)
    noCumple.push("CAPA DE ESTRELLAS HINCHADA: el " + pe + " % de los píxeles pasa de 0,02 (límite 10 %): las estrellas taparán el objeto. " +
                  "Si viene de estrellas \"extraer\" en una NEBULOSA (el estirado de la nebulosa es enorme e hincha las estrellas), " +
                  "repetir estirarEstrellasCandidatos SIN tipo \"galaxia\" (arcsinh k 3000). El mismo estirado que la starless es sólo para galaxias");
  return {
    vista: id, original: viewId, pasos: pasos, antes: antes, despues: despues,
    limpieza_quita_pct: +flujoQuitado.toFixed(1), pix_estrella_pct: pe, aviso: aviso, no_cumple: noCumple,
    control: { medido: {
                 fondo_a_cero: despues.every(function (d) { return d.mediana <= 0.001; }),
                 maximo_menor_098: despues.every(function (d) { return d.maximo < 0.98; }),
                 p90_suficiente: p90 >= 0.08,
                 capa_con_estrellas: pe >= 0.3,
                 capa_no_hinchada: pe <= 10,
                 cumple_lo_medido: ok && noCumple.length === 0 },
               revisar_a_ojo: ["anillos de color alrededor de las estrellas brillantes (al 200–400 %)",
                               "halos residuales en zonas brillantes",
                               "manchas de residuos de SXT entre estrellas (verdes o moradas)"],
               nota: "El p90 (referencia 0,08–0,13 con starStretch; más alto con estrellas 'extraer') depende de cómo se estiró la capa en el " +
                     "Paso 8 (estirarEstrellasCandidatos); si la capa está casi vacía o débil, se arregla en el estirado, no aquí. pix_estrella_pct < 0,3 = casi sin estrellas " +
                     "(galaxia grande con Qwen, 7 nov 2026: la final se quedó sin estrellas); > 10 % = hinchada (nebulosa oscura con Qwen, 7 nov 2026: 19 % con 'extraer' en una nebulosa oscura, estrellas gordas que tapaban el polvo; Opus 1,8 % de estrellas en la final). Lo de revisar_a_ojo no lo mide esta función: no darlo por bueno." }
  };
}

// ---------------------------------------------------------------------------------------------------
// Paso 8 no lineal: estirado de la capa de estrellas y candidatos para elegir (Rafael, 11 nov 2026). El estirado de las
// estrellas ya no va en el Paso 1: se hace aquí, justo antes de recombinar, y se presentan tres candidatos:
//   1. recomendada: el estirado de la guía + prepararEstrellas. Galaxias (tipo "galaxia"): el mismo estirado que la
//      starless (estirarEstrellasExtraer, si el GHS al fallo dejó registro); resto: arcsinh que conserva el color, k 3000.
//   2. estrellas un 20 % más grandes y un 10 % más saturadas.
//   3. estrellas un 50 % más grandes y un 20 % más saturadas.
// "Más grandes" = el área de estrellas (píxeles con luminancia > 0,02, pix_estrella_pct) crece ×1,2 o ×1,5. No se dilata
// (deja anillos y formas de diamante, igual que la erosión): se suben las alas débiles de la capa estirada con un arcsinh
// que conserva el color, f = asinh(a·M) / (asinh(a)·M) con M = máx(R,G,B), y se busca 'a' por bisección.
// "Más saturadas" = c' = L + s·(c − L), L = media de los canales, s = 1,1 o 1,2, después de prepararEstrellas.
// Con starlessActual (la starless al final del Paso 7) cada candidato se combina por screen para la previa (imagen entera
// y recorte al 100 % en la zona con más estrellas) y para medir el aporte, que decide en el Paso 9 (≥ 2 %).
//   var r = estirarEstrellasCandidatos("Stars", { starless: "Starless_st", starlessActual: "Starless_nxt", tipo: "galaxia" });
// Opciones: starless (la starless estirada en el Paso 1: sólo para "extraer"), starlessLineal (si no está en el registro),
// starlessActual, tipo, metodo ("extraer" | "asinh" | "starstretch"), k, amount, variantes ([{ etiqueta, tamano, saturacion }]),
// preparar (opciones de prepararEstrellas), prefijo (ids), cerrar (true: cierra la capa estirada intermedia).
// Deja abiertas las vistas de los candidatos; el usuario elige y las demás se cierran con cerrarVista.

function stIdDe(x) { return (x && typeof x === "object") ? ((x.id !== undefined) ? x.id : (typeof x.vista === "string" ? x.vista : x)) : x; }
function stUnico(id) { var b = id; for (var n = 2; !ImageWindow.windowById(id).isNull; ++n) id = b + "_" + n; return id; }
function stAsinh(x) { return Math.log(x + Math.sqrt(x * x + 1)); }
function stFactorBoost(M, a, k0) { return M > 1e-9 ? stAsinh(a * M) / (k0 * M) : a / k0; }

// Canales, máximo y media por píxel de una capa.
function stLeer(view) {
  var im = view.image, W = im.width, H = im.height, n = W * H, R = new Rect(0, 0, W, H), nc = im.numberOfChannels, ch = [];
  var M = new Float32Array(n), L = new Float32Array(n);
  for (var c = 0; c < nc; ++c) {
    var b = new Float32Array(n); im.getSamples(b, R, c); ch.push(b);
    for (var i = 0; i < n; ++i) { if (b[i] > M[i]) M[i] = b[i]; L[i] += b[i] / nc; }
  }
  return { ch: ch, M: M, L: L, n: n, W: W, H: H, R: R };
}

function stArea(d, a, paso) {
  var k = 0, t = 0, k0 = a > 0 ? stAsinh(a) : 1;
  for (var i = 0; i < d.n; i += paso) { ++t; if ((a > 0 ? d.L[i] * stFactorBoost(d.M[i], a, k0) : d.L[i]) > 0.02) ++k; }
  return t ? k / t : 0;
}

// Agranda las estrellas de una capa estirada hasta que el área crece × factor. Devuelve { a, area_x, aviso }.
function stAgrandar(view, factor) {
  var d = stLeer(view), paso = Math.max(1, Math.ceil(d.n / 2e6)), A0 = stArea(d, 0, paso);
  if (A0 <= 0) return { a: 0, area_x: 1, aviso: "capa sin estrellas por encima de 0,02: no se puede agrandar" };
  var objetivo = factor * A0, lo = Math.log(0.01), hi = Math.log(1e5), aviso = null;
  if (stArea(d, Math.exp(hi), paso) < objetivo) { lo = hi; aviso = "no llega a ×" + factor + " ni con el máximo: se queda en el máximo"; }
  else for (var it = 0; it < 18; ++it) { var mid = (lo + hi) / 2; if (stArea(d, Math.exp(mid), paso) < objetivo) lo = mid; else hi = mid; }
  var a = Math.exp(aviso ? lo : hi), k0 = stAsinh(a), nc = d.ch.length;
  for (var i = 0; i < d.n; ++i) { var f = stFactorBoost(d.M[i], a, k0); for (var c = 0; c < nc; ++c) d.ch[c][i] = Math.min(1, d.ch[c][i] * f); }
  view.beginProcess();
  for (var c2 = 0; c2 < nc; ++c2) view.image.setSamples(d.ch[c2], d.R, c2);
  view.endProcess();
  return { a: +a.toPrecision(3), area_x: +(stArea(stLeer(view), 0, paso) / A0).toFixed(2), aviso: aviso };
}

// Saturación por mezcla con la media de los canales: c' = L + s·(c − L).
function stSaturarMezcla(view, s) {
  var L = "($T[0] + $T[1] + $T[2]) / 3";
  stPM(view, ["max(0, min(1, " + L + " + " + s + " * ($T - " + L + ")))"]);
}

// Croma mediana de los píxeles de estrella: (máx − mín) / máx con máx > 0,05.
function stCroma(view) {
  var d = stLeer(view), v = [];
  if (d.ch.length < 3) return 0;
  for (var i = 0; i < d.n; i += 3) if (d.M[i] > 0.05) v.push((d.M[i] - Math.min(d.ch[0][i], d.ch[1][i], d.ch[2][i])) / d.M[i]);
  if (!v.length) return 0;
  v.sort(function (p, q) { return p - q; });
  return v[v.length >> 1];
}

// Recorte de 800 px en la zona con más píxeles de estrella (bloques de 400 px).
function stRectEstrellas(view) {
  var d = stLeer(view), B = 400, best = -1, bx = 0, by = 0;
  for (var y0 = 0; y0 + B <= d.H; y0 += B) for (var x0 = 0; x0 + B <= d.W; x0 += B) {
    var k = 0; for (var y = y0; y < y0 + B; y += 2) for (var x = x0; x < x0 + B; x += 2) if (d.L[y * d.W + x] > 0.02) ++k;
    if (k > best) { best = k; bx = x0 + B / 2; by = y0 + B / 2; }
  }
  var h = Math.min(400, d.W >> 1, d.H >> 1), x1 = Math.max(0, Math.min(d.W - 2 * h, bx - h)), y1 = Math.max(0, Math.min(d.H - 2 * h, by - h));
  return [x1, y1, x1 + 2 * h, y1 + 2 * h];
}

function stPreviaRecorte(viewId, nombre, rect) {
  if (typeof PIASTROPILOT_PREVIAS !== "string" || !PIASTROPILOT_PREVIAS || typeof pprPrevia !== "function") return null;
  try {
    var f = PIASTROPILOT_PREVIAS + "/" + String(nombre).replace(/[^A-Za-z0-9_.-]+/g, "_") + ".jpg";
    return pprPrevia(viewId, { fichero: f, lado: 800, rect: rect, estirar: false }).fichero;
  } catch (e) { return null; }
}

// % de píxeles cuya luminancia sube más de 0,01 al recombinar (el aporte_estrellas_pct del Paso 9, en luminancia).
function stAporte(starlessId, combId) {
  var a = stLeer(View.viewById(starlessId)), b = stLeer(View.viewById(combId)), k = 0, t = 0;
  for (var i = 0; i < a.n; i += 2) { ++t; if (b.L[i] - a.L[i] > 0.01) ++k; }
  return t ? +(100 * k / t).toFixed(2) : 0;
}

function estirarEstrellasCandidatos(viewId, o) {
  viewId = stIdDe(viewId);
  o = o || {};
  var src = ImageWindow.windowById(viewId);
  if (src.isNull) throw new Error("No existe la vista " + viewId);
  var sim = src.mainView.image; sim.resetSelections();
  if (sim.numberOfChannels !== 3) throw new Error("La capa de estrellas debe ser RGB");
  if (sim.median() > 0.05) throw new Error(viewId + " no es una capa de estrellas LINEAL (mediana " + sim.median().toFixed(3) + "): pasa la capa de estrellas " +
                                           "lineal que salió de separarEstrellas (Paso 15 lineal), no la starless ni una capa ya estirada");
  if (typeof estirarEstrellas !== "function" && typeof PIASTROPILOT_GUIA === "string")
    try { eval.call(null, File.readTextFile(PIASTROPILOT_GUIA + "/herramientas/estirado.js")); } catch (e0) { }
  if (typeof estirarEstrellas !== "function") throw new Error("estirarEstrellas no está cargado (herramientas/estirado.js)");
  var t0 = Date.now(), tipo = String(o.tipo || "").toLowerCase();
  var tt = (typeof ES_TIPOS === "object" && ES_TIPOS[tipo]) || {};
  var metodo = String(o.metodo || (tt.estrellas === "extraer" ? "extraer" : "asinh")).toLowerCase();
  var satEst = (o.saturacionEstirado !== undefined) ? o.saturacionEstirado : (tt.saturacion || 1);
  var base = (typeof o.prefijo === "string" && o.prefijo) || (viewId + "_c"), est = null, avisos = [];
  var slSt = stIdDe(o.starless), slAct = stIdDe(o.starlessActual || o.starless);
  if (slAct && ImageWindow.windowById(slAct).isNull) { avisos.push("no existe la starless " + slAct + ": candidatos sin previa combinada ni aporte"); slAct = null; }

  // 1. Estirado recomendado.
  if (metodo === "extraer") {
    if (!slSt) avisos.push("el mismo estirado que la starless necesita { starless: <la starless estirada en el Paso 1> }: se usa arcsinh k 3000");
    else try {
      est = estirarEstrellasExtraer(stIdDe(o.starlessLineal) || null, viewId, slSt, { nuevaVista: stUnico(base + "_est"), saturacion: satEst });
      if (est.no_cumple && est.no_cumple.length) {   // capa hinchada: no es una galaxia o el estirado de la starless fue enorme
        avisos.push("mismo estirado que la starless descartado: " + est.no_cumple.join("; ") + ". Se usa arcsinh k 3000");
        var wh = ImageWindow.windowById(est.vista); if (!wh.isNull) wh.forceClose();
        est = null;
      }
    } catch (e1) { avisos.push("no se pudo repetir el estirado de la starless (" + (e1.message || e1) + "): se usa arcsinh k 3000"); est = null; }
  }
  if (!est) est = estirarEstrellas(viewId, { nuevaVista: stUnico(base + "_est"), k: o.k, amount: o.amount,
                                             metodo: metodo === "starstretch" ? "starstretch" : undefined, saturacion: satEst });
  var estV = View.viewById(est.vista), rect = stRectEstrellas(estV);

  // 2. Candidatos.
  var variantes = o.variantes || [
    { etiqueta: "recomendada", tamano: 1, saturacion: 1 },
    { etiqueta: "estrellas +20 % de tamaño y +10 % de saturación", tamano: 1.2, saturacion: 1.1 },
    { etiqueta: "estrellas +50 % de tamaño y +20 % de saturación", tamano: 1.5, saturacion: 1.2 }];
  var cands = [], ref = null;
  for (var i = 0; i < variantes.length; ++i) {
    var vr = variantes[i], c = { etiqueta: vr.etiqueta || ("candidato " + (i + 1)), tamano_pedido: vr.tamano || 1, saturacion_pedida: vr.saturacion || 1 };
    try {
      var tmpId = stUnico(base + "_tmp"), tmp = new ImageWindow(sim.width, sim.height, 3, 32, true, true, tmpId);
      tmp.mainView.beginProcess(); tmp.mainView.image.assign(estV.image); tmp.mainView.endProcess();
      if (c.tamano_pedido > 1) { var ag = stAgrandar(tmp.mainView, c.tamano_pedido); c.alas_a = ag.a; if (ag.aviso) c.aviso = ag.aviso; }
      var po = {}; if (o.preparar) for (var kp in o.preparar) po[kp] = o.preparar[kp];
      po.nuevaVista = stUnico(base + (i + 1));
      var prep = prepararEstrellas(tmpId, po);
      tmp.forceClose();
      var pv = View.viewById(prep.vista);
      if (src.hasAstrometricSolution) pv.window.copyAstrometricSolution(src);
      if (c.saturacion_pedida > 1) stSaturarMezcla(pv, c.saturacion_pedida);
      c.vista = prep.vista;
      c.pix_estrella_pct = stStarPct(pv);
      c.croma = +stCroma(pv).toFixed(3);
      c.no_cumple = prep.no_cumple || [];
      if (prep.aviso) c.aviso = (c.aviso ? c.aviso + "; " : "") + prep.aviso;
      if (!ref) ref = c;
      c.tamano_x = ref.pix_estrella_pct > 0 ? +(c.pix_estrella_pct / ref.pix_estrella_pct).toFixed(2) : null;
      c.saturacion_x = ref.croma > 0 ? +(c.croma / ref.croma).toFixed(2) : null;
      if (slAct && typeof screenStarsCombine === "function") {
        var cb = screenStarsCombine(slAct, prep.vista, { newId: base + "_prev" });
        try {
          c.aporte_estrellas_pct = stAporte(slAct, cb.created);
          c.previa = (typeof pxPrevia === "function") ? pxPrevia(cb.created, base + (i + 1) + "_final", { estirar: false }) : null;
          c.previa_recorte = stPreviaRecorte(cb.created, base + (i + 1) + "_100", rect);
        } finally { var wc = ImageWindow.windowById(cb.created); if (!wc.isNull) wc.forceClose(); }
      } else c.previa = (typeof pxPrevia === "function") ? pxPrevia(prep.vista, base + (i + 1), { estirar: false }) : null;
      c.resumen = "tamaño ×" + c.tamano_x + ", saturación ×" + c.saturacion_x + (c.aporte_estrellas_pct !== undefined ? ", aporte " + c.aporte_estrellas_pct + " %" : "");
    } catch (e2) { c.error = String(e2 && e2.message ? e2.message : e2); }
    c.recomendado = i === 0; c.elegido = i === 0;
    cands.push(c);
  }
  if (o.cerrar !== false) estV.window.forceClose();
  var noCumple = (cands[0] && cands[0].no_cumple) ? cands[0].no_cumple.slice() : [];
  cands.forEach(function (c) { if (c.aporte_estrellas_pct !== undefined && c.aporte_estrellas_pct < 2)
    c.no_cumple = (c.no_cumple || []).concat(["aporte " + c.aporte_estrellas_pct + " % < 2 %: con esta capa la final saldrá casi sin estrellas"]); });
  return {
    vista: cands[0] && cands[0].vista ? cands[0].vista : null, original: viewId,
    estirado: { metodo: est.metodo, k: est.k, amount: est.amount, saturacion: est.saturacion, p90_estrellas: est.p90_estrellas },
    candidatos: cands, recomendado: cands[0] ? cands[0].etiqueta : null, avisos: avisos, no_cumple: noCumple,
    recorte_previa: rect, segundos: Math.round((Date.now() - t0) / 1000),
    siguiente: "El usuario elige uno; recombinar con él (Paso 9: recombinarEstrellas(starless, <vista elegida>)) y cerrar los otros con cerrarVista.",
    control: {
      medido: { tamano_conseguido: cands.map(function (c) { return c.tamano_x; }), saturacion_conseguida: cands.map(function (c) { return c.saturacion_x; }) },
      revisar_a_ojo: ["en el recorte al 100 %: estrellas que tapan el objeto, anillos de color o halos", "estrellas débiles que desaparecen"],
      nota: "tamano_x = área de estrellas (píxeles > 0,02) frente a la recomendada, medida después de prepararEstrellas (el objetivo se busca " +
            "antes de prepararla, por eso puede quedar algo por debajo). saturacion_x = croma mediana de las estrellas frente a la recomendada. " +
            "Ningún candidato se elige solo: decide el usuario mirando las previas. Lo de revisar_a_ojo no lo mide esta función."
    }
  };
}
