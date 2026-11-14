# Detalle del Paso 1 no lineal: Estirado

[← Ficha del paso](../no-lineal/01-estirado.md) · [Índice](../SKILL.md) · En PixInsight: [Anexo J, detalle](../anexos/J-pixinsight/detalle.md#no-lineal-01)

Material de apoyo de la ficha: el porqué, las fuentes y los ajustes que sólo hacen falta cuando la receta no basta. La ficha manda. Los nombres de procesos y la interfaz de cada programa están en su anexo.

**Por qué.** El estirado reparte el rango dinámico lineal (señal proporcional al flujo) en el rango de pantalla. "Starless tolera estirado más profundo; estrellas, más suave con protección de altas luces". "Nunca estirar con fórmulas por píxel inventadas... Estirar con estirado adaptativo multiescala, GHS o transformación de histograma, una vez, y luego curvas suaves." Fondos objetivo de aescaffre; con estirado estadístico las medianas típicas son 0,22 (nebulosa) y 0,12 (galaxia).

**Otros métodos.** HMS / VeraLux: color vectorial guiado. Estirado enmascarado: clásico para no hinchar estrellas (los centros saturados salen mal si no se reparan antes).

**Transformación de histograma y visualización automática.** La transformación de histograma (medios tonos) equivale en GHS a b = 1. La visualización automática es sólo eso: la imagen sigue lineal hasta aplicar el estirado. No confundir ver la imagen con haberla estirada.

**GHS en detalle** (el mismo método en PixInsight y en Siril)

- D del interfaz: D 1 → 1,72; D 2 → 6,39; D 3 → 19,1 (real = e^D − 1). D = 0 no hace nada.
- b controla la forma: −1 logarítmico (suave, ajustes post-estirado), 0 exponencial, 1 = transformación de histograma, 2–5 hiperbólico (realce focalizado), 5–15 superhiperbólico (primer estirado desde lineal, concentra el contraste en el pico estrecho).
- SP = punto de máximo contraste; LP y HP protegen sombras y luces con una recta tangente.
- GHS es reversible con las transformaciones hiperbólica, arcsinh, de medios tonos y potencia, **sólo en modo por canal (RGB/K) y sin recorte**; en modo color o con recorte, no. La inversa calcula otra transformación: no es deshacer.
- **Usos de la inversa** (documentación de GHS): (1) recuperar estrellas que se han hinchado con un estirado excesivo, con una transformación inversa concentrada en las altas luces (SP/LP/HP alrededor de las estrellas) y después una pasada suave para devolver el brillo general; (2) si el separador de estrellas no reconoce estrellas brillantes estiradas con b alto: estirado moderado con b = 0 por canal, separar estrellas y aplicar la inversa para volver a lineal. Lo preferible sigue siendo separar en lineal (Paso 15 lineal).
- Valores de partida (documentación): 1.ª pasada b 8–10, LP 0, HP 1, D hasta que el pico del histograma quede en ~0,20–0,25; siguientes, b 3–5, D pequeño, SP en la estructura objetivo, HP para estrellas y zonas brillantes, LP si el fondo se oscurece. Histograma en escala logarítmica para ver lo que ocupa pocos píxeles.
- Modo color (mismo factor para los tres canales): conserva la saturación en el primer estirado RGB, pero puede pasar de 1; si salen núcleos de estrella quemados o colores alterados, probar el recorte por mezcla RGB.

**GHS a mano (cualquier interfaz).** Sin visualización automática y con vista previa en tiempo real, ampliar el histograma y poner SP en el centro del pico o justo a su izquierda; b ≈ 8–8,5 y subir D hasta que el pico principal no pase de ~¼ de la altura del gráfico; aplicar. Segunda pasada: SP sobre la zona a realzar, b ≈ 1–1,5, D 0,5–1, equilibrando LP/HP.

**Ajustes finos de GHS** (fuente externa: PDF del usuario "Skill Técnica GHS v3.0", **no verificada con medidas propias**; ajustes de la receta de 3 fases, no un método alternativo):

- **SP por fórmula:** `SP = pico + k·FWHM_pico`, k 0,5–1,5. Útil si el pico es ancho o hay "colinas" en el histograma logarítmico; si no, SP = mediana.
- **Histograma bifurcado:** focalización destructiva por exceso de b con D alto; **no** corregirlo moviendo SP.
- **Convergencia:** mediana en el objetivo y caída monótona del log-histograma a la derecha del pico. El PDF fija 0,10–0,15 para todo; aquí eso es el objetivo de galaxia.
- **Modo saturación** (b −1 a −3) para subir saturación sin hinchar estrellas. En modo color, vigilar el recorte de canales brillantes (no invertible).
- **D:** los rangos del PDF (1,5–8) son de interfaz y logarítmicos: un 8 es muy agresivo. Mantener D 2–3 en la primera fase.

| Objeto | Estrategia de b (según el PDF) |
|---|---|
| Galaxia | 1.ª pasada b 12–15 con SP en el brazo débil; siguientes 8 → 5 → 3 acercando SP al núcleo, con HP protegiendo el bulbo |
| Nebulosa de emisión / SHO | D bajo (1,2–2) y HP agresivo (0,85–0,95) para no quemar frentes de ionización |
| Polvo / IFN | SP pegado al pico de fondo y LP alto |
| Capa de estrellas | Evitar b > 8; preferir b −1 a −2 o arcsinh, con HP activo |

Documentación citada por el PDF: `ghsastro.co.uk/doc/tools/GeneralizedHyperbolicStretch/` y `ghsastro.co.uk/updates/`.

**Estirado adaptativo multiescala: riesgos y clases** (en PixInsight, MAS; en Siril, el estirado por escalas de SirilAstroPilot)

- Agresividad alta: más contraste en medios pero más ruido y recorte en bajas luces.
- Compresión del rango dinámico demasiado alta aplana. No sustituye a la compresión multiescala del rango dinámico (HDR), que va después si aún sobra dinámica.
- Separación de escalas: subirla hasta que la componente de gran escala quede casi vacía.
- Riesgos: ringing/halos en estrellas brillantes, microcontraste granuloso, ruido amplificado, núcleo aplanado. "Validar en la imagen entera, no sólo en un recorte (depende del tamaño)."
- Clases: nebulosa débil = estirado suave, recuperación moderada; nebulosa compleja = equilibrio recuperación/compresión; galaxia = compresión para el bulbo, recuperación medida; núcleo muy brillante (nebulosa brillante) = HDR con tomas cortas → estirado multiescala sin saturación → compresión HDR → curvas de saturación.
- "No sustituye la compresión HDR ni repara datos recortados. Como usa estadísticas, da estirados parecidos en imágenes distintas."

**Capa de estrellas** (se estira en el [Paso 8](../no-lineal/08-estrellas.md), justo antes de recombinar)

- Estirado de estrellas tipo "Star Stretch": `y = 3^A·x / ((3^A − 1)·x + 1)` (A de 0 a 8; 5 por defecto en el script original), saturación por tono y, si se pide, quitar verde. "Color Boost aumenta separación cromática (controlar R:G:B en no saturados, evitar anillos de color). Suprimir verde off salvo dominante real."
- Objetivo de NOVA: "p90 de la capa en ~0,25 (factor de Star Stretch 1–3, más suave que el 5 por defecto), probando la fuerza con saturación y quitar verde fijos."
- Alternativa arcsinh que conserva color: `f = asinh(k·L)/asinh(k)/L` con `L = max(RGB)` (k ≈ 5000 para muchas estrellas), saturación ×1,6 alrededor de la media, núcleos saturados neutros; o un estirado arcsinh "hasta que se vean claramente sin hincharse (GHS opcional después)".

**Lineal o estirada.** Un master lineal con pedestal puede pasar de 0,01 de mediana (nebulosa oscura: 0,0102); uno estirado suele estar por encima de 0,1, de ahí el umbral 0,05 de la ficha.

**Control.** "El estirado revela todo: la limpieza se hace en lineal, y varias curvas pequeñas son mejores que una grande." Si el fondo se aplasta, bajar el punto negro o subir el fondo objetivo. Con dientes de sierra, menos pasadas destructivas y revisar el paso anterior.
