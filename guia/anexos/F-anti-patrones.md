# Anexo F: Anti-patrones y criterio de parada

[← Índice](../SKILL.md) · Anterior: [Anexo E: Parámetros y detalles](E-parametros-detalle.md) · Siguiente: [Anexo G: Glosario](G-glosario.md)

Lo que **no** se hace. Se lee antes de empezar y se consulta cuando algo "no sale": casi siempre es uno de estos.

## F.1 Proceso y orden

| No hacer | En su lugar |
|---|---|
| Reducir ruido antes de BXT | BXT primero; el ruido fino es información para la deconvolución |
| Sustituir un paso esencial por un apaño (curvas en vez de SPCC, PixelMath en vez de estirado, UnsharpMask en vez de BXT) | Parar y avisar |
| Seguir adelante cuando falla gradiente, SPCC, BXT o estirado | Parar; no marcarlo como "resuelto con alternativa" |
| Trabajar sobre el master | Copia con nombre de versión |
| Aplicar un proceso y fiarse del "success" | Comprobar estadísticas e historial `view.processing` |
| Encadenar resize + registro + rotación | Interpolar una sola vez (Lanczos-3, 32 bits) |
| Confundir HDRComposition (lineal) con HDRMT (no lineal) | Cada uno en su fase |
| HDR global cuando sólo el núcleo lo necesita | Mezcla sólo bajo máscara de núcleo (`hdr_core_blend`) |
| HDRMT sobre núcleos ya recortados | Dejar margen (~0,93–0,97) o tomas cortas |
| LHE + HDRMT juntos, LHE amount > 0,5, radios pequeños con estrellas | Uno u otro; sobre starless o con máscara |
| Mapa de "estructuras oscuras" por diferencia de escalas | LHE con máscara de fondo |

## F.2 Color

| No hacer | En su lugar |
|---|---|
| Ajustar color multiplicando canales a mano o curvas por canal "a ojo" | SPCC (o BackgroundNeutralization + ColorCalibration) |
| SPCC sobre imagen estirada o con color retocado | Volver al master lineal |
| `new SpectrophotometricColorCalibration` sin curvas de cámara | `pxSPCC()` con los filtros y la QE del perfil |
| `whiteReferenceSpectrum = "Average Spiral Galaxy"` | `whiteReferenceName` (ya es el valor por defecto) |
| Tomar el fondo azul pre-SPCC por blue bloat, o los pedestales por fallo de color | Son normales sin calibrar |
| Aplastar luces con curvas sobre toda la imagen | Máscaras o HDR |
| SCNR global para tapar una calibración mal hecha | SPCC; SCNR suave o con máscara |
| SCNR en cometas o sobre OIII real | Dejarlo: es emisión real |

## F.3 Gradiente

| No hacer | En su lugar |
|---|---|
| MGC o IA de GraXpert en nebulosas oscuras, IFN o polvo extenso | Plano robusto grado 1 o muestras manuales |
| Escala por defecto de sample_free / `-sample_free_simplified true` | sample_free escala 10 (8 si queda gradiente) |
| Corregir por división un gradiente aditivo (o por sustracción el viñeteo) | Sustracción para contaminación, división para viñeteo |
| DBE sobre nebulosa | Sólo cielo; nunca sobre señal |
| Dar por bueno un modelo sin mirarlo | Liso, sin objeto, sin anillo; `gcStructCopy` |

## F.4 Preprocesado y subs

| No hacer | En su lugar |
|---|---|
| Precalibrar los darks con el bias | Darks sin calibrar |
| Mezclar cámaras, filtros o exposiciones en una integración | Un master por grupo |
| Quitar subs con trazas de satélite | Los elimina el rechazo |
| Quitar subs por métricas sin mirarlos | Blink, sobre todo halos por nubes finas |
| Borrar subs o masters del usuario | Mover a `_rechazados` y confirmar |
| Sobrescribir versiones | Nombre nuevo (v1, v2…) |

## F.5 Estrellas y paletas

| No hacer | En su lugar |
|---|---|
| Estrellas de L, Hα o banda estrecha | RGB corta o HDR |
| Recombinar estrellas lineales con starless estirada | Estirar ambas o extraer en no lineal |
| Erosión/MorphologicalTransformation para reducir estrellas | Estirar menos o tomas cortas; si se usa, con StarMask y revisando anillos |
| Separar estrellas en cúmulos | Las estrellas son el objeto |
| Auto-stretch/STF en la capa de estrellas | Fondo a cero y estirado controlado |
| Rellenar un núcleo con un círculo plano | Ley de potencias o superficie de grado 2 |
| Dar por buena una separación porque la starless está "limpia" | Revisar original − starless |
| Fuente "OSC Dualband" de AutoPalette (inventa SII) | DBXtract o su emulación, fuente "DBXtract / Mono" |
| Llamar SHO a una paleta de sólo Hα/OIII | Decir "pseudo-SHO" |
| OIII con B como continuo (lleva Hβ) | OIII con G |
| Inyectar Hα sin máscara | Máscara de luminancia/nebulosa (clipLow 0,04–0,08) |

## F.6 PJSR

| No hacer | En su lugar |
|---|---|
| `w.image`, `w.id`, `P.execute()`, `img.clone()`, `h[i]` | `w.mainView.image`, `w.mainView.id`, `executeOn`, ventana nueva + `assign`, `h.at(i)` |
| Expresiones largas en PixelMath | Símbolos + comprobar el valor devuelto (fallan en silencio) |
| `Rect(x0,y0,ancho,alto)` | `Rect` usa esquinas |
| `FastRotation` sobre ventana con astrometría | PixelMath `pixel($T, w()-1-x(), h()-1-y())` |
| `saveAs` y creer que conserva el historial | Anotar los parámetros en el dossier |
| Lanzar scripts o depender de iconos del escritorio | Su equivalente con procesos y PixelMath (Anexo A.9); procesos configurados en código |
| Suponer nombres de parámetros | `describe_process` |

## F.7 Criterio de parada

**La regla base:** "no aplicar un paso es un resultado válido". En M66 la reducción de halos, el realce de estructuras oscuras, CLAHE y el HDR de núcleo perdieron todos contra no hacer nada en un apilado limpio.

Se para cuando:

1. **El control empeora o no mejora.** Comparar siempre contra la copia sin tocar del mismo punto y contra la versión anterior. Si el resultado no gana, se revierte; no se "ajusta un poco más".
2. **El control falla.** "Si un control falla, volver al punto de control anterior y repetir el paso causante con parámetros más suaves (menos saturación en LRGB, menos fuerza de Hα, menos LHE…)".
3. **Hay que tapar el fallo.** "No usar un recorte/clamp final para ocultar núcleos quemados (para eso están las tomas cortas)."
4. **Se está forzando la señal.** "Con 2 h 50 min de una sola noche el cuerpo tiene menos estructura que las referencias: forzarla saca ruido."
5. **No hay variantes que comparar.** En los pasos dudosos (estirado, Hα, LHE, saturación, umbral de HDR): 3–4 variantes, puntuarlas y quedarse con una; si ninguna convence, no se aplica.
6. **Falla un paso esencial.** Parar y avisar (gradiente, SPCC, BXT, estirado).

Número de iteraciones o de pasadas hasta "rendirse": `[Pendiente de documentar]` — la guía fija el criterio (comparar contra no hacer nada) pero no un límite numérico.
