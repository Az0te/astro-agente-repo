// bandaestrecha.js — Dual band y banda estrecha en una sola llamada, con sus controles. PJSR, ECMAScript 5.
//   desmezclarDualBand (Paso 7 lineal), medirContinuo y restarContinuo (Paso 16 lineal), previsualizarPaletas
//   (Paso 2 no lineal).
//
// Uso (en el nivel superior del script):
//   eval(File.readTextFile("<ruta de guia>/herramientas/bandaestrecha.js"));
//   var d = desmezclarDualBand("NB_lineal");                     // → Ha_raw y OIII_raw (gris), pedestales medidos
//     (S2O3 → SII_raw y OIII_raw; S2Hb → SII_raw y Hb_raw, según FILTER o { filtro }; d.lineas dice cuál es cuál)
//   var k = medirContinuo(d.ha, "RGB_spcc");                      // k por fotometría de apertura de estrellas (canal R)
//   var c = restarContinuo("Ha_starless", "RGB_starless", { k: k.k });   // Ha_CS = Hα − k·R − c
//   var p = previsualizarPaletas("Ha_st", "OIII_st", { carpeta: "<versión>/prev/paletas" });   // capas YA estiradas igual

function beId(v) { return (v && typeof v === "object" && v.id !== undefined) ? v.id : v; }

function beView(id) {
  var v = View.viewById(id);
  if (!v || v.isNull) throw new Error("No existe la vista " + id);
  return v;
}

function beUnique(id) {
  var out = id;
  for (var n = 2; !ImageWindow.windowById(out).isNull; ++n) out = id + "_" + n;
  return out;
}

// Mediana por canal en el 10 % de celdas de 64 px más oscuras (cielo) y en el 10 % más brillante en R (zona de Hα).
function beZones(view) {
  var im = view.image, W = im.width, H = im.height, S = 64, nc = im.numberOfChannels, b = new Float32Array(S * S), cells = [];
  for (var y0 = 0; y0 + S <= H; y0 += S)
    for (var x0 = 0; x0 + S <= W; x0 += S) {
      var R = new Rect(x0, y0, x0 + S, y0 + S), m = [];
      for (var c = 0; c < nc; ++c) {
        im.getSamples(b, R, c);
        var v = []; for (var i = 0; i < b.length; i += 8) v.push(b[i]);
        v.sort(function (p, q) { return p - q; });
        m.push(v[v.length >> 1]);
      }
      cells.push(m);
    }
  cells = cells.filter(function (c0) { return (c0[0] + (c0[1] || 0) + (c0[2] || 0)) > 1e-6; });   // fuera bordes negros
  var k = Math.max(5, Math.floor(cells.length * 0.10));
  var med = function (arr, ch) { var v = arr.map(function (x) { return x[ch]; }).sort(function (p, q) { return p - q; }); return v[v.length >> 1]; };
  var bySum = cells.slice().sort(function (a, b2) { return (a[0] + (a[1] || 0) + (a[2] || 0)) - (b2[0] + (b2[1] || 0) + (b2[2] || 0)); });
  var sky = bySum.slice(0, k), s = [], h = [], ch;
  for (ch = 0; ch < nc; ++ch) s.push(med(sky, ch));
  // Zona dominada por la raya roja: entre el 30 % de celdas con más exceso en R, las de mayor R/(G+B) sobre el cielo.
  // Antes eran sólo las más brillantes en R, que en una nebulosa dual band incluían estrellas y zonas mixtas (G/R 0,24 en vez de 0,14).
  var byR = cells.slice().sort(function (a, b2) { return b2[0] - a[0]; }).slice(0, Math.max(k, Math.floor(cells.length * 0.3)));
  if (nc >= 3) byR.sort(function (a, b2) {
    var ra = (a[0] - s[0]) / Math.max(1e-9, (a[1] - s[1]) + (a[2] - s[2])), rb = (b2[0] - s[0]) / Math.max(1e-9, (b2[1] - s[1]) + (b2[2] - s[2]));
    return rb - ra;
  });
  byR = byR.slice(0, k);
  for (ch = 0; ch < nc; ++ch) h.push(med(byR, ch));
  return { cielo: s, zona_r: h };
}

