import { AbiCoder } from "ethers";

const INTENT_V2_TYPES = [
  "tuple(uint8 version,bytes32 quoteId,uint256 sourceChainId,bytes sourceToken,uint256 minSourceAmount,uint256 destChainId,bytes destToken,uint256 minAmountOut,bytes recipient,bytes refundTo,uint64 expiresAt,uint16 slippageBps)",
];

export function destFieldsFromIntentData(data: string): {
  destChainId: bigint;
  destToken: string;
  recipient: string;
  minAmountOut: bigint;
} {
  const decoded = AbiCoder.defaultAbiCoder().decode(INTENT_V2_TYPES, data)[0] as {
    destChainId: bigint;
    destToken: string;
    recipient: string;
    minAmountOut: bigint;
  };
  return {
    destChainId: decoded.destChainId,
    destToken: decoded.destToken,
    recipient: decoded.recipient,
    minAmountOut: decoded.minAmountOut,
  };
}
