# Paso 5: Alineado y recorte común

[← Índice](../SKILL.md) · Anterior: [Paso 4: Preprocesado](04-preprocesado.md) · Siguiente: [Paso 6: Composición HDR](06-hdr-composition.md)

**Por qué.** Todos los masters (RGB y banda estrecha) tienen que estar en la misma rejilla de píxeles antes de combinarse; y hay que recortar los bordes de apilado antes de corregir gradientes, porque un borde negro se convierte en un gradiente artificial. "Las tomas RGB y NB pueden estar giradas entre sí y a escala distinta".

**Regla (Rafael, 12 nov 2026).** Con dos o más masters, alinear y recortar **siempre** antes del gradiente. Se puede saltar sólo si ya vienen alineados: **mismo tamaño, sin bordes sin datos y las estrellas en el mismo sitio** (p. ej., registrados sobre la misma referencia en el mismo apilado). Las herramientas paran el gradiente si hay varios masters abiertos sin alinear.

**Registro**

- Registrar los masters como ficheros, con una carpeta de salida.
- **Una sola referencia común**, la imagen con mejor resolución y SNR (normalmente la L o el Hα de la mono), con splines de superficie + corrección de distorsión.
- "Cada remuestreo suaviza la PSF y el ruido: **interpolar una sola vez** (Lanczos-3, en 32 bits) y no encadenar resize + registro + rotación si se puede evitar."
- Si las escalas difieren: registrar escalas distintas (×2) falló; escalar antes con Lanczos-3. Con la razón de escalas astrométricas, un único remuestreo previo y luego registrar.
- Mejor aún: que salgan ya alineados del preprocesado, registrados sobre la misma referencia (Paso 4).

**Recorte**

- "Recortar todos los masters a la región común antes de procesar (astro-photographie: 'Cropped' es siempre el primer paso). Si los campos difieren mucho (otro telescopio), la imagen final sólo cubre la intersección."
- Calcular el rectángulo válido de todos. "Sin datos" es 0 **o el relleno constante del preprocesado**, igual en los tres canales, que a ojo parece cielo oscuro.
- Recortar también las **franjas con menos cobertura de apilado**: no están vacías, pero su fondo o su ruido se apartan del interior (en una nebulosa dual band, una franja un 21 % más oscura de ~60 px y esquinas más claras y ruidosas de hasta ~100 px).
- **Astrometría:** recortar o remuestrear puede perder o invalidar la solución astrométrica según el programa y la versión; comprobarla después y, si se ha perdido, volver a resolver (Paso 8).

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/lineal.md#lineal-05); en Siril, [Anexo I](../anexos/I-siril.md).

Con las franjas, una nebulosa dual band conservó el 86 % del campo, con las esquinas limpias al estirar fuerte. Comprobado (nov 2026; 3 masters de 300 MB en ~12 s): un master girado 7° y desplazado, y otro binado ×2, quedaron alineados con la referencia, con correlación máxima en el desplazamiento 0,0 (0,93 y 0,94). El binado se reescaló ×2 antes de registrar y conservó la astrometría.

**Revisión del recorte, obligatoria antes del gradiente (Rafael, 16 nov 2026).** «Hay que checkear bien los recortes antes de seguir con los gradientes.» En una nebulosa que llena el campo los masters alineados tenían franjas con menos subs (no vacías: con **más ruido**) de hasta 128 px a la derecha y 80 abajo; el recorte por «sin datos» no las vio, el gradiente se ajustó mal allí y la esquina de arriba a la derecha salió **cian** en la versión final. Tras alinear, y antes de separar capas o corregir gradientes:

1. **Cobertura por el ruido** en cada canal de cada master: ruido local (MAD del paso alto en bloques de 16 px) frente al del centro; una franja con más de ×1,25 del ruido es cobertura parcial. Se toma lo peor de cada lado entre todos los masters y canales.
2. **Franjas de 8/32/64 px** de cada lado frente a una franja interior (200–400 px): nivel, ruido y dominante de color por canal. Tras recortar, la de 8 px no debe tener más de ×1,5 de ruido ni más de un 15 % de dominante.
3. **Mirar las cuatro esquinas** ampliadas (estiradas) de cada master: ni cuñas de color, ni líneas en el borde, ni franjas.
4. Recortar **todos los masters igual** (lo peor de cada lado + 8 px) y seguir sólo con los recortados.

Una caída suave de la señal hacia el borde **sin** subida del ruido es gradiente o nebulosa (lo corrige el Paso 9), no cobertura. En SirilAstroPilot y SetiAstroPilot esto es `revisarRecorte`; `gradienteCandidatos` no recomienda nada sobre capas de masters alineados sin ese paso. En una nebulosa que llena el campo quitó 24/136/24/88 px (izquierda/derecha/arriba/abajo) en Siril y 40/88/56/72 en SASpro.

**Control.** Abrir los registrados y comparar la posición de 3–4 estrellas en las esquinas; comprobar que el recorte no deja bandas sin datos (la medida de bordes sin datos del análisis debe dar que no hay). La mediana de una franja de borde no basta: el relleno del preprocesado no es 0. Tras recortar, comprobar que sigue la solución astrométrica.
