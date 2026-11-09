# Antes de empezar: perfil del usuario y entorno

[← Índice](SKILL.md)

**Cuándo se lee.** Sólo para crear o completar el `perfil.md` del usuario o al montar el entorno. Durante un procesado bastan `SKILL.md` y `perfil.md`.

**Por qué.** "Esta guía es genérica; el perfil decide los valores concretos". La guía no usa iconos del escritorio ni scripts: todo se ejecuta con las funciones de `herramientas/` (herramientas del MCP `piastropilot` o scripts del panel PiAstroPilot), con procesos configurados en código (`herramientas/procesos.js` para SPCC, SPFC y MGC) y los scripts necesarios reimplementados en `herramientas/realces.js`. Los valores de cada equipo (nombres de filtro y QE de `filters.xspd`, base MARS, preferencias) salen del perfil. Sin perfil, la escala de muestreo, los filtros y las rutas son suposiciones.

**Perfil del usuario** (plantilla en `guia/perfil-ejemplo.md`; copiar como `perfil.md` y rellenar antes del primer paso)

| Bloque | Campos |
|---|---|
| Equipo | Telescopio y focal; cámara(s) (modelo, sensor, píxel, OSC/mono, Bayer); escala de muestreo (″/px nativa y con drizzle); montura; filtros y anchura; particularidades (p. ej. ventana UV/IR-cut de serie → curvas de SPFC/SPCC) |
| Cielo | Tipo (ciudad / periurbano / oscuro, Bortle); seeing típico (FWHM); problemas habituales (gradientes, humedad, calima) |
| Captura | Esquema (p. ej. RGB 120 s + RGB 30 s para estrellas y HDR); programa de captura y de preprocesado |
| Rutas | Carpeta de masters; carpeta de cada versión (`<objeto>/<objeto>_v1/`, nunca sobrescribir) |
| PixInsight | Instalación si no es la de por defecto; módulos de terceros instalados; filtros y curva QE para SPCC/SPFC (nombres de `filters.xspd`); ruta de la base MARS; ruta del ejecutable de GraXpert; carpeta `guia/` del repo en el PC (para cargar `herramientas/*.js`) |
| Preferencias estéticas | Nivel de fondo final (p. ej. mediana ≈ 0,17, nunca negro puro); color; estrellas; ruido; referencias; entrega |
| Preferencias por objeto | Lo elegido en cada procesado (p. ej. "nebulosa de reflexión: prefirió la versión B, con más nebulosidad de fondo y Hα al rojo 1,40") |

Regla: "Cuando el usuario exprese una preferencia nueva (elige una versión frente a otra, pide más o menos saturación…), propón añadirla al perfil."

**Límites del entorno**

| Situación | Conducta correcta |
|---|---|
| Herramienta de más de ~45 s | Devuelve un id de trabajo y **sigue ejecutándose**: recoger el resultado con `estado(trabajo)`; no relanzar |
| `estado` / `ping` | `estado(trabajo)` da el resultado de un trabajo largo; `ping` dice si PixInsight responde |
| Código de PixInsight | El agente no lo escribe ni lo ejecuta: sólo llama a las funciones de la guía (`herramientas/manifiesto.json`). Si ninguna sirve, lo dice y propone qué hacer |
| Astrometría | Sólo `resolverAstrometria("<vista>")` (motor de BlindSolver, PixInsight 1.9.6+), ver Paso 8 lineal |
| Una función dice que falta un proceso | El módulo no está cargado en PixInsight: avisar al usuario; no sustituirlo por otro proceso |
| Scripts | La guía no los usa: cada uno tiene su función equivalente ([Anexo A](anexos/A-equivalentes-scripts.md)) |
| PixInsight que deja de responder sin diálogo | No insistir con más llamadas pesadas: avisar y parar |
| MCP antiguo `pixinsight` (watcher) | Retirado: no usar `run_script`, `watcher_status`, `describe_process` ni `list_open_images` aunque aparezcan |
| Ver diálogos o la pantalla | Sólo si el usuario ha dado acceso a la pantalla (computer use); si no, no contar con verlos |
| Ver resultados | Guardar JPG reducidos (IntegerResample) o recortes al 100 % en `<carpeta>/prev/`; mejor que capturas de pantalla |
| Subs y masters del usuario | **Nunca borrar**: mover los descartes a `_rechazados` y que el usuario confirme. Nunca sobrescribir versiones (v1, v2…) |

**Principio innegociable:** "Ceñirse a los datos, no inventar nada... 'Revelar, no inventar': cualquier estructura débil se confirma antes de realzarla, y cada paso se compara con la versión sin tocar".
