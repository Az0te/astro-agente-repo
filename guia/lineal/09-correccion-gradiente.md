# Paso 9: Corrección de Gradiente

[← Índice](../SKILL.md) · Anterior: [Paso 8: Plate solve](08-plate-solve.md) · Siguiente: [Paso 10: Combinación RGB / NB](10-combinacion-rgb-nb.md) · Medidas, opciones de GraXpert, MGC y protocolo de comparativa: [detalle](../detalle/lineal-09-correccion-gradiente.md)

El gradiente es un offset de gran escala que no es del objeto: contamina SPCC, aplasta el polvo y el IFN y sale como velo al estirar. Se corrige **en lineal, por canal si los canales vienen de noches, filtros o cámaras distintos**, y antes de combinar y de BXT Correct Only.

**Sin método fijo: se comparan siempre los candidatos y se aplica el que mejor funcione en esa imagen**: el que quita el gradiente copiando menos el objeto en su modelo (`gradienteCandidatos`, abajo). Ningún método gana siempre:
- GraXpert sample_free escala 10 copió poco objeto en una nebulosa oscura, nebulosa dual band y una nebulosa de emisión y reflexión.
- En galaxia grande ganó un polinomio de grado 2: GraXpert se comía el 8,5 % de la galaxia.
- En polvo e IFN, MGC se comió el 75 % del contraste.

El proceso GraXpert crea `GraXpert_sample_free_background_extraction` (corregida, conserva la astrometría) y `GraXpert_background` (modelo).

| Caso | Cadena |
|---|---|
| GraXpert | Recorte → `blindSolve` → GraXpert sample_free 10 → BXT Correct Only → comprobar WCS → SPCC |
| MGC | Recorte → `blindSolve` → `pxSPFC` → `pxMGC` (base MARS del perfil) → SPCC |
| Nebulosas oscuras, IFN, polvo extenso | Plano robusto grado 1 o muestras manuales; desconfiar de MGC y de la IA |
| Banda estrecha sin MGC | Polinomio sobre rejilla de medianas con rechazo sigma: grado 2 en OIII; en Hα sólo plano grado 1 en los bordes |

**Ajustes**

- **Sustracción** para contaminación lumínica (aditiva); **división** sólo para viñeteo residual. Ante la duda, probar las dos y comparar el modelo.
- Queda gradiente en el cielo → escala 8 (copia algo más, fondo más plano) o, si el residuo es liso, plano robusto grado 1 encima (no puede comerse formas).
- No usar la escala por defecto de sample_free (se comió el 18 % de una galaxia grande) ni `-sample_free_simplified true`.
- IA de GraXpert: sólo objetos pequeños en campo amplio; se come objetos extensos.
- Con GraXpert por sustracción el fondo sale además con el color neutralizado; MGC no lo hace. Comparar el color del fondo después de SPCC.
- `herramientas/graxpert.js` (ejecutable externo) sólo para RBF, Kriging, Splines con muestras propias o denoise.

**Revisar el modelo siempre**, antes de aceptarlo: liso, sin la forma del objeto, sin bordes ni anillo oscuro. Medida: `gcStructCopy` (correlación < 0,15 limpio; > 0,5 se come el objeto) y contraste objeto−cielo en cajas de 300 px (≥ 90 % en polvo e IFN). Si no convence, hacer la comparativa de candidatos del detalle.

```javascript
var G = new GraXpert;
G.backgroundExtraction = true;
G.backgroundExtractionSampleFree = true;
G.sampleFreeScale = 10;                 // 8 si queda gradiente
G.correction = "Subtraction";
G.createBackground = true;
G.replaceImage = false;
if (!G.executeOn(View.viewById("MasterLight"))) throw new Error("GraXpert falló");
var wc = ImageWindow.windowById("GraXpert_sample_free_background_extraction");
if (wc.isNull || !wc.hasAstrometricSolution) throw new Error("Falta la corregida o ha perdido la astrometría");
eval(File.readTextFile("<ruta de guia>/herramientas/gradcompare.js"));
var base = gcPrepare("MasterLight", 8);
gcStructCopy(base, "GraXpert_background");   // corr < 0,15 = limpio
```

```javascript
// MGC: SPFC -> MGC -> SPCC (los tres necesitan WCS).
var v = View.viewById("MasterLight");
if (!v || v.isNull) throw new Error("No existe MasterLight");
if (!ImageWindow.windowById("MasterLight").hasAstrometricSolution) throw new Error("Sin WCS: parar");
eval(File.readTextFile("<ruta de guia>/herramientas/procesos.js"));
if (!pxSPFC({ /* filtros y QE del perfil */ }).executeOn(v)) throw new Error("SPFC falló");
var mgc = pxMGC({ mars: "<base MARS del perfil>", gradientScale: 2048 });   // 1024 / 2048 / 4096
if (!mgc.executeOn(v)) throw new Error("MGC falló");   // crea <vista>_MGC_gradient_model para revisarlo
"SPFC + MGC aplicados";
```

