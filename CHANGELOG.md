# Historial de cambios

## Sin publicar

- **MCP picopilot: correcciones y modo compacto** (9 nov 2026).
  - `gradienteVarias` estaba en `manifiesto.json` pero no en la `LISTA` del runner: el MCP la ofrecía y el runner la rechazaba. Añadida.
  - `screenStarsCombine` y `screenStarsExtract` (realces.js) son ahora herramientas MCP, como decía `SKILL.md`.
  - Nuevo campo `resumen` en el manifiesto (20 herramientas con descripción larga). `PICOPILOT_COMPACTO=1` lo usa en vez de la descripción y `PICOPILOT_FASE=lineal|no-lineal` ofrece sólo las herramientas de esa fase: la lista baja de ~10.900 tokens a ~6.600 (lineal) o ~4.700 (no lineal). Sin las variables, todo igual que antes.
  - PiCopilot Lite usa el `resumen` cuando existe al listar las funciones para el modelo.

- **Lo aprendido comparando LDN 1235 de Qwen (build89) con la v1 de Opus** (7 nov 2026, datos de Dominic Gareau). Qwen dejó el polvo casi pegado al cielo (cuerpo 0,009 por encima frente a 0,051), estrellas hinchadas (9,5 % del campo frente a 1,8 %) y llamó al objeto IC 63. Cambios:
  - `estrellas.js`: si la limpieza < 0,005 se lleva > 10 % del brillo, prueba < 0,002; si tampoco, sólo avisa (ya no manda a `extraer`). `no_cumple` nuevo si la capa pasa del 10 % de píxeles > 0,02 (hinchada).
  - `estirado.js`: `estrellas: "extraer"` da `no_cumple` si la capa pasa del 10 % (es sólo para galaxias); nuevo `tipo: "nebulosa_oscura"` (cielo 0,15, ruidoMax 0,20; sin calibrar).
  - `bandaestrecha.js`: `medirContinuo` explica que el canal es 0/1/2 y que con un solo master RGB el Paso 16 no aplica (antes fallaba con un error de getSamples).
  - PiCopilot (prompt): `extraer` sólo en galaxias, `nebulosa_oscura` para polvo, no inventar el nombre del objeto ni la carpeta, continuo sólo con banda estrecha, NXT 0,50 en el Paso 15 tras el 14.

- **Lo aprendido comparando M31 de Qwen (PiCopilot build88) con M31 v7 de Opus** (7 nov 2026, mismo master). Qwen salió casi sin estrellas (269 detectables frente a 13 721), con el núcleo y M32 quemados (meseta de 22 px) y el fondo manchado. Cambios:
  - `estirado.js`: `estrellas: "extraer"` saca la capa de estrellas con el mismo estirado que la starless (se repiten las pasadas de GHS y los puntos negros sobre starless + estrellas y se separa con `screenStarsExtract`); `tipo: "galaxia"` lo usa por defecto. Nueva medida `meseta_nucleo` con `no_cumple` si pasa de 3 px.
  - Nuevo `nucleo.js`: `comprimirNucleo` (HDRMT 7 capas al 60 % con máscara de bulbo, la receta de Opus) y `medirMeseta`. Añadido al runner y al manifiesto del MCP.
  - `estrellas.js`: la limpieza < 0,005 sólo se aplica si quita ≤ 10 % del brillo; `no_cumple` si la capa queda casi vacía; corregido el control del p90 (pedía 0,15–0,35 y la ficha 0,08–0,13).
  - `recombinacion.js`: `no_cumple` (no existía) con `aporte_estrellas_pct` < 0,5 % (Qwen: 0,19 %), fondo que sube o baja y recorte nuevo.
  - `ruido.js`: en no lineal, el moteado > 1,5 ya no sugiere subir el NXT (no lo arregla); aviso si un denoise sube el moteado más de 0,5; Paso 15 en RGB a 0,50 si ya hubo NXT suave en el 14.
  - `lineal.js`: el cielo no neutro del checkpoint dice que no se pase a no lineal sin `neutralizarCielo`.
  - Fichas 1, 5, 6, 8 y 9 no lineales, Anexo D (cadena de M31) y trampas de `SKILL.md`.
  - PiCopilot (prompt de Qwen): `tipo: "galaxia"` obligatorio en galaxias, `comprimirNucleo` en el orden, no seguir con `no_cumple` sin resolver y no inventar umbrales.

