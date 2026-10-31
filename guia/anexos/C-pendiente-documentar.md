# Anexo C: Pendiente de documentar

[← Índice](../SKILL.md) · Anterior: [Anexo B: Controles de calidad y checklist de entrega](B-checklist-entrega.md) · Siguiente: [Anexo D: Flujos por tipo de objeto](D-flujos-por-tipo-objeto.md)

Puntos que el flujo necesita y que todavía no están medidos ni comprobados. No se rellenan con conocimiento general: cuando se resuelva uno, se pasa al paso que corresponda y se quita de aquí.

Comprobados el 31 oct 2026 en PixInsight 1.9.6 (watcher v8) y ya corregidos en los pasos: HDRComposition (`maskBinarizingThreshold`, `maskSmoothness`, `maskGrowth`), StarAlignment (`referenceImage`, `referenceIsFile`, `distortionCorrection`), LinearFit (`referenceViewId`), SCNR, PixelMath (otras imágenes por id, `newImageColorSpace`), CurvesTransformation (canales), LocalHistogramEqualization, ICCProfileTransformation (`targetProfile`), MultiscaleGradientCorrection, MultiscaleAdaptiveStretch, SPCC y las constantes en v8 (`Clase.CONSTANTE`).

| Punto | Estado |
|---|---|
| Nombres PJSR de BlurXTerminator, NoiseXTerminator y StarXTerminator (módulo RCAstroSuite), GeneralizedHyperbolicStretch y NarrowbandNormalization | No se pudieron comprobar: en esa sesión los módulos de terceros no estaban cargados. Confirmarlos con `describe_process` y corregir los pasos 11, 13, 14 y 15 lineales y 1, 2 y 6 no lineales |
| Corrección de gradiente antes de BXT Correct Only | Es el orden del flujo; la tabla de GraXpert se midió con BXT CO previo. Comprobar en un objeto que el ganador no cambia |
| Comparativa de gradientes en nebulosas que llenan el campo | sample_free 10 aún copia un 14 % en IC 1396: sin criterio cerrado |
| Proceso GraXpert nativo (módulo `GraXpert-pxm`) | Instalado como módulo de PixInsight; probar si sustituye a `herramientas/graxpert.js` |
| Receta de sharpening no lineal (proceso, radio, amount) | Sólo están el orden, la máscara y la verificación |
| Calidad y tamaño de los JPG de entrega | Sólo está el orden: ICC sRGB y redimensionar al final |
| Número de subs integrados por grupo desde PJSR | Se lee del log de WBPP |
| Plantilla formal de inventario | Sólo están los campos (Paso 2 lineal) |
| Límite de iteraciones antes de dar un paso por perdido | El criterio es comparar contra no hacer nada (Anexo F) |
