# Anexo A: Contrato de API (PJSR)

[← Índice](../SKILL.md) · Anterior: [Índice](../SKILL.md) · Siguiente: [Anexo B: Controles de calidad y checklist de entrega](B-checklist-entrega.md)

Contrato mínimo para que un agente ejecute los pasos de esta guía sin inventar funciones.

### A.1 Acceso a ventana, vista e imagen

| Necesidad | Llamada correcta | Trampa |
|---|---|---|
| Ventana por id | `ImageWindow.windowById("MasterLight")` | Nunca devuelve `null`: si no existe, un objeto con `.isNull = true` |
| Vista por id | `View.viewById("MasterLight")` | En el watcher v8 devuelve **`null`** si no existe (comprobado en 1.9.6); en el clásico, un objeto con `.isNull`. Comprobar siempre `!v || v.isNull` |
| Vista principal | `w.mainView` | — |
| Imagen | `v.image` | **`w.image` no existe** |
| Id de la vista | `w.mainView.id` | **`w.id` no existe** |
| Dentro de `run_script` | `findViewById(id)`, `findWindowByViewId(id)` | Devuelven `null` (no `.isNull`) |

```javascript
var w = ImageWindow.windowById("MasterLight");
if (!w || w.isNull) throw new Error("No existe MasterLight");
var v = w.mainView;          // la vista
var img = v.image;           // la imagen está en la vista, NO en la ventana
```

**Devolver resultados:** la última expresión del script (o un `return`) es la respuesta de `run_script`; no hace falta escribir un fichero y leerlo después.

### A.2 Ejecución de procesos

| Necesidad | Llamada correcta | No existe |
|---|---|---|
| Aplicar sobre una vista | `P.executeOn(v)` → `false` si falló | `P.process()`, `P.execute()`, `P.run()`, `P.apply()` |
| Proceso que crea imágenes | `P.executeGlobal()` | — |
| Proceso con los ajustes del equipo | `pxSPCC()`, `pxSPFC()`, `pxMGC()` de `herramientas/procesos.js`, o `new Proceso` con los valores del perfil | `ProcessInstance.fromIcon`: la guía no usa iconos |
| Proceso desde cero | `new BlurXTerminator` (etc.) | Nombres mal escritos → `describe_process` |

```javascript
var P = new HistogramTransformation;
// ... parámetros ...
if (!P.executeOn(v)) throw new Error("HistogramTransformation no se aplicó");
```

Regla: **cada `executeOn` se comprueba**. Un proceso que devuelve `false` no ha hecho nada, y las expresiones largas de PixelMath "fallan en silencio".

### A.3 Astrometría

| Necesidad | Llamada | Notas |
|---|---|---|
| ¿Tiene WCS? | `w.hasAstrometricSolution` | Comprobar tras crop, rotación, BXT, GraXpert |
| Resolver a ciegas (v8) | `blindSolve("<vista>", opciones)` | Devuelve `{ra, dec, scale, rotation, flipped, matches, solution, …}`; `null` si falla |
| Copiar WCS entre ventanas | `destino.copyAstrometricSolution(origen)` | Método de la **ventana** |
| Regenerar tras mover la solución | `regenerateAstrometricSolution()` | Residuos 0,2–0,3 px en el traslado manual |

```javascript
var r = blindSolve("MasterLight");
if (!ImageWindow.windowById("MasterLight").hasAstrometricSolution) throw new Error("Sin solución");
JSON.stringify(r);
```

### A.4 Imagen: estadísticas y píxeles

| Necesidad | Llamada |
|---|---|
| Mediana / media / MAD / σ / mín / máx | `img.median()`, `img.mean()`, `img.MAD()`, `img.stdDev()`, `img.minimum()`, `img.maximum()` (sobre `selectedChannel`) |
| Cambiar de canal | `img.selectedChannel = c` |
| Volver a todas | `img.resetSelections()` |
| Un píxel | `img.sample(x, y, canal)` |
| Una fila / un rectángulo | `img.getSamples(Float32Array, Rect, canal)` |
| Escribir | `img.setSamples(...)` entre `beginProcess()` y `endProcess()` |
| Copiar contenido | `img.assign(otra)` |
| Propiedades | `img.width`, `img.height`, `img.numberOfChannels`, `img.bitsPerSample`, `img.isColor`, `img.isReal` |

`Rect(x0, y0, x1, y1)` usa **esquinas**, no anchura y altura: `new Rect(0, y, W, y + 1)` para una fila.

### A.5 Duplicar una imagen (no existe `clone()`)

```javascript
var src = ImageWindow.windowById("MasterLight");
var im = src.mainView.image;
var w2 = new ImageWindow(im.width, im.height, im.numberOfChannels, 32, true, im.isColor, "M31_v3");
w2.mainView.beginProcess();
w2.mainView.image.assign(im);
w2.mainView.endProcess();
w2.copyAstrometricSolution(src);   // destino.copyAstrometricSolution(origen)
w2.show();
```

### A.6 Historial de una vista

```javascript
var h = v.processing;        // contenedor, NO array
h.length;                    // número de pasos
h.at(i).toSource();          // código del paso i
```

`h[i]` no funciona. `window.saveAs` **no** guarda el historial en el XISF.

### A.7 Edición segura y memoria

- `beginProcess()` / `endProcess()`: si salta un error entre ambos, **la vista queda bloqueada**. Calcular todo antes y escribir dentro de un `try/finally`; si ya está bloqueada, llamar a `endProcess()` en un script aparte.
- `window.purge()` tras pasos pesados (LHE, HDRMT, máscaras) y en los puntos de unión.
- `processEvents()` en bucles largos para no congelar la interfaz.
- Cerrar ventanas temporales: una RGB f32 de ~11k×7k ocupa ~1 GB.

