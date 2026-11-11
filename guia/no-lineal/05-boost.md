# Paso 5: Boost (curvas, contraste, saturación)

[← Índice](../SKILL.md) · Anterior: [Paso 4: Máscaras](04-mascaras.md) · Siguiente: [Paso 6: NoiseX](06-noisex.md)

**Por qué.** El boost es la parte estética: subir contraste local y saturación **sin fabricar detalle**. Todo lo que se añade aquí debe existir en los datos. "Más microcontraste no es más resolución; más saturación no es más exactitud de color".

**Curvas y saturación**

- Curva S suave en L; saturación de partida **S 0,5 → 0,6**.
- Método "empujar hasta el rechazo" (aescaffre): clonar y probar el punto medio de la curva S de saturación en pasos **0,58 → 0,63 → 0,68 → 0,73 → 0,78**; quedarse con el último sin bandas de color, tonos antinaturales, ruido de color amplificado, canales > 0,98 ni fondo teñido (**nebulosas 0,70–0,78; galaxias 0,63–0,70**). "Anotar el valor ganador en el dossier."
- "No saturar con una dominante de fondo sin resolver (la amplifica); los núcleos de estrella ya recortados no recuperan color. Si el ruido de color del cielo es visible o el objeto llena el campo, mejor saturación selectiva por tono o con máscara que global."
- **Más color en la nebulosa sin teñir el cielo:** saturar a través de una máscara de luminancia (0 en el cielo, 1 en lo brillante), probando 0,63 → 0,88, cuando el usuario pida más color o cuando la versión sin máscara pare por «fondo teñido»; siempre sobre la misma entrada, no sobre la ya saturada. En galaxia, 0,63–0,70.
- Una máscara que se crea en el Paso 4 (p. ej. la de fondo para contraste local) es para usarla en el paso siguiente; si no se va a aplicar contraste local, no se crea.
- Puntos de curva para levantar sombras sin quemar el objeto: `[[0,0.04],[0.04,0.12],[0.10,0.16],[0.20,0.24],[0.50,0.50],[1,1]]`; "las curvas S que hunden sombras matan esa señal". Oscurecer sombras sólo en el fondo verdadero y con transición suave (p. ej. 0,05→0,003, 0,10→0,015, 0,15→0,05).

**Elegir el color entre varias versiones** (Rafael, 11 nov 2026). El color no lineal es en parte estético: en vez de entregar un único resultado, se generan copias y el usuario elige mirando las previas. Todas parten de la misma entrada y se miden igual:

| Versión | Qué cambia |
|---|---|
| Neutra | nada (sin saturar): se guarda siempre como referencia |
| **Equilibrada (recomendada)** | saturación al fallo (arriba) |
| Viva | un paso más de saturación (+0,05) a través de la máscara de luminancia (el cielo no se tiñe) |
| Cálida / fría | equilibrada + curvas suaves de rojo y azul (±0,015 en medios tonos) ancladas en el cielo |
| Contraste suave / medio | equilibrada + curva S (±0,02 / ±0,04) anclada en el cielo |

Medidas de cada una: canales > 0,98, dominante y ruido de color del cielo (los fallos de la saturación al fallo), **tono del objeto y su deriva**, saturación media y **% de píxeles muy saturados**. Una versión que no cumple se puede elegir, pero se dice. Las curvas de equilibrio y contraste no mueven el cielo: la neutralidad del fondo es de la calibración de color (Paso 12 lineal) y no se toca aquí.

**Calibración frente a interpretación.** La calibración de color (lineal) da colores creíbles; el color no lineal es interpretación y tiene que seguir siendo plausible: tonos coherentes con la emisión (Hα rojo, OIII verde azulado, reflexión azul, polvo pardo), estrellas blancas o de su color, sin dominante en el fondo. "Una imagen bonita no es necesariamente una imagen colorimétricamente fiel."

**Medidas de color** (de las láminas de color; umbrales orientativos, sin calibrar con varios casos):

- **Deriva de tono.** La saturación y las curvas de contraste cambian la croma pero no deberían girar el tono del objeto: un giro de más de 10° entre dos pasos no lineales es una deriva (curvas por canal, máscara mal hecha, dominante). Del lineal al estirado algo de cambio es normal salvo con estirados que conservan el color. Se mide en los píxeles del objeto (percentiles 70–99,5 de la luminancia).
- **Mapa de saturación.** % de píxeles con señal y croma > 0,8: los colores que se van al borde del gamut. Si se dispara (más del 5 % o el doble que la neutra), la saturación se ha pasado aunque los canales no recorten.
- **Saturación selectiva por tono.** Cuando falta un solo color (Hα rojo, OIII cian) y la global ya para por el cielo o por otro color, subir sólo ese tono con una campana de ±30° alrededor (cantidad 0,3; negativa para desaturar un tono que se sale del gamut al exportar), con máscara de luminancia si el cielo tiene ese tono.

