// estrellas.js — Preparación de la capa de estrellas para la recombinación (Paso 8 no lineal) en una sola
// llamada. PJSR, ECMAScript 5.
//
// Uso (en el nivel superior del script):
//   eval(File.readTextFile("<ruta de guia>/herramientas/estrellas.js"));
//   var r = prepararEstrellas("Stars_st", { nuevaVista: "Stars_v1" });
//   JSON.stringify(r);   // { vista, pasos: [...], antes: {...}, despues: {...}, control: {...} }
//
// Entrada: la capa de estrellas YA ESTIRADA (starStretch, Paso 1), sin la starless.
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

  var id = o.nuevaVista || (viewId + "_prep");
  for (var n = 2; !ImageWindow.windowById(id).isNull; ++n) id = (o.nuevaVista || (viewId + "_prep")) + "_" + n;
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
            "ya deja el fondo a 0. Sólo en GALAXIAS: si no se usó tipo \"galaxia\" en el Paso 1, volver a estirarCapas con él. En nebulosas, seguir";
  if (pe < 0.3)
    noCumple.push("capa de estrellas casi vacía: sólo el " + pe + " % de los píxeles pasa de 0,02. Galaxia: volver al Paso 1 con " +
                  "estirarCapas(..., { tipo: \"galaxia\" }). Nebulosa: volver al Paso 1 con amount 3 (mira p90_segun_amount); no recombinar así");
  if (pe > 10)
    noCumple.push("CAPA DE ESTRELLAS HINCHADA: el " + pe + " % de los píxeles pasa de 0,02 (límite 10 %): las estrellas taparán el objeto. " +
                  "Si viene de estrellas \"extraer\" en una NEBULOSA (el estirado de la nebulosa es enorme e hincha las estrellas), " +
                  "volver al Paso 1 con estirarCapas SIN estrellas \"extraer\" (starStretch, amount 2). \"extraer\" es sólo para galaxias");
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
                     "Paso 1; si la capa está casi vacía o débil, se arregla allí (estrellas: 'extraer'), no aquí. pix_estrella_pct < 0,3 = casi sin estrellas " +
                     "(galaxia grande con Qwen, 7 nov 2026: la final se quedó sin estrellas); > 10 % = hinchada (nebulosa oscura con Qwen, 7 nov 2026: 19 % con 'extraer' en una nebulosa oscura, estrellas gordas que tapaban el polvo; Opus 1,8 % de estrellas en la final). Lo de revisar_a_ojo no lo mide esta función: no darlo por bueno." }
  };
}
