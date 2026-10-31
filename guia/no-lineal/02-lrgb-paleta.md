# Paso 2: LRGB / Paleta

[← Índice](../SKILL.md) · Anterior: [Paso 1: Estirado (starless y estrellas por separado)](01-estirado.md) · Siguiente: [Paso 3: SCNR](03-scnr.md)

**Por qué.** Aquí se decide la estructura de color de la imagen final: si la luminancia viene de una L (LRGB) o de la propia RGB, y si el color es natural (RGB), una convención de paleta (HOO/SHO/Foraxx) o una mezcla de ambas (Hα+RGB, SHO+RGB). "LRGB siempre después de estirar L y RGB por separado, en CIE L*a*b*".

**LRGB**

- "Antes, igualar brillo: LinearFit de L a la luminancia de la RGB (aescaffre: evita velo) y estirados comparables (MAS da estirados parecidos por estadística)."
- "Un píxel no admite a la vez brillo y saturación máximos: si el color se lava, bajar lightness/subir saturación en LRGBCombination o suavizar L. Punto de partida de reflected-space: **lightness + saturación ≈ 1 (0,50/0,50 o 0,45/0,55)**, con R, G y B desactivados y la L en su casilla."
- Galaxias (aescaffre): **lightness 0,35 (de canto) / 0,50 (de cara), saturación 0,70**; cúmulos de galaxias lightness 0,45–0,55.
- "La RGB sólo aporta color: se puede reducir su ruido de crominancia con más fuerza (incluso suavizarla) porque el detalle lo pone la L."
- Truco de saturación: "Saturar la nebulosa con una L muy desenfocada: sobre la capa sin estrellas, LRGBCombination con la propia luminancia muy suavizada como L y channel weight de L ≈ 0,15–0,19; sube la croma sin amplificar el ruido de luminancia."
- Luminancia sintética (sin L real): `L = wR·R + wG·G + wB·B` con Σw = 1; pesos perceptual 0,30/0,59/0,11; neutro 0,33/0,33/0,33; alta resolución 0,4/0,4/0,2; o por SNR (`w ∝ 1/σ²`).

**Composición natural Hα/OIII + RGB (OSC; la que gustó en IC 63)**

1. Estirar por separado con MAS (fondo 0,15) la RGB sin estrellas y el Hα (saturación de MAS desactivada).
2. `hx = max(Has − mediana(Has), 0)`, anulado cerca de estrellas muy brillantes. R += ~1,5·hx, G += ~0,2·hx, B += ~0,45·hx (rosa natural Hα + Hβ). En IC 63 se eligió un rojo de 1,40–1,49 frente a 1,65: más rojo tapa los blancos.
3. La suma satura el rojo en las zonas brillantes: calcular sin truncar y aplicar la **rodilla suave** sobre el máximo de los tres canales (Anexo E).
4. El Hα de un dual band OSC sale de la desmezcla (Paso 7 lineal) con el continuo restado (Paso 16 lineal). Alternativas: CombineRGBAndNarrowband / CombineHaWithRGB (scripts), o la inyección en tres partes de aescaffre (R condicional + realce de luminancia + capa de detalle) con máscara de nebulosa derivada del Hα (clipLow 0,04, blur 8; fuerza ~0,65, umbral 0,3).
5. Blancos y azules de reflexión, nebulosidad de fondo en Hα y compresión de altas luces: Anexo E. Curvas y saturación: Paso 5. NXT tras los realces: Paso 6.
6. Ajustar el nivel del fondo al final con una curva K (el valor objetivo está en el perfil).
7. El OIII de un dual band en una nebulosa sin OIII sólo aporta continuo de reflexión y ruido: medirlo y descartarlo si no añade señal (NOVA descarta la paleta bicolor si Hα/OIII > 20). Una nebulosa de reflexión captada con dual band no pasa por una paleta: su color es continuo de banda ancha (RGB).

**Paleta: cuándo y cómo se elige**

