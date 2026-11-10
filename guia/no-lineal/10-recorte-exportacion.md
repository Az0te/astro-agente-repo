# Paso 10: Recorte y exportación

[← Índice](../SKILL.md) · Anterior: [Paso 9: Recombinación](09-recombinacion.md) · Siguiente: [Paso 11: Dossier](11-dossier.md)

**Por qué.** La exportación no es un detalle: si el perfil ICC no es sRGB, los colores cambian fuera de PixInsight; si se redimensiona antes de tiempo, se pierde el criterio de nitidez; si no se guardan las capas y la versión XISF con astrometría, no se puede rehacer.

**Antes de exportar**

- "Recortes a 100 % en fondo, núcleo de la estrella más brillante y zona de nebulosa; % de píxeles saturados; controles objetivos de arriba; comparar con la versión anterior (diferencias por zonas)."
- "Guardar cada versión con nuevo nombre: XISF 32 bits con astrometría, TIFF 16 bits, JPG y capas separadas (nebulosa sin estrellas y estrellas). Guardar también capas lineales intermedias (incluida la HDR y sus máscaras)."
- "Antes de exportar JPG/TIFF para web o impresión: **ICCProfileTransformation a sRGB** (perfil incrustado), para que los colores se vean igual fuera de PixInsight. Redimensionar sólo al final."

**Cuidados**

- "`window.saveAs` no guarda el historial de procesos en el XISF: anotar los parámetros en el dossier".
- Desde PixInsight 1.9.6, Crop, DynamicCrop (también girado), Resample y FastRotation **conservan la astrometría** y la ajustan al nuevo marco. Comprobado (nebulosa dual band, nov 2026): tras Crop + Resample 0,5 + DynamicCrop de 10°, una nueva resolución coincide con la heredada a 0,05 px; tras FastRotation 180°, igual que el original. Con 1.9.5 o anterior se perdía y `FastRotation` sobre una ventana con astrometría llegó a colgar PixInsight: girar con PixelMath `pixel($T, w()-1-x(), h()-1-y())`.

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/no-lineal.md#no-lineal-10); en Siril, [Anexo I](../anexos/I-siril.md).

**Control.** Abrir el JPG/TIFF exportado en un visor externo y comparar con PixInsight (si cambia, el ICC no está incrustado). Comprobar dimensiones y que el recorte no deja bordes negros ni bandas de máscara.

**Pendiente:** calidad y tamaño de los JPG de entrega (Anexo C); sólo está fijado el orden: ICC y redimensionado al final.
