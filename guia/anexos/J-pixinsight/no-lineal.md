# Anexo J (PixInsight): fase no lineal

[← Anexo J](../J-pixinsight.md) · [← Índice](../../SKILL.md)

<a id="no-lineal-01"></a>
### Fase no lineal · Paso 1: Estirado (starless y estrellas por separado)

Ficha: [no-lineal/01-estirado.md](../../no-lineal/01-estirado.md)

**Las dos capas en una llamada** (`herramientas/estirado.js`), sobre copias: starless al fallo (o a una mediana fija con `modo: "fondo"`) y estrellas con **arcsinh que conserva el color** (k 3000 por defecto, con el p90 que daría cada k), o con **`estrellas: "extraer"`** (el mismo estirado que la starless, ver abajo; es lo que pone `tipo: "galaxia"`). Devuelve las pasadas, qué falló, las medidas, la **meseta del núcleo** y el control (lo visual, aparte). Recomendado para cualquier modelo. Sueltas: `estirarStarless(vista, {cielo})` y `estirarEstrellas(vista, {k})`. `starStretch` sólo si se pide (`metodoEstrellas: "starstretch"` o pasando `amount`): pierde las estrellas débiles. **Si no se sabe qué tipo de objeto es** (sin OBJECT y con un nombre de fichero genérico), preguntarlo antes de estirar.


**Estrellas con el mismo estirado (`estrellas: "extraer"`).** Suma starless lineal + estrellas lineales (SXT lineal es una suma exacta), le repite exactamente las pasadas de GHS y los puntos negros de la starless y separa con `screenStarsExtract`. Las estrellas quedan con el brillo que tendrían en la imagen entera. Comparación galaxia grande (7 nov 2026): con `starStretch` amount 2 la final se quedó con 269 estrellas detectables (0,19 % de píxeles con aporte); con este método (Opus v7), 13 721. Si no se puede (modo `fondo`, falta `realces.js`), cae a `starStretch` y lo dice en `aviso`.

**Comparar métodos** (`estirarCandidatos(starless, { cielo })`, mismo fichero): prueba sobre copias GHS al fallo, MultiscaleAdaptiveStretch (sin su saturación, que va después) y ArcsinhStretch (factor por bisección y punto negro bajo el cielo del canal más bajo), y los lleva todos al mismo cielo para comparar en igualdad. Gana, entre los que no fallan (ruido del cielo, recortes, dominante), el que más separa la señal débil del fondo: `senal_debil_en_ruidos` = (p90 − cielo) / ruido del cielo. La tabla va en `comparados`; con `cerrar: false` se conservan todos para mirarlos. La capa de estrellas va aparte (`estirarEstrellas`).

```json
{"llamadas": [
  {"funcion": "estirarCandidatos", "parametros": {"vista": "Starless", "opciones": {"cielo": 0.1, "nuevaVista": "Starless_st"}}}
]}
```

Opciones: `metodos` ("ghs", "mas", "arcsinh"), `mas`.

```json
{"llamadas": [
  {"funcion": "estirarCapas", "parametros": {"starless": "Starless", "estrellas": "Stars", "opciones": {"cielo": 0.1, "nuevaStarless": "Starless_st_v1", "nuevasEstrellas": "Stars_st_v1"}}}
]}
```

Galaxia: `{"tipo": "galaxia", "nuevaStarless": …, "nuevasEstrellas": …}` (cielo 0,07, `ruidoMax` 0,12, estrellas "extraer", saturación 1,3); nebulosa oscura: `tipo: "nebulosa_oscura"` (cielo 0,12); lo que se pase explícito manda. Modo antiguo a mediana fija: `modo: "fondo"`. Devuelve `{ starless: {pasadas, parada, medidas, dominante, control}, estrellas: {amount, p90, control} }`. Si `meseta_nucleo.radio_px` > 3, el siguiente paso es `comprimirNucleo` (Paso 5).

