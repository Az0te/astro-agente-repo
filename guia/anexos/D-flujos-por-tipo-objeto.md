# Anexo D: Flujos por tipo de objeto

[← Índice](../SKILL.md) · Anterior: [Anexo C: Pendiente de documentar](C-pendiente-documentar.md) · Siguiente: [Anexo E: Parámetros y detalles complementarios](E-parametros-detalle.md)

Material por tipo de objeto que no se ha convertido en paso porque **sustituye** el orden general para un tipo de objeto concreto. Se usa en lugar de los pasos que indique, no además.

**Qué combinación elegir.** Colores naturales y galaxias → RGB, LRGB o LHa-RHaGB; simplicidad e impacto → HOO; separación máxima de rayas → SHO; nebulosa rica con estrellas naturales → SHORGB; grandes campos complejos u objetos mixtos → LSHORGB (L + SHO sin estrellas + estrellas RGB).

**Emisión frente a reflexión.** "Emisión = rayas (contraste alto, colores de paleta); reflexión = continuo, dominante azul natural (azul, no cian), contraste suave, más sensible a gradientes; los halos de la estrella que la ilumina son el problema principal (tomas cortas/HDR para esa estrella). Objetos mixtos (IC 63, NGC 2024, IC 4592): tratar por capas/máscaras, preservar coherencia de color y estrellas; no saturar el azul. Con mono: la reflexión sale de L/RGB, la emisión de la banda estrecha."

**Nebulosa oscura (LDN, Barnard).** "El tema es la silueta; un estirado excesivo la destruye. Textura de polvo con LHE suave; el color de las estrellas del fondo es parte del atractivo. El script clásico DarkStructureEnhance (amount 0,30–0,40, lo lanza el usuario) es una alternativa, pero se basa en restar escalas como el mapa de 'estructuras oscuras' que falló en IC 63: probarlo sólo contra el control sin hacer nada."

Flujo que gustó en LDN 1235 (v2 + v5), en orden:

1. MAS (fondo 0,17, agresividad 0,6, recuperación de contraste 0,5, fondo de referencia en cielo limpio) y curva que separa el polvo del fondo (0,167 → 0,165; 0,18 → 0,215; 0,20 → 0,27).
2. NXT con separación de color: croma 0,90, luminancia 0,40, detalle 0,25.
3. Máscaras de gran escala, calculadas binando 8×, suavizando y ampliando de nuevo: polvo = luminancia entre el cielo y ~+0,03 (incluye cirros débiles, señal real); azul = `(B − (R+G)/2 > 0,010) × (L > cielo + 0,04)`, más una versión ancha (gauss σ 25 binado) para ampliar la zona de reflexión; fondo = inversa del polvo.
4. Polvo: curva de brillo y saturación S 0,5 → 0,66.
5. Fondo: **no oscurecerlo**; abrir sombras sin mover el negro (0,145 → 0,152; 0,17 → 0,185; 0,20 → 0,225) y saturación suave.
6. Reflexiones: brillo con saturación moderada (S 0,5 → 0,56; para un azul más blanquecino, S 0,40 y L 0,4 → 0,45).
7. LHE en luminancia: radio 256 en toda la imagen (0,25) y radio 64 en el polvo (0,20).
8. Quitar verde: `G − 0,85·max(0, G − max(R,B))`.

"Con 2 h 50 min de una sola noche el cuerpo tiene menos estructura que las referencias: forzarla saca ruido. La reducción de estrellas suave ayudaría a que se vea la textura del polvo."

Errores a no repetir en este tipo de objeto: "NXT 0,75 por igual a luminancia y color deja aspecto de plástico; saturar (curva S global) sin quitar antes el ruido de croma amplifica grano de colores y puntos oscuros (mirar SIEMPRE a 100 % sobre las reflexiones, no sólo en el fondo); MultiscaleLinearTransform con bias en las capas 5–7 sobre la imagen en color disparó el ruido (usar LHE, que sólo toca la luminancia); MGC se comió el polvo."

**Galaxias.** Cadena: "pretratamiento → fondo (DBE/ABE/GraXpert/MARS, por canal si hace falta) → BXT → SXT opcional (o ninguno en espirales grandes) → NXT por etapas → stretch progresivo por pasadas (GHS/MAS/Veralux/Statistical) → máscaras/HDR → colores y estrellas → acabado". Proteger bulbo (máscaras con gamma/HDR; tomas cortas si el núcleo satura), revelar brazos y halo sin subir ruido, HII en rosa/rojo y zonas viejas amarillas, polvo oscuro respetado. "SPCC con referencia 'Average Spiral Galaxy'. LRGB + Hα con inyección moderada (k bajo). Espiral: 3 zonas (núcleo proteger, brazos realzar, fondo+IFN levantar sombras con máscara invertida). De canto: el carril de polvo es el tema (máximo contraste a través del carril), sin IFN. Comprobar tras cada curva que la IFN sigue visible."

Parámetros orientativos de aescaffre para galaxias: fondo 0,10; HDRMT 6–7 capas con máscara gamma 1,5; LHE radio 64, amount 0,25 (de canto) a 0,35 (de cara), slopeLimit 1,3–1,5; LRGB lightness 0,35 (de canto) / 0,50 (de cara), saturación 0,70; LinearFit de L a la luminancia RGB antes de combinar; NXT final 0,30; SCNR 0,30–0,35; sin reducción de estrellas. Cúmulos de galaxias: fondo 0,08–0,10, NXT sólo tras estirar (0,25–0,35), LRGB lightness 0,45–0,55, "la diversidad de color entre galaxias es un rasgo".

**Galaxias de gran dinámica (M31).** "Stretch global suave + máscara de protección del núcleo + stretch localizado de extensiones; HDRComposition/HDRMT; LHE/HDRMT ligeros para polvo; reducir estrellas ligeramente si hace falta."

**IFN / cirros.** "Flujo minimalista; gradiente con muestreo amplio; denoise ligero con máscara; stretch suave y progresivo; MMT/LHE con parsimonia; validar con DSS2, Planck, WISE/Hα y otras imágenes; nunca dar por señal estructuras aisladas."

**Planetaria.** "Objeto pequeño, nitidez primordial; el núcleo se quema fácil (estirado contenido, margen 0,10); halo exterior muy débil; zonas OIII/Hα por máscaras; inyección de Hα siempre con máscara."

**Resto de supernova.** "Los filamentos son el tema (LHE fino, no suavizar hilos); Hα y OIII muestran estructuras distintas."

**Cúmulos.** "Las estrellas son el objeto (no SXT; color estelar como protagonista; globulares: BXT clave, núcleo con margen). Cúmulos abiertos brillantes (Joyero): HDR con varias exposiciones (p. ej. 300, 30, 5 s y 0,3 s) y color estelar como objetivo."

**Dual band OSC.** "Extraer Hα/OIII (DBXtract, su emulación con PixelMath o NBExtractPI), tratar cada raya por separado (denoise, deconvolución, gradiente, stretch, máscaras, contraste local), recombinar HOO (Hα→R, OIII→G+B) o bicolor; estrellas del OSC (color natural) o separadas."

**Paleta Hubble (SHO) sin SPCC.** "Calibrar en lineal con BackgroundNeutralization (preview de fondo) + ColorCalibration con preview de la nebulosa como blanco y **'Structure detection' desactivado** (cuenta toda la luz de la nebulosa, no sólo estrellas). Lo mismo con la imagen completa como blanco en campos estelares sin SPCC."

---
