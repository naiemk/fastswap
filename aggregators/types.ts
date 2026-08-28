export type AggregatorId = "rango" | "rubic" | "symbiosis" | "transit" | "mock";

export type ChainKind = "evm" | "tron" | "solana";

export type QuoteRequest = {
  sourceChainId: string;
  sourceToken: string;
  sourceAmount: string;
  destChainId: string;
  destToken: string;
  recipient: string;
  refundAddress?: string;
  slippageBps?: number;
  /** When set, prefer this provider for execution. */
  preferredProvider?: AggregatorId;
};

export type QuoteFeeBreakdown = {
  protocolFeeBps: number;
  aggregatorFeeUsd?: string;
  networkFeeUsd?: string;
};

export type AggregatorQuote = {
  provider: AggregatorId;
  destAmountOut: string;
  sourceAmountIn: string;
  estimatedDurationSec?: number;
  fees?: QuoteFeeBreakdown;
  /** Opaque provider quote id for swap/buildExecution. */
  providerQuoteId?: string;
  /** Raw provider payload for debugging. */
  raw?: unknown;
  updatedAt: number;
};

export type ExecutionKind = "evm-contract" | "tron-contract" | "solana-tx" | "deposit-rejected";

export type EvmExecutionPlan = {
  kind: "evm-contract";
  chainId: string;
  fromAddress: string;
  adapterId: string;
  routeData: string;
  minAmountOut: string;
  router?: string;
  approvalToken?: string;
  approvalSpender?: string;
  approvalAmount?: string;
  tx?: { to: string; data: string; value: string };
};

export type TronExecutionPlan = {
  kind: "tron-contract" | "tron-eoa";
  chainId: string;
  fromAddress: string;
  adapterId: string;
  routeData: string;
  minAmountOut: string;
  tx?: { to: string; data: string; value: string };
};

export type SolanaExecutionPlan = {
  kind: "solana-tx";
  chainId: string;
  fromAddress: string;
  serializedTx: string;
  minAmountOut: string;
};

export type ExecutionPlan = EvmExecutionPlan | TronExecutionPlan | SolanaExecutionPlan;

export type RouteStatus =
  | { state: "pending" }
  | { state: "source_submitted"; txHash: string; chainId: string }
  | { state: "bridging" }
  | { state: "dest_confirmed"; txHash?: string; chainId?: string; amountOut?: string }
  | { state: "refunded"; txHash?: string }
  | { state: "failed"; message: string };

export type BuildExecutionContext = {
  fromAddress: string;
  actualSourceAmount: string;
  slippageBps: number;
};