function bePM(view, expr, newId, gray) {
  var P = new PixelMath;
  P.useSingleExpression = true;
  P.expression = expr;
  P.createNewImage = true;
  P.newImageId = newId;
  if (gray) {
    P.newImageColorSpace = (PixelMath.Gray !== undefined) ? PixelMath.Gray : PixelMath.prototype.Gray;
    P.newImageSampleFormat = (PixelMath.f32 !== undefined) ? PixelMath.f32 : PixelMath.prototype.f32;
  }
  P.truncate = false;
  if (!P.executeOn(view)) throw new Error("PixelMath falló: " + newId);
  return View.viewById(newId);
}

// ---------------------------------------------------------------------------------------------------
// Paso 7: desmezcla del dual band Hα/OIII (Antlia HO 5 nm en IMX571; coeficientes de la ficha). Lineal, sin SPCC.
// Respuesta del IMX571 (R, G, B) a cada raya: tabla de la ficha del Paso 7.
var BE_QE = { Ha: [0.80, 0.11, 0.04], OIII: [0.04, 0.93, 0.50], SII: [0.74, 0.13, 0.05], Hb: [0.01, 0.67, 0.70] };

// Qué dos rayas deja pasar el filtro: o.filtro ("HaO3", "S2O3", "S2Hb") o, si no, la palabra clave FILTER.
function beFiltro(v, o) {
  var f = String(o.filtro || "");
  if (!f) { var k = v.window.keywords; for (var i = 0; i < k.length; ++i) if (k[i].name === "FILTER") f = String(k[i].value); }
  f = f.toUpperCase().replace(/[^A-Z0-9]/g, "");
  var s = /S2|SII/.test(f), hb = /HB|HBETA/.test(f), o3 = /O3|OIII/.test(f);
  if (s && hb) return ["SII", "Hb"];
  if (s && o3) return ["SII", "OIII"];
  return ["Ha", "OIII"];
}

// Mínimos cuadrados (ponderando G ×2 si se pide) de 3 ecuaciones con 2 incógnitas: filas de (MᵀWM)⁻¹MᵀW.
function beUnmixRows(a, b, wG) {
  var w = [1, wG, 1], s11 = 0, s12 = 0, s22 = 0, i;
  for (i = 0; i < 3; i++) { s11 += w[i] * a[i] * a[i]; s12 += w[i] * a[i] * b[i]; s22 += w[i] * b[i] * b[i]; }
  var d = s11 * s22 - s12 * s12, r1 = [], r2 = [];
  for (i = 0; i < 3; i++) { r1.push(+(w[i] * (s22 * a[i] - s12 * b[i]) / d).toFixed(4)); r2.push(+(w[i] * (s11 * b[i] - s12 * a[i]) / d).toFixed(4)); }
  return [r1, r2];
}