### A.8 Lo que no existe (o está mal)

| Error frecuente | Realidad |
|---|---|
| `w.image` | `w.mainView.image` |
| `w.id` | `w.mainView.id` |
| `img.clone()` | `new ImageWindow(...)` + `assign` |
| `P.execute()`, `P.run()`, `P.apply()`, `P.process()` | `executeOn(v)` / `executeGlobal()` |
| `img.getChannelData()` | `getSamples(Float32Array, Rect, canal)` |
| `h[i]` | `h.at(i)` |
| `P.starmask`, `P.linear` (SXT) | No existen |
| `Math.hypot` en el watcher clásico | No existe (ES5) |
| `pow()` en PixelMath | `^` o `exp(e*ln(b))` |
| `if` en PixelMath | `iif(cond, a, b)` |
| Variables sin declarar en PixelMath | `P.symbols = "s, B, SP"` (si no: "Expected lvalue (variable) operand") |
| PixelMath por canal | `P.useSingleExpression = false`, `P.expression` (R), `P.expression1` (G), `P.expression2` (B); dentro de cada una el canal es `$T` |
| Otra imagen en PixelMath | Se usa por su id en la expresión (`Ha`, `RGB_starless[0]`) |
| `new Script` desde el watcher | "Attempt to execute a Script instance recursively" |
| `Clase.prototype.CONSTANTE` en el watcher v8 | `Clase.CONSTANTE` (`PixelMath.RGB`, `SCNR.Green`): con `.prototype` sale `undefined` sin error. En el clásico era `.prototype` |
| Proceso que "no existe" | Casi siempre el nombre está mal (es `GeneralizedHyperbolicStretch`, no `GreenHyperbolicStretch`): `describe_process` sugiere el real |
| Guardar en una carpeta que no existe | `save_image` la crea desde el watcher v0.4.5; antes fallaba en silencio |

### A.9 Watcher clásico (ES5) frente a v8

- **v8** (PixInsight 1.9.6+): `let`/`const`, flechas, clases, `for…of`, `Promise`, `blindSolve` y las funciones de `realces.js`.
- **Clásico**: sólo `var`, `function(){}`, concatenación de cadenas. Nada de `let`, flechas, plantillas, clases, `for…of`, `Promise`.
- Si no sabes cuál corre: la consola muestra `v0.5.x-v8` al arrancar, o `typeof blindSolve === "function"` sólo en v8.
- **Procesos** (se lanzan desde el watcher): BlurXTerminator, NoiseXTerminator, StarXTerminator, SpectrophotometricColorCalibration, SpectrophotometricFluxCalibration, MultiscaleGradientCorrection, MultiscaleAdaptiveStretch, GeneralizedHyperbolicStretch, HistogramTransformation, CurvesTransformation, PixelMath, LocalHistogramEqualization, HDRMultiscaleTransform, HDRComposition, NarrowbandNormalization, AutomaticBackgroundExtractor, DynamicBackgroundExtraction, SCNR.
- **Scripts:** la guía no los usa. Desde el watcher no se pueden lanzar ("Script instance recursively"), así que cada uno tiene su equivalente:

| Script | Equivalente desde el watcher |
|---|---|
| ImageSolver / BlindSolver | `blindSolve` (Paso 8 lineal) |
| WBPP | Cadena de procesos de calibración, registro e integración (Paso 4 lineal) |
| DBXtract / NBExtractPI | Emulación con PixelMath (Paso 7 lineal) |
| GraXpert (script) / AutoDBE | Proceso GraXpert (sample_free 10), `herramientas/graxpert.js`, MGC con `pxMGC` o plano robusto (Paso 9 lineal) |
| Combine Ha with RGB / CombineRGBAndNarrowband / Mix SHORGB | PixelMath (Paso 10 lineal y Paso 2 no lineal) |
| PhotometricContinuumSubtraction | Fotometría de estrellas + PixelMath (Paso 16 lineal) |
| AutoPalette Studio / Perfect Palette Picker / Foraxx | Fórmulas con PixelMath (Paso 2 no lineal) |
| Statistical Stretch | MAS o GHS (Paso 1 no lineal) |
| Star Stretch | `starStretch` (Paso 1 no lineal) |
| ScreenStars | `screenStarsCombine` / `screenStarsExtract` (Pasos 8 y 9 no lineales) |
| NB to RGB Star Combination | PixelMath (Paso 8 no lineal) |
| Halo-B-Gon / Star Reduction / RepairStarCores / Repaired HSV Separation | Recetas de halos y relleno con ley de potencias (Paso 8 no lineal); HDR con tomas cortas |
| DarkStructureEnhance | `darkStructureEnhance` (Paso 5 no lineal) |
| BackgroundEnhance | `backgroundEnhance` (Paso 5 no lineal) |
- **Integrados en el watcher v8**: `blindSolve` (motor de BlindSolver) y los realces de `herramientas/realces.js` (`starStretch`, `screenStarsCombine`, `screenStarsExtract`, `darkStructureEnhance`, `backgroundEnhance`), que reproducen los scripts originales píxel a píxel. Con el watcher clásico, `realces.js` se carga con `eval`.
- **GraXpert**: el proceso de PixInsight (`new GraXpert`) para el fondo por defecto; `herramientas/graxpert.js` llama al programa externo para el resto.

---
