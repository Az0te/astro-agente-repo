# SetiAstroPilot

Equivalente de PiAstroPilot y SirilAstroPilot para **Seti Astro Suite Pro (SASpro)**: un servidor MCP que deja a Claude Code, Codex o un modelo local procesar en SASpro con herramientas de una lista blanca, siguiendo la misma guía (`guia/`). Desarrollado por **Rafael Vidal** (2026). Licencia MIT.

> Estado (noviembre de 2026): versión 0.1.0, primera adaptación. Copia la estructura de `siril/` (puente + MCP + herramientas + manifiesto). Se ha probado con un SASpro simulado (`pruebas/falso`); **falta validarla en SASpro de verdad**.

## Cómo funciona

```
modelo ──MCP (stdio)──> sas/mcp/dist/setiastropilot-mcp.mjs ──TCP 127.0.0.1 + token──> sas/puente/puente.py (dentro de SASpro) ──ctx──> SASpro
```

La diferencia con Siril es que SASpro ejecuta los scripts de usuario **dentro de su propio proceso**, en el hilo de la interfaz (Qt), con un objeto `ctx` (`setiastro/saspro/ops/scripts.py`) que da acceso a los documentos, al deshacer y a `ctx.run_command(id, preset)`.

1. En SASpro se lanza una vez el script **SetiAstroPilot (puente MCP)** (menú Scripts > AstroPilot). El script vuelve enseguida y el puente se queda escuchando en `127.0.0.1:48733`. Escribe `~/.setiastropilot/puente.json` (puerto) y `~/.setiastropilot/token`.
2. El servidor MCP lee el manifiesto (`herramientas/manifiesto.json`) y ofrece sus herramientas. Cada llamada va al puente como una línea JSON `{id, token, herramienta, args}`.
3. El puente comprueba el token y deja el trabajo en una cola. Un temporizador de Qt en el hilo de la interfaz saca los trabajos y los ejecuta **uno detrás de otro, en el hilo de SASpro**, como si el usuario pulsara el botón. Solo se ejecutan herramientas de `herramientas.LISTA` y procesos de `PROCESOS`. No hay `eval` ni código libre (`function_bundle` queda fuera).

Mientras corre una herramienta larga (GraXpert, Cosmic Clarity, StarNet), la interfaz de SASpro está ocupada igual que si se lanzara a mano. Las que tardan más de 45 s devuelven un id de trabajo: el resultado se recoge con `estado(trabajo)`. Las fichas de la guía se ofrecen como recursos MCP (`guia:///...`).

Relanzar el script detiene el puente anterior y arranca uno nuevo. Si cambia algún fichero de `herramientas/`, el puente lo recarga solo entre dos trabajos.

## Herramientas (0.1.0)

SASpro tiene **varias vistas abiertas**, como PixInsight. Casi todas las herramientas llevan `vista` (nombre, título de la ventana o uid). Sin `vista` se usa la activa. Coordenadas como en pantalla (0,0 arriba a la izquierda) y valores de píxel en 0–1, igual que en PixInsight y Siril.

| Nivel | Herramientas |
|---|---|
| lectura | `ping`, `vistas`, `imagen`, `estadisticas` (0–1, rect, bordes), `previa` (JPG con autoestirado STF si es lineal, o de un candidato), `analizarMaster`, `registro`, `ayudaProceso` |
| disco | `abrirImagen`, `guardarImagen` (no sobrescribe), `exportarFinal` |
| vista | `deshacer`, `rehacer`, `duplicarVista`, `procesoSAS` (lista blanca de procesos de SASpro con su preset) |

### Por paso de la guía

| Paso | Herramienta | Con qué |
|---|---|---|
| L8 Astrometría | `resolverAstrometria` | plate_solve (ASTAP / astrometry.net según SASpro) |
| L9 Gradiente | `gradienteCandidatos` → `aplicarCandidato` | ABE polinomio 1 y 2, ABE con RBF, GraXpert IA |
| L12 Color | `neutralizarFondo`, `calibrarColor` | Background Neutralization, White Balance (estrellas) |
| L15 Estrellas | `separarEstrellas` | StarNet o DarkStar (remove_stars), SyQon |
| NL1 Estirado | `estirarCandidatos` → `aplicarCandidato` | estirado estadístico enlazado y por canal a varias medianas, GHS con pivote en el cielo |
| NL3 SCNR | `quitarVerde` | Remove Green conservando la luminosidad |
| L14 / NL6 Ruido | `ruidoCandidatos` → `aplicarCandidato` | Cosmic Clarity denoise a varias fuerzas, GraXpert denoise; detalle perdido < 10 % |
| NL10 Exportación | `exportarFinal` | TIFF 16 bits + JPG 95 como `<nombre>_final`, sin sobrescribir |

