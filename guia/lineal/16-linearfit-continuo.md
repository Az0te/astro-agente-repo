# Paso 16: LinearFit / sustracción de continuo

[← Índice](../SKILL.md) · Anterior: [Paso 15: StarX y NXT de la starless](15-starx.md) · Siguiente: [Paso 17: Checkpoint](17-checkpoint.md)

**Por qué.** Un filtro de banda estrecha no mide sólo la raya: deja pasar continuo (estrellas, polvo, reflejo). Restar ese continuo con la banda ancha calibrada deja la **emisión** y evita que el Hα pinte de rojo el fondo y las estrellas. "Medir k de nuevo con cada combinación de cámaras y filtros: el k = 0,293 de una nebulosa de emisión y reflexión (dual band OSC vs RGB OSC) no vale para un Hα de la mono".

**Teoría (Photometric Continuum Subtraction).** `k = mediana robusta de (N−B_N)/(C−B_C)` en estrellas no saturadas; "buena k = residuos simétricos; k baja deja estrellas positivas; k alta, agujeros negros". Para OIII usar **sólo G** como continuo (B lleva Hβ).

**Versión completa (SHO)**

"S,H,O combinados → Gradient → BXT Correct Only → Plate Solve → SPCC narrowband → extraer S,H,O → SXT + NXT por canal; RGB → Gradient → BXT Correct Only → Plate Solve (coordenadas copiadas) → SPCC → SXT → extraer R y G (con estrellas y sin estrellas). PCS con **Max stars 1000, Max peak 0,80, Generate starless**: SII y Hα con R, OIII con G → S,H,O continuum subtracted (lineal)."

**Versión Hα simplificada**

- Cadena: Hα → Gradient → BXT → SXT → NXT → **LinearFit con R como referencia** → sustracción de continuo con R (de la RGB calibrada con SPCC y sin estrellas).
- Fórmula: `Ha_sub = Hα − k·R − c`.
- Caso medido: "En nebulosa de emisión y reflexión: Ha_sub = Hα − 0,293·R − 0,00155; deja un disco oscuro donde domina el continuo de la estrella brillante (cubrir con la estrella o enmascarar)."
- Con la R de la HDR y fotometría de apertura: "k = 0,332 con la R de la HDR ... **fotometría de apertura en ~3000 estrellas** (r ≤ 7 px, anillo de cielo 10–14 px, mediana de cocientes)". "En nebulosa de emisión y reflexión el continuo sólo quita un 2–5 % al fantasma: casi todo su rojo es emisión."

**Medición de k (procedimiento)**

1. Localizar estrellas no saturadas en la capa de estrellas **por centroide del flujo**, nunca por el píxel máximo.
2. Apertura r ≤ 7 px y anillo de cielo 10–14 px.
3. Cociente `(N − B_N)/(C − B_C)` por estrella; **mediana** de los cocientes.
4. Comprobar simetría de residuos: si quedan estrellas positivas, k baja; si quedan agujeros negros, k alta.

**A mano en PixInsight (valores de referencia)**

La fórmula es `Ha_sub = Hα − k·R − c`. En nebulosa de emisión y reflexión, k = 0,293 y c = 0,00155; con la R de la HDR y fotometría de apertura, k = 0,332. Cambiar k con cada combinación de cámara y filtro. En PixelMath la R se usa por el id de su vista:

- PixelMath en una imagen nueva `Ha_CS`: `$T − k·RGB_starless[0] − c` sobre la starless de Hα (k y c medidos antes; ej. k = 0,293, c = 0,00155).

- Comprobación sin tocar la imagen: mediana y mínimo por canal de `Ha_CS`; un mínimo por debajo de −0,001 indica fondo negativo (k o c mal medidos).

**En una llamada** (`herramientas/bandaestrecha.js`): `medirContinuo(nbConEstrellas, rgbConEstrellas, { canal: 0 })` mide k con el procedimiento de arriba (centroide, apertura 7 px, anillo 10–14 px, mediana de ~3000 estrellas); `restarContinuo(nbStarless, rgbStarless, { k })` resta y mide los negativos y el brillo de emisión conservado. nebulosa de emisión y reflexión (nov 2026): k = 0,316 (la medida a mano fue 0,332) y la emisión conserva el 95 %.

```json
{"llamadas": [
  {"funcion": "medirContinuo", "parametros": {"nb": "Ha_raw", "continuo": "RGB_spcc", "opciones": {"canal": 0}}}
]}
```

OIII: canal 1 (G). Con el `k` que devuelva, en otra respuesta:

```json
{"llamadas": [
  {"funcion": "restarContinuo", "parametros": {"nb": "Ha_starless", "continuo": "RGB_starless", "opciones": {"k": "<k medido>", "nuevaVista": "Ha_CS"}}}
]}
```

**Control.** Residuos simétricos alrededor de las estrellas; sin discos oscuros en zonas de continuo fuerte (enmascarar o cubrir con la estrella); sin fondo negativo. Comparar el Hα original y el restado en una zona dominada por emisión: debe conservar casi todo el brillo (en una nebulosa de emisión y reflexión el continuo sólo quitaba un 2–5 %).
