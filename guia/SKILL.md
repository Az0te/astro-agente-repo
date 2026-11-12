---
name: "astro-procesado"
description: "Procesado de astrofotografía de cielo profundo con un agente de IA en PixInsight o en Siril, a través del MCP de cada programa (las funciones de la guía como herramientas), paso a paso desde el análisis del objeto hasta la entrega: OSC + dual band, HDR con tomas cortas, gradientes, deconvolución, separación de estrellas, calibración de color, ruido, estrellas y halos, paletas de banda estrecha y controles objetivos de calidad. Compara métodos en vez de fijar uno. Fiel a los datos."
---

# Procesado de astrofotografía de cielo profundo

Núcleo común de la guía para cualquier agente (Claude, ChatGPT o un modelo local) que procese con las herramientas de la guía, en **PixInsight** o en **Siril**, a través del servidor MCP de cada programa o de su panel de chat. Cada herramienta es una función de la guía con su nombre y sus parámetros (los describe el propio servidor). El agente no escribe ni ejecuta código del programa: sólo llama a las herramientas. Si ninguna sirve, lo dice y propone al usuario qué hacer.

Se lee entero al empezar, junto con el `perfil.md` del usuario y el **arranque del anexo del programa en uso**: [Anexo J](anexos/J-pixinsight.md) (PixInsight) o [Anexo I](anexos/I-siril.md) (Siril). El resto se carga **sólo cuando hace falta**: la ficha del paso que se va a ejecutar y su apartado del anexo, y nada más.

## Principio

**Ceñirse a los datos, no inventar nada**, y sacar la máxima información que contengan. Toda estructura débil se confirma antes de realzarla; cada paso se compara con la versión sin tocar. No aplicar un paso es un resultado válido.

## Reglas

1. **Si falla un paso esencial (gradiente, calibración de color, deconvolución, estirado), parar y avisar.** Nada de apaños (curvas en vez de calibración de color, una fórmula en vez de un estirado, una máscara de enfoque en vez de deconvolución).
2. **El color sale de la calibración fotométrica (SPCC)**, nunca de multiplicar canales ni de curvas por canal a ojo. Las versiones cálida y fría del paso de color (no lineal 5) son una elección estética del usuario sobre un color ya calibrado: medidas, con el cielo fijo y la versión neutra guardada.
3. **Estirar con un método de estirado probado** (GHS por pasadas cortas al fallo, adaptativo multiescala, arcsinh o transformación de histograma; la herramienta de estirado los compara); el estirado propio de estrellas sólo para la capa de estrellas lineal, en el paso de estrellas (no lineal 8), justo antes de recombinar. Nunca fórmulas inventadas. Antes de estirar, quitar la visualización automática de la imagen (las herramientas de estirado lo hacen solas) y saber el tipo de objeto (preguntarlo o sacarlo de la ficha del objeto).
4. **Comprobar cada paso** con las estadísticas por canal antes y después y con el historial. Un paso que no cambió nada no se ha hecho. Ningún canal puede acabar recortado.
5. **Copias con nombre de versión** (v1, v2…): nunca trabajar sobre el master ni sobrescribir. Nunca borrar subs ni masters: los descartes van a `_rechazados` y el usuario confirma.
6. **Comparar siempre, no fijar un método.** Donde la guía tiene una herramienta `…Candidatos`, usarla en vez de aplicar un solo método o valor, y enseñar su tabla. En los pasos estéticos (color en no lineal 5, nitidez en no lineal 7, estrellas en no lineal 8) **elige el usuario**: enseñar las previas con la recomendada marcada, esperar su elección y seguir con esa versión.
7. **Todo con las herramientas de la guía**, sin iconos, scripts ni menús del programa. Si una herramienta dice que falta un proceso o un programa externo, avisar, no sustituirlo.
8. **El dossier cuenta lo que dice el historial**, no lo que se pretendía.

**Orden lineal:** gradiente → deconvolución sólo de corrección → calibración de color → deconvolución completa → separación de estrellas → reducción de ruido principal sobre la capa sin estrellas en lineal (Paso 15). Nunca reducir ruido antes de la deconvolución. **Con banda estrecha o dual band** (Paso 10): cada capa por su gradiente y su deconvolución; la calibración de color se hace sobre la RGB **sola** y la combinación (inyectar Hα/OIII o paleta) va **después** del color, aunque su número de paso sea menor. Neutralizar el cielo, si hace falta, sobre la starless lineal (la misma que se estira).

## Imágenes e ids

- Usar sólo los nombres o ids que devuelven las herramientas del programa, escritos exactamente igual. Nunca inventar ni completar un id. Los ids de las fichas (`MasterLight`, `Starless`…) son ejemplos: cambiarlos por uno real. Si el usuario no dice cuál, la activa; si hay dudas, preguntar. En Siril no hay ids: se trabaja sobre la imagen cargada.
- Guardar con rutas absolutas y nombres nuevos.

