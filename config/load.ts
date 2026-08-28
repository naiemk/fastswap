import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { CREATEX_ADDRESS } from "../cli/createx.js";
import type {
  FastSwapChainDefinition,
  FastSwapConfigFile,
  ResolvedChainContracts,
  ResolvedFastSwapChain,
  TronSweepSettings,
} from "./types.js";
import { resolveDeploySalts } from "./salts.js";
import type { ResolvedDeploySalts } from "./salts.js";
import { normalizeFastSwapConfig } from "./normalize.js";
import type { FastSwapChainConfig } from "../shared/types.js";

export type { FastSwapConfigFile } from "./types.js";

export const DEFAULT_CONFIG_PATH = join(process.cwd(), "FastSwapConfig.yaml");

export function resolveConfigPath(path?: string): string {
  return path ?? process.env.FASTSWAP_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
}

export function loadFastSwapConfig(path?: string): FastSwapConfigFile {
  const configPath = resolveConfigPath(path);
  const raw = parse(readFileSync(configPath, "utf8")) as FastSwapConfigFile;
  const expanded = expandEnvDeep(raw) as FastSwapConfigFile;
  return normalizeFastSwapConfig(normalizeDeployConfig(expanded) as Parameters<typeof normalizeFastSwapConfig>[0]);
}

export function resolveCreateXAddress(config: FastSwapConfigFile): string {
  return config.deploy.createx || config.deploy.create2Factory || CREATEX_ADDRESS;
}

export function saveFastSwapConfig(config: FastSwapConfigFile, path?: string): void {
  const configPath = resolveConfigPath(path);
  writeFileSync(configPath, stringify(config, { lineWidth: 0 }), "utf8");
}

export function getChainDefinition(config: FastSwapConfigFile, key: string): FastSwapChainDefinition {
  const chain = config.chains.find((entry) => entry.key === key);
  if (!chain) throw new Error(`Unknown chain key "${key}" in FastSwapConfig.yaml`);
  return chain;
}

export function getActiveChainDefinitions(config: FastSwapConfigFile): FastSwapChainDefinition[] {
  return config["active-chains"].map((key) => getChainDefinition(config, key));
}

export function getEvmActiveChains(config: FastSwapConfigFile): FastSwapChainDefinition[] {
  return getActiveChainDefinitions(config).filter((chain) => chain.type === "evm");
}

export function getOptionalEvmChains(config: FastSwapConfigFile): FastSwapChainDefinition[] {
  return config.chains.filter((chain) => chain.type === "evm" && chain.optional);
}

export function isTronEoaChain(chain: FastSwapChainDefinition): boolean {
  if (chain.type !== "tron") return false;
  if (chain.sweep?.mode === "contract") return false;
  if (chain.sweep?.mode === "eoa") return true;
  const contracts = chain.contracts;
  return !contracts?.sweeperAddress && !contracts?.fastSwapAddress;
}

export function resolveTronSweepSettings(chain: FastSwapChainDefinition): TronSweepSettings {
  return {
    mode: isTronEoaChain(chain) ? "eoa" : "contract",
    invoiceMasterSecretEnv: chain.sweep?.invoiceMasterSecretEnv ?? "TRON_INVOICE_MASTER_SECRET",
    sponsorAddress: chain.sweep?.sponsorAddress,
    batchSweepThresholdUsd: chain.sweep?.batchSweepThresholdUsd ?? 50,
    batchSweepMaxInvoices: chain.sweep?.batchSweepMaxInvoices,
    energyMode: chain.sweep?.energyMode ?? "staked",
    energyRentProvider: chain.sweep?.energyRentProvider,
    minDelegateEnergy: chain.sweep?.minDelegateEnergy ?? 65_000,
  };
}

