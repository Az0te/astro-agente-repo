# Paso 6: NoiseX

[← Índice](../SKILL.md) · Anterior: [Paso 5: Boost (curvas, contraste, saturación)](05-boost.md) · Siguiente: [Paso 7: Nitidez](07-nitidez.md)

**Por qué.** El denoise principal ya se hizo en lineal sobre la starless (Paso 15 de la fase lineal; por defecto el híbrido ML + NXT). El boost ha amplificado el ruido de croma y el moteado de baja frecuencia. Este es el denoise **final**, sobre la capa sin estrellas y ya estirada: aquí sí se puede ser más agresivo que en lineal, porque BXT ya hizo su trabajo. "Si va a haber saturación fuerte, quitar el ruido de croma **antes** de saturar".

**Parámetros**

| Parámetro | Valor |
|---|---|
| Pasada final tras estirar | 0,15–0,30 por defecto; 0,50–0,70 sólo si tras los realces se ve ruido de croma |
| Receta nebulosa de emisión y reflexión | NXT 0,75 bajo la máscara de fondo del contraste local + 0,30 global |
| Separación de color | croma 0,90 / luminancia 0,40 (si hay saturación fuerte o el ruido de croma se ve) |
| detail | 0,25 con separación de color |
| Tras contraste local o compresión multiescala en galaxias | NXT final 0,30 ("más suaviza el detalle recuperado") |
| Pasada final muy suave (aescaffre) | 0,15 tras el contraste local |

- "El ruido de crominancia es mayor y el ojo lo percibe 4–5 veces menos: se puede suavizar más la crominancia que la luminancia (NXT con separación color/frecuencia)."
- **Mucho más suave que en lineal.** Las fuerzas que se comparan son bajas (p. ej. 0,30, 0,50 y dos pasadas de 0,30) y ninguna debe dejar menos de la mitad del ruido del cielo: más baja da un fondo muerto, sobre todo si ya hubo un denoise fuerte en lineal.
- "Varias pasadas suaves mejor que una fuerte (una fuerte da aspecto de cera)": sólo cuando la fuerte pierde detalle. Criterio de elección: Se aplica el candidato que **más ruido quita sin perder prácticamente detalle** (≤ 2 % de `detalle_perdido_pct`) ni añadir recortes. «Varias pasadas suaves mejor que una fuerte» vale cuando la fuerte pierde detalle o da aspecto de cera: si la fuerte no pierde detalle, se usa la fuerte (galaxia grande, 10 nov 2026: NoiseX 0,50 dejó el ruido del cielo al 50 % sin perder detalle y una pasada «ligera» al 63 % dejó el fondo con grano). Pero una pasada que deja menos del 25 % del ruido da un **fondo muerto** de aspecto plástico (galaxia grande: 0,90 dejó el 10 % y la medida de detalle no lo veía); y si tras estirar el cielo ya está limpio, como mucho una pasada suave. La pérdida de detalle se mide en la parte brillante del objeto, sin núcleo ni estrellas. Alternativa de aescaffre: denoise 0,20–0,25 y detail 0,15 en lineal antes de SXT, tras estirar la L y tras estirar la RGB, y 0,15 final tras el contraste local.
- Rangos de partida de reflected-space: denoise ≤ 0,70 y detail ≤ 0,25 (a menudo menos), siempre después de la deconvolución.
- "NXT no sustituye a la señal: con poca integración, mejor menos denoise que un fondo plano artificial."
- **Candidatos además de las fuerzas:** NXT con separación de color y de frecuencias (en color; intensidad suave, croma alta y croma de baja frecuencia 1,0, que según el manual de RC-Astro quita las manchas de color) y NXT sólo donde hay poca señal (máscara que deja lo brillante como estaba). Los mide la misma comparativa.
- **Manchas de color grandes (moteado) no se quitan con NXT normal ni con SCNR.** La separación de frecuencias con croma de baja frecuencia es la única variante de NXT pensada para ellas: entra como candidato y decide `moteado_color_despues`; si tampoco lo baja, vale lo de abajo. galaxia grande procesada por un modelo local (7 nov 2026): NXT 0,30 sobre la imagen estirada subió el moteado de 1,45 a 2,03, y 0,20 a 1,79. Vienen de la fase lineal (dominante del checkpoint aceptada, dos NXT lineales encadenados) o de saturar demasiado. Si la reducción de ruido da `moteado_color_despues` > 1,5 aquí, quedarse con la entrada sin este NXT y bajar la saturación o volver al checkpoint. El único límite es 1,5: no inventar otro.
- Los Pasos 14 y 15 lineales son dos NXT encadenados. En RGB/OSC, si se hizo el suave del 14, el principal del 15 va con menos denoise (0,50) y mirando `moteado_color_despues`: en una galaxia grande (0,50 + 0,70) el segundo subió el moteado de 0,35 a 0,92 y dejó el disco con aspecto pintado; la mejor versión hizo una sola pasada lineal.

**Síntomas**

| Síntoma | Causa |
|---|---|
| Fondo moteado o "piel de naranja" | denoise demasiado alto o pocas iteraciones |
| Halos oscuros en estrellas | detail alto |
| Aspecto de cera / plástico | una pasada fuerte |

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/no-lineal.md#no-lineal-06); en Siril, [Anexo I](../anexos/I-siril.md).

**Control.** σ del cielo antes/después (bajar un 50–80 %, nunca a cero: fondo muerto). Contraste de una zona débil (polvo, IFN, filamento): no debe bajar más de ~5 %. Imagen residual: sólo ruido; si se ven filamentos o bordes, se llevó señal.
