// preproceso.js — Pasos 3 y 4 lineales: revisar la calibración y seleccionar subs. PJSR, ECMAScript 5.
//
// Uso (cargar en el nivel superior del script, nunca dentro de una función):
//   eval(File.readTextFile("<ruta de guia>/herramientas/preproceso.js"));
//   JSON.stringify(revisarCalibracion({ lights: "<carpeta LIGHT>", flats: "<carpeta FLAT>",
//                                       flatDarks: "<carpeta DARK de flats>", darks: "<carpeta o master>" }));
//   JSON.stringify(seleccionarSubs("<carpeta LIGHT>"));          // o una lista de ficheros
//   JSON.stringify(lanzarWBPP({ lights: sel.aprobados_rutas, flats: ..., flatDarks: ..., darks: ..., salida: "C:/wbpp/obj" }));
//   JSON.stringify(estadoWBPP("C:/wbpp/obj"));                    // repetir hasta terminado: true
//
// revisarCalibracion lee sólo las cabeceras (sin abrir ventanas) y, de los flats, unos pocos ficheros para medir
// su nivel. Comprueba que darks, flats y darks de flats casan con los lights (exposición, temperatura, gain, offset,
// binning, tamaño, telescopio y filtro) y que los flats no están saturados ni subexpuestos.
//
// seleccionarSubs mide los subs con ImageAnalysis (PixInsight 1.9.6+) y rechaza, dentro de cada grupo de carpeta,
// filtro y exposición:
//   - FWHM > (1 + fwhmTol) x cuartil inferior del FWHM del grupo (fwhmTol 0,5): foco o seeing peores. Entre
//     +fwhmDuda (0,35) y +fwhmTol se aprueban pero se listan en "dudosos" para que decida el usuario.
//     Se compara con el cuartil inferior y no con la mediana porque en una noche que mejora (o empeora) poco a poco
//     la mitad de los subs pueden ser malos y la mediana se va con ellos.
//   - Excentricidad > mediana del grupo + eccDelta (0,07): seguimiento o viento.
//   - CloudExtinction con z robusto > nubeZ (2,5): pérdida de transparencia (nubes, rocío).
// Devuelve la tabla, aprobados, rechazados con motivo y pesos (PSF Signal Weight / máximo del grupo). Los trazos
// (satélites, aviones) sólo se anotan: los quita el rechazo de píxeles de la integración.
// Los umbrales se ajustaron con LDN 1235 (11-9-2026, subs crudos CFA): revisar con otros datos.

function ppList(x, patron) {
  if (!x) return [];
  if (x instanceof Array) return x;
  var p = String(x).replace(/\\/g, "/");
  if (File.exists(p)) return [p];
  var d = p.replace(/\/$/, ""), out = [], exts = patron || ["*.fits", "*.fit", "*.fts", "*.xisf"];
  for (var i = 0; i < exts.length; ++i) out = out.concat(searchDirectory(d + "/" + exts[i], false));
  out.sort();
  return out;
}

