# AstroPilot: astrophotography agent for Siril and Seti Astro Suite Pro

*Español: ver [README.md](README.md).*

> [!WARNING]
> **The PixInsight part has been withdrawn** (PiAstroPilot, PiAstroPilot Lite and their MCP server).
> The PCL License 3.0 (section 4.d) does not allow an external agent to run functions in PixInsight, and Pleiades Astrophoto has confirmed that it grants no exceptions. There will be no further versions or support. AstroPilot carries on with Siril and Seti Astro Suite Pro.

This project lets an AI assistant process deep-sky astrophotographs in Siril and SASpro **working with you**: you decide and supervise, the AI runs, measures and proposes.

It includes these parts:

- **[SirilAstroPilot](siril/README.md)** (`siril/`): the assistant for **Siril**, with a chat inside the program and an MCP server. See [SirilAstroPilot](#sirilastropilot).
- **[SetiAstroPilot](sas/README.md)** (`sas/`): the assistant for **Seti Astro Suite Pro (SASpro)**, with a chat inside the program and an MCP server. See [SetiAstroPilot](#setiastropilot).
- **Processing guide** (`guia/`): a detailed manual, in Spanish, that Claude loads as a *skill*. The assistant answers in the language you ask in (English or any other), even though the guide is in Spanish. It follows the workflow: 17 steps of the linear phase, 11 of the non-linear phase and appendices (quality checks, anti-patterns, workflows by object type, glossary, and the how-to for each program); each step is a file with the why, the parameters, the function that does it and the check to verify it. It is the main part: it gathers techniques, traps, starting values and quality checks learned in real processing sessions.

## Principle

**Stick to the data, invent nothing.** The guide requires confirming any faint structure before enhancing it, comparing each step with the untouched version, and measuring (ringing, burnt cores, stars) instead of trusting the eye alone.

## Quick install on Windows

The [installer](instalar/README.en.md) sets everything up with a single script (it speaks English or Spanish, following the Windows language; `-Idioma en` or `-Idioma es` to choose). If you don't have the repository yet, open PowerShell and paste:

```
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Az0te/astro-agente-repo/main/instalar/instalar.ps1).TrimStart([char]0xFEFF)))
```

If you already have it, double-click `instalar\Instalar.cmd`. The script:

- finds Siril and SASpro;
- downloads or updates the repository in the folder you choose (with Git or the ZIP);
- checks Node.js and installs it with `winget` if missing;
- **guides you through installing the AI** you pick, one or several: **Claude** (the Claude Desktop app, which works with a free account, and Claude Code if you have a subscription), **Codex**, **local with Ollama** (it suggests a Qwen model based on your GPU memory) or **Gemini** (it opens the free key page and saves the key);
- sets up the MCP servers in Claude Desktop, Claude Code and Codex, the Siril scripts folder and the SASpro launchers.

Before touching a config file it keeps a `.antes-astropilot` copy, and `-Simular` shows what it would do without changing anything. Run it again later to update. Options and details in [`instalar/README.en.md`](instalar/README.en.md).

## SirilAstroPilot

The assistant for **Siril** (`siril/`). It is a bridge written from scratch with sirilpy, plus a chat inside Siril. It works with a local Ollama model (e.g. Qwen), with Claude or with free APIs with a key (Gemini, OpenRouter, Groq; less reliable). It follows the common guide, with the Siril how-to in Annex I. The tools come from a whitelist and compare candidates at every step, from stacking to export.

1. Requirements: Siril 1.4.x (with Python and sirilpy).
2. In Siril, Preferences > Scripts: add the `siril/puente` folder.
3. Launch **Scripts > SirilAstroPilot**: it starts the bridge and opens the chat.

Details and MCP setup (Claude Code, Codex) in [`siril/README.md`](siril/README.md) (Spanish).

## SetiAstroPilot

The assistant for **Seti Astro Suite Pro (SASpro)** (`sas/`). The bridge runs inside SASpro, which runs user scripts in its own process, and it comes with a chat like the Siril one: local AI, Claude, Codex or APIs with a key. It follows the common guide, with the SASpro how-to in Annex K and whitelisted tools that compare candidates at every step. Tested end to end in SASpro 1.24.2 with an M31 master.

1. Requirements: a recent Seti Astro Suite Pro (with the Scripts menu), and Node.js 18 or later if you use it through MCP from Claude Code or Codex.
2. In SASpro, **Scripts > Open Scripts Folder** (on Windows `%LOCALAPPDATA%\SASpro\scripts`): copy `sas/puente/SetiAstroPilot.py` and `sas/puente/SetiAstroPilot_Chat.py` there. If the repository is not in `~/astro-agente-repo`, set the `SETIASTROPILOT_REPO` variable.
3. Reload the scripts and launch **Workflows > Scripts > AstroPilot > SetiAstroPilot (chat)** (in SASpro 1.x, the Scripts > AstroPilot menu): it starts the bridge and opens the chat.

Details, tools and MCP setup in [`sas/README.md`](sas/README.md) (Spanish).

## Which AI to use and how to set it up

The Siril and SASpro chats follow the same guide with the model you choose. The [installer](#quick-install-on-windows) installs Claude, Codex, Ollama with its model or the Gemini key for you; below is how to do it by hand.

| AI | Cost | What you need | Where it works | Reliability with the guide |
|---|---|---|---|---|
| **Claude Desktop** (Anthropic, app) | **free** with a claude.ai account, **Sonnet** only, small quota | the app and the MCP servers in its settings (the installer does it) | Siril and SASpro by talking to Claude in the app (not in the chats) | the best, while the quota lasts |
| **Claude Code** (Anthropic) | subscription or paid API | Claude Code installed and signed in | chats and MCP | the best (the guide's reference) |
| **Codex** (OpenAI) | ChatGPT subscription or API | `npm install -g @openai/codex` and `codex login` | chats and MCP | good |
| **Local with Ollama** (e.g. Qwen) | free | a GPU with enough VRAM (about 16–24 GB for a 27–32B Qwen) | chats | good with the large models; nothing leaves your PC |
| **Gemini** (Google, API) | **free** with daily limits | a Google AI Studio key | chats | **lower**: for trying it out |
| **OpenRouter / Groq** (API) | free tier with limits | a key from their site | chats | **lower**; not tested in depth |

> **Free APIs are not as reliable as a local AI or the paid ones.** They let you try the assistant without a GPU or a subscription, but they choose worse and skip rules. In the 18 Nov 2026 test (IC 1396, Siril, "Hasta el final"), Gemini Flash-Lite did the whole linear part almost as in the reference processing, but in the non-linear part it left the nebula lavender, the stars almost gone and no contrast, and it made up timings in its report. Use them with **«Elegir yo»** (choose myself) ticked and check every step. Also, on free tiers the provider may use what you send (measurements and thumbnails of your images) to improve its models.

### Claude Desktop (free)

For those without a subscription: **Claude Code has no free plan** (typing `claude` in a terminal asks for a subscription or an API key), but the **Claude Desktop** app does work with a free claude.ai account and talks to Siril and SASpro through MCP.

1. Install [Claude Desktop](https://claude.ai/download) and sign in (or use the [installer](#quick-install-on-windows), option 1, and answer that you have no subscription).
2. Register the servers in `%APPDATA%\Claude\claude_desktop_config.json` (the installer does it, and `instalar\Claude-MCP.cmd` does only this step; both keep a `.antes-astropilot` backup):

   ```json
   {
     "mcpServers": {
       "sirilastropilot": { "command": "node", "args": ["C:/Users/<your_user>/astro-agente-repo/siril/mcp/dist/sirilastropilot-mcp.mjs"] },
       "setiastropilot": { "command": "node", "args": ["C:/Users/<your_user>/astro-agente-repo/sas/mcp/dist/setiastropilot-mcp.mjs"] }
     }
   }
   ```

   Quit the app completely (also from the tray) and open it again.
3. With the free account, pick **Sonnet** in the app's model picker and use only that one.
4. In the chat, press **+**, pick the program's connector and add `SKILL.md` to load the guide. Then ask for the step you want with the program open and the bridge running.

> **The free quota is small and can run out halfway through a processing session**: every step sends measurements and thumbnails, and a full session uses many messages. When it runs out you have to wait a few hours. To work without interruptions, carry on with [Gemini](#gemini-free-with-a-key) (free with a key, less reliable) or [local Qwen](#local-with-ollama) if your graphics card can take it, or move to a subscription.

### Claude Code

1. Install [Claude Code](https://claude.com/claude-code) and sign in (Pro/Max subscription or API key).
2. **Siril/SASpro chats**: model *Claude (CLI)*. It can also be used from a terminal with the MCP (see `siril/README.md` and `sas/README.md`).

### Codex

1. `npm install -g @openai/codex`, then `codex login`.
2. **Siril/SASpro chats**: model *Codex (CLI)*. It can also be used from a terminal with the MCP (see `siril/README.md` and `sas/README.md`).

### Local with Ollama

1. Install [Ollama](https://ollama.com) and pull a model, e.g. `ollama pull qwen3:32b`.
2. **Siril/SASpro chats**: your Ollama models show up in the list.

### Gemini (free, with a key)

1. Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) with your Google account, no card needed. **Do not share it or paste it into chats.**
2. **Siril and SASpro chats**: choose *Gemini Flash-Lite (API gratis, rápido)* and press **Key…** to paste it. It is stored only on your PC, as the user environment variable `GEMINI_API_KEY`.
3. **Flash-Lite** answers in seconds. **Flash** reasons somewhat better, but on the free tier it can take minutes per answer. If Google retires a model, the chats switch on their own to the one the API suggests.

To create the variable by hand: Start > "environment variables" > *Edit environment variables for your account* > **New**, with the name `GEMINI_API_KEY` and your key as the value.

### OpenRouter and Groq (free, with a key)

1. Get the key at [openrouter.ai/keys](https://openrouter.ai/keys) or [console.groq.com/keys](https://console.groq.com/keys).
2. **Siril and SASpro chats**: choose *OpenRouter (API)* or *Groq (API)* and press **Key…**. It is stored in `OPENROUTER_API_KEY` or `GROQ_API_KEY`.
3. Change the model with the `OPENROUTER_MODELO` or `GROQ_MODELO` variable, and for Gemini with `GEMINI_MODELO`. These models do not see the previews: they work from the measurements only.

## Loading the guide in your agent

The Siril and SASpro chats load it on their own. If you use the MCP from another client:

1. The entry point is `guia/SKILL.md` (common core of rules and index, ~4,000 tokens; skill `astro-procesado`) together with the start-up section of the program's annex (Annex I for Siril, Annex K for SASpro); the rest is read step by step.
   - Claude: the `guia/` folder as a *skill*.
   - ChatGPT or another MCP client: [`guia/envolturas/chatgpt.md`](guia/envolturas/chatgpt.md).
   - Local model (Ollama): [`guia/envolturas/local.md`](guia/envolturas/local.md).
2. Copy `guia/perfil-ejemplo.md` to `guia/perfil.md` and fill it in with your equipment, your sky, your paths and your preferences. That file is excluded from Git.

## Known limitations

- The guide has been tested with an OSC camera (IMX571) and several filters (no filter, tri-band and dual band Hα/OIII, SII/OIII and SII/Hβ) and with a **monochrome camera and narrowband filters**: the Tarantula Nebula (KAF-11000 with a filter wheel, LRGB + 7–8.5 nm Hα, OIII and SII, SHO with stars from the RGB). For other equipment, its values are starting points.

## ⚠️ Security

The Siril and SASpro bridges do not run arbitrary code: they listen only on `127.0.0.1`, and each request carries a token (`~/.sirilastropilot/token` or `~/.setiastropilot/token`) and only the name of a whitelisted tool with its parameters. **No model writes or runs code.** Even so:

- do not share or sync the `~/.sirilastropilot` and `~/.setiastropilot` folders with cloud services;
- review what the AI does, especially before saving or overwriting files.

## How to contribute

What helps most right now is **data and results from other equipment, skies and object types**; no programming needed:

- **Test cases**: masters or crops of little-tested object types, with equipment, filter and camera.
- **Bugs** with the chat or console log.
- **Comparisons** of your manual processing against the assistant's, to calibrate thresholds.
- **Tests** with other AI models, GPUs, systems or smart telescopes.
- **Guide improvements** by *pull request*: always rules by **object type**, never for a specific object.

Open an [*issue*](https://github.com/Az0te/astro-agente-repo/issues/new/choose) with the matching template, or share ideas and results in [*Discussions*](https://github.com/Az0te/astro-agente-repo/discussions). Large files are better shared with a Drive or WeTransfer link. All the details are in [`CONTRIBUTING.md`](CONTRIBUTING.md#how-to-contribute). Contributions in English are welcome.

## Credits

- **Alain Escaffre**, [pixinsight-mcp](https://github.com/aescaffre/pixinsight-mcp) (MIT): design of the project's first bridge (withdrawn) and many ideas in the guide (quality gates, object taxonomy).
- **Jeff Henry**, [NOVA](https://github.com/measurethepixels/nova) (MIT): articles with measured evidence cited in the guide.
- The other sources are in [`guia/FUENTES.md`](guia/FUENTES.md).
- Project developed in collaboration with Claude (Anthropic) from real processing sessions, reviewed and tested by the author.

## Licences

- Code (`siril/`, `sas/`): **MIT**. Copyright (c) 2026 Rafael Vidal. See [`LICENSE`](LICENSE).
- Guide (`guia/`): **CC BY-SA 4.0**. See [`guia/LICENSE.md`](guia/LICENSE.md).

PixInsight is a trademark of Pleiades Astrophoto S.L. Claude is a trademark of Anthropic. This is an independent project, not affiliated with or endorsed by either company.

## Author

Rafael Vidal ([@Az0te](https://github.com/Az0te))
