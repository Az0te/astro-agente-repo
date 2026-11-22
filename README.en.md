# Astrophotography agent for PixInsight (Windows)

*Español: ver [README.md](README.md).*

This project lets an AI assistant (Claude, through the MCP protocol) control PixInsight to process deep-sky astrophotographs, **working with you**: you decide and supervise, the AI runs, measures and proposes.

It includes these parts:

- **[PiAstroPilot Lite](piastropilot/script/README.en.md)** (`piastropilot/script/PiAstroPilotLite.js`): **the easiest way to start**. It is a PixInsight script, with nothing to build or sign: chat with the assistant (local Ollama, Claude Code or Codex), the guide's functions already loaded, method comparison, object information from the internet, and voice. Its window and replies can be switched to English (Settings > Language). See [Getting started with PiAstroPilot Lite](#getting-started-with-piastropilot-lite).
- **[PiAstroPilot](piastropilot/README.md)** (`piastropilot/`): a native PixInsight module that docks an AI assistant in a side panel without blocking PixInsight. It has one button per guide step, a chat with tables and previews, and works with Claude Code, Codex or a local model (Ollama). It comes with this repository's guide; for now you have to build it and sign it with your own developer keys.
- **piastropilot MCP server** (`mcp/`): the bridge between the AI and PixInsight. It offers the guide's functions as tools and runs them in the PixInsight instance you have open (IPC `PixInsight.exe -x=`), with no watched folder and no `eval`. Details in [`mcp/README.md`](mcp/README.md).
- **[SirilAstroPilot](siril/README.md)** (`siril/`): the same for **Siril**, with the same guide. See [SirilAstroPilot](#sirilastropilot).
- **[SetiAstroPilot](sas/README.md)** (`sas/`): the same for **Seti Astro Suite Pro (SASpro)**, with the same guide. See [SetiAstroPilot](#setiastropilot).
- **Processing guide** (`guia/`): a detailed manual, in Spanish, that Claude loads as a *skill*. The assistant answers in the language you ask in (English or any other), even though the guide is in Spanish. It follows the workflow: 17 steps of the linear phase, 11 of the non-linear phase and appendices (script equivalents, quality checks, anti-patterns, workflows by object type, glossary); each step is a file with the why, the parameters, the guide function that does it and the check to verify it. It is the main part: it gathers techniques, traps, starting values and quality checks learned in real processing sessions.

## Principle

**Stick to the data, invent nothing.** The guide requires confirming any faint structure before enhancing it, comparing each step with the untouched version, and measuring (ringing, burnt cores, stars) instead of trusting the eye alone.

## What it adds over pixinsight-mcp

Alain Escaffre's original project is an **autonomous** pipeline designed for macOS and mono LRGB/HaLRGB data. This project starts from its bridge and adds:

- **Windows support**: paths, PowerShell and building the module for Windows.
- **Guide functions instead of loose processes** (`guia/herramientas/`): analysis, gradient with candidates, stretching «to failure», stars, saturation, palettes… each with its quality check. The MCP server only runs the ones on its whitelist.
- **Built-in BlindSolver**: `resolverAstrometria` solves the astrometry blindly for SPCC, SPFC and MGC without launching the script. It also includes **Star Stretch, ScreenStars, DarkStructureEnhance and BackgroundEnhance** (`guia/herramientas/realces.js`), reimplemented with the same result as the scripts.
- **Long jobs without blocking**: calls longer than 45 s return an id and the result is collected with `estado(trabajo)`.
- **Processing guide** aimed at OSC + dual band from urban skies, HDR with short exposures, bright star halos, DBXtract emulation with PixelMath, continuum subtraction and mixing mono and OSC cameras. Also tested with a **monochrome camera and narrowband filters** (LRGB + Hα, OIII and SII, SHO palette).

## Quick install on Windows

The [installer](instalar/README.en.md) sets everything up with a single script (it speaks English or Spanish, following the Windows language; `-Idioma en` or `-Idioma es` to choose). If you don't have the repository yet, open PowerShell and paste:

```
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Az0te/astro-agente-repo/main/instalar/instalar.ps1).TrimStart([char]0xFEFF)))
```

If you already have it, double-click `instalar\Instalar.cmd`. The script:

- finds PixInsight, Siril and SASpro;
- downloads or updates the repository in the folder you choose (with Git or the ZIP);
- checks Node.js and installs it with `winget` if missing;
- **guides you through installing the AI** you pick, one or several: **Claude** (Claude Desktop and Claude Code), **Codex**, **local with Ollama** (it suggests a Qwen model based on your GPU memory) or **Gemini** (it opens the free key page and saves the key);
- sets up the MCP servers in Claude Desktop, Claude Code and Codex, the Siril scripts folder and the SASpro launchers.

Before touching a config file it keeps a `.antes-astropilot` copy, and `-Simular` shows what it would do without changing anything. Run it again later to update. Options and details in [`instalar/README.en.md`](instalar/README.en.md).

## Getting started with PiAstroPilot Lite

This is what most people will use: it needs no Node.js, MCP server or building.

1. Download the repository (**Code > Download ZIP** on GitHub) and unzip it, for example in `C:\Users\<your_user>\astro-agente-repo`. Or use the [installer](#quick-install-on-windows), which does this step and the next.
2. Have a model: [Ollama](https://ollama.com) with a model pulled (local and free, e.g. `ollama pull qwen3:32b`), Claude Code / Codex installed and signed in, or a free Gemini key (no GPU or subscription needed, less reliable). See [Which AI to use and how to set it up](#which-ai-to-use-and-how-to-set-it-up).
3. In PixInsight 1.9.6 or later: **Script > Feature Scripts… > Add**, choose the `piastropilot\script` folder and press **Done**.
4. Open your image and launch **Script > PiAstroPilot > PiAstroPilotLite**.
5. In **Settings > Language** choose **English** (window and model replies; applied at once and remembered).
6. Choose the model in the **Model** tab and type in **Prompt**, for example «analyse the image».

Details, options and common problems in [`piastropilot/script/README.en.md`](piastropilot/script/README.en.md). What follows is for the MCP server and the module.

## SirilAstroPilot

The same assistant for **Siril** (`siril/`). It is a bridge written from scratch with sirilpy, with no PixInsight code, plus a chat inside Siril. It works with a local Ollama model (e.g. Qwen), with Claude or with free APIs with a key (Gemini, OpenRouter, Groq; less reliable). It follows the same common guide, with the Siril how-to in Annex I. The tools come from a whitelist and compare candidates at every step, from stacking to export.

1. Requirements: Siril 1.4.x (with Python and sirilpy).
2. In Siril, Preferences > Scripts: add the `siril/puente` folder.
3. Launch **Scripts > SirilAstroPilot**: it starts the bridge and opens the chat.

Details and MCP setup (Claude Code, Codex) in [`siril/README.md`](siril/README.md) (Spanish).

## Which AI to use and how to set it up

Every part (Lite, the module, the Siril and SASpro chats) follows the same guide with the model you choose. The [installer](#quick-install-on-windows) installs Claude, Codex, Ollama with its model or the Gemini key for you; below is how to do it by hand.

| AI | Cost | What you need | Where it works | Reliability with the guide |
|---|---|---|---|---|
| **Claude Code** (Anthropic) | subscription or paid API | Claude Code installed and signed in | everywhere; processes on its own through MCP | the best (the guide's reference) |
| **Codex** (OpenAI) | ChatGPT subscription or API | `npm install -g @openai/codex` and `codex login` | everywhere; processes on its own through MCP (in Lite it proposes the calls) | good |
| **Local with Ollama** (e.g. Qwen) | free | a GPU with enough VRAM (about 16–24 GB for a 27–32B Qwen) | everywhere | good with the large models; nothing leaves your PC |
| **Gemini** (Google, API) | **free** with daily limits | a Google AI Studio key | Siril and SASpro chats, Lite and module | **lower**: for trying it out |
| **OpenRouter / Groq** (API) | free tier with limits | a key from their site | Siril and SASpro chats; templates in the module | **lower**; not tested in depth |

> **Free APIs are not as reliable as a local AI or the paid ones.** They let you try the assistant without a GPU or a subscription, but they choose worse and skip rules. In the 18 Nov 2026 test (IC 1396, Siril, "Hasta el final"), Gemini Flash-Lite did the whole linear part almost as in the reference processing, but in the non-linear part it left the nebula lavender, the stars almost gone and no contrast, and it made up timings in its report. Use them with **«Elegir yo»** (choose myself) ticked and check every step. Also, on free tiers the provider may use what you send (measurements and thumbnails of your images) to improve its models.

### Claude Code

1. Install [Claude Code](https://claude.com/claude-code) and sign in (Pro/Max subscription or API key).
2. **Lite**: *Model* tab > provider *Claude Code (CLI)*. **Module**: model *Claude*. **Siril/SASpro chats**: model *Claude (CLI)*.

### Codex

1. `npm install -g @openai/codex`, then `codex login`.
2. **Lite**: provider *Codex (CLI)*. **Module**: model *Codex*. **Siril/SASpro chats**: model *Codex (CLI)*. It can also be used from a terminal with the MCP (see `siril/README.md` and `sas/README.md`).

### Local with Ollama

1. Install [Ollama](https://ollama.com) and pull a model, e.g. `ollama pull qwen3:32b`.
2. **Lite**: provider *Ollama* and *Read Ollama models*. **Module**: model *Qwen 3.8 (local)* or «+» > *Ollama*. **Siril/SASpro chats**: your Ollama models show up in the list.

### Gemini (free, with a key)

1. Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) with your Google account, no card needed. **Do not share it or paste it into chats.**
2. **Siril and SASpro chats**: choose *Gemini Flash-Lite (API gratis, rápido)* and press **Key…** to paste it. It is stored only on your PC, as the user environment variable `GEMINI_API_KEY`.
3. **Lite**: provider *Gemini (API, gratis con clave)* and paste the key in *Settings > Clave de Gemini*. If left empty, it uses `GEMINI_API_KEY`.
4. **Module** (build 115 or later): model *Gemini Flash-Lite (API gratis)*. It reads `GEMINI_API_KEY`. Like the local model, it proposes the calls for you to review.
5. **Flash-Lite** answers in seconds. **Flash** reasons somewhat better, but on the free tier it can take minutes per answer. If Google retires a model, the chats switch on their own to the one the API suggests.

To create the variable by hand: Start > "environment variables" > *Edit environment variables for your account* > **New**, with the name `GEMINI_API_KEY` and your key as the value.

### OpenRouter and Groq (free, with a key)

1. Get the key at [openrouter.ai/keys](https://openrouter.ai/keys) or [console.groq.com/keys](https://console.groq.com/keys).
2. **Siril and SASpro chats**: choose *OpenRouter (API)* or *Groq (API)* and press **Key…**. It is stored in `OPENROUTER_API_KEY` or `GROQ_API_KEY`. **Module**: «+» > the matching template.
3. Change the model with the `OPENROUTER_MODELO` or `GROQ_MODELO` variable, and for Gemini with `GEMINI_MODELO`. These models do not see the previews: they work from the measurements only.

## SetiAstroPilot

The same assistant for **Seti Astro Suite Pro (SASpro)** (`sas/`). The bridge runs inside SASpro, which runs user scripts in its own process, and it comes with a chat like the Siril one: local AI, Claude, Codex or APIs with a key. It follows the same common guide, with whitelisted tools that compare candidates at every step. Tested end to end in SASpro 1.24.2 with an M31 master.

1. Requirements: a recent Seti Astro Suite Pro (with the Scripts menu), and Node.js 18 or later if you use it through MCP from Claude Code or Codex.
2. In SASpro, **Scripts > Open Scripts Folder** (on Windows `%LOCALAPPDATA%\SASpro\scripts`): copy `sas/puente/SetiAstroPilot.py` and `sas/puente/SetiAstroPilot_Chat.py` there. If the repository is not in `~/astro-agente-repo`, set the `SETIASTROPILOT_REPO` variable.
3. Reload the scripts and launch **Scripts > AstroPilot > SetiAstroPilot (chat)**: it starts the bridge and opens the chat.

Details, tools and MCP setup in [`sas/README.md`](sas/README.md) (Spanish).

## PixInsight vs Siril comparison

**Video:** [processing test in PixInsight and Siril with the assistant](https://www.youtube.com/watch?v=qDlfi9weV1U) (YouTube, in Spanish).

[Comparison dossier (PDF in Spanish, M31 and IC 1396)](comparativas/dossier_PI_vs_Siril_M31_IC1396.pdf). Same masters, same brief, measured with the same code:

- **M31** (galaxy, four runs: PixInsight and Siril, each with Claude Opus and with Qwen). PixInsight with Opus wins: arms better separated from the sky, a core with structure and more stars. Siril lacked a core step and a multiscale stretch; both have since been added.
- **IC 1396** (emission nebula, RGB + Hα/OIII dual band, Qwen only). PixInsight wins on the neutral sky and on the stars. Siril wins on the nebula, noise and colour (Hα and OIII visible).

## Requirements (MCP server and module)

- Windows 10/11 (tested on Windows 11).
- [PixInsight](https://pixinsight.com) 1.9.6 or later.
- For `blindSolve`: a Gaia astrometric index configured in the Gaia process preferences (the same one the BlindSolver script uses).
- [Node.js](https://nodejs.org) 18 or later.
- An MCP-compatible AI client, for example the Claude desktop app or Claude Code.
- Optional, but the guide uses them a lot: BlurXTerminator, NoiseXTerminator and StarXTerminator (RC-Astro, paid), GraXpert, SetiAstro scripts and Toolbox. **Not included**: everyone must install them with their own licence.

## Installation (MCP server)

> The [installer](#quick-install-on-windows) does all of this for you. Below is the manual installation.

1. Download or clone this repository, for example in `C:\Users\<your_user>\astro-agente`. Any folder works (including `astro-agente-repo-main` from the GitHub ZIP): the MCP server and the runner find the guide (`guia/`) from their own location, with no file to edit. If you use the PiAstroPilot module and the repo is not in `~/astro-agente-repo`, set the `guia/` folder in its Settings.
2. Register the piastropilot MCP server in your client (no `npm install` needed: `mcp/dist/piastropilot-mcp.mjs` bundles everything). With Claude Code:
   ```
   claude mcp add piastropilot -- node C:/Users/<your_user>/astro-agente/mcp/dist/piastropilot-mcp.mjs
   ```
   With Codex or another client, see [`mcp/README.md`](mcp/README.md#instalar).
3. If PixInsight is not in `C:/Program Files/PixInsight`, set the `PIXINSIGHT_EXE` variable to the path of `PixInsight.exe`.
4. Open PixInsight. There is no script to launch: each call reaches the open instance and, if it is busy, waits in a queue.
5. Load the guide in your agent. The entry point is `guia/SKILL.md` (common core of rules and index, neutral for PixInsight and Siril, ~4,000 tokens; skill `astro-procesado`) together with the start-up section of the program's annex (Annex J for PixInsight, Annex I for Siril); the rest is read step by step.
   - Claude: the `guia/` folder as a *skill*.
   - ChatGPT or another MCP client: [`guia/envolturas/chatgpt.md`](guia/envolturas/chatgpt.md).
   - Local model (Ollama): [`guia/envolturas/local.md`](guia/envolturas/local.md).
6. Copy `guia/perfil-ejemplo.md` to `guia/perfil.md` and fill it in with your equipment, your sky, your paths and your preferences. That file is excluded from Git.

## Daily use

With PixInsight open, ask the assistant for the step you want (or use the [PiAstroPilot](piastropilot/README.md) buttons). You can keep using PixInsight normally: while you run a script from the menu yourself, the assistant's requests wait in a queue.

## Known limitations

- PixInsight **scripts** with a user interface (DBXtract, AutoDBE…) cannot be launched from a guide function; WBPP can, with `lanzarWBPP` (in a second instance), and BlindSolver is built in (`resolverAstrometria`).
- PiAstroPilot and PixInsight's default path are designed for Windows: on macOS or Linux they need adapting (PiAstroPilot Lite should work there, except parts of the voice features).
- The guide has been tested with an OSC camera (IMX571) and several filters (no filter, tri-band and dual band Hα/OIII, SII/OIII and SII/Hβ) and with a **monochrome camera and narrowband filters**: the Tarantula Nebula (KAF-11000 with a filter wheel, LRGB + 7–8.5 nm Hα, OIII and SII, SHO with stars from the RGB). For other equipment, its values are starting points.

## ⚠️ Security

The piastropilot MCP server does not run arbitrary code: each request carries only the name of a function and its parameters, and the runner checks a token (`~/.piastropilot/token`) and a whitelist before running it. There is no tool that runs free code. The same goes for PiAstroPilot and PiAstroPilot Lite: **no model writes or runs PixInsight code**; with local models, the model proposes calls to guide functions (name and parameters), which are checked against the manifest (`guia/herramientas/manifiesto.json`) before any of them runs. Even so:

- do not share or sync the `~/.piastropilot` folder with cloud services;
- review what the AI does, especially before saving or overwriting files.

## How to contribute

What helps most right now is **data and results from other equipment, skies and object types**; no programming needed:

- **Test cases**: masters or crops of little-tested object types, with equipment, filter and camera.
- **Bugs** with the panel or console log.
- **Comparisons** of your manual processing against PiAstroPilot's, to calibrate thresholds.
- **Tests** with other AI models, GPUs, systems or smart telescopes.
- **Guide improvements** by *pull request*: always rules by **object type**, never for a specific object.

Open an [*issue*](https://github.com/Az0te/astro-agente-repo/issues/new/choose) with the matching template, or share ideas and results in [*Discussions*](https://github.com/Az0te/astro-agente-repo/discussions). Large files are better shared with a Drive or WeTransfer link. All the details are in [`CONTRIBUTING.md`](CONTRIBUTING.md#how-to-contribute). Contributions in English are welcome.

## Credits

- **Alain Escaffre**, [pixinsight-mcp](https://github.com/aescaffre/pixinsight-mcp) (MIT): original design of the first bridge (file watcher and MCP server, retired in November 2026), plus many ideas in the guide (quality gates, object taxonomy, PJSR traps).
- **Jeff Henry**, [NOVA](https://github.com/measurethepixels/nova) (MIT): articles with measured evidence cited in the guide.
- The other sources are in [`guia/FUENTES.md`](guia/FUENTES.md).
- Project developed in collaboration with Claude (Anthropic) from real processing sessions, reviewed and tested by the author.

## Licences

- Code (`mcp/`, `piastropilot/`): **MIT**. Copyright (c) 2026 Rafael Vidal. See [`LICENSE`](LICENSE). The previous bridge (`watcher/`, `servidor-mcp/`, in the Git history) was MIT, Copyright (c) 2026 Alain Escaffre (original) and Rafael Vidal (modifications).
- Guide (`guia/`): **CC BY-SA 4.0**. See [`guia/LICENSE.md`](guia/LICENSE.md).

PixInsight is a trademark of Pleiades Astrophoto S.L. Claude is a trademark of Anthropic. This is an independent project, not affiliated with or endorsed by either company.

## Author

Rafael Vidal ([@Az0te](https://github.com/Az0te))
