/**
 * TRON operator key + invoice derivation secret.
 * By default the invoice master secret is the same as the operator private key
 * (one wallet / one secret for sponsor + deterministic invoice EOAs).
 */

export function resolveTronOperatorPrivateKey(): string | undefined {
  return process.env.TRON_PRIVATE_KEY ?? process.env.EVM_PRIVATE_KEY;
}

export function resolveTronInvoiceMasterSecretEnv(chainEnvName?: string): string {
  return chainEnvName ?? "TRON_INVOICE_MASTER_SECRET";
}

/** Invoice EOA derivation secret — explicit env, else same as TRON/EVM operator key. */
export function resolveTronInvoiceMasterSecret(chainEnvName?: string): string {
  const envName = resolveTronInvoiceMasterSecretEnv(chainEnvName);
  const explicit = process.env[envName];
  if (explicit) return explicit;
  const pk = resolveTronOperatorPrivateKey();
  if (!pk) {
    throw new Error(`Missing ${envName} and no TRON_PRIVATE_KEY / EVM_PRIVATE_KEY to derive it`);
  }
  return pk.replace(/^0x/, "");
}

/** Set env defaults: node keys + invoice master secret from operator key. */
export function applyTronSecretDefaults(chainInvoiceSecretEnv?: string): void {
  const tronPk = resolveTronOperatorPrivateKey();
  if (tronPk) {
    const normalized = tronPk.replace(/^0x/, "");
    process.env.TRON_PRIVATE_KEY ??= normalized;
    process.env.SWEEP_TRON_PRIVATE_KEY ??= normalized;
    process.env.RELAY_TRON_PRIVATE_KEY ??= normalized;
    const envName = resolveTronInvoiceMasterSecretEnv(chainInvoiceSecretEnv);
    process.env[envName] ??= normalized;
  }
}
