---
name: "astro-procesado-pixinsight"
description: "Procesado de astrofotografía de cielo profundo en PixInsight controlado por Claude a través del watcher MCP, paso a paso desde el análisis del objeto hasta la entrega: OSC + dual band, HDR con tomas cortas, gradientes, BXT/NXT/SXT, SPCC, estrellas y halos, paletas de banda estrecha y controles objetivos de calidad. Fiel a los datos."
---

# Procesado de astrofotografía en PixInsight

Guía de trabajo para que Claude procese astrofotografía de cielo profundo en PixInsight a través del watcher MCP de este repositorio (PixInsight 1.9.5+; `blindSolve` necesita el watcher v8 y PixInsight 1.9.6+). Está escrita para Claude, pero se puede leer como manual. Cada paso vive en su propio fichero: carga sólo el que vayas a ejecutar.

## Principio innegociable

**Ceñirse a los datos, no inventar nada**, y sacar la máxima información que contengan. "Revelar, no inventar": cualquier estructura débil se confirma antes de realzarla, y cada paso se compara con la versión sin tocar.

## Reglas no negociables

1. **Si falla un paso esencial, PARA y avisa.** Esenciales: corrección de gradiente, SPCC, BXT, estirado. Nunca sustituirlos por un apaño (curvas en lugar de calibración de color, PixelMath en lugar de estirado, UnsharpMask en lugar de BXT) ni marcar el error como "resuelto con alternativa".
2. **Nunca ajustar el color multiplicando canales a mano** ni con curvas por canal "a ojo". El color sale de SPCC (o, sin SPCC, de BackgroundNeutralization + ColorCalibration). Si SPCC no se puede aplicar, se para.
3. **Nunca estirar con fórmulas de PixelMath inventadas.** Estirar con MAS, GHS o HistogramTransformation, y luego curvas suaves.
4. **Comprobar cada paso**, sin fiarse del "success": estadísticas por canal antes y después y el historial `view.processing`. Un paso que no cambió nada no se ha hecho.
5. **Ningún canal puede acabar recortado.** Fondo final de una galaxia ~0,10; de una nebulosa ~0,15–0,25 (o el que diga el perfil).
6. **Trabajar sobre una copia con nombre de versión**, nunca sobre el master ni sobrescribiendo versiones. Nunca borrar subs ni masters: los descartes van a `_rechazados` y el usuario confirma.
7. **El dossier describe lo que dice el historial de la vista**, no lo que se pretendía.
8. **No inventar nombres.** Procesos y parámetros: `describe_process`. IDs de vistas: `list_open_images`. Los procesos se aplican con `P.executeOn(ventana.mainView)`; la imagen está en `ventana.mainView.image`.
9. **Todo desde el watcher.** Sin iconos del escritorio ni scripts: procesos configurados en código y PixelMath. Si un proceso no existe en el script (`typeof BlurXTerminator`), su módulo no está cargado en PixInsight: avisar, no sustituirlo.
10. **Antes de aplicar nada, repasar los anti-patrones** ([Anexo F](anexos/F-anti-patrones.md)): casi todos los fallos de una sesión están ahí, y el criterio de parada también.

**Orden lineal:** gradiente → BXT Correct Only → SPCC → BXT completo → SXT → NXT principal sobre la starless. Nunca reducir ruido antes de BXT: el ruido fino es información para la deconvolución.

## Antes de empezar

Leer [Perfil del usuario y entorno](00-perfil-y-entorno.md) y el `perfil.md` del usuario (plantilla en `perfil-ejemplo.md`; es privado y no se sube a Git). La guía es genérica: el perfil decide equipo, escala, rutas, filtros y QE para SPCC/SPFC, base MARS y preferencias. Cuando el usuario exprese una preferencia nueva, propón añadirla al perfil.

## Mapa de decisión rápido

| Señal de partida | Combinación | Pasos que cambian |
|---|---|---|
| OSC sin filtro (RGB natural) | RGB; LRGB si hay L de mono | 7 y 10 se saltan la desmezcla; SPCC con curva QE 'Ideal' |
| OSC dual band (Hα/OIII) | HOO o Hα+RGB; SHO sólo si hay SII real | 7 obligatorio (DBXtract o emulación), 10 y paso 2 no lineal |
| Mono con rueda de filtros | LRGB, HOO, SHO | 7 no aplica; SPCC con QE real y filtros de la rueda |
| Mono + OSC | LRGB / LHa-RHaGB / HOO+RGB | 10 con LinearFit y `w ∝ 1/σ²` |

