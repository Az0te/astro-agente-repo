# Paso 2: Inventario

[← Índice](../SKILL.md) · Anterior: [Paso 1: Análisis del objeto](01-analisis-del-objeto.md) · Siguiente: [Paso 3: Selección de subs](03-blink-subframeselector.md)

**Por qué.** El preprocesado no se puede juzgar después: "si un master tiene problemas, revisar el preprocesado antes de forzar el postprocesado". El inventario fija qué masters existen, con qué calibración y con qué geometría, y evita dos errores caros: mezclar grupos incompatibles en una integración y descubrir a mitad del procesado que faltan flats de un filtro.

**Qué debe registrar el inventario** :

| Campo | Por qué importa |
|---|---|
| Cámara (modelo, sensor) | Curva QE para la calibración de color y coeficientes de la desmezcla dual band |
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

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/lineal.md#lineal-02); en Siril, [Anexo I](../anexos/I-siril.md).

La revisión avisa en `no_cumple` de lights sin flats de su filtro en su noche, sin dark de su exposición, con gain u offset mezclados o con flats de otro telescopio. La biblioteca de darks suele estar fuera de la carpeta del objeto: indicarla aparte.

Comprobado con una nebulosa dual band (nov 2026; 11 grupos en 10 noches, 1147 ficheros). Detectó que los lights Hα/OIII del 12-9 y del 14-9 no tienen flats de ese filtro en su noche (sí del 20-9, 24-9 y 25-9).

**Historial.** Para comprobar que un master contiene realmente una integración y con cuántos subs, se lee su historial: sin ningún paso de integración, el master no ha pasado por el apilado (o se guardó sin historial): revisar el preprocesado.

**Control.** Un master sin integración en su historial no ha pasado por el preprocesado completo. Número de subs integrados por grupo: se lee del log del preprocesado (Anexo C).
