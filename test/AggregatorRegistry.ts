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
});
