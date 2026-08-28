export const FASTSWAP_RECEIVER_ABI = [
  "function execute(bytes32 invoiceId,bytes32 adapterId,bytes routeData,uint256 minAmountOut)",
  "function refund(bytes32 invoiceId)",
  "function setAdapter(bytes32 adapterId,address adapterAddr)",
  "function setFeeBps(uint16 feeBps_)",
  "function adapter(bytes32 adapterId) view returns (address)",
  "function feeBps() view returns (uint16)",
  "function invoiceRecord(bytes32 invoiceId) view returns ((uint8 version,bytes32 quoteId,uint256 sourceChainId,bytes sourceToken,uint256 minSourceAmount,uint256 destChainId,bytes destToken,uint256 minAmountOut,bytes recipient,bytes refundTo,uint64 expiresAt,uint16 slippageBps),uint8 status,address paidToken,uint256 paidAmount,bytes32 executedAdapterId)",
  "function invoicePayment(bytes32 invoiceId) view returns (address token,uint256 amount,address forwarder)",
  "event InvoicePaid(bytes32 indexed invoiceId,bytes32 indexed quoteId,address indexed token,uint256 amount,uint256 destChainId)",
  "event SwapExecuted(bytes32 indexed invoiceId,bytes32 indexed adapterId,address indexed token,uint256 amountIn,uint256 minAmountOut)",
  "event InvoiceRefunded(bytes32 indexed invoiceId,address indexed token,address indexed to,uint256 amount)",
] as const;

export enum InvoiceStatus {
  None = 0,
  Paid = 1,
  Executed = 2,
  Refunded = 3,
}
