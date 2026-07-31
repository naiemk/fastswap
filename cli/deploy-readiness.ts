import { Contract, JsonRpcProvider, Wallet, formatEther, formatUnits } from "ethers";
import { TronWeb } from "tronweb";
import type { FastSwapConfigFile } from "../config/types.js";
import {
  getActiveChainDefinitions,
  getChainDefinition,
  isTronEoaChain,
  resolveChainContracts,
  tryResolveChainContracts,
} from "../config/load.js";
import { validateFastSwapConfig } from "./validate-config.js";
import { applyOperatorEnvDefaults, stepEnvCheck } from "./bootstrap.js";
import {
  applyTronSecretDefaults,
  resolveTronInvoiceMasterSecret,
  resolveTronOperatorPrivateKey,
} from "../shared/tron-secrets.js";

import { keccak256, toUtf8Bytes } from "ethers";
import { FASTSWAP_RECEIVER_ABI } from "../shared/fastswap-abi.js";
import {
  deriveTronInvoiceAddress,
  ERC20_ABI,
} from "onchain-invoice";

export type ReadinessIssue = { level: "error" | "warn"; message: string };

export type DeployReadinessReport = {
  ok: boolean;
  issues: ReadinessIssue[];
  env: ReturnType<typeof stepEnvCheck>;
  chains: Record<string, unknown>;
};

const MAX_TOKEN_BAND_RAW = (decimals: number) => 10n ** (BigInt(decimals) + 9n);

export function checkLiquidityBandSanity(
  chainKey: string,
  symbol: string,
  band: { floor: string; target: string; ceiling: string; isStable?: boolean; decimals?: number },
  issues: ReadinessIssue[]
): void {
  const floor = BigInt(band.floor);
  const target = BigInt(band.target);
  const ceiling = BigInt(band.ceiling);
  const max = MAX_TOKEN_BAND_RAW(band.decimals ?? (band.isStable ? 6 : 18));

  if (floor > target || target > ceiling) {
    issues.push({
      level: "error",
      message: `${chainKey}: ${symbol} band ordering invalid (floor ≤ target ≤ ceiling)`,
    });
  }
  for (const [label, raw] of [
    ["floor", floor],
    ["target", target],
    ["ceiling", ceiling],
  ] as const) {
    if (raw > max) {
      issues.push({
        level: "error",
        message: `${chainKey}: ${symbol} ${label} looks corrupt (${raw.toString()} raw units)`,
      });
    }
  }
}

function checkChainLiquiditySanity(chainKey: string, config: FastSwapConfigFile, issues: ReadinessIssue[]): void {
  const chain = getChainDefinition(config, chainKey);
  if (!chain.liquidity) return;
  for (const receiver of chain.liquidity.receivers) {
    for (const band of receiver.tokens) {
      checkLiquidityBandSanity(chainKey, band.symbol, band, issues);
    }
  }
}

