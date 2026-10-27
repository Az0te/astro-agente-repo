# Historial de cambios

## Sin publicar

- Guía: nuevo tema `20-graxpert-comparativa-gradientes.md` (cómo funciona GraXpert y protocolo con métricas para comparar MGC, GraXpert, plano robusto y DBE en cada objeto).
- Guía: nuevo tema `21-bxt-nxt.md` (orden lineal con BXT Correct Only antes de SPCC, ajustes por tipo de objeto, PSF manual, iteraciones y separación HF/LF de NXT, rejilla de variantes con medidas).
- Guía: quitado el NXT ligero antes de BXT (RC-Astro desaconseja reducir ruido antes de deconvolucionar); `05`, `06`, `07` y `SKILL.md` enlazan los temas nuevos.
- Caso práctico de IC 63 en `docs/casos/IC63/` (selección de subs, HDR con tomas cortas, gradiente, continuo, estrellas), enlazado desde el README.

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
