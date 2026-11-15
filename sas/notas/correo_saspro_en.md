Subject: SASpro 1.24.2.post2 — scripting it from an AI agent: a few issues and requests

Hi Franklin,

My name is Rafael, an amateur astrophotographer [from <city/country>]. I image deep-sky objects and process them in
PixInsight, Siril and, more and more, Seti Astro Suite Pro.

**The project.** I have been building an open project (MIT licence) in which an AI agent processes
astrophotos step by step inside the programs I already use: https://github.com/Az0te/astro-agente-repo

- A written **processing guide** (from object analysis to the final export: gradients, colour calibration, star
  separation, noise, stretching, narrowband palettes, HDR, quality checks), shared by the three programs.
- One **bridge per program**: PiAstroPilot for PixInsight, SirilAstroPilot for Siril and **SetiAstroPilot for SASpro**.
  SetiAstroPilot is a SASpro script that opens a small local server and exposes ~45 "tools" (gradient, stretch, noise,
  stars, palettes, plate solving, multi-master alignment…) to an AI model through MCP. The model can be Claude or a
  local model (Qwen on Ollama). There is also a chat window inside SASpro.
- The agent never applies a step blindly: each tool **compares several methods** (e.g. ABE vs. GraXpert, several
  stretches or Cosmic Clarity strengths), measures them with objective metrics (sky level, noise, detail kept, clipping,
  colour cast, texture by scale) and recommends one; the image only changes when a candidate is applied. Everything
  is faithful to the data — no generated detail.
- Recent test: IC 1396 with four masters (RGB + three dual-band filters), processed the same way in PixInsight, Siril
  and SASpro and compared with the same measurements. SASpro got very close to the PixInsight result, using Cosmic
  Clarity, StarNet, the stretch functions and SASpro's own tools.

Driving SASpro headless through `ScriptContext` works remarkably well — thank you for making it scriptable. Along the
way I found the issues below. Each has steps, expected vs. actual and, where I could find it, the likely cause (code
references are to `main` on GitHub). I'm happy to test fixes or share the scripts.

**Environment:** SASpro 1.24.2.post2 (Windows installer), Windows 11 Pro, AI tools on DirectML. Data: 32-bit XISF
one-shot-colour masters (6248 × 4176), stacked in PixInsight WBPP.

---

1. `ScriptContext.base_document()` raises TypeError

Steps: launch a script with no active subwindow and call `ctx.base_document()`.
Expected: the base document (or None).
Actual: `TypeError: ScriptContext.active_document() got an unexpected keyword argument 'fallback_to_base'`
Cause: `base_document()` ends with `return self.active_document(fallback_to_base=False)`, but `active_document` is
defined as `def active_document(self):`.
Fix: `return self.active_document()`, or add `fallback_to_base=True` to `active_document`'s signature.

2. Headless `stat_stretch` misses its target median (almost black at 0.2–0.3, overshoot elsewhere)

Steps: on a dark linear starless image (median ≈ 0.0006 after Background Neutralization), run
`ctx.run_command("stat_stretch", {"target_median": T, "linked": True})`.
Expected: result median ≈ T.
Actual (M31 starless): T 0.15 → 0.149; 0.20 → 0.00008; 0.25 → 0.0006 (63 % of pixels at 0); 0.30 → 0.00006.
On an IC 1396 layer it overshot instead: 0.15 → 0.245. Reproducible after undo/retry; history entry
"Statistical Stretch (target=0.25, linked, norm, bpσ=5.00)".
Likely cause: the headless wrapper `_apply_stat_stretch_preset_to_doc` (arguments passed: normalize / curves / HDR /
black point). Calling `imageops.stretch.stretch_color_image(img, T, linked=True, normalize=False, apply_curves=False,
blackpoint_sigma=5)` directly reaches the target (0.248 for 0.25).

3. Headless `wavescale_hdr` never returns

Steps: `ctx.run_command("wavescale_hdr", {...})` from a script.
Expected: applies and returns. Actual: never returns (0 % CPU for 30+ min; SASpro had to be killed).
Cause: `run_wavescale_hdr_via_preset` calls `dlg.exec()`; `_apply_to_doc` ends with "Dialog stays open so user can
apply to other images" and never calls `accept()`/`done()`, and the dialog has `WA_DontShowOnScreen`, so `exec()`
blocks forever (`_clear_wavescale_flags` never runs).
Fix: in headless mode, `self.accept()` (or `done(0)`) at the end of `_apply_to_doc`.
Workaround: `wavescale_hdr.compute_wavescale_hdr(...)` (pure numpy). `wavescale_dark_enhance` may have the same pattern.

4. Headless `cosmic_clarity` waits forever when the AI runtime is missing

Steps: run `cosmic_clarity` from a script without PyTorch in `%LOCALAPPDATA%\SASpro\runtime\py312\venv`, or after
installing it while SASpro is open.
Expected: an error the script can catch. Actual: never returns; the only hint is "GPU acceleration runtime is not
installed or is incomplete" in the System Log. After a restart with PyTorch it works fine (DirectML).

5. FITS saved from a script are written top-down (open flipped elsewhere)

Steps: `ctx.save_image(img, "out.fits", original_format="fits", ...)`, open in Siril / PixInsight / astropy.
Expected: same orientation as in SASpro. Actual: vertically flipped — rows in screen order, while FITS is bottom-up;
an embedded WCS no longer matches the pixels. (GUI "Save As" not checked.)

6. Saving an open document as XISF from a script drops the plate solution

Steps: for a plate-solved document, `ctx.save_image(doc.image, "out.xisf", original_format="xisf",
original_header=meta["fits_header"], image_meta=meta["xisf_meta"])`.
Expected: the WCS shown in SASpro is kept. Actual: original XISF keywords written, WCS lost; it only survives if
`meta["wcs_header"]` is merged into `original_header` and `image_meta` is omitted.
Request: a `ctx.save_document(doc, path)` that behaves like "Save As".

7. Plate solve: a decimal RA seed ≤ 24 looks ambiguous (read as hours)

Steps: headless plate solve, `seed_mode="manual"`, decimal RA from the FITS header (degrees, e.g. 10.68 for M31).
Expected: degrees, as in FITS `RA`/`CRVAL1`. Actual: the solve failed as if the value had been read as hours;
passing sexagesimal text ("00h42m44s", "+41d16m09s") works. Request: document the unit or accept `ra_deg`/`ra_hours`.

8. Minor

- `remove_green` with `preserve_lightness=True` raises R and B instead of lowering G (M31 sky: G +4 % → G −3.5 %,
  magenta). Maybe intended, but it isn't classic SCNR.
- Python package metadata reports 1.23.2 on a 1.24.2.post2 install (`importlib.metadata.version`).
- `ScriptContext` can't close a document (scripts that open many files accumulate windows).
- ABE normalises its output to max 1 (× 0.998 on M31): not a bug, but it rescales the whole image slightly.

Feature requests (scripting)

- SFCC headless: `sfcc.py` has the building blocks but no headless entry point / command.
- Halo-B-Gon: a command (or headless entry point) to call it from scripts.
- Stacking Suite headless: register by stars and stack from a script (`star_align` only appears as an alias), so a
  whole workflow from subframes can be automated.

Thanks again for SASpro and for all the work you put into it. If any of this is useful, I'm glad to help test.

Best regards,
Rafael
[GitHub: Az0te]
