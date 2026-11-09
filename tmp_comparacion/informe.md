# M31: comparación Qwen (7-nov) frente a Opus (v7, 31-oct)

Ambos procesados parten del **mismo master**: `M31_v2\master\M31_v2_master.xisf`, con 376 subs. La sesión de Qwen lo tiene abierto en PixInsight como `MasterLight`. Todo lo de esta carpeta se ha hecho en modo lectura sobre `D:\Astronomia`: no se ha borrado ni sobrescrito nada allí.

## 1. Archivos encontrados

| Procesado | Final | Fecha | Documentación |
|---|---|---|---|
| **Qwen** | `M31\M31_Final_v1.xisf / .tif / .jpg` (6248×4176, sin recorte ni giro) | 07-11 10:55 | `M31\estado.md` (07-11 10:47, 455 B; solo cubre el checkpoint lineal, y las «Decisiones y notas» están sin completar). No hay dossier. |
| **Opus** | `M31\M31_v2\final\M31_v7.xisf` (6120×4032, recortado) más `M31_v7_rot180.xisf/.tif/.jpg/_web.jpg`, `M31_v7.jpg`, `M31_v7_starless/_estrellas.xisf` | 31-10 17:29 (el `M31_v7.jpg` es de las 23:55) | Dossier PDF v6 y v7 en `final\`, logs en `M31_v2\logs\`, scripts en `M31_v2\tools\` y la memoria de la sesión `m31-procesado.md`. También hay una comparativa de estirados en `M31\estirados_cmp\` (31-10 y 04-11). |

- **estado.md**: el único que hay en `M31` es el de Qwen, de hoy. En todo `D:\Astronomia` no hay ningún otro `estado.md` de M31 ni existe una carpeta `M31_v3`. Opus no usó `estado.md` en M31: documentó con logs, dossier PDF y su memoria. Por tanto, **no hay indicios de que Qwen sobrescribiera un estado.md de Opus**.
- Otras carpetas de M31 que no entran en la comparación: `D:\Astronomia\SQA106\M31` (datos brutos) y `D:\Astronomia\pruebas_graxpert\M31`.
- Las copias y su ruta original están en `indice.txt`. El dossier PDF de Opus está copiado tal cual (`opus_dossier_v7.pdf` y `v6`). No he podido extraer su texto porque la máquina no tiene herramientas de PDF. Los parámetros de Opus salen de los logs, de los scripts y de su memoria.

## 2. Pasos de cada procesado

### Opus, v6 → v6b → v7 (31-10)
Fuentes: `opus_memoria_m31-procesado.md`, `opus_log_*.txt` y `opus_tool_*.js`.
1. **Calibración por sesión, sin WBPP**: S1 con 150 subs y S2 con 279. Debayer, medidas y selección (FWHM ≤ 6,1″), LocalNormalization y registro (380 entran, 376 salen) e integración. Ruido del master: 2,23e-5 / 2,20e-5 / 2,45e-5; FWHM del master: 2,31 px (3,52″).
2. **Degradado**: polinomio de grado 2 fuera de una elipse de M31. Se comparó con GraXpert sf10, que se comía el 8,5 % de M31.
3. **BXT correct only** → **SPCC** (Triband, WB 1 / 0,929 / 0,817) → **BXT** (estrellas 0,25, halos 0, no estelar 0,65) → **StarXTerminator** en lineal → **NXT** en lineal sobre la starless.
4. **Estirado de la starless con GHS en modo color**: GHS1 D6 b15 SP=cielo (0,00026); GHS2 D0,5 b2 SP0,20 LP0,128 HP0,70; después HT con bp 0,042.
5. **Núcleo y disco**: HDRMT de 7 capas mezclado al 60 % con máscara en el bulbo. Antes se descartó HDRMT a pleno, porque creaba un anillo oscuro. LHE r64 y r200 en el disco y, en v7, LHE r32 en el disco.
6. **Color**: ColorSaturation por tono. En v7, S de 0,5 a 0,64, azul +0,25 y rojo +0,15 con máscara galaxia×(1−bulbo), para que no recorte el núcleo. Se devolvieron los núcleos de M31, M32 y M110, que SXT se había llevado.
7. **Estrellas**: el mismo estirado más `screenStarsExtract` (starStretch dejaba casi sin estrellas). En v7, curva fuerte más saturación en la capa de estrellas y recombinación en modo screen.
8. **v7** responde a lo que pidió Rafael: fondo más oscuro (cielo ≈ 0,11), más detalle, brazos más saturados y estrellas más estiradas. Se entregó también girada 180°.

### Qwen (7-nov)
Fuentes: `qwen_estado.md` y el historial de las 35 vistas abiertas en PixInsight. Los scripts `run_*.js` ya no están en `PiAstroPilot\tmp`.
1. **Degradado**: probó GraXpert (GX8, GX10), MGC 1024/2048 (con y sin borde) y polinomio 1/2 (vistas `GC_*`). No hay constancia de cuál eligió.
2. **BXT correct only** → **SPCC** → **BXT** (estrellas 0,30, halos 0, no estelar 0,65) → NXT → **StarX** → **NXT 0,70 sobre la starless lineal**. El checkpoint lineal dio FWHM 8,8 px y cielo verde 0,67 σ.
3. **Estirado de la starless con GHS en modo RGB** (no en modo color): D2,5 b12 SP0,000344 HP0,95; D1 b6 SP0,0107; D1 b6 SP0,0493. Después, **seis rondas más** de GHS (D1, 1, 0,5, 0,25, 0,125, 0,125 a SP0,1 y HP0,92), cada una seguida de una resta de punto negro por PixelMath `($T-k)/(1-k)` con k de 0,031 a 0,174.
4. Neutralización del fondo (`M31_Starless_Neutral`), curva de saturación (`_sat`) y **NXT 0,20 en no lineal**. Existe una máscara `mask_fondo_lhe`, así que probablemente aplicó LHE, aunque no consta en los historiales que he leído.
5. **Estrellas** (`M31_Stars_Prepared`): umbral `iif($T<0.005,0,$T)` (pone a cero todo lo débil), curva y compresión de altas luces `>0.8 → ×0.85`. Recombinación por PixelMath en `M31_Final`.
6. No hay HDR ni protección del núcleo. El estirado acumulado deja el bulbo en una meseta.

## 3. Estadísticas comparadas
Medidas sobre los XISF, exportados a FITS en el scratchpad. Las zonas son las mismas en el cielo: el desplazamiento medido por correlación de fase es Qwen = Opus + (64, 80) px, sin giro. Las cifras completas están en `estadisticas.json`, `estadisticas_opus.json` y `estadisticas_qwen.json`.

| Medida | Opus v7 | Qwen v1 |
|---|---|---|
| Tamaño | 6120×4032 | 6248×4176 |
| Fondo (600×600 vacío) mediana R/G/B | 0,1072 / 0,1063 / 0,1033 | 0,1098 / 0,1003 / 0,0923 |
| Fondo MAD R/G/B | 0,0125 / 0,0123 / 0,0122 | 0,0117 / 0,0100 / 0,0138 |
| Fondo R/G y B/G | **1,009 / 0,972** | **1,094 / 0,920** (rojizo) |
| Cielo (30 % más oscuro, cajas 50 px): R/G p5–p95 | 0,94 – 1,04 | **0,70 – 1,24** |
| Cielo: B/G p5–p95 | 0,93 – 1,08 | **0,62 – 1,42** |
| Cielo: L p5–p95 | 0,102 – 0,114 | 0,083 – 0,119 |
| Núcleo (300×300): máx R/G/B | 1,00 / 0,97 / 1,00 | 0,977 / 0,973 / 0,972 |
| Núcleo: p99,9 R/G/B | 0,90 / 0,80 / 0,78 | 0,971 / 0,968 / 0,965 |
| Núcleo: % píxeles > 0,98 | 0,008 % | 0 % |
| Núcleo: radio de la meseta L > 0,95 | **1 px** | **22 px** |
| Imagen entera: % píxeles > 0,98 | 0,055 % (estrellas) | 0,00004 % |
| Estrellas detectadas (> 15 σ) | **13 721** | **269** |
| FWHM mediana de las estrellas detectadas | 2,52 px | 2,26 px (de solo 269 estrellas, poco fiable) |

Sobre el núcleo de Qwen: no supera 0,98 porque la compresión final topa en ≈ 0,97. Aun así, hay un disco de 22 px de radio por encima de 0,95, prácticamente plano. Está quemado en la práctica, solo que comprimido.

## 4. Observaciones visuales de los recortes
Archivos `par_*_opus_izq_qwen_der.jpg`: Opus a la izquierda y Qwen a la derecha, ambos al 100 %.

- **Núcleo**: Opus tiene un núcleo pequeño y anaranjado, con gradiente hasta el bulbo, y las bandas de polvo internas llegan cerca del centro. Qwen tiene una **gran mancha blanca sin estructura** de unos 400 px de diámetro visible, y el bulbo es plano y blanco. El polvo cercano al centro se ve, pero lavado.
- **Brazo y polvo**: el polvo y las regiones HII aparecen en los dos. Opus tiene grano fino y natural. En Qwen se ve **textura «pintada» o vermicular** (NXT fuerte más estirado agresivo), menos contraste local en el polvo y un tono más apagado y grisáceo.
- **M32**: Opus muestra un núcleo con gradiente suave. En Qwen M32 es una bola blanca más grande y quemada en el centro, sobre un fondo de disco verdoso y oscuro.
- **Fondo**: Opus es neutro, con grano uniforme y muchas estrellas. Qwen es más oscuro, con un tinte rojizo o marrón, y tiene **manchas de color de gran escala** (verde en las esquinas izquierdas y magenta en el centro izquierda) que se ven bien en la previa completa. Lo cuantifica el rango R/G y B/G del cielo, tres o cuatro veces más ancho que en Opus.
- **Estrellas**: es el fallo más grave de Qwen. **El final casi no tiene estrellas** (269 frente a 13 721). El umbral `<0,005 → 0` sobre la capa de estrellas, más la compresión, eliminó prácticamente todo el campo estelar. En Opus las estrellas son puntuales y tienen colores variados (azules y naranjas), sin halos marcados.
- **Ruido**: el MAD del fondo es parecido (≈ 0,010–0,014), pero en Qwen el NXT lineal a 0,70 más el no lineal se traduce en pérdida de textura y aspecto plástico. En Opus el ruido es fino y de luminancia.

**Resumen**: con los mismos datos, la v7 de Opus es claramente superior. Tiene el núcleo controlado, el fondo neutro y homogéneo, un campo estelar completo y textura natural. El final de Qwen tiene el núcleo y M32 en meseta blanca, el fondo con manchas de color, casi todas las estrellas eliminadas y textura artificial por exceso de reducción de ruido y estirados encadenados.

## 5. Archivos generados en esta carpeta
- `opus_completa_1600.jpg` y `qwen_completa_1600.jpg`: previas de 1600 px de ancho, calidad 90, sin STF.
- `opus_recorte_*.jpg`, `qwen_recorte_*.jpg` y `par_*.jpg`: núcleo (800), brazo y polvo (800), M32 (600) y fondo (600). Las zonas, en coordenadas de Opus, están en `estadisticas.json` → `_alineado`.
- `estadisticas*.json`, `indice.txt` y las copias `opus_*` y `qwen_*` de la documentación y de los JPG finales.
