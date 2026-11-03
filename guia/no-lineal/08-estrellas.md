# Paso 8: Procesado de estrellas

[← Índice](../SKILL.md) · Anterior: [Paso 7: Nitidez](07-nitidez.md) · Siguiente: [Paso 9: Recombinación](09-recombinacion.md) · Diagnóstico de halos y recetas de IC 63 y LDN 1235: [detalle](../detalle/no-lineal-08-estrellas.md)

La capa de estrellas (original − starless) lleva PSF, halos, aigrettes y residuos de SXT. Tiene que quedar con el fondo a cero, el color recuperado y sin residuos, o el screen mete esa basura en la imagen final.

**Preparación de la capa**

- Estirarla recortando el fondo a cero (`starStretch`, Paso 1); nunca auto-stretch, que levanta el fondo y los residuos de SXT (manchas verdes o moradas).
- Limpiar residuos: `iif($T < 0.005, 0, $T)`. Recuperar color con la curva de saturación `[[0,0],[0.40,0.65],[0.70,0.90],[1,1]]`.
- **Suelo antes del screen:** punto negro por canal = mediana + 2·MAD de la capa, reescalando para no tocar los núcleos. En campos densos ese "grano" pueden ser estrellas débiles reales: no subir el suelo hasta borrarlas.
- Contenerlas atenuando el brillo (`iif($T > 0.02, $T*0.65, $T)`), nunca con erosión ni MorphologicalTransformation (anillos).

**Extracción en no lineal** (evita halos hinchados): clon antes de SXT → SXT lineal para la starless → estirar la starless → aplicar al clon **exactamente el mismo estirado** → SXT con `unscreen=true` sobre el clon → estrellas listas para screen.

**`screenStarsExtract`** (ScreenStars, mismo resultado que el script)

- Cuándo: hay imagen con estrellas y starless **con el mismo estirado** y hace falta la capa de estrellas sin repetir SXT (tras retocar la starless, o para rehacer la capa de otra versión).
- Por qué: es la inversa exacta de `screenStarsCombine`; separar y recombinar devuelve la imagen original.
- Cómo: `screenStarsExtract("Original_st", "Starless_st")` crea la capa nueva. Mismo `method` que se usará al recombinar. Si los estirados no coinciden, salen halos o agujeros: no usarla.

**Estrellas de banda estrecha** (si no hay RGB): R = 0,5·Hα + 0,5·SII, G = 0,3·Hα + 0,7·OIII, B = OIII (sin SII: R = Hα). Color plausible, no fotometría.

**Halos y núcleos**

- Núcleo saturado: neutralizarlo a blanco en la capa, o mejor evitarlo con toma corta / HDR.
- Halos magenta: `G = iif(min(R,B) > G, min(R,B), G)`.
- Atenuar 35–40 % sólo la capa de estrellas en la corona del halo es aceptable y se documenta; nunca tocar la nebulosa de esa zona.
- Halo dudoso (¿reflejo, nubes, real?), restos de SXT en estrellas muy brillantes o halos instrumentales en la starless: ver el detalle antes de tocar nada.

```javascript
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
   out.push("canal " + c + " suelo = " + (img.median() + 2 * img.MAD()).toFixed(5));
}
img.resetSelections();
out.join("\n");
```

**Control.** Fondo negro (mediana ≈ 0 tras el suelo); p90 ≈ 0,25; sin manchas de residuos de SXT ni anillos de color; máximo < 0,98; halos residuales revisados al 200–400 % en zonas brillantes.
