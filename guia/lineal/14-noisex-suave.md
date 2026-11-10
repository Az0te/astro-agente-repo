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

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/lineal.md#lineal-14); en Siril, [Anexo I](../anexos/I-siril.md).

**Comparar en vez de fijar el valor.** Probar sobre la misma entrada varias fuerzas (0,30 / 0,50 / 0,70) y algún método distinto, con las mismas medidas (`ruido_rel` del cielo, contraste de la zona débil, estructura de la residual, moteado de color), y quedarse con el que más baja el ruido sin pasar del 80 % entre los que cumplen. En una nebulosa de emisión y reflexión sin calibrar (8 nov 2026) ganó la fuerza 0,70 (−57 %): los que quitaban más ruido subían el moteado de color más de 0,3.

**Control.** σ del cielo baja poco (es una pasada suave), contraste de una zona débil no baja más de ~5 %, la imagen diferencia (antes − después) debe ser **sólo ruido**. Si aparece aspecto de cera, se ha pasado: bajar denoise o dejarlo para la starless.
