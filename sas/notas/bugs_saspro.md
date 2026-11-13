# Borradores de informes de fallos para Seti Astro Suite Pro

Encontrados al probar SetiAstroPilot con SASpro **1.24.2.post2** (Windows 11, instalador) el 13 nov 2026, con un master
de M31 (ASI2600MC, 6248 × 4176, 32 bits, XISF de WBPP). **Borradores**: no se han publicado. Rafael decide si se envían
y dónde (https://github.com/setiastro/setiastrosuitepro/issues). El código citado es de la rama `main` de GitHub.

---

## 1. `ScriptContext.base_document()` lanza TypeError

**ES.** `base_document()` termina con `return self.active_document(fallback_to_base=False)`, pero `active_document`
se define sin argumentos (`def active_document(self):`). Cuando la primera rama no devuelve nada (sin subventana activa,
p. ej. justo después de lanzar un script), la llamada falla:

```
TypeError: ScriptContext.active_document() got an unexpected keyword argument 'fallback_to_base'
```

Arreglo: quitar el argumento (`return self.active_document()`) o añadirlo a `active_document`.

**EN.** `ScriptContext.base_document()` ends with `return self.active_document(fallback_to_base=False)`, but
`active_document(self)` takes no arguments, so scripts calling `base_document()` get the TypeError above whenever the
subwindow branch does not return. Fix: drop the keyword or accept it in `active_document`.

---

## 2. `stat_stretch` sin ventana deja la imagen casi negra con mediana objetivo 0,2–0,3

**ES.** Con `ctx.run_command("stat_stretch", {"target_median": T, "linked": True})` sobre una starless lineal (mediana
≈ 0,0006 tras Background Neutralization):

| target_median | mediana del resultado (comando) | mediana con `stretch_color_image` directa |
|---|---|---|
| 0,15 | 0,149 | 0,149 |
| 0,20 | 0,00008 | — |
| 0,25 | 0,0006 (63 % de píxeles a 0) | **0,248** |
| 0,30 | 0,00006 | — |

Es reproducible (mismo resultado repitiendo y deshaciendo). La función `imageops.stretch.stretch_color_image` con
`linked=True, normalize=False, apply_curves=False, blackpoint_sigma=5` da la mediana pedida, así que el fallo está en el
envoltorio sin ventana (`_apply_stat_stretch_preset_to_doc`) y no en la fórmula: probablemente los argumentos que le
pasa (normalize, curvas, HDR u otra mediana / punto negro). El paso queda en el historial como
«Statistical Stretch (target=0.25, linked, norm, bpσ=5.00)».

**EN.** Headless `stat_stretch` with target_median 0.2–0.3 returns an almost black image (median far *below* the input)
on a dark linear starless image, while 0.15 works and calling `imageops.stretch.stretch_color_image` directly with the
same target gives the right median (0.248 for 0.25). The bug seems to be in `_apply_stat_stretch_preset_to_doc` (the
arguments it passes), not in the stretch kernel. Table above.

---

## 3. `wavescale_hdr` sin ventana no termina nunca

**ES.** `run_wavescale_hdr_via_preset` crea el diálogo, llama a `dlg._start_preview()` y luego a `dlg.exec()`. En modo
sin ventana `_on_finished` hace `QTimer.singleShot(0, self._apply_to_doc)`, pero `_apply_to_doc` termina con
`# Dialog stays open so user can apply to other images` y no llama a `accept()`/`done()`. El diálogo tiene
`WA_DontShowOnScreen`, así que el usuario no puede cerrarlo: `exec()` no vuelve, el script se queda esperando y
`_clear_wavescale_flags` no se ejecuta. En nuestra prueba SASpro estuvo más de 30 min al 0 % de CPU y hubo que cerrarlo.

Arreglo: en modo sin ventana, `self.accept()` (o `done(0)`) al final de `_apply_to_doc`. Mientras tanto, desde un script
se puede llamar a `wavescale_hdr.compute_wavescale_hdr(rgb, n_scales, compression_factor, mask_gamma)` (es numpy puro).
Puede pasar lo mismo con `wavescale_dark_enhance` (no comprobado).

**EN.** Headless `wavescale_hdr` never returns: `_apply_to_doc` keeps the (invisible) dialog open, so `dlg.exec()`
blocks forever. Calling `accept()` at the end of the headless apply would fix it. `wavescale_dark_enhance` may have the
same pattern (not checked).

---

## 4. Cosmic Clarity sin ventana se queda esperando si falta el entorno de IA

**ES.** Sin PyTorch en el entorno de IA (`%LOCALAPPDATA%\SASpro\runtime\py312\venv`), `cosmic_clarity` desde un script
no devuelve nunca: sólo el System Log dice «GPU acceleration runtime is not installed or is incomplete». Lo mismo si
PyTorch se instala con SASpro abierto (hay que reiniciar). Sería mejor que el comando lanzara un error.

**EN.** Headless `cosmic_clarity` hangs (instead of raising) when the AI runtime (torch) is missing or was installed
after SASpro started; the only hint is in the System Log.

---

## 5. Guardar XISF desde un script pierde la astrometría si se usa `image_meta`

**ES.** No es exactamente un fallo, pero sorprende: la cabecera de un documento abierto está en
`metadata["fits_header"]` y la astrometría en `metadata["wcs_header"]`. `ctx.save_image(..., original_format="xisf",
image_meta=metadata["xisf_meta"])` escribe las palabras clave de la XISF original y descarta la solución astrométrica;
sin `image_meta` y con la cabecera más `wcs_header` como `original_header`, se conserva. Estaría bien una forma de
guardar un documento abierto tal cual (como «Guardar como»), con su cabecera y su WCS.

**EN.** Saving an open document from a script loses the WCS unless the caller merges `wcs_header` into the header and
omits `image_meta`. A `ctx.save_document(doc, path)` that behaves like "Save As" would avoid this.

---

## 6. Otros detalles

- `remove_green` con `preserve_lightness=True` sube R y B en vez de bajar G: en M31 el cielo pasó de G +4 % a G −3,5 %
  (magenta). Quizá es lo esperado al conservar la luminosidad, pero no es el SCNR clásico.
- Los metadatos del paquete Python instalado dicen 1.23.2 en una 1.24.2.post2 (`importlib.metadata.version`).
- `ScriptContext` no tiene forma de cerrar un documento.
- ABE normaliza el resultado a máximo 1 (× 0,998 en M31): no es un fallo, pero cambia ligeramente la escala de toda la
  imagen.
