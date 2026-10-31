# Paso 6: HDRComposition

[← Índice](../SKILL.md) · Anterior: [Paso 5: StarAlignment + crop común](05-staralignment-crop.md) · Siguiente: [Paso 7: Extracción de canales (OSC dual band)](07-extraccion-canales.md)

**Por qué.** "En las tomas largas los núcleos de las estrellas brillantes (y núcleos de galaxias o M42) se saturan y pierden color y forma; en las cortas no, y el halo es menor. Las estrellas son brillantes y no necesitan tiempo largo.". HDRComposition combina exposiciones en lineal; **no** es HDRMultiscaleTransform, que comprime rango dinámico en una imagen ya estirada.

**Cuándo aplica.** Cuando la estrella más brillante del campo (γ Cas, Antares, núcleo de M42) sigue saturada en la exposición corta, o cuando hay grupos de distinta exposición (120 s / 30 s). No en cúmulos ni cuando no hay saturación que recuperar.

**Adquisición**

- Grupos integrados por separado con los mismos parámetros, registrados sobre la misma referencia y recortados igual (ideal: misma ejecución de WBPP).
- **Razón entre exposiciones moderada:** Tombolini, con 300 s → 30 s (10×), vio una transición visible y recomienda un escalón intermedio de 1–2 min. El 120 s / 30 s (4×) es cómodo. Si la estrella más brillante sigue saturada en 30 s, añadir un grupo de 5 s (o menos); en M42 se sugieren 30, 10, 5 y 1 s.

**Parámetros y diagnóstico**

| Elemento | Instrucción |
|---|---|
| Orden | Combina de mayor a menor exposición; si se desactiva la ordenación automática, introducir de mayor a menor tiempo |
| Trabajo | En lineal; resultado lineal (mejor en 64 bits), que se ve muy oscuro: usar STF de 24 bits para verlo |
| **Binarizing threshold** | Parámetro clave: a partir de qué nivel se considera saturado. Ajustarlo mirando las máscaras generadas |
| Máscaras | Debe haber n−1 máscaras para n imágenes; "cannot integrate further images" = falta alguna → bajar el umbral |
| Mask smoothness / growth | Controlan suavidad y extensión de la transición (transición visible = subir suavizado/crecimiento o añadir un escalón intermedio) |
| OSC | Los canales se saturan a distinto nivel: sustituir en cuanto se satura **cualquier** canal; bajar el umbral de binarización para evitar anillos de color |
| Fitting region | Limitarla a una zona plana y representativa acelera y mejora el ajuste si hay bordes malos |
| Gradientes | Los aditivos deben ser parecidos entre tomas o corregirse antes (DBE/MGC en cada master lineal); si son similares, se corrigen después sobre la HDR |
| Máscara | Conservar la primera máscara (zonas sustituidas): sirve para proteger o tratar núcleos |

**Caso medido (IC63 v4).** Se lanza desde el watcher con `P.images = [[true, ruta120],[true, ruta30]]` y `executeGlobal()` (crea las ventanas `HDR` y `HDR_mask01`; tarda > 60 s). **Con LocalNormalization los masters no saturan a 1**: el verde de 120 s se quedaba en 0,89–0,92 y R/B en 0,93–0,96; medir la meseta por canal y poner el umbral por debajo (**se usó 0,80, suavizado 7, crecimiento 1**). La salida queda reescalada (HDR ≈ 0,275 × M120, sin pedestal): normal, es lineal. La razón 120/30 en estrellas fue 3,66–3,93, pero en las alas de γ Cas ≈ 4,1, lo que dejó un escalón del −6 % a 28 px dentro del núcleo saturado: invisible tras estirar, pero comprobarlo con el perfil HDR/M120 y HDR/M30.

**Código**

```javascript
var HDR = new HDRComposition;
// De mayor a menor exposición; cada elemento: [enabled, path]
HDR.images = [[true, "C:/ASTRO/IC63/master/M120.xisf"],
              [true, "C:/ASTRO/IC63/master/M030.xisf"]];
// Nombres comprobados con describe_process (PixInsight 1.9.6):
HDR.maskBinarizingThreshold = 0.80;   // por debajo de la meseta medida por canal (0,89-0,96)
HDR.maskSmoothness      = 7;      // suavizado de la transición
HDR.maskGrowth          = 1;      // crecimiento de la máscara
if (!HDR.executeGlobal()) throw new Error("HDRComposition falló");
"creadas HDR y HDR_mask01";
```

**Control.** n−1 máscaras; perfil de la relación HDR/M120 y HDR/M30 en la estrella brillante (sin escalones); bordes de la sustitución revisados al 100 % en estrellas y núcleos; sin anillos de color en OSC. Alternativa propia si la composición no convence: medir la razón de flujo larga/corta en estrellas no saturadas y mezclar con máscara de saturación dilatada y suavizada (PixelMath), comprobando que no queda escalón ni anillo.

**De dónde salen las estrellas después** (orden de preferencia): (1) capa de estrellas de la **HDR** (larga + corta); (2) capa de estrellas de la **RGB corta** sola (más limpia y con menos halo, pero pierde las más débiles: comprobar el recuento); (3) RGB larga sólo si no hay corta. **Nunca de L, Hα ni banda estrecha.** Si se usa la corta sola: calibrarla igual que la larga (SPCC, BXT Correct Only + BXT) y escalarla a la larga por la razón de flujo medida en estrellas no saturadas antes de combinar en lineal, o estirarla aparte y recombinar en screen. La nebulosa (starless) sale de la larga o de la HDR, que tienen la SNR.

**HDR sólo en el núcleo (`hdr_core_blend`, NOVA).** "Cuando sólo una zona pequeña (0,3–3 % del campo) necesita compresión, aplicar HDRMT/HDR multiescala y mezclarlo sólo bajo una máscara de luminancia del núcleo suavizada (**umbral ~0,72 nebulosas / 0,80 galaxias, σ 6 px, difuminado 20 px**). En M42 y M31 el HDR global hacía legible el núcleo pero apagaba la señal débil del resto. Revisar el borde de la máscara (escalones, halos, costuras de color). No en cúmulos. El color de un núcleo blanco rellenado con el de alrededor es una reconstrucción, no color medido."

**Núcleos saturados que quedan.** "Script **Repaired HSV Separation** (lo lanza el usuario) en lineal: reconstruye el centro de estrellas saturadas antes de MaskedStretch u otro estirado; según pixinsight.com.ar el resultado es limitado y es mejor una HDR con tomas cortas. Alternativas: RepairStarCores (Toolbox), StarHaloReducer para dar luminosidad al centro, o nuestro relleno con la ley de potencias medida."
