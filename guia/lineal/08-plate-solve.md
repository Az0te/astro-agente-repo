# Paso 8: Plate solve

[← Índice](../SKILL.md) · Anterior: [Paso 7: Extracción de canales (OSC dual band)](07-extraccion-canales.md) · Siguiente: [Paso 9: Corrección de Gradiente](09-correccion-gradiente.md)

**Por qué.** SPCC, SPFC y MGC **necesitan solución astrométrica**: sin ella fallan con "The image has no valid astrometric solution". BXT y GraXpert pueden eliminarla (y recortar o rotar, con PixInsight 1.9.5 o anterior): comprobar `hasAstrometricSolution` antes de cada uno. Resolver es más barato que descubrir el fallo a mitad de SPCC.

**Orden: alinear primero (Paso 5), resolver después.** Con varios masters, resolver antes de alinear no sirve:
- StarAlignment escribe ficheros nuevos y la solución no pasa a los alineados.
- Una solución con splines (corrección de distorsión) antes del recorte abre el diálogo "irreversible" que deja el script parado.

Tras alinear, todos comparten la rejilla: basta resolver la referencia y copiar la solución a las demás. `alinearMasters` ya lo hace (`r.astrometria`). Este paso queda para un master suelto o para volver a resolver si BXT o GraXpert quitan la solución.

**Método único: `blindSolve` del watcher v8** (BlindSolver portado al watcher, PixInsight 1.9.6+). La astrometría se resuelve siempre así, desde `run_script`; no se usan ImageSolver, el script BlindSolver ni copias de otras ventanas.

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
- Desde 1.9.6, Crop, DynamicCrop, Resample y FastRotation conservan y ajustan la solución (comprobado con `blindSolve` sobre la imagen transformada: 0,05 px de diferencia). Si se pierde tras BXT o GraXpert, volver a resolver es más sencillo que trasladarla a mano.

**Si falla**

- Repetir `blindSolve` con la pista de escala del perfil (`minScale`/`maxScale`) y, si se conoce el centro (cabecera `RA`/`DEC` o el objeto), con `regionRA`/`regionDec`/`regionRadius`.
- Si da `blindSolve is not defined`, el watcher cargado no es el v8: parar y decírselo al usuario para que cargue `watcher/pixinsight-mcp-watcher-v8.js`. No sustituirlo por ImageSolver, por copias de solución ni por traslados manuales.

**En una llamada** (`herramientas/lineal.js`): `resolverAstrometria(vista, { pistas })` llama a `blindSolve` y comprueba la solución. Desde PiCopilot, los scripts que usan `blindSolve` se ejecutan sobre el watcher, así que también funciona con modelos sin herramientas.

```javascript
eval(File.readTextFile("<ruta de guia>/herramientas/lineal.js"));   // en el nivel superior del script
JSON.stringify(resolverAstrometria("MasterLight"));
```

**Control.** `hasAstrometricSolution === true` **después** de cada paso que pueda romperla (BXT, GraXpert; crop y rotación sólo antes de 1.9.6); si se ha perdido, volver a ejecutar `blindSolve`.
