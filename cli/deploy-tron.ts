import { Interface } from "ethers";
import { TronWeb } from "tronweb";
import { tronAddressToEvmHex } from "../shared/tron-address.js";
import type { FastSwapConfigFile, ResolvedChainContracts } from "../config/types.js";
import { getChainDefinition, isTronEoaChain, saveFastSwapConfig, updateTronContracts } from "../config/load.js";
import { readArtifact } from "./artifacts.js";

/** Keep this much liquid TRX untouched for bandwidth and follow-up configure txs. */
const TRON_RESERVE_TRX = 40;
/** Hard cap on total TRX burned across the whole deploy run (safety rail). */
const TRON_MAX_TOTAL_BURN_TRX = 520;
/** Bytecode larger than this uses the large-contract fee ceiling. */
const LARGE_BYTECODE_BYTES = 8_000;

const FEE_LIMIT_SMALL_SUN = 100_000_000;
const FEE_LIMIT_LARGE_SUN = 320_000_000;
/** Observed Nile floor for ~17 KB contracts (failed at 2.6M energy / 260 TRX). */
const MIN_LARGE_FEE_SUN = 270_000_000;
/** Do not attempt large deploys below this liquid balance — they fail after burning ~300 TRX. */
const MIN_LARGE_LIQUID_SUN = 315_000_000;
const MIN_SMALL_FEE_SUN = 60_000_000;


class TronDeployBudget {
  private burnedSun = 0;

  constructor(
    private readonly tronWeb: TronWeb,
    private readonly ownerBase58: string,
    private readonly maxBurnSun: number
  ) {}

  async liquidTrx(): Promise<number> {
    return Number(await this.tronWeb.trx.getBalance(this.ownerBase58)) / 1e6;
  }

  async assertCanAfford(step: string, feeLimitSun: number): Promise<void> {
    const liquid = await this.liquidTrx();
    const feeTrx = feeLimitSun / 1e6;
    const remainingBudgetTrx = this.maxBurnSun / 1e6 - this.burnedSun / 1e6;
    if (remainingBudgetTrx < feeTrx) {
      throw new Error(
        `[deploy:tron] budget stop before "${step}": ` +
          `${remainingBudgetTrx.toFixed(0)} TRX burn budget left, step ceiling is ${feeTrx.toFixed(0)} TRX`
      );
    }
    if (liquid < TRON_RESERVE_TRX + feeTrx) {
      throw new Error(
        `[deploy:tron] budget stop before "${step}": ` +
          `${liquid.toFixed(2)} liquid TRX, need ${(TRON_RESERVE_TRX + feeTrx).toFixed(0)} TRX ` +
          `(step up to ${feeTrx.toFixed(0)} TRX + ${TRON_RESERVE_TRX} TRX reserve)`
      );
    }
  }

  recordBurn(feeSun: number): void {
    this.burnedSun += feeSun;
    if (this.burnedSun > this.maxBurnSun) {
      throw new Error(
        `[deploy:tron] total burn cap exceeded: ${(this.burnedSun / 1e6).toFixed(2)} / ${(this.maxBurnSun / 1e6).toFixed(0)} TRX`
      );
    }
  }

  summary(): string {
    return `${(this.burnedSun / 1e6).toFixed(2)} / ${(this.maxBurnSun / 1e6).toFixed(0)} TRX burned`;
  }
}

