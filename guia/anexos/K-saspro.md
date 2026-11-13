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
| L1 Análisis | `analizarMaster`, `estadisticas`, `previa` |
| L8 Astrometría | `resolverAstrometria` (resolvedor de SASpro con su índice Gaia; ASTAP o astrometry.net si están configurados) |
| L9 Gradiente | **`gradienteCandidatos`** (ABE polinomio 1 y 2, ABE con RBF, GraXpert IA) → `aplicarCandidato` |
| L12 Color | `neutralizarFondo` → `calibrarColor` (White Balance con las estrellas); devuelven el cielo por canal antes y después |
| L15 Estrellas | `separarEstrellas` (StarNet, DarkStar o SyQon) |
| NL1 Estirado | **`estirarCandidatos`** (estadístico, GHS y MTF propio) → `aplicarCandidato` |
| NL3 Verde | `quitarVerde` (SCNR propio que sólo baja el verde; `metodo: sas` para el de SASpro) |
| NL5 Realces | **`nucleoCandidatos`** (galaxias, antes de saturar), **`saturacionCandidatos`** → `aplicarCandidato` |
| L14 / NL6 Ruido | **`ruidoCandidatos`** (Cosmic Clarity, GraXpert) → `aplicarCandidato` |
| NL7 Nitidez | **`nitidezCandidatos`** (Cosmic Clarity sharpen) → `aplicarCandidato` |
| NL8 Estrellas | **`estirarEstrellas`** (de la vista de estrellas) → `aplicarCandidato` |
| NL9 Recombinación | `recombinarEstrellas` (starless + vista de estrellas, screen) |
| NL10 Exportación | `exportarFinal` |

**Siempre disponibles:** `ping`, `vistas`, `imagen`, `estadisticas`, `previa` (también de un candidato y de un recorte), `registro`, `abrirImagen`, `guardarImagen`, `duplicarVista`, `activarVista`, `deshacer`, `rehacer`, `procesoSAS`, `ayudaProceso`, `estado` (trabajos largos).

**Guardar.** Las versiones van en `.xisf` (32 bits en coma flotante) con nombre nuevo, en una carpeta nueva junto al master. Nunca sobre el master.

**Aceleración.** Cosmic Clarity, SyQon, DarkStar y aberration_ai necesitan el entorno de IA de SASpro (PyTorch; con una AMD, torch-directml). Si falta, o se instaló después de arrancar SASpro, la herramienta lo dice: hay que instalarlo en Preferencias y reiniciar SASpro.

## Lo que se sabe de SASpro 1.24.2 (13 nov 2026)

- ABE normaliza el resultado (× 0,998): `gradienteCandidatos` lo descuenta (`escala_pct`).
- El estirado estadístico a mediana 0,2–0,3 deja algunas imágenes casi negras: `estirarCandidatos` lo descarta y añade un MTF propio.
- WaveScale HDR sin ventana se cuelga: no se usa por defecto.
- SFCC y Halo-B-Gon sólo tienen ventana: sin herramienta.
