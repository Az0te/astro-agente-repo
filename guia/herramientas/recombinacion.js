// recombinacion.js — Recombinación de starless y estrellas (Paso 9 no lineal) en una sola llamada, con sus controles.
// PJSR, ECMAScript 5.
//
// Uso (en el nivel superior del script):
//   eval(File.readTextFile("<ruta de guia>/herramientas/recombinacion.js"));
//   var r = recombinarEstrellas("Starless_st", "Stars_v1", { nuevaVista: "Final_v1" });
//   JSON.stringify(r);   // { vista, metodo, fondo, recorte, aporte_estrellas, control: { medido, revisar_a_ojo } }
//
// Las dos capas tienen que estar YA ESTIRADAS (nunca estrellas lineales sobre una starless estirada).
// Opciones:
//   metodo   "auto"   screenStarsCombine si existe (watcher v8: screen casi lineal y vuelta a estirar); si no, screen PixelMath
//            "screen"  PixelMath ~(~starless * ~(k*estrellas)), con fuerza k
//   k        1.0      fuerza de las estrellas en "screen" (0,5–0,6 para estrellas discretas en galaxias)
//   original ""       id de una imagen con estrellas del mismo estirado, para medir el residuo (original − final)
//   atenuar  0        0–0,8: baja las estrellas que caen sobre nebulosa brillante (máscara t² de la luminancia de la starless,
//                     t = (L − cielo)/(p99,5 − cielo)); fuerza el screen PixelMath. Vídeo de Seti Astro, 25 nov 2026: en
//                     SetiAstroPilot 0,5 dejó las estrellas de la nebulosa a la mitad de las del cielo oscuro sin perder ninguna.
// No toca las entradas.

function rcMedians(view) {
  var im = view.image, out = [];
  for (var c = 0; c < im.numberOfChannels; ++c) { im.selectedChannel = c; out.push(+im.median().toPrecision(4)); }
  im.resetSelections();
  return out;
}

// Percentiles de la luminancia (media de canales) sobre una muestra de ~250 000 píxeles.
function rcLumPct(view, pcts) {
  var im = view.image, W = im.width, H = im.height, nc = Math.min(im.numberOfChannels, 3);
  var paso = Math.max(1, Math.round(Math.sqrt(W * H / 250000))), row = new Float32Array(W), v = [];
  for (var y = 0; y < H; y += paso) {
    var acc = new Float32Array(W);
    for (var c = 0; c < nc; ++c) {
      im.getSamples(row, new Rect(0, y, W, y + 1), c);
      for (var x = 0; x < W; x += paso) acc[x] += row[x] / nc;
    }
    for (var x2 = 0; x2 < W; x2 += paso) v.push(acc[x2]);
  }
  v.sort(function (p, q) { return p - q; });
  return pcts.map(function (p) { return v[Math.min(v.length - 1, Math.floor(p / 100 * v.length))]; });
}

function rcCount(view, thr) {
  var im = view.image, W = im.width, H = im.height, buf = new Float32Array(W * H), out = [];
  for (var c = 0; c < im.numberOfChannels; ++c) {
    im.getSamples(buf, new Rect(0, 0, W, H), c);
    var n = 0;
    for (var i = 0; i < buf.length; ++i) if (buf[i] >= thr) ++n;
    out.push(n);
  }
  return out;
}