function ppHeader(path) {
  var F = new FileFormat(File.extractExtension(path).toLowerCase(), true, false);
  if (F.isNull) throw new Error("Formato no soportado: " + path);
  var f = new FileFormatInstance(F);
  var d = f.open(path, "verbosity 0");
  if (!d || d.length == 0) throw new Error("No se pudo leer " + path);
  var o = { fichero: path, ancho: d[0].width, alto: d[0].height }, k = f.keywords;
  var want = ["IMAGETYP", "FILTER", "EXPTIME", "EXPOSURE", "CCD-TEMP", "SET-TEMP", "GAIN", "OFFSET", "XBINNING",
              "BAYERPAT", "DATE-OBS", "INSTRUME", "TELESCOP", "FOCALLEN", "OBJECT"];
  for (var i = 0; i < k.length; ++i) if (want.indexOf(k[i].name) >= 0) o[k[i].name] = k[i].strippedValue.trim();
  // Masters XISF: a veces sólo llevan propiedades XISF, sin palabras clave FITS.
  var props = { EXPTIME: "Instrument:FrameExposureTime", EXPOSURE: "Instrument:ExposureTime", "CCD-TEMP": "Instrument:Sensor:Temperature", FILTER: "Instrument:Filter:Name",
                TELESCOP: "Instrument:Telescope:Name", XBINNING: "Instrument:Sensor:XBinning", IMAGETYP: "Instrument:Frame:Type" };
  for (var kp in props)
    if (o[kp] === undefined) try { var pv = f.readImageProperty(props[kp]); if (pv !== undefined && pv !== null) o[kp] = String(pv); } catch (e) { }
  f.close();
  o.exp = parseFloat(o.EXPTIME || o.EXPOSURE);
  o.temp = parseFloat(o["CCD-TEMP"] || o["SET-TEMP"]);
  o.gain = o.GAIN === undefined ? null : parseFloat(o.GAIN);
  o.offset = o.OFFSET === undefined ? null : parseFloat(o.OFFSET);
  // Último recurso, el nombre del fichero ("Master Dark 300s -10C 100Ga 50Of"): exposición, temperatura, gain y offset.
  var nm = File.extractName(path), m;
  if (!isFinite(o.exp) && (m = nm.match(/(\d+(?:\.\d+)?)\s*s(?![a-z])/i))) o.exp = parseFloat(m[1]);
  if (!isFinite(o.temp) && (m = nm.match(/(-?\d+(?:\.\d+)?)\s*C(?![a-z])/))) o.temp = parseFloat(m[1]);
  if (o.gain === null && (m = nm.match(/(\d+)\s*Ga/i))) o.gain = parseFloat(m[1]);
  if (o.offset === null && (m = nm.match(/(\d+)\s*Of/i))) o.offset = parseFloat(m[1]);
  o.bin = parseInt(o.XBINNING || "1");
  o.filtro = o.FILTER || "";
  o.telescopio = (o.TELESCOP || "").toLowerCase();
  o.tipo = (o.IMAGETYP || "").toLowerCase();
  return o;
}

function ppUnique(list, key) {
  var u = [];
  for (var i = 0; i < list.length; ++i) { var v = key(list[i]); if (u.indexOf(v) < 0) u.push(v); }
  return u;
}

function ppMed(a) {
  var b = a.slice().sort(function (x, y) { return x - y; }), n = b.length;
  return n == 0 ? NaN : (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2);
}

function ppQuantile(a, q) {
  var b = a.slice().sort(function (x, y) { return x - y; });
  if (b.length == 0) return NaN;
  var p = q * (b.length - 1), i = Math.floor(p), f = p - i;
  return i + 1 < b.length ? b[i] * (1 - f) + b[i + 1] * f : b[i];
}

// Nivel de un flat por canal CFA (RGGB por defecto): mediana y % de píxeles >= 0,98 del rango.
function ppFlatLevel(path, bayer) {
  var w = ImageWindow.open(path, "ppFLAT", "verbosity 0", true);
  if (!w || w.length == 0) throw new Error("No se pudo abrir " + path);
  var im = w[0].mainView.image, W = im.width, H = im.height, row = new Float32Array(W);
  var pat = (bayer || "RGGB").toUpperCase(), ch = { R: [], G: [], B: [] }, sat = { R: 0, G: 0, B: 0 }, n = { R: 0, G: 0, B: 0 };
  for (var y = 0; y < H; y += 2) {
    for (var dy = 0; dy < 2; ++dy) {
      im.getSamples(row, new Rect(0, y + dy, W, y + dy + 1), 0);
      for (var x = 0; x < W; x += 2)
        for (var dx = 0; dx < 2; ++dx) {
          var c = pat.charAt(dy * 2 + dx), v = row[x + dx];
          if ((x & 31) == 0 && (y & 31) == 0) ch[c].push(v);    // muestra para la mediana
          if (v >= 0.98) ++sat[c];
          ++n[c];
        }
    }
  }
  w[0].forceClose();
  var r = {};
  for (var c in ch) if (n[c]) r[c] = { mediana: +ppMed(ch[c]).toFixed(4), saturados_pct: +(100 * sat[c] / n[c]).toFixed(2) };
  return r;
}

