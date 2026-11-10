# Paso 10: Combinación RGB / NB

[← Índice](../SKILL.md) · Anterior: [Paso 9: Corrección de Gradiente](09-correccion-gradiente.md) · Siguiente: [Paso 11: BlurX correct only](11-bxt-correct-only.md)

**Por qué.** Combinar es decidir **qué canal aporta qué**: el color natural y las estrellas vienen de la banda ancha; el detalle y la emisión, de la banda estrecha. Hacerlo mal (Hα sin restar continuo, o mezclado antes de calibrar) produce el síntoma clásico: fondo rojo y regiones HII "pegadas" por diferencia de textura.

**Cuándo aplica.** Sólo cuando hay **masters separados que juntar**:
- Mono: L, R, G, B por separado (LRGB), o Hα, OIII, SII, Hβ.
- Banda estrecha + RGB de banda ancha, aunque sea OSC: p. ej. RGB sin filtro + Hα/OIII extraídos del dual band (Paso 7). Con dual band OSC el R ya lleva casi todo el Hα y la inyección aporta poco (nebulosa dual band: el R cambió un 0,6 %).
- Dos masters del mismo canal (Hα de la mono + Hα del dual band).

**No aplica** con una sola OSC sin filtro (p. ej. galaxia grande), ni con sólo dual band: la paleta HOO/SHO se monta en el Paso 2 no lineal. Si no aplica, decirlo y pasar al Paso 11 sin pedir ninguna llamada.

**Regla previa.** "Antes de procesar: alinear todos los stacks entre sí y recortar bordes negros a la misma dimensión" (flujo OSC5 de astro-photographie). Si los canales vienen de cámaras o noches distintas, **normalizar antes de combinar**: "Cada noche y cámara cambia fondo, transparencia y FWHM: LocalNormalization/LinearFit antes de combinar, ponderar por calidad, flats por configuración, no mezclar filtros ni material incompatible en una integración."

**Qué aporta cada cámara**

| Fuente | Aporta | Uso preferente |
|---|---|---|
| Mono | Todo el sensor en cada filtro: más SNR y resolución por canal | Detalle (L) y banda estrecha |
| OSC sin filtro | Color natural de estrellas y continuo (polvo, reflexión, galaxias), SPCC sencillo | Color y estrellas (tomas cortas + HDR) |
| OSC dual band | Hα/OIII con menos SNR y resolución (¼ o ½ de los píxeles por raya) | Sumar tiempo a la banda estrecha de la mono, o cuando falta ese filtro |

Nunca mezclar subs de cámaras distintas en una integración: cada cámara y filtro da su propio master. La astrometría de cada master (RGB y banda estrecha) se resuelve con `blindSolve` (Paso 8).

**Combinar dos masters del mismo canal** (p. ej. Hα mono + Hα de dual band)

- Registrar, **LinearFit del peor al mejor** (mismo nivel de fondo y escala de señal) y combinar en lineal pesando por ruido: `w ∝ 1/σ²` (ImageIntegration con los dos masters, sin rechazo, pesos por estimación de ruido; o PixelMath con los pesos medidos).
- "Si un master tiene peor FWHM, añadirlo sólo si su SNR compensa: comparar el resultado con el mejor master solo al 100 %. Si empeora la nitidez, usarlo sólo para la señal difusa de gran escala (máscara o separación por escalas)."

**Hα de la mono con RGB (lineal)**

- Primero decidir **si el Hα aporta de verdad**: "no integrarlo es un resultado válido" (aescaffre). ¿Añade estructura real?, ¿al color, a la luminancia o a ambos?, ¿global o por regiones?, ¿su ruido y textura casan con los de la banda ancha?
- Cadena del Hα: "Hα → Gradient → BXT → SXT → NXT". Después **LinearFit con R como referencia** y **sustracción de continuo con R** (de la RGB ya calibrada con SPCC y sin estrellas) → Hα CS (Paso 16).
- Rojo enriquecido: `R' = (1−α)·R + α·Hα`, **α ≈ 0,2–0,6** (galaxias bajo, nebulosas de emisión más alto; objetos mixtos con máscara). En los flujos de Bernhard es "Combine Ha with RGB" (lineal, RGB4A) o CombineRGBAndNarrowband (no lineal, RGB4B); aquí se hace con PixelMath.
- Valores de aescaffre (inyección condicional en R sobre starless, Hα estirado a mediana ~0,15): "galaxias fuerza 0,25 con límite de brillo 0,25 + luminancia 0,15; nebulosas de emisión 0,30–0,60".
- Luminancia enriquecida: `L_Hα = L + k·Hα`, empezar con k = 0,1–0,3 y subir poco a poco; Bernhard mezcla L y Hα estirados ("Mix LHa") y luego Combine LRGB con la RHaGB.
- **La inyección de Hα siempre a través de máscara** de luminancia/nebulosa (clipLow 0,04–0,08): "sin máscara el fondo se vuelve rojo".

