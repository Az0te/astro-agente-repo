# Anexo D: Flujos por tipo de objeto

[← Índice](../SKILL.md) · Anterior: [Anexo C: Pendiente de documentar](C-pendiente-documentar.md) · Siguiente: [Anexo E: Parámetros y detalles complementarios](E-parametros-detalle.md)

Material por tipo de objeto que no se ha convertido en paso porque **sustituye** el orden general para un tipo de objeto concreto. Se usa en lugar de los pasos que indique, no además.

**Qué combinación elegir.** Colores naturales y galaxias → RGB, LRGB o LHa-RHaGB; simplicidad e impacto → HOO; separación máxima de rayas → SHO; nebulosa rica con estrellas naturales → SHORGB; grandes campos complejos u objetos mixtos → LSHORGB (L + SHO sin estrellas + estrellas RGB).

**Emisión frente a reflexión.** "Emisión = rayas (contraste alto, colores de paleta); reflexión = continuo, dominante azul natural (azul, no cian), contraste suave, más sensible a gradientes; los halos de la estrella que la ilumina son el problema principal (tomas cortas/HDR para esa estrella). Objetos mixtos: tratar por capas/máscaras, preservar coherencia de color y estrellas; no saturar el azul. Con mono: la reflexión sale de L/RGB, la emisión de la banda estrecha."

**Nebulosa oscura (LDN, Barnard).** "El tema es la silueta; un estirado excesivo la destruye. Textura de polvo con contraste local suave; el color de las estrellas del fondo es parte del atractivo."

Flujo que gustó en una nebulosa oscura (v2 + v5), en orden:

1. Estirado adaptativo multiescala (fondo 0,17, agresividad 0,6, recuperación de contraste 0,5, fondo de referencia en cielo limpio) y curva que separa el polvo del fondo (0,167 → 0,165; 0,18 → 0,215; 0,20 → 0,27).
2. NXT con separación de color: croma 0,90, luminancia 0,40, detalle 0,25.
3. Máscaras de gran escala, calculadas binando 8×, suavizando y ampliando de nuevo: polvo = luminancia entre el cielo y ~+0,03 (incluye cirros débiles, señal real); azul = `(B − (R+G)/2 > 0,010) × (L > cielo + 0,04)`, más una versión ancha (gauss σ 25 binado) para ampliar la zona de reflexión; fondo = inversa del polvo.
4. Polvo: curva de brillo y saturación S 0,5 → 0,66.
5. Fondo: **no oscurecerlo**; abrir sombras sin mover el negro (0,145 → 0,152; 0,17 → 0,185; 0,20 → 0,225) y saturación suave.
6. Reflexiones: brillo con saturación moderada (S 0,5 → 0,56; para un azul más blanquecino, S 0,40 y L 0,4 → 0,45).
7. Contraste local en luminancia: radio 256 en toda la imagen (0,25) y radio 64 en el polvo (0,20).
8. Quitar verde: `G − 0,85·max(0, G − max(R,B))`.

"Con 2 h 50 min de una sola noche el cuerpo tiene menos estructura que las referencias: forzarla saca ruido. La reducción de estrellas suave ayudaría a que se vea la textura del polvo."

Errores a no repetir en este tipo de objeto: "NXT 0,75 por igual a luminancia y color deja aspecto de plástico; saturar (curva S global) sin quitar antes el ruido de croma amplifica grano de colores y puntos oscuros (mirar SIEMPRE a 100 % sobre las reflexiones, no sólo en el fondo); realzar las capas 5–7 de una transformada multiescala sobre la imagen en color disparó el ruido (usar contraste local, que sólo toca la luminancia); el modelo de fondo con referencia se comió el polvo."

**Galaxias.** Cadena: "pretratamiento → fondo (DBE/ABE/GraXpert/MARS, por canal si hace falta) → BXT → SXT opcional (o ninguno en espirales grandes) → NXT por etapas → stretch progresivo por pasadas (GHS/MAS/Veralux/Statistical) → máscaras/HDR → colores y estrellas → acabado". Proteger bulbo (máscaras con gamma/HDR; tomas cortas si el núcleo satura), revelar brazos y halo sin subir ruido, HII en rosa/rojo y zonas viejas amarillas, polvo oscuro respetado. "SPCC con referencia 'Average Spiral Galaxy'. LRGB + Hα con inyección moderada (k bajo). Espiral: 3 zonas (núcleo proteger, brazos realzar, fondo+IFN levantar sombras con máscara invertida). De canto: el carril de polvo es el tema (máximo contraste a través del carril), sin IFN. Comprobar tras cada curva que la IFN sigue visible."

