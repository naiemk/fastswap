import { Contract, JsonRpcProvider } from "ethers";
import { TronWeb } from "tronweb";

import { TRON_FASTSWAP_RECEIVER_ABI } from "../../shared/tron-fastswap-abi.js";

import { FASTSWAP_RECEIVER_ABI } from "../../shared/fastswap-abi.js";
import type { FastSwapLiquiditySummary } from "../../shared/types.js";
import {
  ERC20_ABI,
  NATIVE_TOKEN,
  TRC20_ABI,
  TRON_NATIVE_TOKEN,
  readTronTokenBalance,
} from "onchain-invoice";

export type LiquidityMonitorChain = {
  id: string;
  type?: "evm" | "tron";
  rpcUrl?: string;
  /** TRON HTTP endpoint (TronWeb fullHost). Falls back to rpcUrl. */
  fullHost?: string;
  fastSwapAddress: string;
  /** TRON EOA mode: read node wallet balances without receiver contract floors. */
  nodeWalletMode?: boolean;
  tokens: Array<{ symbol: string; address?: string; minLiquidity: string; floor?: string }>;
  explorerUrl?: string;
};

export async function collectLiquidity(chain: LiquidityMonitorChain): Promise<FastSwapLiquiditySummary[]> {
  if (chain.type === "tron" && chain.nodeWalletMode) return collectTronNodeWalletLiquidity(chain);
  return chain.type === "tron" ? collectTronLiquidity(chain) : collectEvmLiquidity(chain);
}

async function collectEvmLiquidity(chain: LiquidityMonitorChain): Promise<FastSwapLiquiditySummary[]> {
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const fastSwap = new Contract(chain.fastSwapAddress, FASTSWAP_RECEIVER_ABI, provider);
  const summaries: FastSwapLiquiditySummary[] = [];

  for (const token of chain.tokens) {
    const tokenAddress = token.address ?? NATIVE_TOKEN;
    const balance = token.address
      ? await new Contract(token.address, ERC20_ABI, provider).balanceOf(chain.fastSwapAddress)
      : await provider.getBalance(chain.fastSwapAddress);
    const reserved = await fastSwap.liquidityFloor(tokenAddress);
    const minLiquidity = BigInt(token.minLiquidity);

    summaries.push({
      chainId: chain.id,
      token: token.symbol,
      balance: balance.toString(),
      reserved: reserved.toString(),
      queuedAmount: "0",
      lowLiquidity: BigInt(balance.toString()) < minLiquidity,
    });
  }

  return summaries;
}

async function collectTronLiquidity(chain: LiquidityMonitorChain): Promise<FastSwapLiquiditySummary[]> {
  const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl ?? "" });
  const fastSwap = await tronWeb.contract(TRON_FASTSWAP_RECEIVER_ABI as never, chain.fastSwapAddress);
  const summaries: FastSwapLiquiditySummary[] = [];

  for (const token of chain.tokens) {
    const isNative = !token.address;
    const balance = isNative
      ? BigInt(await tronWeb.trx.getBalance(chain.fastSwapAddress))
      : await readTronTokenBalance(tronWeb, chain.fastSwapAddress, token.address!);
    const floorToken = token.address ?? TRON_NATIVE_TOKEN;
    const reserved = BigInt((await fastSwap.liquidityFloor(floorToken).call()).toString());
    const minLiquidity = BigInt(token.minLiquidity);

    summaries.push({
      chainId: chain.id,
      token: token.symbol,
      balance: balance.toString(),
      reserved: reserved.toString(),
      queuedAmount: "0",
      lowLiquidity: balance < minLiquidity,
    });
  }

  return summaries;
}

async function collectTronNodeWalletLiquidity(chain: LiquidityMonitorChain): Promise<FastSwapLiquiditySummary[]> {
  const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl ?? "" });
  const wallet = chain.fastSwapAddress;
  const summaries: FastSwapLiquiditySummary[] = [];

  for (const token of chain.tokens) {
    const isNative = !token.address;
    const balance = isNative
      ? BigInt(await tronWeb.trx.getBalance(wallet))
      : await readTronTokenBalance(tronWeb, wallet, token.address!);
    const reserved = token.floor ? BigInt(token.floor) : 0n;
    const minLiquidity = BigInt(token.minLiquidity);

    summaries.push({
      chainId: chain.id,
      token: token.symbol,
      balance: balance.toString(),
      reserved: reserved.toString(),
      queuedAmount: "0",
      lowLiquidity: balance < minLiquidity,
    });
  }

  return summaries;
}
