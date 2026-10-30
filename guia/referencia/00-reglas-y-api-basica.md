# Reglas de trabajo y API básica de PJSR (leer siempre antes de empezar)

Este tema recoge los fallos de un procesado real de M31 (oct 2026) hecho por un agente que escribía PJSR de memoria: inventó funciones, siguió adelante cuando fallaron pasos esenciales, "arregló" el color multiplicando canales a mano y documentó como resueltos errores que no lo estaban. El resultado tuvo que descartarse. Las reglas de abajo evitan que se repita.

## Reglas de trabajo
1. **Si falla un paso esencial, PARA y avisa al usuario.** Esenciales: corrección de gradiente, SPCC, BXT, estirado. Nunca sustituirlos por un apaño (curvas en lugar de calibración de color, PixelMath en lugar de estirado, UnsharpMask en lugar de BXT) ni marcar el error como "resuelto con alternativa".
2. **Nunca ajustar el color multiplicando canales a mano** (`$T*1.25`, `$T*0.6`…) ni con curvas por canal "a ojo". El color sale de SPCC (o, sin SPCC, de BackgroundNeutralization + ColorCalibration). Si SPCC no se puede aplicar, se para.
3. **Nunca estirar con fórmulas de PixelMath inventadas** (`iif($T<0.05, $T*15, …)`, tramos lineales): crean saltos en el histograma y destruyen sombras y luces. Estirar con MAS, GHS o HistogramTransformation, una vez, y luego curvas suaves.
4. **Comprobar cada paso**, sin fiarse del "success": estadísticas por canal antes y después (mediana, máximo), y el historial `view.processing` para confirmar que el proceso está aplicado. Un paso que no cambió nada no se ha hecho.
5. **Ningún canal puede acabar recortado** (máximo de un canal muy por debajo de 1 cuando los otros llegan a 1 = color destruido) y el fondo final de una galaxia debe quedar en ~0,10, de una nebulosa en ~0,15–0,25. Si se aparta mucho, volver atrás.
6. **Trabajar sobre una copia con nombre de versión**, nunca sobre el master.
7. **El dosier describe lo que dice el historial de la vista**, no lo que se pretendía: listar `view.processing` al final. No afirmar que se aplicó un proceso que falló.
8. **No inventar nombres.** Si no sabes cómo se llama un proceso o un parámetro, usa `describe_process`; si no sabes el ID de una vista, `list_open_images`. Ante la duda, pregunta.

## Orden lineal: BXT antes que NXT
- **Nunca reducir ruido antes de BXT** (RC-Astro): el ruido fino es información para la deconvolución. Orden: gradiente → BXT Correct Only → SPCC → BXT completo → SXT → NXT.
- **El NXT principal (denoise 0,70–0,80) va sobre la capa sin estrellas, en lineal, después de BXT y SXT.** Ese valor no es "suave": sobre la imagen con estrellas o antes de BXT es demasiado.
- Tras estirar, como mucho una pasada final suave (0,15–0,30). Varias pasadas suaves mejor que una fuerte (una fuerte da aspecto de cera).
- Detalle, ajustes por objeto y la rejilla de variantes: `21-bxt-nxt.md`.

## Diagnósticos que no hay que confundir
- **Fondo más azul que rojo antes de calibrar ≠ blue bloat.** Es el color del cielo y de la cámara sin calibrar; lo corrige SPCC. Blue bloat son halos azules *alrededor de las estrellas* (comparar el tamaño de las estrellas por canal).
- **Pedestales distintos por canal** (mínimos de R, G y B muy por encima de 0 y diferentes) son normales en un master OSC sin calibrar; no son un fallo de color.
- **El núcleo de una galaxia a 0,9 en lineal** se protege con máscaras o HDR, no aplastando las luces con curvas sobre toda la imagen.

