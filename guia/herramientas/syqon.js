// syqon.js — SyQon Studio (syqon-cli) desde PixInsight. PJSR, ECMAScript 5.
//
// syqon-cli es el programa de línea de comandos de SyQon Studio (1.2.0, 22 nov 2026). Como graxpert.js: se guarda la
// vista en un XISF temporal, se lanza el modelo con ExternalProcess y el resultado se pone en una vista NUEVA (la de
// entrada no cambia). Lo usan gradienteCandidatos (deep-gradient), ruidoCandidatos (prism-essential), bxtCandidatos
// (parallax-nano) y separarEstrellas (axiom-mini, motor: "syqon").
//
// Uso:
//   var SQ_EXE = "C:/ruta/syqon-cli.exe";   // opcional; si no, registro (App Paths) o %LOCALAPPDATA%\Programs\SyQon Studio
//   eval(File.readTextFile("<guia>/herramientas/syqon.js"));
//   syqonEstado();                                     // { disponible, version, modelos: { "prism-essential": {...} } }
//   var r = syqonRuido("master", { nuevaVista: "master_prism" });          // r = { vista, comando, segundos, volteada }
//   var g = syqonGradiente("master", { nuevaVista: "GC_SYQON" });          // g = { vista, modelo, ... }
//   var e = syqonEstrellas("estirada", { nuevaVista: "sl", nuevasEstrellas: "st" });   // e = { starless, estrellas, ... }
//   var p = syqonParallax("master", { aplicacion: 0.5 });                  // p = { vista, saturados_antes/despues, descartar? }
//
// Lo comprobado con un recorte de 1500 px del master RGB de IC 405 (22 nov 2026):
// - prism-essential (ruido) solo admite lineal (en no lineal da código 2); deja ~la mitad del ruido.
// - axiom-mini (estrellas) solo vale sobre imagen ESTIRADA con --domain nonlinear: en lineal, con --axiom-stretch auto la
//   starless sale plana, y con identity deja una rejilla magenta y la capa de estrellas solo en verde.
// - deep-gradient (gradiente) necesita internet y las bases de ASTAP (resuelve el campo); corre en CPU, de 5 s a ~2 min.
// - parallax-nano (corrección/deconvolución) recorta a 1,0 en lineal desde la etapa de corrección: --application 0,5 y se
//   descarta si satura más píxeles que la original.
// - SyQon pone ROWORDER = TOP-DOWN en sus FITS y voltea o no las filas según la entrada: se intercambia en XISF y, por si
//   acaso, se compara la salida con la entrada y se voltea si sale al revés.
// - Deja ficheros .syq-export-* junto a la salida: se trabaja en una carpeta temporal propia que se vacía.
// Códigos de salida: 0 bien, 2 dominio u opción no válida, 3 ruta, 4 licencia o modelo no disponible, 5/6 fallo.

var SQ_TMP = File.systemTempDirectory + "/piastropilot_syqon";
var SQ_ESTADO = null, SQ_SIN_LICENCIA = {};
var SQ_GRATIS = ["axiom-mini", "prism-essential", "parallax-nano", "deep-gradient"];

function sqWin(p) { return /^[A-Za-z]:/.test(p) ? File.unixPathToWindows(p) : p; }

// Ejecuta un programa y devuelve { codigo, salida, segundos }. Sin excepción si el código no es 0.
function sqProceso(cmd, maxMinutos) {
  var buf = "", P = new ExternalProcess, t0 = Date.now(), lim = (maxMinutos || 30) * 60000;
  P.onStandardOutputDataAvailable = function () { buf += String(this.stdout); };
  P.onStandardErrorDataAvailable = function () { buf += String(this.stderr); };
  P.start(cmd);
  while (P.isStarting) processEvents();
  while (P.isRunning) {
    if (Date.now() - t0 > lim) { P.kill(); throw new Error("SyQon: tiempo agotado (" + (maxMinutos || 30) + " min)\n" + buf.slice(-400)); }
    processEvents();
  }
  return { codigo: P.exitCode, salida: buf, segundos: (Date.now() - t0) / 1000 };
}

