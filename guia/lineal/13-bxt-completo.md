# Paso 13: BlurX completo

[← Índice](../SKILL.md) · Anterior: [Paso 12: SPCC](12-spcc.md) · Siguiente: [Paso 14: NoiseX suave (opcional)](14-noisex-suave.md)

**Por qué.** Correct Only arregla la óptica; la pasada completa **restaura** detalle que el seeing y la difracción han repartido: devuelve la PSF a su tamaño instrumental. Va **después de SPCC** (para no alterar el color que SPCC acaba de medir) y **antes de SXT** (BXT usa las estrellas como referencia de PSF) y antes de cualquier denoise.

**Valores de partida por objeto**

| Objeto | Sharpen stars | Sharpen nonstellar |
|---|---|---|
| Galaxias | 0,15–0,20 | 0,20–0,35 |
| Nebulosas grandes | 0,25–0,40 | 0,50–0,70 |
| Cúmulos / campo estelar | 0,20–0,30 | 0,00–0,20 |
| SNR bajo | 0,10–0,20 | 0,10–0,25 |

- "Con drizzle 2x (sobremuestreo) tomar el extremo bajo del rango no estelar. Por encima de ~0,8 en datos con ruido aparecen texturas 'crujientes'."
- Ajustes RC-Astro (EXT1): "BXT pasada 2: sharpen stars 0,30, adjust star halos **−0,30**, automatic PSF, sharpen nonstellar 0,50. **Contraste:** aescaffre usa halos 0,00 porque los valores negativos le daban ringing visible antes de SXT, sobre todo en galaxias."
- "El nonstellar 0,90 es para datos bien muestreados o submuestreados: con drizzle 2x (sobremuestreado) mantener ~0,45–0,55 y comprobar 'gusanos' al 100 %."
- "BXT siempre antes de SXT (usa las estrellas como referencia de PSF)."

**PSF manual.** "Automatic PSF off, diámetro = FWHM medido" (`auto_nonstellar_psf = false`, `nonstellar_diameter` = FWHM; SPFC deja `PCL:SPFC:FWHMx/FWHMy`: campos con pocas estrellas, nebulosa que llena el campo o deconvolución de una starless. Un valor aproximado basta."

**Núcleos saturados.** "BXT puede dejarlos casi blancos. En estrellas muy brillantes, pasar BXT sobre la HDR (larga + corta) o enmascarar los núcleos saturados."

**Código**

```javascript
var v = View.viewById("MasterLight");
if (!v || v.isNull) throw new Error("No existe MasterLight");
var BXT = new BlurXTerminator;
// nombres comprobados en PixInsight 1.9.6 (módulo RCAstroSuite)
BXT.correct_only = false;
BXT.auto_nonstellar_psf = true;
BXT.sharpen_stars = 0.30;
BXT.adjust_star_halos = 0.00;   // -0,30 SOLO si hay blue bloat y sin ringing
BXT.sharpen_nonstellar = 0.35;  // galaxia; 0,50-0,70 nebulosa; 0,45-0,55 con drizzle 2x
BXT.overlap = 0.20;
if (!BXT.executeOn(v)) throw new Error("BXT completo falló");
"BXT completo aplicado";
```

**Control.** "Gusanos: si BXT los crea (no estelar alto), NXT los acentúa: bajar BXT, no subir NXT." Ringing = 0; textura no plástica; FWHM de estrellas baja respecto al original; sin franjas de color (mala alineación de canales). Los valores se eligen con la rejilla de abajo, no a ojo.

**Rejilla de variantes con medidas** (BXT aquí; NXT en el Paso 15)

1. Recorte representativo de ~1500 px con objeto débil, fondo y alguna estrella brillante (más rápido que la imagen entera y por debajo del corte de 60 s).
2. BXT con nonstellar 0,25 / 0,45 / 0,65 (estrellas fijo 0,25–0,30). Medir FWHM mediano de estrellas, ringing (perfil radial de la estrella más brillante, cambios de signo > 0,01), gusanos al 100 % y contraste en cajas del objeto.
3. Plancha de recortes al 100 % con el mismo STF y CSV de métricas en `<versión>/tests/`; elegir la ganadora y anotarla en el dossier y en la tabla.
4. Aplicar la ganadora a la imagen entera (si devuelve id de trabajo, esperar con `estado(trabajo)`).

**Rejilla y aplicación en una llamada** (`herramientas/deconvolucion.js`): `bxtCandidatos` hace la rejilla en un recorte de 1500 px (el de más señal extensa) con los valores de la tabla para el tipo de objeto y mide en cada variante el FWHM de las mismas estrellas, el ringing de la más brillante no saturada y, fuera de las estrellas, la textura nueva en el fondo (gusanos) y el detalle en el objeto respecto a BXT con nonstellar 0; recomienda el nonstellar más alto sin ringing ni gusanos. `bxtAplicar` lo aplica a una copia de la imagen entera. En nebulosa dual band (nov 2026): FWHM 4,6 → 4,1 px; el nonstellar 0,25–0,65 sólo añadía un 0,4–1,9 % de detalle, sin gusanos. Recomendado para modelos sin herramientas.

```javascript
eval(File.readTextFile("<ruta de guia>/herramientas/deconvolucion.js"));   // en el nivel superior del script
var r = bxtCandidatos("MasterLight_spcc", { tipo: "nebulosa" });           // "galaxia" | "cumulo" | "snr_bajo"
var a = bxtAplicar("MasterLight_spcc", { nonstellar: r.recomendada.nonstellar, stars: r.recomendada.stars, nuevaVista: "MasterLight_bxt" });
JSON.stringify({ candidatos: r, aplicado: a });
```

| Objeto | BXT CO | BXT stars / nonstellar | NXT denoise / detail / iter / separación | Notas |
|---|---|---|---|---|
| nebulosa de emisión y reflexión (previo) | no | ? / ? (halos 0,00) | 0,5–0,8 + 0,75 + 0,30 | sin rejilla |
| nebulosa oscura (previo) | no | sin registro | croma 0,90 / lum 0,40 / det 0,25 | 0,75 por igual dio plástico |
