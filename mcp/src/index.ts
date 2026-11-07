#!/usr/bin/env node
// picopilot-mcp — Servidor MCP de PiCopilot: ofrece las funciones de la guía como herramientas.
// Copyright (c) 2026 Rafael Vidal. Licencia MIT.
//
// Cómo llega a PixInsight: escribe ~/.picopilot/peticiones/<id>.json y lanza
//   PixInsight.exe -x=<mcp>/pjsr/picopilot-runner.js,<id>
// en la instancia abierta (IPC de PixInsight). El runner ejecuta solo funciones de su lista blanca y deja
// ~/.picopilot/resultados/<id>.json. No hay carpeta vigilada ni watcher.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { dirname, join, resolve, relative, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const VERSION = "0.3.0";

// --- Rutas --------------------------------------------------------------------------------------------------

const AQUI = dirname(fileURLToPath(import.meta.url));          // mcp/dist
const MCP_DIR = resolve(AQUI, "..");                           // mcp/
const REPO = resolve(MCP_DIR, "..");                           // raíz del repo
const GUIA = process.env.PICOPILOT_GUIA ?? join(REPO, "guia");
const RUNNER = (process.env.PICOPILOT_RUNNER ?? join(MCP_DIR, "pjsr", "picopilot-runner.js")).replace(/\\/g, "/");
const PIXINSIGHT = process.env.PIXINSIGHT_EXE ??
  (process.platform === "win32" ? "C:/Program Files/PixInsight/bin/PixInsight.exe"
    : process.platform === "darwin" ? "/Applications/PixInsight/PixInsight.app/Contents/MacOS/PixInsight"
    : "/opt/PixInsight/bin/PixInsight");
const DATOS = join(homedir(), ".picopilot");
const PETICIONES = join(DATOS, "peticiones");
const RESULTADOS = join(DATOS, "resultados");
// Tiempo máximo de espera dentro de una llamada: por debajo del límite de ~60 s de los clientes MCP.
const ESPERA_MAX_S = Number(process.env.PICOPILOT_ESPERA_S ?? 45);
const RECOGER_S = 60;   // si el runner no ha empezado en este tiempo, la petición se da por perdida

// --- Manifiesto ---------------------------------------------------------------------------------------------

interface Funcion {
  nombre: string;
  fichero: string | null;
  nivel: "lectura" | "copias" | "vista" | "disco" | "libre";
  timeout_s: number;
  descripcion: string;
  paso?: string;
  params: Record<string, unknown>;
}

function leerManifiesto(): Funcion[] {
  const ruta = join(GUIA, "herramientas", "manifiesto.json");
  const m = JSON.parse(readFileSync(ruta, "utf-8"));
  // run_script (nivel libre) solo si el usuario lo ha permitido creando ~/.picopilot/permitir_libre.
  const libre = existsSync(join(DATOS, "permitir_libre"));
  return (m.funciones as Funcion[]).filter((f) => f.nivel !== "libre" || libre);
}

// --- Token --------------------------------------------------------------------------------------------------

function prepararDatos(): string {
  for (const d of [DATOS, PETICIONES, RESULTADOS]) mkdirSync(d, { recursive: true });
  const rt = join(DATOS, "token");
  if (!existsSync(rt)) writeFileSync(rt, randomBytes(24).toString("hex"), "utf-8");
  return readFileSync(rt, "utf-8").trim();
}

// --- PixInsight ---------------------------------------------------------------------------------------------

