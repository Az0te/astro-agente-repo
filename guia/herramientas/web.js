// web.js — Consultas a internet desde PixInsight para documentar el objeto y el equipo (Rafael, 8 nov 2026). PJSR, ECMAScript 5.
//
// Pensado sobre todo para los modelos sin herramientas propias (Ollama/Qwen): con Claude Code el modelo ya tiene
// WebSearch y WebFetch. Todo es de solo lectura salvo imagenCatalogo, que abre una ventana nueva.
//   simbad("IC 63")                         tipo de objeto (SIMBAD), coordenadas, tamaño, identificadores
//   wikipedia("IC 63", { idioma: "es" })    resumen del artículo más parecido (y otros títulos)
//   imagenCatalogo("IC 63", { survey: "H-Alpha Comp", campo: 2 })   imagen de un catálogo (SkyView, NASA) en PixInsight
//   leerWeb("<url>")                        texto de una página (fabricante del filtro, ficha de la cámara...)
// No hay buscador general sin clave: para buscar, wikipedia (es / en) y, con una URL conocida, leerWeb.
// Ojo: el preprocesador de PJSR toma la doble barra como comentario aunque esté en una cadena: las URL se trocean.

var WB_UA = "PiCopilot/1.0 (astro-agente-repo; PixInsight)";
var WB_HTTPS = "https:" + "/" + "/";

function wbGet(url, o) {
  o = o || {};
  // El panel puede prohibir las consultas externas (casilla «Internet» de PiCopilot Lite).
  if (typeof PICOPILOT_INTERNET !== "undefined" && PICOPILOT_INTERNET === false)
    throw new Error("Las búsquedas en internet están desactivadas (casilla «Internet» del panel): no consultes fuera; pídeselo al usuario");
  var datos = new ByteArray, t = new NetworkTransfer;
  t.setURL(url);
  t.setConnectionTimeout(o.timeout || 20);
  t.setCustomHTTPHeaders(["User-Agent: " + WB_UA, "Accept-Language: es,en"]);
  t.onDownloadDataAvailable = function (d) { datos.add(d); return true; };
  var ok = t.download();
  return { ok: ok && t.responseCode >= 200 && t.responseCode < 300, codigo: t.responseCode, error: t.errorInformation, datos: datos };
}

function wbTexto(url, o) {
  var r = wbGet(url, o);
  if (!r.ok) throw new Error("No se pudo leer " + url + " (" + (r.error || "HTTP " + r.codigo) + ")");
  return r.datos.utf8ToString();
}

function wbEnc(s) { return encodeURIComponent(String(s)); }

// Tipos de objeto de SIMBAD más habituales en cielo profundo (códigos cortos de la salida ASCII).
var WB_TIPOS = {
  "HII": "región HII (nebulosa de emisión)", "RNe": "nebulosa de reflexión", "DNe": "nebulosa oscura", "PN": "nebulosa planetaria",
  "SNR": "resto de supernova", "ISM": "medio interestelar", "Cld": "nube", "MoC": "nube molecular", "EmO": "objeto de emisión",
  "G": "galaxia", "GiG": "galaxia en grupo", "GiC": "galaxia en cúmulo", "SBG": "galaxia con brote estelar", "Sy1": "galaxia Seyfert 1",
  "Sy2": "galaxia Seyfert 2", "AGN": "núcleo activo", "IG": "galaxias en interacción", "GrG": "grupo de galaxias", "ClG": "cúmulo de galaxias",
  "GlC": "cúmulo globular", "OpC": "cúmulo abierto", "Cl*": "cúmulo de estrellas", "As*": "asociación estelar", "*": "estrella",
  "WR*": "estrella Wolf-Rayet", "Be*": "estrella Be", "**": "estrella doble", "SFR": "región de formación estelar", "bub": "burbuja",
  "HH": "objeto Herbig-Haro", "Y*O": "objeto estelar joven", "LIN": "galaxia LINER", "H2G": "galaxia HII", "BiC": "galaxia más brillante del cúmulo"
};

