# Paso 5: Boost (curvas, contraste, saturación)

[← Índice](../SKILL.md) · Anterior: [Paso 4: Máscaras](04-mascaras.md) · Siguiente: [Paso 6: NoiseX](06-noisex.md)

**Por qué.** El boost es la parte estética: subir contraste local y saturación **sin fabricar detalle**. Todo lo que se añade aquí debe existir en los datos. "Más microcontraste no es más resolución; más saturación no es más exactitud de color".

**Curvas y saturación**

- Curva S suave en L; saturación de partida **S 0,5 → 0,6**.
- Método "empujar hasta el rechazo" (aescaffre): clonar y probar el punto medio de la curva S de saturación en pasos **0,58 → 0,63 → 0,68 → 0,73 → 0,78**; quedarse con el último sin bandas de color, tonos antinaturales, ruido de color amplificado, canales > 0,98 ni fondo teñido (**nebulosas 0,70–0,78; galaxias 0,63–0,70**). "Anotar el valor ganador en el dossier."
- "No saturar con una dominante de fondo sin resolver (la amplifica); los núcleos de estrella ya recortados no recuperan color. Si el ruido de color del cielo es visible o el objeto llena el campo, mejor saturación selectiva por tono o con máscara que global."
- Una máscara que se crea en el Paso 4 (p. ej. `fondo_lhe`) es para usarla en el paso siguiente; si no se va a aplicar LHE, no se crea.
- Puntos de curva para levantar sombras sin quemar el objeto: `[[0,0.04],[0.04,0.12],[0.10,0.16],[0.20,0.24],[0.50,0.50],[1,1]]`; "las curvas S que hunden sombras matan esa señal". Oscurecer sombras sólo en el fondo verdadero y con transición suave (p. ej. 0,05→0,003, 0,10→0,015, 0,15→0,05).

**Núcleo de galaxias, antes de saturar.** Si el estirado deja el núcleo como una meseta de más de 3 px de radio (`meseta_nucleo.radio_px`) o se ve plano, comprimir el rango dinámico sólo dentro de una máscara de bulbo (luminancia de gran escala > 0,35, rampa de 0,25), mezclado al 60 %, y medir la meseta antes y después, anillos oscuros nuevos en el perfil radial y cuánto brillo pierde el bulbo. A pleno, o con contraste local de radio grande sobre el bulbo, salen anillo oscuro y bulbo plano; sin este paso (galaxia grande, 7 nov 2026) el núcleo y la satélite quedaron como una meseta de 22 px, con él, 1 px. El contraste local del disco, si se usa, va después y con máscara galaxia × (1 − bulbo).

```json
{"llamadas": [
  {"funcion": "comprimirNucleo", "parametros": {"vista": "Starless_st", "opciones": {"nuevaVista": "Starless_nucleo"}}}
]}
```

Por defecto: capas 7, mezcla 0,6, mascaraDesde 0,35. Devuelve meseta antes y después, brillo del bulbo, anillos nuevos, `no_cumple` y el control.

**Comparar dos compresiones del núcleo** (multiescala y por gradiente) con la misma máscara de bulbo y la misma mezcla, y quedarse con la que deja menos meseta sin anillos nuevos ni bulbo plano. En una prueba de 8 nov 2026 la de gradiente bajó la meseta de 6,4 a 0,6 px sin anillo y la multiescala dejó 7,7 px con un anillo oscuro (una sola imagen: las medidas deciden en cada caso).

```json
{"llamadas": [
  {"funcion": "nucleoCandidatos", "parametros": {"vista": "Starless_st", "opciones": {"nuevaVista": "Starless_nucleo"}}}
]}
```

Opciones: `exponentes` ([0.6, 0.4]), `mascaraDesde`, `cerrar`. La tabla está en `comparados`.

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/no-lineal.md#no-lineal-05); en Siril, [Anexo I](../anexos/I-siril.md).

**Más color en la nebulosa sin teñir el cielo:** `saturarAlFallo(vista, { tipo: "nebulosa", mascara: true })` satura a través de una máscara de luminancia (0 en el cielo, 1 en lo brillante) y prueba 0,63 → 0,88. Úsalo cuando el usuario pida más color o cuando la versión sin máscara pare por «fondo teñido»; siempre sobre la misma entrada, no sobre la ya saturada.

