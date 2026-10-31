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
| `herramientas/graxpert.js` | GraXpert desde el watcher (fondo y denoise), sin su script |
| `herramientas/gradcompare.js` | Medir modelos de gradiente (`gcStructCopy` y comparativa) |
| `FUENTES.md` | Fuentes consultadas |
