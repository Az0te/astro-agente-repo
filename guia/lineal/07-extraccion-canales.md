# Paso 7: Extracción de canales (OSC dual band)

[← Índice](../SKILL.md) · Anterior: [Paso 6: HDRComposition](06-hdr-composition.md) · Siguiente: [Paso 8: Plate solve](08-plate-solve.md)

**Por qué.** Con un filtro dual band, el sensor no mide Hα y OIII por separado: mide una mezcla lineal. "Con el Antlia HO el verde es ≈ 0,11·Hα + 0,93·OIII (QE del IMX571): no es SII". Si no se desmezcla, toda paleta con S se construye sobre un canal inventado.

**Requisitos, literales** (modelo `C = A·L + P`, Raúl Hussein / DBXtract):

- Lineal, **sin estirar**.
- **Sin SCNR, sin SPCC ni balance de blancos** (el modelo usa la respuesta bruta del sensor).
- Canales sin saturar.
- Perfil de cámara correcto.
- Flats con 'Separate CFA flat scaling factors' (conserva la escala relativa de cada canal).

**Coeficientes QE del IMX571 (ASI2600MC)**

| Raya | λ | R | G | B |
|---|---|---|---|---|
| Hα | 656 nm | 0,80 | 0,11 | 0,04 |
| OIII | 501 nm | 0,04 | 0,93 | 0,50 |
| SII | 672 nm | 0,74 | 0,13 | 0,05 |
| Hβ | 486 nm | 0,01 | 0,67 | 0,70 |

El Antlia Hα/OIII 5 nm no deja pasar Hβ ni SII.

**Emulación para el Antlia HO** (DBXtract es un script; la guía usa esta emulación). Restar a cada canal su fondo (mediana/moda de cielo limpio tras corregir el gradiente) y resolver por mínimos cuadrados las 3 ecuaciones con 2 incógnitas (sistema bien condicionado, número de condición 1,4). Con R, G, B ya sin pedestal (`$T[0]`, `$T[1]`, `$T[2]` en PixelMath):

- `Ha = 1.2563*R - 0.0293*G - 0.0460*B`
- `OIII = -0.1378*R + 0.8370*G + 0.4542*B`
- Variante ponderando G ×2 (doble de píxeles verdes en la matriz Bayer, menos ruido): `Ha = 1.2565*R - 0.0330*G - 0.0391*B`; `OIII = -0.1425*R + 0.9430*G + 0.2574*B`.

Recortar a ≥ 0 **sólo al final** y vigilar sobre-restas (zonas negras) en señal débil. **Sumar un pedestal antes de recortar.** Al restar el cielo, la mitad del ruido del fondo queda por debajo de 0. Recortado a 0, medio cielo se queda a cero: sesga el fondo, estropea el gradiente y el denoise, y parece una cuña sin datos (nebulosa dual band, nov 2026). `desmezclarDualBand` suma la media de los pedestales de entrada (`pedestal_salida`). Comprobación en una zona dominada por Hα: `(G−pG)/(R−pR) ≈ 0,14` y `(B−pB)/(R−pR) ≈ 0,05`; si se aparta mucho, el balance de canales no es el bruto (SPCC, flats) o hay continuo.

**Limitación del modelo:** "supone sólo rayas. El continuo que entra por las bandas de 5 nm (estrellas, nebulosa de reflexión, galaxias) también se reparte como 'Hα' y 'OIII': restar después el continuo con la RGB (sustracción de continuo) y, en objetos de reflexión como una nebulosa de emisión y reflexión, no interpretar ese 'OIII' como emisión."

**Una imagen por raya, con pedestal restado**

- Una imagen por raya con PixelMath por canal; los pedestales (pR, pG, pB) se miden antes como mediana de un trozo de cielo limpio.
- Ejemplo Hα: `1,2563·(R−pR) − 0,0293·(G−pG) − 0,0460·(B−pB)` en una imagen nueva `Ha_raw` (gris).
- Las expresiones largas fallan en silencio: usar símbolos y comprobar el valor devuelto.

`OIII_raw` igual, con `−0,1378·(R−pR) + 0,8370·(G−pG) + 0,4542·(B−pB)`.

**En una llamada** (`herramientas/bandaestrecha.js`): `desmezclarDualBand(vista, { ponderarG })` mide los pedestales en el cielo, crea `Ha_raw` y `OIII_raw` (gris, con la solución astrométrica), cuenta las sobre-restas antes de recortar a 0 y comprueba los ratios G/R y B/R en la zona de Hα. nebulosa de emisión y reflexión (nov 2026): ratios 0,146 y 0,072, sin sobre-resta; misma estructura que DBXtract (correlación 0,96 en bloques de 16 px; DBXtract escala distinto).

```json
{"llamadas": [
  {"funcion": "desmezclarDualBand", "parametros": {"vista": "MasterLight_NB"}}
]}
```

