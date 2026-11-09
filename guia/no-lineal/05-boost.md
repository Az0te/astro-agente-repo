# Paso 5: Boost (curvas, contraste, saturación)

[← Índice](../SKILL.md) · Anterior: [Paso 4: Máscaras](04-mascaras.md) · Siguiente: [Paso 6: NoiseX](06-noisex.md)

**Por qué.** El boost es la parte estética: subir contraste local y saturación **sin fabricar detalle**. Todo lo que se añade aquí debe existir en los datos. "Más microcontraste no es más resolución; más saturación no es más exactitud de color".

**Curvas y saturación**

- Curva S suave en L; saturación de partida **S 0,5 → 0,6**.
- Método "empujar hasta el rechazo" (aescaffre): clonar y probar el punto medio de la curva S de saturación en pasos **0,58 → 0,63 → 0,68 → 0,73 → 0,78**; quedarse con el último sin bandas de color, tonos antinaturales, ruido de color amplificado, canales > 0,98 ni fondo teñido (**nebulosas 0,70–0,78; galaxias 0,63–0,70**). "Anotar el valor ganador en el dossier."
- "No saturar con una dominante de fondo sin resolver (la amplifica); los núcleos de estrella ya recortados no recuperan color. Si el ruido de color del cielo es visible o el objeto llena el campo, mejor saturación selectiva por tono o con máscara que global."
- Una máscara que se crea en el Paso 4 (p. ej. `fondo_lhe`) es para usarla en el paso siguiente; si no se va a aplicar LHE, no se crea.
- Puntos de curva para levantar sombras sin quemar el objeto: `[[0,0.04],[0.04,0.12],[0.10,0.16],[0.20,0.24],[0.50,0.50],[1,1]]`; "las curvas S que hunden sombras matan esa señal". Oscurecer sombras sólo en el fondo verdadero y con transición suave (p. ej. 0,05→0,003, 0,10→0,015, 0,15→0,05).

**Núcleo de galaxias, antes de saturar** (`herramientas/nucleo.js`). Si el estirado da `meseta_nucleo.radio_px` > 3 (o el núcleo se ve plano), `comprimirNucleo("Starless_st", { nuevaVista: "Starless_nucleo" })` aplica HDRMultiscaleTransform de 7 capas y lo mezcla al 60 % sólo dentro de una máscara de bulbo (luminancia de gran escala > 0,35, rampa de 0,25). Mide la meseta antes y después, anillos oscuros nuevos en el perfil radial y cuánto brillo pierde el bulbo. Receta de Opus en una galaxia grande: HDRMT a pleno o LHE de radio 200 sobre el bulbo dieron anillo oscuro y bulbo plano. Sin este paso (galaxia grande con Qwen, 7 nov 2026) el núcleo y la galaxia satélite quedaron como una meseta de 22 px; con él, 1 px. `medirMeseta(vista)` sólo mide. El LHE del disco, si se usa, va después y con máscara galaxia × (1 − bulbo): no es "LHE + HDRMT juntos" porque no tocan la misma zona.

```json
{"llamadas": [
  {"funcion": "comprimirNucleo", "parametros": {"vista": "Starless_st", "opciones": {"nuevaVista": "Starless_nucleo"}}}
]}
```

Por defecto: capas 7, mezcla 0,6, mascaraDesde 0,35. Devuelve meseta antes y después, brillo del bulbo, anillos nuevos, `no_cumple` y el control.

**Comparar HDRMT con GradientHDRCompression** (`nucleoCandidatos`, mismo fichero): aplica los dos con la misma máscara de bulbo y la misma mezcla (`comprimirNucleo` con `metodo: "hdrmt"` y `metodo: "ghc"`, exponente del gradiente 0,6; < 1 comprime) y se queda con el que deja menos meseta sin anillos nuevos ni bulbo plano. En una prueba de 8 nov 2026 GradientHDRCompression bajó la meseta de 6,4 a 0,6 px sin anillo y HDRMT dejó 7,7 px con un anillo oscuro (una sola imagen: las medidas deciden en cada caso).

