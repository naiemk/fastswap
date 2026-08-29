import type {
  AggregatorQuote,
  BuildExecutionContext,
  ExecutionPlan,
  QuoteRequest,
  RouteStatus,
} from "./types.js";

export interface IAggregatorClient {
  readonly id: import("./types.js").AggregatorId;

  quote(request: QuoteRequest): Promise<AggregatorQuote>;

  buildExecution(
    request: QuoteRequest,
    quote: AggregatorQuote,
    context: BuildExecutionContext
  ): Promise<ExecutionPlan>;

  watch(reference: { txHash?: string; requestId?: string; chainId: string }): Promise<RouteStatus>;
}
