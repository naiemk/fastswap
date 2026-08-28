import { expect } from "chai";
import { MockAggregatorClient } from "../aggregators/mock/client.js";
import { QuoteEngine } from "../server/quote-engine.js";
import type { FastSwapChainConfig } from "../shared/types.js";

describe("QuoteEngine (aggregators)", function () {
  const chains: FastSwapChainConfig[] = [
    {
      id: "base",
      type: "evm",
      name: "Base",
      nativeSymbol: "ETH",
      sweeperAddress: "0x1",
      fastSwapAddress: "0x2",
      explorerUrl: "https://basescan.org",
      tokens: [{ symbol: "ETH", chainId: "base", decimals: 18, isNative: true }],
    },
    {
      id: "arbitrum",
      type: "evm",
      name: "Arbitrum",
      nativeSymbol: "ETH",
      sweeperAddress: "0x1",
      fastSwapAddress: "0x2",
      explorerUrl: "https://arbiscan.io",
      tokens: [{ symbol: "ETH", chainId: "arbitrum", decimals: 18, isNative: true }],
    },
  ];

  it("ranks aggregator quotes by dest amount and selects best", async function () {
    const engine = new QuoteEngine({
      clients: [new MockAggregatorClient(9900n), new MockAggregatorClient(9950n)],
      feeBps: 75n,
      quoteTtlMs: 30_000,
      chains,
    });

    const quote = await engine.quote({
      sourceChainId: "base",
      sourceToken: "native",
      targetChainId: "arbitrum",
      targetToken: "native",
      recipient: "0x0000000000000000000000000000000000000001",
      sourceAmount: "1000000000000000000",
    });

    expect(quote.selectedProvider).to.equal("mock");
    expect(BigInt(quote.targetAmount)).to.equal(977_662_125_000_000_000n);
    expect(quote.sources.length).to.be.gte(2);
  });
});
