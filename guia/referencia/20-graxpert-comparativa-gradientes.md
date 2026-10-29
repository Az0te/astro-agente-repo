# GraXpert y comparativa de corrección de gradientes

## GraXpert: método predeterminado de corrección de gradientes (desde el 29 oct 2026)
Por defecto: **GraXpert sample_free, escala 10, sustracción** (`graxpertBGE("<vista>")`), elegido con la prueba medida de abajo. La comparativa queda para cuando el modelo no convence.
- **Qué es:** programa independiente y libre (Dark Matters). Extracción de fondo con modelo de IA o con métodos clásicos sobre puntos de muestra: splines, funciones de base radial (thin-plate, lineal, cúbica, quíntica, con parámetro de suavizado) y kriging (sin suavizado). Desde la v3.1 también tiene modelos de denoise y deconvolución (estelar y de objeto); no sustituyen a NXT/BXT, pero se pueden comparar.
- **Fondo de cada muestra:** sigma-clipping (fuera > 3σ de la mediana y los píxeles a < 4 px de ellos, iterando) y mediana del resto.
- **Salida por sustracción:** `resultado = original − modelo + media(modelo)`, con la media **de los tres canales juntos**: además de quitar el gradiente, **neutraliza el color del fondo**. MGC no lo hace. Al comparar, medir el color del fondo después de SPCC, no antes.
- **Salida por división:** `original / modelo × media(modelo)` con la media **por canal** (para viñeteo residual).
- **El script de PixInsight (Toolbox/Graxpert.js) no se lanza desde el watcher** (error de script recursivo). Por dentro (`Toolbox/GraXpertLib.jsh`) sólo guarda la imagen, ejecuta `GraXpert -cli … -correction … -smoothing …` con `ExternalProcess` y reabre el resultado; siempre en modo IA.
- **Desde el watcher: `guia/herramientas/graxpert.js`** (probado en oct 2026 con GraXpert 4.0.0 "Charon", IA de fondo 1.0.1 con GPU; 2–8 s en una imagen pequeña). Llama directamente al ejecutable:
  - `eval(File.readTextFile("<ruta de guia>/herramientas/graxpert.js")); var r = graxpertBGE("<vista>");` (sample_free, escala 10) → crea `GC_GraXpert_<tag>` (corregida) y `GC_GraXpert_<tag>_model` (modelo de fondo), **con la astrometría del original copiada**, y devuelve `{corrected, model, seconds, log}`.
  - El ejecutable se busca en las rutas habituales; si no está, definir `var GX_EXE = "ruta"` antes del `eval` y anotarla en el perfil.
  - Opciones: `method` (sample_free por defecto, AI, RBF, Kriging, Splines), `scale` (sample_free, 1–10, por defecto 10), `smoothing` 0–1, `correction` (Subtraction o Division), `aiVersion`, `gpu: false`, `prefs` (fichero de preferencias con puntos de muestra), `extra` (argumentos `-sample_free_scale`, `-sample_free_smoothness`, `-sample_free_protect`, `-sample_free_protect_threshold`, `-sample_free_protect_amount`, `-sample_free_simplified`, `-sample_free_degree`, `-sample_free_downsample`), `tag`, `keepFiles`, `maxMinutes`.
  - Denoise: `graxpertDenoise("<vista>", {strength: 0.5})`. La primera vez descarga el modelo. Es una alternativa a comparar con NXT, no un sustituto.
  - En imágenes grandes puede pasar del corte de 60 s del MCP: esperar con `watcher_status` y comprobar las ventanas `GC_GraXpert_*`.
  - Si cambia la versión de GraXpert, confirmar las opciones con `GraXpert -cli -cmd background-extraction -h`; no suponer nombres de parámetros.
