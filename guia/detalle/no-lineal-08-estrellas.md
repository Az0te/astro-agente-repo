# Detalle del Paso 8 no lineal: Procesado de estrellas

[← Ficha del paso](../no-lineal/08-estrellas.md) · [Índice](../SKILL.md) · En PixInsight: [Anexo J, detalle](../anexos/J-pixinsight/detalle.md#no-lineal-08)

Material de apoyo de la ficha: fuentes y recetas medidas para halos y estrellas muy brillantes. La ficha manda. Todo vale para cualquier programa; los nombres de procesos están en su anexo.

**Fuentes de la ficha.** "La capa de estrellas = Original − Starless: contiene PSF completa, halos, aigrettes, residuos de nebulosa, núcleos de galaxias/cúmulos" y la preparación de la capa (fondo a cero: valores < 0,005 a 0, curva de saturación, "el fondo de la capa debe quedar negro puro", atenuar en vez de erosionar) son de aescaffre. El suelo mediana + 2·MAD es de NOVA: "si no, el screen añade al fondo el grano estirado entre estrellas. Pero en campos densos ese 'grano' puede ser estrellas débiles reales (Cocoon: 94 % de la varianza del fondo eran estrellas)". La fórmula de estrellas de banda estrecha es la de NB to RGB Stars: "una estrella saturada en las tres capas queda blanca". "No usar erosión/umbral morfológico para reducir estrellas: crea anillos. Mejor estirar menos las estrellas o usar tomas cortas."

**Identificar el origen del artefacto antes de corregir** (lámina «halos, reflets et artefacts optiques»): cada uno se arregla en un sitio distinto.

| Aspecto | Causa probable | Cómo comprobarlo | Dónde se arregla |
|---|---|---|---|
| Anillos de color alrededor de estrellas brillantes | microlentes del sensor | compararlo en otra cámara o con RGB frente a banda estrecha | en la toma; en procesado, atenuar en la capa de estrellas |
| Halo circular grande o difuso, distinto por filtro | reflejo en el filtro (banda estrecha) | cambia con el filtro o con la inclinación; gira con la cámara | en la toma (filtro, inclinación); en procesado, resta de halo (abajo) |
| Copias débiles simétricas de una estrella brillante | reflejos internos (fantasmas) | simétricos respecto al centro óptico; cambian con el ángulo | parasoles y deflectores; en procesado, sólo resta local documentada |
| Picos (aigrettes) | difracción de la araña | número de picos = forma de la araña | no es un defecto: atenuar sólo si se pide |
| Estrellas alargadas hacia un lado | inclinación del sensor o backfocus | peor en un lado del campo | mecánico: calzas, rotador; la deconvolución ayuda poco |
| Estrellas en coma o cruz en los bordes | aberraciones (coma, astigmatismo, curvatura) | crecen hacia los bordes | corrector de campo; la deconvolución ayuda pero no lo quita |

Un halo que sólo está en algunos subs son nubes: quitar esos subs. En la duda, no tocar y decirlo.

**Halos: diagnóstico y recetas que funcionaron**

Diagnóstico previo, en este orden:

- Perfil radial azimutal (mediana) para buscar anillos.
- "Comparar posición en el cielo entre sesiones con distinta rotación de cámara: **un reflejo del filtro gira con la cámara; la estructura real no**."
- Halos que sólo aparecen en algunos subs = nubes finas o calima: quitar esos subs y reintegrar es lo más fiel a los datos. Con dos cámaras: "un halo que sólo está en una de ellas es instrumental."
- Excluir el entorno de la estrella brillante (máscara radial suave) de los realces de Hα y de detalle.

Reglas de la resta:

- "Restar halo con perfil radial **ajustado con curva suave** (polinomio en log-log), nunca con el perfil ruidoso directo → si no, quedan 'ondas' concéntricas. Si quedan, medir el perfil actual, separar escala lenta (gaussiana ~60 px en r) y restar sólo el rizado."
- "**No rellenar con un círculo plano**: borra fondo real y queda una mancha. Mejor dejar parte del halo (reinyectar ~50 % del halo ajustado con su color medido) y rellenar sólo el núcleo sin datos (r < ~200 px) con la continuación de la ley de potencias, monótona."
- "El separador de estrellas (StarXTerminator) corta el disco de estrellas muy brillantes con borde nítido (~115 px en la estrella brillante); al estirar más las estrellas aparece un anillo. Arreglo: prolongar el ala de la estrella con su pendiente medida (r^-p) y su color, desvaneciendo hasta ~300 px."

**Restos del separador de estrellas en estrellas muy brillantes (receta nebulosa de emisión y reflexión, "la que funcionó").** El separador (StarXTerminator) en lineal dejó en la capa sin estrellas un cuadrado con arco iris en la estrella brillante y dejó enteras dos estrellas de mag ~4–5.

1. En la capa sin estrellas **lineal**, dentro de R0 (la estrella brillante 320 px; estrellas menores 80–120 px) sustituir por la continuación de su propio perfil azimutal medido entre R1 y R2 (ley de potencias ajustada en log-log, **pendiente ≈ −1,5 en la estrella brillante, −2 en las otras**), con tope en r = rcap ≈ R0, y transición suave R0→R1 con **R1 ≈ 3·R0** (la estrella brillante 900 px). "Con R1 ≈ 1,3·R0 quedó un anillo visible."
2. Sumar la diferencia exacta (antes − después) a la capa de estrellas lineal: "en lineal la suma sigue siendo el original; nada se borra".
3. Aun así, al estirar las capas por separado y recomponer en screen queda un escalón en el borde del relleno. Arreglo en la imagen **final**: perfil radial por canal (**percentil 40** de cada anillo, para no coger estrellas), versión lenta = gaussiana en r (**σ 25 px** en estrellas menores, **60 px** en la estrella brillante), restar sólo el rizado (perfil − lento) con rampas en los extremos. Amplitud quitada ≈ 0,03–0,09; el halo real se queda.
4. Hacer lo mismo en el Hα sin estrellas antes de restar el continuo: "si no, aparecen agujeros negros donde la R tenía la estrella y el Hα no".

**Halos instrumentales en la capa sin estrellas (receta nebulosa oscura, "la que funcionó").**

- Diagnóstico: índice de halo por sub constante en las dos sesiones, con y sin luna y a ambos lados del meridiano (no son nubes). El centro de cada halo, como centroide del exceso suavizado, estaba **desplazado 15–70 px hacia el centro óptico** respecto a su estrella: firma de reflejo. Eran más azules (**B ≈ 1,3–1,5×R**) y con Triband 1,3–4× menores (luz visible fuera de esas bandas, no IR).
- Tras separar estrellas en lineal, el exceso de halo en la starless (0,7–2,8 ×10⁻⁴) era "del orden del contraste del propio polvo".
- Restar por estrella y canal, **centrado en el halo y no en la estrella**: mediana azimutal en bins de 8–10 px, fondo = mediana más allá de Rh, exceso suavizado (media móvil de 5 bins) y forzado monótono, núcleo con tope constante (r < 40–80 px), borde coseno entre 0,6·Rh y Rh, **restar el 85 %**. Rh = 360–560 px en las 4 brillantes y 120–400 automático en las medianas (donde el exceso cae por debajo de 0,06 ×10⁻⁴). Se hizo en 19 estrellas; quedan fuera las que iluminan reflexiones (su brillo es nebulosa real).
- "**Localizar las estrellas por centroide del flujo** en la capa de estrellas, nunca por el píxel máximo: con núcleos saturados el máximo cae en otra estrella (180 px de error en una nebulosa oscura)."
- Núcleo mal separado por el separador: "**no rellenar con un valor plano** (disco visible). Ajustar una superficie de grado 2 al anillo r = 190–250 px y fundirla dentro con transición de 50 px."
- "Atenuar suavemente (35–40 %) sólo la capa de estrellas en la corona del halo (entre ~2× el núcleo y el radio externo) es aceptable y se documenta; nunca tocar la nebulosa de esa zona."