**Nombres de PixInsight.** Visualización automática = STF (las funciones de `estirado.js` lo quitan de la vista de entrada). `stretch_image` con "stf" aplica un autoestirado real y se niega si la imagen ya no es lineal. Transformación de histograma = HistogramTransformation. GHS = GeneralizedHyperbolicStretch, tipo hiperbólico generalizado, canal RGB, modo color "Col": D (`stretchFactor`) 2,5; b (`localIntensity`) 12; SP (`symmetryPoint`) = mediana previa; LP 0; HP 0,95. Arcsinh = ArcsinhStretch.

**MAS (MultiscaleAdaptiveStretch).** Parámetros (por defecto): `targetBackground` (0,15), `aggressiveness` (0,70), `dynamicRangeCompression` (0,40), `contrastRecovery` (true), `scaleSeparation` (1024), `contrastRecoveryIntensity` (1,0), `saturationEnabled` (true), `saturationAmount` (0,75), `backgroundROIEnabled` y `backgroundROIX0/Y0/Width/Height`. Valores de referencia: `targetBackground` 0,15; `aggressiveness` 0,6; `contrastRecoveryIntensity` 0,5; saturación desactivada en Hα o capas que se combinarán después. DRC no sustituye a HDRMT.

**`starStretch`** (Star Stretch de SetiAstro, mismo resultado que el script): `starStretch("Stars_v1", { amount: 2, saturation: 1, removeGreen: false })` sobre una copia, sólo si se pide (`metodoEstrellas: "starstretch"` o pasando `amount`). Alternativa: ArcsinhStretch.

<a id="no-lineal-02"></a>
### Fase no lineal · Paso 2: LRGB / Paleta

Ficha: [no-lineal/02-lrgb-paleta.md](../../no-lineal/02-lrgb-paleta.md)

**A mano en PixInsight (valores de referencia)**

- HOO clásico (Blend Soft 60/40) con PixelMath en una imagen RGB nueva: R = Ha, G = 0,6·Ha + 0,4·OIII, B = OIII, con las dos capas estiradas con el MISMO estirado.
- Variante: NarrowbandNormalization sobre la HOO, paleta HOO, lightness desactivada, shadowpoint 1. Parámetros del proceso: `palette` (`Palette_SHO/HOO/HSO/HOS`), `lightness` (`Lightness_Off/Preserve/Ha/OIII/SII`), `blendMode` (`Blend_Mode1..3`), `haBlend`, `scnr`, `o3Boost`, `s2Boost`, `shadowpoint`, `highlightReduction`, `brightness`. Comprobados en PixInsight 1.9.6; en v8 las constantes van en el constructor (`NarrowbandNormalization.Palette_HOO`).
- LRGB: LinearFit de L a la luminancia de la RGB y LRGBCombination (R, G y B desactivados y la L en su casilla). Estirados comparables con MAS.
- Previas a mano: reducir con IntegerResample (Average) y PixelMath con símbolos, comprobando el valor devuelto. Plancha: copiar cada preview en su casilla de una ImageWindow grande con `setSamples`; si los rótulos con Bitmap/Graphics fallan, numerar las casillas.
- Foraxx: copiadas de las funciones `foraxSHO`…`foraxSOH` de AutoPalette Studio v1.2.0 (fuente "DBXtract / Mono" para dual band, nunca "OSC Dualband"). En SHO sin equilibrar `quitarVerde` no corrige el verde porque mira sólo el cielo: lo hace `componerPaleta`.

**Previews en una llamada** (`herramientas/bandaestrecha.js`): `previsualizarPaletas(ha, oiii, { carpeta })` genera a ~1200 px Classic HOO Soft y Hard, Foraxx Classic bicolor y HOO con límite al OIII (NOVA) desde capas ya estiradas con el mismo estirado, y las guarda como JPG para enseñarlas y preguntar.

```json
{"llamadas": [
  {"funcion": "previsualizarPaletas", "parametros": {"ha": "Ha_st", "oiii": "OIII_st", "opciones": {"carpeta": "<versión>/prev/paletas"}}}
]}
```


