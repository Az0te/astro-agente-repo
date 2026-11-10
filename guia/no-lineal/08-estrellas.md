# Paso 8: Procesado de estrellas

[← Índice](../SKILL.md) · Anterior: [Paso 7: Nitidez](07-nitidez.md) · Siguiente: [Paso 9: Recombinación](09-recombinacion.md) · Diagnóstico de halos y recetas de una nebulosa de emisión y reflexión y una nebulosa oscura: [detalle](../detalle/no-lineal-08-estrellas.md)

La capa de estrellas (original − starless) lleva PSF, halos, aigrettes y residuos de la separación. Tiene que quedar con el fondo a cero, el color recuperado y sin residuos, o el screen mete esa basura en la imagen final.

**Preparación de la capa**

- Estirarla en el Paso 1: con el mismo estirado que la starless (por defecto en galaxias) o con el estirado propio de estrellas; nunca con un autoestirado, que levanta el fondo y los residuos de la separación (manchas verdes o moradas).
- Limpiar residuos: poner a 0 lo que esté por debajo de 0,005, **sólo si se lleva poco brillo** (≤ 10 %). Si se llevara más, lo que borra son estrellas débiles de una capa poco estirada: no limpiar, avisarlo en `no_cumple` y arreglarlo en el Paso 1. Recuperar color con la curva de saturación `[[0,0],[0.40,0.65],[0.70,0.90],[1,1]]`.
- **Suelo antes del screen:** punto negro por canal = mediana + 2·MAD de la capa, reescalando para no tocar los núcleos. En campos densos ese "grano" pueden ser estrellas débiles reales: no subir el suelo hasta borrarlas.
- Contenerlas atenuando el brillo (por encima de 0,02, × 0,65), nunca con erosión ni transformaciones morfológicas (anillos).
- Comprimir las luces por encima de 0,80 hasta 0,97 (núcleos neutros, sin recorte brusco).

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

**Control.** Fondo negro (mediana ≈ 0 tras el suelo); p90 de los píxeles de estrella (> 0,005) ≥ 0,08 (0,08–0,13 con el estirado propio de estrellas, más con el mismo estirado que la starless); `pix_estrella_pct` (píxeles con luminancia > 0,02) ≥ 0,3 % en campos con estrellas: por debajo, la capa está casi vacía y la final saldrá sin estrellas (galaxia grande procesada por un modelo local, nov 2026); `no_cumple` vacío; sin manchas de residuos ni anillos de color; máximo < 0,98; halos residuales revisados al 200–400 % en zonas brillantes.
