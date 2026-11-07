---
name: m31-procesado
description: "M31 (26 oct 2026): datos, decisiones de calibración (flat azul sintético), masters, cadena de estirado sin quemar el núcleo y dossier"
metadata:
  node_type: memory
  type: project
  originSessionId: 797c36f4-eb6c-4677-bf3f-a5ab0207d66c
  modified: 2026-10-31T16:30:03.445Z
---

M31 en `D:\Astronomia\SQA106\M31` (2 noches Triband 60 s: 7-9 150 subs, 18-9 279). Trabajo en `_proc/` con scripts en `_proc/tools/` (copiados del flujo de IC1396: calibración por sesión desde el watcher, sin WBPP).
- Flats del 7-9 con **azul saturado al 100 %** → `MasterFlat_S1_Bsint.xisf`: B = B(18-9)·G(7-9)/G(18-9) de los 4 vecinos (motas movidas 1–2 %). Sin dark de 60 s −10 °C: se usó el de 30 s −10 °C (sólo 35 píxeles calientes). Pedir a Rafael darks de 60 s −10 °C para la biblioteca.
- El núcleo NO satura en 60 s (máx 5–20 kADU): no hace falta HDR de exposiciones.
- Selección: 7-9 FWHM 6,8″→2,6″ a lo largo de la noche; 18-9 bache 02:15–03:30 UTC. Master amplio (309 subs, 5 h 9 min) elegido frente al estricto (244): −8 % ruido, +3 % FWHM.
- Gradiente: polinomio grado 2 fuera de una elipse de M31 (2,5 % del cielo). BXT correct only → BXT (estrellas 0,25, halos 0, no estelar 0,65) → SXT lineal.
- Estirado que funcionó: NXT lineal 0,5/0,9 → arcsinh color b=1000 → MTF fondo 0,12 → curva K suave → HDRMT 8 capas mezclado al 60 % con máscara L>0,35 → LHE 64/0,25 en brazos → NXT 0,3. HDRMT 7 capas a pleno y LHE 200 en el bulbo crearon anillo oscuro y bulbo plano: evitar.
- Final v4 (26-10): SPCC (WB 1/0,925/0,810) tras ImageSolver de Rafael (guardó la solución sobre `master_amplio.xisf`); punto negro arcsinh = cielo − 0,0002 (pegado al cielo se dispara); corrección de croma del cielo a 16× bajo máscara y quita-verde 0,85. Entregables en `M31/final/` (xisf, tif, jpg, starless, estrellas). 2,1 h activas, 192 llamadas, 119 k tokens de salida.
- v5 (pedida por Rafael: girar 180°, más estirado, más azul): bp 0,00026, fondo 0,128, curva más alta, realce de azules donde B>R (croma ×1,35, B +6 %), croma de gran escala del halo L<0,2 atenuada 70 % (al estirar más sale un halo oliva asimétrico). Archivos `final/M31_v5_rot180.*`. Sus preferencias para galaxias: imagen girada 180°, más estirada y azules marcados.
- 26-10 19:37: Rafael la deja así (v5) "a falta de más lights". Dossier exportado a `final/M31_dosier.pdf`. Siguiente paso cuando haya datos: más horas, Hα con la mono, tanda corta; ideas pendientes: reducción suave de estrellas, HII por tono, LHE fino en polvo.
- 31-10: `SQA106\M31\_proc` y `M31\final` ya NO existen (borrados/movidos fuera de esta sesión); hay un reprocesado nuevo en `D:\Astronomia\Master\master\M31\M31_v2` (otra sesión, scripts `tools/pre.js`). Rafael pidió comparar estirados arcsinh/GHS/MAS en el dossier; GHS nativo existe (`GeneralizedHyperbolicStretch`: stretchFactor=D log, localIntensity=b, symmetryPoint, shadowProtection, highlightProtection). Script preparado `estirados3.js` (copiado también abajo si se pierde).
- 31-10 comparación de estirados (en `Master\master\M31\estirados_cmp`, sobre capas de M31_v2): arcsinh ≈ MAS (disco 0,29, polvo 0,149 vs 0,137); GHS 3 fases más limpio pero disco 0,19. MAS sólo falla sin SPCC. GHS nativo: shadowProtection debe ser < SP (darla como fracción). Constantes de PixelMath en este PI: `PixelMath.RGB/Gray/f32` (no `.prototype`): usar helper K_.
- Dossier: Claude Doc https://claude.ai/artifact/UmVwzFytSGonLD8bDiRydu. Inicio de trabajo 26-10 16:04 UTC.
- 31-10: los `_proc/` y `final/` de la v5 ya no están en D: (sólo `M31_v5_rot180.jpg` en Descargas y `master_amplio.xisf` en `C:\Users\sieso\astro-agente-ollana_local\`).
- **M31 v6 (31-10; se llamó v2 por error, Rafael la renombró a v6; la carpeta sigue siendo `M31_v2` porque Windows bloqueó el cambio, los ficheros de final/ ya son `M31_v6*` y `M31_v6b*`)** desde cero con la skill, en `D:\Astronomia\Master\master\M31\M31_v2\` (final/, lineal/, logs/, tools/). 376 subs (FWHM ≤ 6,1″), ruido −5 % vs v5, FWHM 3,52″. Gradiente: polinomio g2 gana a GraXpert sf10 (que come 8,5 % de M31). SPCC Triband WB 1/0,929/0,817. GHS col D6 b15 → D0,5 b2 SP0,2 HP0,7 → HT bp; HDRMT 7 capas 60 % en bulbo; LHE 64+200 en disco; ColorSaturation por tono. SXT se lleva los núcleos de M31/M32/M110: devolverlos. starStretch dejó casi sin estrellas: mejor mismo estirado + `screenStarsExtract`. Contras vs v5: disco más oscuro y menos estrellas; propuesta v2b. Dossier: https://claude.ai/artifact/6sWTBYJ1zatjjphCjbH9ra
- v7 (31-10, pedida por Rafael sobre v6b: fondo más oscuro, más detalle, brazos más saturados, más color, estrellas más estiradas): cielo 0,112, LHE r32 en disco, S 0,5→0,64 y ColorSaturation azul +0,25 / rojo +0,15 con máscara galaxia×(1−bulbo) (sin excluir el bulbo el núcleo recorta), curva fuerte + saturación en la capa de estrellas. `final/M31_v7*`.
- Trampas: `saveAs` a carpeta inexistente abre un diálogo modal que bloquea el watcher (crear carpetas antes); `image.assign(im, rect)` copia sólo el canal seleccionado si quedó `selectedChannel` puesto (resetSelections antes); otro hilo usando el watcher a la vez hizo que se perdieran comandos.
**Why:** retomar sin repetir medidas. **How to apply:** ver [[ic63-v4-procesado]] y [[pixinsight-mcp-watcher]].
