# picopilot-mcp

Servidor MCP de PiCopilot. Ofrece a Claude Code, Codex o cualquier cliente MCP **las funciones de la guía** (`guia/herramientas/`) como herramientas, en vez de procesos genéricos. Desarrollado por **Rafael Vidal** (2026). Licencia MIT.

> Estado: **0.2.0.** Desde noviembre de 2026 es el único puente: el antiguo `servidor-mcp/` + `watcher/` (MCP `pixinsight`) se retiró.

## Cómo funciona

1. El modelo llama a una herramienta (`analizarMaster`, `inventario`…). Sus parámetros están descritos en `guia/herramientas/manifiesto.json`.
2. El servidor deja la petición en `~/.picopilot/peticiones/<id>.json` y lanza `PixInsight.exe -x=mcp/pjsr/picopilot-runner.js,<id>`. PixInsight la recibe por IPC en la instancia que ya tienes abierta.
3. `picopilot-runner.js` comprueba el token (`~/.picopilot/token`), ejecuta la función **solo si está en su lista blanca** y escribe `~/.picopilot/resultados/<id>.json`.

No hay carpeta vigilada, watcher ni `eval`: la guía se carga con `#include` y la petición solo lleva nombre y parámetros. Si PixInsight está ocupado (otro script, un proceso largo), la petición espera en cola y se ejecuta al quedar libre. Las herramientas que tardan más de 45 s devuelven un id de trabajo; el resultado se recoge con `estado(trabajo)`.

Las fichas de la guía (`*.md`, salvo `perfil.md`) se ofrecen como recursos MCP (`guia:///lineal/01-analisis-del-objeto.md`…).

## Herramientas (0.2.0)

47 herramientas generadas desde `guia/herramientas/manifiesto.json`, más `estado`. El nivel dice qué tocan:

| Nivel | Qué hace | Herramientas |
|---|---|---|
| lectura | No cambia nada | `ping`, `vistas`, `estadisticas`, `previa` (JPG en `~/.picopilot/previas`), `analizarMaster`, `bordesSinDatos`, `inventario`, `revisarCalibracion`, `seleccionarSubs`, `estadoWBPP`, `medirContinuo` |
| copias | Crea vistas nuevas; no toca las de entrada | `desmezclarDualBand`, `gradienteCandidatos`, `gradienteVarias`, `screenStarsCombine`, `screenStarsExtract`, `graxpertBGE`, `graxpertDenoise`, `combinarMasters`, `combinarMismoCanal`, `inyectarHa`, `bxtCorrectOnly`, `calibrarColor`, `bxtCandidatos`, `bxtAplicar`, `reducirRuido`, `separarEstrellas`, `restarContinuo`, `estirarCapas`, `estirarStarless`, `estirarEstrellas`, `quitarVerde`, `crearMascara`, `saturarAlFallo`, `prepararEstrellas`, `recombinarEstrellas` |
| vista | Cambia la vista indicada, con historial | `resolverAstrometria`, `starStretch`, `darkStructureEnhance`, `backgroundEnhance` |
| disco | Lee o escribe ficheros | `abrirImagen`, `guardarImagen` (no sobrescribe), `cerrarVista` (no cierra con cambios), `alinearMasters`, `componerHDR`, `lanzarWBPP`, `checkpointLineal`, `previsualizarPaletas`, `exportarFinal` |

## Instalar

Requisitos: PixInsight 1.9.6 o superior y Node.js 18 o superior. No hace falta `npm install`: `dist/picopilot-mcp.mjs` lleva todo dentro.

Claude Code:

```
claude mcp add picopilot -- node C:/ruta/al/repo/mcp/dist/picopilot-mcp.mjs
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.picopilot]
command = "node"
args = ["C:/ruta/al/repo/mcp/dist/picopilot-mcp.mjs"]
```

Variables opcionales: `PIXINSIGHT_EXE` (por defecto `C:/Program Files/PixInsight/bin/PixInsight.exe`), `PICOPILOT_GUIA`, `PICOPILOT_RUNNER`, `PICOPILOT_ESPERA_S`.

Para clientes con poco contexto (un modelo local a 32K):

- `PICOPILOT_COMPACTO=1`: descripciones cortas (campo `resumen` del manifiesto) en vez de las largas.
- `PICOPILOT_FASE=lineal` o `no-lineal`: sólo las herramientas de esa fase, más las generales (`vistas`, `estadisticas`, `previa`, abrir y guardar…).

Medido con 0.3.0: la lista completa ocupa ~10.900 tokens; con las dos variables, ~6.600 en la fase lineal y ~4.700 en la no lineal.

## Desarrollo

```
npm install
npm run check   # tipos
npm run build   # regenera dist/picopilot-mcp.mjs
```

Para añadir una herramienta: su entrada en `manifiesto.json` y su línea en `LISTA` de `pjsr/picopilot-runner.js` (con el `#include` de su fichero). Lo que no está en `LISTA` no se puede ejecutar aunque esté en el manifiesto.
