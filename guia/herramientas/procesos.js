// procesos.js — Procesos configurados desde código, sin iconos del escritorio de PixInsight.
// PJSR, ECMAScript 5: funciona con el watcher clásico y con el v8.
//
// Uso:
//   eval(File.readTextFile("<carpeta del repo>/guia/herramientas/procesos.js"));
//   pxSPCC().executeOn(vista)                          // OSC sin filtro: Sony UV/IR-cut + QE ideal
//   pxSPCC({ narrowband: [[656.3, 5], [500.7, 5], [500.7, 5]] }).executeOn(vista)   // dual band Hα/OIII 5 nm
//   pxSPFC({ qe: "Sony IMX411/455/461/533/571" }).executeOn(vista)
//   pxMGC({ mars: "D:/ruta/MARS-DR2-1.0.3-s08.xmars", gradientScale: 2048 }).executeOn(vista)
//
// Las curvas de filtro y de QE se leen por su nombre de la base de datos de PixInsight
// (library/filters.xspd), la misma que usa el diálogo de SPCC/SPFC. pxFilterNames(/texto/) lista los
// nombres disponibles. Los valores concretos de cada equipo (filtros, QE, base MARS, escala de MGC)
// van en el perfil del usuario, no aquí.

var PX_FILTERS_DB = null;

// Constante de un proceso en los dos motores de PJSR (v8: Clase.X; clásico: Clase.prototype.X).
function pxK(C, name) {
  if (C[name] !== undefined) return C[name];
  if (C.prototype && C.prototype[name] !== undefined) return C.prototype[name];
  throw new Error("Constante no encontrada: " + name);
}

function pxFiltersDb() {
  if (PX_FILTERS_DB !== null) return PX_FILTERS_DB;
  var cands = [];
  try { cands.push(File.extractDrive(coreSrcDirPath) + File.extractDirectory(coreSrcDirPath) + "/library/filters.xspd"); } catch (e) {}
  cands.push("C:/Program Files/PixInsight/library/filters.xspd", "/Applications/PixInsight/library/filters.xspd", "/opt/PixInsight/library/filters.xspd");
  for (var i = 0; i < cands.length; ++i)
    if (File.exists(cands[i])) {
      var s = File.readTextFile(cands[i]), db = {}, re = /<Filter\s+name="([^"]+)"[^>]*\sdata="([^"]+)"/g, m;
      while ((m = re.exec(s)) !== null) db[m[1]] = m[2];
      PX_FILTERS_DB = db;
      return db;
    }
  throw new Error("No se encuentra library/filters.xspd de PixInsight");
}

// Lista de nombres de filtro/QE que contienen el texto o cumplen la expresión regular.
function pxFilterNames(pattern) {
  var db = pxFiltersDb(), out = [];
  for (var k in db) if (!pattern || (pattern.test ? pattern.test(k) : k.indexOf(pattern) >= 0)) out.push(k);
  return out.sort();
}

function pxFilter(name) {
  var d = pxFiltersDb()[name];
  if (d === undefined) throw new Error("Filtro o curva QE no encontrada en filters.xspd: \"" + name + "\". Ver pxFilterNames()");
  return d;
}

function pxDefault(o, k, v) { return (o && o[k] !== undefined) ? o[k] : v; }

// Asigna filtros RGB (y gris, en SPFC) y QE por nombre; o modo banda estrecha con [longitud de onda, ancho].
function pxSetFilters(P, o, withGray) {
  var r = pxDefault(o, "r", "Sony Color Sensor R-UVIRcut");
  var g = pxDefault(o, "g", "Sony Color Sensor G-UVIRcut");
  var b = pxDefault(o, "b", "Sony Color Sensor B-UVIRcut");
  var qe = pxDefault(o, "qe", "Ideal QE curve");
  P.redFilterName = r;   P.redFilterTrCurve = pxFilter(r);
  P.greenFilterName = g; P.greenFilterTrCurve = pxFilter(g);
  P.blueFilterName = b;  P.blueFilterTrCurve = pxFilter(b);
  if (withGray) {
    var gr = pxDefault(o, "gray", "Ideal QE curve");
    P.grayFilterName = gr; P.grayFilterTrCurve = pxFilter(gr);
  }
  P.deviceQECurveName = qe; P.deviceQECurve = pxFilter(qe);
  var nb = pxDefault(o, "narrowband", null);   // [[λR, anchoR], [λG, anchoG], [λB, anchoB]] en nm
  P.narrowbandMode = nb !== null;
  if (nb !== null) {
    P.redFilterWavelength = nb[0][0];   P.redFilterBandwidth = nb[0][1];
    P.greenFilterWavelength = nb[1][0]; P.greenFilterBandwidth = nb[1][1];
    P.blueFilterWavelength = nb[2][0];  P.blueFilterBandwidth = nb[2][1];
    if (withGray && o.grayNarrowband) { P.grayFilterWavelength = o.grayNarrowband[0]; P.grayFilterBandwidth = o.grayNarrowband[1]; }
  }
}

// SpectrophotometricColorCalibration. Opciones: r, g, b, qe (nombres de filters.xspd), narrowband,
// whiteReference (por defecto "Average Spiral Galaxy", que ya trae PixInsight), neutralizeBackground (true),
// backgroundReferenceViewId.
function pxSPCC(o) {
  o = o || {};
  var P = new SpectrophotometricColorCalibration;
  pxSetFilters(P, o, false);
  if (o.whiteReference !== undefined) P.whiteReferenceName = o.whiteReference;   // la tabla del espectro se deja la de PixInsight
  P.neutralizeBackground = pxDefault(o, "neutralizeBackground", true);
  if (o.backgroundReferenceViewId) P.backgroundReferenceViewId = o.backgroundReferenceViewId;
  P.applyCalibration = true;
  return P;
}

// SpectrophotometricFluxCalibration (prerrequisito de MGC). Opciones: r, g, b, gray, qe, narrowband, grayNarrowband.
function pxSPFC(o) {
  o = o || {};
  var P = new SpectrophotometricFluxCalibration;
  pxSetFilters(P, o, true);
  return P;
}

// MultiscaleGradientCorrection con base MARS. Opciones: mars (ruta del .xmars, obligatoria), gradientScale (1024),
// structureSeparation (3), modelSmoothness (1.0), showGradientModel (true).
function pxMGC(o) {
  o = o || {};
  if (!o.mars) throw new Error("pxMGC: falta la ruta de la base MARS (opción mars; está en el perfil)");
  if (!File.exists(o.mars)) throw new Error("No existe la base MARS: " + o.mars);
  var P = new MultiscaleGradientCorrection;
  P.useMARSDatabase = true;
  P.marsDatabaseFiles = [[true, o.mars]];
  P.gradientScale = pxDefault(o, "gradientScale", 1024);
  P.structureSeparation = pxDefault(o, "structureSeparation", 3);
  P.modelSmoothness = pxDefault(o, "modelSmoothness", 1.0);
  P.showGradientModel = pxDefault(o, "showGradientModel", true);
  return P;
}