Sin banda estrecha no hay paletas: RGB o LHa-RHaGB. Una paleta es una convención, no el color real: decirlo en el dossier. Para galaxias, nebulosas oscuras, planetarias, cúmulos e IFN, el [Anexo D](anexos/D-flujos-por-tipo-objeto.md) dice qué pasos cambian.

## Scripts integrados en el watcher: cuándo, por qué y cómo

Funciones de `herramientas/realces.js` (incluido en el watcher v8; con el clásico, `eval` del fichero). Dan el mismo resultado que los scripts originales. Todas menos `screenStarsCombine`/`Extract` modifican la vista: **trabajar sobre una copia con nombre de versión** y comparar con la anterior.

| Función (script) | Cuándo y en qué casos | Por qué | Cómo |
|---|---|---|---|
| `starStretch` (Star Stretch) | Paso 1 no lineal, **sólo la capa de estrellas lineal** (la de SXT en lineal). También las estrellas RGB que se añaden a una imagen de banda estrecha (Anexo E). Nunca la starless ni una capa ya estirada | Estira las estrellas aparte, con núcleos compactos y sin hincharlas, y recupera su color con saturación por tono | `starStretch("Stars", { amount: 2 })`. `amount` 1–3 en campos con muchas estrellas (objetivo: p90 de la capa ≈ 0,25), hasta 5 con pocas. `saturation` 1; 1,2–1,5 si salen pálidas, vigilando anillos de color. `removeGreen: true` sólo con dominante verde real |
| `screenStarsCombine` (ScreenStars) | Paso 9: devolver las estrellas estiradas a la starless ya procesada. Es la recombinación por defecto | El screen no recorta ni endurece; si la starless está estirada, combina en un espacio casi lineal y vuelve a estirar, y los bordes de las estrellas quedan más naturales que con el screen directo | `screenStarsCombine("Starless_boost", "Stars_st", { newId: "Final" })` crea una imagen nueva. `method: "add"` sólo con capas lineales. Para dosificar las estrellas (fuerza `k`), el PixelMath del Paso 9. Control: el fondo de Final nunca baja respecto a la starless |
| `screenStarsExtract` (ScreenStars) | Pasos 8–9: hay imagen con estrellas y starless **con el mismo estirado** y hace falta la capa de estrellas sin repetir SXT (p. ej. tras retocar la starless, o para reconstruir la capa de otra versión) | Es la inversa exacta de `screenStarsCombine`: separar y recombinar devuelve la imagen original | `screenStarsExtract("Original_st", "Starless_st")`. Mismo `method` que se usará para recombinar. Si los estirados no coinciden, la capa sale con halos o agujeros: no usarla |
| `backgroundEnhance` (BackgroundEnhance) | Paso 5 no lineal, sobre la starless, antes de LHE y del NXT final. Nebulosidad débil extensa, IFN, polvo o colas de nebulosa que quedan apagadas, **con señal confirmada** (Paso 1 lineal, Anexo D) | Suma la gran escala de la imagen a través de una máscara invertida de luminancia: levanta lo débil y extenso sin quemar lo brillante ni realzar el detalle fino (ni el ruido de escala pequeña) | `backgroundEnhance("SL_v2", { amount: 0.3 })`; subir `amount` (0,5 en el script) mientras sólo suba la nebulosidad. `maskAmount` más alto protege más lo brillante. No usar si el fondo es sólo ruido o queda gradiente residual: lo amplifica |
| `darkStructureEnhance` (DarkStructureEnhance) | Paso 5 no lineal, sobre la starless (con estrellas crea anillos oscuros). Nebulosas oscuras, bandas de polvo de galaxias, filamentos oscuros sobre emisión, cuando la imagen tiene buena SNR | Oscurece sólo lo que es más oscuro que su entorno de gran escala: más contraste del polvo sin tocar el resto | Primero `darkStructureEnhance("SL_v3", { keepMask: true })` y mirar la máscara: si sigue estructuras reales, vale; si es ruido moteado o rodea bordes brillantes (caso IC 63, Paso 5), deshacer y usar LHE con máscara. `median` 0,6–0,7 (0,5 no cambia nada; más alto oscurece más), `iterations` 1, `layers` 8 (6 para estructuras más pequeñas) |

## Índice de carga

### Fase lineal

