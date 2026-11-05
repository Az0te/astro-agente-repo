---
name: "astro-procesado-pixinsight"
description: "Procesado de astrofotografía de cielo profundo en PixInsight controlado por un agente de IA a través del watcher MCP, paso a paso desde el análisis del objeto hasta la entrega: OSC + dual band, HDR con tomas cortas, gradientes, BXT/NXT/SXT, SPCC, estrellas y halos, paletas de banda estrecha y controles objetivos de calidad. Fiel a los datos."
---

# Procesado de astrofotografía en PixInsight

Núcleo de la guía para cualquier agente (Claude, ChatGPT o un modelo local) que procese en PixInsight a través del watcher MCP de este repositorio (PixInsight 1.9.6+ con el watcher v8). Se lee entero al empezar, junto con el `perfil.md` del usuario. El resto se carga **sólo cuando hace falta**: el fichero del paso que se va a ejecutar, y nada más.

## Principio

**Ceñirse a los datos, no inventar nada**, y sacar la máxima información que contengan. Toda estructura débil se confirma antes de realzarla; cada paso se compara con la versión sin tocar. No aplicar un paso es un resultado válido.

## Reglas

1. **Si falla un paso esencial (gradiente, SPCC, BXT, estirado), parar y avisar.** Nada de apaños (curvas en vez de SPCC, PixelMath en vez de estirado, UnsharpMask en vez de BXT).
2. **El color sale de SPCC**, nunca de multiplicar canales ni de curvas por canal a ojo.
3. **Estirar con MAS, GHS o HistogramTransformation**; `starStretch` sólo para la capa de estrellas lineal. Nunca fórmulas de PixelMath inventadas.
4. **Comprobar cada paso**: estadísticas por canal antes y después e historial `view.processing`. Un paso que no cambió nada no se ha hecho. Ningún canal puede acabar recortado.
5. **Copias con nombre de versión** (v1, v2…): nunca trabajar sobre el master ni sobrescribir. Nunca borrar subs ni masters: los descartes van a `_rechazados` y el usuario confirma.
6. **No inventar nombres**: procesos y parámetros con `describe_process`, IDs con `list_open_images`. Se aplica con `P.executeOn(ventana.mainView)`; la imagen está en `ventana.mainView.image`.
7. **Todo desde el watcher**, sin iconos ni scripts del menú (no se pueden lanzar desde el watcher). Si `typeof Proceso !== "function"`, su módulo no está cargado: avisar, no sustituirlo.
8. **El dossier cuenta lo que dice el historial**, no lo que se pretendía.

**Orden lineal:** gradiente → BXT Correct Only → SPCC → BXT completo → SXT → denoise principal sobre la starless en lineal (por defecto, híbrido MLDenoise + NXT; Paso 15). Nunca reducir ruido antes de BXT.

## Sesiones por fase

Para no arrastrar contexto, cada fase va en su propia sesión:

1. **Fase lineal** (pasos lineales 1–17). Termina en el checkpoint, que escribe `<carpeta de la versión>/estado.md` (plantilla en el Paso 17 lineal).
2. **Fase no lineal** (pasos no lineales 1–11). Empieza en una sesión nueva leyendo este fichero, `perfil.md` y `estado.md`. No hace falta nada de la fase lineal.

Si algo de la fase lineal hay que rehacer, se vuelve a la versión guardada en el checkpoint, no se corrige en no lineal.

## Funciones del watcher v8

Disponibles en `run_script` sin cargar nada:

