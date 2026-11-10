# Anexo J (PixInsight): fase no lineal

[← Anexo J](../J-pixinsight.md) · [← Índice](../../SKILL.md)

<a id="no-lineal-01"></a>
### Fase no lineal · Paso 1: Estirado (starless y estrellas por separado)

Ficha: [no-lineal/01-estirado.md](../../no-lineal/01-estirado.md)

**Las dos capas en una llamada** (`herramientas/estirado.js`), sobre copias: starless al fallo (o a una mediana fija con `modo: "fondo"`) y estrellas con **arcsinh que conserva el color** (k 3000 por defecto, con el p90 que daría cada k), o con **`estrellas: "extraer"`** (el mismo estirado que la starless, ver abajo; es lo que pone `tipo: "galaxia"`). Devuelve las pasadas, qué falló, las medidas, la **meseta del núcleo** y el control (lo visual, aparte). Recomendado para cualquier modelo. Sueltas: `estirarStarless(vista, {cielo})` y `estirarEstrellas(vista, {k})`. `starStretch` sólo si se pide (`metodoEstrellas: "starstretch"` o pasando `amount`): pierde las estrellas débiles. **Si no se sabe qué tipo de objeto es** (sin OBJECT y con un nombre de fichero genérico), preguntarlo antes de estirar.


**Estrellas con el mismo estirado (`estrellas: "extraer"`).** Suma starless lineal + estrellas lineales (SXT lineal es una suma exacta), le repite exactamente las pasadas de GHS y los puntos negros de la starless y separa con `screenStarsExtract`. Las estrellas quedan con el brillo que tendrían en la imagen entera. Comparación galaxia grande (7 nov 2026): con `starStretch` amount 2 la final se quedó con 269 estrellas detectables (0,19 % de píxeles con aporte); con este método (Opus v7), 13 721. Si no se puede (modo `fondo`, falta `realces.js`), cae a `starStretch` y lo dice en `aviso`.

**Comparar métodos** (`estirarCandidatos(starless, { cielo })`, mismo fichero): prueba sobre copias GHS al fallo, MultiscaleAdaptiveStretch (sin su saturación, que va después) y ArcsinhStretch (factor por bisección y punto negro bajo el cielo del canal más bajo), y los lleva todos al mismo cielo para comparar en igualdad. Gana, entre los que no fallan (ruido del cielo, recortes, dominante), el que más separa la señal débil del fondo: `senal_debil_en_ruidos` = (p90 − cielo) / ruido del cielo. La tabla va en `comparados`; con `cerrar: false` se conservan todos para mirarlos. La capa de estrellas va aparte (`estirarEstrellas`).

<a id="no-lineal-02"></a>
### Fase no lineal · Paso 2: LRGB / Paleta

Ficha: [no-lineal/02-lrgb-paleta.md](../../no-lineal/02-lrgb-paleta.md)

**A mano en PixInsight (valores de referencia)**

- HOO clásico (Blend Soft 60/40) con PixelMath en una imagen RGB nueva: R = Ha, G = 0,6·Ha + 0,4·OIII, B = OIII, con las dos capas estiradas con el MISMO estirado.
- Variante: NarrowbandNormalization sobre la HOO, paleta HOO, lightness desactivada, shadowpoint 1.

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

- SCNR: amount 0,65 (aescaffre; «nosotros preferimos suave»); verde y Average Neutral por defecto.
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

**En una llamada** (`herramientas/mascaras.js`): `crearMascara(vista, { tipo })` con `tipo` `luminancia` (gamma 2,0 LHE / 1,5 HDRMT), `cielo` (rampa 1,5σ–5σ, suavizada) o `fondo_lhe` (receta v4B). Devuelve la vista de la máscara, su cobertura y la media en el cielo y en lo brillante, y cómo aplicarla.

```json
{"llamadas": [
  {"funcion": "crearMascara", "parametros": {"vista": "Starless_st", "opciones": {"tipo": "fondo_lhe"}}}
]}
```

<a id="no-lineal-05"></a>
### Fase no lineal · Paso 5: Boost (curvas, contraste, saturación)

Ficha: [no-lineal/05-boost.md](../../no-lineal/05-boost.md)

**Saturación al fallo en una llamada** (`herramientas/boost.js`): `saturarAlFallo("Starless_st", { tipo: "nebulosa" })` prueba 0,58 → 0,78 sobre copias y se queda la última sin fallo medido (canales > 0,98, fondo teñido: dominante del cielo > 8 % o +4 puntos, ruido de color del cielo × 1,5). Si ni la primera pasa, no satura. Pruebas de nov 2026: galaxia grande → 0,63 (para por ruido de color); nebulosa dual band → no satura (dominante azul del cielo sin resolver). Los umbrales de tinte son provisionales.

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

- **Comparar en una llamada** (`contrasteCandidatos("Starless_st")`, `herramientas/realces.js`): sobre copias, LHE radio 64 (pendiente 1,5, amount 0,35) y radio 128 (pendiente 2,0, amount 0,35), HDRMT de 6 capas sobre la luminosidad mezclado al 50 % y DarkStructureEnhance (median 0,7). Mide en todos el contraste local (rango p10–p90 en celdas de 64 px con señal), el ruido y el nivel del cielo y los píxeles quemados. Gana el que más sube el contraste sin subir el ruido del cielo más de un 25 % (`ruidoMax`), sin mover el cielo más de 0,03 ni quemar; si ninguno cumple, recomienda no tocar la imagen. En IC 63 sin calibrar (8 nov 2026) ganó LHE radio 64 (contraste ×1,15, ruido ×1,18); el radio 128 subía el ruido ×1,35 y HDRMT bajaba el cielo de 0,10 a 0,07. Las recetas de abajo valen como candidatos a mano (`lhe: [{ radius, slopeLimit, amount }]`).

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

Devuelve los pasos, antes y después por canal (mediana, MAD, máximo, pix_098, p90_estrellas) y el control.

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

**En una llamada** (`herramientas/exportar.js`): `exportarFinal("Final", { carpeta, nombre, girar180 })` comprueba saturados y bordes negros, guarda el XISF 32 bits con astrometría y, sobre una copia en sRGB (y girada 180° con FastRotation si se pide), el TIFF 16 bits y el JPG. Crea la carpeta antes de guardar y no sobrescribe (añade _2). Recomendado para modelos sin herramientas.

```json
{"llamadas": [
  {"funcion": "exportarFinal", "parametros": {"vista": "Final", "opciones": {"carpeta": "<carpeta de la versión>/final", "nombre": "<objeto>_v1", "girar180": false}}}
]}
```

Devuelve los ficheros (con su tamaño), los controles y `no_cumple`.