function desmezclarDualBand(viewId, o) {
  viewId = beId(viewId); o = o || {};
  var v = beView(viewId), im = v.image;
  if (im.numberOfChannels !== 3) throw new Error("Hace falta el master RGB del dual band");
  im.resetSelections();
  if (im.median() > 0.05) throw new Error("La imagen parece estirada: la desmezcla va en lineal y sin SPCC");
  var z = beZones(v), p = o.pedestales || z.cielo, lineas = beFiltro(v, o);
  var cHa, cO;
  if (lineas[0] === "Ha") {   // coeficientes de la ficha (iguales a los de la tabla QE)
    cHa = o.ponderarG ? [1.2565, -0.0330, -0.0391] : [1.2563, -0.0293, -0.0460];
    cO = o.ponderarG ? [-0.1425, 0.9430, 0.2574] : [-0.1378, 0.8370, 0.4542];
  } else {
    var u = beUnmixRows(BE_QE[lineas[0]], BE_QE[lineas[1]], o.ponderarG ? 2 : 1); cHa = u[0]; cO = u[1];
  }
  var lin = function (c) {
    return c[0] + "*($T[0]-" + p[0] + ") + " + c[1] + "*($T[1]-" + p[1] + ") + " + c[2] + "*($T[2]-" + p[2] + ")";
  };
  // Con varios dual band (HaO3 + S2O3 dan los dos OIII) los nombres llevan el filtro: SII_raw_S2O3, OIII_raw_S2O3,
  // SII_raw_S2Hb, Hb_raw_S2Hb. Hα/OIII sigue siendo Ha_raw y OIII_raw.
  var tag = lineas[0] === "Ha" ? "" : "_" + (lineas[1] === "Hb" ? "S2Hb" : "S2O3");
  var haId = beUnique(o.ha || (lineas[0] + "_raw" + tag)), oId = beUnique(o.oiii || (lineas[1] + "_raw" + tag));
  var ha = bePM(v, lin(cHa), haId, true), oi = bePM(v, lin(cO), oId, true);
  // Sobre-restas (negativos) antes de recortar a 0.
  var neg = function (view) {
    var x = view.image, n = x.width * x.height, b = new Float32Array(n), k = 0;
    x.getSamples(b, new Rect(0, 0, x.width, x.height), 0);
    for (var i = 0; i < n; i += 3) if (b[i] < -0.0005) ++k;
    return +(100 * k / (n / 3)).toFixed(3);
  };
  var nHa = neg(ha), nO = neg(oi);
  // Pedestal de salida: al restar el cielo, la mitad del ruido del fondo queda por debajo de 0 y recortarlo a 0 deja
  // medio cielo a cero (sesga el fondo, estropea el gradiente y el denoise, y parece una cuña sin datos: nebulosa dual band,
  // 6 nov 2026). Se suma la media de los pedestales de entrada (o.pedestalSalida para otro valor; 0 = el recorte de antes).
  var pedOut = o.pedestalSalida !== undefined ? o.pedestalSalida : (p[0] + p[1] + p[2]) / 3;
  [ha, oi].forEach(function (vv) {
    var P = new PixelMath; P.useSingleExpression = true; P.expression = "max($T + " + pedOut + ", 0)"; P.createNewImage = false;
    P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1; P.executeOn(vv);
    vv.window.show();
  });
  if (v.window.hasAstrometricSolution) { ha.window.copyAstrometricSolution(v.window); oi.window.copyAstrometricSolution(v.window); }
  var dr = z.zona_r, gR = (dr[1] - p[1]) / (dr[0] - p[0]), bR = (dr[2] - p[2]) / (dr[0] - p[0]);
  var q = BE_QE[lineas[0]], eG = q[1] / q[0], eB = q[2] / q[0];
  var noCumple = [];
  // Sólo con Hα: el SII es débil y la zona más roja suele ser OIII o continuo (nebulosa dual band S2O3 y S2Hb, 6 nov 2026: G/R 0,78
  // y 1,20), así que con SII el ratio es informativo y no se marca.
  if (lineas[0] === "Ha" && (Math.abs(gR - eG) > 0.08 || Math.abs(bR - eB) > 0.05))
    noCumple.push("ratios en la zona de " + lineas[0] + " G/R " + gR.toFixed(3) + " y B/R " + bR.toFixed(3) + " lejos de " +
                  eG.toFixed(2) + " y " + eB.toFixed(2) + ": el balance no es el bruto (¿SPCC, flats?) o hay continuo");
  if (nHa > 1 || nO > 1) noCumple.push("sobre-resta: " + nHa + " % de " + lineas[0] + " y " + nO + " % de " + lineas[1] + " por debajo de 0 antes de recortar");
  var vistas = {}; vistas[lineas[0]] = haId; vistas[lineas[1]] = oId;
  return {
    // ha / oiii: primera y segunda raya (con S2O3 son SII y OIII; con S2Hb, SII y Hβ); 'lineas' dice cuál es cuál.
    ha: haId, oiii: oId, lineas: vistas, filtro: lineas.join("+"), original: viewId,
    pedestales: p.map(function (x) { return +x.toPrecision(4); }), pedestal_salida: +pedOut.toPrecision(4),
    coeficientes: { primera: cHa, segunda: cO, ponderar_G: !!o.ponderarG },
    zona_roja: { raya: lineas[0], G_R: +gR.toFixed(3), B_R: +bR.toFixed(3), esperado: eG.toFixed(2) + " y " + eB.toFixed(2) },
    negativos_pct: { primera: nHa, segunda: nO }, no_cumple: noCumple,
    control: {
      medido: { ratios_de_la_zona_roja_ok: lineas[0] === "Ha" ? !noCumple.some(function (t) { return /ratios/.test(t); }) : "no aplica (SII)", sin_sobre_resta: nHa <= 1 && nO <= 1 },
      revisar_a_ojo: ["zonas negras por sobre-resta en la señal débil", "el OIII no debe ser continuo (compararlo con la R de la RGB)"],
      nota: "El modelo supone sólo rayas: el continuo (estrellas, reflexión) entra como Hα y OIII; restarlo en el Paso 16. Lo de revisar_a_ojo no lo mide esta función."
    }
  };
}

