# Paso 3: SCNR

[← Índice](../SKILL.md) · Anterior: [Paso 2: LRGB / Paleta](02-lrgb-paleta.md) · Siguiente: [Paso 4: Máscaras](04-mascaras.md)

**Por qué.** El verde sintético aparece por desequilibrios de balance (no por emisión real de OIII, que también es verde-azulada) y el ojo lo detecta de inmediato. SCNR lo neutraliza, pero **no es una corrección de color**: si se usa para tapar una calibración mal hecha, se lleva por delante el OIII real y el color de las estrellas.

**Cuándo sí y cuándo no**

- Recurso si SPCC falló: "aescaffre 0,65 en verde; nosotros preferimos suave".
- **No en cometas** ("el verde de la coma es emisión real de C₂") ni en zonas de OIII real.
- En HOO/SHO, ver la sección de paletas: "en SHO el verde es esperable si domina Hα (no quitarlo todo con SCNR)".

**Alternativa con máscara** (mejor que el SCNR global cuando hay dominante de fondo)

- "Sólo si la G/R del cielo supera ~1,03; máscara de cielo por luminancia (sigma-clip del fondo, rampa de 1,5σ a 5σ, suavizada); suavizar los canales (gauss σ ≈ 6 px) y restar en el cielo `amount·max(G_s − max(R_s,B_s), 0)` (amount ≈ 0,85)."
- "El tope max(R,B) neutraliza el verde sin volverlo magenta; un recorte píxel a píxel dejó el cielo de M31 por debajo de neutro (G/R 1,06 → 0,93). No tocar el verde/cian real del objeto (OIII)."
- Caso M42: "la corrección sin máscara neutralizó el cielo pero volvió verde el núcleo (G/R 0,91 → 1,13, porque su OIII es real); con máscara quedó en 0,92."
- Fórmula puntual para halos: `G = iif(min(R,B) > G, min(R,B), G)`.
- En NarrowbandNormalization: SCNR interno `G = min(G, (R+B)/2)`, "no en HOO".
- En LDN 1235: quitar verde con `G − 0,85·max(0, G − max(R,B))`.
- SCNR invertido (invertir, SCNR suave, invertir) para halos verdes o azules.

**Código**

```javascript
var P = new SCNR;           // no llamar a la variable SCNR: tapa el constructor
P.amount = 0.65;            // aescaffre; "nosotros preferimos suave" ; colorToRemove = SCNR.Green y protectionMethod = SCNR.AverageNeutral por defecto (comprobado en 1.9.6)
if (!P.executeOn(View.viewById("Starless"))) throw new Error("SCNR falló");

// Alternativa quirúrgica sin tocar el OIII real:
var PM = new PixelMath;
PM.useSingleExpression = true;
PM.expression = "iif(min($T[0],$T[2]) > $T[1], min($T[0],$T[2]), $T[1])";
PM.createNewImage = true;
PM.newImageId = "Starless_noGreen";
if (!PM.executeOn(View.viewById("Starless"))) throw new Error("Neutralización de verde falló");
```

**Control.** G/R del cielo después de SCNR ≈ 1,00 (±0,03). Comprobar que el OIII del objeto sigue verde-azulado y que las estrellas no han virado a magenta. En el fondo, medir antes y después en un ROI de cielo limpio.