- Con la elegida: aplicar la misma fórmula con PixelMath a resolución completa. **En una llamada** (`herramientas/bandaestrecha.js`): `componerPaleta({ S, H, O }, { paleta: "SHO", estrellas })`. Devuelve la paleta **sin estrellas** (la `estrellas` sólo se anota para el final): después `saturarAlFallo(paleta)`, `prepararEstrellas(capa de estrellas RGB estirada)` (nunca sobre la paleta: da error) y `recombinarEstrellas(paleta saturada, estrellas preparadas)`. Si G domina (la raya del verde, casi siempre Hα, manda) aplica SCNR Average Neutral 0,8 y da G/max(R,B) antes y después; `verde: 1` lo apura, `verde: false` lo deja. Paletas: SHO, HSO, OHS, HOS, SOH, OSH, HOO (Soft/Neutral/Hard), HOO_NOVA, FORAXX, FORAXX_BICOLOR, las siete familias Foraxx de AutoPalette Studio (FORAXX_SHO, _HOS, _OHS, _HOO, _HSO, _OSH, _SOH) y sus 42 variantes FORAXX_<familia>_<variante>, copiadas del script instalado (`paletasDisponibles()`); sin SII real las de S usan el SII sintético y salen marcadas pseudo. Antes, para cada raya desmezclada (mono): `separarEstrellas` y `estirarStarless(starless, { cielo: 0.10 })`; la RGB, con SPCC, da las estrellas (`estirarCapas(starless RGB, estrellas RGB)` y su `r.estrellas.vista`). Si el usuario ya ha dicho la paleta, no hacen falta previas.

<a id="no-lineal-03"></a>
### Fase no lineal · Paso 3: SCNR

Ficha: [no-lineal/03-scnr.md](../../no-lineal/03-scnr.md)

**A mano en PixInsight (valores de referencia)**

- SCNR: amount 0,65 (aescaffre; «nosotros preferimos suave»); verde y Average Neutral por defecto. Jon Rista: 0,7 habitual (0,2–0,95); Maximum Neutral sólo a 1,0, Minimum Neutral ≤ 0,5; Maximum Mask y Additive Mask llevan a magenta (0,01–0,05). Comprobar en el histograma de HistogramTransformation que el final del verde queda alineado con el segundo canal. Sobre la starless o con máscara de estrellas (vacía el amarillo de las estrellas).
- Alternativa quirúrgica sin tocar el OIII real, en una imagen nueva: `iif(min(R,B) > G, min(R,B), G)`.

**En una llamada** (`herramientas/lineal.js`): `quitarVerde(vista, { amount: 0.85 })` sólo actúa si el verde del cielo supera en más de un 3 % a R **y** a B (con el azul también alto, G/R engaña: en una nebulosa dual band el cielo era azulado y no había verde que quitar). Aplica la fórmula de arriba bajo una máscara de cielo (rampa de 1,5σ a 5σ) y comprueba que el color del objeto no cambia. Si no hace falta, no aplica nada y lo dice.

```json
{"llamadas": [
  {"funcion": "quitarVerde", "parametros": {"vista": "Starless_st", "opciones": {"nuevaVista": "Starless_sinverde"}}}
]}
```

<a id="no-lineal-04"></a>
### Fase no lineal · Paso 4: Máscaras

Ficha: [no-lineal/04-mascaras.md](../../no-lineal/04-mascaras.md)

**A mano en PixInsight (valores de referencia)**

