# Paso 1: Estirado de la starless

[← Índice](../SKILL.md) · Siguiente: [Paso 2: LRGB / Paleta](02-lrgb-paleta.md) · Porqué, GHS a mano y ajustes finos: [detalle](../detalle/no-lineal-01-estirado.md)

Primer paso de la sesión no lineal: leer antes `estado.md` (Paso 17 lineal). Aquí se estira **sólo la starless**. La capa de estrellas se queda **lineal** y se estira en el [Paso 8](08-estrellas.md), justo antes de recombinar, donde el usuario elige entre tres candidatos (Rafael, 11 nov 2026). No cerrar ni retocar la starless estirada que sale de aquí ni la capa de estrellas lineal: el Paso 8 las necesita tal cual. Irreversible: lo que no se limpió en lineal queda amplificado.

**Cielo objetivo** (estirado al fallo, el método por defecto): **0,10 en nebulosas y cúmulos; 0,07 en galaxias**.
En una galaxia con mucho cielo alrededor, 0,10 deja el fondo gris: una galaxia grande OSC (7 nov 2026) quedó mucho mejor con cielo 0,07 y límite de ruido del cielo 0,12 (las estrellas, con el mismo estirado y saturación 1,3: ver el Paso 8). Es el nivel de las zonas más oscuras de la imagen (`cielo`), no la mediana: en una nebulosa que llena el campo la mediana sale sola por encima (nebulosa dual band: 0,14 con cielo 0,10). Con cielo 0,15 la nebulosa queda algo pasada (prueba de nov 2026), y en una nebulosa oscura el fondo sale gris, sin zonas oscuras: en nebulosas oscuras, cielo 0,12 (las pasadas siguientes suben el polvo sin mover el cielo). El perfil puede fijar otro.

**Fondo objetivo** (sólo para el modo antiguo a mediana fija): nebulosa de emisión 0,15–0,25 · galaxia 0,10 · cúmulo de galaxias 0,08–0,10 · margen de altas luces 0,05.

**Método**

| Método | Cuándo |
|---|---|
| **GHS** | Control fino (SP, LP/HP): galaxias HDR y starless |
| **Adaptativo multiescala** | Estructuras multiescala, nebulosas complejas, galaxias; igualar capas antes de combinar (L y RGB) |
| **Arcsinh** | Conserva el color; buen candidato en la comparación |
| Transformación de histograma | Válida; GHS es mejor en varias pasadas porque LP no vuelve a comprimir las sombras ya trabajadas |
| **Estirado propio de estrellas** | Sólo la capa de estrellas lineal, en el Paso 8 |

Un autoestirado sólo vale sobre una imagen lineal. Comparar métodos a resultado visual equivalente, no a parámetros iguales.

**GHS en 3 fases desde lineal.** D del interfaz logarítmico: D real = e^D − 1. Restricción LP < SP < HP. Remedir la mediana antes de cada pasada (SP = mediana).

| Fase | D | B | SP | LP | HP | Efecto |
|---|---|---|---|---|---|---|
| 1. Levantar el pie | 2–3 | 10–15 | mediana (~0,001–0,003) | 0 | 0,95 | fondo ~0,15–0,23 |
| 2. Tonos medios | 1,5–2 | 3–6 | nueva mediana | 0,02–0,05 | 0,90 | contraste en medios |
| 3. Altas luces | 0,5–1 | −1 a 0 | nueva mediana | 0,05–0,08 | 0,85 | comprime luces |
| 4 (opcional, núcleos) | 0,3–0,5 | −1,5 | 0,5–0,8 | 0,15 | 1 | núcleos |

Modo color conserva el tono; por canal puede desplazarlo. Histograma con dos cúpulas = exceso de b con D alto: deshacer y bajar b ~40 % o D ~50 %.

- Antes: si la mediana pasa de 0,05, la imagen ya está estirada (no repetir la fase 1; mirar el historial).
- Fase 1 de referencia: D 2,5; b 12; SP = mediana previa; LP 0; HP 0,95.
- **SP según el tipo de objeto** (documentación de GHS): en galaxias, con el objeto separado del fondo y un pico estrecho, SP algo a la derecha del pico, donde empiezan el halo y los brazos débiles (sube lo exterior sin dar contraste al fondo ni al núcleo); en nebulosas que llenan el campo, SP en el pico o algo a su izquierda (revela lo difuso y extenso). Cada pasada con un objetivo concreto; que la imagen se vea algo plana tras la primera no es un fallo.
- GHS elige **intensidades, no zonas**: sobre una imagen ya estirada, SP en el nivel de una estructura y b 3–5 sube su contraste sin máscara; para limitarlo a una región hace falta máscara (Paso 4).

