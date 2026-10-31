# Paso 9: Recombinación

[← Índice](../SKILL.md) · Anterior: [Paso 8: Procesado de estrellas](08-estrellas.md) · Siguiente: [Paso 10: Recorte y exportación](10-recorte-exportacion.md)

**Por qué.** El screen es la operación que devuelve las estrellas sobre la starless sin endurecerlas: `R = 1 − (1−N)(1−S)`. "No endurece estrellas; esencial en galaxias; la suma deja ver bordes de residuos de SXT". La suma sólo vale en lineal; mezclar estrellas lineales con una starless estirada produce "círculos enormes".

**Reglas**

- Screen en no lineal. "Con fuerza ajustable `~(~$T * ~(k*stars))` (**k ≈ 0,5–0,6** para estrellas discretas en galaxias)."
- Suma `Starless + Stars` **sólo en lineal**; `S + k·E` con máscara para casos difíciles.
- "Nunca combinar estrellas lineales sin estirar con una starless estirada."
- Invariante: "el resultado nunca es menor que la base (`1−(1−B)(1−S) ≥ B`); si el fondo baja tras recombinar, hay un error en otro sitio. Lo que ya está a 1 en cualquier capa no se recupera."
- "Comprobar la reconstrucción: starless + estrellas con su propia fórmula debe reproducir la imagen original."

**Código**

```javascript
// Screen con fuerza k: equivalente a 1-(1-N)(1-k*S).
var PM = new PixelMath;
PM.useSingleExpression = true;
PM.symbols = "k";
PM.expression = "k = 0.55;\n~(~$T * ~(k*Stars))";   // Stars = id de la capa de estrellas ya estirada
PM.createNewImage = true;
PM.newImageId = "Final";
if (!PM.executeOn(View.viewById("Starless_boost"))) throw new Error("Recombinación falló");
"Final creada";
```

**Control.** "Residuo (Original − Final) ≈ ruido"; zoom 200–400 % en zonas brillantes; halos residuales → máscara/reducción en la capa de estrellas; agujeros en la starless → ensanchar máscara o reextraer. "Con estrellas de otra cámara/filtro/exposición: color equilibrado (SPCC), sin dominante, sin estrellas demasiado grandes ni halos de combinación, sin perder las débiles."
