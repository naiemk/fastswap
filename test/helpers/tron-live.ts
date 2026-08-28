import { TronWeb } from "tronweb";

export const TRON_ERC20_ABI = [
  {
    constant: false,
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    type: "function",
  },
] as const;

export function makeTron(fullHost: string, privateKey: string) {
  return new TronWeb({ fullHost, privateKey: privateKey.replace(/^0x/, "") });
}

export async function waitTron(tronWeb: TronWeb, txId: string) {
  for (let i = 0; i < 60; i++) {
    const info = await tronWeb.trx.getTransactionInfo(txId);
    if (info?.id) return info;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`TRON tx not confirmed: ${txId}`);
}