- Máscara de luminancia en una imagen nueva: `exp(g·ln(max($T, 1e-5)))` con g = 2,0 para LHE (1,5 para HDRMT).
- Máscara de estrellas desde la capa de estrellas (mejor que StarMask con estrellas grandes): PixelMath en una imagen nueva gris `min(1, CIEL(Stars)/u)` con u ≈ 0,05–0,10 (o `iif(CIEL(Stars) > u, 1, 0)` para binarizar), luego MorphologicalTransformation Dilation 3–5 px y Convolution (gauss 2–4 px) para cubrir halos. Máscara de nebulosa: `max(0, CIEL(Starless) − cielo) − MascaraEstrellas`, reescalada y suavizada; control con la máscara mostrada en rojo.
- Máscara de estrellas con StarMask: "Subir Noise threshold para no coger ruido, subir Scale para incluir estrellas grandes, subir Midtones y bajar algo Truncation para proteger centros grandes, subir Smoothness para cubrir halos de forma uniforme." Mapa de estructuras con estrellas agrandadas por MorphologicalTransformation y suavizadas quitando capas 1–3 con MultiscaleLinearTransform. La máscara de fondo para contraste local es `fondo_lhe`.

**En una llamada** (`herramientas/mascaras.js`): `crearMascara(vista, { tipo })` con `tipo` `luminancia` (gamma 2,0 LHE / 1,5 HDRMT), `cielo` (rampa 1,5σ–5σ, suavizada) o `fondo_lhe` (receta v4B). Devuelve la vista de la máscara, su cobertura y la media en el cielo y en lo brillante, y cómo aplicarla.

```json
{"llamadas": [
  {"funcion": "crearMascara", "parametros": {"vista": "Starless_st", "opciones": {"tipo": "fondo_lhe"}}}
]}
```

Con `normalizar: true` (sólo `tipo: "luminancia"`), la luminancia se lleva a 0–1 (Rescale mín–máx) antes de la gamma: en imágenes con poco rango la máscara sí separa lo brillante. Si `crearMascara` avisa de que apenas distingue cielo y brillante, repetir con `normalizar` o pasar a `fondo_lhe`.

**Aplicar con la máscara medida** (`herramientas/mascaras.js`): `aplicarConMascara(vista, { mascara, operacion, fuerza, invertir, objetivo })` aplica la operación a una copia oculta sin máscara y la mezcla con PixelMath en otra copia (`<vista>_m`): `$T·(1 − k·m) + procesado·k·m`. Es lo mismo que poner la máscara en la ventana y ejecutar el proceso, pero sin dejarla puesta o invertida y con medidas. Operaciones: `{ tipo: "curvas", K: [[x, y], …] }` (CurvesTransformation en K), `{ tipo: "saturacion", factor }` (PixelMath alrededor de la luminancia) y `{ tipo: "lhe", radio, amount, slope }` (LocalHistogramEqualization). `mascara` es el id de una vista gris del mismo tamaño (la de `crearMascara`); `fuerza` 0–1 (def. 1); `invertir` usa 1 − m; `objetivo` `"fondo"` o `"brillante"` activa el aviso de máscara invertida.

```json
{"llamadas": [
  {"funcion": "crearMascara", "parametros": {"vista": "Starless_st", "opciones": {"tipo": "fondo_lhe"}}},
  {"funcion": "aplicarConMascara", "parametros": {"vista": "Starless_st", "opciones": {"mascara": "<id de la máscara devuelta>", "objetivo": "fondo", "operacion": {"tipo": "lhe", "radio": 128, "amount": 0.3}}}}
]}
```

Devuelve la vista nueva, la fórmula, `medidas.mascara` (`media_en_cielo`, `media_en_lo_brillante`, `cobertura_pct`, `transicion_pct`, `salto_p99_por_px`), `medidas.efecto` (`cambio_medio_zona_m_alta`, `fuga_media_zona_m_baja`, `fuga_p99`, `fuga_rel_pct` y el % de píxeles de cada zona), `no_cumple` con los avisos de la ficha y el control a ojo (bordes al 100 %, `previa` con el mismo recorte que la original).

<a id="no-lineal-05"></a>
### Fase no lineal · Paso 5: Boost (curvas, contraste, saturación)

Ficha: [no-lineal/05-boost.md](../../no-lineal/05-boost.md)

