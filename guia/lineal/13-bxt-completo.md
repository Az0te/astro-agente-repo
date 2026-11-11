# Paso 13: BlurX completo

[← Índice](../SKILL.md) · Anterior: [Paso 12: SPCC](12-spcc.md) · Siguiente: [Paso 14: Reducción de ruido suave (opcional)](14-noisex-suave.md)

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

**PSF manual.** "Automatic PSF off, diámetro = FWHM medido" (`auto_nonstellar_psf = false`, `nonstellar_diameter` = FWHM medido): campos con pocas estrellas, nebulosa que llena el campo o deconvolución de una starless. Un valor aproximado basta."

**Núcleos saturados.** "BXT puede dejarlos casi blancos. En estrellas muy brillantes, pasar BXT sobre la HDR (larga + corta) o enmascarar los núcleos saturados." Pasa también en núcleos de galaxia en imágenes de color (no en mono): la deconvolución crea píxeles cerca de 1,0 que al estirar queman el entorno y le quitan color y detalle (astroimagetw). Control: píxeles > 0,98 en el núcleo antes y después; si suben, máscara sobre lo saturado y repetir.

**Color entero, no sólo la luminancia.** La deconvolución por IA encoge las estrellas: si sólo se aplica a la L, las estrellas de color quedan mayores y salen anillos de color al combinar. En color, aplicarla a la imagen RGB y extraer la L después; en mono, a la L y a los canales de color a la vez.

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/lineal.md#lineal-13); en Siril, [Anexo I](../anexos/I-siril.md).

**Control.** "Gusanos: si BXT los crea (no estelar alto), NXT los acentúa: bajar BXT, no subir NXT." Ringing = 0; textura no plástica; FWHM de estrellas baja respecto al original (y la excentricidad no sube); detalle nuevo real, no inventado (si hay duda, comparar con una imagen de referencia de mayor resolución del mismo campo); sin franjas de color (mala alineación de canales). Los valores se eligen con la rejilla de abajo, no a ojo.

**Rejilla de variantes con medidas** (BXT aquí; NXT en el Paso 15)

1. Recorte representativo de ~1500 px con objeto débil, fondo y alguna estrella brillante (más rápido que la imagen entera y por debajo del corte de 60 s).
2. BXT con nonstellar 0,25 / 0,45 / 0,65 (estrellas fijo 0,25–0,30). Medir FWHM mediano de estrellas, ringing (perfil radial de la estrella más brillante, cambios de signo > 0,01), gusanos al 100 % y contraste en cajas del objeto.
3. Plancha de recortes al 100 % con la misma visualización y CSV de métricas en `<versión>/tests/`; elegir la ganadora y anotarla en el dossier y en la tabla.
4. Aplicar la ganadora a la imagen entera (si devuelve id de trabajo, esperar con la herramienta de estado).

| Objeto | BXT CO | BXT stars / nonstellar | NXT denoise / detail / iter / separación | Notas |
|---|---|---|---|---|
| nebulosa de emisión y reflexión (previo) | no | ? / ? (halos 0,00) | 0,5–0,8 + 0,75 + 0,30 | sin rejilla |
| nebulosa oscura (previo) | no | sin registro | croma 0,90 / lum 0,40 / det 0,25 | 0,75 por igual dio plástico |
