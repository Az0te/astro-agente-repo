# Instalador para Windows

*English: [README.en.md](README.en.md). El instalador habla español o inglés según el idioma de Windows (`-Idioma es` o `-Idioma en` para elegirlo).*

Instala y configura AstroPilot (PiAstroPilot para PixInsight, SirilAstroPilot y SetiAstroPilot) con un solo script.

## Cómo se usa

- **Sin el repositorio todavía**: abre PowerShell y pega

  ```
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Az0te/astro-agente-repo/main/instalar/instalar.ps1).TrimStart([char]0xFEFF)))
  ```

  Si PowerShell no deja ejecutar scripts, antes: `Set-ExecutionPolicy -Scope Process Bypass`.

- **Con el repositorio ya descargado**: doble clic en `instalar\Instalar.cmd`.

Para ver lo que haría sin cambiar nada: `Instalar.cmd -Simular`. Para actualizar más adelante, vuelve a ejecutarlo.

## Qué hace

1. **Busca los programas**: PixInsight, Siril y Seti Astro Suite Pro (registro de Windows y carpetas habituales).
2. **Descarga el repositorio** en la carpeta que elijas: con `git clone` si tienes Git y, si no, con el ZIP de GitHub. Si ya está, lo actualiza (`git pull` o ZIP encima; tus ficheros, como `guia/perfil.md`, se quedan).
3. **Node.js 18 o superior** (lo necesitan los servidores MCP): si falta, ofrece instalarlo con `winget`.
4. **La IA** que elijas (puedes elegir varias); ver abajo.
5. **Configura cada programa encontrado**:
   - Servidores MCP (`piastropilot`, `sirilastropilot`, `setiastropilot`) en Claude Desktop, Claude Code y Codex, los que tengas. En Claude Desktop vale aunque esté recién instalado y sin abrir (crea `%APPDATA%\Claude`). Si la configuración de Claude Desktop está rota (JSON incompleto), la repara; quita los servidores viejos del proyecto (`pixinsight`, `picopilot`) cuyo fichero ya no existe.
   - PixInsight: la variable `PIXINSIGHT_EXE` si no está en `C:\Program Files\PixInsight`. El Lite hay que añadirlo a mano en *Script > Feature Scripts… > Add* (`piastropilot\script`): PixInsight no deja hacerlo desde fuera.
   - Siril: añade `siril\puente` a las carpetas de scripts (Siril tiene que estar **cerrado**, porque guarda su configuración al salir).
   - SASpro: copia los lanzadores a `%LOCALAPPDATA%\SASpro\scripts` y define `SETIASTROPILOT_REPO`.
6. Crea `guia/perfil.md` a partir del ejemplo, si no existe.

Antes de tocar un fichero de configuración guarda una copia con la extensión `.antes-astropilot`.

## Qué IA elegir

| Opción | Coste | Qué instala el script | Fiabilidad con la guía |
|---|---|---|---|
| 1. **Claude** | **gratis** con la app Claude Desktop (cuota pequeña); Claude Code solo con suscripción Pro/Max o API | Claude Desktop (`winget`) y, si dices que tienes suscripción o API, Claude Code (instalador oficial) | la mejor |
| 2. **Codex** (OpenAI) | suscripción de ChatGPT o API | `npm install -g @openai/codex` y `codex login` | buena |
| 3. **Local con Ollama** | gratis | Ollama (`winget`) y un modelo Qwen según la memoria de tu gráfica: 32B con 20 GB o más, 14B con 12 GB, 8B por debajo (solo para probar) | buena con 32B; nada sale del PC |
| 4. **Gemini** (Google) | gratis con clave | abre la página de la clave y la guarda como `GEMINI_API_KEY` (no se ve al escribirla) | menor: para probar, revisando cada paso |

Después de instalar:

- **Claude gratis (Claude Desktop)**: abre la app e inicia sesión con tu cuenta de claude.ai (la gratuita vale) y, con la cuenta gratis, elige **Sonnet** en el selector de modelo y usa solo ese. El instalador ya ha registrado `piastropilot`, `sirilastropilot` y `setiastropilot` en `%APPDATA%\Claude\claude_desktop_config.json`; si la app estaba abierta, ciérrala del todo (también en la bandeja) y ábrela otra vez. Para cargar la guía, en el chat pulsa **+**, elige el conector del programa y añade `SKILL.md`. Desde ahí se procesa hablando con Claude en la app; el Lite, el módulo y los chats de Siril y SASpro **no** usan esta vía.
  - **No escribas `claude` en una terminal con una cuenta gratis**: eso es Claude Code, que no tiene plan gratuito y te pedirá suscripción o clave de API.
  - La cuota gratuita es pequeña y **puede agotarse a mitad de un procesado** (cada paso manda medidas y miniaturas); entonces hay que esperar unas horas. Si te pasa a menudo, sigue con **Gemini** (gratis con clave, menos fiable) o con **Qwen local** (Ollama, si tu gráfica da).
- **Claude Code (de pago)**: el instalador solo lo ofrece si dices que tienes suscripción Pro/Max o clave de API. Escribe `claude` en una terminal una vez para iniciar sesión. En el Lite, proveedor *Claude Code (CLI)*; en los chats de Siril y SASpro, *Claude (CLI)*.
- **Codex**: `codex login` una vez. En el Lite, *Codex (CLI)*; en los chats, *Codex (CLI)*.
- **Local**: con Ollama abierto, en el Lite elige *Ollama* y *Leer modelos de Ollama*; en los chats salen solos.
- **Gemini**: en el Lite, *Gemini (API, gratis con clave)*; en los chats, *Gemini Flash-Lite*.

Más detalle en [Qué IA usar](../README.md#qué-ia-usar-y-cómo-configurarla).

## Opciones

```
instalar.ps1 [-Carpeta <ruta>] [-Simular] [-SinPreguntas] [-IA "1,3"] [-SinConfigurar] [-SinGit] [-Idioma es|en]
```

- `-Carpeta`: dónde instalar (si no, pregunta; por defecto `%USERPROFILE%\astro-agente-repo`).
- `-Simular`: no cambia nada, dice lo que haría.
- `-SinPreguntas`: acepta lo que va por defecto; con `-IA` elige la IA sin preguntar.
- `-SinConfigurar`: solo descarga o actualiza el repositorio.
- `-SinGit`: usa el ZIP aunque tengas Git.
- `-Idioma`: `es` o `en`; si no, el de Windows.
