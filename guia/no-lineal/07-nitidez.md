# Paso 7: Nitidez

[← Índice](../SKILL.md) · Anterior: [Paso 6: NoiseX](06-noisex.md) · Siguiente: [Paso 8: Procesado de estrellas](08-estrellas.md)

**Por qué.** El sharpening refuerza bordes existentes; no crea detalle. Va **al final**, sobre la imagen no lineal y con máscara, después de deconvolución (BXT) y denoise: hacerlo antes amplifica ruido y luego el denoise se lo lleva, dejando textura sucia. "Deconvolución (lineal) restaura; sharpening refuerza bordes existentes (sube ruido)... Orden: deconvolución → denoise → microcontraste/contraste local con máscara → sharpening final sobre no lineal y con máscara".

**Según muestreo**

| Muestreo | Qué hacer |
|---|---|
| Submuestreado | drizzle útil, deconvolución limitada, sharpening prudente |
| Bien muestreado | deconvolución muy eficaz |
| Sobremuestreado (drizzle 2x) | deconvolución eficaz, sharpening ligero, denoise más importante |

**Si no hay BXT** (o para comparar): deconvolución clásica con la PSF medida en estrellas, máscara de estructuras/estrellas, deringing para evitar anillos oscuros y regularización wavelet para no crear patrones en el fondo.

**Con LRGB**, "el detalle se trabaja en la L".

**Verificación.** "Verificar al 100 % y en negativo."

**Niveles para elegir** (Rafael, 11 nov 2026). Sobre la **starless** estirada (las estrellas van aparte: sin ellas no hay halos oscuros que crear) y con máscara de luminancia que protege el cielo, tres niveles de máscara de enfoque en luminancia: suave (σ 1,5, amount 0,3), equilibrado (σ 2, 0,5) y acentuado (σ 2,5, 0,7). Se mide el detalle fino (laplaciana en las celdas con señal), el ruido y el nivel del cielo y los quemados; se recomienda el más fuerte que no sube el ruido del cielo más de un 10 %, y si ninguno cumple, no aplicar. El usuario elige mirando un recorte al 100 %. Valores de partida sin calibrar con casos (Anexo C); casi siempre basta con lo que ya hizo la deconvolución.

**Grano del objeto, no sólo del cielo** (24 nov 2026). La máscara de luminancia protege el cielo, pero el grano de la nebulosa se amplifica igual: en la paleta de IC 1396 de Qwen el «detalle ×1,31» del equilibrado era casi todo grano (la laplaciana mide sobre todo ruido a 1 px), y la final quedó con 2,6 veces el grano del Natural de Rafael, que no llevó máscara de enfoque. `nitidezCandidatos` mide ahora, en las mismas celdas brillantes, el **grano** (`|L − caja 3×3|`, 1 px) y la **estructura** (`|caja 3×3 − caja 9×9|`, 2–8 px), y es `no_cumple` si el grano del objeto sube más de ×1,10 (`granoMax`). Si ningún nivel cumple, lo que falta suele ser relieve de escala grande (Paso 5, candidato «Escala grande» de `contrasteCandidatos`), no enfoque.

**El Paso 6 va antes.** `nitidezCandidatos` se para si desde el último `estirarCandidatos` no hubo reducción de ruido sobre una imagen estirada (`ruidoCandidatos`/`reducirRuido`): las paletas de IC 1396 se lo saltaron. `forzar: true` sólo si el usuario no quiere el Paso 6.

**Microcontraste no es resolución** (lámina «le microcontraste n'est pas la résolution»): el contraste local y la nitidez hacen más visible lo que ya hay; sólo la deconvolución puede bajar la FWHM, y sólo con buena SNR. Tras la nitidez, la FWHM de las estrellas (en la imagen recombinada) no debe cambiar: si "mejora", es un artefacto. Un detalle que no aparece en los datos de otra noche o en otra integración no es un detalle.

**Control.** Ruido del cielo ≤ ×1,10; FWHM de las estrellas igual que antes; sin halos oscuros alrededor de estrellas ni bordes "ilustrados"; sin grano amplificado en el fondo; comparación al 100 % contra la versión sin sharpening. "Probar variantes... y quedarse con la mejor"; "no aplicar un paso es un resultado válido".
