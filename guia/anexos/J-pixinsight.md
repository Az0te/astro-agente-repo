# Anexo J: cómo se hace cada paso en PixInsight

[← Índice](../SKILL.md)

Bajo demanda: el **cómo** de cada paso con PixInsight (la guía en JavaScript de `herramientas/`, el MCP `piastropilot`, PiAstroPilot y PiAstroPilot Lite). Las fichas dicen **qué** hacer, **por qué** y con **qué criterios**, con nombres neutros; aquí están las funciones de la guía, los procesos de PixInsight, los valores de referencia a mano y los ejemplos de llamada. En Siril: [Anexo I](I-siril.md).

Los ejemplos de llamada explican qué hace cada función: no se copian, se pide la función con sus parámetros. Los ids de vista (`MasterLight`, `Starless_st`…) son genéricos: usar siempre los ids reales de la lista de vistas.

<a id="arranque"></a>
## Arranque en PixInsight (leer con SKILL.md)

**Entorno.** PixInsight 1.9.6+ con el servidor MCP `piastropilot` de este repositorio (`mcp/`), el panel PiAstroPilot (módulo) o PiAstroPilot Lite (script). Con el MCP, cada función de `herramientas/` es una herramienta con su nombre (`mcp__piastropilot__analizarMaster`…; parámetros en `herramientas/manifiesto.json`); con poco contexto, el servidor puede ofrecer sólo las de la fase en curso (`PIASTROPILOT_FASE=lineal | no-lineal`). El MCP antiguo `pixinsight` (watcher, `watcher_status`, `describe_process`, `list_open_images` y su `run_script`) está retirado: no usarlo aunque aparezca. Si una función dice que falta un proceso (`typeof Proceso !== "function"`), su módulo no está cargado: avisar, no sustituirlo.

**Vistas e ids.** Los ids salen de `vistas`. Las funciones reciben el id como texto (`analizarMaster("id")`), no una ventana ni una vista. Renombrar las ventanas en la misma llamada que las crea (`nuevaVista`).

**Funciones por paso** (en negrita las que comparan)

| Paso | Funciones |
|---|---|
| L1 Análisis | `analizarMaster` + `documentarObjeto` (Internet); `simbad`, `wikipedia`, `imagenCatalogo`, `leerWeb` |
| L2 Inventario | `inventario` |
| L3 Selección de subs | `seleccionarSubs` |
| L4 Preprocesado | `revisarCalibracion` → `lanzarWBPP` → `estadoWBPP` |
| L5 Alineado y recorte | `alinearMasters`, `bordesSinDatos` |
| L6 HDR | `componerHDR` |
| L7 Canales | `desmezclarDualBand` |
| L8 Astrometría | `resolverAstrometria` (repetir tras BXT o GraXpert si `hasAstrometricSolution` es falso) |
| L9 Gradiente | **`gradienteCandidatos`** / `gradienteVarias` (GraXpert sample_free 10 y 8, GraXpert IA, GradientCorrection, MGC con astrometría, polinomio 1 y 2) |
| L10 Combinación | `combinarMasters` (`combinarMismoCanal`, `inyectarHa`) |
| L11 BXT Correct Only | `bxtCorrectOnly` |
| L12 Color | `calibrarColor` (SPCC), `neutralizarCielo` |
| L13 BXT completo | **`bxtCandidatos`** → `bxtAplicar` |
| L14 NXT suave | **`ruidoCandidatos`** (NXT 3 niveles, MLDenoise, MultiscaleTGVDenoise) → `reducirRuido` |
| L15 StarX y denoise | `separarEstrellas`; **`ruidoCandidatos`** → `reducirRuido` sobre la starless |
| L16 Continuo | `medirContinuo`, `restarContinuo` |
| L17 Checkpoint | `checkpointLineal` |
| NL1 Estirado | **`estirarCandidatos`** (GHS al fallo, MAS, Arcsinh) → `estirarCapas` (o `estirarStarless`); sólo la starless |
| NL2 Paleta | `paletasDisponibles`, `previsualizarPaletas`, `componerPaleta` |
| NL3 SCNR | `quitarVerde` |
| NL4 Máscaras | `crearMascara` (también por color) → **`aplicarConMascara`** (mezcla medida: fuga, bordes, máscara invertida) |
| NL5 Boost | **`contrasteCandidatos`** (LHE 64 y 128, HDRMT, DSE), **`nucleoCandidatos`** / `comprimirNucleo` / `medirMeseta` (galaxias, antes de saturar), **`colorCandidatos`** (versiones para elegir; dentro, `saturarAlFallo`), `saturarTono`, `derivaColor`, `backgroundEnhance`, `darkStructureEnhance` |
| NL6 NoiseX | **`ruidoCandidatos`** → `reducirRuido` |
| NL7 Nitidez | **`nitidezCandidatos`** (suave, equilibrada, acentuada; elige el usuario) |
| NL8 Estrellas | **`estirarEstrellasCandidatos`** (estira la capa lineal y saca 3 candidatos para elegir; dentro, `estirarEstrellas` y `prepararEstrellas`); `screenStarsExtract` (sacar la capa sin repetir SXT) |
| NL9 Recombinación | `recombinarEstrellas` (con controles); `screenStarsCombine` |
| NL10 Exportación | `exportarFinal` (XISF, TIFF 16 bits, JPG sRGB) |
| NL11 Dossier | `historial` |

