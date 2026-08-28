import { AbiCoder, getAddress, hexlify, keccak256, toUtf8Bytes, zeroPadValue } from "ethers";
import type { FastSwapChainConfig, FastSwapChainType, FastSwapQuote } from "./types.js";
import { isTronBase58Address, tronAddressToEvmHex, ZERO_ADDRESS } from "./tron-address.js";

export const INTENT_VERSION_V2 = 2n;

export type SwapIntentV2 = {
  version: bigint;
  quoteId: string;
  sourceChainId: bigint;
  sourceToken: string;
  minSourceAmount: bigint;
  destChainId: bigint;
  destToken: string;
  minAmountOut: bigint;
  recipient: string;
  refundTo: string;
  expiresAt: bigint;
  slippageBps: bigint;
};

/** @deprecated v1 inventory intent — kept for reading legacy invoices. */
export type FastSwapIntentV1 = {
  version: bigint;
  quoteId: string;
  sourceChainId: bigint;
  sourceToken: string;
  sourceAmount: bigint;
  targetChainId: bigint;
  targetToken: string;
  targetAmount: bigint;
  recipient: string;
  expiresAt: bigint;
  refundAddress: string;
};

export type FastSwapIntent = SwapIntentV2;

const abi = AbiCoder.defaultAbiCoder();

const INTENT_V2_TYPES = [
  "tuple(uint8 version,bytes32 quoteId,uint256 sourceChainId,bytes sourceToken,uint256 minSourceAmount,uint256 destChainId,bytes destToken,uint256 minAmountOut,bytes recipient,bytes refundTo,uint64 expiresAt,uint16 slippageBps)",
];

const INTENT_V1_TYPES = [
  "tuple(uint8 version,bytes32 quoteId,uint256 sourceChainId,address sourceToken,uint256 sourceAmount,uint256 targetChainId,address targetToken,uint256 targetAmount,address recipient,uint64 expiresAt,address refundAddress)",
];

export function encodeSwapIntent(intent: SwapIntentV2): string {
  return abi.encode(INTENT_V2_TYPES, [intentToTuple(intent)]);
}

/** @deprecated use encodeSwapIntent */
export const encodeFastSwapIntent = encodeSwapIntent;

export function getFastSwapInvoiceId(data: string | Uint8Array): string {
  return keccak256(data);
}

export function decodeSwapIntent(data: string): SwapIntentV2 {
  try {
    const decoded = abi.decode(INTENT_V2_TYPES, data)[0] as Record<string, unknown>;
    if (BigInt(decoded.version as number) === INTENT_VERSION_V2) {
      return tupleToIntent(decoded);
    }
  } catch {
    // fall through to v1
  }
  return migrateV1ToV2(decodeSwapIntentV1(data));
}

function decodeSwapIntentV1(data: string): FastSwapIntentV1 {
  const decoded = abi.decode(INTENT_V1_TYPES, data)[0] as Record<string, unknown>;
  return {
    version: BigInt(decoded.version as number),
    quoteId: normalizeBytes32(String(decoded.quoteId)),
    sourceChainId: BigInt(decoded.sourceChainId as bigint),
    sourceToken: decoded.sourceToken as string,
    sourceAmount: BigInt(decoded.sourceAmount as bigint),
    targetChainId: BigInt(decoded.targetChainId as bigint),
    targetToken: decoded.targetToken as string,
    targetAmount: BigInt(decoded.targetAmount as bigint),
    recipient: decoded.recipient as string,
    expiresAt: BigInt(decoded.expiresAt as bigint),
    refundAddress: decoded.refundAddress as string,
  };
}

function migrateV1ToV2(v1: FastSwapIntentV1): SwapIntentV2 {
  return {
    version: INTENT_VERSION_V2,
    quoteId: v1.quoteId,
    sourceChainId: v1.sourceChainId,
    sourceToken: addressToBytes(v1.sourceToken),
    minSourceAmount: v1.sourceAmount,
    destChainId: v1.targetChainId,
    destToken: addressToBytes(v1.targetToken),
    minAmountOut: v1.targetAmount,
    recipient: addressToBytes(v1.recipient),
    refundTo: addressToBytes(v1.refundAddress),
    expiresAt: v1.expiresAt,
    slippageBps: 100n,
  };
}

