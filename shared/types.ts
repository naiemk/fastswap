export type FastSwapChainType = "evm" | "tron" | "solana";

export type AggregatorId = "rango" | "rubic" | "symbiosis" | "transit" | "mock";

export type FastSwapTokenConfig = {
  symbol: string;
  chainId: string;
  address?: string;
  decimals: number;
  isNative?: boolean;
  /** Curated list tier: simple mode shows gas + stables only. */
  tier?: "simple" | "advanced";
  priceUsdMicros?: string;
  priceSources?: FastSwapTokenPriceSourceConfig[];
  explorerUrl?: string;
};

export type FastSwapTokenPriceSourceConfig =
  | { type: "coingecko"; coinId?: string; platformId?: string; contractAddress?: string }
  | { type: "binance"; symbol: string }
  | { type: "dexscreener"; chainId: string; tokenAddress?: string; pairAddress?: string }
  | { type: "static"; priceUsdMicros: string };

export type FastSwapChainConfig = {
  id: string;
  type: FastSwapChainType;
  name: string;
  nativeSymbol: string;
  sweeperAddress: string;
  fastSwapAddress: string;
  explorerUrl: string;
  tokens: FastSwapTokenConfig[];
  /** Solana commerce-invoice program id when type=solana. */
  solanaProgramId?: string;
  /** FastSwap relayer/merchant pubkey for Solana settle. */
  solanaMerchant?: string;
};

export type FastSwapPack = {
  usdAmountMicros: string;
};

export type FastSwapQuoteRequest = {
  sourceChainId: string;
  sourceToken: string;
  targetChainId: string;
  targetToken: string;
  recipient: string;
  /** Raw token amount in smallest units (preferred). */
  sourceAmount?: string;
  /** Estimated dest amount from client (optional). */
  targetAmount?: string;
  usdAmountMicros?: string;
  usdPack?: number;
  refundAddress?: string;
  slippageBps?: number;
  preferredProvider?: AggregatorId;
  /** UI mode hint — simple restricts token list server-side. */
  mode?: "simple" | "advanced";
};

export type AggregatorQuoteResult = {
  provider: AggregatorId;
  destAmountOut: string;
  sourceAmountIn: string;
  estimatedDurationSec?: number;
  updatedAt: number;
};

export type FastSwapQuote = {
  quoteId: string;
  expiresAt: number;
  sourceChainId: string;
  sourceToken: string;
  sourceAmount: string;
  targetChainId: string;
  targetToken: string;
  /** Estimated receive (indicative, re-quoted at execute). */
  targetAmount: string;
  recipient: string;
  refundAddress?: string;
  feeAmount: string;
  slippageBps: number;
  /** Best provider selected for execution unless user pinned one. */
  selectedProvider: AggregatorId;
  sources: AggregatorQuoteResult[];
};

export type FastSwapStatus =
  | "quoted"
  | "waiting_payment"
  | "paid"
  | "executing"
  | "bridging"
  | "complete"
  | "failed"
  | "refunded"
  /** @deprecated inventory-era states */
  | "relaying"
  | "queued";

export type FastSwapChainTx = {
  chainId: string;
  txHash: string;
  blockNumber?: number;
  gasUsed?: string;
  status: "pending" | "confirmed" | "failed";
  explorerTxUrl?: string;
};

export type FastSwapSweepInfo = {
  tx?: FastSwapChainTx;
  sourcePayment?: FastSwapChainTx;
  forwarder?: string;
  paymentToken?: string;
  paymentAmount?: string;
  sweeperAddress?: string;
  error?: string;
};

export type FastSwapExecuteInfo = {
  status?: "pending" | "submitted" | "confirmed" | "failed";
  provider?: AggregatorId;
  tx?: FastSwapChainTx;
  routeStatus?: string;
  error?: string;
};

/** @deprecated Legacy dest-chain relay telemetry. */
export type FastSwapRelayInfo = {
  status?: "pending" | "submitted" | "confirmed" | "failed";
  swapRequestedTx?: FastSwapChainTx;
  tx?: FastSwapChainTx;
  error?: string;
};

/** @deprecated Legacy price-feed quote row. */
export type QuoteSourceResult = {
  source: string;
  rate: string;
  targetAmount: string;
  updatedAt: number;
};

export type FastSwapLiquiditySummary = {
  chainId: string;
  token: string;
  balance: string;
  reserved: string;
  queuedAmount: string;
  lowLiquidity: boolean;
};

export type FastSwapPayoutInfo = {
  status?: "pending" | "confirmed" | "failed";
  tx?: FastSwapChainTx;
  token?: string;
  amount?: string;
  recipient?: string;
  error?: string;
};

export type FastSwapInvoice = FastSwapQuote & {
  invoiceId: string;
  invoiceAddress: string;
  data: string;
  chainId: string;
  token?: string;
  amount: string;
  status: FastSwapStatus;
  signature?: string;
  sweep?: FastSwapSweepInfo;
  execute?: FastSwapExecuteInfo;
  /** @deprecated */
  relay?: FastSwapRelayInfo;
  payout?: FastSwapPayoutInfo;
};

export type FastSwapInvoiceTrackPatch = {
  status?: FastSwapStatus;
  sweep?: Partial<FastSwapSweepInfo> & { tx?: Partial<FastSwapChainTx>; sourcePayment?: Partial<FastSwapChainTx> };
  execute?: Partial<FastSwapExecuteInfo> & { tx?: Partial<FastSwapChainTx> };
  /** @deprecated */
  relay?: Partial<FastSwapRelayInfo> & { tx?: Partial<FastSwapChainTx>; swapRequestedTx?: Partial<FastSwapChainTx> };
  payout?: Partial<FastSwapPayoutInfo> & { tx?: Partial<FastSwapChainTx> };
};

export type FastSwapRecentSwap = {
  swapId: string;
  sourceChainId: string;
  targetChainId: string;
  sourceToken: string;
  targetToken: string;
  sourceAmount?: string;
  targetAmount?: string;
  amountBand: string;
  status: FastSwapStatus;
  txHash?: string;
  explorerTxUrl?: string;
  completedAt?: number;
};
