# Detalle del Paso 15 lineal: MLDenoise frente a NoiseX

[← Ficha del paso](../lineal/15-starx.md) · [Índice](../SKILL.md)

Material de apoyo de la ficha: comparación medida de MLDenoise (proceso nativo de PixInsight, módulo MachineLearning) con NoiseXTerminator, y la receta híbrida que ganó. La ficha manda.

**Resultado.** En los tres canales gana el **híbrido**: el detalle fino de MLDenoise (amount 1,0) con lo grueso de NXT 0,95. Iguala a NXT en ruido a todas las escalas y borra menos detalle de nebulosa. Con señal fuerte (Hα), MLDenoise solo ya empata con NXT 0,95. Con señal débil (OIII, SII), MLDenoise solo deja hasta el doble de ruido a 16 px: hace falta NXT para lo grueso.

**Cómo se midió (IC 1396, SQA106 + OSC dual band, 3–4 nov 2026).** Medir sólo cuánto baja σ no distingue ruido quitado de señal borrada. Por eso se usó una referencia independiente:

- **A** = 1 de cada 4 subs registrados (24 de Hα, 29 de OIII y de SII), integrados aparte: la imagen ruidosa que se filtra.
- **B** = el resto de subs de esas sesiones más otra sesión (122 / 148 subs), sin ningún sub en común con A: la "verdad" con ~4× menos ruido.
- Escala A→B por fotometría de 400–550 estrellas (el ajuste por regresión o por contraste falla con señal débil: en OIII dio 0,21 y 2,04 frente a 1,36). Se quita la diferencia de gradiente entre sesiones (escalas > ~64 px).
- Error = RMS de (A filtrada − B) por zonas sin estrellas (cielo, medio, nebulosa) a 1, 4 y 16 px. El ruido de B suma igual a todas las variantes: no cambia el orden.
- Detalle = pendiente del error frente a la estructura de escala media de B en la nebulosa (más negativa = más detalle real borrado).
- Puntuación por canal: ruido 70 % (media de los 9 errores, 100 = el mejor en cada uno) + detalle 30 % (100 = original, 0 = el que más borra).

**Puntuaciones (total 0–100, comparables sólo dentro de un canal)**

| Variante | Hα | OIII | SII |
|---|---|---|---|
| Híbrido ML fino + NXT grueso | **81,5** | **83,8** | **74,4** |
| Híbrido sólo ML (bin2 para lo grueso) | 81,1 | 76,0 | 68,5 |
| ML + NXT 50/50 | 81,1 | 75,6 | 71,4 |
| MLDenoise 1,0 | 81,0 | 67,0 | 68,3 |
| NXT 0,95 | 78,6 | 78,6 | 69,7 |
| NXT 0,85 | 79,2 | 71,4 | 66,8 |
| NXT 0,70 | 77,7 | 58,6 | 59,3 |
| MultiscaleTGVDenoise fuerza 0,7, 8 escalas | — | 75,1 | 44,6 |
| MultiscaleTGVDenoise fuerza 0,6, 8 escalas | — | 75,1 | 52,5 |
| MultiscaleTGVDenoise fuerza 0,5, 8 escalas | — | 70,0 | — |
| MultiscaleTGVDenoise por defecto (0,5, 2 escalas) | — | 52,4 | — |

**MultiscaleTGVDenoise (nuevo en PixInsight 1.9.6, medido el 5 nov 2026).** Con 8 escalas y fuerza 0,6–0,7 iguala al híbrido en ruido (OIII: error en el cielo 1,60·10⁻⁵ a 1 px y 3,2·10⁻⁶ a 16 px), pero borra más detalle de la nebulosa (pendiente −0,50 a −0,59 frente a −0,43 del híbrido; en SII −0,47 a −0,58, más que cualquier otra variante). No supera ni al híbrido ni a NXT 0,95; con sus valores por defecto (2 escalas) deja tres veces más ruido a 16 px. Tarda ~2 min por canal de 26 MP (como MLDenoise en CPU). Hα no se midió. Queda como alternativa sin RC-Astro ni modelo de MLDenoise, con 8 escalas y fuerza 0,6.

Error en el cielo a 16 px, OIII: NXT 0,95 3,1·10⁻⁶; híbrido 3,1·10⁻⁶; MLDenoise 1,0 6,1·10⁻⁶. Detalle en nebulosa, OIII: híbrido −0,43; NXT 0,95 −0,55.

**Parámetros de MLDenoise (PixInsight 1.9.6+, modelo `MLDenoise_v42.xmlm`)**

