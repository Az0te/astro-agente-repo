# Astrophotography agent for PixInsight (Windows)

*Español: ver [README.md](README.md).*

This project lets an AI assistant (Claude, through the MCP protocol) control PixInsight to process deep-sky astrophotographs, **working with you**: you decide and supervise, the AI runs, measures and proposes.

It includes these parts:

- **[PiAstroPilot Lite](piastropilot/script/README.en.md)** (`piastropilot/script/PiAstroPilotLite.js`): **the easiest way to start**. It is a PixInsight script, with nothing to build or sign: chat with the assistant (local Ollama, Claude Code or Codex), the guide's functions already loaded, method comparison, object information from the internet, and voice. Its window and replies can be switched to English (Settings > Language). See [Getting started with PiAstroPilot Lite](#getting-started-with-piastropilot-lite).
- **[PiAstroPilot](piastropilot/README.md)** (`piastropilot/`): a native PixInsight module that docks an AI assistant in a side panel without blocking PixInsight. It has one button per guide step, a chat with tables and previews, and works with Claude Code, Codex or a local model (Ollama). It comes with this repository's guide; for now you have to build it and sign it with your own developer keys.
- **piastropilot MCP server** (`mcp/`): the bridge between the AI and PixInsight. It offers the guide's functions as tools and runs them in the PixInsight instance you have open (IPC `PixInsight.exe -x=`), with no watched folder and no `eval`. Details in [`mcp/README.md`](mcp/README.md).
- **Processing guide** (`guia/`): a detailed manual, in Spanish, that Claude loads as a *skill*. The assistant answers in the language you ask in (English or any other), even though the guide is in Spanish. It follows the workflow: 17 steps of the linear phase, 11 of the non-linear phase and appendices (script equivalents, quality checks, anti-patterns, workflows by object type, glossary); each step is a file with the why, the parameters, the guide function that does it and the check to verify it. It is the main part: it gathers techniques, traps, starting values and quality checks learned in real processing sessions.

## Principle

**Stick to the data, invent nothing.** The guide requires confirming any faint structure before enhancing it, comparing each step with the untouched version, and measuring (ringing, burnt cores, stars) instead of trusting the eye alone.

## What it adds over pixinsight-mcp

Alain Escaffre's original project is an **autonomous** pipeline designed for macOS and mono LRGB/HaLRGB data. This project starts from its bridge and adds:

- **Windows support**: paths, PowerShell and building the module for Windows.
- **Guide functions instead of loose processes** (`guia/herramientas/`): analysis, gradient with candidates, stretching «to failure», stars, saturation, palettes… each with its quality check. The MCP server only runs the ones on its whitelist.
- **Built-in BlindSolver**: `resolverAstrometria` solves the astrometry blindly for SPCC, SPFC and MGC without launching the script. It also includes **Star Stretch, ScreenStars, DarkStructureEnhance and BackgroundEnhance** (`guia/herramientas/realces.js`), reimplemented with the same result as the scripts.
- **Long jobs without blocking**: calls longer than 45 s return an id and the result is collected with `estado(trabajo)`.
- **Processing guide** aimed at OSC + dual band from urban skies, HDR with short exposures, bright star halos, DBXtract emulation with PixelMath, continuum subtraction and mixing mono and OSC cameras.

## Example: IC 63

The case study [IC 63, the Ghost of Cassiopeia](docs/casos/IC63/README.md) (in Spanish) shows the full process with images: sub selection with a halo index, HDR with short exposures for γ Cas, urban gradient, Hα from a dual band with continuum subtraction, and finishing.

## Getting started with PiAstroPilot Lite

This is what most people will use: it needs no Node.js, MCP server or building.

1. Download the repository (**Code > Download ZIP** on GitHub) and unzip it, for example in `C:\Users\<your_user>\astro-agente-repo`.
2. Have a model: [Ollama](https://ollama.com) with a model pulled (local and free, e.g. `ollama pull qwen3:32b`), or Claude Code / Codex installed and signed in.
3. In PixInsight 1.9.6 or later: **Script > Feature Scripts… > Add**, choose the `piastropilot\script` folder and press **Done**.
4. Open your image and launch **Script > PiAstroPilot > PiAstroPilotLite**.
5. In **Settings > Language** choose **English** (window and model replies; applied at once and remembered).
6. Choose the model in the **Model** tab and type in **Prompt**, for example «analyse the image».

Details, options and common problems in [`piastropilot/script/README.en.md`](piastropilot/script/README.en.md). What follows is for the MCP server and the module.

## Requirements (MCP server and module)

- Windows 10/11 (tested on Windows 11).
- [PixInsight](https://pixinsight.com) 1.9.6 or later.
- For `blindSolve`: a Gaia astrometric index configured in the Gaia process preferences (the same one the BlindSolver script uses).
- [Node.js](https://nodejs.org) 18 or later.
- An MCP-compatible AI client, for example the Claude desktop app or Claude Code.
- Optional, but the guide uses them a lot: BlurXTerminator, NoiseXTerminator and StarXTerminator (RC-Astro, paid), GraXpert, SetiAstro scripts and Toolbox. **Not included**: everyone must install them with their own licence.

## Installation (MCP server)

1. Download or clone this repository, for example in `C:\Users\<your_user>\astro-agente`.
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
- The guide has been tested mostly with an OSC camera (IMX571) and several filters: no filter, tri-band and dual band Hα/OIII, SII/OIII and SII/Hβ. For other equipment, its values are starting points.

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
