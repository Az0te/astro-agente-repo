# Paso 9: Corrección de Gradiente

[← Índice](../SKILL.md) · Anterior: [Paso 8: Plate solve](08-plate-solve.md) · Siguiente: [Paso 10: Combinación RGB / NB](10-combinacion-rgb-nb.md) · Medidas, opciones de GraXpert, MGC y protocolo de comparativa: [detalle](../detalle/lineal-09-correccion-gradiente.md)

El gradiente es un offset de gran escala que no es del objeto: contamina SPCC, aplasta el polvo y el IFN y sale como velo al estirar. Se corrige **en lineal, por canal si los canales vienen de noches, filtros o cámaras distintos**, y antes de combinar y de BXT Correct Only.

**Método por defecto: proceso GraXpert, sample_free escala 10, sustracción**, sobre el master lineal recortado. Fue el que menos objeto copió en el modelo en M31, LDN 1235, IC 1396 e IC 63. Crea `GraXpert_sample_free_background_extraction` (corregida, conserva la astrometría) y `GraXpert_background` (modelo).

| Caso | Cadena |
|---|---|
| Por defecto | Recorte → `blindSolve` → GraXpert sample_free 10 → BXT Correct Only → comprobar WCS → SPCC |
| MGC | Recorte → `blindSolve` → `pxSPFC` → `pxMGC` (base MARS del perfil) → SPCC |
| Nebulosas oscuras, IFN, polvo extenso | Plano robusto grado 1 o muestras manuales; desconfiar de MGC y de la IA |
| Banda estrecha sin MGC | Polinomio sobre rejilla de medianas con rechazo sigma: grado 2 en OIII; en Hα sólo plano grado 1 en los bordes |

**Ajustes**

- **Sustracción** para contaminación lumínica (aditiva); **división** sólo para viñeteo residual. Ante la duda, probar las dos y comparar el modelo.
- Queda gradiente en el cielo → escala 8 (copia algo más, fondo más plano) o, si el residuo es liso, plano robusto grado 1 encima (no puede comerse formas).
- No usar la escala por defecto de sample_free (se comió el 18 % de M31) ni `-sample_free_simplified true`.
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

**Comparativa en una sola llamada** (`herramientas/gradiente.js`): lanza GraXpert y MGC sobre copias, mide cada modelo con `gcStructCopy`, mide además el gradiente que queda (rejilla 4×3), nombra las vistas (`GC_GX10`, `GC_GX10_modelo`, `GC_MGC2048`…), recomienda entre los que dejan ≤ 30 % del gradiente el que menos copia el objeto y, si se le pasa una ruta, escribe el dossier. Es la forma recomendada cuando no se puede ir paso a paso (modelos sin herramientas).

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

**Control.** Modelo liso y sin objeto; fondo no aplastado con el mismo STF antes y después; contraste objeto−cielo ≥ 90 % en polvo/IFN; `hasAstrometricSolution` al terminar. Anillo oscuro alrededor de un objeto extenso = se ha comido el halo: volver atrás y usar plano robusto o muestras manuales. En imágenes grandes GraXpert puede pasar de 60 s: esperar con `watcher_status`.