## Qué se compara en cada paso

| Paso | Qué se decide o compara | Medidas que deciden |
|---|---|---|
| L1 Análisis | Tipo de objeto, señal, estrellas brillantes, bordes sin datos (con Internet, ficha del objeto) | estadísticas por canal, escala, saturados, bordes |
| L2 Inventario | Grupos de lights y su calibración | compatibilidad (`no_cumple`) |
| L3 Selección de subs | Subs con nubes, mal guiado o desenfoque | FWHM, excentricidad, estrellas, cielo |
| L4 Preprocesado | Calibración, registro e integración | revisión previa (`no_cumple`), log |
| L5 Alineado y recorte | Rejilla común y bordes | estrellas emparejadas, bordes sin datos |
| L6 HDR | Mezcla de tomas largas y cortas | razón de flujo, escalón en la transición |
| L7 Canales | Desmezcla del dual band | ratios G/R y B/R, sobre-restas |
| L8 Astrometría | Solución astrométrica | resuelta, escala, centro |
| L9 Gradiente | **Candidatos** de modelo de fondo | `copia_objeto`, `objeto_quitado_pct`, `gradiente_restante` |
| L10 Combinación | Qué canal aporta qué | ruido, dominante del cielo |
| L11 Deconvolución de corrección | FWHM por canal | FWHM antes y después, ringing, astrometría |
| L12 Color | Calibración fotométrica; neutralizar cielo | cielo por canal en sigmas, `dominante_cielo_pct` |
| L13 Deconvolución completa | **Candidatos** de intensidad | FWHM, ringing, gusanos, detalle |
| L14 Ruido suave | **Candidatos** de fuerza y método | `ruido_rel`, contraste débil, moteado de color |
| L15 Estrellas y ruido | Separación; **candidatos** de ruido sobre la starless | reconstrucción, `ruido_rel`, moteado |
| L16 Continuo | k de la sustracción de continuo | k, negativos, emisión conservada |
| L17 Checkpoint | Estado lineal congelado | tabla del checkpoint, `no_cumple` |
| NL1 Estirado | **Candidatos** al mismo cielo, sólo la starless (las estrellas siguen lineales hasta NL8) | `separacion`, `ruido_rel`, recortes, dominante, meseta del núcleo |
| NL2 Paleta | Previas de paletas; el usuario elige | G/max(R,B), fondo teñido |
| NL3 Verde | Quitar verde sólo si sobra | cielo RGB antes y después |
| NL4 Máscaras | Máscara medida y mezcla | fuga, borde, máscara invertida |
| NL5 Realces | **Candidatos** de contraste local y de núcleo; **versiones de color para que elija el usuario** (neutra, saturación al fallo, viva, cálida, fría, contraste) | `contraste_ganado_pct`, `ruido_rel`, cielo, quemados, meseta; deriva de tono, % muy saturados |
| NL6 Ruido final | **Candidatos** | `ruido_rel`, moteado de color |
| NL7 Nitidez | Tres niveles sobre la starless, con máscara; elige el usuario (o ninguno) | ruido del cielo ≤ ×1,10, detalle fino, quemados |
| NL8 Estrellas | **Estirado de la capa** y **candidatos para que elija el usuario**: recomendada, +20 % de tamaño y +10 % de saturación, +50 % y +20 % | tamaño y saturación conseguidos, p90, suelo, aporte |
| NL9 Recombinación | Screen o suma | `aporte_estrellas_pct`, fondo, recortes |
| NL10 Exportación | Limpieza cosmética y formatos de entrega | ficheros, saturados, bordes, recorte del gamut al pasar a sRGB |
| NL11 Dossier | Historial y revisión crítica | historial |