| Paso | Parte | Tokens aprox. |
|---|---|---|
| 1 | [Análisis del objeto](lineal/01-analisis-del-objeto.md) | ~1000 |
| 2 | [Inventario](lineal/02-inventario.md) | ~780 |
| 3 | [Blink / SubframeSelector](lineal/03-blink-subframeselector.md) | ~1180 |
| 4 | [Preprocesado](lineal/04-preprocesado.md) | ~1670 |
| 5 | [StarAlignment + crop común](lineal/05-staralignment-crop.md) | ~800 |
| 6 | [HDRComposition](lineal/06-hdr-composition.md) | ~1570 |
| 7 | [Extracción de canales (OSC dual band)](lineal/07-extraccion-canales.md) | ~1040 |
| 8 | [Plate solve](lineal/08-plate-solve.md) | ~720 |
| 9 | [Corrección de Gradiente](lineal/09-correccion-gradiente.md) | ~3660 |
| 10 | [Combinación RGB / NB](lineal/10-combinacion-rgb-nb.md) | ~1710 |
| 11 | [BlurX correct only](lineal/11-bxt-correct-only.md) | ~910 |
| 12 | [SPCC](lineal/12-spcc.md) | ~840 |
| 13 | [BlurX completo](lineal/13-bxt-completo.md) | ~1000 |
| 14 | [NoiseX suave (opcional)](lineal/14-noisex-suave.md) | ~560 |
| 15 | [StarX y NXT de la starless](lineal/15-starx.md) | ~1050 |
| 16 | [LinearFit / sustracción de continuo](lineal/16-linearfit-continuo.md) | ~1070 |
| 17 | [Checkpoint](lineal/17-checkpoint.md) | ~630 |

### Fase no lineal

| Paso | Parte | Tokens aprox. |
|---|---|---|
| 1 | [Estirado (starless y estrellas por separado)](no-lineal/01-estirado.md) | ~2580 |
| 2 | [LRGB / Paleta](no-lineal/02-lrgb-paleta.md) | ~2940 |
| 3 | [SCNR](no-lineal/03-scnr.md) | ~730 |
| 4 | [Máscaras](no-lineal/04-mascaras.md) | ~800 |
| 5 | [Boost (curvas, contraste, saturación)](no-lineal/05-boost.md) | ~1130 |
| 6 | [NoiseX](no-lineal/06-noisex.md) | ~720 |
| 7 | [Nitidez](no-lineal/07-nitidez.md) | ~500 |
| 8 | [Procesado de estrellas](no-lineal/08-estrellas.md) | ~2170 |
| 9 | [Recombinación](no-lineal/09-recombinacion.md) | ~530 |
| 10 | [Recorte y exportación](no-lineal/10-recorte-exportacion.md) | ~680 |
| 11 | [Dossier](no-lineal/11-dossier.md) | ~560 |

### Anexos

| Anexo | Contenido | Tokens aprox. |
|---|---|---|
| A | [Contrato de API (PJSR)](anexos/A-contrato-api-pjsr.md) | ~1900 |
| B | [Controles de calidad y checklist de entrega](anexos/B-checklist-entrega.md) | ~990 |
| C | [Pendiente de documentar](anexos/C-pendiente-documentar.md) | ~470 |
| D | [Flujos por tipo de objeto](anexos/D-flujos-por-tipo-objeto.md) | ~1670 |
| E | [Parámetros y detalles complementarios](anexos/E-parametros-detalle.md) | ~3230 |
| F | [Anti-patrones y criterio de parada](anexos/F-anti-patrones.md) | ~1770 |
| G | [Glosario](anexos/G-glosario.md) | ~1210 |

### Herramientas y fuentes

| Fichero | Para qué |
|---|---|
| `herramientas/procesos.js` | SPCC, SPFC y MGC configurados en código (filtros y QE de la base de PixInsight, base MARS), sin iconos |
| `herramientas/realces.js` | Star Stretch, ScreenStars, DarkStructureEnhance y BackgroundEnhance desde el watcher (incluido en el v8): `starStretch`, `screenStarsCombine`, `screenStarsExtract`, `darkStructureEnhance`, `backgroundEnhance` |
| `herramientas/graxpert.js` | GraXpert por línea de comandos: métodos que el proceso GraXpert no ofrece (RBF, Kriging, Splines con muestras) y denoise. El fondo por defecto se hace con el proceso GraXpert |
| `herramientas/gradcompare.js` | Medir modelos de gradiente (`gcStructCopy` y comparativa) |
| `FUENTES.md` | Fuentes consultadas |
