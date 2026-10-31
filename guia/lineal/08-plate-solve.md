# Paso 8: Plate solve

[← Índice](../SKILL.md) · Anterior: [Paso 7: Extracción de canales (OSC dual band)](07-extraccion-canales.md) · Siguiente: [Paso 9: Corrección de Gradiente](09-correccion-gradiente.md)

**Por qué.** SPCC, SPFC y MGC **necesitan solución astrométrica**: sin ella fallan con "The image has no valid astrometric solution". Y "recortar, rotar, BXT y GraXpert pueden eliminarla: comprobar `hasAstrometricSolution` antes de cada uno". Resolver es más barato que descubrir el fallo a mitad de SPCC.

**Con watcher v8 (PixInsight 1.9.6+)**

```javascript
var r = blindSolve("MasterLight");                                  // a ciegas
// var r = blindSolve("MasterLight", { minScale: 1.8, maxScale: 2.3 }); // con la escala del perfil
// var r = blindSolve("MasterLight", { regionRA: 332.6, regionDec: 73.1, regionRadius: 5 });
if (!ImageWindow.windowById("MasterLight").hasAstrometricSolution) throw new Error("Sin solución");
JSON.stringify(r);   // ra, dec (grados), scale (″/px), rotation, flipped, matches, solution
```

- Necesita el índice astrométrico de Gaia configurado en las preferencias del proceso Gaia; si falta, el error lo dice.
- Resolver la imagen **con estrellas**, nunca la capa sin estrellas.
- Si la imagen ya tenía solución, la conserva (`solution: "existing"`) y devuelve la comparación (`centerOffsetArcsec`, `resolutionDifference`, `rotationDifference`, `parityMatch`): sirve para verificar una solución dudosa.
- "Tras recortar, rotar, BXT o GraXpert, volver a resolver es más sencillo que trasladar la solución a mano."

**Con watcher clásico.** El usuario resuelve con ImageSolver o BlindSolver, con el watcher parado. ImageSolver es un **script**: no se puede lanzar desde el watcher ("Attempt to execute a Script instance recursively").

**Alternativas**

- Entre imágenes con la misma geometría: `ventanaDestino.copyAstrometricSolution(ventanaOrigen)` (método de la **ventana**, no de la vista) y comprobar después `ventanaDestino.hasAstrometricSolution`.
- Traslado manual a una vista recortada: copiar las propiedades `AstrometricSolution:*`, `PCL:AstrometricSolution:Generation*`, `Observation:*` restando el offset del recorte a `ReferenceImageCoordinates`, `ControlPoints:Image` y a las matrices `ProjectiveTransformation` (ImageToProjection: col 2 += M·[dx,dy]; ProjectionToImage: filas 0/1 −= dx,dy·fila 2), omitir `DistortionModel`, luego `regenerateAstrometricSolution()`.

**Control.** `hasAstrometricSolution === true` **después** de cada paso que pueda romperla (crop, rotación, BXT, GraXpert). Residuos esperados del traslado manual: 0,2–0,3 px.