**Otros filtros dual band (S2O3, S2Hb).** `desmezclarDualBand` lee la palabra clave FILTER, o `{ filtro: "S2O3" }`, y resuelve las dos rayas con la tabla QE de arriba por mínimos cuadrados. Con HaO3 da los mismos coeficientes de arriba:
- S2O3: `SII = 1.3602·R − 0.0300·G − 0.0530·B` y `OIII = −0.1780·R + 0.8377·G + 0.4562·B`.
- S2Hb: `SII = 1.3450·R + 0.0685·G − 0.0847·B` y `Hβ = −0.1748·R + 0.7041·G + 0.7572·B`.

Crea `SII_raw` / `OIII_raw` / `Hb_raw` y devuelve en `lineas` qué vista es cada raya. El control de ratios sólo se aplica con Hα: con SII la zona más roja es OIII o continuo.

**Orden: desmezclar pronto (medido).** nebulosa dual band (nov 2026), 3 masters OSC dual band alineados y recortados. Se aplicaron las mismas operaciones (gradiente polinómico, BXT correct only y NXT 0,50) en dos órdenes:
- A: desmezclar primero (esta guía).
- B: estilo DBXtract (procesar en color y desmezclar al final).

Resultados, medidos en la nebulosa, sin estrellas (binado ×8 por mediana) y frente a la desmezcla en bruto:
- Señal conservada: igual en A y B (66–81 % según la raya; la diferencia con el bruto es la misma en las dos).
- Detalle conservado: correlación de 0,97 a 0,997 con el bruto, igual en A y B.
- Señal/ruido: igual en SII y Hβ. En OIII es algo mejor con A: 14,8 frente a 13,5 en HaO3 y 10,1 frente a 9,8 en S2O3. NXT limpia mejor una raya en mono que el color que luego se desmezcla.

Se mantiene desmezclar en el Paso 7.

**¿Y la rutina OSC completa antes de desmezclar? (medido, nebulosa dual band, nov 2026).** Se compararon dos rutinas sobre los tres dual band alineados, con BXT 0,45/0,30, StarX y NXT 0,50 en ambas:
- B, rutina OSC: gradiente → BXT correct only → SPCC narrowband en color (Hα 656/5, OIII 501/5…) → BXT → StarX → NXT → desmezclar al final.
- A, esta guía: desmezclar → gradiente → BXT correct only → SPCC narrowband sobre cada pareja de rayas compuesta en RGB → BXT → StarX → NXT.

Resultados, señal/ruido de la nebulosa (A / B):
- Hα: 26,7 / 28,0. OIII del HaO3: 23,5 / 20,4. SII y Hβ: iguales.
- Detalle: igual.
- Coherencia OIII entre filtros (correlación HaO3 frente a S2O3): 0,968 / 0,954.

Conclusiones:
- **SPCC narrowband sobre las rayas ya desmezcladas apenas cambia nada** (factores 0,99, 0,92 y 0,89): los coeficientes QE de la desmezcla ya las dejan en unidades comparables.
- Hecho antes de desmezclar, SPCC cambia los canales 0,74–0,86 y la desmezcla con los coeficientes brutos deja de ser exacta.
- **SPCC no iguala filtros distintos.** El SII del S2O3 (3 nm) sale a 0,61 del S2Hb (5 nm) en bruto, 0,63 en A y 0,58 en B. Eso lo iguala `combinarMismoCanal` (LinearFit), no el color.

Se mantiene desmezclar pronto y SPCC sólo en el RGB.

**Dónde están los mejores datos (nebulosa dual band).** Señal/ruido de la nebulosa (binado ×8):
- SII: 9,2 del S2Hb frente a 6,1 del S2O3.
- OIII: 14,8 del HaO3 frente a 10,1 del S2O3.

Las dos medidas de una misma raya coinciden (correlación 0,92 en SII y 0,95 en OIII). Se combinaron en el Paso 10 con `combinarMismoCanal` (LinearFit y pesos 1/σ²), midiendo en bruto tras el gradiente:
- SII: pesos 0,70 para S2Hb y 0,30 para S2O3. El ruido por píxel baja un 14,5 % frente al S2Hb solo; la señal/ruido a 8 px pasa de 6,5 a 6,7. **Combinar.**
- OIII: tras igualar escalas, el del S2O3 tiene 3× el ruido del HaO3 (peso 0,10). El ruido sólo baja un 0,4 % y la función lo marca. **Usar el del HaO3 solo.**

Hay que medirlo en cada proyecto: la función dice si compensa.

**Control.** Ratios G/R y B/R en una zona de Hα ≈ 0,14 y 0,05. Comparar con DBXtract si el usuario lo lanza (fuente "DBXtract / Mono" en AutoPalette Studio, nunca "OSC Dualband"). Revisar que no hay zonas negras por sobre-resta y que el OIII no está lleno de continuo (comparar con la R de la RGB).
