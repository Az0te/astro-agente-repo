# Cómo contribuir

*[English version below](#how-to-contribute)*

Gracias por querer ayudar. Este proyecto (la guía de procesado, el puente MCP y el módulo PiAstroPilot) ha crecido a partir de sesiones reales de procesado, casi todas con un solo equipo. Lo que más falta ahora son **datos y resultados de otros equipos, otros cielos y otros tipos de objeto**. No hace falta saber programar para aportar mucho.

## Qué aportar, de más útil a menos

1. **Casos de prueba reales.** Masters (o recortes) de tipos de objeto que aún no se han probado, con su equipo, filtro y cámara. La guía mejora por tipo de objeto, y cada caso nuevo sirve para comprobar o corregir sus valores de partida.
2. **Fallos con su registro.** Cuando un paso de PiAstroPilot o de la guía falle o dé un resultado raro, el registro del panel (o de la consola de PixInsight) y una captura valen más que cualquier descripción.
3. **Comparativas.** Tu procesado manual al lado del de PiAstroPilot con los mismos datos. Sirven para calibrar los umbrales: nivel de cielo, ruido, moteado de color, aporte de estrellas, etc.
4. **Pruebas con otros modelos y equipos.** Codex, otros modelos locales, otras GPU, Seestar u otros telescopios inteligentes, OSC frente a mono, macOS o Linux, otra versión de PixInsight.
5. **Correcciones y mejoras de la guía**, por *pull request* (ver las reglas más abajo).
6. **Traducciones** y, más adelante, **código** del módulo o del servidor MCP.

## Por dónde

| Qué | Canal |
|---|---|
| Fallos, casos de prueba, comparativas, pruebas con otro modelo o equipo | [Issues](https://github.com/Az0te/astro-agente-repo/issues/new/choose): elige la plantilla que corresponda |
| Ideas, preguntas, resultados que quieras enseñar | [Discussions](https://github.com/Az0te/astro-agente-repo/discussions) |
| Cambios en la guía, el código o la documentación | *Pull request* contra la rama `main` |

**Ficheros grandes:** no los adjuntes a la *issue*. Súbelos a Google Drive, OneDrive, Dropbox o WeTransfer y pega el enlace. Un recorte de 1000 × 1000 px en XISF o FITS suele bastar; si puedes, indica cuánto tiempo estará disponible el enlace.

**Datos privados:** las cabeceras FITS/XISF pueden llevar tus coordenadas, el nombre del observatorio o rutas de tu PC. Revísalas antes de compartir. Comparte solo datos tuyos o que tengas permiso para compartir, y di bajo qué condiciones pueden usarse (por ejemplo, solo para probar la guía, o también como imagen de ejemplo en la documentación).

## Reglas para cambios en la guía

- **Reglas por tipo de objeto, nunca por objeto concreto.** La guía debe ser lo más general posible. Se aceptan reglas para galaxias, nebulosas de emisión, oscuras, de reflexión, planetarias, cúmulos globulares o abiertos, etc. No se aceptan reglas del tipo «en M31 usa…» o «para IC 63 pon…». Un objeto concreto puede aparecer como ejemplo de dónde se midió algo, nunca como condición de una regla.
- **Ceñirse a los datos.** Nada que invente estructura que no esté en la imagen. Si propones un umbral o un valor nuevo, acompáñalo de lo que se midió y con qué datos (equipo, filtro, integración, tipo de objeto). Un solo caso es un punto de partida, no una regla.
- **Cada paso es un fichero** con el porqué, los parámetros, el código y el control para comprobarlo. Respeta esa estructura.
- **Escribe en español.** El asistente responde en el idioma del usuario aunque la guía esté en español. Las traducciones completas se coordinan antes en *Discussions*.
- **No incluyas datos personales** (`guia/perfil.md` no se publica; usa `guia/perfil-ejemplo.md` como modelo).

## Reglas para código

- PiAstroPilot es un módulo PCL en C++; el servidor MCP está en TypeScript; los scripts y las funciones de la guía (`guia/herramientas/*.js`) son PJSR. Sigue el estilo del fichero que toques.
- Prueba el cambio en PixInsight antes de abrir la *pull request* y di con qué versión (por ejemplo, 1.9.6 en Windows 11).
- El módulo y la guía van juntos: si cambias la firma de una función de `guia/herramientas/`, actualiza `manifiesto.json` y lo que la use.
- **Reglas CPD de PixInsight.** PixInsight endurece sus reglas para módulos y scripts de terceros (en vigor el 12 de diciembre de 2026), entre ellas la firma de código. Léelas en el foro oficial de PixInsight. No propongas cambios que dependan de saltarse esas reglas. Si tienes dudas sobre si algo las cumple, pregúntalo en *Discussions* antes de programarlo.
- No subas binarios (DLL, `.xsgn`, `.xssk`) ni claves de firma.

## Licencias de las aportaciones

Al aportar aceptas que tu contribución se publique con la licencia de la parte del proyecto que tocas:

- Código (`mcp/`, `piastropilot/`): **MIT**, Copyright (c) 2026 Rafael Vidal ([`LICENSE`](LICENSE)). El puente anterior (`watcher/`, `servidor-mcp/`), ya retirado y solo en el historial de Git, era MIT de Alain Escaffre (original) y Rafael Vidal (modificaciones).
- Guía (`guia/`): **CC BY-SA 4.0** ([`guia/LICENSE.md`](guia/LICENSE.md)).

Las imágenes y datos que enlaces siguen siendo tuyos; solo se usarán como digas en la *issue*.

## Trato

Sé amable y concreto. Aquí se aprende de los fallos, también de los de la guía.

---

# How to contribute

Thanks for wanting to help. This project (the processing guide, the MCP bridge and the PiAstroPilot module) grew out of real processing sessions, almost all with a single rig. What it needs most now is **data and results from other rigs, other skies and other object types**. You do not need to code to make a big contribution.

## What to contribute, most useful first

1. **Real test cases.** Masters (or crops) of object types that have not been tested yet, with telescope, filter and camera. The guide improves per object type, and each new case checks or corrects its starting values.
2. **Bugs with their log.** When a PiAstroPilot or guide step fails or gives an odd result, the panel log (or the PixInsight console) and a screenshot are worth more than any description.
3. **Comparisons.** Your manual processing next to PiAstroPilot's on the same data. They are used to calibrate thresholds: sky level, noise, colour mottle, star contribution, etc.
4. **Tests with other models and hardware.** Codex, other local models, other GPUs, Seestar or other smart telescopes, OSC vs mono, macOS or Linux, other PixInsight versions.
5. **Guide fixes and improvements** by pull request (see the rules below).
6. **Translations** and, later on, **code** for the module or the MCP server.

## Where

| What | Channel |
|---|---|
| Bugs, test cases, comparisons, tests with another model or rig | [Issues](https://github.com/Az0te/astro-agente-repo/issues/new/choose): pick the matching template |
| Ideas, questions, results you want to show | [Discussions](https://github.com/Az0te/astro-agente-repo/discussions) |
| Changes to the guide, code or docs | Pull request against `main` |

Issues can be written in English or Spanish.

**Large files:** do not attach them to the issue. Upload them to Google Drive, OneDrive, Dropbox or WeTransfer and paste the link. A 1000 × 1000 px XISF or FITS crop is usually enough; if you can, say how long the link will stay up.

**Private data:** FITS/XISF headers may contain your coordinates, observatory name or local paths. Check them before sharing. Only share your own data or data you are allowed to share, and say how it may be used (only to test the guide, or also as an example image in the docs).

## Rules for guide changes

- **Rules per object type, never per specific object.** The guide must stay as general as possible. Rules for galaxies, emission, dark, reflection and planetary nebulae, globular or open clusters, etc. are welcome. Rules like "for M31 use…" or "for IC 63 set…" are not. A specific object may appear as an example of where something was measured, never as the condition of a rule.
- **Stay true to the data.** Nothing that invents structure not present in the image. If you propose a new threshold or value, include what was measured and on which data (rig, filter, integration, object type). One case is a starting point, not a rule.
- **Each step is one file** with the why, the parameters, the code and the check. Keep that structure.
- **Write in Spanish.** The assistant answers in the user's language even though the guide is in Spanish. Full translations should be discussed first in Discussions.
- **No personal data** (`guia/perfil.md` is not published; use `guia/perfil-ejemplo.md` as a template).

## Rules for code

- PiAstroPilot is a C++ PCL module; the MCP server is TypeScript; the guide's scripts and functions (`guia/herramientas/*.js`) are PJSR. Follow the style of the file you touch.
- Test the change in PixInsight before opening the pull request and say which version (e.g. 1.9.6 on Windows 11).
- The module and the guide go together: if you change the signature of a function in `guia/herramientas/`, update `manifiesto.json` and its callers.
- **PixInsight CPD rules.** PixInsight is tightening its rules for third-party modules and scripts (in force from 12 December 2026), including code signing. Read them on the official PixInsight forum. Do not propose changes that rely on getting around those rules. If unsure, ask in Discussions before coding.
- Do not commit binaries (DLL, `.xsgn`, `.xssk`) or signing keys.

## Licensing of contributions

By contributing you agree that your contribution is published under the licence of the part of the project you change:

- Code (`mcp/`, `piastropilot/`): **MIT**, Copyright (c) 2026 Rafael Vidal ([`LICENSE`](LICENSE)). The previous bridge (`watcher/`, `servidor-mcp/`), now retired and only in the Git history, was MIT by Alain Escaffre (original) and Rafael Vidal (modifications).
- Guide (`guia/`): **CC BY-SA 4.0** ([`guia/LICENSE.md`](guia/LICENSE.md)).

Images and data you link to remain yours; they will only be used as you state in the issue.

## Conduct

Be kind and specific. We learn from failures here, including the guide's own.
