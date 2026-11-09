# PiAstroPilot Lite (PixInsight script)

PiAstroPilot Lite is the easiest way to use the assistant: a PixInsight **script**. It is not a module or a DLL, so **there is nothing to build or sign**. It opens a chat window; the model proposes which guide functions to use and with which parameters, and you decide whether they run. **The model never writes code**: it only asks for functions in the manifest (`guia/herramientas/manifiesto.json`), and PiAstroPilot Lite checks each call before running it.

*Español: ver [README.md](README.md).*

## Requirements

- [PixInsight](https://pixinsight.com) 1.9.6 or later. Tested on Windows 10/11. On **macOS and Linux** everything should work except parts of the voice features (not tested yet): on macOS it reads aloud with `say` and dictation is opened by hand (press the Fn key twice); on Linux it reads with `spd-say` if installed and there is no dictation.
- This repository downloaded (the guide must be in `guia/`, next to `piastropilot/`).
- A model, one of these:
  - **Ollama** (local, free, no internet): [ollama.com](https://ollama.com) with a model pulled, for example `ollama pull qwen3:32b`. PiAstroPilot Lite looks for it at `http://localhost:11434`.
  - **Claude Code** (paid, gives the best results): [installed](https://docs.anthropic.com/en/docs/claude-code) and signed in (`claude` in a terminal).
  - **Codex** (OpenAI): `npm install -g @openai/codex` and `codex login`.
- For astrometry (`resolverAstrometria`): a Gaia index configured in the Gaia process preferences.
- Optional, but the guide uses them a lot: BlurXTerminator, NoiseXTerminator, StarXTerminator and GraXpert (each with its own licence).

No Node.js or MCP server is needed: the script loads the guide inside PixInsight itself.

## Install

1. Download the repository (**Code > Download ZIP** on GitHub, or `git clone`) and unzip it, for example in `C:\Users\<your_user>\astro-agente-repo`.
2. Optional, to have it in the menu: in PixInsight, **Script > Feature Scripts…**, **Add** button, choose the `piastropilot\script` folder and press **Done**. From then on it is under **Script > PiAstroPilot > PiAstroPilotLite**.
3. Optional: copy `guia/perfil-ejemplo.md` to `guia/perfil.md` and fill it in with your equipment, sky and paths (for example, the MLDenoise `.xmlm` model). It is not uploaded to GitHub.

## Use

1. Open your image in PixInsight.
2. Launch **Script > PiAstroPilot > PiAstroPilotLite** (or **Script > Execute Script File…** and choose `piastropilot/script/PiAstroPilotLite.js`).
3. In **Settings > Language** choose **English**: the window switches at once and the model answers in English. The setting is remembered.
4. In the **Model** tab choose the provider (Ollama, Claude Code or Codex) and the model. In **Settings** check the Ollama URL, the `claude`/`codex` paths and the guide folder (detected automatically).
5. In **Prompt** type what you want, for example «analyse the image». When the model proposes calls, review them and press **Run calls**: nothing runs until you press it. The «Next step» lines in the chat are links: click them to do that step.

## What it does

- **HTML chat** with tables, colours and links, like the module. Call results appear as cards («Pass / Fail», measurements, folded JSON) and the model interprets them and recommends the next step.
- **Guide functions** already loaded: analysis, astrometry (BlindSolver engine), gradient, noise, stretching, local contrast, cores, saturation, stars, export… Where there are several methods, it **compares candidates** and keeps the best measured one (gradient: GraXpert, GradientCorrection, MGC, polynomial; noise: NXT, MLDenoise, MultiscaleTGVDenoise and the ML + NXT hybrid; stretch: GHS, MAS, Arcsinh; contrast: LHE, HDRMT, DarkStructureEnhance; core: HDRMT, GradientHDRCompression). Each candidate shows its **thumbnail** in the chat (for the gradient, with the removed model next to it).
- On images larger than 8 MP, noise, stretch and contrast **compare on a 2000 px crop** and apply only the winner to the full image. MLDenoise only uses the GPU with NVIDIA; on AMD or Intel it runs on the CPU (~13 s per megapixel).
- **PDF dossier** and **.md report**: the first saves the conversation with its cards and thumbnails as a PDF (light theme, for printing); the second, a Markdown file with the functions used, the errors with the calls that caused them and the conversation, to collect processing sessions and improve the guide. They are saved in the dossier folder set in Settings (default `~/PiAstroPilotLite/dossiers`).
- **Tokens**: each reply shows its usage (and the cost with Claude) and the conversation total is shown above the prompt.
- **Internet** («Internet» checkbox): object card (type, expected emission, bright stars that will cause trouble) from SIMBAD and Wikipedia, and catalog images. With Claude, web search too. Unchecked, nothing goes out to the internet.
- **Voice**: «Dictate» opens Windows dictation (Win + H) in the prompt and «Read aloud» reads the replies with the Windows voice.
- **N weights**: with Claude or Codex on «auto (pesos N)», it picks a cheaper model (sonnet) or a more capable one (opus), like the module.
- **Language**: Spanish or English (Settings > Language), applied at once to the window and to the model's replies.
- Settings saved in PixInsight (keys `PiAstroPilotLite/...`).

The window does not freeze while waiting for the model, and the request can be cancelled. It is a modal window: while it is open the rest of PixInsight cannot be used (the PiAstroPilot module does allow it).

The processing guide itself (`guia/`) is written in Spanish. In English mode the model translates what it takes from it; function names and result fields stay in Spanish.

## Common problems

- **«No encuentro … guia»** (guide not found): in Settings, set the repository's `guia` folder.
- **Ollama does not answer**: open Ollama (or `ollama serve`) and press «Read Ollama models» in the Model tab.
- **Astrometry: «No astrometric index file is available»**: configure the Gaia index in the Gaia process preferences.
- **Errors**: copy what appears in the PixInsight console and open an [*issue*](https://github.com/Az0te/astro-agente-repo/issues/new/choose).

## For developers

Automated test (opens another PixInsight instance without touching yours):

```
PixInsight.exe -n --automation-mode --no-focus-stealing -r=<path>/PiAstroPilotLite.js,--prueba,<output.json>[,claude|codex] --force-exit
```

It opens and closes the dialog simulating a question, a link click and a language switch, loads the guide, checks the BlindSolver engine, the voice and the internet block, asks Ollama, runs test calls and checks that anything outside the manifest is rejected. The result goes to `<output.json>`.

PJSR preprocessor traps: do not write slash-asterisk, asterisk-slash or a double slash together inside strings or regexes (they are taken as comments); with `#engine v8` do not include `<pjsr/Sizer.jsh>` and inherit from `Dialog` with `class … extends`; `.js` files without BOM. New window texts are written in Spanish; add their English translation to `PL_TR` in `PiAstroPilotLite.js`.
