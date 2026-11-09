# Paso 4: Preprocesado

[← Índice](../SKILL.md) · Anterior: [Paso 3: Blink / SubframeSelector](03-blink-subframeselector.md) · Siguiente: [Paso 5: StarAlignment + crop común](05-staralignment-crop.md)

**Por qué.** "Los errores aquí no se arreglan después": un master con flats mal calibrados, darks incompatibles o grupos mezclados no se recupera en postprocesado. Todo lo que sigue en esta guía asume que el master es correcto.

**Revisión previa al WBPP (lecciones nebulosa oscura, oct 2026)** — antes de medir subs:

- **Flats por canal Bayer:** mediana y % de píxeles a 65535 en R, G1, G2, B de varios flats de cada tanda (no sólo el primero). En nebulosa oscura los 29 flats del 11-9 estaban saturados; el master flat salió plano (0,4017 en centro y esquinas) y esos lights entraron sin corrección. Comprobar también la relación esquina/centro del master flat (≈ 0,95 con el SQA106 sin filtro).
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
| Varios masters alineados | Registrarlos todos con la misma referencia común, misma escala de drizzle y Autocrop: salen alineados y recortados igual; 'Reuse last reference frames' para añadir noches |
| Rutas | Rutas y carpetas cortas; nombres de sesión con guion bajo (SESSION_1) para las grouping keywords |

**Diagnóstico de flats en el master** (para no culpar al postprocesado): viñeteo residual = subcorrección (flats sin calibrar o bias y dark restados a la vez); "viñeteo negativo" = lights sin dark; motas de polvo en relieve = rotación movida, polvo desplazado, filtro mal posicionado en la rueda (usar movimiento unidireccional) o luz parásita (probar sky flats).

**Medidas por sub.** "SubframeSelector sobre los FITS crudos CFA ordena bien, pero los valores absolutos están sesgados (en debayerizado VNG el FWHM sale ~15–20 % mayor y la excentricidad ~0,06 menor). Para umbrales absolutos, debayerizar una muestra. Fondo por sub = mediana − bias (bias con offset 50 ≈ 500 ADU). Gradiente por sub = rejilla 4×4 de medianas; en crudo incluye el viñeteo (~2,4 %). Un velo fino se ve como fondo +5–8 % con 15–18 % menos estrellas respecto a sus vecinos."

**En una llamada (PixInsight 1.9.6+)** (`herramientas/preproceso.js`):

1. `revisarCalibracion({ lights, flats, flatDarks, darks, bias })` lee las cabeceras sin abrir ventanas y mide unos pocos flats por canal Bayer. Avisa en `no_cumple` si falta el dark de la exposición de los lights, si los flats son de otro filtro o de otro telescopio (`TELESCOP`), si faltan darks de flats o bias, si un flat está saturado o si la temperatura varía más de 2 °C. Un flat por encima de 0,85 en un canal va a `revisar_a_ojo`. Los masters sin palabras clave se leen de sus propiedades XISF o del nombre ("Master Dark 300s -10C 100Ga 50Of").
2. `lanzarWBPP({ lights, flats, flatDarks, darks, salida })` arranca WBPP en **otra instancia de PixInsight en modo automatización**, que se cierra sola al acabar. No bloquea la sesión. En `lights` se puede pasar `lista_aprobados` de `seleccionarSubs` (Paso 3). La salida tiene que ser una **ruta corta**: Windows no crea ficheros de más de 256 caracteres. El resto de ajustes (drizzle, normalización local, autocrop) son los últimos guardados en WBPP; se cambian con `parametros` (nombres de la ayuda de automatización, Alt+A en la ventana de WBPP).
3. `estadoWBPP(salida)`: repetir hasta `terminado: true`; entonces abre el master de lights (el recortado si lo hay) con un STF automático. Resume el log: pasos con éxitos y fallos, errores, avisos, ficheros fallidos, masters generados y qué master dark y flat usó cada grupo.

```json
{"llamadas": [
  {"funcion": "revisarCalibracion", "parametros": {"calibracion": {"lights": "<LIGHT>", "flats": "<FLAT>", "flatDarks": "<DARK de flats>", "darks": ["<master dark>"]}}}
]}
```

Si `no_cumple` está vacío (o el usuario lo acepta), en otra respuesta:

```json
{"llamadas": [
  {"funcion": "lanzarWBPP", "parametros": {"wbpp": {"lights": "<LIGHT>", "flats": "<FLAT>", "flatDarks": "<DARK de flats>", "darks": ["<master dark>"], "salida": "C:/wbpp/objeto"}}}
]}
```

y luego, cada minuto o dos, hasta que devuelva `terminado: true`:

```json
{"llamadas": [
  {"funcion": "estadoWBPP", "parametros": {"salida": "C:/wbpp/objeto"}}
]}
```

Comprobado con una nebulosa oscura (nov 2026). En la noche del 11-9, `revisarCalibracion` encontró sin abrir ninguna imagen lo que en octubre costó una tarde: sin dark de 240 s, flats sin `FILTER`, flats con `TELESCOP` TS65Q (los lights, SQA106) y flats saturados. En la del 19-9 todo casa, con un aviso: el canal R de los flats a 0,94. En galaxia grande (7-9) detectó los flats con el azul saturado y que no había dark de 60 s. En nebulosa dual band (13-9) detectó que los flats llevan el nombre de filtro "Astodon HA 3nn" y los lights "Antlia Dualband S2 Hb 5nm", algo que WBPP no empareja. Era el mismo filtro, renombrado en NINA después de los flats: con `aliasFiltros: { "Astodon HA 3nn": "Antlia Dualband S2 Hb 5nm" }` la revisión los empareja. Para WBPP hay que corregir `FILTER` en copias de esos flats (o añadirlos a mano al grupo). WBPP con 8 lights, 10 flats y 10 darks de flats tardó 2 min.

**Sin WBPP:** el preprocesado es la cadena de procesos equivalente con los ajustes de la tabla: ImageCalibration → CosmeticCorrection → Debayer → ImageAnalysis → StarAlignment → LocalNormalization → ImageIntegration → DrizzleIntegration, todos con ficheros de entrada y carpeta de salida. Con los masters hechos, se audita el resultado:

- En el historial del master (`historial {vista}`) deben estar: ImageCalibration, Debayer (OSC), StarAlignment, LocalNormalization, ImageIntegration y, si se usó, DrizzleIntegration.
- Si falta alguno, se anota como «FALTA» y se revisa el preprocesado antes de seguir.

**Control.** Si falta `ImageCalibration`, `Debayer` o `ImageIntegration`, el "master" no es un master. Antes de seguir, comprobar el % de píxeles saturados por grupo y que la exposición más corta no esté saturada en lo que debe aportar.
