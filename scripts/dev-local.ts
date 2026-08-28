#!/usr/bin/env tsx
/**
 * Local dev harness: two Hardhat nodes, deploy FastSwap stack, write FastSwapConfig.local.yaml,
 * then run production API + sweep + execute workers.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, ZeroAddress } from "ethers";
import { stringify } from "yaml";
import { readArtifact } from "../cli/artifacts.js";
import type { FastSwapConfigFile } from "../config/types.js";

const HOST = "127.0.0.1";
const ALICE_PORT = 9545;
const BOB_PORT = 9546;
const PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const LOCAL_CONFIG = join(process.cwd(), "FastSwapConfig.local.yaml");
const DATA_DIR = join(process.cwd(), "data", "local");

type LocalChain = {
  key: string;
  id: string;
  name: string;
  rpcUrl: string;
  fastSwap: string;
  sweeper: string;
  stable: { symbol: string; address: string; decimals: number };
};

const children: ChildProcess[] = [];

async function main() {
  process.env.EVM_PRIVATE_KEY = PRIVATE_KEY;
  process.env.API_SIGNING_SECRET = process.env.API_SIGNING_SECRET ?? "local-dev-signing-secret-32chars-min";
  process.env.FASTSWAP_CONFIG_PATH = LOCAL_CONFIG;

  await rm(DATA_DIR, { recursive: true, force: true });
  await mkdir(DATA_DIR, { recursive: true });

  await run("npm", ["run", "compile"]);

  const aliceNode = spawnHardhatNode("alice", ALICE_PORT);
  const bobNode = spawnHardhatNode("bob", BOB_PORT);
  children.push(aliceNode, bobNode);
  await sleep(2000);

  const alice = await deployLocalChain("alice", "101", "AliceChain", `http://${HOST}:${ALICE_PORT}`, "DumUSDT");
  const bob = await deployLocalChain("bob", "202", "BobChain", `http://${HOST}:${BOB_PORT}`, "BobUSDC");

  await writeLocalConfig([alice, bob]);
  console.log(`[dev-local] wrote ${LOCAL_CONFIG}`);

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

async function deployLocalChain(
  key: string,
  id: string,
  name: string,
  rpcUrl: string,
  stableSymbol: string
): Promise<LocalChain> {
  const provider = new JsonRpcProvider(rpcUrl);
  await provider.getBlockNumber();
  const wallet = new Wallet(PRIVATE_KEY, provider);
  const [fastSwapArtifact, proxyArtifact, sweeperArtifact, tokenArtifact] = await Promise.all([
    readArtifact("contracts/FastSwapReceiver.sol/FastSwapReceiver.json"),
    readArtifact("ReceiverProxy"),
    readArtifact("InvoiceSweeper"),
    readArtifact("MockERC20"),
  ]);

  const impl = await deploy(wallet, fastSwapArtifact);
  const initData = new Contract(impl.target, fastSwapArtifact.abi, wallet).interface.encodeFunctionData("initialize", [
    wallet.address,
  ]);
  const proxy = await deploy(wallet, proxyArtifact, impl.target, initData);
  const sweeper = await deploy(wallet, sweeperArtifact, proxy.target);
  const token = (await deploy(wallet, tokenArtifact, `Local ${stableSymbol}`, stableSymbol, 6)) as Contract;
  await (await token.mint(wallet.address, 1_000_000_000_000n)).wait();
  await (await token.mint(proxy.target, 10_000_000_000n)).wait();
  const nativeLiq = 25n * 10n ** 18n;
  const fastSwap = new Contract(proxy.target, fastSwapArtifact.abi, wallet);
  await (await fastSwap.addLiquidity(ZeroAddress, nativeLiq, { value: nativeLiq })).wait();

  return {
    key,
    id,
    name,
    rpcUrl,
    fastSwap: String(proxy.target),
    sweeper: String(sweeper.target),
    stable: { symbol: stableSymbol, address: String(token.target), decimals: 6 },
  };
}

async function writeLocalConfig(chains: LocalChain[]) {
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
      owner: new Wallet(PRIVATE_KEY).address,
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

function spawnHardhatNode(name: string, port: number) {
  return spawn("npx", ["hardhat", "node", "--hostname", HOST, "--port", String(port)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
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

async function deploy(signer: Wallet, artifact: { abi: unknown; bytecode: string }, ...args: unknown[]) {
  const factory = new ContractFactory(artifact.abi as never, artifact.bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

function run(cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: process.cwd(), stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
