import type { IAggregatorClient } from "../IAggregatorClient.js";
import { applySlippageFloor } from "../compare.js";
import { ADAPTER_IDS, encodeRouterRouteDataSync, postJson, type HttpClientOptions } from "../http.js";
import type { AggregatorQuote, BuildExecutionContext, ExecutionPlan, QuoteRequest, RouteStatus } from "../types.js";

type SymbiosisQuoteResponse = {
  tokenAmountOut: { amount: string };
  estimatedTime?: number;
  tx?: { data?: string; to?: string; value?: string; approveTo?: string };
};

function symbiosisChainId(chainId: string): number {
  const map: Record<string, number> = {
    ethereum: 1,
    base: 8453,
    arbitrum: 42161,
    bsc: 56,
    polygon: 137,
    tron: 728126428,
    solana: 900,
    "mainnet-beta": 900,
  };
  const n = map[chainId];
  if (n) return n;
  if (/^\d+$/.test(chainId)) return Number(chainId);
  throw new Error(`Unknown chain for Symbiosis: ${chainId}`);
}

export class SymbiosisClient implements IAggregatorClient {
  readonly id = "symbiosis" as const;

  constructor(private readonly options: HttpClientOptions) {}

  async quote(request: QuoteRequest): Promise<AggregatorQuote> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const body = await postJson<SymbiosisQuoteResponse>(
      `${this.options.baseUrl.replace(/\/$/, "")}/v2/quote`,
      {
        tokenAmountIn: { chainId: symbiosisChainId(request.sourceChainId), address: normalizeToken(request.sourceToken), amount: request.sourceAmount },
        tokenOut: { chainId: symbiosisChainId(request.destChainId), address: normalizeToken(request.destToken) },
        from: request.refundAddress ?? request.recipient,
        to: request.recipient,
        slippage: (request.slippageBps ?? 100) / 100,
      },
      fetchImpl
    );
    const out = body.tokenAmountOut?.amount;
    if (!out) throw new Error("Symbiosis quote missing tokenAmountOut");
    return {
      provider: "symbiosis",
      destAmountOut: out,
      sourceAmountIn: request.sourceAmount,
      estimatedDurationSec: body.estimatedTime,
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
    const body = await postJson<SymbiosisQuoteResponse>(
      `${this.options.baseUrl.replace(/\/$/, "")}/v2/quote`,
      {
        tokenAmountIn: {
          chainId: symbiosisChainId(request.sourceChainId),
          address: normalizeToken(request.sourceToken),
          amount: context.actualSourceAmount,
        },
        tokenOut: { chainId: symbiosisChainId(request.destChainId), address: normalizeToken(request.destToken) },
        from: context.fromAddress,
        to: request.recipient,
        slippage: context.slippageBps / 100,
      },
      fetchImpl
    );
    const tx = body.tx;
    if (!tx?.to || !tx.data) throw new Error("Symbiosis quote missing tx");
    const minOut = applySlippageFloor(BigInt(quote.destAmountOut), context.slippageBps).toString();
    return {
      kind: "evm-contract",
      chainId: request.sourceChainId,
      fromAddress: context.fromAddress,
      adapterId: ADAPTER_IDS.symbiosis,
      routeData: encodeRouterRouteDataSync(tx.to, tx.data),
      minAmountOut: minOut,
      router: tx.to,
      approvalToken: normalizeToken(request.sourceToken) || undefined,
      approvalSpender: tx.approveTo,
      tx: { to: tx.to, data: tx.data, value: tx.value ?? "0" },
    };
  }

  async watch(reference: { txHash?: string; chainId: string }): Promise<RouteStatus> {
    if (!reference.txHash) return { state: "pending" };
    const fetchImpl = this.options.fetchImpl ?? fetch;
    try {
      const chain = symbiosisChainId(reference.chainId);
      const body = await fetchImpl(`${this.options.baseUrl.replace(/\/$/, "")}/v2/tx/${chain}/${reference.txHash}`).then(
        (r) => r.json() as Promise<{ status?: { code?: number }; tx?: { hash?: string } }>
      );
      if (body.status?.code === 1) {
        return { state: "dest_confirmed", txHash: body.tx?.hash, chainId: reference.chainId };
      }
      if (body.status?.code === -1) return { state: "failed", message: "Symbiosis route failed" };
      return { state: "bridging" };
    } catch (error) {
      return { state: "failed", message: error instanceof Error ? error.message : "status error" };
    }
  }
}

function normalizeToken(token: string): string {
  if (!token || token === "native") return "";
  return token;
}

export function createSymbiosisClient(options?: Partial<HttpClientOptions>): SymbiosisClient {
  return new SymbiosisClient({
    baseUrl: options?.baseUrl ?? "https://api.symbiosis.finance/crosschain",
    fetchImpl: options?.fetchImpl,
  });
}
