# Anexo F: Anti-patrones y criterio de parada

[← Índice](../SKILL.md) · Anterior: [Anexo E: Parámetros y detalles](E-parametros-detalle.md) · Siguiente: [Anexo G: Glosario](G-glosario.md)

Lo que **no** se hace. Se lee antes de empezar y se consulta cuando algo "no sale": casi siempre es uno de estos.

## F.1 Proceso y orden

| No hacer | En su lugar |
|---|---|
| Reducir ruido antes de BXT | BXT primero; el ruido fino es información para la deconvolución |
| Sustituir un paso esencial por un apaño (curvas en vez de calibración de color, una fórmula en vez de estirado, una máscara de enfoque en vez de deconvolución) | Parar y avisar |
| Seguir adelante cuando falla gradiente, SPCC, BXT o estirado | Parar; no marcarlo como "resuelto con alternativa" |
| Trabajar sobre el master | Copia con nombre de versión |
| Aplicar un proceso y fiarse del "success" | Comprobar estadísticas e historial `view.processing` |
| Dar por buena una comparación en la que varios niveles salen idénticos (NXT 0,3 / 0,5 / 0,7 con el mismo ruido) | Es que el parámetro no llega al proceso: probar dos valores extremos y arreglar la herramienta antes de elegir |
| Usar el equipo y las curvas del perfil con datos de otra persona | Leer el texto del autor y las cabeceras (Paso 1 lineal) |
| Restar a la capa de estrellas un suelo distinto por canal | Un suelo común que conserve el tono (Paso 8 no lineal) |
| Quedarse con el estirado que más separa la señal débil aunque queme el núcleo de una nebulosa | Medir la meseta y repetir el mismo método con un límite de luces más estricto (`altoMax`) |
| Cambiar el método de estirado de las rayas de una paleta ya aprobada | Mantener el método: otro estirado cambia la relación entre canales y con ella los colores |
| Estrellas de una RGB con canales desequilibrados (pocos subs en un canal, FWHM distintos) | La RGB con canales equilibrados, aunque sea más corta |
| Encadenar resize + registro + rotación | Interpolar una sola vez (Lanczos-3, 32 bits) |
| Confundir la composición HDR (lineal) con la compresión multiescala del rango (no lineal) | Cada uno en su fase |
| HDR global cuando sólo el núcleo lo necesita | Mezcla sólo bajo máscara de núcleo (`hdr_core_blend`) |
| Compresión multiescala sobre núcleos ya recortados | Dejar margen (~0,93–0,97) o tomas cortas |
| Contraste local + compresión multiescala juntos, contraste local amount > 0,5, radios pequeños con estrellas | Uno u otro; sobre starless o con máscara |
| Fijar un mínimo absoluto de contraste o de estructura ("el núcleo debe tener al menos X") | Mínimos relativos a la entrada y un máximo de amplificación; un mínimo fijo lleva a cocinar el núcleo (Paso 5 no lineal) |
| Juzgar la saturación antes del tono y del contraste local, o nitidez después del último NXT | Saturación al final; NXT después de cada contraste local o nitidez (Paso 5 no lineal) |
| Mapa de "estructuras oscuras" por diferencia de escalas sin mirarlo (en una nebulosa de emisión y reflexión era ruido) | Realce de estructuras oscuras mirando su máscara: sólo si sigue estructuras reales; si no, contraste local con máscara de fondo |

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
| Modelos de fondo con referencia o IA de GraXpert en nebulosas oscuras, IFN o polvo extenso | Plano robusto grado 1 o muestras manuales |
| Escala por defecto de sample_free / `-sample_free_simplified true` | sample_free escala 10 (8 si queda gradiente) |
| Corregir por división un gradiente aditivo (o por sustracción el viñeteo) | Sustracción para contaminación, división para viñeteo |
| DBE sobre nebulosa | Sólo cielo; nunca sobre señal |
| Corregir el gradiente sobre la imagen estirada con el objeto en el campo (el estirado agranda una inclinación lineal pequeña y «se ve») | Volver a lineal y medir el gradiente que se verá al estirar; en estirada, el modelo se come el halo por un lado y deja un borde pardo (pixinsight-mcp) |
| Dar por bueno un modelo sin mirarlo | Liso, sin objeto, sin anillo; `copia_objeto` |

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
| Autoestirado o visualización automática en la capa de estrellas | Fondo a cero y estirado controlado |
| Rellenar un núcleo con un círculo plano | Ley de potencias o superficie de grado 2 |
| Dar por buena una separación porque la starless está "limpia" | Revisar original − starless |
| Fuente "OSC Dualband" de AutoPalette (inventa SII) | DBXtract o su emulación, fuente "DBXtract / Mono" |
| Llamar SHO a una paleta de sólo Hα/OIII | Decir "pseudo-SHO" |
| OIII con B como continuo (lleva Hβ) | OIII con G |
| Inyectar Hα sin máscara | Máscara de luminancia/nebulosa (clipLow 0,04–0,08) |

## F.6 Herramientas

