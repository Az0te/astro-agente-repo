# Seti Astro Suite Pro 1.24.2.post2 — scripting issues and a few requests

Hi,

First, thanks for SASpro. I have been driving it from Python scripts (`ScriptContext`: `ctx.run_command`,
`ctx.save_image`, …) to automate a processing workflow, and found the issues below. Each one has steps, expected vs.
actual behaviour and, where I could find it, the likely cause. Code references are to the `main` branch on GitHub.
Happy to test fixes.

**Environment:** SASpro 1.24.2.post2 (Windows installer), Windows 11 Pro, AI tools on DirectML. Data: 32-bit XISF
one-shot-colour masters (6248 × 4176), stacked in PixInsight WBPP.

---

## 1. `ScriptContext.base_document()` raises TypeError

**Steps:** launch a script with no active subwindow and call `ctx.base_document()`.
**Expected:** the base document (or `None`).
**Actual:**
```
TypeError: ScriptContext.active_document() got an unexpected keyword argument 'fallback_to_base'
```
**Cause:** `base_document()` ends with `return self.active_document(fallback_to_base=False)`, but `active_document`
is defined as `def active_document(self):`.
**Fix:** `return self.active_document()`, or add `fallback_to_base=True` to `active_document`'s signature.

---

## 2. Headless `stat_stretch` misses its target median (almost black at 0.2–0.3, overshoot elsewhere)

**Steps:** on a dark linear starless image (median ≈ 0.0006 after Background Neutralization), run
`ctx.run_command("stat_stretch", {"target_median": T, "linked": True})`.
**Expected:** result median ≈ T.
**Actual (M31 starless):**

| target_median | result median (command) | `stretch_color_image` called directly |
|---|---|---|
| 0.15 | 0.149 | 0.149 |
| 0.20 | 0.00008 | — |
| 0.25 | 0.0006 (63 % of pixels at 0) | **0.248** |
| 0.30 | 0.00006 | — |

On another image (IC 1396 layer) the same command overshot instead: target 0.15 → median 0.245.
Reproducible after undo/retry. The history entry reads "Statistical Stretch (target=0.25, linked, norm, bpσ=5.00)".
**Likely cause:** the headless wrapper (`_apply_stat_stretch_preset_to_doc`) and the arguments it passes
(normalize / curves / HDR / black point). Calling `imageops.stretch.stretch_color_image(img, T, linked=True,
normalize=False, apply_curves=False, blackpoint_sigma=5)` directly reaches the target.

---

## 3. Headless `wavescale_hdr` never returns

**Steps:** `ctx.run_command("wavescale_hdr", {...})` from a script.
**Expected:** the command applies and returns.
**Actual:** it never returns; SASpro sat at 0 % CPU for 30+ minutes and had to be killed.
**Cause:** `run_wavescale_hdr_via_preset` calls `dlg._start_preview()` and then `dlg.exec()`. `_on_finished` schedules
`_apply_to_doc`, which ends with `# Dialog stays open so user can apply to other images` and never calls
`accept()`/`done()`. The dialog has `WA_DontShowOnScreen`, so it can't be closed and `exec()` blocks forever
(`_clear_wavescale_flags` never runs).
**Fix:** in headless mode call `self.accept()` (or `done(0)`) at the end of `_apply_to_doc`.
**Workaround:** `wavescale_hdr.compute_wavescale_hdr(rgb, n_scales, compression_factor, mask_gamma)` (pure numpy).
`wavescale_dark_enhance` may follow the same pattern (not checked).

---

## 4. Headless `cosmic_clarity` waits forever when the AI runtime is missing

**Steps:** run `cosmic_clarity` from a script when PyTorch is not installed in the AI runtime
(`%LOCALAPPDATA%\SASpro\runtime\py312\venv`), or after installing it while SASpro is open.
**Expected:** an error the script can catch.
**Actual:** the command never returns; the only hint is "GPU acceleration runtime is not installed or is incomplete"
in the System Log. After restarting SASpro with PyTorch installed it works fine (DirectML).

---

## 5. FITS saved from a script are written top-down (open flipped elsewhere)

**Steps:** `ctx.save_image(img, "out.fits", original_format="fits", ...)`, then open the file in Siril, PixInsight or
astropy.
**Expected:** same orientation as in SASpro.
**Actual:** vertically flipped. Rows are written in screen order (top row first), while the FITS convention is
bottom-up. With an embedded WCS the solution no longer matches the pixels. (Not checked for the GUI "Save As" path.)

---

## 6. Saving an open document as XISF from a script drops the plate solution

**Steps:** for an open, plate-solved document, `meta = doc.metadata`, then
`ctx.save_image(doc.image, "out.xisf", original_format="xisf", original_header=meta["fits_header"],
image_meta=meta["xisf_meta"])`.
**Expected:** the saved file keeps the astrometric solution shown in SASpro.
**Actual:** the original XISF keywords are written and the WCS is lost. It only survives if `meta["wcs_header"]` is
merged into `original_header` and `image_meta` is omitted.
**Request:** a `ctx.save_document(doc, path)` that behaves like "Save As" (header + WCS as in the GUI).

---

## 7. Plate solve: a decimal RA seed ≤ 24 is ambiguous (read as hours)

**Steps:** headless plate solve with `seed_mode="manual"` and a decimal RA taken from the FITS header (degrees, e.g.
`RA = 10.68` for M31).
**Expected:** degrees, as in the FITS `RA`/`CRVAL1` keywords.
**Actual:** values ≤ 24 were taken as hours, so the seed pointed to the wrong place and the solve failed.
**Workaround:** pass the seed as sexagesimal text (`"00h42m44s"`, `"+41d16m09s"`).
**Request:** document the unit, or accept an explicit unit (e.g. `ra_deg` / `ra_hours`).

---

## 8. Minor

- `remove_green` with `preserve_lightness=True` raises R and B instead of lowering G: on M31 the sky went from
  G +4 % to G −3.5 % (magenta). Possibly intended, but it differs from classic SCNR.
- The installed Python package metadata reports **1.23.2** on a 1.24.2.post2 install (`importlib.metadata.version`).
- `ScriptContext` has no way to close a document (scripts that open many files accumulate windows).
- ABE normalises its output to max 1 (× 0.998 on M31): not a bug, but it slightly rescales the whole image, which
  matters when comparing before/after.

---

## Feature requests (scripting)

- **SFCC headless:** `sfcc.py` has the building blocks (photometry, curves) but no headless entry point / command.
- **Halo-B-Gon:** a command (or headless entry point) to call it from scripts.
- **Stacking Suite headless:** a command to register by stars and stack (`star_align` only appears as an alias), so a
  whole workflow from subframes can be scripted.

Thanks again — and thanks for making SASpro scriptable in the first place; it made all of this possible.
