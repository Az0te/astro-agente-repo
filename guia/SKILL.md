---
name: "astro-procesado-pixinsight"
description: "Procesado de astrofotografía de cielo profundo en PixInsight controlado por Claude a través del watcher MCP: OSC + dual band, HDR con tomas cortas, estrellas y halos, blue bloat, combinación Hα/OIII + RGB, paletas de banda estrecha y controles objetivos de calidad. Fiel a los datos."
---

# Procesado de astrofotografía en PixInsight con Claude

Guía de trabajo para que Claude procese astrofotografías de cielo profundo en PixInsight a través del watcher MCP de este repositorio. Está escrita para Claude (le habla en segunda persona del "usuario"), pero también se puede leer como manual.

## Principio innegociable
**Ceñirse a los datos, no inventar nada**, y sacar la máxima información que contengan. "Revelar, no inventar": cualquier estructura débil se confirma antes de realzarla, y cada paso se compara con la versión sin tocar.

## Reglas que no se saltan (leer `referencia/00-reglas-y-api-basica.md` antes de empezar)
1. Si falla un paso esencial (gradiente, SPCC, BXT, estirado), **para y avisa**: no lo sustituyas por un apaño ni lo des por resuelto.
2. **Nunca** ajustes el color multiplicando canales a mano ni con curvas por canal a ojo; el color sale de SPCC.
3. **Nunca** estires con fórmulas de PixelMath inventadas: usa MAS, GHS o HistogramTransformation.
4. Comprueba cada paso (estadísticas por canal e historial `view.processing`); no te fíes del "success".
5. No inventes funciones, procesos ni IDs: `describe_process` y `list_open_images`. Los procesos se aplican con `P.executeOn(ventana.mainView)`; `.process()`/`.execute()` no existen y la imagen está en `ventana.mainView.image`.
6. BXT, NXT, SXT, SPCC, MGC, MAS y GHS son **procesos** (se ejecutan desde el watcher); ImageSolver, WBPP, DBXtract y GraXpert son **scripts** (los lanza el usuario).
7. Trabaja sobre una copia con nombre de versión y documenta lo que dice el historial, no lo que pretendías.

## Antes de empezar: el perfil del usuario
Lee primero `perfil.md` (cópialo de `perfil-ejemplo.md` y rellénalo): equipo, escala de muestreo, filtros, cielo, rutas de trabajo, iconos de PixInsight disponibles, scripts instalados y preferencias estéticas. Esta guía es genérica; el perfil decide los valores concretos. Cuando el usuario exprese una preferencia nueva (elige una versión frente a otra, pide más o menos saturación…), propón añadirla al perfil.

Los nombres de iconos que aparecen en la guía (SPFC_RGB, SPCC_RGB, NoiseX_075…) son ejemplos del espacio de trabajo del autor: usa los equivalentes del perfil.

## Herramientas y límites del entorno
- PixInsight se controla con la herramienta `run_script` del servidor MCP (código PJSR en el parámetro `code`). Las llamadas de más de ~60 s dan timeout pero siguen ejecutándose: esperar y comprobar (lista de ventanas, historial `view.processing`, ficheros guardados), no relanzar a ciegas. `watcher_status` dice qué comando está en curso y si PixInsight responde.
- Para bucles largos (p. ej. medir cientos de subs), escribir funciones que trabajen ~50 s, guarden el resultado en un CSV incremental y devuelvan el índice siguiente.
- Cada llamada empieza sin estado: guardar funciones reutilizables en `<versión>/tools/*.js` y cargarlas con `eval(File.readTextFile(ruta))`.
- `describe_process` lista los parámetros y constantes reales de un proceso en la versión de PixInsight instalada: úsalo antes de adivinar nombres de parámetros.
- **No se pueden lanzar scripts (ImageSolver, AutoDBE, DBXtract, WBPP, RepairedHSVSeparation…) desde el watcher** (error "Script instance recursively" y un diálogo modal que el usuario debe cerrar). Los procesos sí (`ProcessInstance.fromIcon("Nombre")`, SubframeSelector, ImageIntegration, StarAlignment, HDRComposition…). Pide al usuario que lance él los scripts, con el watcher en pausa (`mcp-pause.bat`).
- Si el watcher deja de responder sin diálogo visible, no insistir con más llamadas pesadas: avisar al usuario. Para parar el watcher: botón Pause/Abort de la consola o `mcp-stop.bat`.
- Para VER resultados: guardar JPG reducidos (IntegerResample) o recortes al 100 % en `<carpeta>/prev/` y leerlos. Es mucho mejor que las capturas de pantalla.
- Descargar desde PJSR: `NetworkTransfer` + `onDownloadDataAvailable` escribiendo a un `File`.
- `beginProcess()` sin `endProcess()` deja la vista bloqueada: si pasa, clonar la imagen a una ventana nueva y cerrar la vieja.
- El historial de cada vista (`view.processing`) permite reconstruir qué se hizo y con qué parámetros.
- Nunca borrar subs ni masters del usuario: mover los descartes a una subcarpeta `_rechazados` y que el usuario confirme. Nunca sobrescribir versiones (v1, v2…).

