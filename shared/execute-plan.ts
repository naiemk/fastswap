import { AbiCoder, getAddress, keccak256, TypedDataEncoder, Wallet, zeroPadValue } from "ethers";

export const EXECUTE_PLAN_DOMAIN = {
  name: "FastSwap",
  version: "1",
} as const;

export const EXECUTE_PLAN_TYPES = {
  ExecutePlan: [
    { name: "invoiceId", type: "bytes32" },
    { name: "adapterId", type: "bytes32" },
    { name: "routeDataHash", type: "bytes32" },
    { name: "minAmountOut", type: "uint256" },
  ],
} as const;

export type ExecutePlanFields = {
  invoiceId: string;
  adapterId: string;
  routeData: string;
  minAmountOut: bigint;
};

export function routeDataHash(routeData: string): string {
  return keccak256(routeData.startsWith("0x") ? routeData : `0x${routeData}`);
}

export function executePlanDigest(fields: ExecutePlanFields, chainId: bigint, verifyingContract: string): string {
  return TypedDataEncoder.hash(
    { ...EXECUTE_PLAN_DOMAIN, chainId, verifyingContract: getAddress(verifyingContract) },
    EXECUTE_PLAN_TYPES,
    {
      invoiceId: fields.invoiceId,
      adapterId: fields.adapterId,
      routeDataHash: routeDataHash(fields.routeData),
      minAmountOut: fields.minAmountOut,
    }
  );
}

export async function signExecutePlan(
  fields: ExecutePlanFields,
  chainId: bigint,
  verifyingContract: string,
  privateKey: string
): Promise<string> {
  const wallet = new Wallet(privateKey);
  return wallet.signTypedData(
    { ...EXECUTE_PLAN_DOMAIN, chainId, verifyingContract: getAddress(verifyingContract) },
    EXECUTE_PLAN_TYPES,
    {
      invoiceId: fields.invoiceId,
      adapterId: fields.adapterId,
      routeDataHash: routeDataHash(fields.routeData),
      minAmountOut: fields.minAmountOut,
    }
  );
}

export function executePlanStructHash(fields: ExecutePlanFields): string {
  const abi = AbiCoder.defaultAbiCoder();
  return keccak256(
    abi.encode(
      ["bytes32", "bytes32", "bytes32", "uint256"],
      [fields.invoiceId, fields.adapterId, routeDataHash(fields.routeData), fields.minAmountOut]
    )
  );
}

/** Normalize invoice id to bytes32 for typed-data signing. */
export function normalizePlanInvoiceId(invoiceId: string): string {
  if (invoiceId.startsWith("0x") && invoiceId.length === 66) return invoiceId;
  return zeroPadValue(invoiceId, 32);
}
