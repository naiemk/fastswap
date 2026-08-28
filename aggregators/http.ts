import { AbiCoder, keccak256, toUtf8Bytes } from "ethers";
import type { AggregatorId } from "./types.js";

export function adapterIdBytes(provider: AggregatorId): string {
  return keccak256(toUtf8Bytes(provider));
}

export const ADAPTER_IDS: Record<AggregatorId, string> = {
  rango: adapterIdBytes("rango"),
  rubic: adapterIdBytes("rubic"),
  symbiosis: adapterIdBytes("symbiosis"),
  transit: adapterIdBytes("transit"),
  mock: adapterIdBytes("mock"),
};

export type HttpClientOptions = {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  referrer?: string;
  baseUrl: string;
};

export async function postJson<T>(url: string, body: unknown, fetchImpl: typeof fetch = fetch): Promise<T> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${response.statusText}${text ? `: ${text}` : ""}`);
  }
  return (await response.json()) as T;
}

export async function getJson<T>(url: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${response.statusText}${text ? `: ${text}` : ""}`);
  }
  return (await response.json()) as T;
}

export function toRangoBlockchain(chainId: string): string {
  const map: Record<string, string> = {
    ethereum: "ETH",
    base: "BASE",
    arbitrum: "ARBITRUM",
    bsc: "BSC",
    polygon: "POLYGON",
    tron: "TRON",
    solana: "SOLANA",
    "mainnet-beta": "SOLANA",
    devnet: "SOLANA",
  };
  return map[chainId] ?? chainId.toUpperCase();
}

export function toRangoToken(token: string, chainId: string): string {
  if (!token || token === "native" || token === "0x0000000000000000000000000000000000000000") {
    return `${toRangoBlockchain(chainId)}.--`;
  }
  return `${toRangoBlockchain(chainId)}--${token}`;
}

export function encodeRouterRouteDataSync(router: string, callData: string): string {
  return AbiCoder.defaultAbiCoder().encode(["address", "bytes"], [router, callData]);
}