export async function checkDeployReadiness(
  config: FastSwapConfigFile,
  env: NodeJS.ProcessEnv = process.env
): Promise<DeployReadinessReport> {
  applyOperatorEnvDefaults();
  applyTronSecretDefaults(config.chains.find((c) => c.type === "tron")?.sweep?.invoiceMasterSecretEnv);

  const issues: ReadinessIssue[] = [];
  const envCheck = stepEnvCheck(config);
  for (const message of envCheck.issues) {
    issues.push({ level: "error", message });
  }

  const validation = validateFastSwapConfig(config, env, { allowLocalPublicUrl: true });
  for (const message of validation.issues) {
    issues.push({ level: "error", message: `config: ${message}` });
  }

  const captcha = config.server.captcha;
  if (captcha.requireForQuotes || captcha.requireForInvoices) {
    if (!captcha.siteKey || !captcha.secretKey) {
      issues.push({ level: "error", message: "captcha required but TURNSTILE siteKey/secretKey empty after env expansion" });
    }
  } else {
    issues.push({ level: "warn", message: "captcha is disabled — enable requireForQuotes/Invoices for go-live" });
  }

  for (const chain of getActiveChainDefinitions(config)) {
    for (const token of chain.tokens) {
      if (token.isNative) {
        const sources = token.priceSources ?? [];
        const live = sources.filter((s) => s.type !== "static");
        if (live.length === 0) {
          issues.push({
            level: "error",
            message: `${chain.key}: ${token.symbol} has no live priceSources (coingecko/binance/dexscreener)`,
          });
        }
      }
    }
  }

  const chainReports: Record<string, unknown> = {};

  for (const chain of getActiveChainDefinitions(config)) {
    checkChainLiquiditySanity(chain.key, config, issues);
    if (chain.type === "evm") {
      if (!chain.router) {
        issues.push({ level: "error", message: `${chain.key}: router not set` });
      }
      chainReports[chain.key] = await checkEvmChain(chain.key, config, issues);
    } else if (isTronEoaChain(chain)) {
      chainReports[chain.key] = await checkTronEoaChain(chain.key, config, issues);
    } else {
      chainReports[chain.key] = { mode: "contract", note: "legacy TronForwarder deploy path" };
      issues.push({ level: "warn", message: `${chain.key}: contract mode — consider sweep.mode: eoa` });
    }
  }

  const ok = issues.every((i) => i.level !== "error");
  const activeKeys = config["active-chains"];
  const checkedKeys = Object.keys(chainReports);
  if (checkedKeys.length !== activeKeys.length) {
    issues.push({
      level: "error",
      message: `readiness checked ${checkedKeys.length}/${activeKeys.length} active chains`,
    });
  }
  return { ok, issues, env: envCheck, chains: chainReports };
}

async function checkEvmChain(chainKey: string, config: FastSwapConfigFile, issues: ReadinessIssue[]) {
  const chain = getChainDefinition(config, chainKey);
  const contracts = tryResolveChainContracts(config, chain);
  if (!contracts?.fastSwapAddress || !chain.rpcUrl) {
    issues.push({ level: "error", message: `${chainKey}: EVM contracts or RPC not ready` });
    return { deployed: false };
  }

  const provider = new JsonRpcProvider(chain.rpcUrl);
  const code = await provider.getCode(contracts.fastSwapAddress);
  if (code === "0x") {
    issues.push({ level: "error", message: `${chainKey}: FastSwap receiver not deployed at ${contracts.fastSwapAddress}` });
    return { deployed: false };
  }

  const fastSwap = new Contract(contracts.fastSwapAddress, FASTSWAP_RECEIVER_ABI, provider);
  const native = chain.tokens.find((t) => t.isNative);
  const stable = chain.tokens.find((t) => t.symbol === "USDT" || t.symbol === "USDC");
  const ethBal = await provider.getBalance(contracts.fastSwapAddress);
  let stableBal = 0n;
  if (stable?.address) {
    stableBal = await new Contract(stable.address, ERC20_ABI, provider).balanceOf(contracts.fastSwapAddress);
  }

  const ethHuman = formatEther(ethBal);
  const stableHuman = stable ? formatUnits(stableBal, stable.decimals) : "0";
  if (native && ethBal === 0n) {
    issues.push({ level: "warn", message: `${chainKey}: receiver has 0 ${native.symbol} — relay payouts may queue` });
  }

  let relayerOk = false;
  const pk = process.env.EVM_PRIVATE_KEY;
  if (pk) {
    try {
      const role = await fastSwap.RELAYER_ROLE();
      relayerOk = await fastSwap.hasRole(role, new Wallet(pk).address);
      if (!relayerOk) issues.push({ level: "warn", message: `${chainKey}: operator lacks RELAYER_ROLE on receiver` });
    } catch {
      issues.push({ level: "warn", message: `${chainKey}: could not verify RELAYER_ROLE` });
    }
  }

  return {
    deployed: true,
    fastSwapAddress: contracts.fastSwapAddress,
    sweeperAddress: contracts.sweeperAddress,
    liquidityManagerAddress: contracts.liquidityManagerAddress,
    balances: { native: ethHuman, stable: stableHuman },
    relayerOk,
  };
}

