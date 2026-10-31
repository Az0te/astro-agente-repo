# Paso 8: Procesado de estrellas

[← Índice](../SKILL.md) · Anterior: [Paso 7: Nitidez](07-nitidez.md) · Siguiente: [Paso 9: Recombinación](09-recombinacion.md)

**Por qué.** "La capa de estrellas = Original − Starless: contiene PSF completa, halos, aigrettes, residuos de nebulosa, núcleos de galaxias/cúmulos". Por eso se procesa aparte: hay que dejarla con el fondo a cero, el color recuperado y sin residuos, o el screen posterior mete basura en la imagen final.

**Preparación de la capa lineal** (aescaffre)

- "Estirarla recortando el fondo a cero (nunca auto-stretch, que levanta el fondo y amplifica residuos de SXT en manchas verdes/moradas)."
- Limpiar residuos: `iif($T < 0.005, 0, $T)`.
- Recuperar color con curva de saturación fuerte `[[0,0],[0.40,0.65],[0.70,0.90],[1,1]]`.
- "El fondo de la capa debe quedar negro puro."
- Si hay que contenerlas: "atenuar brillo (p. ej. `iif($T > 0.02, $T*0.65, $T)`) en vez de erosionar".
- **Suelo antes del screen** (NOVA): "punto negro por canal = mediana + 2·MAD de la capa, reescalando para no tocar los núcleos; si no, el screen añade al fondo el grano estirado entre estrellas. Pero en campos densos ese 'grano' puede ser estrellas débiles reales (Cocoon: 94 % de la varianza del fondo eran estrellas): no subir el suelo hasta borrarlas."

**Extracción en no lineal** (alternativa para evitar halos hinchados): "guardar un clon antes de SXT; SXT lineal para la starless; estirar la starless; aplicar al clon **exactamente el mismo estirado**; SXT con `unscreen=true` sobre el clon estirado → estrellas ya en rango de pantalla, listas para screen."

**Estrellas de banda estrecha** (si no hay RGB), fórmula de NB to RGB Stars con PixelMath: " R = 0,5·Hα + 0,5·SII, G = 0,3·Hα + 0,7·OIII, B = OIII (sin SII: R = Hα). Color plausible, no fotometría; una estrella saturada en las tres capas queda blanca."

**Halos y núcleos**

- "Estrella brillante con núcleo saturado: neutralizar a blanco en la capa de estrellas, o mejor evitarlo con la toma corta/HDR."
- "Halos magenta en la capa de estrellas: `G = iif(min(R,B) > G, min(R,B), G)`."
- "Atenuar suavemente (35–40 %) sólo la capa de estrellas en la corona del halo (entre ~2× el núcleo y el radio externo) es aceptable y se documenta; nunca tocar la nebulosa de esa zona."
- "No usar erosión/umbral (MorphologicalTransformation) para reducir estrellas: crea anillos. Mejor estirar menos las estrellas o usar tomas cortas."

**Código**

```javascript
// Limpieza de la capa de estrellas: fondo a cero y saturación (curva de aescaffre).
var PM = new PixelMath;
PM.useSingleExpression = true;
PM.expression = "iif($T < 0.005, 0, $T)";
if (!PM.executeOn(View.viewById("MasterLight_stars"))) throw new Error("Limpieza de estrellas falló");

// Suelo de la capa: mediana + 2*MAD por canal (medir antes; no subir hasta borrar estrellas débiles)
var v = View.viewById("MasterLight_stars");
if (!v || v.isNull) throw new Error("No existe MasterLight_stars");
var img = v.image, out = [];
for (var c = 0; c < img.numberOfChannels; ++c) {
   img.selectedChannel = c;
   out.push("canal " + c + " suelo = " + (img.median() + 2 * img.MAD()));
}
img.resetSelections();
out.join("\n");
```

**Control.** Fondo negro puro (mediana ≈ 0 después del suelo); p90 de la capa ≈ 0,25; sin manchas verdes/moradas de residuos de SXT; sin anillos de color; máximo < 0,98. "Zoom 200–400 % en zonas brillantes" para halos residuales.

**Halos: diagnóstico y recetas que funcionaron**

Diagnóstico previo, en este orden:

- Perfil radial azimutal (mediana) para buscar anillos.
- "Comparar posición en el cielo entre sesiones con distinta rotación de cámara: **un reflejo del filtro gira con la cámara; la estructura real no**."
- Halos que sólo aparecen en algunos subs = nubes finas o calima: quitar esos subs y reintegrar es lo más fiel a los datos. Con dos cámaras: "un halo que sólo está en una de ellas es instrumental."
- Excluir el entorno de la estrella brillante (máscara radial suave) de los realces de Hα y de detalle.

