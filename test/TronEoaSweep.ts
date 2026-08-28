import { expect } from "chai";
import { keccak256, toUtf8Bytes } from "ethers";
import { TRON_ERC20_ABI, makeTron, waitTron } from "./helpers/tron-live.js";
import {
  deriveTronInvoiceAddress,
  readTronTokenBalance,
  sponsorBase58,
  sponsorTronWeb,
} from "onchain-invoice";
import {
  executeTronSweepItem,
  type TronChainConfig,
  type SweepNodeInvoice,
} from "onchain-invoice/sweep-node";

const NILE_CHAIN_ID = "3448148188";
const DEFAULT_NILE_HOST = "https://nile.trongrid.io";
const DEFAULT_NILE_USDT = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const SWEEP_USDT = 100_300n; // 0.1003 USDT (6 decimals)

function operatorKey(): string | undefined {
  const raw = process.env.TRON_PRIVATE_KEY ?? process.env.EVM_PRIVATE_KEY;
  return raw?.replace(/^0x/, "");
}

/**
 * Live Nile test: pay USDT to a deterministic invoice EOA, sweep to sponsor wallet, assert balances.
 * Skips when TRON_PRIVATE_KEY / EVM_PRIVATE_KEY is unset (CI and local unit runs).
 */
describe("TRON EOA USDT sweep (Nile live)", function () {
  this.timeout(180_000);

  const pk = operatorKey();
  const fullHost = process.env.NILE_FULL_HOST ?? DEFAULT_NILE_HOST;
  const usdtAddress = process.env.TRON_USDT_ADDRESS ?? DEFAULT_NILE_USDT;

  before(function () {
    if (!pk) {
      this.skip();
    }
  });

  it("sweeps USDT from invoice EOA to sponsor wallet", async function () {
    const masterSecret = pk!;
    const invoiceId = keccak256(toUtf8Bytes(`sweep-test-${Date.now()}`));
    const invoiceAddress = deriveTronInvoiceAddress(masterSecret, NILE_CHAIN_ID, invoiceId, fullHost);

    const chain: TronChainConfig = {
      id: NILE_CHAIN_ID,
      type: "tron",
      fullHost,
      privateKey: masterSecret,
      invoiceMasterSecret: masterSecret,
      sweepMode: "eoa",
      energyMode: "burn",
      batchSweepThresholdUsd: 0,
      minDelegateEnergy: 65_000,
      feeLimit: 150_000_000,
      tokens: [{ symbol: "USDT", address: usdtAddress, decimals: 6, priceUsd: 1 }],
    };

    const operator = makeTron(fullHost, masterSecret);
    const sponsor = sponsorBase58(sponsorTronWeb({ fullHost, sponsorPrivateKey: masterSecret, energyMode: "burn" }));
    expect(sponsor).to.equal(operator.address);

    const trc20 = operator.tronWeb.contract(TRON_ERC20_ABI as never, usdtAddress);
    await waitTron(
      operator.tronWeb,
      await trc20.transfer(invoiceAddress, SWEEP_USDT.toString()).send({ feeLimit: 150_000_000 })
    );

    const invoiceUsdtBefore = await readTronTokenBalance(operator.tronWeb, invoiceAddress, usdtAddress);
    expect(invoiceUsdtBefore).to.equal(SWEEP_USDT);

    const sponsorUsdtBeforeSweep = await readTronTokenBalance(operator.tronWeb, sponsor, usdtAddress);

    const invoice: SweepNodeInvoice = {
      chainId: NILE_CHAIN_ID,
      invoiceId,
      invoiceAddress,
      data: "0x" + "aa".repeat(32),
      token: usdtAddress,
      amount: SWEEP_USDT.toString(),
      minAmount: SWEEP_USDT.toString(),
    };

    const sweep = await executeTronSweepItem(chain, {
      invoice,
      token: usdtAddress,
      balance: SWEEP_USDT,
      usdValue: 0.1003,
    });

    expect(sweep.txId).to.match(/^[0-9a-f]{64}$/i);
    expect(sweep.amount).to.equal(SWEEP_USDT);
    expect(sweep.token).to.equal(usdtAddress);

    await waitTron(operator.tronWeb, sweep.txId);

    const invoiceUsdtAfter = await readTronTokenBalance(operator.tronWeb, invoiceAddress, usdtAddress);
    const sponsorUsdtAfter = await readTronTokenBalance(operator.tronWeb, sponsor, usdtAddress);

    expect(invoiceUsdtAfter).to.equal(0n);
    expect(sponsorUsdtAfter - sponsorUsdtBeforeSweep).to.equal(SWEEP_USDT);
  });
});
