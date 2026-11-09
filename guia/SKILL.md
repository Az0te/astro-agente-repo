---
name: "astro-procesado-pixinsight"
description: "Procesado de astrofotografía de cielo profundo en PixInsight controlado por un agente de IA a través del MCP picopilot (las funciones de la guía como herramientas), paso a paso desde el análisis del objeto hasta la entrega: OSC + dual band, HDR con tomas cortas, gradientes, BXT/NXT/SXT, SPCC, estrellas y halos, paletas de banda estrecha y controles objetivos de calidad. Compara métodos en vez de fijar uno. Fiel a los datos."
---

# Procesado de astrofotografía en PixInsight

Núcleo de la guía para cualquier agente (Claude, ChatGPT o un modelo local) que procese en PixInsight a través del servidor MCP `picopilot` de este repositorio (`mcp/`, PixInsight 1.9.6+) o desde el panel PiCopilot. Con el MCP, cada función de `herramientas/` es una herramienta con su nombre (`mcp__picopilot__analizarMaster`…; parámetros en `herramientas/manifiesto.json`); con poco contexto, el servidor puede ofrecer sólo las de la fase en curso (`PICOPILOT_FASE`). El MCP antiguo `pixinsight` (watcher, `watcher_status`, `describe_process`, `list_open_images` y su `run_script`) está retirado: no usarlo aunque aparezca. El `run_script` de `picopilot` es otra cosa: PJSR libre con las funciones de la guía cargadas, sólo si el usuario lo ha activado y sólo cuando ninguna función sirve.

Se lee entero al empezar, junto con el `perfil.md` del usuario. El resto se carga **sólo cuando hace falta**: la ficha del paso que se va a ejecutar, y nada más.

## Principio

**Ceñirse a los datos, no inventar nada**, y sacar la máxima información que contengan. Toda estructura débil se confirma antes de realzarla; cada paso se compara con la versión sin tocar. No aplicar un paso es un resultado válido.

## Reglas

1. **Si falla un paso esencial (gradiente, SPCC, BXT, estirado), parar y avisar.** Nada de apaños (curvas en vez de SPCC, PixelMath en vez de estirado, UnsharpMask en vez de BXT).
2. **El color sale de SPCC**, nunca de multiplicar canales ni de curvas por canal a ojo.
3. **Estirar con GHS, MAS, ArcsinhStretch o HistogramTransformation** (`estirarCandidatos` los compara); `starStretch` sólo para la capa de estrellas lineal. Nunca fórmulas de PixelMath inventadas. Antes de estirar, quitar el STF de la vista (las funciones de `estirado.js` lo hacen solas) y saber el tipo de objeto (preguntarlo o sacarlo de `documentarObjeto`).
4. **Comprobar cada paso** con `estadisticas` por canal antes y después e `historial`. Un paso que no cambió nada no se ha hecho. Ningún canal puede acabar recortado.
5. **Copias con nombre de versión** (v1, v2…): nunca trabajar sobre el master ni sobrescribir. Nunca borrar subs ni masters: los descartes van a `_rechazados` y el usuario confirma.
6. **Comparar siempre, no fijar un método.** Donde la guía tiene una función `…Candidatos`, usarla en vez de aplicar un solo método o valor, y enseñar su tabla (`comparados` / `candidatos`).
7. **Todo con las funciones de la guía**, sin iconos ni scripts del menú. Si una función dice que falta un proceso (`typeof Proceso !== "function"`), su módulo no está cargado: avisar, no sustituirlo.
8. **El dossier cuenta lo que dice el historial**, no lo que se pretendía.

**Orden lineal:** gradiente → BXT Correct Only → SPCC → BXT completo → SXT → denoise principal sobre la starless en lineal (Paso 15). Nunca reducir ruido antes de BXT.

## Vistas e ids

- Usar sólo los ids que devuelve `vistas`, escritos exactamente igual. Nunca inventar ni completar un id. Los ids de las fichas (`MasterLight`, `Starless`…) son ejemplos: cambiarlos por uno real. Si el usuario no dice cuál, la activa; si hay dudas, preguntar.
- Las funciones reciben el id como texto (`analizarMaster("id")`), no una ventana ni una vista.
- En scripts: `ImageWindow.windowById(id)` nunca devuelve null (comprobar `w.isNull`); `View.viewById(id)` sí (`!v || v.isNull`). El id es `w.mainView.id`.
- Renombrar las ventanas en la misma llamada que las crea; guardar con rutas absolutas.

