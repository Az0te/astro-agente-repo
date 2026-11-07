# Paso 1: Estirado (starless y estrellas por separado)

[← Índice](../SKILL.md) · Siguiente: [Paso 2: LRGB / Paleta](02-lrgb-paleta.md) · Porqué, GHS a mano y ajustes finos: [detalle](../detalle/no-lineal-01-estirado.md)

Primer paso de la sesión no lineal: leer antes `estado.md` (Paso 17 lineal). Starless y estrellas se estiran **por separado**: la starless tolera un estirado más profundo; las estrellas, más suave y con las altas luces protegidas. Irreversible: lo que no se limpió en lineal queda amplificado.

**Cielo objetivo** (estirado al fallo, el método por defecto): **0,10 en nebulosas y cúmulos; 0,07 en galaxias** (`tipo: "galaxia"`).
En una galaxia con mucho cielo alrededor, 0,10 deja el fondo gris: galaxia grande OSC (7 nov 2026) quedó mucho mejor con cielo 0,07 y `ruidoMax` 0,12, y las estrellas con el mismo estirado y saturación 1,3 (con starStretch amount 2 salían diminutas y pálidas). `tipo: "galaxia"` pone esos valores; lo que se pase explícito manda. Es el nivel de las zonas más oscuras de la imagen (`cielo`), no la mediana: en una nebulosa que llena el campo la mediana sale sola por encima (nebulosa dual band: 0,14 con cielo 0,10). Con cielo 0,15 la nebulosa queda algo pasada (prueba de nov 2026). El perfil puede fijar otro.

**Fondo objetivo** (sólo para el modo antiguo a mediana fija, `modo: "fondo"`): nebulosa de emisión 0,15–0,25 · galaxia 0,10 · cúmulo de galaxias 0,08–0,10 · margen de altas luces 0,05.

**Método**

| Método | Cuándo |
|---|---|
| **GHS** | Control fino (SP, LP/HP): galaxias HDR y starless |
| **MAS** | Estructuras multiescala, nebulosas complejas, galaxias; igualar capas antes de combinar (L y RGB) |
| HistogramTransformation | Válido; GHS es mejor en varias pasadas porque LP no vuelve a comprimir las sombras ya trabajadas |
| **`starStretch`** | Sólo la capa de estrellas lineal |

`stretch_image` con "stf" aplica un autoestirado real y se niega si la imagen ya no es lineal. Comparar métodos a resultado visual equivalente, no a parámetros iguales.

**GHS en 3 fases desde lineal.** D del interfaz logarítmico: D real = e^D − 1. Restricción LP < SP < HP. Remedir la mediana antes de cada pasada (SP = mediana).

| Fase | D | B | SP | LP | HP | Efecto |
|---|---|---|---|---|---|---|
| 1. Levantar el pie | 2–3 | 10–15 | mediana (~0,001–0,003) | 0 | 0,95 | fondo ~0,15–0,23 |
| 2. Tonos medios | 1,5–2 | 3–6 | nueva mediana | 0,02–0,05 | 0,90 | contraste en medios |
| 3. Altas luces | 0,5–1 | −1 a 0 | nueva mediana | 0,05–0,08 | 0,85 | comprime luces |
| 4 (opcional, núcleos) | 0,3–0,5 | −1,5 | 0,5–0,8 | 0,15 | 1 | núcleos |

Modo color ("Col") conserva el tono; RGB/K por canal puede desplazarlo. Histograma con dos cúpulas = exceso de b con D alto: deshacer y bajar b ~40 % o D ~50 %.

```javascript
var v = View.viewById("Starless");
if (!v || v.isNull) throw new Error("No existe Starless");
var img = v.image;
img.selectedChannel = 0;
var med = img.median();
img.resetSelections();
if (med > 0.05) throw new Error("La imagen parece estirada: no repetir la fase 1 (mirar el historial)");
var P = new GeneralizedHyperbolicStretch;
P.stretchType = GeneralizedHyperbolicStretch.ST_GeneralisedHyperbolic;
P.stretchChannel = GeneralizedHyperbolicStretch.SC_RGB;
P.stretchFactor = 2.5;           // D
P.localIntensity = 12;           // b
P.symmetryPoint = med;           // SP
P.shadowProtection = 0;          // LP
P.highlightProtection = 0.95;    // HP
if (!P.executeOn(v)) throw new Error("GHS fase 1 falló");
"GHS fase 1: mediana previa " + med;
```

**Estirar al fallo, en pasadas cortas** (método por defecto). Varias pasadas cortas son mejores que una larga: se estira hasta que algo falla y se queda la pasada anterior. Tras la fase 1, pasadas cortas de GHS (D ≈ 1, b 6, SP = cielo, HP 0,92), cada una seguida de un punto negro que devuelve el cielo a ~0,10; se mide tras cada pasada. **Fallo:** ruido del cielo > 15 % del cielo, > 0,05 % de píxeles a 0 o > 0,95. Si una pasada falla, se deshace y se prueba la mitad de corta; cuando ni la más corta cabe, se queda la anterior. Con galaxia grande (nov 2026) da lo mismo que el arcsinh elegido (bulbo 0,75, disco 0,24, ruido del cielo ~12–14 %), mientras que llevar sólo la mediana a 0,10 dejaba la galaxia apagada (bulbo 0,45, disco 0,13).