```json
{"llamadas": [
  {"funcion": "nucleoCandidatos", "parametros": {"vista": "Starless_st", "opciones": {"nuevaVista": "Starless_nucleo"}}}
]}
```

Opciones: `exponentes` ([0.6, 0.4]), `mascaraDesde`, `cerrar`. La tabla está en `comparados`.

**Saturación al fallo en una llamada** (`herramientas/boost.js`): `saturarAlFallo("Starless_st", { tipo: "nebulosa" })` prueba 0,58 → 0,78 sobre copias y se queda la última sin fallo medido (canales > 0,98, fondo teñido: dominante del cielo > 8 % o +4 puntos, ruido de color del cielo × 1,5). Si ni la primera pasa, no satura. Pruebas de nov 2026: galaxia grande → 0,63 (para por ruido de color); nebulosa dual band → no satura (dominante azul del cielo sin resolver). Los umbrales de tinte son provisionales.

**Más color en la nebulosa sin teñir el cielo:** `saturarAlFallo(vista, { tipo: "nebulosa", mascara: true })` satura a través de una máscara de luminancia (0 en el cielo, 1 en lo brillante) y prueba 0,63 → 0,88. Úsalo cuando el usuario pida más color o cuando la versión sin máscara pare por «fondo teñido»; siempre sobre la misma entrada, no sobre la ya saturada.

```json
{"llamadas": [
  {"funcion": "saturarAlFallo", "parametros": {"vista": "Starless_st", "opciones": {"tipo": "nebulosa", "nuevaVista": "Starless_sat"}}}
]}
```

En galaxia, 0,63–0,70. Devuelve las pruebas, el punto medio elegido, por qué paró, `no_cumple` y el control.

**Realces de los scripts BackgroundEnhance y DarkStructureEnhance** (`herramientas/realces.js`, también como herramientas del MCP; mismo resultado que los scripts)

- **`backgroundEnhance`** (BackgroundEnhance). Cuándo: sobre la starless, antes de LHE y del NXT final, con nebulosidad débil extensa, IFN, polvo o colas de nebulosa apagadas **y señal confirmada** (Paso 1 lineal, Anexo D). Por qué: suma la gran escala de la imagen a través de una máscara invertida de luminancia; levanta lo débil y extenso sin quemar lo brillante ni realzar el ruido fino. Cómo: `backgroundEnhance("SL_v2", { amount: 0.3 })` en una copia; subir `amount` (0,5 en el script) mientras sólo suba la nebulosidad; `maskAmount` (0,6) más alto protege más lo brillante. No usar si el fondo es sólo ruido o queda gradiente residual: lo amplifica.
- **`darkStructureEnhance`** (DarkStructureEnhance). Cuándo: sobre la starless (con estrellas crea anillos oscuros), en nebulosas oscuras, bandas de polvo de galaxias o filamentos oscuros sobre emisión, con buena SNR. Por qué: oscurece sólo lo que es más oscuro que su entorno de gran escala, sin tocar el resto. Cómo: primero `darkStructureEnhance("SL_v3", { keepMask: true })` y mirar la máscara: si sigue estructuras reales, vale; si es ruido moteado o rodea bordes brillantes (lo que pasó en una nebulosa de emisión y reflexión, ver abajo), deshacer y usar LHE con máscara. `median` 0,6–0,7 (0,5 no cambia nada; más alto oscurece más), `iterations` 1, `layers` 8 (6 para estructuras menores).

**Contraste local (LHE)**