// SIMBAD por nombre, con el espejo de Harvard primero (8 nov 2026: el de Estrasburgo no conectaba desde el PC de Rafael).
function simbad(objeto, o) {
  o = o || {};
  var espejos = [WB_HTTPS + "simbad.cfa.harvard.edu", WB_HTTPS + "simbad.cds.unistra.fr", WB_HTTPS + "simbad.u-strasbg.fr"], txt = null, fuente = null, errores = [];
  for (var i = 0; i < espejos.length && txt === null; ++i) {
    try { txt = wbTexto(espejos[i] + "/simbad/sim-id?Ident=" + wbEnc(objeto) + "&output.format=ASCII", { timeout: 15 }); fuente = espejos[i]; }
    catch (e) { errores.push(String(e.message || e)); }
  }
  if (txt === null) throw new Error("SIMBAD no responde: " + errores.join("; "));
  if (/No known catalog|Identifier not found|not found/i.test(txt) && !/Object /.test(txt))
    return { objeto: objeto, encontrado: false, fuente: fuente, nota: "SIMBAD no conoce ese nombre: probar otro (M, NGC, IC, Sh2, LDN...)" };
  var r = { objeto: objeto, encontrado: true, fuente: fuente + " (SIMBAD)" };
  var m = /Object\s+(.+?)\s+---\s+(\S+)\s+---/.exec(txt);
  if (m) { r.nombre = m[1].trim(); r.tipo_simbad = m[2]; r.tipo = WB_TIPOS[m[2]] || m[2]; }
  var c = /Coordinates\(ICRS[^)]*\):\s*(\d+)\s+(\d+)\s+([\d.]+)\s+([+-])(\d+)\s+(\d+)\s+([\d.]+)/.exec(txt);
  if (c) {
    r.ra_grados = +(15 * (+c[1] + c[2] / 60 + c[3] / 3600)).toFixed(5);
    r.dec_grados = +((c[4] === "-" ? -1 : 1) * (+c[5] + c[6] / 60 + c[7] / 3600)).toFixed(5);
    r.ra = c[1] + "h " + c[2] + "m " + c[3] + "s"; r.dec = c[4] + c[5] + "° " + c[6] + "' " + c[7] + "\"";
  }
  var a = /Angular size:\s*([\d.~]+)\s+([\d.~]+)/.exec(txt);
  if (a && a[1] !== "~") r.tamano_arcmin = [+a[1], a[2] !== "~" ? +a[2] : null];
  var fl = [], re = /Flux (\w+)\s*:\s*([-\d.]+)/g, f;
  while ((f = re.exec(txt)) !== null) fl.push(f[1] + " " + f[2]);
  if (fl.length) r.magnitudes = fl;
  var ids = /Identifiers \(\d+\):\s*([\s\S]*?)(\n\s*\n|Bibcodes|Measures|Notes)/.exec(txt);
  if (ids) r.identificadores = ids[1].split(/\s{2,}|\n/).map(function (s) { return s.trim(); }).filter(function (s) { return s; }).slice(0, 20);
  return r;
}

// Wikipedia: busca y devuelve el resumen del mejor resultado (idioma "es" por defecto; si no hay, prueba "en").
function wikipedia(texto, o) {
  o = o || {};
  var idiomas = o.idioma ? [o.idioma] : ["es", "en"], ult = null;
  for (var i = 0; i < idiomas.length; ++i) {
    var base = WB_HTTPS + idiomas[i] + ".wikipedia.org";
    var b = JSON.parse(wbTexto(base + "/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=" + wbEnc(texto)));
    var lista = (b.query && b.query.search) || [];
    if (!lista.length) { ult = idiomas[i]; continue; }
    var titulo = lista[0].title;
    var s = JSON.parse(wbTexto(base + "/api/rest_v1/page/summary/" + wbEnc(titulo.replace(/ /g, "_"))));
    return { busqueda: texto, idioma: idiomas[i], titulo: titulo, resumen: s.extract || "",
             url: (s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page) || (base + "/wiki/" + wbEnc(titulo)),
             otros_resultados: lista.slice(1).map(function (x) { return x.title; }), fuente: "Wikipedia (" + idiomas[i] + ")" };
  }
  return { busqueda: texto, encontrado: false, nota: "Sin resultados en Wikipedia (" + idiomas.join(", ") + ")" };
}

