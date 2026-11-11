# Paso 8: Estirado y procesado de estrellas

[← Índice](../SKILL.md) · Anterior: [Paso 7: Nitidez](07-nitidez.md) · Siguiente: [Paso 9: Recombinación](09-recombinacion.md) · Diagnóstico de halos y recetas de una nebulosa de emisión y reflexión y una nebulosa oscura: [detalle](../detalle/no-lineal-08-estrellas.md)

La capa de estrellas (original − starless) lleva PSF, halos, aigrettes y residuos de la separación. Llega aquí **lineal** (el Paso 1 sólo estira la starless) y se estira justo antes de recombinar, cuando la starless ya está terminada: así se juzga el tamaño y el color de las estrellas sobre la imagen casi final (Rafael, 11 nov 2026). Tiene que quedar con el fondo a cero, el color recuperado y sin residuos, o el screen mete esa basura en la imagen final.

**Estirado de la capa**

- **Galaxias y campos con muchas estrellas: el mismo estirado que la starless.** Sumar starless y estrellas lineales (la separación lineal es una suma exacta), repetirles exactamente el estirado y los puntos negros de la starless del Paso 1 y volver a separar: las estrellas quedan con el brillo que tendrían en la imagen entera. En una galaxia grande (7 nov 2026), con un estirado propio de estrellas la final se quedó con 269 estrellas detectables; con este método, 13 721. Necesita la starless estirada del Paso 1 sin tocar. En nebulosas débiles hincha las estrellas (nebulosa oscura: 25 % de la capa por encima de 0,02): ahí, el estirado propio.
- **Resto: estirado propio que conserva el color.** Arcsinh con `L = máx(R,G,B)`, `f = asinh(k·L) / (asinh(k)·L)`, cada canal × f, **k = 3000**. Lo débil se amplifica ~×345 y lo brillante casi nada: salen las estrellas débiles sin hinchar las brillantes. Nebulosa oscura (7 nov 2026): con Star Stretch (SetiAstro) amount 2 la final tuvo ~2 200 estrellas visibles y un aporte del 0,8 %; con el arcsinh k 3000, ~18 000 y un 10 %.
- Star Stretch sólo si se pide: su curva sube lo débil sólo ×9 con amount 2 (amount 1–3 en campos con muchas estrellas, hasta 5 con pocas; p90 de las estrellas 0,08–0,12 con amount 2). Saturación 1; 1,2–1,5 si salen pálidas.
- Nunca un autoestirado: levanta el fondo y los residuos de la separación (manchas verdes o moradas).

**Candidatos para elegir** (el usuario decide mirando las previas sobre la starless terminada; ninguno se elige solo):

| Candidato | Tamaño | Saturación |
|---|---|---|
| Recomendada | el del estirado de la guía | la de la preparación |
| Estrellas más presentes | **+20 %** | **+10 %** |
| Estrellas muy presentes | **+50 %** | **+20 %** |

- "Más grandes" = el área de estrellas (`pix_estrella_pct`, píxeles con luminancia > 0,02) crece ×1,2 o ×1,5. **Sin dilatación** (deja anillos y formas de diamante, como la erosión): se suben las alas débiles de la capa estirada con un arcsinh que conserva el color hasta llegar a ese área.
- "Más saturadas" = cada canal se aleja de la media de los tres: `c' = L + s·(c − L)` con s 1,1 o 1,2, después de la preparación.
- Cada candidato se combina por screen con la starless terminada para la previa (entera y recorte al 100 % en la zona con más estrellas) y para medir el aporte (Paso 9, ≥ 2 %). El elegido es la capa que se recombina; las demás se cierran.

**Preparación de la capa** (se aplica a cada candidato)

- Limpiar residuos: poner a 0 lo que esté por debajo de 0,005, **sólo si se lleva poco brillo** (≤ 10 %). Si se llevara más, lo que borra son estrellas débiles de una capa poco estirada: no limpiar, avisarlo en `no_cumple` y arreglarlo en el Paso 1. Recuperar color con la curva de saturación `[[0,0],[0.40,0.65],[0.70,0.90],[1,1]]`.
- **Suelo antes del screen:** punto negro por canal = mediana + 2·MAD de la capa, reescalando para no tocar los núcleos. En campos densos ese "grano" pueden ser estrellas débiles reales: no subir el suelo hasta borrarlas.
- Contenerlas atenuando el brillo (por encima de 0,02, × 0,65), nunca con erosión ni transformaciones morfológicas (anillos).
- Comprimir las luces por encima de 0,80 hasta 0,97 (núcleos neutros, sin recorte brusco).

