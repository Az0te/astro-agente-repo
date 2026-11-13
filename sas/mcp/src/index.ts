#!/usr/bin/env node
// setiastropilot-mcp — Servidor MCP de SetiAstroPilot: ofrece las herramientas de Seti Astro Suite Pro al modelo.
// Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
//
// Cómo llega a SASpro: el puente sas/puente/puente.py (lanzado desde el menú Scripts de SASpro)
// escucha en 127.0.0.1 (en el hilo de Qt de SASpro) en el puerto de ~/.setiastropilot/puente.json. Cada llamada es una línea JSON
// { id, token, herramienta, args } y la respuesta otra línea JSON. El puente solo ejecuta herramientas de su
// lista blanca (herramientas.LISTA), una detrás de otra en un único hilo. Sin eval ni código libre.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join, resolve, relative, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.0";

// --- Rutas --------------------------------------------------------------------------------------------------

const AQUI = dirname(fileURLToPath(import.meta.url));          // sas/mcp/dist
const SAS_DIR = resolve(AQUI, "..", "..");                    // sas/
const REPO = resolve(SAS_DIR, "..");                          // raíz del repo
const GUIA = process.env.SETIASTROPILOT_GUIA ?? join(REPO, "guia");
const MANIFIESTO = process.env.SETIASTROPILOT_MANIFIESTO ?? join(SAS_DIR, "herramientas", "manifiesto.json");
const DATOS = process.env.SETIASTROPILOT_DATOS ?? join(homedir(), ".setiastropilot");
// Tiempo máximo de espera dentro de una llamada: por debajo del límite de ~60 s de los clientes MCP.
const ESPERA_MAX_S = Number(process.env.SETIASTROPILOT_ESPERA_S ?? 45);
// Igual que piastropilot: COMPACTO=1 usa el "resumen" de cada herramienta; FASE=lineal | no-lineal filtra por paso.
const COMPACTO = /^(1|true|si|sí|yes)$/i.test(process.env.SETIASTROPILOT_COMPACTO ?? "");
const FASE = (process.env.SETIASTROPILOT_FASE ?? "").trim().toLowerCase();

// --- Manifiesto ---------------------------------------------------------------------------------------------

interface Funcion {
  nombre: string;
  nivel: "lectura" | "copias" | "vista" | "disco" | "libre";
  timeout_s: number;
  descripcion: string;
  resumen?: string;
  paso?: string;
  params: Record<string, unknown>;
}

function leerManifiesto(): Funcion[] {
  const m = JSON.parse(readFileSync(MANIFIESTO, "utf-8"));
  return (m.funciones as Funcion[]).filter((f) => f.nivel !== "libre");
}

function herramientasVisibles(): Funcion[] {
  const todas = leerManifiesto();
  if (FASE !== "lineal" && FASE !== "no-lineal") return todas;
  return todas.filter((f) => !f.paso || f.paso.startsWith(FASE + "/"));
}

// --- Puente -------------------------------------------------------------------------------------------------

interface Respuesta {
  id?: string;
  estado: "ok" | "error";
  herramienta?: string;
  resultado?: unknown;
  error?: string;
  duracion_ms?: number;
}

function conexion(): { puerto: number; token: string } {
  const pj = join(DATOS, "puente.json");
  if (!existsSync(pj))
    throw new Error("El puente de SASpro no está abierto. En SASpro: Scripts > AstroPilot > SetiAstroPilot (puente MCP) y repite.");
  const { puerto } = JSON.parse(readFileSync(pj, "utf-8"));
  const token = readFileSync(join(DATOS, "token"), "utf-8").trim();
  return { puerto: Number(puerto), token };
}

// Una petición = una conexión TCP. El puente responde cuando la herramienta termina (puede tardar minutos).
function pedir(herramienta: string, args: unknown, id: string = randomUUID()): Promise<Respuesta> {
  return new Promise((res) => {
    let c: { puerto: number; token: string };
    try { c = conexion(); } catch (e) { return res({ id, estado: "error", error: (e as Error).message }); }
    const s = createConnection({ host: "127.0.0.1", port: c.puerto });
    let buf = "";
    let hecho = false;
    const fin = (r: Respuesta) => { if (!hecho) { hecho = true; s.destroy(); res(r); } };
    s.setEncoding("utf-8");
    s.on("connect", () => s.write(JSON.stringify({ id, token: c.token, herramienta, args: args ?? {} }) + "\n"));
    s.on("data", (d: string) => {
      buf += d;
      const n = buf.indexOf("\n");
      if (n >= 0) {
        try { fin(JSON.parse(buf.slice(0, n)) as Respuesta); }
        catch { fin({ id, estado: "error", error: "Respuesta del puente no válida." }); }
      }
    });
    s.on("error", (e: NodeJS.ErrnoException) => fin({ id, estado: "error", error: e.code === "ECONNREFUSED"
      ? `No hay puente escuchando en el puerto ${c.puerto}. ¿Se cerró SASpro? Ábrelo y vuelve a lanzar el script SetiAstroPilot.`
      : `Error de conexión con el puente: ${e.message}` }));
    s.on("close", () => fin({ id, estado: "error", error: "El puente cerró la conexión sin responder." }));
  });
}