## Funciones por paso

| Paso | Funciones |
|---|---|
| L1 Análisis | `analizarMaster` + `documentarObjeto` (Internet); `simbad`, `wikipedia`, `imagenCatalogo`, `leerWeb` |
| L2 Inventario | `inventario` |
| L3 Selección de subs | `seleccionarSubs` |
| L4 Preprocesado | `revisarCalibracion` → `lanzarWBPP` → `estadoWBPP` |
| L5 Alineado y recorte | `alinearMasters`, `bordesSinDatos` |
| L6 HDR | `componerHDR` |
| L7 Canales | `desmezclarDualBand` |
| L8 Astrometría | `resolverAstrometria` (repetir tras BXT o GraXpert si `hasAstrometricSolution` es falso) |
| L9 Gradiente | **`gradienteCandidatos`** / `gradienteVarias` (GraXpert sample_free 10 y 8, GraXpert IA, GradientCorrection, MGC con astrometría, polinomio 1 y 2) |
| L10 Combinación | `combinarMasters` (`combinarMismoCanal`, `inyectarHa`) |
| L11 BXT Correct Only | `bxtCorrectOnly` |
| L12 Color | `calibrarColor` (SPCC), `neutralizarCielo` |
| L13 BXT completo | **`bxtCandidatos`** → `bxtAplicar` |
| L14 NXT suave | **`ruidoCandidatos`** (NXT 3 niveles, MLDenoise, MultiscaleTGVDenoise) → `reducirRuido` |
| L15 StarX y denoise | `separarEstrellas`; **`ruidoCandidatos`** → `reducirRuido` sobre la starless |
| L16 Continuo | `medirContinuo`, `restarContinuo` |
| L17 Checkpoint | `checkpointLineal` |
| NL1 Estirado | **`estirarCandidatos`** (GHS al fallo, MAS, Arcsinh) → `estirarCapas` (o `estirarStarless` + `estirarEstrellas` / `starStretch`) |
| NL2 Paleta | `paletasDisponibles`, `previsualizarPaletas`, `componerPaleta` |
| NL3 SCNR | `quitarVerde` |
| NL4 Máscaras | `crearMascara` |
| NL5 Boost | **`contrasteCandidatos`** (LHE 64 y 128, HDRMT, DSE), **`nucleoCandidatos`** / `comprimirNucleo` / `medirMeseta` (galaxias, antes de saturar), **`saturarAlFallo`**, `backgroundEnhance`, `darkStructureEnhance` |
| NL6 NoiseX | **`ruidoCandidatos`** → `reducirRuido` |
| NL7 Nitidez | Sin función propia: la ficha |
| NL8 Estrellas | `prepararEstrellas`; `screenStarsExtract` (sacar la capa sin repetir SXT) |
| NL9 Recombinación | `recombinarEstrellas` (con controles); `screenStarsCombine` |
| NL10 Exportación | `exportarFinal` (XISF, TIFF 16 bits, JPG sRGB) |
| NL11 Dossier | `historial` |

Siempre disponibles: `vistas`, `estadisticas`, `historial`, `previa` (JPG para mirar la imagen), `abrirImagen`, `guardarImagen`, `cerrarVista`, `estado`, `ping`, `graxpertBGE`, `graxpertDenoise`. Sólo en scripts (`run_script` o panel): `pxSPCC`, `pxSPFC`, `pxMGC` (`procesos.js`), `gcStructCopy` (`gradcompare.js`), `astrometriaLineal` (`alineado.js`, antes de recortar o reescalar una imagen con astrometría con splines). En un script del panel se cargan con `eval(File.readTextFile("<guia>/herramientas/<fichero>.js"))`.

## Internet

`documentarObjeto`, `simbad`, `wikipedia`, `leerWeb` e `imagenCatalogo` sólo funcionan con la casilla **Internet** del panel marcada (o sin el fichero `~/.picopilot/sin-internet`). Si responden que está desactivada, no reintentar ni buscar otra vía: seguir sólo con `analizarMaster` o pedírselo al usuario. Con Internet, al analizar la imagen llamar a `analizarMaster` y `documentarObjeto` juntos y cruzar las medidas con la ficha: qué objeto es, qué emite (y si el filtro lo capta), qué estrellas darán halos y qué pasos vigilar. Lo de internet es orientativo: citar la fuente y no añadir nada que no traiga. Las búsquedas web propias del cliente (WebSearch, WebFetch) también sólo con Internet activado.

## Siguiente paso

