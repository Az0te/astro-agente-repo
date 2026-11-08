# PiCopilot Lite (script PJSR)

Versión mínima de PiCopilot como **script** de PixInsight: no es un módulo ni una DLL, así que no necesita firma.

## Lanzarlo

`Script > Execute Script File…` y elegir `picopilot/script/PiCopilotLite.js`.

## Qué hace

- **Prompt**: chat con el modelo. Cuando el modelo quiere actuar, responde con un bloque ```javascript; se ejecuta
  con «Ejecutar script» (o solo, si está marcada «Ejecutar sin preguntar»). El resultado (lo que el script manda con
  `chat(...)` y el valor de su última expresión) vuelve al chat y a la conversación. Si falla, «Pedir corrección»
  reenvía el error al modelo (máximo 3 veces seguidas; con «Ejecutar sin preguntar» se reenvía solo).
- **Modelo**: Ollama (HTTP, `/api/chat`, lista de modelos leída de `/api/tags`), Claude Code (`claude -p` sin
  herramientas ni MCP) o Codex (`codex exec` en solo lectura). Las CLI reciben el prompt por un fichero temporal.
- **Ajustes**: URL de Ollama, temperatura, rutas de `claude` y `codex`, carpeta de la guía. Se guardan con `Settings`
  de PixInsight (claves `PiCopilotLite/...`).

El modelo recibe un prompt corto con las reglas de la guía, la lista de funciones de
`guia/herramientas/manifiesto.json` y las ventanas abiertas (id, tamaño, canales y si parecen lineales por la mediana).
El script carga en el propio PixInsight las herramientas de la guía y las funciones del runner del MCP
(`vistas`, `estadisticas`, `previa`, `abrirImagen`…). `resolverAstrometria` no está disponible en esta versión.

Mientras espera al modelo, el diálogo no se congela (Ollama en un hilo aparte; las CLI con un bucle de eventos) y se
puede cancelar. El diálogo es modal: mientras está abierto no se puede trabajar en el resto de PixInsight.

## Pruebas automáticas

```
PixInsight.exe -x=<ruta>/PiCopilotLite.js,--prueba[,<salida.json>[,claude|codex]]
```

Abre y cierra el diálogo simulando una pregunta, guarda ajustes, pregunta a Ollama, ejecuta scripts de prueba y escribe
el resultado en `<salida.json>` (por defecto en la carpeta temporal `PiCopilotLite`).

## Trampas del preprocesador de PJSR

- No escribir barra-asterisco ni asterisco-barra seguidos en ningún sitio (ni en comentarios `//`, cadenas o regex):
  el preprocesador abre o cierra un comentario de bloque y el script no compila.
- Con `#engine v8` no incluir `<pjsr/Sizer.jsh>` (los sizers ya existen) y heredar de `Dialog` con `class … extends`.
