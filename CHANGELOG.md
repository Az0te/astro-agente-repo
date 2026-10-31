# Historial de cambios

## Sin publicar

- Guía **reestructurada como flujo de trabajo** (propuesta del autor, revisada): `guia/referencia/` se sustituye por `lineal/` (17 pasos), `no-lineal/` (11 pasos) y `anexos/` (A–G), con un fichero por paso (por qué, parámetros, código PJSR y control). `SKILL.md` queda como índice ligero con las reglas y el mapa de decisión. Se incorporó el contenido que faltaba de los temas anteriores (composición natural Hα/OIII + RGB, protocolo de paletas, blue bloat, controles de calidad, rejilla BXT/NXT, flujo OSC5) y se corrigió: orden único gradiente → BXT Correct Only → SPCC; NXT principal sobre la starless en lineal; umbrales del checkpoint lineal; mezclas y restas con PixelMath usando otras imágenes por su id (sin iconos inventados); variable que tapaba el constructor de SCNR.

- Guía: la astrometría para SPCC, SPFC y MGC se resuelve con `blindSolve("<vista>")` desde el watcher v8, sin pedir al usuario que lance ImageSolver. Tras recortar, rotar, BXT o GraXpert se puede volver a resolver en vez de trasladar la solución a mano. Corregido además que para lanzar un script del menú no basta con pausar el watcher: hay que pararlo. Cambios en `SKILL.md`, `00`, `01`, `06`, `07`, `12`, `21` y el README.

### Watcher v0.5.0-v8 (2026-10-30)
- Nuevo `watcher/pixinsight-mcp-watcher-v8.js` para **PixInsight 1.9.6+**, con el motor JavaScript v8 (`let`/`const`, flechas y clases en `run_script`). El watcher clásico v0.4.14 se mantiene para versiones anteriores.
- **BlindSolver integrado**: `blindSolve("<vista>", opciones)` desde `run_script` (y comando `blind_solve`) resuelve la astrometría a ciegas con el índice de Gaia, sin parar el watcher y sin diálogos (≈1 s en 2427×1894 y 3008×3008). Opciones: escala (`minScale`/`maxScale`, ″/px), diagonal (`minField`/`maxField`, grados), región del cielo (`regionRA`, `regionDec`, `regionRadius`) y `timeLimit`. Si la imagen ya tenía solución, la conserva y devuelve la comparación (desplazamiento del centro, escala, rotación, paridad).
- Quitados los includes del ImageSolver antiguo de AdP, que no usaba ningún comando.
- `File.searchDirectory` y `System.msleep` en lugar de las funciones obsoletas, con respaldo para versiones que no las tengan.

- Guía: **prueba medida de GraXpert 4.0.0** en M31, LDN 1235, IC 1396 e IC 63. El método predeterminado pasa a ser **sample_free con escala 10** (antes IA): la IA se comió el 18–21 % de M31 y copió las nubes de IC 1396 en el modelo; su suavizado y la protección de estructuras de sample_free casi no influyen. Tabla de resultados en `20`; `SKILL.md`, `06`, `07` y `21` actualizados.
- Herramientas: `graxpertBGE()` usa sample_free escala 10 por defecto (opción `scale`); `gradcompare.js` añade `gcStructCopy`, la medida más fiable de cuánto objeto copia un modelo de fondo.
- Guía: **GraXpert IA pasa a ser el método predeterminado de corrección de gradientes**; la comparativa con MGC, plano robusto y DBE queda para cuando su modelo no convence o en objetos de riesgo (nebulosas oscuras, polvo/IFN, objetos que llenan el campo). Cambios en `SKILL.md`, `00`, `06`, `07`, `20`, `21` y el perfil de ejemplo.
- Guía: nueva herramienta `guia/herramientas/gradcompare.js` con métricas para comparar correcciones de gradiente sobre la luminancia binada: señal del objeto que se come el modelo (abombamiento frente a un polinomio de grado 2 ajustado en el cielo), señal conservada, gradiente residual del cielo y anillo oscuro. Validada con casos sintéticos; pendiente de probar en PixInsight.
- Guía: nueva herramienta `guia/herramientas/graxpert.js` para usar GraXpert desde el watcher llamando a su ejecutable por línea de comandos (el script de PixInsight no se puede lanzar): fondo con IA, RBF, Kriging, Splines o sample_free, modelo de fondo, denoise, y astrometría copiada del original.
- Guía: regla de orden lineal en `SKILL.md` y `00-reglas-y-api-basica.md`: nunca NXT antes de BXT; el NXT principal (0,70–0,80) sólo sobre la capa sin estrellas en lineal.
- Guía: nuevo tema `00-reglas-y-api-basica.md`, de lectura obligatoria (reglas de parar en vez de improvisar, prohibido ajustar el color a mano, API básica de PJSR, proceso frente a script, requisitos que hacen fallar SPCC), a partir de los fallos de un procesado de M31 hecho por un agente local; las reglas clave también en `SKILL.md`.
- Guía: nuevo tema `20-graxpert-comparativa-gradientes.md` (cómo funciona GraXpert y protocolo con métricas para comparar MGC, GraXpert, plano robusto y DBE en cada objeto).
- Guía: nuevo tema `21-bxt-nxt.md` (orden lineal con BXT Correct Only antes de SPCC, ajustes por tipo de objeto, PSF manual, iteraciones y separación HF/LF de NXT, rejilla de variantes con medidas).
- Guía: quitado el NXT ligero antes de BXT (RC-Astro desaconseja reducir ruido antes de deconvolucionar); `05`, `06`, `07` y `SKILL.md` enlazan los temas nuevos.
- Caso práctico de IC 63 en `docs/casos/IC63/` (selección de subs, HDR con tomas cortas, gradiente, continuo, estrellas), enlazado desde el README.

