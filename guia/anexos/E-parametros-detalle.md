# Anexo E: Parámetros y detalles complementarios

[← Índice](../SKILL.md) · Anterior: [Anexo D: Flujos por tipo de objeto](D-flujos-por-tipo-objeto.md) · Siguiente: [Anexo F: Anti-patrones y criterio de parada](F-anti-patrones.md)

Material que no encaja en un paso concreto del flujo. Se consulta cuando el paso correspondiente se queda corto.

**Muestreo y escala de trabajo**. "Muestreo óptimo ≈ FWHM/2. Con un seeing típico de ciudad (FWHM ~2,5–3,5") 1,2–1,7"/px está bien muestreado; 0,76"/px (drizzle 2x) es sobremuestreo (más ruido por píxel, BXT eficaz, NXT algo más fuerte). Elegir la escala común por la cámara de mejor resolución y no subir de escala datos que no tienen ese detalle."

**Fidelidad de las proporciones entre rayas**. "Las proporciones Hα/OIII/SII son información física (orientativo: regiones HII Hα/OIII > 2–5, SII/Hα < 0,3; planetarias Hα/OIII < 1; restos de supernova SII/Hα > 0,5). Estirar cada canal por separado, saturar o reducir ruido sólo en un canal las cambia. Para mantenerse 'fiel a los datos': combinar en lineal o aplicar el mismo estirado a todos los canales; si se usa un mapeo estético, decirlo en el dossier."
OIII débil: "confirmar cualquier estructura antes de realzarla (aparece en varias sesiones independientes, es coherente con la morfología Hα, no es grano de ruido, sobrevive a un estirado inverso o a la imagen diferencia, tiene sentido físico). Gradiente bien corregido antes de interpretar; denoise moderado; restar continuo si procede. 'Revelar, no inventar'."

**Compresión de altas luces y rodilla**. "Comprimir altas luces (K: 0,9→0,875, 1→0,955) y comprobar % saturado. Dejar margen antes de HDRMT (aescaffre: máximo ~0,93–0,97): HDRMT no recupera núcleos ya recortados."
Rodilla sobre el máximo, para que la suma no sature el rojo: "`m = max(r,g,b)`; si m > k, escalar los tres por `(k + (1−k)(1−exp(−(m−k)/(1−k))))/m`, k = 0,72", que conserva el tono; "en IC63 v4 bajó a 0,06 %" los píxeles ≥ 0,98.

**Azules y saturación selectiva por tono**. "`Ldet = max(L − L_suave(σ≈300 px), 0)`; azulidad `bl = clip((B−R)/max*4)`; sumar Ldet·(0,8 neutro / R 0,4, G 0,72, B 1,25 en zonas azules). Saturación selectiva por tono (aescaffre `hue_boost`): `lum + f·(canal − lum)` con f distinto para azules (~1,3), rosas (~1,25) y neutros/dorados (1,0), mejor que una curva global."

**Nebulosidad de fondo en Hα**. "Hα de gran escala (bin 4 + gauss σ 8 + reescalar) sumado ~0,8 en R, 0,14 G, 0,34 B; levantar tonos bajos con curva sin mover el negro."

**Dominante verde en las esquinas tras SPCC+MGC**. "G/R hasta 1,67 en IC63: la corrección de NOVA (sección Blue bloat) con máscara de cielo `clip((med + 5σ − L_s)/(3,5σ))` sobre los canales suavizados a ~48 px y amount 0,85 funcionó sin tocar la nebulosa."

**Flujos de referencia LRGB** (los nombres de scripts son los de los flujos originales; en esta guía cada uno se hace con su equivalente desde el watcher, Anexo A.9)