| Función | Para qué | Paso |
|---|---|---|
| `blindSolve("vista")` | Astrometría para SPCC, SPFC y MGC; repetir tras BXT o GraXpert si `hasAstrometricSolution` es falso (recortar y rotar la conservan desde 1.9.6) | 8 lineal |
| `starStretch("Stars", {amount})` | Estirar la capa de estrellas lineal | 1 no lineal |
| `screenStarsCombine("Starless", "Stars", {newId})` | Recombinar estrellas (por defecto) | 9 no lineal |
| `screenStarsExtract("Original", "Starless")` | Sacar la capa de estrellas sin repetir SXT | 8 no lineal |
| `backgroundEnhance("Starless", {amount})` | Levantar nebulosidad débil extensa | 5 no lineal |
| `darkStructureEnhance("Starless", {median})` | Oscurecer polvo y estructuras oscuras | 5 no lineal |

Con `eval(File.readTextFile("<ruta de guia>/herramientas/<fichero>.js"))`: `procesos.js` (`pxSPCC`, `pxSPFC`, `pxMGC` con los valores del perfil), `graxpert.js` (GraXpert externo: RBF, Kriging, Splines, denoise), `gradcompare.js` (medir modelos de gradiente) `gradiente.js` (`gradienteCandidatos(vista, opciones)`: comparativa de GraXpert y MGC en una llamada, con medida y dossier), `analisis.js` (`analizarMaster(vista)`: datos de la checklist del Paso 1), `alineado.js` (`alinearMasters`: registro sobre una referencia común, reescalado si hace falta y recorte a la zona común, Paso 5), `preproceso.js` (`inventario`: cabeceras de toda la carpeta del objeto, Paso 2; `seleccionarSubs`: ImageAnalysis por grupo, Paso 3; `revisarCalibracion`, `lanzarWBPP` y `estadoWBPP`: cabeceras y flats, WBPP en otra instancia sin ventana y resumen del log, Paso 4), `color.js` (`calibrarColor(vista, {spcc})`: SPCC con comprobaciones y cielo medido), `deconvolucion.js` (`bxtCandidatos` / `bxtAplicar`: rejilla de BXT completo con FWHM, ringing y gusanos), `ruido.js` (`reducirRuido`: NXT o híbrido con σ del cielo, contraste y residual; `separarEstrellas`: SXT comprobado), `boost.js` (`saturarAlFallo`: saturación 0,58 → 0,78 hasta el fallo), `lineal.js` (`resolverAstrometria`, `bxtCorrectOnly`, `checkpointLineal`, `quitarVerde`), `bandaestrecha.js` (`desmezclarDualBand`, `medirContinuo`, `restarContinuo`, `previsualizarPaletas`), `mascaras.js` (`crearMascara`), `exportar.js` (`exportarFinal`: XISF, TIFF 16 bits y JPG sRGB), `estirado.js` (`estirarCapas(starless, estrellas)`: starless al fallo con pasadas cortas de GHS y `starStretch`), `estrellas.js` (`prepararEstrellas(vista)`: preparación de la capa de estrellas del Paso 8) y `recombinacion.js` (`recombinarEstrellas(starless, estrellas)`: Paso 9 con sus controles). Constantes de proceso en v8: `Clase.CONSTANTE` (`PixelMath.RGB`); con `.prototype` dan `undefined` sin error. `View.viewById` de una vista que no existe devuelve `null`: comprobar `!v || v.isNull`.

## Entorno

- Una llamada de más de ~60 s da timeout pero **sigue ejecutándose**: comprobar con `watcher_status` y la lista de ventanas antes de relanzar.
- Devolver resultados cortos (números redondeados, listas breves); para ver la imagen, JPG reducidos o recortes al 100 % en `<versión>/prev/`, no capturas de pantalla.
- `beginProcess()` sin `endProcess()` bloquea la vista: clonarla a una ventana nueva y cerrar la vieja.
- Bucles largos: tramos de ~50 s que guardan en un CSV y devuelven el índice siguiente.
- Tras pasos pesados, cerrar vistas temporales y `window.purge()`.

## Trampas más frecuentes

