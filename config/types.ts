import type {
  FastSwapChainConfig,
  FastSwapTokenConfig,
  FastSwapTokenPriceSourceConfig,
} from "../shared/types.js";

export type FastSwapChainType = "evm" | "tron" | "solana";

export type FastSwapConfigToken = Omit<FastSwapTokenConfig, "chainId"> & {
  priceSources?: FastSwapTokenPriceSourceConfig[];
  minLiquidity?: string;
};

export type LiquidityTokenBand = {
  symbol: string;
  address?: string;
  decimals: number;
  isStable?: boolean;
  floor: string;
  target: string;
  ceiling: string;
};

export type LiquidityReserveStable = {
  symbol: string;
  address: string;
  decimals: number;
};

export type LiquidityReceiverConfig = {
  /** Defaults to the chain FastSwap receiver when omitted. */
  address?: string;
  tokens: LiquidityTokenBand[];
};

export type ChainLiquidityConfig = {
  reserveStable: LiquidityReserveStable;
  receivers: LiquidityReceiverConfig[];
};

export type TronChainContracts = {
  fastSwapAddress?: string;
  sweeperAddress?: string;
  forwarderImplementation?: string;
};

export type TronSweepSettings = {
  mode?: "eoa" | "contract";
  invoiceMasterSecretEnv?: string;
  sponsorAddress?: string;
  batchSweepThresholdUsd?: number;
  batchSweepMaxInvoices?: number;
  energyMode?: "staked" | "burn" | "rent";
  energyRentProvider?: string;
  minDelegateEnergy?: number;
};

export type FastSwapChainDefinition = {
  key: string;
  id: string;
  type: FastSwapChainType;
  name: string;
  optional?: boolean;
  rpcUrl?: string;
  fullHost?: string;
  feeLimit?: number;
  explorerUrl: string;
  confirmations?: number;
  startBlock?: number;
  startTimestamp?: number;
  aggregatorSlug?: string;
  nativeSentinel?: string;
  router?: string;
  /** Optional per-chain deployed addresses (local dev / TRON). EVM defaults to deploy.contracts. */
  contracts?: Partial<DeployContracts>;
  /** TRON EOA sweep settings (default mode: eoa when contracts are unset). */
  sweep?: TronSweepSettings;
  /** Solana commerce-invoice program + merchant for settle-to-relayer. */
  solana?: {
    programId?: string;
    merchantPubkey?: string;
    rpcUrl?: string;
  };
  tokens: FastSwapConfigToken[];
  /** @deprecated Liquidity bands removed in aggregator model. */
  liquidity?: ChainLiquidityConfig;
};

import type { DeploySaltSpec, ResolvedDeploySalts } from "./salts.js";

export type DeployContracts = {
  fastSwapImplementation: string;
  fastSwapAddress: string;
  sweeperAddress: string;
  forwarderImplementation: string;
};

export type DeployConfig = {
  /** Canonical CreateX factory address (same on all supported EVM chains). */
  createx: string;
  /** @deprecated Use `createx`. Kept for backward compatibility with older configs. */
  create2Factory?: string;
  owner: string;
  /** Human-readable namespace + version; hashed to CREATE2 salts at load. */
  salts: DeploySaltSpec | ResolvedDeploySalts;
  /** Bytes32 salts derived from `salts.namespace` + `salts.version` (set by loader). */
  resolvedSalts?: ResolvedDeploySalts;
  contracts: DeployContracts;
};

export type FastSwapConfigFile = {
  version: number;
  "active-chains": string[];
  server: {
    host: string;
    apiPort: number;
    /** Public URL nodes and UI use (no trailing slash). */
    publicUrl?: string;
    sqlitePath: string;
    auditLogPath: string;
    /** Env var name holding the HMAC signing secret (default API_SIGNING_SECRET). */
    signingSecretEnv?: string;
    /** @deprecated Use signingSecretEnv. */
    nodeApiKey?: string;
    captcha: {
      provider: string;
      siteKey: string;
      secretKey: string;
      requireForQuotes?: boolean;
      requireForInvoices?: boolean;
    };
  };
  quote: {
    feeBps: number | string;
    maxDeviationBps: number | string;
    quoteTtlSec: number;
    /** Human USD notionals in on-disk config (e.g. "10" = $10). */
    packsUsd?: string[];
    /** Normalized micro-USD notionals (always set after load). */
    packsUsdMicros: string[];
  };
  sweepNode: {
    pollIntervalMs: number;
    pageLimit: number;
    confirmations: number;
    logScanOverlap: number;
    sqlitePath: string;
  };
  relayNode?: {
    pollIntervalMs: number;
    confirmations: number;
  };
  executeNode?: {
    pollIntervalMs: number;
  };
  deploy: DeployConfig;
  nodes: {
    sweep: { auditLogPath: string };
    relay?: { progressPath: string; auditLogPath: string };
    execute?: { progressPath: string; auditLogPath: string; pollIntervalMs?: number };
  };
  chains: FastSwapChainDefinition[];
};

export type ResolvedChainContracts = DeployContracts;

export type ResolvedFastSwapChain = FastSwapChainDefinition & {
  contracts: ResolvedChainContracts;
  fastSwap: FastSwapChainConfig;
};
