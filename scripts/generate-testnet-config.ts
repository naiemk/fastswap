#!/usr/bin/env node
/**
 * Generate FastSwapConfig.testnet.yaml from FastSwapConfig.yaml.
 * Two-chain testnet go-live: Sepolia + TRON Nile.
 * Real CoinGecko/Binance prices; Cloudflare Turnstile captcha via env.
 *
 *   npm run generate:testnet-config
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROD_PATH = join(ROOT, "FastSwapConfig.yaml");
const OUT_PATH = join(ROOT, "FastSwapConfig.testnet.yaml");

/** Prod chain key → testnet chain definition. */
const CHAIN_MAP = {
  ethereum: {
    key: "sepolia",
    id: "11155111",
    name: "Sepolia",
    rpcEnv: "SEPOLIA_RPC_URL",
    explorerUrl: "https://sepolia.etherscan.io",
    aggregatorSlug: "eth",
    routerEnv: "SEPOLIA_ROUTER_ADDRESS",
  },
  tron: {
    key: "tron",
    id: "3448148188",
    name: "TRON Nile",
    fullHostEnv: "NILE_FULL_HOST",
    explorerUrl: "https://nile.tronscan.org",
    aggregatorSlug: "tron",
    routerEnv: "TRON_ROUTER_ADDRESS",
  },
} as const;

const NILE_USDT = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const SCALE = 100;

function scaleDecimal(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return value;
  const scaled = n / SCALE;
  if (scaled >= 1) return scaled % 1 === 0 ? String(scaled) : scaled.toFixed(2).replace(/\.?0+$/, "");
  return scaled.toFixed(4).replace(/\.?0+$/, "");
}

