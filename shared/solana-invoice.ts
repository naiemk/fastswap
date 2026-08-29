/**
 * Solana invoice integration for FastSwap aggregator model.
 * Deposits use onchain-invoice `commerce-invoice` PDAs; settle delivers to FastSwap merchant pubkey.
 */
export type SolanaInvoiceConfig = {
  chainId: "devnet" | "mainnet-beta";
  programId: string;
  merchantPubkey: string;
  rpcUrl: string;
};

export function isSolanaChain(chainId: string): boolean {
  return chainId === "devnet" || chainId === "mainnet-beta" || chainId === "solana";
}

/** Documented settle flow — actual SDK calls live in onchain-invoice SolanaSdk. */
export function describeSolanaSettleFlow(config: SolanaInvoiceConfig): string {
  return [
    `Payer sends SPL to invoice ATA (PDA seeds: invoice + invoiceId + merchant + mint).`,
    `Sweeper calls settle on ${config.programId}; funds go to merchant ${config.merchantPubkey}.`,
    `Execute node routes from merchant authority via aggregator (Rango/Rubic prebuilt tx or CPI adapter).`,
  ].join(" ");
}
