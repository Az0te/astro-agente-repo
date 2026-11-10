# Agente de astrofotografía para PixInsight (Windows)

> **English: full README in [README.en.md](README.en.md).** A Windows-ready bridge that lets an AI assistant (Claude, via MCP) drive PixInsight for deep-sky processing, plus a detailed processing guide in Spanish (the assistant answers in the language you write in, English included; OSC + dual-band, HDR with short exposures, star halos, blue bloat, Hα/OIII + RGB, narrowband palettes, objective quality checks). The first bridge (a file watcher plus MCP server, retired in November 2026) was derived from [pixinsight-mcp](https://github.com/aescaffre/pixinsight-mcp) by Alain Escaffre (MIT); the current bridge is the `piastropilot` MCP server (`mcp/`), which runs the guide's functions in PixInsight through IPC. **Easiest start: [PiAstroPilot Lite](piastropilot/script/README.en.md)**, a plain PixInsight script (no build, no signing) that chats with Ollama, Claude Code or Codex and runs the guide's functions; its window and replies can be switched to English in Settings > Language. Independent project, not affiliated with Pleiades Astrophoto or Anthropic.

Este proyecto permite que un asistente de IA (Claude, a través del protocolo MCP) controle PixInsight para procesar astrofotografías de cielo profundo, **trabajando contigo**: tú decides y supervisas, la IA ejecuta, mide y propone.

Incluye estas partes:

- **[PiAstroPilot Lite](piastropilot/script/README.md)** (`piastropilot/script/PiAstroPilotLite.js`): **la forma más sencilla de empezar**. Es un script de PixInsight, sin compilar ni firmar nada: chat con el asistente (Ollama local, Claude Code o Codex), funciones de la guía ya cargadas, comparación de métodos, información del objeto desde internet y voz. Ver [Empezar con PiAstroPilot Lite](#empezar-con-piastropilot-lite).
- **[PiAstroPilot](piastropilot/README.md)** (`piastropilot/`): módulo nativo de PixInsight que acopla un asistente de IA al panel lateral sin bloquear PixInsight. Tiene un botón por paso de la guía, chat con tablas y vistas previas, y funciona con Claude Code, Codex o un modelo local (Ollama). Va con la guía de este repositorio; por ahora hay que compilarlo y firmarlo con claves de desarrollador propias.
- **Servidor MCP piastropilot** (`mcp/`): el puente entre la IA y PixInsight. Ofrece las funciones de la guía como herramientas y las ejecuta en la instancia de PixInsight que tienes abierta (IPC `PixInsight.exe -x=`), sin carpeta vigilada ni `eval`. Detalles en [`mcp/README.md`](mcp/README.md).
- **Guía de procesado** (`guia/`): un manual detallado, en español, que Claude carga como *skill*. El asistente responde en el idioma en que se le pregunte (inglés o cualquier otro), aunque la guía esté en español. Está ordenada como el flujo de trabajo: 17 pasos de la fase lineal, 11 de la no lineal y anexos (equivalentes de scripts, controles de calidad, anti-patrones, flujos por tipo de objeto, glosario); cada paso es un fichero con el porqué, los parámetros, la función de la guía que lo hace y el control para comprobarlo. Es la parte principal: recoge técnicas, trampas, valores de partida y controles de calidad aprendidos en sesiones reales de procesado.

## Principio

**Ceñirse a los datos, no inventar nada.** La guía obliga a confirmar cualquier estructura débil antes de realzarla, a comparar cada paso con la versión sin tocar y a medir (ringing, núcleos quemados, estrellas) en vez de fiarse sólo de la vista.

## Qué aporta respecto a pixinsight-mcp

El proyecto original de Alain Escaffre es un pipeline **autónomo** pensado para macOS y datos mono LRGB/HaLRGB. Este proyecto parte de su puente y añade:

- **Soporte de Windows**: rutas, PowerShell y compilación del módulo para Windows.
- **Funciones de la guía en vez de procesos sueltos** (`guia/herramientas/`): análisis, gradiente con candidatos, estirado «al fallo», estrellas, saturación, paletas… cada una con su control de calidad. El servidor MCP solo ejecuta las que están en su lista blanca.
- **BlindSolver integrado**: `resolverAstrometria` resuelve la astrometría a ciegas para SPCC, SPFC y MGC sin lanzar el script. También incluye **Star Stretch, ScreenStars, DarkStructureEnhance y BackgroundEnhance** (`guia/herramientas/realces.js`), reimplementados con resultado idéntico al de los scripts.
- **Trabajos largos sin bloquear**: las llamadas de más de 45 s devuelven un id y el resultado se recoge con `estado(trabajo)`.
- **Guía de procesado** orientada a OSC + dual band desde cielo urbano, HDR con tomas cortas, halos de estrellas brillantes, emulación de DBXtract con PixelMath, sustracción de continuo y mezcla de cámaras mono y OSC.

## Ejemplo: IC 63

El caso práctico [IC 63, el Fantasma de Cassiopeia](docs/casos/IC63/README.md) muestra el proceso completo con imágenes: selección de subs con índice de halo, HDR con tomas cortas para γ Cas, gradiente urbano, Hα de un dual band con sustracción de continuo y acabado.

## Empezar con PiAstroPilot Lite

Es lo que usará la mayoría: no necesita Node.js, servidor MCP ni compilar nada.

1. Descarga el repositorio (**Code > Download ZIP** en GitHub) y descomprímelo, por ejemplo en `C:\Users\<tu_usuario>\astro-agente-repo`.
2. Ten un modelo: [Ollama](https://ollama.com) con un modelo descargado (local y gratis, p. ej. `ollama pull qwen3:32b`), o Claude Code / Codex instalados y con sesión iniciada.
3. En PixInsight 1.9.6 o superior: **Script > Feature Scripts… > Add**, elige la carpeta `piastropilot\script` y pulsa **Done**.
4. Abre tu imagen y lanza **Script > PiAstroPilot > PiAstroPilotLite**. Elige el modelo en la pestaña **Modelo** y escribe en **Prompt**, por ejemplo «hazme un análisis de la imagen».
5. Opcional: en **Ajustes > Idioma** elige español o inglés (ventana y respuestas del modelo; se aplica al momento).

Detalles, opciones y problemas frecuentes en [`piastropilot/script/README.md`](piastropilot/script/README.md). Lo de abajo es para el servidor MCP y el módulo.

## Requisitos (servidor MCP y módulo)

- Windows 10/11 (probado en Windows 11).
- [PixInsight](https://pixinsight.com) 1.9.6 o superior.
- Para `blindSolve`: un índice astrométrico de Gaia configurado en las preferencias del proceso Gaia (es el mismo que usa el script BlindSolver).
- [Node.js](https://nodejs.org) 18 o superior.
- Un cliente de IA compatible con MCP, por ejemplo la app de escritorio de Claude o Claude Code.
- Opcional, pero la guía los usa mucho: BlurXTerminator, NoiseXTerminator y StarXTerminator (RC-Astro, de pago), GraXpert, scripts de SetiAstro y Toolbox. **No se incluyen**: cada uno debe instalarlos con su licencia.

## Instalación (servidor MCP)

1. Descarga o clona este repositorio, por ejemplo en `C:\Users\<tu_usuario>\astro-agente`.
2. Registra el servidor MCP piastropilot en tu cliente (no hace falta `npm install`: `mcp/dist/piastropilot-mcp.mjs` lleva todo dentro). Con Claude Code:
   ```
   claude mcp add piastropilot -- node C:/Users/<tu_usuario>/astro-agente/mcp/dist/piastropilot-mcp.mjs
   ```
   Con Codex u otro cliente, ver [`mcp/README.md`](mcp/README.md#instalar).
3. Si PixInsight no está en `C:/Program Files/PixInsight`, define la variable `PIXINSIGHT_EXE` con la ruta de `PixInsight.exe`.
4. Abre PixInsight. No hay que lanzar ningún script: cada llamada llega a la instancia abierta y, si está ocupada, espera en cola.
5. Carga la guía en tu agente. El punto de entrada es `guia/SKILL.md` (núcleo común de reglas e índice, neutro para PixInsight y Siril, ~4.000 tokens; skill `astro-procesado`) junto con el arranque del anexo del programa (Anexo J para PixInsight, Anexo I para Siril); el resto se lee paso a paso.
   - Claude: la carpeta `guia/` como *skill*.
   - ChatGPT u otro cliente con MCP: [`guia/envolturas/chatgpt.md`](guia/envolturas/chatgpt.md).
   - Modelo local (Ollama): [`guia/envolturas/local.md`](guia/envolturas/local.md).
6. Copia `guia/perfil-ejemplo.md` como `guia/perfil.md` y rellénalo con tu equipo, tu cielo, tus rutas y tus gustos. Ese fichero está excluido de Git.

## Uso diario

Con PixInsight abierto, pide al asistente el paso que quieras (o usa los botones de [PiAstroPilot](piastropilot/README.md)). Puedes seguir usando PixInsight con normalidad: mientras lanzas tú un script del menú, las peticiones del asistente esperan en cola.

## Limitaciones conocidas

- Los **scripts** de PixInsight con interfaz (DBXtract, AutoDBE…) no se pueden lanzar desde una función de la guía; WBPP sí, con `lanzarWBPP` (en una segunda instancia), y BlindSolver va integrado (`resolverAstrometria`).
- PiAstroPilot y la ruta por defecto de PixInsight están pensados para Windows: en macOS o Linux hay que adaptarlos.
- La guía se ha probado sobre todo con una cámara OSC (IMX571) y varios filtros: sin filtro, tribanda y dual band Hα/OIII, SII/OIII y SII/Hβ. Para otros equipos, sus valores son puntos de partida.

## ⚠️ Seguridad

El servidor MCP piastropilot no ejecuta código arbitrario: cada petición lleva solo el nombre de una función y sus parámetros, y el runner comprueba un token (`~/.piastropilot/token`) y una lista blanca antes de ejecutarla. No hay ninguna herramienta que ejecute código libre. Lo mismo vale para PiAstroPilot y PiAstroPilot Lite: **ningún modelo escribe ni ejecuta código de PixInsight**; con los modelos locales, el modelo propone llamadas a funciones de la guía (nombre y parámetros) y se comprueban contra el manifiesto (`guia/herramientas/manifiesto.json`) antes de ejecutar ninguna. Aun así:

- no compartas ni sincronices la carpeta `~/.piastropilot` con servicios en la nube;
- revisa lo que hace la IA, sobre todo antes de guardar o sobrescribir ficheros.

## Cómo contribuir

Lo que más ayuda ahora son **datos y resultados de otros equipos, cielos y tipos de objeto**; no hace falta programar:

- **Casos de prueba**: masters o recortes de tipos de objeto poco probados, con equipo, filtro y cámara.
- **Fallos** con el registro del panel o de la consola.
- **Comparativas** de tu procesado manual frente al de PiAstroPilot, para calibrar umbrales.
- **Pruebas** con otros modelos de IA, GPU, sistemas o telescopios inteligentes.
- **Mejoras de la guía** por *pull request*: siempre reglas por **tipo de objeto**, nunca para un objeto concreto.

Abre una [*issue*](https://github.com/Az0te/astro-agente-repo/issues/new/choose) con la plantilla que corresponda, o comenta ideas y resultados en [*Discussions*](https://github.com/Az0te/astro-agente-repo/discussions). Los ficheros grandes, mejor con un enlace a Drive o WeTransfer. Todos los detalles (también en inglés) están en [`CONTRIBUTING.md`](CONTRIBUTING.md).

*Contributions are welcome in English too: see [`CONTRIBUTING.md`](CONTRIBUTING.md#how-to-contribute).*

## Créditos

- **Alain Escaffre**, [pixinsight-mcp](https://github.com/aescaffre/pixinsight-mcp) (MIT): diseño original del primer puente (watcher por ficheros y servidor MCP, retirado en noviembre de 2026), además de muchas ideas de la guía (barreras de calidad, taxonomía de objetos, trampas de PJSR).
- **Jeff Henry**, [NOVA](https://github.com/measurethepixels/nova) (MIT): artículos con evidencia medida que se citan en la guía.
- Las demás fuentes están en [`guia/FUENTES.md`](guia/FUENTES.md).
- Proyecto desarrollado en colaboración con Claude (Anthropic) a partir de sesiones reales de procesado, revisado y probado por el autor.

## Licencias

- Código (`mcp/`, `piastropilot/`): **MIT**. Copyright (c) 2026 Rafael Vidal. Ver [`LICENSE`](LICENSE). El puente anterior (`watcher/`, `servidor-mcp/`, en el historial de Git) era MIT, Copyright (c) 2026 Alain Escaffre (original) y Rafael Vidal (modificaciones).
- Guía (`guia/`): **CC BY-SA 4.0**. Ver [`guia/LICENSE.md`](guia/LICENSE.md).

PixInsight es una marca de Pleiades Astrophoto S.L. Claude es una marca de Anthropic. Este es un proyecto independiente, sin relación ni respaldo de ninguna de las dos empresas.

## Autor

Rafael Vidal ([@Az0te](https://github.com/Az0te))
