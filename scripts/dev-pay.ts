#!/usr/bin/env tsx
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { loadFastSwapConfig, resolveConfigPath } from "../config/load.js";

const configPath = resolveConfigPath(process.argv[2]);
const invoiceId = process.argv[3];
if (!invoiceId) {
  console.error("Usage: npm run dev:pay -- <invoiceId> [configPath]");
  process.exit(1);
}

const config = loadFastSwapConfig(configPath);
const privateKey = process.env.EVM_PRIVATE_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const apiBase = config.server.publicUrl ?? `http://127.0.0.1:${config.server.apiPort}`;
const signingSecret = process.env[config.server.signingSecretEnv ?? "API_SIGNING_SECRET"] ?? "local-dev-signing-secret-32chars-min";

const invoiceRes = await fetch(`${apiBase}/invoices/${invoiceId}`, {
  headers: { "x-api-key": signingSecret },
});
if (!invoiceRes.ok) throw new Error(`Invoice fetch failed: ${invoiceRes.status}`);
const { invoice } = (await invoiceRes.json()) as { invoice: Record<string, string> };

const chain = config.chains.find((c) => c.id === invoice.sourceChainId);
if (!chain?.rpcUrl) throw new Error(`Unknown source chain ${invoice.sourceChainId}`);

const provider = new JsonRpcProvider(chain.rpcUrl);
const wallet = new Wallet(privateKey, provider);
const amount = BigInt(invoice.sourceAmount);
const token = invoice.sourceToken;

if (!token || token === "0x0000000000000000000000000000000000000000") {
  const tx = await wallet.sendTransaction({ to: invoice.invoiceAddress, value: amount });
  console.log("Paid native:", tx.hash);
} else {
  const erc20 = new Contract(
    token,
    ["function transfer(address to,uint256 amount) returns (bool)"],
    wallet
  );
  const tx = await erc20.transfer(invoice.invoiceAddress, amount);
  console.log("Paid token:", tx.hash);
}
