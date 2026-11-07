# Detalle del Paso 1 no lineal: Estirado

[← Ficha del paso](../no-lineal/01-estirado.md) · [Índice](../SKILL.md)

Material de apoyo de la ficha: el porqué, las fuentes y los ajustes que sólo hacen falta cuando la receta no basta. La ficha manda.

**Por qué.** El estirado reparte el rango dinámico lineal (señal proporcional al flujo) en el rango de pantalla. "Starless tolera estirado más profundo; estrellas, más suave con protección de altas luces". "Nunca estirar con fórmulas de PixelMath inventadas... Estirar con MAS, GHS o HistogramTransformation, una vez, y luego curvas suaves." Fondos objetivo de aescaffre; con estirado estadístico las medianas típicas son 0,22 (nebulosa) y 0,12 (galaxia).

**Otros métodos.** HMS / VeraLux: color vectorial guiado. MaskedStretch: clásico para no hinchar estrellas (los centros saturados salen mal si no se reparan antes).

**HT + STF.** `HistogramTransformation` equivale en GHS a B = 1. El STF es una visualización: con watchers anteriores a v0.4.9, `stretch_image` con "stf" sólo cambiaba la visualización y la imagen seguía lineal. No confundir ver la imagen con haberla estirado.

**GHS en detalle**

- D del interfaz: D 1 → 1,72; D 2 → 6,39; D 3 → 19,1 (real = e^D − 1). D = 0 no hace nada.
- B controla la forma: −1 logarítmico (suave, ajustes post-estirado), 0 exponencial, 1 = HistogramTransformation, 2–5 hiperbólico (realce focalizado), 5–15 superhiperbólico (primer estirado desde lineal, concentra el contraste en el pico estrecho).
- SP = punto de máximo contraste; LP y HP protegen sombras y luces con una recta tangente.
- GHS es reversible (casilla Inverse).

**GHS a mano en la interfaz.** Con STF desactivado y Real-Time Preview, ampliar el histograma, pulsar en el centro del pico o justo a su izquierda y "Send to SP"; local intensity (b) ≈ 8–8,5 y subir el stretch factor hasta que el pico principal no pase de ~¼ de la altura del gráfico; aplicar y resetear. Segunda pasada: SP sobre la zona a realzar, b ≈ 1–1,5, stretch factor 0,5–1, equilibrando LP/HP.

**Ajustes finos de GHS** (fuente externa: PDF del usuario "Skill Técnica GHS v3.0", **no verificada con medidas propias**; ajustes de la receta de 3 fases, no un método alternativo):

- **SP por fórmula:** `SP = pico + k·FWHM_pico`, k 0,5–1,5. Útil si el pico es ancho o hay "colinas" en el histograma logarítmico; si no, SP = mediana.
- **Histograma bifurcado:** focalización destructiva por exceso de b con D alto; **no** corregirlo moviendo SP.
- **Convergencia:** mediana en el objetivo y caída monótona del log-histograma a la derecha del pico. El PDF fija 0,10–0,15 para todo; aquí eso es el objetivo de galaxia.
- **Modo Saturation** (b −1 a −3) para subir saturación sin hinchar estrellas. Con **Colour**, vigilar el recorte de canales brillantes (no invertible; Clip type `RGBBlend`).
- **D:** los rangos del PDF (1,5–8) son de interfaz y logarítmicos: un 8 es muy agresivo. Mantener D 2–3 en la primera fase.

| Objeto | Estrategia de b (según el PDF) |
|---|---|
| Galaxia | 1.ª pasada b 12–15 con SP en el brazo débil; siguientes 8 → 5 → 3 acercando SP al núcleo, con HP protegiendo el bulbo |
| Nebulosa de emisión / SHO | D bajo (1,2–2) y HP agresivo (0,85–0,95) para no quemar frentes de ionización |
| Polvo / IFN | SP pegado al pico de fondo y LP alto |
| Capa de estrellas | Evitar b > 8; preferir b −1 a −2 o arcsinh, con HP activo |

Documentación citada por el PDF: `ghsastro.co.uk/doc/tools/GeneralizedHyperbolicStretch/` y `ghsastro.co.uk/updates/`.

**MAS: riesgos y clases**

- Aggressiveness alta: más contraste en medios pero más ruido y recorte en bajas luces.
- DRC demasiado alto aplana. DRC ≠ HDRMT (HDRMT después, si aún sobra dinámica).
- Scale separation: subirla hasta que la vista "large scale" quede casi vacía.
- Riesgos: ringing/halos en estrellas brillantes, microcontraste granuloso, ruido amplificado, núcleo aplanado. "Validar en la imagen entera, no sólo en un recorte (depende del tamaño)."
- Clases: nebulosa débil = estirado suave, recuperación moderada; nebulosa compleja = equilibrio recuperación/DRC; galaxia = DRC para el bulbo, recuperación medida; núcleo muy brillante (nebulosa brillante) = HDRComposition con tomas cortas → MAS con saturación off → HDRMT → curvas de saturación.
- "MAS no sustituye HDRMT ni repara datos recortados. Como usa estadísticas, da estirados parecidos en imágenes distintas."

**Capa de estrellas**

- `starStretch` hace `y = 3^A·x / ((3^A − 1)·x + 1)` (A de 0 a 8; 5 por defecto en el script), saturación por tono con ColorSaturation (0,4·s / 0,7·s / 0,4·s) y, si se pide, SCNR del verde. "Color Boost aumenta separación cromática (controlar R:G:B en no saturados, evitar anillos de color). Suprimir verde off salvo dominante real."
- Objetivo de NOVA: "p90 de la capa en ~0,25 (factor de Star Stretch 1–3, más suave que el 5 por defecto), probando la fuerza con saturación y SCNR fijos."
- Alternativa arcsinh que conserva color: `f = asinh(k·L)/asinh(k)/L` con `L = max(RGB)` (k ≈ 5000 para muchas estrellas), saturación ×1,6 alrededor de la media, núcleos saturados neutros; o ArcsinhStretch "hasta que se vean claramente sin hincharse (GHS opcional después)".

**Código.** Un master lineal con pedestal puede pasar de 0,01 de mediana (nebulosa oscura: 0,0102); uno estirado suele estar por encima de 0,1, de ahí el umbral 0,05 de la ficha. En el watcher clásico las constantes de GHS van con `.prototype`.

**Control.** "El estirado revela todo: la limpieza se hace en lineal, y varias curvas pequeñas son mejores que una grande." Si el fondo se aplasta, bajar el punto negro o subir el fondo objetivo. Con dientes de sierra, menos pasadas destructivas y revisar el paso anterior.
