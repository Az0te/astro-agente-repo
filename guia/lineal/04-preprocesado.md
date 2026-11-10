# Paso 4: Preprocesado

[← Índice](../SKILL.md) · Anterior: [Paso 3: Selección de subs](03-blink-subframeselector.md) · Siguiente: [Paso 5: Alineado y recorte común](05-staralignment-crop.md)

**Por qué.** "Los errores aquí no se arreglan después": un master con flats mal calibrados, darks incompatibles o grupos mezclados no se recupera en postprocesado. Todo lo que sigue en esta guía asume que el master es correcto.

**Revisión previa al preprocesado (lecciones nebulosa oscura, oct 2026)** — antes de medir subs:

- **Flats por canal Bayer:** mediana y % de píxeles a 65535 en R, G1, G2, B de varios flats de cada tanda (no sólo el primero). En nebulosa oscura los 29 flats del 11-9 estaban saturados; el master flat salió plano (0,4017 en centro y esquinas) y esos lights entraron sin corrección. Comprobar también la relación esquina/centro del master flat (≈ 0,95 con el SQA106 sin filtro).
- **Un grupo por filtro:** leer la lista de subs integrados en el historial del master. El master previo mezclaba 30 Triband + 44 sin filtro en el grupo "Nada".
- **Cobertura entre sesiones:** registrar un sub de cada sesión sobre la referencia y contar la fracción de píxeles con datos. El Triband cubría sólo el 54 % (otro centro y rotación) y dejaba zonas con distinto número de subs.
- **Darks:** comprobar en el log qué master dark usó cada grupo; la biblioteca de darks de lights puede estar en otra carpeta. Alguno con `IMAGETYP='Dark'` en vez de `Master Dark`: añadirlo a mano como master.
- Las sesiones con flats inservibles no se integran; si interesan, repetir flats con el mismo rotador, foco y filtro.

**Parámetros de calibración e integración**

| Elemento | Ajuste documentado |
|---|---|
| Masters bias/dark | Integración por promedio, sin normalización, pesos = 1, rechazo Winsorized Sigma Clipping, sin evaluación de señal/ruido, sin restar pedestales |
| Darks | **Nunca precalibrar los darks con el bias** (se truncan negativos y la calibración queda mal) |
| Calibración de lights | Sin optimización de dark: `(Light − MD)/MF` sin master bias; con amp glow o refrigerada, la optimización apenas aporta |
| Aviso de optimización | "No correlation between the master dark and target frames" (k < 0,005) = los darks no sirven |
| Flats | Calibrar con master bias (o dark de flats de la misma exposición si la corriente de oscuridad no es despreciable); promedio, normalización multiplicativa, rechazo igualando flujos |
| OSC en flats | Factores de escala del flat separados por canal CFA (evita el cambio de color de la corrección de flat) |
| Recorte en bajas luces | Pedestal de salida automático con límite 0,0001 (0,01 %) si muchos píxeles quedan a 0 |
| Corrección cosmética | OSC en modo CFA, juzgada tras debayer; sigma de píxeles calientes alto (Landmann usa 13 en su ASI2600MC; 3 daña estrellas débiles) |
| Debayer | VNG |
| Aberración cromática lateral | Canales RGB separados y registro con splines de superficie (thin plate), todo registrado al verde |
| Registro | Corrección de distorsión (splines) con subs antes y después del meridiano; subir la reducción de ruido de la detección si hay poca SNR |
| Normalización local | Recomendada antes de integrar (no quita gradientes, pero facilita su corrección) |
| Integración | Promedio, normalización local, pesos por señal de PSF, rechazo según número de subs; revisar el mapa de rechazo alto; rechazo de píxeles a gran escala para trazas persistentes |
| Drizzle | Recomendado en OSC aunque no haya submuestreo (evita artefactos del debayer): escala 1 y drop shrink 1,0; 2x si hay submuestreo y muchos subs bien "ditherizados"; el mapa de pesos del drizzle debe ser uniforme |
| Varios masters alineados | Registrarlos todos con la misma referencia común, misma escala de drizzle y recorte automático: salen alineados y recortados igual |
| Rutas | Rutas y carpetas cortas; nombres de sesión con guion bajo (SESSION_1) para las palabras clave de agrupación |

**Diagnóstico de flats en el master** (para no culpar al postprocesado): viñeteo residual = subcorrección (flats sin calibrar o bias y dark restados a la vez); "viñeteo negativo" = lights sin dark; motas de polvo en relieve = rotación movida, polvo desplazado, filtro mal posicionado en la rueda (usar movimiento unidireccional) o luz parásita (probar sky flats).

**Medidas por sub.** Las métricas sobre los FITS crudos CFA ordenan bien, pero los valores absolutos están sesgados (en debayerizado VNG el FWHM sale ~15–20 % mayor y la excentricidad ~0,06 menor). Para umbrales absolutos, debayerizar una muestra. Fondo por sub = mediana − bias (bias con offset 50 ≈ 500 ADU). Gradiente por sub = rejilla 4×4 de medianas; en crudo incluye el viñeteo (~2,4 %). Un velo fino se ve como fondo +5–8 % con 15–18 % menos estrellas respecto a sus vecinos.

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/lineal.md#lineal-04); en Siril, [Anexo I](../anexos/I-siril.md).

La revisión de la calibración antes de lanzar el preprocesado, leyendo sólo cabeceras y unos pocos flats, encontró en una nebulosa oscura (nov 2026) lo que en octubre costó una tarde: sin dark de 240 s, flats sin `FILTER`, flats con otro `TELESCOP` y flats saturados. En una galaxia grande detectó los flats con el azul saturado y que no había dark de 60 s. En una nebulosa dual band, que los flats y los lights llevaban nombres de filtro distintos para el mismo filtro (renombrado en el programa de captura después de los flats): hay que emparejarlos con un alias o corregir `FILTER` en copias de los flats.

**Sin preprocesado automático:** la cadena equivalente con los ajustes de la tabla: calibración → corrección cosmética → debayer → medida de subs → registro → normalización local → integración → drizzle, todos con ficheros de entrada y carpeta de salida. Con los masters hechos, se audita el resultado: en el historial del master deben estar la calibración, el debayer (OSC), el registro, la normalización local, la integración y, si se usó, el drizzle. Si falta alguno, se anota como «FALTA» y se revisa el preprocesado antes de seguir.

**Control.** Si falta la calibración, el debayer o la integración, el "master" no es un master. Antes de seguir, comprobar el % de píxeles saturados por grupo y que la exposición más corta no esté saturada en lo que debe aportar.