**Errores típicos** (lista literal): "inyección excesiva (imagen roja artificial, estrellas rojas), desalineación o muestreo distinto entre capas, combinar antes de calibrar color, olvidar máscaras en estrellas y núcleos, bordes de máscara visibles. Comparar siempre con la RGB sola."

**HOO / SHO de la mono con estrellas RGB** (si hay banda estrecha): "cada canal Gradient → BXT → SXT → NXT"; SPCC narrowband combinando S,H,O en RGB y volviendo a extraer los canales. El continuo se resta con la RGB starless calibrada: **R sobre Hα, R sobre SII, G sobre OIII**; "OIII nunca con B si se quiere evitar Hβ". Estrellas siempre de la RGB (preferentemente la corta/HDR); "nunca de L ni de Hα/banda estrecha: tienen otra PSF y otro tamaño y dan estrellas hinchadas o de color de paleta".

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/lineal.md#lineal-10); en Siril, [Anexo I](../anexos/I-siril.md).

Comprobado con una nebulosa dual band: con RGB + Hα + OIII inyecta el Hα y deja el OIII; con R, G y B mono los junta en `RGB_comb`.

**Las piezas, sobre vistas** (sobre copias):

- `combinarMismoCanal(a, b, { nuevaVista })`: dos masters del mismo canal, alineados.
  - LinearFit del segundo al primero y suma pesada por 1/σ² (ruido MRS).
  - Avisa si el ruido apenas baja (< 2 %) o si las estrellas empeoran más de un 10 %.
  - nebulosa dual band Hα, 24 frente a 122 subs: pesos 0,05 / 0,95 y ruido −2,4 %, lo que predice 1/σ² con esa diferencia de ruido.
- `inyectarHa(rgb, ha, { tipo: "nebulosa" | "galaxia", alfa, clipLow })`: RGB y Hα lineales, sin estrellas y alineados.
  - LinearFit del Hα al R y máscara de nebulosa referida al cielo (celdas más oscuras), no a la mediana: en nebulosas que llenan el campo, la mediana ya es nebulosa.
  - Por defecto, **modo "suma"**: `R' = R + α·M·max(0, Hα − R)`, con α 0,6 en nebulosas y 0,3 en galaxias. Añade sólo la emisión que el R no tiene.
  - La fórmula clásica `R' = (1 − α·M)·R + α·M·Hα` queda como `modo: "mezcla"`. Con el Hα ajustado por LinearFit global, en una nebulosa dual band **apagó el rojo de la nebulosa**, que quedó grisácea: el Hα ajustado es más bajo que el R en buena parte de la emisión.
  - Mide la dominante del cielo antes y después (aviso si enrojece más de un 3 %), el % del campo bajo la máscara y cuánto sube el R donde más cambia (percentil 95).
  - nebulosa dual band (Hα del dual band con la RGB sin filtro): máscara sobre el 60 % del campo, cielo +0,8 %; en el 5 % de la nebulosa donde más cambia, el R sube un 1,6 % en lineal, visible tras estirar.

```json
{"llamadas": [
  {"funcion": "inyectarHa", "parametros": {"rgb": "RGB_starless", "ha": "Ha_CS", "opciones": {"tipo": "nebulosa", "nuevaVista": "RGB_Ha"}}}
]}
```

**LinearFit y mezcla en lineal**

La mezcla, en fórmula: `R' = (1−α)·R + α·Hα`, con `α ≈ 0,2–0,6` y siempre bajo máscara. Se hace con PixelMath, con el Hα y la máscara por su id:

- LinearFit del Hα a la R (vista de referencia por su id; `rejectHigh` 0,92 por defecto).

En PixelMath cualquier imagen abierta se usa por su id dentro de la expresión (`Ha`, `R_starless[0]` para un canal); no hace falta declararla. Mezcla en el canal R bajo máscara:

- Mezcla en R con PixelMath por canal: `(1−a)·R + a·Ha` con a = 0,2–0,6 (G y B sin tocar).
- Siempre bajo una máscara de nebulosa (clipLow 0,04–0,08), que se quita al terminar.

Comprobar antes `ImageWindow.windowById("mask_neb").isNull`: con un id inexistente `w.mask` no falla y el proceso se aplica **sin máscara**.

**Control.** Comparar la combinación con la RGB sola al 100 % en una zona de Hα y en el fondo: sin dominante roja en el cielo, sin textura distinta entre la nebulosa y la banda ancha, sin bordes de máscara. El fondo de la combinación debe seguir neutro (medir medianas R/G/B en un ROI de cielo).