// Diferencia a − b por canal sobre una muestra: mínimo, mediana, MAD y % de píxeles con a < b − 1e-4.
function rcDiff(a, b) {
  var ia = a.image, ib = b.image, W = ia.width, H = ia.height, R = new Rect(0, 0, W, H);
  var ba = new Float32Array(W * H), bb = new Float32Array(W * H), out = [];
  for (var c = 0; c < ia.numberOfChannels; ++c) {
    ia.getSamples(ba, R, c); ib.getSamples(bb, R, Math.min(c, ib.numberOfChannels - 1));
    var d = [], mn = 1, below = 0, above = 0, n = 0;
    for (var i = 0; i < ba.length; i += 5) {
      var x = ba[i] - bb[i];
      if (x < mn) mn = x;
      if (x < -1e-4) ++below;
      if (x > 0.01) ++above;
      d.push(x); ++n;
    }
    d.sort(function (p, q) { return p - q; });
    var med = d[d.length >> 1], dev = [];
    for (var j = 0; j < d.length; j += 3) dev.push(Math.abs(d[j] - med));
    dev.sort(function (p, q) { return p - q; });
    out.push({ minimo: +mn.toFixed(5), mediana: +med.toPrecision(3), MAD: +dev[dev.length >> 1].toPrecision(3),
               pct_por_debajo: +(100 * below / n).toFixed(3), pct_sube_mas_de_001: +(100 * above / n).toFixed(2),
               p999: +d[Math.floor(0.999 * (d.length - 1))].toFixed(4), maximo: +d[d.length - 1].toFixed(4) });
  }
  return out;
}

