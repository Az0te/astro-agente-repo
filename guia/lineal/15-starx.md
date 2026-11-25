# Paso 15: Separación de estrellas y reducción de ruido de la capa sin estrellas

[← Índice](../SKILL.md) · Anterior: [Paso 14: Reducción de ruido suave (opcional)](14-noisex-suave.md) · Siguiente: [Paso 16: Sustracción de continuo](16-linearfit-continuo.md)

**Por qué.** Separar estrellas permite estirar la nebulosa a fondo sin hinchar las estrellas y procesar cada capa con su propia receta. "SXT: lo antes posible en lineal (no arcsinh/GHS/estirado multiescala/HDR multiescala antes, deforman perfiles)". En lineal la separación es exacta: estrellas = original − starless.

**Reglas**

- **Con banda estrecha que se va a inyectar en la RGB:** antes de separar, medir k del continuo con las dos capas aún con estrellas ([Paso 16](16-linearfit-continuo.md)); después separar la RGB y cada raya, restar el continuo y hacer la inyección ([Paso 10](10-combinacion-rgb-nb.md)).
- En lineal, separación **por suma exacta** (sin "unscreen"): starless + estrellas = original. Generar siempre la capa de estrellas.
- Overlap: 0,20 normal; 0,50 sólo con estrellas muy grandes, campos densos o costuras (×3 tiempo).
- No aplicar una visualización automática a la capa de estrellas.
- "No separar estrellas en cúmulos (abiertos o globulares): las estrellas son el objeto."
- "SXT rinde peor con aberraciones fuertes, sobremuestreo (p. ej. drizzle 2x) y estirados extremos tipo GHS/arcsinh (RC-Astro); puede quitar núcleos de galaxias, núcleos de planetarias, comas de cometas y cruces de filamentos (proteger con máscara)."
- "En galaxias espirales grandes SXT confunde regiones HII y nudos con estrellas: el estirado de estrellas amplifica esos residuos; usar screen, estirado moderado o no separar estrellas."
- Donde haya varios motores (StarX, StarNet), compararlos: restos de estrellas, agujeros y objeto quitado. Orientación (astroimagetw): con focal larga suele rendir mejor StarX y además quita píxeles calientes; con focal corta y estrellas pequeñas, StarNet; StarX conserva mejor las galaxias pequeñas del fondo. Si en lineal sale una cuadrícula en el fondo, más solape (×2 de tiempo).
- SyQon Axiom Mini (SyQon Studio) solo sirve sobre la imagen ya estirada: en lineal sale rota. Para compararlo, separar después de estirar ([Anexo L](../anexos/L-syqon.md)).
- **Malla de 2 px fuera antes de StarX (OSC, sobre todo dual band).** El resto de la matriz Bayer crece con la señal: alrededor de las estrellas brillantes la malla sube con la estrella, StarX la toma por nebulosa y deja en la starless un disco con malla y un **anillo**, que al estirar sale como halo. Antes de separar, quitar la malla **relativa a la señal** (estimarla sobre imagen / fondo suave gaussiano de σ 2 px y volver a multiplicar) y sacar la capa de estrellas como **original − starless**, para que la suma siga siendo exacta con la imagen de verdad. IC 1396 dual band (25 nov 2026): anillo 0,03–0,18 → 0,01–0,02. Las herramientas lo hacen por defecto en lineal (`patron: false` lo desactiva).
- **No separar dos veces.** Sobre una imagen ya sin estrellas (una paleta hecha con starless, una capa que salió de una separación) StarX solo saca restos, ruido y anillos; si esa capa se recombina en lugar de la buena, las estrellas salen pocas y difusas. Recombinar la capa de estrellas de la primera separación. Para saberlo: % de píxeles de estrella, contando solo picos del paso alto > 5σ que formen grupo (≥ 3 píxeles en su 3×3), no picos sueltos de ruido ni la malla. IC 1396: 0,13 % en una starless, 2,3 % con estrellas; por debajo de 0,5 % las herramientas se niegan a separar salvo `forzar: true`.
- La capa de estrellas sirve después como **máscara de estrellas** (coge las grandes mejor que la detección de estructuras): guardarla ([Paso 4 no lineal](../no-lineal/04-mascaras.md)).

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/lineal.md#lineal-15); en Siril, [Anexo I](../anexos/I-siril.md).

**Control.** "Una starless 'limpia' no prueba que la separación sea buena: revisar la diferencia original − starless." Esa diferencia debe contener **sólo** estrellas y sus halos, no filamentos, polvo ni núcleos de galaxia. Comprobar el recuento de estrellas de la capa frente al original. Y la suma `starless + stars` debe reproducir el original píxel a píxel (en lineal es exacta).

**Denoise principal sobre la starless (lineal)**

Es el denoise fuerte del flujo: va aquí, sobre la capa sin estrellas y todavía en lineal, no antes de BXT ni sobre la imagen con estrellas. Comparar candidatos (fuerzas y métodos) y preferir el que baja el ruido un 50–80 % cumpliendo los controles.

**Por defecto, si el programa lo tiene: híbrido de un denoise por IA de detalle fino (ML) + NXT.** Es la mejor opción medida, en los tres canales probados frente a una referencia de subs independientes (nebulosa dual band; [detalle](../detalle/lineal-15-denoise-mldenoise.md)). Toma el detalle fino de ML y lo grueso de NXT 0,95: `ML − suave(ML) + suave(NXT)`, con caja de radio 3. Iguala a NXT 0,95 en ruido a 1, 4 y 16 px y borra menos detalle.

| Variante (puntuación 0–100) | Hα | OIII | SII |
|---|---|---|---|
| **Híbrido ML + NXT (por defecto)** | **81,5** | **83,8** | **74,4** |
| ML 1,0 solo | 81,0 | 67,0 | 68,3 |
| NXT 0,95 solo | 78,6 | 78,6 | 69,7 |
| NXT 0,70 solo | 77,7 | 58,6 | 59,3 |