function revisarCalibracion(o) {
  o = o || {};
  var r = { grupos_lights: [], darks: [], flats: [], darks_de_flats: [], no_cumple: [], control: { medido: [], revisar_a_ojo: [] } };
  var L = ppList(o.lights).map(ppHeader);
  if (L.length == 0) throw new Error("No hay lights en " + o.lights);
  var D = ppList(o.darks).map(ppHeader), F = ppList(o.flats).map(ppHeader), FD = ppList(o.flatDarks).map(ppHeader);
  var B = ppList(o.bias).map(ppHeader);
  var tolExp = o.tolExposicion || 1, tolTemp = o.tolTemperatura || 2;

  function sameSensor(a, b) {
    return a.ancho == b.ancho && a.alto == b.alto && a.bin == b.bin &&
           (a.gain === null || b.gain === null || a.gain == b.gain) && (a.offset === null || b.offset === null || a.offset == b.offset);
  }
  function key(h) { return [h.filtro, h.exp, h.gain, h.offset, h.bin, h.ancho + "x" + h.alto, h.telescopio].join(" | "); }

  var keys = ppUnique(L, key);
  for (var g = 0; g < keys.length; ++g) {
    var Lg = L.filter(function (h) { return key(h) == keys[g]; }), h0 = Lg[0];
    var temps = Lg.map(function (h) { return h.temp; }).filter(function (t) { return isFinite(t); });
    var grp = { filtro: h0.filtro || "(sin FILTER)", exposicion_s: h0.exp, gain: h0.gain, offset: h0.offset, bin: h0.bin,
                tamano: h0.ancho + "x" + h0.alto, telescopio: h0.TELESCOP || "", n: Lg.length,
                temp_min: temps.length ? Math.min.apply(null, temps) : null, temp_max: temps.length ? Math.max.apply(null, temps) : null };
    r.grupos_lights.push(grp);
    var etiqueta = "lights " + grp.filtro + " " + h0.exp + " s";

    // Darks de los lights (crudos o master): misma exposición, temperatura, gain, offset, binning y tamaño.
    var dOk = D.filter(function (d) { return sameSensor(d, h0) && Math.abs(d.exp - h0.exp) <= tolExp &&
                                              (!isFinite(d.temp) || !isFinite(h0.temp) || Math.abs(d.temp - h0.temp) <= tolTemp); });
    if (dOk.length == 0) {
      var dExp = D.filter(function (d) { return sameSensor(d, h0); }).map(function (d) { return d.exp; });
      r.no_cumple.push(etiqueta + ": no hay dark de " + h0.exp + " s a " + h0.temp + " °C (gain " + h0.gain + ", offset " + h0.offset +
                       ")" + (dExp.length ? "; sólo de " + ppUnique(dExp, function (x) { return x; }).join(", ") + " s" : "") +
                       ". Sin él quedan los píxeles calientes y la señal térmica: hacer darks o usar uno de la biblioteca.");
    } else r.darks.push({ grupo: etiqueta, n: dOk.length, ejemplo: dOk[0].fichero });

    // Flats: mismo sensor, filtro y telescopio.
    var fSen = F.filter(function (f) { return sameSensor(f, h0); });
    if (F.length == 0) r.no_cumple.push(etiqueta + ": no hay flats.");
    else if (fSen.length == 0) r.no_cumple.push(etiqueta + ": ningún flat tiene el mismo tamaño, binning, gain y offset que los lights.");
    else {
      var fFil = fSen.filter(function (f) { return f.filtro == h0.filtro; });
      if (fFil.length == 0)
        r.no_cumple.push(etiqueta + ": los flats tienen filtro '" + ppUnique(fSen, function (f) { return f.filtro || "(sin FILTER)"; }).join("', '") +
                         "' y los lights '" + grp.filtro + "'. WBPP no los emparejará (o lo hará mal); revisar qué filtro llevaban.");
      var fTel = fSen.filter(function (f) { return !f.telescopio || !h0.telescopio || f.telescopio == h0.telescopio; });
      if (fTel.length < fSen.length)
        r.no_cumple.push(etiqueta + ": " + (fSen.length - fTel.length) + " flats dicen telescopio '" +
                         ppUnique(fSen.filter(function (f) { return fTel.indexOf(f) < 0; }), function (f) { return f.TELESCOP; }).join("', '") +
                         "' y los lights '" + h0.TELESCOP + "'. Un flat de otro tren óptico no corrige el viñeteado ni el polvo.");
      r.flats.push({ grupo: etiqueta, n: fSen.length, mismo_filtro: fFil.length, exposiciones_s: ppUnique(fSen, function (f) { return f.exp; }) });

      // Darks de flats (o bias) para cada exposición de flat.
      var fExps = ppUnique(fSen, function (f) { return f.exp; });
      for (var e = 0; e < fExps.length; ++e) {
        var fd = FD.concat(D).filter(function (d) { return sameSensor(d, h0) && Math.abs(d.exp - fExps[e]) <= Math.max(0.05 * fExps[e], 0.01); });
        if (fd.length == 0 && B.length == 0)
          r.no_cumple.push(etiqueta + ": no hay darks de flats de " + fExps[e] + " s ni bias.");
        else r.darks_de_flats.push({ exposicion_flat_s: fExps[e], darks: fd.length, bias: B.length });
      }

      // Nivel de los flats: unos pocos ficheros (por defecto 3).
      var nf = Math.min(o.flatsMedidos || 3, fSen.length);
      for (var i = 0; i < nf; ++i) {
        var fh = fSen[Math.floor(i * (fSen.length - 1) / Math.max(1, nf - 1))];
        var lv = ppFlatLevel(fh.fichero, fh.BAYERPAT);
        r.control.medido.push("flat " + File.extractName(fh.fichero) + ": " + JSON.stringify(lv));
        for (var c in lv) {
          if (lv[c].saturados_pct > 1)
            r.no_cumple.push(etiqueta + ": flat " + File.extractName(fh.fichero) + " saturado en " + c + " (mediana " + lv[c].mediana +
                             ", " + lv[c].saturados_pct + " % a >= 0,98). Un flat saturado no corrige nada en ese canal.");
          else if (lv[c].mediana > 0.85)
            r.control.revisar_a_ojo.push("flat " + File.extractName(fh.fichero) + " muy alto en " + c + " (mediana " + lv[c].mediana +
                                         "): cerca de saturar, donde el sensor deja de ser lineal. Mejor 0,3–0,7.");
          else if (lv[c].mediana < 0.08)
            r.control.revisar_a_ojo.push("flat " + File.extractName(fh.fichero) + " muy oscuro en " + c + " (mediana " + lv[c].mediana + ").");
        }
      }
    }
    if (grp.temp_max !== null && grp.temp_max - grp.temp_min > tolTemp)
      r.no_cumple.push(etiqueta + ": la temperatura del sensor va de " + grp.temp_min + " a " + grp.temp_max + " °C.");
  }
  if (keys.length > 1)
    r.control.revisar_a_ojo.push("Hay " + keys.length + " grupos de lights distintos: integrarlos por separado o comprobar que WBPP los agrupa bien.");
  r.no_cumple = ppUnique(r.no_cumple, function (x) { return x; });
  return r;
}

