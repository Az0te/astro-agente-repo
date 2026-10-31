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

**Emulación para el Antlia HO** (el script no se puede lanzar desde el watcher). Restar a cada canal su fondo (mediana/moda de cielo limpio tras corregir el gradiente) y resolver por mínimos cuadrados las 3 ecuaciones con 2 incógnitas (sistema bien condicionado, número de condición 1,4). Con R, G, B ya sin pedestal (`$T[0]`, `$T[1]`, `$T[2]` en PixelMath):

- `Ha = 1.2563*R - 0.0293*G - 0.0460*B`
- `OIII = -0.1378*R + 0.8370*G + 0.4542*B`
- Variante ponderando G ×2 (doble de píxeles verdes en la matriz Bayer, menos ruido): `Ha = 1.2565*R - 0.0330*G - 0.0391*B`; `OIII = -0.1425*R + 0.9430*G + 0.2574*B`.

Recortar a ≥ 0 **sólo al final** y vigilar sobre-restas (zonas negras) en señal débil. Comprobación en una zona dominada por Hα: `(G−pG)/(R−pR) ≈ 0,14` y `(B−pB)/(R−pR) ≈ 0,05`; si se aparta mucho, el balance de canales no es el bruto (SPCC, flats) o hay continuo.

**Limitación del modelo:** "supone sólo rayas. El continuo que entra por las bandas de 5 nm (estrellas, nebulosa de reflexión, galaxias) también se reparte como 'Hα' y 'OIII': restar después el continuo con la RGB (sustracción de continuo) y, en objetos de reflexión como IC 63, no interpretar ese 'OIII' como emisión."

**Código: una imagen por raya, con pedestal restado**

```javascript
// Una imagen por raya con PixelMath por canal (useSingleExpression = false).
// Los pedestales (pR, pG, pB) se miden antes como mediana de un ROI de cielo limpio.
// Ojo: expresiones largas fallan en silencio -> símbolos + comprobar el valor devuelto.
var PM = new PixelMath;
PM.useSingleExpression = false;   // expression (R), expression1 (G), expression2 (B)
PM.symbols = "pR, pG, pB";
PM.expression  = "pR = 0.0021;\npG = 0.0019;\npB = 0.0025;\n" +
                 "1.2563*($T[0]-pR) - 0.0293*($T[1]-pG) - 0.0460*($T[2]-pB)";
PM.expression1 = "0";
PM.expression2 = "0";
PM.createNewImage = true;
PM.newImageId = "Ha_raw";
// Desde executeOn(view) el resultado hereda color space y formato; para cambiarlos:
// PM.newImageColorSpace = PixelMath.Gray; PM.newImageSampleFormat = PixelMath.f32;  (v8, comprobado en 1.9.6)
if (!PM.executeOn(View.viewById("MasterLight"))) throw new Error("Desmezcla Hα falló");
"Ha_raw: el Hα queda en el canal R";
```

El mismo bloque con `newImageId = "OIII_raw"` y la expresión `-0.1378*($T[0]-pR) + 0.8370*($T[1]-pG) + 0.4542*($T[2]-pB)`. Con `createNewImage` desde `executeOn(view)` basta color space y formato; `executeGlobal` exige además `newImageWidth/Height`.

**Control.** Ratios G/R y B/R en una zona de Hα ≈ 0,14 y 0,05. Comparar con DBXtract si el usuario lo lanza (fuente "DBXtract / Mono" en AutoPalette Studio, nunca "OSC Dualband"). Revisar que no hay zonas negras por sobre-resta y que el OIII no está lleno de continuo (comparar con la R de la RGB).
