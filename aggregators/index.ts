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
  /** When true, include live Providers. Default false (hermetic Local Provider only). */
  live?: boolean;
};

export function createAggregatorClientsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): IAggregatorClient[] {
  const live = env.FASTSWAP_LIVE_PROVIDERS !== "0";
  return createAggregatorClients({
    includeMock: !live,
    rangoApiKey: env.RANGO_API_KEY,
    live,
  });
}

export function createAggregatorClients(options: AggregatorRegistryOptions = {}): IAggregatorClient[] {
  const clients: IAggregatorClient[] = [];
  if (options.includeMock !== false) {
    clients.push(new MockAggregatorClient());
  }
  if (options.live) {
    const rangoKey = options.rangoApiKey ?? process.env.RANGO_API_KEY;
    if (rangoKey) {
      clients.push(createRangoClient({ apiKey: rangoKey }));
    }
    clients.push(createRubicClient(), createSymbiosisClient(), createTransitClient());
  }
  return clients;
}