// WBPP sin ventana: arranca una segunda instancia de PixInsight en modo automatización que se cierra al acabar.
// No bloquea esta instancia ni el watcher. Opciones: lights, flats, darks, flatDarks, bias (carpetas o listas de
// ficheros; en lights se puede pasar la lista de aprobados de seleccionarSubs), salida (carpeta, ruta CORTA: Windows
// no crea ficheros de más de 256 caracteres y WBPP añade nombres largos), parametros ({ nombre: valor } de la ayuda de
// automatización de WBPP, Alt+A en su ventana). Por defecto sin plate solve ni modos interactivos; el resto de
// ajustes (drizzle, normalización local, autocrop...) son los últimos guardados en WBPP.
// Después: estadoWBPP(salida) hasta que diga terminado, y entonces resume el log.
function lanzarWBPP(o) {
  o = o || {};
  if (!o.salida) throw new Error("Falta la carpeta de salida (opción salida, ruta corta)");
  var salida = o.salida.replace(/\\/g, "/").replace(/\/$/, "");
  if (salida.length > 60) throw new Error("Ruta de salida demasiado larga (" + salida.length + " caracteres): usar una de menos de 60");
  var files = [].concat(ppList(o.lights), ppList(o.flats), ppList(o.darks), ppList(o.flatDarks), ppList(o.bias));
  if (ppList(o.lights).length == 0) throw new Error("No hay lights");
  for (var i = 0; i < files.length; ++i)
    if (files[i].indexOf(",") >= 0) throw new Error("WBPP no admite comas en las rutas: " + files[i]);
  if (!File.directoryExists(salida)) File.createDirectory(salida, true);
  var par = { frameSelectionInteractive: "false", localNormalizationInteractiveMode: "false", platesolve: "false" };
  if (o.parametros) for (var k in o.parametros) par[k] = String(o.parametros[k]);
  var r = [CoreApplication.dirPath.replace(/\/bin$/, "") + "/src/scripts/BatchPreprocessing/WBPP.js", "automationMode=true",
           "outputDirectory=" + salida];
  for (var k2 in par) r.push(k2 + "=" + par[k2]);
  files.forEach(function (f) { r.push("file=" + f.replace(/\\/g, "/")); });
  var inicio = new Date();
  File.writeTextFile(salida + "/picopilot_wbpp.json", JSON.stringify({ inicio: inicio.toISOString(), ficheros: files.length, parametros: par }));
  if (!ExternalProcess.startDetached(CoreApplication.filePath, ["-n", "--automation-mode", "--no-focus-stealing", "-r=" + r.join(","), "--force-exit"]))
    throw new Error("No se pudo arrancar la segunda instancia de PixInsight");
  return { salida: salida, ficheros: files.length, lights: ppList(o.lights).length, inicio: inicio.toISOString(), parametros: par,
           nota: "WBPP corre en otra instancia de PixInsight (se cierra sola). Comprobar con estadoWBPP(\"" + salida + "\")." };
}

