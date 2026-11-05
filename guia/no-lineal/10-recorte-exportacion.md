# Paso 10: Recorte y exportación

[← Índice](../SKILL.md) · Anterior: [Paso 9: Recombinación](09-recombinacion.md) · Siguiente: [Paso 11: Dossier](11-dossier.md)

**Por qué.** La exportación no es un detalle: si el perfil ICC no es sRGB, los colores cambian fuera de PixInsight; si se redimensiona antes de tiempo, se pierde el criterio de nitidez; si no se guardan las capas y la versión XISF con astrometría, no se puede rehacer.

**Antes de exportar**

- "Recortes a 100 % en fondo, núcleo de la estrella más brillante y zona de nebulosa; % de píxeles saturados; controles objetivos de arriba; comparar con la versión anterior (diferencias por zonas)."
- "Guardar cada versión con nuevo nombre: XISF 32 bits con astrometría, TIFF 16 bits, JPG y capas separadas (nebulosa sin estrellas y estrellas). Guardar también capas lineales intermedias (incluida la HDR y sus máscaras)."
- "Antes de exportar JPG/TIFF para web o impresión: **ICCProfileTransformation a sRGB** (perfil incrustado), para que los colores se vean igual fuera de PixInsight. Redimensionar sólo al final."

**Cuidados de PJSR**

- "`window.saveAs` no guarda el historial de procesos en el XISF: anotar los parámetros en el dossier".
- Desde PixInsight 1.9.6, Crop, DynamicCrop (también girado), Resample y FastRotation **conservan la astrometría** y la ajustan al nuevo marco. Comprobado (IC 1396, nov 2026): tras Crop + Resample 0,5 + DynamicCrop de 10°, una nueva resolución coincide con la heredada a 0,05 px; tras FastRotation 180°, igual que el original. Con 1.9.5 o anterior se perdía y `FastRotation` sobre una ventana con astrometría llegó a colgar el watcher: girar con PixelMath `pixel($T, w()-1-x(), h()-1-y())`.

**Código**

```javascript
// Perfil de salida y guardado de la versión final.
var v = View.viewById("Final");
if (!v || v.isNull) throw new Error("No existe Final");
var icc = new ICCProfileTransformation;
icc.targetProfile = "sRGB IEC61966-2.1";   // comprobado en PixInsight 1.9.6
icc.toDefaultProfile = false;
if (!icc.executeOn(v)) throw new Error("ICC sRGB falló");
var w = ImageWindow.windowById("Final");
if (!w.saveAs("C:/ASTRO/IC63/final/IC63_v4.xisf", false, false, false, false))
   throw new Error("No se pudo guardar el XISF");
"guardado: sin historial en el XISF, anotar los parámetros en el dossier";
```

**En una llamada** (`herramientas/exportar.js`): `exportarFinal("Final", { carpeta, nombre, girar180 })` comprueba saturados y bordes negros, guarda el XISF 32 bits con astrometría y, sobre una copia en sRGB (y girada 180° con FastRotation si se pide), el TIFF 16 bits y el JPG. Crea la carpeta antes de guardar y no sobrescribe (añade _2). Recomendado para modelos sin herramientas.

```javascript
eval(File.readTextFile("<ruta de guia>/herramientas/exportar.js"));   // en el nivel superior del script
var r = exportarFinal("Final", { carpeta: "<carpeta de la versión>/final", nombre: "IC63_v4", girar180: false });
JSON.stringify(r);   // ficheros (con tamaño), controles, no_cumple
```

**Control.** Abrir el JPG/TIFF exportado en un visor externo y comparar con PixInsight (si cambia, el ICC no está incrustado). Comprobar dimensiones y que el recorte no deja bordes negros ni bandas de máscara.

**Pendiente:** calidad y tamaño de los JPG de entrega (Anexo C); sólo está fijado el orden: ICC y redimensionado al final.
