# Paso 9: Recombinación

[← Índice](../SKILL.md) · Anterior: [Paso 8: Procesado de estrellas](08-estrellas.md) · Siguiente: [Paso 10: Recorte y exportación](10-recorte-exportacion.md)

**Por qué.** El screen es la operación que devuelve las estrellas sobre la starless sin endurecerlas: `R = 1 − (1−N)(1−S)`. "No endurece estrellas; esencial en galaxias; la suma deja ver bordes de residuos de SXT". La suma sólo vale en lineal; mezclar estrellas lineales con una starless estirada produce "círculos enormes".

**Reglas**

- Screen en no lineal. "Con fuerza ajustable `~(~$T * ~(k*stars))` (**k ≈ 0,5–0,6** para estrellas discretas en galaxias)."
- Con la starless estirada, llevar las dos capas a casi lineal con una MTF, combinar ahí y volver a estirar con la inversa integra mejor las estrellas que el screen directo. Control: el fondo recombinado nunca baja respecto a la starless.
- Suma `Starless + Stars` **sólo en lineal**; `S + k·E` con máscara para casos difíciles.
- "Nunca combinar estrellas lineales sin estirar con una starless estirada."
- Invariante: "el resultado nunca es menor que la base (`1−(1−B)(1−S) ≥ B`); si el fondo baja tras recombinar, hay un error en otro sitio. Lo que ya está a 1 en cualquier capa no se recupera."
- "Comprobar la reconstrucción: starless + estrellas con su propia fórmula debe reproducir la imagen original."

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/no-lineal.md#no-lineal-09); en Siril, [Anexo I](../anexos/I-siril.md).

**Las estrellas tienen que verse.** `aporte_estrellas_pct` es el % de píxeles que suben más de 0,01 al recombinar. Por debajo del 2 % `no_cumple` avisa: la final saldrá casi sin estrellas. Bien procesadas salen 6–10 % (galaxia grande 5,9 %, nebulosa oscura 10 %). Con la capa de `starStretch` amount 2 salió 0,19 % en una galaxia grande y 0,8 % en una nebulosa oscura, y las dos finales quedaron casi sin estrellas. Que el fondo no suba ni baje no basta: se vuelve al Paso 1 con el arcsinh por defecto (en galaxias, `tipo: "galaxia"`) y se repiten los Pasos 8 y 9. Umbral calibrado con un solo caso; en un campo con muy pocas estrellas puede ser normal, y se dice.

**Control.** "Residuo (Original − Final) ≈ ruido"; zoom 200–400 % en zonas brillantes; halos residuales → máscara/reducción en la capa de estrellas; agujeros en la starless → ensanchar máscara o reextraer. "Con estrellas de otra cámara/filtro/exposición: color equilibrado (SPCC), sin dominante, sin estrellas demasiado grandes ni halos de combinación, sin perder las débiles."
