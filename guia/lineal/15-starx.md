# Paso 15: StarX y NXT de la starless

[← Índice](../SKILL.md) · Anterior: [Paso 14: NoiseX suave (opcional)](14-noisex-suave.md) · Siguiente: [Paso 16: LinearFit / sustracción de continuo](16-linearfit-continuo.md)

**Por qué.** Separar estrellas permite estirar la nebulosa a fondo sin hinchar las estrellas y procesar cada capa con su propia receta. "SXT: lo antes posible en lineal (no arcsinh/GHS/MaskedStretch/HDR multiescala antes, deforman perfiles)". En lineal la separación es exacta: estrellas = original − starless.

**Reglas**

- `output_stars=true`, `unscreen=false` en lineal → **suma exacta**: starless + estrellas = original.
- La imagen de estrellas se llama `<id>_stars`: detectarla comparando la lista de ventanas antes y después.
- "`P.starmask` y `P.linear` no existen".
- Overlap: 0,20 normal; 0,50 sólo con estrellas muy grandes, campos densos o costuras (×3 tiempo).
- No usar STF Auto Stretch en la imagen de estrellas.
- "No separar estrellas en cúmulos (abiertos o globulares): las estrellas son el objeto."
- "SXT rinde peor con aberraciones fuertes, sobremuestreo (p. ej. drizzle 2x) y estirados extremos tipo GHS/arcsinh (RC-Astro); puede quitar núcleos de galaxias, núcleos de planetarias, comas de cometas y cruces de filamentos (proteger con máscara)."
- "En galaxias espirales grandes SXT confunde regiones HII y nudos con estrellas: el estirado de estrellas amplifica esos residuos; usar screen, estirado moderado o no separar estrellas."

**Código**

```javascript
var v = View.viewById("MasterLight");
if (!v || v.isNull) throw new Error("No existe MasterLight");
var SXT = new StarXTerminator;
// nombres comprobados en PixInsight 1.9.6 (módulo RCAstroSuite)
SXT.output_stars = true; // genera la capa de estrellas
SXT.unscreen = false;    // lineal: suma exacta starless + stars
// SXT.overlap = 0.20;   // 0,50 solo con estrellas muy grandes / campos densos (x3 tiempo)
if (!SXT.executeOn(v)) throw new Error("StarX falló");
"starless + MasterLight_stars";
```

**En una llamada** (`herramientas/ruido.js`): `separarEstrellas` hace SXT sobre una copia (unscreen según sea lineal o no), localiza la capa de estrellas y comprueba que starless + estrellas reproduce el original; la estructura extensa de la capa de estrellas se da como orientación (en campos densos es alta sin fallo). Después, el denoise principal con `reducirRuido` (híbrido en mono con el modelo del perfil; en RGB, NXT 0,70 y mirar `moteado_color_despues`) o, mejor, con `ruidoCandidatos(s.starless, { principal: true })`, que compara NXT, MLDenoise y MultiscaleTGVDenoise y prefiere el que baja el ruido un 50–80 % cumpliendo los controles (ver [Paso 14](14-noisex-suave.md)).

```javascript
eval(File.readTextFile("<ruta de guia>/herramientas/ruido.js"));   // en el nivel superior del script
var s = separarEstrellas("MasterLight_nxt", { nuevaVista: "Starless", nuevasEstrellas: "Stars" });
var d = reducirRuido(s.starless, { metodo: "hibrido", modelo: "<.xmlm del perfil>", nuevaVista: "Starless_dn" });   // RGB: { denoise: 0.70 } (ver «RGB» abajo)
JSON.stringify({ separacion: s, denoise: d });
```

**Control.** "Una starless 'limpia' no prueba que la separación sea buena: revisar la diferencia original − starless." Esa diferencia debe contener **sólo** estrellas y sus halos, no filamentos, polvo ni núcleos de galaxia. Comprobar el recuento de estrellas de la capa frente al original. Y la suma `starless + stars` debe reproducir el original píxel a píxel (en lineal es exacta).

