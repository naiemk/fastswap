import type { AggregatorQuote } from "./types.js";

/** Rank quotes by destination amount received (descending). */
export function compareQuotesByDestAmount(quotes: AggregatorQuote[]): AggregatorQuote[] {
  return [...quotes].sort((a, b) => {
    const av = BigInt(a.destAmountOut);
    const bv = BigInt(b.destAmountOut);
    if (av === bv) return 0;
    return av > bv ? -1 : 1;
  });
}

export function pickBestQuote(quotes: AggregatorQuote[]): AggregatorQuote | undefined {
  const ranked = compareQuotesByDestAmount(quotes);
  return ranked[0];
}

export function applySlippageFloor(amountOut: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(10_000, slippageBps)));
  return (amountOut * (10_000n - bps)) / 10_000n;
}

export function protocolFeeAmount(amount: bigint, feeBps: bigint): bigint {
  return (amount * feeBps) / 10_000n;
}

export function routeAmountAfterFee(amount: bigint, feeBps: bigint): bigint {
  const fee = protocolFeeAmount(amount, feeBps);
  return amount > fee ? amount - fee : 0n;
}