// Texto de una página web (sin etiquetas, scripts ni estilos), recortado a 'max' caracteres (6000).
function leerWeb(url, o) {
  o = o || {};
  if (!/^https?:/i.test(String(url))) throw new Error("leerWeb necesita una URL completa (https:...)");
  var h = wbTexto(String(url), o), max = o.max || 6000;
  var titulo = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h) || [])[1] || "";
  // Si la página marca su contenido principal (<main>, <article> o el de Wikipedia), sólo eso: sin menús ni pies.
  var cuerpo = /<main[\s\S]*?<\/main>/i.exec(h) || /<article[\s\S]*?<\/article>/i.exec(h) || /id="mw-content-text"[\s\S]*$/i.exec(h);
  if (cuerpo) h = cuerpo[0];
  var t = h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
           .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
           .replace(/\s+/g, " ").trim();
  return { url: url, titulo: titulo.replace(/\s+/g, " ").trim(), caracteres: t.length, texto: t.length > max ? t.substring(0, max) + " …[recortado]" : t };
}

// Imagen de un catálogo con SkyView (NASA) abierta en PixInsight como FITS. posicion: nombre del objeto ("IC 63"),
// "ra, dec" en grados, o el id de una vista con astrometría (usa su centro y su campo).
//   survey: "DSS2 Red" (por defecto), "DSS2 Blue", "DSS2 IR", "H-Alpha Comp" (mapa Hα de todo el cielo, ~6'), "WISE 12",
//           "2MASS-K", "GALEX Near UV", "SDSSr"...; campo (grados, 1 por defecto), pixeles (1000).
// Para comparar: dónde hay Hα u OIII esperable, estructuras débiles reales frente a gradientes, nebulosas oscuras.
function imagenCatalogo(posicion, o) {
  o = o || {};
  var survey = o.survey || "DSS2 Red", campo = o.campo || 1, pix = o.pixeles || 1000, pos = String(posicion);
  var w = (typeof posicion === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(posicion)) ? ImageWindow.windowById(posicion) : null;
  if (w && !w.isNull && w.hasAstrometricSolution) {
    var im = w.mainView.image, c = w.imageToCelestial(im.width / 2, im.height / 2);
    pos = c.x.toFixed(5) + "," + c.y.toFixed(5);
    if (!o.campo) {
      var p0 = w.imageToCelestial(0, im.height / 2), p1 = w.imageToCelestial(im.width, im.height / 2);
      var dra = (p1.x - p0.x) * Math.cos(c.y * Math.PI / 180);
      campo = +Math.max(0.1, Math.sqrt(dra * dra + (p1.y - p0.y) * (p1.y - p0.y))).toFixed(3);
    }
  }
  var url = WB_HTTPS + "skyview.gsfc.nasa.gov/current/cgi/runquery.pl?Survey=" + wbEnc(survey) + "&Position=" + wbEnc(pos) +
            "&Pixels=" + pix + "&Size=" + campo + "&Return=FITS";
  var r = wbGet(url, { timeout: 60 });
  if (!r.ok) throw new Error("SkyView no devolvió la imagen (" + (r.error || "HTTP " + r.codigo) + ")");
  if (r.datos.length < 3000) throw new Error("SkyView no tiene esa zona en " + survey + " o no conoce la posición: " + r.datos.utf8ToString().substring(0, 200));
  var dir = File.systemTempDirectory + "/PiCopilotCatalogo";
  if (!File.directoryExists(dir)) File.createDirectory(dir, true);
  var f = dir + "/" + (survey + "_" + pos).replace(/[^A-Za-z0-9_.-]+/g, "_") + ".fits";
  var fh = new File; fh.createForWriting(f); fh.write(r.datos); fh.close();
  if (o.abrir === false) return { fichero: f, survey: survey, posicion: pos, campo_grados: campo };
  var ws = ImageWindow.open(f);
  if (!ws.length) throw new Error("No se pudo abrir " + f);
  var id = ("Cat_" + survey).replace(/[^A-Za-z0-9_]+/g, "_");
  for (var n = 2; !ImageWindow.windowById(id).isNull; ++n) id = ("Cat_" + survey).replace(/[^A-Za-z0-9_]+/g, "_") + "_" + n;
  ws[0].mainView.id = id;
  ws[0].show();
  return { vista: id, fichero: f, survey: survey, posicion: pos, campo_grados: campo, pixeles: pix, fuente: "SkyView (NASA GSFC)",
           nota: "Imagen de referencia de un catálogo: no es para combinar con la tuya (otra escala y otro filtro)." };
}