- "**Cuándo:** nebulosa de emisión (región HII, nebulosa difusa), resto de supernova o nebulosa planetaria con datos de banda estrecha o dual band, y el usuario no ha dicho qué paleta quiere. Antes de componer el color final, generar previews pequeñas de varias paletas y pedirle que elija (pregunta de una palabra, con una recomendada). Mientras contesta, seguir con lo que no depende de la paleta (estrellas, máscaras). No aplicar a reflexión, nebulosas oscuras ni galaxias... Sin banda estrecha no hay paletas: RGB o LHa-RHaGB."
- Protocolo de previews: capas Hα y OIII (y SII si hay) **sin estrellas**, con gradiente corregido, continuo restado si procede, registradas y estiradas **con el mismo estirado** (o MAS al mismo fondo, ~0,15); reducir a ~1200 px de lado largo (IntegerResample Average); generar el juego por defecto con PixelMath; guardar cada una como JPG en `<versión>/prev/paletas/NN_<Paleta>.jpg` y una plancha; enseñarla y preguntar.

**Fórmulas de referencia**

| Paleta | Fórmula |
|---|---|
| Classic HOO | R = H, G = O (o la mezcla del Blend), B = O |
| Classic SHO | R = S, G = H, B = O |
| Classic Hubble (HSO) | R = H, G = S, B = O |
| Foraxx Classic bicolor (sin SII) | R = H; G = ho·H + ~ho·O; B = O |
| Foraxx Classic (con SII real) | R = o·S + ~o·H; G = ho·H + ~ho·O; B = O |
| Foraxx HOS sin SII (subtle) | R = H; G = 0,88·(ho·H + ~ho·O) + 0,12·O; B = o·S′ + ~o·O, con S′ = 0,78·O + 0,22·(ho·H + ~ho·max(0, H − 0,22·O)) en Soft |
| HOO con límite al OIII (NOVA) | `O = min(OIII, 0,85·Hα)`, R = Hα, G = 0,15·Hα + 0,90·O, B = O |

con `~x = 1 − x`, `o = p(O)`, `ho = p(H·O)`, `p(x) = x^~x`.

- "Con sólo Hα y OIII no hay SHO real: llamarlo pseudo-SHO."
- "Sin SII real crea un SII sintético: 0,6·Hα + 0,4·OIII con Blend Soft (Neutral 0,5/0,5, Hard 0,7/0,3); para las Foraxx usa otro más cercano a Hα (0,85·Hα + 0,15·OIII en Soft). Cualquier paleta S con sólo Hα/OIII es pseudo-SHO: decirlo."
**Herramientas**

- **AutoPalette Studio v1.2.0** (Raúl Hussein, Suite Astrocitas): **script**, sin API de scripting; pensado para imágenes no lineales. Si recibe una imagen lineal (mediana < 0,12 y p98 < 0,55) estira cada canal por separado, lo que cambia la proporción Hα/OIII: darle las capas ya estiradas con el mismo estirado.
- Blend mode (mezcla del canal compartido): Neutral 50/50, **Soft 60/40 (defecto)**, Hard 70/30. HOO: G = b·Hα + (1−b)·OIII. SHO: R = b·S + (1−b)·H, G = b·H + (1−b)·O.
- Familias Foraxx (SHO, HOS, OHS, HOO, HSO, OSH, SOH, 6 variantes cada una): están en las funciones `foraxSHO`…`foraxSOH` del script; copiarlas de allí, no de memoria. Exigen SII real. Paletas por defecto de la herramienta: Original, Classic HOO, Foraxx Classic y Foraxx HOS.
- Otros scripts de paleta (los lanza el usuario): Perfect Palette Picker, ForaxxPalette_V8, AutoPalette_V8, NBColourMapper, NarrowbandHueCombination, CreateHubblePaletteFromOSC.
- **Aviso de AutoPalette Studio:** "Fuente 'OSC Dualband': separa R, G, B con ChannelExtraction y usa R como Hα, G como 'SII' y B como OIII, sin desmezclar... toda paleta con S sale de un canal inventado. Con dual band usar siempre DBXtract (o su emulación con PixelMath) y la fuente 'DBXtract / Mono'."

**Juego de previews por defecto** (PixelMath con símbolos, comprobando el valor devuelto)

