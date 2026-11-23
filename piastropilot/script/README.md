# PiAstroPilot Lite (script de PixInsight)

PiAstroPilot Lite es la forma más sencilla de usar el asistente: un **script** de PixInsight. No es un módulo ni una DLL, así que **no hay que compilar ni firmar nada**. Abre una ventana con el chat, el modelo propone qué funciones de la guía usar y con qué parámetros, y tú decides si se ejecutan. **El modelo nunca escribe código**: sólo pide funciones del manifiesto (`guia/herramientas/manifiesto.json`), y PiAstroPilot Lite comprueba cada llamada antes de ejecutarla.

*English: see [README.en.md](README.en.md). La ventana y las respuestas se pueden poner en inglés en Ajustes > Idioma.*

## Requisitos

- [PixInsight](https://pixinsight.com) 1.9.6 o superior. Probado en Windows 10/11. En **macOS y Linux** debería funcionar todo salvo partes de la voz (sin probar todavía): en macOS lee con `say` y el dictado se abre a mano (dos veces la tecla Fn); en Linux lee con `spd-say` si está instalado y no hay dictado.
- Este repositorio descargado (la guía tiene que estar en `guia/`, junto a `piastropilot/`).
- Un modelo, uno de estos:
  - **Ollama** (local, gratis, sin internet): [ollama.com](https://ollama.com) con un modelo descargado, por ejemplo `ollama pull qwen3:32b`. PiAstroPilot Lite lo busca en `http://localhost:11434`.
  - **Claude Code** (de pago, el que mejor resultado da): [instalado](https://docs.anthropic.com/es/docs/claude-code) y con sesión iniciada (`claude` en una terminal).
  - **Codex** (OpenAI): `npm install -g @openai/codex` y `codex login`.
  - **Gemini** (Google, gratis con clave, sin gráfica ni suscripción): clave de [aistudio.google.com/apikey](https://aistudio.google.com/apikey), que el Lite pide al elegir Gemini (botón **Clave…** junto al proveedor; se guarda en la variable `GEMINI_API_KEY`) y proveedor *Gemini (API, gratis con clave)*. **Menos fiable** que la IA local o las de pago: sirve para probar; revisa cada paso. Más en [Qué IA usar](../../README.md#qué-ia-usar-y-cómo-configurarla).
  - **RDNA-FAST** (local, para AMD RX 7900 y otras RDNA3/4): llama-server compilado con ROCm y proveedor *RDNA-FAST (local, llama-server)*. Ver [Motor local RDNA-FAST](#motor-local-rdna-fast-amd-rx-7900).
- Para la astrometría (`resolverAstrometria`): un índice de Gaia configurado en las preferencias del proceso Gaia.
- Opcionales, pero la guía los usa mucho: BlurXTerminator, NoiseXTerminator, StarXTerminator y GraXpert (cada uno con su licencia).

No hace falta Node.js ni el servidor MCP: el script carga la guía en el propio PixInsight.

## Instalar

1. Descarga el repositorio (botón **Code > Download ZIP** en GitHub, o `git clone`) y descomprímelo, por ejemplo en `C:\Users\<tu_usuario>\astro-agente-repo`.
2. Opcional, para tenerlo en el menú: en PixInsight, **Script > Feature Scripts…**, botón **Add**, elige la carpeta `piastropilot\script` y pulsa **Done**. Desde entonces está en **Script > PiAstroPilot > PiAstroPilotLite**.
3. Opcional: copia `guia/perfil-ejemplo.md` como `guia/perfil.md` y rellénalo con tu equipo, cielo y rutas (por ejemplo, el modelo `.xmlm` de MLDenoise). No se sube a GitHub.

## Usar

1. Abre tu imagen en PixInsight.
2. Lanza **Script > PiAstroPilot > PiAstroPilotLite** (o **Script > Execute Script File…** y elige `piastropilot/script/PiAstroPilotLite.js`).
3. En la pestaña **Modelo** elige el proveedor (Ollama, Claude Code, Codex, Gemini o RDNA-FAST) y el modelo. En **Ajustes** revisa la URL de Ollama, las rutas de `claude`/`codex` y la carpeta de la guía (se detecta sola), y elige el **Idioma** (español o inglés).
4. En **Prompt** escribe lo que quieres, por ejemplo «hazme un análisis de la imagen». Las funciones de la guía que pide el modelo se ejecutan solas (se comprueban antes contra el manifiesto) y el modelo te explica el resultado; si fallan, le pide la corrección (hasta 3 veces). Las líneas «Siguiente paso» del chat son enlaces: púlsalos para hacer ese paso.

## Qué hace

- **Chat en HTML** con tablas, colores y enlaces, como el módulo. Los resultados de las llamadas salen como fichas («Cumple / No cumple», medidas, JSON plegado) y el modelo los interpreta y recomienda el paso siguiente.
- **Funciones de la guía** ya cargadas: análisis, astrometría (motor de BlindSolver), gradiente, ruido, estirado, contraste local, núcleos, saturación, estrellas, exportación… Donde hay varios métodos, **compara candidatos** y se queda con el mejor medido (gradiente: GraXpert, GradientCorrection, MGC, polinomio; ruido: NXT, MLDenoise, MultiscaleTGVDenoise y el híbrido ML + NXT; estirado: GHS, MAS, Arcsinh; contraste: LHE, HDRMT, DarkStructureEnhance; núcleo: HDRMT, GradientHDRCompression). Cada candidato sale con su **miniatura** en el chat (en el gradiente, con el modelo quitado al lado).
- En imágenes de más de 8 MP, ruido, estirado y contraste **comparan en un recorte** de 2000 px y aplican sólo el ganador a la imagen entera. MLDenoise sólo usa la GPU con NVIDIA; en AMD o Intel va por CPU (~13 s por megapíxel).
- **Dossier PDF** e **Informe .md**: el primero guarda la conversación con sus fichas y miniaturas en PDF (tema claro, para imprimir); el segundo, un Markdown con las funciones usadas, los errores con las llamadas que los provocaron y la conversación, para recopilar procesados y mejorar la guía. Se guardan en la carpeta de dossieres de Ajustes (por defecto `~/PiAstroPilotLite/dossiers`).
- **Tokens**: cada respuesta lleva su consumo (y el coste con Claude) y arriba del prompt se ve el total de la conversación.
- **Internet** (casilla «Internet»): ficha del objeto (tipo, emisión esperada, estrellas brillantes que darán problemas) con SIMBAD y Wikipedia, e imágenes de catálogo. Con Claude, además, búsqueda web. Desmarcada, nada sale a internet.
- **Voz**: «Dictar» abre el dictado de Windows (Win + H) en el prompt y «Leer en voz alta» lee las respuestas con la voz de Windows.
- **Pesos N**: con Claude o Codex en «auto (pesos N)», elige un modelo más barato (sonnet) o más capaz (opus), como el módulo.
- **Idioma** (Ajustes > Idioma): español o inglés. Cambia al momento los textos de la ventana y el modelo pasa a responder en ese idioma.
- Ajustes guardados en PixInsight (claves `PiAstroPilotLite/...`).

Mientras espera al modelo la ventana no se congela y se puede cancelar. Es una ventana modal: mientras está abierta no se puede usar el resto de PixInsight (el módulo PiAstroPilot sí lo permite).

## Motor local RDNA-FAST (AMD RX 7900)

[RDNA-FAST](https://github.com/serrynaimo/RDNA-FAST) es un `llama-server` (llama.cpp) optimizado para gráficas AMD RDNA3 y RDNA4. Lee el prompt muchas veces más rápido que Ollama en estas tarjetas. El Lite lo usa por su API compatible con OpenAI (`http://127.0.0.1:1234/v1`, sin clave), con las mismas llamadas en el bloque ```json que con Ollama. Va sin razonamiento y ve las previas.

**Requisitos (Windows):**
- **ROCm 10.1 (TheRock):** el tarball `therock-dist-windows-gfx110X-all-10.1.0.tar.gz` para RDNA3, descomprimido en cualquier carpeta. No necesita instalador.
- **Para compilar:** Visual Studio con cmake y ninja, y el Windows SDK (`rc.exe`). Sigue la compilación del README de RDNA-FAST con `-DGPU_TARGETS=gfx1100` (RX 7900).
- **Si usas Visual Studio 2026 y falla en `intrin.h`** («`__host__ __device__` function cannot overload `__host__` function»): compila con el toolset MSVC 14.44, poniendo `VCToolsInstallDir=<VS>\VC\Tools\MSVC\14.44.<versión>\` antes de cmake. Empieza desde una carpeta de compilación vacía.

**Modelo recomendado:**
- [`Qwen3.8-27B-UD-IQ4_XS.gguf`](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF) de unsloth (14,4 GB). Trae la cabeza MTP para el borrador.
- Para la visión, el [`mmproj-Qwen3.8-27B-BF16.gguf`](https://huggingface.co/lmstudio-community/Qwen3.8-27B-GGUF).
- En AMD conviene IQ4_XS antes que Q4_K_M: el Q4_K_M va por el camino lento y en 24 GB no cabe holgado.

**Arranque de ejemplo** (cmd, desde la carpeta de `llama-server.exe`; 98k de contexto en 24 GB). Antes descarga el modelo de Ollama (`ollama stop <modelo>`): los dos no caben a la vez en la gráfica.

```
set "PATH=<carpeta de ROCm 10.1>\bin;%PATH%"
set GGML_CUDA_NO_PINNED=1
set ROCMFPX_DRAFT_VOCAB=24576
llama-server -m <modelos>\Qwen3.8-27B-UD-IQ4_XS.gguf --mmproj <modelos>\mmproj-Qwen3.8-27B-BF16.gguf ^
  -dev ROCm0 -ngl 999 -fa on --jinja -c 98304 -np 2 --kv-unified --kv-unified-reserve 12288 ^
  -ctk q4_0 -ctv q4_0 -ctkd q4_0 -ctvd q4_0 -b 2048 -ub 2048 ^
  --cache-ram 0 --cache-disk <carpeta de caché> --cache-disk-limit 16384 ^
  --spec-type "draft-mtp,ngram-map-k4v" --spec-draft-n-max 4 --spec-draft-p-min 0.60 ^
  --temp 0.2 --alias qwen/qwen3.8-27b --host 127.0.0.1 --port 1234
```

Después, en la pestaña **Modelo**, elige *RDNA-FAST (local, llama-server)*. Si dejas el modelo vacío, usa el que sirva el servidor.

**Medido (RX 7900 XTX, 20 nov 2026)** en una pasada completa de IC 405 en PixInsight, con la misma petición, el mismo código y temp 0.2:
- **RDNA-FAST con Qwen3.8 IQ4_XS:** 22 min, con 95 % de llamadas correctas.
- **Ollama con qwen3.8 Q4_K_M a 64k:** 46 min, con 89 % de llamadas correctas.

La calidad final fue parecida. Gran parte de la ganancia viene de que el prompt de sistema del Lite ya no cambia entre peticiones y el historial se recorta en bloque: el servidor reutiliza su caché (85 % del prompt por petición).

## Problemas frecuentes

- **«No encuentro … guia»**: en Ajustes, pon la carpeta `guia` del repositorio.
- **Ollama no responde**: abre Ollama (o `ollama serve`) y pulsa «Leer modelos de Ollama» en la pestaña Modelo.
- **RDNA-FAST no responde**: arranca `llama-server` (ver [Motor local RDNA-FAST](#motor-local-rdna-fast-amd-rx-7900)) y comprueba que Ollama no tiene un modelo cargado en la gráfica.
- **Astrometría: «No astrometric index file is available»**: configura el índice de Gaia en las preferencias del proceso Gaia.
- **Errores**: copia lo que sale en la consola de PixInsight y ábrelo como [*issue*](https://github.com/Az0te/astro-agente-repo/issues/new/choose).

## Para desarrolladores

Prueba automática (abre otra instancia de PixInsight sin tocar la tuya):

```
PixInsight.exe -n --automation-mode --no-focus-stealing -r=<ruta>/PiAstroPilotLite.js,--prueba,<salida.json>[,claude|codex] --force-exit
```

Abre y cierra el diálogo simulando una pregunta, un clic en un enlace y un cambio de idioma, carga la guía, comprueba el motor de BlindSolver, la voz y el bloqueo de internet, pregunta a Ollama, ejecuta llamadas de prueba y comprueba que se rechaza todo lo que no está en el manifiesto. El resultado va a `<salida.json>`.

Trampas del preprocesador de PJSR: no escribir barra-asterisco, asterisco-barra ni doble barra seguidas dentro de cadenas o regex (se toman como comentarios); con `#engine v8` no incluir `<pjsr/Sizer.jsh>` y heredar de `Dialog` con `class … extends`; los `.js` sin BOM.