**Estirar al fallo, en pasadas cortas** (método por defecto). Varias pasadas cortas son mejores que una larga: se estira hasta que algo falla y se queda la pasada anterior. Tras la fase 1, pasadas cortas de GHS (D ≈ 1, b 6, SP = cielo, HP 0,92), cada una seguida de un punto negro que devuelve el cielo a ~0,10; se mide tras cada pasada. **Fallo:** ruido del cielo > 15 % del cielo, > 0,05 % de píxeles a 0 o > 0,95. Si una pasada falla, se deshace y se prueba la mitad de corta; cuando ni la más corta cabe, se queda la anterior. En una galaxia grande (nov 2026) da lo mismo que el arcsinh elegido (bulbo 0,75, disco 0,24, ruido del cielo ~12–14 %), mientras que llevar sólo la mediana a 0,10 dejaba la galaxia apagada (bulbo 0,45, disco 0,13).

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/no-lineal.md#no-lineal-01); en Siril, [Anexo I](../anexos/I-siril.md).

**Registro del estirado.** El estirado al fallo de la starless queda registrado (pasadas y puntos negros) para que el Paso 8 pueda repetirlo sobre starless + estrellas en galaxias (estrellas con el mismo estirado).

**Antes de estirar, quitar la visualización automática.** Sólo cambia la pantalla: con ella puesta la imagen parece ya estirada y la estirada se ve estirada dos veces. Las herramientas de estirado la quitan solas de la imagen de entrada.

**Topes de luces y color.** Ningún candidato vale si el p99 pasa de 0,80 (disco lavado), el p999 de 0,92 (núcleo o zonas brillantes quemadas) o si apenas estira (p99 a menos de 0,10 del cielo). El estirado conserva el color: misma curva para los tres canales sobre la luminancia; estirar cada canal por su cuenta deja halos verdes y magenta alrededor del objeto (galaxia grande, 10 nov 2026). En galaxias se prefiere el que más levanta la señal débil (brazos, disco exterior) **dentro de esos topes**.

**Comparar métodos.** Probar sobre copias un estirado por pasadas cortas al fallo (GHS), uno adaptativo multiescala y arcsinh, todos llevados **al mismo cielo** para comparar en igualdad. Gana, entre los que no fallan (ruido del cielo, recortes, dominante), el que más separa la señal débil del fondo: `separacion` = (p90 − cielo) / ruido del cielo. La capa de estrellas se estira en el Paso 8.

**Meseta del núcleo.** `meseta_nucleo.radio_px` es el radio equivalente de lo que queda por encima de 0,95 alrededor del punto más brillante. Con estructura: 0–3 px; en una galaxia grande procesada por un modelo local, 22 px (núcleo y la galaxia satélite planos). Si pasa de 3, `no_cumple` lo dice y el siguiente paso es comprimir el núcleo (Paso 5), **no** volver a estirar ni encadenar más GHS.

**Estirado adaptativo multiescala.** Ajustes: fondo objetivo (0,15), agresividad (0,6–0,7), compresión de rango dinámico (0,40), recuperación de contraste (0,25 sutil, 0,5 moderado, 1 completo), separación de escalas (1024), saturación propia (desactivada en Hα o capas que se combinarán después) y una región de fondo (imprescindible si el objeto llena el campo). Orden de ajuste: región de fondo → fondo objetivo → agresividad → compresión → separación de escalas → recuperación de contraste → saturación. Más señal débil: subir un poco el fondo y bajar la agresividad. La compresión protege núcleos durante el estirado; no sustituye a la compresión multiescala del Paso 5.

**Capa de estrellas:** se estira en el [Paso 8](08-estrellas.md) (mismo estirado que la starless en galaxias; arcsinh que conserva el color en el resto), con tres candidatos para elegir.

**Control.** Estirado hasta el fallo (ni más ni menos: la pasada anterior a que el ruido del cielo pase del 15 % o recorte); cielo ~0,10 (0,07 en galaxias); sin dominante en el cielo (< 5 %; si la hay, venía de la lineal: corregirla allí); mínimo ≥ 0 (sin sombras aplastadas); sin deriva de color. Pico más ancho = más ruido; pico de un canal desplazado = dominante; "dientes de sierra" al ampliar el histograma = posterización por estirados repetidos.
