# Paso 8: Plate solve

[← Índice](../SKILL.md) · Anterior: [Paso 7: Extracción de canales (OSC dual band)](07-extraccion-canales.md) · Siguiente: [Paso 9: Corrección de Gradiente](09-correccion-gradiente.md)

**Por qué.** SPCC, SPFC y MGC **necesitan solución astrométrica**: sin ella fallan con "The image has no valid astrometric solution". BXT y GraXpert pueden eliminarla (y recortar o rotar, con PixInsight 1.9.5 o anterior): comprobar `hasAstrometricSolution` antes de cada uno. Resolver es más barato que descubrir el fallo a mitad de SPCC.

**Orden: alinear primero (Paso 5), resolver después.** Con varios masters, resolver antes de alinear no sirve:
- StarAlignment escribe ficheros nuevos y la solución no pasa a los alineados.
- Una solución con splines (corrección de distorsión) antes del recorte abre el diálogo "irreversible" que deja el proceso parado.

Tras alinear, todos comparten la rejilla: basta resolver la referencia y copiar la solución a las demás. `alinearMasters` ya lo hace (`r.astrometria`). Este paso queda para un master suelto o para volver a resolver si BXT o GraXpert quitan la solución.

**Método único: `resolverAstrometria` / `blindSolve`** (motor de BlindSolver portado a la guía, PixInsight 1.9.6+). Con el MCP o desde el panel, la función `resolverAstrometria`; no se usan ImageSolver, el script BlindSolver ni copias de otras ventanas.

```json
{"llamadas": [
  {"funcion": "resolverAstrometria", "parametros": {"vista": "MasterLight"}}
]}
```

Con pistas: `"opciones": {"pistas": {"minScale": 1.8, "maxScale": 2.3}}` (escala del perfil) o `{"regionRA": 332.6, "regionDec": 73.1, "regionRadius": 5}`. Devuelve ra, dec (grados), escala (″/px), rotación, si está volteada y las estrellas casadas.

- Necesita el índice astrométrico de Gaia configurado en las preferencias del proceso Gaia; si falta, el error lo dice.
- Resolver la imagen **con estrellas**, nunca la capa sin estrellas.
- Si la imagen ya tenía solución, la conserva (`solution: "existing"`) y devuelve la comparación (`centerOffsetArcsec`, `resolutionDifference`, `rotationDifference`, `parityMatch`): sirve para verificar una solución dudosa.
- Desde 1.9.6, Crop, DynamicCrop, Resample y FastRotation conservan y ajustan la solución (comprobado con `blindSolve` sobre la imagen transformada: 0,05 px de diferencia). Si se pierde tras BXT o GraXpert, volver a resolver es más sencillo que trasladarla a mano.

**Si falla**

- Repetir `resolverAstrometria` con la pista de escala del perfil (`minScale`/`maxScale`) y, si se conoce el centro (cabecera `RA`/`DEC` o el objeto), con `regionRA`/`regionDec`/`regionRadius`.
- Si dice que `blindSolve` no está disponible, la función no está corriendo con el runner de picopilot: parar y avisar. No sustituirlo por ImageSolver, por copias de solución ni por traslados manuales.

**En una llamada** (`herramientas/lineal.js`): `resolverAstrometria(vista, { pistas })` llama a `blindSolve` y comprueba la solución. Funciona igual desde el MCP `picopilot` y desde el panel PiCopilot.

**Control.** `hasAstrometricSolution === true` **después** de cada paso que pueda romperla (BXT, GraXpert; crop y rotación sólo antes de 1.9.6); si se ha perdido, volver a pedir `resolverAstrometria`.
