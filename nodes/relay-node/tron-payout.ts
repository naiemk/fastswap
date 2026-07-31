import { TronWeb } from "tronweb";
import { decodeFastSwapIntent } from "../../shared/encoding.js";
import { evmHexToTronBase58, isZeroEvmAddress } from "../../shared/tron-address.js";
import type { FastSwapInvoice } from "../../shared/types.js";

import { OpenOceanRouteProvider } from "../../LiquidityManager/bot/price.js";
import type { ChainConfig } from "../../LiquidityManager/shared/types.js";
import {
  isNativeTronToken,
  sponsorTronWeb,
  transferTrc20FromNodeWallet,
  transferTrxFromNodeWallet,
  TRON_NATIVE_TOKEN,
  type TronSponsorConfig,
} from "onchain-invoice";

export type TronPayoutChain = {
  id: string;
  fullHost: string;
  privateKey: string;
  feeLimit?: number;
  sponsorAddress?: string;
  router?: string;
  aggregatorSlug?: string;
  nativeSentinel?: string;
  tokens: Array<{ symbol: string; address?: string; decimals: number; isNative?: boolean }>;
};

export type TronPayoutResult = {
  txHash: string;
  swapped: boolean;
  token: string;
  amount: bigint;
};

export async function payoutFromNodeWallet(
  chain: TronPayoutChain,
  invoice: FastSwapInvoice
): Promise<TronPayoutResult> {
  const intent = decodeFastSwapIntent(invoice.data);
  const recipient = resolveTronRecipient(intent.recipient);
  const targetToken = resolveTargetToken(chain, intent.targetToken);
  const targetAmount = intent.targetAmount;

  const sponsorConfig: TronSponsorConfig = {
    fullHost: chain.fullHost,
    sponsorPrivateKey: chain.privateKey,
    feeLimit: chain.feeLimit,
  };
  const tronWeb = sponsorTronWeb(sponsorConfig);
  const nodeWallet = chain.sponsorAddress ?? (tronWeb.defaultAddress.base58 as string);

  const walletBalance = await readWalletBalance(tronWeb, nodeWallet, targetToken);
  if (walletBalance >= targetAmount) {
    const txHash = await sendToken(sponsorConfig, targetToken, recipient, targetAmount);
    return { txHash, swapped: false, token: targetToken, amount: targetAmount };
  }

  const sourceToken = resolveTargetToken(chain, intent.sourceToken);
  const sourceBalance = await readWalletBalance(tronWeb, nodeWallet, sourceToken);
  if (sourceBalance === 0n) {
    throw new Error("Node wallet has insufficient balance for payout");
  }

  const route = await quoteSwap(chain, sourceToken, targetToken, sourceBalance);
  const swapTx = await executeOpenOceanSwap(sponsorConfig, route, sourceBalance);
  void swapTx;

  const afterBalance = await readWalletBalance(tronWeb, nodeWallet, targetToken);
  const payoutAmount = afterBalance >= targetAmount ? targetAmount : afterBalance;
  if (payoutAmount === 0n) throw new Error("Swap did not yield enough target token for payout");

  const txHash = await sendToken(sponsorConfig, targetToken, recipient, payoutAmount);
  return { txHash, swapped: true, token: targetToken, amount: payoutAmount };
}

async function readWalletBalance(tronWeb: TronWeb, wallet: string, token: string): Promise<bigint> {
  if (isNativeTronToken(tronWeb, token)) {
    return BigInt(await tronWeb.trx.getBalance(wallet));
  }
  const trc20 = tronWeb.contract(
    [{ type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as never,
    token
  );
  return BigInt((await trc20.balanceOf(wallet).call()).toString());
}

async function sendToken(config: TronSponsorConfig, token: string, to: string, amount: bigint): Promise<string> {
  const tronWeb = sponsorTronWeb(config);
  if (isNativeTronToken(tronWeb, token)) {
    return transferTrxFromNodeWallet(config, to, amount);
  }
  return transferTrc20FromNodeWallet(config, token, to, amount);
}

function resolveTronRecipient(recipient: string): string {
  if (recipient.startsWith("T")) return recipient;
  if (isZeroEvmAddress(recipient)) throw new Error("Invalid TRON recipient");
  return evmHexToTronBase58(recipient);
}

function resolveTargetToken(chain: TronPayoutChain, slot: string): string {
  if (slot.startsWith("T")) return slot;
  if (isZeroEvmAddress(slot)) return TRON_NATIVE_TOKEN;
  const body = slot.replace(/^0x/i, "").slice(-40);
  const base58 = evmHexToTronBase58(`0x${body}`);
  const known = chain.tokens.find((t) => t.address && t.address.toLowerCase() === base58.toLowerCase());
  return known?.address ?? (known?.isNative ? TRON_NATIVE_TOKEN : base58);
}

async function quoteSwap(chain: TronPayoutChain, tokenIn: string, tokenOut: string, amountIn: bigint) {
  const lmChain: ChainConfig = {
    key: "tron",
    id: chain.id,
    type: "tron",
    nativeSymbol: "TRX",
    fullHost: chain.fullHost,
    liquidityManager: chain.sponsorAddress ?? "",
    reserveStable: { symbol: "USDT", address: chain.tokens.find((t) => t.symbol === "USDT")?.address ?? "", decimals: 6 },
    router: chain.router ?? "",
    aggregatorSlug: chain.aggregatorSlug ?? "tron",
    nativeSentinel: chain.nativeSentinel,
    receivers: [],
    explorerUrl: "",
  };
  const routes = new OpenOceanRouteProvider();
  return routes.quote({ chain: lmChain, tokenIn, tokenOut, amountIn, slippageBps: 100 });
}

async function executeOpenOceanSwap(
  config: TronSponsorConfig,
  route: { router: string; data: string },
  amountIn: bigint
): Promise<string> {
  const tronWeb = sponsorTronWeb(config);
  const parameter = [{ type: "address", value: route.router }, { type: "bytes", value: route.data }];
  const tx = await tronWeb.transactionBuilder.triggerSmartContract(
    route.router,
    "swap(address,bytes)",
    { feeLimit: config.feeLimit ?? 150_000_000, callValue: 0 },
    parameter,
    tronWeb.defaultAddress.hex as string
  );
  const signed = await tronWeb.trx.sign(tx.transaction);
  const result = await tronWeb.trx.sendRawTransaction(signed);
  if (!result.result) throw new Error(`OpenOcean swap failed: ${JSON.stringify(result)}`);
  return result.txid ?? result.transaction?.txID ?? "";
}
