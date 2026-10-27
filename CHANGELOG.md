# Historial de cambios

## Sin publicar

- Caso práctico de IC 63 en `docs/casos/IC63/` (selección de subs, HDR con tomas cortas, gradiente, continuo, estrellas), enlazado desde el README.

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
