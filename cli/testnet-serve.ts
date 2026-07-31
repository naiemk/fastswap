import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { loadFastSwapConfig } from "../config/load.js";
import { applyOperatorEnvDefaults } from "./bootstrap.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function repoRoot(): string {
  return process.cwd();
}

export async function startTestnetServices(configPath: string): Promise<void> {
  applyOperatorEnvDefaults();
  const config = loadFastSwapConfig(configPath);
  const dataDirs = new Set<string>();
  for (const path of [
    config.server.sqlitePath,
    config.server.auditLogPath,
    config.sweepNode?.sqlitePath,
    config.nodes?.sweep?.auditLogPath,
    config.nodes?.relay?.auditLogPath,
    config.nodes?.relay?.progressPath,
    config.liquidityManager?.sqlitePath,
  ]) {
    if (path) dataDirs.add(dirname(path));
  }
  await Promise.all([...dataDirs].map((dir) => mkdir(dir, { recursive: true })));
  const host = config.server.host === "0.0.0.0" ? "127.0.0.1" : config.server.host;
  const apiPort = config.server.apiPort ?? 4010;
  const apiBase = `http://${host}:${apiPort}`;
  const uiPort = Number(process.env.FASTSWAP_UI_PORT ?? 3000);
  const root = repoRoot();
  const uiDir = join(root, "ui");

  const children: ChildProcess[] = [];
  const spawnService = (label: string, script: string) => {
    const child = spawn("node", [script, configPath], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`[serve] ${label} exited with code ${code}${signal ? ` (${signal})` : ""}`);
      }
    });
    children.push(child);
    console.log(`[serve] started ${label} (pid ${child.pid})`);
    return child;
  };

  const uiServer = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", `http://${request.headers.host}`).pathname;
      const relative = pathname === "/" ? "/index.html" : pathname;
      const filePath = join(uiDir, relative);
      const body = await readFile(filePath);
      response.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  await new Promise<void>((resolve, reject) => {
    uiServer.listen(uiPort, "127.0.0.1", () => resolve());
    uiServer.on("error", reject);
  });

  spawnService("api", "dist/server/main.js");
  await sleep(2500);
  spawnService("sweep", "dist/nodes/sweep-main.js");
  spawnService("relay", "dist/nodes/relay-node/main.js");

  const uiUrl = `http://127.0.0.1:${uiPort}/?api=${encodeURIComponent(apiBase)}`;
  console.log("\n════════════════════════════════════════════════════════");
  console.log(" Testnet services running — press Ctrl+C to stop");
  console.log("════════════════════════════════════════════════════════");
  console.log(` API:    ${apiBase}/health`);
  console.log(` UI:     ${uiUrl}`);
  console.log(` Config: ${configPath}`);
  console.log("════════════════════════════════════════════════════════\n");

  const shutdown = () => {
    console.log("\n[serve] shutting down…");
    for (const child of children) child.kill("SIGTERM");
    uiServer.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise<never>(() => {
    // Keep process alive until signal.
  });
}