- **Ajustes de partida (medidos el 29 oct 2026 en M31, LDN 1235, IC 1396 e IC 63; tabla abajo):**
  - **sample_free, escala 10, sustracción.** Es el que menos objeto copia en el modelo en los cuatro casos. Escala 8 si queda gradiente en el cielo: copia un poco más, pero deja el fondo más plano. Más escala = modelo más liso = menos objeto comido y algo más de gradiente residual.
  - **No usar la escala por defecto de sample_free** (se comió el 18 % de M31 y copió la estructura de IC 1396), ni `-sample_free_simplified true` (peor: 30 % de M31).
  - **`-sample_free_protect` no cambia nada** en GraXpert 4.0.0 (resultados idénticos activado o no).
  - **IA:** el suavizado casi no influye (de 0 a 1: M31 pasó de 21,5 % a 17,9 %). Se come los objetos extensos (bulbo y halo de M31, nubes de IC 1396, halo de γ Cas en IC 63). En LDN 1235 su modelo fue el más limpio. Usarla sólo con objetos pequeños en un campo de cielo amplio, o si sample_free deja un gradiente complejo, y siempre revisando el modelo.
  - División sólo para viñeteo residual.
  - Tiempo: IA ~4 s y sample_free ~14 s en una imagen de 6000×4000 con GPU.
  - Si el gradiente que queda tras sample_free 10 es liso, quitarlo con el plano robusto de grado 1 (no puede comerse formas) en vez de bajar la escala.
- **Cómo revisar el modelo:** `gcStructCopy(base, modelo)` de `guia/herramientas/gradcompare.js` da la correlación entre la estructura de gran escala del original y la del modelo (sin estrellas y sin gradiente liso). Correlación < 0,15 = limpio; > 0,5 = se come el objeto. Confirmarlo a la vista con el modelo menos su gradiente liso: cualquier forma reconocible del objeto es señal perdida. Las demás métricas de `gradcompare.js` dependen de una máscara automática del objeto que falla en campos llenos de nebulosa o con estrellas muy brillantes.
- **Más control en la aplicación independiente:** permite colocar las muestras a mano (útil cuando el objeto llena el campo o hay halos extensos). Exportar 32 bits y volver a PixInsight.
- **No siempre gana:** en un hilo de AstroBin (jul 2026) no pudo quitar un gradiente alrededor de M31 ni subiendo el suavizado; la recomendación fue MGC o DBE con muestras escogidas. Con objetos que se difuminan en el fondo (M31, nebulosas extensas, polvo) cualquier extractor puede tomar el halo del objeto por fondo y dejar un **anillo oscuro**.
- Copia de la astrometría: el resultado de GraXpert vuelve como imagen nueva; copiar la solución astrométrica desde el master (`copyAstrometricSolution`) antes de SPCC.

## Comparativa de corrección de gradientes (protocolo, oct 2026)
Cuándo: el modelo de GraXpert no convence (correlación de `gcStructCopy` alta o forma del objeto visible en el modelo). Objetivo: decidir con medidas qué método va mejor en cada tipo de objeto y acumular una tabla propia. **Ninguno es "el más avanzado" en abstracto:** MGC compara con cielo real medido (MARS), GraXpert IA es una red entrenada (caja negra, rápida, buena en gradientes complejos), el plano robusto no puede crear ni borrar formas.
1. **Entrada común:** el mismo master lineal, recortado (sin bordes de apilado), con astrometría y **después de BXT Correct Only**. Guardar una copia intacta.
2. **Candidatos** (cada uno a una ventana nueva, nombre `GC_<metodo>`):
   - MGC (SPFC previo, escalas 1024/2048/4096 si hay duda).
   - GraXpert sample_free escala 10 y 8, y GraXpert IA (`graxpertBGE` con `scale`, `method` y `tag` distintos).
   - GraXpert RBF con muestras manuales (aplicación independiente) si el objeto llena el campo.
   - Plano robusto de grado 1 (y grado 2 si el gradiente es curvo) como control conservador.
   - DBE con pocas muestras como referencia clásica (opcional).
   - Guardar también el **modelo** de cada uno (original − corregido, o el que da la herramienta).