## Referencia por temas
Carga sólo la sección que necesites:

| Fichero | Tema |
|---|---|
| `referencia/00-reglas-y-api-basica.md` | **Leer siempre primero.** Reglas de trabajo, API básica de PJSR, proceso vs script, requisitos que hacen fallar pasos |
| `referencia/01-trampas-pjsr.md` | Trampas de PJSR y del watcher (ES5, ventanas, PixelMath, memoria) |
| `referencia/02-preprocesado.md` | Calibración, WBPP, selección de subs, índice de halo por sub |
| `referencia/03-hdr-tomas-cortas.md` | HDR con tomas cortas, HDRComposition, de dónde salen las estrellas |
| `referencia/04-mono-osc-dualband.md` | Mezclar mono, OSC y dual band; LRGB; Hα con RGB; HOO/SHO |
| `referencia/05-flujos-astro-photographie.md` | Flujos de referencia OSC5, HRGB1, OSC2; RC-Astro; continuo; DBXtract y su emulación |
| `referencia/06-flujo-lineal.md` | Flujo lineal probado paso a paso |
| `referencia/07-mars-mgc.md` | Gradientes con MARS / MGC |
| `referencia/08-estrellas.md` | Separación, estirado y recombinación de estrellas |
| `referencia/09-halos-estrellas-brillantes.md` | Halos de estrellas brillantes |
| `referencia/10-blue-bloat-halos-azules.md` | Blue bloat, halos azules, dominantes de color |
| `referencia/11-combinacion-ha-oiii-rgb.md` | Combinación Hα/OIII + RGB en no lineal |
| `referencia/12-paletas-emision.md` | Previews de paletas para objetos de emisión |
| `referencia/13-mas.md` | MultiscaleAdaptiveStretch |
| `referencia/14-estirado.md` | Elegir método de estirado; GHS en detalle |
| `referencia/15-contraste-nitidez.md` | Contraste local, LHE, HDRMT, nitidez |
| `referencia/16-por-tipo-de-objeto.md` | Emisión, reflexión, oscuras, planetarias, galaxias, cúmulos… |
| `referencia/17-controles-calidad.md` | Controles objetivos: ringing, núcleos quemados, estrellas |
| `referencia/18-validacion.md` | Validación y revisión crítica final |
| `referencia/19-verificacion-entrega.md` | Verificación y entrega de cada versión |
| `referencia/20-graxpert-comparativa-gradientes.md` | GraXpert y protocolo para comparar métodos de gradiente con medidas |
| `referencia/21-bxt-nxt.md` | BlurXTerminator y NoiseXTerminator: orden, ajustes por objeto, rejilla de variantes con medidas |
| `FUENTES.md` | Fuentes consultadas |

## Flujo de trabajo resumido
1. Leer el perfil e inspeccionar los masters (estadísticas, escala, rotación, píxeles saturados).
2. Clasificar el objeto y decidir qué es "el tema" (`16-por-tipo-de-objeto.md`).
3. Procesado lineal (`06-flujo-lineal.md`): gradiente elegido por comparativa medida (`20`), BXT Correct Only antes de SPCC y parámetros de BXT/NXT elegidos con rejilla de variantes (`21`); estrellas separadas pronto (`08-estrellas.md`).
4. Estirado y combinación (`11`, `13`, `14`), con variantes en los pasos dudosos.
5. Controles objetivos y revisión crítica (`17`, `18`), comparando siempre con "no hacer nada".
6. Entregar cada versión con nombre nuevo y un dossier de qué se hizo y por qué (`19`).
