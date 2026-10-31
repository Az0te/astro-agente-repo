# Paso 15: StarX y NXT de la starless

[← Índice](../SKILL.md) · Anterior: [Paso 14: NoiseX suave (opcional)](14-noisex-suave.md) · Siguiente: [Paso 16: LinearFit / sustracción de continuo](16-linearfit-continuo.md)

**Por qué.** Separar estrellas permite estirar la nebulosa a fondo sin hinchar las estrellas y procesar cada capa con su propia receta. "SXT: lo antes posible en lineal (no arcsinh/GHS/MaskedStretch/HDR multiescala antes, deforman perfiles)". En lineal la separación es exacta: estrellas = original − starless.

**Reglas**

- `stars=true`, `unscreen=false` en lineal → **suma exacta**: starless + estrellas = original.
- La imagen de estrellas se llama `<id>_stars`: detectarla comparando la lista de ventanas antes y después.
- "`P.starmask` y `P.linear` no existen".
- Overlap: 0,20 normal; 0,50 sólo con estrellas muy grandes, campos densos o costuras (×3 tiempo).
- No usar STF Auto Stretch en la imagen de estrellas.
- "No separar estrellas en cúmulos (abiertos o globulares): las estrellas son el objeto."
- "SXT rinde peor con aberraciones fuertes, sobremuestreo (p. ej. drizzle 2x) y estirados extremos tipo GHS/arcsinh (RC-Astro); puede quitar núcleos de galaxias, núcleos de planetarias, comas de cometas y cruces de filamentos (proteger con máscara)."
- "En galaxias espirales grandes SXT confunde regiones HII y nudos con estrellas: el estirado de estrellas amplifica esos residuos; usar screen, estirado moderado o no separar estrellas."

**Código**

```javascript
var v = View.viewById("MasterLight");
if (v.isNull) throw new Error("No existe MasterLight");
var SXT = new StarXTerminator;
SXT.stars = true;        // genera la capa de estrellas
SXT.unscreen = false;    // lineal: suma exacta starless + stars
// SXT.overlap = 0.20;   // 0,50 solo con estrellas muy grandes / campos densos (x3 tiempo)
if (!SXT.executeOn(v)) throw new Error("StarX falló");
"starless + MasterLight_stars";
```

**Control.** "Una starless 'limpia' no prueba que la separación sea buena: revisar la diferencia original − starless." Esa diferencia debe contener **sólo** estrellas y sus halos, no filamentos, polvo ni núcleos de galaxia. Comprobar el recuento de estrellas de la capa frente al original. Y la suma `starless + stars` debe reproducir el original píxel a píxel (en lineal es exacta).

**NXT principal sobre la starless (lineal)**

Es el denoise fuerte del flujo: va aquí, sobre la capa sin estrellas y todavía en lineal, no antes de BXT ni sobre la imagen con estrellas.

| Parámetro | Partida |
|---|---|
| denoise | 0,70–0,80 (no el 0,90 por defecto) |
| detail | 0,10–0,20 (más alto crea halos oscuros en estrellas) |
| iterations | 2–3 (hasta 5: conservan mejor el detalle débil y limpian el moteado de gran escala) |
| Separación de color | croma > luminancia (LDN 1235: croma 0,90, luminancia 0,40, detail 0,25); 0,75 por igual dio aspecto plástico |
| Variante "full" (RC-Astro) | separación intensidad/color y de frecuencia: HF y LF 0,80 en intensidad y color, escala HF/LF 5, iterations 5 |

Elegir con una rejilla sobre la starless de la BXT ganadora (Paso 13): denoise 0,50 / 0,70 / 0,85 × iterations 2 / 5, más una variante con separación de color. Medir en cajas fijas: σ del cielo (bajar un 50–80 %, nunca a cero), contraste de una zona débil (no bajar más de ~5 %), imagen residual (sólo ruido) y FWHM de estrellas si se aplica a la capa con estrellas.

```javascript
var v = View.viewById("MasterLight_starless");
if (v.isNull) throw new Error("No existe la starless");
var NXT = new NoiseXTerminator;
NXT.denoise = 0.75;      // confirmar nombres con describe_process NoiseXTerminator
NXT.detail = 0.15;
NXT.iterations = 3;
if (!NXT.executeOn(v)) throw new Error("NXT principal falló");
"NXT principal sobre la starless";
```