| Parámetro | Medido |
|---|---|
| `modelPath` | obligatorio: sin modelo `.xmlm` falla con "No model path specified" |
| `amount` | mezcla lineal original/denoised; 1,0 es el mejor (por defecto 0,90) |
| `mask` (máscara integrada) | sin cambio medible en lineal |
| `overlapPercent` 50 + `precision` alta | idéntico a los valores por defecto, el doble de tiempo |
| Segunda pasada | idéntica a la primera |
| Tiempo | ~117 s para 26 MP en el equipo de prueba |

MultiscaleLinearTransform detrás de MLDenoise quita el moteado de 4 px, pero borra tanto detalle como NXT 0,95: no compensa.

**Receta híbrida** (sobre la starless lineal; no sobre imágenes con estrellas: la variante bin2 deja puntos negros en los núcleos)

```javascript
// Desenfoque de caja separable (radio r), comprobado en el banco de pruebas
function boxblur(a, W, H, r) {
  var t = new Float32Array(W * H), o = new Float32Array(W * H);
  for (var y = 0; y < H; y++) { var s = 0, n = 0, b = y * W;
    for (var x = 0; x < Math.min(r, W); x++) { s += a[b + x]; n++; }
    for (var x = 0; x < W; x++) { if (x + r < W) { s += a[b + x + r]; n++; } if (x - r - 1 >= 0) { s -= a[b + x - r - 1]; n--; } t[b + x] = s / n; } }
  for (var x = 0; x < W; x++) { var s = 0, n = 0;
    for (var y = 0; y < Math.min(r, H); y++) { s += t[y * W + x]; n++; }
    for (var y = 0; y < H; y++) { if (y + r < H) { s += t[(y + r) * W + x]; n++; } if (y - r - 1 >= 0) { s -= t[(y - r - 1) * W + x]; n--; } o[y * W + x] = s / n; } }
  return o; }
function dup(src, id) { var s = View.viewById(src).image; var w = new ImageWindow(s.width, s.height, 1, 32, true, false, id); w.mainView.beginProcess(); w.mainView.image.assign(s); w.mainView.endProcess(); w.show(); return w; }
function px(id) { var im = View.viewById(id).image, a = new Float32Array(im.width * im.height); im.getSamples(a, new Rect(0, 0, im.width, im.height), 0); return a; }

var SRC = "OIII_starless";                                   // canal mono lineal sin estrellas
var ml = dup(SRC, SRC + "_ml"), nx = dup(SRC, SRC + "_nx");  // ids nuevos en cada prueba (caché de NXT)
var ML = new MLDenoise; ML.modelPath = "C:/ruta/a/MLDenoise_v42.xmlm";       // cambiar por la ruta del modelo ML.amount = 1.0; ML.useCache = false;
if (!ML.executeOn(ml.mainView)) throw new Error("MLDenoise falló");
var NX = new NoiseXTerminator; NX.denoise = 0.95; NX.denoise_intensity = 0.95; NX.detail = 0.15; NX.iterations = 2;
if (!NX.executeOn(nx.mainView)) throw new Error("NXT falló");
var im = View.viewById(SRC).image, W = im.width, H = im.height, m = px(ml.mainView.id), n = px(nx.mainView.id);
var bm = boxblur(m, W, H, 3), bn = boxblur(n, W, H, 3), o = new Float32Array(W * H);
for (var i = 0; i < o.length; i++) o[i] = m[i] - bm[i] + bn[i];       // fino de ML + grueso de NXT
var out = new ImageWindow(W, H, 1, 32, true, false, SRC + "_hibrido");
out.mainView.beginProcess(); out.mainView.image.setSamples(o, new Rect(0, 0, W, H), 0); out.mainView.endProcess(); out.show();
"híbrido ML + NXT creado";
```

Variante sólo ML (Hα, sin NXT): en lugar de `nx`, MLDenoise sobre una copia reducida 2× (`IntegerResample`, `zoomFactor = -2`, promedio) y reescalada al tamaño original (`Resample`, `BicubicSpline`); combinar con radio 4. El híbrido de 3 niveles (bin2 + bin4) limpia muy bien el cielo pero dobla el error en la nebulosa de OIII: descartado.

**Trampas**

- NoiseXTerminator ejecutado varias veces sobre ventanas con el **mismo id** devolvió el mismo resultado aunque cambiara `denoise`: usar un id nuevo por prueba y fijar también `denoise_intensity`.
- Las pruebas largas (varios MLDenoise seguidos, 8+ min en un `run_script`) acabaron con "Invalid task termination intent" en la consola y el watcher sin recoger comandos: lanzar tandas de menos de 1 min y guardar resultados en disco entre medias.

Banco de pruebas reutilizable (scripts `dn_ref.js`, `dn_paso.js`, resultados JSON) en `IC1396/_proc/denoise_cmp/` del equipo de prueba.
