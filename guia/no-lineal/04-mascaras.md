# Paso 4: Máscaras

[← Índice](../SKILL.md) · Anterior: [Paso 3: SCNR](03-scnr.md) · Siguiente: [Paso 5: Boost (curvas, contraste, saturación)](05-boost.md)

**Por qué.** Casi todos los realces no lineales (LHE, HDRMT, curvas, saturación, inyección de Hα) deben aplicarse **selectivamente**: sin máscara, el proceso actúa igual sobre el núcleo, el fondo y las estrellas, y el resultado típico es un núcleo aplanado y un fondo con ruido amplificado. "Máscaras de luminancia con gamma para LHE/HDRMT: sin gamma los núcleos brillantes reciben el efecto completo y se aplanan".

**Máscaras de luminancia con gamma**

- `m = exp(γ·ln(max(m, 1e-5)))` con **γ ≈ 2,0 (LHE)** y **γ ≈ 1,5 (HDRMT)**.
- Uso: proteger núcleos y zonas brillantes mientras el efecto actúa sobre medios y sombras.

**Máscaras de estrellas** (StarMask)

- "Subir Noise threshold para no coger ruido, subir Scale para incluir estrellas grandes, subir Midtones y bajar algo Truncation para proteger centros grandes, subir Smoothness para cubrir halos de forma uniforme."
- "Máscara de luminancia (protege el fondo) menos (StarMask + mapa de estructuras con estrellas agrandadas por MorphologicalTransformation y suavizadas quitando capas 1–3 con MultiscaleLinearTransform)."
- Para inyección de Hα: "clipLow 0,04–0,08"; "sin máscara el fondo se vuelve rojo".

**Máscara de cielo** (para neutralizar sin tocar el objeto): "máscara de cielo por luminancia (sigma-clip del fondo, rampa de 1,5σ a 5σ, suavizada)". Sólo si las esquinas se desvían > 0,10 de neutro. "La zona más oscura no siempre es cielo limpio (IFN, polvo, nebulosidad débil)."

**Máscaras por escalas (polvo, reflexión, fondo)** — caso nebulosa oscura

- "Máscaras de gran escala, calculadas binando 8×, suavizando y ampliando de nuevo: polvo = luminancia entre el cielo y ~+0,03 (incluye cirros débiles, señal real); azul = (B − (R+G)/2 > 0,010) × (L > cielo + 0,04), más una versión ancha (gauss σ 25 binado) para ampliar la zona de reflexión; fondo = inversa del polvo."
- Máscara de fondo para LHE (nebulosa de emisión y reflexión): `1 − clip((L64 − 0,20)/0,25)`, con L64 = luminancia suavizada a ~64 px: "protege la nebulosa brillante y el halo de la estrella brillante".

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/no-lineal.md#no-lineal-04); en Siril, [Anexo I](../anexos/I-siril.md).

**Control.** Ver la máscara estirada (STF) y comprobar que cubre lo que debe: núcleo protegido, fondo incluido, estrellas cubiertas si el proceso las daña. "Si hay que contenerlas, atenuar brillo en vez de erosionar." Revisar bordes de máscara (escalones, halos, costuras de color) en la imagen final, no sólo en la máscara.