**Denoise principal sobre la starless (lineal)**

Es el denoise fuerte del flujo: va aquí, sobre la capa sin estrellas y todavía en lineal, no antes de BXT ni sobre la imagen con estrellas.

**Por defecto: híbrido MLDenoise + NXT.** Es la mejor opción medida, en los tres canales probados frente a una referencia de subs independientes (nebulosa dual band; [detalle](../detalle/lineal-15-denoise-mldenoise.md)). Toma el detalle fino de MLDenoise y lo grueso de NXT 0,95: `ML − suave(ML) + suave(NXT)`, con caja de radio 3. Iguala a NXT 0,95 en ruido a 1, 4 y 16 px y borra menos detalle.

| Variante (puntuación 0–100) | Hα | OIII | SII |
|---|---|---|---|
| **Híbrido ML + NXT (por defecto)** | **81,5** | **83,8** | **74,4** |
| MLDenoise 1,0 solo | 81,0 | 67,0 | 68,3 |
| NXT 0,95 solo | 78,6 | 78,6 | 69,7 |
| NXT 0,70 solo | 77,7 | 58,6 | 59,3 |

| Parámetro | Valor |
|---|---|
| MLDenoise `modelPath` | modelo `.xmlm` (obligatorio; ruta en `perfil.md`) |
| MLDenoise `amount` | 1,0 (máscara, overlap y precisión alta no cambian nada) |
| NXT `denoise` y `denoise_intensity` | 0,95 |
| NXT `detail` / `iterations` | 0,15 / 2 (iterations 5 no mejoró) |
| Radio de la caja | 3 px |

Canales mono (Hα, OIII, SII, L). En RGB, el modelo puede rechazar imágenes de color ("cannot process RGB images"): aplicar por canal (sin medir) o usar NXT con separación de color.

```javascript
var SRC = "MasterLight_starless";             // mono, lineal, sin estrellas
var MODEL = "<ruta del modelo .xmlm>";        // de perfil.md
var v = View.viewById(SRC);
if (!v || v.isNull) throw new Error("No existe la starless");
if (typeof MLDenoise !== "function") throw new Error("MLDenoise no está cargado: usar NXT 0,95 solo y avisar");
function boxblur(a, W, H, r) {                // caja separable de radio r
  var t = new Float32Array(W * H), o = new Float32Array(W * H);
  for (var y = 0; y < H; y++) { var s = 0, n = 0, b = y * W;
    for (var x = 0; x < Math.min(r, W); x++) { s += a[b + x]; n++; }
    for (var x = 0; x < W; x++) { if (x + r < W) { s += a[b + x + r]; n++; } if (x - r - 1 >= 0) { s -= a[b + x - r - 1]; n--; } t[b + x] = s / n; } }
  for (var x = 0; x < W; x++) { var s = 0, n = 0;
    for (var y = 0; y < Math.min(r, H); y++) { s += t[y * W + x]; n++; }
    for (var y = 0; y < H; y++) { if (y + r < H) { s += t[(y + r) * W + x]; n++; } if (y - r - 1 >= 0) { s -= t[(y - r - 1) * W + x]; n--; } o[y * W + x] = s / n; } }
  return o; }
function dup(id) { var s = v.image, w = new ImageWindow(s.width, s.height, 1, 32, true, false, id); w.mainView.beginProcess(); w.mainView.image.assign(s); w.mainView.endProcess(); w.show(); return w; }
function px(w) { var im = w.mainView.image, a = new Float32Array(im.width * im.height); im.getSamples(a, new Rect(0, 0, im.width, im.height), 0); return a; }
var ml = dup(SRC + "_ml"), nx = dup(SRC + "_nx");
var ML = new MLDenoise; ML.modelPath = MODEL; ML.amount = 1.0; ML.useCache = false;
if (!ML.executeOn(ml.mainView)) throw new Error("MLDenoise falló");
var NXT = new NoiseXTerminator; NXT.denoise = 0.95; NXT.denoise_intensity = 0.95; NXT.detail = 0.15; NXT.iterations = 2;
if (!NXT.executeOn(nx.mainView)) throw new Error("NXT falló");
var W = v.image.width, H = v.image.height, m = px(ml), n = px(nx), bm = boxblur(m, W, H, 3), bn = boxblur(n, W, H, 3), o = new Float32Array(W * H);
for (var i = 0; i < o.length; i++) o[i] = m[i] - bm[i] + bn[i];
var out = new ImageWindow(W, H, 1, 32, true, false, SRC + "_dn");
out.mainView.beginProcess(); out.mainView.image.setSamples(o, new Rect(0, 0, W, H), 0); out.mainView.endProcess(); out.show();
ml.forceClose(); nx.forceClose();
"híbrido ML + NXT: " + SRC + "_dn";
```