Qué herramienta hace cada paso, las siempre disponibles y cómo se recoge un trabajo largo: [Anexo J, arranque](anexos/J-pixinsight.md#arranque) en PixInsight; [Anexo I, arranque](anexos/I-siril.md#arranque) en Siril.

## Internet

Las herramientas de internet (ficha del objeto, catálogos, enciclopedia, páginas web) sólo funcionan con **Internet** activado en el panel o en la configuración del programa. Si responden que está desactivado, no reintentar ni buscar otra vía: seguir sólo con el análisis de la imagen o pedírselo al usuario. Con Internet, al analizar la imagen pedir a la vez el análisis y la ficha del objeto y cruzar las medidas con ella: qué objeto es, qué emite (y si el filtro lo capta), qué estrellas darán halos y qué pasos vigilar. Lo de internet es orientativo: citar la fuente y no añadir nada que no traiga. Las búsquedas web propias del cliente también sólo con Internet activado.

## Siguiente paso

Al terminar una respuesta, cerrar con una línea **«Siguiente paso: <qué hacer> con <herramienta>.»** (la herramienta del anexo del programa en uso) en el **orden de la guía** (tabla de arriba) según lo ya hecho: sin saltar ni reordenar pasos; si uno no aplica, decirlo y pasar al siguiente. Alternativas razonables, en líneas «Paso N: …». Los paneles las muestran como enlaces.

## Sesiones por fase

1. **Fase lineal** (pasos lineales 1–17). Termina en el checkpoint, que escribe `<carpeta de la versión>/estado.md` (plantilla en el Paso 17 lineal).
2. **Fase no lineal** (pasos no lineales 1–11). Empieza en una sesión nueva leyendo este fichero, `perfil.md`, el arranque del anexo del programa y `estado.md`.

Si algo de la fase lineal hay que rehacer, se vuelve a la versión guardada en el checkpoint, no se corrige en no lineal.

## Entorno

- Una herramienta que tarda más de ~45 s devuelve un **id de trabajo** y sigue ejecutándose: recoger el resultado con la herramienta de estado, nunca relanzarla. Si el programa está ocupado, la petición espera en cola.
- **Un solo agente con el programa a la vez.**
- Resultados cortos (números redondeados, listas breves); para ver la imagen, la previa en JPG o recortes al 100 % en `<versión>/prev/`, no capturas de pantalla.
- Tras pasos pesados, cerrar las imágenes temporales.

## Trampas más frecuentes

| No hacer | En su lugar |
|---|---|
| Fiarse del "success" de un proceso | Estadísticas e historial |
| Inventar o completar un id de imagen | El id exacto que da el programa |
| Repetir una llamada que ha fallado igual | Cambiar lo que causó el error |
| Aplicar un solo método o valor donde hay `…Candidatos` | La herramienta que compara, y su tabla |
| Estirar con la visualización automática puesta | Quitarla antes (las herramientas de estirado lo hacen) |
| Calibrar el color sobre imagen estirada, sin astrometría o sin las curvas del perfil | Master lineal, astrometría, calibración con las curvas del perfil |
| Modelos de fondo con referencia o IA en nebulosas oscuras, IFN o polvo extenso | Plano robusto o muestras manuales (Paso 9 lineal) |
| Dar por bueno un modelo de gradiente sin mirarlo | Liso, sin objeto, sin anillo; `copia_objeto` |
| Recombinar estrellas lineales con una starless estirada | Estirar las dos o extraer en no lineal |
| Estrellas de L, Hα o banda estrecha | RGB corta o HDR |
| Llamar SHO a una paleta sólo de Hα/OIII | "pseudo-SHO" |
| Contraste local y compresión multiescala juntos en la misma zona, contraste local fuerte (amount > 0,5) o de radio pequeño con estrellas | Uno u otro por zona (compresión en el bulbo, contraste local en el disco), sobre la starless o con máscara |
| Núcleo de galaxia quemado (meseta > 3 px) o más rondas de estirado para "arreglarlo" | Comprimir el núcleo antes de saturar (Paso 5 no lineal) |
| Centro de una nebulosa quemado y cambiar de método de estirado para arreglarlo | El mismo método con un límite de luces más estricto: otro estirado cambia la relación entre canales y la paleta (Paso 1 no lineal) |
| Dar por buena una comparación con varios niveles idénticos | El parámetro no llega al proceso: probar dos valores extremos antes de elegir |
| Datos de otra persona procesados con el equipo del perfil | El texto del autor y las cabeceras (Paso 1 lineal) |
| Estrellas de una RGB con canales desequilibrados (pocos subs o FWHM distintos en un canal) | La RGB con canales equilibrados, aunque sea más corta (Paso 12 lineal) |
| Dar por buena una recombinación porque el fondo no cambia | Mirar `aporte_estrellas_pct` (≥ 0,5 %); estrellas con el mismo estirado |
| Seguir con un `no_cumple` sin resolver o inventar otro umbral | Corregirlo en el paso que dice el mensaje; los umbrales son los de la herramienta |
| Reducción de ruido o quitar verde para manchas de color grandes en no lineal | Venir de una lineal neutra y con una reducción de ruido lineal moderada; bajar saturación |
| Dar por cierto lo de internet o nombrar el objeto por el nombre del fichero | Medidas de la imagen; OBJECT o astrometría; citar la fuente |
| Seguir ajustando un paso que no gana a "no hacer nada" | Revertir; 3–4 variantes en los pasos dudosos |

Lista completa y criterio de parada: [Anexo F](anexos/F-anti-patrones.md), cuando algo falla o no convence.

## Mapa de decisión

| Señal de partida | Combinación | Pasos que cambian |
|---|---|---|
| OSC sin filtro | RGB; LRGB si hay L de mono | 7 y 10 sin desmezcla; calibración de color con QE "Ideal" |
| OSC dual band (Hα/OIII) | HOO o Hα+RGB; SHO sólo con SII real | 7 obligatorio, 10 y paso 2 no lineal |
| Mono con rueda | LRGB, HOO, SHO | 7 no aplica; calibración con QE y filtros reales |
| Mono + OSC | LRGB / LHa-RHaGB / HOO+RGB | 10 con ajuste lineal entre canales y `w ∝ 1/σ²` |

Una paleta es una convención, no el color real: decirlo en el dossier. Galaxias, nebulosas oscuras, planetarias, cúmulos e IFN: [Anexo D](anexos/D-flujos-por-tipo-objeto.md).

**Modelo por paso** (rápido o potente, regla N): [Anexo H](anexos/H-modelo-por-paso.md), sólo si la plataforma ofrece varios modelos y no lo ha elegido ya.

## Índice (cargar sólo el paso en curso; tokens aproximados)

**Lineal:** [1 Análisis del objeto](lineal/01-analisis-del-objeto.md) ~600 · [2 Inventario](lineal/02-inventario.md) ~440 · [3 Selección de subs](lineal/03-blink-subframeselector.md) ~770 · [4 Preprocesado](lineal/04-preprocesado.md) ~980 · [5 Alineado y recorte](lineal/05-staralignment-crop.md) ~450 · [6 HDR](lineal/06-hdr-composition.md) ~910 · [7 Extracción de canales](lineal/07-extraccion-canales.md) ~1050 · [8 Astrometría](lineal/08-plate-solve.md) ~390 · [9 Gradiente](lineal/09-correccion-gradiente.md) ~650 · [10 Combinación RGB / NB](lineal/10-combinacion-rgb-nb.md) ~1020 · [11 Deconvolución de corrección](lineal/11-bxt-correct-only.md) ~400 · [12 Calibración de color](lineal/12-spcc.md) ~440 · [13 Deconvolución completa](lineal/13-bxt-completo.md) ~520 · [14 Ruido suave](lineal/14-noisex-suave.md) ~360 · [15 Estrellas y ruido de la starless](lineal/15-starx.md) ~950 · [16 Sustracción de continuo](lineal/16-linearfit-continuo.md) ~460 · [17 Checkpoint](lineal/17-checkpoint.md) ~480

**No lineal:** [1 Estirado](no-lineal/01-estirado.md) ~1220 · [2 LRGB / paleta](no-lineal/02-lrgb-paleta.md) ~1460 · [3 Quitar verde](no-lineal/03-scnr.md) ~340 · [4 Máscaras](no-lineal/04-mascaras.md) ~820 · [5 Realces](no-lineal/05-boost.md) ~1050 · [6 Ruido final](no-lineal/06-noisex.md) ~520 · [7 Nitidez](no-lineal/07-nitidez.md) ~290 · [8 Estrellas](no-lineal/08-estrellas.md) ~560 · [9 Recombinación](no-lineal/09-recombinacion.md) ~410 · [10 Recorte y exportación](no-lineal/10-recorte-exportacion.md) ~280 · [11 Dossier](no-lineal/11-dossier.md) ~410

**Cómo en cada programa (bajo demanda):** las fichas dicen qué y con qué criterios, con nombres neutros; las herramientas, procesos y llamadas de PixInsight están en el [Anexo J](anexos/J-pixinsight.md) y las de Siril en el [Anexo I](anexos/I-siril.md).

**Anexos (bajo demanda):** [A Equivalentes de scripts](anexos/A-equivalentes-scripts.md) · [B Controles de calidad y entrega](anexos/B-checklist-entrega.md) · [C Pendiente](anexos/C-pendiente-documentar.md) · [D Flujos por tipo de objeto](anexos/D-flujos-por-tipo-objeto.md) · [E Parámetros complementarios](anexos/E-parametros-detalle.md) · [F Anti-patrones y parada](anexos/F-anti-patrones.md) · [G Glosario](anexos/G-glosario.md) · [H Modelo por paso](anexos/H-modelo-por-paso.md) · [I Siril](anexos/I-siril.md) · [J PixInsight](anexos/J-pixinsight.md)

**Detalle de los pasos** (el porqué y las fuentes; sólo si una ficha no basta para decidir): `detalle/`. **Configuración** (crear o completar `perfil.md`, entorno del programa): [00 Perfil y entorno](00-perfil-y-entorno.md). Fuentes: `FUENTES.md`. Instrucciones para ChatGPT y modelos locales: `envolturas/`.