### Watcher v0.4.14 (2026-10-28)
- `run_script` acepta `return` fuera de una función (lo envuelve en una función; el valor devuelto es la respuesta) en vez de fallar con "return not in function".
- Pista para errores de fichero (`Unable to open file`): no hace falta escribir ficheros para devolver datos.

### Watcher v0.4.13 (2026-10-28)
- Pista general para cualquier método inexistente (p. ej. `img.getChannelData`), con los métodos reales de `Image`.

### Watcher v0.4.12 (2026-10-28)
- Pistas para `view.processing[i]` (es un contenedor: `.at(i)`) y para SPCC con `whiteReferenceSpectrum` puesto a un nombre.

### Watcher v0.4.11 (2026-10-28)
- Corregida la pista de `.image`: salía con cualquier error que mencionara `.image` (p. ej. `vista.image.clone`) y daba un consejo equivocado. Nueva pista para duplicar una imagen (no existe `.clone()`).

### Watcher v0.4.10 (2026-10-28)
- Pista para `vista.copyAstrometricSolution`: el método es de la ventana, y SPCC necesita que la imagen siga lineal.

### Watcher v0.4.9 (2026-10-28)
- `stretch_image` con `method: "stf"` aplica de verdad el autoestirado a la imagen (HistogramTransformation con punto negro por canal y medios comunes, fondo objetivo 0,25 o `targetBackground`). Antes sólo cambiaba la visualización y respondía "success", y el agente seguía como si la imagen estuviera estirada. Se niega si la imagen ya no es lineal.
- Pista también para `.execute()`, `.run()` y `.apply()`, que no existen en los procesos de PixInsight.

### Watcher v0.4.8 (2026-10-28)
- Corregido `deconvolve`: usaba parámetros que no existen en PixInsight 1.9.5 (`psfGaussianSigma`, `iterations` como número). Ahora usa `psfMode` paramétrico, `psfSigma` y `numberOfIterations`, valida los rangos y activa el deringing por defecto.

### Watcher v0.4.7 (2026-10-28)
- Todas las herramientas comprueban si el proceso se ejecutó: si PixInsight devuelve `false` (p. ej. SPCC sin solución astrométrica), responden con error en vez de "success".
- `color_calibrate` (SPCC/PCC) comprueba antes que la imagen tenga solución astrométrica y explica cómo conseguirla.
- `describe_process`: ante un nombre desconocido sugiere el proceso real para abreviaturas y nombres frecuentes (GHS → GeneralizedHyperbolicStretch, BXT, NXT, SXT, MAS, MGC…).

### Watcher v0.4.6 (2026-10-28)
- `run_script`: los errores típicos de PJSR escrito de memoria (`.process()`, funciones inventadas, `ventana.image`, comprobar null, sintaxis ES6) añaden una pista con la forma correcta y las vistas abiertas.

### Watcher v0.4.5 (2026-10-28)
- `save_image`: crea la carpeta de destino si no existe y comprueba que el fichero se ha escrito. Antes, con una carpeta inexistente, PixInsight fallaba y el watcher respondía "success".

### Watcher v0.4.4 (2026-10-27)
- Si una herramienta recibe un `viewId` que no existe, el error lista las vistas abiertas para que el agente use el ID correcto (antes sólo decía "Image not found").

### Watcher v0.4.3 (2026-10-27)
- `sharpen`: valida `amount` (0,1–1,0) y `sigma` (0,1–250), los rangos de UnsharpMask, con un mensaje claro en vez del error de PixInsight.

### Watcher v0.4.2 (2026-10-27)
- Corregido `denoise`: la columna de iteraciones de `MultiscaleLinearTransform.layers` era `false` en vez de un número (error "numeric value expected"), y el parámetro `strength` se ignoraba; ahora fija el amount de cada capa (0–1).
- Corregido `stretch_image` en modo manual: las filas de `HistogramTransformation.H` tenían el orden equivocado (error "numeric value out of range" y los medios se usaban como punto de luces). Ahora valida los rangos y rechaza un punto negro por encima de la mediana de algún canal.

## v0.4.1 (2026-10-26)

Primera versión publicada. Derivada de [pixinsight-mcp](https://github.com/aescaffre/pixinsight-mcp) de Alain Escaffre.

### Watcher
- Botón Pause/Abort de la consola activo (`console.abortEnabled`).
- Pausa y parada mediante ficheros `pause` y `shutdown` en el bridge, con scripts `mcp-pause.bat`, `mcp-resume.bat` y `mcp-stop.bat`.
- Corregido: la señal de parada se consumía dentro de un bucle interno y el watcher no se detenía.
- Fichero `current.json` con el comando en curso, para detectar cuelgues.
- PixelMath comprueba que la imagen ha cambiado y da un error claro si no.
- Nueva herramienta `describe_process`.
- Rutas de ImageSolver para Windows.
- Parada opcional por inactividad (`IDLE_TIMEOUT_MIN`).

### Servidor MCP
- Herramienta `watcher_status` y avisos de comandos bloqueados.
- Dependencias reducidas a `@modelcontextprotocol/sdk` y `zod`.
- `zod` actualizado a la versión 4 (corrige la vulnerabilidad GHSA-mrhx-c7xc-m3w5).

### Guía de procesado
- Primera versión pública, dividida en 19 temas, con plantilla de perfil de usuario.
