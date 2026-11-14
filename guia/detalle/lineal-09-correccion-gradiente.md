# Detalle del Paso 9 lineal: Corrección de gradiente

[← Ficha del paso](../lineal/09-correccion-gradiente.md) · [Índice](../SKILL.md) · En PixInsight: [Anexo J, detalle](../anexos/J-pixinsight/detalle.md#lineal-09)

Material de apoyo de la ficha: medidas, funcionamiento de GraXpert y de los modelos con base de referencia, y el protocolo para comparar métodos cuando el modelo no convence. La ficha manda. Los nombres de procesos, funciones y ventanas de cada programa están en su anexo.

**Por qué.** El gradiente es un offset de gran escala que no pertenece al objeto: contamina la calibración de color (que mide el fondo), aplasta el contraste del polvo y del IFN y aparece como un velo al estirar. Y se corrige **en lineal y por canal**, antes de combinar: "Si los canales tienen gradientes distintos (otras noches/filtros/cámaras), corregir por canal antes de combinar". Un gradiente que llega al estirado ya no se puede separar de la señal débil.

**Sin método predeterminado** (decisión del usuario, 5 nov 2026): se comparan los candidatos en cada imagen y se aplica el que mejor mida. GraXpert sample_free escala 10 por sustracción fue el mejor en la prueba de la tabla de abajo, pero en una galaxia grande ganó un polinomio de grado 2.

**Cadena de pasos alrededor del gradiente**

| Caso | Cadena documentada |
|---|---|
| GraXpert | Recorte → astrometría → **GraXpert sample_free 10** (conservar la astrometría) → deconvolución "sólo corregir" → comprobar la astrometría → calibración de color |
| Modelo con base de referencia | Recorte → astrometría → calibración de flujo fotométrico → **modelo con base de referencia** → calibración de color |
| Banda estrecha sin base de referencia | "polinomio suave propio sobre rejilla de medianas con rechazo sigma (grado 2 en OIII; en Hα sólo plano grado 1 ajustado en bordes, para no comerse emisión difusa real)" |

**Sustracción o división**

- Corrección **por sustracción** para gradientes de contaminación lumínica (aditivos).
- **Por división** sólo para viñeteo residual (multiplicativo, flats imperfectos).
- "Ante la duda probar las dos y comparar el modelo."

**GraXpert en detalle**

- Programa independiente (Dark Matters); desde la v3.1 también tiene modelos de denoise y deconvolución, que "no sustituyen a NXT/BXT".
- Fondo de cada muestra: sigma-clipping (> 3σ de la mediana y píxeles a < 4 px de ellos, iterando) y mediana del resto.
- **Salida por sustracción:** `resultado = original − modelo + media(modelo)`, con la media **de los tres canales juntos**: además de quitar el gradiente, **neutraliza el color del fondo**. El modelo con base de referencia no lo hace. Al comparar, medir el color del fondo después de calibrar el color, no antes.
- **Salida por división:** `original / modelo × media(modelo)` con la media **por canal**.
- Extrae el fondo con un modelo de IA o con métodos clásicos sobre puntos de muestra: splines, funciones de base radial (thin-plate, lineal, cúbica, quíntica, con suavizado), kriging y sample_free.
- Se puede llamar desde el programa (proceso o interfaz propia) o por línea de comandos; en PixInsight los dos dan el mismo resultado (comparativa en el Anexo J). Si cambia la versión de GraXpert, confirmar las opciones con `GraXpert -cli -cmd background-extraction -h`.
- Su denoise "es una alternativa a comparar con NXT, no un sustituto".

**Ajustes de partida (medidos el 29 oct 2026 en galaxia grande, nebulosa oscura, nebulosa dual band y nebulosa de emisión y reflexión)**

| Ajuste | Instrucción |
|---|---|
| Base | sample_free, escala 10, sustracción: el que menos objeto copia en el modelo en los cuatro casos |
| Escala 8 | "si queda gradiente en el cielo: copia un poco más, pero deja el fondo más plano" |
| Escala por defecto de sample_free | **No usarla**: se comió el 18 % de una galaxia grande y copió la estructura de una nebulosa dual band |
| `-sample_free_simplified true` | Peor: 30 % de una galaxia grande |
| `-sample_free_protect` | "no cambia nada" en GraXpert 4.0.0 (resultados idénticos activado o no) |
| IA | El suavizado casi no influye (de 0 a 1: galaxia grande pasó de 21,5 % a 17,9 %); se come objetos extensos (bulbo y halo de una galaxia grande, nubes de una nebulosa dual band, halo de la estrella brillante). Sólo con objetos pequeños en campo amplio, o si sample_free deja un gradiente complejo, y siempre revisando el modelo |
| División | Sólo para viñeteo residual |
| Tiempo | IA ~4 s y sample_free ~14 s en una imagen de 6000×4000 con GPU |
| Gradiente residual liso | "quitarlo con el plano robusto de grado 1 (no puede comerse formas) en vez de bajar la escala" |

**Tabla de resultados de GraXpert 4.0.0** ("copia" = estructura del original copiada en el modelo, `copia_objeto`, correlación entre paréntesis; "come" = señal del objeto en el modelo)

| Objeto | IA s0,1 | IA s1,0 | SF por defecto | SF escala 8 | SF escala 10 |
|---|---|---|---|---|---|
| galaxia grande | come 21 %, copia 6 % (0,56) | come 18 % (0,51) | come 18 % (0,09) | come 6,6 % (0,07) | **come 4 % (0,10)** |
| nebulosa oscura | copia 0,1 % (0,02) | — | copia 2 % (0,18) | copia 1,2 % (0,15) | **copia 0,8 % (0,13)** |
| nebulosa dual band (llena el campo) | copia 48 % (0,79) | IA s0,5: 37 % (0,74) | copia 39 % (0,76) | copia 22 % (0,68) | **copia 14 % (0,61)** |
| nebulosa de emisión y reflexión  | modelo con mancha en la estrella brillante | — | estructura alrededor del fantasma | liso | liso |

Masters lineales sin tocar (nebulosa dual band, nebulosa oscura y una nebulosa de emisión y reflexión binados ×2), luminancia binada ×8, con deconvolución "sólo corregir" previa. En nebulosa de emisión y reflexión la medida está dominada por el halo de la estrella brillante: se juzgó a la vista. Conclusión: **sample_free escala 10 como punto de partida**; en nebulosas que llenan el campo (nebulosa dual band) aún copia algo: revisar el modelo y, si hace falta, comparar con el plano robusto o RBF con muestras propias.

Resultados anteriores, sin GraXpert: nebulosa oscura → ganó el plano de grado 1, el modelo con base de referencia (escalas 2048/4096) se comió el 75 % del contraste del polvo; nebulosa de emisión y reflexión → modelo con base de referencia, sin comparar con otros métodos.

**Modelo con base de referencia** (en PixInsight, MGC con la base MARS)

- Modelo: `I ≈ k·R + G + ε` (imagen = factor × referencia de cielo sin gradiente + gradiente + ruido). Prerrequisitos en orden: master lineal recortado (sin bordes de apilado) → astrometría **correcta** → calibración de flujo fotométrico → modelo → calibración de color. Correlación ≈ 0 con la base = la base no cubre ese campo o la astrometría está mal.
- Parámetros: escala del gradiente (pequeña = riesgo de absorber cielo real; grande = subcorrección), separación de estructuras, suavizado del modelo, factores de escala por canal y filtro de gris en mono. **Factores de escala automáticos** (ajustados a la imagen): con factores fijos a 1,0 se comió el 3–4 % de una galaxia grande; con automáticos (correlación con la base 0,98–0,99), ≈ 0 % (nov 2026).
- Corrección de bordes: modela aparte la franja del borde; agresividad 2 de partida. No quita del todo las manchas que deja en el resto del campo: ahí, encadenar con cielo con máscara (ficha) y medir.
- Diagnóstico: modelo liso, sin objeto fantasma, sin bordes, fondo corregido no aplastado, misma visualización antes/después, control por canal. "El modelo de gradiente es la prueba." Si la nebulosa aparece en el modelo, el brillo de los objetos está infravalorado (subir escala); si aparece en negativo, sobrevalorado.
- **Medirlo, no sólo mirarlo:** medianas en cajas de 300 px sobre el objeto y sobre el cielo cercano, antes y después. En nebulosa oscura, con escala 2048 y 4096 el modelo reproducía el borde del tiburón y el contraste polvo−cielo bajaba de 1,16 a 0,26–0,30 ×10⁻⁴ (−75 %). "**En nebulosas oscuras, IFN y polvo extenso, desconfiar del modelo con base de referencia.**"
- No es el método predeterminado: es un candidato más en la comparativa.

**Manchas de color que deja el modelo en objetos grandes y difusos** (nov 2026, galaxia grande)

- Diagnosticar antes de corregir. Para cada mancha del cielo, medir en qué canal está, si es un exceso o un hueco respecto al cielo y si sigue al objeto (cerca de él y repetida al otro lado). **La señal real sólo suma luz**: un hueco, o una mancha casi en un solo canal, es un artefacto (luz parásita, planos) y se puede corregir; un exceso en los tres canales, cerca del objeto y simétrico, es halo real y no se quita. En el caso estudiado, la mancha amarilla era un hueco casi sólo en azul (−0,2…−0,4 % del cielo en B, R y G ≈ 0); dos modelos que no midieron esto la tomaron por halo y la dejaron.
- Causa frecuente: la máscara del objeto se queda corta. El halo exterior entra como «cielo», el polinomio se curva para seguirlo y deja manchas alrededor.
- Remedio que ganó: **polinomio de grado 2 por canal ajustado sólo fuera del objeto agrandado** (elipse del objeto ×1,1; las compañeras, fuera también) y, después, **corrección de crominancia**: medianas de R−G y B−G en cajas de cielo (~1/21 del lado menor, ≥ 60 % de cielo, con rechazo de estrellas), una superficie suave (thin-plate con suavizado y rechazo de cajas a 2,5σ) y restarla de R y de B. La luminancia sólo recibe el polinomio, así que no se lleva halo débil ni IFN. Manchas de color de 0,038 a 0,016 con el objeto intacto, mejor que spline por canal o un término de halo en el ajuste (0,023–0,025).
- Trampas: la elipse para las cajas de color no debe llevar margen extra (con ×1,25 se perdían las cajas de las esquinas, la superficie extrapolaba allí y no mejoraba nada). Bajo el objeto la corrección es interpolada: no se puede verificar.

**Extracción por muestras manuales (referencia clásica)**: "tolerancia ~2,0, shadows relaxation ~6, pocas muestras (gradiente = gran escala), nunca sobre nebulosa".

**Plano robusto (control conservador).** "Plano robusto de grado 1 (rejilla 24×16 de medianas, mínimos cuadrados con rechazo iterativo a 2σ) restado por canal. No puede crear ni borrar formas; antes, confirmar en una vista binada con mediana que el gradiente es liso (en una nebulosa oscura, brillo verdoso hacia arriba a la derecha)."

**Protocolo de comparativa** (cuando el modelo de GraXpert no convence: correlación de `copia_objeto` alta o forma del objeto visible en el modelo). Las herramientas `gradienteCandidatos` de cada programa hacen casi todo esto en una llamada.

1. Entrada común: el mismo master lineal, recortado y con astrometría, en el punto del flujo en que se va a corregir (antes de la deconvolución "sólo corregir"). Guardar una copia intacta.
2. Candidatos, cada uno a una vista o fichero nuevo: modelo con base de referencia (escalas 1024/2048/4096 si hay duda); GraXpert sample_free escala 10 y 8, y GraXpert IA; GraXpert RBF con muestras manuales si el objeto llena el campo; plano robusto grado 1 (y 2 si el gradiente es curvo); muestras manuales (opcional). Guardar también el modelo de cada uno.
3. Métricas:
   - **Forma del objeto en el modelo** (`copia_objeto`): correlación entre el modelo (sin su ajuste de grado 1) y una máscara del objeto (luminancia suavizada por encima de cielo + 3σ). Cerca de 0 = bien; positiva = se come el objeto; negativa = lo infla. **< 0,15 = limpio; > 0,5 = se come el objeto.**
   - **Contraste objeto−cielo:** medianas en 4–6 cajas fijas (300 px) sobre el objeto y sobre cielo cercano, % conservado respecto al original. Penalizar < 90 % en polvo/IFN.
   - **Planitud del fondo:** rejilla 8×8 de medianas sigma-clipped sólo en cajas de cielo; rango y σ por canal.
   - **Color del fondo:** R/G y B/G en la rejilla, medido **después de calibrar el color** en todos.
   - **Anillo oscuro:** perfil radial alrededor del objeto (objetos extensos): mínimo por debajo del cielo lejano = sobrecorrección.
   - **Ruido:** σ en cajas de cielo antes y después.
4. Vista: tríptico original / corregido / modelo con la misma visualización, más una plancha con los modelos de todos los candidatos; comprobar también con un estirado agresivo.
5. Decisión: gana el que conserva el contraste del objeto con el fondo más plano y sin anillo; en empate, GraXpert sample_free escala 10.
6. Registrar el resultado (objeto, tipo, ganador, métricas clave, notas) y guardar también el modelo de cada candidato.

**Revisión del modelo.** "Confirmarlo a la vista con el modelo menos su gradiente liso: cualquier forma reconocible del objeto es señal perdida." Revisar siempre el modelo: "liso, sin la forma del objeto y sin anillo oscuro".

**Control.** Modelo liso, sin objeto fantasma, sin bordes, fondo no aplastado, misma visualización antes/después. Medir el contraste objeto−cielo en cajas de 300 px (no debe bajar del 90 % en polvo/IFN). Comprobar que la imagen conserva la astrometría al terminar. Si aparece un anillo oscuro alrededor de un objeto extenso, el extractor se ha comido el halo: volver atrás y usar plano robusto o muestras manuales.

> **Orden.** El gradiente se corrige antes de la deconvolución "sólo corregir", como en los flujos de astro-photographie (gradiente → deconvolución sólo corregir → astrometría → color). La tabla de GraXpert se midió con la deconvolución previa; como el modelo de fondo es de gran escala y "sólo corregir" sólo cambia el perfil de las estrellas, no se espera que el orden cambie el resultado, pero no está medido (Anexo C).
