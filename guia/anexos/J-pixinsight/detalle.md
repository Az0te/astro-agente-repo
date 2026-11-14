# Anexo J (PixInsight): detalle de los pasos

[← Anexo J](../J-pixinsight.md) · [← Índice](../../SKILL.md)

Lo propio de PixInsight que acompaña a los ficheros de `detalle/` (que son comunes a todos los programas): procesos, ventanas, parámetros y trampas medidas en PixInsight.

<a id="lineal-09"></a>
## Gradiente (detalle del Paso 9 lineal)

Detalle común: [detalle/lineal-09-correccion-gradiente.md](../../detalle/lineal-09-correccion-gradiente.md). Funciones y cadena: [Paso 9](lineal.md#lineal-09).

**Nombres.** Modelo con base de referencia = MultiscaleGradientCorrection (MGC) con la base MARS; calibración de flujo fotométrico = SPFC; calibración de color = SPCC; astrometría = `resolverAstrometria` (BlindSolver); extracción por muestras manuales = DBE; deconvolución "sólo corregir" = BXT Correct Only; plano robusto = rejilla de medianas restada con PixelMath por canal.

**GraXpert desde PixInsight**

- **Proceso GraXpert de PixInsight** (método por defecto; comprobado en 1.9.6). Crea `GraXpert_sample_free_background_extraction` (corregida, con la astrometría conservada) y `GraXpert_background` (el modelo); ~5 s en 3008×3222. Por defecto usa sample_free con suavizado 1,0, protección de estructuras activada y submuestreo 4.
- La guía no usa el script de PixInsight (Toolbox/Graxpert.js): por dentro sólo guarda la imagen, ejecuta `GraXpert -cli` con `ExternalProcess` y reabre el resultado, siempre con IA.
- `herramientas/graxpert.js` (alternativa: llama al ejecutable por línea de comandos) queda para lo que el proceso no ofrece (RBF, Kriging, Splines con muestras propias) y para el denoise:

```json
{"llamadas": [
  {"funcion": "graxpertBGE", "parametros": {"vista": "<vista>"}}
]}
```

  sample_free, escala 10 por defecto. Crea `GC_GraXpert_<tag>` (corregida) y `GC_GraXpert_<tag>_model` (modelo), con la astrometría del original copiada; devuelve `{corrected, model, seconds, log}`. El ejecutable se busca en las rutas habituales; si no está, definir `var GX_EXE = "ruta"` antes del `eval`. Opciones: `method` (sample_free por defecto, AI, RBF, Kriging, Splines), `scale` (1–10, por defecto 10), `smoothing` 0–1, `correction` (Subtraction o Division), `aiVersion`, `gpu: false`, `prefs`, `extra` (`-sample_free_scale`, `-sample_free_smoothness`, `-sample_free_protect`, `-sample_free_protect_threshold`, `-sample_free_protect_amount`, `-sample_free_simplified`, `-sample_free_degree`, `-sample_free_downsample`), `tag`, `keepFiles`, `maxMinutes`.
- Denoise: `graxpertDenoise("<vista>", {strength: 0.5})`.
- En imágenes grandes GraXpert puede pasar de 45 s: el MCP devuelve un id de trabajo; esperar con `estado(trabajo)` y comprobar las ventanas `GC_GraXpert_*`.

Comparativa del 31 oct 2026, sample_free escala 10 en la misma imagen (masters binados ×2):

| Objeto | `copia_objeto` graxpert.js | `copia_objeto` proceso | Diferencia entre las corregidas |
|---|---|---|---|
| nebulosa oscura | copia 0,8 % (0,13) | copia 0,5 % (0,07) | p95 0,07σ del cielo |
| nebulosa dual band (`master_RGB`) | copia 4,3 % (0,32) | copia 4,1 % (0,31) | p95 0,08σ |

Mismo resultado en la práctica, con el modelo igual o algo más limpio. En nebulosa dual band este master da un 4,3 % con graxpert.js, no el 14 % de la tabla del detalle común: aquella medida se hizo sobre otra versión del master (Anexo C).

**MGC / MARS**

- Parámetros: Gradient scale, Structure separation, Model smoothness, Scale factors R/G/B, Gray filter en mono; en 1.9.6+, `autoScaleFactors` (activado por defecto en `pxMGC` y `gradienteCandidatos`), `edgeCorrection` y `edgeAggressiveness` (2).
- Orden: SPFC → MGC → SPCC; los tres necesitan solución astrométrica (sin ella, parar). Si `resolverAstrometria` conserva una solución previa errónea (BlindSolver la preserva), resolver con `forzar: true`.
- SPFC con los filtros y la QE del perfil; MGC con la base MARS del perfil y `gradientScale` 1024 / 2048 / 4096 en la comparativa. MGC crea `<vista>_MGC_gradient_model` para revisarlo. Probado el 31 oct 2026: SPFC 2,7 s y MGC 5,6 s en 3008×3222.

**Medidas.** `copia_objeto` es `gcStructCopy(base, modelo)` de `herramientas/gradcompare.js`; el protocolo completo lo hace `gradienteCandidatos` (Paso 9).

**A mano en PixInsight (valores de referencia)**

- GraXpert sample_free, escala 10, sustracción, con el modelo de fondo aparte y sin sustituir la imagen. Revisar `GraXpert_background` antes de aceptarlo.
- Si el modelo no convence: sample_free escala 8, o IA (`graxpertBGE` con `{"method": "AI", "tag": "ai"}`). Renombrar las ventanas que crea cada variante antes de lanzar la siguiente.
- DBE: tolerancia ~2,0, shadows relaxation ~6, pocas muestras.
- Comprobar `hasAstrometricSolution` al terminar.

<a id="lineal-15"></a>
## Ruido de la starless (detalle del Paso 15 lineal)

Detalle común: [detalle/lineal-15-denoise-mldenoise.md](../../detalle/lineal-15-denoise-mldenoise.md). Funciones: [Paso 15](lineal.md#lineal-15).

**Nombres.** Denoise ML = MLDenoise (módulo MachineLearning, PixInsight 1.9.6+); TGV = MultiscaleTGVDenoise (nuevo en 1.9.6); transformada multiescala lineal = MultiscaleLinearTransform.

**Parámetros de MLDenoise (modelo `MLDenoise_v42.xmlm`)**

| Parámetro | Medido |
|---|---|
| `modelPath` | obligatorio: sin modelo `.xmlm` falla con "No model path specified" |
| `amount` | mezcla lineal original/denoised; 1,0 es el mejor (por defecto 0,90) |
| `mask` (máscara integrada) | sin cambio medible en lineal |
| `overlapPercent` 50 + `precision` alta | idéntico a los valores por defecto, el doble de tiempo |
| Segunda pasada | idéntica a la primera |
| Tiempo | ~117 s para 26 MP en el equipo de prueba |

MultiscaleTGVDenoise: ~2 min por canal de 26 MP (como MLDenoise en CPU); con sus valores por defecto (2 escalas) deja tres veces más ruido a 16 px: usar `scales` 8, `strength` 0,6.

**Receta híbrida en PixInsight.** Lo hace `reducirRuido` con `{"metodo": "hibrido", "modelo": "<.xmlm del perfil>"}`: MLDenoise (amount 1,0, sin caché) y NXT (denoise 0,95, denoise_intensity 0,95, detail 0,15, iterations 2) con ids nuevos en cada prueba. Variante sólo ML: reducción con `IntegerResample` (`zoomFactor = -2`, promedio) y vuelta al tamaño con `Resample` (`BicubicSpline`).

**Trampas**

- NoiseXTerminator ejecutado varias veces sobre ventanas con el **mismo id** devolvió el mismo resultado aunque cambiara `denoise`: usar un id nuevo por prueba y fijar también `denoise_intensity`.
- Varios MLDenoise seguidos, 8+ min en una misma petición, acabaron con "Invalid task termination intent" en la consola y PixInsight sin responder: tandas de menos de 1 min y resultados a disco entre medias.

Banco de pruebas reutilizable (scripts `dn_ref.js`, `dn_paso.js`, resultados JSON) en `<objeto>/_proc/denoise_cmp/` del equipo de prueba.

<a id="no-lineal-01"></a>
## Estirado (detalle del Paso 1 no lineal)

Detalle común: [detalle/no-lineal-01-estirado.md](../../detalle/no-lineal-01-estirado.md). Funciones: [Paso 1 no lineal](no-lineal.md#no-lineal-01).

**Nombres.** Transformación de histograma = HistogramTransformation (HT); visualización automática = STF; estirado adaptativo multiescala = MultiscaleAdaptiveStretch (MAS; Aggressiveness, Dynamic range compression, Scale separation); compresión HDR = HDRMultiscaleTransform (HDRMT); estirado enmascarado = MaskedStretch; estirado arcsinh = ArcsinhStretch; recorte por mezcla RGB de GHS = Clip type `RGBBlend`; modo por canal = RGB/K; casilla de la inversa = Inverse.

**GHS a mano en la interfaz de PixInsight.** Con STF desactivado y Real-Time Preview, ampliar el histograma, pulsar en el centro del pico o justo a su izquierda y "Send to SP"; local intensity (b) ≈ 8–8,5 y subir el stretch factor hasta que el pico principal no pase de ~¼ de la altura del gráfico; aplicar y resetear. Segunda pasada: SP sobre la zona a realzar, b ≈ 1–1,5, stretch factor 0,5–1, equilibrando LP/HP.

**Capa de estrellas.** `starStretch` reimplementa el script Star Stretch: la fórmula del detalle común, saturación por tono con ColorSaturation (0,4·s / 0,7·s / 0,4·s) y, si se pide, SCNR del verde.

**Versión.** Desde PixInsight 1.9.4 el script antiguo de GHS no se mantiene: usar el módulo de proceso (GHS 3.2.0 aprovecha la previsualización de 32 bits de PixInsight 1.9.5+). En PixInsight anterior a 1.9.6 las constantes de GHS van con `.prototype` (`pxK` de `procesos.js`). Fuentes: documentación oficial `ghsastro.co.uk/doc/tools/GeneralizedHyperbolicStretch/` y el resumen técnico que pasó el usuario (nov 2026).

<a id="no-lineal-08"></a>
## Estrellas (detalle del Paso 8 no lineal)

Detalle común: [detalle/no-lineal-08-estrellas.md](../../detalle/no-lineal-08-estrellas.md). Funciones: [Paso 8 no lineal](no-lineal.md#no-lineal-08).

**Nombres.** Separador de estrellas = StarXTerminator (SXT); fondo de la capa a cero = PixelMath `iif($T < 0.005, 0, $T)`; erosión/umbral morfológico = MorphologicalTransformation; perfiles y centroides de estrellas = DynamicPSF.
