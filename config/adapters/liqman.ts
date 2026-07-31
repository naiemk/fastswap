import type { LiquidityManagerConfig, ChainConfig, ManagedReceiver, TokenBand } from "../../LiquidityManager/shared/types.js";
import type { FastSwapConfigFile, FastSwapChainDefinition } from "../types.js";
import { getActiveChainDefinitions, isTronEoaChain, resolveChainContracts, resolveTronSweepSettings } from "../load.js";
import { TronWeb } from "tronweb";

export function toLiquidityManagerConfig(config: FastSwapConfigFile): LiquidityManagerConfig {
  const chains = getActiveChainDefinitions(config)
    .filter((chain) => chain.liquidity)
    .map((chain) => toLiqManChain(config, chain));

  if (chains.length === 0) throw new Error("No active chains with liquidity config");

  return {
    chains,
    economics: { ...config.liquidityManager.economics },
    pollIntervalMs: config.liquidityManager.pollIntervalMs,
    sqlitePath: config.liquidityManager.sqlitePath,
  };
}

function toLiqManChain(config: FastSwapConfigFile, chain: FastSwapChainDefinition): ChainConfig {
  const liquidity = chain.liquidity!;
  const contracts = resolveChainContracts(config, chain);
  const eoa = chain.type === "tron" && isTronEoaChain(chain);
  if (!chain.router) throw new Error(`${chain.key}: router required`);

  let nodeWalletAddress: string | undefined;
  if (eoa) {
    const sweep = resolveTronSweepSettings(chain);
    if (sweep.sponsorAddress?.startsWith("T")) {
      nodeWalletAddress = sweep.sponsorAddress;
    } else {
      const pk = process.env.LM_PRIVATE_KEY ?? process.env.SWEEP_TRON_PRIVATE_KEY ?? process.env.TRON_PRIVATE_KEY;
      if (!pk) throw new Error(`${chain.key}: missing LM_PRIVATE_KEY for TRON EOA node wallet`);
      nodeWalletAddress = new TronWeb({
        fullHost: chain.fullHost ?? chain.rpcUrl ?? "",
        privateKey: pk.replace(/^0x/, ""),
      }).defaultAddress.base58 as string;
    }
  }

  if (!eoa && !contracts.liquidityManagerAddress) {
    throw new Error(`${chain.key}: liquidityManagerAddress required`);
  }

  const walletOrReceiver = eoa ? nodeWalletAddress! : contracts.fastSwapAddress;
  const receivers: ManagedReceiver[] = liquidity.receivers.map((receiver) => ({
    address: receiver.address ?? walletOrReceiver,
    tokens: receiver.tokens.map(
      (token): TokenBand => ({
        symbol: token.symbol,
        address: token.address,
        decimals: token.decimals,
        isStable: token.isStable,
        floor: token.floor,
        target: token.target,
        ceiling: token.ceiling,
      })
    ),
  }));

  const stableSymbol =
    typeof liquidity.reserveStable === "string" ? liquidity.reserveStable : liquidity.reserveStable.symbol;
  const stableToken = chain.tokens.find((t) => t.symbol === stableSymbol);
  if (!stableToken?.address && !stableToken?.isNative) {
    throw new Error(`${chain.key}: reserve stable ${stableSymbol} missing address`);
  }

  return {
    key: chain.key,
    id: chain.id,
    type: chain.type,
    nativeSymbol: chain.tokens.find((t) => t.isNative)?.symbol ?? "NATIVE",
    rpcUrl: chain.rpcUrl,
    fullHost: chain.fullHost ?? chain.rpcUrl,
    feeLimit: chain.feeLimit,
    liquidityManager: eoa ? nodeWalletAddress! : contracts.liquidityManagerAddress!,
    reserveStable: {
      symbol: stableSymbol,
      address: stableToken!.address ?? "",
      decimals: stableToken!.decimals,
    },
    router: chain.router,
    aggregatorSlug: chain.aggregatorSlug ?? chain.key,
    nativeSentinel: chain.nativeSentinel,
    receivers,
    explorerUrl: chain.explorerUrl,
    nodeWalletMode: eoa,
    nodeWalletAddress,
  };
}
