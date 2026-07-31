#!/usr/bin/env node
/**
 * Cross-chain E2E using real SweepNode + RelayRunner (one tick per round).
 *
 * Usage:
 *   npm run fastswap:e2e-nodes -- --config FastSwapConfig.testnet.yaml
 *   npm run fastswap:e2e-nodes -- --config FastSwapConfig.testnet.yaml --target baseSepolia
 */
import { Contract, formatUnits, parseUnits } from "ethers";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { FastSwapServer } from "../server/server.js";
import { buildFastSwapServerOptions } from "../server/bootstrap.js";
import { toSweepNodeConfig } from "../config/adapters/sweep.js";
import { toRelayRunnerConfig } from "../config/adapters/relay.js";
import { RelayRunner } from "../nodes/relay-node/runner.js";
import { SweepNode } from "onchain-invoice/sweep-node";
import {
  getActiveChainDefinitions,
  getChainDefinition,
  resolveChainContracts,
  resolveConfigPath,
} from "../config/load.js";
import type { FastSwapConfigFile } from "../config/types.js";
import type { FastSwapInvoice, FastSwapQuote, FastSwapStatus } from "../shared/types.js";
import {
  applyOperatorEnvDefaults,
  ensureSigningSecret,
  reloadConfig,
} from "./bootstrap.js";
import { applyTronSecretDefaults } from "../shared/tron-secrets.js";
import {
  TRON_ERC20_ABI,
  makeEvm,
  makeTron,
  sleep,
  waitTron,
} from "../fastSwapDemo/integration/live-helpers.js";
import { FASTSWAP_RECEIVER_ABI } from "../shared/fastswap-abi.js";

const PACK_USD = "100000";
const MAX_NODE_ROUNDS = 40;

export type CrossChainE2EOptions = {
  sourceKey?: string;
  targetKey?: string;
};

async function main() {
  const configPath = resolveConfigPath(readFlag("--config"));
  const options: CrossChainE2EOptions = {
    sourceKey: readFlag("--source") ?? "tron",
    targetKey: readFlag("--target"),
  };
  await runCrossChainE2ENodes(configPath, options);
}

/** @deprecated Use runCrossChainE2ENodes */
export async function runTronToSepoliaE2ENodes(configPath: string) {
  return runCrossChainE2ENodes(configPath, { sourceKey: "tron", targetKey: "sepolia" });
}

export function resolveDefaultEvmTargetKey(config: FastSwapConfigFile): string {
  for (const preferred of ["sepolia", "baseSepolia", "arbitrumSepolia"]) {
    if (config["active-chains"].includes(preferred)) return preferred;
  }
  const evm = getActiveChainDefinitions(config).find((c) => c.type === "evm");
  if (!evm) throw new Error("No active EVM chain for E2E target");
  return evm.key;
}

export async function runCrossChainE2ENodes(configPath: string, options: CrossChainE2EOptions = {}) {
  applyOperatorEnvDefaults();
  const config = reloadConfig(configPath);
  applyTronSecretDefaults(config.chains.find((c) => c.type === "tron")?.sweep?.invoiceMasterSecretEnv);
  ensureSigningSecret(config);

  const sourceKey = options.sourceKey ?? "tron";
  const targetKey = options.targetKey ?? resolveDefaultEvmTargetKey(config);

  const evmPk = process.env.EVM_PRIVATE_KEY!;
  const tronPk = process.env.TRON_PRIVATE_KEY ?? evmPk;

  await ensureDataDirs(config);
  const server = new FastSwapServer(buildFastSwapServerOptions(config));
  const bound = await server.run(config.server.host, config.server.apiPort);
  const liveApi = config.server.publicUrl ?? `http://${bound.address === "::" ? "127.0.0.1" : bound.address}:${bound.port}`;

  const sweepNode = new SweepNode(toSweepNodeConfig(config, liveApi));
  const relayRunner = new RelayRunner(toRelayRunnerConfig({ ...config, server: { ...config.server, publicUrl: liveApi } }));

  const source = getChainDefinition(config, sourceKey);
  const target = getChainDefinition(config, targetKey);
  if (source.type !== "tron") {
    throw new Error(`E2E nodes runner currently supports TRON source only (got ${sourceKey})`);
  }
  if (target.type !== "evm") {
    throw new Error(`E2E nodes runner requires EVM target (got ${targetKey})`);
  }

  const targetContracts = resolveChainContracts(config, target);
  const sourceUsdt = source.tokens.find((t) => t.symbol === "USDT");
  if (!sourceUsdt?.address) throw new Error(`${sourceKey}: USDT address required`);

  const recipient = makeEvm(target.rpcUrl!, evmPk).address;

  console.log(`\n=== E2E nodes: ${source.name} → ${target.name} (${liveApi}) ===\n`);

  try {
    const quote = await api<FastSwapQuote>(liveApi, "POST", "/quotes", {
      sourceChainId: source.id,
      sourceToken: sourceUsdt.address,
      targetChainId: target.id,
      targetToken: "native",
      recipient,
      usdAmountMicros: PACK_USD,
    });

    const invoice = await api<FastSwapInvoice>(liveApi, "POST", "/invoices", { quoteId: quote.quoteId });
    const sourceAmount = BigInt(invoice.sourceAmount);
    const targetAmount = BigInt(invoice.targetAmount);

    console.log(`Invoice ${invoice.invoiceId.slice(0, 14)}… → ${invoice.invoiceAddress}`);
    console.log(`Pay ${formatUnits(sourceAmount, sourceUsdt.decimals)} USDT on TRON`);

    await payTronUsdt(source.fullHost ?? source.rpcUrl!, tronPk, sourceUsdt.address, invoice.invoiceAddress, sourceAmount);
    await ensureEvmTargetLiquidity(target, targetContracts.fastSwapAddress, targetAmount, evmPk);

    console.log("Running sweep + relay nodes (once per round)…");
    for (let round = 1; round <= MAX_NODE_ROUNDS; round++) {
      await sweepNode.runOnce();
      await relayRunner.runOnce();
      let status = await fetchStatus(liveApi, invoice.invoiceId);
      if (status === "queued") {
        await tryProcessQueuedEvm(target, targetContracts.fastSwapAddress, invoice.invoiceId, evmPk);
        status = await fetchStatus(liveApi, invoice.invoiceId);
      }
      console.log(`  round ${round}: ${status}`);
      if (status === "complete") {
        console.log(`\n✓ ${source.name} → ${target.name} E2E complete (nodes)\n`);
        return;
      }
      await sleep(4000);
    }
    throw new Error(`Timeout after ${MAX_NODE_ROUNDS} node rounds (last status: ${await fetchStatus(liveApi, invoice.invoiceId)})`);
  } finally {
    sweepNode.stop();
    relayRunner.stop();
    await server.close();
  }
}

