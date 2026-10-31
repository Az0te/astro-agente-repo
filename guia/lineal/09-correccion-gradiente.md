# Paso 9: Corrección de Gradiente

[← Índice](../SKILL.md) · Anterior: [Paso 8: Plate solve](08-plate-solve.md) · Siguiente: [Paso 10: Combinación RGB / NB](10-combinacion-rgb-nb.md)

**Por qué.** El gradiente es un offset de gran escala que no pertenece al objeto: contamina la calibración de color (SPCC mide el fondo), aplasta el contraste del polvo y del IFN y aparece como un velo al estirar. Y se corrige **en lineal y por canal**, antes de combinar: "Si los canales tienen gradientes distintos (otras noches/filtros/cámaras), corregir por canal antes de combinar". Un gradiente que llega al estirado ya no se puede separar de la señal débil.

**Método predeterminado (desde el 29 oct 2026).** "**GraXpert sample_free, escala 10, por sustracción** (`graxpertBGE()` sin opciones, de `guia/herramientas/graxpert.js`) sobre el master lineal recortado". Elegido con la prueba medida de `20-graxpert-comparativa-gradientes.md`.

**Cadena de procesos alrededor del gradiente**

| Caso | Cadena documentada |
|---|---|
| GraXpert (predeterminado) | Recorte → `blindSolve` → **GraXpert sample_free 10** (devuelve la astrometría copiada) → BXT Correct Only → comprobar WCS → SPCC |
| MGC | RGB → **SPFC_RGB** → **MGC** (MARS) → SPCC |
| Banda estrecha sin MGC | "polinomio suave propio sobre rejilla de medianas con rechazo sigma (grado 2 en OIII; en Hα sólo plano grado 1 ajustado en bordes, para no comerse emisión difusa real)" |

**Sustracción o división**

- Corrección **por sustracción** para gradientes de contaminación lumínica (aditivos).
- **Por división** sólo para viñeteo residual (multiplicativo, flats imperfectos) en ABE/DBE/GraXpert.
- "Ante la duda probar las dos y comparar el modelo."

**GraXpert en detalle**

- Programa independiente (Dark Matters); desde la v3.1 también tiene modelos de denoise y deconvolución, que "no sustituyen a NXT/BXT".
- Fondo de cada muestra: sigma-clipping (> 3σ de la mediana y píxeles a < 4 px de ellos, iterando) y mediana del resto.
- **Salida por sustracción:** `resultado = original − modelo + media(modelo)`, con la media **de los tres canales juntos**: además de quitar el gradiente, **neutraliza el color del fondo**. MGC no lo hace. Al comparar, medir el color del fondo después de SPCC, no antes.
- **Salida por división:** `original / modelo × media(modelo)` con la media **por canal**.
- Extrae el fondo con un modelo de IA o con métodos clásicos sobre puntos de muestra: splines, funciones de base radial (thin-plate, lineal, cúbica, quíntica, con suavizado), kriging y sample_free.
- La guía no usa el script de PixInsight (Toolbox/Graxpert.js). Por dentro sólo guarda la imagen, ejecuta `GraXpert -cli` con `ExternalProcess` y reabre el resultado, siempre con IA. Desde el watcher se usa `guia/herramientas/graxpert.js`:

```javascript
eval(File.readTextFile("<ruta de guia>/herramientas/graxpert.js"));
var r = graxpertBGE("<vista>");      // sample_free, escala 10 por defecto
// crea GC_GraXpert_<tag> (corregida) y GC_GraXpert_<tag>_model (modelo),
// con la astrometría del original copiada; devuelve {corrected, model, seconds, log}
```

