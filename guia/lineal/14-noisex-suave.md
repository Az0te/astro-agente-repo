# Paso 14: Reducción de ruido suave (opcional)

[← Índice](../SKILL.md) · Anterior: [Paso 13: BlurX completo](13-bxt-completo.md) · Siguiente: [Paso 15: Separación de estrellas y reducción de ruido de la capa sin estrellas](15-starx.md)

**Por qué.** Es una pasada **ligera y opcional** antes de SXT: "NXT ligero opcional después de BXT completo y antes de SXT (denoise 0,50)". No es el denoise principal. Su objetivo es que SXT no confunda ruido con estrellas débiles, sin quitar la información que BXT ya usó. "Nunca NR antes de BXT": aquí ya se ha pasado BXT completo, así que es el primer momento válido.

**Parámetros**

| Parámetro | Valor |
|---|---|
| denoise | 0,50 (pasada ligera) |
| detail | 0,10–0,20 ("más alto crea halos oscuros en estrellas") |
| iterations | 2–3 |
| Separación color | croma > luminancia (nebulosa oscura: croma 0,90, luminancia 0,40, detail 0,25) |
| tile overlap | 0,50 si aparecen bloques |
| Valor por defecto | **No** el 0,90: "denoise 0,70–0,80 (no el 0,90 por defecto)" |

- "`iterations` (más iteraciones conservan mejor el detalle débil y limpian el moteado de gran escala; 2–5), separación **HF/LF** (moteado de fondo = baja frecuencia; ajustar la escala poniendo temporalmente LF a 0 con vista previa), **tile overlap** 0,50 si aparecen bloques."
- "NXT funciona también en no lineal (se entrenó con imágenes estiradas)". En esta fase, lineal.
- **Esta pasada va sobre la imagen con estrellas: protegerlas.** NXT en lineal puede estropear los núcleos de las estrellas (color raro en el centro o centro más oscuro que el halo), y no se ve hasta estirar (astroimagetw, «la IA todavía necesita máscaras»; mejor en AI3, pero no desaparece). Con estrellas brillantes, aplicarla con máscara de estrellas ([Paso 4 no lineal](../no-lineal/04-mascaras.md)) o dejar el denoise para la starless del Paso 15; y revisar los núcleos al 200–400 % tras estirar.
- **Separación de frecuencias** (manual de RC-Astro): alta frecuencia = grano píxel a píxel; baja = manchas y ondulaciones. Valores de partida: intensidad alta 0,80–0,90 y baja 0,50–0,70; color alta 0,90–1,0 y baja 1,0 (la croma de baja frecuencia al 100 % quita las manchas de color). Bajar la intensidad de baja frecuencia conserva el polvo y las nubes débiles. Entra como candidato más en la comparativa (sólo en color).

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/lineal.md#lineal-14); en Siril, [Anexo I](../anexos/I-siril.md).

**Criterio de elección.** Se aplica el candidato que **más ruido quita sin perder prácticamente detalle** (≤ 2 % de `detalle_perdido_pct`) ni añadir recortes, en lineal igual que en no lineal. «Varias pasadas suaves mejor que una fuerte» vale cuando la fuerte pierde detalle o da aspecto de cera: si la fuerte no pierde detalle, se usa la fuerte (galaxia grande, 10 nov 2026: NoiseX 0,50 dejó el ruido del cielo al 50 % sin perder detalle y una pasada «ligera» al 63 % dejó el fondo con grano). Pero una pasada que deja menos del 25 % del ruido da un **fondo muerto** de aspecto plástico (galaxia grande: 0,90 dejó el 10 % y la medida de detalle no lo veía); y si tras estirar el cielo ya está limpio, como mucho una pasada suave. La pérdida de detalle se mide en la parte brillante del objeto, sin núcleo ni estrellas.

**Comparar en vez de fijar el valor.** Probar sobre la misma entrada varias fuerzas (0,30 / 0,50 / 0,70), la separación de frecuencias (en color), un denoise fuerte **sólo donde hay poca señal** (máscara que protege lo brillante, que ya tiene buena relación señal/ruido; Jon Rista) y algún método distinto, con las mismas medidas (`ruido_rel` del cielo, contraste de la zona débil, estructura de la residual, moteado de color), y quedarse con el que más baja el ruido sin pasar del 80 % entre los que cumplen. En una nebulosa de emisión y reflexión sin calibrar (8 nov 2026) ganó la fuerza 0,70 (−57 %): los que quitaban más ruido subían el moteado de color más de 0,3.

**Control.** σ del cielo baja poco (es una pasada suave), contraste de una zona débil no baja más de ~5 %, la imagen diferencia (antes − después) debe ser **sólo ruido**. Si aparece aspecto de cera, se ha pasado: bajar denoise o dejarlo para la starless.
