# Cómo contribuir

*[English version below](#how-to-contribute)*

> **La parte de PixInsight está retirada** y no se aceptan aportaciones para ella. Ver el aviso del [README](README.md).

Gracias por querer ayudar. Este proyecto (la guía de procesado y los asistentes para Siril y Seti Astro Suite Pro) ha crecido a partir de sesiones reales de procesado, casi todas con un solo equipo. Lo que más falta ahora son **datos y resultados de otros equipos, otros cielos y otros tipos de objeto**. No hace falta saber programar para aportar mucho.

## Qué aportar, de más útil a menos

1. **Casos de prueba reales.** Masters (o recortes) de tipos de objeto que aún no se han probado, con su equipo, filtro y cámara. La guía mejora por tipo de objeto, y cada caso nuevo sirve para comprobar o corregir sus valores de partida.
2. **Fallos con su registro.** Cuando un paso del asistente o de la guía falle o dé un resultado raro, el registro del chat (o de la consola de Siril o SASpro) y una captura valen más que cualquier descripción.
3. **Comparativas.** Tu procesado manual al lado del del asistente con los mismos datos. Sirven para calibrar los umbrales: nivel de cielo, ruido, moteado de color, aporte de estrellas, etc.
4. **Pruebas con otros modelos y equipos.** Codex, otros modelos locales, otras GPU, Seestar u otros telescopios inteligentes, OSC frente a mono, macOS o Linux, otra versión de Siril o SASpro.
5. **Correcciones y mejoras de la guía**, por *pull request* (ver las reglas más abajo).
6. **Traducciones** y, más adelante, **código** de los puentes o de los servidores MCP.

## Por dónde

| Qué | Canal |
|---|---|
| Fallos, casos de prueba, comparativas, pruebas con otro modelo o equipo | [Issues](https://github.com/Az0te/astro-agente-repo/issues/new/choose): elige la plantilla que corresponda |
| Ideas, preguntas, resultados que quieras enseñar | [Discussions](https://github.com/Az0te/astro-agente-repo/discussions) |
| Cambios en la guía, el código o la documentación | *Pull request* contra la rama `main` |

**Ficheros grandes:** no los adjuntes a la *issue*. Súbelos a Google Drive, OneDrive, Dropbox o WeTransfer y pega el enlace. Un recorte de 1000 × 1000 px en XISF o FITS suele bastar; si puedes, indica cuánto tiempo estará disponible el enlace.

**Métricas y sesión:** el informe de Siril o de SASpro lleva una tabla de métricas de la sesión y un bloque JSON (`astropilot-metricas/1`): modelo, versión de la guía, llamadas correctas, errores, correcciones, tiempos y tokens. Pega ese bloque en la *issue*: es lo que permite comparar envíos con datos y no solo a ojo. No lleva rutas ni datos personales. Con modelos locales se guarda además, junto al informe, un fichero `…_sesion_anonima` con la conversación completa, sin el prompt de sistema ni las previas y con las carpetas de usuario cambiadas. Nada se envía solo: revísalo y adjúntalo únicamente si quieres, y di en la plantilla si podemos usarlo para entrenar modelos locales.

**Datos privados:** las cabeceras FITS/XISF pueden llevar tus coordenadas, el nombre del observatorio o rutas de tu PC. Revísalas antes de compartir. Comparte solo datos tuyos o que tengas permiso para compartir, y di bajo qué condiciones pueden usarse (por ejemplo, solo para probar la guía, o también como imagen de ejemplo en la documentación).

## Reglas para cambios en la guía

- **Reglas por tipo de objeto, nunca por objeto concreto.** La guía debe ser lo más general posible. Se aceptan reglas para galaxias, nebulosas de emisión, oscuras, de reflexión, planetarias, cúmulos globulares o abiertos, etc. No se aceptan reglas del tipo «en M31 usa…» o «para IC 63 pon…». Un objeto concreto puede aparecer como ejemplo de dónde se midió algo, nunca como condición de una regla.
- **Ceñirse a los datos.** Nada que invente estructura que no esté en la imagen. Si propones un umbral o un valor nuevo, acompáñalo de lo que se midió y con qué datos (equipo, filtro, integración, tipo de objeto). Un solo caso es un punto de partida, no una regla.
- **Cada paso es un fichero** con el porqué, los parámetros, el código y el control para comprobarlo. Respeta esa estructura.
- **Escribe en español.** El asistente responde en el idioma del usuario aunque la guía esté en español. Las traducciones completas se coordinan antes en *Discussions*.
- **No incluyas datos personales** (`guia/perfil.md` no se publica; usa `guia/perfil-ejemplo.md` como modelo).

## Reglas para código

- Los puentes y las herramientas de Siril y SASpro están en Python (`siril/`, `sas/`); los servidores MCP, en TypeScript (`siril/mcp/`, `sas/mcp/`). Sigue el estilo del fichero que toques.
- Prueba el cambio en Siril o en SASpro antes de abrir la *pull request* y di con qué versión (por ejemplo, Siril 1.4 en Windows 11).
- Las herramientas y la guía van juntas: si cambias la firma de una herramienta, actualiza el `manifiesto.json` de su carpeta y lo que la use.
- **Nada de código de PixInsight.** No se aceptan aportaciones para PixInsight ni código copiado, traducido o adaptado de PCL o PJSR (su licencia no lo permite fuera de PixInsight).
- No subas binarios ni claves.

## Licencias de las aportaciones

Al aportar aceptas que tu contribución se publique con la licencia de la parte del proyecto que tocas:

- Código (`siril/`, `sas/`): **MIT**, Copyright (c) 2026 Rafael Vidal ([`LICENSE`](LICENSE)).
- Guía (`guia/`): **CC BY-SA 4.0** ([`guia/LICENSE.md`](guia/LICENSE.md)).

Las imágenes y datos que enlaces siguen siendo tuyos; solo se usarán como digas en la *issue*.

## Trato

Sé amable y concreto. Aquí se aprende de los fallos, también de los de la guía.

---

# How to contribute

> **The PixInsight part has been withdrawn** and contributions for it are not accepted. See the notice in the [README](README.en.md).

Thanks for wanting to help. This project (the processing guide and the assistants for Siril and Seti Astro Suite Pro) grew out of real processing sessions, almost all with a single rig. What it needs most now is **data and results from other rigs, other skies and other object types**. You do not need to code to make a big contribution.

## What to contribute, most useful first

1. **Real test cases.** Masters (or crops) of object types that have not been tested yet, with telescope, filter and camera. The guide improves per object type, and each new case checks or corrects its starting values.
2. **Bugs with their log.** When an assistant or guide step fails or gives an odd result, the chat log (or the Siril or SASpro console) and a screenshot are worth more than any description.
3. **Comparisons.** Your manual processing next to the assistant's on the same data. They are used to calibrate thresholds: sky level, noise, colour mottle, star contribution, etc.
4. **Tests with other models and hardware.** Codex, other local models, other GPUs, Seestar or other smart telescopes, OSC vs mono, macOS or Linux, other Siril or SASpro versions.
5. **Guide fixes and improvements** by pull request (see the rules below).
6. **Translations** and, later on, **code** for the bridges or the MCP servers.

## Where

| What | Channel |
|---|---|
| Bugs, test cases, comparisons, tests with another model or rig | [Issues](https://github.com/Az0te/astro-agente-repo/issues/new/choose): pick the matching template |
| Ideas, questions, results you want to show | [Discussions](https://github.com/Az0te/astro-agente-repo/discussions) |
| Changes to the guide, code or docs | Pull request against `main` |

Issues can be written in English or Spanish.

**Large files:** do not attach them to the issue. Upload them to Google Drive, OneDrive, Dropbox or WeTransfer and paste the link. A 1000 × 1000 px XISF or FITS crop is usually enough; if you can, say how long the link will stay up.

**Metrics and session:** the Siril or SASpro report includes a session metrics table and a JSON block (`astropilot-metricas/1`): model, guide version, correct calls, errors, corrections, timing and tokens. Paste that block into the issue: it lets us compare submissions with data, not just by eye. It contains no paths or personal data. With local models a `…_sesion_anonima` file with the full conversation is also saved next to the report, without the system prompt or previews and with user folders replaced. Nothing is sent automatically: check it and attach it only if you want, and say in the template whether we may use it to train local models.

**Private data:** FITS/XISF headers may contain your coordinates, observatory name or local paths. Check them before sharing. Only share your own data or data you are allowed to share, and say how it may be used (only to test the guide, or also as an example image in the docs).

## Rules for guide changes

- **Rules per object type, never per specific object.** The guide must stay as general as possible. Rules for galaxies, emission, dark, reflection and planetary nebulae, globular or open clusters, etc. are welcome. Rules like "for M31 use…" or "for IC 63 set…" are not. A specific object may appear as an example of where something was measured, never as the condition of a rule.
- **Stay true to the data.** Nothing that invents structure not present in the image. If you propose a new threshold or value, include what was measured and on which data (rig, filter, integration, object type). One case is a starting point, not a rule.
- **Each step is one file** with the why, the parameters, the code and the check. Keep that structure.
- **Write in Spanish.** The assistant answers in the user's language even though the guide is in Spanish. Full translations should be discussed first in Discussions.
- **No personal data** (`guia/perfil.md` is not published; use `guia/perfil-ejemplo.md` as a template).

## Rules for code

- The Siril and SASpro bridges and tools are Python (`siril/`, `sas/`); the MCP servers are TypeScript (`siril/mcp/`, `sas/mcp/`). Follow the style of the file you touch.
- Test the change in Siril or SASpro before opening the pull request and say which version (e.g. Siril 1.4 on Windows 11).
- The tools and the guide go together: if you change a tool's signature, update the `manifiesto.json` in its folder and its callers.
- **No PixInsight code.** Contributions for PixInsight are not accepted, nor code copied, translated or adapted from PCL or PJSR (their licence does not allow it outside PixInsight).
- Do not commit binaries or keys.

## Licensing of contributions

By contributing you agree that your contribution is published under the licence of the part of the project you change:

- Code (`siril/`, `sas/`): **MIT**, Copyright (c) 2026 Rafael Vidal ([`LICENSE`](LICENSE)).
- Guide (`guia/`): **CC BY-SA 4.0** ([`guia/LICENSE.md`](guia/LICENSE.md)).

Images and data you link to remain yours; they will only be used as you state in the issue.

## Conduct

Be kind and specific. We learn from failures here, including the guide's own.