- El ejecutable se busca en las rutas habituales; si no está, definir `var GX_EXE = "ruta"` antes del `eval`.
- Opciones: `method` (sample_free por defecto, AI, RBF, Kriging, Splines), `scale` (sample_free, 1–10, por defecto 10), `smoothing` 0–1, `correction` (Subtraction o Division), `aiVersion`, `gpu: false`, `prefs`, `extra` (`-sample_free_scale`, `-sample_free_smoothness`, `-sample_free_protect`, `-sample_free_protect_threshold`, `-sample_free_protect_amount`, `-sample_free_simplified`, `-sample_free_degree`, `-sample_free_downsample`), `tag`, `keepFiles`, `maxMinutes`.
- Denoise: `graxpertDenoise("<vista>", {strength: 0.5})`; "es una alternativa a comparar con NXT, no un sustituto".
- Si cambia la versión de GraXpert, confirmar las opciones con `GraXpert -cli -cmd background-extraction -h`.

**Ajustes de partida (medidos el 29 oct 2026 en M31, LDN 1235, IC 1396 e IC 63)**

| Ajuste | Instrucción |
|---|---|
| Base | sample_free, escala 10, sustracción: el que menos objeto copia en el modelo en los cuatro casos |
| Escala 8 | "si queda gradiente en el cielo: copia un poco más, pero deja el fondo más plano" |
| Escala por defecto de sample_free | **No usarla**: se comió el 18 % de M31 y copió la estructura de IC 1396 |
| `-sample_free_simplified true` | Peor: 30 % de M31 |
| `-sample_free_protect` | "no cambia nada" en GraXpert 4.0.0 (resultados idénticos activado o no) |
| IA | El suavizado casi no influye (de 0 a 1: M31 pasó de 21,5 % a 17,9 %); se come objetos extensos (bulbo y halo de M31, nubes de IC 1396, halo de γ Cas). Sólo con objetos pequeños en campo amplio, o si sample_free deja un gradiente complejo, y siempre revisando el modelo |
| División | Sólo para viñeteo residual |
| Tiempo | IA ~4 s y sample_free ~14 s en una imagen de 6000×4000 con GPU |
| Gradiente residual liso | "quitarlo con el plano robusto de grado 1 (no puede comerse formas) en vez de bajar la escala" |

**Tabla de resultados de GraXpert 4.0.0** ("copia" = estructura del original copiada en el modelo, `gcStructCopy`, correlación entre paréntesis; "come" = señal del objeto en el modelo)

| Objeto | IA s0,1 | IA s1,0 | SF por defecto | SF escala 8 | SF escala 10 |
|---|---|---|---|---|---|
| M31 (galaxia extensa) | come 21 %, copia 6 % (0,56) | come 18 % (0,51) | come 18 % (0,09) | come 6,6 % (0,07) | **come 4 % (0,10)** |
| LDN 1235 (nebulosa oscura) | copia 0,1 % (0,02) | — | copia 2 % (0,18) | copia 1,2 % (0,15) | **copia 0,8 % (0,13)** |
| IC 1396 (nebulosa que llena el campo) | copia 48 % (0,79) | IA s0,5: 37 % (0,74) | copia 39 % (0,76) | copia 22 % (0,68) | **copia 14 % (0,61)** |
| IC 63 (γ Cas) | modelo con mancha en γ Cas | — | estructura alrededor del fantasma | liso | liso |

Masters lineales sin tocar (IC 1396, LDN 1235 e IC 63 binados ×2), luminancia binada ×8, con BXT Correct Only previo. En IC 63 la medida está dominada por el halo de γ Cas: se juzgó a la vista. Conclusión: **sample_free escala 10 como punto de partida**; en nebulosas que llenan el campo (IC 1396) aún copia algo: revisar el modelo y, si hace falta, comparar con el plano robusto o RBF con muestras propias.

Resultados anteriores, sin GraXpert: LDN 1235 (nebulosa oscura) → ganó el plano de grado 1, MGC 2048/4096 se comió el 75 % del contraste del polvo; IC 63 (emisión + reflexión) → MGC, sin comparar con otros métodos.

