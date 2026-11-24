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

// 8 nov 2026: con dos masters abiertos, Qwen desmezcló y corrigió el gradiente sin pasar por alinearMasters (Paso 5).
// Si la vista es un master abierto desde disco (tiene fichero y no es un _alin) y hay otro master así abierto, se para.
function beExigirAlineado(id, o) {
  if (o && (o.sinAlinear || o.alineados)) return;
  var w = ImageWindow.windowById(id);
  if (w.isNull || !w.filePath || /_alin/i.test(id + " " + w.filePath)) return;
  var otros = [], ws = ImageWindow.windows;
  for (var i = 0; i < ws.length; ++i) {
    var x = ws[i];
    if (x.mainView.id === id || !x.filePath || /_alin/i.test(x.mainView.id + " " + x.filePath)) continue;
    if (/\.(xisf|fits?|fts)$/i.test(x.filePath) && x.mainView.image.width > 1000) otros.push(x.mainView.id);
  }
  if (otros.length)
    throw new Error("Hay " + (otros.length + 1) + " masters abiertos sin alinear (" + [id].concat(otros).join(", ") + "). Primero el Paso 5: " +
                    "alinearMasters([\"" + [id].concat(otros).join("\", \"") + "\"]) y después todo sobre las vistas _alin que devuelve (r.vistas). " +
                    "Si ya salieron alineados y recortados del mismo WBPP y el usuario lo confirma, repetir con { sinAlinear: true }.");
}

