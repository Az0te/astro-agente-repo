// Prueba del MCP setiastropilot sin dependencias: lo lanza por stdio, lista herramientas y llama a algunas.
// Uso: node sas/pruebas/prueba-mcp.mjs [herramienta [argsJSON]]
// Sin argumentos: un recorrido corto (ping, vistas, analizarMaster, previa, gradiente, estirado, ruido, aplicar).
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MCP = join(dirname(fileURLToPath(import.meta.url)), "..", "mcp", "dist", "setiastropilot-mcp.mjs");
const p = spawn(process.execPath, [MCP], { stdio: ["pipe", "pipe", "inherit"], env: process.env });
let buf = "", n = 0;
const esperando = new Map();
p.stdout.setEncoding("utf-8");
p.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const l = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!l.trim()) continue;
    const m = JSON.parse(l);
    esperando.get(m.id)?.(m); esperando.delete(m.id);
  }
});
const rpc = (method, params) => new Promise((r) => { const id = ++n; esperando.set(id, r); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });

await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "prueba", version: "1" } });
p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
const tools = (await rpc("tools/list", {})).result.tools;
console.log(`Herramientas (${tools.length}): ${tools.map((t) => t.name).join(", ")}`);
console.log(`Tokens aprox. de la lista: ${Math.round(JSON.stringify(tools).length / 3.5)}`);

let fallos = 0;
const llamar = async (name, args = {}, esperaError = false) => {
  const t0 = Date.now();
  const r = await rpc("tools/call", { name, arguments: args });
  const txt = r.result?.content?.[0]?.text ?? JSON.stringify(r.error);
  const err = !!r.result?.isError;
  if (err !== esperaError) fallos++;
  console.log(`\n=== ${name} ${JSON.stringify(args)} — ${Date.now() - t0} ms${err ? " (ERROR)" : ""}${err !== esperaError ? "  <<< INESPERADO" : ""}\n${txt.slice(0, 1800)}`);
  return txt;
};

const [, , h, a] = process.argv;
if (h) await llamar(h, a ? JSON.parse(a) : {});
else {
  await llamar("estado");
  await llamar("ping");
  await llamar("vistas");
  await llamar("analizarMaster");
  await llamar("estadisticas", { bordes: 100 });
  await llamar("previa", { lado: 800 });
  await llamar("procesoSAS", { proceso: "function_bundle", preset: {} }, true);   // fuera de la lista blanca
  await llamar("gradienteCandidatos", { tipo: "Galaxia" });
  await llamar("aplicarCandidato", { id: "gradiente_2" });
  await llamar("aplicarCandidato", { id: "gradiente_2" }, true);                   // la vista ya cambió
  await llamar("estirarCandidatos");
  await llamar("aplicarCandidato", { id: "estirado_1" });
  await llamar("ruidoCandidatos", { usar_graxpert: false });
  await llamar("quitarVerde");
  await llamar("deshacer");
  await llamar("rehacer");
  await llamar("ayudaProceso", { proceso: "abe" });
  await llamar("vistas");
  console.log(`\nInesperados: ${fallos}`);
}
p.kill();
process.exit(fallos ? 1 : 0);