**Reducir estrellas gordas** (sin erosión). Si las estrellas quedan grandes frente al objeto, reducirlas con la starless del mismo estirado, no con erosión ni transformaciones morfológicas (dejan formas de diamante y anillos negros). Fórmula (astroimagetw), con `~x = 1 − x` y `mtf(k, x)` una transformación de medios tonos que oscurece las dos imágenes por igual:

`reducida = ~( ( ~mtf(k, original) / ~mtf(k, starless) ) · ~starless )`

Cuanto más oscurece `mtf`, más se reducen. Como mucho **dos pasadas**. Control: tamaño de las estrellas antes y después (FWHM mediano, o `pix_estrella_pct` de la capa) y que las estrellas no se oscurezcan, cambien de color ni dejen anillo; revisar al 200–400 %. Alternativa equivalente cuando hay capa de estrellas: atenuar la capa (abajo) o elegir un estirado más suave aquí. Si se hincharon por un estirado excesivo con GHS, otra salida es su transformación inversa concentrada en las altas luces ([detalle del Paso 1](../detalle/no-lineal-01-estirado.md)).

**Tamaños distintos por filtro o canal** (mono con varios filtros, o deconvolución sólo en la luminancia): al combinar salen anillos de color o negros alrededor de las estrellas. Igualar antes de combinar: deconvolución en todos los canales (o en la imagen color entera) y, si un canal sigue con estrellas mayores, reducirlas en ese canal.

**Extracción en no lineal** (evita halos hinchados): clon antes de separar → separación lineal para la starless → estirar la starless → aplicar al clon **exactamente el mismo estirado** → separar con `unscreen` sobre el clon → estrellas listas para screen.

**Extraer la capa por screen inverso**

- Cuándo: hay imagen con estrellas y starless **con el mismo estirado** y hace falta la capa de estrellas sin repetir la separación (tras retocar la starless, o para rehacer la capa de otra versión).
- Por qué: es la inversa exacta de la recombinación por screen; separar y recombinar devuelve la imagen original.
- Cómo: mismo método (screen o suma) que se usará al recombinar. Si los estirados no coinciden, salen halos o agujeros: no usarla.

**Estrellas de banda estrecha** (si no hay RGB): R = 0,5·Hα + 0,5·SII, G = 0,3·Hα + 0,7·OIII, B = OIII (sin SII: R = Hα). Color plausible, no fotometría.

**Halos y núcleos**

- Núcleo saturado: neutralizarlo a blanco en la capa, o mejor evitarlo con toma corta / HDR.
- Halos magenta: `G = máx(G, mín(R,B))`.
- Atenuar 35–40 % sólo la capa de estrellas en la corona del halo es aceptable y se documenta; nunca tocar la nebulosa de esa zona.
- Halo dudoso (¿reflejo, nubes, real?), restos de la separación en estrellas muy brillantes o halos instrumentales en la starless: ver el detalle antes de tocar nada.

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/no-lineal.md#no-lineal-08); en Siril, [Anexo I](../anexos/I-siril.md).

**Control.** Tamaño y saturación conseguidos frente a los pedidos (×1,2 / ×1,5 y ×1,1 / ×1,2); fondo negro (mediana ≈ 0 tras el suelo); p90 de los píxeles de estrella (> 0,005) ≥ 0,08 (0,08–0,13 con el estirado propio de estrellas, más con el mismo estirado que la starless); `pix_estrella_pct` (píxeles con luminancia > 0,02) ≥ 0,3 % en campos con estrellas: por debajo, la capa está casi vacía y la final saldrá sin estrellas (galaxia grande procesada por un modelo local, nov 2026); `no_cumple` vacío; sin manchas de residuos ni anillos de color; máximo < 0,98; halos residuales revisados al 200–400 % en zonas brillantes.
