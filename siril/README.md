# SirilAstroPilot

Equivalente de PiAstroPilot para **Siril**: un servidor MCP que deja a Claude Code, Codex o un modelo local procesar en Siril con herramientas de una lista blanca, siguiendo la misma guía (`guia/`) que PixInsight. Desarrollado por **Rafael Vidal** (2026). Licencia MIT.

> Estado (noviembre de 2026): procesado completo en Siril 1.4.x, desde el apilado hasta la exportación, con 42 herramientas, comparación de candidatos en cada paso y chat dentro de Siril. Probado con procesados reales (una galaxia y una nebulosa de emisión con RGB + dual band) frente a PiAstroPilot: ver la [comparativa PixInsight frente a Siril](../comparativas/dossier_PI_vs_Siril_M31_IC1396.pdf).

## Cómo funciona

```
modelo ──MCP (stdio)──> siril/mcp/dist/sirilastropilot-mcp.mjs ──TCP 127.0.0.1 + token──> puente/SirilAstroPilot.py ──sirilpy──> Siril
```

1. En Siril se lanza una vez el script `SirilAstroPilot` (menú Scripts). Se queda escuchando en `127.0.0.1:48731` y escribe `~/.sirilastropilot/puente.json` (puerto) y `~/.sirilastropilot/token`.
2. El servidor MCP lee el manifiesto (`herramientas/manifiesto.json`) y ofrece sus herramientas. Cada llamada va al puente como una línea JSON `{id, token, herramienta, args}`.
3. El puente comprueba el token, ejecuta la herramienta **solo si está en `herramientas.LISTA`** y la hace en un único hilo, una detrás de otra. No hay `eval` ni código libre.

Las herramientas que tardan más de 45 s devuelven un id de trabajo; el resultado se recoge con `estado(trabajo)`. Las fichas de la guía se ofrecen como recursos MCP (`guia:///...`).

## Herramientas (0.2.0)

| Nivel | Herramientas |
|---|---|
| lectura | `ping`, `imagen`, `estadisticas` (0–1, rect, bordes), `previa` (JPG con el autoestirado de Siril), `analizarMaster`, `estrellas`, `medirRendimiento`, `registro` (consola de Siril: últimas líneas, solo errores o filtro) |
| disco | `abrirImagen`, `guardarImagen` (no sobrescribe) |
| vista | `deshacer`, `rehacer`, `comandoSiril` (lista blanca de comandos de procesado: estirados, fondo, color, ruido, estrellas, geometría; GraXpert no, en Siril 1.4 no hay comandos graxpert_* e irá como herramienta propia) |

Siril tiene una sola imagen cargada: ninguna herramienta lleva `vista`. Coordenadas como en pantalla (0,0 arriba a la izquierda) y valores de píxel en 0–1, igual que en PixInsight.

### Por paso de la guía (`herramientas/pasos.py`)

| Paso | Herramienta | Con qué |
|---|---|---|
| L5 Recorte | `recortarBordes` | crop del rectángulo sin cuñas sin datos |
| L5/L7/L10 Varios masters | `alinearMasters`, `desmezclarDualBand`, `combinarCandidatos` → `aplicarCandidato` | alinear y recortar a la zona común (`multicapa.py`; XISF con lectura propia, `xisf.py`), separar Hα y OIII del dual band, combinar con el RGB lineal calibrado |
| L8 Astrometría | `resolverAstrometria` | platesolve |
| L9 Gradiente | `gradienteCandidatos` → `aplicarCandidato` | subsky polinomio 1 y 2, subsky RBF, GraXpert IA (CLI) |
| L12 Color | `listaSPCC`, `calibrarColor` | spcc |
| L11/L13 Deconvolución | `nitidezLineal` | IA de RC Astro por su CLI (`rc-astro bxt`), solo corregir o completa; FWHM antes y después |
| L15 Estrellas | `separarEstrellas` | starnet de Siril o, si falla, StarNet2 (2.5+) directo |
| L15 Estrellas | `estrellasCandidatos` → `aplicarCandidato` | StarNet2 frente a StarX (`rc-astro sxt`): restos de estrellas, agujeros, objeto quitado |
| NL1 Estirado | `estirarCandidatos` → `aplicarCandidato` | GHS al fallo (ght + linstretch; también con la simetría en la señal débil), arcsinh al fallo, por escalas, autostretch; punto negro en lineal y altas luces hacia neutro |
| NL5 Núcleo (galaxias) | `nucleoCandidatos` → `aplicarCandidato` | comprimir el bulbo con máscara suave (`nucleo.py`): meseta, anillos, brillo |
| NL5 Contraste | `contrasteCandidatos` → `aplicarCandidato` | CLAHE, ondículas, máscara de enfoque |
| NL3 SCNR | `quitarVerde` | rmgreen |
| L14 / NL6 Ruido | `reducirRuidoCandidatos` → `aplicarCandidato` | denoise (fuerza 0,5/0,7/1,0 y DA3D) y, con `ia`, el de RC Astro (`rc-astro nxt`) frente a nada: ruido del cielo y pérdida de detalle (< 10 %) |
| NL5 Saturación | `saturacionCandidatos` → `aplicarCandidato` | satu 0,25/0,5/0,75 (fondo 1): saturación en objeto y cielo, dominante del cielo < 5 %, recortes |
| NL9 Recombinación | `recombinarEstrellas` | starless cargada + fichero de estrellas, screen o suma con factor; avisa (y estira con arcsinh si se pide) si las estrellas son lineales |
| NL10 Exportación | `exportarFinal` | savetif (16 bits) + savejpg 95 como `<nombre>_final`, sin sobrescribir (_2, _3…) |