export async function deployTronStack(input: {
  config: FastSwapConfigFile;
  privateKey: string;
  owner?: string;
  save?: boolean;
  configPath?: string;
  chainKey?: string;
  includeLiquidityManager?: boolean;
}) {
  const chainKey = input.chainKey ?? "tron";
  const chain = getChainDefinition(input.config, chainKey);
  if (chain.type !== "tron") throw new Error(`Chain "${chainKey}" is not Tron`);
  if (isTronEoaChain(chain)) {
    console.log(`[deploy-tron] ${chainKey}: EOA sweep mode — skipping contract deploy (set sweep.mode: contract for legacy)`);
    return { skipped: true, reason: "eoa-mode", chainKey };
  }
  const fullHost = chain.fullHost ?? chain.rpcUrl;
  if (!fullHost) throw new Error(`Missing fullHost for chain "${chainKey}"`);

  const privateKey = input.privateKey.replace(/^0x/, "");
  const tronWeb = new TronWeb({ fullHost, privateKey });
  const ownerBase58 =
    input.owner?.startsWith("T") === true ? input.owner : (tronWeb.defaultAddress.base58 as string);
  const ownerHex = tronAddressToEvmHex(ownerBase58);
  const budget = new TronDeployBudget(tronWeb, ownerBase58, TRON_MAX_TOTAL_BURN_TRX * 1_000_000);

  console.log(`[deploy:tron] wallet ${ownerBase58} — ${await budget.liquidTrx()} liquid TRX`);
  await unfreezeAllEnergy(tronWeb, ownerBase58);
  console.log(`[deploy:tron] after unfreeze — ${await budget.liquidTrx()} liquid TRX`);
  await assertTronDeployBudget(tronWeb, ownerBase58);

  const [fastSwapArtifact, proxyArtifact, sweeperArtifact, lmArtifact] = await Promise.all([
    readArtifact("contracts/tron/TronFastSwapReceiver.sol/TronFastSwapReceiver.json"),
    readArtifact("contracts/proxy/ReceiverProxy.sol/ReceiverProxy.json"),
    readArtifact("contracts/tron/TronInvoiceSweeper.sol/TronInvoiceSweeper.json"),
    readArtifact("contracts/tron/liquiditymanager/TronLiquidityManager.sol/TronLiquidityManager.json"),
  ]);

  const initIface = new Interface(["function initialize(address initialOwner)"]);
  const initData = initIface.encodeFunctionData("initialize", [ownerHex]);

  let workingConfig = input.config;
  const state: ResolvedChainContracts = {
    fastSwapImplementation: "",
    fastSwapAddress: chain.contracts?.fastSwapAddress ?? "",
    sweeperAddress: chain.contracts?.sweeperAddress ?? "",
    forwarderImplementation: chain.contracts?.forwarderImplementation ?? "",
    liquidityManagerImplementation: "",
    liquidityManagerAddress: chain.contracts?.liquidityManagerAddress ?? "",
  };

  const saveProgress = async (patch: Partial<ResolvedChainContracts>) => {
    Object.assign(state, patch);
    if (input.save === false) return;
    workingConfig = updateTronContracts(workingConfig, patch, chainKey);
    saveFastSwapConfig(workingConfig, input.configPath);
    const label = input.configPath ?? "FastSwapConfig.yaml";
    console.log(`[deploy:tron] updated ${label} (${Object.keys(patch).join(", ")})`);
  };

  if (!(await isLiveFastSwap(tronWeb, fastSwapArtifact, state.fastSwapAddress))) {
    state.fastSwapImplementation = await deployTronContract({
      tronWeb,
      fullHost,
      budget,
      label: "TronFastSwapReceiver implementation",
      artifact: fastSwapArtifact,
    });
    await saveProgress({ fastSwapImplementation: state.fastSwapImplementation });
  } else {
    console.log(`[deploy:tron] reusing FastSwap proxy ${state.fastSwapAddress}`);
  }

  if (!(await isLiveFastSwap(tronWeb, fastSwapArtifact, state.fastSwapAddress))) {
    state.fastSwapAddress = await deployTronContract({
      tronWeb,
      fullHost,
      budget,
      label: "FastSwap ReceiverProxy",
      artifact: proxyArtifact,
      parameters: [tronAddressToEvmHex(state.fastSwapImplementation), initData],
    });
    await saveProgress({
      fastSwapImplementation: state.fastSwapImplementation,
      fastSwapAddress: state.fastSwapAddress,
    });
  }

  if (!(await isLiveSweeper(tronWeb, sweeperArtifact, fastSwapArtifact, state.sweeperAddress, state.fastSwapAddress))) {
    state.sweeperAddress = await deployTronContract({
      tronWeb,
      fullHost,
      budget,
      label: "TronInvoiceSweeper",
      artifact: sweeperArtifact,
      parameters: [tronAddressToEvmHex(state.fastSwapAddress)],
    });
  } else {
    console.log(`[deploy:tron] reusing sweeper ${state.sweeperAddress}`);
  }

  const sweeperContract = await tronWeb.contract(sweeperArtifact.abi as never, state.sweeperAddress);
  state.forwarderImplementation = toBase58(
    tronWeb,
    (await sweeperContract.forwarderImplementation().call()) as string
  );
  await saveProgress({
    fastSwapImplementation: state.fastSwapImplementation,
    fastSwapAddress: state.fastSwapAddress,
    sweeperAddress: state.sweeperAddress,
    forwarderImplementation: state.forwarderImplementation,
  });

  if (input.includeLiquidityManager !== false) {
    const liquid = await budget.liquidTrx();
    if (liquid < 650) {
      console.log(
        `[deploy:tron] skipping LiquidityManager deploy — only ${liquid.toFixed(0)} TRX liquid left (need ~650+ for LM)`
      );
    } else if (!(await isLiveLiquidityManager(tronWeb, lmArtifact, state.liquidityManagerAddress))) {
      state.liquidityManagerImplementation = await deployTronContract({
        tronWeb,
        fullHost,
        budget,
        label: "TronLiquidityManager implementation",
        artifact: lmArtifact,
      });
      await saveProgress({
        fastSwapImplementation: state.fastSwapImplementation,
        fastSwapAddress: state.fastSwapAddress,
        sweeperAddress: state.sweeperAddress,
        forwarderImplementation: state.forwarderImplementation,
        liquidityManagerImplementation: state.liquidityManagerImplementation,
      });

      state.liquidityManagerAddress = await deployTronContract({
        tronWeb,
        fullHost,
        budget,
        label: "LiquidityManager ReceiverProxy",
        artifact: proxyArtifact,
        parameters: [tronAddressToEvmHex(state.liquidityManagerImplementation), initData],
      });
      await saveProgress({
        fastSwapImplementation: state.fastSwapImplementation,
        fastSwapAddress: state.fastSwapAddress,
        sweeperAddress: state.sweeperAddress,
        forwarderImplementation: state.forwarderImplementation,
        liquidityManagerImplementation: state.liquidityManagerImplementation,
        liquidityManagerAddress: state.liquidityManagerAddress,
      });
    } else {
      console.log(`[deploy:tron] reusing liquidity manager ${state.liquidityManagerAddress}`);
    }
  }

  await assertTronStack({
    tronWeb,
    fastSwapArtifact,
    sweeperArtifact,
    lmArtifact,
    addresses: state,
    includeLiquidityManager:
      input.includeLiquidityManager !== false && Boolean(state.liquidityManagerAddress),
  });

  console.log(`[deploy:tron] done — ${budget.summary()}, ${await budget.liquidTrx()} TRX liquid remaining`);

  if (input.save !== false) {
    const next = updateTronContracts(workingConfig, state, chainKey);
    saveFastSwapConfig(next, input.configPath);
  }

  return { chainKey, addresses: state };
}

