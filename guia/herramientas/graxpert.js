// graxpert.js — GraXpert (línea de comandos) desde el watcher de PixInsight. PJSR, ECMAScript 5.
//
// El script GraXpert de PixInsight no se puede lanzar desde el watcher (error de script recursivo).
// Por dentro sólo guarda la imagen, ejecuta "GraXpert -cli ..." y reabre el resultado: esto hace lo mismo
// directamente con ExternalProcess, con todas las opciones de la línea de comandos de GraXpert 4.
//
// Uso:
//   var GX_EXE = "C:/ruta/a/GraXpert.exe";   // opcional, antes del eval; si no, se busca en las rutas habituales
//   eval(File.readTextFile("<carpeta del repo>/guia/herramientas/graxpert.js"));
//   var r = graxpertBGE("master");                   // sample_free, escala 10, sustracción (predeterminado)
//   var a = graxpertBGE("master", {method: "AI"});    // IA
//   // r = {corrected, model, seconds, log}: vistas GC_GraXpert_<tag> y GC_GraXpert_<tag>_model,
//   // con la solución astrométrica copiada del original.
//   var d = graxpertDenoise("starless", {strength: 0.5}); // d = {result, seconds, log}
//
// Opciones de graxpertBGE: method (sample_free por defecto, AI, RBF, Kriging, Splines), scale 1-10 (sample_free,
//   por defecto 10), smoothing 0-1,
//   correction (Subtraction, Division), aiVersion, gpu:false, prefs (fichero de preferencias con
//   puntos de muestra), extra (argumentos -sample_free_*), tag, keepFiles, maxMinutes.
// Opciones de graxpertDenoise: strength, batch, aiVersion, gpu:false, tag, keepFiles, maxMinutes.
//
// Probado con GraXpert 4.0.0 "Charon" en Windows (oct 2026). Si cambia la versión, revisar las opciones con
//   GraXpert -cli -cmd background-extraction -h
// La salida por sustracción neutraliza el color del fondo (media común de los tres canales).

if (typeof GX_EXE === 'undefined' || !GX_EXE) {
  var GX_EXE = (function () {
    var home = File.homeDirectory;
    var c = [
      home + '/AppData/Local/Programs/GraXpert/GraXpert.exe',
      'C:/Program Files/GraXpert/GraXpert.exe',
      'C:/Program Files/GraXpert/GraXpert-win64.exe',
      'C:/GraXpert/GraXpert.exe',
      '/Applications/GraXpert.app/Contents/MacOS/GraXpert',
      home + '/Applications/GraXpert.app/Contents/MacOS/GraXpert',
      '/usr/bin/GraXpert',
      '/usr/local/bin/GraXpert',
      home + '/GraXpert/GraXpert-linux'
    ];
    for (var i = 0; i < c.length; i++) if (File.exists(c[i])) return c[i];
    return '';
  })();
}
var GX_TMP = File.systemTempDirectory + '/graxpert_watcher';


// View.viewById devuelve null en el watcher v8 y un objeto con isNull en el clásico.
function gxViewExists(id) { var v = View.viewById(id); return !!v && !v.isNull; }

function gxWin(p) { return /^[A-Za-z]:/.test(p) ? File.unixPathToWindows(p) : p; }

function gxRun(args, maxMinutes) {
  if (!GX_EXE || !File.exists(GX_EXE))
    throw new Error('No encuentro GraXpert. Define var GX_EXE = "ruta/al/ejecutable" antes del eval (anótala en perfil.md).');
  var buf = '';
  var P = new ExternalProcess;
  P.onStandardOutputDataAvailable = function () { buf += String(this.stdout); };
  P.onStandardErrorDataAvailable = function () { buf += String(this.stderr); };
  var t0 = Date.now();
  var lim = (maxMinutes || 30) * 60000;
  P.start('"' + gxWin(GX_EXE) + '" -cli ' + args);
  while (P.isStarting) processEvents();
  while (P.isRunning) {
    if (Date.now() - t0 > lim) { P.kill(); throw new Error('GraXpert: tiempo agotado\n' + buf); }
    processEvents();
  }
  var log = buf.replace(/^\S+ \S+ MainProcess root /mg, '');
  if (P.exitCode != 0 || log.indexOf('ERROR') >= 0 || log.indexOf('unrecognized argument') >= 0)
    throw new Error('GraXpert ha fallado (exit ' + P.exitCode + ')\n' + log);
  return { seconds: (Date.now() - t0) / 1000, log: log };
}

function gxSafeId(id) {
  id = String(id).replace(/[^A-Za-z0-9_]/g, '_');
  if (/^[0-9]/.test(id)) id = '_' + id;
  var base = id, n = 2;
  while (gxViewExists(id)) id = base + '_' + (n++);
  return id;
}

