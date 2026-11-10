# Paso 5: StarAlignment + crop común

[← Índice](../SKILL.md) · Anterior: [Paso 4: Preprocesado](04-preprocesado.md) · Siguiente: [Paso 6: HDRComposition](06-hdr-composition.md)

**Por qué.** Todos los masters (RGB y banda estrecha) tienen que estar en la misma rejilla de píxeles antes de combinarse; y hay que recortar los bordes de apilado antes de corregir gradientes, porque un borde negro se convierte en un gradiente artificial. "Las tomas RGB y NB pueden estar giradas entre sí y a escala distinta".

**Registro**

- "Registrar con StarAlignment **en modo fichero** (targets como ficheros, outputDirectory); `executeOn(view)` no registra." Estructura de `targets`: `[[enabled, isFile, path]]`.
- **Una sola referencia común**, la imagen con mejor resolución y SNR (normalmente la L o el Hα de la mono), con surface splines + corrección de distorsión.
- "Cada remuestreo suaviza la PSF y el ruido: **interpolar una sola vez** (Lanczos-3, en 32 bits) y no encadenar resize + registro + rotación si se puede evitar."
- Si las escalas difieren: "Registrar escalas distintas (×2) nos falló: escalar antes con Resample (Lanczos-3)". Con la razón de escalas astrométricas, un único Resample previo y luego registrar.
- Mejor aún: que salgan ya alineados del preprocesado, registrados sobre la misma referencia (Paso 4).

**Crop**

- "Recortar todos los masters a la región común antes de procesar (astro-photographie: 'Cropped' es siempre el primer paso). Si los campos difieren mucho (otro telescopio), la imagen final sólo cubre la intersección."
- Calcular el rectángulo válido de las tres.
- **Astrometría con splines (corrección de distorsión):** no se puede transformar. Crop, Resample y los demás abren el diálogo "Some of these side effects could be irreversible. Proceed?", que **deja el proceso parado** esperando a que alguien pulse. Antes de recortar o reescalar, hay que reducir la solución a su parte lineal (lo hace `alinearMasters` por dentro): en una nebulosa de emisión y reflexión, tras IntegerResample ×2 coincidía con una resolución nueva a 0,11 px. `alinearMasters` ya lo hace.
- **Crop y rotación y la astrometría lineal**: desde PixInsight 1.9.6, Crop, DynamicCrop, Resample, IntegerResample y FastRotation conservan la solución y la ajustan (comprobado: 0,05 px frente a una resolución nueva). Con 1.9.5 o anterior se perdía: "trasladarla copiando las propiedades `AstrometricSolution:*` con el offset (ver Flujo probado, paso 3) y `regenerateAstrometricSolution()` funcionó (residuos 0,2–0,3 px)", o volver a resolver (Paso 8).

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/lineal.md#lineal-05); en Siril, [Anexo I](../anexos/I-siril.md).

Con las franjas, nebulosa dual band conserva el 86 % del campo, con las esquinas limpias al estirar fuerte (`franjas: false` para no buscarlas).

Al terminar abre los alineados en PixInsight con un STF automático, con la referencia delante (`abrir: false` para no abrirlos). Devuelve el rectángulo, el % del campo que se conserva, las estrellas emparejadas, los bordes a 0 y si cada uno conserva la astrometría.

```json
{"llamadas": [
  {"funcion": "alinearMasters", "parametros": {"masters": ["<Hα>", "<OIII>", "<RGB>"], "opciones": {"referencia": "<Hα>", "salida": "<carpeta>/alineados"}}}
]}
```

Comprobado con una nebulosa dual band (nov 2026; 3 masters de 300 MB en ~12 s). Un master girado 7° y desplazado, y otro binado ×2, quedaron alineados con la referencia: correlación máxima en el desplazamiento 0,0 (0,93 y 0,94). El binado se reescaló ×2 antes de registrar y conserva la astrometría.

**Control.** Abrir los registrados y comparar la posición de 3–4 estrellas en las esquinas; comprobar que el recorte no deja bandas sin datos: `bordesSinDatos(vista)` de `herramientas/analisis.js` (también sale en `analizarMaster`) debe dar `hay: false`. La mediana de una franja de borde no basta: el relleno de WBPP no es 0. Tras recortar, comprobar `hasAstrometricSolution`: con 1.9.6+ la conserva; con versiones anteriores no, y hay que resolver de nuevo (Paso 8) o trasladar la solución.