export async function readTronOnChainState(input: {
  config: FastSwapConfigFile;
  chainKey?: string;
  addresses: {
    fastSwapAddress: string;
    sweeperAddress: string;
    liquidityManagerAddress?: string;
  };
}) {
  const chainKey = input.chainKey ?? "tron";
  const chain = getChainDefinition(input.config, chainKey);
  const fullHost = chain.fullHost ?? chain.rpcUrl;
  if (!fullHost) throw new Error(`Missing fullHost for chain "${chainKey}"`);

  const tronWeb = new TronWeb({ fullHost });
  const sweeperArtifact = await readArtifact("contracts/tron/TronInvoiceSweeper.sol/TronInvoiceSweeper.json");
  const fastSwapArtifact = await readArtifact("contracts/tron/TronFastSwapReceiver.sol/TronFastSwapReceiver.json");

  const [fastSwapDeployed, sweeperDeployed, lmDeployed] = await Promise.all([
    tronHasContract(tronWeb, input.addresses.fastSwapAddress),
    tronHasContract(tronWeb, input.addresses.sweeperAddress),
    input.addresses.liquidityManagerAddress
      ? tronHasContract(tronWeb, input.addresses.liquidityManagerAddress)
      : Promise.resolve(false),
  ]);

  const sweeper = await tronWeb.contract(sweeperArtifact.abi as never, input.addresses.sweeperAddress);
  const receiver = toBase58(tronWeb, (await sweeper.receiver().call()) as string);
  const forwarderImplementation = toBase58(
    tronWeb,
    (await sweeper.forwarderImplementation().call()) as string
  );

  let fastSwapPaused = false;
  if (fastSwapDeployed) {
    const fastSwap = await tronWeb.contract(fastSwapArtifact.abi as never, input.addresses.fastSwapAddress);
    fastSwapPaused = Boolean(await fastSwap.paused().call().catch(() => false));
  }

  return {
    chainKey,
    chainId: chain.id,
    deployed: {
      fastSwap: fastSwapDeployed,
      sweeper: sweeperDeployed,
      liquidityManager: lmDeployed,
    },
    sweeperReceiver: receiver,
    forwarderImplementation,
    fastSwapPaused,
    receiverMatches: receiver === input.addresses.fastSwapAddress,
  };
}

