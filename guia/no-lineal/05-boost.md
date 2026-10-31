# Paso 5: Boost (curvas, contraste, saturación)

[← Índice](../SKILL.md) · Anterior: [Paso 4: Máscaras](04-mascaras.md) · Siguiente: [Paso 6: NoiseX](06-noisex.md)

**Por qué.** El boost es la parte estética: subir contraste local y saturación **sin fabricar detalle**. Todo lo que se añade aquí debe existir en los datos. "Más microcontraste no es más resolución; más saturación no es más exactitud de color".

**Curvas y saturación**

- Curva S suave en L; saturación de partida **S 0,5 → 0,6**.
- Método "empujar hasta el rechazo" (aescaffre): clonar y probar el punto medio de la curva S de saturación en pasos **0,58 → 0,63 → 0,68 → 0,73 → 0,78**; quedarse con el último sin bandas de color, tonos antinaturales, ruido de color amplificado, canales > 0,98 ni fondo teñido (**nebulosas 0,70–0,78; galaxias 0,63–0,70**). "Anotar el valor ganador en el dossier."
- "No saturar con una dominante de fondo sin resolver (la amplifica); los núcleos de estrella ya recortados no recuperan color. Si el ruido de color del cielo es visible o el objeto llena el campo, mejor saturación selectiva por tono o con máscara que global."
- Puntos de curva para levantar sombras sin quemar el objeto: `[[0,0.04],[0.04,0.12],[0.10,0.16],[0.20,0.24],[0.50,0.50],[1,1]]`; "las curvas S que hunden sombras matan esa señal". Oscurecer sombras sólo en el fondo verdadero y con transición suave (p. ej. 0,05→0,003, 0,10→0,015, 0,15→0,05).

**Contraste local (LHE)**

- Receta de la v4B que gustó: "LocalHistogramEqualization **radio 256, amount 0,35, slopeLimit 2,0** sobre la capa sin estrellas no lineal, con máscara de fondo `1 − clip((L64 − 0,20)/0,25)`, seguida de **NXT 0,75** bajo esa misma máscara y **NXT 0,30** global."
- "**No usar un mapa de 'estructuras oscuras' por diferencia de escalas** (`max(L_suave − L, 0)`): en IC 63 salía dominado por ruido moteado y creaba bordes oscuros alrededor de los bordes brillantes del fantasma."
- "El LHE de radio pequeño (96, amount 0,25, máscara L² sólo en lo brillante) es el complemento para el detalle del fantasma (v4A)."
- Límites prácticos (aescaffre): "LHE amount > 0,5 ya parece artificial; slopeLimit ~1,5–1,8 (≥2,0 artefactos); una sola pasada de LHE suele bastar; LHE + HDRMT juntos dan aspecto 'diseñado': usar uno u otro."
- Radios: "Radio de LHE de NOVA: ~1/12 del lado corto de la imagen (32–128 px), amount 0,5, slope 1,5 en nebulosas y 2,0–2,5 en galaxias". Galaxias aescaffre: "LHE radio 64, amount 0,25 (de canto) a 0,35 (de cara), slopeLimit 1,3–1,5".
- "Radios de LHE pequeños crean anillos oscuros alrededor de estrellas: aplicar siempre sobre la starless o con máscara de estrellas. HDRMT con 'median transform' activado evita anillos oscuros en campos ricos en estrellas."

**Código**

```javascript
// LHE sobre la starless, con la máscara de fondo de la receta v4B ya aplicada a la vista.
var v = View.viewById("Starless");
if (v.isNull) throw new Error("No existe Starless");
var LHE = new LocalHistogramEqualization;
LHE.radius = 256;          // 96 para detalle fino; ~1/12 del lado corto en NOVA
LHE.amount = 0.35;         // > 0,5 parece artificial
LHE.slopeLimit = 2.0;      // 1,3-1,8 recomendado por aescaffre; ≥2,0 artefactos
if (!LHE.executeOn(v)) throw new Error("LHE falló");
"Núcleos/estrellas protegidos por mask_L_g20";
```

Para las curvas, `CurvesTransformation`: cada curva es una lista de pares `[x, y]` en `R`, `G`, `B`, `K` (RGB/K, todos los canales), `A` (alfa), `L`, `a`, `b`, `c` (CIE L*a*b* y croma), `H` (tono) y `S` (saturación), con su interpolación en `Rt`, `Gt`, `Bt`, `Kt`… (`CurvesTransformation.AkimaSubsplines` en v8). Comprobado en PixInsight 1.9.6.

```javascript
var C = new CurvesTransformation;
C.K = [[0, 0.04], [0.04, 0.12], [0.10, 0.16], [0.20, 0.24], [0.50, 0.50], [1, 1]];   // levantar sombras
C.Kt = CurvesTransformation.AkimaSubsplines;
if (!C.executeOn(View.viewById("Starless"))) throw new Error("Curvas fallaron");
```

**Control.** 100 % y en negativo (imagen invertida): bandas de color, anillos alrededor de estrellas, ruido moteado, bordes de máscara. Porcentaje de píxeles > 0,98 antes y después. Textura en altas luces: "conservar ≥ 60 %; < 40 % = textura aplastada". "Señales de sobreprocesado: aspecto 'diseñado' en vez de 'observado', transiciones nebulosa–fondo demasiado limpias, bordes 'ilustrados', pérdida de grano en zonas débiles → bajar LHE, quitar HDRMT, curvas más suaves."
