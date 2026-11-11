# Paso 1: Estirado (starless y estrellas por separado)

[← Índice](../SKILL.md) · Siguiente: [Paso 2: LRGB / Paleta](02-lrgb-paleta.md) · Porqué, GHS a mano y ajustes finos: [detalle](../detalle/no-lineal-01-estirado.md)

Primer paso de la sesión no lineal: leer antes `estado.md` (Paso 17 lineal). Starless y estrellas se estiran **por separado**: la starless tolera un estirado más profundo; las estrellas, más suave y con las altas luces protegidas. Irreversible: lo que no se limpió en lineal queda amplificado.

**Cielo objetivo** (estirado al fallo, el método por defecto): **0,10 en nebulosas y cúmulos; 0,07 en galaxias**.
En una galaxia con mucho cielo alrededor, 0,10 deja el fondo gris: una galaxia grande OSC (7 nov 2026) quedó mucho mejor con cielo 0,07 y límite de ruido del cielo 0,12, y las estrellas con el mismo estirado y saturación 1,3 (con el estirado propio de estrellas suave salían diminutas y pálidas). Es el nivel de las zonas más oscuras de la imagen (`cielo`), no la mediana: en una nebulosa que llena el campo la mediana sale sola por encima (nebulosa dual band: 0,14 con cielo 0,10). Con cielo 0,15 la nebulosa queda algo pasada (prueba de nov 2026), y en una nebulosa oscura el fondo sale gris, sin zonas oscuras: en nebulosas oscuras, cielo 0,12 (las pasadas siguientes suben el polvo sin mover el cielo). El perfil puede fijar otro.

**Fondo objetivo** (sólo para el modo antiguo a mediana fija): nebulosa de emisión 0,15–0,25 · galaxia 0,10 · cúmulo de galaxias 0,08–0,10 · margen de altas luces 0,05.

**Método**

| Método | Cuándo |
|---|---|
| **GHS** | Control fino (SP, LP/HP): galaxias HDR y starless |
| **Adaptativo multiescala** | Estructuras multiescala, nebulosas complejas, galaxias; igualar capas antes de combinar (L y RGB) |
| **Arcsinh** | Conserva el color; buen candidato en la comparación |
| Transformación de histograma | Válida; GHS es mejor en varias pasadas porque LP no vuelve a comprimir las sombras ya trabajadas |
| **Estirado propio de estrellas** | Sólo la capa de estrellas lineal |

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

**Estirar al fallo, en pasadas cortas** (método por defecto). Varias pasadas cortas son mejores que una larga: se estira hasta que algo falla y se queda la pasada anterior. Tras la fase 1, pasadas cortas de GHS (D ≈ 1, b 6, SP = cielo, HP 0,92), cada una seguida de un punto negro que devuelve el cielo a ~0,10; se mide tras cada pasada. **Fallo:** ruido del cielo > 15 % del cielo, > 0,05 % de píxeles a 0 o > 0,95. Si una pasada falla, se deshace y se prueba la mitad de corta; cuando ni la más corta cabe, se queda la anterior. En una galaxia grande (nov 2026) da lo mismo que el arcsinh elegido (bulbo 0,75, disco 0,24, ruido del cielo ~12–14 %), mientras que llevar sólo la mediana a 0,10 dejaba la galaxia apagada (bulbo 0,45, disco 0,13).

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/no-lineal.md#no-lineal-01); en Siril, [Anexo I](../anexos/I-siril.md).

**Estrellas con el mismo estirado** (galaxias). Sumar starless y estrellas lineales (la separación lineal es una suma exacta), repetirles exactamente el estirado y los puntos negros de la starless y volver a separar: las estrellas quedan con el brillo que tendrían en la imagen entera. En una galaxia grande (7 nov 2026), con un estirado propio de estrellas la final se quedó con 269 estrellas detectables; con este método, 13 721.

**Antes de estirar, quitar la visualización automática.** Sólo cambia la pantalla: con ella puesta la imagen parece ya estirada y la estirada se ve estirada dos veces. Las herramientas de estirado la quitan solas de la imagen de entrada.