export function resolveChainContracts(
  config: FastSwapConfigFile,
  chain: FastSwapChainDefinition
): ResolvedChainContracts {
  if (chain.type === "tron") {
    if (isTronEoaChain(chain)) {
      const sweep = resolveTronSweepSettings(chain);
      return {
        fastSwapImplementation: "",
        fastSwapAddress: sweep.sponsorAddress ?? "",
        sweeperAddress: "",
        forwarderImplementation: "",
      };
    }
    const contracts = chain.contracts;
    if (!contracts?.fastSwapAddress || !contracts?.sweeperAddress) {
      throw new Error(`Missing Tron contract addresses for chain "${chain.key}"`);
    }
    return {
      fastSwapImplementation: contracts.forwarderImplementation ?? "",
      fastSwapAddress: contracts.fastSwapAddress,
      sweeperAddress: contracts.sweeperAddress,
      forwarderImplementation: contracts.forwarderImplementation ?? "",
    };
  }

  const shared = config.deploy.contracts;
  const override = chain.contracts ?? {};
  const merged = { ...shared, ...override };
  if (!merged.fastSwapAddress || !merged.sweeperAddress) {
    throw new Error(`Missing EVM contract addresses (chain "${chain.key}")`);
  }
  return merged;
}

export function tryResolveChainContracts(
  config: FastSwapConfigFile,
  chain: FastSwapChainDefinition
): ResolvedChainContracts | undefined {
  try {
    return resolveChainContracts(config, chain);
  } catch {
    return undefined;
  }
}

export function toFastSwapChainConfig(
  chain: FastSwapChainDefinition,
  contracts: ResolvedChainContracts
): FastSwapChainConfig {
  return {
    id: chain.id,
    type: chain.type,
    name: chain.name,
    nativeSymbol: chain.tokens.find((token) => token.isNative)?.symbol ?? "NATIVE",
    sweeperAddress: contracts.sweeperAddress,
    fastSwapAddress: contracts.fastSwapAddress,
    explorerUrl: chain.explorerUrl,
    tokens: chain.tokens.map((token) => ({
      ...token,
      chainId: chain.id,
    })),
  };
}

export function resolveActiveFastSwapChains(config: FastSwapConfigFile): ResolvedFastSwapChain[] {
  return getActiveChainDefinitions(config).map((chain) => {
    const contracts = resolveChainContracts(config, chain);
    return {
      ...chain,
      contracts,
      fastSwap: toFastSwapChainConfig(chain, contracts),
    };
  });
}

export function updateDeployContracts(
  config: FastSwapConfigFile,
  patch: Partial<ResolvedChainContracts>
): FastSwapConfigFile {
  return {
    ...config,
    deploy: {
      ...config.deploy,
      contracts: {
        ...config.deploy.contracts,
        ...patch,
      },
    },
  };
}

export function updateTronContracts(
  config: FastSwapConfigFile,
  patch: Partial<ResolvedChainContracts>,
  chainKey = "tron"
): FastSwapConfigFile {
  return {
    ...config,
    chains: config.chains.map((chain) => {
      if (chain.key !== chainKey) return chain;
      return {
        ...chain,
        contracts: {
          fastSwapAddress: patch.fastSwapAddress ?? chain.contracts?.fastSwapAddress ?? "",
          sweeperAddress: patch.sweeperAddress ?? chain.contracts?.sweeperAddress ?? "",
          forwarderImplementation:
            patch.forwarderImplementation ?? chain.contracts?.forwarderImplementation ?? "",
        },
      };
    }),
  };
}

export function updateChainTokenAddress(
  config: FastSwapConfigFile,
  chainKey: string,
  symbol: string,
  address: string
): FastSwapConfigFile {
  return {
    ...config,
    chains: config.chains.map((chain) => {
      if (chain.key !== chainKey) return chain;
      return {
        ...chain,
        tokens: chain.tokens.map((token) => (token.symbol === symbol ? { ...token, address } : token)),
      };
    }),
  };
}

function expandEnvDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (_key, current) =>
    typeof current === "string" ? expandEnv(current) : current
  ) as T;
}

function expandEnv(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => process.env[name] ?? "");
}

function normalizeDeployConfig(config: FastSwapConfigFile): FastSwapConfigFile {
  const createx = config.deploy.createx || config.deploy.create2Factory || CREATEX_ADDRESS;
  const resolvedSalts = resolveDeploySalts(config.deploy.salts);
  return {
    ...config,
    deploy: {
      ...config.deploy,
      createx,
      resolvedSalts,
    },
  };
}

export function getResolvedDeploySalts(config: FastSwapConfigFile): ResolvedDeploySalts {
  return config.deploy.resolvedSalts ?? resolveDeploySalts(config.deploy.salts);
}
