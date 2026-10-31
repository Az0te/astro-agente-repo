# Antes de empezar: perfil del usuario y entorno

[← Índice](SKILL.md)

**Por qué.** "Esta guía es genérica; el perfil decide los valores concretos". Los nombres de iconos que aparecen en los pasos (SPCC_RGB, SPFC_RGB, NoiseX_075) son **ejemplos del espacio de trabajo del autor**: hay que sustituirlos por los del perfil. Sin perfil, la escala de muestreo, los filtros y las rutas son suposiciones.

**Perfil del usuario** (plantilla en `guia/perfil-ejemplo.md`; copiar como `perfil.md` y rellenar antes del primer paso)

| Bloque | Campos |
|---|---|
| Equipo | Telescopio y focal; cámara(s) (modelo, sensor, píxel, OSC/mono, Bayer); escala de muestreo (″/px nativa y con drizzle); montura; filtros y anchura; particularidades (p. ej. ventana UV/IR-cut de serie → curvas de SPFC/SPCC) |
| Cielo | Tipo (ciudad / periurbano / oscuro, Bortle); seeing típico (FWHM); problemas habituales (gradientes, humedad, calima) |
| Captura | Esquema (p. ej. RGB 120 s + RGB 30 s para estrellas y HDR); programa de captura y de preprocesado |
| Rutas | Carpeta de masters; carpeta de cada versión (`<objeto>/<objeto>_v1/`, nunca sobrescribir) |
| PixInsight | Instalación si no es la de por defecto; iconos del workspace y para qué sirve cada uno; scripts instalados; módulos de terceros; ruta del ejecutable de GraXpert; carpeta `guia/` del repo en el PC (para cargar `herramientas/*.js`) |
| Preferencias estéticas | Nivel de fondo final (p. ej. mediana ≈ 0,17, nunca negro puro); color; estrellas; ruido; referencias; entrega |
| Preferencias por objeto | Lo elegido en cada procesado (p. ej. "IC 63: prefirió la versión B, con más nebulosidad de fondo y Hα al rojo 1,40") |

Regla: "Cuando el usuario exprese una preferencia nueva (elige una versión frente a otra, pide más o menos saturación…), propón añadirla al perfil."

**Límites del entorno**

| Situación | Conducta correcta |
|---|---|
| Llamada de más de ~60 s | Da timeout pero **sigue ejecutándose**: esperar y comprobar (lista de ventanas, `view.processing`, ficheros guardados); no relanzar a ciegas |
| `watcher_status` | Dice qué comando está en curso y si PixInsight responde |
| Bucles largos (medir cientos de subs) | Funciones que trabajen ~50 s, guarden el resultado en un CSV incremental y devuelvan el índice siguiente |
| Cada llamada empieza sin estado | Guardar funciones reutilizables en `<versión>/tools/*.js` y cargarlas con `eval(File.readTextFile(ruta))` |
| Herramientas de la guía | `herramientas/graxpert.js` (GraXpert desde el watcher) y `herramientas/gradcompare.js` (medir modelos de gradiente): `eval(File.readTextFile("<ruta de guia>/herramientas/<fichero>.js"))` |
| Astrometría | `blindSolve("<vista>")` en el watcher v8 (PixInsight 1.9.6+); con el clásico la resuelve el usuario (Paso 8 lineal) |
| Iconos del workspace | `ProcessInstance.icons()` vacío = no están cargados (tras reiniciar PixInsight no vuelven solos): pedir al usuario que cargue su fichero de iconos o su proyecto antes de usar `fromIcon` |
| Proceso que no existe en el script (`typeof BlurXTerminator`) | El módulo no está cargado en PixInsight: avisar al usuario; no sustituirlo por otro proceso |
| Duda con un nombre | `describe_process` (parámetros y constantes reales de la versión instalada) |
| Lanzar un script | No se puede desde el watcher ("Script instance recursively" + diálogo modal). El usuario lo lanza con el watcher **parado** (Pause/Abort o `mcp-stop.bat`): mientras corre, aunque esté en pausa, el menú Script está bloqueado |
| Watcher que deja de responder sin diálogo | No insistir con más llamadas pesadas: avisar y parar (Pause/Abort o `mcp-stop.bat`) |
| Ver diálogos o la pantalla | Sólo si el usuario ha dado acceso a la pantalla (computer use); si no, no contar con verlos |
| Ver resultados | Guardar JPG reducidos (IntegerResample) o recortes al 100 % en `<carpeta>/prev/`; mejor que capturas de pantalla |
| Descargar desde PJSR | `NetworkTransfer` + `onDownloadDataAvailable` escribiendo a un `File` |
| `beginProcess()` sin `endProcess()` | Vista bloqueada: clonar la imagen a una ventana nueva y cerrar la vieja |
| Subs y masters del usuario | **Nunca borrar**: mover los descartes a `_rechazados` y que el usuario confirme. Nunca sobrescribir versiones (v1, v2…) |

**Principio innegociable:** "Ceñirse a los datos, no inventar nada... 'Revelar, no inventar': cualquier estructura débil se confirma antes de realzarla, y cada paso se compara con la versión sin tocar".
