# Anexo J (PixInsight): fase lineal

[← Anexo J](../J-pixinsight.md) · [← Índice](../../SKILL.md)

<a id="lineal-01"></a>
### Fase lineal · Paso 1: Análisis del objeto

Ficha: [lineal/01-analisis-del-objeto.md](../../lineal/01-analisis-del-objeto.md)

**Datos de la checklist en una llamada** (`herramientas/analisis.js`): cabecera (objeto, filtro, cámara), escala (de la cabecera o de la astrometría), estadísticas y píxeles saturados por canal, estrella más brillante, si es lineal y qué fracción del campo tiene señal extensa. Devuelve los datos; la interpretación de la checklist se hace después con ellos.

```json
{"llamadas": [
  {"funcion": "analizarMaster", "parametros": {"vista": "MasterLight"}}
]}
```

**Ficha del objeto en una llamada** (`documentarObjeto(vista)`, `herramientas/web.js`): junto a `analizarMaster`, siempre que haya internet. Identifica el objeto por `OBJECT` (aunque lleve texto de más, como «<objeto> sin filtro») o, si no, por la astrometría o el RA/DEC de la cabecera, y devuelve su tipo (SIMBAD), un resumen (Wikipedia en español o inglés), la emisión esperada (rayas y filtros según el tipo, completada con el resumen: una nebulosa de emisión con cúmulo puede salir en SIMBAD como cúmulo abierto y el resumen decir nebulosa de emisión), las estrellas de V < 6 del campo y alrededores, y los problemas que pueden dar (una estrella de V 2,4 a 20' del objeto: halo, reflejos, gradiente, HDR). El análisis junta las medidas con esa ficha.

```json
{"llamadas": [
  {"funcion": "analizarMaster", "parametros": {"vista": "MasterLight"}},
  {"funcion": "documentarObjeto", "parametros": {"vista": "MasterLight"}}
]}
```

**Documentarse en internet** (`herramientas/web.js`): qué es el objeto y qué señal tiene antes de decidir nada. `simbad("<objeto>")` da el tipo según SIMBAD (región HII, nebulosa de reflexión, oscura, galaxia...), coordenadas, tamaño e identificadores; `wikipedia("<objeto>")` el resumen del artículo (español y, si no hay, inglés), también para cámaras, telescopios y filtros; `leerWeb(url)` el texto de una página concreta (ficha del filtro o de la cámara); `imagenCatalogo("<objeto>", { survey: "H-Alpha Comp", campo: 2 })` abre una imagen de catálogo de SkyView (DSS2 Red/Blue/IR, mapa Hα, WISE, 2MASS, GALEX) para saber qué Hα u otras señales esperar y distinguir estructura débil real de gradiente. Con una vista con astrometría, `imagenCatalogo("<vista>")` usa su centro y su campo. Citar siempre la fuente que devuelven. Con Claude Code el modelo tiene además WebSearch y WebFetch.

```json
{"llamadas": [
  {"funcion": "simbad", "parametros": {"objeto": "<objeto>"}},
  {"funcion": "wikipedia", "parametros": {"texto": "<objeto>"}},
  {"funcion": "imagenCatalogo", "parametros": {"posicion": "<objeto>", "opciones": {"survey": "H-Alpha Comp", "campo": 2}}}
]}
```

`simbad` devuelve `{ tipo, ra_grados, dec_grados, … }`; `wikipedia`, `{ titulo, resumen, url }`; `imagenCatalogo` abre `Cat_H_Alpha_Comp`.

**Bordes sin datos y estadísticas.** `analizarMaster` devuelve `bordes_sin_datos`. WBPP rellena las cuñas del registro con un valor constante, no con 0; con cuñas, `gradienteCandidatos` se niega. `estadisticas {vista}` da sólo las estadísticas por canal.

<a id="lineal-02"></a>
### Fase lineal · Paso 2: Inventario

Ficha: [lineal/02-inventario.md](../../lineal/02-inventario.md)

**En una llamada** (`herramientas/preproceso.js`): `inventario(carpeta del objeto, { darks, aliasFiltros })` lee sólo las cabeceras de todas las subcarpetas, en ~1 s para 1100 ficheros. Se salta `_proc`, `_rechazados` y las salidas de WBPP. Devuelve:
- el equipo: cámara, OSC o mono, píxel, focal, escala y programa de captura;
- un grupo de lights por noche, filtro, exposición, gain, offset, binning y telescopio, con horas, temperaturas, rotador y cuántos flats y darks compatibles tiene;
- la calibración disponible y las horas por filtro y exposición.

La biblioteca de darks suele estar fuera de la carpeta del objeto: pasarla en `darks`.

```json
{"llamadas": [
  {"funcion": "inventario", "parametros": {"carpeta": "<carpeta del objeto>", "opciones": {"darks": "<carpeta de master darks>"}}}
]}
```

**Historial del master.** Para listar vistas abiertas, `vistas`. Para ver si un master contiene una integración: `historial {vista}` recorre `view.processing` y cuenta los pasos con `ImageIntegration`. Sin ninguno, no ha pasado por WBPP o se guardó con `window.saveAs`, que no guarda el historial de procesos en el XISF. Los subs integrados por grupo se leen del log de WBPP.

<a id="lineal-03"></a>
### Fase lineal · Paso 3: Selección de subs (Blink / SubframeSelector)

Ficha: [lineal/03-blink-subframeselector.md](../../lineal/03-blink-subframeselector.md)

**En una llamada (PixInsight 1.9.6+, ImageAnalysis)** (`herramientas/preproceso.js`): `seleccionarSubs(carpeta o lista, { csv })` mide los subs con ImageAnalysis (sin abrir ventanas, ~1 s por sub) y, dentro de cada grupo de carpeta, filtro y exposición, rechaza por FWHM > cuartil inferior + 50 %, excentricidad > mediana + 0,10 o extinción por nubes con z robusto > 2,5. Con FWHM entre +35 y +50 % , excentricidad entre +0,07 y +0,10 o nubes con z entre 1,5 y 2,5 los aprueba, pero los lista en `dudosos` para que decida el usuario. En subs crudos CFA la excentricidad sube cuando las estrellas son más pequeñas: en una galaxia grande los subs de mejor FWHM tenían +0,08. Devuelve el número de aprobados y `lista_aprobados` (fichero con una ruta por línea, para WBPP), rechazados con su motivo, pesos (PSF Signal Weight relativo) y los subs con trazos (sólo anotados). ImageAnalysis sustituye a SubframeSelector.

```json
{"llamadas": [
  {"funcion": "seleccionarSubs", "parametros": {"subs": "<carpeta LIGHT de una noche>", "opciones": {"csv": "<carpeta>/seleccion.csv"}}}
]}
```

**Nombres de PixInsight.** La revisión visual es Blink; las métricas, SubframeSelector o ImageAnalysis. Los descartes van fuera de las carpetas LIGHT porque WBPP añade directorios de forma recursiva. En el índice de halo, el binado ×2 es `IntegerResample −2 (Average)`. WBPP con pesos 'PSF Signal Weight' ya da poco peso a los subs nublados, y su SubframeSelector llegó a descartar por su cuenta ~65 de 204 subs de un dual band: revisarlo en el log de WBPP.

<a id="lineal-04"></a>
### Fase lineal · Paso 4: Preprocesado

Ficha: [lineal/04-preprocesado.md](../../lineal/04-preprocesado.md)

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

Comprobado (nov 2026): en una nebulosa oscura `revisarCalibracion` detectó flats con `TELESCOP` TS65Q (los lights, SQA106); en la noche del 19-9 todo casaba, con un aviso: el canal R de los flats a 0,94. En una nebulosa dual band los flats llevaban el filtro "Astodon HA 3nn" y los lights "Antlia Dualband S2 Hb 5nm", algo que WBPP no empareja: con `aliasFiltros: { "Astodon HA 3nn": "Antlia Dualband S2 Hb 5nm" }` la revisión los empareja; para WBPP hay que corregir `FILTER` en copias de esos flats (o añadirlos a mano al grupo). WBPP con 8 lights, 10 flats y 10 darks de flats tardó 2 min.

**Nombres de PixInsight de la tabla de la ficha.** Integración = ImageIntegration ('Subtract pedestals' off en bias/dark; 'Equalize fluxes' en flats; 'PSF Signal Weight'; mapa `rejection_high`; 'Large-scale pixel rejection'); 'Separate CFA flat scaling factors' (por defecto); Output pedestal 'Automatic'; CosmeticCorrection con 'CFA' y Hot Sigma; 'Separate RGB channels' + StarAlignment con 'Two-dimensional surface splines' y 'DDM Thin Plate Spline'; 'Noise reduction' de detección; LocalNormalization; DrizzleIntegration (mapa `drizzle_weights`); Autocrop y 'Reuse last reference frames' en WBPP para añadir noches; grouping keywords. Un master dark con `IMAGETYP='Dark'` se añade con Add Custom como master. La lista de subs integrados está en el historial del XISF (`ImageIntegration` dentro de `PixInsight:ProcessingHistory`). Las métricas por sub sobre CFA son las de SubframeSelector.

**Sin WBPP:** ImageCalibration → CosmeticCorrection → Debayer → ImageAnalysis → StarAlignment → LocalNormalization → ImageIntegration → DrizzleIntegration; después `historial {vista}` del master debe listar ImageCalibration, Debayer (OSC), StarAlignment, LocalNormalization, ImageIntegration y, si se usó, DrizzleIntegration.

<a id="lineal-05"></a>
### Fase lineal · Paso 5: Alineado y recorte común (StarAlignment + Crop)

Ficha: [lineal/05-staralignment-crop.md](../../lineal/05-staralignment-crop.md)

**En una llamada** (`herramientas/alineado.js`): `alinearMasters(masters o carpeta, { referencia, salida })` trabaja sobre ficheros y no toca los originales. También acepta ids de vistas abiertas: usa su fichero si está guardado y sin cambios, y si no, guarda antes una copia temporal. Sin `salida`, crea `alineados` junto a la referencia.
1. Lee la escala de cada master, de su astrometría o del píxel y la focal. Si difiere más de un 3 % de la referencia, lo reescala antes con Resample Lanczos-3.
2. Registra con StarAlignment en modo fichero, con corrección de distorsión y Lanczos-3.
3. Calcula el rectángulo donde todos tienen datos y los recorta todos a él, también la referencia. Guarda `<nombre>_alin.xisf` en `salida`. "Sin datos" es 0 **o el relleno de WBPP**: WBPP no deja la cuña a 0 sino a un valor constante igual en los tres canales (nebulosa dual band, SO3: 0,0008361), que a ojo parece cielo oscuro. Buscando sólo ceros, la cuña del SO3 (142/111/88/43 px) se quedaba dentro; ahora el recorte es 6113×3918 y ninguno de los 4 masters tiene bordes vacíos. Además recorta las **franjas con menos cobertura de apilado**. No están vacías, pero su fondo o su ruido se apartan del interior: en una nebulosa dual band, el HaO3 tenía una franja a la derecha un 21 % más oscura (~60 px) y el SO3 franjas más claras y ruidosas en las esquinas (hasta ~100 px). `bandaBorde` las busca así:
- Mira 12 tramos por borde y busca un escalón en la mediana o en la MAD de líneas de 2 px.
- No cuenta el halo de una estrella junto al borde, porque sólo afecta a un tramo.
- Hace dos pasadas.

**A mano en PixInsight (valores de referencia)**

- StarAlignment en modo fichero (`executeOn` sobre una vista NO registra): cada objetivo como fichero y una sola referencia común para todo el proyecto.
- Carpeta de salida sin espacios si falla en silencio.
- `distortionCorrection` activado, con surface splines (thin plate).
- Estructura de `targets`: `[[enabled, isFile, path]]`; `executeOn(view)` no registra.
- Escalas distintas (×2): escalar antes con Resample (Lanczos-3).

**Astrometría con splines.** No se puede transformar: Crop, Resample y los demás abren el diálogo "Some of these side effects could be irreversible. Proceed?", que **deja el proceso parado** esperando a que alguien pulse. Antes de recortar o reescalar hay que reducir la solución a su parte lineal (`astrometriaLineal`; lo hace `alinearMasters` por dentro): en una nebulosa de emisión y reflexión, tras IntegerResample ×2 coincidía con una resolución nueva a 0,11 px. Desde PixInsight 1.9.6, Crop, DynamicCrop, Resample, IntegerResample y FastRotation conservan la solución y la ajustan (0,05 px frente a una resolución nueva). Con 1.9.5 o anterior se perdía: trasladarla copiando las propiedades `AstrometricSolution:*` con el offset y `regenerateAstrometricSolution()` (residuos 0,2–0,3 px), o volver a resolver (Paso 8).

Al terminar, `alinearMasters` abre los alineados con un STF automático, con la referencia delante (`abrir: false` para no abrirlos; `franjas: false` para no buscar franjas). Devuelve el rectángulo, el % del campo que se conserva, las estrellas emparejadas, los bordes a 0 y si cada uno conserva la astrometría.

```json
{"llamadas": [
  {"funcion": "alinearMasters", "parametros": {"masters": ["<Hα>", "<OIII>", "<RGB>"], "opciones": {"referencia": "<Hα>", "salida": "<carpeta>/alineados"}}}
]}
```

Control: `bordesSinDatos(vista)` (también en `analizarMaster`) debe dar `hay: false`; el relleno de WBPP no es 0. Tras recortar, `hasAstrometricSolution`.

<a id="lineal-06"></a>
### Fase lineal · Paso 6: Composición HDR (HDRComposition)

Ficha: [lineal/06-hdr-composition.md](../../lineal/06-hdr-composition.md)

**En una llamada** (`herramientas/hdr.js`): `componerHDR([larga, corta] o carpeta, { nuevaVista })` trabaja con los masters ya alineados (Paso 5, `alinearMasters`) y hace esto:
- Los ordena por exposición (`EXPTIME`, o el número del nombre: "L120", "S30").
- Mide la meseta de saturación por canal de la larga y pone el umbral en 0,9 × la más baja. Así sustituye en cuanto satura cualquier canal, como pide OSC.
- Lanza HDRComposition (suavizado 7, crecimiento 1) y comprueba el resultado: n−1 máscaras, % del campo sustituido, razón de flujo larga/corta, escalón en la transición (HDR frente a la corta escalada, aviso si pasa del 3 %) y si la corta también satura.

```json
{"llamadas": [
  {"funcion": "componerHDR", "parametros": {"masters": ["<master 120 s alineado>", "<master 30 s alineado>"], "opciones": {"nuevaVista": "HDR"}}}
]}
```

**A mano en PixInsight (valores de referencia)**

- HDRComposition con las imágenes de mayor a menor exposición.
- `maskBinarizingThreshold` 0,80: por debajo de la meseta medida por canal (0,89–0,96).
- `maskSmoothness` 7 (suavizado de la transición) y `maskGrowth` 1. Crea `HDR` y `HDR_mask01` (tarda > 60 s en modo global con las rutas de los masters).
- El resultado lineal se ve muy oscuro: STF de 24 bits para verlo. "cannot integrate further images" = falta una máscara → bajar `maskBinarizingThreshold`. 'Fitting region' acelera y mejora el ajuste si hay bordes malos. Gradientes distintos entre tomas: DBE/MGC en cada master antes.
- Astrometría con splines: reducirla antes con `astrometriaLineal(ventana)`; IntegerResample o recortar sin eso pide confirmación (Paso 5).
- Alternativa propia: mezcla con máscara de saturación dilatada y suavizada con PixelMath. HDR sólo en el núcleo: HDRMultiscaleTransform bajo máscara (Paso 5 no lineal).

<a id="lineal-07"></a>
### Fase lineal · Paso 7: Extracción de canales (OSC dual band)

Ficha: [lineal/07-extraccion-canales.md](../../lineal/07-extraccion-canales.md)

**En una llamada** (`herramientas/bandaestrecha.js`): `desmezclarDualBand(vista, { ponderarG })` mide los pedestales en el cielo, crea `Ha_raw` y `OIII_raw` (gris, con la solución astrométrica), cuenta las sobre-restas antes de recortar a 0 y comprueba los ratios G/R y B/R en la zona de Hα. nebulosa de emisión y reflexión (nov 2026): ratios 0,146 y 0,072, sin sobre-resta; misma estructura que DBXtract (correlación 0,96 en bloques de 16 px; DBXtract escala distinto).

```json
{"llamadas": [
  {"funcion": "desmezclarDualBand", "parametros": {"vista": "MasterLight_NB"}}
]}
```

- Suma a la salida la media de los pedestales de entrada (`pedestal_salida`). Lee FILTER o `{ filtro: "S2O3" }`; crea `SII_raw` / `OIII_raw` / `Hb_raw` y devuelve en `lineas` qué vista es cada raya.
- A mano: una imagen por raya con PixelMath, con R, G, B como `$T[0]`, `$T[1]`, `$T[2]` y los pedestales medidos antes (Hα: `1.2563*($T[0]-pR) - 0.0293*($T[1]-pG) - 0.0460*($T[2]-pB)` en una imagen nueva gris `Ha_raw`). Las expresiones largas fallan en silencio: usar símbolos y comprobar el valor devuelto.
- Dos medidas de la misma raya se combinan en el Paso 10 con `combinarMismoCanal` (LinearFit y pesos 1/σ²). Con DBXtract, fuente "DBXtract / Mono" en AutoPalette Studio, nunca "OSC Dualband".

<a id="lineal-08"></a>
### Fase lineal · Paso 8: Plate solve

Ficha: [lineal/08-plate-solve.md](../../lineal/08-plate-solve.md)

**En una llamada** (`herramientas/lineal.js`): `resolverAstrometria(vista, { pistas })` llama a `blindSolve` (motor de BlindSolver portado a la guía, PixInsight 1.9.6+) y comprueba la solución. Funciona igual desde el MCP `piastropilot` y desde el panel PiAstroPilot. No se usan ImageSolver, el script BlindSolver ni copias de otras ventanas.

```json
{"llamadas": [
  {"funcion": "resolverAstrometria", "parametros": {"vista": "MasterLight"}}
]}
```

- Pistas: `"opciones": {"pistas": {"minScale": 1.8, "maxScale": 2.3}}` (escala del perfil) o `{"regionRA": 332.6, "regionDec": 73.1, "regionRadius": 5}`.
- Necesita el índice astrométrico de Gaia configurado en las preferencias del proceso Gaia.
- Si la imagen ya tenía solución, la conserva (`solution: "existing"`) y devuelve la comparación (`centerOffsetArcsec`, `resolutionDifference`, `rotationDifference`, `parityMatch`).
- Con varios masters, `alinearMasters` copia la solución de la referencia (`r.astrometria`). StarAlignment no la pasa a los alineados, y una solución con splines antes del recorte abre el diálogo "irreversible" que deja el proceso parado (Paso 5).
- Desde 1.9.6, Crop, DynamicCrop, Resample y FastRotation conservan y ajustan la solución (0,05 px); con 1.9.5 o anterior se perdía.
- Si dice que `blindSolve` no está disponible, la función no está corriendo con el runner de piastropilot: parar y avisar.
- Control: `hasAstrometricSolution === true` tras cada paso que pueda romperla.

<a id="lineal-09"></a>
### Fase lineal · Paso 9: Corrección de Gradiente

Ficha: [lineal/09-correccion-gradiente.md](../../lineal/09-correccion-gradiente.md)

El proceso GraXpert crea `GraXpert_sample_free_background_extraction` (corregida, conserva la astrometría) y `GraXpert_background` (modelo).

| Caso | Cadena |
|---|---|
| GraXpert | Recorte → `blindSolve` → GraXpert sample_free 10 → BXT Correct Only → comprobar WCS → SPCC |
| MGC | Recorte → `blindSolve` → `pxSPFC` → `pxMGC` (base MARS del perfil) → SPCC. SPFC no sustituye a SPCC: sólo añade metadatos de brillo. Con HOO/SHO o dual band, no las bandas RGB de MARS (casi seguro falla): Hα como rojo y OIII como verde y azul cuando MARS la publique |
| Nebulosas oscuras, IFN, polvo extenso | Plano robusto grado 1 o muestras manuales; desconfiar de MGC y de la IA |
| Banda estrecha sin MGC | Polinomio sobre rejilla de medianas con rechazo sigma: grado 2 en OIII; en Hα sólo plano grado 1 en los bordes |

**Ajustes**

- **Sustracción** para contaminación lumínica (aditiva); **división** sólo para viñeteo residual. Ante la duda, probar las dos y comparar el modelo.
- Queda gradiente en el cielo → escala 8 (copia algo más, fondo más plano) o, si el residuo es liso, plano robusto grado 1 encima (no puede comerse formas).
- No usar la escala por defecto de sample_free (se comió el 18 % de una galaxia grande) ni `-sample_free_simplified true`.
- IA de GraXpert: sólo objetos pequeños en campo amplio; se come objetos extensos. Aun así entra en la comparativa: las medidas deciden.
- Con GraXpert por sustracción el fondo sale además con el color neutralizado; MGC no lo hace. Comparar el color del fondo después de SPCC.
- `herramientas/graxpert.js` (ejecutable externo) sólo para RBF, Kriging, Splines con muestras propias o denoise.

**Revisar el modelo siempre**, antes de aceptarlo: liso, sin la forma del objeto, sin bordes ni anillo oscuro. Medida: `copia_objeto` (antes `gcStructCopy`) (correlación < 0,15 limpio; > 0,5 se come el objeto) y contraste objeto−cielo en cajas de 300 px (≥ 90 % en polvo e IFN). Si no convence, hacer la comparativa de candidatos del detalle.

- GraXpert sample_free, escala 10 (8 si queda gradiente), corrección por sustracción, con el modelo de fondo aparte y sin sustituir la imagen.
- Crea `GraXpert_sample_free_background_extraction` (corregida, debe conservar la astrometría) y `GraXpert_background` (modelo).
- Revisión del modelo: estructura copiada del objeto < 0,15 = limpio (lo mide `gradienteCandidatos`).

- Orden: SPFC → MGC → SPCC; los tres necesitan solución astrométrica (sin ella, parar).
- SPFC con los filtros y la QE del perfil; MGC con la base MARS del perfil y `gradientScale` 1024 / 2048 / 4096.
- MGC crea `<vista>_MGC_gradient_model` para revisarlo.

**Comparativa en una sola llamada** (`herramientas/gradiente.js`): `gradienteCandidatos(vista, { spfc, dossier })` compara por defecto, sobre copias:
- GraXpert sample_free 10 y 8, y GraXpert con su modelo de IA (`graxpertIA: false` para quitarlo);
- GradientCorrection, el proceso nativo de PixInsight: automático, sin astrometría ni MARS, con protección de estructuras (`gradientCorrection: false` para quitarlo; `gcOpts` para sus parámetros);
- MGC 1024 y 2048, con y sin corrección de bordes;
- polinomio robusto de grado 1 y 2 por canal, ajustado fuera del objeto.

Sin astrometría, MGC no se puede probar, pero quedan 6 candidatos. En una nebulosa de emisión y reflexión sin calibrar (8 nov 2026) ganó GradientCorrection: dejó el 62 % del gradiente y se llevó el 2 % del objeto; los tres GraXpert se llevaban entre el 4 y el 6 %. `gradienteVarias` (varias vistas) conserva la tabla de la comparación en `comparados` (una fila por candidato, con `elegido`). Si el objeto llena el campo y no quedan celdas de cielo, `fondoResidual` se mide en la rejilla 4×3 de toda la imagen (lo dice `fondo_medido_en`); una medida imposible cuenta como la peor.

Mide cada uno así:
- `copia_objeto` (antes `gcStructCopy`): cuánto se parece el modelo al objeto.
- `come_objeto_pct`: % de la señal del objeto que se lleva el modelo.
- `fondoResidual`: gradiente del **cielo** que queda, en una rejilla 8×8 fuera del objeto.

Recomienda, entre los que no se comen el objeto (≤ 3 % y |corr| < 0,3), el que deja el cielo más plano. Nombra las vistas `GC_GX10`, `GC_MGC2048_borde`, `GC_POLY2`… con su `_modelo`. Si se le pasa una ruta, escribe el dossier. El resultado lleva una `leyenda` de cómo leer las medidas.

Comprobado con una galaxia grande (nov 2026, 100 s con los 8 candidatos). Reproduce la decisión de octubre:
- GraXpert 10 se lleva el **8,5 %** de la galaxia.
- MGC 2048 se lleva el 1,8 %.
- El polinomio de grado 2, el 0 %, con el cielo igual de plano (13 % del gradiente): recomendado.

Antes el gradiente que quedaba se medía en una rejilla 4×3 de toda la imagen. En objetos grandes medía la galaxia y no el gradiente, y daba por bueno a GraXpert.

```json
{"llamadas": [
  {"funcion": "gradienteCandidatos", "parametros": {"vista": "MasterLight", "opciones": {"graxpert": [10, 8], "mgc": [2048], "spfc": {}, "mars": "<base MARS del perfil>", "mgcOpts": {}, "dossier": "<ruta del dossier .json>"}}}
]}
```

`spfc`: filtros y QE del perfil; `mgcOpts`: structureSeparation y modelSmoothness del perfil. Devuelve los candidatos (`copia_objeto`, `objeto_quitado_pct`, `gradiente_restante`; durante una versión también con los nombres antiguos corr/gcStructCopy, come_objeto_pct y fondoResidual), el recomendado, el motivo y los errores.
En MGC, si la nebulosa aparece en el modelo, subir la escala; si aparece en negativo, bajarla.

**MGC en PixInsight 1.9.6+** (medido en una nebulosa oscura binada ×2, nov 2026):
- `edgeCorrection` (corrección de bordes): `gradienteCandidatos` prueba cada escala con y sin ella (`GC_MGC2048_borde`). En nebulosa oscura dejó los bordes a ±1·10⁻⁵ del centro (sin ella, hasta −5·10⁻⁵) y bajó el gradiente que queda del 83 % al 59 %, pero el modelo copia algo más el polvo (corr −0,13 → +0,16). Elegir con las medidas, y mirar el modelo en nebulosas oscuras.
- `autoScaleFactors`: ajusta a la imagen el factor de cada canal de MARS (nebulosa oscura: R 0,92, G 0,61, B 0,64), pero el modelo cambió sólo un 2–6 %. Se deja apagado; `gradienteCandidatos` devuelve en `ajuste_mars` el factor y la correlación con MARS de cada canal (correlación baja, < 0,3 = MARS se parece poco a la imagen: desconfiar de MGC).
- Sin la opción `mars`, `pxMGC` y `gradienteCandidatos` usan la base MARS configurada en las preferencias de MGC (comando de servidor `set-default-database-files`).
- Píxeles a 0 (bordes negros del registro): MGC los trata como sin datos. Siguen a 0 y la franja de al lado queda igual que si se hubiera recortado. Aun así, recortar primero (Paso 5).
- En `pxMGC`: opciones `edgeCorrection`, `edgeAggressiveness` (2) y `autoScaleFactors`; se ignoran en versiones sin ellas.

<a id="lineal-10"></a>
### Fase lineal · Paso 10: Combinación RGB / NB

Ficha: [lineal/10-combinacion-rgb-nb.md](../../lineal/10-combinacion-rgb-nb.md)

**En una llamada, con todos los masters** (`herramientas/combinacion.js`): `combinarMasters(carpeta o lista, { tipo })` trabaja con 2 a 8 masters alineados (Paso 5); LRGB son 4.
- Abre cada master y lo clasifica por su filtro (`FILTER` o el nombre): L, R, G, B, Hα, OIII, SII, Hβ o RGB (color). Si no reconoce un filtro, se le indica en `clases`.
- Combina lo que toca en lineal:
  - dos de la misma clase con `combinarMismoCanal`;
  - R, G y B mono en una RGB (ChannelCombination);
  - la RGB con el Hα y el OIII con `inyectarHa` (el OIII sólo en nebulosas; `oiii: false` para dejarlo fuera).
- Deja abiertos la L y la banda estrecha sin RGB para el Paso 2 no lineal (LRGB y paletas).
- Un dual band en color sin separar no se toma por RGB: pide `desmezclarDualBand` antes.

Comprobado con una nebulosa dual band: con R, G y B mono los junta en `RGB_comb`. La inyección del OIII en G y B se añadió el 11 nov 2026 (nebulosa de emisión que llena el campo): antes el OIII se quedaba fuera.

**Las piezas, sobre vistas** (sobre copias):

- `combinarMismoCanal(a, b, { nuevaVista })`: dos masters del mismo canal, alineados. LinearFit del segundo al primero y suma pesada por 1/σ² (ruido MRS); avisa si el ruido apenas baja (< 2 %) o si las estrellas empeoran más de un 10 %.
- `inyectarHa(rgb, ha, { tipo: "nebulosa" | "galaxia", alfa, oiii, alfaOIII, clipLow })`: RGB y Hα lineales, sin estrellas y alineados. LinearFit del Hα al R y máscara de nebulosa referida al cielo.
  - En nebulosas, `modo: "senal"` por defecto: suma la señal del Hα ajustada al R, y α 0,6 sube la nebulosa ≈ 60 %. El exceso sobre el R («suma») no aporta cuando la nebulosa llena el campo, porque el ajuste la iguala.
  - En galaxias, `modo: "suma"`. La fórmula clásica queda como `modo: "mezcla"`.
  - Con `oiii` (la vista OIII de `desmezclarDualBand`), el OIII entra en G y B a partes iguales (turquesa, como HOO), con su máscara.
  - Se niega si la «RGB» lleva `FILTER` de banda estrecha: sería el propio dual band.

```json
{"llamadas": [
  {"funcion": "inyectarHa", "parametros": {"rgb": "RGB_starless", "ha": "Ha_CS", "opciones": {"tipo": "nebulosa", "oiii": "OIII_starless", "nuevaVista": "RGB_HaO"}}}
]}
```

**A mano en PixInsight (valores de referencia)**

- Mezcla de dos masters del mismo canal: ImageIntegration con los dos, sin rechazo, pesos por estimación de ruido; o PixelMath con los pesos medidos. Normalizar antes con LocalNormalization/LinearFit.
- LinearFit del Hα a la R (vista de referencia por su id; `rejectHigh` 0,92 por defecto).
- Mezcla en R con PixelMath por canal: `(1−a)·R + a·Ha` con a = 0,2–0,6 (G y B sin tocar), bajo una máscara de nebulosa (clipLow 0,04–0,08) que se quita al terminar. En PixelMath cualquier imagen abierta se usa por su id dentro de la expresión (`Ha`, `R_starless[0]` para un canal).
- Comprobar antes `ImageWindow.windowById("mask_neb").isNull`: con un id inexistente `w.mask` no falla y el proceso se aplica **sin máscara**.
- La astrometría de cada master se resuelve con `resolverAstrometria` (`blindSolve`).

<a id="lineal-11"></a>
### Fase lineal · Paso 11: BlurX correct only

Ficha: [lineal/11-bxt-correct-only.md](../../lineal/11-bxt-correct-only.md)

**A mano en PixInsight (valores de referencia)**

- BlurXTerminator con `correct_only` activado y PSF automática (o manual con `nonstellar_diameter` = FWHM medido).
- Después, comprobar la solución astrométrica; si se ha perdido, resolverla otra vez (Paso 8) antes de SPCC. aescaffre: "BlurXTerminator elimina la solución astrométrica de la vista: tras BXT, `copyAstrometricSolution` desde el master original antes de SPFC/SPCC"; en PI 1.9.5 la conservó, y en 1.9.6 BXT Correct Only y BXT completo la conservaron (31 oct 2026). Se comprueba `hasAstrometricSolution` igual y, si falta, `resolverAstrometria` (no copiar soluciones).
- Correct Only por canal: ChannelExtraction, BXT a cada canal, ChannelCombination.
- SPFC deja en la vista `PCL:SPFC:FWHMx/FWHMy` por canal (diagnóstico de blue bloat).

**En una llamada** (`herramientas/lineal.js`): `bxtCorrectOnly(vista, { nuevaVista })` aplica BXT correct only sobre una copia y mide el FWHM por canal antes y después (sobre las mismas estrellas), el ringing de la estrella más brillante y si conserva la solución astrométrica (si no, la recupera con `blindSolve`). nebulosa dual band (nov 2026): diferencia de FWHM entre canales 0,34 → 0,24 px, sin ringing, WCS conservada.

```json
{"llamadas": [
  {"funcion": "bxtCorrectOnly", "parametros": {"vista": "MasterLight", "opciones": {"nuevaVista": "MasterLight_bxtco"}}}
]}
```

<a id="lineal-12"></a>
### Fase lineal · Paso 12: SPCC

Ficha: [lineal/12-spcc.md](../../lineal/12-spcc.md)

**A mano en PixInsight (valores de referencia)**

- Requisitos: solución astrométrica y datos lineales.
- OSC sin filtro con ventana UV/IR-cut: Sony Color Sensor R/G/B-UVIRcut y «Ideal QE curve» (valores por defecto).
- Dual band Hα/OIII 5 nm: modo narrowband con [656,3 nm, 5], [500,7, 5], [500,7, 5] y la QE del sensor.
- Probado el 31 oct 2026 (PixInsight 1.9.6): 2,4 s en 3008×3222; deja PCL:SPCC:WhiteBalanceFactors en la vista.
- Verificación: medianas del cielo por canal parecidas tras SPCC (Statistics en previews de cielo limpio).
- Curvas: `pxSPCC()` de `herramientas/procesos.js` las carga por su nombre desde la base de filtros de PixInsight (`filters.xspd`). "Un `new SpectrophotometricColorCalibration` sin más usa curvas genéricas, no las de la cámara".
- Referencia de blanco: `P.whiteReferenceName` ("Average Spiral Galaxy" por defecto). `P.whiteReferenceSpectrum` es la tabla de datos (longitud de onda, valor), **no** el nombre: da "Parsing 32-bit floating point expression: conversion error".
- Narrowband dual band: `SPCC_HA_O3_5nn`. En modo narrowband, la recomendación oficial es referencia de blanco **«Photon Flux»** en vez de «Average Spiral Galaxy» (astroimagetw); compararla si el resultado sale con dominante.
- Sin SPCC: BackgroundNeutralization + ColorCalibration.

**SPCC en una llamada** (`herramientas/color.js`, necesita `procesos.js`): comprueba la solución astrométrica y que la imagen sea lineal, aplica `pxSPCC` con los filtros del perfil sobre una copia y mide el cielo por canal antes y después, en las zonas más oscuras, comparando la diferencia con el ruido. Devuelve los filtros usados, los factores de balance de blancos, `no_cumple` y el control. Una diferencia de más de 0,5 sigmas en el cielo sale como dominante al estirar (nebulosa dual band, nov 2026: 1,1 sigmas en lineal → 19 % azul estirada). Recomendado para modelos sin herramientas.

```json
{"llamadas": [
  {"funcion": "calibrarColor", "parametros": {"vista": "MasterLight", "opciones": {"nuevaVista": "MasterLight_spcc", "spcc": {}}}}
]}
```

`spcc`: filtros y QE del perfil. Devuelve los filtros, los factores de balance de blancos, cielo antes y después, `no_cumple` y el control.


**Cielo descompensado tras SPCC** (`neutralizarCielo`, en `color.js`). Si `calibrarColor` da el cielo por encima de 0,5 sigmas, o el estirado sale con dominante en el cielo (> 5 %), se neutraliza el fondo en lineal: BackgroundNeutralization aditiva, que suma a cada canal lo que le falta para igualar su cielo al del canal más alto (no resta, no recorta sombras y no cambia el balance de SPCC más que ese desplazamiento constante). Mide en las mismas zonas que el control del estirado (el 10 % de celdas de 64 px más oscuras); si esas zonas son polvo o nebulosa oscura con color propio, pasar `rect` con un trozo de cielo limpio. Vale sobre la starless lineal, sin rehacer BXT ni SXT. No es un apaño de color: es la neutralización de fondo que la guía ya admite junto a SPCC.

```json
{"llamadas": [
  {"funcion": "neutralizarCielo", "parametros": {"vista": "Starless_dn", "opciones": {"nuevaVista": "Starless_bn"}}}
]}
```

Devuelve el cielo antes y después por canal, lo sumado a cada canal, `no_cumple` y el control.

<a id="lineal-13"></a>
### Fase lineal · Paso 13: BlurX completo

Ficha: [lineal/13-bxt-completo.md](../../lineal/13-bxt-completo.md)

**A mano en PixInsight (valores de referencia)**

- `correct_only` desactivado y PSF automática.
- `sharpen_stars` 0,30; `adjust_star_halos` 0,00 (−0,30 SOLO si hay blue bloat y sin ringing).
- `sharpen_nonstellar` 0,35 galaxia; 0,50–0,70 nebulosa; 0,45–0,55 con drizzle 2x. `overlap` 0,20.

**Rejilla y aplicación en una llamada** (`herramientas/deconvolucion.js`): `bxtCandidatos` hace la rejilla en un recorte de 1500 px (el de más señal extensa) con los valores de la tabla para el tipo de objeto y mide en cada variante el FWHM de las mismas estrellas, el ringing de la más brillante no saturada y, fuera de las estrellas, la textura nueva en el fondo (gusanos) y el detalle en el objeto respecto a BXT con nonstellar 0; recomienda el nonstellar más alto sin ringing ni gusanos. `bxtAplicar` lo aplica a una copia de la imagen entera. En nebulosa dual band (nov 2026): FWHM 4,6 → 4,1 px; el nonstellar 0,25–0,65 sólo añadía un 0,4–1,9 % de detalle, sin gusanos. Recomendado para modelos sin herramientas.

```json
{"llamadas": [
  {"funcion": "bxtCandidatos", "parametros": {"vista": "MasterLight_spcc", "opciones": {"tipo": "nebulosa"}}}
]}
```

`tipo`: "nebulosa" | "galaxia" | "cumulo" | "snr_bajo". Con su resultado, en otra respuesta:

```json
{"llamadas": [
  {"funcion": "bxtAplicar", "parametros": {"vista": "MasterLight_spcc", "opciones": {"nonstellar": "<recomendada.nonstellar>", "stars": "<recomendada.stars>", "nuevaVista": "MasterLight_bxt"}}}
]}
```

<a id="lineal-14"></a>
### Fase lineal · Paso 14: Reducción de ruido suave (NoiseX, opcional)

Ficha: [lineal/14-noisex-suave.md](../../lineal/14-noisex-suave.md)

**A mano en PixInsight (valores de referencia)**

- NoiseXTerminator: `denoise` 0,50 (pasada ligera antes de SXT), `detail` 0,15, `iterations` 2. Parámetros comprobados en 1.9.6: `iterations`, `enable_frequency_separation`, `denoise_high_freq`, `denoise_low_freq`, `frequency_scale`, `overlap`.
- BXT con PSF manual: SPFC deja `PCL:SPFC:FWHMx/FWHMy` para `nonstellar_diameter` (Paso 13).

```json
{"llamadas": [
  {"funcion": "ruidoCandidatos", "parametros": {"vista": "MasterLight_bxt", "opciones": {"nuevaVista": "MasterLight_nxt"}}}
]}
```

Opciones de `ruidoCandidatos`: `metodos` (por defecto `nxt`, `frecuencias`, `mascara`, `ml`, `tgv`), `niveles`, `tgv`, `amount`, `modelo`. La tabla está en `comparados`.

- `frecuencias` (sólo color): NXT con `enable_color_separation` y `enable_frequency_separation`; lineal intensidad 0,85 alta / 0,60 baja, color 0,95 alta / 1,0 baja, `frequency_scale` 5; estirada intensidad 0,40 / 0,30, color 0,90 / 1,0. Pone los parámetros que existan en la versión instalada y los devuelve en `parametros.aplicado`; si no hay croma de baja frecuencia, lo avisa. En `reducirRuido`: `{ frecuencias: { hf, lf, hfColor, lfColor, escala } }`.
- `mascara`: NXT 0,80 (estirada 0,45) en una copia y mezcla `original·(1 − m) + nxt·m`, con m = 1 en el cielo y la señal débil y 0 desde cielo + 20σ (rampa desde + 3σ, suavizada). En `reducirRuido`: `{ metodo: "mascara", denoise }`; devuelve la cobertura de la máscara.
- Con estrellas brillantes en la imagen (Paso 14), NXT lineal puede dañar sus núcleos: revisar al estirar o usar la máscara de estrellas del Paso 4 no lineal.

**En una llamada** (`herramientas/ruido.js`): `reducirRuido` aplica NXT sobre una copia y mide los controles de abajo: σ del cielo antes y después, contraste de la zona débil y estructura de la imagen residual (~1–2 = sólo ruido). En nebulosa dual band (nov 2026), NXT 0,50 bajó el ruido del cielo un 43 % con el contraste intacto (−0,5 %). Recomendado para modelos sin herramientas.

```json
{"llamadas": [
  {"funcion": "reducirRuido", "parametros": {"vista": "MasterLight_bxt", "opciones": {"denoise": 0.5, "detail": 0.15, "iterations": 2, "nuevaVista": "MasterLight_nxt"}}}
]}
```

Devuelve las medidas (ruido_baja_pct, contraste_zona_debil_pct, residual_estructura), `no_cumple` y el control.


**Comparar en vez de fijar el valor** (`ruidoCandidatos`, mismo fichero): prueba sobre la misma entrada NXT 0,30 / 0,50 / 0,70, MLDenoise (amount 1,0, con el modelo `.xmlm` del perfil) y MultiscaleTGVDenoise (strength 0,5 y 1,0), con las mismas medidas de `reducirRuido`, y se queda con el que más baja el ruido sin pasar del 80 % entre los que cumplen. Devuelve la tabla en `comparados`. MLDenoise es lento (~7 min en 22 MP; en un drizzle 2x de la 2600MC, mucho más): `metodos: ["nxt", "tgv"]` para dejarlo fuera. En una nebulosa de emisión y reflexión sin calibrar (8 nov 2026) ganó NXT 0,70 (−57 %); MLDenoise (−76 %) y TGV (−63 % y −75 %) quitaban más ruido, pero subían el moteado de color más de 0,3.

<a id="lineal-15"></a>
### Fase lineal · Paso 15: Separación de estrellas y ruido de la starless (StarX, MLDenoise, NXT)

Ficha: [lineal/15-starx.md](../../lineal/15-starx.md)

**A mano en PixInsight (valores de referencia)**

- StarXTerminator con `output_stars` (genera la capa de estrellas) y `unscreen` desactivado en lineal (suma exacta starless + estrellas).
- `overlap` 0,20; 0,50 sólo con estrellas muy grandes o campos densos (×3 de tiempo).
- La imagen de estrellas se llama `<id>_stars`: detectarla comparando la lista de ventanas antes y después. "`P.starmask` y `P.linear` no existen". No usar STF Auto Stretch en la imagen de estrellas.
- El denoise por IA de detalle fino (ML) de la ficha es **MLDenoise** (`modelPath` = modelo `.xmlm` del perfil, `amount` 1,0, sin caché); la variación total multiescala es **MultiscaleTGVDenoise** (1.9.6: `scales` 8, `strength` 0,6). El híbrido lo hace `reducirRuido` con `metodo: "hibrido"`. MLDenoise en RGB puede dar "cannot process RGB images".
- MLDenoise tarda ~2 min en 26 MP: pasa de 45 s y el MCP devuelve un id de trabajo (esperar con `estado(trabajo)`); con 8+ min seguidos de varios canales en una petición PixInsight dio "Invalid task termination intent" y dejó de responder.
- En RGB, `reducirRuido` con `{"denoise": 0.70}` mirando `moteado_color_despues` (no_cumple por encima de 1,5); mejor aún, `ruidoCandidatos` con `{"principal": true}`.

**En una llamada** (`herramientas/ruido.js`): `separarEstrellas` hace SXT sobre una copia (unscreen según sea lineal o no), localiza la capa de estrellas y comprueba que starless + estrellas reproduce el original; la estructura extensa de la capa de estrellas se da como orientación (en campos densos es alta sin fallo). Después, el denoise principal con `reducirRuido` (híbrido en mono con el modelo del perfil; en RGB, NXT 0,70 y mirar `moteado_color_despues`) o, mejor, con `ruidoCandidatos(s.starless, { principal: true })`, que compara NXT, MLDenoise y MultiscaleTGVDenoise y prefiere el que baja el ruido un 50–80 % cumpliendo los controles (ver [Paso 14](../../lineal/14-noisex-suave.md)).

```json
{"llamadas": [
  {"funcion": "separarEstrellas", "parametros": {"vista": "MasterLight_nxt", "opciones": {"nuevaVista": "Starless", "nuevasEstrellas": "Stars"}}},
  {"funcion": "reducirRuido", "parametros": {"vista": "Starless", "opciones": {"metodo": "hibrido", "modelo": "<.xmlm del perfil>", "nuevaVista": "Starless_dn"}}}
]}
```

<a id="lineal-16"></a>
### Fase lineal · Paso 16: Sustracción de continuo (LinearFit)

Ficha: [lineal/16-linearfit-continuo.md](../../lineal/16-linearfit-continuo.md)

**A mano en PixInsight (valores de referencia)**

La fórmula es `Ha_sub = Hα − k·R − c`. En nebulosa de emisión y reflexión, k = 0,293 y c = 0,00155; con la R de la HDR y fotometría de apertura, k = 0,332. Cambiar k con cada combinación de cámara y filtro. En PixelMath la R se usa por el id de su vista:

- PixelMath en una imagen nueva `Ha_CS`: `$T − k·RGB_starless[0] − c` sobre la starless de Hα (k y c medidos antes; ej. k = 0,293, c = 0,00155).

- Comprobación sin tocar la imagen: mediana y mínimo por canal de `Ha_CS`; un mínimo por debajo de −0,001 indica fondo negativo (k o c mal medidos).

**En una llamada** (`herramientas/bandaestrecha.js`): `medirContinuo(nbConEstrellas, rgbConEstrellas, { canal: 0 })` mide k con el procedimiento de arriba (centroide, apertura 7 px, anillo 10–14 px, mediana de ~3000 estrellas); `restarContinuo(nbStarless, rgbStarless, { k })` resta y mide los negativos y el brillo de emisión conservado. nebulosa de emisión y reflexión (nov 2026): k = 0,316 (la medida a mano fue 0,332) y la emisión conserva el 95 %.

```json
{"llamadas": [
  {"funcion": "medirContinuo", "parametros": {"nb": "Ha_raw", "continuo": "RGB_spcc", "opciones": {"canal": 0}}}
]}
```

OIII: canal 1 (G). Con el `k` que devuelva, en otra respuesta:

```json
{"llamadas": [
  {"funcion": "restarContinuo", "parametros": {"nb": "Ha_starless", "continuo": "RGB_starless", "opciones": {"k": "<k medido>", "nuevaVista": "Ha_CS"}}}
]}
```

El ajuste lineal previo con R como referencia es LinearFit.

<a id="lineal-17"></a>
### Fase lineal · Paso 17: Checkpoint

Ficha: [lineal/17-checkpoint.md](../../lineal/17-checkpoint.md)

**Informe en una llamada** (`herramientas/lineal.js`): `checkpointLineal(vista, { carpeta, objeto, version, notas })` mide la tabla de arriba (lineal, cielo por canal en sigmas, recorte, WCS, FWHM por canal, ringing, núcleos, historial), devuelve `no_cumple` y, con `carpeta`, escribe un borrador de `estado.md` para la fase no lineal.

```json
{"llamadas": [
  {"funcion": "checkpointLineal", "parametros": {"vista": "MasterLight_v3", "opciones": {"carpeta": "<carpeta de la versión>", "objeto": "<nombre del objeto>", "version": "v3"}}}
]}
```

Solución astrométrica: `hasAstrometricSolution === true`. Antes de estirar, `cerrarVista` de las temporales; a mano, `window.purge()` vacía el historial de deshacer de una ventana.
