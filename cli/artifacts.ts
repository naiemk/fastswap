import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { InterfaceAbi } from "ethers";

export type ContractArtifact = {
  abi: InterfaceAbi;
  bytecode: string;
};

const ARTIFACT_CANDIDATES: Record<string, string[]> = {
  "FastSwapReceiver": [
    "artifacts/contracts/FastSwapReceiver.sol/FastSwapReceiver.json",
  ],
  "ReceiverProxy": [
    "artifacts/contracts/vendor/ReceiverProxy.sol/ReceiverProxy.json",
    "artifacts/onchain-invoice/contracts/proxy/ReceiverProxy.sol/ReceiverProxy.json",
  ],
  "InvoiceSweeper": [
    "artifacts/contracts/vendor/InvoiceSweeper.sol/InvoiceSweeper.json",
    "artifacts/onchain-invoice/contracts/InvoiceSweeper.sol/InvoiceSweeper.json",
  ],
  "MockERC20": [
    "artifacts/contracts/vendor/MockERC20.sol/MockERC20.json",
    "artifacts/onchain-invoice/contracts/mocks/MockERC20.sol/MockERC20.json",
  ],
  "MockAdapter": [
    "artifacts/contracts/adapters/MockAdapter.sol/MockAdapter.json",
  ],
  "LocalProviderRouter": [
    "artifacts/contracts/adapters/LocalProviderRouter.sol/LocalProviderRouter.json",
  ],
  "Forwarder": [
    "artifacts/onchain-invoice/contracts/Forwarder.sol/Forwarder.json",
    "artifacts/contracts/Forwarder.sol/Forwarder.json",
  ],
};

export async function readArtifact(pathFromArtifacts: string): Promise<ContractArtifact> {
  const candidates = [pathFromArtifacts];
  const contractName = pathFromArtifacts.split("/").pop()?.replace(".json", "");
  if (contractName && ARTIFACT_CANDIDATES[contractName]) {
    candidates.push(...ARTIFACT_CANDIDATES[contractName]);
  }

  for (const relative of [...new Set(candidates)]) {
    const artifactPath = join(process.cwd(), relative);
    if (!existsSync(artifactPath)) continue;
    const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as ContractArtifact;
    if (artifact.abi && artifact.bytecode) return artifact;
  }

  throw new Error(`Artifact not found for ${pathFromArtifacts}`);
}
