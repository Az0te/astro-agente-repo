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

**Aplicar con la máscara medida (mezcla en una copia)**

- Cuándo: siempre que un realce (curvas, saturación, LHE) deba actuar sólo en una zona y se quiera **comprobar** que la máscara hace lo que se espera, en vez de fiarse de verla. Se aplica el proceso a una copia y se mezcla: resultado = original·(1 − k·m) + procesado·k·m, con m la máscara (invertida si se pide) y k la fuerza (0–1). El original no se toca y no queda ninguna máscara puesta o invertida por error.
- **Objetivo**: decir dónde debe actuar el proceso, `fondo` (medios, sombras, nebulosidad débil) o `brillante` (núcleo, nebulosa brillante). Con el objetivo dado se puede detectar una máscara al revés.
- Medidas: de la máscara, la media en el cielo y en lo brillante, la cobertura, el % en transición y el salto máximo por píxel (p99); del efecto, el cambio medio donde m > 0,8 y la **fuga** donde m < 0,05, también relativa al efecto (`fuga_rel_pct`).

| Aviso | Qué significa | Qué hacer |
|---|---|---|
| Fuga apreciable (> 5 % del efecto) | la máscara no llega a 0 donde debe proteger | máscara con más contraste (gamma más alta, normalizada) o restar la zona a proteger; si no, bajar la fuerza |
| Borde duro (salto > 0,05 por píxel) | la máscara pasa de proteger a actuar de golpe: escalón visible | suavizar la máscara (desenfoque o gran escala) y repetir |
| Efecto nulo (cambio < 1e-4, o casi sin zona con m > 0,8) | la operación es demasiado suave o la máscara casi no se activa | subir la fuerza de la operación, o usar una máscara que sí cubra la zona objetivo |
| La máscara no protege nada (en ningún sitio baja de 0,05) | lo brillante recibe casi todo el efecto | máscara con más contraste: luminancia normalizada, otra gamma o la máscara de fondo para LHE |
| Apenas distingue cielo de brillante (diferencia de medias < 0,3) | la máscara es casi uniforme: actúa igual en todo | normalizar la luminancia antes de la gamma, o cambiar de tipo de máscara |
| Posible máscara invertida (mayor en la zona contraria al objetivo) | se va a tratar justo lo que se quería proteger | invertirla y repetir; comprobar que el aviso desaparece |

- Conclusión de las pruebas: **en galaxias estiradas, la máscara de luminancia con gamma no protege el núcleo** : lo brillante sigue recibiendo buena parte del efecto. **La máscara de fondo para LHE sí lo protege.** En otros objetos, que decidan las medidas (fuga y diferencia cielo/brillante), no el nombre de la máscara.

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/no-lineal.md#no-lineal-04); en Siril, [Anexo I](../anexos/I-siril.md).

**Control.** Ver la máscara estirada (STF) y comprobar que cubre lo que debe: núcleo protegido, fondo incluido, estrellas cubiertas si el proceso las daña. "Si hay que contenerlas, atenuar brillo en vez de erosionar." Revisar bordes de máscara (escalones, halos, costuras de color) en la imagen final, no sólo en la máscara.