En imágenes grandes GraXpert puede pasar del corte de 60 s del MCP: esperar con `watcher_status` y comprobar las ventanas `GC_GraXpert_*`.

**MGC / MARS**

- Modelo: `I ≈ k·R + G + ε`. Prerrequisitos en orden: master lineal recortado (sin bordes de apilado) → astrometría (`blindSolve`) → SPFC → MGC → SPCC.
- Parámetros: Gradient scale (pequeña = riesgo de absorber cielo real; grande = subcorrección), Structure separation, Model smoothness, Scale factors R/G/B (corregir si el objeto imprime en el modelo), Gray filter en mono.
- Diagnóstico: modelo liso, sin objeto fantasma, sin bordes, fondo corregido no aplastado, mismo STF antes/después, control por canal. "El modelo de gradiente es la prueba." Si la nebulosa aparece en el modelo, el brillo de los objetos está infravalorado (subir escala); si aparece en negativo, sobrevalorado.
- **Medirlo, no sólo mirarlo:** medianas en cajas de 300 px sobre el objeto y sobre el cielo cercano, antes y después. En LDN 1235, con escala 2048 y 4096 el modelo reproducía el borde del tiburón y el contraste polvo−cielo bajaba de 1,16 a 0,26–0,30 ×10⁻⁴ (−75 %). "**En nebulosas oscuras, IFN y polvo extenso, desconfiar de MGC.**"
- MGC ya no es el método predeterminado: usarlo como candidato en la comparativa.

**DBE clásico como referencia**: "tolerancia ~2,0, shadows relaxation ~6, pocas muestras (gradiente = gran escala), nunca sobre nebulosa".

**Plano robusto (control conservador).** "Plano robusto de grado 1 (rejilla 24×16 de medianas, mínimos cuadrados con rechazo iterativo a 2σ) restado con PixelMath por canal. No puede crear ni borrar formas; antes, confirmar en una vista binada con mediana que el gradiente es liso (en LDN 1235, brillo verdoso hacia arriba a la derecha)."

**Protocolo de comparativa** (cuando el modelo de GraXpert no convence: correlación de `gcStructCopy` alta o forma del objeto visible en el modelo)

1. Entrada común: el mismo master lineal, recortado y con astrometría, en el punto del flujo en que se va a corregir (antes de BXT Correct Only). Guardar una copia intacta.
2. Candidatos, cada uno a una ventana nueva `GC_<metodo>`: MGC (SPFC previo, escalas 1024/2048/4096 si hay duda); GraXpert sample_free escala 10 y 8, y GraXpert IA; GraXpert RBF con muestras manuales si el objeto llena el campo; plano robusto grado 1 (y 2 si el gradiente es curvo); DBE con pocas muestras (opcional). Guardar también el modelo de cada uno.
3. Métricas con `<versión>/tools/gradcompare.js`, resultados en CSV:
   - **Forma del objeto en el modelo:** correlación entre el modelo (sin su ajuste de grado 1) y una máscara del objeto (luminancia suavizada por encima de cielo + 3σ). Cerca de 0 = bien; positiva = se come el objeto; negativa = lo infla.
   - **Contraste objeto−cielo:** medianas en 4–6 cajas fijas (300 px) sobre el objeto y sobre cielo cercano, % conservado respecto al original. Penalizar < 90 % en polvo/IFN.
   - **Planitud del fondo:** rejilla 8×8 de medianas sigma-clipped sólo en cajas de cielo; rango y σ por canal.
   - **Color del fondo:** R/G y B/G en la rejilla, medido **después de SPCC** en todos.
   - **Anillo oscuro:** perfil radial alrededor del objeto (objetos extensos): mínimo por debajo del cielo lejano = sobrecorrección.
   - **Ruido:** σ en cajas de cielo antes y después.