function sqExe() {
  if (typeof SQ_EXE === "string" && SQ_EXE && File.exists(SQ_EXE)) return SQ_EXE;
  var c = [File.homeDirectory + "/AppData/Local/Programs/SyQon Studio/syqon-cli.exe",
           "/Applications/SyQon Studio.app/Contents/MacOS/syqon-cli", "/usr/local/bin/syqon-cli"];
  for (var i = 0; i < c.length; ++i) if (File.exists(c[i])) return c[i];
  if (File.directoryExists("C:/Windows")) {
    try {   // registro: HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\syqon-cli.exe (valor por defecto)
      var r = sqProceso('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\syqon-cli.exe" /ve', 1);
      var m = /REG_SZ\s+(.+\.exe)/i.exec(r.salida);
      if (m && File.exists(m[1].trim().replace(/\\/g, "/"))) return m[1].trim().replace(/\\/g, "/");
    } catch (e) { }
  }
  return "";
}

// Versión y modelos (--version, --list-models). La lista dice la clase de licencia (free, included, paid...), no si la
// cuenta tiene acceso: eso se sabe al lanzar (código 4).
function syqonEstado(refrescar) {
  if (SQ_ESTADO && !refrescar) return SQ_ESTADO;
  var e = sqExe(), r = { exe: e || null, disponible: false, modelos: {} };
  if (e) {
    try {
      var v = sqProceso('"' + sqWin(e) + '" --version', 1);
      r.disponible = v.codigo == 0;
      r.version = v.salida.trim().split(/\r?\n/).pop();
      var l = sqProceso('"' + sqWin(e) + '" --list-models', 1).salida.split(/\r?\n/);
      for (var i = 0; i < l.length; ++i) {
        var m = /^\s*([a-z0-9][a-z0-9-]*)\s{2,}([a-z][a-z ]*?)\s+[^\sa-z0-9]+\s+(.*)$/i.exec(l[i]);   // «·» puede llegar mal codificado
        if (m) r.modelos[m[1]] = { licencia: m[2], nombre: m[3] };
      }
    } catch (x) { r.error = String(x).slice(0, 200); }
  }
  if (!r.disponible) r.nota = "SyQon Studio no está instalado (o syqon-cli no responde): los candidatos de SyQon se omiten.";
  SQ_ESTADO = r;
  return r;
}

// true si syqon-cli responde y, con modelo, si está en su lista y no ha dado ya código 4.
function sqHay(modelo) {
  var e = syqonEstado();
  if (!e.disponible) return false;
  if (!modelo) return true;
  var hayLista = false; for (var k in e.modelos) { hayLista = true; break; }
  if (hayLista && !e.modelos[modelo]) return false;
  return !SQ_SIN_LICENCIA[modelo];
}

function sqLimpiar() {
  if (!File.directoryExists(SQ_TMP)) { File.createDirectory(SQ_TMP, true); return; }
  var ff = searchDirectory(SQ_TMP + "/*", false);
  for (var i = 0; i < ff.length; ++i) try { File.remove(ff[i]); } catch (e) { }
  var ocultos = searchDirectory(SQ_TMP + "/.syq*", false);
  for (var j = 0; j < ocultos.length; ++j) try { File.remove(ocultos[j]); } catch (e2) { }
}

function sqGuardar(view, ruta) {
  var im = view.image;
  var w = new ImageWindow(im.width, im.height, im.numberOfChannels, 32, true, im.isColor, "sq_tmp_export");
  w.mainView.beginProcess(); w.mainView.image.assign(im); w.mainView.endProcess();
  if (File.exists(ruta)) File.remove(ruta);
  var ok = w.saveAs(ruta, false, false, false, false);
  w.forceClose();
  if (!ok) throw new Error("No se pudo guardar " + ruta);
}

