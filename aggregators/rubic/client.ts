import type { IAggregatorClient } from "../IAggregatorClient.js";
import { applySlippageFloor } from "../compare.js";
import { ADAPTER_IDS, encodeRouterRouteDataSync, postJson, type HttpClientOptions } from "../http.js";
import type { AggregatorQuote, BuildExecutionContext, ExecutionPlan, QuoteRequest, RouteStatus } from "../types.js";

type RubicQuoteResponse = {
  id: string;
  estimate: {
    destinationTokenAmount: string;
    durationInMinutes?: number;
  };
};

type RubicSwapResponse = {
  transaction?: {
    to?: string;
    data?: string;
    value?: string;
    depositAddress?: string;
    amountToSend?: string;
  };
};

function toRubicBlockchain(chainId: string): string {
  const map: Record<string, string> = {
    ethereum: "ETH",
    base: "BASE",
    arbitrum: "ARBITRUM",
    bsc: "BSC",
    polygon: "POLYGON",
    tron: "TRON",
    solana: "SOLANA",
    "mainnet-beta": "SOLANA",
  };
  return map[chainId] ?? chainId.toUpperCase();
}

function toRubicTokenAddress(token: string): string {
  if (!token || token === "native") return "0x0000000000000000000000000000000000000000";
  return token;
}

export class RubicClient implements IAggregatorClient {
  readonly id = "rubic" as const;

  constructor(private readonly options: HttpClientOptions & { referrer?: string }) {}

  async quote(request: QuoteRequest): Promise<AggregatorQuote> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const body = await postJson<RubicQuoteResponse>(
      `${this.options.baseUrl.replace(/\/$/, "")}/api/routes/quoteBest`,
      {
        srcTokenAddress: toRubicTokenAddress(request.sourceToken),
        srcTokenAmount: formatHumanAmount(request.sourceAmount, request.sourceChainId),
        srcTokenBlockchain: toRubicBlockchain(request.sourceChainId),
        dstTokenAddress: toRubicTokenAddress(request.destToken),
        dstTokenBlockchain: toRubicBlockchain(request.destChainId),
        referrer: this.options.referrer ?? "fastswap",
      },
      fetchImpl
    );
    const dest = body.estimate?.destinationTokenAmount;
    if (!dest) throw new Error("Rubic quote missing destinationTokenAmount");
    return {
      provider: "rubic",
      destAmountOut: dest,
      sourceAmountIn: request.sourceAmount,
      estimatedDurationSec: body.estimate.durationInMinutes ? body.estimate.durationInMinutes * 60 : undefined,
      providerQuoteId: body.id,
      raw: body,
      updatedAt: Date.now(),
    };
  }

  async buildExecution(
    request: QuoteRequest,
    quote: AggregatorQuote,
    context: BuildExecutionContext
  ): Promise<ExecutionPlan> {
    if (!quote.providerQuoteId) throw new Error("Rubic quote missing id");
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const body = await postJson<RubicSwapResponse>(
      `${this.options.baseUrl.replace(/\/$/, "")}/api/routes/swap`,
      {
        id: quote.providerQuoteId,
        fromAddress: context.fromAddress,
        receiver: request.recipient,
        referrer: this.options.referrer ?? "fastswap",
      },
      fetchImpl
    );
    const tx = body.transaction;
    if (tx?.depositAddress) {
      throw new Error("Rubic deposit-address routes are not supported for invoice model");
    }
    if (!tx?.to || !tx.data) throw new Error("Rubic swap missing contract tx");
    const minOut = applySlippageFloor(BigInt(quote.destAmountOut), context.slippageBps).toString();
    return {
      kind: "evm-contract",
      chainId: request.sourceChainId,
      fromAddress: context.fromAddress,
      adapterId: ADAPTER_IDS.rubic,
      routeData: encodeRouterRouteDataSync(tx.to, tx.data),
      minAmountOut: minOut,
      router: tx.to,
      tx: { to: tx.to, data: tx.data, value: tx.value ?? "0" },
    };
  }

  async watch(reference: { txHash?: string; requestId?: string; chainId: string }): Promise<RouteStatus> {
    if (!reference.txHash) return { state: "pending" };
    const fetchImpl = this.options.fetchImpl ?? fetch;
    try {
      const body = await postJson<{ status?: string; destinationTxHash?: string }>(
        `${this.options.baseUrl.replace(/\/$/, "")}/api/info/status`,
        { srcTxHash: reference.txHash },
        fetchImpl
      );
      if (body.status === "SUCCESS") {
        return { state: "dest_confirmed", txHash: body.destinationTxHash, chainId: reference.chainId };
      }
      if (body.status === "FAILED") return { state: "failed", message: "Rubic route failed" };
      return { state: "bridging" };
    } catch (error) {
      return { state: "failed", message: error instanceof Error ? error.message : "status error" };
    }
  }
}

/** Rubic API expects decimal string amounts for some routes; pass through raw wei when already integer. */
function formatHumanAmount(amount: string, _chainId: string): string {
  if (/^\d+$/.test(amount) && amount.length > 12) {
    return amount;
  }
  return amount;
}

export function createRubicClient(options?: Partial<HttpClientOptions & { referrer?: string }>): RubicClient {
  return new RubicClient({
    baseUrl: options?.baseUrl ?? "https://api-v2.rubic.exchange",
    referrer: options?.referrer ?? "fastswap",
    fetchImpl: options?.fetchImpl,
  });
}