4. Vista: tríptico original / corregido / modelo con el mismo STF, más una plancha con los modelos de todos los candidatos; comprobar también con un estirado agresivo.
5. Decisión: gana el que conserva el contraste del objeto con el fondo más plano y sin anillo; en empate, GraXpert sample_free escala 10.
6. Registrar el resultado en la tabla de arriba (objeto, tipo, ganador, métricas clave, notas) y guardar también el modelo de cada candidato.

**Revisión del modelo con medida**

- `gcStructCopy(base, modelo)` de `guia/herramientas/gradcompare.js` da la correlación entre la estructura de gran escala del original y la del modelo (sin estrellas y sin gradiente liso). **Correlación < 0,15 = limpio; > 0,5 = se come el objeto.**
- "Confirmarlo a la vista con el modelo menos su gradiente liso: cualquier forma reconocible del objeto es señal perdida."
- Revisar siempre el modelo que devuelve GraXpert: "liso, sin la forma del objeto y sin anillo oscuro".

**Código**

```javascript
// Gradiente por defecto: GraXpert sample_free, escala 10, sustracción.
eval(File.readTextFile("C:/ASTRO/guia/herramientas/graxpert.js"));
var r = graxpertBGE("MasterLight");           // crea GC_GraXpert_default y su _model
if (!ImageWindow.windowById(r.corrected).hasAstrometricSolution)
   throw new Error("El resultado de GraXpert ha perdido la astrometría");
// Revisión del modelo antes de aceptarlo:
//   - abrir GC_GraXpert_default_model con STF, restarle su ajuste de grado 1
//   - gcStructCopy(<base>, <modelo>) segun guia/herramientas/gradcompare.js
JSON.stringify({ corrected: r.corrected, model: r.model, seconds: r.seconds });
```

```javascript
// Variante medida cuando el modelo no convence: sample_free escala 8 o IA.
var r8 = graxpertBGE("MasterLight", { method: "sample_free", scale: 8, tag: "sf8" });
var rAI = graxpertBGE("MasterLight", { method: "AI", tag: "ai" });
[r8.corrected, rAI.corrected].join(" | ");
```

```javascript
// MGC: SPFC -> MGC -> SPCC (los tres necesitan WCS). Nombres comprobados en PixInsight 1.9.6.
var v = View.viewById("MasterLight");
if (v.isNull) throw new Error("No existe MasterLight");
if (!ImageWindow.windowById("MasterLight").hasAstrometricSolution) throw new Error("Sin WCS: Parar");
eval(File.readTextFile("<ruta de guia>/herramientas/procesos.js"));
var spfc = pxSPFC({ /* filtros y QE del perfil */ });
if (!spfc.executeOn(v)) throw new Error("SPFC falló");
var mgc = pxMGC({ mars: "<base MARS del perfil>", gradientScale: 2048 });   // 1024 / 2048 / 4096 en la comparativa
if (!mgc.executeOn(v)) throw new Error("MGC falló");   // crea <vista>_MGC_gradient_model para revisarlo
// Probado el 31 oct 2026: SPFC 2,7 s y MGC 5,6 s en 3008×3222.
if (!mgc.executeOn(v)) throw new Error("MGC falló");
"SPFC + MGC aplicados";
```

**Control.** Modelo liso, sin objeto fantasma, sin bordes, fondo no aplastado, mismo STF antes/después. Medir el contraste objeto−cielo en cajas de 300 px (no debe bajar del 90 % en polvo/IFN). Comprobar `hasAstrometricSolution` al terminar. Si aparece un anillo oscuro alrededor de un objeto extenso, el extractor se ha comido el halo: volver atrás y usar plano robusto o muestras manuales.

> **Orden.** El gradiente se corrige antes de BXT Correct Only, como en los flujos de astro-photographie (Gradient Correction → BXT Correct Only → Plate Solve → SPCC). La tabla de GraXpert se midió con BXT CO previo; como el modelo de fondo es de gran escala y Correct Only sólo cambia el perfil de las estrellas, no se espera que el orden cambie el resultado, pero no está medido (Anexo C).
