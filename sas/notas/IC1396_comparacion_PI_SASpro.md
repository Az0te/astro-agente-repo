# IC 1396: PixInsight frente a SASpro + SetiAstroPilot

14 nov 2026. Mismos masters (ASI2600MC, Sqa106, RGB + dual band HaO3, SHb, SO3). Imagen: `IC1396_comparacion_PI_SASpro.jpg`.

**Falta Siril:** la carpeta con las comparativas PixInsight / Siril del 11 nov (`tmp_comparacion\IC1396_PI_vs_Siril_Qwen_20261111`) se borró y en el disco no queda ningún final de Siril de IC 1396 a resolución completa (sólo previas de un borde). Para añadirlo hay que repetir el procesado con SirilAstroPilot.

## Versiones

| | Fichero | Flujo |
|---|---|---|
| PixInsight | `02_Resultados\IC1396_Natural_final.xisf` (26 oct) | Paleta «natural» con banda estrecha, procesado con PiAstroPilot |
| SASpro natural | `SetiAstroPilot_20261114\IC1396_v5_contraste_final.xisf` / `IC1396_SetiAstroPilot_final_2` | alinearMasters (WCS) → ABE 1 → White Balance → Hα ×1 + OIII ×1 sobre el RGB → StarNet → MTF 0,15 → Cosmic Clarity 0,35 → CLAHE 50 % → saturación +0,75 → estrellas arcsinh + screen |
| SASpro Foraxx | `SetiAstroPilot_20261114\IC1396_Foraxx_v2.xisf` / `IC1396_Foraxx_SetiAstroPilot_final_2` | capas Hα (HaO3), OIII (HaO3), SII (SO3) → ABE 1 → MTF 0,25 → Foraxx → SCNR → CLAHE 50 % → saturación +0,75 |

## Medidas (`compararFinales`, mismos criterios en las tres)

| Medida | PixInsight | SASpro natural | SASpro Foraxx |
|---|---|---|---|
| Tamaño (px) | 5948 × 3822 | 6104 × 3912 | 6104 × 3912 |
| Cielo (nivel) | 0,0095 | 0,104 | 0,145 |
| Ruido relativo (ruido / cielo) | 0,202 | 0,127 | 0,098 |
| Dominante del cielo | 118 %* | 1,2 % | 1,3 % |
| Contraste local en el objeto | 0,0150 | 0,0228 | 0,0267 |
| Saturación del objeto | 0,49 | 0,23 | 0,21 |
| Píxeles a 0 | 0,22 % | 0,001 % | 0,006 % |
| FWHM de las estrellas (px) | 5,65 | 5,97 | 5,81 |
| Píxeles de estrella | 5,3 % | 3,4 % | 3,4 % |

\* Con el cielo casi en negro (0,0095) la dominante relativa no significa nada: cualquier diferencia mínima entre canales es un porcentaje enorme.

## Lectura

- **Fondo.** PixInsight lleva el cielo casi a negro (0,0095) y recorta el 0,22 % de los píxeles a 0. SASpro lo deja en 0,10–0,15, neutro (dominante ~1 %), sin recortes: más fiel a los datos y con margen para la señal débil, pero se ve más plano y menos «contrastado» a simple vista.
- **Color de la nebulosa.** La de PixInsight es mucho más intensa: OIII turquesa muy marcado y Hα rojo (saturación 0,49 frente a 0,23). En SASpro la banda estrecha se añadió como exceso sobre el RGB con tope (no domina) y la saturación propia protege el cielo: el resultado es más sobrio. Si se quiere el aspecto de PixInsight: combinarCandidatos con intensidades mayores (1,5–2) y una saturación más fuerte con el cielo protegido.
- **Detalle.** El contraste local medido es mayor en SASpro (0,023 frente a 0,015), pero depende del nivel del estirado; las nubes oscuras y la Trompa se ven bien definidas en las dos.
- **Estrellas.** Tamaño igual (FWHM 5,6–6,0 px). PixInsight tiene más píxeles de estrella (5,3 % frente a 3,4 %): estrellas más brillantes o más grandes tras su recombinación; en SASpro el arcsinh las deja discretas.
- **Ruido.** El relativo es menor en SASpro porque su cielo es más alto; en valor absoluto los dos están limpios.

## Pendiente

- Repetir IC 1396 en Siril (SirilAstroPilot) para la comparación a tres.
- Probar en SASpro combinarCandidatos con intensidades 1,5–2 y saturación +1 para acercarse al aspecto de PixInsight, y comparar otra vez.
- El borde rojizo fino de las versiones de SASpro sale del recorte común del alineado: corregido en `alinearMasters` (margen de seguridad); las versiones de hoy lo conservan.
