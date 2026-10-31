# Paso 11: Dossier

[← Índice](../SKILL.md) · Anterior: [Paso 10: Recorte y exportación](10-recorte-exportacion.md) · Siguiente: [Índice](../SKILL.md)

**Por qué.** "El dosier describe lo que dice el historial de la vista, no lo que se pretendía". Sin dossier, el siguiente procesado repite los mismos errores y no se puede comparar una versión con otra; con él, cada objeto acumula parámetros ganadores y trampas conocidas.

**Contenido exigido**

- "Qué se hizo, valores y por qué; cámaras, filtros, exposiciones, sesiones y tiempos; paleta usada; parámetros ganadores".
- "Listar `view.processing` al final. No afirmar que se aplicó un proceso que falló."
- Errores y tiempo: qué falló, en qué paso, cómo se resolvió (o que no se resolvió).
- Tiempo de procesado activo (sin esperas), si el perfil lo pide: horas de inicio y fin de cada tramo.
- Revisión crítica final (aescaffre), puntuando 0–100: credibilidad del detalle (resuelto o sintético/"gusanos"), calidad del fondo, naturalidad del color, integridad de estrellas, equilibrio tonal, separación objeto–fondo, artefactos (anillos, costuras, manchas, textura sobreafilada) y coherencia estética. "Cada pega con una corrección concreta y accionable (proceso y parámetros), nunca 'mejorar el contraste'."

**Código: volcado del historial**

```javascript
var v = View.viewById("Final");
if (!v || v.isNull) throw new Error("No existe Final");
var h = v.processing, out = [];       // contenedor, no array: length y at(i)
for (var i = 0; i < h.length; ++i) out.push(i + ": " + h.at(i).toSource());
out.join("\n\n");
```

**Al terminar.** Proponer añadir a `perfil.md` las preferencias nuevas del usuario (qué versión eligió y por qué) y a la guía lo aprendido que sirva para cualquiera, sin datos personales.

**Control.** El historial debe contener, como mínimo: calibración/integración (del master), corrección de gradiente, BXT CO, SPCC, BXT, SXT, NXT, GHS/MAS, LHE, SCNR, recombinación. Si falta alguno, o se hizo en otro sitio o no se hizo: decirlo.

---