// Trabajos que pasan de ESPERA_MAX_S: la promesa sigue viva y se recoge con estado(trabajo).
const trabajos = new Map<string, { herramienta: string; lanzado: number; promesa: Promise<Respuesta>; r?: Respuesta }>();

const esperarHasta = <T>(p: Promise<T>, s: number) =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), s * 1000))]);

// --- Respuestas ---------------------------------------------------------------------------------------------

const texto = (t: string, error = false) => ({ content: [{ type: "text" as const, text: t }], ...(error ? { isError: true } : {}) });

function formatear(r: Respuesta) {
  if (r.estado === "error") return texto(`Error en ${r.herramienta ?? "la petición"}: ${r.error}`, true);
  return texto(`${r.herramienta} (${((r.duracion_ms ?? 0) / 1000).toFixed(1)} s):\n${JSON.stringify(r.resultado, null, 1)}`);
}

async function estado(args: { trabajo?: string; esperar_s?: number }) {
  const lineas: string[] = [];
  if (args?.trabajo) {
    const t = trabajos.get(args.trabajo);
    if (!t) lineas.push(`Trabajo ${args.trabajo}: desconocido o ya recogido.`);
    else {
      const seg = Math.max(0, Math.min(ESPERA_MAX_S, args.esperar_s ?? ESPERA_MAX_S));
      const r = t.r ?? (await esperarHasta(t.promesa, seg));
      if (r) { trabajos.delete(args.trabajo); return formatear(r); }
      lineas.push(`Trabajo ${args.trabajo} (${t.herramienta}) sin terminar tras ${Math.round((Date.now() - t.lanzado) / 1000)} s.`);
    }
  }
  const e = await pedir("__estado", {});
  if (e.estado === "ok") {
    const x = e.resultado as { version: string; ejecutando: { herramienta: string; desde_s: number } | null; en_cola: number };
    lineas.push(`Puente de SASpro: abierto (versión ${x.version})`);
    lineas.push(x.ejecutando ? `Ejecutando: ${x.ejecutando.herramienta} desde hace ${x.ejecutando.desde_s} s` : "Ejecutando: nada");
    lineas.push(`En cola: ${x.en_cola}`);
  } else lineas.push(`Puente de SASpro: NO disponible (${e.error})`);
  if (trabajos.size) lineas.push(`Trabajos de esta sesión sin recoger: ${[...trabajos.keys()].join(", ")}`);
  return texto(lineas.join("\n"));
}

async function llamar(f: Funcion, args: unknown) {
  const id = randomUUID();
  const promesa = pedir(f.nombre, args, id);
  const r = await esperarHasta(promesa, Math.min(f.timeout_s, ESPERA_MAX_S));
  if (r) return formatear(r);
  const t = { herramienta: f.nombre, lanzado: Date.now(), promesa } as { herramienta: string; lanzado: number; promesa: Promise<Respuesta>; r?: Respuesta };
  promesa.then((x) => { t.r = x; });
  trabajos.set(id, t);
  return texto(`${f.nombre} sigue en marcha (trabajo ${id}). Llama a estado con trabajo="${id}": espera hasta ${ESPERA_MAX_S} s por llamada y devuelve el resultado en cuanto termine. No lances otra herramienta pesada mientras tanto (SASpro las hace en cola, una detrás de otra).`);
}

// --- Recursos: la guía (compartida con PixInsight) ----------------------------------------------------------

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
  const server = new Server({ name: "setiastropilot", version: VERSION }, { capabilities: { tools: {}, resources: {} } });

  const herramientaEstado = {
    name: "estado",
    description: `Estado del puente de SASpro: si está abierto, qué herramienta se ejecuta y cuántas hay en cola. Con trabajo=<id> espera (hasta ${ESPERA_MAX_S} s por llamada) y recoge el resultado de una herramienta larga; si aún no ha terminado, vuelve a llamar.`,
    inputSchema: { type: "object", properties: {
      trabajo: { type: "string", description: "Id de trabajo devuelto por una herramienta larga." },
      esperar_s: { type: "number", description: `Segundos máximos de espera (0–${ESPERA_MAX_S}). 0 = solo mirar.` },
    } },
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [herramientaEstado, ...herramientasVisibles().map((f) => ({
      name: f.nombre,
      description: `${COMPACTO && f.resumen ? f.resumen : f.descripcion}${f.paso ? ` (ficha: guia/${f.paso})` : ""} [nivel: ${f.nivel}]`,
      inputSchema: f.params,
    }))],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      if (name === "estado") return await estado((args ?? {}) as { trabajo?: string; esperar_s?: number });
      const f = leerManifiesto().find((x) => x.nombre === name);
      if (!f) return texto(`Herramienta desconocida: ${name}`, true);
      return await llamar(f, args ?? {});
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
  console.error(`setiastropilot-mcp ${VERSION} listo. Guía: ${GUIA}. Manifiesto: ${MANIFIESTO}. Datos: ${DATOS}`);
}

main().catch((e) => {
  console.error("setiastropilot-mcp no ha podido arrancar:", e);
  process.exit(1);
});
