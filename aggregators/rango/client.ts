import type { IAggregatorClient } from "../IAggregatorClient.js";
import { applySlippageFloor } from "../compare.js";
import { ADAPTER_IDS, encodeRouterRouteDataSync, getJson, toRangoBlockchain, toRangoToken, type HttpClientOptions } from "../http.js";
import type { AggregatorQuote, BuildExecutionContext, ExecutionPlan, QuoteRequest, RouteStatus } from "../types.js";

type RangoQuoteResponse = {
  resultType?: string;
  route?: {
    outputAmount?: string;
    requestId?: string;
    estimatedTimeInSeconds?: number;
  };
};

type RangoSwapResponse = {
  resultType?: string;
  tx?: {
    txTo?: string;
    txData?: string;
    value?: string;
  };
};

export class RangoClient implements IAggregatorClient {
  readonly id = "rango" as const;

  constructor(private readonly options: HttpClientOptions) {}

  async quote(request: QuoteRequest): Promise<AggregatorQuote> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const params = new URLSearchParams({
      from: toRangoToken(request.sourceToken, request.sourceChainId),
      to: toRangoToken(request.destToken, request.destChainId),
      amount: request.sourceAmount,
      slippage: String((request.slippageBps ?? 100) / 100),
      apiKey: this.options.apiKey ?? "",
    });
    const url = `${this.options.baseUrl.replace(/\/$/, "")}/basic/quote?${params}`;
    const body = await getJson<RangoQuoteResponse>(url, fetchImpl);
    if (body.resultType && body.resultType !== "OK") {
      throw new Error(`Rango quote failed: ${body.resultType}`);
    }
    const out = body.route?.outputAmount;
    if (!out) throw new Error("Rango quote missing outputAmount");
    return {
      provider: "rango",
      destAmountOut: out,
      sourceAmountIn: request.sourceAmount,
      estimatedDurationSec: body.route?.estimatedTimeInSeconds,
      providerQuoteId: body.route?.requestId,
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
    const params = new URLSearchParams({
      from: toRangoToken(request.sourceToken, request.sourceChainId),
      to: toRangoToken(request.destToken, request.destChainId),
      amount: context.actualSourceAmount,
      slippage: String((context.slippageBps ?? 100) / 100),
      fromAddress: context.fromAddress,
      toAddress: request.recipient,
      disableEstimate: "true",
      apiKey: this.options.apiKey ?? "",
    });
    const url = `${this.options.baseUrl.replace(/\/$/, "")}/basic/swap?${params}`;
    const body = await getJson<RangoSwapResponse>(url, fetchImpl);
    const tx = body.tx;
    if (!tx?.txTo || !tx.txData) throw new Error("Rango swap missing tx");
    const minOut = applySlippageFloor(BigInt(quote.destAmountOut), context.slippageBps).toString();
    return {
      kind: "evm-contract",
      chainId: request.sourceChainId,
      fromAddress: context.fromAddress,
      adapterId: ADAPTER_IDS.rango,
      routeData: encodeRouterRouteDataSync(tx.txTo, tx.txData),
      minAmountOut: minOut,
      router: tx.txTo,
      tx: { to: tx.txTo, data: tx.txData, value: tx.value ?? "0" },
    };
  }

  async watch(reference: { txHash?: string; requestId?: string; chainId: string }): Promise<RouteStatus> {
    if (!reference.requestId && !reference.txHash) return { state: "pending" };
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const params = new URLSearchParams({
      requestId: reference.requestId ?? "",
      txId: reference.txHash ?? "",
      apiKey: this.options.apiKey ?? "",
    });
    const url = `${this.options.baseUrl.replace(/\/$/, "")}/basic/status?${params}`;
    try {
      const body = await getJson<{ status?: string; output?: { amount?: string; txHash?: string } }>(url, fetchImpl);
      if (body.status === "success" || body.status === "finished") {
        return {
          state: "dest_confirmed",
          txHash: body.output?.txHash,
          chainId: reference.chainId,
          amountOut: body.output?.amount,
        };
      }
      if (body.status === "failed") return { state: "failed", message: "Rango route failed" };
      return { state: "bridging" };
    } catch (error) {
      return { state: "failed", message: error instanceof Error ? error.message : "status error" };
    }
  }
}

export function createRangoClient(options?: Partial<HttpClientOptions>): RangoClient {
  return new RangoClient({
    baseUrl: options?.baseUrl ?? "https://api.rango.exchange",
    apiKey: options?.apiKey ?? process.env.RANGO_API_KEY,
    fetchImpl: options?.fetchImpl,
  });
}
