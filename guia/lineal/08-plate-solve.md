# Paso 8: Plate solve

[← Índice](../SKILL.md) · Anterior: [Paso 7: Extracción de canales (OSC dual band)](07-extraccion-canales.md) · Siguiente: [Paso 9: Corrección de Gradiente](09-correccion-gradiente.md)

**Por qué.** La calibración de color (SPCC) y los modelos de fondo con base de referencia **necesitan solución astrométrica**: sin ella fallan con "The image has no valid astrometric solution" o equivalente. BXT, GraXpert y algunos recortes o rotaciones (según el programa y su versión) pueden eliminarla: comprobar que sigue antes de cada paso que la necesite. Resolver es más barato que descubrir el fallo a mitad de la calibración.

**Orden: alinear primero (Paso 5), resolver después.** Con varios masters, resolver antes de alinear no sirve:
- El registro escribe ficheros nuevos y la solución no pasa a los alineados.
- Una solución con corrección de distorsión antes del recorte puede impedir recortar o remuestrear sin perderla.

Tras alinear, todos comparten la rejilla: basta resolver la referencia y copiar la solución a las demás (la herramienta de alineado ya lo hace). Este paso queda para un master suelto o para volver a resolver si BXT o GraXpert quitan la solución.

**Método único: la herramienta de astrometría de la guía.** No se usan otros resolvedores, scripts ni copias de solución de otras ventanas.

- Con pistas si hace falta: la escala del perfil (mínima y máxima) o el centro (cabecera `RA`/`DEC` o el objeto) con un radio de búsqueda. Devuelve ra, dec (grados), escala (″/px), rotación, si está volteada y las estrellas casadas.
- Necesita el catálogo o índice astrométrico configurado en el programa; si falta, el error lo dice.
- Resolver la imagen **con estrellas**, nunca la capa sin estrellas.
- Si la imagen ya tenía solución, comparar la nueva con la anterior sirve para verificar una solución dudosa.
- **Una solución previa equivocada se conserva** si no se borra antes (el resolvedor avisa de que ha preservado la existente). Pasa sobre todo tras combinar imágenes (HDR, integraciones), que heredan la solución de una entrada. Comprobar que el centro resuelto coincide con el objeto; si no, resolver **forzando** (borrando la anterior). La herramienta la borra sola si su centro cae fuera de la región indicada.
- Si se pierde tras BXT o GraXpert, volver a resolver es más sencillo que trasladarla a mano.

**Si falla**

- Repetir con la pista de escala del perfil y, si se conoce el centro, con la región.
- Si la herramienta dice que su motor no está disponible: parar y avisar. No sustituirlo por otros resolvedores, por copias de solución ni por traslados manuales.

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/lineal.md#lineal-08); en Siril, [Anexo I](../anexos/I-siril.md).

**Control.** La imagen tiene solución astrométrica **después** de cada paso que pueda romperla (BXT, GraXpert, recortes y rotaciones); si se ha perdido, volver a resolver.
