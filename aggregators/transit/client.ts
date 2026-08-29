import type { IAggregatorClient } from "../IAggregatorClient.js";
import { applySlippageFloor } from "../compare.js";
import { ADAPTER_IDS, encodeRouterRouteDataSync, postJson, type HttpClientOptions } from "../http.js";
import type { AggregatorQuote, BuildExecutionContext, ExecutionPlan, QuoteRequest, RouteStatus } from "../types.js";

type TransitQuoteResponse = {
  data?: {
    toTokenAmount?: string;
    estimatedTime?: number;
    tx?: { to?: string; data?: string; value?: string };
  };
};

export class TransitClient implements IAggregatorClient {
  readonly id = "transit" as const;

  constructor(private readonly options: HttpClientOptions) {}

  async quote(request: QuoteRequest): Promise<AggregatorQuote> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const body = await postJson<TransitQuoteResponse>(
      `${this.options.baseUrl.replace(/\/$/, "")}/v3/quote`,
      {
        fromToken: request.sourceToken,
        toToken: request.destToken,
        fromChain: request.sourceChainId,
        toChain: request.destChainId,
        amount: request.sourceAmount,
        slippage: (request.slippageBps ?? 100) / 100,
      },
      fetchImpl
    );
    const out = body.data?.toTokenAmount;
    if (!out) throw new Error("Transit quote missing toTokenAmount");
    return {
      provider: "transit",
      destAmountOut: out,
      sourceAmountIn: request.sourceAmount,
      estimatedDurationSec: body.data?.estimatedTime,
      raw: body,
      updatedAt: Date.now(),
    };
  }

  async buildExecution(
    request: QuoteRequest,
    quote: AggregatorQuote,
    context: BuildExecutionContext
  ): Promise<ExecutionPlan> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const body = await postJson<TransitQuoteResponse>(
      `${this.options.baseUrl.replace(/\/$/, "")}/v3/swap`,
      {
        fromToken: request.sourceToken,
        toToken: request.destToken,
        fromChain: request.sourceChainId,
        toChain: request.destChainId,
        amount: context.actualSourceAmount,
        slippage: context.slippageBps / 100,
        fromAddress: context.fromAddress,
        toAddress: request.recipient,
      },
      fetchImpl
    );
    const tx = body.data?.tx;
    if (!tx?.to || !tx.data) throw new Error("Transit swap missing tx");
    const minOut = applySlippageFloor(BigInt(quote.destAmountOut), context.slippageBps).toString();
    return {
      kind: "evm-contract",
      chainId: request.sourceChainId,
      fromAddress: context.fromAddress,
      adapterId: ADAPTER_IDS.transit,
      routeData: encodeRouterRouteDataSync(tx.to, tx.data),
      minAmountOut: minOut,
      router: tx.to,
      tx: { to: tx.to, data: tx.data, value: tx.value ?? "0" },
    };
  }

  async watch(reference: { txHash?: string; chainId: string }): Promise<RouteStatus> {
    if (!reference.txHash) return { state: "pending" };
    return { state: "bridging" };
  }
}

export function createTransitClient(options?: Partial<HttpClientOptions>): TransitClient {
  return new TransitClient({
    baseUrl: options?.baseUrl ?? "https://aggserver.transit.finance",
    fetchImpl: options?.fetchImpl,
  });
}