Al terminar una respuesta sin código, cerrar con una línea **«Siguiente paso: <qué hacer> con <función>.»** en el **orden de la guía** (tabla de arriba) según lo ya hecho: sin saltar ni reordenar pasos; si uno no aplica, decirlo y pasar al siguiente. Alternativas razonables, en líneas «Paso N: …». El panel las muestra como enlaces.

## Sesiones por fase

1. **Fase lineal** (pasos lineales 1–17). Termina en el checkpoint, que escribe `<carpeta de la versión>/estado.md` (plantilla en el Paso 17 lineal).
2. **Fase no lineal** (pasos no lineales 1–11). Empieza en una sesión nueva leyendo este fichero, `perfil.md` y `estado.md`.

Si algo de la fase lineal hay que rehacer, se vuelve a la versión guardada en el checkpoint, no se corrige en no lineal.

## Entorno

- Una herramienta que tarda más de ~45 s devuelve un **id de trabajo** y sigue ejecutándose: recoger el resultado con `estado(trabajo)`, nunca relanzarla. Si PixInsight está ocupado, la petición espera en cola.
- **Un solo agente con PixInsight a la vez** (dos en paralelo con imágenes grandes lo cerraron, c0000374).
- Resultados cortos (números redondeados, listas breves); para ver la imagen, `previa` o recortes al 100 % en `<versión>/prev/`, no capturas de pantalla.
- `beginProcess()` sin `endProcess()` bloquea la vista: clonarla a una ventana nueva y cerrar la vieja.
- Bucles largos: tramos de ~50 s que guardan en un CSV y devuelven el índice siguiente.
- Tras pasos pesados, cerrar vistas temporales (`cerrarVista`) y `window.purge()`.

## Trampas más frecuentes

| No hacer | En su lugar |
|---|---|
| Fiarse del "success" de un proceso | `estadisticas` e `historial` |
| Inventar o completar un id de vista | El id exacto de `vistas` |
| `Clase.prototype.CONSTANTE` (da `undefined` sin error) | `Clase.CONSTANTE` (`PixelMath.RGB`) |
| `w.image`, `w.id`, `w.name`, `!w`, `P.execute()`, `h[i]`, `console.log` | `w.mainView.image`, `w.mainView.id`, `w.isNull`, `executeOn`, `h.at(i)`, `console.writeln` |
| Repetir un script que ha fallado | Cambiar lo que causó el error |
| Aplicar un solo método o valor donde hay `…Candidatos` | La función que compara, y su tabla |
| Estirar con el STF puesto | Quitarlo antes (`estirado.js` lo hace) |
| SPCC sobre imagen estirada, sin astrometría o sin las curvas del perfil | Master lineal, `resolverAstrometria`, `calibrarColor` |
| MGC o IA de GraXpert en nebulosas oscuras, IFN o polvo extenso | Plano robusto o muestras manuales (Paso 9 lineal) |
| Dar por bueno un modelo de gradiente sin mirarlo | Liso, sin objeto, sin anillo; `gcStructCopy` |
| Recombinar estrellas lineales con una starless estirada | Estirar las dos o extraer en no lineal |
| Estrellas de L, Hα o banda estrecha | RGB corta o HDR |
| Llamar SHO a una paleta sólo de Hα/OIII | "pseudo-SHO" |
| LHE + HDRMT juntos en la misma zona, LHE amount > 0,5 o radios pequeños con estrellas | Uno u otro por zona (HDRMT en el bulbo, LHE en el disco), sobre la starless o con máscara |
| Núcleo de galaxia quemado (meseta > 3 px) o más rondas de GHS para "arreglarlo" | `comprimirNucleo` antes de saturar (Paso 5 no lineal) |
| Dar por buena una recombinación porque el fondo no cambia | Mirar `aporte_estrellas_pct` (≥ 0,5 %); estrellas con el mismo estirado (`estrellas: "extraer"`) |
| Seguir con un `no_cumple` sin resolver o inventar otro umbral | Corregirlo en el paso que dice el mensaje; los umbrales son los de la función |
| NXT o SCNR para manchas de color grandes en no lineal | Venir de una lineal neutra y con un NXT lineal moderado; bajar saturación |
| Dar por cierto lo de internet o nombrar el objeto por el nombre del fichero | Medidas de la imagen; OBJECT o astrometría; citar la fuente |
| Seguir ajustando un paso que no gana a "no hacer nada" | Revertir; 3–4 variantes en los pasos dudosos |

