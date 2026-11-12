# Paso 1: Análisis del objeto

[← Índice](../SKILL.md) · Anterior: [Índice](../SKILL.md) · Siguiente: [Paso 2: Inventario](02-inventario.md)

**Por qué.** El tipo de objeto decide las máscaras, el estirado, si se separan estrellas y si hacen falta tomas cortas/HDR. Procesar sin haber fijado "cuál es el tema" lleva a realzar lo que no importa y a destruir lo que sí (una nebulosa oscura con un estirado pensado para una nebulosa de emisión, por ejemplo).

**Qué hay que responder antes de tocar nada.** "Antes de procesar, clasificar el objeto y fijar qué es 'el tema' (aescaffre, target-taxonomy): tipo de señal (banda ancha, dominada por Hα, dual), zonas (núcleo–halo, filamentos, multizona), papel de las estrellas (son el objeto / contexto / distracción) y meta de señal débil (IFN, halo exterior, filamentos). Eso decide máscaras, estirado, si se separan estrellas y si hacen falta tomas cortas/HDR."

**Estrellas masivas, halos y bloat.** No se decide "a ojo": hay tres diagnósticos que no hay que confundir:

| Síntoma | Diagnóstico | Dónde se arregla |
|---|---|---|
| Fondo más azul que rojo antes de calibrar | Color del cielo y de la cámara sin calibrar, **no** blue bloat | SPCC (Paso 12) |
| Estrellas más grandes en el azul que en R/G | Blue bloat (dispersión/aberración cromática, reflexiones del filtro dual) | BXT Correct Only (Paso 11) y, si no basta, [Anexo E: blue bloat](../anexos/E-parametros-detalle.md#blue-bloat-y-halos-azules) |
| Anillos de color alrededor de una estrella brillante | Halo: nubes finas/calima en algunos subs, o reflejo instrumental | Quitar subs (Paso 3) o restar halo (Fase No Lineal 8) |
| Estrella brillante con núcleo blanco sin detalle | Saturación: en OSC los canales saturan a distinto nivel y el rojo suele saturar antes | Tomas cortas / HDR (Paso 6) |

"Lo mejor es no generarlos: tomas cortas y HDR para las estrellas brillantes, y descartar subs con halos de nubes finas (índice de halo por sub)."

**Checklist del análisis**

1. Tipo de objeto y "el tema" ([Anexo D](../anexos/D-flujos-por-tipo-objeto.md): galaxia, emisión, reflexión, oscura, planetaria, resto de supernova, cúmulo, IFN).
2. ¿Hay banda estrecha? Sin ella no hay paletas.
3. Estrella más brillante del campo y magnitud: decide si hacen falta tomas cortas y a qué exposición.
4. ¿El objeto llena el campo o se difumina en el fondo? (galaxia grande, nebulosas extensas, polvo): riesgo de anillo oscuro en la corrección de gradiente y de que la IA se coma el objeto.
5. ¿Hay IFN/polvo? Desconfiar de los modelos de fondo con base de referencia y de cualquier extractor agresivo.
6. Régimen de muestreo: submuestreado / bien muestreado / sobremuestreado (drizzle 2x), que condiciona BXT, NXT y nitidez.
7. **¿Bordes sin datos?** (`bordes_sin_datos` del análisis). Un master registrado sin recortar tiene cuñas en los bordes; el preprocesado puede rellenarlas con un valor constante, no con 0, y a ojo se confunden con cielo oscuro. Con varios masters, lo primero es el [Paso 5: alinear y recortar](05-staralignment-crop.md); con uno solo, recortar los bordes. Gradiente, BXT, SPCC o desmezcla con cuñas dan resultados falsos (la comparación de gradientes se niega).

8. **¿De quién son los datos?** Si junto a los masters hay un texto del autor (equipo, filtros, exposiciones, escala, notas) o las cabeceras dicen otra cámara y otro telescopio, son **datos de terceros**: el equipo, los filtros y las curvas salen de ese texto y de las cabeceras, **nunca del perfil del usuario**. Leer también sus notas: «subs cortos para el color de las estrellas», «flats mal hechos en tal canal», canales binados y reescalados. Ejemplo (nebulosa de la Tarántula, mono, nov 2026): el texto daba la RGB corta de 30 s para las estrellas, y la RGB larga, con sólo 5 subs en azul, daba las estrellas azules.
9. **¿Campo muy denso en estrellas?** (Nubes de Magallanes, plano de la Vía Láctea). La capa de estrellas no tendrá el fondo a cero y la preparación de estrellas y la recombinación se adaptan (Paso 8 no lineal).

**Estado de partida del master**

- Por canal: mediana, máximo y MAD; además canales, bits por muestra, si es color y si tiene solución astrométrica.
- Todo eso lo devuelve la herramienta de análisis; las estadísticas dan sólo los valores por canal.

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/lineal.md#lineal-01); en Siril, [Anexo I](../anexos/I-siril.md).

**Control.** La mediana de un master lineal está en torno a 0,001–0,02 (con pedestal puede pasar de 0,01: el de una nebulosa oscura da 0,0102). Si es mucho mayor (> 0,05), la imagen ya está estirada y no es la entrada correcta. Máximos por canal muy distintos = saturación desigual, no fallo de color.
