export type E2EMatrixCase = {
  id: string;
  label: string;
  mode: "nodes" | "smoke";
  sourceKey: string;
  targetKey: string;
  sendSymbol: string;
  recvSymbol: string;
};

/** Two-chain go-live matrix: Sepolia + TRON Nile. */
export const E2E_MATRIX: E2EMatrixCase[] = [
  {
    id: "T1",
    label: "TRON USDT → Sepolia ETH (nodes)",
    mode: "nodes",
    sourceKey: "tron",
    targetKey: "sepolia",
    sendSymbol: "USDT",
    recvSymbol: "ETH",
  },
  {
    id: "T2",
    label: "Sepolia ETH → TRON TRX (smoke)",
    mode: "smoke",
    sourceKey: "sepolia",
    targetKey: "tron",
    sendSymbol: "ETH",
    recvSymbol: "TRX",
  },
  {
    id: "T3",
    label: "TRON TRX → Sepolia ETH (smoke)",
    mode: "smoke",
    sourceKey: "tron",
    targetKey: "sepolia",
    sendSymbol: "TRX",
    recvSymbol: "ETH",
  },
  {
    id: "T4",
    label: "Sepolia USDT → TRON USDT (smoke)",
    mode: "smoke",
    sourceKey: "sepolia",
    targetKey: "tron",
    sendSymbol: "USDT",
    recvSymbol: "USDT",
  },
  {
    id: "T5",
    label: "TRON USDT → default EVM ETH (nodes, bootstrap default)",
    mode: "nodes",
    sourceKey: "tron",
    targetKey: "*",
    sendSymbol: "USDT",
    recvSymbol: "ETH",
  },
];