function pixinsightAbierto(): Promise<boolean> {
  if (process.platform !== "win32") return Promise.resolve(true);   // sin comprobar fuera de Windows
  return new Promise((res) => {
    execFile("tasklist", ["/FI", "IMAGENAME eq PixInsight.exe", "/NH"], { windowsHide: true }, (err, out) =>
      res(!err && /PixInsight\.exe/i.test(String(out))));
  });
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Resultado {
  id: string;
  estado: "ok" | "error";
  herramienta?: string;
  resultado?: unknown;
  error?: string;
  inicio?: string;
  duracion_ms?: number;
}

const pendientes = new Map<string, { herramienta: string; lanzada: number }>();

async function lanzar(token: string, herramienta: string, args: unknown): Promise<string> {
  if (!(await pixinsightAbierto()))
    throw new Error("PixInsight no está abierto. Ábrelo y repite (el MCP no lo arranca para no abrir una instancia nueva).");
  if (!existsSync(RUNNER)) throw new Error(`No encuentro el runner en ${RUNNER}.`);
  const id = randomUUID();
  writeFileSync(join(PETICIONES, `${id}.json`), JSON.stringify({ id, token, herramienta, args: args ?? {}, guia: GUIA.replace(/\\/g, "/") }), "utf-8");
  const p = spawn(PIXINSIGHT, [`-x=${RUNNER},${id}`], { detached: true, stdio: "ignore", windowsHide: true });
  p.on("error", () => {});
  p.unref();
  pendientes.set(id, { herramienta, lanzada: Date.now() });
  return id;
}

function leerResultado(id: string): Resultado | null {
  const ruta = join(RESULTADOS, `${id}.json`);
  if (!existsSync(ruta)) return null;
  try {
    const r = JSON.parse(readFileSync(ruta, "utf-8")) as Resultado;
    try { unlinkSync(ruta); } catch { /* ya recogido */ }
    pendientes.delete(id);
    return r;
  } catch {
    return null;   // a medio escribir: se reintenta
  }
}

function enCurso(): { id: string; herramienta: string; inicio: string } | null {
  try { return JSON.parse(readFileSync(join(DATOS, "en_curso.json"), "utf-8")); } catch { return null; }
}

async function esperar(id: string, segundos: number): Promise<Resultado | null> {
  const fin = Date.now() + segundos * 1000;
  while (Date.now() < fin) {
    const r = leerResultado(id);
    if (r) return r;
    await dormir(250);
  }
  return null;
}

// --- Respuestas ---------------------------------------------------------------------------------------------

const texto = (t: string, error = false) => ({ content: [{ type: "text" as const, text: t }], ...(error ? { isError: true } : {}) });

function formatear(r: Resultado) {
  if (r.estado === "error") return texto(`Error en ${r.herramienta ?? "la petición"}: ${r.error}`, true);
  const cuerpo = JSON.stringify(r.resultado, null, 1);
  return texto(`${r.herramienta} (${((r.duracion_ms ?? 0) / 1000).toFixed(1)} s):\n${cuerpo}`);
}

async function estado(args: { trabajo?: string; esperar_s?: number }) {
  const lineas: string[] = [];
  if (args?.trabajo) {
    // Espera él mismo al trabajo (hasta 45 s por llamada): así el cliente no tiene que dormir con la shell.
    const seg = Math.max(0, Math.min(ESPERA_MAX_S, args.esperar_s ?? ESPERA_MAX_S));
    const r = seg > 0 ? await esperar(args.trabajo, seg) : leerResultado(args.trabajo);
    if (r) { pendientes.delete(args.trabajo); return formatear(r); }
    const p = pendientes.get(args.trabajo);
    lineas.push(p ? `Trabajo ${args.trabajo} (${p.herramienta}) sin terminar.` : `Trabajo ${args.trabajo}: sin resultado (ya recogido o desconocido).`);
  }
  lineas.push(`PixInsight abierto: ${(await pixinsightAbierto()) ? "sí" : "NO"}`);
  const c = enCurso();
  lineas.push(c ? `Ejecutando: ${c.herramienta} desde ${c.inicio}` : "Ejecutando: nada");
  let cola = 0;
  try { cola = readdirSync(PETICIONES).filter((f) => f.endsWith(".json")).length; } catch { /* vacío */ }
  lineas.push(`Peticiones sin recoger: ${cola}`);
  if (pendientes.size) lineas.push(`Trabajos de esta sesión sin resultado: ${[...pendientes.keys()].join(", ")}`);
  lineas.push(`Runner: ${RUNNER}`);
  return texto(lineas.join("\n"));
}

async function llamar(token: string, f: Funcion, args: unknown) {
  const id = await lanzar(token, f.nombre, args);
  const espera = Math.min(f.timeout_s, ESPERA_MAX_S);
  const r = await esperar(id, espera);
  if (r) return formatear(r);
  const c = enCurso();
  if (c?.id === id || f.timeout_s > ESPERA_MAX_S)
    return texto(`${f.nombre} sigue en marcha (trabajo ${id}). Llama a estado con trabajo="${id}": espera hasta 45 s por llamada y devuelve el resultado en cuanto termine (no esperes con la shell). No lances otra herramienta pesada mientras tanto.`);
  // No ha empezado: PixInsight ocupado (otro script, un proceso largo o un diálogo abierto).
  const extra = await esperar(id, Math.max(0, RECOGER_S - espera));
  if (extra) return formatear(extra);
  return texto(`PixInsight no ha empezado ${f.nombre} en ${RECOGER_S} s: está ocupado (otro script, un proceso largo o un diálogo abierto). La petición queda en cola y se ejecutará cuando quede libre; consulta estado con trabajo="${id}".`, true);
}

// --- Recursos: la guía --------------------------------------------------------------------------------------

function fichasGuia(): string[] {
  const r: string[] = [];
  const recorrer = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) recorrer(p);
      else if (n.endsWith(".md") && n !== "perfil.md") r.push(relative(GUIA, p).split(sep).join("/"));
    }
  };
  try { recorrer(GUIA); } catch { /* sin guía */ }
  return r.sort();
}

