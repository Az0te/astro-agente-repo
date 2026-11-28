# Anexo K: cómo se hace cada paso en Seti Astro Suite Pro (SASpro)

[← Índice](../SKILL.md)

Bajo demanda: sólo hace falta con el servidor **setiastropilot** conectado (SASpro 1.24 o posterior con el script SetiAstroPilot lanzado desde el menú Flujos de trabajo > Scripts > AstroPilot (en 1.x, Scripts > AstroPilot)). Las fichas dicen **qué** hacer y con **qué criterios**; aquí sólo está **con qué herramienta o proceso de SASpro**. Los nombres de las medidas son los mismos que en las fichas.

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
| L10 Combinación | `combinarRGB` (mono con rueda) en su sitio; la inyección, **`combinarCandidatos`** → `aplicarCandidato`, con la RGB ya calibrada (tras L12) y antes de separar estrellas: como en Siril, la herramienta mide el continuo en las estrellas y las deja fuera ([Anexo I](I-siril.md)) **Ruta de paleta** (24 nov 2026, igual que en PixInsight): `alinearMasters` lee el tiempo total y el filtro de cada master (PCL:TotalExposureTime, LIVETIME o EXPTIME × NCOMBINE) y devuelve `ruta_paso10`; con la banda estrecha ≥ 4 veces la RGB, `combinarCandidatos` se niega en nebulosas salvo `motivo` (emisión y reflexión, o el usuario pide color RGB), `paletasCandidatos` deja de negarse y `exportarFinal` pide la paleta aplicada. |
| L12 Color | `neutralizarFondo` → `calibrarColor` (White Balance con las estrellas); devuelven el cielo por canal antes y después |
| L15 Estrellas | `separarEstrellas` (StarNet, DarkStar o SyQon; `syqon_cli` = SyQon Axiom Mini de SyQon Studio, solo estirada) |
| NL1 Estirado | **`estirarCandidatos`** (estadístico, GHS y MTF propio) → `aplicarCandidato` |
| NL2 Paletas | **`paletasCandidatos`** (capas estiradas; pasa ha, oiii, sii y hb: la Natural usa las cuatro) → `aplicarCandidato` |
| NL3 Verde | `quitarVerde` (SCNR propio que sólo baja el verde; `metodo: sas` para el de SASpro) |
| NL4 Máscaras | `crearMascara` (luminancia, cielo, estrellas, color, estructura, objeto, rango, crominancia; `fuente` para sacarla de otra vista), `combinarMascaras`, `ajustarMascara`, `aplicarConMascara`; y el parámetro `mascara` en las comparaciones (ver abajo) |
| NL5 Realces | **`nucleoCandidatos`** (galaxias), **`contrasteCandidatos`**, **`saturacionCandidatos`** → `aplicarCandidato`, en ese orden |
| L14 / NL6 Ruido | **`ruidoCandidatos`** (Cosmic Clarity y NoiseX a 0,3 / 0,5 / 0,7 y en dos pasadas 0,5×2 / 0,7×2; Cosmic Clarity fuerte solo en el cielo, SyQon Prism en lineal, GraXpert si se pide; gana el que más quita con < 10 % de detalle perdido; en capas débiles, el que deja ~30 % del ruido; ver [criterios](#ruido)) → `aplicarCandidato` |
| NL7 Nitidez | **`nitidezCandidatos`** (Cosmic Clarity sharpen) → `aplicarCandidato` |
| NL8 Estrellas | **`estirarEstrellas`** (de la vista de estrellas; arcsinh a varios p90 y + Halo-B-Gon; `mas_pequenas` si se ven grandes) → `aplicarCandidato` |
| NL9 Recombinación | `recombinarEstrellas` (starless + vista de estrellas, screen) |
| NL10 Exportación | `exportarFinal` (cielo 0,01–0,10; con un cometa hasta 0,13, objetivo ~0,10: [Anexo D](D-flujos-por-tipo-objeto.md#cometas)) |

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

<a id="mascaras"></a>
## Máscaras en las comparaciones (25 nov 2026)

Las máscaras sirven en casi todos los pasos no lineales: dejan el efecto donde hace falta y protegen el resto. En SASpro
cada comparación que la acepta (`ruidoCandidatos`, `nucleoCandidatos`, `contrasteCandidatos`, `saturacionCandidatos`,
`nitidezCandidatos`, `deconvolucionCandidatos`, `halosCandidatos`, `reducirEstrellasCandidatos`, `fondoCandidatos`)
lleva tres parámetros:

- `mascara`: el nombre de una vista de máscara (de `crearMascara`, `combinarMascaras` o `ajustarMascara`) o un objeto con
  los parámetros de `crearMascara` para hacerla al vuelo, p. ej. `{"tipo": "cielo", "gamma": 1.5}`.
- `mascara_fuerza` (0–1) y `mascara_invertir`.

Cada candidato se mezcla con la imagen de partida a través de la máscara **antes** de medirlo y de guardarlo: lo que se
compara y lo que pone `aplicarCandidato` es lo mismo. El resultado trae `mascara` con su cobertura (media en el cielo, el
objeto y las estrellas) para comprobar que protege lo que debe. El estirado y el gradiente no la aceptan (en lineal deja
saltos al estirar).

Usos típicos, por tipo de efecto (no por objeto):

| Efecto | Máscara | Por qué |
|---|---|---|
| Ruido fuerte solo en el fondo | `{"tipo": "cielo"}` | el fondo admite más denoise que el objeto |
| Contraste y nitidez del objeto | `{"tipo": "objeto"}` o `luminancia` × (1 − estrellas) con `combinarMascaras(a_sin_b)` | sin realzar estrellas ni ruido del cielo |
| Saturación sin teñir el cielo | `luminancia` o `crominancia` | el color va donde ya hay señal |
| Un solo tono (OIII, polvo dorado) | `{"tipo": "color", "tono": "cian"}` | sube o baja un tono sin tocar los otros |
| Núcleo o zonas brillantes | `{"tipo": "rango", "bajo": 0.6}` | solo actúa por encima del nivel, con rampa suave |
| Halos y estrellas | `{"tipo": "estrellas", "crecer": 3}` (las brillantes crecen ×3) | cubre el halo de las grandes |
| Desde otra capa | `{"tipo": "luminancia", "fuente": "<starless o Hα>"}` | la máscara sin estrellas o donde hay Hα |

Si la vista tenía una máscara de SASpro activa (de la ventana Mask), la comparación la desactiva mientras dura y la
vuelve a poner (`aviso_mascara_sas`): los procesos de SASpro la respetarían y los candidatos no serían comparables.

## Novedades de SASpro 1.24.8 que se aprovechan (25 nov 2026)

- Estirado estadístico en luminancia conservando el color y con compresión de altas luces (`estirarCandidatos`).
- Cosmic Clarity sharpen como deconvolución gratuita en `deconvolucionCandidatos` (alternativa a BXT).
- `saturacionCandidatos`: «color suave por tonos» (rojo ×0,85, dorado ×1,3, azul ×1,35) para elegir a la vista.
- `combinarCandidatos`: Hα ×0,5 / 0,75 / 1 y margen de R/G del objeto por tipo (emisión ×1,8, galaxia ×1,3).
- `paletasCandidatos`: HSO y SHO suave.

<a id="ruido"></a>
## Prueba de las herramientas nuevas en IC 1396 (25 nov 2026)

Recortes de 1500 × 1000 y la Natural completa (HaO3 lineal, OIII y Natural estirada). Lo que salió y lo que se cambió:

- **Criterios de `ruidoCandidatos`.** `residual_estructura` (lo quitado: ~1–2 = solo ruido) es una proporción y no baja
  al bajar el denoise: en el HaO3 lineal NoiseX 0,3 daba 2,71 y 0,7 daba 1,96. Como filtro duro solo dejaba pasar los
  fuertes. Ahora, como en PixInsight: es fallo si además se pierde > 3 % del detalle medido; si no, aviso (mirar la
  diferencia a ojo) y sirve para preferir, entre los que cumplen, los de residual ≤ 2.
- **Detalle no medible.** En los recortes (y en las capas OIII/SII) el detalle de 2–8 px de la zona brillante no sobresale
  del ruido del cielo y la pérdida no se mide: se recomienda la pasada moderada (~70 % del ruido) o, en una capa débil
  lineal (SNR < 8), la que deja ~30 %. El resultado trae `detalle_no_medible` con el motivo.
- **Natural completa (estirada).** NoiseX 0,3 quita un tercio del ruido sin perder detalle (gana). Cosmic Clarity denoise
  pierde el 18 % del detalle a 0,15 y el 28 % a 0,25: en imágenes estiradas, mejor NoiseX. Cosmic Clarity solo en el
  cielo da residual 2,3: en IC 1396 el «cielo» es nebulosa débil y se la lleva.
- **Cosmic Clarity en lineal** deja recortes nuevos (ceros) en el HaO3 lineal: se descarta solo.
- **Dos pasadas** de NoiseX ya son dos pasadas de verdad (0,5×2 deja el 35 % del ruido; 0,7×2 el 29 %).
- **Deconvolución.** BXT no bajó la FWHM en el master HaO3 (3,94 → 4,0–4,15 px). Cosmic Clarity sharpen en lineal satura
  los núcleos (FWHM falsa de 1,25 px): ahora un candidato que satura más píxeles que la original queda fuera.
- **Máscaras.** El parámetro `mascara` ya llega a la herramienta (antes el puente lo quitaba). La máscara `objeto` sale de
  la luminancia suavizada si la de estructura de SASpro queda casi vacía (`aviso`).
- **Paletas.** `paletasCandidatos` acepta los nombres con espacios o mayúsculas («SHO suave») y avisa de los que no
  existen.
- **Pendiente.** GHS no estira en lineal; la máscara de estrellas sacada de una capa de estrellas estirada cubre el 22 %
  (demasiado): usar `crecer` bajo o umbral más alto.

<a id="videos-seti"></a>
## Ideas de los vídeos de Seti Astro (25 nov 2026)

Pedestal y propuestas 1–4 del análisis de los dos vídeos. Probado en recortes de IC 1396 (Natural v10 sin estrellas, su
capa de estrellas, Hα estirado, HaO3 lineal) y en imágenes sintéticas:

- **Pedestal 0,05 al reponer la luminancia** (`_con_luminancia`, `comprimir_nucleo`; en Siril, `nucleo.py` y la escala
  grande). Se sube el negro, se escala y se vuelve a bajar: cerca de 0 el cociente L1/L amplificaba el ruido de color.
  CLAHE 50 % en la Natural completa: dominante del cielo 4,6 → 12,0 % sin pedestal y → 7,1 % con él; ruido × 0,99 → 0,92.
  Solo en estirada (en lineal desatura). PixInsight usa sus procesos de luminancia y no lo necesita.
- **Estrellas atenuadas sobre la nebulosa brillante** (`estrellasNebulosaCandidatos`; `recombinarEstrellas` con
  `atenuar`; también en Siril y en PixInsight). Máscara de la luminancia de la starless (t², suavizada). En IC 1396 el
  screen ya deja las estrellas de la nebulosa al 0,71 de las del cielo oscuro; con 0,5 bajan a 0,48 sin perder ninguna
  (0,4 %); con 0,7 casi desaparece el 5,5 %. Recomienda la más fuerte ≤ 0,5 que no pierde estrellas, y 0 si no hay
  nebulosa brillante. Es gusto: mirar la previa.
- **ABE con exclusión automática del objeto** (`gradienteCandidatos`, `abe_excluir`). El comando sin ventana de ABE no
  admite polígonos; se llama a `abe_run` con `exclusion_mask` = las cajas de cielo de `cielo.py` (True = zona donde SÍ se
  toman muestras; invertida, el gradiente quedaba peor). Campo sintético con una nebulosa gaussiana: polinomio 1 deja
  0,10 del gradiente frente a 0,18 sin exclusión; el 2 no se come nada (sin exclusión, el 9 % del objeto). En el HaO3 de
  IC 1396 (la nebulosa llena el campo) empata con ABE normal (0,52–0,62).
- **CLAHE con zona en píxeles** (`clahe_128`, `clahe_180`, `clahe_256`, `clahe_180_sin_croma`; en Siril `clahe_128/180/256`
  calculan la rejilla con el tamaño de la imagen). Con 1/8 de la imagen la zona medía 750 px. En la Natural completa,
  zona de 128 px: +29 % de contraste frente a +26 %, con el mismo ruido. Todos los CLAHE siguen fuera por «recortes
  nuevos» y color del cielo en esta imagen (ya pasaba). El croma repuesto apenas cambia nada aquí (croma × 1,00): el
  reparto por cocientes ya conserva la saturación; queda para quien use curvas en la luminancia.
- **Hα como luminancia en las afueras** (`haLuminanciaCandidatos`, nueva). Hα igualado a la luminancia de la vista y
  suavizado, mezclado solo en lo débil con una máscara de rango invertida, croma repuesto y `saturar` opcional. Mide el
  contraste ganado en la zona débil, el croma de esa zona, el ruido del cielo y que lo brillante no cambie. Sintético
  (afueras con poco contraste y Hα con estructura): +4 / +10 / +18 % con 0,2 / 0,3 / 0,4, color igual, brillante sin
  tocar. En la Natural v10 de IC 1396 baja el contraste (−12 a −24 %): su luminancia ya es de Hα y está trabajada, así que
  no se recomienda ninguna. Pensada para paletas con las afueras flojas (OIII o SII dominantes).