**Topes de luces y color.** Ningún candidato vale si el p99 pasa de 0,80 (disco lavado), el p999 de 0,92 (núcleo o zonas brillantes quemadas) o si apenas estira (p99 a menos de 0,10 del cielo). El estirado conserva el color: misma curva para los tres canales sobre la luminancia; estirar cada canal por su cuenta deja halos verdes y magenta alrededor del objeto (galaxia grande, 10 nov 2026). En galaxias se prefiere el que más levanta la señal débil (brazos, disco exterior) **dentro de esos topes**.

**Comparar métodos.** Probar sobre copias un estirado por pasadas cortas al fallo (GHS), uno adaptativo multiescala y arcsinh, todos llevados **al mismo cielo** para comparar en igualdad. Gana, entre los que no fallan (ruido del cielo, recortes, dominante), el que más separa la señal débil del fondo: `separacion` = (p90 − cielo) / ruido del cielo. La capa de estrellas se estira aparte.

**Meseta del núcleo.** `meseta_nucleo.radio_px` es el radio equivalente de lo que queda por encima de 0,95 alrededor del punto más brillante. Con estructura: 0–3 px; en una galaxia grande procesada por un modelo local, 22 px (núcleo y la galaxia satélite planos). Si pasa de 3, `no_cumple` lo dice y el siguiente paso es comprimir el núcleo (Paso 5), **no** volver a estirar ni encadenar más GHS.

**Estirado adaptativo multiescala.** Ajustes: fondo objetivo (0,15), agresividad (0,6–0,7), compresión de rango dinámico (0,40), recuperación de contraste (0,25 sutil, 0,5 moderado, 1 completo), separación de escalas (1024), saturación propia (desactivada en Hα o capas que se combinarán después) y una región de fondo (imprescindible si el objeto llena el campo). Orden de ajuste: región de fondo → fondo objetivo → agresividad → compresión → separación de escalas → recuperación de contraste → saturación. Más señal débil: subir un poco el fondo y bajar la agresividad. La compresión protege núcleos durante el estirado; no sustituye a la compresión multiescala del Paso 5.

**Capa de estrellas: estirado propio**

- Cuándo: la capa de estrellas **lineal**, y las estrellas RGB que se añaden a una imagen de banda estrecha. Nunca la starless ni una capa ya estirada. En galaxias y campos con muchas estrellas es mejor el mismo estirado que la starless: con un estirado propio suave las débiles se pierden al recombinar sobre un fondo estirado al fallo (galaxia grande, nov 2026).
- Cómo (por defecto): arcsinh que conserva el color, `L = máx(R,G,B)`, `f = asinh(k·L) / (asinh(k)·L)`, cada canal × f, **k = 3000**. Lo débil se amplifica ~×345 y lo brillante casi nada: salen las estrellas débiles sin hinchar las brillantes. Nebulosa oscura (7 nov 2026): con Star Stretch (SetiAstro) amount 2 la final tuvo ~2 200 estrellas visibles y un aporte del 0,8 %; con el arcsinh k 3000, ~18 000 y un 10 %.
- Star Stretch (sólo si se pide): su curva sube lo débil sólo ×9 con amount 2. amount 1–3 en campos con muchas estrellas, hasta 5 con pocas. Referencia medida (p90 de los píxeles de estrella > 0,005): 0,08–0,12 con amount 2 en una nebulosa dual band y una galaxia grande (nov 2026); el "≈ 0,25" de NOVA se mide de otra forma y no se alcanza así ni con amount 5. Saturación 1; 1,2–1,5 si salen pálidas, vigilando anillos de color. Quitar verde sólo con dominante verde real.

**Control.** Estirado hasta el fallo (ni más ni menos: la pasada anterior a que el ruido del cielo pase del 15 % o recorte); cielo ~0,10 (0,07 en galaxias); sin dominante en el cielo (< 5 %; si la hay, venía de la lineal: corregirla allí); mínimo ≥ 0 (sin sombras aplastadas); sin estrellas hinchadas; sin deriva de color. Pico más ancho = más ruido; pico de un canal desplazado = dominante; "dientes de sierra" al ampliar el histograma = posterización por estirados repetidos.