- **Comparar en una llamada** (`contrasteCandidatos("Starless_st")`, `herramientas/realces.js`): sobre copias, LHE radio 64 (pendiente 1,5, amount 0,35) y radio 128 (pendiente 2,0, amount 0,35), HDRMT de 6 capas sobre la luminosidad mezclado al 50 % y DarkStructureEnhance (median 0,7). Mide en todos el contraste local (rango p10–p90 en celdas de 64 px con señal), el ruido y el nivel del cielo y los píxeles quemados. Gana el que más sube el contraste sin subir el ruido del cielo más de un 25 % (`ruidoMax`), sin mover el cielo más de 0,03 ni quemar; si ninguno cumple, recomienda no tocar la imagen. En IC 63 sin calibrar (8 nov 2026) ganó LHE radio 64 (contraste ×1,15, ruido ×1,18); el radio 128 subía el ruido ×1,35 y HDRMT bajaba el cielo de 0,10 a 0,07. Las recetas de abajo valen como candidatos a mano (`lhe: [{ radius, slopeLimit, amount }]`).

- Receta de la v4B que gustó: "LocalHistogramEqualization **radio 256, amount 0,35, slopeLimit 2,0** sobre la capa sin estrellas no lineal, con máscara de fondo `1 − clip((L64 − 0,20)/0,25)`, seguida de **NXT 0,75** bajo esa misma máscara y **NXT 0,30** global."
- "**No usar un mapa de 'estructuras oscuras' por diferencia de escalas** (`max(L_suave − L, 0)`): en una nebulosa de emisión y reflexión salía dominado por ruido moteado y creaba bordes oscuros alrededor de los bordes brillantes del fantasma." Con `darkStructureEnhance` es la misma técnica: vale sólo si su máscara sigue estructuras reales.
- "El LHE de radio pequeño (96, amount 0,25, máscara L² sólo en lo brillante) es el complemento para el detalle del fantasma (v4A)."
- Límites prácticos (aescaffre): "LHE amount > 0,5 ya parece artificial; slopeLimit ~1,5–1,8 (≥2,0 artefactos); una sola pasada de LHE suele bastar; LHE + HDRMT juntos dan aspecto 'diseñado': usar uno u otro."
- Radios: "Radio de LHE de NOVA: ~1/12 del lado corto de la imagen (32–128 px), amount 0,5, slope 1,5 en nebulosas y 2,0–2,5 en galaxias". Galaxias aescaffre: "LHE radio 64, amount 0,25 (de canto) a 0,35 (de cara), slopeLimit 1,3–1,5".
- "Radios de LHE pequeños crean anillos oscuros alrededor de estrellas: aplicar siempre sobre la starless o con máscara de estrellas. HDRMT con 'median transform' activado evita anillos oscuros en campos ricos en estrellas."

**A mano en PixInsight (valores de referencia)**

- LocalHistogramEqualization sobre la starless, con la máscara de fondo de la receta v4B ya aplicada.
- `radius` 256 (96 para detalle fino; ~1/12 del lado corto en NOVA); `amount` 0,35 (> 0,5 parece artificial); `slopeLimit` 2,0 (1,3–1,8 recomendado por aescaffre; ≥ 2,0 da artefactos).

Para las curvas, `CurvesTransformation`: cada curva es una lista de pares `[x, y]` en `R`, `G`, `B`, `K` (RGB/K, todos los canales), `A` (alfa), `L`, `a`, `b`, `c` (CIE L*a*b* y croma), `H` (tono) y `S` (saturación), con su interpolación en `Rt`, `Gt`, `Bt`, `Kt`… (`CurvesTransformation.AkimaSubsplines` en v8). Comprobado en PixInsight 1.9.6.

- CurvesTransformation en K para levantar sombras: (0, 0,04), (0,04, 0,12), (0,10, 0,16), (0,20, 0,24), (0,50, 0,50), (1, 1), interpolación Akima.

**Control.** 100 % y en negativo (imagen invertida): bandas de color, anillos alrededor de estrellas, ruido moteado, bordes de máscara. Porcentaje de píxeles > 0,98 antes y después. Textura en altas luces: "conservar ≥ 60 %; < 40 % = textura aplastada". "Señales de sobreprocesado: aspecto 'diseñado' en vez de 'observado', transiciones nebulosa–fondo demasiado limpias, bordes 'ilustrados', pérdida de grano en zonas débiles → bajar LHE, quitar HDRMT, curvas más suaves."
