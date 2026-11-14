# IC 1396: PixInsight, Siril y SASpro

14 nov 2026. Mismos masters (ASI2600MC, Sqa106, RGB + dual band HaO3; SII de SO3 para la Foraxx). Imagen:
`IC1396_comparacion_PI_Siril_SASpro.jpg` (la de Siril, girada en vertical para que coincida: ver «Orientación»).

## Versiones

| | Fichero | Flujo |
|---|---|---|
| PixInsight | `02_Resultados\IC1396_Natural_final.xisf` (26 oct) | Paleta natural con banda estrecha (PiAstroPilot) |
| Siril | `SirilAstroPilot_20261114\IC1396_SirilAstroPilot_final.tif` | SirilAstroPilot sin ventana (siril-cli): gradiente subsky 1 → **sin SPCC** (ver abajo) → Hα ×1 + OIII ×1 → StarNet 2 → GHS al fallo → ruido: ninguno cumple → ondículas → satu 0,75 → estrellas |
| SASpro ×2 | `SetiAstroPilot_20261114\IC1396_SetiAstroPilot_final_4.tif` | alinearMasters (margen 8 px) → ABE 1 → White Balance → Hα ×2 + OIII ×2 (máscara de señal suavizada) → StarNet → MTF 0,20 → Cosmic Clarity → CLAHE 50 % → saturación +1,75 → estrellas |
| SASpro natural | `IC1396_SetiAstroPilot_final_2.tif` (v5) | igual con Hα ×1 + OIII ×1, MTF 0,15, saturación +0,75 |
| SASpro Foraxx | `IC1396_Foraxx_SetiAstroPilot_final_2.tif` | capas Hα, OIII, SII estiradas a 0,25 → Foraxx → SCNR → CLAHE → saturación |

## Medidas (`compararFinales`, mismos criterios)

| Medida | PixInsight | Siril | SASpro ×2 | SASpro natural | SASpro Foraxx |
|---|---|---|---|---|---|
| Cielo (nivel) | 0,0095 | 0,103 | 0,138 | 0,104 | 0,145 |
| Ruido relativo | 0,202 | 0,159 | 0,091 | 0,127 | 0,098 |
| Dominante del cielo | (118 %)* | 1,1 % | 1,4 % | 1,2 % | 1,3 % |
| Contraste local del objeto | 0,0150 | 0,0267 | 0,0220 | 0,0228 | 0,0267 |
| Saturación del objeto | 0,49 | 0,36 | 0,41 | 0,23 | 0,21 |
| Píxeles a 0 | 0,22 % | 0,000 % | 0,000 % | 0,001 % | 0,006 % |
| FWHM estrellas (px) | 5,65 | 6,12 | 5,87 | 5,97 | 5,81 |
| Píxeles de estrella | 5,3 % | 3,4 % | 3,5 % | 3,4 % | 3,4 % |

\* Con el cielo casi en negro la dominante relativa no significa nada.

## Lectura

- **Aspecto.** PixInsight y SASpro ×2 se parecen: centro OIII turquesa y borde Hα rojo intenso. Siril, sin SPCC, queda
  más rojo y menos turquesa. La Foraxx es otra convención (dorado y azul).
- **Fondo.** PixInsight lleva el cielo casi a negro y recorta el 0,22 %; Siril y SASpro lo dejan en 0,10–0,15, neutro y sin
  recortes.
- **Color.** Saturación: PixInsight 0,49 > SASpro ×2 0,41 > Siril 0,36 > SASpro natural 0,23.
- **Detalle.** El contraste local medido es mayor en Siril y SASpro (0,022–0,027) que en PixInsight (0,015), aunque
  depende del nivel del estirado.
- **Estrellas.** Mismo tamaño en los tres (FWHM 5,6–6,1 px). PixInsight deja más píxeles de estrella (5,3 % frente a
  3,4 %): estrellas más brillantes tras su recombinación.
- **Ruido.** Relativo: SASpro ×2 0,09 < SASpro natural 0,13 < Siril 0,16 < PixInsight 0,20 (en parte porque el cielo de
  PixInsight es muy bajo).

## Lo que pasó por el camino

- **Siril sin ventana (siril-cli):** el puente funciona, pero `resolverAstrometria` y `calibrarColor` (SPCC) leen el
  registro de Siril, que sin ventana no existe («Log only available in GUI mode»). La versión de Siril va sin SPCC. Para
  la comparación completa, repetirla con Siril abierto (Scripts > SirilAstroPilot).
- **WBPP sin CRPIX:** los masters traen RA/DEC y CDELT pero no CRPIX; el WCS que se arma con eso no vale (centro en el
  píxel 0). Se resolvió el RGB con el índice Gaia de SASpro y se pasó a Siril como FITS con WCS completo y PLTSOLVD.
- **Orientación:** el FITS que escribe SASpro guarda las filas de arriba abajo y Siril sigue el estándar (de abajo
  arriba): en Siril la imagen sale volteada en vertical. No cambia las medidas; pendiente en SASpro.
- **Manchas en la combinación ×2:** la máscara de «dónde hay señal de banda estrecha» se calculaba píxel a píxel y salía a
  manchas de borde duro. Ahora se mide sobre la capa suavizada (final_4; final_3 tiene las manchas).
