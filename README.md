# AstroPilot: agente de astrofotografía para Siril y Seti Astro Suite Pro

> **English: full README in [README.en.md](README.en.md).** An AI assistant (Claude, Codex, a local model through Ollama, or free APIs) that processes deep-sky images in **Siril** and **Seti Astro Suite Pro (SASpro)** with you, following a detailed processing guide in Spanish (the assistant answers in the language you write in). Independent project, not affiliated with Anthropic or with the authors of Siril or SASpro.

> [!WARNING]
> **La parte de PixInsight está retirada** (PiAstroPilot, PiAstroPilot Lite y su servidor MCP).
> La licencia PCL 3.0 (sección 4.d) no permite que un agente externo ejecute funciones en PixInsight, y Pleiades Astrophoto ha confirmado que no concede excepciones. No habrá más versiones ni soporte. AstroPilot continúa con Siril y Seti Astro Suite Pro.

Este proyecto permite que un asistente de IA procese astrofotografías de cielo profundo en Siril y en SASpro **trabajando contigo**: tú decides y supervisas, la IA ejecuta, mide y propone.

Incluye estas partes:

- **[SirilAstroPilot](siril/README.md)** (`siril/`): el asistente para **Siril**, con chat dentro del programa y servidor MCP. Ver [SirilAstroPilot](#sirilastropilot).
- **[SetiAstroPilot](sas/README.md)** (`sas/`): el asistente para **Seti Astro Suite Pro (SASpro)**, con chat dentro del programa y servidor MCP. Ver [SetiAstroPilot](#setiastropilot).
- **Guía de procesado** (`guia/`): un manual detallado, en español, que Claude carga como *skill*. El asistente responde en el idioma en que se le pregunte (inglés o cualquier otro), aunque la guía esté en español. Está ordenada como el flujo de trabajo: 17 pasos de la fase lineal, 11 de la no lineal y anexos (controles de calidad, anti-patrones, flujos por tipo de objeto, glosario, y el cómo de cada programa); cada paso es un fichero con el porqué, los parámetros, la función que lo hace y el control para comprobarlo. Es la parte principal: recoge técnicas, trampas, valores de partida y controles de calidad aprendidos en sesiones reales de procesado.

## Principio

**Ceñirse a los datos, no inventar nada.** La guía obliga a confirmar cualquier estructura débil antes de realzarla, a comparar cada paso con la versión sin tocar y a medir (ringing, núcleos quemados, estrellas) en vez de fiarse sólo de la vista.

## Instalación rápida en Windows

El [instalador](instalar/README.md) lo deja todo listo con un solo script (habla español o inglés según el idioma de Windows; `-Idioma es` o `-Idioma en` para elegirlo). Si aún no tienes el repositorio, abre PowerShell y pega:

```
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Az0te/astro-agente-repo/main/instalar/instalar.ps1).TrimStart([char]0xFEFF)))
```

Si ya lo tienes, haz doble clic en `instalar\Instalar.cmd`. El script:

- busca Siril y SASpro;
- descarga o actualiza el repositorio en la carpeta que elijas (con Git o con el ZIP);
- comprueba Node.js y, si falta, lo instala con `winget`;
- **te guía para instalar la IA** que elijas, una o varias: **Claude** (la app Claude Desktop, que vale con una cuenta gratis, y Claude Code si tienes suscripción), **Codex**, **local con Ollama** (propone el modelo Qwen según la memoria de tu gráfica) o **Gemini** (abre la página de la clave gratuita y la guarda);
- configura los servidores MCP en Claude Desktop, Claude Code y Codex, la carpeta de scripts de Siril y los lanzadores de SASpro.

Antes de tocar un fichero de configuración guarda una copia `.antes-astropilot`, y con `-Simular` dice lo que haría sin cambiar nada. Para actualizar más adelante, vuelve a ejecutarlo. Opciones y detalles en [`instalar/README.md`](instalar/README.md).

## SirilAstroPilot

El asistente para **Siril** (`siril/`). Es un puente escrito desde cero con sirilpy, más un chat dentro de Siril. Funciona con un modelo local de Ollama (p. ej. Qwen), con Claude o con APIs gratuitas con clave (Gemini, OpenRouter, Groq; menos fiables). Sigue la guía común, con el cómo de Siril en el Anexo I. Las herramientas son de una lista blanca y comparan candidatos en cada paso, del apilado a la exportación.

1. Requisitos: Siril 1.4.x (con Python y sirilpy).
2. En Siril, Preferencias > Scripts: añade la carpeta `siril/puente`.
3. Lanza **Scripts > SirilAstroPilot**: arranca el puente y abre el chat.

Detalles e instalación del MCP (Claude Code, Codex) en [`siril/README.md`](siril/README.md).

## SetiAstroPilot

El asistente para **Seti Astro Suite Pro (SASpro)** (`sas/`). El puente corre dentro de SASpro, que ejecuta los scripts de usuario en su propio proceso, y lleva un chat igual que el de Siril: IA local, Claude, Codex o APIs con clave. Sigue la guía común, con el cómo de SASpro en el Anexo K y herramientas de una lista blanca que comparan candidatos en cada paso. Probado de principio a fin en SASpro 1.24.2 con un master de M31.

1. Requisitos: Seti Astro Suite Pro reciente (con el menú Flujos de trabajo > Scripts) y Node.js 18 o superior si se usa por MCP desde Claude Code o Codex.
2. En SASpro, **Scripts > Open Scripts Folder** (en Windows `%LOCALAPPDATA%\SASpro\scripts`): copia allí `sas/puente/SetiAstroPilot.py` y `sas/puente/SetiAstroPilot_Chat.py`. Si el repositorio no está en `~/astro-agente-repo`, define la variable `SETIASTROPILOT_REPO`.
3. Recarga los scripts y lanza **Flujos de trabajo > Scripts > AstroPilot > SetiAstroPilot (chat)** (en SASpro 1.x, menú Scripts > AstroPilot): arranca el puente y abre el chat.

Detalles, herramientas e instalación del MCP en [`sas/README.md`](sas/README.md).

## Qué IA usar y cómo configurarla

Los chats de Siril y SASpro siguen la misma guía con el modelo que elijas. El [instalador](#instalación-rápida-en-windows) instala Claude, Codex, Ollama con su modelo o la clave de Gemini por ti; abajo está cómo hacerlo a mano.

| IA | Coste | Qué necesitas | Dónde funciona | Fiabilidad con la guía |
|---|---|---|---|---|
| **Claude Desktop** (Anthropic, app) | **gratis** con cuenta de claude.ai, solo con **Sonnet**, cuota pequeña | la app y los servidores MCP en su configuración (el instalador lo hace) | Siril y SASpro hablando con Claude en la app (no en los chats) | la mejor, mientras dure la cuota |
| **Claude Code** (Anthropic) | suscripción o API de pago | Claude Code instalado y con sesión | chats y MCP | la mejor (referencia de la guía) |
| **Codex** (OpenAI) | suscripción de ChatGPT o API | `npm install -g @openai/codex` y `codex login` | chats y MCP | buena |
| **Local con Ollama** (p. ej. Qwen) | gratis | una gráfica con VRAM suficiente (unos 16–24 GB para Qwen de 27–32B) | chats | buena con los modelos grandes; sin enviar nada fuera del PC |
| **Gemini** (Google, API) | **gratis** con límites diarios | una clave de Google AI Studio | chats | **menor**: para probar |
| **OpenRouter / Groq** (API) | nivel gratuito con límites | una clave de su web | chats | **menor**; sin probar a fondo |

> **Las APIs gratuitas no son tan fiables como la IA local o las de pago.** Sirven para probar el asistente sin gráfica ni suscripción, pero eligen peor y se saltan reglas. En la prueba del 18 nov 2026 (IC 1396, Siril, «Hasta el final»), Gemini Flash-Lite hizo de principio a fin la parte lineal casi como en el procesado de referencia, pero en la no lineal dejó la nebulosa con un tono lavanda, las estrellas casi apagadas y sin contraste, e inventó tiempos en el informe. Úsalas con **«Elegir yo»** marcado y revisa cada paso. Además, en el nivel gratuito el proveedor puede usar lo que se envía (las medidas y las miniaturas de tus imágenes) para mejorar sus modelos.

### Claude Desktop (gratis)

Para quien no tiene suscripción: **Claude Code no tiene plan gratuito** (si escribes `claude` en una terminal te pedirá suscripción o clave de API), pero la app **Claude Desktop** sí funciona con una cuenta gratis de claude.ai y habla con Siril y SASpro por MCP.

1. Instala [Claude Desktop](https://claude.ai/download) e inicia sesión (o usa el [instalador](#instalación-rápida-en-windows), opción 1, y responde que no tienes suscripción).
2. Registra los servidores en `%APPDATA%\Claude\claude_desktop_config.json` (el instalador lo hace solo, y `instalar\Claude-MCP.cmd` hace solo este paso; los dos guardan una copia `.antes-astropilot`):

   ```json
   {
     "mcpServers": {
       "sirilastropilot": { "command": "node", "args": ["C:/Users/<tu_usuario>/astro-agente-repo/siril/mcp/dist/sirilastropilot-mcp.mjs"] },
       "setiastropilot": { "command": "node", "args": ["C:/Users/<tu_usuario>/astro-agente-repo/sas/mcp/dist/setiastropilot-mcp.mjs"] }
     }
   }
   ```

   Cierra la app del todo (también en la bandeja) y ábrela otra vez.
3. Con la cuenta gratis, elige **Sonnet** en el selector de modelo de la app y usa solo ese.
4. En el chat, pulsa **+**, elige el conector del programa y añade `SKILL.md` para cargar la guía. Luego pide el paso que quieras con el programa abierto y el puente arrancado.

> **La cuota gratuita es pequeña y puede agotarse a mitad de un procesado**: cada paso manda medidas y miniaturas, y un procesado completo usa muchos mensajes. Cuando se agota hay que esperar unas horas. Para trabajar sin cortes, sigue con [Gemini](#gemini-gratis-con-clave) (gratis con clave, menos fiable) o con [Qwen local](#local-con-ollama) si tu gráfica da, o pasa a una suscripción.

### Claude Code

1. Instala [Claude Code](https://claude.com/claude-code) e inicia sesión (suscripción Pro/Max o clave de API).
2. **Chats de Siril/SASpro**: modelo *Claude (CLI)*. También se puede usar desde una terminal con el MCP (ver `siril/README.md` y `sas/README.md`).

### Codex

1. `npm install -g @openai/codex` y después `codex login`.
2. **Chats de Siril/SASpro**: modelo *Codex (CLI)*. También se puede usar desde una terminal con el MCP (ver `siril/README.md` y `sas/README.md`).

### Local con Ollama

1. Instala [Ollama](https://ollama.com) y descarga un modelo, por ejemplo `ollama pull qwen3:32b`.
2. **Chats de Siril/SASpro**: tus modelos de Ollama salen solos en la lista.

### Gemini (gratis, con clave)

1. Saca una clave gratis en [aistudio.google.com/apikey](https://aistudio.google.com/apikey), con tu cuenta de Google y sin tarjeta. **No la compartas ni la pegues en chats.**
2. **Chats de Siril y SASpro**: elige *Gemini Flash-Lite (API gratis, rápido)* y pulsa **Clave…** para pegarla. Se guarda solo en tu PC, como variable de entorno de usuario `GEMINI_API_KEY`.
3. **Flash-Lite** responde en segundos. **Flash** razona algo mejor, pero en el nivel gratuito puede tardar minutos por respuesta. Si Google retira un modelo, los chats cambian solos al que indique la API.

Para crear la variable a mano: Inicio > «variables de entorno» > *Editar las variables de entorno de esta cuenta* > **Nueva**, con el nombre `GEMINI_API_KEY` y tu clave como valor.

### OpenRouter y Groq (gratis, con clave)

1. Saca la clave en [openrouter.ai/keys](https://openrouter.ai/keys) o en [console.groq.com/keys](https://console.groq.com/keys).
2. **Chats de Siril y SASpro**: elige *OpenRouter (API)* o *Groq (API)* y pulsa **Clave…**. Se guarda en `OPENROUTER_API_KEY` o `GROQ_API_KEY`.
3. El modelo se cambia con la variable `OPENROUTER_MODELO` o `GROQ_MODELO`, y para Gemini con `GEMINI_MODELO`. Estos modelos no ven las previas: trabajan solo con las medidas.

## Cargar la guía en tu agente

Los chats de Siril y SASpro ya la cargan solos. Si usas el MCP desde otro cliente:

1. El punto de entrada es `guia/SKILL.md` (núcleo común de reglas e índice, ~4.000 tokens; skill `astro-procesado`) junto con el arranque del anexo del programa (Anexo I para Siril, Anexo K para SASpro); el resto se lee paso a paso.
   - Claude: la carpeta `guia/` como *skill*.
   - ChatGPT u otro cliente con MCP: [`guia/envolturas/chatgpt.md`](guia/envolturas/chatgpt.md).
   - Modelo local (Ollama): [`guia/envolturas/local.md`](guia/envolturas/local.md).
2. Copia `guia/perfil-ejemplo.md` como `guia/perfil.md` y rellénalo con tu equipo, tu cielo, tus rutas y tus gustos. Ese fichero está excluido de Git.

## Limitaciones conocidas

- La guía se ha probado con una cámara OSC (IMX571) y varios filtros (sin filtro, tribanda y dual band Hα/OIII, SII/OIII y SII/Hβ) y con **cámara monocromo y banda estrecha**: la Nebulosa de la Tarántula (KAF-11000 con rueda de filtros, LRGB + Hα, OIII y SII de 7–8,5 nm, SHO con estrellas de la RGB). Para otros equipos, sus valores son puntos de partida.
## ⚠️ Seguridad

Los puentes de Siril y SASpro no ejecutan código arbitrario: escuchan solo en `127.0.0.1`, cada petición lleva un token (`~/.sirilastropilot/token` o `~/.setiastropilot/token`) y solo el nombre de una herramienta de su lista blanca con sus parámetros. **Ningún modelo escribe ni ejecuta código.** Aun así:

- no compartas ni sincronices las carpetas `~/.sirilastropilot` y `~/.setiastropilot` con servicios en la nube;
- revisa lo que hace la IA, sobre todo antes de guardar o sobrescribir ficheros.

## Cómo contribuir

Lo que más ayuda ahora son **datos y resultados de otros equipos, cielos y tipos de objeto**; no hace falta programar:

- **Casos de prueba**: masters o recortes de tipos de objeto poco probados, con equipo, filtro y cámara.
- **Fallos** con el registro del chat o de la consola.
- **Comparativas** de tu procesado manual frente al del asistente, para calibrar umbrales.
- **Pruebas** con otros modelos de IA, GPU, sistemas o telescopios inteligentes.
- **Mejoras de la guía** por *pull request*: siempre reglas por **tipo de objeto**, nunca para un objeto concreto.

Abre una [*issue*](https://github.com/Az0te/astro-agente-repo/issues/new/choose) con la plantilla que corresponda, o comenta ideas y resultados en [*Discussions*](https://github.com/Az0te/astro-agente-repo/discussions). Los ficheros grandes, mejor con un enlace a Drive o WeTransfer. Todos los detalles (también en inglés) están en [`CONTRIBUTING.md`](CONTRIBUTING.md).

*Contributions are welcome in English too: see [`CONTRIBUTING.md`](CONTRIBUTING.md#how-to-contribute).*

## Créditos

- **Alain Escaffre**, [pixinsight-mcp](https://github.com/aescaffre/pixinsight-mcp) (MIT): diseño del primer puente del proyecto (retirado) y muchas ideas de la guía (barreras de calidad, taxonomía de objetos).
- **Jeff Henry**, [NOVA](https://github.com/measurethepixels/nova) (MIT): artículos con evidencia medida que se citan en la guía.
- Las demás fuentes están en [`guia/FUENTES.md`](guia/FUENTES.md).
- Proyecto desarrollado en colaboración con Claude (Anthropic) a partir de sesiones reales de procesado, revisado y probado por el autor.

## Licencias

- Código (`siril/`, `sas/`): **MIT**. Copyright (c) 2026 Rafael Vidal. Ver [`LICENSE`](LICENSE).
- Guía (`guia/`): **CC BY-SA 4.0**. Ver [`guia/LICENSE.md`](guia/LICENSE.md).

PixInsight es una marca de Pleiades Astrophoto S.L. Claude es una marca de Anthropic. Este es un proyecto independiente, sin relación ni respaldo de ninguna de las dos empresas.

## Autor

Rafael Vidal ([@Az0te](https://github.com/Az0te))