// ---------------------------------------------------------------------------------------------------
// Paso 16: k del continuo por fotometría de apertura (r ≤ 7, anillo 10–14) sobre estrellas no saturadas, con centroide
// del flujo. nb: banda estrecha CON estrellas (gris o canal 0); cont: banda ancha calibrada CON estrellas (canal 'canal').
function medirContinuo(nbId, contId, o) {
  nbId = beId(nbId); contId = beId(contId); o = o || {};
  var nb = beView(nbId), ct = beView(contId), ch = (o.canal !== undefined) ? o.canal : 0;
  if (ch !== 0 && ch !== 1 && ch !== 2)
    throw new Error("canal debe ser 0, 1 o 2 (no '" + ch + "'). El continuo sólo se mide con un master de BANDA ESTRECHA (Hα, OIII) " +
                    "frente a uno de banda ancha: con un solo master RGB/OSC el Paso 16 no aplica, sáltalo");
  var W = nb.image.width, H = nb.image.height;
  if (ct.image.width !== W || ct.image.height !== H) throw new Error("Las dos imágenes no tienen el mismo tamaño (registrarlas antes)");
  var n = W * H, N = new Float32Array(n), C = new Float32Array(n);
  nb.image.getSamples(N, new Rect(0, 0, W, H), 0); ct.image.getSamples(C, new Rect(0, 0, W, H), ch);
  // Estrellas en la banda ancha: máximos locales aislados, no saturados.
  var s = []; for (var i = 0; i < n; i += 13) s.push(C[i]);
  s.sort(function (a, b) { return a - b; });
  var med = s[s.length >> 1], d = []; for (var j = 0; j < s.length; j += 3) d.push(Math.abs(s[j] - med));
  d.sort(function (a, b) { return a - b; });
  var sig = 1.4826 * d[d.length >> 1], thr = med + 30 * sig, maxPeak = o.picoMax || 0.80, ratios = [], R0 = 7, R1 = 10, R2 = 14;
  for (var y = R2; y < H - R2 && ratios.length < (o.maxEstrellas || 3000); y += 2)
    for (var x = R2; x < W - R2; x += 2) {
      var k = y * W + x, pk = C[k];
      if (pk < thr || pk > maxPeak) continue;
      var isMax = true;
      for (var dy = -2; dy <= 2 && isMax; ++dy) for (var dx = -2; dx <= 2; ++dx) if ((dx || dy) && C[k + dy * W + dx] > pk) { isMax = false; break; }
      if (!isMax) continue;
      // centroide del flujo
      var sw = 0, sx = 0, sy = 0;
      for (var dy1 = -3; dy1 <= 3; ++dy1) for (var dx1 = -3; dx1 <= 3; ++dx1) { var w = C[k + dy1 * W + dx1] - med; if (w > 0) { sw += w; sx += w * dx1; sy += w * dy1; } }
      var cx = x + Math.round(sx / sw), cy = y + Math.round(sy / sw);
      if (cx < R2 || cy < R2 || cx >= W - R2 || cy >= H - R2) continue;
      var aN = 0, aC = 0, na = 0, bn = [], bc = [];
      for (var dy2 = -R2; dy2 <= R2; ++dy2)
        for (var dx2 = -R2; dx2 <= R2; ++dx2) {
          var r = Math.sqrt(dx2 * dx2 + dy2 * dy2), q = (cy + dy2) * W + cx + dx2;
          if (r <= R0) { aN += N[q]; aC += C[q]; ++na; }
          else if (r >= R1 && r <= R2) { bn.push(N[q]); bc.push(C[q]); }
        }
      bn.sort(function (a, b) { return a - b; }); bc.sort(function (a, b) { return a - b; });
      var fN = aN - na * bn[bn.length >> 1], fC = aC - na * bc[bc.length >> 1];
      if (fC > 0) ratios.push(fN / fC);
      x += R2;
    }
  if (ratios.length < 20) throw new Error("Pocas estrellas medidas (" + ratios.length + "): ¿las imágenes tienen estrellas y están registradas?");
  ratios.sort(function (a, b) { return a - b; });
  var kk = ratios[ratios.length >> 1], q1 = ratios[Math.floor(ratios.length * 0.25)], q3 = ratios[Math.floor(ratios.length * 0.75)];
  return { k: +kk.toFixed(4), estrellas: ratios.length, rango_intercuartil: [+q1.toFixed(4), +q3.toFixed(4)], canal_continuo: ch,
           control: { medido: { estrellas_suficientes: ratios.length >= 100 },
                      revisar_a_ojo: ["tras restar: residuos simétricos en las estrellas (estrellas positivas = k baja; agujeros = k alta)"],
                      nota: "Mediana de (N − fondo)/(C − fondo) en apertura r ≤ 7 px con anillo 10–14 px. Para OIII usar sólo G (canal 1)." } };
}

