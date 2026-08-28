import { Contract, JsonRpcProvider, Wallet, id } from "ethers";
import type { FastSwapConfigFile } from "../config/types.js";
import { getChainDefinition, resolveChainContracts } from "../config/load.js";
import { readArtifact } from "./artifacts.js";

const ROLE_NAMES = ["DEFAULT_ADMIN_ROLE", "ADMIN_ROLE", "RELAYER_ROLE", "SIGNER_ROLE", "PAUSER_ROLE"] as const;

type FastSwapRoleName = (typeof ROLE_NAMES)[number];

export async function configureFastSwapRole(input: {
  config: FastSwapConfigFile;
  chainKey: string;
  privateKey: string;
  role: FastSwapRoleName;
  account: string;
  grant: boolean;
}) {
  const chain = getChainDefinition(input.config, input.chainKey);
  const contracts = resolveChainContracts(input.config, chain);
  const artifact = await readArtifact("contracts/FastSwapReceiver.sol/FastSwapReceiver.json");

  if (chain.type === "evm") {
    if (!chain.rpcUrl) throw new Error(`Missing rpcUrl for ${input.chainKey}`);
    const wallet = new Wallet(input.privateKey, new JsonRpcProvider(chain.rpcUrl));
    const fastSwap = new Contract(contracts.fastSwapAddress, artifact.abi, wallet);
    const roleHash = await fastSwap.getFunction(input.role)();
    const tx = input.grant
      ? await fastSwap.grantRole(roleHash, input.account)
      : await fastSwap.revokeRole(roleHash, input.account);
    await tx.wait();
    return { chainKey: input.chainKey, role: input.role, account: input.account, grant: input.grant, txHash: tx.hash };
  }

  throw new Error("Tron role configuration is not implemented in the CLI yet");
}

export async function setAdapter(input: {
  config: FastSwapConfigFile;
  chainKey: string;
  privateKey: string;
  adapterId: string;
  adapterAddress: string;
}) {
  const chain = getChainDefinition(input.config, input.chainKey);
  if (chain.type !== "evm") throw new Error("setAdapter currently supports EVM only");
  if (!chain.rpcUrl) throw new Error(`Missing rpcUrl for ${input.chainKey}`);
  const contracts = resolveChainContracts(input.config, chain);
  const artifact = await readArtifact("contracts/FastSwapReceiver.sol/FastSwapReceiver.json");
  const wallet = new Wallet(input.privateKey, new JsonRpcProvider(chain.rpcUrl));
  const fastSwap = new Contract(contracts.fastSwapAddress, artifact.abi, wallet);
  const adapterId = input.adapterId.startsWith("0x") ? input.adapterId : id(input.adapterId);
  const tx = await fastSwap.setAdapter(adapterId, input.adapterAddress);
  await tx.wait();
  return { chainKey: input.chainKey, adapterId, adapterAddress: input.adapterAddress, txHash: tx.hash };
}

export async function setFastSwapPaused(input: {
  config: FastSwapConfigFile;
  chainKey: string;
  privateKey: string;
  paused: boolean;
}) {
  const chain = getChainDefinition(input.config, input.chainKey);
  if (chain.type !== "evm") throw new Error("pause/unpause currently supports EVM only");
  if (!chain.rpcUrl) throw new Error(`Missing rpcUrl for ${input.chainKey}`);
  const contracts = resolveChainContracts(input.config, chain);
  const artifact = await readArtifact("contracts/FastSwapReceiver.sol/FastSwapReceiver.json");
  const wallet = new Wallet(input.privateKey, new JsonRpcProvider(chain.rpcUrl));
  const fastSwap = new Contract(contracts.fastSwapAddress, artifact.abi, wallet);
  const tx = input.paused ? await fastSwap.pause() : await fastSwap.unpause();
  await tx.wait();
  return { chainKey: input.chainKey, paused: input.paused, txHash: tx.hash };
}

export type { FastSwapRoleName };

export function listRoleNames(): readonly FastSwapRoleName[] {
  return ROLE_NAMES;
}