## API básica (PixInsight 1.9.5+; ECMAScript 5 con el watcher clásico, v8 con el watcher v8)
```js
// Ventana y vista: los procesos se aplican a la VISTA
var w = ImageWindow.windowById("MasterLight");   // nunca es null: comprobar isNull
if (w.isNull) throw new Error("No existe MasterLight");
var v = w.mainView;                               // la vista
var img = v.image;                                // la imagen está en la vista, NO en la ventana (w.image no existe)
// o directamente: var v = View.viewById("MasterLight"); if (v.isNull) ...
// Dentro de run_script también existen findViewById(id) y findWindowByViewId(id) del watcher (devuelven null).

// Aplicar un proceso: executeOn (o executeGlobal en los que crean imágenes)
var P = new HistogramTransformation;
// ... parámetros ...
if (!P.executeOn(v)) throw new Error("HistogramTransformation no se aplicó");
// NO existen: P.process(), P.execute(), P.run(), P.apply()

// Duplicar una imagen (no existe img.clone()): ventana nueva + assign, y copiar la astrometría
var src = ImageWindow.windowById("MasterLight");
var im = src.mainView.image;
var w2 = new ImageWindow(im.width, im.height, im.numberOfChannels, 32, true, im.isColor, "M31_v3");
w2.mainView.beginProcess(); w2.mainView.image.assign(im); w2.mainView.endProcess();
w2.copyAstrometricSolution(src);   // método de la VENTANA: destino.copyAstrometricSolution(origen)
w2.show();

// Identificadores y datos de imagen: el id es de la VISTA, el formato de la IMAGEN
var id = w.mainView.id;                 // w.id no existe
var bits = img.bitsPerSample;           // 32; img.isReal indica coma flotante

// Devolver resultados: la última expresión del script (o un return) es la respuesta de run_script.
// No hace falta escribir un fichero y leerlo después.
"mediana R = " + img.median();

// Usar un icono del workspace del usuario (con sus ajustes)
var spcc = ProcessInstance.fromIcon("SPCC_RGB");
if (!spcc.executeOn(v)) throw new Error("SPCC falló");

// Estadísticas por canal
for (var c = 0; c < img.numberOfChannels; ++c) {
   img.selectedChannel = c;
   console.writeln(c + ": mediana " + img.median() + " max " + img.maximum());
}
img.resetSelections();

// Leer píxeles de un canal (no existe getChannelData): por filas, con Float32Array
var fila = new Float32Array(img.width);
img.getSamples(fila, new Rect(0, 100, img.width, 101), 0);   // fila y = 100, canal 0
var v = img.sample(50, 100, 1);                                // un píxel: x, y, canal
```
Métodos reales de `Image`: `median()`, `mean()`, `MAD()`, `stdDev()`, `minimum()`, `maximum()` (sobre `selectedChannel`), `resetSelections()`, `sample()`, `getSamples()`, `setSamples()` (entre `beginProcess()` y `endProcess()`), `assign()`. Cualquier otro nombre, antes de usarlo, compruébalo.

## Qué es un proceso y qué es un script
- **Procesos** (se ejecutan desde el watcher con `new Nombre` o `ProcessInstance.fromIcon`): BlurXTerminator, NoiseXTerminator, StarXTerminator, SpectrophotometricColorCalibration, SpectrophotometricFluxCalibration, MultiscaleGradientCorrection, MultiscaleAdaptiveStretch, GeneralizedHyperbolicStretch, HistogramTransformation, CurvesTransformation, PixelMath, LocalHistogramEqualization, HDRMultiscaleTransform, HDRComposition, NarrowbandNormalization, AutomaticBackgroundExtractor, DynamicBackgroundExtraction, SCNR.
- **Scripts** (NO se pueden lanzar desde el watcher; los lanza el usuario con el watcher **parado**, porque mientras corre, aunque esté en pausa, el menú Script está bloqueado): ImageSolver, WBPP, DBXtract, AutoPalette Studio, Perfect Palette Picker, Star Stretch y el resto de SetiAstro.
- **BlindSolver** es la excepción: su motor va incluido en el watcher v8 y se usa con `blindSolve("<vista>")` (ver abajo).
- **GraXpert** es un programa externo: su script de PixInsight no se lanza desde el watcher, pero el ejecutable sí, con `guia/herramientas/graxpert.js` (`20-graxpert-comparativa-gradientes.md`).
- Si un proceso "no existe", casi siempre el nombre está mal (p. ej. es `GeneralizedHyperbolicStretch`, no `GreenHyperbolicStretch`): `describe_process` sugiere el real.

