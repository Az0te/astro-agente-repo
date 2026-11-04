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
// No toca las entradas.

function rcMedians(view) {
  var im = view.image, out = [];
  for (var c = 0; c < im.numberOfChannels; ++c) { im.selectedChannel = c; out.push(+im.median().toPrecision(4)); }
  im.resetSelections();
  return out;
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
  o = o || {};
  var sl = View.viewById(starlessId), st = View.viewById(starsId);
  if (!sl || sl.isNull) throw new Error("No existe la starless " + starlessId);
  if (!st || st.isNull) throw new Error("No existe la capa de estrellas " + starsId);
  if (sl.image.width !== st.image.width || sl.image.height !== st.image.height)
    throw new Error("Las dos capas no tienen el mismo tamaño");
  var medSl = rcMedians(sl), medSt = rcMedians(st);
  if (Math.max.apply(null, medSl) < 0.005)
    throw new Error("La starless parece lineal (mediana < 0,005): estirarla antes (Paso 1) o usar la suma en lineal");

  var base = o.nuevaVista || "Final", id = base;
  for (var n = 2; !ImageWindow.windowById(id).isNull; ++n) id = base + "_" + n;
  var metodo = o.metodo || "auto", k = (o.k !== undefined) ? o.k : 1.0, usado;

  // Fuera del watcher v8 (p. ej. scripts ejecutados por PiCopilot) screenStarsCombine no existe: se carga realces.js
  // de la misma guía, que PiCopilot indica en la variable global PICOPILOT_GUIA.
  if (metodo === "auto" && typeof screenStarsCombine !== "function" && typeof PICOPILOT_GUIA === "string") {
    try { eval.call(null, File.readTextFile(PICOPILOT_GUIA + "/herramientas/realces.js")); } catch (e) { }
  }
  if (metodo === "auto" && typeof screenStarsCombine === "function") {
    var r = screenStarsCombine(starlessId, starsId, { newId: id });
    id = r.created;
    usado = "screenStarsCombine" + (r.reverseStretch ? " (screen casi lineal y vuelta a estirar)" : " (screen directo)");
  } else {
    var P = new PixelMath;
    P.useSingleExpression = true;
    P.symbols = "k";
    P.expression = "k = " + k + ";\n~(~$T * ~(k*" + starsId + "))";
    P.createNewImage = true; P.newImageId = id;
    P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1;
    if (!P.executeOn(sl)) throw new Error("Recombinación (PixelMath) falló");
    usado = "screen PixelMath, k = " + k + (metodo === "auto" ? " (screenStarsCombine no está cargado)" : "");
  }
  var fin = View.viewById(id);
  var w = fin.window;
  if (sl.window.hasAstrometricSolution) w.copyAstrometricSolution(sl.window);

  var medFin = rcMedians(fin), dif = rcDiff(fin, sl), clipSl = rcCount(sl, 0.99), clipFin = rcCount(fin, 0.99);
  var nuncaBaja = dif.every(function (d) { return d.pct_por_debajo < 0.01; });
  var fondoSube = medFin.map(function (m, i) { return +(m - medSl[i]).toPrecision(3); });
  var res = {
    vista: id, starless: starlessId, estrellas: starsId, metodo: usado,
    fondo: { starless: medSl, estrellas: medSt, final: medFin, subida: fondoSube },
    recorte: { pix_099_starless: clipSl, pix_099_final: clipFin },
    aporte_estrellas: dif,
    control: {
      medido: {
        nunca_baja_respecto_a_starless: nuncaBaja,
        fondo_casi_igual: fondoSube.every(function (s) { return Math.abs(s) < 0.01; }),
        sin_recorte_nuevo: clipFin.every(function (c, i) { return c <= clipSl[i]; }),
        recorte_nuevo_px: clipFin.map(function (c, i) { return c - clipSl[i]; }),
        recorte_nuevo_despreciable: clipFin.every(function (c, i) { return c - clipSl[i] <= 0.00005 * fin.image.width * fin.image.height; })
      },
      revisar_a_ojo: ["zoom 200–400 % en zonas brillantes: halos de combinación o bordes de residuos de SXT",
                      "agujeros oscuros alrededor de estrellas (starless mal extraída)",
                      "color de las estrellas equilibrado, sin estrellas demasiado grandes ni pérdida de las débiles"],
      nota: "Si nunca_baja es false hay un error en las capas (el screen nunca oscurece). Una subida de fondo > 0,01 indica " +
            "que la capa de estrellas no tiene el fondo a cero: volver al Paso 8. recorte_nuevo_px son píxeles que llegan a 0,99 " +
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