function desmezclarDualBand(viewId, o) {
  viewId = beId(viewId); o = o || {};
  beExigirAlineado(viewId, o);
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
  // Cabecera del master con FILTER = la línea: combinarMasters reconoce así la vista aunque luego se llame GC_POLY2_3.
  [[ha, lineas[0]], [oi, lineas[1]]].forEach(function (x) {
    try {
      var ks = v.window.keywords.filter(function (k) { return k.name !== "FILTER"; });
      ks.push(new FITSKeyword("FILTER", "'" + x[1] + "'", "línea separada por desmezclarDualBand"));
      x[0].window.keywords = ks;
    } catch (e) { }
  });
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
// Guardas del Paso 16 (Rafael, 23 nov 2026). En la pasada C1-c de IC 405, Qwen midió k sobre las STARLESS (34 restos
// de estrellas: k = 3,14) y después se inventó k = 0,5. medirContinuo se niega con capas sin estrellas y pide ≥ 100
// estrellas; restarContinuo sólo acepta un k medido (registro en la carpeta temporal: el MCP arranca un script nuevo
// en cada llamada) salvo forzar.
function beSinEstrellas(v) {
  try { if (v.propertyValue("PiAstroPilot:SinEstrellas")) return true; } catch (e) { }
  try {
    if (typeof StarDetector === "undefined") return false;
    var D = new StarDetector, s = D.stars(v.image);
    return !s || s.length < 100;
  } catch (e) { return false; }
}
// Canal del continuo (23 nov 2026, IC 405 con Qwen, pasada C1-f: el OIII se midió y se restó con el R porque el modelo no
// pasó canal y el valor por defecto era 0). El OIII va con el G (el B lleva Hβ): si la raya es OIII (FILTER, la propiedad
// del filtro o «OIII»/«O3» en el id), canal 1 por defecto y se niega con canal 0 salvo forzar. El resto, R (canal 0).
function beEsOIII(v, id) {
  // El id manda: «OIII_raw_S2O3» es la capa OIII aunque venga de un S2O3; «Ha_raw» no lo es aunque el FILTER diga HaO3.
  var s = String(id || "");
  if (/(^|[^a-z])oiii/i.test(s)) return true;
  if (/^(ha|h_?alpha|sii|s2|hb|hbeta|l|r|g|b|rgb)([^a-z]|$)/i.test(s)) return false;
  // «O3» suelto en el id («O3_raw», «master_O3»), pero no un dual band («HaO3», «S2O3»: letra o cifra pegada delante).
  if (/(^|[^a-z0-9])o3([^a-z0-9]|$)/i.test(s)) return true;
  // Sin pista en el id: el filtro de la raya (no un dual band que lleve O3 junto a Hα o SII).
  var t = "";
  try { var k = v.window.keywords; for (var i = 0; i < k.length; ++i) if (k[i].name == "FILTER") t += " " + k[i].strippedValue; } catch (e) { }
  try { var f = v.propertyValue("Instrument:Filter:Name"); if (f) t += " " + f; } catch (e) { }
  return /(^|[^a-z])(oiii|o3)([^a-z]|$)/i.test(t) && !/(ha|h-?alpha|sii|s2)[^a-z]*o3|o3[^a-z]*(ha|sii|s2)/i.test(t);
}
// Canal como número o como texto («G», «verde», «1»…): un texto que no se entiende es un error, no el R.
function beNumCanal(c) {
  if (typeof c === "number" && (c === 0 || c === 1 || c === 2)) return c;
  var m = { "0": 0, r: 0, rojo: 0, red: 0, "1": 1, g: 1, verde: 1, green: 1, "2": 2, b: 2, azul: 2, blue: 2 }[String(c).trim().toLowerCase()];
  if (m === undefined) throw new Error("canal " + JSON.stringify(c) + " no se entiende: 0 (R), 1 (G) o 2 (B)");
  return m;
}
function beCanal(v, id, o) {
  var oiii = beEsOIII(v, id);
  if (o.canal === undefined || o.canal === null) return oiii ? 1 : 0;
  o.canal = beNumCanal(o.canal);
  if (oiii && o.canal === 0 && !o.forzar)
    throw new Error(id + " es OIII: el continuo del OIII se mide y se resta con el G (opciones.canal: 1), no con el R; el B lleva Hβ. " +
                    "Quita canal (por defecto ya es 1 con OIII) o pon canal: 1. opciones.forzar: true sólo si el usuario lo pide.");
  return o.canal;
}

function beOriginal(v) { try { var p = v.propertyValue("PiAstroPilot:Original"); return p ? String(p) : null; } catch (e) { return null; } }
function beRutaK() { return File.systemTempDirectory + "/piastropilot-continuo.json"; }
function beLeerK() { try { if (File.exists(beRutaK())) return JSON.parse(File.readTextFile(beRutaK())) || []; } catch (e) { } return []; }
function beGuardarK(e) {
  var l = beLeerK().filter(function (x) { return Date.now() - (x.t || 0) < 86400000; });
  l.push(e); if (l.length > 50) l = l.slice(l.length - 50);
  try { File.writeTextFile(beRutaK(), JSON.stringify(l)); } catch (x) { }
}
function beKMedido(k, canal) {
  var l = beLeerK(), ok = null;
  l.forEach(function (x) { if ((x.canal || 0) == (canal || 0) && Date.now() - (x.t || 0) < 86400000 && Math.abs(x.k - k) <= 0.0005 + 0.001 * Math.abs(x.k)) ok = x; });
  return ok;
}

// Paso 16: k del continuo por fotometría de apertura (r ≤ 7, anillo 10–14) sobre estrellas no saturadas, con centroide
// del flujo. nb: banda estrecha CON estrellas (gris o canal 0); cont: banda ancha calibrada CON estrellas (canal 'canal').
function medirContinuo(nbId, contId, o) {
  nbId = beId(nbId); contId = beId(contId); o = o || {};
  var nb = beView(nbId), ct = beView(contId), ch = beCanal(nb, nbId, o);
  if (ch !== 0 && ch !== 1 && ch !== 2)
    throw new Error("canal debe ser 0, 1 o 2 (no '" + ch + "'). El continuo sólo se mide con un master de BANDA ESTRECHA (Hα, OIII) " +
                    "frente a uno de banda ancha: con un solo master RGB/OSC el Paso 16 no aplica, sáltalo");
  if (!o.forzar) {
    var sinE = [nb, ct].filter(function (v) { return beSinEstrellas(v); });
    if (sinE.length)
      throw new Error("medirContinuo mide k en las ESTRELLAS: " + sinE.map(function (v) { var or = beOriginal(v);
        return v.id + " no tiene estrellas (usa la vista de antes de separarEstrellas" + (or ? ": " + or : "") + ")"; }).join("; ") +
        ". Pasa la raya y la RGB calibrada CON estrellas, alineadas; después separarEstrellas y restarContinuo sobre las starless con este k.");
  }
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
  // Qwen pasó la starless de la RGB (7 nov 2026): el continuo se mide en ESTRELLAS, hacen falta las dos con estrellas.
  if (ratios.length < 100) throw new Error("Pocas estrellas medidas (" + ratios.length + ", hacen falta 100): no hay k. El continuo se mide con las estrellas, así que las dos vistas " +
    "tienen que tenerlas (la raya y la RGB de ANTES de separarEstrellas, ya alineadas; nunca una starless)" +
    (/starless/i.test(nbId + contId) ? ". " + (/starless/i.test(contId) ? contId : nbId) + " es una starless: usa la vista anterior a separarEstrellas" : "") +
    ". Si el Hα ya se inyectó en la RGB (combinarMasters/inyectarHa), el Paso 16 no aplica: sáltalo.");
  ratios.sort(function (a, b) { return a - b; });
  var kk = ratios[ratios.length >> 1];
  beGuardarK({ k: +kk.toFixed(4), canal: ch, nb: nbId, continuo: contId, estrellas: ratios.length, t: Date.now() });
  var q1 = ratios[Math.floor(ratios.length * 0.25)], q3 = ratios[Math.floor(ratios.length * 0.75)];
  return { k: +kk.toFixed(4), estrellas: ratios.length, rango_intercuartil: [+q1.toFixed(4), +q3.toFixed(4)], canal_continuo: ch,
           control: { medido: { estrellas_suficientes: ratios.length >= 100 },
                      revisar_a_ojo: ["tras restar: residuos simétricos en las estrellas (estrellas positivas = k baja; agujeros = k alta)"],
                      nota: "Mediana de (N − fondo)/(C − fondo) en apertura r ≤ 7 px con anillo 10–14 px. Para OIII usar sólo G (canal 1)." } };
}

// Hα_CS = Hα − k·C − c sobre las capas SIN estrellas; c deja el cielo de la resta en el cielo del Hα (sin fondo negativo).
function restarContinuo(nbId, contId, o) {
  nbId = beId(nbId); contId = beId(contId); o = o || {};
  if (o.k === undefined) throw new Error("Falta k: medirlo antes con medirContinuo sobre las capas con estrellas");
  // Doble resta (pasada C1-e1, 23 nov 2026: Qwen restó el continuo al Hα con estrellas, separó estrellas y lo volvió a
  // restar sobre esa starless: le quedó ~84 % de la emisión y agujeros donde hay continuo).
  var nb = beView(nbId), ct = beView(contId);   // antes de la guarda: con «nb» sin asignar la marca no se leía (sólo valía el _CS del id)
  var yaCS = false;
  try { yaCS = !!nb.propertyValue("PiAstroPilot:ContinuoRestado"); } catch (e) { }
  if (!yaCS && /_CS(_|\d|$)/.test(String(nbId))) yaCS = true;
  if (yaCS && !o.forzar)
    throw new Error(nbId + " ya tiene el continuo restado (viene de restarContinuo): no se resta dos veces. Si le falta la separación " +
      "de estrellas, separarEstrellas sobre ella y pasa su starless a inyectarHa; si hay que repetir la resta, hazla sobre la raya de antes " +
      "de restarContinuo (sin _CS). opciones.forzar: true sólo si el usuario lo pide.");
  var chK = beCanal(nb, nbId, o), medido = beKMedido(+o.k, chK);
  if (!medido && !o.forzar)
    throw new Error("k = " + o.k + " no lo ha medido medirContinuo (canal " + chK + "): no se inventa ni se retoca. Si el resultado no " +
      "convence, mídelo otra vez con medirContinuo { nb: raya CON estrellas, continuo: RGB calibrada CON estrellas, opciones: { canal } } " +
      "y pasa el k que devuelva. opciones.forzar: true sólo si el usuario da otro k expresamente.");
  var ch = chK;
  var zN = beZones(nb), zC = beZones(ct);
  var c = (o.c !== undefined) ? o.c : 0;   // por defecto sin desplazamiento; se informa del cielo resultante
  var id = beUnique((typeof o.nuevaVista === "string" && o.nuevaVista) || (nbId + "_CS"));
  var r = bePM(nb, "$T - " + o.k + "*" + contId + "[" + ch + "] - " + c, id, false);
  var P = new PixelMath; P.useSingleExpression = true; P.expression = "$T"; P.createNewImage = false; P.truncate = false; P.executeOn(r);
  var x = r.image, n = x.width * x.height, b = new Float32Array(n), neg = 0;
  x.getSamples(b, new Rect(0, 0, x.width, x.height), 0);
  for (var i = 0; i < n; i += 3) if (b[i] < -0.001) ++neg;
  var zR = beZones(r), keep = (zN.zona_r[0] - zN.cielo[0]) > 0 ? (zR.zona_r[0] - zR.cielo[0]) / (zN.zona_r[0] - zN.cielo[0]) : null;
  var P2 = new PixelMath; P2.useSingleExpression = true; P2.expression = "max($T, 0)"; P2.createNewImage = false;
  P2.truncate = true; P2.truncateLower = 0; P2.truncateUpper = 1; P2.executeOn(r);
  // Marcas para inyectarHa (Paso 10): continuo restado y, si la raya venía de separarEstrellas, sin estrellas.
  try { r.setPropertyValue("PiAstroPilot:ContinuoRestado", true); } catch (e) { }
  try { if (nb.propertyValue("PiAstroPilot:SinEstrellas")) r.setPropertyValue("PiAstroPilot:SinEstrellas", true); } catch (e) { }
  r.window.show();
  if (nb.window.hasAstrometricSolution) r.window.copyAstrometricSolution(nb.window);
  var negPct = +(100 * neg / (n / 3)).toFixed(3), noCumple = [];
  if (negPct > 0.5) noCumple.push(negPct + " % de píxeles negativos antes de recortar: k o c demasiado altos, o zonas de continuo fuerte (enmascarar)");
  if (keep !== null && keep < 0.80) noCumple.push("la zona de emisión conserva sólo el " + Math.round(100 * keep) + " % del brillo: ¿k demasiado alta o el objeto es de reflexión?");
  return { vista: id, nb: nbId, continuo: contId + "[" + ch + "]", k: o.k, k_medido: medido ? { nb: medido.nb, continuo: medido.continuo, estrellas: medido.estrellas } : "no (forzar)", c: c, cielo_antes: +zN.cielo[0].toPrecision(4), cielo_despues: +zR.cielo[0].toPrecision(4),
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
    else if (typeof pxPrevia === "function") { var pv = pxPrevia(id, "pal_" + p.n, { estirar: false }); if (pv) e.previa = pv; }   // miniatura para el chat
    w.show(); out.push(e);
  }
  // Previas también de las paletas con SII y de la Natural (23 nov 2026, IC 1396 con Qwen: sin previas más que de HOO, el
  // modelo se saltó la comparación y compuso una SHO sin Hβ, apagada, frente a la Natural de referencia). Con o.sii y o.hb
  // (capas estiradas, mono) se añaden SHO, Natural (con Hβ si lo hay) y Foraxx, hechas con componerPaleta sobre copias
  // reducidas (mismas fórmulas e igualado que a resolución completa). o.paletas: lista de nombres para elegir otras.
  var extra = o.paletas || ((o.sii ? ["SHO", "FORAXX"] : []).concat(["NATURAL"]));
  if (extra.length) {
    var wS = o.sii ? small(beView(beId(o.sii)), "bePalS") : null, wB = o.hb ? small(beView(beId(o.hb)), "bePalB") : null;
    try {
      extra.forEach(function (nom, j) {
        var n = String(nom).toUpperCase(), cap = { H: "bePalH", O: "bePalO" };
        if (wS) cap.S = "bePalS";
        if (wB) cap.B = "bePalB";
        var vid = "bePal_" + n, e2 = { paleta: n, vista: vid };
        try {
          var rp = componerPaleta(cap, { paleta: n, nuevaVista: vid, _previa: true });
          vid = rp.vista; e2.vista = vid; e2.formula = "R = " + rp.formula.R + "; G = " + rp.formula.G + "; B = " + rp.formula.B;
          if (rp.paleta !== n) e2.paleta = rp.paleta;
          var w2 = ImageWindow.windowById(vid);
          if (dir) { var path2 = dir + "/" + String(pal.length + j + 1).replace(/^(\d)$/, "0$1") + "_" + rp.paleta + ".jpg"; w2.saveAs(path2, false, false, false, false); e2.jpg = path2; }
          else if (typeof pxPrevia === "function") { var pv2 = pxPrevia(vid, "pal_" + rp.paleta, { estirar: false }); if (pv2) e2.previa = pv2; }
          w2.show();
        } catch (x2) { e2.error = String(x2 && x2.message ? x2.message : x2); }
        out.push(e2);
      });
    } finally { if (wS) wS.forceClose(); if (wB) wB.forceClose(); }
  }
  beAnotarPrevias(out.map(function (x) { return x.paleta; }));
  wH.forceClose(); wO.forceClose();
  return { previews: out, reduccion: f, carpeta: dir,
           control: { medido: { previews_creadas: out.length },
                      revisar_a_ojo: ["elegir con el usuario (pregunta de una palabra, con una recomendada; con Hβ, la Natural suele ser la más fiel)", "fondo teñido u OIII que inunda el campo de cian"],
                      nota: "Sin SII real: cualquier paleta con S sería pseudo-SHO. Con la elegida, aplicar la misma fórmula a resolución completa y las estrellas RGB en screen. Una paleta es una convención, no el color real." } };
}

// ---------------------------------------------------------------------------------------------------
// Paso 2 no lineal: la paleta elegida a resolución completa (previsualizarPaletas sólo hace previas reducidas de HOO).
// En una prueba con cuatro masters (RGB + tres dual band) se pidió "paleta SHO verdadera" y no había función: Qwen siguió con la
// RGB + Hα y la paleta no se aplicó (7 nov 2026). Fórmulas: tabla del Paso 2 no lineal (AutoPalette Studio v1.2.0).
//   var p = componerPaleta({ S: "SII_st", H: "Ha_st", O: "OIII_st" }, { paleta: "SHO", estrellas: "Estrellas_st" });
//   paletasDisponibles()   // nombres y fórmulas
// capas: rayas desmezcladas (mono), SIN estrellas y YA estiradas con el mismo cielo (estirarStarless(id, { cielo: 0.10 }) en cada una).
// Opciones: paleta (ver BE_PALETAS; por defecto SHO con S, HOO sin S), blend (0..1: mezcla del canal compartido en SHO/HOO,
// 0,5 Neutral, 0,6 Soft, 0,7 Hard), estrellas (capa de estrellas RGB estirada, se suma en screen), nuevaVista.
// Sin SII real, las paletas con S usan un SII sintético (0,6·Hα + 0,4·OIII; Foraxx: 0,85·Hα + 0,15·OIII) y se marcan pseudo.
var BE_PALETAS = (function () {
  var inv = function (x) { return "(1-(" + x + "))"; };
  var p = function (x) { return "((" + x + ")^" + inv(x) + ")"; };
  var mix = function (b, x, y) { return b + "*" + x + "+" + (+(1 - b).toFixed(3)) + "*" + y; };
  var perm = function (a) { return function (c) { return [c[a[0]], c[a[1]], c[a[2]]]; }; };
  var hoo = function (b) { return function (c) { return [c.H, mix(b, c.H, c.O), c.O]; }; };
  var T = {
    SHO: { usaS: true, f: function (c, b) { return b === null ? [c.S, c.H, c.O] : [mix(b, c.S, c.H), mix(b, c.H, c.O), c.O]; }, d: "Classic SHO (Hubble): R = S, G = H, B = O" },
    HSO: { usaS: true, f: perm("HSO"), d: "Classic HSO: R = H, G = S, B = O" },
    OHS: { usaS: true, f: perm("OHS"), d: "R = O, G = H, B = S" },
    HOS: { usaS: true, f: perm("HOS"), d: "R = H, G = O, B = S" },
    SOH: { usaS: true, f: perm("SOH"), d: "R = S, G = O, B = H" },
    OSH: { usaS: true, f: perm("OSH"), d: "R = O, G = S, B = H" },
    HOO: { usaS: false, f: function (c, b) { return hoo(b === null ? 0.6 : b)(c); }, d: "Classic HOO (Soft por defecto): R = H, G = b·H + (1−b)·O, B = O" },
    HOO_NEUTRAL: { usaS: false, f: hoo(0.5), d: "HOO Neutral 50/50" },
    HOO_SOFT: { usaS: false, f: hoo(0.6), d: "HOO Soft 60/40" },
    HOO_HARD: { usaS: false, f: hoo(0.7), d: "HOO Hard 70/30" },
    // Natural (IC 1396, 26 oct 2026, la mejor versión de Rafael): las cuatro rayas con su color aproximado; Hα y SII en rojo,
    // OIII y Hβ en turquesa (el Hβ da señal limpia donde el OIII es flojo). Sin Hβ el OIII hace su papel; sin SII, el Hα.
    NATURAL: { usaS: false, f: function (c) {
        var r = c.real ? "0.85*" + c.H + "+0.15*" + c.S : c.H;
        if (c.B) return [r, "0.60*" + c.O + "+0.25*" + c.B + "+0.15*" + c.H, "0.70*" + c.O + "+0.30*" + c.B];
        return [r, "0.85*" + c.O + "+0.15*" + c.H, c.O]; },
      d: "Natural: R = 0,85·Hα + 0,15·SII; G = 0,6·OIII + 0,25·Hβ + 0,15·Hα; B = 0,7·OIII + 0,3·Hβ (sin Hβ: G = 0,85·OIII + 0,15·Hα, B = OIII)" },
    HOO_NOVA: { usaS: false, f: function (c) { var o = "min(" + c.O + ",0.85*" + c.H + ")"; return [c.H, "0.15*" + c.H + "+0.90*" + o, o]; }, d: "HOO con límite al OIII (NOVA): O' = min(O, 0,85·H)" },
    FORAXX: { usaS: true, sint: "foraxx", f: function (c) { var ho = p(c.H + "*" + c.O), oo = p(c.O); return [oo + "*" + c.S + "+" + inv(oo) + "*" + c.H, ho + "*" + c.H + "+" + inv(ho) + "*" + c.O, c.O]; }, d: "Foraxx Classic: R = o·S + ~o·H, G = ho·H + ~ho·O, B = O" },
    FORAXX_BICOLOR: { usaS: false, f: function (c) { var ho = p(c.H + "*" + c.O); return [c.H, ho + "*" + c.H + "+" + inv(ho) + "*" + c.O, c.O]; }, d: "Foraxx Classic bicolor (sin SII): R = H, G = ho·H + ~ho·O, B = O" },
    FORAXX_HOS: { usaS: false, f: function (c) {
        var ho = p(c.H + "*" + c.O), oo = p(c.O);
        if (c.real) return [c.H, c.O, oo + "*" + c.S + "+" + inv(oo) + "*" + c.O];   // con SII real (AutoPalette Studio)
        var g = ho + "*" + c.H + "+" + inv(ho) + "*" + c.O;
        var s1 = "0.78*" + c.O + "+0.22*(" + ho + "*" + c.H + "+" + inv(ho) + "*max(0," + c.H + "-0.22*" + c.O + "))";
        return [c.H, "0.88*(" + g + ")+0.12*" + c.O, oo + "*(" + s1 + ")+" + inv(oo) + "*" + c.O]; },
      sinS: "pseudo", d: "Foraxx HOS: con SII R = H, G = O, B = o·S + ~o·O; sin SII, la versión subtle (pseudo)" }
  };
  // Familias Foraxx de AutoPalette Studio v1.2.0 (Raúl Hussein, GPL-3), sacadas de su script instalado (8 nov 2026):
  // FORAXX_<familia> = la que genera Studio para esa familia (generateSelectedForaxxPaletteOnly); FORAXX_<familia>_<variante> =
  // las 6 variantes de cada familia (foraxSHO … foraxSOH). o = O^~O, ho = (H·O)^~(H·O) (pipStrength 1). Exigen SII; sin él, SII sintético (pseudo).
  var FX = {"FORAXX_SHO": ["{o}*{S}+~{o}*{H}", "{ho}*{H}+~{ho}*{O}", "{O}"],
    "FORAXX_OHS": ["{o}*{O}+~{o}*{H}", "{ho}*{H}+~{ho}*{O}", "{o}*{S}+~{o}*{O}"],
    "FORAXX_HOO": ["{H}", "{O}", "{o}*{O}+~{o}*{S}"],
    "FORAXX_HSO": ["{H}", "{ho}*{S}+~{ho}*{O}", "{O}"],
    "FORAXX_OSH": ["{o}*{O}+~{o}*{H}", "{ho}*{S}+~{ho}*{O}", "{o}*{H}+~{o}*{O}"],
    "FORAXX_SOH": ["{o}*{S}+~{o}*{H}", "{O}", "{o}*{H}+~{o}*{S}"],
    "FORAXX_HOO_HOS": ["{o}*{H}+~{o}*{H}", "{ho}*{O}+~{ho}*{O}", "{o}*{O}+~{o}*{S}"],
    "FORAXX_HOO_HSO": ["{o}*{H}+~{o}*{H}", "{ho}*{O}+~{ho}*{S}", "{o}*{O}+~{o}*{O}"],
    "FORAXX_HOO_OHS": ["{o}*{H}+~{o}*{O}", "{ho}*{O}+~{ho}*{H}", "{o}*{O}+~{o}*{S}"],
    "FORAXX_HOO_OSH": ["{o}*{H}+~{o}*{O}", "{ho}*{O}+~{ho}*{S}", "{o}*{O}+~{o}*{H}"],
    "FORAXX_HOO_SHO": ["{o}*{H}+~{o}*{S}", "{ho}*{O}+~{ho}*{H}", "{o}*{O}+~{o}*{O}"],
    "FORAXX_HOO_SOH": ["{o}*{H}+~{o}*{S}", "{ho}*{O}+~{ho}*{O}", "{o}*{O}+~{o}*{H}"],
    "FORAXX_HOS_HOO": ["{o}*{H}+~{o}*{H}", "{ho}*{O}+~{ho}*{O}", "{o}*{S}+~{o}*{O}"],
    "FORAXX_HOS_HSO": ["{o}*{H}+~{o}*{H}", "{ho}*{O}+~{ho}*{S}", "{o}*{S}+~{o}*{O}"],
    "FORAXX_HOS_OHS": ["{o}*{H}+~{o}*{O}", "{ho}*{O}+~{ho}*{H}", "{o}*{S}+~{o}*{S}"],
    "FORAXX_HOS_OSH": ["{o}*{H}+~{o}*{O}", "{ho}*{O}+~{ho}*{S}", "{o}*{S}+~{o}*{H}"],
    "FORAXX_HOS_SHO": ["{o}*{H}+~{o}*{S}", "{ho}*{O}+~{ho}*{H}", "{o}*{S}+~{o}*{O}"],
    "FORAXX_HOS_SOH": ["{o}*{H}+~{o}*{S}", "{ho}*{O}+~{ho}*{O}", "{o}*{S}+~{o}*{H}"],
    "FORAXX_HSO_HOO": ["{o}*{H}+~{o}*{H}", "{ho}*{S}+~{ho}*{O}", "{o}*{O}+~{o}*{O}"],
    "FORAXX_HSO_HOS": ["{o}*{H}+~{o}*{H}", "{ho}*{S}+~{ho}*{O}", "{o}*{O}+~{o}*{S}"],
    "FORAXX_HSO_OHS": ["{o}*{H}+~{o}*{O}", "{ho}*{S}+~{ho}*{H}", "{o}*{O}+~{o}*{S}"],
    "FORAXX_HSO_OSH": ["{o}*{H}+~{o}*{O}", "{ho}*{S}+~{ho}*{S}", "{o}*{O}+~{o}*{H}"],
    "FORAXX_HSO_SHO": ["{o}*{H}+~{o}*{S}", "{ho}*{S}+~{ho}*{H}", "{o}*{O}+~{o}*{O}"],
    "FORAXX_HSO_SOH": ["{o}*{H}+~{o}*{S}", "{ho}*{S}+~{ho}*{O}", "{o}*{O}+~{o}*{H}"],
    "FORAXX_OHS_HOO": ["{o}*{O}+~{o}*{H}", "{ho}*{H}+~{ho}*{O}", "{o}*{S}+~{o}*{O}"],
    "FORAXX_OHS_HOS": ["{o}*{O}+~{o}*{H}", "{ho}*{H}+~{ho}*{O}", "{o}*{S}+~{o}*{S}"],
    "FORAXX_OHS_HSO": ["{o}*{O}+~{o}*{H}", "{ho}*{H}+~{ho}*{S}", "{o}*{S}+~{o}*{O}"],
    "FORAXX_OHS_OSH": ["{o}*{O}+~{o}*{O}", "{ho}*{H}+~{ho}*{S}", "{o}*{S}+~{o}*{H}"],
    "FORAXX_OHS_SHO": ["{o}*{O}+~{o}*{S}", "{ho}*{H}+~{ho}*{H}", "{o}*{S}+~{o}*{O}"],
    "FORAXX_OHS_SOH": ["{o}*{O}+~{o}*{S}", "{ho}*{H}+~{ho}*{O}", "{o}*{S}+~{o}*{H}"],
    "FORAXX_OSH_HOO": ["{o}*{O}+~{o}*{H}", "{ho}*{S}+~{ho}*{O}", "{o}*{H}+~{o}*{O}"],
    "FORAXX_OSH_HOS": ["{o}*{O}+~{o}*{H}", "{ho}*{S}+~{ho}*{O}", "{o}*{H}+~{o}*{S}"],
    "FORAXX_OSH_HSO": ["{o}*{O}+~{o}*{H}", "{ho}*{S}+~{ho}*{S}", "{o}*{H}+~{o}*{O}"],
    "FORAXX_OSH_OSH": ["{o}*{O}+~{o}*{O}", "{ho}*{S}+~{ho}*{S}", "{o}*{H}+~{o}*{H}"],
    "FORAXX_OSH_SHO": ["{o}*{O}+~{o}*{S}", "{ho}*{S}+~{ho}*{H}", "{o}*{H}+~{o}*{O}"],
    "FORAXX_OSH_SOH": ["{o}*{O}+~{o}*{S}", "{ho}*{S}+~{ho}*{O}", "{o}*{H}+~{o}*{H}"],
    "FORAXX_SHO_HOO": ["{o}*{S}+~{o}*{H}", "{ho}*{H}+~{ho}*{O}", "{O}"],
    "FORAXX_SHO_HOS": ["{o}*{S}+~{o}*{H}", "{ho}*{H}+~{ho}*{O}", "{o}*{O}+~{o}*{S}"],
    "FORAXX_SHO_HSO": ["{o}*{S}+~{o}*{H}", "{ho}*{H}+~{ho}*{S}", "{O}"],
    "FORAXX_SHO_OHS": ["{o}*{S}+~{o}*{O}", "{H}", "{o}*{O}+~{o}*{S}"],
    "FORAXX_SHO_OSH": ["{o}*{S}+~{o}*{O}", "{ho}*{H}+~{ho}*{S}", "{o}*{O}+~{o}*{H}"],
    "FORAXX_SHO_SOH": ["{S}", "{ho}*{O}+~{ho}*{H}", "{o}*{O}+~{o}*{H}"],
    "FORAXX_SOH_HOO": ["{o}*{S}+~{o}*{H}", "{ho}*{O}+~{ho}*{O}", "{o}*{H}+~{o}*{O}"],
    "FORAXX_SOH_HOS": ["{o}*{S}+~{o}*{H}", "{ho}*{O}+~{ho}*{O}", "{o}*{H}+~{o}*{S}"],
    "FORAXX_SOH_HSO": ["{o}*{S}+~{o}*{H}", "{ho}*{O}+~{ho}*{S}", "{o}*{H}+~{o}*{O}"],
    "FORAXX_SOH_OHS": ["{o}*{S}+~{o}*{O}", "{ho}*{O}+~{ho}*{H}", "{o}*{H}+~{o}*{S}"],
    "FORAXX_SOH_OSH": ["{o}*{S}+~{o}*{O}", "{ho}*{O}+~{ho}*{S}", "{o}*{H}+~{o}*{H}"],
    "FORAXX_SOH_SHO": ["{o}*{S}+~{o}*{S}", "{ho}*{O}+~{ho}*{H}", "{o}*{H}+~{o}*{O}"]};
  var fx = function (tpl) { return function (c) {
    var oo = p(c.O), ho = p(c.H + "*" + c.O);
    return tpl.map(function (x) { return x.replace(/\{ho\}/g, ho).replace(/\{o\}/g, oo).replace(/\{S\}/g, c.S).replace(/\{H\}/g, c.H).replace(/\{O\}/g, c.O); }); }; };
  for (var nombre in FX) if (!T[nombre]) T[nombre] = { usaS: true, sint: "foraxx", f: fx(FX[nombre]), d: "AutoPalette " + nombre + ": R = " + FX[nombre][0] + "; G = " + FX[nombre][1] + "; B = " + FX[nombre][2] };
  T.HUBBLE = T.SHO; T.FORAXX_CLASSIC = T.FORAXX;
  return T;
})();

// Previas de paleta hechas (registro en la carpeta temporal: el MCP arranca un script nuevo en cada llamada).
function beRutaPrevias() { return File.systemTempDirectory + "/piastropilot-paletas.json"; }
function beAnotarPrevias(nombres) { try { File.writeTextFile(beRutaPrevias(), JSON.stringify({ t: Date.now(), paletas: nombres })); } catch (e) { } }
function bePreviasRecientes() {
  try { if (File.exists(beRutaPrevias())) { var r = JSON.parse(File.readTextFile(beRutaPrevias())); if (Date.now() - r.t < 86400000) return r; } } catch (e) { }
  return null;
}

function paletasDisponibles() {
  var r = {};
  for (var k in BE_PALETAS) r[k] = (BE_PALETAS[k].usaS ? "[con SII] " : "") + BE_PALETAS[k].d;
  return { paletas: r, nota: "Foraxx: FORAXX_<familia> es la de AutoPalette Studio para esa familia; FORAXX_<familia>_<variante> sus 6 variantes (42). Las marcadas [con SII] usan SII sintético si no hay SII real (pseudo)." };
}

function componerPaleta(capas, o) {
  o = o || {};
  // Qwen la llamó dos veces con una lista de ids (14–15 nov 2026): se reparten por el nombre de cada capa.
  if (capas instanceof Array) {
    var porNombre = {};
    capas.forEach(function (c) {
      // Las capas de desmezclarDualBand empiezan por la raya (Ha_raw, OIII_raw_comb, SII_raw_S2Hb, Hb_raw_S2Hb).
      var s = String(c), k = /^SII/i.test(s) ? "S" : /^Hb/i.test(s) ? "B" : /^OIII/i.test(s) ? "O" : /^Ha/i.test(s) ? "H" : null;
      if (k && !porNombre[k]) porNombre[k] = s;
    });
    if (porNombre.H && porNombre.O) capas = porNombre;
  }
  if (!capas || typeof capas !== "object" || capas instanceof Array)
    throw new Error("componerPaleta({ S: id, H: id, O: id }, opciones): las capas van en un objeto con S (opcional), H y O");
  var ids = {};
  // Claves sin distinguir mayúsculas y con el nombre de la raya (s/h/o/b, sii/ha/oiii/hb): Qwen probó las tres formas
  // y sólo valía S/H/O/B (15 nov 2026).
  var porClave = {};
  for (var kc in capas) porClave[String(kc).toLowerCase()] = capas[kc];
  ["S", "H", "O", "B"].forEach(function (k) {
    var lk = k.toLowerCase(), nom = { S: "sii", H: "ha", O: "oiii", B: "hb" }[k];
    var v = porClave[lk] !== undefined ? porClave[lk] : porClave[nom];
    if (v) ids[k] = beId(v);
  });
  if (!ids.H || !ids.O) throw new Error("Hacen falta al menos H (Hα) y O (OIII)");
  // Regla de la guía: previa de todas las opciones antes de elegir (23 nov 2026, IC 1396: sin previas salió una SHO sin Hβ).
  if (!o._previa && !o.forzar && !bePreviasRecientes())
    throw new Error("Antes de componer la paleta, compara las previas: previsualizarPaletas { ha: <Hα estirada>, oiii: <OIII estirada>, " +
                    "opciones: { sii: <SII estirada si la hay>, hb: <Hβ estirada si la hay> } } (HOO, SHO, Natural, Foraxx…) y elige con el " +
                    "usuario; después componerPaleta con la elegida. opciones.forzar: true sólo si el usuario lo pide.");
  // Una capa Hβ abierta que no se pasa: la Natural (cuatro rayas) la usa (IC 1396, 23 nov 2026: se quedó fuera).
  var hbSinUsar = null;
  if (!ids.B && !o._previa) ImageWindow.windows.forEach(function (w0) { var i0 = w0.mainView.id; if (!hbSinUsar && /^hb([^a-z]|$)/i.test(i0) && w0.mainView.image.numberOfChannels === 1) hbSinUsar = i0; });
  // Con Hβ, la paleta por defecto es la Natural (las cuatro rayas).
  var tieneS = !!ids.S, nombre = String(o.paleta || (ids.B ? "NATURAL" : tieneS ? "SHO" : "HOO")).toUpperCase().replace(/[\s-]+/g, "_");
  var def = BE_PALETAS[nombre];
  if (!def) throw new Error("paleta '" + o.paleta + "' no reconocida. Disponibles: " + Object.keys(BE_PALETAS).join(", "));
  var ref = beView(ids.H), W = ref.image.width, Hh = ref.image.height, med = {};
  for (var k in ids) {
    var v = beView(ids[k]);
    if (v.image.width !== W || v.image.height !== Hh) throw new Error(k + " (" + ids[k] + ") no tiene el tamaño de H: alinear antes (Paso 5 lineal)");
    if (v.image.numberOfChannels !== 1) throw new Error(k + " (" + ids[k] + ") es en color: usa la raya desmezclada (mono) del Paso 7 lineal");
    v.image.resetSelections();
    med[k] = +v.image.median().toFixed(4);
    if (med[k] < 0.02) throw new Error(k + " (" + ids[k] + ") parece lineal (mediana " + med[k] + "): sepárale las estrellas (separarEstrellas) y estira cada " +
                                      "raya starless con el mismo cielo (estirarCandidatos en una raya y estirarStarless(id, { cielo: 0.10 }) en las demás), antes de componer la paleta");
  }
  // Igualar las rayas al Hα (como _igualar de Siril y SASpro): mismo cielo y mismo recorrido cielo→p99. Sin esto la mezcla
  // depende de cómo quedó cada estirado: en IC 1396 (15 nov 2026) la misma Natural salió turquesa en una pasada y roja,
  // con el OIII apagado, en la siguiente. Por defecto en la NATURAL; { igualar: true/false } en cualquiera.
  var temporales = [], igualadas = {};
  if (o.igualar === true || (o.igualar !== false && nombre === "NATURAL")) {
    var nivel = function (vw) {
      var imx = vw.image, n = imx.width * imx.height, buf = new Float32Array(n);
      imx.getSamples(buf, new Rect(0, 0, imx.width, imx.height), 0);
      var s = []; for (var i = 0; i < n; i += 37) s.push(buf[i]);
      s.sort(function (a, b) { return a - b; });
      return { cielo: esCheck(vw).cielo, p99: s[Math.floor(0.99 * (s.length - 1))] };
    };
    var nh = nivel(ref);
    ["S", "O", "B"].forEach(function (k) {
      if (!ids[k]) return;
      var nv = nivel(beView(ids[k])), sh = nh.p99 - nh.cielo, so = Math.max(nv.p99 - nv.cielo, 1e-6), f = sh / so;
      var tid = beUnique("beIgual_" + k), Q = new PixelMath;
      Q.expression = nh.cielo.toFixed(6) + " + ($T - " + nv.cielo.toFixed(6) + ") * " + f.toFixed(6);
      Q.useSingleExpression = true; Q.createNewImage = true; Q.newImageId = tid; Q.showNewImage = false;
      Q.newImageColorSpace = (PixelMath.Gray !== undefined) ? PixelMath.Gray : PixelMath.prototype.Gray;
      Q.newImageSampleFormat = (PixelMath.f32 !== undefined) ? PixelMath.f32 : PixelMath.prototype.f32;
      Q.truncate = true; Q.truncateLower = 0; Q.truncateUpper = 1;
      if (!Q.executeOn(beView(ids[k]))) throw new Error("No se pudo igualar " + k + " al Hα");
      temporales.push(tid);
      igualadas[k] = { factor: +f.toFixed(3), cielo_antes: +nv.cielo.toFixed(4), p99_antes: +nv.p99.toFixed(4) };
      ids[k] = tid;
    });
  }
  var c = { S: ids.S, H: ids.H, O: ids.O, B: ids.B, real: tieneS }, pseudo = !!def.pseudo || (def.sinS === "pseudo" && !tieneS);
  if (def.usaS && !tieneS) {
    c.S = def.sint === "foraxx" ? "(0.85*" + ids.H + "+0.15*" + ids.O + ")" : "(0.6*" + ids.H + "+0.4*" + ids.O + ")";
    pseudo = true;
  }
  var e = def.f(c, (o.blend !== undefined) ? o.blend : null);
  var etiqueta = (pseudo ? "pseudo_" : "") + nombre;
  var id = beUnique((typeof o.nuevaVista === "string" && o.nuevaVista) || ("Paleta_" + etiqueta));
  var P = new PixelMath;
  P.useSingleExpression = false; P.expression = e[0]; P.expression1 = e[1]; P.expression2 = e[2];
  P.createNewImage = true; P.newImageId = id;
  P.newImageColorSpace = (PixelMath.RGB !== undefined) ? PixelMath.RGB : PixelMath.prototype.RGB;
  P.newImageSampleFormat = (PixelMath.f32 !== undefined) ? PixelMath.f32 : PixelMath.prototype.f32;
  P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1;
  var okP = P.executeOn(ref);
  temporales.forEach(function (t) { var wt = ImageWindow.windowById(t); if (!wt.isNull) wt.forceClose(); });
  if (!okP) throw new Error("PixelMath de la paleta falló");
  var w = ImageWindow.windowById(id), hecho = [def.d + (pseudo ? " (pseudo: sin SII real)" : "")];
  if (temporales.length) hecho.push("rayas igualadas al Hα (mismo cielo y recorrido hasta el p99) antes de mezclar: " + JSON.stringify(igualadas));
  w.keywords = ref.window.keywords;
  if (ref.window.hasAstrometricSolution) try { w.copyAstrometricSolution(ref.window); } catch (x) { }
  var noCumple = [];
  if (hbSinUsar) noCumple.push("hay una capa Hβ abierta (" + hbSinUsar + ") que no se ha pasado: la Natural usa las cuatro rayas " +
                               "(capas: { S, H, O, B: \"" + hbSinUsar + "\" }); estírala como las demás y repite si conviene");
  // Equilibrio del verde (8 nov 2026, IC 1396 SHO): con cada raya estirada al mismo cielo, la que va al verde (casi siempre Hα)
  // domina y la imagen sale verde entera; quitarVerde no lo ve porque mide sólo el cielo. Se mide en toda la imagen
  // G / max(R, B) y, si pasa de 1,05, SCNR (Average Neutral, conserva luminosidad) con amount o.verde (0,8 por defecto).
  var im = w.mainView.image;
  function bePromedios() { var m = []; for (var ch = 0; ch < 3; ++ch) { im.selectedChannel = ch; m.push(im.mean()); } im.resetSelections(); return m; }
  var m0 = bePromedios(), verde0 = m0[1] / Math.max(m0[0], m0[2], 1e-6), verde1 = verde0;
  if (o.verde !== false && verde0 > 1.05) {
    var S = new SCNR;
    S.amount = (typeof o.verde === "number") ? Math.max(0, Math.min(1, o.verde)) : 0.8;
    S.protectionMethod = (SCNR.AverageNeutral !== undefined) ? SCNR.AverageNeutral : SCNR.prototype.AverageNeutral;
    S.colorToRemove = (SCNR.Green !== undefined) ? SCNR.Green : SCNR.prototype.Green;
    S.preserveLightness = true;
    if (!S.executeOn(w.mainView)) throw new Error("SCNR del verde falló");
    var m1 = bePromedios(); verde1 = m1[1] / Math.max(m1[0], m1[2], 1e-6);
    hecho.push("verde equilibrado con SCNR " + S.amount + ": G/max(R,B) " + verde0.toFixed(2) + " → " + verde1.toFixed(2) + " (opción verde: false para dejarlo)");
  }
  // Estrellas: NO se suman aquí por defecto. La paleta es la starless: se satura (Paso 5) y las estrellas RGB se preparan
  // (prepararEstrellas sobre la CAPA DE ESTRELLAS) y se recombinan al final (Pasos 8–9). Si se sumaran ahora, la saturación
  // las teñiría y prepararEstrellas acabaría corriendo sobre la paleta entera (estrellas dobles).
  var estrellasId = o.estrellas ? beId(o.estrellas) : null, sumadas = false;
  if (estrellasId) {
    var st = beView(estrellasId);
    if (st.image.width !== W || st.image.height !== Hh) throw new Error("La capa de estrellas no tiene el tamaño de las rayas");
    st.image.resetSelections();
    var stMx = 0; for (var c1 = 0; c1 < 3; ++c1) { st.image.selectedChannel = c1; stMx = Math.max(stMx, st.image.median()); } st.image.resetSelections();
    if (stMx < 2e-5) {
      var alt = ["_estiradas", "_estirada"].map(function (x) { return st.id + x; }).filter(function (x) { return !ImageWindow.windowById(x).isNull; });
      if (alt.length) { hecho.push("estrellas: " + st.id + " es la capa lineal; uso la estirada " + alt[0]); estrellasId = alt[0]; st = beView(alt[0]); }
      else noCumple.push("la capa de estrellas " + st.id + " está sin estirar (lineal): estírala con estirarCapas antes de prepararEstrellas");
    }
    if (st.image.median() > 0.05) noCumple.push("la capa de estrellas tiene mediana " + st.image.median().toFixed(3) + ": parece una imagen con nebulosa, no sólo estrellas");
    if (o.sumarEstrellas) {
      var Q = new PixelMath;
      Q.useSingleExpression = true; Q.expression = "~(~$T*~" + st.id + ")"; Q.createNewImage = false; Q.truncate = true;
      if (!Q.executeOn(w.mainView)) throw new Error("Screen de las estrellas falló");
      hecho.push("estrellas de " + st.id + " sumadas en screen (sumarEstrellas: true): NO hacer después prepararEstrellas ni recombinarEstrellas");
      sumadas = true;
    }
  }
  var porCanal = [];
  for (var ch = 0; ch < 3; ++ch) { im.selectedChannel = ch; porCanal.push(+im.median().toFixed(4)); }
  im.resetSelections();
  w.show();
  var siguiente = sumadas ? "La paleta ya lleva las estrellas: saturarAlFallo(\"" + id + "\") con cuidado y exportar; NO prepararEstrellas ni recombinarEstrellas."
    : "Paleta SIN estrellas: 1) fondoCandidatos(\"" + id + "\") (cielo oscuro y neutro; sigue con su r.vista); 2) colorCandidatos(esa vista, { tipo: \"nebulosa\" }) (saturación con máscara de luminancia); 3) contrasteCandidatos sobre la elegida; 4) prepararEstrellas(" + (estrellasId ? "\"" + estrellasId + "\"" : "capa de estrellas RGB estirada (r.estrellas.vista de estirarCapas)") +
      ") — sobre la CAPA DE ESTRELLAS, nunca sobre la paleta (o mejor estirarEstrellasCandidatos con la capa lineal); 5) recombinarEstrellas(paleta saturada, estrellas preparadas); 6) exportarFinal.";
  return {
    vista: id, paleta: etiqueta, previa: (typeof pxPrevia === "function" ? pxPrevia(id, "pal_" + id, { estirar: false }) : null) || undefined,
    capas: ids, medianas_capas: med, mediana_por_canal: porCanal, hecho: hecho, no_cumple: noCumple,
    formula: { R: e[0], G: e[1], B: e[2] },
    estrellas_sumadas: sumadas, estrellas_para_recombinar: sumadas ? null : estrellasId,
    siguiente: siguiente,
    control: {
      medido: { mismo_tamano: true, capas_estiradas: true, estrellas_sumadas: sumadas, sii_real: tieneS,
                verde_G_sobre_RB_antes: +verde0.toFixed(3), verde_G_sobre_RB_despues: +verde1.toFixed(3) },
      revisar_a_ojo: ["color general: en SHO, zonas doradas (Hα+SII) y azules (OIII); si aún sale verde, repetir con { verde: 1 }",
                      "fondo: sin tinte fuerte (si lo hay, curvas por canal)"],
      nota: (pseudo ? "Sin SII real: es pseudo-" + nombre + "; decirlo. " : "") + "Una paleta es una convención, no el color real. " + siguiente
    }
  };
}
