# Paso 16: LinearFit / sustracción de continuo

[← Índice](../SKILL.md) · Anterior: [Paso 15: StarX y NXT de la starless](15-starx.md) · Siguiente: [Paso 17: Checkpoint](17-checkpoint.md)

**Por qué.** Un filtro de banda estrecha no mide sólo la raya: deja pasar continuo (estrellas, polvo, reflejo). Restar ese continuo con la banda ancha calibrada deja la **emisión** y evita que el Hα pinte de rojo el fondo y las estrellas. "Medir k de nuevo con cada combinación de cámaras y filtros: el k = 0,293 de IC63 (dual band OSC vs RGB OSC) no vale para un Hα de la mono".

**Teoría (Photometric Continuum Subtraction).** `k = mediana robusta de (N−B_N)/(C−B_C)` en estrellas no saturadas; "buena k = residuos simétricos; k baja deja estrellas positivas; k alta, agujeros negros". Para OIII usar **sólo G** como continuo (B lleva Hβ).

**Versión completa (SHO)**

"S,H,O combinados → Gradient → BXT Correct Only → Plate Solve → SPCC narrowband → extraer S,H,O → SXT + NXT por canal; RGB → Gradient → BXT Correct Only → Plate Solve (coordenadas copiadas) → SPCC → SXT → extraer R y G (con estrellas y sin estrellas). PCS con **Max stars 1000, Max peak 0,80, Generate starless**: SII y Hα con R, OIII con G → S,H,O continuum subtracted (lineal)."

**Versión Hα simplificada**

- Cadena: Hα → Gradient → BXT → SXT → NXT → **LinearFit con R como referencia** → sustracción de continuo con R (de la RGB calibrada con SPCC y sin estrellas).
- Fórmula: `Ha_sub = Hα − k·R − c`.
- Caso medido: "En IC63 v3: Ha_sub = Hα − 0,293·R − 0,00155; deja un disco oscuro donde domina el continuo de γ Cas (cubrir con la estrella o enmascarar)."
- Con la R de la HDR y fotometría de apertura: "k = 0,332 con la R de la HDR ... **fotometría de apertura en ~3000 estrellas** (r ≤ 7 px, anillo de cielo 10–14 px, mediana de cocientes)". "En IC 63 el continuo sólo quita un 2–5 % al fantasma: casi todo su rojo es emisión."

**Medición de k (procedimiento)**

1. Localizar estrellas no saturadas en la capa de estrellas **por centroide del flujo**, nunca por el píxel máximo.
2. Apertura r ≤ 7 px y anillo de cielo 10–14 px.
3. Cociente `(N − B_N)/(C − B_C)` por estrella; **mediana** de los cocientes.
4. Comprobar simetría de residuos: si quedan estrellas positivas, k baja; si quedan agujeros negros, k alta.

**Código**

La fórmula es `Ha_sub = Hα − k·R − c`. En IC 63 v3, k = 0,293 y c = 0,00155; con la R de la HDR y fotometría de apertura, k = 0,332. Cambiar k con cada combinación de cámara y filtro. En PixelMath la R se usa por el id de su vista:

```javascript
var PM = new PixelMath;
PM.useSingleExpression = true;
PM.symbols = "k, c";
PM.expression = "k = 0.293;\nc = 0.00155;\n$T - k*RGB_starless[0] - c";
PM.createNewImage = true;
PM.newImageId = "Ha_CS";
// confirmar color space y formato del resultado con describe_process PixelMath
if (!PM.executeOn(View.viewById("Ha_starless"))) throw new Error("Resta de continuo falló");
"Ha_CS creada";
```

Alternativa: el script PCS con el watcher parado (Max stars 1000, Max peak 0,80, Generate starless).

```javascript
// Comprobación del resultado de la resta, sin tocar la imagen:
var v = View.viewById("Ha_CS");
if (v.isNull) throw new Error("No existe Ha_CS");
var img = v.image, out = [];
for (var c = 0; c < img.numberOfChannels; ++c) {
   img.selectedChannel = c;
   out.push("canal " + c + ": mediana " + img.median() + "  min " + img.minimum());
}
img.resetSelections();
if (img.minimum() < -0.001) throw new Error("Fondo negativo: k o c mal medidos");
out.join("\n");
```

**Control.** Residuos simétricos alrededor de las estrellas; sin discos oscuros en zonas de continuo fuerte (enmascarar o cubrir con la estrella); sin fondo negativo. Comparar el Hα original y el restado en una zona dominada por emisión: debe conservar casi todo el brillo (en IC 63 el continuo sólo quitaba un 2–5 %).