**Siempre disponibles:** `vistas`, `estadisticas`, `historial`, `previa` (JPG para mirar la imagen), `abrirImagen`, `guardarImagen`, `cerrarVista`, `estado`, `ping`, `graxpertBGE`, `graxpertDenoise`. `pxSPCC`, `pxSPFC`, `pxMGC` y `astrometriaLineal` son internas: las usan otras funciones y no se llaman directamente. Las tablas de las funciones que comparan van en `comparados` / `candidatos`.

**Internet.** `documentarObjeto`, `simbad`, `wikipedia`, `leerWeb` e `imagenCatalogo` sólo funcionan con la casilla **Internet** del panel marcada (o sin el fichero `~/.piastropilot/sin-internet`). Con Internet, `analizarMaster` y `documentarObjeto` juntos.

**Trabajos largos y memoria.** Más de ~45 s: id de trabajo, recogerlo con `estado(trabajo)`. Dos agentes en paralelo con imágenes grandes cerraron PixInsight (c0000374). Tras pasos pesados, `cerrarVista` de las vistas temporales.

**Nombres de PixInsight de las técnicas neutras de la guía**

| En las fichas | En PixInsight |
|---|---|
| visualización automática | STF (ScreenTransferFunction); las funciones de `estirado.js` lo quitan solas |
| estirado adaptativo multiescala | MultiscaleAdaptiveStretch (MAS) |
| transformación de histograma | HistogramTransformation |
| contraste local por ecualización adaptativa | LocalHistogramEqualization (LHE) |
| compresión multiescala del rango dinámico (HDR) | HDRMultiscaleTransform (HDRMT) |
| compresión del rango por gradiente | GradientHDRCompression |
| realce de estructuras oscuras / del fondo débil | DarkStructureEnhance (DSE) / BackgroundEnhance |
| modelo de fondo con base de gradientes de referencia | MultiscaleGradientCorrection (MGC) con base MARS |
| corrección de gradiente nativa automática | GradientCorrection |
| ajuste lineal entre canales | LinearFit |
| fórmula por píxel | PixelMath |
| preprocesado automático | WBPP (WeightedBatchPreprocessing) |
| medida de subs | SubframeSelector / ImageAnalysis |
| PSF medida | DynamicPSF |
| separar y recombinar estrellas con screen exacto | ScreenStars (`screenStarsExtract` / `screenStarsCombine`) |
| máscara de estrellas | StarMask (+ MorphologicalTransformation, MultiscaleLinearTransform) |
| curvas | CurvesTransformation |
| quitar verde | SCNR |
| reducción de ruido por IA sin RC Astro / por variación total | MLDenoise / MultiscaleTGVDenoise |
| convertir a sRGB al exportar | ICCProfileTransformation |