- **Sin SII** (dual band, o mono con H y O): Classic HOO Soft, Classic HOO Hard, Foraxx Classic bicolor, Foraxx HOS (marcada pseudo), HOO + NBN (Mode1, shadowpoint 1, Lightness Off) y la composición natural como referencia.
- **Con SII real**: Classic SHO, Classic Hubble (HSO), Foraxx Classic, Foraxx HOS, Classic HOO, SHO + NBN y la natural.
- Plancha: copiar cada preview en su casilla de una ImageWindow grande con `setSamples`; si los rótulos con Bitmap/Graphics fallan, numerar las casillas y dar la leyenda en el mensaje.
- Con la elegida: aplicar la misma fórmula a resolución completa (o AutoPalette Studio lanzado por el usuario con el watcher parado: fuente DBXtract/Mono sobre nuestras capas estiradas, Normalization None, o Auto si los canales vienen de cámaras o exposiciones distintas, Blend Soft). Después, estrellas RGB en screen.
- Avisos: no hay fórmula Foraxx oficial única (la ficha C10-34 de astro-photographie no coincide con el script: usar la del script); en SHO el verde es esperable si domina Hα.

**NarrowbandNormalization 1.0** (proceso, sí se ejecuta desde el watcher)

- Equilibra la intensidad de los canales con **Hα siempre como referencia**: aplica a cada canal una MTF para que su desviación positiva media sobre la mediana iguale la del Hα, sólo por encima del punto de sombra (**shadowpoint 1 = desde la mediana; 0 = toda la imagen**). "Es un ajuste estético: cambia las proporciones entre rayas (documentarlo)."
- "Vale en lineal o no lineal, pero con **Lightness = Off en lineal**."
- Paleta: SHO, HOO, HSO, HOS (dual band OSC → HOO). En HOO toma el OIII del canal verde (más SNR en OSC); R = Hα, B = OIII normalizado y G = (1−amount)·base + amount·mezcla, con Mode1 = Hα original sobre OIII normalizado, Mode2 = OIII normalizado sobre OIII original, Mode3 = Hα original sobre OIII original.
- Otros: SCNR (`G = min(G, (R+B)/2)`, no en HOO), OIII boost y SII boost, Highlight reduction, Brightness. Orden interno: normalización → SCNR → Lightness → Highlight reduction → Brightness.
- Nombres PJSR leídos del módulo: `palette` (`Palette_SHO/HOO/HSO/HOS`), `lightness` (`Lightness_Off/Preserve/Ha/OIII/SII`), `blendMode` (`Blend_Mode1..3`), `haBlend`, `scnr`, `o3Boost`, `s2Boost`, `shadowpoint`, `highlightReduction`, `brightness`. "Confirmar con `describe_process NarrowbandNormalization` la primera vez."

**Qué recomendar**

| Objeto | Recomendación |
|---|---|
| Región HII / nebulosa difusa | HOO (simple, rojo/cian) o Foraxx (transiciones oro → azul más suaves) |
| Con SII real | SHO/Hubble para separar zonas de ionización |
| Resto de supernova | SHO o Foraxx (HOO con dual band); filamentos finos; validar el OIII débil antes de realzarlo |
| Planetaria | Colores próximos a los reales (OIII azul-verde, Hα/NII rojo), HOO o RGB + banda estrecha; núcleo con HDR o tomas cortas |
| OIII débil | Mezcla no lineal o HOS; OIII boost moderado, nunca hasta llenar el campo de cian |

**Código**

```javascript
// HOO clásico (Blend Soft 60/40) a partir de las capas Ha y OIII, ya estiradas con el MISMO estirado.
// En PixelMath cada imagen se usa por su id.
var PM = new PixelMath;
PM.useSingleExpression = false;
PM.expression  = "Ha";
PM.expression1 = "0.6*Ha + 0.4*OIII";
PM.expression2 = "OIII";
PM.createNewImage = true;
PM.newImageId = "HOO";
PM.newImageColorSpace = PixelMath.RGB;   // watcher v8; en el clásico, PixelMath.prototype.RGB
if (!PM.executeGlobal()) throw new Error("HOO falló");   // executeGlobal exige además newImageWidth/Height

// Variante con NarrowbandNormalization sobre la HOO:
var NBN = new NarrowbandNormalization;
NBN.palette = NarrowbandNormalization.Palette_HOO;        // v8: constantes en el constructor
NBN.lightness = NarrowbandNormalization.Lightness_Off;
NBN.shadowpoint = 1;
if (!NBN.executeOn(View.viewById("HOO"))) throw new Error("NBN falló");
"NBN HOO aplicado";
```

**Control.** Comparar la paleta elegida con la composición natural (Hα/OIII + RGB) como referencia. Vigilar: fondo teñido, OIII que inunda el campo de cian, estrellas de color de paleta (deben venir de la RGB), transiciones de máscara. "Una paleta es una convención, no el color real: decirlo en el dosier."
