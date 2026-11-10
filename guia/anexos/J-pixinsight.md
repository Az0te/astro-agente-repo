# Anexo J: cómo se hace cada paso en PixInsight

[← Índice](../SKILL.md)

Bajo demanda: el **cómo** de cada paso con PixInsight (la guía en JavaScript de `herramientas/`, el MCP `piastropilot`, PiAstroPilot y PiAstroPilot Lite). Las fichas dicen **qué** hacer, **por qué** y con **qué criterios**, con nombres neutros; aquí están las funciones de la guía, los procesos de PixInsight, los valores de referencia a mano y los ejemplos de llamada. En Siril: [Anexo I](I-siril.md).

Los ejemplos de llamada explican qué hace cada función: no se copian, se pide la función con sus parámetros. Los ids de vista (`MasterLight`, `Starless_st`…) son genéricos: usar siempre los ids reales de la lista de vistas.

## Nombres neutros y nombres en PixInsight

| Nombre neutro (fichas, Siril) | En las funciones de PixInsight | Qué mide |
|---|---|---|
| `copia_objeto` | `gcStructCopy`, `corr` (gradienteCandidatos) | parecido del modelo de fondo con el objeto (< 0,15 limpio; > 0,5 se lo come) |
| `objeto_quitado_pct` | `come_objeto_pct` | % de la señal del objeto que se lleva el modelo |
| `gradiente_restante` | `fondoResidual` (`deja_gradiente_pct` = ×100) | gradiente del cielo que queda, después / antes |
| `separacion` | `senal_debil_en_ruidos` | (p90 − cielo) / ruido del cielo tras estirar |
| `ruido_rel` | `ruido_baja_pct` = 100·(1 − `ruido_rel`) | ruido del cielo después / antes |
| `contraste_ganado_pct` | `contraste_x` = 1 + pct/100 | contraste local ganado en el objeto |
| `dominante_cielo_pct`, `aporte_estrellas_pct`, `no_cumple` | iguales | — |

Las funciones devuelven ya los nombres neutros; los antiguos se mantienen como alias durante una versión (nov 2026) y se quitarán.

## Por paso

- [Fase lineal](J-pixinsight/lineal.md): [Paso 1](J-pixinsight/lineal.md#lineal-01), [Paso 2](J-pixinsight/lineal.md#lineal-02), [Paso 3](J-pixinsight/lineal.md#lineal-03), [Paso 4](J-pixinsight/lineal.md#lineal-04), [Paso 5](J-pixinsight/lineal.md#lineal-05), [Paso 6](J-pixinsight/lineal.md#lineal-06), [Paso 7](J-pixinsight/lineal.md#lineal-07), [Paso 8](J-pixinsight/lineal.md#lineal-08), [Paso 9](J-pixinsight/lineal.md#lineal-09), [Paso 10](J-pixinsight/lineal.md#lineal-10), [Paso 11](J-pixinsight/lineal.md#lineal-11), [Paso 12](J-pixinsight/lineal.md#lineal-12), [Paso 13](J-pixinsight/lineal.md#lineal-13), [Paso 14](J-pixinsight/lineal.md#lineal-14), [Paso 15](J-pixinsight/lineal.md#lineal-15), [Paso 16](J-pixinsight/lineal.md#lineal-16), [Paso 17](J-pixinsight/lineal.md#lineal-17)
- [Fase no lineal](J-pixinsight/no-lineal.md): [Paso 1](J-pixinsight/no-lineal.md#no-lineal-01), [Paso 2](J-pixinsight/no-lineal.md#no-lineal-02), [Paso 3](J-pixinsight/no-lineal.md#no-lineal-03), [Paso 4](J-pixinsight/no-lineal.md#no-lineal-04), [Paso 5](J-pixinsight/no-lineal.md#no-lineal-05), [Paso 6](J-pixinsight/no-lineal.md#no-lineal-06), [Paso 8](J-pixinsight/no-lineal.md#no-lineal-08), [Paso 9](J-pixinsight/no-lineal.md#no-lineal-09), [Paso 10](J-pixinsight/no-lineal.md#no-lineal-10)
