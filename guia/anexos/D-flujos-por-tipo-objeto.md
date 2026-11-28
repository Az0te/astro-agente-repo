# Anexo D: Flujos por tipo de objeto

[← Índice](../SKILL.md) · Anterior: [Anexo C: Pendiente de documentar](C-pendiente-documentar.md) · Siguiente: [Anexo E: Parámetros y detalles complementarios](E-parametros-detalle.md)

Material por tipo de objeto que no se ha convertido en paso porque **sustituye** el orden general para un tipo de objeto concreto. Se usa en lugar de los pasos que indique, no además.

**Qué combinación elegir.** Colores naturales y galaxias → RGB, LRGB o LHa-RHaGB; simplicidad e impacto → HOO; separación máxima de rayas → SHO; nebulosa rica con estrellas naturales → SHORGB; grandes campos complejos u objetos mixtos → LSHORGB (L + SHO sin estrellas + estrellas RGB).

**Emisión frente a reflexión.** "Emisión = rayas (contraste alto, colores de paleta); reflexión = continuo, dominante azul natural (azul, no cian), contraste suave, más sensible a gradientes; los halos de la estrella que la ilumina son el problema principal (tomas cortas/HDR para esa estrella). Objetos mixtos: tratar por capas/máscaras, preservar coherencia de color y estrellas; no saturar el azul. Con mono: la reflexión sale de L/RGB, la emisión de la banda estrecha."

**Nebulosa oscura (LDN, Barnard).** "El tema es la silueta; un estirado excesivo la destruye. Textura de polvo con contraste local suave; el color de las estrellas del fondo es parte del atractivo."

Flujo que gustó en una nebulosa oscura (v2 + v5), en orden:

1. Estirado adaptativo multiescala (fondo 0,17 en la receta original: histórico, no usar como objetivo; cielo 0,12 en nebulosas oscuras, Paso 1 no lineal; agresividad 0,6, recuperación de contraste 0,5, fondo de referencia en cielo limpio) y curva que separa el polvo del fondo (0,167 → 0,165; 0,18 → 0,215; 0,20 → 0,27).
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

Parámetros orientativos de aescaffre para galaxias: fondo 0,10 (histórico, no usar como objetivo: en galaxias, cielo 0,07); compresión multiescala 6–7 capas con máscara gamma 1,5; contraste local radio 64, amount 0,25 (de canto) a 0,35 (de cara), slopeLimit 1,3–1,5; LRGB lightness 0,35 (de canto) / 0,50 (de cara), saturación 0,70; ajuste lineal de L a la luminancia RGB antes de combinar; NXT final 0,30; SCNR 0,30–0,35; sin reducción de estrellas. Cúmulos de galaxias: fondo 0,08–0,10, NXT sólo tras estirar (0,25–0,35), LRGB lightness 0,45–0,55, "la diversidad de color entre galaxias es un rasgo".

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


<a id="cometas"></a>
**Cometas** (27 nov 2026, de tutoriales de cometas; sin pasada propia todavía). El cometa se mueve contra las estrellas durante la sesión: alineado en las estrellas sale corrido, y alineado en el núcleo las estrellas salen en trazos. Por eso se hacen **dos apilados** (estrellas y cometa), cada uno por su camino, y se unen al final. Lo que más se estropea: la cola débil (con el gradiente, el rechazo o el separador de estrellas) y el verde de la coma (con SCNR).

Flujo, en orden (sustituye lo que se indica en cada paso; lo demás, como siempre):

