import type { FastSwapConfigFile } from "../types.js";
import { getActiveChainDefinitions, isTronEoaChain, resolveChainContracts, resolveTronSweepSettings } from "../load.js";
import { resolveTronInvoiceMasterSecret } from "../../shared/tron-secrets.js";
import type { SweepNodeConfig, TronChainConfig } from "onchain-invoice/sweep-node";
import { attachFastSwapSweepHooks } from "../../nodes/sweep-hooks.js";
import { TronWeb } from "tronweb";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

function resolveTronMasterSecret(chain: { sweep?: { invoiceMasterSecretEnv?: string } }): string {
  return resolveTronInvoiceMasterSecret(chain.sweep?.invoiceMasterSecretEnv);
}

export function toSweepNodeConfig(config: FastSwapConfigFile, apiPublicUrl: string): SweepNodeConfig {
  const signingSecret = requireEnv(config.server.signingSecretEnv ?? "API_SIGNING_SECRET");
  const chains = getActiveChainDefinitions(config).map((chain) => {
    const contracts = resolveChainContracts(config, chain);
    const base = {
      id: chain.id,
      sweeperAddress: contracts.sweeperAddress || undefined,
      receiverAddress: contracts.fastSwapAddress || undefined,
      confirmations: chain.confirmations ?? config.sweepNode.confirmations,
      logScanOverlap: config.sweepNode.logScanOverlap,
      sweepBatchSize: chain.sweep?.batchSweepMaxInvoices ?? 50,
    };
    if (chain.type === "evm") {
      if (!chain.rpcUrl) throw new Error(`${chain.key}: rpcUrl required`);
      return {
        ...base,
        type: "evm" as const,
        rpcUrl: chain.rpcUrl,
        privateKey: requireEnv("SWEEP_EVM_PRIVATE_KEY"),
        startBlock: chain.startBlock ?? 0,
        sweeperAddress: contracts.sweeperAddress,
        receiverAddress: contracts.fastSwapAddress,
      };
    }
    if (!chain.fullHost && !chain.rpcUrl) throw new Error(`${chain.key}: fullHost required`);
    const privateKey = requireEnv("SWEEP_TRON_PRIVATE_KEY");
    const sweepSettings = resolveTronSweepSettings(chain);
    const eoa = isTronEoaChain(chain);
    const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl!, privateKey: privateKey.replace(/^0x/, "") });
    const sponsorAddress =
      sweepSettings.sponsorAddress && sweepSettings.sponsorAddress.startsWith("T")
        ? sweepSettings.sponsorAddress
        : (tronWeb.defaultAddress.base58 as string);

    const tronChain: TronChainConfig = {
      ...base,
      type: "tron" as const,
      fullHost: chain.fullHost ?? chain.rpcUrl!,
      privateKey,
      startTimestamp: chain.startTimestamp ?? 0,
      feeLimit: chain.feeLimit,
      eventPollLimit: 200,
      sweepMode: eoa ? "eoa" : "contract",
      sponsorAddress,
      batchSweepThresholdUsd: sweepSettings.batchSweepThresholdUsd,
      batchSweepMaxInvoices: sweepSettings.batchSweepMaxInvoices,
      energyMode: sweepSettings.energyMode,
      energyRentProvider: sweepSettings.energyRentProvider,
      minDelegateEnergy: sweepSettings.minDelegateEnergy,
      tokens: chain.tokens.map((t) => ({
        symbol: t.symbol,
        address: t.address,
        decimals: t.decimals,
        isNative: t.isNative,
        priceUsd: staticPriceUsd(t),
      })),
    };

    if (eoa) {
      tronChain.invoiceMasterSecret = resolveTronMasterSecret(chain);
    } else {
      tronChain.sweeperAddress = contracts.sweeperAddress;
      tronChain.receiverAddress = contracts.fastSwapAddress;
    }

    return tronChain;
  });

  return attachFastSwapSweepHooks(
    {
      webServer: {
        baseUrl: apiPublicUrl,
        nodeApiKey: signingSecret,
        pageLimit: config.sweepNode.pageLimit,
      },
      cache: { sqlitePath: config.sweepNode.sqlitePath },
      pollIntervalMs: config.sweepNode.pollIntervalMs,
      reconcileReceiverLimitPerChain: 500,
      auditLogPath: config.nodes.sweep.auditLogPath,
      chains,
    },
    signingSecret
  );
}

function staticPriceUsd(token: { priceSources?: Array<{ type: string; priceUsd?: string; priceUsdMicros?: string }>; symbol: string }): number | undefined {
  const staticSrc = token.priceSources?.find((p) => p.type === "static");
  if (staticSrc?.priceUsd) return Number(staticSrc.priceUsd);
  if (staticSrc?.priceUsdMicros) return Number(staticSrc.priceUsdMicros) / 1_000_000;
  if (token.symbol === "USDT" || token.symbol === "USDC") return 1;
  return undefined;
}
