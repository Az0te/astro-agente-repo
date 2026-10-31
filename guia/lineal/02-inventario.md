# Paso 2: Inventario

[← Índice](../SKILL.md) · Anterior: [Paso 1: Análisis del objeto](01-analisis-del-objeto.md) · Siguiente: [Paso 3: Blink / SubframeSelector](03-blink-subframeselector.md)

**Por qué.** El preprocesado no se puede juzgar después: "si un master tiene problemas, revisar el preprocesado antes de forzar el postprocesado". El inventario fija qué masters existen, con qué calibración y con qué geometría, y evita dos errores caros: mezclar grupos incompatibles en una integración y descubrir a mitad del procesado que faltan flats de un filtro.

**Qué debe registrar el inventario** :

| Campo | Por qué importa |
|---|---|
| Cámara (modelo, sensor) | Curva QE para SPCC y coeficientes de DBXtract |
| OSC o mono | Decide si hay desmezcla (Paso 7) |
| Filtros usados (por grupo) | Un master por filtro; un juego de flats por filtro |
| Exposiciones por grupo (30 s, 120 s…) | Cada tiempo en su propio master |
| Ganancia, offset, modo de lectura, binning | Deben coincidir lights y calibración |
| Temperatura y consigna | Consigna unos grados por debajo de la mínima de la noche, potencia ≤ 75–80 % |
| Driver y programa de captura, formato de archivo | Compatibilidad de la calibración |
| Focal y tamaño de píxel | Escala del sub = 206,265·píxel(µm)/focal(mm) |
| Noches y horas por grupo | Dossier y normalización entre sesiones |
| Darks/bias disponibles (exposición y temperatura) | Cada cámara con su biblioteca; darks de la misma exposición |
| Flats: fecha, filtro, rotador, foco | Cada cambio de camino óptico = nueva sesión con sus flats |

**Regla de compatibilidad, literal:**

> **Compatibilidad:** lights y calibración con la misma ganancia, offset, modo de lectura, binning, temperatura, driver, programa de captura y formato de archivo.

**Código.** Para listar vistas abiertas, la herramienta del watcher es `list_open_images`. Para comprobar que un master contiene realmente una integración y con cuántos subs, se lee su historial:

```javascript
// ¿Este master tiene una integración real y de qué tipo?
var v = View.viewById("MasterLight");
if (!v || v.isNull) throw new Error("No existe MasterLight");
var h = v.processing, out = [], integ = 0;
for (var i = 0; i < h.length; ++i) {
   var src = h.at(i).toSource();
   if (src.indexOf("ImageIntegration") >= 0) { ++integ; out.push("ImageIntegration en paso " + i); }
}
out.push("pasos en el historial: " + h.length + "  integraciones: " + integ);
if (integ === 0) throw new Error("El master no tiene ImageIntegration en el historial: revisar preprocesado");
out.join("\n");
```

**Control.** Un master sin `ImageIntegration` en `view.processing` no ha pasado por WBPP (o se guardó con `window.saveAs`, que "no guarda el historial de procesos en el XISF"). Número de subs integrados por grupo: se lee del log de WBPP (Anexo C).