export function quoteToIntent(quote: FastSwapQuote, chains: FastSwapChainConfig[]): SwapIntentV2 {
  const chainIds = chainNumericIds(chains);
  const sourceType = chainTypeFor(chains, quote.sourceChainId);
  const targetType = chainTypeFor(chains, quote.targetChainId);
  const refundRaw =
    "refundAddress" in quote && (quote as { refundAddress?: string }).refundAddress
      ? String((quote as { refundAddress?: string }).refundAddress)
      : quote.recipient;
  return {
    version: INTENT_VERSION_V2,
    quoteId: normalizeBytes32(quote.quoteId),
    sourceChainId: chainIds[quote.sourceChainId] ?? BigInt(quote.sourceChainId),
    sourceToken: tokenToBytes(quote.sourceToken, sourceType),
    minSourceAmount: BigInt(quote.sourceAmount),
    destChainId: chainIds[quote.targetChainId] ?? BigInt(quote.targetChainId),
    destToken: tokenToBytes(quote.targetToken, targetType),
    minAmountOut: BigInt(quote.targetAmount),
    recipient: recipientToBytes(quote.recipient, targetType),
    refundTo: refundRaw ? recipientToBytes(refundRaw, sourceType) : "0x",
    expiresAt: BigInt(Math.floor(quote.expiresAt / 1000)),
    slippageBps: BigInt(quote.slippageBps ?? 100),
  };
}

export function quoteIdFromString(value: string): string {
  return keccak256(toUtf8Bytes(value));
}

export function chainNumericIds(chains: FastSwapChainConfig[]): Record<string, bigint> {
  const result: Record<string, bigint> = {};
  for (let i = 0; i < chains.length; i++) {
    const id = chains[i].id;
    if (id === "tron") result[id] = 728126428n;
    else if (id === "mainnet-beta" || id === "solana") result[id] = 900n;
    else if (id === "devnet") result[id] = 901n;
    else result[id] = /^\d+$/.test(id) ? BigInt(id) : BigInt(i + 1);
  }
  return result;
}

function chainTypeFor(chains: FastSwapChainConfig[], chainId: string): FastSwapChainType | "solana" {
  return chains.find((chain) => chain.id === chainId)?.type ?? "evm";
}

function normalizeBytes32(value: string): string {
  return value.startsWith("0x") && value.length === 66 ? value : keccak256(toUtf8Bytes(value));
}

function addressToBytes(address: string): string {
  if (!address || address === ZERO_ADDRESS) return "0x";
  return hexlify(zeroPadValue(getAddress(address), 20));
}

function tokenToBytes(value: string | undefined, chainType: FastSwapChainType | "solana"): string {
  if (!value || value === "native" || value === ZERO_ADDRESS) return "0x";
  if (chainType === "solana") {
    return value.startsWith("0x") ? value : hexlify(toUtf8Bytes(value));
  }
  if (chainType === "tron" && isTronBase58Address(value)) {
    return hexlify(zeroPadValue(tronAddressToEvmHex(value), 20));
  }
  return addressToBytes(value);
}

function recipientToBytes(value: string, chainType: FastSwapChainType | "solana"): string {
  if (!value) return "0x";
  if (chainType === "solana") {
    return value.startsWith("0x") ? value : hexlify(toUtf8Bytes(value));
  }
  if (chainType === "tron" && isTronBase58Address(value)) {
    return hexlify(zeroPadValue(tronAddressToEvmHex(value), 20));
  }
  return addressToBytes(value);
}

function intentToTuple(intent: SwapIntentV2) {
  return {
    version: Number(intent.version),
    quoteId: intent.quoteId,
    sourceChainId: intent.sourceChainId,
    sourceToken: intent.sourceToken,
    minSourceAmount: intent.minSourceAmount,
    destChainId: intent.destChainId,
    destToken: intent.destToken,
    minAmountOut: intent.minAmountOut,
    recipient: intent.recipient,
    refundTo: intent.refundTo,
    expiresAt: intent.expiresAt,
    slippageBps: intent.slippageBps,
  };
}

function tupleToIntent(decoded: Record<string, unknown>): SwapIntentV2 {
  return {
    version: BigInt(decoded.version as number),
    quoteId: normalizeBytes32(String(decoded.quoteId)),
    sourceChainId: BigInt(decoded.sourceChainId as bigint),
    sourceToken: decoded.sourceToken as string,
    minSourceAmount: BigInt(decoded.minSourceAmount as bigint),
    destChainId: BigInt(decoded.destChainId as bigint),
    destToken: decoded.destToken as string,
    minAmountOut: BigInt(decoded.minAmountOut as bigint),
    recipient: decoded.recipient as string,
    refundTo: decoded.refundTo as string,
    expiresAt: BigInt(decoded.expiresAt as bigint),
    slippageBps: BigInt(decoded.slippageBps as number),
  };
}

/** Decode legacy v1 intent if needed. */
export const decodeFastSwapIntent = decodeSwapIntent;