Comparar en Siril (una sola imagen): se guarda la imagen, cada candidato se aplica, se mide y se guarda en `~/.sirilastropilot/trabajo/`, y la imagen vuelve a como estaba. `aplicarCandidato(id)` pone el elegido, exactamente el que se midió, con deshacer. GraXpert: si no lo encuentra, poner su ruta en `~/.sirilastropilot/config.json` (`{"graxpert": "C:/…/GraXpert.exe"}`). Igual con `starnet2` (si no está en la preferencia de StarNet de Siril) y `rcastro` (por defecto `C:\Program Files\RC-Astro\CLI\rc-astro.exe`; vale la licencia de RC Astro que ya se tenga).

Todo está escrito desde cero con sirilpy y comandos de Siril: no se usa código de PixInsight. Solo se comparten los criterios de la guía (umbrales y qué medir).

Para añadir una herramienta: la función en `herramientas/herramientas.py`, su línea en `LISTA` y su entrada en `herramientas/manifiesto.json`.

## Chat dentro de Siril (`herramientas/chat.py`)

Ventana de chat (PyQt6) para procesar hablando con un modelo, sin salir de Siril. **Un solo script**: Scripts > **SirilAstroPilot** arranca el puente y abre el chat en el mismo proceso (la ventana en el hilo principal, el puente en los suyos: no se bloquean entre sí ni bloquean Siril).

- Cerrar la ventana **no** para el puente: sigue para Claude Code u otro cliente MCP. Para volver a abrir el chat, relanzar el script (el puente nuevo detiene al anterior).
- Sólo puente, sin ventana: desmarcar *Abrir el chat al lanzar* en el chat (se guarda en `~/.sirilastropilot/chat.json`) o `SIRILASTROPILOT_SOLO_PUENTE=1`.

1. Lanza el script **SirilAstroPilot** desde el menú Scripts.
2. Elige el modelo: uno local de Ollama (por defecto `qwen38-32k`; arranca Ollama antes) o **Claude (CLI)** (usa `claude` con el MCP sirilastropilot; casilla *Internet* para dejarle buscar en la web).
3. Escribe (Ctrl+Intro envía) o pulsa **🎤 Dictar**: abre el dictado de Windows (Win+H) sobre la caja de texto; hablas y el texto aparece; para terminar calla o vuelve a pulsar. El idioma del dictado es el de Windows (Configuración > Hora e idioma > Voz).

- Solo conversación: ningún botón por herramienta. El modelo usa las herramientas del puente (lista blanca); en el chat se ven en gris (⚙ llamada, ✓/✗ resultado y tiempo) y las previas como miniaturas (clic para abrir).
- Tokens de entrada y salida por respuesta y en total; con Claude, coste en $ (cada turno con el CLI cuesta al menos ~0,3 $ por el arranque de Claude Code; con el modelo local, 0).
- Idioma de la interfaz y de las respuestas: Español / English (se guarda en `~/.sirilastropilot/chat.json`, con el modelo y la casilla Internet). Cambiarlo empieza conversación nueva.
- **Limpiar** empieza una conversación nueva; **Detener** corta el turno (no deshace lo hecho en Siril).
- El modelo local recibe las herramientas con su `resumen` y lee las fichas de la guía con la herramienta local `ficha` (solo lectura de `guia/`).

## Instalar

Requisitos: Siril 1.4 o superior (con Python y sirilpy) y Node.js 18 o superior.

1. Siril > Preferencias > Scripts: añade la carpeta `…/astro-agente-repo/siril/puente` a las carpetas de scripts y refresca. Aparece `SirilAstroPilot` en el menú Scripts.
2. Registra el MCP (no hace falta `npm install`, `dist/` lleva todo dentro):

```
claude mcp add sirilastropilot -- node C:/ruta/al/repo/siril/mcp/dist/sirilastropilot-mcp.mjs
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.sirilastropilot]
command = "node"
args = ["C:/ruta/al/repo/siril/mcp/dist/sirilastropilot-mcp.mjs"]
```

Variables opcionales: `SIRILASTROPILOT_PUERTO` (puente, por defecto 48731), `SIRILASTROPILOT_ESPERA_S`, `SIRILASTROPILOT_COMPACTO=1`, `SIRILASTROPILOT_FASE=lineal|no-lineal`, `SIRILASTROPILOT_GUIA`.

## Validar en el PC

1. Abre un master en Siril y lanza el script `SirilAstroPilot`. En la consola debe salir «escuchando en 127.0.0.1:48731. Herramientas: 42». El puente recarga solo las herramientas si cambia algún fichero de `herramientas/`.
2. Desde la raíz del repo: `node siril/pruebas/prueba-mcp.mjs`. Hace ping, imagen, estadísticas, analizarMaster, previa, comprueba que rechaza `load` y termina con `medirRendimiento`.
3. Mientras corre, comprueba que la interfaz de Siril sigue respondiendo (zoom, desplazar la imagen).

Sin Siril (solo para desarrollo): `PYTHONPATH=siril/pruebas/falso python siril/puente/SirilAstroPilot.py` lanza el puente con un sirilpy falso (imagen sintética de 26 MP). `SIRIL_FALSO_TAM=1600x1100` la reduce; `SIRIL_FALSO_NEB=grande` pone una nebulosa que llena el campo, con textura fina (para probar el gradiente y la pérdida de detalle del denoise).

## Desarrollo

```
cd siril/mcp
npm install
npm run check   # tipos
npm run build   # regenera dist/sirilastropilot-mcp.mjs
```
