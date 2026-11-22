# Anexo K: cómo se hace cada paso en Seti Astro Suite Pro (SASpro)

[← Índice](../SKILL.md)

Bajo demanda: sólo hace falta con el servidor **setiastropilot** conectado (SASpro 1.24 o posterior con el script SetiAstroPilot lanzado desde el menú Scripts > AstroPilot). Las fichas dicen **qué** hacer y con **qué criterios**; aquí sólo está **con qué herramienta o proceso de SASpro**. Los nombres de las medidas son los mismos que en las fichas.

<a id="arranque"></a>
## Arranque en SASpro (leer con SKILL.md)

**Entorno.** SASpro con el script SetiAstroPilot lanzado (puente dentro de SASpro) y el servidor MCP `setiastropilot`, o el chat de SetiAstroPilot (se abre con el mismo script). Cada herramienta es una entrada del manifiesto (`sas/herramientas/manifiesto.json`). El agente no escribe código: los procesos de SASpro sólo con `procesoSAS` (lista blanca) y sus parámetros con `ayudaProceso`.

**Varias vistas.** Como en PixInsight, hay varias imágenes abiertas: `vistas` las lista y casi todas las herramientas llevan `vista` (nombre o uid). Sin `vista` se usa la activa. Tras `separarEstrellas` hay dos: la starless (queda activa) y la de estrellas.

**Herramientas por paso** (en negrita las que comparan sin cambiar la vista; el elegido se pone con `aplicarCandidato`)

| Paso | Herramientas |
|---|---|
| L1 Análisis | `analizarMaster`, `cabecera`, `estadisticas`, `previa`; con internet `documentarObjeto`, `simbad`, `wikipedia`, `leerWeb` |
| L5 Alineado | `alinearMasters` (por astrometría; recorte común) |
| L6 HDR | `componerHDR` (larga + corta, en lineal) |
| L7 Dual band | `desmezclarDualBand` de cada dual band; `unirCapas` para las capas de la misma raya (OIII de HaO3 + SO3, SII de SHb + SO3) |
| L8 Astrometría | `resolverAstrometria` (resolvedor de SASpro con su índice Gaia; ASTAP o astrometry.net si están configurados) |
| L9 Gradiente | **`gradienteCandidatos`** (ABE polinomio 1 y 2, ABE con RBF, GraXpert IA, SyQon DeepGradient) → `aplicarCandidato` |
| L10 Combinación | `combinarRGB` (mono con rueda) en su sitio; la inyección, **`combinarCandidatos`** → `aplicarCandidato`, con la RGB ya calibrada (tras L12) y antes de separar estrellas: como en Siril, la herramienta mide el continuo en las estrellas y las deja fuera ([Anexo I](I-siril.md)) |
| L12 Color | `neutralizarFondo` → `calibrarColor` (White Balance con las estrellas); devuelven el cielo por canal antes y después |
| L15 Estrellas | `separarEstrellas` (StarNet, DarkStar o SyQon; `syqon_cli` = SyQon Axiom Mini de SyQon Studio, solo estirada) |
| NL1 Estirado | **`estirarCandidatos`** (estadístico, GHS y MTF propio) → `aplicarCandidato` |
| NL2 Paletas | **`paletasCandidatos`** (capas estiradas; pasa ha, oiii, sii y hb: la Natural usa las cuatro) → `aplicarCandidato` |
| NL3 Verde | `quitarVerde` (SCNR propio que sólo baja el verde; `metodo: sas` para el de SASpro) |
| NL5 Realces | **`nucleoCandidatos`** (galaxias), **`contrasteCandidatos`**, **`saturacionCandidatos`** → `aplicarCandidato`, en ese orden |
| L14 / NL6 Ruido | **`ruidoCandidatos`** (Cosmic Clarity, NoiseX, GraXpert, SyQon Prism en lineal) → `aplicarCandidato` |
| NL7 Nitidez | **`nitidezCandidatos`** (Cosmic Clarity sharpen) → `aplicarCandidato` |
| NL8 Estrellas | **`estirarEstrellas`** (de la vista de estrellas) → `aplicarCandidato` |
| NL9 Recombinación | `recombinarEstrellas` (starless + vista de estrellas, screen) |
| NL10 Exportación | `exportarFinal` |

**Siempre disponibles:** `ping`, `vistas`, `imagen`, `cabecera`, `estadisticas`, `previa` (también de un candidato y de un recorte), `registro`, `abrirImagen`, `guardarImagen`, `duplicarVista`, `activarVista`, `cerrarVista`, `deshacer`, `rehacer`, `procesoSAS`, `ayudaProceso`, `estado` (trabajos largos).

**Guardar.** Las versiones van en `.xisf` (32 bits en coma flotante) con nombre nuevo, en una carpeta nueva junto al master. Nunca sobre el master.

**SyQon Studio (`syqon-cli`).** Aparte del SyQon interno de SASpro, si SyQon Studio está instalado los `*Candidatos` añaden sus modelos gratuitos (ver [Anexo L](L-syqon.md)): DeepGradient en el gradiente, Prism en el ruido (solo lineal), Parallax Nano experimental en `deconvolucionCandidatos` y Axiom Mini con `separarEstrellas(motor: "syqon_cli")` (solo estirada). `ping` dice si está.

**Aceleración.** Cosmic Clarity, SyQon, DarkStar y aberration_ai necesitan el entorno de IA de SASpro (PyTorch; con una AMD, torch-directml). Si falta, o se instaló después de arrancar SASpro, la herramienta lo dice: hay que instalarlo en Preferencias y reiniciar SASpro.

## Lo que se sabe de SASpro 1.24.2 (13 nov 2026)

- ABE normaliza el resultado (× 0,998): `gradienteCandidatos` lo descuenta (`escala_pct`).
- El estirado estadístico a mediana 0,2–0,3 (objetivo propio de SASpro, histórico: no el de la guía, cielo 0,10 / 0,07) deja algunas imágenes casi negras: `estirarCandidatos` lo descarta y añade un MTF propio.
- WaveScale HDR sin ventana se cuelga: no se usa por defecto.
- SFCC y Halo-B-Gon sólo tienen ventana: sin herramienta.

## SASpro 1.24.5 (arreglos pedidos por Rafael, nov 2026)

Las herramientas miran la versión al ejecutarse: con 1.24.5 o posterior usan lo nuevo y, con versiones anteriores, siguen
con los rodeos de arriba.

- `guardarImagen` guarda con `save_document` (como «Guardar como», con la astrometría) y `cerrarVista` cierra con
  `close_document`.
- `estirarCandidatos` vuelve a ofrecer el estirado estadístico de SASpro (sin normalizar, para que la mediana caiga en el
  objetivo); se descarta si se desvía más de un 20 %.
- `nucleoCandidatos` añade el comando WaveScale HDR, que ya termina, junto al cálculo propio.
- `resolverAstrometria` pasa la semilla en grados con `ra_deg`/`dec_deg`. Una RA decimal de 24 o menos sin unidad se lee
  en horas, como en el diálogo de SASpro.
- Herramienta nueva `halosCandidatos`: Halo-B-Gon a varias reducciones, con el halo medido alrededor de las estrellas
  brillantes y control de anillos oscuros.
- Se quedan sin herramienta, por decisión del autor: SFCC (el usuario debe revisar el emparejado de estrellas) y el
  apilado (Stacking Suite).
- Los FITS que guarda SASpro van de arriba abajo con `ROWORDER = 'TOP-DOWN'` y el WCS volteado: son coherentes. Un
  programa que no lea ROWORDER los verá volteados.
