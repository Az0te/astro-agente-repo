# Paso 5: Alineado y recorte común

[← Índice](../SKILL.md) · Anterior: [Paso 4: Preprocesado](04-preprocesado.md) · Siguiente: [Paso 6: Composición HDR](06-hdr-composition.md)

**Por qué.** Todos los masters (RGB y banda estrecha) tienen que estar en la misma rejilla de píxeles antes de combinarse; y hay que recortar los bordes de apilado antes de corregir gradientes, porque un borde negro se convierte en un gradiente artificial. "Las tomas RGB y NB pueden estar giradas entre sí y a escala distinta".

**Registro**

- Registrar los masters como ficheros, con una carpeta de salida.
- **Una sola referencia común**, la imagen con mejor resolución y SNR (normalmente la L o el Hα de la mono), con splines de superficie + corrección de distorsión.
- "Cada remuestreo suaviza la PSF y el ruido: **interpolar una sola vez** (Lanczos-3, en 32 bits) y no encadenar resize + registro + rotación si se puede evitar."
- Si las escalas difieren: registrar escalas distintas (×2) falló; escalar antes con Lanczos-3. Con la razón de escalas astrométricas, un único remuestreo previo y luego registrar.
- Mejor aún: que salgan ya alineados del preprocesado, registrados sobre la misma referencia (Paso 4).

**Recorte**

- "Recortar todos los masters a la región común antes de procesar (astro-photographie: 'Cropped' es siempre el primer paso). Si los campos difieren mucho (otro telescopio), la imagen final sólo cubre la intersección."
- Calcular el rectángulo válido de todos. "Sin datos" es 0 **o el relleno constante del preprocesado**, igual en los tres canales, que a ojo parece cielo oscuro.
- Recortar también las **franjas con menos cobertura de apilado**: no están vacías, pero su fondo o su ruido se apartan del interior (en una nebulosa dual band, una franja un 21 % más oscura de ~60 px y esquinas más claras y ruidosas de hasta ~100 px).
- **Astrometría:** recortar o remuestrear puede perder o invalidar la solución astrométrica según el programa y la versión; comprobarla después y, si se ha perdido, volver a resolver (Paso 8).

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/lineal.md#lineal-05); en Siril, [Anexo I](../anexos/I-siril.md).

Con las franjas, una nebulosa dual band conservó el 86 % del campo, con las esquinas limpias al estirar fuerte. Comprobado (nov 2026; 3 masters de 300 MB en ~12 s): un master girado 7° y desplazado, y otro binado ×2, quedaron alineados con la referencia, con correlación máxima en el desplazamiento 0,0 (0,93 y 0,94). El binado se reescaló ×2 antes de registrar y conservó la astrometría.

**Control.** Abrir los registrados y comparar la posición de 3–4 estrellas en las esquinas; comprobar que el recorte no deja bandas sin datos (la medida de bordes sin datos del análisis debe dar que no hay). La mediana de una franja de borde no basta: el relleno del preprocesado no es 0. Tras recortar, comprobar que sigue la solución astrométrica.
