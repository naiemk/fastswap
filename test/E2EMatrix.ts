import { expect } from "chai";
import { E2E_MATRIX } from "../cli/e2e-matrix-cases.js";
import { resolveDefaultEvmTargetKey } from "../cli/testnet-e2e-nodes.js";
import { loadFastSwapConfig } from "../config/load.js";
import { join } from "node:path";

describe("E2E test matrix", function () {
  it("defines T1–T5 for Sepolia + Nile", function () {
    expect(E2E_MATRIX.map((c) => c.id)).to.deep.equal(["T1", "T2", "T3", "T4", "T5"]);

    const keys = new Set(E2E_MATRIX.flatMap((c) => [c.sourceKey, c.targetKey]).filter((k) => k !== "*"));
    for (const key of ["sepolia", "tron"]) {
      expect(keys.has(key), `matrix should reference ${key}`).to.equal(true);
    }
    expect(keys.has("baseSepolia")).to.equal(false);
  });

  it("defaults E2E target to sepolia on go-live config", function () {
    process.env.FASTSWAP_PUBLIC_URL ??= "http://127.0.0.1:4010";
    process.env.TURNSTILE_SITE_KEY ??= "test-site-key";
    process.env.TURNSTILE_SECRET_KEY ??= "test-secret-key";
    const config = loadFastSwapConfig(join(process.cwd(), "FastSwapConfig.testnet.yaml"));
    expect(resolveDefaultEvmTargetKey(config)).to.equal("sepolia");
  });
});
