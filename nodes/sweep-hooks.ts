import { Contract, JsonRpcProvider, getAddress } from "ethers";
import { TronWeb } from "tronweb";

import { FASTSWAP_RECEIVER_ABI } from "../shared/fastswap-abi.js";
import { TRON_FASTSWAP_RECEIVER_ABI } from "../shared/tron-fastswap-abi.js";
import { verifyInvoiceSignature } from "../shared/signing.js";
import {
  normalizeInvoiceId,
  type SweepNodeInvoice,
  type SweepNodeConfig,
  type ChainConfig,
} from "onchain-invoice/sweep-node";

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberLikeField(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function normalizeData(data: string): string {
  return data.startsWith("0x") ? data : `0x${data}`;
}

/** TRON tokens are base58 (`T...`) and must not be passed through ethers `getAddress`. */
function normalizeTokenField(token: string | undefined): string | undefined {
  if (!token) return undefined;
  return token.startsWith("0x") ? getAddress(token) : token;
}

export function createFastSwapParseInvoice(signingSecret: string) {
  return (value: Record<string, unknown>): SweepNodeInvoice | undefined => {
    const invoice = value.invoice && typeof value.invoice === "object"
      ? (value.invoice as Record<string, unknown>)
      : value;
    const chainId = stringField(invoice.chainId) ?? stringField(invoice.chain);
    const invoiceId = stringField(invoice.invoiceId) ?? stringField(invoice.id);
    const invoiceAddress = stringField(invoice.invoiceAddress) ?? stringField(invoice.address);
    const data = stringField(invoice.data) ?? stringField(invoice.encodedInvoiceParams);

    if (!chainId || !invoiceId || !invoiceAddress || !data) return undefined;

    const signed = {
      invoiceId: normalizeInvoiceId(invoiceId),
      data: normalizeData(data),
      recipient: stringField(invoice.recipient) ?? "",
      sourceChainId: stringField(invoice.sourceChainId) ?? chainId,
      targetChainId: stringField(invoice.targetChainId) ?? "",
      sourceToken: normalizeTokenField(stringField(invoice.sourceToken) ?? stringField(invoice.token)) ?? "",
      targetToken: normalizeTokenField(stringField(invoice.targetToken)) ?? "",
      sourceAmount: String(invoice.sourceAmount ?? invoice.amount ?? ""),
      targetAmount: String(invoice.targetAmount ?? ""),
      signature: stringField(invoice.signature),
    };
    if (!verifyInvoiceSignature(signed, signingSecret)) {
      console.warn("[sweep-node] rejected invoice with invalid signature", invoiceId.slice(0, 12));
      return undefined;
    }

    const tok = stringField(invoice.token);
    const targetChainId = stringField(invoice.targetChainId);
    return {
      chainId,
      invoiceId: normalizeInvoiceId(invoiceId),
      invoiceAddress,
      data: normalizeData(data),
      token: normalizeTokenField(tok),
      amount: numberLikeField(invoice.amount),
      minAmount: numberLikeField(invoice.minAmount),
      ...(targetChainId ? { targetChainId } : {}),
    };
  };
}

async function readEvmSwapState(chain: Extract<ChainConfig, { type: "evm" }>, invoiceId: string) {
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const targetContract = new Contract(chain.receiverAddress, FASTSWAP_RECEIVER_ABI, provider);
  const state = await targetContract.swapState(invoiceId);
  return { relayed: Boolean(state.relayed), processed: Boolean(state.processed), queued: Boolean(state.queued) };
}

async function readTronSwapState(chain: Extract<ChainConfig, { type: "tron" }>, invoiceId: string) {
  if (!chain.receiverAddress || chain.sweepMode === "eoa") {
    return { relayed: false, processed: false, queued: false };
  }
  const tronWeb = new TronWeb({ fullHost: chain.fullHost });
  const contract = await tronWeb.contract(TRON_FASTSWAP_RECEIVER_ABI as never, chain.receiverAddress);
  const state = await contract.swapState(invoiceId).call();
  return { relayed: Boolean(state.relayed), processed: Boolean(state.processed), queued: Boolean(state.queued) };
}

export function createFastSwapResolveTrackStatus(chains: ChainConfig[]) {
  return async (inv: SweepNodeInvoice): Promise<string> => {
    const targetId = inv.targetChainId;
    if (!targetId) return "paid";
    const targetChain = chains.find((c) => c.id === targetId);
    if (!targetChain) return "paid";
    try {
      const state = targetChain.type === "tron"
        ? await readTronSwapState(targetChain, inv.invoiceId)
        : await readEvmSwapState(targetChain, inv.invoiceId);
      if (state.processed) return "complete";
      if (state.queued) return "queued";
      if (state.relayed) return "relaying";
      return "paid";
    } catch {
      return "paid";
    }
  };
}

export function attachFastSwapSweepHooks(
  config: SweepNodeConfig,
  signingSecret: string
): SweepNodeConfig {
  return {
    ...config,
    parseInvoice: createFastSwapParseInvoice(signingSecret),
    resolveTrackStatus: createFastSwapResolveTrackStatus(config.chains),
  };
}
