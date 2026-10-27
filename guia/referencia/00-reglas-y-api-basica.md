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

## Diagnósticos que no hay que confundir
- **Fondo más azul que rojo antes de calibrar ≠ blue bloat.** Es el color del cielo y de la cámara sin calibrar; lo corrige SPCC. Blue bloat son halos azules *alrededor de las estrellas* (comparar el tamaño de las estrellas por canal).
- **Pedestales distintos por canal** (mínimos de R, G y B muy por encima de 0 y diferentes) son normales en un master OSC sin calibrar; no son un fallo de color.
- **El núcleo de una galaxia a 0,9 en lineal** se protege con máscaras o HDR, no aplastando las luces con curvas sobre toda la imagen.

## API básica (PixInsight 1.9.5, ECMAScript 5)
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

// Usar un icono del workspace del usuario (con sus ajustes)
var spcc = ProcessInstance.fromIcon("SPCC_RGB");
if (!spcc.executeOn(v)) throw new Error("SPCC falló");

// Estadísticas por canal
for (var c = 0; c < img.numberOfChannels; ++c) {
   img.selectedChannel = c;
   console.writeln(c + ": mediana " + img.median() + " max " + img.maximum());
}
img.resetSelections();
```

## Qué es un proceso y qué es un script
- **Procesos** (se ejecutan desde el watcher con `new Nombre` o `ProcessInstance.fromIcon`): BlurXTerminator, NoiseXTerminator, StarXTerminator, SpectrophotometricColorCalibration, SpectrophotometricFluxCalibration, MultiscaleGradientCorrection, MultiscaleAdaptiveStretch, GeneralizedHyperbolicStretch, HistogramTransformation, CurvesTransformation, PixelMath, LocalHistogramEqualization, HDRMultiscaleTransform, HDRComposition, NarrowbandNormalization, AutomaticBackgroundExtractor, DynamicBackgroundExtraction, SCNR.
- **Scripts** (NO se pueden lanzar desde el watcher; los lanza el usuario pausando el watcher): ImageSolver, WBPP, DBXtract, AutoPalette Studio, GraXpert, Perfect Palette Picker, Star Stretch y el resto de SetiAstro.
- Si un proceso "no existe", casi siempre el nombre está mal (p. ej. es `GeneralizedHyperbolicStretch`, no `GreenHyperbolicStretch`): `describe_process` sugiere el real.

## Requisitos que hacen fallar pasos
- **SPCC/SPFC/MGC necesitan solución astrométrica.** Sin ella fallan ("The image has no valid astrometric solution"). Resolver con ImageSolver (lo lanza el usuario) o copiarla con `copyAstrometricSolution` desde una imagen con la misma geometría. Recortar, rotar y a veces BXT la eliminan: comprobar `w.hasAstrometricSolution` antes.
- **`stretch_image` con "stf"** aplica un autoestirado real desde la v0.4.9 del watcher y se niega si la imagen ya no es lineal. Con watchers anteriores sólo cambiaba la visualización: la imagen seguía lineal.
- **`save_image`** crea la carpeta de destino desde la v0.4.5; antes, una carpeta inexistente hacía fallar el guardado en silencio.
- **PixelMath por canal:** `P.useSingleExpression = false` y `P.expression` (R), `P.expression1` (G), `P.expression2` (B); dentro de cada expresión el canal es `$T`. Expresiones largas fallan en silencio: usar símbolos y comprobar el valor devuelto.