**Saturación al fallo en una llamada** (`herramientas/boost.js`): `saturarAlFallo("Starless_st", { tipo: "nebulosa" })` prueba 0,58 → 0,78 sobre copias y se queda la última sin fallo medido (canales > 0,98, fondo teñido: dominante del cielo > 8 % o +4 puntos, ruido de color del cielo × 1,5). Si ni la primera pasa, no satura. Pruebas de nov 2026: galaxia grande → 0,63 (para por ruido de color); nebulosa dual band → no satura (dominante azul del cielo sin resolver). Los umbrales de tinte son provisionales.

```json
{"llamadas": [
  {"funcion": "saturarAlFallo", "parametros": {"vista": "Starless_st", "opciones": {"tipo": "nebulosa", "nuevaVista": "Starless_sat"}}}
]}
```

Más color sin teñir el cielo: `saturarAlFallo(vista, { tipo: "nebulosa", mascara: true })` satura a través de una máscara de luminancia y prueba 0,63 → 0,88. Devuelve las pruebas, el punto medio elegido, por qué paró, `no_cumple` y el control.

```json
{"llamadas": [
  {"funcion": "comprimirNucleo", "parametros": {"vista": "Starless_st", "opciones": {"nuevaVista": "Starless_nucleo"}}}
]}
```

Por defecto: capas 7, mezcla 0,6, mascaraDesde 0,35. Devuelve meseta antes y después, brillo del bulbo, anillos nuevos, `no_cumple` y el control.

```json
{"llamadas": [
  {"funcion": "nucleoCandidatos", "parametros": {"vista": "Starless_st", "opciones": {"nuevaVista": "Starless_nucleo"}}}
]}
```

Opciones de `nucleoCandidatos`: `exponentes` ([0.6, 0.4]), `mascaraDesde`, `cerrar`. La tabla está en `comparados`.

**Nombres de PixInsight.** Contraste local por ecualización adaptativa = LocalHistogramEqualization (LHE; `radius`, `amount`, `slopeLimit`); compresión multiescala = HDRMultiscaleTransform (HDRMT, con 'median transform' para campos ricos en estrellas); compresión por gradiente = GradientHDRCompression; realces del fondo débil y de estructuras oscuras = BackgroundEnhance y DarkStructureEnhance (DSE). La máscara de fondo para contraste local es `crearMascara(..., { tipo: "fondo_lhe" })`.

**A mano en PixInsight (valores de referencia)**

- LocalHistogramEqualization sobre la starless, con la máscara de fondo de la receta v4B ya aplicada.
- `radius` 256 (96 para detalle fino; ~1/12 del lado corto en NOVA); `amount` 0,35 (> 0,5 parece artificial); `slopeLimit` 2,0 (1,3–1,8 recomendado por aescaffre; ≥ 2,0 da artefactos).

Para las curvas, `CurvesTransformation`: cada curva es una lista de pares `[x, y]` en `R`, `G`, `B`, `K` (RGB/K, todos los canales), `A` (alfa), `L`, `a`, `b`, `c` (CIE L*a*b* y croma), `H` (tono) y `S` (saturación), con su interpolación en `Rt`, `Gt`, `Bt`, `Kt`… (`CurvesTransformation.AkimaSubsplines` en v8). Comprobado en PixInsight 1.9.6.

- CurvesTransformation en K para levantar sombras: (0, 0,04), (0,04, 0,12), (0,10, 0,16), (0,20, 0,24), (0,50, 0,50), (1, 1), interpolación Akima.


