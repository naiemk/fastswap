import type { FastSwapConfigFile } from "../types.js";
import { resolveApiBaseUrl } from "../../shared/api-base.js";
import { createAggregatorClientsFromEnv } from "../../aggregators/index.js";
import type { ExecuteRunnerConfig } from "../../nodes/execute-node/runner.js";

export function toExecuteNodeConfig(config: FastSwapConfigFile): ExecuteRunnerConfig {
  const secretEnv = config.server.signingSecretEnv ?? "API_SIGNING_SECRET";
  const nodeAuthSecret = process.env[secretEnv] ?? config.server.nodeApiKey ?? "";
  if (!nodeAuthSecret) throw new Error(`Missing ${secretEnv} for execute node`);

  return {
    apiBaseUrl: resolveApiBaseUrl(config),
    nodeAuthSecret,
    pollIntervalMs: config.nodes?.execute?.pollIntervalMs ?? config.executeNode?.pollIntervalMs ?? 15_000,
    progressPath: config.nodes?.execute?.progressPath ?? "data/execute-progress.json",
    auditLogPath: config.server.auditLogPath,
    maxDeviationBps: BigInt(config.quote.maxDeviationBps),
    clients: createAggregatorClientsFromEnv(),
    chains: config["active-chains"]
      .map((key) => config.chains.find((c) => c.key === key))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .filter((chain) => chain.type === "evm" || chain.type === "tron")
      .map((chain) => ({
        id: chain.id,
        type: chain.type as "evm" | "tron",
        rpcUrl: chain.rpcUrl,
        fullHost: chain.fullHost,
        fastSwapAddress: chain.contracts?.fastSwapAddress ?? "",
        privateKeyEnv: `EXECUTE_${chain.key.toUpperCase()}_PRIVATE_KEY`,
        feeBps: BigInt(config.quote.feeBps),
      })),
  };
}