function scaleUsdPack(pack: string): string {
  const n = Number(pack);
  if (!Number.isFinite(n)) return pack;
  const scaled = n / SCALE;
  if (scaled < 0.01) return "0.10";
  return scaled % 1 === 0 ? String(scaled) : scaled.toFixed(2).replace(/\.?0+$/, "");
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function quoteEnvVarScalars(yaml: string): string {
  return yaml.replace(/^(\s*[\w.-]+: )(\$\{[A-Z0-9_]+\})$/gm, '$1"$2"');
}

function stripStaticPriceSources(tokens: Record<string, Record<string, unknown>>): void {
  for (const token of Object.values(tokens)) {
    const sources = token.priceSources as Array<{ type: string }> | undefined;
    if (!sources) continue;
    token.priceSources = sources.filter((s) => s.type !== "static");
  }
}

function main() {
  const prod = parseYaml(readFileSync(PROD_PATH, "utf8")) as Record<string, unknown>;
  const out = deepClone(prod);

  out["active-chains"] = ["sepolia", "tron"];

  const server = out.server as Record<string, unknown>;
  server.host = "0.0.0.0";
  server.publicUrl = "${FASTSWAP_PUBLIC_URL}";
  server.sqlitePath = "./data/fastswap-testnet.sqlite";
  server.auditLogPath = "./data/api-audit-testnet.jsonl";
  const captcha = server.captcha as Record<string, unknown>;
  captcha.provider = "cloudflare-turnstile";
  captcha.siteKey = "${TURNSTILE_SITE_KEY}";
  captcha.secretKey = "${TURNSTILE_SECRET_KEY}";
  captcha.requireForQuotes = true;
  captcha.requireForInvoices = true;

  const quote = out.quote as Record<string, unknown>;
  const packsUsd = quote.packsUsd as string[] | undefined;
  if (packsUsd) {
    quote.packsUsd = packsUsd.map(scaleUsdPack);
  }

  const sweepNode = out.sweepNode as Record<string, unknown>;
  sweepNode.confirmations = 1;
  sweepNode.sqlitePath = "./data/sweep-testnet.sqlite";

  const relayNode = out.relayNode as Record<string, unknown>;
  relayNode.confirmations = 1;

  const lm = out.liquidityManager as Record<string, unknown>;
  lm.sqlitePath = "./data/liquidity-manager-testnet.sqlite";
  const economics = lm.economics as Record<string, unknown>;
  economics.minNotionalUsd = Number(economics.minNotionalUsd) / SCALE;
  economics.riskCapUsd = Number(economics.riskCapUsd) / SCALE;
  economics.maxGasPriceGwei = 200;

  const deploy = out.deploy as Record<string, unknown>;
  deploy.owner = "${FASTSWAP_OWNER_ADDRESS}";
  const salts = deploy.salts as Record<string, unknown>;
  salts.namespace = "fastswap-testnet";
  deploy.contracts = {
    fastSwapImplementation: "",
    fastSwapAddress: "",
    sweeperAddress: "",
    forwarderImplementation: "",
    liquidityManagerImplementation: "",
    liquidityManagerAddress: "",
  };
  delete deploy.resolvedSalts;

  const nodes = out.nodes as Record<string, unknown>;
  (nodes.sweep as Record<string, unknown>).auditLogPath = "./data/sweep-audit-testnet.jsonl";
  (nodes.relay as Record<string, unknown>).progressPath = "./data/relay-progress-testnet.json";
  (nodes.relay as Record<string, unknown>).auditLogPath = "./data/relay-audit-testnet.jsonl";
  (nodes.liqman as Record<string, unknown>).auditLogPath = "./data/liqman-audit-testnet.jsonl";

  const prodChains = out.chains as Array<Record<string, unknown>>;
  const mirrored: Array<Record<string, unknown>> = [];

  for (const prodKey of ["ethereum", "tron"] as const) {
    const prodChain = prodChains.find((c) => c.key === prodKey);
    if (!prodChain) throw new Error(`Missing prod chain ${prodKey}`);
    const map = CHAIN_MAP[prodKey];
    const chain = deepClone(prodChain);
    chain.key = map.key;
    chain.id = map.id;
    chain.name = map.name;
    chain.explorerUrl = map.explorerUrl;
    chain.aggregatorSlug = map.aggregatorSlug;
    chain.confirmations = 1;
    chain.startBlock = 0;
    chain.optional = false;

    if (prodKey === "tron") {
      chain.fullHost = `\${${map.fullHostEnv}}`;
      delete chain.rpcUrl;
      chain.startTimestamp = 0;
      const sweep = chain.sweep as Record<string, unknown>;
      sweep.mode = "eoa";
      sweep.batchSweepThresholdUsd = 50;
      sweep.energyMode = "staked";
      chain.contracts = {
        fastSwapAddress: "",
        sweeperAddress: "",
        forwarderImplementation: "",
        liquidityManagerAddress: "",
      };
      const tokens = chain.tokens as Record<string, Record<string, unknown>>;
      if (tokens.USDT) tokens.USDT.address = NILE_USDT;
      stripStaticPriceSources(tokens);
      chain.router = `\${${map.routerEnv}}`;
    } else {
      chain.rpcUrl = `\${${map.rpcEnv}}`;
      chain.router = `\${${map.routerEnv}}`;
      delete chain.fullHost;
      delete chain.startTimestamp;
      delete chain.sweep;
      const tokens = chain.tokens as Record<string, Record<string, unknown>>;
      // Deploy mintable USDT/USDC on Sepolia; clear mainnet addresses.
      for (const token of Object.values(tokens)) {
        if (token.address) delete token.address;
      }
      stripStaticPriceSources(tokens);
      // Sepolia seed uses USDT as reserve stable (simpler one-stable deploy).
      const liquidity = chain.liquidity as Record<string, unknown>;
      if (liquidity) liquidity.reserveStable = "USDT";
      // Keep ETH + USDT; drop USDC for the 2-chain minimal surface.
      if (tokens.USDC) delete tokens.USDC;
      if (liquidity?.receivers) {
        for (const receiver of liquidity.receivers as Array<{ tokens: Record<string, unknown> }>) {
          delete receiver.tokens.USDC;
          if (!receiver.tokens.USDT && tokens.USDT) {
            // Pre-scale values (scaled down by SCALE below) — mirrors live Sepolia bands ≈ $1–$20.
            receiver.tokens.USDT = { isStable: true, floor: "100", target: "500", ceiling: "2000" };
          }
        }
      }
      // Prefer a recent Sepolia start block after bootstrap; generator leaves 0 for empty configs.
      chain.startBlock = 0;
    }

    const liquidity = chain.liquidity as Record<string, unknown>;
    const receivers = liquidity.receivers as Array<{ tokens: Record<string, Record<string, unknown>> }>;
    for (const receiver of receivers) {
      for (const band of Object.values(receiver.tokens)) {
        if (band.floor) band.floor = scaleDecimal(String(band.floor));
        if (band.target) band.target = scaleDecimal(String(band.target));
        if (band.ceiling) band.ceiling = scaleDecimal(String(band.ceiling));
      }
    }

    mirrored.push(chain);
  }

  // Preserve deploy.contracts (and Sepolia USDT address) from an existing testnet file when present.
  try {
    const previous = parseYaml(readFileSync(OUT_PATH, "utf8")) as Record<string, unknown>;
    const prevDeploy = previous.deploy as Record<string, unknown> | undefined;
    const prevContracts = prevDeploy?.contracts as Record<string, string> | undefined;
    if (prevContracts?.fastSwapAddress) {
      deploy.contracts = prevContracts;
      console.log("Preserved deploy.contracts from existing testnet config");
    }
    const prevChains = previous.chains as Array<Record<string, unknown>> | undefined;
    const prevSepolia = prevChains?.find((c) => c.key === "sepolia");
    const outSepolia = mirrored.find((c) => c.key === "sepolia");
    if (prevSepolia && outSepolia) {
      if (prevSepolia.startBlock) outSepolia.startBlock = prevSepolia.startBlock;
      const prevTokens = prevSepolia.tokens as Record<string, Record<string, unknown>> | Array<{ symbol: string; address?: string }>;
      const outTokens = outSepolia.tokens as Record<string, Record<string, unknown>>;
      if (Array.isArray(prevTokens)) {
        const usdt = prevTokens.find((t) => t.symbol === "USDT");
        if (usdt?.address && outTokens.USDT) outTokens.USDT.address = usdt.address;
      } else if (prevTokens?.USDT?.address && outTokens.USDT) {
        outTokens.USDT.address = prevTokens.USDT.address;
      }
    }
  } catch {
    // First generate — empty contracts intentional.
  }

  out.chains = mirrored;

  const header = `# FastSwap 2-chain testnet go-live: Sepolia + TRON Nile.
# Regenerate: npm run generate:testnet-config
# Real prices (CoinGecko/Binance). Real Cloudflare Turnstile (TURNSTILE_* env).
# After deploy, addresses are written here (or use FastSwapConfig.testnet.local.yaml.example overlay).
version: 1\n\n`;

  const body = quoteEnvVarScalars(stringifyYaml(out, { lineWidth: 120 }).replace(/^version: 1\n/, ""));
  writeFileSync(OUT_PATH, header + body);
  console.log(`Wrote ${OUT_PATH}`);
}

main();
