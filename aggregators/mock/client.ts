import type { IAggregatorClient } from "../IAggregatorClient.js";
import { ADAPTER_IDS, encodeRouterRouteDataSync } from "../http.js";
import type { AggregatorQuote, BuildExecutionContext, ExecutionPlan, QuoteRequest, RouteStatus } from "../types.js";

/** Deterministic mock client for tests and local demo without API keys. */
export class MockAggregatorClient implements IAggregatorClient {
  readonly id = "mock" as const;

  constructor(
    private readonly rateBps: bigint = 9950n,
    router?: string,
    private readonly routersByChainId: Record<string, string> = {}
  ) {
    this.router = router ?? "0x0000000000000000000000000000000000000001";
  }

  private readonly router: string;

  private routerFor(chainId: string): string {
    return this.routersByChainId[chainId] ?? this.router;
  }

  async quote(request: QuoteRequest): Promise<AggregatorQuote> {
    const inAmt = BigInt(request.sourceAmount);
    const out = (inAmt * this.rateBps) / 10_000n;
    return {
      provider: "mock",
      destAmountOut: out.toString(),
      sourceAmountIn: request.sourceAmount,
      estimatedDurationSec: 60,
      providerQuoteId: "mock-quote",
      updatedAt: Date.now(),
    };
  }

  async buildExecution(
    request: QuoteRequest,
    quote: AggregatorQuote,
    _context: BuildExecutionContext
  ): Promise<ExecutionPlan> {
    const router = this.routerFor(request.sourceChainId);
    return {
      kind: "evm-contract",
      chainId: request.sourceChainId,
      fromAddress: _context.fromAddress,
      adapterId: ADAPTER_IDS.mock,
      routeData: encodeRouterRouteDataSync(router, "0x"),
      minAmountOut: quote.destAmountOut,
      router,
      tx: { to: router, data: "0x", value: "0" },
    };
  }

  async watch(): Promise<RouteStatus> {
    return { state: "dest_confirmed" };
  }
}