Parámetros orientativos de aescaffre para galaxias: fondo 0,10; compresión multiescala 6–7 capas con máscara gamma 1,5; contraste local radio 64, amount 0,25 (de canto) a 0,35 (de cara), slopeLimit 1,3–1,5; LRGB lightness 0,35 (de canto) / 0,50 (de cara), saturación 0,70; ajuste lineal de L a la luminancia RGB antes de combinar; NXT final 0,30; SCNR 0,30–0,35; sin reducción de estrellas. Cúmulos de galaxias: fondo 0,08–0,10, NXT sólo tras estirar (0,25–0,35), LRGB lightness 0,45–0,55, "la diversidad de color entre galaxias es un rasgo".

**Galaxias de gran dinámica.** "Stretch global suave + máscara de protección del núcleo + stretch localizado de extensiones; composición HDR / compresión multiescala; contraste local o compresión ligeros para polvo; reducir estrellas ligeramente si hace falta."

Cadena que funcionó en una galaxia grande (versión de referencia, oct 2026) y que la comparación con un modelo local (7 nov 2026) confirmó por lo que faltó:

1. Lineal: gradiente polinomio grado 2 → BXT correct only → SPCC → BXT (estrellas 0,25, halos 0, no estelar 0,65) → SXT → **un** NXT lineal moderado. Checkpoint con el cielo neutro (≤ 0,5 σ); si no, neutralizar el cielo antes de estirar.
2. Estirado de galaxia: cielo 0,07; las estrellas, en el Paso 8, con el mismo estirado que la starless. SXT se lleva a veces los núcleos de la galaxia y de sus satélites: devolverlos a la starless.
3. Comprimir el núcleo: compresión multiescala de 7 capas al 60 % con máscara de bulbo. Nunca a pleno ni contraste local de radio 200 sobre el bulbo (anillo y bulbo plano).
4. Contraste local r64 (y r32 para más detalle) sólo en el disco, con máscara galaxia × (1 − bulbo).
5. Saturación al fallo (galaxia), o por tono con la misma máscara: sin excluir el bulbo, el núcleo recorta).
6. Estrellas: preparar la capa y recombinar; comprobar `aporte_estrellas_pct`.

Sin los pasos 2–4 (modelo local, 7 nov 2026): 269 estrellas detectables frente a 13 721, núcleo y la galaxia satélite como una meseta de 22 px y fondo con manchas de color (R/G del cielo 0,70–1,24 frente a 0,94–1,04).

**IFN / cirros.** "Flujo minimalista; gradiente con muestreo amplio; denoise ligero con máscara; stretch suave y progresivo; MMT/LHE con parsimonia; validar con DSS2, Planck, WISE/Hα y otras imágenes; nunca dar por señal estructuras aisladas."

**Planetaria.** "Objeto pequeño, nitidez primordial; el núcleo se quema fácil (estirado contenido, margen 0,10); halo exterior muy débil; zonas OIII/Hα por máscaras; inyección de Hα siempre con máscara."

**Resto de supernova.** "Los filamentos son el tema (contraste local fino, no suavizar hilos); Hα y OIII muestran estructuras distintas."

**Cúmulos.** "Las estrellas son el objeto (no SXT; color estelar como protagonista; globulares: BXT clave, núcleo con margen). Cúmulos abiertos brillantes: HDR con varias exposiciones (p. ej. 300, 30, 5 s y 0,3 s) y color estelar como objetivo."

**Dual band OSC.** "Extraer Hα/OIII (emulación de DBXtract, Paso 7 lineal), tratar cada raya por separado (denoise, deconvolución, gradiente, stretch, máscaras, contraste local), recombinar HOO (Hα→R, OIII→G+B) o bicolor; estrellas del OSC (color natural) o separadas."

**Paleta Hubble (SHO) sin SPCC.** "Calibrar en lineal con BackgroundNeutralization (preview de fondo) + ColorCalibration con preview de la nebulosa como blanco y **'Structure detection' desactivado** (cuenta toda la luz de la nebulosa, no sólo estrellas). Lo mismo con la imagen completa como blanco en campos estelares sin SPCC."

---