**Núcleo de galaxias, antes de saturar** (`herramientas/nucleo.js`). Si el estirado da `meseta_nucleo.radio_px` > 3 (o el núcleo se ve plano), `comprimirNucleo("Starless_st", { nuevaVista: "Starless_nucleo" })` aplica HDRMultiscaleTransform de 7 capas y lo mezcla al 60 % sólo dentro de una máscara de bulbo (luminancia de gran escala > 0,35, rampa de 0,25). Mide la meseta antes y después, anillos oscuros nuevos en el perfil radial y cuánto brillo pierde el bulbo. Receta de Opus en una galaxia grande: HDRMT a pleno o LHE de radio 200 sobre el bulbo dieron anillo oscuro y bulbo plano. Sin este paso (galaxia grande con Qwen, 7 nov 2026) el núcleo y la galaxia satélite quedaron como una meseta de 22 px; con él, 1 px. `medirMeseta(vista)` sólo mide. El LHE del disco, si se usa, va después y con máscara galaxia × (1 − bulbo): no es "LHE + HDRMT juntos" porque no tocan la misma zona.

**Comparar HDRMT con GradientHDRCompression** (`nucleoCandidatos`, mismo fichero): aplica los dos con la misma máscara de bulbo y la misma mezcla (`comprimirNucleo` con `metodo: "hdrmt"` y `metodo: "ghc"`, exponente del gradiente 0,6; < 1 comprime) y se queda con el que deja menos meseta sin anillos nuevos ni bulbo plano. En una prueba de 8 nov 2026 GradientHDRCompression bajó la meseta de 6,4 a 0,6 px sin anillo y HDRMT dejó 7,7 px con un anillo oscuro (una sola imagen: las medidas deciden en cada caso).

**Realces de los scripts BackgroundEnhance y DarkStructureEnhance** (`herramientas/realces.js`, también como herramientas del MCP; mismo resultado que los scripts)

- *Cómo: `backgroundEnhance("SL_v2", { amount: 0.3 })` en una copia; subir `amount` (0,5 en el script) mientras sólo suba la nebulosidad; `maskAmount` (0,6) más alto protege más lo brillante. No usar si el fondo es sólo ruido o queda gradiente residual: lo amplifica.

- *Cómo: primero `darkStructureEnhance("SL_v3", { keepMask: true })` y mirar la máscara: si sigue estructuras reales, vale; si es ruido moteado o rodea bordes brillantes (lo que pasó en una nebulosa de emisión y reflexión, ver abajo), deshacer y usar LHE con máscara. `median` 0,6–0,7 (0,5 no cambia nada; más alto oscurece más), `iterations` 1, `layers` 8 (6 para estructuras menores).

- **Comparar en una llamada** (`contrasteCandidatos("Starless_st")`, `herramientas/realces.js`): sobre copias, LHE radio 64 (pendiente 1,5, amount 0,35) y radio 128 (pendiente 2,0, amount 0,35), HDRMT de 6 capas sobre la luminosidad mezclado al 50 % y DarkStructureEnhance (median 0,7). Mide en todos el contraste local (rango p10–p90 en celdas de 64 px con señal), el ruido y el nivel del cielo y los píxeles quemados. Gana el que más sube el contraste sin subir el ruido del cielo más de un 25 % (`ruidoMax`), sin mover el cielo más de 0,03 ni quemar; si ninguno cumple, recomienda no tocar la imagen. En una nebulosa de emisión y reflexión sin calibrar (8 nov 2026) ganó LHE radio 64 (contraste ×1,15, ruido ×1,18); el radio 128 subía el ruido ×1,35 y HDRMT bajaba el cielo de 0,10 a 0,07. Las recetas de abajo valen como candidatos a mano (`lhe: [{ radius, slopeLimit, amount }]`).

<a id="no-lineal-06"></a>
### Fase no lineal · Paso 6: NoiseX

Ficha: [no-lineal/06-noisex.md](../../no-lineal/06-noisex.md)

**A mano en PixInsight (valores de referencia)**

- NoiseXTerminator: `denoise` 0,30 (pasada final suave), `detail` 0,15, `iterations` 2.

