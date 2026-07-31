import type { RelayChain } from "../../nodes/relay-node/index.js";
import type { FastSwapConfigFile } from "../types.js";
import { getActiveChainDefinitions, isTronEoaChain, resolveChainContracts, resolveTronSweepSettings } from "../load.js";
import { resolveApiBaseUrl } from "../../shared/api-base.js";
import { TronWeb } from "tronweb";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

export function toRelayChains(config: FastSwapConfigFile): RelayChain[] {
  return getActiveChainDefinitions(config).map((chain) => {
    const contracts = resolveChainContracts(config, chain);
    const privateKey =
      chain.type === "evm" ? requireEnv("RELAY_EVM_PRIVATE_KEY") : requireEnv("RELAY_TRON_PRIVATE_KEY");
    const eoa = chain.type === "tron" && isTronEoaChain(chain);
    const sweep = chain.type === "tron" ? resolveTronSweepSettings(chain) : undefined;
    const sponsorAddress =
      eoa && sweep?.sponsorAddress?.startsWith("T")
        ? sweep.sponsorAddress
        : eoa
          ? (new TronWeb({
              fullHost: chain.fullHost ?? chain.rpcUrl ?? "",
              privateKey: privateKey.replace(/^0x/, ""),
            }).defaultAddress.base58 as string)
          : undefined;

    if (chain.type === "evm") {
      if (!chain.rpcUrl) throw new Error(`${chain.key}: rpcUrl required`);
      return {
        id: chain.id,
        name: chain.name,
        type: "evm",
        rpcUrl: chain.rpcUrl,
        fastSwapAddress: contracts.fastSwapAddress,
        privateKey,
        startBlock: chain.startBlock ?? 0,
        confirmations: chain.confirmations ?? config.relayNode.confirmations,
      };
    }
    if (!chain.fullHost && !chain.rpcUrl) throw new Error(`${chain.key}: fullHost required`);
    return {
      id: chain.id,
      name: chain.name,
      type: "tron",
      fullHost: chain.fullHost ?? chain.rpcUrl!,
      fastSwapAddress: contracts.fastSwapAddress || sponsorAddress || "",
      privateKey,
      feeLimit: chain.feeLimit,
      startTimestamp: chain.startTimestamp ?? 0,
      eventPollLimit: 200,
      confirmations: chain.confirmations ?? config.relayNode.confirmations,
      nodeWalletMode: eoa,
      sponsorAddress,
      router: chain.router,
      aggregatorSlug: chain.aggregatorSlug,
      nativeSentinel: chain.nativeSentinel,
      tokens: chain.tokens.map((t) => ({
        symbol: t.symbol,
        address: t.address,
        decimals: t.decimals,
        isNative: t.isNative,
      })),
    };
  });
}

export type RelayRunnerConfig = {
  apiBaseUrl: string;
  nodeAuthSecret: string;
  pollIntervalMs: number;
  progressPath: string;
  auditLogPath: string;
  chains: RelayChain[];
};

export function toRelayRunnerConfig(config: FastSwapConfigFile): RelayRunnerConfig {
  const signingSecret = requireEnv(config.server.signingSecretEnv ?? "API_SIGNING_SECRET");
  return {
    apiBaseUrl: resolveApiBaseUrl(config),
    nodeAuthSecret: signingSecret,
    pollIntervalMs: config.relayNode.pollIntervalMs,
    progressPath: config.nodes.relay.progressPath,
    auditLogPath: config.nodes.relay.auditLogPath,
    chains: toRelayChains(config),
  };
}
