# Paso 1: Estirado (starless y estrellas por separado)

[← Índice](../SKILL.md) · Anterior: [Índice](../SKILL.md) · Siguiente: [Paso 2: LRGB / Paleta](02-lrgb-paleta.md)

**Por qué.** El estirado es la operación que reparte el rango dinámico lineal (donde la señal es proporcional al flujo) en el rango de pantalla. Es irreversible en la práctica y amplifica todo lo que no se limpió. Se hace **por separado** porque las estrellas y la nebulosa tienen exigencias opuestas: "Starless tolera estirado más profundo; estrellas, más suave con protección de altas luces". Y no se inventa: "Nunca estirar con fórmulas de PixelMath inventadas... Estirar con MAS, GHS o HistogramTransformation, una vez, y luego curvas suaves."

**Fondo objetivo de referencia** (aescaffre)

| Objeto | Fondo |
|---|---|
| Nebulosas de emisión | 0,15–0,25 (estirado estadístico: mediana 0,22) |
| Galaxias | 0,10 (estadístico: mediana 0,12) |
| Cúmulos de galaxias | 0,08–0,10 |
| Margen de altas luces | 0,05 |

**Qué método usar**

| Método | Cuándo |
|---|---|
| **GHS** | Control manual fino (SP, LP/HP), ideal galaxias HDR y starless |
| **Statistical** | Rápido y reproducible |
| **MAS** | Estructuras multiescala, nebulosas complejas, galaxias |
| HMS / VeraLux | Color vectorial guiado |
| **MaskedStretch** | Clásico para no hinchar estrellas (los centros saturados salen mal si no se reparan antes) |
| **Star Stretch** (SETI) | Sólo para la capa de estrellas, nunca starless |

"Comparar a resultado visual equivalente, no a parámetros iguales."

**HT + STF.** `HistogramTransformation` es el estirado clásico (en GHS equivale a B = 1); es válido y está en la lista de métodos permitidos, pero "a diferencia de repetir HT, el LP [de GHS] impide volver a comprimir las sombras ya trabajadas": por eso el flujo de 3 fases usa GHS. El STF es una **visualización** (autoestirado): "`stretch_image` con 'stf' aplica un autoestirado real desde la v0.4.9 del watcher y se niega si la imagen ya no es lineal. Con watchers anteriores sólo cambiaba la visualización: la imagen seguía lineal". No confundir ver la imagen con haberla estirado.

**GHS en detalle**

- El D del interfaz es logarítmico: **D real = e^D − 1** (D 1 → 1,72; D 2 → 6,39; D 3 → 19,1).
- B controla la forma: **−1** logarítmico (suave, ajustes post-estirado), **0** exponencial, **1 = HistogramTransformation**, **2–5** hiperbólico (realce focalizado), **5–15** superhiperbólico (primer estirado desde lineal, concentra el contraste en el pico estrecho).
- SP = punto de máximo contraste (la mediana actual); LP y HP protegen sombras y luces con una recta tangente.
- Restricciones: **LP < SP < HP**; D = 0 no hace nada.
- "GHS en modo color ('Col') conserva el tono (similar a arcsinh); el modo RGB/K por canal puede desplazar el color. GHS es reversible (casilla Inverse)."

**GHS en 3 fases desde lineal (sin HT)**

| Fase | D | B | SP | LP | HP | Efecto |
|---|---|---|---|---|---|---|
| 1. Levantar el pie | 2–3 | 10–15 | mediana (~0,001–0,003) | 0 | 0,95 | fondo ~0,15–0,23 |
| 2. Tonos medios | 1,5–2 | 3–6 | nueva mediana | 0,02–0,05 (bloquea lo de la fase 1) | 0,90 | contraste en medios |
| 3. Altas luces | 0,5–1 | −1 a 0 | nueva mediana | 0,05–0,08 | 0,85 | comprime luces |
| 4 (opcional, núcleos) | 0,3–0,5 | −1,5 | 0,5–0,8 | 0,15 | 1 | núcleos |

"Remedir la mediana en cada pasada. A diferencia de repetir HT, el LP impide volver a comprimir las sombras ya trabajadas."

**GHS a mano en la interfaz** (versión simple): con STF desactivado y Real-Time Preview, ampliar el histograma, pulsar en el centro del pico o justo a su izquierda y "Send to SP"; local intensity (b) ≈ 8–8,5 y subir el stretch factor hasta que el pico principal no pase de ~¼ de la altura del gráfico; aplicar y resetear. Segunda pasada de contraste: SP sobre la zona que se quiere realzar, b ≈ 1–1,5, stretch factor 0,5–1 con cuidado, y equilibrar LP/HP.

**Ajustes finos de GHS** (fuente externa: PDF del usuario "Skill Técnica GHS v3.0", **no verificada con medidas propias**). Son ajustes de la receta de 3 fases, no un método alternativo:

- **Colocar SP por fórmula:** `SP = pico + k·FWHM_pico`, con k 0,5–1,5 según el contraste que se busque. Útil si el pico es ancho o hay "colinas" en el histograma logarítmico; si no, SP = mediana (receta de arriba).
- **Histograma bifurcado** (dos cúpulas con vaguada central): focalización destructiva por exceso de b con D alto. Deshacer y bajar b ~40 % o D ~50 %; **no** corregirlo moviendo SP.
- **Convergencia:** mediana dentro del objetivo **y** caída monótona del log-histograma a la derecha del pico (sin colinas ni valles). Ojo: el PDF fija 0,10–0,15 para todo; en esta guía eso es el objetivo de **galaxia** (nebulosa 0,15–0,25; cúmulos 0,08–0,10, tabla de arriba).
- **Modo Saturation** (b −1 a −3) para subir saturación sin hinchar estrellas. Si se usa **Colour**, vigilar el recorte de canales brillantes: no es invertible y conviene Clip type `RGBBlend`.
- **Aviso sobre D:** los rangos del PDF (D 1,5–8 "típicos") son valores de interfaz, y el D del interfaz es logarítmico; con la conversión de esta guía (D real = e^D − 1) un 8 es un estirado muy agresivo. Mantener D 2–3 en la primera fase.