3. **Métricas** (script PJSR en `<versión>/tools/gradcompare.js`, resultados en CSV):
   - **Forma del objeto en el modelo:** correlación entre el modelo (sin su ajuste de grado 1) y una máscara del objeto (luminancia suavizada por encima de cielo + 3σ). Cerca de 0 = bien; positiva = se come el objeto; negativa = lo infla.
   - **Contraste objeto−cielo:** medianas en 4–6 cajas fijas (300 px) sobre el objeto y sobre cielo cercano, % conservado respecto al original. Penalizar < 90 % en polvo/IFN.
   - **Planitud del fondo:** rejilla 8×8 de medianas sigma-clipped sólo en cajas de cielo (fuera de la máscara del objeto); rango y σ por canal.
   - **Color del fondo:** R/G y B/G en la rejilla, medido **después de SPCC** en todos (GraXpert neutraliza, MGC no).
   - **Anillo oscuro:** perfil radial alrededor del objeto (objetos extensos): mínimo por debajo del cielo lejano = sobrecorrección.
   - **Ruido:** σ en cajas de cielo antes y después (restar un modelo liso no debe cambiarlo; si cambia, el modelo tiene estructura fina).
4. **Vista:** tríptico original / corregido / modelo con el mismo STF, más una plancha con los modelos de todos los candidatos. Comprobar también con un estirado agresivo (el gradiente residual se ve antes que en el estirado normal).
5. **Decisión:** gana el que conserva el contraste del objeto con el fondo más plano y sin anillo; en empate, GraXpert sample_free escala 10 (el predeterminado). Se puede combinar: p. ej. plano global + GraXpert sólo si queda un gradiente complejo.
6. **Registrar** aquí en la tabla de resultados (objeto, tipo, ganador, métricas clave, notas).

### Resultados de la comparativa
| Objeto | Tipo | Ganador | Notas |
|---|---|---|---|
| LDN 1235 (previo, sin GraXpert) | nebulosa oscura | plano grado 1 | MGC 2048/4096 se comió el 75 % del contraste del polvo |
| IC 63 (previo, sin GraXpert) | emisión + reflexión | MGC | no se comparó con otros métodos |

### Prueba de GraXpert 4.0.0 (29 oct 2026)
Masters lineales sin tocar (IC 1396, LDN 1235 e IC 63 binados ×2), luminancia binada ×8. "Copia" = estructura de gran escala del original copiada en el modelo (`gcStructCopy`; correlación entre paréntesis). "Come" = señal del objeto en el modelo con la máscara automática (sólo fiable en M31).

| Objeto | IA s0,1 | IA s1,0 | SF por defecto | SF escala 8 | SF escala 10 | Notas |
|---|---|---|---|---|---|---|
| M31 (Triband, galaxia extensa) | come 21 %, copia 6 % (0,56) | come 18 % (0,51) | come 18 % (0,09) | come 6,6 % (0,07) | come 4 % (0,10) | a la vista, la IA se come el bulbo y el halo; SF 8–10 casi plano |
| LDN 1235 (sin filtro, nebulosa oscura) | copia 0,1 % (0,02) | — | copia 2 % (0,18) | copia 1,2 % (0,15) | copia 0,8 % (0,13) | todo limpio; la IA es la más plana |
| IC 1396 (S2/Hβ, nebulosa que llena el campo) | copia 48 % (0,79) | IA s0,5: 37 % (0,74) | copia 39 % (0,76) | copia 22 % (0,68) | copia 14 % (0,61) | la IA reproduce las nubes en el modelo; SF 10 casi plano a la vista, pero aún copia algo |
| IC 63 (sin filtro, γ Cas) | modelo con mancha en γ Cas | — | estructura alrededor del fantasma | liso | liso | medida dominada por el halo de γ Cas: juzgado a la vista |

Conclusión: **sample_free escala 10 como punto de partida**. En nebulosas que llenan el campo (IC 1396) aún copia algo: revisar el modelo y, si hace falta, comparar con el plano robusto o RBF con muestras propias.