| Parámetro | Valor |
|---|---|
| ML: modelo | obligatorio; ruta en `perfil.md` |
| ML: cantidad | 1,0 (máscara, overlap y precisión alta no cambian nada) |
| NXT `denoise` y `denoise_intensity` | 0,95 |
| NXT `detail` / `iterations` | 0,15 / 2 (iterations 5 no mejoró) |
| Radio de la caja | 3 px |

Canales mono (Hα, OIII, SII, L). En RGB, el modelo de ML puede rechazar imágenes de color: aplicar por canal (sin medir) o usar NXT con separación de color.

- Resultado = fino de ML + grueso de NXT: `ML − caja₃(ML) + caja₃(NXT)`, con un desenfoque de caja separable de radio 3.
- Si no hay ML: NXT 0,70 en dos pasadas y avisar (Rafael, 25 nov 2026: mejor dos pasadas de 0,5 o 0,7 que una de 0,9 o más).
- ML es lento (~2 min en 26 MP): esperar el trabajo y no encadenar varios canales en una misma petición.

**Sin ML (no hay modelo o el programa no lo tiene):** NXT solo, denoise 0,70 en **dos pasadas** (detail 0,15, iterations 2). Medido contra la referencia: una pasada de 0,95 puntuó 78,6 (en Hα 0,85, 79,2); las dos pasadas de 0,7 aún no se han medido contra ella, pero es la preferencia de Rafael (25 nov 2026): nada de una pasada de 0,9 o más, mejor dos de 0,5 o 0,7. Con señal fuerte (Hα), sin NXT: ML 1,0 solo. Sin ML ni NXT: reducción de ruido por variación total multiescala (8 escalas, fuerza 0,6; no con los valores por defecto, que dejan mucho ruido grueso) o la reducción de ruido propia del programa, comparada. Borra más detalle que el híbrido y que NXT 0,95 (ver [detalle](../detalle/lineal-15-denoise-mldenoise.md)).

**En las herramientas** (24 nov 2026): `reducirRuido` sobre una capa mono **lineal y sin estrellas** (marca de `separarEstrellas`) usa NXT 0,70 en dos pasadas si no se le da `denoise` (hasta el 25 nov 2026, 0,95 en una), y si el ruido baja menos del 50 % es `no_cumple` cuando se le pidió una sola pasada de NXT por debajo de 0,75 (con 0,75 o más, aviso: en un recorte del Hα de IC 1396, NXT 0,50 / 0,75 / 0,95 bajaron un 27 / 38 / 44 %, así que con NXT solo el 50 % no siempre se alcanza); `ruidoCandidatos` compara ahí 0,50 / 0,75 y 0,50 × 2 / 0,70 × 2 (en lineal, también fuera de este caso, 0,5 × 2 y 0,7 × 2; estirada, 0,3 × 2). Motivo: en las pasadas de paleta de IC 1396 con Qwen se aplicó el NXT 0,50 por defecto a cada capa (Hα bajó un 28 %, OIII/SII/Hβ ~47 %) y tras el estirado al fallo las capas débiles llegaron con el doble de grano que el Natural de Rafael (NXT Hα 0,5, OIII 0,75, SII 0,8, Hβ 0,75 sobre datos con más señal). Con `principal: false` no se aplica.

| Parámetro NXT (variantes) | Valor |
|---|---|
| Separación de color (RGB) | croma > luminancia (nebulosa oscura: croma 0,90, luminancia 0,40, detail 0,25); 0,75 por igual dio aspecto plástico |
| Variante "full" (RC-Astro) | separación intensidad/color y de frecuencia: HF y LF 0,80 en intensidad y color, escala HF/LF 5, iterations 5 |

- En una rejilla, cada prueba de NXT sobre una imagen **nueva**, y fijar también `denoise_intensity`: sobre la misma imagen NXT llegó a devolver el mismo resultado aunque cambiara `denoise`.
- La rejilla de antes (denoise 0,50 / 0,70 / 0,85) se quedaba corta: medido contra una referencia, 0,70 pierde frente a 0,95 en los tres canales. Bajar σ del cielo sin referencia no distingue ruido quitado de señal borrada.

**RGB (OSC): no 0,95.** Lo de arriba se midió en canales mono. En RGB, quitar casi todo el grano deja a la vista el moteado de color de gran escala del cielo (manchas verdes y moradas de 100–300 px) que el grano tapaba, y sale al estirar. Galaxia grande OSC (7 nov 2026): NXT 0,95 bajó el ruido un 90 % y la starless quedó con manchas muy visibles; NXT 0,50 (50 %) quedó limpia, con `moteado_color` 0,36 → 0,65. El moteado sube en proporción a lo que baja el grano, así que con 0,95 rondaba 3,5. Regla: el denoise que deje `moteado_color_despues` por debajo de ~1 (en esa galaxia grande, quitar como mucho un 65–70 % del ruido); por encima de 1,5 es `no_cumple`. En RGB, NXT 0,70 o menos mirando el moteado, y como candidato la separación de frecuencias con croma de baja frecuencia 1,0 (manual de RC-Astro: quita las manchas de color; [Paso 14](14-noisex-suave.md)). Si hace falta más limpieza, en la fase no lineal (Paso 6) con separación de color, no subiendo aquí el denoise.

**Control del denoise.** σ del cielo (bajar un 50–80 %, nunca a cero), contraste de una zona débil (no bajar más de ~5 %) e imagen residual (antes − después): sólo ruido, sin filamentos ni bordes. Con el híbrido, revisar además que no aparezca moteado a 4–16 px en el cielo.
