/**
 * Local harness stack: Hardhat node + FastSwap Receiver + Local Provider adapter/Router.
 * Shared by `dev:local` and the hermetic worker-path test.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, id } from "ethers";
import { readArtifact } from "../cli/artifacts.js";

export const LOCAL_OPERATOR_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export type DeployedLocalChain = {
  key: string;
  id: string;
  name: string;
  rpcUrl: string;
  fastSwap: string;
  sweeper: string;
  router: string;
  adapter: string;
  operator: string;
  stable: { symbol: string; address: string; decimals: number };
};

export async function waitForRpc(rpcUrl: string, chainId: number, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    try {
      await provider.getBlockNumber();
      provider.destroy();
      return;
    } catch {
      provider.destroy();
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`RPC not ready: ${rpcUrl}`);
}

export function spawnHardhatNode(input: { port: number; chainId: number; hostname?: string }): ChildProcess {
  const hostname = input.hostname ?? "127.0.0.1";
  return spawn(
    "npx",
    ["hardhat", "node", "--hostname", hostname, "--port", String(input.port), "--chain-id", String(input.chainId)],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
  );
}

export function applyLocalOperatorEnv(chainKeys: string[], privateKey = LOCAL_OPERATOR_PRIVATE_KEY): void {
  process.env.EVM_PRIVATE_KEY = privateKey;
  process.env.SWEEP_EVM_PRIVATE_KEY ??= privateKey;
  process.env.EXECUTE_PLAN_SIGNER_PRIVATE_KEY ??= privateKey;
  for (const key of chainKeys) {
    process.env[`EXECUTE_${key.toUpperCase()}_PRIVATE_KEY`] ??= privateKey;
  }
}

export async function deployLocalFastSwapChain(input: {
  key: string;
  id: string;
  name: string;
  rpcUrl: string;
  stableSymbol: string;
  privateKey?: string;
  feeBps?: number;
}): Promise<DeployedLocalChain> {
  const privateKey = input.privateKey ?? LOCAL_OPERATOR_PRIVATE_KEY;
  const feeBps = input.feeBps ?? 75;
  const provider = new JsonRpcProvider(input.rpcUrl, Number(input.id), { staticNetwork: true });
  await provider.getBlockNumber();
  const wallet = new Wallet(privateKey, provider);
  let nonce = await provider.getTransactionCount(wallet.address, "pending");

  const [fastSwapArtifact, proxyArtifact, sweeperArtifact, tokenArtifact, adapterArtifact, routerArtifact] =
    await Promise.all([
      readArtifact("contracts/FastSwapReceiver.sol/FastSwapReceiver.json"),
      readArtifact("ReceiverProxy"),
      readArtifact("InvoiceSweeper"),
      readArtifact("MockERC20"),
      readArtifact("MockAdapter"),
      readArtifact("LocalProviderRouter"),
    ]);

  const impl = await deploy(wallet, fastSwapArtifact, nonce++);
  const initData = new Contract(impl.target, fastSwapArtifact.abi, wallet).interface.encodeFunctionData(
    "initialize(address,uint16)",
    [wallet.address, feeBps]
  );
  const proxy = await deploy(wallet, proxyArtifact, nonce++, impl.target, initData);
  const sweeper = await deploy(wallet, sweeperArtifact, nonce++, proxy.target);
  const token = (await deploy(
    wallet,
    tokenArtifact,
    nonce++,
    `Local ${input.stableSymbol}`,
    input.stableSymbol,
    6
  )) as Contract;
  await (await token.mint(wallet.address, 1_000_000_000_000n, { nonce: nonce++ })).wait();

  const fastSwap = new Contract(proxy.target, fastSwapArtifact.abi, wallet);
  await (await fastSwap.setTreasury(wallet.address, { nonce: nonce++ })).wait();

  const router = await deploy(wallet, routerArtifact, nonce++);
  const adapter = await deploy(wallet, adapterArtifact, nonce++, proxy.target, wallet.address, wallet.address);
  const adapterContract = new Contract(adapter.target, adapterArtifact.abi, wallet);
  await (await adapterContract.setRouterAllowed(router.target, true, { nonce: nonce++ })).wait();
  await (await fastSwap.setAdapter(id("mock"), adapter.target, { nonce: nonce++ })).wait();

  const relayerRole = await fastSwap.RELAYER_ROLE();
  await (await fastSwap.grantRole(relayerRole, wallet.address, { nonce: nonce++ })).wait();

  const deployed: DeployedLocalChain = {
    key: input.key,
    id: input.id,
    name: input.name,
    rpcUrl: input.rpcUrl,
    fastSwap: String(proxy.target),
    sweeper: String(sweeper.target),
    router: String(router.target),
    adapter: String(adapter.target),
    operator: wallet.address,
    stable: { symbol: input.stableSymbol, address: String(token.target), decimals: 6 },
  };
  provider.destroy();
  return deployed;
}

async function deploy(
  signer: Wallet,
  artifact: { abi: unknown; bytecode: string },
  nonce: number,
  ...args: unknown[]
) {
  const factory = new ContractFactory(artifact.abi as never, artifact.bytecode, signer);
  const contract = await factory.deploy(...args, { nonce });
  await contract.deploymentTransaction()?.wait();
  await contract.waitForDeployment();
  return contract;
}
