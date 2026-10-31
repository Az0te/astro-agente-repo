# Anexo C: Pendiente de documentar

[← Índice](../SKILL.md) · Anterior: [Anexo B: Controles de calidad y checklist de entrega](B-checklist-entrega.md) · Siguiente: [Anexo D: Flujos por tipo de objeto](D-flujos-por-tipo-objeto.md)

Puntos que el flujo necesita y que todavía no están medidos ni comprobados. No se rellenan con conocimiento general: cuando se resuelva uno, se pasa al paso que corresponda y se quita de aquí.

| Punto | Estado |
|---|---|
| Nombres PJSR de los parámetros de BlurXTerminator, NoiseXTerminator, StarXTerminator, HDRComposition, StarAlignment (referencia), LinearFit (`referenceViewId`), SCNR y PixelMath (`newImageColorSpace`) | Los bloques de código los marcan: confirmarlos con `describe_process` la primera vez y corregir aquí |
| Canales de CurvesTransformation en PJSR | Sólo se conoce `Kt = CurvesTransformation.prototype.AkimaSubsplines`; si no, aplicar la curva desde un icono |
| Corrección de gradiente antes de BXT Correct Only | Es el orden del flujo; la tabla de GraXpert se midió con BXT CO previo. Comprobar en un objeto que el ganador no cambia |
| Comparativa de gradientes en nebulosas que llenan el campo | sample_free 10 aún copia un 14 % en IC 1396: sin criterio cerrado |
| Receta de sharpening no lineal (proceso, radio, amount) | Sólo están el orden, la máscara y la verificación |
| Calidad y tamaño de los JPG de entrega | Sólo está el orden: ICC sRGB y redimensionar al final |
| Número de subs integrados por grupo desde PJSR | Se lee del log de WBPP |
| Plantilla formal de inventario | Sólo están los campos (Paso 2 lineal) |
| Límite de iteraciones antes de dar un paso por perdido | El criterio es comparar contra no hacer nada (Anexo F) |