function recombinarEstrellas(starlessId, starsId, o) {
  if (starlessId && typeof starlessId === "object") starlessId = (starlessId.id !== undefined) ? starlessId.id : (typeof starlessId.vista === "string" ? starlessId.vista : starlessId);   // también vale la View o el resultado de otra función ({ vista: ... })
  if (starsId && typeof starsId === "object") starsId = (starsId.id !== undefined) ? starsId.id : (typeof starsId.vista === "string" ? starsId.vista : starsId);   // también vale la View o el resultado de otra función ({ vista: ... })
  o = o || {};
  var sl = View.viewById(starlessId), st = View.viewById(starsId);
  if (!sl || sl.isNull) throw new Error("No existe la starless " + starlessId);
  if (!st || st.isNull) throw new Error("No existe la capa de estrellas " + starsId);
  if (sl.image.width !== st.image.width || sl.image.height !== st.image.height)
    throw new Error("Las dos capas no tienen el mismo tamaño");
  var medSl = rcMedians(sl), medSt = rcMedians(st);
  if (Math.max.apply(null, medSl) < 0.005)
    throw new Error("La starless parece lineal (mediana < 0,005): estirarla antes (Paso 1) o usar la suma en lineal");

  var base = (typeof o.nuevaVista === "string" && o.nuevaVista) || "Final", id = base;
  for (var n = 2; !ImageWindow.windowById(id).isNull; ++n) id = base + "_" + n;
  var metodo = o.metodo || "auto", k = (o.k !== undefined) ? o.k : 1.0, usado;
  var aten = +(o.atenuar || 0);
  if (aten < 0 || aten > 0.8) throw new Error("atenuar entre 0 y 0,8 (0 = todas las estrellas igual)");
  if (aten > 0) metodo = "screen";

  // Fuera del watcher v8 (p. ej. scripts ejecutados por PiAstroPilot) screenStarsCombine no existe: se carga realces.js
  // de la misma guía, que PiAstroPilot indica en la variable global PIASTROPILOT_GUIA.
  if (metodo === "auto" && typeof screenStarsCombine !== "function" && typeof PIASTROPILOT_GUIA === "string") {
    try { eval.call(null, File.readTextFile(PIASTROPILOT_GUIA + "/herramientas/realces.js")); } catch (e) { }
  }
  if (metodo === "auto" && typeof screenStarsCombine === "function") {
    var r = screenStarsCombine(starlessId, starsId, { newId: id });
    id = r.created;
    usado = "screenStarsCombine" + (r.reverseStretch ? " (screen casi lineal y vuelta a estirar)" : " (screen directo)");
  } else {
    var P = new PixelMath;
    P.useSingleExpression = true;
    if (aten > 0) {
      var pc = rcLumPct(sl, [5, 99.5]), cl = pc[0], hi = Math.max(pc[1], pc[0] + 1e-4);
      var Lx = sl.image.numberOfChannels >= 3 ? "($T[0]+$T[1]+$T[2])/3" : "$T";
      P.symbols = "k, a, c, h, t";
      P.expression = "k = " + k + "; a = " + aten + "; c = " + cl.toPrecision(5) + "; h = " + hi.toPrecision(5) + ";\n" +
                     "t = min(max((" + Lx + " - c)/(h - c), 0), 1);\n~(~$T * ~(k*(1 - a*t*t)*" + starsId + "))";
    } else {
      P.symbols = "k";
      P.expression = "k = " + k + ";\n~(~$T * ~(k*" + starsId + "))";
    }
    P.createNewImage = true; P.newImageId = id;
    P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1;
    if (!P.executeOn(sl)) throw new Error("Recombinación (PixelMath) falló");
    usado = "screen PixelMath, k = " + k + (aten > 0 ? ", estrellas atenuadas " + aten + " sobre la nebulosa brillante" : "") +
            (metodo === "auto" ? " (screenStarsCombine no está cargado)" : "");
  }
  var fin = View.viewById(id);
  var w = fin.window;
  if (sl.window.hasAstrometricSolution) w.copyAstrometricSolution(sl.window);

  var medFin = rcMedians(fin), dif = rcDiff(fin, sl), clipSl = rcCount(sl, 0.99), clipFin = rcCount(fin, 0.99);
  var nuncaBaja = dif.every(function (d) { return d.pct_por_debajo < 0.01; });
  var fondoSube = medFin.map(function (m, i) { return +(m - medSl[i]).toPrecision(3); });
  // Aporte de las estrellas: % de píxeles que suben más de 0,01 (el mayor de los canales). galaxia grande (7 nov 2026): con la capa de
  // starStretch amount 2 salió 0,14–0,19 % y la final se quedó casi sin estrellas; con la capa del mismo estirado (Opus v7)
  // la final tiene ~50 veces más estrellas detectables (aporte 5,9 %). Nebulosa oscura (7 nov 2026): starStretch amount 2 dio 0,8 %
  // y estrellas casi invisibles; el arcsinh k 3000 de Opus, 10 %. Umbral 2 % (sin calibrar con más casos).
  var aporte = Math.max.apply(null, dif.map(function (d) { return d.pct_sube_mas_de_001; })), noCumple = [];
  var recNuevo = clipFin.map(function (c, i) { return c - clipSl[i]; });
  if (!nuncaBaja) noCumple.push("el fondo baja respecto a la starless en algunos píxeles: las capas no son coherentes (el screen nunca oscurece)");
  // Subida del fondo (23 nov 2026, IC 405 con Qwen, pasada C1-d4: 14 vueltas prepararEstrellas → recombinarEstrellas con
  // «el fondo sube 0,0135» y la capa de estrellas con la mediana a 0 en los tres canales). En un campo denso, el screen de
  // miles de estrellas débiles mueve la mediana aunque la capa tenga el fondo a cero. Con la capa a cero (mediana ≤ 0,002)
  // el límite crece con el aporte: 0,01 + 0,002 · aporte_estrellas_pct, como mucho 0,03; con la capa sin fondo a cero
  // (halos, fondo levantado), 0,01 como siempre.
  var capaACero = medSt.every(function (m) { return m <= 0.002; });
  var limFondo = capaACero ? Math.min(0.03, 0.01 + 0.002 * aporte) : 0.01, avisos = [];
  if (fondoSube.some(function (s) { return Math.abs(s) >= limFondo; }))
    noCumple.push("el fondo sube " + fondoSube.join(" / ") + " (límite " + limFondo.toFixed(3) + "): " +
                  (capaACero ? "demasiado incluso para un campo denso; revisar halos en la capa de estrellas (Paso 8)" : "la capa de estrellas no tiene el fondo a cero; volver al Paso 8"));
  else if (fondoSube.some(function (s) { return Math.abs(s) >= 0.01; }))
    avisos.push("el fondo sube " + fondoSube.join(" / ") + " con la capa de estrellas a cero: normal en un campo denso (aporte " + aporte +
                " %, límite " + limFondo.toFixed(3) + "). No repetir prepararEstrellas por esto.");
  if (recNuevo.some(function (c) { return c > 0.00005 * fin.image.width * fin.image.height; })) noCumple.push("recorte nuevo de " + recNuevo.join(" / ") + " px a 0,99: bajar el máximo de la capa de estrellas o usar k < 1");
  if (aporte < 2)
    noCumple.push("LAS ESTRELLAS CASI NO APORTAN: sólo el " + aporte + " % de los píxeles sube más de 0,01 (umbral 2 %; bien procesadas, 6–10 %). La imagen " +
                  "final se verá casi sin estrellas. Volver al Paso 8 (estirarEstrellasCandidatos con la capa de estrellas LINEAL: arcsinh por defecto, sin amount; en galaxias, tipo \"galaxia\"), " +
                  "elegir un candidato con estrellas más grandes si hace falta y recombinar. Sólo es aceptable en un campo con muy pocas estrellas, y hay que decirlo");
  var res = {
    vista: id, starless: starlessId, estrellas: starsId, metodo: usado,
    fondo: { starless: medSl, estrellas: medSt, final: medFin, subida: fondoSube },
    recorte: { pix_099_starless: clipSl, pix_099_final: clipFin },
    aporte_estrellas: dif, aporte_estrellas_pct: aporte, no_cumple: noCumple, avisos: avisos, limite_subida_fondo: +limFondo.toFixed(3),
    control: {
      medido: {
        estrellas_aportan: aporte >= 2,
        nunca_baja_respecto_a_starless: nuncaBaja,
        fondo_casi_igual: fondoSube.every(function (s) { return Math.abs(s) < limFondo; }),
        sin_recorte_nuevo: clipFin.every(function (c, i) { return c <= clipSl[i]; }),
        recorte_nuevo_px: clipFin.map(function (c, i) { return c - clipSl[i]; }),
        recorte_nuevo_despreciable: clipFin.every(function (c, i) { return c - clipSl[i] <= 0.00005 * fin.image.width * fin.image.height; })
      },
      revisar_a_ojo: ["zoom 200–400 % en zonas brillantes: halos de combinación o bordes de residuos de SXT",
                      "agujeros oscuros alrededor de estrellas (starless mal extraída)",
                      "color de las estrellas equilibrado, sin estrellas demasiado grandes ni pérdida de las débiles"],
      nota: "Si nunca_baja es false hay un error en las capas (el screen nunca oscurece). Una subida de fondo > 0,01 con la capa de estrellas sin el fondo a cero indica " +
            "halos o fondo levantado: volver al Paso 8; con la capa a cero se admite hasta 0,01 + 0,002·aporte (máx. 0,03), normal en campos densos. recorte_nuevo_px son píxeles que llegan a 0,99 " +
            "sólo tras recombinar (núcleos de estrellas brillantes): unos pocos cientos son normales (despreciable = menos del " +
            "0,005 % de la imagen); muchos más, bajar el máximo de la capa de estrellas o usar k < 1. " +
            "Lo de revisar_a_ojo no lo mide esta función."
    }
  };
  if (o.original) {
    var ov = View.viewById(o.original);
    if (ov && !ov.isNull && ov.image.width === fin.image.width && ov.image.height === fin.image.height) {
      res.residuo_original_menos_final = rcDiff(ov, fin);
      res.control.nota += " Residuo original − final: mediana ≈ 0 y MAD del orden del ruido si el estirado es el mismo.";
    } else res.residuo_original_menos_final = "no medido: " + o.original + " no existe o no tiene el mismo tamaño";
  }
  return res;
}
