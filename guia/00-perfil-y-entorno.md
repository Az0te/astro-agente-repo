# Antes de empezar: perfil del usuario y entorno

[← Índice](SKILL.md)

**Cuándo se lee.** Sólo para crear o completar el `perfil.md` del usuario o al montar el entorno. Durante un procesado bastan `SKILL.md` y `perfil.md`.

**Por qué.** "Esta guía es genérica; el perfil decide los valores concretos". La guía no usa iconos del escritorio ni scripts del programa: todo se ejecuta con las herramientas del agente de cada programa (las de su manifiesto), que ya llevan los procesos configurados. Los valores de cada equipo (filtros y curva QE para la calibración de color, base de referencia de gradientes, rutas, preferencias) salen del perfil. Sin perfil, la escala de muestreo, los filtros y las rutas son suposiciones.

**Perfil del usuario** (plantilla en `guia/perfil-ejemplo.md`; copiar como `perfil.md` y rellenar antes del primer paso)

| Bloque | Campos |
|---|---|
| Equipo | Telescopio y focal; cámara(s) (modelo, sensor, píxel, OSC/mono, Bayer); escala de muestreo (″/px nativa y con drizzle); montura; filtros y anchura; particularidades (p. ej. ventana UV/IR-cut de serie → curvas de la calibración de color) |
| Cielo | Tipo (ciudad / periurbano / oscuro, Bortle); seeing típico (FWHM); problemas habituales (gradientes, humedad, calima) |
| Captura | Esquema (p. ej. RGB 120 s + RGB 30 s para estrellas y HDR); programa de captura y de preprocesado |
| Rutas | Carpeta de masters; carpeta de cada versión (`<objeto>/<objeto>_v1/`, nunca sobrescribir) |
| Programa | Con qué programa se procesa y su instalación si no es la de por defecto; módulos o programas externos instalados (GraXpert, RC-Astro, StarNet…); nombres de filtro y curva QE tal como los da la base del programa; ruta de la base de referencia de gradientes; carpeta `guia/` del repo en el PC. Lo propio de cada programa: [Anexo J](anexos/J-pixinsight.md#perfil) (PixInsight), [Anexo I](anexos/I-siril.md) (Siril), [Anexo K](anexos/K-saspro.md) (SASpro) |
| Preferencias estéticas | Nivel de fondo final (p. ej. mediana ≈ 0,17, nunca negro puro); color; estrellas; ruido; referencias; entrega |
| Preferencias por objeto | Lo elegido en cada procesado (p. ej. "nebulosa de reflexión: prefirió la versión B, con más nebulosidad de fondo y Hα al rojo 1,40") |

Regla: "Cuando el usuario exprese una preferencia nueva (elige una versión frente a otra, pide más o menos saturación…), propón añadirla al perfil."

**Límites del entorno** (en todos los programas; los detalles de cada uno, en el arranque de su anexo)

| Situación | Conducta correcta |
|---|---|
| Herramienta de más de ~45 s | Devuelve un id de trabajo y **sigue ejecutándose**: recoger el resultado con `estado(trabajo)`; no relanzar |
| `estado` / `ping` | `estado(trabajo)` da el resultado de un trabajo largo; `ping` dice si el programa responde |
| Código del programa | El agente no lo escribe ni lo ejecuta: sólo llama a las herramientas de la guía (el manifiesto del programa). Si ninguna sirve, lo dice y propone qué hacer |
| Astrometría | Sólo con `resolverAstrometria("<vista>")`, ver Paso 8 lineal |
| Una herramienta dice que falta un proceso o un programa externo | No está instalado o cargado: avisar al usuario; no sustituirlo por otro |
| Scripts del programa | La guía no los usa: cada uno tiene su herramienta equivalente ([Anexo A](anexos/A-equivalentes-scripts.md)) |
| El programa deja de responder sin diálogo | No insistir con más llamadas pesadas: avisar y parar |
| Ver diálogos o la pantalla | Sólo si el usuario ha dado acceso a la pantalla (computer use); si no, no contar con verlos |
| Ver resultados | Con `previa` (JPG reducido) o recortes al 100 % en `<carpeta>/prev/`; mejor que capturas de pantalla |
| Subs y masters del usuario | **Nunca borrar ni sobrescribir**: mover los descartes a `_rechazados` y que el usuario confirme. Nunca sobrescribir versiones (v1, v2…) |

**Principio innegociable:** "Ceñirse a los datos, no inventar nada... 'Revelar, no inventar': cualquier estructura débil se confirma antes de realzarla, y cada paso se compara con la versión sin tocar".
