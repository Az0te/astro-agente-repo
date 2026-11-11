# Paso 10: Combinación RGB / NB

[← Índice](../SKILL.md) · Anterior: [Paso 9: Corrección de Gradiente](09-correccion-gradiente.md) · Siguiente: [Paso 11: BlurX correct only](11-bxt-correct-only.md)

**Cuándo, aunque sea el Paso 10.** La combinación va **después** de calibrar el color de la RGB (Paso 12, sobre la RGB sola) y con las capas ya con su gradiente: Hα o OIII sumados antes de la calibración sesgan los factores de color y dejan el cielo teñido (azul o rojo) al estirar. Orden con dual band: alinear (5) → desmezclar (7) → gradiente de cada capa (9) → deconvolución de corrección de la RGB (11) → color de la RGB (12) → **combinar (10)** → deconvolución completa (13) → separar estrellas (15).

**Por qué.** Combinar es decidir **qué canal aporta qué**: el color natural y las estrellas vienen de la banda ancha; el detalle y la emisión, de la banda estrecha. Hacerlo mal (Hα sin restar continuo, o mezclado antes de calibrar) produce el síntoma clásico: fondo rojo y regiones HII "pegadas" por diferencia de textura.

**Cuándo aplica.** Sólo cuando hay **masters separados que juntar**:
- Mono: L, R, G, B por separado (LRGB), o Hα, OIII, SII, Hβ.
- Banda estrecha + RGB de banda ancha, aunque sea OSC: p. ej. RGB sin filtro + Hα/OIII extraídos del dual band (Paso 7). Con dual band OSC, el exceso de Hα sobre el R aporta poco (nebulosa dual band: el R cambió un 0,6 %). Por eso en nebulosas se suma la señal del Hα (abajo). Antes de combinar, comprobar que la «RGB» es de verdad el master de banda ancha y no el dual band: si las estrellas guardan con el Hα la misma proporción que la nebulosa, es el propio dual band.
- Dos masters del mismo canal (Hα de la mono + Hα del dual band).

**No aplica** con una sola OSC sin filtro (p. ej. galaxia grande), ni con sólo dual band: la paleta HOO/SHO se monta en el Paso 2 no lineal. Si no aplica, decirlo y pasar al Paso 11 sin pedir ninguna llamada.

**Regla previa.** "Antes de procesar: alinear todos los stacks entre sí y recortar bordes negros a la misma dimensión" (flujo OSC5 de astro-photographie). Si los canales vienen de cámaras o noches distintas, **normalizar antes de combinar**: cada noche y cámara cambia fondo, transparencia y FWHM: normalización local o ajuste lineal antes de combinar, ponderar por calidad, flats por configuración, no mezclar filtros ni material incompatible en una integración.

**Qué aporta cada cámara**

| Fuente | Aporta | Uso preferente |
|---|---|---|
| Mono | Todo el sensor en cada filtro: más SNR y resolución por canal | Detalle (L) y banda estrecha |
| OSC sin filtro | Color natural de estrellas y continuo (polvo, reflexión, galaxias), calibración de color sencilla | Color y estrellas (tomas cortas + HDR) |
| OSC dual band | Hα/OIII con menos SNR y resolución (¼ o ½ de los píxeles por raya) | Sumar tiempo a la banda estrecha de la mono, o cuando falta ese filtro |

Nunca mezclar subs de cámaras distintas en una integración: cada cámara y filtro da su propio master. La astrometría de cada master (RGB y banda estrecha) se resuelve en el Paso 8.

**Combinar dos masters del mismo canal** (p. ej. Hα mono + Hα de dual band)

- Registrar, **ajuste lineal del peor al mejor** (mismo nivel de fondo y escala de señal) y combinar en lineal pesando por ruido: `w ∝ 1/σ²` (integración de los dos masters sin rechazo con pesos por ruido, o una suma pesada con los pesos medidos).
- Avisar si el ruido apenas baja (< 2 %) o si las estrellas empeoran más de un 10 %. En una nebulosa dual band, Hα de 24 frente a 122 subs: pesos 0,05 / 0,95 y ruido −2,4 %, lo que predice 1/σ² con esa diferencia de ruido.
- "Si un master tiene peor FWHM, añadirlo sólo si su SNR compensa: comparar el resultado con el mejor master solo al 100 %. Si empeora la nitidez, usarlo sólo para la señal difusa de gran escala (máscara o separación por escalas)."

**Hα de la mono con RGB (lineal)**