function gxExport(view, base) {
  if (!File.directoryExists(GX_TMP)) File.createDirectory(GX_TMP, true);
  var im = view.image;
  var w = new ImageWindow(Math.round(im.width), Math.round(im.height), im.numberOfChannels, 32, true, im.isColor, 'gx_tmp_export');
  w.mainView.beginProcess();
  w.mainView.image.assign(im);
  w.mainView.endProcess();
  var p = GX_TMP + '/' + base + '.fits';
  if (File.exists(p)) File.remove(p);
  var ok = w.saveAs(p, false, false, false, false);
  w.forceClose();
  if (!ok) throw new Error('No se pudo guardar ' + p);
  return p;
}

function gxImport(path, id, srcView) {
  if (!File.exists(path)) throw new Error('GraXpert no ha generado ' + path);
  var ws = ImageWindow.open(path);
  if (!ws || ws.length == 0) throw new Error('No se pudo abrir ' + path);
  for (var i = 1; i < ws.length; i++) ws[i].forceClose();
  var w = ws[0];
  w.mainView.id = gxSafeId(id);
  if (srcView && srcView.window.hasAstrometricSolution) {
    try { w.copyAstrometricSolution(srcView.window); } catch (e) { Console.warningln('Astrometría no copiada: ' + e); }
  }
  w.show();
  return w.mainView;
}

function gxClean(paths) {
  for (var i = 0; i < paths.length; i++) try { if (File.exists(paths[i])) File.remove(paths[i]); } catch (e) {}
}

function graxpertBGE(viewId, o) {
  o = o || {};
  var v = View.viewById(viewId);
  if (!v || v.isNull) throw new Error('No existe la vista ' + viewId);
  var method = o.method || 'sample_free';
  var scale = (o.scale === undefined) ? 10 : o.scale;
  var smoothing = (o.smoothing === undefined) ? 0.1 : o.smoothing;
  var correction = o.correction || 'Subtraction';
  var base = gxSafeId('bge_' + viewId).replace(/_\d+$/, '');
  var inp = gxExport(v, base);
  var outBase = GX_TMP + '/' + base + '_GX';
  var args = '-cmd background-extraction "' + gxWin(inp) + '" -output "' + gxWin(outBase) + '"' +
    ' -interpolation ' + method + ' -correction ' + correction + ' -smoothing ' + smoothing;
  if (o.aiVersion) args += ' -ai_version ' + o.aiVersion;
  if (o.gpu === false) args += ' -gpu false';
  if (o.prefs) args += ' -preferences_file "' + gxWin(o.prefs) + '"';
  if (method == 'sample_free' && scale && (!o.extra || o.extra.indexOf('-sample_free_scale') < 0)) args += ' -sample_free_scale ' + scale;
  if (o.extra) args += ' ' + o.extra;
  args += ' -bg';
  var r = gxRun(args, o.maxMinutes);
  var tag = o.tag || ((method == 'sample_free' ? 'SF_esc' + scale : method + '_s' + String(smoothing).replace('.', '')) + (correction == 'Division' ? '_div' : ''));
  var cor = gxImport(outBase + '.fits', 'GC_GraXpert_' + tag, v);
  var mod = gxImport(outBase + '_background.fits', 'GC_GraXpert_' + tag + '_model', v);
  if (!o.keepFiles) gxClean([inp, outBase + '.fits', outBase + '_background.fits']);
  return { corrected: cor.id, model: mod.id, seconds: r.seconds, log: r.log };
}

function graxpertDenoise(viewId, o) {
  o = o || {};
  var v = View.viewById(viewId);
  if (!v || v.isNull) throw new Error('No existe la vista ' + viewId);
  var strength = (o.strength === undefined) ? 0.5 : o.strength;
  var base = gxSafeId('nr_' + viewId).replace(/_\d+$/, '');
  var inp = gxExport(v, base);
  var outBase = GX_TMP + '/' + base + '_GX';
  var args = '-cmd denoising "' + gxWin(inp) + '" -output "' + gxWin(outBase) + '" -strength ' + strength;
  if (o.batch) args += ' -batch_size ' + o.batch;
  if (o.aiVersion) args += ' -ai_version ' + o.aiVersion;
  if (o.gpu === false) args += ' -gpu false';
  var r = gxRun(args, o.maxMinutes);
  var out = gxImport(outBase + '.fits', o.tag || ('NR_GraXpert_s' + String(strength).replace('.', '')), v);
  if (!o.keepFiles) gxClean([inp, outBase + '.fits']);
  return { result: out.id, seconds: r.seconds, log: r.log };
}
