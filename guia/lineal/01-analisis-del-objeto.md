# Paso 1: Análisis del objeto

[← Índice](../SKILL.md) · Anterior: [Índice](../SKILL.md) · Siguiente: [Paso 2: Inventario](02-inventario.md)

**Por qué.** El tipo de objeto decide las máscaras, el estirado, si se separan estrellas y si hacen falta tomas cortas/HDR. Procesar sin haber fijado "cuál es el tema" lleva a realzar lo que no importa y a destruir lo que sí (una nebulosa oscura con un estirado pensado para una nebulosa de emisión, por ejemplo).

**Qué hay que responder antes de tocar nada.** "Antes de procesar, clasificar el objeto y fijar qué es 'el tema' (aescaffre, target-taxonomy): tipo de señal (banda ancha, dominada por Hα, dual), zonas (núcleo–halo, filamentos, multizona), papel de las estrellas (son el objeto / contexto / distracción) y meta de señal débil (IFN, halo exterior, filamentos). Eso decide máscaras, estirado, si se separan estrellas y si hacen falta tomas cortas/HDR."

**Estrellas masivas, halos y bloat.** No se decide "a ojo": hay tres diagnósticos que no hay que confundir:

| Síntoma | Diagnóstico | Dónde se arregla |
|---|---|---|
| Fondo más azul que rojo antes de calibrar | Color del cielo y de la cámara sin calibrar, **no** blue bloat | SPCC (Paso 12) |
| Estrellas más grandes en el azul que en R/G | Blue bloat (dispersión/aberración cromática, reflexiones del filtro dual) | BXT Correct Only (Paso 11) y, si no basta, [Anexo E: blue bloat](../anexos/E-parametros-detalle.md#blue-bloat-y-halos-azules) |
| Anillos de color alrededor de una estrella brillante | Halo: nubes finas/calima en algunos subs, o reflejo instrumental | Quitar subs (Paso 3) o restar halo (Fase No Lineal 8) |
| Estrella brillante con núcleo blanco sin detalle | Saturación: en OSC los canales saturan a distinto nivel y el rojo suele saturar antes | Tomas cortas / HDRComposition (Paso 6) |

"Lo mejor es no generarlos: tomas cortas y HDR para las estrellas brillantes, y descartar subs con halos de nubes finas (índice de halo por sub)."

**Checklist del análisis**

1. Tipo de objeto y "el tema" ([Anexo D](../anexos/D-flujos-por-tipo-objeto.md): galaxia, emisión, reflexión, oscura, planetaria, resto de supernova, cúmulo, IFN).
2. ¿Hay banda estrecha? Sin ella no hay paletas.
3. Estrella más brillante del campo y magnitud: decide si hacen falta tomas cortas y a qué exposición.
4. ¿El objeto llena el campo o se difumina en el fondo? (galaxia grande, nebulosas extensas, polvo): riesgo de anillo oscuro en la corrección de gradiente y de que la IA se coma el objeto.
5. ¿Hay IFN/polvo? Desconfiar de MGC y de cualquier extractor agresivo.
6. Régimen de muestreo: submuestreado / bien muestreado / sobremuestreado (drizzle 2x), que condiciona BXT, NXT y nitidez.
7. **¿Bordes sin datos?** (`bordes_sin_datos` de `analizarMaster`). Un master registrado sin recortar tiene cuñas en los bordes; WBPP las rellena con un valor constante, no con 0, y a ojo se confunden con cielo oscuro. Con varios masters, lo primero es el [Paso 5: alinear y recortar](05-staralignment-crop.md); con uno solo, recortar los bordes. Gradiente, BXT, SPCC o desmezcla con cuñas dan resultados falsos (`gradienteCandidatos` se niega).

**Estado de partida del master**

- Por canal: mediana, máximo y MAD; además canales, bits por muestra, si es color y si tiene solución astrométrica.
- Todo eso lo devuelve `analizarMaster` (abajo); `estadisticas {vista}` da sólo las estadísticas por canal.

**Datos de la checklist en una llamada** (`herramientas/analisis.js`): cabecera (objeto, filtro, cámara), escala (de la cabecera o de la astrometría), estadísticas y píxeles saturados por canal, estrella más brillante, si es lineal y qué fracción del campo tiene señal extensa. Devuelve los datos; la interpretación de la checklist se hace después con ellos.

```json
{"llamadas": [
  {"funcion": "analizarMaster", "parametros": {"vista": "MasterLight"}}
]}
```

**Ficha del objeto en una llamada** (`documentarObjeto(vista)`, `herramientas/web.js`): junto a `analizarMaster`, siempre que haya internet. Identifica el objeto por `OBJECT` (aunque lleve texto de más, como «IC 1396 sin filtro») o, si no, por la astrometría o el RA/DEC de la cabecera, y devuelve su tipo (SIMBAD), un resumen (Wikipedia en español o inglés), la emisión esperada (rayas y filtros según el tipo, completada con el resumen: IC 1396 sale en SIMBAD como cúmulo abierto pero el resumen dice nebulosa de emisión), las estrellas de V < 6 del campo y alrededores, y los problemas que pueden dar (γ Cas, V 2,4 a 20' de IC 63: halo, reflejos, gradiente, HDR). El análisis junta las medidas con esa ficha.

```json
{"llamadas": [
  {"funcion": "analizarMaster", "parametros": {"vista": "MasterLight"}},
  {"funcion": "documentarObjeto", "parametros": {"vista": "MasterLight"}}
]}
```

**Documentarse en internet** (`herramientas/web.js`): qué es el objeto y qué señal tiene antes de decidir nada. `simbad("IC 63")` da el tipo según SIMBAD (región HII, nebulosa de reflexión, oscura, galaxia...), coordenadas, tamaño e identificadores; `wikipedia("IC 63")` el resumen del artículo (español y, si no hay, inglés), también para cámaras, telescopios y filtros; `leerWeb(url)` el texto de una página concreta (ficha del filtro o de la cámara); `imagenCatalogo("IC 63", { survey: "H-Alpha Comp", campo: 2 })` abre una imagen de catálogo de SkyView (DSS2 Red/Blue/IR, mapa Hα, WISE, 2MASS, GALEX) para saber qué Hα u otras señales esperar y distinguir estructura débil real de gradiente. Con una vista con astrometría, `imagenCatalogo("<vista>")` usa su centro y su campo. Citar siempre la fuente que devuelven. Con Claude Code el modelo tiene además WebSearch y WebFetch.

```json
{"llamadas": [
  {"funcion": "simbad", "parametros": {"objeto": "IC 63"}},
  {"funcion": "wikipedia", "parametros": {"texto": "IC 63"}},
  {"funcion": "imagenCatalogo", "parametros": {"posicion": "IC 63", "opciones": {"survey": "H-Alpha Comp", "campo": 2}}}
]}
```

`simbad` devuelve `{ tipo, ra_grados, dec_grados, … }`; `wikipedia`, `{ titulo, resumen, url }`; `imagenCatalogo` abre `Cat_H_Alpha_Comp`.
**Control.** La mediana de un master lineal está en torno a 0,001–0,02 (con pedestal puede pasar de 0,01: el de una nebulosa oscura da 0,0102). Si es mucho mayor (> 0,05), la imagen ya está estirada y no es la entrada correcta. Máximos por canal muy distintos = saturación desigual, no fallo de color.
