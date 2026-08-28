import { expect } from "chai";
import { loadFastSwapConfig } from "../config/load.js";
import { parseDecimalToRaw, parseUsdToMicros, normalizeFastSwapConfig } from "../config/normalize.js";

describe("FastSwapConfig normalize", function () {
  it("parses human decimal amounts to raw base units", function () {
    expect(parseDecimalToRaw("10", 6)).to.equal("10000000");
    expect(parseDecimalToRaw("0.02", 18)).to.equal("20000000000000000");
    expect(parseUsdToMicros("10")).to.equal("10000000");
    expect(parseUsdToMicros("200")).to.equal("200000000");
  });

  it("normalizes token map and symbol-based liquidity bands from YAML shape", function () {
    const normalized = normalizeFastSwapConfig({
      version: 1,
      "active-chains": ["base"],
      server: {
        host: "0.0.0.0",
        apiPort: 4010,
        sqlitePath: ":memory:",
        auditLogPath: "/tmp/a.jsonl",
        captcha: { provider: "none", siteKey: "", secretKey: "" },
      },
      quote: { feeBps: 75, maxDeviationBps: 100, quoteTtlSec: 900, packsUsd: ["10", "20"] },
      sweepNode: { pollIntervalMs: 1, pageLimit: 1, confirmations: 1, logScanOverlap: 1, sqlitePath: ":memory:" },
      executeNode: { pollIntervalMs: 1 },
      deploy: {
        createx: "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed",
        owner: "0x0",
        salts: { namespace: "fastswap", version: "1" },
        contracts: {
          fastSwapImplementation: "0x1",
          fastSwapAddress: "0x2",
          sweeperAddress: "0x3",
          forwarderImplementation: "0x4",
        },
      },
      nodes: {
        sweep: { auditLogPath: "/tmp/s.jsonl" },
        execute: { progressPath: "/tmp/e.json", auditLogPath: "/tmp/e.jsonl" },
      },
      chains: [
        {
          key: "base",
          id: "8453",
          type: "evm",
          name: "Base",
          explorerUrl: "https://basescan.org",
          tokens: {
            ETH: { decimals: 18, isNative: true },
            USDC: {
              address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              decimals: 6,
              priceUsd: "1",
            },
          },
        },
      ],
    });

    expect(normalized.quote.packsUsdMicros).to.deep.equal(["10000000", "20000000"]);
    expect(normalized.chains[0].tokens.find((t) => t.symbol === "USDC")?.priceUsdMicros).to.equal("1000000");
  });

  it("loads FastSwapConfig.yaml with human-readable amounts", function () {
    const config = loadFastSwapConfig();
    expect(config.quote.packsUsdMicros[0]).to.equal("10000000");
    expect(config.deploy.resolvedSalts?.fastSwapImplementation).to.match(/^0x[0-9a-f]{64}$/);

    const base = config.chains.find((c) => c.key === "base")!;
    const eth = base.tokens.find((t) => t.symbol === "ETH")!;
    expect(eth.isNative).to.equal(true);
  });
});
