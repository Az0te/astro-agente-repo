# Detalle del Paso 15 lineal: ruido de la starless, denoise de detalle fino frente a NoiseX

[← Ficha del paso](../lineal/15-starx.md) · [Índice](../SKILL.md) · En PixInsight: [Anexo J, detalle](../anexos/J-pixinsight/detalle.md#lineal-15)

Material de apoyo de la ficha: comparación medida de un denoise por IA de detalle fino (ML; en PixInsight, MLDenoise) y de la variación total multiescala (TGV) con NoiseXTerminator (NXT), y la receta híbrida que ganó. La ficha manda. Los parámetros de cada programa están en su anexo.

**Resultado.** En los tres canales gana el **híbrido**: el detalle fino del denoise ML (al 100 %) con lo grueso de NXT 0,95. Iguala a NXT en ruido a todas las escalas y borra menos detalle de nebulosa. Con señal fuerte (Hα), el ML solo ya empata con NXT 0,95. Con señal débil (OIII, SII), el ML solo deja hasta el doble de ruido a 16 px: hace falta NXT para lo grueso.

**Cómo se midió (nebulosa dual band, refractor 106 mm + OSC dual band, 3–4 nov 2026).** Medir sólo cuánto baja σ no distingue ruido quitado de señal borrada. Por eso se usó una referencia independiente:

- **A** = 1 de cada 4 subs registrados (24 de Hα, 29 de OIII y de SII), integrados aparte: la imagen ruidosa que se filtra.
- **B** = el resto de subs de esas sesiones más otra sesión (122 / 148 subs), sin ningún sub en común con A: la "verdad" con ~4× menos ruido.
- Escala A→B por fotometría de 400–550 estrellas (el ajuste por regresión o por contraste falla con señal débil: en OIII dio 0,21 y 2,04 frente a 1,36). Se quita la diferencia de gradiente entre sesiones (escalas > ~64 px).
- Error = RMS de (A filtrada − B) por zonas sin estrellas (cielo, medio, nebulosa) a 1, 4 y 16 px. El ruido de B suma igual a todas las variantes: no cambia el orden.
- Detalle = pendiente del error frente a la estructura de escala media de B en la nebulosa (más negativa = más detalle real borrado).
- Puntuación por canal: ruido 70 % (media de los 9 errores, 100 = el mejor en cada uno) + detalle 30 % (100 = original, 0 = el que más borra).

Este método (dos integraciones independientes de los mismos datos) sirve para comparar cualquier denoise en cualquier programa.

**Puntuaciones (total 0–100, comparables sólo dentro de un canal)**

| Variante | Hα | OIII | SII |
|---|---|---|---|
| Híbrido ML fino + NXT grueso | **81,5** | **83,8** | **74,4** |
| Híbrido sólo ML (bin2 para lo grueso) | 81,1 | 76,0 | 68,5 |
| ML + NXT 50/50 | 81,1 | 75,6 | 71,4 |
| ML 1,0 | 81,0 | 67,0 | 68,3 |
| NXT 0,95 | 78,6 | 78,6 | 69,7 |
| NXT 0,85 | 79,2 | 71,4 | 66,8 |
| NXT 0,70 | 77,7 | 58,6 | 59,3 |
| TGV fuerza 0,7, 8 escalas | — | 75,1 | 44,6 |
| TGV fuerza 0,6, 8 escalas | — | 75,1 | 52,5 |
| TGV fuerza 0,5, 8 escalas | — | 70,0 | — |
| TGV por defecto (0,5, 2 escalas) | — | 52,4 | — |

**Variación total multiescala (TGV, medida el 5 nov 2026).** Con 8 escalas y fuerza 0,6–0,7 iguala al híbrido en ruido (OIII: error en el cielo 1,60·10⁻⁵ a 1 px y 3,2·10⁻⁶ a 16 px), pero borra más detalle de la nebulosa (pendiente −0,50 a −0,59 frente a −0,43 del híbrido; en SII −0,47 a −0,58, más que cualquier otra variante). No supera ni al híbrido ni a NXT 0,95; con 2 escalas deja tres veces más ruido a 16 px. Hα no se midió. Queda como alternativa sin RC-Astro ni modelo ML, con 8 escalas y fuerza 0,6.

Error en el cielo a 16 px, OIII: NXT 0,95 3,1·10⁻⁶; híbrido 3,1·10⁻⁶; ML 1,0 6,1·10⁻⁶. Detalle en nebulosa, OIII: híbrido −0,43; NXT 0,95 −0,55.

**Lo que no ayudó.** Mezclar parcialmente con el original (amount < 1), una segunda pasada del ML, más solapamiento o más precisión: igual resultado o más tiempo. Una transformada multiescala lineal detrás del ML quita el moteado de 4 px, pero borra tanto detalle como NXT 0,95: no compensa.

**Receta híbrida** (sobre la starless lineal; no sobre imágenes con estrellas: la variante bin2 deja puntos negros en los núcleos)

- Sobre el canal mono lineal sin estrellas: una copia por el denoise ML (al 100 %) y otra por NXT (denoise 0,95, intensidad 0,95, detalle 0,15, 2 iteraciones).
- Híbrido = fino del ML + grueso de NXT: `ML − caja₃(ML) + caja₃(NXT)` (caja₃ = desenfoque de caja de radio 3).
- Variante sólo ML (Hα, sin NXT): en lugar de NXT, el ML sobre una copia reducida 2× (promedio) y reescalada al tamaño original; combinar con radio 4. El híbrido de 3 niveles (bin2 + bin4) limpia muy bien el cielo pero dobla el error en la nebulosa de OIII: descartado.

**Trampas**

- Con NXT, fijar todos sus parámetros en cada prueba (también la intensidad), y en PixInsight usar una vista nueva por prueba (ver Anexo J).
- Las pruebas largas (varios denoise ML seguidos, 8+ min sin parar) pueden dejar el programa sin responder: lanzar tandas cortas y guardar resultados en disco entre medias.
