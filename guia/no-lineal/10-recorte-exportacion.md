# Paso 10: Recorte y exportación

[← Índice](../SKILL.md) · Anterior: [Paso 9: Recombinación](09-recombinacion.md) · Siguiente: [Paso 11: Dossier](11-dossier.md)

**Por qué.** La exportación no es un detalle: si el perfil ICC no es sRGB, los colores cambian fuera del programa; si se redimensiona antes de tiempo, se pierde el criterio de nitidez; si no se guardan las capas y la versión de 32 bits con astrometría, no se puede rehacer.

**Antes de exportar**

- "Recortes a 100 % en fondo, núcleo de la estrella más brillante y zona de nebulosa; % de píxeles saturados; controles objetivos de arriba; comparar con la versión anterior (diferencias por zonas)."
- "Guardar cada versión con nuevo nombre: 32 bits con astrometría (XISF o FITS), TIFF 16 bits, JPG y capas separadas (nebulosa sin estrellas y estrellas). Guardar también capas lineales intermedias (incluida la HDR y sus máscaras)."
- Antes de exportar JPG/TIFF para web o impresión: **convertir a sRGB** (perfil incrustado), para que los colores se vean igual fuera del programa. Redimensionar sólo al final.

**Limpieza cosmética** (antes de exportar; lámina «nettoyage cosmétique»). Revisar al 100–200 % y corregir sólo artefactos **confirmados**, nunca estructuras reales: píxeles calientes o fríos sueltos, trazas de satélite o avión que sobrevivieron al rechazo, cósmicos, motas de polvo (donuts), bordes de integración, restos de la separación de estrellas (agujeros oscuros, cuadrados) y costuras de mosaico. Antes de tocar, confirmar que no es real: una galaxia pequeña lejana o un nudo de nebulosa no se borran. Corregir con máscara y en local, comparar antes y después y anotarlo en el dossier. "Mejor un ligero residuo que una estructura borrada."

**Gamut y espacio de color.** Una imagen de 32 bits puede tener colores que el sRGB no puede mostrar (sobre todo OIII y Hα muy saturados): al convertir a sRGB se recortan o se desplazan. Medir los valores pegados a 0 o a 1 antes y después de la conversión; si la conversión recorta más del 0,05 %, bajar la saturación (Paso 5) o desaturar sólo ese tono y volver a exportar. sRGB para web y redes; para impresión, el perfil del laboratorio con prueba en pantalla. Guardar el maestro en 32 bits (o TIFF 16 bits) con el perfil incrustado. Revisar en un monitor calibrado si se puede (nota del perfil del usuario, no del procesado).

**Cuidados**

- Guardar sin historial pierde los parámetros: anotarlos en el dossier.
- Recortar, remuestrear o girar puede conservar, ajustar o perder la astrometría según el programa y su versión: comprobarla después de cada transformación.

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/no-lineal.md#no-lineal-10); en Siril, [Anexo I](../anexos/I-siril.md).

**Control.** Conversión a sRGB sin recortes nuevos (≤ 0,05 %); versión neutra guardada junto a la elegida; abrir el JPG/TIFF exportado en un visor externo y comparar con el programa (si cambia, el ICC no está incrustado). Comprobar dimensiones y que el recorte no deja bordes negros ni bandas de máscara.

**Pendiente:** calidad y tamaño de los JPG de entrega (Anexo C); sólo está fijado el orden: ICC y redimensionado al final.