Comparar en SASpro: cada candidato se hace **sobre la propia vista** con su proceso, se copia el resultado, se mide y se guarda en `~/.setiastropilot/trabajo/`, y se deshace. La vista vuelve a como estaba (se comprueba con una huella de los píxeles) y la pila de rehacer queda vacía. `aplicarCandidato(id)` pone el elegido, exactamente el que se midió, con un paso de deshacer. Las métricas (`herramientas/medidas.py`) son las mismas que en Siril, copiadas de `siril/herramientas`: si se cambia un criterio, hay que cambiarlo en los dos sitios.

GraXpert, Cosmic Clarity, StarNet y los modelos de SyQon usan las rutas que ya tenga configuradas SASpro.

Para añadir una herramienta: la función en `herramientas/herramientas.py`, su línea en `LISTA` y su entrada en `herramientas/manifiesto.json`. Para permitir otro proceso de SASpro: su id en `PROCESOS`.

## Instalar

Requisitos: Seti Astro Suite Pro reciente (con el menú Scripts y `ctx.run_command`) y Node.js 18 o superior.

1. En SASpro: menú Scripts > *Open Scripts Folder* (en Windows `%LOCALAPPDATA%\SASpro\scripts`). Copia allí `sas/puente/SetiAstroPilot.py`. Si el repo no está en `~/astro-agente-repo`, cambia `REPO` en esa copia o define la variable `SETIASTROPILOT_REPO`. Recarga los scripts: aparece *AstroPilot > SetiAstroPilot (puente MCP)*.
2. Registra el MCP (no hace falta `npm install`, `dist/` lleva todo dentro):

```
claude mcp add setiastropilot -- node C:/ruta/al/repo/sas/mcp/dist/setiastropilot-mcp.mjs
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.setiastropilot]
command = "node"
args = ["C:/ruta/al/repo/sas/mcp/dist/setiastropilot-mcp.mjs"]
```

Variables opcionales: `SETIASTROPILOT_PUERTO` (puente, por defecto 48733; hay que ponerla igual en SASpro y en el MCP), `SETIASTROPILOT_ESPERA_S`, `SETIASTROPILOT_COMPACTO=1`, `SETIASTROPILOT_FASE=lineal|no-lineal`, `SETIASTROPILOT_GUIA`, `SETIASTROPILOT_REPO`.

## Validar en el PC

1. Abre un master en SASpro y lanza el script. En la consola de SASpro debe salir «escuchando en 127.0.0.1:48733. Herramientas: 24».
2. Desde la raíz del repo: `node sas/pruebas/prueba-mcp.mjs ping` y luego `node sas/pruebas/prueba-mcp.mjs vistas`. El recorrido completo (`node sas/pruebas/prueba-mcp.mjs` sin argumentos) **cambia la vista activa** (aplica gradiente, estirado y SCNR): úsalo con una copia.
3. Mientras corre una comparación, comprueba que SASpro termina cada proceso sin abrir diálogos que esperen un clic. Si alguno lo hace, anota cuál.

Sin SASpro (solo para desarrollo): `python sas/pruebas/puente_falso.py` lanza el puente con un SASpro falso (imagen sintética, unos pocos procesos hechos en numpy) y después `node sas/pruebas/prueba-mcp.mjs`. `SAS_FALSO_TAM=1600x1100` cambia el tamaño; `SAS_FALSO_SIN_GRAXPERT=1` simula que falta GraXpert.

## Pendiente

- Validar en SASpro real: que `remove_stars`, `graxpert` y `cosmic_clarity` corren sin diálogos con el preset dado, y los nombres de vista que crean.
- Herramientas de Siril que aún no están: alinear y combinar masters, dual band, HDR, núcleo de galaxias, contraste, saturación, recombinar estrellas, chat dentro de SASpro.

## Desarrollo

```
cd sas/mcp
npm install
npm run check   # tipos
npm run build   # regenera dist/setiastropilot-mcp.mjs
```

`src/index.ts` es el de Siril con otros nombres (variables `SETIASTROPILOT_*`, carpeta `~/.setiastropilot`).