| Objeto | Estrategia de b (según el PDF) |
|---|---|
| Galaxia | 1.ª pasada b 12–15 con SP en el brazo débil; siguientes 8 → 5 → 3 acercando SP al núcleo, con HP protegiendo el bulbo |
| Nebulosa de emisión / SHO | Pasadas con D bajo (1,2–2) y HP agresivo (0,85–0,95) para no quemar frentes de ionización |
| Polvo / IFN | SP pegado al pico de fondo y LP alto, para sacar el perfil del polvo sin arrancarlo |
| Capa de estrellas | Evitar b > 8; preferir b −1 a −2 o arcsinh, con HP activo |

Documentación citada por el PDF: `ghsastro.co.uk/doc/tools/GeneralizedHyperbolicStretch/` y `ghsastro.co.uk/updates/`.

**MAS (MultiscaleAdaptiveStretch)** — protocolo

Background Reference (ROI en fondo limpio; imprescindible si el objeto llena el campo) → Target Background → Aggressiveness → DRC → Large-scale preview / Scale separation → Contrast Recovery Intensity → Color saturation (opcional) → validación global.

- Aggressiveness alta: más contraste en tonos medios pero más ruido y recorte en bajas luces. Para ver más señal débil: subir un poco el fondo objetivo y bajar la agresividad.
- DRC actúa durante el estirado (protege estrellas brillantes y núcleos); demasiada aplana. DRC ≠ HDRMT (HDRMT después, si aún sobra dinámica).
- Contrast Recovery: intensidad 0–1 (**0,25 sutil, 0,5 moderado, 1 completo**); scale separation define qué escalas se recuperan (subirla hasta que la vista "large scale" quede casi vacía).
- Riesgos: ringing/halos en estrellas brillantes, microcontraste granuloso, ruido amplificado, núcleo aplanado. "Validar en la imagen entera, no sólo en un recorte (depende del tamaño)."
- Clases: nebulosa débil = estirado suave, recuperación moderada; nebulosa compleja = equilibrio recuperación/DRC; galaxia = DRC para bulbo, recuperación medida; núcleo muy brillante (M42) = HDRComposition con tomas cortas → MAS con saturación off → HDRMT → Curves saturación.
- "MAS no sustituye HDRMT ni repara datos recortados. Como usa estadísticas, da estirados parecidos en imágenes distintas (útil para igualar capas antes de combinar, p. ej. L y RGB)."

**Capa de estrellas**

- SETI Astro **Star Stretch** (v2.6): `y = 3^A·x / ((3^A − 1)·x + 1)`, Amount 0–8 (**defecto 5**). "Color Boost aumenta separación cromática (controlar R:G:B en no saturados, evitar anillos de color). Suprimir verde off salvo dominante real."
- Objetivo de la capa (NOVA): "buscar que el p90 de la capa quede en ~0,25 (factor de Star Stretch 1–3, más suave que el 5 por defecto), probando la fuerza con saturación y SCNR fijos."
- Alternativa: arcsinh que conserva color, `f = asinh(k·L)/asinh(k)/L` con `L = max(RGB)` (**k ≈ 5000** para muchas estrellas), saturación ×1,6 alrededor de la media, núcleos saturados neutros; o ArcsinhStretch "hasta que se vean claramente sin hincharse (GHS opcional después)".

**Código: fase 1 de GHS sobre la starless**

```javascript
var v = View.viewById("Starless");
if (v.isNull) throw new Error("No existe Starless");
var img = v.image;
img.selectedChannel = 0;
var med = img.median();          // SP = mediana actual (medir ANTES de cada pasada)
img.resetSelections();
if (med > 0.01) throw new Error("La imagen ya no es lineal: no repetir fase 1");

var P = new GeneralizedHyperbolicStretch;
P.stretchType = GeneralizedHyperbolicStretch.prototype.ST_GeneralisedHyperbolic;
P.stretchChannel = GeneralizedHyperbolicStretch.prototype.SC_RGB;
P.stretchFactor = 2.5;           // D
P.localIntensity = 12;           // b
P.symmetryPoint = med;           // SP
P.shadowProtection = 0;          // LP
P.highlightProtection = 0.95;    // HP
if (!P.executeOn(v)) throw new Error("GHS fase 1 falló");
"GHS fase 1: mediana previa " + med;
```

**Control.** Mediana del fondo ≈ objetivo (0,15–0,25 nebulosa; 0,10 galaxia). Sin recorte en sombras (mínimo ≥ 0; si el fondo se aplasta, bajar BP o subir el fondo). Sin estrellas hinchadas (proteger altas luces/DRC). Sin deriva de color (modo Col o estirado ligado). El estirado revela todo: la limpieza se hace en lineal, y varias curvas pequeñas son mejores que una grande. Un pico más ancho indica más ruido; el pico de un canal desplazado en las sombras indica una dominante. Un histograma con "dientes de sierra" al ampliarlo = posterización o ruido amplificado por estirados repetidos: menos pasadas destructivas y revisar el paso anterior.