Reglas de la resta:

- "Restar halo con perfil radial **ajustado con curva suave** (polinomio en log-log), nunca con el perfil ruidoso directo → si no, quedan 'ondas' concéntricas. Si quedan, medir el perfil actual, separar escala lenta (gaussiana ~60 px en r) y restar sólo el rizado."
- "**No rellenar con un círculo plano**: borra fondo real y queda una mancha. Mejor dejar parte del halo (reinyectar ~50 % del halo ajustado con su color medido) y rellenar sólo el núcleo sin datos (r < ~200 px) con la continuación de la ley de potencias, monótona."
- "StarXTerminator corta el disco de estrellas muy brillantes con borde nítido (~115 px en γ Cas); al estirar más las estrellas aparece un anillo. Arreglo: prolongar el ala de la estrella con su pendiente medida (r^-p) y su color, desvaneciendo hasta ~300 px."

**Restos de SXT en estrellas muy brillantes (receta IC63 v4, "la que funcionó").** SXT en lineal dejó en la capa sin estrellas un cuadrado con arco iris en γ Cas y dejó enteras dos estrellas de mag ~4–5.

1. En la capa sin estrellas **lineal**, dentro de R0 (γ Cas 320 px; estrellas menores 80–120 px) sustituir por la continuación de su propio perfil azimutal medido entre R1 y R2 (ley de potencias ajustada en log-log, **pendiente ≈ −1,5 en γ Cas, −2 en las otras**), con tope en r = rcap ≈ R0, y transición suave R0→R1 con **R1 ≈ 3·R0** (γ Cas 900 px). "Con R1 ≈ 1,3·R0 quedó un anillo visible."
2. Sumar la diferencia exacta (antes − después) a la capa de estrellas lineal: "en lineal la suma sigue siendo el original; nada se borra".
3. Aun así, al estirar las capas por separado y recomponer en screen queda un escalón en el borde del relleno. Arreglo en la imagen **final**: perfil radial por canal (**percentil 40** de cada anillo, para no coger estrellas), versión lenta = gaussiana en r (**σ 25 px** en estrellas menores, **60 px** en γ Cas), restar sólo el rizado (perfil − lento) con rampas en los extremos. Amplitud quitada ≈ 0,03–0,09; el halo real se queda.
4. Hacer lo mismo en el Hα sin estrellas antes de restar el continuo: "si no, aparecen agujeros negros donde la R tenía la estrella y el Hα no".

**Halos instrumentales en la capa sin estrellas (receta LDN 1235, "la que funcionó").**

- Diagnóstico: índice de halo por sub constante en las dos sesiones, con y sin luna y a ambos lados del meridiano (no son nubes). El centro de cada halo, como centroide del exceso suavizado, estaba **desplazado 15–70 px hacia el centro óptico** respecto a su estrella: firma de reflejo. Eran más azules (**B ≈ 1,3–1,5×R**) y con Triband 1,3–4× menores (luz visible fuera de esas bandas, no IR).
- Tras SXT lineal, el exceso de halo en la starless (0,7–2,8 ×10⁻⁴) era "del orden del contraste del propio polvo".
- Restar por estrella y canal, **centrado en el halo y no en la estrella**: mediana azimutal en bins de 8–10 px, fondo = mediana más allá de Rh, exceso suavizado (media móvil de 5 bins) y forzado monótono, núcleo con tope constante (r < 40–80 px), borde coseno entre 0,6·Rh y Rh, **restar el 85 %**. Rh = 360–560 px en las 4 brillantes y 120–400 automático en las medianas (donde el exceso cae por debajo de 0,06 ×10⁻⁴). Se hizo en 19 estrellas; quedan fuera las que iluminan reflexiones (su brillo es nebulosa real).
- "**Localizar las estrellas por centroide del flujo** en la capa de estrellas, nunca por el píxel máximo: con núcleos saturados el máximo cae en otra estrella (180 px de error en LDN 1235)."
- Núcleo mal separado por SXT: "**no rellenar con un valor plano** (disco visible). Ajustar una superficie de grado 2 al anillo r = 190–250 px y fundirla dentro con transición de 50 px."
- "Atenuar suavemente (35–40 %) sólo la capa de estrellas en la corona del halo (entre ~2× el núcleo y el radio externo) es aceptable y se documenta; nunca tocar la nebulosa de esa zona."