| Flujo | Secuencia |
|---|---|
| OSC5 (RGB + dual band Hα-OIII) | Alinear y recortar todos los stacks. RGB: Gradient Correction → BXT Correct Only → Plate Solve → SPCC → BXT → SXT → estrellas aparte; starless → NXT. HOO: Gradient Correction → BXT → SXT → NXT → DBXtract (o su emulación) → MAS sobre Hα y OIII por separado. RGB starless → MAS; estrellas → Star Stretch. Mezcla no lineal con CombineRGBAndNarrowband → NXT → Boost → Screen Stars |
| RGB2 (Bernhard) | RGB → Gradient Correction → Background Neutralization → BXT Correct Only → Plate Solve → SPCC → BXT → SXT (estrellas lineales aparte) → NXT → GHS/MAS. L → Gradient Correction → BXT completo → SXT → NXT → GHS/MAS. Combine LRGB en **no lineal** (starless) → NXT → Boost (curvas) → Screen Stars con las estrellas RGB (Star Stretch) |
| HRGB1 | RGB: Gradient Correction → Background Neutralization → BXT Correct Only → Plate Solve → SPCC → BXT → SXT. Hα: Gradient Correction → BXT → SXT → NXT → GHS. Starless RGB → NXT → GHS. "Combine Ha with RGB" → RHaGB → (LRGB opcional con Hα como L) → NXT → Boost → Screen Stars |
| OSC2 (sólo dual band) | HOO → Gradient Correction → BXT → SXT → NXT → DBXtract → NXT + MAS por canal → HOO Mix (Perfect Palette Picker) → NXT → Narrowband Normalization → Boost → Screen Stars. Estrellas NB → **NB to RGB Star Combination + Star Stretch** (SETI Astro) |
| HOORGB (HOO3) | Combinación por canal Hα+R, OIII+G, OIII+B (script Mix SHORGB / CombineRGBAndNarrowband) → Narrowband Normalization → NXT → Boost → Screen Stars RGB |
| SHO5A | Mezcla SHO no lineal (Mix SHO / Perfect Palette Picker) + luminancia sintética de S,H,O ("Mix L(SHO)") + Combine LRGB → Narrowband Normalization → NXT → Boost → Screen Stars RGB |

**Combinar varios masters de la misma raya** (DBXtract). Modos: "Adaptive with scaling (normalizar cada uno por media y sigma y combinar en escala común; cuando difieren fondo, exposición o calibración), SNR-weighted average, Average, Minimum (rechaza gradientes y ruido residual) y Maximum (realza lo que sólo está en uno)." La fórmula de color por defecto de DBXtract reconstruye el RGB a partir de las rayas con los mismos coeficientes de QE; "se puede editar para HOO/SHO".

**AutoPalette Studio: normalización**. "None (defecto, canales tal cual); Ha/SII/OIII as reference = LinearFit (rejectHigh 0,92) de los otros canales al de referencia; Auto = puntúa cada canal con (p90 − p25)/(0,01 + σ), penaliza saturación (p98 > 0,94) y fondo alto, y se queda con Hα si su puntuación es ≥ 0,7 de la mejor." Los "Boosted, Advanced (Gold Accent, Structure Lift), Cosmetic Presets y Masks" son retoques estéticos: no usarlos en las previews de elección.

**GHS sin módulo nativo y MaskedStretch**. "GHS no tiene módulo nativo en algunas instalaciones: se puede implementar con PixelMath (`use64BitWorkingImage`, `truncate`); tras cada pasada, volver a medir la mediana (SP adaptativo = mediana actual)." "MaskedStretch clásico: target background 0,08–0,30 (tarda mucho en imágenes grandes)."

**CLAHE**. "Trabaja en 8 bits y su parámetro de rejilla es el número de teselas, no su tamaño."

## Blue bloat y halos azules

- Causas: dispersión o aberración cromática residual en el azul-violeta (refractores), scatter mayor en el canal azul, microlentes; en filtros duales, **reflexiones internas del filtro** (bloqueo fuera de banda < OD4), peores con óptica rápida y con estrellas muy calientes o muy frías. Arreglo óptico: UV/IR-cut delante del dual band, filtros con OD > 4 y antirreflejo en el lado de la cámara.
- Diagnóstico: comparar los canales por separado; si las estrellas son más grandes en el azul, hay blue bloat. SPFC deja `PCL:SPFC:FWHMx/FWHMy` por canal.
- Tratamiento: BXT Correct Only antes de SPCC y, sólo si hace falta, segunda pasada con "Adjust star halos" ≈ −0,30 vigilando el ringing. Desde el preprocesado, debayer con canales separados + registro con surface splines corrige la aberración cromática lateral. Con mono, el foco por filtro (o filtros parafocales) evita gran parte.
- Reducción de estrellas: estirar menos las estrellas. En galaxias, aescaffre la desactiva (crea anillos).

