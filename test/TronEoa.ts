import { expect } from "chai";
import { keccak256, toUtf8Bytes } from "ethers";
import { encodeFastSwapIntent, quoteToIntent } from "../shared/encoding.js";
import type { FastSwapQuote } from "../shared/types.js";
import {
  deriveTronInvoiceAddress,
  deriveTronInvoicePrivateKey,
  hashTronInvoiceMasterSecret,
  getTronInvoiceId,
} from "onchain-invoice";
import {
  planTronSweepBatch,
  estimateInvoiceUsdValue,
  type TronChainConfig,
} from "onchain-invoice/sweep-node";

describe("TRON EOA invoice derivation", () => {
  const master = "test-master-secret";
  const chainId = "3448148188";
  const data = encodeFastSwapIntent({
    version: 1n,
    quoteId: keccak256(toUtf8Bytes("q1")),
    sourceChainId: BigInt(chainId),
    sourceToken: "0x0000000000000000000000000000000000000000",
    sourceAmount: 1_000_000n,
    targetChainId: 11155111n,
    targetToken: "0x0000000000000000000000000000000000000000",
    targetAmount: 2_000_000n,
    recipient: "0x0000000000000000000000000000000000000001",
    expiresAt: 9_999_999_999n,
    refundAddress: "0x0000000000000000000000000000000000000002",
  });
  const invoiceId = getTronInvoiceId(data);

  it("derives stable private keys and addresses from master secret + chain + invoiceId", () => {
    const pk1 = deriveTronInvoicePrivateKey(master, chainId, invoiceId);
    const pk2 = deriveTronInvoicePrivateKey(master, chainId, invoiceId);
    expect(pk1).to.equal(pk2);
    expect(pk1).to.match(/^[0-9a-f]{64}$/);

    const addr1 = deriveTronInvoiceAddress(master, chainId, invoiceId);
    const addr2 = deriveTronInvoiceAddress(master, chainId, invoiceId);
    expect(addr1).to.equal(addr2);
    expect(addr1.startsWith("T")).to.equal(true);
  });

  it("changes address when invoiceId changes", () => {
    const otherId = keccak256(toUtf8Bytes("other"));
    const a = deriveTronInvoiceAddress(master, chainId, invoiceId);
    const b = deriveTronInvoiceAddress(master, chainId, otherId);
    expect(a).to.not.equal(b);
  });

  it("matches invoiceId from encoded FastSwap intent", () => {
    const quote: FastSwapQuote = {
      quoteId: keccak256(toUtf8Bytes("quote-a")),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      sourceChainId: chainId,
      sourceToken: "native",
      sourceAmount: "1000000",
      targetChainId: "11155111",
      targetToken: "native",
      targetAmount: "2000000",
      recipient: "0x0000000000000000000000000000000000000001",
      feeAmount: "0",
      rate: "1",
      sources: [],
    };
    const intent = quoteToIntent(quote, [
      { id: chainId, type: "tron", name: "Nile", nativeSymbol: "TRX", sweeperAddress: "", fastSwapAddress: "", explorerUrl: "", tokens: [] },
      { id: "11155111", type: "evm", name: "Sepolia", nativeSymbol: "ETH", sweeperAddress: "0x1", fastSwapAddress: "0x2", explorerUrl: "", tokens: [] },
    ]);
    const encoded = encodeFastSwapIntent(intent);
    expect(getTronInvoiceId(encoded)).to.equal(keccak256(encoded));
  });

  it("hashes master secret to bytes32", () => {
    expect(hashTronInvoiceMasterSecret(master)).to.match(/^0x[0-9a-f]{64}$/);
  });
});

describe("TRON batch sweep planner", () => {
  it("waits when invoices have no on-chain balance", async () => {
    const chain: TronChainConfig = {
      id: "3448148188",
      type: "tron",
      fullHost: "https://api.nileex.io",
      privateKey: "c87509a1c067bbde78beb793e6fa76544b2e41ee18e6079290739af0503d2f9",
      invoiceMasterSecret: "master",
      sweepMode: "eoa",
      batchSweepThresholdUsd: 1000,
      minDelegateEnergy: 65_000,
      tokens: [{ symbol: "TRX", decimals: 6, priceUsd: 0.3, isNative: true }],
    };
    const invoices = [
      {
        chainId: chain.id,
        invoiceId: keccak256(toUtf8Bytes("inv1")),
        invoiceAddress: deriveTronInvoiceAddress("master", chain.id, keccak256(toUtf8Bytes("inv1"))),
        data: "0x" + "11".repeat(32),
        token: "native",
        minAmount: "1",
      },
    ];

    const plan = await planTronSweepBatch({
      chain,
      invoices,
      tokenPricesUsd: { TRX: 0.3 },
      tokenDecimals: { TRX: 6 },
    });

    expect(plan.action).to.equal("wait");
    if (plan.action === "wait") {
      expect(plan.reason).to.match(/no funded|threshold/);
    }
  });

  it("estimates USD notionals for threshold gating", () => {
    expect(estimateInvoiceUsdValue(1_000_000n, 6, 0.3)).to.be.closeTo(0.3, 0.001);
    expect(estimateInvoiceUsdValue(10_000_000n, 6, 1)).to.equal(10);
  });
});