async function payTronUsdt(fullHost: string, pk: string, token: string, to: string, amount: bigint) {
  const tron = makeTron(fullHost, pk);
  const c = tron.tronWeb.contract(TRON_ERC20_ABI as never, token);
  await waitTron(tron.tronWeb, await c.transfer(to, amount.toString()).send({ feeLimit: 150_000_000 }));
}

async function ensureEvmTargetLiquidity(
  target: ReturnType<typeof getChainDefinition>,
  receiver: string,
  needEth: bigint,
  evmPk: string
) {
  const evm = makeEvm(target.rpcUrl!, evmPk);
  const native = "0x0000000000000000000000000000000000000000";
  const fs = new Contract(receiver, FASTSWAP_RECEIVER_ABI, evm.wallet);
  const saneFloor = parseUnits("0.001", 18);
  let floor = await fs.liquidityFloor(native);
  if (floor > parseUnits("1", 18)) {
    console.log(`Fixing ${target.key} liquidity floor (${floor.toString()} wei → ${saneFloor.toString()} wei)`);
    await (await fs.setLiquidityFloor(native, saneFloor)).wait();
    floor = saneFloor;
  }
  const bal = await evm.provider.getBalance(receiver);
  const available = bal > floor ? bal - floor : 0n;
  const minAvailable = needEth + parseUnits("0.0001", 18);
  if (available >= minAvailable) return;
  const topUp = minAvailable - available + parseUnits("0.001", 18);
  console.log(`Top-up ${target.key} receiver with ${formatUnits(topUp, 18)} ETH for relay`);
  await (await fs.addLiquidity(native, topUp, { value: topUp })).wait();
}

async function tryProcessQueuedEvm(
  target: ReturnType<typeof getChainDefinition>,
  receiver: string,
  swapId: string,
  evmPk: string
) {
  const evm = makeEvm(target.rpcUrl!, evmPk);
  const fs = new Contract(receiver, FASTSWAP_RECEIVER_ABI, evm.wallet);
  const state = await fs.swapState(swapId);
  if (!state.queued || state.processed) return;
  console.log(`  settling queued ${target.key} payout via processQueued…`);
  await (await fs.processQueued(swapId)).wait();
}

async function ensureDataDirs(config: ReturnType<typeof reloadConfig>) {
  const paths = [
    config.server.sqlitePath,
    config.sweepNode.sqlitePath,
    config.nodes.sweep.auditLogPath,
    config.nodes.relay.auditLogPath,
    config.nodes.relay.progressPath,
  ];
  await Promise.all(paths.map((p) => mkdir(dirname(p), { recursive: true })));
}

async function fetchStatus(apiBase: string, invoiceId: string): Promise<FastSwapStatus | "unknown"> {
  const res = await fetch(`${apiBase}/invoices/${encodeURIComponent(invoiceId)}`);
  if (!res.ok) return "unknown";
  const body = (await res.json()) as FastSwapInvoice;
  return body.status ?? "unknown";
}

async function api<T>(base: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

function readFlag(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1]?.includes("testnet-e2e-nodes")) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
