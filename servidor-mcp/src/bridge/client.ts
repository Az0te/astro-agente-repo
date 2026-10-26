// Derivado de pixinsight-mcp, Copyright (c) 2026 Alain Escaffre (licencia MIT).
// Modificaciones Copyright (c) 2026 Rafael Vidal (licencia MIT).
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { BridgeCommand, BridgeResult, BridgeConfig } from "../types.js";
import { DEFAULT_CONFIG } from "../types.js";

function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class BridgeClient {
  private config: BridgeConfig;
  private commandsDir: string;
  private resultsDir: string;
  private logsDir: string;

  constructor(config?: Partial<BridgeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const bridgeDir = expandHome(this.config.bridgeDir);
    this.commandsDir = join(bridgeDir, "commands");
    this.resultsDir = join(bridgeDir, "results");
    this.logsDir = join(bridgeDir, "logs");
  }

  async ensureDirectories(): Promise<void> {
    await mkdir(this.commandsDir, { recursive: true });
    await mkdir(this.resultsDir, { recursive: true });
    await mkdir(this.logsDir, { recursive: true });
  }

  async sendCommand(
    tool: string,
    process: string,
    parameters: Record<string, unknown>,
    options?: {
      executeMethod?: "executeGlobal" | "executeOn";
      targetView?: string | null;
      timeoutMs?: number;
    }
  ): Promise<BridgeResult> {
    await this.ensureDirectories();

    const id = randomUUID();
    const command: BridgeCommand = {
      id,
      timestamp: new Date().toISOString(),
      tool,
      process,
      parameters,
      executeMethod: options?.executeMethod ?? "executeGlobal",
      targetView: options?.targetView ?? null,
    };

    const commandPath = join(this.commandsDir, `${id}.json`);
    await writeFile(commandPath, JSON.stringify(command, null, 2), "utf-8");

    const timeoutMs = options?.timeoutMs ?? this.config.defaultTimeoutMs;
    return this.waitForResult(id, timeoutMs);
  }

  private async waitForResult(id: string, timeoutMs: number): Promise<BridgeResult> {
    const resultPath = join(this.resultsDir, `${id}.json`);
    const commandPath = join(this.commandsDir, `${id}.json`);
    const startTime = Date.now();
    let running: any = null;

    while (Date.now() - startTime < timeoutMs) {
      if (existsSync(resultPath)) {
        // Small delay to ensure the file is fully written
        await sleep(50);
        try {
          const data = await readFile(resultPath, "utf-8");
          const result = JSON.parse(data) as BridgeResult;

          // If still running, keep polling
          if (result.status === "running") {
            running = result;
            await sleep(this.config.pollIntervalMs);
            continue;
          }

          // Clean up the result file
          try {
            await unlink(resultPath);
          } catch {
            // Ignore cleanup errors
          }

          return result;
        } catch {
          // File might still be written, retry
          await sleep(this.config.pollIntervalMs);
          continue;
        }
      }
      await sleep(this.config.pollIntervalMs);
    }

    const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);

    // Never picked up: remove it from the queue so it does not run later by surprise.
    if (!running && existsSync(commandPath)) {
      try {
        await unlink(commandPath);
      } catch {
        // Watcher may have just taken it
      }
      return {
        id,
        timestamp: new Date().toISOString(),
        status: "error",
        process: "timeout",
        duration_ms: Date.now() - startTime,
        error: {
          message: `El watcher no recogió el comando en ${elapsedMin} min (se ha quitado de la cola). ` +
            `¿Está el watcher corriendo, en pausa, o PixInsight ocupado con otra cosa?\n` +
            (await this.diagnose()),
          type: "NotPickedUp",
        },
      };
    }

    // Picked up but still running: PixInsight is busy or blocked.
    if (running) {
      return {
        id,
        timestamp: new Date().toISOString(),
        status: "error",
        process: "timeout",
        duration_ms: Date.now() - startTime,
        error: {
          message: `PixInsight sigue ejecutando '${running.tool}'` +
            (running.targetView ? ` sobre ${running.targetView}` : "") +
            ` desde ${running.started} (${elapsedMin} min esperando) y no ha terminado. ` +
            `Puede ser un proceso largo o un cuelgue / diálogo oculto. No envíes más comandos hasta aclararlo; ` +
            `llama a watcher_status con commandId="${id}" para ver si terminó y recoger su resultado.\n` +
            (await this.diagnose()),
          type: "Stalled",
        },
      };
    }

    return {
      id,
      timestamp: new Date().toISOString(),
      status: "error",
      process: "timeout",
      duration_ms: Date.now() - startTime,
      error: {
        message: `Command timed out after ${timeoutMs}ms. The PJSR watcher may not be running in PixInsight.`,
        type: "Timeout",
      },
    };
  }

  /**
   * Windows-side health check of PixInsight: is it responding, and which windows
   * (dialogs included) does it have open. Works even when the watcher is blocked.
   */
  async diagnose(): Promise<string> {
    if (process.platform !== "win32") return "";
    const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$p = Get-Process PixInsight -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { 'PixInsight: no está en ejecución'; exit }
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class PiWin {
  public delegate bool Cb(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Cb f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static List<string> Titles(uint id) {
    var r = new List<string>();
    EnumWindows((h, l) => { uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == id && IsWindowVisible(h)) { var s = new StringBuilder(512); GetWindowText(h, s, 512); if (s.Length > 0) r.Add(s.ToString()); }
      return true; }, IntPtr.Zero);
    return r;
  }
}
"@
'PixInsight responde: ' + $(if ($p.Responding) { 'sí' } else { 'NO (no responde)' })
'Memoria: ' + [math]::Round($p.WorkingSet64 / 1GB, 1) + ' GB'
$t = [PiWin]::Titles([uint32]$p.Id) | Where-Object { $_ -ne 'PixInsight' }
if ($t) { $t | ForEach-Object { 'Ventana abierta (posible diálogo): ' + $_ } } else { 'Sin diálogos visibles' }
`;
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    return new Promise((res) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        { timeout: 20000, windowsHide: true },
        (err, stdout) => {
          if (err && !stdout) res(`(diagnóstico no disponible: ${err.message})`);
          else res(String(stdout).trim());
        }
      );
    });
  }

  /** What the watcher is doing now, how many commands are queued, and Windows diagnostics. */
  async getStatus(commandId?: string): Promise<string> {
    const bridgeDir = expandHome(this.config.bridgeDir);
    const lines: string[] = [];
    if (commandId && /^[0-9a-f-]{36}$/i.test(commandId)) {
      const rp = join(this.resultsDir, `${commandId}.json`);
      if (existsSync(rp)) {
        try {
          const r = JSON.parse(await readFile(rp, "utf-8"));
          if (r.status !== "running") {
            await unlink(rp).catch(() => {});
            const body = r.status === "error" ? `ERROR: ${r.error?.message}` :
              (r.outputs?.consoleOutput ?? r.message ?? "") + (r.outputs ? `\noutputs: ${JSON.stringify(r.outputs).slice(0, 4000)}` : "");
            lines.push(`Comando ${commandId} TERMINADO (${r.status}, ${(r.duration_ms / 1000).toFixed(1)} s): ${body}`);
          } else {
            lines.push(`Comando ${commandId} sigue en ejecución.`);
          }
        } catch {
          lines.push(`Comando ${commandId}: resultado ilegible (quizá se está escribiendo), reintenta.`);
        }
      } else {
        lines.push(`Comando ${commandId}: sin resultado (ya recogido, o nunca se ejecutó).`);
      }
    }
    try {
      const cur = JSON.parse(await readFile(join(bridgeDir, "current.json"), "utf-8"));
      const min = ((Date.now() - new Date(cur.started).getTime()) / 60000).toFixed(1);
      lines.push(`Ejecutando: ${cur.tool}${cur.targetView ? ` sobre ${cur.targetView}` : ""} desde ${cur.started} (${min} min)`);
    } catch {
      lines.push("Ejecutando: nada (o watcher anterior a v0.4.0)");
    }
    try {
      const queued = (await readdir(this.commandsDir)).filter((f) => f.endsWith(".json")).length;
      lines.push(`Comandos en cola: ${queued}`);
    } catch {
      // No commands dir yet
    }
    if (existsSync(join(bridgeDir, "pause"))) lines.push("Watcher EN PAUSA (existe el archivo 'pause')");
    lines.push(await this.diagnose());
    return lines.filter(Boolean).join("\n");
  }

  async isWatcherAlive(): Promise<boolean> {
    // Send a ping-like command and see if we get a response
    try {
      const result = await this.sendCommand(
        "list_open_images",
        "__internal__",
        {},
        { timeoutMs: 5000 }
      );
      return result.status === "success";
    } catch {
      return false;
    }
  }

  async cleanStaleCommands(): Promise<number> {
    try {
      const files = await readdir(this.commandsDir);
      let cleaned = 0;
      for (const file of files) {
        if (file.endsWith(".json")) {
          const filePath = join(this.commandsDir, file);
          try {
            const data = await readFile(filePath, "utf-8");
            const cmd = JSON.parse(data) as BridgeCommand;
            const age = Date.now() - new Date(cmd.timestamp).getTime();
            // Remove commands older than 10 minutes
            if (age > 600_000) {
              await unlink(filePath);
              cleaned++;
            }
          } catch {
            // Malformed file, remove it
            await unlink(filePath);
            cleaned++;
          }
        }
      }
      return cleaned;
    } catch {
      return 0;
    }
  }

  getConfig(): BridgeConfig {
    return { ...this.config };
  }
}
