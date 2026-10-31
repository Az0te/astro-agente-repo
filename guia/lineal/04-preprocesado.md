# Paso 4: Preprocesado

[← Índice](../SKILL.md) · Anterior: [Paso 3: Blink / SubframeSelector](03-blink-subframeselector.md) · Siguiente: [Paso 5: StarAlignment + crop común](05-staralignment-crop.md)

**Por qué.** "Los errores aquí no se arreglan después": un master con flats mal calibrados, darks incompatibles o grupos mezclados no se recupera en postprocesado. Todo lo que sigue en esta guía asume que el master es correcto.

**Revisión previa al WBPP (lecciones LDN 1235, oct 2026)** — antes de medir subs:

- **Flats por canal Bayer:** mediana y % de píxeles a 65535 en R, G1, G2, B de varios flats de cada tanda (no sólo el primero). En LDN 1235 los 29 flats del 11-9 estaban saturados; el master flat salió plano (0,4017 en centro y esquinas) y esos lights entraron sin corrección. Comprobar también la relación esquina/centro del master flat (≈ 0,95 con el SQA106 sin filtro).
- **Un grupo por filtro:** leer la lista de subs integrados en el historial del master XISF (`ImageIntegration` dentro de `PixInsight:ProcessingHistory`). El master previo mezclaba 30 Triband + 44 sin filtro en el grupo "Nada".
- **Cobertura entre sesiones:** registrar un sub de cada sesión sobre la referencia y contar la fracción de píxeles con datos. El Triband cubría sólo el 54 % (otro centro y rotación) y dejaba zonas con distinto número de subs.
- **Darks:** comprobar en el log qué master dark usó cada grupo; la biblioteca de darks de lights puede estar en otra carpeta. Alguno con `IMAGETYP='Dark'` en vez de `Master Dark`: añadirlo con Add Custom como master.
- Las sesiones con flats inservibles no se integran; si interesan, repetir flats con el mismo rotador, foco y filtro.

**Parámetros de calibración e integración**

| Elemento | Ajuste documentado |
|---|---|
| Masters bias/dark | Integración Average, sin normalización, pesos = 1, Winsorized Sigma Clipping, sin evaluación de señal/ruido, 'Subtract pedestals' **off** |
| Darks | **Nunca precalibrar los darks con el bias** (se truncan negativos y la calibración queda mal) |
| Calibración de lights | Sin optimización de dark: `(Light − MD)/MF` sin master bias; con amp glow o refrigerada, la optimización apenas aporta |
| Aviso de optimización | "No correlation between the master dark and target frames" (k < 0,005) = los darks no sirven |
| Flats | Calibrar con master bias (o dark de flats de la misma exposición si la corriente de oscuridad no es despreciable); Average, normalización multiplicativa, rechazo con 'Equalize fluxes' |
| OSC en flats | 'Separate CFA flat scaling factors' activado (por defecto) evita el cambio de color de la corrección de flat |
| Recorte en bajas luces | Output pedestal 'Automatic' con límite 0,0001 (0,01 %) si muchos píxeles quedan a 0 |
| CosmeticCorrection | OSC con 'CFA' activado, juzgado tras debayer; Hot Sigma alto (Landmann usa 13 en su ASI2600MC; 3 daña estrellas débiles) |
| Debayer | VNG |
| Aberración cromática lateral | 'Separate RGB channels' + StarAlignment con 'Two-dimensional surface splines' y 'DDM Thin Plate Spline' (todo registrado al verde) |
| Registro | Corrección de distorsión (surface splines) con subs antes y después del meridiano; subir 'Noise reduction' de detección si hay poca SNR |
| LocalNormalization | Recomendada antes de integrar (no quita gradientes, pero facilita su corrección) |
| ImageIntegration | Average, normalización LocalNormalization, pesos 'PSF Signal Weight', rechazo según número de subs; revisar el mapa `rejection_high`; 'Large-scale pixel rejection' para trazas persistentes |
| Drizzle | Recomendado en OSC aunque no haya submuestreo (evita artefactos del debayer): escala 1 y drop shrink 1,0; 2x si hay submuestreo y muchos subs bien "ditherizados"; el mapa `drizzle_weights` debe ser uniforme |
| Varios masters alineados | Procesarlos en la misma ejecución de WBPP con referencia de registro común, misma escala de drizzle y Autocrop: salen alineados y recortados igual; 'Reuse last reference frames' para añadir noches |
| Rutas | Rutas y carpetas cortas; nombres de sesión con guion bajo (SESSION_1) para las grouping keywords |

**Diagnóstico de flats en el master** (para no culpar al postprocesado): viñeteo residual = subcorrección (flats sin calibrar o bias y dark restados a la vez); "viñeteo negativo" = lights sin dark; motas de polvo en relieve = rotación movida, polvo desplazado, filtro mal posicionado en la rueda (usar movimiento unidireccional) o luz parásita (probar sky flats).

**Medidas por sub desde el watcher.** "SubframeSelector sobre los FITS crudos CFA ordena bien, pero los valores absolutos están sesgados (en debayerizado VNG el FWHM sale ~15–20 % mayor y la excentricidad ~0,06 menor). Para umbrales absolutos, debayerizar una muestra. Fondo por sub = mediana − bias (bias con offset 50 ≈ 500 ADU). Gradiente por sub = rejilla 4×4 de medianas; en crudo incluye el viñeteo (~2,4 %). Un velo fino se ve como fondo +5–8 % con 15–18 % menos estrellas respecto a sus vecinos."

**Código.** WBPP es un **script**: no se puede lanzar desde el watcher (lo lanza el usuario con el watcher parado). Lo que sí se hace desde PJSR es auditar el resultado:

```javascript
// Auditoría del master: pasos aplicados y presencia de los procesos clave.
var v = View.viewById("MasterLight");
if (v.isNull) throw new Error("No existe MasterLight");
var h = v.processing, out = [], claves = ["ImageCalibration", "Debayer", "StarAlignment",
                                          "LocalNormalization", "ImageIntegration", "DrizzleIntegration"];
for (var k = 0; k < claves.length; ++k) {
   var hay = false;
   for (var i = 0; i < h.length; ++i) {
      if (h.at(i).toSource().indexOf(claves[k]) >= 0) { hay = true; break; }
   }
   out.push((hay ? "OK  " : "FALTA ") + claves[k]);
}
out.join("\n");
```

**Control.** Si falta `ImageCalibration`, `Debayer` o `ImageIntegration`, el "master" no es un master. Antes de seguir, comprobar el % de píxeles saturados por grupo y que la exposición más corta no esté saturada en lo que debe aportar.
