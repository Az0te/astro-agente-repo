# Anexo A: Equivalentes de scripts

[← Índice](../SKILL.md) · Anterior: [Índice](../SKILL.md) · Siguiente: [Anexo B: Controles de calidad y checklist de entrega](B-checklist-entrega.md)

La guía no lanza scripts del menú de PixInsight. Lo que hacen los más habituales está en funciones de la guía o en procesos dentro de ellas:

| Script | Equivalente en la guía |
|---|---|
| ImageSolver / BlindSolver | `resolverAstrometria` (Paso 8 lineal) |
| WBPP | `lanzarWBPP` / `estadoWBPP` (Paso 4 lineal) |
| DBXtract / NBExtractPI | `desmezclarDualBand` (Paso 7 lineal) |
| GraXpert (script) / AutoDBE | `gradienteCandidatos` (proceso GraXpert, MGC, GradientCorrection, polinomios) o plano robusto (Paso 9 lineal) |
| Combine Ha with RGB / CombineRGBAndNarrowband / Mix SHORGB | PixelMath (Paso 10 lineal y Paso 2 no lineal) |
| PhotometricContinuumSubtraction | Fotometría de estrellas + PixelMath (Paso 16 lineal) |
| AutoPalette Studio / Perfect Palette Picker / Foraxx | Fórmulas con PixelMath (Paso 2 no lineal) |
| Statistical Stretch | MAS o GHS (Paso 1 no lineal) |
| Star Stretch | `starStretch` (Paso 1 no lineal) |
| ScreenStars | `screenStarsCombine` / `screenStarsExtract` (Pasos 8 y 9 no lineales) |
| NB to RGB Star Combination | PixelMath (Paso 8 no lineal) |
| Halo-B-Gon / Star Reduction / RepairStarCores / Repaired HSV Separation | Recetas de halos y relleno con ley de potencias (Paso 8 no lineal); HDR con tomas cortas |
| DarkStructureEnhance | `darkStructureEnhance` (Paso 5 no lineal) |
| BackgroundEnhance | `backgroundEnhance` (Paso 5 no lineal) |

`resolverAstrometria` usa el motor de BlindSolver, y las funciones de `herramientas/realces.js` (`starStretch`, `screenStarsCombine`, `screenStarsExtract`, `darkStructureEnhance`, `backgroundEnhance`) reproducen los scripts originales píxel a píxel (créditos a sus autores en el fichero).

---