**En una llamada** (`herramientas/ruido.js`): `reducirRuido("Starless", { denoise: 0.30, detail: 0.15, nuevaVista: "Starless_nxt" })` (con `croma: 0.90, denoise: 0.40` para la separación de color) aplica NXT sobre una copia y mide σ del cielo, contraste de la zona débil y estructura de la residual. Recomendado para modelos sin herramientas. Mejor aún, `ruidoCandidatos("Starless")`: sobre una imagen estirada compara NXT 0,15 / 0,30 / 0,45, MLDenoise y MultiscaleTGVDenoise 0,25 / 0,5 (en modo general, sin el de cielo profundo) y se queda con el mejor que cumpla (ver [Paso 14 lineal](../../lineal/14-noisex-suave.md)).

<a id="no-lineal-08"></a>
### Fase no lineal · Paso 8: Procesado de estrellas

Ficha: [no-lineal/08-estrellas.md](../../no-lineal/08-estrellas.md)

**Preparación en una llamada** (`herramientas/estrellas.js`): sobre una copia de la capa ya estirada hace la limpieza de residuos, el suelo por canal (reescalando), la curva de saturación y comprime las luces por encima de 0,80 hasta 0,97 (núcleos neutros, sin recorte brusco); opcionales `halosMagenta: true` y `atenuar: 0.35`. Devuelve las medidas antes y después y el control. Recomendado para modelos sin herramientas; el p90 depende del estirado del Paso 1.

```json
{"llamadas": [
  {"funcion": "prepararEstrellas", "parametros": {"vista": "Stars_st", "opciones": {"nuevaVista": "Stars_v1"}}}
]}
```

Devuelve los pasos, antes y después por canal (mediana, MAD, máximo, pix_098, p90_estrellas) y el control. Si la limpieza se llevaría más del 10 % del brillo, `prepararEstrellas` no limpia y lo dice en `no_cumple`.

**A mano en PixInsight (valores de referencia)**

- Limpieza de residuos: `iif($T < 0.005, 0, $T)`; atenuar: `iif($T > 0.02, $T*0.65, $T)`; halos magenta: `G = iif(min(R,B) > G, min(R,B), G)`. Nunca MorphologicalTransformation para contener estrellas (anillos).
- Capa con el mismo estirado: `estrellas: "extraer"` en el Paso 1; si no, `starStretch`. Nunca STF auto-stretch en la capa.
- Extracción en no lineal: SXT con `unscreen=true` sobre el clon estirado.
- Reducción de estrellas sin erosión (astroimagetw), PixelMath sobre la imagen con estrellas `O` y su starless `S` del mismo estirado: `~((~mtf(k, O) / ~mtf(k, S)) * ~S)`, con k ≈ 0,75 (en PixInsight `mtf` oscurece con k > 0,5: más cerca de 0,5 reduce menos; más alto, más). Si `mtf(k, x)` no existe en la versión de PixelMath, aplicar antes a copias de O y S la misma HistogramTransformation con medios desplazados a la derecha. Como mucho dos pasadas; medir FWHM o `pix_estrella_pct` antes y después.
- Lineal: separar sin `unscreen` y recombinar sumando; no lineal: `unscreen` y recombinar con `~(~starless * ~stars)`.
- **`screenStarsExtract`** (ScreenStars, mismo resultado que el script): `screenStarsExtract("Original_st", "Starless_st")` crea la capa nueva, inversa exacta de `screenStarsCombine`; mismo `method` que al recombinar.

<a id="no-lineal-09"></a>
### Fase no lineal · Paso 9: Recombinación

Ficha: [no-lineal/09-recombinacion.md](../../no-lineal/09-recombinacion.md)

**A mano en PixInsight (valores de referencia)**

- Screen con fuerza k en una imagen nueva: `~(~$T · ~(k·Stars))`, equivalente a 1 − (1 − N)(1 − k·S), con k = 0,55 y `Stars` la capa de estrellas ya estirada.

**Recombinación en una llamada** (`herramientas/recombinacion.js`): combina con `screenStarsCombine` (o screen con `k` si se pide `metodo: "screen"`), sin tocar las entradas, y mide que el fondo no baje ni suba, el recorte nuevo y lo que aportan las estrellas; con `original` mide también el residuo. Recomendado para modelos sin herramientas.