// Estado de un WBPP lanzado con lanzarWBPP (o de cualquier carpeta de salida de WBPP) y resumen de su log.
function estadoWBPP(salida) {
  salida = salida.replace(/\\/g, "/").replace(/\/$/, "");
  var logs = searchDirectory(salida + "/logs/*.log", false).sort();
  if (logs.length == 0) return { terminado: false, estado: "sin log todavía (arrancando)" };
  var log = logs[logs.length - 1], lines = File.readLines(log), last = "";
  for (var i = lines.length - 1; i >= 0 && !last; --i) if (lines[i].replace(/^\[[^\]]*\]\s*/, "").trim()) last = lines[i];
  var fin = /Batch Preprocessing: [\d:.]+\s*$/.test(last);
  var r = { terminado: fin, log: log, duracion: fin ? last.replace(/.*Preprocessing:\s*/, "") : null,
            pasos: [], errores: [], avisos: [], fallidos: [], masters: [], no_cumple: [], control: { medido: [], revisar_a_ojo: [] } };
  lines.forEach(function (l0) {
    var l = l0.replace(/^\[[^\]]*\]\s*/, "");
    var m;
    if ((m = l.match(/^===== (\w+): (\d+) succeeded, (\d+) failed, (\d+) skipped/))) r.pasos.push(m[1] + ": " + m[2] + " bien, " + m[3] + " fallidos");
    else if (/^\*\*\* Error/.test(l)) r.errores.push(l.substring(0, 300));
    else if (/^\*\* Warning/.test(l) && !/problem(s|\(s\))? found before|path longer than 256/i.test(l)) r.avisos.push(l.substring(0, 300));
    else if (/\[ FAILED \]/.test(l)) r.fallidos.push(l.replace(/.*frame \d+: /, "").replace(/ ---> .*/, ""));
    else if ((m = l.match(/master (\w+) saved at path (.*)$/i))) r.masters.push(m[1] + ": " + m[2].trim());
    else if ((m = l.match(/cropped master file saved at: (.*)$/))) r.masters.push("autocrop: " + m[1].trim());
  });
  ["errores", "avisos", "fallidos", "masters"].forEach(function (k) { r[k] = ppUnique(r[k], function (x) { return x; }); });
  var rep = salida + "/logs/" + File.extractName(log) + "_SmartReport.txt";
  if (File.exists(rep)) {
    var t = File.readTextFile(rep), m2 = t.match(/BAD FRAMES REJECTION[\s\S]*?\n(\d+) rejected/);
    if (m2) r.control.medido.push("WBPP rechazó " + m2[1] + " lights por su selección de frames.");
    var used = t.match(/Master (bias|dark|flat): .*/g);
    if (used) r.control.medido = r.control.medido.concat(ppUnique(used, function (x) { return x; }));
    if (/Master dark: none/.test(t.split("LIGHT FRAMES CALIBRATION")[1] || "")) r.no_cumple.push("Los lights se calibraron sin master dark.");
    if (/Master flat: none/.test(t.split("LIGHT FRAMES CALIBRATION")[1] || "")) r.no_cumple.push("Los lights se calibraron sin master flat.");
  }
  if (!fin) r.estado = "en marcha: última línea \"" + last.replace(/^\[[^\]]*\]\s*/, "").substring(0, 120) + "\"";
  if (r.errores.length) r.no_cumple.push(r.errores.length + " errores en el log (ver errores).");
  if (r.fallidos.length) r.no_cumple.push(r.fallidos.length + " ficheros fallaron (ver fallidos).");
  if (fin && !r.masters.some(function (x) { return /^Light/i.test(x); })) r.no_cumple.push("No se generó ningún master de lights.");
  return r;
}