| No hacer | En su lugar |
|---|---|
| Escribir código del programa o pedir que se ejecute | Las funciones de la guía; si ninguna sirve, decirlo y proponer qué hacer |
| `saveAs` y creer que conserva el historial | Anotar los parámetros en el dossier |
| Lanzar scripts o depender de iconos del escritorio | Su función equivalente de la guía (Anexo A) |
| Suponer nombres de parámetros | La ficha del paso o el manifiesto (`herramientas/manifiesto.json`) |

## F.7 Criterio de parada

**La regla base:** "no aplicar un paso es un resultado válido". En galaxia la reducción de halos, el realce de estructuras oscuras, CLAHE y el HDR de núcleo perdieron todos contra no hacer nada en un apilado limpio.

Se para cuando:

1. **El control empeora o no mejora.** Comparar siempre contra la copia sin tocar del mismo punto y contra la versión anterior. Si el resultado no gana, se revierte; no se "ajusta un poco más".
2. **El control falla.** "Si un control falla, volver al punto de control anterior y repetir el paso causante con parámetros más suaves (menos saturación en LRGB, menos fuerza de Hα, menos contraste local…)".
3. **Hay que tapar el fallo.** "No usar un recorte/clamp final para ocultar núcleos quemados (para eso están las tomas cortas)."
4. **Se está forzando la señal.** "Con 2 h 50 min de una sola noche el cuerpo tiene menos estructura que las referencias: forzarla saca ruido."
5. **No hay variantes que comparar.** En los pasos dudosos (estirado, Hα, contraste local, saturación, umbral de HDR): 3–4 variantes, puntuarlas y quedarse con una; si ninguna convence, no se aplica.
6. **Falla un paso esencial.** Parar y avisar (gradiente, SPCC, BXT, estirado).

Número de iteraciones o de pasadas hasta "rendirse": `[Pendiente de documentar]` — la guía fija el criterio (comparar contra no hacer nada) pero no un límite numérico.

## F.8 Revisiones tras la opinión del usuario (IC 63 en SASpro, 26 nov 2026)

Lo aprendido en 14 versiones de IC 63 (SQA106 + 2600MC, RGB HDR + Hα dual band), con el usuario revisando cada una. Sirve para cualquier objeto.

1. **Arreglar el defecto sobre la versión que le gusta, no rehacer la cadena.** v2, v3 y v6 cambiaron estirado, cielo o contraste para resolver una queja y perdieron lo que le gustaba de v1. Las que volvieron a v1 y tocaron sólo el defecto (v4, v7) se aceptaron.
2. **Subir el estirado o el cielo agranda el halo de una estrella brillante y aplana la nebulosa.** Medido en v2 y v3 alrededor de γ Cas.
3. **Un anillo alrededor de una estrella brillante puede ser de la saturación, no del halo.** Si el halo cambia de tono con el radio (violeta dentro, cian fuera), saturar convierte el cambio en un anillo (saturación 0,99 a r ≈ 500–580 px). Rehacer el halo en un solo color y sacar la saturación de esa zona con una máscara radial.
4. **Restar un halo con suelo:** p' = max(p − k·H, 0,5·p). Sin el suelo, el 0,011 % de los píxeles de R se fue a 0.
5. **Seleccionar zonas tenues por exceso local, no por umbral absoluto.** Un umbral de L cogió los bordes de Hα (6,7 % de la imagen); «B/R menos su desenfoque σ60» encontró las zonas azuladas débiles.
6. **Ganancias calculadas sobre la luminancia suavizada** (σ3); si no, las sombras salen moteadas.
7. **Realzar tonos suaves con máscara muy desenfocada** (σ60, normalizada al p99,5, estrella brillante excluida). Las sombras se refuerzan sólo donde la zona es más oscura que su entorno: sh = min(Ls − blur_σ50(Ls), 0), con L < 0,2 y suelo 0,55·L.
8. **Proteger las luces en cualquier realce de color.** En los rojos, con un peso (0,92 − máx)/0,25; sin él, R recortó entre el 0,011 % y el 0,07 %. En las estrellas, dividir por max(1, canal máximo) en vez de recortar.
9. **Capa de estrellas con cuatro mandos medibles:** cantidad Y^γ, presencia 1 − (1 − Y)^g, tamaño max(Y, k·gauss(Y, σ)) y color alrededor de la media. Se miden con umbral Y 0,04 y máximos locales en 7 px: número de estrellas, área/número, Y en los picos originales y saturación media. Con eso se clavó lo que pidió el usuario (+25/+25/+25/+28 %) con un error de 0,2 puntos.
10. **Dar los valores de cada opción.** Con los parámetros a la vista, el usuario pide números exactos en vez de «una entre medias».
11. **Al recombinar estrellas, mirar el cielo.** `recombinarEstrellas` de SASpro subió el cielo de 0,035 a 0,049; se recombinó fuera con la capa conocida: S = 1 − (1 − v)/(1 − starless), v = 1 − (1 − o)(1 − S).