// Hα_CS = Hα − k·C − c sobre las capas SIN estrellas; c deja el cielo de la resta en el cielo del Hα (sin fondo negativo).
function restarContinuo(nbId, contId, o) {
  nbId = beId(nbId); contId = beId(contId); o = o || {};
  if (o.k === undefined) throw new Error("Falta k: medirlo antes con medirContinuo sobre las capas con estrellas");
  var nb = beView(nbId), ct = beView(contId), ch = (o.canal !== undefined) ? o.canal : 0;
  var zN = beZones(nb), zC = beZones(ct);
  var c = (o.c !== undefined) ? o.c : 0;   // por defecto sin desplazamiento; se informa del cielo resultante
  var id = beUnique(o.nuevaVista || (nbId + "_CS"));
  var r = bePM(nb, "$T - " + o.k + "*" + contId + "[" + ch + "] - " + c, id, false);
  var P = new PixelMath; P.useSingleExpression = true; P.expression = "$T"; P.createNewImage = false; P.truncate = false; P.executeOn(r);
  var x = r.image, n = x.width * x.height, b = new Float32Array(n), neg = 0;
  x.getSamples(b, new Rect(0, 0, x.width, x.height), 0);
  for (var i = 0; i < n; i += 3) if (b[i] < -0.001) ++neg;
  var zR = beZones(r), keep = (zN.zona_r[0] - zN.cielo[0]) > 0 ? (zR.zona_r[0] - zR.cielo[0]) / (zN.zona_r[0] - zN.cielo[0]) : null;
  var P2 = new PixelMath; P2.useSingleExpression = true; P2.expression = "max($T, 0)"; P2.createNewImage = false;
  P2.truncate = true; P2.truncateLower = 0; P2.truncateUpper = 1; P2.executeOn(r);
  r.window.show();
  if (nb.window.hasAstrometricSolution) r.window.copyAstrometricSolution(nb.window);
  var negPct = +(100 * neg / (n / 3)).toFixed(3), noCumple = [];
  if (negPct > 0.5) noCumple.push(negPct + " % de píxeles negativos antes de recortar: k o c demasiado altos, o zonas de continuo fuerte (enmascarar)");
  if (keep !== null && keep < 0.80) noCumple.push("la zona de emisión conserva sólo el " + Math.round(100 * keep) + " % del brillo: ¿k demasiado alta o el objeto es de reflexión?");
  return { vista: id, nb: nbId, continuo: contId + "[" + ch + "]", k: o.k, c: c, cielo_antes: +zN.cielo[0].toPrecision(4), cielo_despues: +zR.cielo[0].toPrecision(4),
           negativos_pct: negPct, emision_conservada_pct: keep === null ? null : Math.round(100 * keep), no_cumple: noCumple,
           control: { medido: { sin_fondo_negativo: negPct <= 0.5, emision_conservada: keep === null || keep >= 0.80 },
                      revisar_a_ojo: ["residuos simétricos alrededor de estrellas", "discos oscuros en zonas de continuo fuerte (enmascarar o cubrir con la estrella)"],
                      nota: "En nebulosa de emisión y reflexión el continuo sólo quitaba un 2–5 % al fantasma. Lo de revisar_a_ojo no lo mide esta función." } };
}

