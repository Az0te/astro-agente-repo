# Paso 1: Estirado (starless y estrellas por separado)

[← Índice](../SKILL.md) · Siguiente: [Paso 2: LRGB / Paleta](02-lrgb-paleta.md) · Porqué, GHS a mano y ajustes finos: [detalle](../detalle/no-lineal-01-estirado.md)

Primer paso de la sesión no lineal: leer antes `estado.md` (Paso 17 lineal). Starless y estrellas se estiran **por separado**: la starless tolera un estirado más profundo; las estrellas, más suave y con las altas luces protegidas. Irreversible: lo que no se limpió en lineal queda amplificado.

**Fondo objetivo** (mediana tras estirar): nebulosa de emisión 0,15–0,25 · galaxia 0,10 · cúmulo de galaxias 0,08–0,10 · margen de altas luces 0,05. El perfil puede fijar otro.

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

**GHS hasta el fondo objetivo en una llamada** (`herramientas/estirado.js`): hace la fase 1 y, si no basta, una segunda pasada con el D que lleva la mediana al objetivo (buscado sobre una copia reducida), sobre una copia y midiendo el recorte. Recomendado cuando no se puede ir pasada a pasada (modelos sin herramientas). Las fases 3 y 4 siguen siendo a mano.

```javascript
eval(File.readTextFile("<ruta de guia>/herramientas/estirado.js"));   // en el nivel superior del script
var r = estirarStarless("Starless", { fondo: 0.20, nuevaVista: "Starless_st_v1" });
JSON.stringify(r);   // pasadas, mediana (y por canal), mínimo, máximo, recorte, en_objetivo
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

- Cuándo: la capa de estrellas **lineal** de SXT, y las estrellas RGB que se añaden a una imagen de banda estrecha. Nunca la starless ni una capa ya estirada.
- Cómo: `starStretch("Stars_v1", { amount: 2, saturation: 1, removeGreen: false })` sobre una copia. `amount` 1–3 en campos con muchas estrellas (objetivo: p90 de la capa ≈ 0,25, probando con saturación fija), hasta 5 con pocas. `saturation` 1; 1,2–1,5 si salen pálidas, vigilando anillos de color. `removeGreen` sólo con dominante verde real.
- Alternativa: arcsinh con `L = max(RGB)` y k ≈ 5000, o ArcsinhStretch (ver detalle).

**Control.** Mediana del fondo en el objetivo; mínimo ≥ 0 (sin sombras aplastadas); sin estrellas hinchadas; sin deriva de color. Pico más ancho = más ruido; pico de un canal desplazado = dominante; "dientes de sierra" al ampliar el histograma = posterización por estirados repetidos.
