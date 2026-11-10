# Paso 10: Recorte y exportación

[← Índice](../SKILL.md) · Anterior: [Paso 9: Recombinación](09-recombinacion.md) · Siguiente: [Paso 11: Dossier](11-dossier.md)

**Por qué.** La exportación no es un detalle: si el perfil ICC no es sRGB, los colores cambian fuera del programa; si se redimensiona antes de tiempo, se pierde el criterio de nitidez; si no se guardan las capas y la versión de 32 bits con astrometría, no se puede rehacer.

**Antes de exportar**

- "Recortes a 100 % en fondo, núcleo de la estrella más brillante y zona de nebulosa; % de píxeles saturados; controles objetivos de arriba; comparar con la versión anterior (diferencias por zonas)."
- "Guardar cada versión con nuevo nombre: 32 bits con astrometría (XISF o FITS), TIFF 16 bits, JPG y capas separadas (nebulosa sin estrellas y estrellas). Guardar también capas lineales intermedias (incluida la HDR y sus máscaras)."
- Antes de exportar JPG/TIFF para web o impresión: **convertir a sRGB** (perfil incrustado), para que los colores se vean igual fuera del programa. Redimensionar sólo al final.

**Cuidados**

- Guardar sin historial pierde los parámetros: anotarlos en el dossier.
- Recortar, remuestrear o girar puede conservar, ajustar o perder la astrometría según el programa y su versión: comprobarla después de cada transformación.

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/no-lineal.md#no-lineal-10); en Siril, [Anexo I](../anexos/I-siril.md).

**Control.** Abrir el JPG/TIFF exportado en un visor externo y comparar con el programa (si cambia, el ICC no está incrustado). Comprobar dimensiones y que el recorte no deja bordes negros ni bandas de máscara.

**Pendiente:** calidad y tamaño de los JPG de entrega (Anexo C); sólo está fijado el orden: ICC y redimensionado al final.