- Primero decidir **si el Hα aporta de verdad**: "no integrarlo es un resultado válido" (aescaffre). ¿Añade estructura real?, ¿al color, a la luminancia o a ambos?, ¿global o por regiones?, ¿su ruido y textura casan con los de la banda ancha?
- Cadena del Hα: "Hα → Gradient → BXT → SXT → NXT". Después **ajuste lineal con R como referencia** y **sustracción de continuo con R** (de la RGB ya calibrada y sin estrellas) → Hα CS (Paso 16).
- Rojo enriquecido: `R' = (1−α)·R + α·Hα`, **α ≈ 0,2–0,6** (galaxias bajo, nebulosas de emisión más alto; objetos mixtos con máscara). En los flujos de Bernhard es "Combine Ha with RGB" (lineal, RGB4A) o CombineRGBAndNarrowband (no lineal, RGB4B).
- Valores de aescaffre (inyección condicional en R sobre starless, Hα estirado a mediana ~0,15): "galaxias fuerza 0,25 con límite de brillo 0,25 + luminancia 0,15; nebulosas de emisión 0,30–0,60".
- Luminancia enriquecida: `L_Hα = L + k·Hα`, empezar con k = 0,1–0,3 y subir poco a poco; Bernhard mezcla L y Hα estirados ("Mix LHa") y luego Combine LRGB con la RHaGB.
- **La inyección de Hα siempre a través de máscara** de luminancia/nebulosa (clipLow 0,04–0,08): "sin máscara el fondo se vuelve rojo". La máscara se refiere al cielo (celdas más oscuras), no a la mediana: en nebulosas que llenan el campo, la mediana ya es nebulosa.
- En **galaxias, modo suma**: `R' = R + α·M·max(0, Hα − R)` con α 0,3, que añade sólo la emisión que el R no tiene. En **nebulosas que llenan el campo, modo señal**: `R' = R + α·M·max(0, Hα − cielo)` con α 0,6. Con el Hα ajustado a la nebulosa, el exceso sobre el R es ≈ 0 y la nebulosa no sube (RGB + dual band: 3,9 ruidos sobre el cielo con la suma). El exceso puro, con la escala del continuo (las estrellas), es unas 10–15 veces la nebulosa del RGB y la tapa. Por eso conviene un tope: ×1 como mucho duplica la nebulosa.
- **OIII con RGB** (nebulosas): igual que el Hα, en **verde y azul a partes iguales** (como HOO; el OIII de 501 nm es turquesa) y con su propia máscara. Con la mitad en el verde, sobre un Hα fuerte sale lavanda. La fórmula clásica `R' = (1 − α·M)·R + α·M·Hα`, con el Hα ajustado globalmente, en una nebulosa dual band **apagó el rojo de la nebulosa**, que quedó grisácea: el Hα ajustado es más bajo que el R en buena parte de la emisión.
- Medir la dominante del cielo antes y después (aviso si enrojece más de un 3 %), el % del campo bajo la máscara y cuánto sube el R donde más cambia (percentil 95). En una nebulosa dual band (Hα del dual band con la RGB sin filtro): máscara sobre el 60 % del campo, cielo +0,8 %; en el 5 % de la nebulosa donde más cambia, el R sube un 1,6 % en lineal, visible tras estirar.

**Errores típicos** (lista literal): "inyección excesiva (imagen roja artificial, estrellas rojas), desalineación o muestreo distinto entre capas, combinar antes de calibrar color, olvidar máscaras en estrellas y núcleos, bordes de máscara visibles. Comparar siempre con la RGB sola."

**HOO / SHO de la mono con estrellas RGB** (si hay banda estrecha): "cada canal Gradient → BXT → SXT → NXT"; SPCC narrowband combinando S,H,O en RGB y volviendo a extraer los canales. El continuo se resta con la RGB starless calibrada: **R sobre Hα, R sobre SII, G sobre OIII**; "OIII nunca con B si se quiere evitar Hβ". Estrellas siempre de la RGB (preferentemente la corta/HDR); "nunca de L ni de Hα/banda estrecha: tienen otra PSF y otro tamaño y dan estrellas hinchadas o de color de paleta".

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/lineal.md#lineal-10); en Siril, [Anexo I](../anexos/I-siril.md).

**Control.** Comparar la combinación con la RGB sola al 100 % en una zona de Hα y en el fondo: sin dominante roja en el cielo, sin textura distinta entre la nebulosa y la banda ancha, sin bordes de máscara. El fondo de la combinación debe seguir neutro (medir medianas R/G/B en un ROI de cielo). Comprobar que la máscara existe y está puesta: un proceso aplicado con una máscara que no existe actúa sin máscara.
