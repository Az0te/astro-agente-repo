# Paso 9: Corrección de Gradiente

[← Índice](../SKILL.md) · Anterior: [Paso 8: Plate solve](08-plate-solve.md) · Siguiente: [Paso 10: Combinación RGB / NB](10-combinacion-rgb-nb.md) · Medidas y protocolo de comparativa: [detalle](../detalle/lineal-09-correccion-gradiente.md)

El gradiente es un offset de gran escala que no es del objeto: contamina la calibración de color, aplasta el polvo y el IFN y sale como velo al estirar. Se corrige **en lineal, por canal si los canales vienen de noches, filtros o cámaras distintos**, y antes de combinar (Paso 10: canales de filtros distintos, L, RGB, banda estrecha) y de la deconvolución de corrección.

**Excepción: varios masters RGB de distinta exposición** (60 s y 120 s, por ejemplo). Esos no se combinan en el Paso 10: van a la HDR (Paso 6) y el gradiente se quita **una vez, sobre la HDR**, no en cada master (`gradienteCandidatos` sobre la vista HDR, no `gradienteVarias` sobre los masters). Orden: alinear → recortar → HDR → gradiente.

**Sin método fijo: se comparan siempre los candidatos y se aplica el que mejor funcione en esa imagen**: el que quita el gradiente copiando menos el objeto en su modelo. Ningún método gana siempre:
- un modelo por muestras automáticas (escala 10) copió poco objeto en una nebulosa oscura, una nebulosa dual band y una nebulosa de emisión y reflexión;
- en una galaxia grande ganó un polinomio de grado 2: el modelo por muestras se comía el 8,5 % de la galaxia;
- en polvo e IFN, un modelo con base de gradientes de referencia se comió el 75 % del contraste.

| Caso | Qué probar |
|---|---|
| Galaxias y nebulosas compactas | Polinomio robusto 1–2 fuera del objeto, modelo por muestras, modelo con referencia (si hay astrometría) |
| Nebulosas oscuras, IFN, polvo extenso | Plano robusto grado 1 o muestras manuales; desconfiar de los modelos con referencia y de la IA |
| Banda estrecha | Polinomio sobre rejilla de medianas con rechazo sigma: grado 2 en OIII; en Hα sólo plano grado 1 en los bordes |

**Ajustes**

- **Sustracción** para contaminación lumínica (aditiva); **división** sólo para viñeteo residual. Ante la duda, probar las dos y comparar el modelo.
- Queda gradiente en el cielo → escala algo menor (copia algo más, fondo más plano) o, si el residuo es liso, plano robusto grado 1 encima (no puede comerse formas).
- Modelos de IA de fondo: sólo objetos pequeños en campo amplio; se comen objetos extensos. Aun así entran en la comparativa: las medidas deciden.
- Comparar el color del fondo después de la calibración de color: algunos métodos neutralizan además el color del fondo y otros no.
- Los modelos con base de referencia necesitan astrometría (sin ella, no se prueban). Con banda estrecha o dual band, no usar las bandas RGB de la referencia: Hα como rojo y OIII como verde y azul cuando exista; si no hay banda de referencia para ese filtro, no probarlo. Si la nebulosa aparece en su modelo, subir la escala; si aparece en negativo, bajarla.
- Píxeles a 0 de los bordes del registro: recortar primero (Paso 5); un modelo que intente ajustarlos falsea todo.

**Medidas** (las mismas en todos los programas):

- `copia_objeto`: cuánto se parece el modelo al objeto (correlación de la estructura de gran escala, sin estrellas ni gradiente liso). **< 0,15 limpio; > 0,5 se come el objeto.**
- `objeto_quitado_pct`: % de la señal del objeto que se lleva el modelo.
- `gradiente_restante`: gradiente del **cielo** que queda (después / antes), medido fuera del objeto. Si el objeto llena el campo, el cielo más oscuro también es nebulosa y la cifra no es fiable: decidir por `copia_objeto`, `gradiente_visible` y mirando.
- `gradiente_visible`: lo que se **verá** del gradiente que queda. Plano robusto sobre las medianas de una rejilla 12×8 (se rechazan las celdas que quedan por encima, que son objeto) y sus esquinas pasadas por un estirado automático (cielo a 0,10): diferencia entre la esquina más clara y la más oscura. < 0,008 plano; 0,008–0,015 leve; > 0,015 se verá al estirar (pixinsight-mcp). Entre los candidatos que no se comen el objeto se prefiere uno que no se vea.
- Contraste objeto−cielo en cajas de 300 px (≥ 90 % en polvo e IFN).

Se recomienda, entre los que no se comen el objeto (`objeto_quitado_pct` ≤ 3 % y |`copia_objeto`| < 0,3), el que deja el cielo más plano. En una galaxia grande (nov 2026) eso reprodujo la decisión hecha a mano: el modelo por muestras se llevaba el 8,5 %, el de referencia el 1,8 % y el polinomio de grado 2 el 0 % con el cielo igual de plano (13 % del gradiente). Medir el gradiente que queda en toda la imagen, en vez de fuera del objeto, medía la galaxia y daba por bueno al que se la comía.

**Revisar el modelo siempre**, antes de aceptarlo: liso, sin la forma del objeto, sin bordes ni anillo oscuro, y **con el color de la luz parásita** (Jon Rista): pardo si es airglow, dorado o anaranjado si es contaminación lumínica. Manchas azules, magenta o rojas en el modelo = se está llevando el objeto (reflexión, OIII, Hα): quitar muestras de esa zona o subir el suavizado. Si tras corregir el fondo queda más desigual, revisar muestras y máscara en vez de encadenar más pasadas; y no usar el gradiente para tapar una calibración (flats) mala.

**Encadenar dos métodos** puede ganar a cualquiera solo: uno automático de base y otro de acabado (en una toma con mucha contaminación y sin flats, astroimagetw obtuvo lo mejor con un modelo automático seguido de la corrección de gradiente nativa, que además quitó la sombra que dejó el primero). Medir la cadena como un candidato más. Si no convence, hacer la comparativa de candidatos del detalle.

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/lineal.md#lineal-09); en Siril, [Anexo I](../anexos/I-siril.md).

**Control.** Modelo liso y sin objeto; fondo no aplastado con la misma visualización antes y después; contraste objeto−cielo ≥ 90 % en polvo/IFN; la astrometría sigue al terminar. Anillo oscuro alrededor de un objeto extenso = se ha comido el halo: volver atrás y usar plano robusto o muestras manuales.
