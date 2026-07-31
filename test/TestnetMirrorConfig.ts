import { expect } from "chai";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadFastSwapConfig, isTronEoaChain } from "../config/load.js";

const ROOT = join(process.cwd());
const TESTNET_PATH = join(ROOT, "FastSwapConfig.testnet.yaml");

describe("FastSwapConfig testnet mirror", function () {
  it("loads Sepolia + Nile go-live config with real prices and captcha", function () {
    process.env.FASTSWAP_PUBLIC_URL ??= "http://127.0.0.1:4010";
    process.env.TURNSTILE_SITE_KEY ??= "test-site-key";
    process.env.TURNSTILE_SECRET_KEY ??= "test-secret-key";
    process.env.SEPOLIA_RPC_URL ??= "https://example.invalid";
    process.env.NILE_FULL_HOST ??= "https://nile.trongrid.io";
    process.env.SEPOLIA_ROUTER_ADDRESS ??= "0x0000000000000000000000000000000000000001";
    process.env.TRON_ROUTER_ADDRESS ??= "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
    process.env.FASTSWAP_OWNER_ADDRESS ??= "0x0000000000000000000000000000000000000002";

    const config = loadFastSwapConfig(TESTNET_PATH);

    expect(config["active-chains"]).to.deep.equal(["sepolia", "tron"]);
    expect(config.quote.feeBps).to.equal(75);
    expect(config.deploy.salts.namespace).to.equal("fastswap-testnet");
    expect(config.server.captcha.requireForQuotes).to.equal(true);
    expect(config.server.captcha.requireForInvoices).to.equal(true);
    expect(config.server.captcha.siteKey).to.equal("test-site-key");

    const tron = config.chains.find((c) => c.key === "tron")!;
    expect(isTronEoaChain(tron)).to.equal(true);
    expect(tron.sweep?.mode).to.equal("eoa");
    expect(tron.tokens.find((t) => t.symbol === "USDT")?.address).to.equal(
      "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"
    );

    const sepolia = config.chains.find((c) => c.key === "sepolia")!;
    const eth = sepolia.tokens.find((t) => t.symbol === "ETH")!;
    expect(eth.priceSources?.some((s) => s.type === "coingecko")).to.equal(true);
    expect(eth.priceSources?.some((s) => s.type === "binance")).to.equal(true);
    expect(eth.priceSources?.some((s) => s.type === "static")).to.equal(false);

    const trx = tron.tokens.find((t) => t.symbol === "TRX")!;
    expect(trx.priceSources?.some((s) => s.type === "coingecko")).to.equal(true);
    expect(trx.priceSources?.some((s) => s.type === "static")).to.equal(false);
  });

  it("keeps env placeholders quoted in generated YAML", function () {
    const raw = readFileSync(TESTNET_PATH, "utf8");
    expect(raw).to.include('owner: "${FASTSWAP_OWNER_ADDRESS}"');
    expect(raw).to.include('rpcUrl: "${SEPOLIA_RPC_URL}"');
    expect(raw).to.include('siteKey: "${TURNSTILE_SITE_KEY}"');
    expect(raw).to.not.include("owner: ${FASTSWAP_OWNER_ADDRESS}\n");
  });

  it("scales quote packs from prod", function () {
    const prod = loadFastSwapConfig(join(ROOT, "FastSwapConfig.yaml"));
    process.env.FASTSWAP_PUBLIC_URL ??= "http://127.0.0.1:4010";
    process.env.TURNSTILE_SITE_KEY ??= "test-site-key";
    process.env.TURNSTILE_SECRET_KEY ??= "test-secret-key";
    const testnet = loadFastSwapConfig(TESTNET_PATH);
    expect(testnet.quote.packsUsdMicros.length).to.equal(prod.quote.packsUsdMicros.length);
    expect(Number(testnet.quote.packsUsdMicros[0])).to.be.lessThan(Number(prod.quote.packsUsdMicros[0]));
  });
});
