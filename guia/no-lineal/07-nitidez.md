# Paso 7: Nitidez

[← Índice](../SKILL.md) · Anterior: [Paso 6: NoiseX](06-noisex.md) · Siguiente: [Paso 8: Procesado de estrellas](08-estrellas.md)

**Por qué.** El sharpening refuerza bordes existentes; no crea detalle. Va **al final**, sobre la imagen no lineal y con máscara, después de deconvolución (BXT) y denoise: hacerlo antes amplifica ruido y luego el denoise se lo lleva, dejando textura sucia. "Deconvolución (lineal) restaura; sharpening refuerza bordes existentes (sube ruido)... Orden: deconvolución → denoise → microcontraste/LHE con máscara → sharpening final sobre no lineal y con máscara".

**Según muestreo**

| Muestreo | Qué hacer |
|---|---|
| Submuestreado | drizzle útil, deconvolución limitada, sharpening prudente |
| Bien muestreado | deconvolución muy eficaz |
| Sobremuestreado (drizzle 2x) | deconvolución eficaz, sharpening ligero, denoise más importante |

**Si no hay BXT** (o para comparar): deconvolución clásica con PSF medida con DynamicPSF, máscara de estructuras/estrellas, deringing para evitar anillos oscuros y regularización wavelet para no crear patrones en el fondo.

**Con LRGB**, "el detalle se trabaja en la L".

**Verificación.** "Verificar al 100 % y en negativo."

**Código.** No hay una receta de sharpening no lineal medida (proceso, radio, amount): está en el Anexo C. Lo documentado es el **orden**, la máscara y la verificación. Si se aplica, siempre con máscara que proteja estrellas y fondo, nunca global, y comparando contra la versión sin sharpening; casi siempre basta con lo que ya hizo BXT.

**Control.** Sin halos oscuros alrededor de estrellas ni bordes "ilustrados"; sin grano amplificado en el fondo; comparación al 100 % contra la versión sin sharpening. "Probar variantes... y quedarse con la mejor"; "no aplicar un paso es un resultado válido".