async function deployTronContract(input: {
  tronWeb: TronWeb;
  fullHost: string;
  budget: TronDeployBudget;
  label: string;
  artifact: { abi: unknown; bytecode: string };
  parameters?: unknown[];
}): Promise<string> {
  const bytecodeBytes = (input.artifact.bytecode.replace(/^0x/, "").length) / 2;
  const feeLimit = await resolveFeeLimit(input.budget, bytecodeBytes, input.label);
  await input.budget.assertCanAfford(input.label, feeLimit);

  console.log(
    `[deploy:tron] ${input.label} (bytecode ${bytecodeBytes} B, fee ceiling ${feeLimit / 1e6} TRX)…`
  );

  const instance = await input.tronWeb.contract().new({
    abi: input.artifact.abi as never,
    bytecode: input.artifact.bytecode.replace(/^0x/, ""),
    feeLimit,
    parameters: (input.parameters ?? []) as never,
  } as never);

  const predicted = toBase58(input.tronWeb, (instance as { address: string }).address);
  const txId = await waitForDeployTxId(input.tronWeb, input.fullHost, instance as { address: string });
  if (!txId) {
    throw new Error(`[deploy:tron] could not find create tx for ${input.label} (${predicted})`);
  }

  const receipt = await waitForTronTx(input.tronWeb, txId);
  const feeSun = Number(receipt.fee ?? 0);
  input.budget.recordBurn(feeSun);
  console.log(
    `[deploy:tron] ${input.label} ok at ${predicted} — burned ${(feeSun / 1e6).toFixed(2)} TRX (${input.budget.summary()})`
  );

  await waitForTronContract(input.tronWeb, predicted);
  return predicted;
}

function feeLimitForBytecode(bytecodeBytes: number): number {
  return bytecodeBytes >= LARGE_BYTECODE_BYTES ? FEE_LIMIT_LARGE_SUN : FEE_LIMIT_SMALL_SUN;
}

async function resolveFeeLimit(
  budget: TronDeployBudget,
  bytecodeBytes: number,
  label: string
): Promise<number> {
  const liquidSun = Math.floor((await budget.liquidTrx()) * 1_000_000);
  const affordableSun = Math.max(0, liquidSun - TRON_RESERVE_TRX * 1_000_000);
  const targetSun = feeLimitForBytecode(bytecodeBytes);
  const minSun = bytecodeBytes >= LARGE_BYTECODE_BYTES ? MIN_LARGE_FEE_SUN : MIN_SMALL_FEE_SUN;

  if (bytecodeBytes >= LARGE_BYTECODE_BYTES && liquidSun < MIN_LARGE_LIQUID_SUN) {
    throw new Error(
      `[deploy:tron] refusing "${label}": large contracts need ~${MIN_LARGE_LIQUID_SUN / 1e6} TRX liquid on Nile ` +
        `(wallet has ${(liquidSun / 1e6).toFixed(2)} TRX). Wait for the 1200 TRX unfreeze or send more TRX.`
    );
  }

  const feeLimit = Math.min(targetSun, affordableSun);

  if (feeLimit < minSun) {
    throw new Error(
      `[deploy:tron] cannot afford "${label}": need at least ${minSun / 1e6} TRX fee headroom, ` +
        `wallet has ${(liquidSun / 1e6).toFixed(2)} liquid TRX (${TRON_RESERVE_TRX} TRX reserved)`
    );
  }
  return feeLimit;
}