async function checkTronEoaChain(chainKey: string, config: FastSwapConfigFile, issues: ReadinessIssue[]) {
  const chain = getChainDefinition(config, chainKey);
  const fullHost = chain.fullHost ?? chain.rpcUrl;
  if (!fullHost) {
    issues.push({ level: "error", message: `${chainKey}: missing TRON fullHost` });
    return { mode: "eoa", ready: false };
  }

  const pk = resolveTronOperatorPrivateKey();
  if (!pk) {
    issues.push({ level: "error", message: `${chainKey}: missing TRON/EVM private key` });
    return { mode: "eoa", ready: false };
  }

  try {
    resolveTronInvoiceMasterSecret(chain.sweep?.invoiceMasterSecretEnv);
  } catch (error) {
    issues.push({ level: "error", message: `${chainKey}: ${error instanceof Error ? error.message : String(error)}` });
    return { mode: "eoa", ready: false };
  }

  const tronWeb = new TronWeb({ fullHost, privateKey: pk.replace(/^0x/, "") });
  const sponsor = tronWeb.defaultAddress.base58 as string;
  const trxSun = BigInt(await tronWeb.trx.getBalance(sponsor));
  const trx = Number(trxSun) / 1e6;

  const usdt = chain.tokens.find((t) => t.symbol === "USDT");
  let usdtBal = 0n;
  if (usdt?.address) {
    const c = tronWeb.contract(
      [{ type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as never,
      usdt.address
    );
    usdtBal = BigInt((await c.balanceOf(sponsor).call()).toString());
  }

  if (trx < 10) {
    issues.push({ level: "error", message: `${chainKey}: sponsor wallet low TRX (${trx.toFixed(2)} TRX) — need gas/energy` });
  } else if (trx < 50) {
    issues.push({ level: "warn", message: `${chainKey}: sponsor TRX ${trx.toFixed(2)} — consider freezing for energy` });
  }

  const resources = await tronWeb.trx.getAccountResources(sponsor);
  const energyAvail = Math.max(0, Number(resources.EnergyLimit ?? 0) - Number(resources.EnergyUsed ?? 0));
  const minEnergy = chain.sweep?.minDelegateEnergy ?? 65_000;
  if (chain.sweep?.energyMode === "staked" && energyAvail < minEnergy) {
    issues.push({
      level: "error",
      message: `${chainKey}: sponsor energy ${energyAvail} below minDelegateEnergy ${minEnergy} (freeze TRX or switch energyMode)`,
    });
  } else if (energyAvail < minEnergy) {
    issues.push({
      level: "warn",
      message: `${chainKey}: sponsor energy ${energyAvail} below ${minEnergy} — sweeps may burn TRX`,
    });
  }

  const sampleId = keccak256(toUtf8Bytes("readiness-probe"));
  const sampleInvoice = deriveTronInvoiceAddress(
    resolveTronInvoiceMasterSecret(chain.sweep?.invoiceMasterSecretEnv),
    chain.id,
    sampleId,
    fullHost
  );

  if (!usdt?.address) {
    issues.push({ level: "warn", message: `${chainKey}: USDT token address not set — run deploy-tokens` });
  }

  return {
    mode: "eoa",
    ready: true,
    sponsor,
    trx,
    usdt: usdt ? (Number(usdtBal) / 10 ** usdt.decimals).toFixed(6) : "0",
    energyAvailable: energyAvail,
    sampleInvoiceAddress: sampleInvoice,
    batchSweepThresholdUsd: chain.sweep?.batchSweepThresholdUsd ?? 50,
  };
}