| No hacer | En su lugar |
|---|---|
| Fiarse del "success" de un proceso | Estadísticas e historial |
| SPCC sobre imagen estirada, sin astrometría o sin las curvas del perfil | Master lineal, `blindSolve`, `pxSPCC()` |
| MGC o IA de GraXpert en nebulosas oscuras, IFN o polvo extenso | Plano robusto o muestras manuales (Paso 9 lineal) |
| Dar por bueno un modelo de gradiente sin mirarlo | Liso, sin objeto, sin anillo; `gcStructCopy` |
| Recombinar estrellas lineales con una starless estirada | Estirar las dos o extraer en no lineal |
| Estrellas de L, Hα o banda estrecha | RGB corta o HDR |
| Llamar SHO a una paleta sólo de Hα/OIII | "pseudo-SHO" |
| LHE + HDRMT juntos, LHE amount > 0,5 o radios pequeños con estrellas | Uno u otro, sobre la starless o con máscara |
| `w.image`, `w.id`, `P.execute()`, `h[i]` | `w.mainView.image`, `w.mainView.id`, `executeOn`, `h.at(i)` |
| Seguir ajustando un paso que no gana a "no hacer nada" | Revertir; 3–4 variantes en los pasos dudosos |

Lista completa y criterio de parada: [Anexo F](anexos/F-anti-patrones.md), cuando algo falla o no convence.

## Modelo por paso: rápido o potente

Si la plataforma ofrece varios modelos o niveles de razonamiento, cada paso se puede hacer con uno **rápido** (más barato) o uno **potente**. El % de cada paso es la calidad del rápido respecto al potente haciendo ese paso, **medida con Claude** (Sonnet 5.5 frente a Opus 5.5; IC 1396 v2, noviembre de 2026; rúbrica de 40 puntos: exactitud, completitud, verificación y utilidad).

- Lineal: 1 → 86 · 2 → 97 · 3 → 92 · 4 → 84 · 5 → 84 · 6 → 100 · 7 → 100 · 8 → 100 · 9 → 87 · 10 → 100 (NB) / 95 (RGB) · 11–17 → 95
- No lineal: 1 → 95 · 2 → 95 · 3–10 → 89 · 11 (dossier) → 80 (asignado, sin medir)
- Resolución completa (todos los pasos seguidos en una sola tarea) → 80 (asignado, sin medir)

| Plataforma | Rápido | Potente | % |
|---|---|---|---|
| Claude | Sonnet | Opus | Medidos |
| ChatGPT | Modelo o nivel de razonamiento estándar | El de más razonamiento del plan (Thinking alto o Pro) | Sin medir: usar los de Claude como provisionales |
| Local | No aplica (un solo modelo) | — | — |

**Regla N.** Al empezar, el usuario elige N (0–100): si el % del paso es **> N**, rápido; si es **≤ N**, potente. Si no lo da, preguntarlo una vez; sin respuesta, N = 100 (todo potente). Con Claude, N = 95 pasa al rápido ~18 % del trabajo (ahorro ~7 %, pérdida ~0,2 %) y N = 90 ~50 % (ahorro ~20 %, pérdida ~2 %); el ahorro es de precio por token, no de tokens. Fijo, sea cual sea N: lotes mecánicos de un método ya decidido (calibrar con una herramienta escrita, medir subs, mover ficheros) con el rápido; decisiones de método y cambios en la guía con el potente. **Un solo agente con PixInsight a la vez** (dos en paralelo con imágenes grandes lo cerraron, c0000374); renombrar las ventanas en la misma llamada que las crea y guardar con rutas absolutas. Los % salen de un solo objeto (emisión, OSC dual band) y los pasos lineales 10–17 y no lineales 3–10 se puntuaron en bloque.

## Mapa de decisión

