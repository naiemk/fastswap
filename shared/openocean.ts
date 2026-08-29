export type OpenOceanChain = {
  key: string;
  aggregatorSlug?: string;
  router: string;
  nativeSentinel?: string;
  account: string;
};

export type SwapRoute = {
  router: string;
  data: string;
  expectedOut: bigint;
};

const NATIVE_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/** OpenOcean v4 swap quote for TRON node-wallet payouts. */
export class OpenOceanRouteProvider {
  constructor(private readonly baseUrl = "https://open-api.openocean.finance/v4") {}

  async quote(args: {
    chain: OpenOceanChain;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    slippageBps: number;
  }): Promise<SwapRoute> {
    const { chain, tokenIn, tokenOut, amountIn, slippageBps } = args;
    const slug = chain.aggregatorSlug ?? chain.key;
    const inAddr = resolveToken(chain, tokenIn);
    const outAddr = resolveToken(chain, tokenOut);

    const params = new URLSearchParams({
      inTokenAddress: inAddr,
      outTokenAddress: outAddr,
      amountDecimals: amountIn.toString(),
      gasPriceDecimals: "1",
      slippage: (slippageBps / 100).toString(),
      account: chain.account,
    });

    const res = await fetch(`${this.baseUrl}/${slug}/swap?${params.toString()}`);
    if (!res.ok) throw new Error(`OpenOcean quote failed (${slug}): ${res.status}`);
    const body = (await res.json()) as { data?: { to?: string; data?: string; outAmount?: string } };
    const d = body.data;
    if (!d?.to || !d.data || !d.outAmount) throw new Error(`OpenOcean returned no route for ${slug}`);
    if (d.to.toLowerCase() !== chain.router.toLowerCase()) {
      throw new Error(`OpenOcean router ${d.to} is not the whitelisted router ${chain.router}`);
    }
    return { router: d.to, data: d.data, expectedOut: BigInt(d.outAmount) };
  }
}

function resolveToken(chain: OpenOceanChain, token: string): string {
  if (token === "0x0000000000000000000000000000000000000000" || token.toLowerCase() === "native") {
    return chain.nativeSentinel ?? NATIVE_SENTINEL;
  }
  return token;
}
