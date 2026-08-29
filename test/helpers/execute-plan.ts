import { Contract, keccak256, toUtf8Bytes, TypedDataEncoder, type Signer } from "ethers";
import { EXECUTE_PLAN_DOMAIN, EXECUTE_PLAN_TYPES, routeDataHash } from "../../shared/execute-plan.js";

export async function signTestExecutePlan(input: {
  signer: Signer;
  fastSwap: Contract;
  invoiceId: string;
  adapterId: string;
  routeData: string;
  minAmountOut: bigint;
}): Promise<string> {
  const network = await input.signer.provider!.getNetwork();
  const verifyingContract = await input.fastSwap.getAddress();
  return input.signer.signTypedData(
    { ...EXECUTE_PLAN_DOMAIN, chainId: network.chainId, verifyingContract },
    EXECUTE_PLAN_TYPES,
    {
      invoiceId: input.invoiceId,
      adapterId: input.adapterId,
      routeDataHash: routeDataHash(input.routeData),
      minAmountOut: input.minAmountOut,
    }
  );
}

export function mockAdapterId(name = "mock"): string {
  return keccak256(toUtf8Bytes(name));
}