## Requisitos que hacen fallar pasos
- **SPCC/SPFC/MGC necesitan solución astrométrica.** Sin ella fallan ("The image has no valid astrometric solution"). Recortar, rotar, BXT y GraXpert pueden eliminarla: comprobar `hasAstrometricSolution` antes de cada uno.
  - **Con el watcher v8 (PixInsight 1.9.6+): resolverla con `blindSolve`**, sin parar el watcher (~1 s):
    ```js
    var r = blindSolve("MasterLight");                                  // a ciegas
    // var r = blindSolve("MasterLight", { minScale: 1.8, maxScale: 2.3 }); // con la escala del perfil, más rápido
    // var r = blindSolve("MasterLight", { regionRA: 332.6, regionDec: 73.1, regionRadius: 5 });
    if (!ImageWindow.windowById("MasterLight").hasAstrometricSolution) throw new Error("Sin solución");
    JSON.stringify(r);   // ra, dec (grados), scale (″/px), rotation, flipped, matches, solution
    ```
    Necesita el índice astrométrico de Gaia configurado en las preferencias del proceso Gaia; si falta, el error lo dice. Resolver la imagen **con estrellas**, nunca la capa sin estrellas. Si la imagen ya tenía solución, la conserva (`solution: "existing"`) y devuelve la comparación (`centerOffsetArcsec`, `resolutionDifference`, `rotationDifference`, `parityMatch`): sirve para verificar una solución dudosa. Tras recortar, rotar, BXT o GraXpert, volver a resolver es más sencillo que trasladar la solución a mano.
  - Con el watcher clásico: el usuario resuelve con ImageSolver o BlindSolver (parando el watcher).
  - Entre imágenes con la misma geometría también vale copiarla: `ventanaDestino.copyAstrometricSolution(ventanaOrigen)` (método de la **ventana**, no de la vista) y comprobar después `ventanaDestino.hasAstrometricSolution`.
- **SPCC sólo sobre datos lineales.** Nunca calibrar una imagen ya estirada o con el color retocado: volver al master lineal.
- **SPCC: usar el icono del usuario** (`ProcessInstance.fromIcon("SPCC_RGB")`, o el de su filtro), que ya trae las curvas de cámara y filtros y la referencia de blanco. No escribir `P.whiteReferenceSpectrum = "Average Spiral Galaxy"`: ese parámetro es la tabla de datos del espectro (longitud de onda, valor…), no el nombre, y da "Parsing 32-bit floating point expression: conversion error". El nombre va en `P.whiteReferenceName`, y "Average Spiral Galaxy" ya es el valor por defecto. Un `new SpectrophotometricColorCalibration` sin más usa curvas genéricas, no las de la cámara.
- **`stretch_image` con "stf"** aplica un autoestirado real desde la v0.4.9 del watcher y se niega si la imagen ya no es lineal. Con watchers anteriores sólo cambiaba la visualización: la imagen seguía lineal.
- **`save_image`** crea la carpeta de destino desde la v0.4.5; antes, una carpeta inexistente hacía fallar el guardado en silencio.
- **Historial de una vista:** `view.processing` es un contenedor, no un array: `h.length` y `h.at(i)` (no `h[i]`); `h.at(i).toSource()` da el código del paso.
- **GHS es un proceso instalado** (`GeneralizedHyperbolicStretch`): no reprogramarlo en PixelMath. Fase 1 desde lineal:
  ```js
  var P = new GeneralizedHyperbolicStretch;
  P.stretchType = GeneralizedHyperbolicStretch.prototype.ST_GeneralisedHyperbolic;
  P.stretchChannel = GeneralizedHyperbolicStretch.prototype.SC_RGB;
  P.stretchFactor = 2.5;        // D
  P.localIntensity = 12;        // b
  P.symmetryPoint = mediana;    // SP = mediana actual (medirla antes de cada pasada)
  P.shadowProtection = 0;       // LP
  P.highlightProtection = 0.95; // HP
  if (!P.executeOn(v)) throw new Error("GHS falló");
  ```
  Antes de estirar, comprobar que la imagen sigue lineal (mediana < ~0,01). Si ya está estirada, otra fase 1 la quema: medir y seguir con las fases 2–3 (`14-estirado.md`) o con curvas suaves.
- **PixelMath no es JavaScript:** no tiene `if` (es `iif(cond, a, b)`) ni `pow` (es `^` o `exp(e*ln(b))`), y las variables (`s = 11.97; …`) hay que declararlas en `P.symbols = "s, B, SP"`; si no, da "Expected lvalue (variable) operand".
- **PixelMath por canal:** `P.useSingleExpression = false` y `P.expression` (R), `P.expression1` (G), `P.expression2` (B); dentro de cada expresión el canal es `$T`. Expresiones largas fallan en silencio: usar símbolos y comprobar el valor devuelto.
