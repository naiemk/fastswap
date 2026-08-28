import { expect } from "chai";
import { join } from "node:path";
import { loadFastSwapConfig } from "../config/load.js";
import { checkLiquidityBandSanity } from "../cli/deploy-readiness.js";
import type { ReadinessIssue } from "../cli/deploy-readiness.js";

function collectIssues(
  chainKey: string,
  symbol: string,
  band: { floor: string; target: string; ceiling: string; isStable?: boolean; decimals?: number }
): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  checkLiquidityBandSanity(chainKey, symbol, band, issues);
  return issues;
}

describe("deploy readiness guardrails", function () {
  it("loads testnet config with execute node settings", function () {
    const config = loadFastSwapConfig(join(process.cwd(), "FastSwapConfig.testnet.yaml"));
    expect(config["active-chains"]).to.have.length(2);
    expect(config.executeNode?.pollIntervalMs).to.be.a("number");
    expect(config.nodes.execute?.progressPath).to.match(/execute-progress/);
  });

  it("flags corrupt and mis-ordered bands", function () {
    const corrupt = collectIssues("sepolia", "ETH", {
      floor: (10n ** 36n).toString(),
      target: (10n ** 36n).toString(),
      ceiling: (10n ** 36n).toString(),
    });
    expect(corrupt.some((i) => i.message.includes("corrupt"))).to.equal(true);

    const misordered = collectIssues("base", "ETH", {
      floor: "100",
      target: "50",
      ceiling: "200",
    });
    expect(misordered.some((i) => i.message.includes("ordering invalid"))).to.equal(true);
  });
});