async function isLiveFastSwap(
  tronWeb: TronWeb,
  artifact: { abi: unknown },
  address: string
): Promise<boolean> {
  if (!address || !(await tronHasContract(tronWeb, address))) return false;
  try {
    const fastSwap = await tronWeb.contract(artifact.abi as never, address);
    await fastSwap.owner().call();
    return true;
  } catch {
    return false;
  }
}

async function isLiveSweeper(
  tronWeb: TronWeb,
  sweeperArtifact: { abi: unknown },
  fastSwapArtifact: { abi: unknown },
  sweeperAddress: string,
  fastSwapAddress: string
): Promise<boolean> {
  if (!sweeperAddress || !(await tronHasContract(tronWeb, sweeperAddress))) return false;
  try {
    const sweeper = await tronWeb.contract(sweeperArtifact.abi as never, sweeperAddress);
    const receiver = toBase58(tronWeb, (await sweeper.receiver().call()) as string);
    return receiver === fastSwapAddress && (await isLiveFastSwap(tronWeb, fastSwapArtifact, fastSwapAddress));
  } catch {
    return false;
  }
}

async function isLiveLiquidityManager(
  tronWeb: TronWeb,
  artifact: { abi: unknown },
  address: string
): Promise<boolean> {
  if (!address || !(await tronHasContract(tronWeb, address))) return false;
  try {
    const lm = await tronWeb.contract(artifact.abi as never, address);
    await lm.owner().call();
    return true;
  } catch {
    return false;
  }
}

async function waitForDeployTxId(
  tronWeb: TronWeb,
  fullHost: string,
  instance: { address: string }
): Promise<string | null> {
  const hexAddress = instance.address.startsWith("T")
    ? tronWeb.address.toHex(instance.address)
    : instance.address;

  const started = Date.now();
  while (Date.now() - started < 90_000) {
    const txs = await fetchRecentCreateTxs(fullHost, tronWeb.defaultAddress.base58 as string);
    const match = txs.find((tx) => tx.contractAddress.toLowerCase() === hexAddress.toLowerCase());
    if (match) return match.txId;
    await sleep(3_000);
  }
  return null;
}

async function fetchRecentCreateTxs(
  fullHost: string,
  ownerBase58: string
): Promise<Array<{ txId: string; contractAddress: string }>> {
  const response = await fetch(`${fullHost}/v1/accounts/${ownerBase58}/transactions?limit=10`);
  if (!response.ok) return [];
  const body = (await response.json()) as {
    data?: Array<{ txID: string; raw_data?: { contract?: Array<{ type?: string }> } }>;
  };
  const results: Array<{ txId: string; contractAddress: string }> = [];
  for (const tx of body.data ?? []) {
    const type = tx.raw_data?.contract?.[0]?.type;
    if (type !== "CreateSmartContract") continue;
    const info = await tronWebGetTxInfo(fullHost, tx.txID);
    if (info?.contract_address) {
      results.push({ txId: tx.txID, contractAddress: info.contract_address });
    }
  }
  return results;
}

async function tronWebGetTxInfo(
  fullHost: string,
  txId: string
): Promise<{ contract_address?: string; receipt?: { result?: string }; fee?: number } | null> {
  const response = await fetch(`${fullHost}/wallet/gettransactioninfobyid`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: txId }),
  });
  if (!response.ok) return null;
  return (await response.json()) as {
    contract_address?: string;
    receipt?: { result?: string };
    fee?: number;
  };
}

