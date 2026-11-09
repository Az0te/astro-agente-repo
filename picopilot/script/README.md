# PiCopilot Lite (script de PixInsight)

PiCopilot Lite es la forma más sencilla de usar el asistente: un **script** de PixInsight. No es un módulo ni una DLL, así que **no hay que compilar ni firmar nada**. Abre una ventana con el chat, el modelo propone qué funciones de la guía usar y con qué parámetros, y tú decides si se ejecutan. **El modelo nunca escribe código**: sólo pide funciones del manifiesto (`guia/herramientas/manifiesto.json`), y PiCopilot Lite comprueba cada llamada antes de ejecutarla.

*English: see [README.en.md](README.en.md). La ventana y las respuestas se pueden poner en inglés en Ajustes > Idioma.*

## Requisitos

- [PixInsight](https://pixinsight.com) 1.9.6 o superior. Probado en Windows 10/11. En **macOS y Linux** debería funcionar todo salvo partes de la voz (sin probar todavía): en macOS lee con `say` y el dictado se abre a mano (dos veces la tecla Fn); en Linux lee con `spd-say` si está instalado y no hay dictado.
- Este repositorio descargado (la guía tiene que estar en `guia/`, junto a `picopilot/`).
- Un modelo, uno de estos:
  - **Ollama** (local, gratis, sin internet): [ollama.com](https://ollama.com) con un modelo descargado, por ejemplo `ollama pull qwen3:32b`. PiCopilot Lite lo busca en `http://localhost:11434`.
  - **Claude Code** (de pago, el que mejor resultado da): [instalado](https://docs.anthropic.com/es/docs/claude-code) y con sesión iniciada (`claude` en una terminal).
  - **Codex** (OpenAI): `npm install -g @openai/codex` y `codex login`.
- Para la astrometría (`resolverAstrometria`): un índice de Gaia configurado en las preferencias del proceso Gaia.
- Opcionales, pero la guía los usa mucho: BlurXTerminator, NoiseXTerminator, StarXTerminator y GraXpert (cada uno con su licencia).

No hace falta Node.js ni el servidor MCP: el script carga la guía en el propio PixInsight.

## Instalar

1. Descarga el repositorio (botón **Code > Download ZIP** en GitHub, o `git clone`) y descomprímelo, por ejemplo en `C:\Users\<tu_usuario>\astro-agente-repo`.
2. Opcional, para tenerlo en el menú: en PixInsight, **Script > Feature Scripts…**, botón **Add**, elige la carpeta `picopilot\script` y pulsa **Done**. Desde entonces está en **Script > PiCopilot > PiCopilotLite**.
3. Opcional: copia `guia/perfil-ejemplo.md` como `guia/perfil.md` y rellénalo con tu equipo, cielo y rutas (por ejemplo, el modelo `.xmlm` de MLDenoise). No se sube a GitHub.

## Usar

1. Abre tu imagen en PixInsight.
2. Lanza **Script > PiCopilot > PiCopilotLite** (o **Script > Execute Script File…** y elige `picopilot/script/PiCopilotLite.js`).
3. En la pestaña **Modelo** elige el proveedor (Ollama, Claude Code o Codex) y el modelo. En **Ajustes** revisa la URL de Ollama, las rutas de `claude`/`codex` y la carpeta de la guía (se detecta sola), y elige el **Idioma** (español o inglés).
4. En **Prompt** escribe lo que quieres, por ejemplo «hazme un análisis de la imagen». Cuando el modelo proponga llamadas, pulsa **Ejecutar llamadas** (o marca **Ejecutar sin preguntar**). Las líneas «Siguiente paso» del chat son enlaces: púlsalos para hacer ese paso.
5. Para procesar la imagen entera, pulsa **Procesado completo**: el modelo dice qué pasos aplican y los hace uno a uno, parando en cada uno hasta que escribas «sigue» o pulses el enlace del siguiente.

## Qué hace

- **Chat en HTML** con tablas, colores y enlaces, como el módulo. Los resultados de las llamadas salen como fichas («Cumple / No cumple», medidas, JSON plegado) y el modelo los interpreta y recomienda el paso siguiente.
- **Funciones de la guía** ya cargadas: análisis, astrometría (motor de BlindSolver), gradiente, ruido, estirado, contraste local, núcleos, saturación, estrellas, exportación… Donde hay varios métodos, **compara candidatos** y se queda con el mejor medido (gradiente: GraXpert, GradientCorrection, MGC, polinomio; ruido: NXT, MLDenoise, MultiscaleTGVDenoise y el híbrido ML + NXT; estirado: GHS, MAS, Arcsinh; contraste: LHE, HDRMT, DarkStructureEnhance; núcleo: HDRMT, GradientHDRCompression). Cada candidato sale con su **miniatura** en el chat (en el gradiente, con el modelo quitado al lado).
- En imágenes de más de 8 MP, ruido, estirado y contraste **comparan en un recorte** de 2000 px y aplican sólo el ganador a la imagen entera. MLDenoise sólo usa la GPU con NVIDIA; en AMD o Intel va por CPU (~13 s por megapíxel).
- **Dossier PDF** e **Informe .md**: el primero guarda la conversación con sus fichas y miniaturas en PDF (tema claro, para imprimir); el segundo, un Markdown con las funciones usadas, los errores con las llamadas que los provocaron y la conversación, para recopilar procesados y mejorar la guía. Se guardan en la carpeta de dossieres de Ajustes (por defecto `~/PiCopilotLite/dossiers`).
- **Tokens**: cada respuesta lleva su consumo (y el coste con Claude) y arriba del prompt se ve el total de la conversación.
- **Internet** (casilla «Internet»): ficha del objeto (tipo, emisión esperada, estrellas brillantes que darán problemas) con SIMBAD y Wikipedia, e imágenes de catálogo. Con Claude, además, búsqueda web. Desmarcada, nada sale a internet.
- **Voz**: «Dictar» abre el dictado de Windows (Win + H) en el prompt y «Leer en voz alta» lee las respuestas con la voz de Windows.
- **Pesos N**: con Claude o Codex en «auto (pesos N)», elige un modelo más barato (sonnet) o más capaz (opus), como el módulo.
- **Idioma** (Ajustes > Idioma): español o inglés. Cambia al momento los textos de la ventana y el modelo pasa a responder en ese idioma.
- Ajustes guardados en PixInsight (claves `PiCopilotLite/...`).

Mientras espera al modelo la ventana no se congela y se puede cancelar. Es una ventana modal: mientras está abierta no se puede usar el resto de PixInsight (el módulo PiCopilot sí lo permite).

## Problemas frecuentes

- **«No encuentro … guia»**: en Ajustes, pon la carpeta `guia` del repositorio.
- **Ollama no responde**: abre Ollama (o `ollama serve`) y pulsa «Leer modelos de Ollama» en la pestaña Modelo.
- **Astrometría: «No astrometric index file is available»**: configura el índice de Gaia en las preferencias del proceso Gaia.
- **Errores**: copia lo que sale en la consola de PixInsight y ábrelo como [*issue*](https://github.com/Az0te/astro-agente-repo/issues/new/choose).

## Para desarrolladores

Prueba automática (abre otra instancia de PixInsight sin tocar la tuya):

```
PixInsight.exe -n --automation-mode --no-focus-stealing -r=<ruta>/PiCopilotLite.js,--prueba,<salida.json>[,claude|codex] --force-exit
```

Abre y cierra el diálogo simulando una pregunta, un clic en un enlace y un cambio de idioma, carga la guía, comprueba el motor de BlindSolver, la voz y el bloqueo de internet, pregunta a Ollama, ejecuta llamadas de prueba y comprueba que se rechaza todo lo que no está en el manifiesto. El resultado va a `<salida.json>`.

Trampas del preprocesador de PJSR: no escribir barra-asterisco, asterisco-barra ni doble barra seguidas dentro de cadenas o regex (se toman como comentarios); con `#engine v8` no incluir `<pjsr/Sizer.jsh>` y heredar de `Dialog` con `class … extends`; los `.js` sin BOM.
