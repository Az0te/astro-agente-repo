# Paso 5: StarAlignment + crop común

[← Índice](../SKILL.md) · Anterior: [Paso 4: Preprocesado](04-preprocesado.md) · Siguiente: [Paso 6: HDRComposition](06-hdr-composition.md)

**Por qué.** Todos los masters (RGB y banda estrecha) tienen que estar en la misma rejilla de píxeles antes de combinarse; y hay que recortar los bordes de apilado antes de corregir gradientes, porque un borde negro se convierte en un gradiente artificial. "Las tomas RGB y NB pueden estar giradas entre sí y a escala distinta".

**Registro**

- "Registrar con StarAlignment **en modo fichero** (targets como ficheros, outputDirectory); `executeOn(view)` no registra." Estructura de `targets`: `[[enabled, isFile, path]]`.
- **Una sola referencia común**, la imagen con mejor resolución y SNR (normalmente la L o el Hα de la mono), con surface splines + corrección de distorsión.
- "Cada remuestreo suaviza la PSF y el ruido: **interpolar una sola vez** (Lanczos-3, en 32 bits) y no encadenar resize + registro + rotación si se puede evitar."
- Si las escalas difieren: "Registrar escalas distintas (×2) nos falló: escalar antes con Resample (Lanczos-3)". Con la razón de escalas astrométricas, un único Resample previo y luego registrar.
- Mejor aún: que salgan ya alineados del preprocesado, registrados sobre la misma referencia (Paso 4).

**Crop**

- "Recortar todos los masters a la región común antes de procesar (astro-photographie: 'Cropped' es siempre el primer paso). Si los campos difieren mucho (otro telescopio), la imagen final sólo cubre la intersección."
- Calcular el rectángulo válido de las tres.
- **Crop y rotación y la astrometría**: desde PixInsight 1.9.6, Crop, DynamicCrop, Resample, IntegerResample y FastRotation conservan la solución y la ajustan (comprobado: 0,05 px frente a una resolución nueva). Con 1.9.5 o anterior se perdía: "trasladarla copiando las propiedades `AstrometricSolution:*` con el offset (ver Flujo probado, paso 3) y `regenerateAstrometricSolution()` funcionó (residuos 0,2–0,3 px)", o volver a resolver (Paso 8).

**En una llamada** (`herramientas/alineado.js`): `alinearMasters(masters o carpeta, { referencia, salida })` trabaja sobre ficheros y no toca los originales:
1. Lee la escala de cada master, de su astrometría o del píxel y la focal. Si difiere más de un 3 % de la referencia, lo reescala antes con Resample Lanczos-3.
2. Registra con StarAlignment en modo fichero, con corrección de distorsión y Lanczos-3.
3. Calcula el rectángulo donde todos tienen datos y los recorta todos a él, también la referencia. Guarda `<nombre>_alin.xisf` en `salida`.

Al terminar abre los alineados en PixInsight con un STF automático, con la referencia delante (`abrir: false` para no abrirlos). Devuelve el rectángulo, el % del campo que se conserva, las estrellas emparejadas, los bordes a 0 y si cada uno conserva la astrometría.

```javascript
eval(File.readTextFile("<ruta de guia>/herramientas/alineado.js"));   // en el nivel superior del script
JSON.stringify(alinearMasters(["<Hα>", "<OIII>", "<RGB>"], { referencia: "<Hα>", salida: "<carpeta>/alineados" }));
```

Comprobado con IC 1396 (nov 2026; 3 masters de 300 MB en ~12 s). Un master girado 7° y desplazado, y otro binado ×2, quedaron alineados con la referencia: correlación máxima en el desplazamiento 0,0 (0,93 y 0,94). El binado se reescaló ×2 antes de registrar y conserva la astrometría.

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

**Control.** Abrir los registrados y comparar la posición de 3–4 estrellas en las esquinas; comprobar que el recorte no deja bandas negras (mediana de una franja de 20 px en cada borde ≈ mediana del fondo, no 0). Tras recortar, comprobar `hasAstrometricSolution`: con 1.9.6+ la conserva; con versiones anteriores no, y hay que resolver de nuevo (Paso 8) o trasladar la solución.