**Comparativa en una sola llamada** (`herramientas/gradiente.js`): `gradienteCandidatos(vista, { spfc, dossier })` compara por defecto, sobre copias:
- GraXpert sample_free 10 y 8;
- MGC 1024 y 2048, con y sin corrección de bordes;
- polinomio robusto de grado 1 y 2 por canal, ajustado fuera del objeto.

Mide cada uno así:
- `gcStructCopy`: cuánto se parece el modelo al objeto.
- `come_objeto_pct`: % de la señal del objeto que se lleva el modelo.
- `fondoResidual`: gradiente del **cielo** que queda, en una rejilla 8×8 fuera del objeto.

Recomienda, entre los que no se comen el objeto (≤ 3 % y |corr| < 0,3), el que deja el cielo más plano. Nombra las vistas `GC_GX10`, `GC_MGC2048_borde`, `GC_POLY2`… con su `_modelo`. Si se le pasa una ruta, escribe el dossier. El resultado lleva una `leyenda` de cómo leer las medidas.

Comprobado con una galaxia grande (nov 2026, 100 s con los 8 candidatos). Reproduce la decisión de octubre:
- GraXpert 10 se lleva el **8,5 %** de la galaxia.
- MGC 2048 se lleva el 1,8 %.
- El polinomio de grado 2, el 0 %, con el cielo igual de plano (13 % del gradiente): recomendado.

Antes el gradiente que quedaba se medía en una rejilla 4×3 de toda la imagen. En objetos grandes medía la galaxia y no el gradiente, y daba por bueno a GraXpert.

```javascript
eval(File.readTextFile("<ruta de guia>/herramientas/gradiente.js"));   // en el nivel superior del script
var r = gradienteCandidatos("MasterLight", {
  graxpert: [10, 8], mgc: [2048],
  spfc: { /* filtros y QE del perfil */ }, mars: "<base MARS del perfil>",
  mgcOpts: { /* structureSeparation, modelSmoothness del perfil */ },
  dossier: "<ruta del dossier .json>"
});
JSON.stringify(r);   // candidatos (corr, copia, fondoResidual), recomendado, motivo, errores
```
En MGC, si la nebulosa aparece en el modelo, subir la escala; si aparece en negativo, bajarla.

**MGC en PixInsight 1.9.6+** (medido en una nebulosa oscura binada ×2, nov 2026):
- `edgeCorrection` (corrección de bordes): `gradienteCandidatos` prueba cada escala con y sin ella (`GC_MGC2048_borde`). En nebulosa oscura dejó los bordes a ±1·10⁻⁵ del centro (sin ella, hasta −5·10⁻⁵) y bajó el gradiente que queda del 83 % al 59 %, pero el modelo copia algo más el polvo (corr −0,13 → +0,16). Elegir con las medidas, y mirar el modelo en nebulosas oscuras.
- `autoScaleFactors`: ajusta a la imagen el factor de cada canal de MARS (nebulosa oscura: R 0,92, G 0,61, B 0,64), pero el modelo cambió sólo un 2–6 %. Se deja apagado; `gradienteCandidatos` devuelve en `ajuste_mars` el factor y la correlación con MARS de cada canal (correlación baja, < 0,3 = MARS se parece poco a la imagen: desconfiar de MGC).
- Sin la opción `mars`, `pxMGC` y `gradienteCandidatos` usan la base MARS configurada en las preferencias de MGC (comando de servidor `set-default-database-files`).
- Píxeles a 0 (bordes negros del registro): MGC los trata como sin datos. Siguen a 0 y la franja de al lado queda igual que si se hubiera recortado. Aun así, recortar primero (Paso 5).
- En `pxMGC`: opciones `edgeCorrection`, `edgeAggressiveness` (2) y `autoScaleFactors`; se ignoran en versiones sin ellas.

**Control.** Modelo liso y sin objeto; fondo no aplastado con el mismo STF antes y después; contraste objeto−cielo ≥ 90 % en polvo/IFN; `hasAstrometricSolution` al terminar. Anillo oscuro alrededor de un objeto extenso = se ha comido el halo: volver atrás y usar plano robusto o muestras manuales. En imágenes grandes GraXpert puede pasar de 60 s: esperar con `watcher_status`.
