import { randomUUID } from "node:crypto";
import type { IAggregatorClient } from "../aggregators/IAggregatorClient.js";
import { compareQuotesByDestAmount, pickBestQuote, protocolFeeAmount } from "../aggregators/compare.js";
import type { AggregatorId, FastSwapChainConfig, FastSwapQuote, FastSwapQuoteRequest, FastSwapTokenConfig } from "../shared/types.js";
import { resolveTokenPriceUsdMicros, type PriceFetch } from "./price-sources.js";

export type QuoteEngineOptions = {
  clients: IAggregatorClient[];
  feeBps: bigint;
  quoteTtlMs: number;
  chains?: FastSwapChainConfig[];
  defaultSlippageBps?: number;
  priceFetch?: PriceFetch;
};

export class QuoteEngine {
  constructor(private readonly options: QuoteEngineOptions) {}

  async quote(request: FastSwapQuoteRequest): Promise<FastSwapQuote> {
    const sourceAmount = await resolveSourceAmount(request, this.options.chains, this.options.priceFetch);
    if (sourceAmount <= 0n) throw new Error("Invalid source amount");

    const slippageBps = request.slippageBps ?? this.options.defaultSlippageBps ?? 100;
    const quoteReq = {
      sourceChainId: request.sourceChainId,
      sourceToken: request.sourceToken,
      sourceAmount: sourceAmount.toString(),
      destChainId: request.targetChainId,
      destToken: request.targetToken,
      recipient: request.recipient,
      refundAddress: request.refundAddress,
      slippageBps,
      preferredProvider: request.preferredProvider,
    };

    const results = await Promise.allSettled(this.options.clients.map((client) => client.quote(quoteReq)));
    const good = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<IAggregatorClient["quote"]>>> => r.status === "fulfilled")
      .map((r) => r.value);

    if (good.length === 0) {
      const reason = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      throw new Error(reason?.reason instanceof Error ? reason.reason.message : "No aggregator quotes available");
    }

    const ranked = compareQuotesByDestAmount(good);
    const selected =
      (request.preferredProvider && ranked.find((q) => q.provider === request.preferredProvider)) ??
      pickBestQuote(ranked);
    if (!selected) throw new Error("No quote selected");

    const fee = protocolFeeAmount(sourceAmount, this.options.feeBps);

    return {
      quoteId: randomUUID(),
      expiresAt: Date.now() + this.options.quoteTtlMs,
      sourceChainId: request.sourceChainId,
      sourceToken: request.sourceToken,
      sourceAmount: sourceAmount.toString(),
      targetChainId: request.targetChainId,
      targetToken: request.targetToken,
      targetAmount: selected.destAmountOut,
      recipient: request.recipient,
      refundAddress: request.refundAddress,
      feeAmount: fee.toString(),
      slippageBps,
      selectedProvider: selected.provider as AggregatorId,
      sources: ranked.map((q) => ({
        provider: q.provider as AggregatorId,
        destAmountOut: q.destAmountOut,
        sourceAmountIn: q.sourceAmountIn,
        estimatedDurationSec: q.estimatedDurationSec,
        updatedAt: q.updatedAt,
      })),
    };
  }
}

async function resolveSourceAmount(request: FastSwapQuoteRequest, chains?: FastSwapChainConfig[], priceFetch?: PriceFetch): Promise<bigint> {
  if (request.sourceAmount) {
    const parsed = parsePositiveBigInt(request.sourceAmount);
    if (parsed) return parsed;
  }
  const usdMicros = requestUsdMicros(request);
  if (usdMicros) {
    const token = findToken(chains, request.sourceChainId, request.sourceToken);
    const price =
      parsePositiveBigInt(token?.priceUsdMicros) ??
      (await resolveTokenPriceUsdMicros(token, priceFetch));
    const fromUsd = tokenAmountFromUsd(usdMicros, token, price);
    if (fromUsd) return fromUsd;
  }
  throw new Error("sourceAmount or usdAmountMicros required");
}

function tokenAmountFromUsd(
  usdMicros: bigint,
  token: FastSwapTokenConfig | undefined,
  resolvedPriceMicros?: bigint
): bigint | undefined {
  const priceMicros = resolvedPriceMicros ?? parsePositiveBigInt(token?.priceUsdMicros);
  if (!priceMicros || !token) return undefined;
  const scale = 10n ** BigInt(token.decimals);
  return ceilDiv(usdMicros * scale, priceMicros);
}

function requestUsdMicros(request: FastSwapQuoteRequest): bigint | undefined {
  if (request.usdAmountMicros) {
    return parsePositiveBigInt(request.usdAmountMicros);
  }
  if (request.usdPack !== undefined && Number.isInteger(request.usdPack) && request.usdPack > 0) {
    return BigInt(request.usdPack) * 1_000_000n;
  }
  return undefined;
}

function findToken(chains: FastSwapChainConfig[] | undefined, chainId: string, tokenAddress: string): FastSwapTokenConfig | undefined {
  const chain = chains?.find((c) => c.id === chainId);
  if (!chain) return undefined;
  if (isNative(tokenAddress)) return chain.tokens.find((t) => t.isNative);
  return chain.tokens.find((t) => !t.isNative && t.address?.toLowerCase() === tokenAddress.toLowerCase());
}

function isNative(address: string): boolean {
  return !address || address === "native" || address.toLowerCase() === "0x0000000000000000000000000000000000000000";
}

function parsePositiveBigInt(value: string | undefined): bigint | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = BigInt(value);
  return parsed > 0n ? parsed : undefined;
}

function ceilDiv(n: bigint, d: bigint) {
  return (n + d - 1n) / d;
}
