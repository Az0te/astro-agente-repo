# Paso 11: Dossier

[← Índice](../SKILL.md) · Anterior: [Paso 10: Recorte y exportación](10-recorte-exportacion.md) · Siguiente: [Índice](../SKILL.md)

**Por qué.** "El dosier describe lo que dice el historial de la vista, no lo que se pretendía". Sin dossier, el siguiente procesado repite los mismos errores y no se puede comparar una versión con otra; con él, cada objeto acumula parámetros ganadores y trampas conocidas.

**Contenido exigido**

- "Qué se hizo, valores y por qué; cámaras, filtros, exposiciones, sesiones y tiempos; paleta usada; parámetros ganadores".
- "Listar `view.processing` al final. No afirmar que se aplicó un proceso que falló."
- Errores y tiempo: qué falló, en qué paso, cómo se resolvió (o que no se resolvió).
- Tiempo de procesado activo (sin esperas), si el perfil lo pide: horas de inicio y fin de cada tramo.
- Revisión crítica final (aescaffre), puntuando 0–100: credibilidad del detalle (resuelto o sintético/"gusanos"), calidad del fondo, naturalidad del color, integridad de estrellas, equilibrio tonal, separación objeto–fondo, artefactos (anillos, costuras, manchas, textura sobreafilada) y coherencia estética. "Cada pega con una corrección concreta y accionable (proceso y parámetros), nunca 'mejorar el contraste'."

**Volcado del historial**

```json
{"llamadas": [
  {"funcion": "historial", "parametros": {"vista": "Final"}}
]}
```

Devuelve los pasos de `view.processing` (un contenedor, no un array) con los parámetros de cada uno.

**Con el MCP piastropilot** (Claude, Codex):

- Historial: `historial(vista)` (con `parametros: true` si hacen falta los valores). Las funciones de la guía trabajan sobre copias, así que el historial de la vista final sólo tiene lo aplicado sobre ella: el resto de la cadena sale del resultado de cada función (vista de entrada, vista nueva, parámetros y medidas). Reconstruirla con eso y decir de dónde sale cada paso.
- Revisión crítica: mirar la imagen antes de puntuar, nunca puntuar sin verla. `previa(vista)` da el JPG entero y `previa(vista, { rect: [x0, y0, x1, y1] })` recortes al 100 % (mínimo: el centro del objeto, una esquina con estrellas y la estrella más brillante). Leer cada JPG y puntuar con lo que se ve; si algo no se puede juzgar en el JPG, decirlo.

**Al terminar.** Proponer añadir a `perfil.md` las preferencias nuevas del usuario (qué versión eligió y por qué) y a la guía lo aprendido que sirva para cualquiera, sin datos personales.

**Control.** El historial debe contener, como mínimo: calibración/integración (del master), corrección de gradiente, BXT CO, SPCC, BXT, SXT, NXT, GHS/MAS, LHE, SCNR, recombinación. Si falta alguno, o se hizo en otro sitio o no se hizo: decirlo.

---
