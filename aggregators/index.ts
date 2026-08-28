import { createRangoClient } from "./rango/client.js";
import { createRubicClient } from "./rubic/client.js";
import { createSymbiosisClient } from "./symbiosis/client.js";
import { createTransitClient } from "./transit/client.js";
import type { IAggregatorClient } from "./IAggregatorClient.js";
import { MockAggregatorClient } from "./mock/client.js";

export * from "./types.js";
export * from "./compare.js";
export * from "./http.js";
export * from "./IAggregatorClient.js";
export { MockAggregatorClient } from "./mock/client.js";
export { createRangoClient } from "./rango/client.js";
export { createRubicClient } from "./rubic/client.js";
export { createSymbiosisClient } from "./symbiosis/client.js";
export { createTransitClient } from "./transit/client.js";

export type AggregatorRegistryOptions = {
  includeMock?: boolean;
  rangoApiKey?: string;
};

export function createAggregatorClients(options: AggregatorRegistryOptions = {}): IAggregatorClient[] {
  const clients: IAggregatorClient[] = [];
  if (options.includeMock !== false) {
    clients.push(new MockAggregatorClient());
  }
  const rangoKey = options.rangoApiKey ?? process.env.RANGO_API_KEY;
  if (rangoKey) {
    clients.push(createRangoClient({ apiKey: rangoKey }));
  }
  clients.push(createRubicClient(), createSymbiosisClient(), createTransitClient());
  return clients;
}
