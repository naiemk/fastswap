#!/usr/bin/env tsx
/**
 * Local dev harness: two Hardhat nodes, deploy FastSwap stack with Local Provider
 * adapter + Router, write FastSwapConfig.local.yaml, then run API + sweep + execute workers.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Wallet } from "ethers";
import { stringify } from "yaml";
import type { FastSwapConfigFile } from "../config/types.js";
import {
  applyLocalOperatorEnv,
  deployLocalFastSwapChain,
  LOCAL_OPERATOR_PRIVATE_KEY,
  spawnHardhatNode,
  waitForRpc,
  type DeployedLocalChain,
} from "./local-stack.js";

const HOST = "127.0.0.1";
const ALICE_PORT = 9545;
const BOB_PORT = 9546;
const LOCAL_CONFIG = join(process.cwd(), "FastSwapConfig.local.yaml");
const DATA_DIR = join(process.cwd(), "data", "local");

const children: ChildProcess[] = [];

async function main() {
  process.env.API_SIGNING_SECRET = process.env.API_SIGNING_SECRET ?? "local-dev-signing-secret-32chars-min";
  process.env.FASTSWAP_CONFIG_PATH = LOCAL_CONFIG;
  process.env.FASTSWAP_LIVE_PROVIDERS = "0";
  applyLocalOperatorEnv(["alice", "bob"]);

  await rm(DATA_DIR, { recursive: true, force: true });
  await mkdir(DATA_DIR, { recursive: true });

  await run("npm", ["run", "compile"]);

  const aliceNode = spawnHardhatNode({ port: ALICE_PORT, chainId: 101, hostname: HOST });
  const bobNode = spawnHardhatNode({ port: BOB_PORT, chainId: 202, hostname: HOST });
  children.push(aliceNode, bobNode);
  await waitForRpc(`http://${HOST}:${ALICE_PORT}`, 101);
  await waitForRpc(`http://${HOST}:${BOB_PORT}`, 202);

  const alice = await deployLocalFastSwapChain({
    key: "alice",
    id: "101",
    name: "AliceChain",
    rpcUrl: `http://${HOST}:${ALICE_PORT}`,
    stableSymbol: "DumUSDT",
  });
  const bob = await deployLocalFastSwapChain({
    key: "bob",
    id: "202",
    name: "BobChain",
    rpcUrl: `http://${HOST}:${BOB_PORT}`,
    stableSymbol: "BobUSDC",
  });

  await writeLocalConfig([alice, bob]);
  console.log(`[dev-local] wrote ${LOCAL_CONFIG}`);
  console.log(`[dev-local] alice adapter=${alice.adapter} router=${alice.router}`);
  console.log(`[dev-local] bob adapter=${bob.adapter} router=${bob.router}`);

  const procs = [
    spawnProc("server", ["npm", "run", "server", LOCAL_CONFIG]),
    spawnProc("sweep", ["npm", "run", "sweep", LOCAL_CONFIG]),
    spawnProc("execute", ["npm", "run", "execute", LOCAL_CONFIG]),
  ];
  children.push(...procs);

  console.log(`[dev-local] API http://${HOST}:4010`);
  console.log(`[dev-local] UI: serve ui/ with FASTSWAP_API_BASE=http://${HOST}:4010`);
  console.log("[dev-local] Press Ctrl+C to stop");

  const stop = () => {
    for (const child of children) child.kill("SIGTERM");
  };
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stop();
    process.exit(0);
  });
}

async function writeLocalConfig(chains: DeployedLocalChain[]) {
  const config: FastSwapConfigFile = {
    version: 1,
    "active-chains": chains.map((c) => c.key),
    server: {
      host: HOST,
      apiPort: 4010,
      publicUrl: `http://${HOST}:4010`,
      sqlitePath: join(DATA_DIR, "fastswap.sqlite"),
      auditLogPath: join(DATA_DIR, "api-audit.jsonl"),
      signingSecretEnv: "API_SIGNING_SECRET",
      captcha: {
        provider: "none",
        siteKey: "",
        secretKey: "",
        requireForQuotes: false,
        requireForInvoices: false,
      },
    },
    quote: {
      feeBps: 75,
      maxDeviationBps: 10000,
      quoteTtlSec: 900,
      packsUsdMicros: ["10000000", "20000000", "50000000"],
    },
    sweepNode: {
      pollIntervalMs: 2500,
      pageLimit: 500,
      confirmations: 0,
      logScanOverlap: 100,
      sqlitePath: join(DATA_DIR, "sweep-node.sqlite"),
    },
    executeNode: { pollIntervalMs: 2500 },
    deploy: {
      createx: "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed",
      owner: new Wallet(LOCAL_OPERATOR_PRIVATE_KEY).address,
      salts: { namespace: "fastswap-local", version: "1" },
      contracts: {
        fastSwapImplementation: "",
        fastSwapAddress: chains[0]?.fastSwap ?? "",
        sweeperAddress: chains[0]?.sweeper ?? "",
        forwarderImplementation: "",
      },
    },
    nodes: {
      sweep: { auditLogPath: join(DATA_DIR, "sweep-audit.jsonl") },
      execute: {
        progressPath: join(DATA_DIR, "execute-progress.json"),
        auditLogPath: join(DATA_DIR, "execute-audit.jsonl"),
        pollIntervalMs: 2500,
      },
    },
    chains: chains.map((chain) => ({
      key: chain.key,
      id: chain.id,
      type: "evm" as const,
      name: chain.name,
      rpcUrl: chain.rpcUrl,
      explorerUrl: "http://localhost",
      confirmations: 0,
      startBlock: 0,
      router: chain.router,
      contracts: {
        fastSwapAddress: chain.fastSwap,
        sweeperAddress: chain.sweeper,
        forwarderImplementation: "",
        fastSwapImplementation: "",
      },
      tokens: [
        {
          symbol: "ETH",
          decimals: 18,
          isNative: true,
          minLiquidity: "0",
          priceSources: [{ type: "static" as const, priceUsdMicros: "2000000000" }],
        },
        {
          symbol: chain.stable.symbol,
          address: chain.stable.address,
          decimals: chain.stable.decimals,
          minLiquidity: "0",
          priceSources: [{ type: "static" as const, priceUsdMicros: "1000000" }],
        },
      ],
    })),
  };

  await writeFile(LOCAL_CONFIG, stringify(config, { lineWidth: 0 }), "utf8");
}

function spawnProc(label: string, cmd: string[]) {
  const child = spawn(cmd[0], cmd.slice(1), {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env, FASTSWAP_CONFIG_PATH: LOCAL_CONFIG },
  });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) console.error(`[dev-local] ${label} exited ${code}`);
  });
  return child;
}

function run(cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: process.cwd(), stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