| Señal de partida | Combinación | Pasos que cambian |
|---|---|---|
| OSC sin filtro | RGB; LRGB si hay L de mono | 7 y 10 sin desmezcla; SPCC con QE "Ideal" |
| OSC dual band (Hα/OIII) | HOO o Hα+RGB; SHO sólo con SII real | 7 obligatorio, 10 y paso 2 no lineal |
| Mono con rueda | LRGB, HOO, SHO | 7 no aplica; SPCC con QE y filtros reales |
| Mono + OSC | LRGB / LHa-RHaGB / HOO+RGB | 10 con LinearFit y `w ∝ 1/σ²` |

Una paleta es una convención, no el color real: decirlo en el dossier. Galaxias, nebulosas oscuras, planetarias, cúmulos e IFN: [Anexo D](anexos/D-flujos-por-tipo-objeto.md).

## Índice (cargar sólo el paso en curso; tokens aproximados)

**Lineal:** [1 Análisis del objeto](lineal/01-analisis-del-objeto.md) ~1000 · [2 Inventario](lineal/02-inventario.md) ~780 · [3 Blink / SubframeSelector](lineal/03-blink-subframeselector.md) ~1180 · [4 Preprocesado](lineal/04-preprocesado.md) ~1670 · [5 StarAlignment + crop](lineal/05-staralignment-crop.md) ~800 · [6 HDRComposition](lineal/06-hdr-composition.md) ~1570 · [7 Extracción de canales](lineal/07-extraccion-canales.md) ~1040 · [8 Plate solve](lineal/08-plate-solve.md) ~720 · [9 Gradiente](lineal/09-correccion-gradiente.md) ~1200 · [10 Combinación RGB / NB](lineal/10-combinacion-rgb-nb.md) ~1710 · [11 BXT Correct Only](lineal/11-bxt-correct-only.md) ~910 · [12 SPCC](lineal/12-spcc.md) ~840 · [13 BXT completo](lineal/13-bxt-completo.md) ~1000 · [14 NXT suave](lineal/14-noisex-suave.md) ~560 · [15 StarX y denoise](lineal/15-starx.md) ~1980 · [16 LinearFit / continuo](lineal/16-linearfit-continuo.md) ~1070 · [17 Checkpoint](lineal/17-checkpoint.md) ~930

**No lineal:** [1 Estirado](no-lineal/01-estirado.md) ~1310 · [2 LRGB / paleta](no-lineal/02-lrgb-paleta.md) ~2940 · [3 SCNR](no-lineal/03-scnr.md) ~730 · [4 Máscaras](no-lineal/04-mascaras.md) ~800 · [5 Boost](no-lineal/05-boost.md) ~1660 · [6 NoiseX](no-lineal/06-noisex.md) ~720 · [7 Nitidez](no-lineal/07-nitidez.md) ~500 · [8 Estrellas](no-lineal/08-estrellas.md) ~950 · [9 Recombinación](no-lineal/09-recombinacion.md) ~700 · [10 Recorte y exportación](no-lineal/10-recorte-exportacion.md) ~680 · [11 Dossier](no-lineal/11-dossier.md) ~560

**Anexos (bajo demanda):** [A API de PJSR y equivalentes de scripts](anexos/A-contrato-api-pjsr.md) · [B Controles de calidad y entrega](anexos/B-checklist-entrega.md) · [C Pendiente](anexos/C-pendiente-documentar.md) · [D Flujos por tipo de objeto](anexos/D-flujos-por-tipo-objeto.md) · [E Parámetros complementarios](anexos/E-parametros-detalle.md) · [F Anti-patrones y parada](anexos/F-anti-patrones.md) · [G Glosario](anexos/G-glosario.md)

**Detalle de los pasos** (el porqué y las fuentes; sólo si una ficha no basta para decidir): `detalle/`. **Configuración** (crear o completar `perfil.md`, entorno de PixInsight): [00 Perfil y entorno](00-perfil-y-entorno.md). Pesos por paso en datos: `porcentajes_skill.json` (los ajustes de cada usuario, como su N, no van ahí sino en local). Fuentes: `FUENTES.md`. Instrucciones para ChatGPT y modelos locales: `envolturas/`.