// ---------------------------------------------------------------------------------------------------
// Paso 2 no lineal: previews de paletas sin SII (dual band o H+O) a ~1200 px, desde capas YA estiradas con el mismo estirado.
function previsualizarPaletas(haId, oiiiId, o) {
  haId = beId(haId); oiiiId = beId(oiiiId); o = o || {};
  var ha = beView(haId), oi = beView(oiiiId);
  if (ha.image.width !== oi.image.width || ha.image.height !== oi.image.height) throw new Error("Hα y OIII no tienen el mismo tamaño");
  ha.image.resetSelections(); oi.image.resetSelections();
  // Sólo el Hα: con el mismo estirado, un OIII débil (o de reflexión) puede quedar con mediana baja.
  if (ha.image.median() < 0.02) throw new Error("El Hα parece lineal: estirar las dos capas antes con el mismo estirado");
  var lado = o.lado || 1200, f = Math.max(1, Math.round(Math.max(ha.image.width, ha.image.height) / lado));
  // Copias reducidas en gris con ids cortos para PixelMath.
  var small = function (src, id) {
    var im = src.image, old = ImageWindow.windowById(id); if (!old.isNull) old.forceClose();
    var w = new ImageWindow(im.width, im.height, 1, 32, true, false, id);
    w.mainView.beginProcess(); w.mainView.image.assign(im); w.mainView.endProcess();
    if (f > 1) { var I = new IntegerResample; I.zoomFactor = -f; I.executeOn(w.mainView); }
    return w;
  };
  var wH = small(ha, "bePalH"), wO = small(oi, "bePalO");
  var pal = [
    { n: "01_HOO_Soft", r: "bePalH", g: "0.6*bePalH + 0.4*bePalO", b: "bePalO" },
    { n: "02_HOO_Hard", r: "bePalH", g: "0.7*bePalH + 0.3*bePalO", b: "bePalO" },
    { n: "03_Foraxx_bicolor", r: "bePalH", g: "(bePalH*bePalO)^~(bePalH*bePalO)*bePalH + ~((bePalH*bePalO)^~(bePalH*bePalO))*bePalO", b: "bePalO" },
    { n: "04_HOO_NOVA", r: "bePalH", g: "0.15*bePalH + 0.90*min(bePalO, 0.85*bePalH)", b: "min(bePalO, 0.85*bePalH)" }
  ];
  var dir = null, out = [];
  if (o.carpeta) { dir = o.carpeta.replace(/\\/g, "/").replace(/\/$/, ""); if (!File.directoryExists(dir)) File.createDirectory(dir, true); }
  for (var i = 0; i < pal.length; ++i) {
    var p = pal[i], id = "bePal_" + p.n.replace(/^\d+_/, "");
    var old = ImageWindow.windowById(id); if (!old.isNull) old.forceClose();
    var P = new PixelMath;
    P.useSingleExpression = false; P.expression = p.r; P.expression1 = p.g; P.expression2 = p.b;
    P.createNewImage = true; P.newImageId = id;
    P.newImageColorSpace = (PixelMath.RGB !== undefined) ? PixelMath.RGB : PixelMath.prototype.RGB;
    P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1;
    if (!P.executeOn(wH.mainView)) throw new Error("Paleta " + p.n + " falló");
    var w = ImageWindow.windowById(id), e = { paleta: p.n, vista: id, formula: "R = " + p.r + "; G = " + p.g + "; B = " + p.b };
    if (dir) { var path = dir + "/" + p.n + ".jpg"; w.saveAs(path, false, false, false, false); e.jpg = path; }
    w.show(); out.push(e);
  }
  wH.forceClose(); wO.forceClose();
  return { previews: out, reduccion: f, carpeta: dir,
           control: { medido: { previews_creadas: out.length },
                      revisar_a_ojo: ["elegir con el usuario (pregunta de una palabra, con una recomendada)", "fondo teñido u OIII que inunda el campo de cian"],
                      nota: "Sin SII real: cualquier paleta con S sería pseudo-SHO. Con la elegida, aplicar la misma fórmula a resolución completa y las estrellas RGB en screen. Una paleta es una convención, no el color real." } };
}
