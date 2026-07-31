import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect } from "chai";

const ROOT = process.cwd();

describe("testnet mirror bootstrap docs", function () {
  it("documents the mirror script, config, and docker stack", function () {
    const doc = readFileSync(join(ROOT, "docs/TESTNET_MIRROR.md"), "utf8");
    const script = join(ROOT, "scripts/testnet-mirror-bootstrap.sh");

    expect(statSync(script).mode & 0o111).to.be.greaterThan(0);
    expect(doc).to.include("testnet-mirror-bootstrap.sh");
    expect(doc).to.include("FastSwapConfig.testnet.yaml");
    expect(doc).to.include("docker:testnet:up");
    expect(doc).to.include("generate:testnet-config");
  });
});
