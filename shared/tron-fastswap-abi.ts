/** Minimal ABI for TronFastSwapReceiver (aggregator executor). */
export const TRON_FASTSWAP_RECEIVER_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "invoiceId", type: "bytes32" },
      { name: "adapterId", type: "bytes32" },
      { name: "routeData", type: "bytes" },
      { name: "minAmountOut", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [{ name: "invoiceId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "invoicePayment",
    stateMutability: "view",
    inputs: [{ name: "invoiceId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "forwarder", type: "address" },
          { name: "paid", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "invoiceRecord",
    stateMutability: "view",
    inputs: [{ name: "invoiceId", type: "bytes32" }],
    outputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
          { name: "version", type: "uint8" },
          { name: "quoteId", type: "bytes32" },
          { name: "sourceChainId", type: "uint256" },
          { name: "sourceToken", type: "bytes" },
          { name: "minSourceAmount", type: "uint256" },
          { name: "destChainId", type: "uint256" },
          { name: "destToken", type: "bytes" },
          { name: "minAmountOut", type: "uint256" },
          { name: "recipient", type: "bytes" },
          { name: "refundTo", type: "bytes" },
          { name: "expiresAt", type: "uint64" },
          { name: "slippageBps", type: "uint16" },
        ],
      },
      { name: "status", type: "uint8" },
      { name: "paidToken", type: "address" },
      { name: "paidAmount", type: "uint256" },
      { name: "executedAdapterId", type: "bytes32" },
    ],
  },
] as const;