async function waitForTronTx(tronWeb: TronWeb, txId: string, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const info = await tronWeb.trx.getTransactionInfo(txId);
    if (info?.id) {
      const result = info.receipt?.result;
      if (result && result !== "SUCCESS") {
        throw new Error(`TRON transaction ${txId} failed: ${result}`);
      }
      if (result === "SUCCESS") return info;
    }
    await sleep(3_000);
  }
  throw new Error(`Timed out waiting for TRON transaction ${txId}`);
}

async function waitForTronContract(tronWeb: TronWeb, address: string, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await tronHasContract(tronWeb, address)) return;
    await sleep(3_000);
  }
  throw new Error(`TRON contract bytecode not available at ${address}`);
}

async function assertTronStack(input: {
  tronWeb: TronWeb;
  fastSwapArtifact: { abi: unknown };
  sweeperArtifact: { abi: unknown };
  lmArtifact: { abi: unknown };
  addresses: ResolvedChainContracts;
  includeLiquidityManager: boolean;
}) {
  const sweeper = await input.tronWeb.contract(
    input.sweeperArtifact.abi as never,
    input.addresses.sweeperAddress
  );
  const receiver = toBase58(input.tronWeb, (await sweeper.receiver().call()) as string);
  if (receiver !== input.addresses.fastSwapAddress) {
    throw new Error(`Sweeper receiver mismatch: ${receiver} != ${input.addresses.fastSwapAddress}`);
  }

  const fastSwap = await input.tronWeb.contract(
    input.fastSwapArtifact.abi as never,
    input.addresses.fastSwapAddress
  );
  await fastSwap.owner().call();

  if (input.includeLiquidityManager) {
    const lm = await input.tronWeb.contract(
      input.lmArtifact.abi as never,
      input.addresses.liquidityManagerAddress!
    );
    await lm.owner().call();
  }
}

async function assertTronDeployBudget(tronWeb: TronWeb, ownerBase58: string): Promise<void> {
  const liquidTrx = Number(await tronWeb.trx.getBalance(ownerBase58)) / 1e6;
  const needed = 315 + TRON_RESERVE_TRX;
  if (liquidTrx >= needed) return;

  throw new Error(
    `TRON deploy needs ~${needed} liquid TRX (frozen stake unlocks later on Nile); wallet has ${liquidTrx.toFixed(2)} TRX at ${ownerBase58}`
  );
}

async function unfreezeAllEnergy(tronWeb: TronWeb, ownerBase58: string): Promise<void> {
  const account = await tronWeb.trx.getAccount(ownerBase58);
  const pending = (account.unfrozenV2 ?? []).filter((e) => (e.unfreeze_amount ?? 0) > 0);
  if (pending.length > 0) {
    for (const entry of pending) {
      const when = entry.unfreeze_expire_time
        ? new Date(entry.unfreeze_expire_time).toISOString()
        : "later";
      console.log(
        `[deploy:tron] ${(entry.unfreeze_amount ?? 0) / 1e6} TRX already unfreezing — liquid after ${when}`
      );
    }
    return;
  }

  for (const entry of account.frozenV2 ?? []) {
    if (entry.type !== "ENERGY" || !(entry.amount ?? 0)) continue;
    console.log(`[deploy:tron] unfreezing ${entry.amount / 1e6} TRX ENERGY stake…`);
    const tx = await tronWeb.transactionBuilder.unfreezeBalanceV2(entry.amount, "ENERGY", ownerBase58);
    const signed = await tronWeb.trx.sign(tx);
    const sent = await tronWeb.trx.sendRawTransaction(signed);
    if (!sent.result) {
      console.log(`[deploy:tron] unfreeze skipped: ${sent.message ?? JSON.stringify(sent)}`);
      return;
    }
    console.log(`[deploy:tron] unfreeze submitted (${sent.txid}) — TRX becomes liquid after the Nile waiting period`);
    return;
  }
}

function toBase58(tronWeb: TronWeb, address: string): string {
  return address.startsWith("T") ? address : (tronWeb.address.fromHex(address) as string);
}

async function tronHasContract(tronWeb: TronWeb, address: string): Promise<boolean> {
  try {
    const contract = await tronWeb.trx.getContract(address);
    return Boolean(contract?.bytecode);
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