Trampas propias de PixInsight: LHE + HDRMT juntos en la misma zona (uno u otro por zona); MGC o IA de GraXpert en nebulosas oscuras, IFN o polvo extenso; `comprimirNucleo` antes de saturar si `meseta_nucleo.radio_px` > 3; `estrellas: "extraer"` para las estrellas con el mismo estirado; SPCC sin `resolverAstrometria` o sin las curvas del perfil (`calibrarColor`).

## Nombres neutros y nombres en PixInsight

| Nombre neutro (fichas, Siril) | En las funciones de PixInsight | Qué mide |
|---|---|---|
| `copia_objeto` | `gcStructCopy`, `corr` (gradienteCandidatos) | parecido del modelo de fondo con el objeto (< 0,15 limpio; > 0,5 se lo come) |
| `objeto_quitado_pct` | `come_objeto_pct` | % de la señal del objeto que se lleva el modelo |
| `gradiente_restante` | `fondoResidual` (`deja_gradiente_pct` = ×100) | gradiente del cielo que queda, después / antes |
| `separacion` | `senal_debil_en_ruidos` | (p90 − cielo) / ruido del cielo tras estirar |
| `ruido_rel` | `ruido_baja_pct` = 100·(1 − `ruido_rel`) | ruido del cielo después / antes |
| `contraste_ganado_pct` | `contraste_x` = 1 + pct/100 | contraste local ganado en el objeto |
| `dominante_cielo_pct`, `aporte_estrellas_pct`, `no_cumple` | iguales | — |

Las funciones devuelven ya los nombres neutros; los antiguos se mantienen como alias durante una versión (nov 2026) y se quitarán.

## Por paso

- [Fase lineal](J-pixinsight/lineal.md): [Paso 1](J-pixinsight/lineal.md#lineal-01), [Paso 2](J-pixinsight/lineal.md#lineal-02), [Paso 3](J-pixinsight/lineal.md#lineal-03), [Paso 4](J-pixinsight/lineal.md#lineal-04), [Paso 5](J-pixinsight/lineal.md#lineal-05), [Paso 6](J-pixinsight/lineal.md#lineal-06), [Paso 7](J-pixinsight/lineal.md#lineal-07), [Paso 8](J-pixinsight/lineal.md#lineal-08), [Paso 9](J-pixinsight/lineal.md#lineal-09), [Paso 10](J-pixinsight/lineal.md#lineal-10), [Paso 11](J-pixinsight/lineal.md#lineal-11), [Paso 12](J-pixinsight/lineal.md#lineal-12), [Paso 13](J-pixinsight/lineal.md#lineal-13), [Paso 14](J-pixinsight/lineal.md#lineal-14), [Paso 15](J-pixinsight/lineal.md#lineal-15), [Paso 16](J-pixinsight/lineal.md#lineal-16), [Paso 17](J-pixinsight/lineal.md#lineal-17)
- [Fase no lineal](J-pixinsight/no-lineal.md): [Paso 1](J-pixinsight/no-lineal.md#no-lineal-01), [Paso 2](J-pixinsight/no-lineal.md#no-lineal-02), [Paso 3](J-pixinsight/no-lineal.md#no-lineal-03), [Paso 4](J-pixinsight/no-lineal.md#no-lineal-04), [Paso 5](J-pixinsight/no-lineal.md#no-lineal-05), [Paso 6](J-pixinsight/no-lineal.md#no-lineal-06), [Paso 8](J-pixinsight/no-lineal.md#no-lineal-08), [Paso 9](J-pixinsight/no-lineal.md#no-lineal-09), [Paso 10](J-pixinsight/no-lineal.md#no-lineal-10), [Paso 11](J-pixinsight/no-lineal.md#no-lineal-11)
