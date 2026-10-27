# Agente de astrofotografía para PixInsight (Windows)

> **English summary.** A Windows-ready bridge that lets an AI assistant (Claude, via MCP) drive PixInsight for deep-sky processing, plus a detailed processing guide in Spanish (OSC + dual-band, HDR with short exposures, star halos, blue bloat, Hα/OIII + RGB, narrowband palettes, objective quality checks). The watcher and MCP server are derived from [pixinsight-mcp](https://github.com/aescaffre/pixinsight-mcp) by Alain Escaffre (MIT). Independent project, not affiliated with Pleiades Astrophoto or Anthropic.

Este proyecto permite que un asistente de IA (Claude, a través del protocolo MCP) controle PixInsight para procesar astrofotografías de cielo profundo, **trabajando contigo**: tú decides y supervisas, la IA ejecuta, mide y propone.

Incluye dos partes:

1. **Watcher + servidor MCP** (`watcher/`, `servidor-mcp/`): el puente entre la IA y PixInsight, adaptado y probado en Windows.
2. **Guía de procesado** (`guia/`): un manual detallado, en español, que Claude carga como *skill*. Es la parte principal: recoge técnicas, trampas, valores de partida y controles de calidad aprendidos en sesiones reales de procesado.

## Principio

**Ceñirse a los datos, no inventar nada.** La guía obliga a confirmar cualquier estructura débil antes de realzarla, a comparar cada paso con la versión sin tocar y a medir (ringing, núcleos quemados, estrellas) en vez de fiarse sólo de la vista.

## Qué aporta respecto a pixinsight-mcp

El proyecto original de Alain Escaffre es un pipeline **autónomo** pensado para macOS y datos mono LRGB/HaLRGB. Este proyecto parte de su puente y añade:

- **Soporte de Windows**: rutas de ImageSolver, scripts `.bat` para pausar, reanudar y parar el watcher.
- **Watcher v0.4.9**: pausa y parada por fichero, botón Pause/Abort de la consola activo, corrección de un fallo que impedía detenerlo, aviso de cuelgues (`current.json`), verificación de que PixelMath cambió la imagen y herramienta `describe_process`.
- **Servidor MCP** con `watcher_status` y detección de comandos bloqueados.
- **Guía de procesado** orientada a OSC + dual band desde cielo urbano, HDR con tomas cortas, halos de estrellas brillantes, emulación de DBXtract con PixelMath, sustracción de continuo y mezcla de cámaras mono y OSC.

## Ejemplo: IC 63

El caso práctico [IC 63, el Fantasma de Cassiopeia](docs/casos/IC63/README.md) muestra el proceso completo con imágenes: selección de subs con índice de halo, HDR con tomas cortas para γ Cas, gradiente urbano, Hα de un dual band con sustracción de continuo y acabado.

## Requisitos

- Windows 10/11 (probado en Windows 11).
- [PixInsight](https://pixinsight.com) 1.9 o superior (licencia propia).
- [Node.js](https://nodejs.org) 22 o superior.
- Un cliente de IA compatible con MCP, por ejemplo la app de escritorio de Claude o Claude Code.
- Opcional, pero la guía los usa mucho: BlurXTerminator, NoiseXTerminator y StarXTerminator (RC-Astro, de pago), GraXpert, scripts de SetiAstro y Toolbox. **No se incluyen**: cada uno debe instalarlos con su licencia.

## Instalación

1. Descarga o clona este repositorio, por ejemplo en `C:\Users\<tu_usuario>\astro-agente`.
2. Compila el servidor MCP:
   ```
   cd servidor-mcp
   npm install
   npm run build
   ```
3. Registra el servidor en tu cliente MCP. Ejemplo de configuración:
   ```json
   {
     "mcpServers": {
       "pixinsight": {
         "command": "node",
         "args": ["C:\\Users\\<tu_usuario>\\astro-agente\\servidor-mcp\\build\\index.js"]
       }
     }
   }
   ```
4. En PixInsight: **Script → Run Script… → `watcher/pixinsight-mcp-watcher.js`**. En la consola debe aparecer `PixInsight MCP Watcher v0.4.9`.
   Si PixInsight no está en `C:/Program Files/PixInsight`, cambia esa ruta en el bloque `#else` del principio del watcher.
5. Carga la guía como *skill* en tu cliente de Claude (la carpeta `guia/`, cuyo punto de entrada es `guia/SKILL.md`).
6. Copia `guia/perfil-ejemplo.md` como `guia/perfil.md` y rellénalo con tu equipo, tu cielo, tus rutas y tus gustos. Ese fichero está excluido de Git.

## Uso diario

| Acción | Cómo |
|---|---|
| Arrancar | Script → Run Script… → `pixinsight-mcp-watcher.js` |
| Pausar (p. ej. para lanzar tú un script) | `watcher/mcp-pause.bat` |
| Reanudar | `watcher/mcp-resume.bat` |
| Parar y liberar PixInsight | Botón **Pause/Abort** de la consola, o `watcher/mcp-stop.bat` |

Ctrl+F11 puede no llegar al watcher en Windows: usa el botón o el `.bat`.

## Limitaciones conocidas

- Los **scripts** de PixInsight (ImageSolver, WBPP, DBXtract, AutoDBE…) no se pueden lanzar desde el watcher: los lanzas tú con el watcher en pausa. Los **procesos** sí funcionan.
- Las llamadas de más de ~60 s devuelven un aviso de tiempo agotado, pero el proceso sigue en PixInsight; `watcher_status` informa de su estado.
- La comprobación de que PixInsight responde usa PowerShell: en macOS o Linux esa parte no funciona sin adaptarla.
- La guía se ha probado sobre todo con una cámara OSC (IMX571) y varios filtros: sin filtro, tribanda y dual band Hα/OIII, SII/OIII y SII/Hβ. Para otros equipos, sus valores son puntos de partida.

## ⚠️ Seguridad

El watcher ejecuta como código de PixInsight cualquier orden que aparezca en la carpeta `%USERPROFILE%\.pixinsight-mcp\bridge\commands` (la herramienta `run_script` usa `eval`). Es adecuado para uso local en tu propio ordenador, pero:

- no compartas ni sincronices esa carpeta con servicios en la nube;
- no dejes el watcher en marcha si otras personas o programas pueden escribir en tu carpeta de usuario;
- revisa lo que hace la IA, sobre todo antes de guardar o sobrescribir ficheros.

## Créditos

- **Alain Escaffre**, [pixinsight-mcp](https://github.com/aescaffre/pixinsight-mcp) (MIT): diseño original del puente por ficheros, el watcher y el servidor MCP, además de muchas ideas de la guía (barreras de calidad, taxonomía de objetos, trampas de PJSR).
- **Jeff Henry**, [NOVA](https://github.com/measurethepixels/nova) (MIT): artículos con evidencia medida que se citan en la guía.
- Las demás fuentes están en [`guia/FUENTES.md`](guia/FUENTES.md).
- Proyecto desarrollado en colaboración con Claude (Anthropic) a partir de sesiones reales de procesado, revisado y probado por el autor.

## Licencias

- Código (`watcher/`, `servidor-mcp/`): **MIT**. Copyright (c) 2026 Alain Escaffre (original) y Copyright (c) 2026 Rafael Vidal (modificaciones). Ver [`LICENSE`](LICENSE).
- Guía (`guia/`): **CC BY-SA 4.0**. Ver [`guia/LICENSE.md`](guia/LICENSE.md).

PixInsight es una marca de Pleiades Astrophoto S.L. Claude es una marca de Anthropic. Este es un proyecto independiente, sin relación ni respaldo de ninguna de las dos empresas.

## Autor

Rafael Vidal ([@Az0te](https://github.com/Az0te))
