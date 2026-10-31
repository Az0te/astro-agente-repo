# Anexo G: Glosario

[← Índice](../SKILL.md) · Anterior: [Anexo F: Anti-patrones y criterio de parada](F-anti-patrones.md) · Siguiente: [Índice](../SKILL.md)

Términos que la guía usa sin explicar. Las definiciones son de uso común en astrofotografía; los valores concretos están en los pasos, no aquí.

| Término | Qué es |
|---|---|
| **ABE / DBE** | Extracción de fondo automática / dinámica (PixInsight). DBE coloca muestras a mano; nunca sobre nebulosa. |
| **Astrometría / WCS** | Solución que sitúa la imagen en el cielo (RA, Dec, escala, rotación). La necesitan SPCC, SPFC y MGC. |
| **Bayer / CFA / debayer** | Mosaico de filtros sobre el sensor (OSC) y su reconstrucción a color por interpolación (VNG en esta guía). |
| **BXT** | BlurXTerminator (RC-Astro): deconvolución por IA. "Correct Only" corrige la óptica sin tocar lo no estelar. |
| **CFA flat scaling** | Ajuste de WBPP que conserva la escala relativa de cada canal Bayer en los flats. |
| **DBXtract** | Script de Raúl Hussein que separa Hα y OIII de un OSC dual band con un modelo lineal `C = A·L + P`; la guía usa su emulación con PixelMath. |
| **Drizzle** | Remuestreo que reparte cada píxel de entrada entre varios de salida; recomendado en OSC aunque no haya submuestreo. |
| **DRC** | Dynamic Range Compression de MAS: protege luces durante el estirado. No es HDRMT. |
| **Estirado / stretch** | Pasar de lineal (señal ∝ flujo) a rango de pantalla. Irreversible en la práctica. |
| **Excentricidad** | Desviación de la forma de una estrella respecto a un círculo; mide el error de guiado/óptica. |
| **FWHM** | Anchura a media altura de la PSF; en estrellas, mide el seeing y el enfoque. |
| **GHS** | GeneralizedHyperbolicStretch: estirado con parámetros D, b, SP, LP, HP. |
| **HDRMT** | HDRMultiscaleTransform: comprime rango dinámico **en no lineal**. No confundir con HDRComposition. |
| **HF / LF** | Alta y baja frecuencia. En NXT, el moteado de fondo es LF; el detalle fino, HF. |
| **ICC / sRGB** | Perfil de color de salida; sin conversión a sRGB los colores cambian fuera de PixInsight. |
| **IFN** | Integrated Flux Nebula: polvo galáctico muy débil; señal de bajo contraste que cualquier extractor agresivo se come. |
| **k (continuo)** | Coeficiente de la sustracción de continuo: cuánto se resta de la banda ancha a la estrecha. Se mide por fotometría de estrellas. |
| **LHE** | LocalHistogramEqualization: contraste local. Necesita máscara y radios moderados. |
| **Lineal** | Imagen sin estirar (mediana del orden de 0,001–0,02; con pedestal puede pasar de 0,01). Es donde se calibra el color y se deconvoluciona. |
| **MAD** | Desviación absoluta mediana; medida de ruido robusta frente a estrellas. |
| **MARS / MGC** | Modelo `I ≈ k·R + G + ε` de corrección de gradiente que compara con cielo real medido. |
| **MAS** | MultiscaleAdaptiveStretch: estirado multiescala con agresividad, DRC y recuperación de contraste. |
| **MMT / MLT** | Transformadas multiescala (media/lineal) para separar escalas y actuar en bandas. |
| **MTF** | Midtone Transfer Function: la curva de HistogramTransformation y de los estirados automáticos. |
| **NXT** | NoiseXTerminator (RC-Astro): reducción de ruido por IA. |
| **OSC** | One Shot Color: cámara de color con matriz de Bayer, sin rueda de filtros. |
| **Pedestal** | Nivel añadido a la imagen para que no haya negativos; distinto por canal en un master sin calibrar. |
| **PSF** | Point Spread Function: cómo reparte la luz un punto (estrella). BXT la restaura; SPFC la mide. |
| **Ringing** | Anillos alrededor de una estrella por deconvolución, HDRMT o compresión excesiva. |
| **ROI** | Región de interés; se usa para medir fondo, muestras o máscaras. |
| **Screen** | `1 − (1−A)(1−B)`: recombinación de estrellas sobre starless sin endurecerlas. |
| **Sigma-clipping** | Rechazo iterativo de valores alejados de la mediana; usado en fondos y en integración. |
| **SNR** | Relación señal/ruido. Más integración la sube con √N. |
| **SPCC / SPFC** | Calibración de color / de flujo espectrofotométrica. Necesitan WCS y datos lineales. |
| **Starless** | Imagen sin estrellas. La capa de estrellas es original − starless (en lineal, exacto). |
| **STF** | Screen Transfer Function: autoestirado **de visualización**; no cambia los datos. |
| **SXT** | StarXTerminator: separación de estrellas por IA. |
| **Viñeteo** | Caída de iluminación hacia las esquinas; se corrige con flats (multiplicativo), no con sustracción. |
