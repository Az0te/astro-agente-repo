# Paso 12: SPCC

[← Índice](../SKILL.md) · Anterior: [Paso 11: BlurX correct only](11-bxt-correct-only.md) · Siguiente: [Paso 13: BlurX completo](13-bxt-completo.md)

**Por qué.** El color no se inventa: "El color sale de SPCC (o, sin SPCC, de neutralización del fondo + calibración por estrellas). Si SPCC no se puede aplicar, se para.". SPCC compara el flujo medido en las estrellas con un catálogo espectrofotométrico y deduce la calibración de los canales; por eso necesita estrellas bien perfiladas (Paso 11), solución astrométrica y datos lineales.

**Requisitos, uno por uno**

| Requisito | Detalle |
|---|---|
| Solución astrométrica | Sin ella falla: "The image has no valid astrometric solution" |
| Datos lineales | "SPCC sólo sobre datos lineales. Nunca calibrar una imagen ya estirada" |
| Curvas de cámara y filtros | Cargar las curvas por su nombre desde la base de filtros del programa. Los nombres de filtro y QE de cada equipo están en el perfil |
| Sin curvas indicadas | Calibrar sin indicar las curvas usa curvas genéricas, no las de la cámara |
| Referencia de blanco | "Average Spiral Galaxy" (valor por defecto) |
| OSC | Curva QE 'Ideal' (las curvas de filtro ya incluyen la QE del sensor) y elegir bien el filtro dual band |
| Mono | Curva QE real del sensor y los filtros de la rueda. Si el sensor no está en la base (p. ej. KAF-11000), «Ideal QE curve» y los filtros reales (Astrodon: «Astrodon E-series R/G/B» o «I-series»); decirlo en el informe |
| Narrowband | El filtro dual band de la base de filtros; en mono, combinar S,H,O (o H,O,O) en RGB, SPCC en modo narrowband con longitud de onda y ancho de cada filtro, y volver a extraer los canales |

**Si SPCC falla.** "Si SPCC falla, SCNR como recurso (aescaffre 0,65 en verde; nosotros preferimos suave)". No es una alternativa válida a la calibración: es un recurso estético posterior.

**Si no hay calibración fotométrica posible.** Antes de parar, en este orden:

1. **Cámara sin curvas en la base de filtros** (muchas DSLR): calibración fotométrica sin curvas (PCC), que sólo necesita el catálogo de estrellas. No usar las curvas de otra cámara "parecida".
2. **Catálogo inaccesible** (sin internet, servidor caído): el catálogo instalado en local si lo hay.
3. **Ni catálogo ni curvas:** equilibrado aproximado, que es lo que esta guía admite "sin SPCC": neutralizar el fondo (cada canal a la misma mediana del cielo, medida en las celdas más oscuras) y equilibrar el blanco con el color medio de las estrellas no saturadas (o de las zonas brillantes de una galaxia espiral grande). Se aplica en lineal, con deshacer, y **se dice en el informe que el color es aproximado**. De media las estrellas de campo son algo amarillentas, así que el blanco queda un poco más frío que con SPCC. Comprobar la dispersión de color de las estrellas y la dominante del cielo después.

Lo que no se hace en ningún caso es ajustar el color a ojo, ni copiar la calibración de otra foto.

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/lineal.md#lineal-12); en Siril, [Anexo I](../anexos/I-siril.md).

**Dónde neutralizar.** Sobre la **starless lineal** (la que se va a estirar) y midiendo en las mismas celdas que mide el estirado: hecho sobre la imagen con estrellas antes de separarlas, la dominante vuelve al estirar la starless. Las funciones de estirado lo hacen solas por defecto (desplazamiento aditivo, no cambia el objeto). Una dominante azul o roja no se arregla con SCNR, que sólo quita verde.

**Cielo descompensado tras la calibración de color.** Si el cielo por canal queda a más de 0,5 sigmas, o el estirado sale con dominante en el cielo (> 5 %), neutralizar el fondo en lineal de forma **aditiva**: sumar a cada canal lo que le falta para igualar su cielo al del canal más alto (no resta, no recorta sombras y no cambia el balance más que ese desplazamiento constante). Medir en el 10 % de celdas de 64 px más oscuras; si son polvo o nebulosa oscura con color propio, usar un trozo de cielo limpio. Vale sobre la starless lineal, sin rehacer la deconvolución ni la separación de estrellas. No es un apaño de color: es la neutralización de fondo que la guía ya admite junto a la calibración.

**Campo lleno de nebulosa.** Si más del 60 % del campo tiene señal sobre el cielo (Nubes de Magallanes, regiones HII extensas), las celdas «más oscuras» siguen siendo emisión y el cielo sale con dominante (roja de Hα) después de la calibración: es señal, no un fallo. La herramienta lo da como aviso, no como `no_cumple`. No neutralizar sin un trozo de cielo limpio; si de esa RGB sólo se usan las estrellas (paleta de banda estrecha), da igual.

**Dos RGB del mismo campo que no coinciden.** Si hay dos juegos (largo y corto) y, calibrados igual, dan colores de estrella distintos (Tarántula, nov 2026: relación azul/rojo media de la capa de estrellas ×1,36 en la larga y ×0,64 en la corta), fiarse del que tenga los canales **equilibrados**: un número de subs parecido por canal y FWHM iguales entre canales tras la deconvolución de corrección. La larga tenía 5 subs de azul frente a 56 de rojo y FWHM de 6,0–6,5 px; la corta, 30/30/30 y 5,4–5,5 px.

**Control.** Medianas de R, G y B en zonas de cielo limpio parecidas tras la calibración; si un canal se aparta, revisar la referencia de fondo antes de seguir. Un fondo más azul que rojo **después** de SPCC ya no es "color del cielo sin calibrar": es un problema a investigar (gradiente, flats, extinción).