- **Idioma**: el asistente responde ahora en el idioma en que se le pregunte (inglés o cualquier otro), no sólo en español; la guía sigue escrita en español. Actualizadas las envolturas de ChatGPT y de modelos locales y el README.

- Guía: **MLDenoise frente a NoiseX**, medido en IC 1396 (Hα, OIII, SII) con una referencia de subs independientes. Nueva ficha `guia/detalle/lineal-15-denoise-mldenoise.md` (método, puntuaciones, parámetros de MLDenoise y receta híbrida ML fino + NXT grueso, que gana en los tres canales) y resumen en el Paso 15 lineal. Trampa documentada: NXT repetido sobre el mismo id de ventana devuelve el mismo resultado.
- Guía: el **denoise principal por defecto** (Paso 15 lineal) pasa a ser el híbrido MLDenoise + NXT 0,95, la mejor opción medida; NXT solo (0,95, ya no 0,70–0,80) queda como alternativa si no hay modelo de MLDenoise. Actualizados SKILL.md (orden lineal) y el Paso 6 no lineal.

- Guía: nueva sección **"Modelo por paso: rápido o potente"** en `SKILL.md`, válida para Claude (Sonnet/Opus, % medidos) y ChatGPT (nivel estándar / máximo razonamiento, % provisionales), con la regla N.

- **Guía optimizada para gastar menos contexto con cualquier modelo** (Claude, ChatGPT, local):
  - `guia/SKILL.md` es ahora el núcleo común: reglas, orden, sesiones por fase, funciones del watcher, entorno, trampas más frecuentes, mapa e índice. Arranque de ~6.150 a ~2.460 tokens: `00-perfil-y-entorno.md` sólo se lee para configurar y el Anexo F completo cuando algo falla.
  - **Sesión por fase**: el checkpoint lineal (Paso 17) escribe `estado.md` y la fase no lineal empieza en una sesión nueva leyéndolo.
  - **Fichas en dos capas** (piloto en Gradiente, Estirado y Estrellas): la ficha lleva lo necesario para ejecutar y controlar; el porqué, las medidas y las recetas largas pasan a `guia/detalle/`. Esos tres pasos bajan de ~9.340 a ~3.450 tokens.
  - Cuándo, por qué y cómo de las funciones de `realces.js`, en sus pasos (1, 5, 8 y 9 no lineales) en vez del índice.
  - Nuevas envolturas `guia/envolturas/chatgpt.md` y `guia/envolturas/local.md` (prompt de sistema y parámetros de Ollama).
  - Corregido: el código de MGC del Paso 9 lineal lo aplicaba dos veces; el Anexo F prohibía el mapa de estructuras oscuras que ahora implementa `darkStructureEnhance` (vale si su máscara sigue estructuras reales).

### Watcher v0.5.1-v8 (2026-10-31)
- Nuevo `guia/herramientas/realces.js`, incluido en el watcher v8: **Star Stretch** (`starStretch`), **ScreenStars** (`screenStarsCombine`, `screenStarsExtract`), **DarkStructureEnhance** (`darkStructureEnhance`) y **BackgroundEnhance** (`backgroundEnhance`), que no se podían lanzar desde el watcher. Son reimplementaciones de sus algoritmos con los mismos procesos y parámetros (créditos a sus autores en el fichero); comparadas con los originales en PixInsight 1.9.6, la diferencia máxima es 0 en todos los casos probados. Guía actualizada: Anexo A, `00` y pasos 1, 5, 8 y 9 no lineales.

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
