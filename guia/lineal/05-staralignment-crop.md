# Paso 5: StarAlignment + crop común

[← Índice](../SKILL.md) · Anterior: [Paso 4: Preprocesado](04-preprocesado.md) · Siguiente: [Paso 6: HDRComposition](06-hdr-composition.md)

**Por qué.** Todos los masters (RGB y banda estrecha) tienen que estar en la misma rejilla de píxeles antes de combinarse; y hay que recortar los bordes de apilado antes de corregir gradientes, porque un borde negro se convierte en un gradiente artificial. "Las tomas RGB y NB pueden estar giradas entre sí y a escala distinta".

**Registro**

- "Registrar con StarAlignment **en modo fichero** (targets como ficheros, outputDirectory); `executeOn(view)` no registra." Estructura de `targets`: `[[enabled, isFile, path]]`.
- **Una sola referencia común**, la imagen con mejor resolución y SNR (normalmente la L o el Hα de la mono), con surface splines + corrección de distorsión.
- "Cada remuestreo suaviza la PSF y el ruido: **interpolar una sola vez** (Lanczos-3, en 32 bits) y no encadenar resize + registro + rotación si se puede evitar."
- Si las escalas difieren: "Registrar escalas distintas (×2) nos falló: escalar antes con Resample (Lanczos-3)". Con la razón de escalas astrométricas, un único Resample previo y luego registrar.
- Mejor aún: que salgan ya alineados de WBPP (Paso 4).

**Crop**

- "Recortar todos los masters a la región común antes de procesar (astro-photographie: 'Cropped' es siempre el primer paso). Si los campos difieren mucho (otro telescopio), la imagen final sólo cubre la intersección."
- Calcular el rectángulo válido de las tres.
- **Crop y rotación pierden la astrometría**: "Crop/DynamicCrop pierden la astrometría; trasladarla copiando las propiedades `AstrometricSolution:*` con el offset (ver Flujo probado, paso 3) y `regenerateAstrometricSolution()` funcionó (residuos 0,2–0,3 px)". Con watcher v8 es más simple volver a resolver (Paso 8).

**Código**

```javascript
// Registro en modo fichero: executeOn(view) NO registra.
var SA = new StarAlignment;
// targets = [[enabled, isFile, path]]; una sola referencia común para todo el proyecto.
SA.targets = [[true, true, "C:/ASTRO/IC63/LIGHT/Ha_120s_001.xisf"],
              [true, true, "C:/ASTRO/IC63/LIGHT/OIII_120s_001.xisf"]];
SA.outputDirectory = "C:/ASTRO/IC63/registered";   // ruta sin espacios si falla en silencio
SA.referenceImage = "C:/ASTRO/IC63/LIGHT/Ha_120s_ref.xisf";   // referencia común del proyecto
SA.referenceIsFile = true;
SA.distortionCorrection = true;      // con surface splines (rbfType = StarAlignment.DDMThinPlateSpline)
if (!SA.executeGlobal()) throw new Error("StarAlignment no registró");
"registro lanzado";
```

**Control.** Abrir los registrados y comparar la posición de 3–4 estrellas en las esquinas; comprobar que el recorte no deja bandas negras (mediana de una franja de 20 px en cada borde ≈ mediana del fondo, no 0). Tras recortar, la vista **no** tiene WCS: resolver de nuevo (Paso 8) o trasladar la solución.