Lista completa y criterio de parada: [Anexo F](anexos/F-anti-patrones.md), cuando algo falla o no convence.

## Mapa de decisión

| Señal de partida | Combinación | Pasos que cambian |
|---|---|---|
| OSC sin filtro | RGB; LRGB si hay L de mono | 7 y 10 sin desmezcla; SPCC con QE "Ideal" |
| OSC dual band (Hα/OIII) | HOO o Hα+RGB; SHO sólo con SII real | 7 obligatorio, 10 y paso 2 no lineal |
| Mono con rueda | LRGB, HOO, SHO | 7 no aplica; SPCC con QE y filtros reales |
| Mono + OSC | LRGB / LHa-RHaGB / HOO+RGB | 10 con LinearFit y `w ∝ 1/σ²` |

Una paleta es una convención, no el color real: decirlo en el dossier. Galaxias, nebulosas oscuras, planetarias, cúmulos e IFN: [Anexo D](anexos/D-flujos-por-tipo-objeto.md).

**Modelo por paso** (rápido o potente, regla N): [Anexo H](anexos/H-modelo-por-paso.md), sólo si la plataforma ofrece varios modelos y no lo ha elegido ya.

## Índice (cargar sólo el paso en curso; tokens aproximados)

**Lineal:** [1 Análisis del objeto](lineal/01-analisis-del-objeto.md) ~1000 · [2 Inventario](lineal/02-inventario.md) ~780 · [3 Blink / SubframeSelector](lineal/03-blink-subframeselector.md) ~1180 · [4 Preprocesado](lineal/04-preprocesado.md) ~1670 · [5 StarAlignment + crop](lineal/05-staralignment-crop.md) ~800 · [6 HDRComposition](lineal/06-hdr-composition.md) ~1570 · [7 Extracción de canales](lineal/07-extraccion-canales.md) ~1040 · [8 Plate solve](lineal/08-plate-solve.md) ~720 · [9 Gradiente](lineal/09-correccion-gradiente.md) ~1200 · [10 Combinación RGB / NB](lineal/10-combinacion-rgb-nb.md) ~1710 · [11 BXT Correct Only](lineal/11-bxt-correct-only.md) ~910 · [12 SPCC](lineal/12-spcc.md) ~840 · [13 BXT completo](lineal/13-bxt-completo.md) ~1000 · [14 NXT suave](lineal/14-noisex-suave.md) ~560 · [15 StarX y denoise](lineal/15-starx.md) ~1980 · [16 LinearFit / continuo](lineal/16-linearfit-continuo.md) ~1070 · [17 Checkpoint](lineal/17-checkpoint.md) ~930

**No lineal:** [1 Estirado](no-lineal/01-estirado.md) ~1310 · [2 LRGB / paleta](no-lineal/02-lrgb-paleta.md) ~2940 · [3 SCNR](no-lineal/03-scnr.md) ~730 · [4 Máscaras](no-lineal/04-mascaras.md) ~800 · [5 Boost](no-lineal/05-boost.md) ~1660 · [6 NoiseX](no-lineal/06-noisex.md) ~720 · [7 Nitidez](no-lineal/07-nitidez.md) ~500 · [8 Estrellas](no-lineal/08-estrellas.md) ~950 · [9 Recombinación](no-lineal/09-recombinacion.md) ~700 · [10 Recorte y exportación](no-lineal/10-recorte-exportacion.md) ~680 · [11 Dossier](no-lineal/11-dossier.md) ~560

**Anexos (bajo demanda):** [A API de PJSR y equivalentes de scripts](anexos/A-contrato-api-pjsr.md) · [B Controles de calidad y entrega](anexos/B-checklist-entrega.md) · [C Pendiente](anexos/C-pendiente-documentar.md) · [D Flujos por tipo de objeto](anexos/D-flujos-por-tipo-objeto.md) · [E Parámetros complementarios](anexos/E-parametros-detalle.md) · [F Anti-patrones y parada](anexos/F-anti-patrones.md) · [G Glosario](anexos/G-glosario.md) · [H Modelo por paso](anexos/H-modelo-por-paso.md)

**Detalle de los pasos** (el porqué y las fuentes; sólo si una ficha no basta para decidir): `detalle/`. **Configuración** (crear o completar `perfil.md`, entorno de PixInsight): [00 Perfil y entorno](00-perfil-y-entorno.md). Fuentes: `FUENTES.md`. Instrucciones para ChatGPT y modelos locales: `envolturas/`.
