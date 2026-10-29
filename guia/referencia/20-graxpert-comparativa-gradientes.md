# GraXpert y comparativa de corrección de gradientes

## GraXpert: método predeterminado de corrección de gradientes (desde el 29 oct 2026)
Se usa GraXpert IA por defecto; la comparativa de abajo queda para cuando su modelo no convence o el objeto es de riesgo (nebulosas oscuras, polvo/IFN, objetos que llenan el campo o se difuminan en el fondo).
- **Qué es:** programa independiente y libre (Dark Matters). Extracción de fondo con modelo de IA o con métodos clásicos sobre puntos de muestra: splines, funciones de base radial (thin-plate, lineal, cúbica, quíntica, con parámetro de suavizado) y kriging (sin suavizado). Desde la v3.1 también tiene modelos de denoise y deconvolución (estelar y de objeto); no sustituyen a NXT/BXT, pero se pueden comparar.
- **Fondo de cada muestra:** sigma-clipping (fuera > 3σ de la mediana y los píxeles a < 4 px de ellos, iterando) y mediana del resto.
- **Salida por sustracción:** `resultado = original − modelo + media(modelo)`, con la media **de los tres canales juntos**: además de quitar el gradiente, **neutraliza el color del fondo**. MGC no lo hace. Al comparar, medir el color del fondo después de SPCC, no antes.
- **Salida por división:** `original / modelo × media(modelo)` con la media **por canal** (para viñeteo residual).
- **El script de PixInsight (Toolbox/Graxpert.js) no se lanza desde el watcher** (error de script recursivo). Por dentro (`Toolbox/GraXpertLib.jsh`) sólo guarda la imagen, ejecuta `GraXpert -cli … -correction … -smoothing …` con `ExternalProcess` y reabre el resultado; siempre en modo IA.
- **Desde el watcher: `guia/herramientas/graxpert.js`** (probado en oct 2026 con GraXpert 4.0.0 "Charon", IA de fondo 1.0.1 con GPU; 2–8 s en una imagen pequeña). Llama directamente al ejecutable:
  - `eval(File.readTextFile("<ruta de guia>/herramientas/graxpert.js")); var r = graxpertBGE("<vista>", {smoothing: 0.1});` → crea `GC_GraXpert_<tag>` (corregida) y `GC_GraXpert_<tag>_model` (modelo de fondo), **con la astrometría del original copiada**, y devuelve `{corrected, model, seconds, log}`.
  - El ejecutable se busca en las rutas habituales; si no está, definir `var GX_EXE = "ruta"` antes del `eval` y anotarla en el perfil.
  - Opciones: `method` (AI, RBF, Kriging, Splines, sample_free), `smoothing` 0–1, `correction` (Subtraction o Division), `aiVersion`, `gpu: false`, `prefs` (fichero de preferencias con puntos de muestra), `extra` (argumentos `-sample_free_scale`, `-sample_free_smoothness`, `-sample_free_protect`, `-sample_free_protect_threshold`, `-sample_free_protect_amount`, `-sample_free_simplified`, `-sample_free_degree`, `-sample_free_downsample`), `tag`, `keepFiles`, `maxMinutes`.
  - Denoise: `graxpertDenoise("<vista>", {strength: 0.5})`. La primera vez descarga el modelo. Es una alternativa a comparar con NXT, no un sustituto.
  - En imágenes grandes puede pasar del corte de 60 s del MCP: esperar con `watcher_status` y comprobar las ventanas `GC_GraXpert_*`.
  - Si cambia la versión de GraXpert, confirmar las opciones con `GraXpert -cli -cmd background-extraction -h`; no suponer nombres de parámetros.
- **Ajustes de partida:** IA, sustracción, suavizado 0,1 (subir a 0,3–0,5 si el modelo tiene estructura fina o la forma del objeto). División sólo para viñeteo residual. Si el objeto llena el campo o el modelo se come la nebulosa: RBF con muestras propias (`prefs`) o `sample_free` con protección de estructuras, y comparar con el plano robusto.
- **Más control en la aplicación independiente:** permite colocar las muestras a mano (útil cuando el objeto llena el campo o hay halos extensos). Exportar 32 bits y volver a PixInsight.
- **No siempre gana:** en un hilo de AstroBin (jul 2026) no pudo quitar un gradiente alrededor de M31 ni subiendo el suavizado; la recomendación fue MGC o DBE con muestras escogidas. Con objetos que se difuminan en el fondo (M31, nebulosas extensas, polvo) cualquier extractor puede tomar el halo del objeto por fondo y dejar un **anillo oscuro**.
- Copia de la astrometría: el resultado de GraXpert vuelve como imagen nueva; copiar la solución astrométrica desde el master (`copyAstrometricSolution`) antes de SPCC.

## Comparativa de corrección de gradientes (protocolo, oct 2026)
Cuándo: el modelo de GraXpert no convence o el objeto es de riesgo (ver arriba). Objetivo: decidir con medidas qué método va mejor en cada tipo de objeto y acumular una tabla propia. **Ninguno es "el más avanzado" en abstracto:** MGC compara con cielo real medido (MARS), GraXpert IA es una red entrenada (caja negra, rápida, buena en gradientes complejos), el plano robusto no puede crear ni borrar formas.
1. **Entrada común:** el mismo master lineal, recortado (sin bordes de apilado), con astrometría y **después de BXT Correct Only**. Guardar una copia intacta.
2. **Candidatos** (cada uno a una ventana nueva, nombre `GC_<metodo>`):
   - MGC (SPFC previo, escalas 1024/2048/4096 si hay duda).
   - GraXpert IA, sustracción, suavizado 0,1 y 0,5 (`graxpertBGE` con `tag` distinto); opcionalmente `sample_free` con protección de estructuras.
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
5. **Decisión:** gana el que conserva el contraste del objeto con el fondo más plano y sin anillo; en empate, GraXpert IA (el predeterminado). Se puede combinar: p. ej. plano global + GraXpert sólo si queda un gradiente complejo.
6. **Registrar** aquí en la tabla de resultados (objeto, tipo, ganador, métricas clave, notas).

### Resultados de la comparativa
| Objeto | Tipo | Ganador | Notas |
|---|---|---|---|
| LDN 1235 (previo, sin GraXpert) | nebulosa oscura | plano grado 1 | MGC 2048/4096 se comió el 75 % del contraste del polvo |
| IC 63 (previo, sin GraXpert) | emisión + reflexión | MGC | no se comparó con otros métodos |