MLDenoise tarda ~2 min en 26 MP: pasa de 45 s: el MCP devuelve un id de trabajo (esperar con `estado(trabajo)`), y no encadenar varios canales en un mismo script (con 8+ min seguidos PixInsight dio "Invalid task termination intent" y el watcher dejó de recoger comandos).

**Sin MLDenoise (no hay modelo o el módulo no está):** NXT solo, denoise 0,95 (en Hα 0,85 puntuó algo más: 79,2 frente a 78,6), detail 0,15, iterations 2. Con señal fuerte (Hα), sin NXT: MLDenoise 1,0 solo. Sin MLDenoise ni NXT: MultiscaleTGVDenoise (1.9.6) con `scales` 8 y `strength` 0,6; no con los valores por defecto (2 escalas dejan mucho ruido grueso). Borra más detalle que el híbrido y que NXT 0,95 (ver [detalle](../detalle/lineal-15-denoise-mldenoise.md)).

| Parámetro NXT (variantes) | Valor |
|---|---|
| Separación de color (RGB) | croma > luminancia (nebulosa oscura: croma 0,90, luminancia 0,40, detail 0,25); 0,75 por igual dio aspecto plástico |
| Variante "full" (RC-Astro) | separación intensidad/color y de frecuencia: HF y LF 0,80 en intensidad y color, escala HF/LF 5, iterations 5 |

- En una rejilla, cada prueba de NXT sobre una ventana con un **id nuevo**, y fijar también `denoise_intensity`: con el mismo id NXT devolvió el mismo resultado aunque cambiara `denoise`.
- La rejilla de antes (denoise 0,50 / 0,70 / 0,85) se quedaba corta: medido contra una referencia, 0,70 pierde frente a 0,95 en los tres canales. Bajar σ del cielo sin referencia no distingue ruido quitado de señal borrada.

**RGB (OSC): no 0,95.** Lo de arriba se midió en canales mono. En RGB, quitar casi todo el grano deja a la vista el moteado de color de gran escala del cielo (manchas verdes y moradas de 100–300 px) que el grano tapaba, y sale al estirar. galaxia grande OSC (7 nov 2026): NXT 0,95 bajó el ruido un 90 % y la starless quedó con manchas muy visibles; NXT 0,50 (50 %) quedó limpia, con `moteado_color` 0,36 → 0,65. El moteado sube en proporción a lo que baja el grano, así que con 0,95 rondaba 3,5. Regla: el denoise que deje `moteado_color_despues` por debajo de ~1 (en esa galaxia grande, quitar como mucho un 65–70 % del ruido); `reducirRuido` da no_cumple por encima de 1,5. Si hace falta más limpieza, en la fase no lineal (Paso 6) con separación de color, no subiendo aquí el denoise.

**Control del denoise.** σ del cielo (bajar un 50–80 %, nunca a cero), contraste de una zona débil (no bajar más de ~5 %) e imagen residual (antes − después): sólo ruido, sin filamentos ni bordes. Con el híbrido, revisar además que no aparezca moteado a 4–16 px en el cielo.
