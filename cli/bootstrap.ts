import type { FastSwapConfigFile } from "../config/types.js";
import { getActiveChainDefinitions, isTronEoaChain } from "../config/load.js";
import { applyTronSecretDefaults, resolveTronInvoiceMasterSecret } from "../shared/tron-secrets.js";
import { Wallet } from "ethers";

/** Copy operator keys to node env vars when unset (single-wallet setup). */
export function applyOperatorEnvDefaults(): void {
  const evm = process.env.EVM_PRIVATE_KEY;
  const tron = process.env.TRON_PRIVATE_KEY ?? evm;
  if (evm) {
    process.env.SWEEP_EVM_PRIVATE_KEY ??= evm;
    process.env.RELAY_EVM_PRIVATE_KEY ??= evm;
    process.env.EXECUTE_PLAN_SIGNER_PRIVATE_KEY ??= evm;
  }
  if (tron) {
    const normalized = tron.replace(/^0x/, "");
    process.env.SWEEP_TRON_PRIVATE_KEY ??= normalized;
    process.env.RELAY_TRON_PRIVATE_KEY ??= normalized;
  }
  applyTronSecretDefaults();
  if (evm && !process.env.FASTSWAP_OWNER_ADDRESS) {
    process.env.FASTSWAP_OWNER_ADDRESS = new Wallet(evm).address;
  }
}

export function stepEnvCheck(config: FastSwapConfigFile) {
  applyOperatorEnvDefaults();
  const evmKey = process.env.EVM_PRIVATE_KEY;
  const tronKey = process.env.TRON_PRIVATE_KEY ?? evmKey;
  const signing = process.env[config.server.signingSecretEnv ?? "API_SIGNING_SECRET"];
  const issues: string[] = [];
  if (!evmKey) issues.push("Missing EVM_PRIVATE_KEY");
  if (!tronKey) issues.push("Missing TRON_PRIVATE_KEY (or EVM_PRIVATE_KEY)");
  if (!signing) issues.push(`Missing ${config.server.signingSecretEnv ?? "API_SIGNING_SECRET"}`);
  const invoiceSecretEnv =
    config.chains.find((c) => c.type === "tron")?.sweep?.invoiceMasterSecretEnv ?? "TRON_INVOICE_MASTER_SECRET";
  if (getActiveChainDefinitions(config).some((c) => isTronEoaChain(c))) {
    applyTronSecretDefaults(invoiceSecretEnv);
    try {
      resolveTronInvoiceMasterSecret(invoiceSecretEnv);
    } catch {
      issues.push(`Missing ${invoiceSecretEnv} (or TRON/EVM private key to derive it)`);
    }
  }
  return {
    ok: issues.length === 0,
    issues,
    addresses: {
      evm: evmKey ? new Wallet(evmKey).address : undefined,
      tron: tronKey ? tronKey.replace(/^0x/, "") : undefined,
    },
  };
}
