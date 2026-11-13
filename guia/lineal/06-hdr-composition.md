# Paso 6: Composición HDR

[← Índice](../SKILL.md) · Anterior: [Paso 5: Alineado y recorte común](05-staralignment-crop.md) · Siguiente: [Paso 7: Extracción de canales (OSC dual band)](07-extraccion-canales.md)

**Por qué.** "En las tomas largas los núcleos de las estrellas brillantes (y núcleos de galaxias o una nebulosa brillante) se saturan y pierden color y forma; en las cortas no, y el halo es menor. Las estrellas son brillantes y no necesitan tiempo largo.". La composición HDR combina exposiciones en lineal; **no** es la compresión multiescala del rango dinámico, que actúa sobre una imagen ya estirada.

**Regla (siempre).** Con **varios masters RGB del mismo objeto y distinta exposición** (por ejemplo 60 s y 120 s de noches distintas), el orden es: **alinear → recortar (Paso 5) → HDR (`componerHDR`, este paso) → gradiente (Paso 9) sobre la HDR**. No se quita el gradiente a cada master por separado ni se combinan como el mismo canal (`combinarMismoCanal` lo rechaza si las exposiciones difieren más de un 20 %; `combinarMasters` hace la HDR solo). Comprobado con M31 (13 nov 2026): quitar el gradiente antes y combinar dio un master en gris y sin rango dinámico.

**Cuándo aplica.** Cuando la estrella más brillante del campo (una estrella de magnitud 2–3, el núcleo de una nebulosa brillante) sigue saturada en la exposición corta, o cuando hay grupos de distinta exposición (120 s / 30 s). No en cúmulos ni cuando no hay saturación que recuperar.

**Adquisición**

- Grupos integrados por separado con los mismos parámetros, registrados sobre la misma referencia y recortados igual (ideal: el mismo preprocesado con la misma referencia).
- **Razón entre exposiciones moderada:** Tombolini, con 300 s → 30 s (10×), vio una transición visible y recomienda un escalón intermedio de 1–2 min. El 120 s / 30 s (4×) es cómodo. Si la estrella más brillante sigue saturada en 30 s, añadir un grupo de 5 s (o menos); en una nebulosa brillante se sugieren 30, 10, 5 y 1 s.

**Parámetros y diagnóstico**

| Elemento | Instrucción |
|---|---|
| Orden | Combina de mayor a menor exposición; si se desactiva la ordenación automática, introducir de mayor a menor tiempo |
| Trabajo | En lineal; resultado lineal (mejor en 64 bits), que se ve muy oscuro: verlo con una visualización automática de alta precisión |
| **Umbral de binarización** | Parámetro clave: a partir de qué nivel se considera saturado. Ajustarlo mirando las máscaras generadas |
| Máscaras | Debe haber n−1 máscaras para n imágenes; si falta alguna, bajar el umbral |
| Suavizado / crecimiento de la máscara | Controlan suavidad y extensión de la transición (transición visible = subir suavizado/crecimiento o añadir un escalón intermedio) |
| OSC | Los canales se saturan a distinto nivel: sustituir en cuanto se satura **cualquier** canal; bajar el umbral de binarización para evitar anillos de color |
| Región de ajuste | Limitarla a una zona plana y representativa acelera y mejora el ajuste si hay bordes malos |
| Gradientes | Se corrigen **después**, sobre la HDR (Paso 9). Sólo si un master tiene un gradiente muy distinto de los otros (otra luna, otra contaminación) y la HDR muestra el escalón de fondo, se le quita antes a ese master, y se dice por qué |
| Máscara | Conservar la primera máscara (zonas sustituidas): sirve para proteger o tratar núcleos |

**Caso medido (nebulosa de emisión y reflexión).** Composición HDR en modo global con los masters de 120 s y 30 s (tarda > 60 s). **Con normalización local los masters no saturan a 1**: el verde de 120 s se quedaba en 0,89–0,92 y R/B en 0,93–0,96; medir la meseta por canal y poner el umbral por debajo (**se usó 0,80, suavizado 7, crecimiento 1**). La salida queda reescalada (HDR ≈ 0,275 × M120, sin pedestal): normal, es lineal. La razón 120/30 en estrellas fue 3,66–3,93, pero en las alas de la estrella brillante ≈ 4,1, lo que dejó un escalón del −6 % a 28 px dentro del núcleo saturado: invisible tras estirar, pero comprobarlo con el perfil HDR/M120 y HDR/M30.

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/lineal.md#lineal-06); en Siril, [Anexo I](../anexos/I-siril.md).

Comprobado con una nebulosa de emisión y reflexión (nov 2026; L120 y S30 reducidos ×2, 22 s):
- Razón de flujo 3,94 para exposiciones 4,0 (en octubre se midió 3,66–3,93).
- Escalón en la transición: −0,8 %.
- Sustituido el 0,013 % del campo.
- Aviso: la de 30 s también satura en ~600 px, el núcleo de la estrella brillante.

Si los masters tienen astrometría con distorsión, reducirlos o recortarlos puede invalidarla (ver Paso 5).

**Control.** n−1 máscaras; perfil de la relación HDR/M120 y HDR/M30 en la estrella brillante (sin escalones); bordes de la sustitución revisados al 100 % en estrellas y núcleos; sin anillos de color en OSC. Alternativa propia si la composición no convence: medir la razón de flujo larga/corta en estrellas no saturadas y mezclar con una máscara de saturación dilatada y suavizada, comprobando que no queda escalón ni anillo.

**De dónde salen las estrellas después** (orden de preferencia): (1) capa de estrellas de la **HDR** (larga + corta); (2) capa de estrellas de la **RGB corta** sola (más limpia y con menos halo, pero pierde las más débiles: comprobar el recuento); (3) RGB larga sólo si no hay corta. **Nunca de L, Hα ni banda estrecha.** Si se usa la corta sola: calibrarla igual que la larga (calibración de color, deconvolución de corrección y completa) y escalarla a la larga por la razón de flujo medida en estrellas no saturadas antes de combinar en lineal, o estirarla aparte y recombinar en screen. La nebulosa (starless) sale de la larga o de la HDR, que tienen la SNR.

**HDR sólo en el núcleo (`hdr_core_blend`, NOVA).** "Cuando sólo una zona pequeña (0,3–3 % del campo) necesita compresión, aplicar la compresión HDR multiescala y mezclarla sólo bajo una máscara de luminancia del núcleo suavizada (**umbral ~0,72 nebulosas / 0,80 galaxias, σ 6 px, difuminado 20 px**). En nebulosas brillantes y galaxias grandes el HDR global hacía legible el núcleo pero apagaba la señal débil del resto. Revisar el borde de la máscara (escalones, halos, costuras de color). No en cúmulos. El color de un núcleo blanco rellenado con el de alrededor es una reconstrucción, no color medido."

**Núcleos saturados que quedan.** Lo mejor es una HDR con tomas cortas. Si aun así queda alguno, rellenarlo con la continuación de su ley de potencias medida (Paso 8 no lineal), nunca con un disco plano.
