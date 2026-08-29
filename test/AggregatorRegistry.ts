import { expect } from "chai";
import { createAggregatorClients, createAggregatorClientsFromEnv } from "../aggregators/index.js";

describe("createAggregatorClients", function () {
  it("hermetic registry is Local Provider only", function () {
    const ids = createAggregatorClients().map((client) => client.id);
    expect(ids).to.deep.equal(["mock"]);
  });

  it("hermetic registry ignores a Rango key", function () {
    const ids = createAggregatorClients({ rangoApiKey: "test-key" }).map((client) => client.id);
    expect(ids).to.deep.equal(["mock"]);
  });

  it("live registry includes live Providers", function () {
    const ids = createAggregatorClients({ live: true, includeMock: false }).map((client) => client.id);
    expect(ids).to.deep.equal(["rubic", "symbiosis", "transit"]);
  });

  it("FASTSWAP_LIVE_PROVIDERS=0 selects Local Provider only", function () {
    const ids = createAggregatorClientsFromEnv({ FASTSWAP_LIVE_PROVIDERS: "0" }).map((client) => client.id);
    expect(ids).to.deep.equal(["mock"]);
  });

  it("unset FASTSWAP_LIVE_PROVIDERS includes live Providers only", function () {
    const ids = createAggregatorClientsFromEnv({}).map((client) => client.id);
    expect(ids).to.not.include("mock");
    expect(ids).to.include.members(["rubic", "symbiosis", "transit"]);
  });

  it("Local Provider buildExecution targets the configured source-chain Router", async function () {
    const router = "0x0000000000000000000000000000000000000123";
    const [client] = createAggregatorClients({ mockRouters: { "101": router } });
    const request = {
      sourceChainId: "101",
      sourceToken: "0x0000000000000000000000000000000000000000",
      sourceAmount: "1000",
      destChainId: "202",
      destToken: "0x0000000000000000000000000000000000000000",
      recipient: "0x0000000000000000000000000000000000000001",
    };
    const quote = await client.quote(request);
    const plan = await client.buildExecution(request, quote, {
      fromAddress: "0x0000000000000000000000000000000000000002",
      actualSourceAmount: "1000",
      slippageBps: 100,
    });
    expect(plan.kind).to.equal("evm-contract");
    if (plan.kind !== "evm-contract") return;
    expect(plan.router).to.equal(router);
  });
});
