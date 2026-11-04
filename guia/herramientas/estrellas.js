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

function prepararEstrellas(viewId, o) {
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
  var v = w.mainView, pasos = [], antes = stMeasure(v);

  // 1. Residuos de SXT.
  if (lim > 0) { stPM(v, ["iif($T < " + lim + ", 0, $T)"]); pasos.push("limpieza < " + lim); }

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

  var despues = stMeasure(v), ok = true;
  for (var k = 0; k < 3; ++k) if (despues[k].maximo >= 0.98 || despues[k].mediana > 0.001) ok = false;
  var p90 = Math.max(despues[0].p90_estrellas || 0, despues[1].p90_estrellas || 0, despues[2].p90_estrellas || 0);
  return {
    vista: id, original: viewId, pasos: pasos, antes: antes, despues: despues,
    control: { medido: {
                 fondo_a_cero: despues.every(function (d) { return d.mediana <= 0.001; }),
                 maximo_menor_098: despues.every(function (d) { return d.maximo < 0.98; }),
                 p90_cerca_de_025: p90 >= 0.15 && p90 <= 0.35,
                 cumple_lo_medido: ok },
               revisar_a_ojo: ["anillos de color alrededor de las estrellas brillantes (al 200–400 %)",
                               "halos residuales en zonas brillantes",
                               "manchas de residuos de SXT entre estrellas (verdes o moradas)"],
               nota: "El p90 (referencia 0,08–0,13 medido así) depende de cuánto se estiró la capa en el Paso 1; si queda muy por debajo, " +
                     "subir 'amount' de starStretch allí, no aquí. Lo de revisar_a_ojo no lo mide esta función: no darlo por bueno." }
  };
}
