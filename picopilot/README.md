# PiCopilot — panel de IA para PixInsight

> **English summary.** PiCopilot is a native PixInsight module (PCL, C++) that docks an AI assistant inside PixInsight without blocking it. It runs the steps of this repository's processing guide (`../guia`) with Claude Code, Codex CLI or a local model (Ollama / any OpenAI-compatible endpoint), shows results as tables and image previews, and measures every step. There is no signed binary yet: build it and sign it with your own PixInsight developer keys (see below). Tested on Windows 11 with PixInsight 1.9.6.

Desarrollado por **Rafael Vidal** (2026), con la guía de este mismo repositorio. Licencia MIT (ver [`LICENSE`](../LICENSE)).

## Qué es

Un módulo nativo de PixInsight (no un script): se acopla al panel lateral y las llamadas a los modelos son procesos externos asíncronos, así que **PixInsight sigue funcionando mientras la IA trabaja**. El módulo y la guía van juntos: los botones de cada paso y las instrucciones a los modelos usan las funciones de `guia/herramientas/*.js`. Por eso están en el mismo repositorio. Usa siempre el módulo con la guía de la misma versión.

- **Un botón por paso de la guía**: 17 de la fase lineal y 11 de la no lineal, sobre la imagen activa o sobre una o varias carpetas, en los pasos que trabajan con ficheros.
- **Ventana de Prompt** (chat no modal) con respuestas en Markdown, tablas, tarjetas de controles (✓ medido, 👁 revisar a ojo, ✗ no cumple) y vistas previas de los candidatos.
- **Modelos**:

  | Modelo | Cómo | Qué hace |
  |---|---|---|
  | Claude | Claude Code (`claude -p`) con el MCP de PixInsight | Trabaja sobre la imagen él mismo |
  | Codex | Codex CLI (`codex exec`) con el MCP | Igual que Claude |
  | Local (Ollama, LM Studio…) o cualquier endpoint OpenAI-compatible | HTTP con `curl.exe` | Propone un script PJSR con las funciones de la guía; tú lo ejecutas con «Ejecutar script» |

- **Watcher MCP integrado**: atiende los comandos del servidor MCP de `../servidor-mcp` sin lanzar el script del watcher aparte.
- **Configurar IA**: elige el modelo inferior o el superior de cada paso según su dificultad (`guia/porcentajes_skill.json`).
- Interfaz en español o inglés.

## Requisitos

- Windows 10/11 y PixInsight 1.9.6 o superior.
- Para compilar: Visual Studio 2022 o posterior (conjunto de herramientas v143, C++ de escritorio) y el SDK de PCL (<https://gitlab.com/pixinsight/PCL>).
- Para firmar: tus claves de desarrollador de PixInsight (fichero `.xssk`). Ver la documentación oficial de firma de código de PixInsight.
- Para usar los modelos, según el que elijas:
  - Claude: [Claude Code](https://docs.anthropic.com/claude-code) con sesión iniciada (`claude`, luego `/login`).
  - Codex: `npm install -g @openai/codex` y `codex login`.
  - Local: [Ollama](https://ollama.com) u otro servidor OpenAI-compatible.
- La guía (`../guia`) y, para Claude y Codex, el servidor MCP (`../servidor-mcp`) de este repositorio.

## Compilar (Windows)

1. Descarga y compila PCL según su documentación, y define las variables de entorno que usa el proyecto: `PCLDIR`, `PCLSRCDIR`, `PCLINCDIR`, `PCLLIBDIR64` y `PCLBINDIR64`.
2. Compila el módulo:

   ```
   MSBuild.exe windows\vc17\PiCopilot.vcxproj /p:Configuration=Release /p:Platform=x64 /p:PCLBINDIR64=<carpeta de salida>
   ```

   El resultado es `<carpeta de salida>\PiCopilot-pxm.dll`.
3. **Con PixInsight abierto, la DLL instalada está bloqueada.** Compila cada versión en una carpeta nueva (`build1`, `build2`…) y no uses `/t:Rebuild` con PixInsight abierto.

Los makefiles de `linux/` y `macosx/` vienen de la plantilla de PCL y **no se han probado**.

## Firmar e instalar

1. Firma la DLL con tus claves: en PixInsight, *Script > Development > CodeSign*, o por línea de comandos con `--sign-module-file` y `--xssk-file`. Hay que volver a firmar tras cada compilación.
2. *Process > Modules > Manage Modules*: si tienes una versión anterior, desinstálala primero (si no, aparece «Duplicate MetaProcess identifier»). Después instala la nueva desde su carpeta.
3. Abre *Process > PiCopilot* y acóplalo al panel lateral.
4. En **Configuración** (plegada al final del panel), indica la carpeta de la guía (`…/guia`), la carpeta de trabajo y, si vas a usar Claude, la ruta de `claude.exe`.

## Seguridad

PiCopilot ejecuta en PixInsight scripts escritos por un modelo de IA:
- Con los modelos locales, **siempre pide confirmación** antes de ejecutar y puedes revisar el script en la ventana de Prompt.
- Con Claude y Codex, el modelo actúa a través del MCP de PixInsight.

Trabaja sobre copias, ten copia de tus masters y revisa lo que hace la IA. Los modelos en la nube reciben la vista activa, los resultados de las medidas y las fichas de la guía; no se les envía ningún fichero de perfil personal.

## Archivos

| Fichero | Qué contiene |
|---|---|
| `PiCopilotInterface.*` | Panel, tareas asíncronas, ejecución de scripts, vistas previas, watcher integrado |
| `PiCopilotDialogs.*` | Prompt, Añadir modelo, Configurar IA y Dossier |
| `PiCopilotRender.*` | Página HTML del chat (Markdown, tablas, tarjetas, previas) |
| `PiCopilotAgent.*` | Modelos, configuración, pasos de la guía, funciones por paso y prompts |
| `PiCopilotI18n.*` | Traducción de la interfaz (español → inglés) |
| `PiCopilotJson.*` | Lector y escritor JSON mínimo |
| `PiCopilotModule/Process/Instance/Parameters.*` | Estructura del módulo PCL |

Proyecto independiente, sin relación con Pleiades Astrophoto, Anthropic ni OpenAI.
