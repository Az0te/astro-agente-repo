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
  // PiCopilot Lite pone la variable global; el módulo deja el fichero ~/.picopilot/sin-internet (también vale por el MCP).
  var prohibido = (typeof PICOPILOT_INTERNET !== "undefined") ? PICOPILOT_INTERNET === false
                                                              : File.exists(File.homeDirectory + "/.picopilot/sin-internet");
  if (prohibido)
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
  var idiomas = o.idioma ? [o.idioma] : ["es", "en"], q = String(texto).toLowerCase(), reserva = null;
  for (var i = 0; i <= idiomas.length; ++i) {
    var base, lista, elegido = null;
    if (i < idiomas.length) {
      base = WB_HTTPS + idiomas[i] + ".wikipedia.org";
      var b = JSON.parse(wbTexto(base + "/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=" + wbEnc(texto)));
      lista = (b.query && b.query.search) || [];
      if (!lista.length) continue;
      // Un artículo cuyo título contiene lo buscado («IC 1396» y no «Catálogo Collinder»); si en este idioma no lo hay,
      // se prueba el siguiente y sólo al final se acepta el primer resultado del primer idioma.
      for (var j = 0; j < lista.length; ++j) if (lista[j].title.toLowerCase().indexOf(q) >= 0) { elegido = lista[j]; break; }
      if (!elegido) { if (!reserva) reserva = { i: i, base: base, lista: lista }; continue; }
    } else {
      if (!reserva) break;
      i = reserva.i; base = reserva.base; lista = reserva.lista; elegido = lista[0];
    }
    // Por pageid (sin el título en la URL: con acentos, el resumen por título daba HTTP 400 desde PixInsight).
    var d = JSON.parse(wbTexto(base + "/w/api.php?action=query&prop=extracts%7Cinfo&exintro=1&explaintext=1&inprop=url&format=json&pageids=" + elegido.pageid));
    var pg = (d.query && d.query.pages && d.query.pages[elegido.pageid]) || {};
    return { busqueda: texto, idioma: idiomas[i], titulo: elegido.title, resumen: String(pg.extract || "").replace(/\s+/g, " ").trim().substring(0, 1500),
             url: pg.fullurl || (base + "/wiki/" + wbEnc(elegido.title.replace(/ /g, "_"))),
             otros_resultados: lista.filter(function (x) { return x !== elegido; }).map(function (x) { return x.title; }), fuente: "Wikipedia (" + idiomas[i] + ")" };
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

// ---------------------------------------------------------------------------------------------------
// Ficha del objeto para el análisis (Paso 1; Rafael, 8 nov 2026): qué es, qué emite, y qué estrellas brillantes del campo
// pueden dar problemas. Acepta el id de una vista (usa OBJECT, la astrometría o RA/DEC de la cabecera) o un nombre.
//   var f = documentarObjeto("MasterLight");   // { objeto, tipo, resumen, emision, estrellas_brillantes, problemas, fuentes }

// Emisión esperada por tipo de objeto (códigos de SIMBAD). Orientativo: la imagen y las medidas mandan.
var WB_EMISION = {
  "HII": { lineas: ["Hα 656 nm (dominante)", "[OIII] 501 nm", "[SII] 672 nm", "Hβ 486 nm"], filtros: "dual band Hα/OIII o tribanda; con mono, SHO o HOO",
           nota: "Nebulosa de emisión: casi toda la señal está en las rayas; en banda ancha sale roja (Hα) con algo de azul-verde (OIII)." },
  "RNe": { lineas: ["continuo reflejado (azul)"], filtros: "banda ancha (RGB / L); los filtros de banda estrecha la apagan",
           nota: "Nebulosa de reflexión: luz de estrellas cercanas dispersada por polvo; no tiene Hα propia." },
  "DNe": { lineas: ["sin emisión: polvo que tapa el fondo"], filtros: "banda ancha y mucho tiempo; cielo oscuro",
           nota: "Nebulosa oscura: se ve por contraste con el fondo; cuidado con el gradiente (se confunde con el polvo)." },
  "PN":  { lineas: ["[OIII] 501 nm (fuerte)", "Hα 656 nm", "[NII] 658 nm", "Hβ 486 nm"], filtros: "dual band Hα/OIII; HOO",
           nota: "Nebulosa planetaria: pequeña y brillante en el centro; HDR o tomas cortas para el núcleo." },
  "SNR": { lineas: ["Hα 656 nm", "[SII] 672 nm (fuerte)", "[OIII] 501 nm"], filtros: "SHO o dual band; SII importante",
           nota: "Resto de supernova: filamentos finos; mucho tiempo en OIII y SII." },
  "Cld": { lineas: ["depende: polvo (reflexión/oscura) o gas (emisión)"], filtros: "mirar el tipo detallado", nota: "Nube interestelar." },
  "MoC": { lineas: ["polvo y gas molecular; Hα en los bordes iluminados"], filtros: "banda ancha y Hα", nota: "Nube molecular." },
  "G":   { lineas: ["continuo estelar", "Hα en regiones HII de los brazos"], filtros: "banda ancha (LRGB); Hα opcional para las regiones HII",
           nota: "Galaxia: núcleo brillante (vigilar meseta; comprimirNucleo) y brazos débiles." },
  "GlC": { lineas: ["continuo estelar"], filtros: "banda ancha", nota: "Cúmulo globular: núcleo muy denso; no sobreestirar, cuidar el color de las estrellas." },
  "OpC": { lineas: ["continuo estelar"], filtros: "banda ancha", nota: "Cúmulo abierto: el interés son las estrellas y su color." }
};

function wbAngulo(ra1, de1, ra2, de2) {
  var r = Math.PI / 180, s = Math.sin((de2 - de1) * r / 2), t = Math.sin((ra2 - ra1) * r / 2);
  return 2 * Math.asin(Math.sqrt(s * s + Math.cos(de1 * r) * Math.cos(de2 * r) * t * t)) / r;
}

function wbSexa(h, m, s, sg, d, dm, ds) {
  return [15 * (+h + m / 60 + s / 3600), (sg === "-" ? -1 : 1) * (+d + dm / 60 + ds / 3600)];
}

// Estrellas más brillantes que magMax (V) en un círculo de 'radio' grados (SIMBAD, espejo de Harvard).
function estrellasBrillantes(ra, dec, radio, magMax) {
  var crit = "region(circle, " + ra.toFixed(5) + " " + (dec >= 0 ? "+" : "") + dec.toFixed(5) + ", " + Math.round(radio * 60) + "m) & Vmag < " + (magMax || 6);
  var txt = wbTexto(WB_HTTPS + "simbad.cfa.harvard.edu/simbad/sim-sam?Criteria=" + wbEnc(crit) +
                    "&OutputMode=LIST&output.format=ASCII&list.idsel=on&list.otypesel=on&list.coo=on&list.fluxsel=on&list.fluxlst=V&list.spsel=off", { timeout: 30 });
  var out = [];
  txt.split("\n").forEach(function (l) {
    var c = l.split("|");
    if (c.length < 6 || !/^\d+$/.test(c[0].trim())) return;
    var m = /(\d+)\s+(\d+)\s+([\d.]+)\s+([+-])(\d+)\s+(\d+)\s+([\d.]+)/.exec(c[3]);
    var v = parseFloat(c[6]);
    if (!m || !isFinite(v)) return;
    var p = wbSexa(m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
    out.push({ nombre: c[1].trim(), tipo: c[2].trim(), V: v, ra_grados: +p[0].toFixed(4), dec_grados: +p[1].toFixed(4),
               distancia_arcmin: +(60 * wbAngulo(ra, dec, p[0], p[1])).toFixed(1) });
  });
  out.sort(function (a, b) { return a.V - b.V; });
  return out;
}

function documentarObjeto(vistaONombre, o) {
  o = o || {};
  var nombre = null, ra = null, dec = null, radio = o.radio || null, fuentes = [], avisos = [];
  var w = (typeof vistaONombre === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(vistaONombre)) ? ImageWindow.windowById(vistaONombre) : null;
  if (w && !w.isNull) {
    var kw = {};
    w.keywords.forEach(function (k) { kw[k.name] = k.strippedValue; });
    nombre = kw.OBJECT || null;
    var im = w.mainView.image;
    if (w.hasAstrometricSolution) {
      var c = w.imageToCelestial(im.width / 2, im.height / 2), e = w.imageToCelestial(0, 0);
      ra = c.x; dec = c.y;
      if (!radio) radio = wbAngulo(c.x, c.y, e.x, e.y);
    } else {
      if (kw.RA !== undefined && kw.DEC !== undefined && isFinite(+kw.RA) && isFinite(+kw.DEC)) { ra = +kw.RA; dec = +kw.DEC; }
      if (!radio && kw.XPIXSZ && kw.FOCALLEN) {
        var esc = 206.265 * kw.XPIXSZ / kw.FOCALLEN / 3600;   // grados/px sin drizzle: el campo sale como mucho el doble
        radio = esc * Math.sqrt(im.width * im.width + im.height * im.height) / 2;
      }
      avisos.push("sin astrometría: centro y campo aproximados (cabecera); con resolverAstrometria salen exactos");
    }
  } else nombre = String(vistaONombre);
  radio = Math.min(Math.max(radio || 1, 0.2), 3);

  var r = { objeto: nombre, centro: ra !== null ? { ra_grados: +ra.toFixed(4), dec_grados: +dec.toFixed(4) } : null, radio_campo_grados: +radio.toFixed(2) };
  // 1. Qué es (SIMBAD por nombre; si no, el objeto extenso más cercano al centro).
  var s = null;
  // OBJECT suele llevar más cosas («IC 1396 sin filtro», «M31_Ha»): primero se prueba la designación de catálogo sola.
  var cat = nombre && /\b(M|NGC|IC|Sh\s?2|LDN|LBN|vdB|Ced|Abell|Barnard|B|Mel|Cr|C|UGC|PGC|Arp|Hickson|HCG|Gum|RCW|Simeis|Sh)\s*-?\s*\d+/i.exec(nombre);
  var intentos = [];
  if (cat) intentos.push(cat[0].replace(/\s*-\s*/, " ").replace(/^sh\s?2\s*/i, "Sh2-"));
  if (nombre) intentos.push(nombre);
  for (var it = 0; it < intentos.length && !s; ++it) {
    try { s = simbad(intentos[it]); if (!s.encontrado || !s.tipo_simbad) s = null; } catch (e) { avisos.push("SIMBAD: " + (e.message || e)); }
  }
  if (!s && ra !== null) {
    try {
      var txt = wbTexto(WB_HTTPS + "simbad.cfa.harvard.edu/simbad/sim-coo?Coord=" + wbEnc(ra.toFixed(5) + " " + (dec >= 0 ? "+" : "") + dec.toFixed(5)) +
                        "&Radius=15&Radius.unit=arcmin&output.format=ASCII&OutputMode=LIST&maxObject=40", { timeout: 30 });
      var extensos = ["HII", "RNe", "DNe", "PN", "SNR", "G", "GlC", "OpC", "Cld", "MoC", "ISM", "GiG", "SBG", "Cl*", "As*", "SFR", "bub", "EmO"];
      txt.split("\n").some(function (l) {
        var c = l.split("|");
        if (c.length > 4 && extensos.indexOf(c[3].trim()) >= 0) {
          var x = simbad(c[2].trim());
          if (x.encontrado && x.tipo_simbad) { s = x; return true; }
        }
        return false;
      });
    } catch (e) { avisos.push("SIMBAD por coordenadas: " + (e.message || e)); }
  }
  if (s) {
    r.nombre_simbad = s.nombre; r.tipo = s.tipo; r.tipo_simbad = s.tipo_simbad; r.tamano_arcmin = s.tamano_arcmin;
    r.otros_nombres = (s.identificadores || []).slice(0, 8);
    if (r.centro === null && s.ra_grados !== undefined) { ra = s.ra_grados; dec = s.dec_grados; r.centro = { ra_grados: ra, dec_grados: dec }; }
    fuentes.push(s.fuente);
  } else avisos.push("no se ha podido identificar el objeto en SIMBAD");
  // 2. Descripción (Wikipedia).
  var busca = (s && s.nombre) || nombre;
  if (busca) {
    try { var wk = wikipedia(busca, o); if (wk.resumen) { r.resumen = wk.resumen; r.url = wk.url; fuentes.push(wk.fuente + ": " + wk.url); } }
    catch (e) { avisos.push("Wikipedia: " + (e.message || e)); }
  }
  // 3. Emisión esperada (por tipo; si el resumen habla de reflexión, se añade).
  var em = WB_EMISION[r.tipo_simbad] || null;
  if (em) r.emision = { lineas: em.lineas, filtros: em.filtros, nota: em.nota };
  // SIMBAD da un solo tipo (IC 1396 sale como cúmulo abierto aunque es sobre todo una región HII): se completa con el resumen.
  var extra = [];
  if (r.resumen && /emisi[oó]n|emission|regi[oó]n HII|HII region|H II/i.test(r.resumen) && r.tipo_simbad !== "HII" && r.tipo_simbad !== "PN" && r.tipo_simbad !== "SNR")
    extra.push("El resumen la describe también como nebulosa de emisión: " + WB_EMISION.HII.lineas.join(", ") + "; filtros: " + WB_EMISION.HII.filtros + ".");
  if (r.resumen && /reflexi[oó]n|reflection/i.test(r.resumen) && r.tipo_simbad !== "RNe")
    extra.push("El resumen la describe también como nebulosa de reflexión: continuo azul reflejado (banda ancha); los filtros de banda estrecha la apagan.");
  if (r.resumen && /oscura|dark nebula|polvo|dust/i.test(r.resumen) && r.tipo_simbad !== "DNe")
    extra.push("El resumen habla de polvo o nebulosa oscura: cuidado con el gradiente, que se confunde con el polvo.");
  if (extra.length) r.emision_extra = extra;
  // 4. Estrellas brillantes del campo y problemas que pueden dar.
  var problemas = [];
  if (r.centro) {
    try {
      var est = estrellasBrillantes(ra, dec, radio * 1.3, o.magMax || 6);   // un poco más que el campo: las de fuera también dan reflejos
      r.estrellas_brillantes = est.slice(0, 10);
      est.forEach(function (e) {
        var dentro = e.distancia_arcmin <= radio * 60, cerca = e.distancia_arcmin <= 20;
        if (e.V < 3) problemas.push(e.nombre + " (V " + e.V + ", a " + e.distancia_arcmin + "' del centro" + (dentro ? ", en el campo" : ", fuera del campo") +
          "): halo grande y reflejos internos, gradiente radial; tomas cortas y HDR (Paso 6), SXT puede dejar restos del halo, cuidar el estirado de estrellas.");
        else if (e.V < 5 && (dentro || cerca)) problemas.push(e.nombre + " (V " + e.V + ", a " + e.distancia_arcmin + "'): halo y posible saturación; revisar BXT/SXT alrededor y la recombinación.");
      });
      fuentes.push("SIMBAD (estrellas V < " + (o.magMax || 6) + ")");
    } catch (e) { avisos.push("estrellas brillantes: " + (e.message || e)); }
  }
  if (r.tipo_simbad === "G") problemas.push("Galaxia: núcleo que se quema al estirar (medir meseta; nucleoCandidatos) y brazos débiles (gradiente con cuidado).");
  if (r.tipo_simbad === "DNe") problemas.push("Nebulosa oscura: el gradiente se confunde con el polvo; comparar candidatos y revisar el modelo.");
  r.problemas = problemas;
  r.fuentes = fuentes;
  if (avisos.length) r.avisos = avisos;
  r.nota = "Orientativo, de internet: confirmar con las medidas de la imagen (analizarMaster) y no inventar lo que no esté aquí.";
  return r;
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