function seleccionarSubs(x, o) {
  o = o || {};
  var fs = ppList(x);
  if (fs.length == 0) throw new Error("No hay subs en " + x);
  var fwhmTol = o.fwhmTol !== undefined ? o.fwhmTol : 0.5, fwhmDuda = o.fwhmDuda !== undefined ? o.fwhmDuda : 0.35, eccDelta = o.eccDelta !== undefined ? o.eccDelta : 0.07;
  var nubeZ = o.nubeZ !== undefined ? o.nubeZ : 2.5;
  if (typeof ImageAnalysis === "undefined") throw new Error("ImageAnalysis no está disponible (PixInsight 1.9.6 o posterior)");

  var P = new ImageAnalysis;
  P.frames = fs.map(function (f) { return [true, f, "", ""]; });
  P.task = 0;       // medir (Task_Measure)
  P.onError = 0;    // seguir con el resto
  P.weightingExpression = "PSFSignalWeight";
  P.executeGlobal();
  var C = ImageAnalysis;
  function col(n) { var k = "measurements_measurement" + n; return C[k] !== undefined ? C[k] : C.prototype[k]; }
  var iP = col("Path"), iF = col("FWHMpx"), iE = col("Eccentricity"), iS = col("Stars"), iW = col("PSFSignalWeight"),
      iCl = col("CloudExtinction"), iT = col("Trails"), iN = col("Noise"), iM = col("Median"), iFl = col("Flags");

  var subs = P.measurements.map(function (row) {
    var p = row[iP], h = {};
    try { h = ppHeader(p); } catch (e) { }
    var flags = row[iFl] || 0;
    return { fichero: p, nombre: File.extractName(p), grupo: [File.extractDirectory(p), h.filtro || "", h.exp || ""].join(" | "),
             estrellas: row[iS], fwhm_px: +row[iF].toFixed(3), excentricidad: +row[iE].toFixed(3), mediana: row[iM], ruido: row[iN],
             psf_signal_weight: row[iW], nube: (flags & 0x40) ? +row[iCl].toFixed(4) : null, trazos: (flags & 0x08) ? row[iT] : null,
             motivos: [] };
  });
  if (subs.length < fs.length) {
    var med = subs.map(function (s) { return s.fichero; });
    fs.forEach(function (f) { if (med.indexOf(f) < 0) subs.push({ fichero: f, nombre: File.extractName(f), grupo: "", motivos: ["no se pudo medir"] }); });
  }

  var grupos = ppUnique(subs.filter(function (s) { return s.grupo; }), function (s) { return s.grupo; }), resumen = [];
  for (var g = 0; g < grupos.length; ++g) {
    var S = subs.filter(function (s) { return s.grupo == grupos[g]; });
    var fw = S.map(function (s) { return s.fwhm_px; }), ec = S.map(function (s) { return s.excentricidad; });
    var fRef = ppQuantile(fw, 0.25), fMax = fRef * (1 + fwhmTol), eMax = ppMed(ec) + eccDelta;
    var nu = S.filter(function (s) { return s.nube !== null; }).map(function (s) { return s.nube; });
    var nMed = ppMed(nu), nSig = 1.4826 * ppMed(nu.map(function (v) { return Math.abs(v - nMed); }));
    var wMax = Math.max.apply(null, S.map(function (s) { return s.psf_signal_weight; }));
    S.forEach(function (s) {
      if (s.fwhm_px > fMax) s.motivos.push("FWHM " + s.fwhm_px + " px > " + fMax.toFixed(2) + " (cuartil inferior " + fRef.toFixed(2) + " + " + Math.round(100 * fwhmTol) + " %)");
      else if (s.fwhm_px > fRef * (1 + fwhmDuda)) s.duda = "FWHM " + s.fwhm_px + " px, " + Math.round(100 * (s.fwhm_px / fRef - 1)) + " % sobre el cuartil inferior";
      if (s.excentricidad > eMax) s.motivos.push("excentricidad " + s.excentricidad + " > " + eMax.toFixed(3) + " (mediana + " + eccDelta + ")");
      if (s.nube !== null && nSig > 0 && (s.nube - nMed) / nSig > nubeZ)
        s.motivos.push("extinción por nubes " + s.nube + " (z " + ((s.nube - nMed) / nSig).toFixed(1) + " > " + nubeZ + ")");
      s.peso = wMax > 0 ? +(s.psf_signal_weight / wMax).toFixed(3) : null;
    });
    resumen.push({ grupo: grupos[g], n: S.length, fwhm_ref_px: +fRef.toFixed(3), fwhm_max_px: +fMax.toFixed(3),
                   excentricidad_max: +eMax.toFixed(3), rechazados: S.filter(function (s) { return s.motivos.length; }).length });
  }
  var rech = subs.filter(function (s) { return s.motivos.length; }), apr = subs.filter(function (s) { return !s.motivos.length; });
  var r = { grupos: resumen, aprobados: apr.map(function (s) { return s.nombre; }),
            aprobados_rutas: apr.map(function (s) { return s.fichero; }),   // para lanzarWBPP({ lights: ... })
            rechazados: rech.map(function (s) { return { sub: s.nombre, motivos: s.motivos }; }),
            tabla: subs.map(function (s) { var t = {}; for (var k in s) if (k != "fichero" && k != "motivos") t[k] = s[k]; return t; }),
            no_cumple: [], control: { medido: [], revisar_a_ojo: [] } };
  if (apr.length < 0.5 * subs.length) r.no_cumple.push("Se rechaza más de la mitad de los subs (" + rech.length + " de " + subs.length + "): revisar los umbrales o la sesión.");
  var dudas = apr.filter(function (s) { return s.duda; });
  if (dudas.length) {
    r.dudosos = dudas.map(function (s) { return { sub: s.nombre, motivo: s.duda }; });
    r.control.revisar_a_ojo.push(dudas.length + " subs aprobados con FWHM entre +" + Math.round(100 * fwhmDuda) + " y +" + Math.round(100 * fwhmTol) +
                                 " % (ver dudosos): el peso ya los rebaja; quitarlos sólo si sobran subs o el usuario lo prefiere.");
  }
  var conTrazos = subs.filter(function (s) { return s.trazos; }).map(function (s) { return s.nombre; });
  if (conTrazos.length) r.control.revisar_a_ojo.push("Trazos (satélites o aviones) en " + conTrazos.join(", ") + ": no se rechazan; los quita el rechazo de la integración.");
  r.control.medido.push(subs.length + " subs medidos, " + apr.length + " aprobados, " + rech.length + " rechazados.");
  if (o.csv) {
    var lines = ["sub;grupo;estrellas;fwhm_px;excentricidad;nube;peso;aprobado;motivos"];
    subs.forEach(function (s) { lines.push([s.nombre, s.grupo, s.estrellas, s.fwhm_px, s.excentricidad, s.nube, s.peso, s.motivos.length ? "no" : "sí", s.motivos.join(" / ")].join(";")); });
    File.writeTextFile(o.csv, lines.join("\n"));
    r.csv = o.csv;
  }
  return r;
}
