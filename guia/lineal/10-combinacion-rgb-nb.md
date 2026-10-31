# Paso 10: Combinación RGB / NB

[← Índice](../SKILL.md) · Anterior: [Paso 9: Corrección de Gradiente](09-correccion-gradiente.md) · Siguiente: [Paso 11: BlurX correct only](11-bxt-correct-only.md)

**Por qué.** Combinar es decidir **qué canal aporta qué**: el color natural y las estrellas vienen de la banda ancha; el detalle y la emisión, de la banda estrecha. Hacerlo mal (Hα sin restar continuo, o mezclado antes de calibrar) produce el síntoma clásico: fondo rojo y regiones HII "pegadas" por diferencia de textura.

**Regla previa.** "Antes de procesar: alinear todos los stacks entre sí y recortar bordes negros a la misma dimensión" (flujo OSC5 de astro-photographie). Si los canales vienen de cámaras o noches distintas, **normalizar antes de combinar**: "Cada noche y cámara cambia fondo, transparencia y FWHM: LocalNormalization/LinearFit antes de combinar, ponderar por calidad, flats por configuración, no mezclar filtros ni material incompatible en una integración."

**Qué aporta cada cámara**

| Fuente | Aporta | Uso preferente |
|---|---|---|
| Mono | Todo el sensor en cada filtro: más SNR y resolución por canal | Detalle (L) y banda estrecha |
| OSC sin filtro | Color natural de estrellas y continuo (polvo, reflexión, galaxias), SPCC sencillo | Color y estrellas (tomas cortas + HDR) |
| OSC dual band | Hα/OIII con menos SNR y resolución (¼ o ½ de los píxeles por raya) | Sumar tiempo a la banda estrecha de la mono, o cuando falta ese filtro |

Nunca mezclar subs de cámaras distintas en una integración: cada cámara y filtro da su propio master. La solución astrométrica de la RGB se copia a las de banda estrecha ("Copy coordinates") o se resuelve cada una con `blindSolve`.

**Combinar dos masters del mismo canal** (p. ej. Hα mono + Hα de dual band)

- Registrar, **LinearFit del peor al mejor** (mismo nivel de fondo y escala de señal) y combinar en lineal pesando por ruido: `w ∝ 1/σ²` (ImageIntegration con los dos masters, sin rechazo, pesos por estimación de ruido; o PixelMath con los pesos medidos).
- "Si un master tiene peor FWHM, añadirlo sólo si su SNR compensa: comparar el resultado con el mejor master solo al 100 %. Si empeora la nitidez, usarlo sólo para la señal difusa de gran escala (máscara o separación por escalas)."

**Hα de la mono con RGB (lineal)**

- Primero decidir **si el Hα aporta de verdad**: "no integrarlo es un resultado válido" (aescaffre). ¿Añade estructura real?, ¿al color, a la luminancia o a ambos?, ¿global o por regiones?, ¿su ruido y textura casan con los de la banda ancha?
- Cadena del Hα: "Hα → Gradient → BXT → SXT → NXT". Después **LinearFit con R como referencia** y **sustracción de continuo con R** (de la RGB ya calibrada con SPCC y sin estrellas) → Hα CS (Paso 16).
- Rojo enriquecido: `R' = (1−α)·R + α·Hα`, **α ≈ 0,2–0,6** (galaxias bajo, nebulosas de emisión más alto; objetos mixtos con máscara). O "Combine Ha with RGB" (lineal, RGB4A) / CombineRGBAndNarrowband (no lineal, RGB4B).
- Valores de aescaffre (inyección condicional en R sobre starless, Hα estirado a mediana ~0,15): "galaxias fuerza 0,25 con límite de brillo 0,25 + luminancia 0,15; nebulosas de emisión 0,30–0,60".
- Luminancia enriquecida: `L_Hα = L + k·Hα`, empezar con k = 0,1–0,3 y subir poco a poco; Bernhard mezcla L y Hα estirados ("Mix LHa") y luego Combine LRGB con la RHaGB.
- **La inyección de Hα siempre a través de máscara** de luminancia/nebulosa (clipLow 0,04–0,08): "sin máscara el fondo se vuelve rojo".

**Errores típicos** (lista literal): "inyección excesiva (imagen roja artificial, estrellas rojas), desalineación o muestreo distinto entre capas, combinar antes de calibrar color, olvidar máscaras en estrellas y núcleos, bordes de máscara visibles. Comparar siempre con la RGB sola."

**HOO / SHO de la mono con estrellas RGB** (si hay banda estrecha): "cada canal Gradient → BXT → SXT → NXT"; SPCC narrowband combinando S,H,O en RGB y volviendo a extraer los canales. El continuo se resta con la RGB starless calibrada: **R sobre Hα, R sobre SII, G sobre OIII**; "OIII nunca con B si se quiere evitar Hβ". Estrellas siempre de la RGB (preferentemente la corta/HDR); "nunca de L ni de Hα/banda estrecha: tienen otra PSF y otro tamaño y dan estrellas hinchadas o de color de paleta".

**Código: LinearFit y mezcla en lineal**

La mezcla, en fórmula: `R' = (1−α)·R + α·Hα`, con `α ≈ 0,2–0,6` y siempre bajo máscara. Los scripts "Combine Ha with RGB" (lineal) y "CombineRGBAndNarrowband" (no lineal) son **scripts**: los lanza el usuario con el watcher parado; desde el watcher no se pueden ejecutar.

```javascript
// LinearFit del Hα a la R (vista de referencia por su id).
// Comprobado en PixInsight 1.9.6 (rejectHigh = 0,92 por defecto).
var vHa = View.viewById("Ha");
if (vHa.isNull) throw new Error("No existe Ha");
var LF = new LinearFit;
LF.referenceViewId = "R_starless";
if (!LF.executeOn(vHa)) throw new Error("LinearFit falló");
"Ha ajustado a R";
```

En PixelMath cualquier imagen abierta se usa por su id dentro de la expresión (`Ha`, `R_starless[0]` para un canal); no hace falta declararla. Mezcla en el canal R bajo máscara:

```javascript
var PM = new PixelMath;
PM.useSingleExpression = false;          // expression = R, expression1 = G, expression2 = B
PM.symbols = "a";
PM.expression  = "a = 0.4;\n(1-a)*$T + a*Ha";   // alfa 0,2-0,6
PM.expression1 = "$T";
PM.expression2 = "$T";
var w = ImageWindow.windowById("RGB_starless");
if (w.isNull) throw new Error("No existe RGB_starless");
w.mask = ImageWindow.windowById("mask_neb");    // máscara de nebulosa (clipLow 0,04-0,08)
if (!PM.executeOn(w.mainView)) throw new Error("Mezcla Hα falló");
w.removeMask();
"R enriquecido con Hα";
```

Comprobar antes `ImageWindow.windowById("mask_neb").isNull`: con un id inexistente `w.mask` no falla y el proceso se aplica **sin máscara**.

**Control.** Comparar la combinación con la RGB sola al 100 % en una zona de Hα y en el fondo: sin dominante roja en el cielo, sin textura distinta entre la nebulosa y la banda ancha, sin bordes de máscara. El fondo de la combinación debe seguir neutro (medir medianas R/G/B en un ROI de cielo).