1. **Análisis** (Paso 1 lineal). Apuntar si hay cola y de qué tipo (de polvo: ancha, curva, amarillenta; iónica: estrecha, recta, azulada, con nudos), o si sólo hay coma redonda. Apuntar también la duración de la sesión, si el cometa estaba bajo (el gradiente cambia durante la sesión) y qué calibración hay (con una DSLR, a menudo ninguna).
2. **Preprocesado y dos apilados** (Paso 4, [Cometas: dos apilados](../lineal/04-preprocesado.md#cometas)).
   - Calibración si la hay. Sin ella: corrección cosmética y debayer; el viñeteo lo quitará el modelo de fondo.
   - Apilado de **estrellas**, alineado en las estrellas.
   - Apilado del **cometa**, alineado en el núcleo, con candidatos de método y de rechazo que se comparan con previas.
   - En los dos, comprobar que se registraron N de N fotogramas.
3. **Cola iónica.** Cambia en minutos. Con sesiones largas, comparar el apilado de todo con tramos cortos: todo da menos ruido y la cola movida; los tramos dan la cola nítida y más ruido. Se elige mirando las previas.
4. **Gradiente** (Paso 9 lineal), en los dos apilados.
   - Muestras fuera de **toda** la trayectoria del cometa, no sólo de su posición final: en el apilado de estrellas el cometa queda como un borrón a lo largo de su recorrido.
   - Por fotograma, antes de apilar, si el cometa estaba bajo.
   - Enseñar el modelo quitado y comprobar que no lleva cola.
   - Sin flats, el modelo tiene que llevarse también el viñeteo (comparar grados y RBF).
5. **Color** (Paso 12 lineal).
   - Se calibra en el apilado de estrellas (SPCC, o PCC en DSLR) con blanco G2V o medio de estrellas: la luz del cometa es la del Sol reflejada, más las emisiones de la coma.
   - Se pasa al apilado del cometa con las mismas ganancias por canal (salen de los mismos fotogramas) o con un ajuste lineal sobre la cabeza.
   - **Nunca** se calibra con un fotograma suelto: el resto de la secuencia queda sin calibrar y cambia de color entre tomas.
6. **Estirado** (Paso 1 no lineal). Por pasadas (GHS al fallo), cometa y estrellas por separado. Núcleo con margen: no quemarlo.
7. **Verde** (Paso 3 no lineal). El verde de la coma es emisión real del C2 y **no se quita**. SCNR o quitar verde, sólo en las estrellas o en el fondo, con máscara que deje fuera coma y cola.
8. **Realce** (Paso 5 no lineal).
   - Compresión multiescala del rango dinámico, de 5 y de 4 capas, con máscara de luminancia, para la coma interior y el núcleo.
   - Contraste local (ecualización adaptativa del histograma, CLAHE) con límite de contraste alto y cantidad baja, para la estructura de la cola iónica.
   - Larson-Sekanina (filtro rotacional) sólo como **variante de análisis**, con su nombre en la previa y en el dossier: inventa simetrías y nunca es la final.
9. **Estrellas y recombinación** (Pasos 8 y 9 no lineal). La capa de estrellas sale del apilado de estrellas, no de separar el del cometa. Se une con screen 1 − (1 − a)(1 − b) o con suma, comprobando el aporte de las estrellas: que se vean sin tapar la cola débil.
   - **Cielo final ~0,10** (Rafael, 28 nov 2026, Lemmon), no el 0,015–0,05 de las nebulosas: con el cielo oscuro se pierden la cola débil y el polvo o la nebulosidad de fondo que haya en el campo. `fondoCandidatos(tipo='cometa')` usa 0,10 por defecto, con el punto negro de cada canal limitado al 0,01 % de píxeles a 0 (sin esquinas negras). Sin polvo ni cola débil que enseñar, se puede bajar.
   - `exportarFinal` con un cometa admite el cielo hasta 0,13, avisa de cielo gris por encima de 0,13 y de cielo oscuro por debajo de 0,06, de más del 0,01 % de un canal a 0 y de coma quemada.
10. **Dossier.** Qué apilado del cometa se eligió (método, rechazo, tramo de tiempo), que el verde de la coma es C2, cómo se calibró el color y, si se enseña, la variante Larson-Sekanina marcada como análisis.

Errores a no repetir en este tipo de objeto: calibrar el color en un fotograma suelto; SCNR global (se lleva la coma); muestras de fondo sobre la cola o sobre la trayectoria; quitar estrellas fotograma a fotograma en un cometa sin cola (el separador se lo lleva como si fuera una estrella); dar por buena la secuencia sin comprobar que se registraron todos los fotogramas.

---