**Núcleo de galaxias, antes de saturar.** Si el estirado deja el núcleo como una meseta de más de 3 px de radio (`meseta_nucleo.radio_px`) o se ve plano, comprimir el rango dinámico sólo dentro de una máscara de bulbo (luminancia de gran escala > 0,35, rampa de 0,25), mezclado al 60 %, y medir la meseta antes y después, anillos oscuros nuevos en el perfil radial y cuánto brillo pierde el bulbo. A pleno, o con contraste local de radio grande sobre el bulbo, salen anillo oscuro y bulbo plano; sin este paso (galaxia grande, 7 nov 2026) el núcleo y la satélite quedaron como una meseta de 22 px, con él, 1 px. El contraste local del disco, si se usa, va después y con máscara galaxia × (1 − bulbo).

**Comparar dos compresiones del núcleo** (multiescala y por gradiente) con la misma máscara de bulbo y la misma mezcla, y quedarse con la que deja menos meseta sin anillos nuevos ni bulbo plano. En una prueba de 8 nov 2026 la de gradiente bajó la meseta de 6,4 a 0,6 px sin anillo y la multiescala dejó 7,7 px con un anillo oscuro (una sola imagen: las medidas deciden en cada caso).

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/no-lineal.md#no-lineal-05); en Siril, [Anexo I](../anexos/I-siril.md).

**Realce del fondo débil y de las estructuras oscuras**

- **Realce del fondo débil.** Cuándo: sobre la starless, antes del contraste local y del denoise final, con nebulosidad débil extensa, IFN, polvo o colas de nebulosa apagadas **y señal confirmada** (Paso 1 lineal, Anexo D). Por qué: suma la gran escala de la imagen a través de una máscara invertida de luminancia; levanta lo débil y extenso sin quemar lo brillante ni realzar el ruido fino. No usarlo si el fondo es sólo ruido o queda gradiente residual: lo amplifica.
- **Realce de estructuras oscuras.** Cuándo: sobre la starless (con estrellas crea anillos oscuros), en nebulosas oscuras, bandas de polvo de galaxias o filamentos oscuros sobre emisión, con buena SNR. Por qué: oscurece sólo lo que es más oscuro que su entorno de gran escala, sin tocar el resto. Mirar antes la máscara: si sigue estructuras reales, vale; si es ruido moteado o rodea bordes brillantes, deshacer y usar contraste local con máscara.

**Contraste local**

- **Comparar.** Sobre copias, contraste local por ecualización adaptativa con dos radios (64 y 128 px), compresión multiescala de la luminosidad mezclada al 50 % y realce de estructuras oscuras. Medir el contraste local (rango p10–p90 en celdas de 64 px con señal), el ruido y el nivel del cielo y los quemados. Gana el que más sube el contraste (`contraste_ganado_pct`) sin subir el ruido del cielo más de un 25 %, sin mover el cielo más de 0,03 ni quemar; si ninguno cumple, no tocar la imagen. En una nebulosa de emisión y reflexión (8 nov 2026) ganó el radio 64 (contraste +15 %, ruido ×1,18); el 128 subía el ruido ×1,35.
- Receta de la v4B que gustó: contraste local por ecualización adaptativa **radio 256, amount 0,35, límite de pendiente 2,0** sobre la capa sin estrellas no lineal, con máscara de fondo `1 − clip((L64 − 0,20)/0,25)`, seguida de **NXT 0,75** bajo esa misma máscara y **NXT 0,30** global.
- "**No usar un mapa de 'estructuras oscuras' por diferencia de escalas** (`max(L_suave − L, 0)`): en una nebulosa de emisión y reflexión salía dominado por ruido moteado y creaba bordes oscuros alrededor de los bordes brillantes del fantasma." El realce de estructuras oscuras es la misma técnica: vale sólo si su máscara sigue estructuras reales.
- El contraste local de radio pequeño (96, amount 0,25, máscara L² sólo en lo brillante) es el complemento para el detalle del fantasma (v4A).
- Límites prácticos (aescaffre): amount > 0,5 ya parece artificial; límite de pendiente ~1,5–1,8 (≥ 2,0 artefactos); una sola pasada suele bastar; contraste local + compresión multiescala juntos dan aspecto 'diseñado': usar uno u otro.
- Radios: NOVA, ~1/12 del lado corto de la imagen (32–128 px), amount 0,5, pendiente 1,5 en nebulosas y 2,0–2,5 en galaxias. Galaxias (aescaffre): radio 64, amount 0,25 (de canto) a 0,35 (de cara), pendiente 1,3–1,5.
- Radios pequeños crean anillos oscuros alrededor de estrellas: aplicar siempre sobre la starless o con máscara de estrellas. La compresión multiescala con transformada mediana evita anillos oscuros en campos ricos en estrellas.

**Control.** Tono del objeto sin girar más de 10° y píxeles muy saturados sin dispararse (versión neutra guardada); 100 % y en negativo (imagen invertida): bandas de color, anillos alrededor de estrellas, ruido moteado, bordes de máscara. Porcentaje de píxeles > 0,98 antes y después. Textura en altas luces: "conservar ≥ 60 %; < 40 % = textura aplastada". "Señales de sobreprocesado: aspecto 'diseñado' en vez de 'observado', transiciones nebulosa–fondo demasiado limpias, bordes 'ilustrados', pérdida de grano en zonas débiles → bajar el contraste local, quitar la compresión multiescala, curvas más suaves."
