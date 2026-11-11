# Anexo B: Controles de calidad y checklist de entrega

[← Índice](../SKILL.md) · Anterior: [Anexo A: Equivalentes de scripts](A-equivalentes-scripts.md) · Siguiente: [Anexo C: Pendiente de documentar](C-pendiente-documentar.md)

Medir con PJSR sobre la imagen final (o tras cada paso arriesgado) y usarlos junto a la revisión visual, no en su lugar. Umbrales de aescaffre, a ajustar con datos propios.

## B.1 Controles objetivos

| Control | Cómo se mide | Umbral |
|---|---|---|
| Ringing | Perfil radial alrededor de la zona más brillante (36 ángulos, hasta 150 px); cambios de signo de la derivada con amplitud > 0,01 | 0. Usarlo tras BXT con halos negativos, compresión multiescala, recuperación de contraste del estirado adaptativo y en la transición de una HDR |
| Núcleos quemados | % de píxeles > 0,93 en el núcleo | < 2 % en 128×128 px y < 10 % en 32×32; ningún bloque de 100×100 px con > 3 % de píxeles > 0,95 (salvo núcleos de estrellas) |
| Textura en altas luces | Desviación local y rango tonal de la zona brillante antes y después | Conservar ≥ 60 %; < 40 % = textura aplastada |
| Estrellas | FWHM mediana, diversidad de color (max−min de R,G,B normalizados en el pico), número detectado, contraste con el fondo | FWHM ≤ 8 px a la escala de trabajo, diversidad > 0,05, ≥ ~50 estrellas, contraste ≥ 3×; capa de estrellas con máximo < 0,98 |
| Croma en altas luces | Saturación en zonas con lum > 0,5 | Que no suba de forma artificial |
| Deriva de color | Tono medio del objeto (HSV, ponderado por la croma) frente al paso anterior | Giro ≤ 10° entre pasos no lineales (orientativo) |
| Muy saturados | % de píxeles con señal y croma > 0,8 | ≤ 5 % y no el doble que la versión neutra (orientativo) |
| Gamut | Valores pegados a 0 o a 1 antes y después de convertir a sRGB | La conversión no recorta más del 0,05 % |

- **Reparar en origen, no tapar después:** si un control falla, volver al punto de control anterior y repetir el paso causante más suave. Nada de recortes finales para ocultar núcleos quemados.
- **Siempre un control "sin hacer nada"** (NOVA): comparar cada paso de acabado contra la copia sin tocar del mismo punto; no aplicar un paso es un resultado válido.
- **Medir en zonas, no en toda la imagen:** regiones fijas (núcleo, brazo/filamento, fondo, estrellas sin saturar) e imágenes diferencia. Un p99 más bajo tras comprimir es compresión, no información recuperada.
- **Probar variantes** en los pasos dudosos (estirado, Hα, contraste local, saturación, umbral de HDR): 3–4 claramente distintas sobre una preview, puntuarlas y quedarse con la mejor.

## B.2 Validación

- Tríptico antes / después / diferencia: el residuo debe parecer ruido. Si contiene filamentos, estrellas o polvo, el proceso quitó señal. Controlar qué se fue con las estrellas, si el modelo de gradiente contiene cielo real, si el sharpening fabrica contornos y si el estirado crea en vez de revelar.
- Con datos de varias cámaras o exposiciones, una estructura que sólo aparece en una cámara, sesión o exposición es sospechosa: comparar los masters entre sí antes de combinar.
- Revisión crítica final puntuada (Paso 11 no lineal).

## B.3 Checklist de entrega

1. Fondo limpio, sin gradientes ni dominantes; cielo (zonas más oscuras) ~0,10 tras el estirado al fallo; la mediana de una nebulosa que llena el campo queda por encima.
2. Estrellas redondas, sin halos, con variedad de color; `hasAstrometricSolution` en el XISF final.
3. Estructura visible (filamentos, polvo, densidades) sin inventar; separación tonal núcleo–extensiones.
4. Color natural sin sobresaturar; ningún canal recortado; % de píxeles > 0,98 anotado; sin deriva de tono; la conversión a sRGB no recorta; versión neutra guardada junto a la elegida.
5. Limpieza cosmética revisada al 100–200 % (sólo artefactos confirmados). Ruido controlado sin emborronar; "sensación de 'observado', no 'procesado'".
6. Controles objetivos pasados: ringing 0, núcleos < 2 % > 0,93, textura ≥ 60 %, FWHM ≤ 8 px, ≥ 50 estrellas, contraste estrella/fondo ≥ 3×.
7. Versiones guardadas: XISF 32 bits con astrometría, TIFF 16, JPG, capas separadas, capas lineales intermedias.
8. Dossier con historial, parámetros, paleta, errores, tiempo y revisión crítica puntuada.

---