// --- Servidor -----------------------------------------------------------------------------------------------

async function main() {
  const token = prepararDatos();
  const server = new Server({ name: "picopilot", version: VERSION }, { capabilities: { tools: {}, resources: {} } });

  const herramientaEstado = {
    name: "estado",
    description: "Estado de PixInsight y del MCP: si está abierto, qué herramienta se está ejecutando y peticiones en cola. Con trabajo=<id> espera (hasta 45 s por llamada) y recoge el resultado de una herramienta que tardó más de 45 s; si aún no ha terminado, vuelve a llamar.",
    inputSchema: { type: "object", properties: {
      trabajo: { type: "string", description: "Id de trabajo devuelto por una herramienta larga." },
      esperar_s: { type: "number", description: "Segundos máximos de espera del trabajo (0–45, por defecto 45). 0 = sólo mirar." },
    } },
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [herramientaEstado, ...leerManifiesto().map((f) => ({
      name: f.nombre,
      description: `${f.descripcion}${f.paso ? ` (ficha: guia/${f.paso})` : ""} [nivel: ${f.nivel}]`,
      inputSchema: f.params,
    }))],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      if (name === "estado") return await estado((args ?? {}) as { trabajo?: string; esperar_s?: number });
      const f = leerManifiesto().find((x) => x.nombre === name);
      if (!f) return texto(`Herramienta desconocida: ${name}`, true);
      return await llamar(token, f, args ?? {});
    } catch (e) {
      return texto(String((e as Error)?.message ?? e), true);
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: fichasGuia().map((r) => ({ uri: `guia:///${r}`, name: r, mimeType: "text/markdown" })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const rel = req.params.uri.replace(/^guia:\/\/\//, "");
    const ruta = resolve(GUIA, rel);
    if (!ruta.startsWith(resolve(GUIA)) || !fichasGuia().includes(rel)) throw new Error(`Recurso no válido: ${req.params.uri}`);
    return { contents: [{ uri: req.params.uri, mimeType: "text/markdown", text: readFileSync(ruta, "utf-8") }] };
  });

  await server.connect(new StdioServerTransport());
  console.error(`picopilot-mcp ${VERSION} listo. Guía: ${GUIA}. Runner: ${RUNNER}. PixInsight: ${PIXINSIGHT}`);
}

main().catch((e) => {
  console.error("picopilot-mcp no ha podido arrancar:", e);
  process.exit(1);
});
