# Windows installer

*Español: [README.md](README.md). The installer speaks English or Spanish depending on the Windows language (`-Idioma en` or `-Idioma es` to choose).*

Installs and sets up AstroPilot (PiAstroPilot for PixInsight, SirilAstroPilot and SetiAstroPilot) with a single script.

## How to use it

- **Without the repository yet**: open PowerShell and paste

  ```
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Az0te/astro-agente-repo/main/instalar/instalar.ps1).TrimStart([char]0xFEFF)))
  ```

  If PowerShell refuses to run scripts, first: `Set-ExecutionPolicy -Scope Process Bypass`.

- **With the repository already downloaded**: double-click `instalar\Instalar.cmd`.

- **Only add the MCP servers to Claude**: double-click `instalar\Claude-MCP.cmd`. It registers `piastropilot`, `sirilastropilot` and `setiastropilot` (depending on the programs it finds) in Claude Desktop and Claude Code, without downloading anything or touching Siril, SASpro or the AI. Useful, for example, after installing Claude Desktop or if you move the repository. The first time, use the full installer: Siril needs its scripts folder and SASpro its launchers.

To see what it would do without changing anything: `Instalar.cmd -Simular` (or `Claude-MCP.cmd -Simular`). To update later, run it again.

## What it does

1. **Finds the programs**: PixInsight, Siril and Seti Astro Suite Pro (Windows registry and usual folders).
2. **Downloads the repository** to the folder you choose: with `git clone` if you have Git, otherwise with the GitHub ZIP. If it is already there, it updates it (`git pull` or the ZIP on top; your own files, such as `guia/perfil.md`, are kept).
3. **Node.js 18 or later** (needed by the MCP servers): if missing, offers to install it with `winget`.
4. **The AI** you choose (you can pick several); see below.
5. **Sets up each program found**:
   - MCP servers (`piastropilot`, `sirilastropilot`, `setiastropilot`) in Claude Desktop, Claude Code and Codex, whichever you have. Claude Desktop works even if it was just installed and never opened (it creates `%APPDATA%\Claude`). If the Claude Desktop settings are broken (incomplete JSON), it repairs them; it removes the project's old servers (`pixinsight`, `picopilot`) whose file no longer exists.
   - PixInsight: the `PIXINSIGHT_EXE` variable if it is not in `C:\Program Files\PixInsight`. The Lite has to be added by hand in *Script > Feature Scripts… > Add* (`piastropilot\script`): PixInsight does not allow doing it from outside.
   - Siril: adds `siril\puente` to the script folders (Siril must be **closed**, because it saves its settings on exit).
   - SASpro: copies the launchers to `%LOCALAPPDATA%\SASpro\scripts` and sets `SETIASTROPILOT_REPO`.
6. Creates `guia/perfil.md` from the example, if it does not exist.

Before touching a settings file it saves a copy with the `.antes-astropilot` extension.

## Which AI to choose

| Option | Cost | What the script installs | Reliability with the guide |
|---|---|---|---|
| 1. **Claude** | **free** with the Claude Desktop app (small quota); Claude Code only with a Pro/Max subscription or API | Claude Desktop (`winget`) and, if you say you have a subscription or API, Claude Code (official installer) | the best |
| 2. **Codex** (OpenAI) | ChatGPT subscription or API | `npm install -g @openai/codex` and `codex login` | good |
| 3. **Local with Ollama** | free | Ollama (`winget`) and a Qwen model sized to your graphics memory: 32B with 20 GB or more, 14B with 12 GB, 8B below that (for testing only) | good with 32B; nothing leaves your PC |
| 4. **Gemini** (Google) | free with a key | opens the key page and saves it as `GEMINI_API_KEY` (hidden while typing) | lower: for trying it out, checking every step |

After installing:

- **Free Claude (Claude Desktop)**: open the app and sign in with your claude.ai account (the free one is enough) and, with the free account, pick **Sonnet** in the model picker and use only that one. The installer has already registered `piastropilot`, `sirilastropilot` and `setiastropilot` in `%APPDATA%\Claude\claude_desktop_config.json`; if the app was open, quit it completely (also from the tray) and open it again. To load the guide, press **+** in the chat, pick the program's connector and add `SKILL.md`. From there you process by talking to Claude in the app; the Lite, the module and the Siril and SASpro chats do **not** use this route.
  - **Do not type `claude` in a terminal with a free account**: that is Claude Code, which has no free plan and will ask for a subscription or an API key.
  - The free quota is small and **can run out halfway through a processing session** (every step sends measurements and thumbnails); then you have to wait a few hours. If it happens often, carry on with **Gemini** (free with a key, less reliable) or **local Qwen** (Ollama, if your graphics card can take it).
- **Claude Code (paid)**: the installer only offers it if you say you have a Pro/Max subscription or an API key. After installing it, it checks `claude --version`, adds `%USERPROFILE%\.local\bin` to your user PATH if missing (works in terminals opened afterwards) and offers to open `claude` in another window to sign in once. In the Lite, provider *Claude Code (CLI)*; in the Siril and SASpro chats, *Claude (CLI)*.
- **Codex**: `codex login` once. In the Lite, *Codex (CLI)*; in the chats, *Codex (CLI)*.
- **Local**: with Ollama running, in the Lite choose *Ollama* and *Read Ollama models*; in the chats they appear by themselves.
- **Gemini**: in the Lite, *Gemini (API, free with key)*; in the chats, *Gemini Flash-Lite*.

More detail in [Which AI to use](../README.en.md).

## Options

```
instalar.ps1 [-Carpeta <path>] [-Simular] [-SinPreguntas] [-IA "1,3"] [-SinConfigurar] [-SoloMCP] [-SinGit] [-Idioma es|en]
```

- `-Carpeta`: where to install (otherwise it asks; default `%USERPROFILE%\astro-agente-repo`).
- `-Simular`: dry run, changes nothing.
- `-SinPreguntas`: accepts the defaults; with `-IA` it picks the AI without asking.
- `-SinConfigurar`: only downloads or updates the repository.
- `-SoloMCP`: only registers the MCP servers in Claude Desktop and Claude Code (what `Claude-MCP.cmd` does).
- `-SinGit`: uses the ZIP even if you have Git.
- `-Idioma`: `es` or `en`; otherwise the Windows language.