```json
{"llamadas": [
  {"funcion": "recombinarEstrellas", "parametros": {"starless": "Starless_st", "estrellas": "Stars_v1", "opciones": {"nuevaVista": "Final_v1"}}}
]}
```

Screen con k: `{"metodo": "screen", "k": 0.55}`. Devuelve el método, fondo, recorte, aporte de las estrellas (y en %), `no_cumple` y el control (medido y revisar a ojo).


- **ScreenStars** (`realces.js`, herramienta MCP): `screenStarsCombine("Starless", "Stars", { newId: "Final" })` crea la imagen recombinada con screen (`method: "add"` para suma). Si la starless está estirada (mediana > 0,005), lleva las dos capas a casi lineal con una MTF, combina ahí y vuelve a estirar con la inversa (`reverseStretch: false` lo desactiva): las estrellas se integran mejor que con el screen directo. Es la opción por defecto; `method: "add"` sólo con capas lineales, y el PixelMath de abajo para dosificar las estrellas con fuerza `k`. Control: el fondo de la imagen recombinada nunca baja respecto a la starless.

<a id="no-lineal-10"></a>
### Fase no lineal · Paso 10: Recorte y exportación

Ficha: [no-lineal/10-recorte-exportacion.md](../../no-lineal/10-recorte-exportacion.md)

**A mano en PixInsight (valores de referencia)**

- ICCProfileTransformation a «sRGB IEC61966-2.1» y guardado del XISF en la carpeta real de la versión.
- `saveAs` no guarda el historial en el XISF: anotar los parámetros en el dossier.
- Desde PixInsight 1.9.6, Crop, DynamicCrop (también girado), Resample y FastRotation **conservan la astrometría** y la ajustan al nuevo marco. Comprobado (nebulosa dual band, nov 2026): tras Crop + Resample 0,5 + DynamicCrop de 10°, una nueva resolución coincide con la heredada a 0,05 px; tras FastRotation 180°, igual que el original. Con 1.9.5 o anterior se perdía y `FastRotation` sobre una ventana con astrometría llegó a colgar PixInsight: girar con PixelMath `pixel($T, w()-1-x(), h()-1-y())`.

**En una llamada** (`herramientas/exportar.js`): `exportarFinal("Final", { carpeta, nombre, girar180 })` comprueba saturados y bordes negros, guarda el XISF 32 bits con astrometría y, sobre una copia en sRGB (y girada 180° con FastRotation si se pide), el TIFF 16 bits y el JPG. Crea la carpeta antes de guardar y no sobrescribe (añade _2). Recomendado para modelos sin herramientas.

```json
{"llamadas": [
  {"funcion": "exportarFinal", "parametros": {"vista": "Final", "opciones": {"carpeta": "<carpeta de la versión>/final", "nombre": "<objeto>_v1", "girar180": false}}}
]}
```

Devuelve los ficheros (con su tamaño), los controles y `no_cumple`.

<a id="no-lineal-11"></a>
### Fase no lineal · Paso 11: Dossier

Ficha: [no-lineal/11-dossier.md](../../no-lineal/11-dossier.md)

**Volcado del historial**

```json
{"llamadas": [
  {"funcion": "historial", "parametros": {"vista": "Final"}}
]}
```

Devuelve los pasos de `view.processing` (un contenedor, no un array) con los parámetros de cada uno (con `parametros: true` si hacen falta los valores).

**Con el MCP piastropilot** (Claude, Codex): las funciones de la guía trabajan sobre copias, así que el historial de la vista final sólo tiene lo aplicado sobre ella; el resto sale del resultado de cada función. Para la revisión crítica, `previa(vista)` da el JPG entero y `previa(vista, { rect: [x0, y0, x1, y1] })` recortes al 100 %.

El historial mínimo, con nombres de PixInsight: calibración/integración (del master), corrección de gradiente, BXT CO, SPCC, BXT, SXT, NXT, GHS/MAS, LHE, SCNR, recombinación.