```json
{"llamadas": [
  {"funcion": "saturarAlFallo", "parametros": {"vista": "Starless_st", "opciones": {"tipo": "nebulosa", "nuevaVista": "Starless_sat"}}}
]}
```

En galaxia, 0,63–0,70. Devuelve las pruebas, el punto medio elegido, por qué paró, `no_cumple` y el control.

**Realce del fondo débil y de las estructuras oscuras**

- **Realce del fondo débil.** Cuándo: sobre la starless, antes de LHE y del NXT final, con nebulosidad débil extensa, IFN, polvo o colas de nebulosa apagadas **y señal confirmada** (Paso 1 lineal, Anexo D). Por qué: suma la gran escala de la imagen a través de una máscara invertida de luminancia; levanta lo débil y extenso sin quemar lo brillante ni realzar el ruido fino.
- **Realce de estructuras oscuras.** Cuándo: sobre la starless (con estrellas crea anillos oscuros), en nebulosas oscuras, bandas de polvo de galaxias o filamentos oscuros sobre emisión, con buena SNR. Por qué: oscurece sólo lo que es más oscuro que su entorno de gran escala, sin tocar el resto. Mirar antes la máscara: si sigue estructuras reales, vale; si es ruido moteado o rodea bordes brillantes, deshacer y usar contraste local con máscara.

**Contraste local (LHE)**

- **Comparar.** Sobre copias, contraste local con dos radios (64 y 128 px), compresión multiescala de la luminosidad mezclada al 50 % y realce de estructuras oscuras. Medir el contraste local (rango p10–p90 en celdas de 64 px con señal), el ruido y el nivel del cielo y los quemados. Gana el que más sube el contraste sin subir el ruido del cielo más de un 25 %, sin mover el cielo más de 0,03 ni quemar; si ninguno cumple, no tocar la imagen. En IC 63 (8 nov 2026) ganó el radio 64 (contraste ×1,15, ruido ×1,18); el 128 subía el ruido ×1,35.

- Receta de la v4B que gustó: "LocalHistogramEqualization **radio 256, amount 0,35, slopeLimit 2,0** sobre la capa sin estrellas no lineal, con máscara de fondo `1 − clip((L64 − 0,20)/0,25)`, seguida de **NXT 0,75** bajo esa misma máscara y **NXT 0,30** global."
- "**No usar un mapa de 'estructuras oscuras' por diferencia de escalas** (`max(L_suave − L, 0)`): en una nebulosa de emisión y reflexión salía dominado por ruido moteado y creaba bordes oscuros alrededor de los bordes brillantes del fantasma." El realce de estructuras oscuras es la misma técnica: vale sólo si su máscara sigue estructuras reales.
- "El LHE de radio pequeño (96, amount 0,25, máscara L² sólo en lo brillante) es el complemento para el detalle del fantasma (v4A)."
- Límites prácticos (aescaffre): "LHE amount > 0,5 ya parece artificial; slopeLimit ~1,5–1,8 (≥2,0 artefactos); una sola pasada de LHE suele bastar; LHE + HDRMT juntos dan aspecto 'diseñado': usar uno u otro."
- Radios: "Radio de LHE de NOVA: ~1/12 del lado corto de la imagen (32–128 px), amount 0,5, slope 1,5 en nebulosas y 2,0–2,5 en galaxias". Galaxias aescaffre: "LHE radio 64, amount 0,25 (de canto) a 0,35 (de cara), slopeLimit 1,3–1,5".
- "Radios de LHE pequeños crean anillos oscuros alrededor de estrellas: aplicar siempre sobre la starless o con máscara de estrellas. HDRMT con 'median transform' activado evita anillos oscuros en campos ricos en estrellas."

**Control.** 100 % y en negativo (imagen invertida): bandas de color, anillos alrededor de estrellas, ruido moteado, bordes de máscara. Porcentaje de píxeles > 0,98 antes y después. Textura en altas luces: "conservar ≥ 60 %; < 40 % = textura aplastada". "Señales de sobreprocesado: aspecto 'diseñado' en vez de 'observado', transiciones nebulosa–fondo demasiado limpias, bordes 'ilustrados', pérdida de grano en zonas débiles → bajar LHE, quitar HDRMT, curvas más suaves."