**InterchannelCurves y máscaras de halo.** Halo-B-Gon (script) no se usa: NOVA midió que sin máscara oscurece toda la imagen (gamma global) y que en campos densos dispara el ruido (IC 1805: +129 %).
Método clásico si BXT no basta: "StarMask ajustada a los halos (estirada y suavizada) protegiendo la nebulosa/galaxia; **InterchannelCurves** con canal de referencia *Value* y canal objetivo *Blue*, bajando la curva hasta que el halo azul desaparezca; o MultiscaleLinearTransform en el canal azul atenuando las capas pequeñas bajo la máscara."
Otras máscaras: "`Halo = CanalConHalo − CanalLimpio + med(CanalLimpio)`, suavizada, y restar en el canal afectado"; "halos OIII de filtro: LinearFit del verde (sin halo) al OIII, igualar ruido con NoiseGenerator y clonar suavemente sobre los halos".
Ajustes BXT como diagnóstico: "anillos negros = fuerza estelar/PSF/halos excesivos; núcleos duros = sobrecorrección; textura plástica = no estelar excesivo; franjas de color = mala alineación de canales."

**VeraLux StarComposer (Siril)**. "LogD controla presencia, protección b de estrellas brillantes, Color Grip, Shadow Convergence; Screen o Linear Add."

**Trampas menores de PJSR**, además de las del Anexo A:

- "`ImageWindow.windowById` con un id inexistente no falla: un `w.mask` así aplica el proceso **sin máscara**." Comprobar `.isNull` antes de asignar la máscara.
- Procesos largos (MGC sobre 12k × 8k ≈ 3 min, LHE ≈ 35 s, NXT ≈ 30 s) superan el corte de 60 s del MCP: esperar con `watcher_status`. La memoria llegó a 15 GB: cerrar ventanas grandes.
- `new ImageWindow(w, h, …)` puede fallar con dimensiones leídas de `Image.width`: redondear o pasar números; para máscaras, `floatSample = true`.
- Tras crear una composición con PixelMath, `copyAstrometricSolution` desde el original (o `blindSolve`): SPCC necesita WCS.

- "Abrir un XISF de WBPP puede crear ventanas `crop_mask` extra: cerrarlas (`id.indexOf('crop_mask')>=0`)."
- "StarDetector puede colgarse en algunos campos: para medir estrellas en imágenes procesadas, buscar máximos locales por encima de mediana + 5·MAD en una rejilla, deduplicar a < 20 px y medir semiancho a media altura en 4 direcciones."
- "Contar píxeles en un rango sin crear imagen: PixelMath `n += $T <= max && $T >= min`, símbolos `n = global(+)`, 'Generate output' desactivado; el resultado sale en la consola."
- "`SampleFormatConversion.format` no acepta la constante: para 16 bits crear `new ImageWindow(w, h, 3, 16, false, true, id)` y `image.assign(src)`."
- "Añadir a un fichero = `f.openOrCreate(p); f.seekEnd()` (no hay `openForAppending`)."
- "`IntegerResample` sobre un FITS de 16 bits deja la imagen en enteros: binar a mano en JS (Float32Array) para medir anillos de halo."
- **Constantes de los procesos:** en el watcher v8 están en el constructor (`PixelMath.RGB`, `IntegerResample.Average`, `SCNR.Green`); con `.prototype` dan `undefined` **sin error** y el parámetro queda vacío (comprobado en PixInsight 1.9.6). En el watcher clásico era al revés: `IntegerResample.prototype.Average`. Para código que deba valer en los dos: `C[k] !== undefined ? C[k] : C.prototype[k]`. "El proceso de curvas es `CurvesTransformation` (no `CurvesTransform`)."
- (Watcher clásico) "Desde el watcher, constantes como `SubframeSelector.MeasureSubframes` o `IntegerResample.Average` pueden dar 'invalid argument type': dejar el valor por defecto o mirar `describe_process`."

**Dosieres de IA sobre BXT/NXT**. "De cuatro dosieres sobre BXT/NXT generados con IA que circularon en oct 2026, dos (BXT 'exhaustivo' y NXT 'dosier exhaustivo') coinciden con RC-Astro y se han usado. Los otros dos tienen errores: uno pone SPCC antes de la extracción de gradiente (choca con MGC, cuya cadena es SPFC → MGC → SPCC) y otro inventa un parámetro 'Linear/Non-linear' de NXT, cifras de rendimiento sin fuente y la regla de 'sólo en lineal'. No usarlos como referencia."

**GraXpert no siempre gana**. "En un hilo de AstroBin (jul 2026) no pudo quitar un gradiente alrededor de M31 ni subiendo el suavizado; la recomendación fue MGC o DBE con muestras escogidas. Con objetos que se difuminan en el fondo (M31, nebulosas extensas, polvo) cualquier extractor puede tomar el halo del objeto por fondo y dejar un **anillo oscuro**." Más control en la aplicación independiente: "permite colocar las muestras a mano (útil cuando el objeto llena el campo o hay halos extensos). Exportar 32 bits y volver a PixInsight."