**Las dos capas en una llamada** (`herramientas/estirado.js`), sobre copias: starless al fallo (o a una mediana fija con `modo: "fondo"`) y estrellas con **arcsinh que conserva el color** (k 3000 por defecto, con el p90 que daría cada k), o con **`estrellas: "extraer"`** (el mismo estirado que la starless, ver abajo; es lo que pone `tipo: "galaxia"`). Devuelve las pasadas, qué falló, las medidas, la **meseta del núcleo** y el control (lo visual, aparte). Recomendado para cualquier modelo. Sueltas: `estirarStarless(vista, {cielo})` y `estirarEstrellas(vista, {k})`. `starStretch` sólo si se pide (`metodoEstrellas: "starstretch"` o pasando `amount`): pierde las estrellas débiles. **Si no se sabe qué tipo de objeto es** (sin OBJECT y con un nombre de fichero genérico), preguntarlo antes de estirar.

**Estrellas con el mismo estirado (`estrellas: "extraer"`).** Suma starless lineal + estrellas lineales (SXT lineal es una suma exacta), le repite exactamente las pasadas de GHS y los puntos negros de la starless y separa con `screenStarsExtract`. Las estrellas quedan con el brillo que tendrían en la imagen entera. Comparación galaxia grande (7 nov 2026): con `starStretch` amount 2 la final se quedó con 269 estrellas detectables (0,19 % de píxeles con aporte); con este método (Opus v7), 13 721. Si no se puede (modo `fondo`, falta `realces.js`), cae a `starStretch` y lo dice en `aviso`.

**Meseta del núcleo.** `meseta_nucleo.radio_px` es el radio equivalente de lo que queda por encima de 0,95 alrededor del punto más brillante. Con estructura: 0–3 px; galaxia grande con Qwen, 22 px (núcleo y la galaxia satélite planos). Si pasa de 3, `no_cumple` lo dice y el siguiente paso es `comprimirNucleo` (Paso 5), **no** volver a estirar ni encadenar más GHS.

```javascript
eval(File.readTextFile("<ruta de guia>/herramientas/estirado.js"));   // en el nivel superior del script
var r = estirarCapas("Starless", "Stars", { cielo: 0.10, nuevaStarless: "Starless_st_v1", nuevasEstrellas: "Stars_st_v1" });
// Galaxia: { tipo: "galaxia", nuevaStarless: ..., nuevasEstrellas: ... }   (cielo 0,07, ruidoMax 0,12, estrellas "extraer", saturación 1,3)
JSON.stringify(r);   // { starless: {pasadas, parada, medidas, dominante, control}, estrellas: {amount, p90, control} }
```
**MAS.** Parámetros (por defecto): `targetBackground` (0,15), `aggressiveness` (0,70), `dynamicRangeCompression` (0,40), `contrastRecovery` (true), `scaleSeparation` (1024), `contrastRecoveryIntensity` (1,0), `saturationEnabled` (true), `saturationAmount` (0,75), `backgroundROIEnabled` y `backgroundROIX0/Y0/Width/Height` (imprescindible si el objeto llena el campo). Orden de ajuste: ROI de fondo → fondo objetivo → agresividad → DRC → scale separation → contrast recovery (0,25 sutil, 0,5 moderado, 1 completo) → saturación. Más señal débil: subir un poco el fondo y bajar la agresividad. DRC protege núcleos durante el estirado; no sustituye a HDRMT.

```javascript
var M = new MultiscaleAdaptiveStretch;
M.targetBackground = 0.15;
M.aggressiveness = 0.6;
M.contrastRecoveryIntensity = 0.5;
M.saturationEnabled = false;          // Hα o capas que se combinarán después
if (!M.executeOn(View.viewById("Starless"))) throw new Error("MAS falló");
```

**Capa de estrellas: `starStretch`** (Star Stretch de SetiAstro, mismo resultado que el script)

- Cuándo: la capa de estrellas **lineal** de SXT, y las estrellas RGB que se añaden a una imagen de banda estrecha. Nunca la starless ni una capa ya estirada. En galaxias y campos con muchas estrellas es mejor `estrellas: "extraer"`: con `starStretch` las débiles se pierden al recombinar sobre un fondo estirado al fallo (galaxia grande, nov 2026).
- Cómo (por defecto): arcsinh que conserva el color, `L = máx(R,G,B)`, `f = asinh(k·L) / (asinh(k)·L)`, cada canal × f, **k = 3000**. Lo débil se amplifica ~×345 y lo brillante casi nada: salen las estrellas débiles sin hinchar las brillantes. Nebulosa oscura (7 nov 2026): con starStretch amount 2 la final tuvo ~2 200 estrellas visibles y un aporte del 0,8 %; con el arcsinh k 3000, ~18 000 y un 10 %.
- Antes (sólo si se pide): `starStretch("Stars_v1", { amount: 2, saturation: 1, removeGreen: false })` sobre una copia; su curva sube lo débil sólo ×9 con amount 2. `amount` 1–3 en campos con muchas estrellas, hasta 5 con pocas. Referencia medida (p90 de los píxeles de estrella > 0,005, como lo miden las funciones): 0,08–0,12 con amount 2 en una nebulosa dual band y una galaxia grande (nov 2026), lo mismo que dejó Opus a mano; el "≈ 0,25" de NOVA se mide de otra forma y no se alcanza así ni con amount 5. `saturation` 1; 1,2–1,5 si salen pálidas, vigilando anillos de color. `removeGreen` sólo con dominante verde real.
- Alternativa: ArcsinhStretch (ver detalle).

**Control.** Estirado hasta el fallo (ni más ni menos: la pasada anterior a que el ruido del cielo pase del 15 % o recorte); cielo ~0,10 (0,07 en galaxias); sin dominante en el cielo (< 5 %; si la hay, venía de la lineal: corregirla allí); mínimo ≥ 0 (sin sombras aplastadas); sin estrellas hinchadas; sin deriva de color. Pico más ancho = más ruido; pico de un canal desplazado = dominante; "dientes de sierra" al ampliar el histograma = posterización por estirados repetidos.