// Luminancia de una rejilla n×n de puntos (para comparar orientaciones).
function sqRejilla(img, n) {
  var W = img.width, H = img.height, C = img.numberOfChannels, a = [];
  for (var j = 0; j < n; ++j) for (var i = 0; i < n; ++i) {
    var x = Math.floor((i + 0.5) * W / n), y = Math.floor((j + 0.5) * H / n), s = 0;
    for (var c = 0; c < C; ++c) s += img.sample(x, y, c);
    a.push(s / C);
  }
  return a;
}

function sqCorr(a, b) {
  var n = a.length, ma = 0, mb = 0, i;
  for (i = 0; i < n; ++i) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  var sab = 0, saa = 0, sbb = 0;
  for (i = 0; i < n; ++i) { var x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

// true si 'out' es 'src' volteada arriba-abajo (rejilla de 128×128 puntos, suavizada 3×3 para no depender de una estrella).
function sqVolteada(src, out) {
  var n = 128, A = sqRejilla(src, n), B = sqRejilla(out, n), Bv = [];
  for (var j = 0; j < n; ++j) for (var i = 0; i < n; ++i) Bv.push(B[(n - 1 - j) * n + i]);
  return sqCorr(A, Bv) > sqCorr(A, B) + 0.05;
}

function sqVoltear(view) {
  var im = view.image, W = im.width, H = im.height, f = new Float32Array(W), g = new Float32Array(W);
  view.beginProcess();
  for (var c = 0; c < im.numberOfChannels; ++c)
    for (var y = 0; y < (H >> 1); ++y) {
      var r1 = new Rect(0, y, W, y + 1), r2 = new Rect(0, H - 1 - y, W, H - y);
      im.getSamples(f, r1, c); im.getSamples(g, r2, c);
      im.setSamples(g, r1, c); im.setSamples(f, r2, c);
    }
  view.endProcess();
}

// Abre 'ruta' y pone sus píxeles en una vista nueva 'id' (copia de 'src': astrometría y palabras clave).
function sqVistaNueva(src, ruta, id, voltear) {
  if (!File.exists(ruta)) throw new Error("SyQon no ha generado " + ruta);
  var ws = ImageWindow.open(ruta);
  if (!ws || !ws.length) throw new Error("No se pudo abrir " + ruta);
  for (var i = 1; i < ws.length; ++i) ws[i].forceClose();
  var im = ws[0].mainView.image, si = src.image;
  if (im.width != si.width || im.height != si.height) {
    ws[0].forceClose();
    throw new Error("SyQon devolvió " + im.width + "×" + im.height + " y la imagen es " + si.width + "×" + si.height);
  }
  var nid = id, n = 2;
  while (!ImageWindow.windowById(nid).isNull) nid = id + "_" + (n++);
  var w = new ImageWindow(si.width, si.height, si.numberOfChannels, 32, true, si.isColor, nid);
  w.mainView.beginProcess();
  if (im.numberOfChannels == si.numberOfChannels) w.mainView.image.assign(im);
  else {   // color ↔ mono: media o repetición
    var Wd = si.width, Hd = si.height, R = new Rect(0, 0, Wd, Hd), b = new Float32Array(Wd * Hd), s = new Float32Array(Wd * Hd);
    if (im.numberOfChannels == 1) { im.getSamples(b, R, 0); for (var c = 0; c < si.numberOfChannels; ++c) w.mainView.image.setSamples(b, R, c); }
    else {
      for (var c2 = 0; c2 < im.numberOfChannels; ++c2) { im.getSamples(b, R, c2); for (var k = 0; k < s.length; ++k) s[k] += b[k] / im.numberOfChannels; }
      w.mainView.image.setSamples(s, R, 0);
    }
  }
  w.mainView.endProcess();
  ws[0].forceClose();
  if (voltear === undefined) voltear = sqVolteada(si, w.mainView.image);
  if (voltear) sqVoltear(w.mainView);
  if (src.window.hasAstrometricSolution) try { w.copyAstrometricSolution(src.window); } catch (e) { }
  try { w.keywords = src.window.keywords; } catch (e2) { }
  w.show();
  return { id: w.mainView.id, volteada: !!voltear };
}

// Lanza 'modelo' sobre la vista. o: { dominio: "linear"|"nonlinear", extra: [args], estrellas: true, nuevaVista,
// nuevasEstrellas, maxMinutos }. Error con e.codigo (4 = licencia o modelo no disponible).
function syqonCorrer(viewId, modelo, o) {
  o = o || {};
  var v = View.viewById(viewId);
  if (!v || v.isNull) throw new Error("No existe la vista " + viewId);
  var e = sqExe();
  if (!e) { var en = new Error("SyQon Studio no está instalado (no encuentro syqon-cli)."); en.codigo = null; throw en; }
  v.image.resetSelections();
  sqLimpiar();
  var ent = SQ_TMP + "/entrada.xisf", sal = SQ_TMP + "/salida.xisf", est = SQ_TMP + "/estrellas.xisf";
  sqGuardar(v, ent);
  var args = ["-m", modelo, "--domain", o.dominio || "linear", "--precision", "f32", "--overwrite", "--quiet"].concat(o.extra || []);
  var cmd = '"' + sqWin(e) + '" ' + args.join(" ") + (o.estrellas ? ' --stars-output "' + sqWin(est) + '"' : "") +
            ' "' + sqWin(ent) + '" "' + sqWin(sal) + '"';
  var r = sqProceso(cmd, o.maxMinutos);
  var texto = "syqon-cli " + args.join(" ") + (o.estrellas ? " --stars-output" : "");
  if (r.codigo != 0 || !File.exists(sal)) {
    if (r.codigo == 4) SQ_SIN_LICENCIA[modelo] = true;
    var msg = { 2: "dominio u opción no válida", 3: "ruta no válida", 4: "licencia o modelo no disponible", 5: "fallo del modelo", 6: "fallo del modelo" }[r.codigo] || "fallo";
    var lineas = r.salida.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).filter(function (x) { return x.trim(); });
    var err = new Error("SyQon " + modelo + ": código " + r.codigo + " (" + msg + "): " + lineas.slice(-3).join(" | ").slice(0, 400));
    err.codigo = r.codigo;
    sqLimpiar();
    throw err;
  }
  try {
    var out = sqVistaNueva(v, sal, o.nuevaVista || (viewId + "_syqon"));
    var res = { vista: out.id, volteada: out.volteada, comando: texto, segundos: Math.round(r.segundos * 10) / 10 };
    var pr = /provider=(\w+)/g, m, ult = null;
    while ((m = pr.exec(r.salida)) !== null) ult = m[1];
    if (ult) res.proveedor = ult;
    if (o.estrellas && File.exists(est)) res.estrellas = sqVistaNueva(v, est, o.nuevasEstrellas || (viewId + "_syqon_estrellas"), out.volteada).id;
    return res;
  } finally { sqLimpiar(); }
}

function sqMediana(viewId) { var v = View.viewById(viewId); v.image.resetSelections(); return v.image.median(); }

// prism-essential: solo lineal.
function syqonRuido(viewId, o) {
  o = o || {};
  if (sqMediana(viewId) > 0.05) { var e = new Error("SyQon Prism solo admite imagen lineal (en no lineal syqon-cli da código 2)."); e.codigo = 2; throw e; }
  return syqonCorrer(viewId, "prism-essential", { dominio: "linear", nuevaVista: o.nuevaVista || (viewId + "_prism"), maxMinutos: o.maxMinutos });
}

// deep-gradient sobre lineal. El modelo (vista <nuevaVista>_modelo) es original − corregida + su mínimo: exactamente lo
// que quita (el --gradient-output de SyQon salía casi plano, ±1e-4, y no servía para medir copia_objeto).
function syqonGradiente(viewId, o) {
  o = o || {};
  if (typeof PIASTROPILOT_INTERNET !== "undefined" && PIASTROPILOT_INTERNET === false) {
    var ei = new Error("SyQon DeepGradient necesita internet y la casilla Internet está desmarcada."); ei.codigo = "sin_internet"; throw ei;
  }
  var nombre = o.nuevaVista || (viewId + "_deepgradient");
  var r = syqonCorrer(viewId, "deep-gradient", { dominio: "linear", nuevaVista: nombre, maxMinutos: o.maxMinutos || 15 });
  var src = View.viewById(viewId).image, cor = View.viewById(r.vista).image, W = src.width, H = src.height, R = new Rect(0, 0, W, H);
  var mid = r.vista + "_modelo", n = 2; while (!ImageWindow.windowById(mid).isNull) mid = r.vista + "_modelo_" + (n++);
  var w = new ImageWindow(W, H, src.numberOfChannels, 32, true, src.isColor, mid), a = new Float32Array(W * H), b = new Float32Array(W * H);
  w.mainView.beginProcess();
  for (var c = 0; c < src.numberOfChannels; ++c) {
    src.getSamples(a, R, c); cor.getSamples(b, R, c);
    var mn = 1e9; for (var i = 0; i < a.length; ++i) { a[i] -= b[i]; if (a[i] < mn) mn = a[i]; }
    for (var k = 0; k < a.length; ++k) a[k] -= mn;
    w.mainView.image.setSamples(a, R, c);
  }
  w.mainView.endProcess();
  w.show();
  r.modelo = mid;
  r.nota = "Necesita internet (referencia del cielo de SyQon y bases de ASTAP).";
  return r;
}

// axiom-mini sobre imagen ESTIRADA (--domain nonlinear). En lineal se niega.
function syqonEstrellas(viewId, o) {
  o = o || {};
  if (sqMediana(viewId) < 0.05) {
    var e = new Error("SyQon Axiom Mini solo funciona sobre imagen estirada: en lineal la starless sale plana o con rejilla magenta. Estira primero o usa StarX.");
    e.codigo = 2; throw e;
  }
  var r = syqonCorrer(viewId, "axiom-mini", { dominio: "nonlinear", estrellas: true, nuevaVista: o.nuevaVista || (viewId + "_starless"),
                                               nuevasEstrellas: o.nuevasEstrellas || (viewId + "_estrellas"), maxMinutos: o.maxMinutos });
  r.starless = r.vista;
  return r;
}

function sqSaturados(viewId, umbral) {
  var im = View.viewById(viewId).image, W = im.width, H = im.height, R = new Rect(0, 0, W, H), a = new Float32Array(W * H);
  var hit = new Uint8Array(W * H), u = umbral || 0.9999, n = 0;
  for (var c = 0; c < im.numberOfChannels; ++c) { im.getSamples(a, R, c); for (var i = 0; i < a.length; ++i) if (a[i] >= u) hit[i] = 1; }
  for (var j = 0; j < hit.length; ++j) n += hit[j];
  return n;
}

// parallax-nano (experimental): corrección + deblur (sin reducción) mezclado con --application.
function syqonParallax(viewId, o) {
  o = o || {};
  var ap = (o.aplicacion !== undefined) ? o.aplicacion : 0.5, lineal = sqMediana(viewId) < 0.05;
  var extra = ["--correction", "true", "--reduction", "false", "--deblur", o.deblur === false ? "false" : "true", "--application", String(ap)];
  var r = syqonCorrer(viewId, "parallax-nano", { dominio: lineal ? "linear" : "nonlinear", extra: extra,
                                                  nuevaVista: o.nuevaVista || (viewId + "_parallax"), maxMinutos: o.maxMinutos });
  r.saturados_antes = sqSaturados(viewId); r.saturados_despues = sqSaturados(r.vista);
  if (r.saturados_despues > r.saturados_antes + Math.max(10, Math.floor(r.saturados_antes / 20)))
    r.descartar = "SyQon Parallax satura " + r.saturados_despues + " píxeles (la original " + r.saturados_antes + "): recorta los núcleos a 1,0. Experimental: descartado.";
  return r;
}
