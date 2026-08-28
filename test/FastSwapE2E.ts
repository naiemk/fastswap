import { expect } from "chai";
import { network } from "hardhat";
import { ethers as ethersLib, keccak256, toUtf8Bytes } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FastSwapServer } from "../server/server.js";
import { OnchainInvoiceSdk } from "onchain-invoice";
import { signTestExecutePlan } from "./helpers/execute-plan.js";
import { destFieldsFromIntentData } from "./helpers/intent.js";

describe("FastSwap end-to-end", function () {
  it("creates a quote, creates an invoice, sweeps payment, and executes via adapter", async function () {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & {
      ethers: any;
    };
    const [owner, payer, recipient, sink] = await ethers.getSigners();
    const sourceChainId = String((await ethers.provider.getNetwork()).chainId);
    const destChainId = String(Number(sourceChainId) + 1);

    const FastSwap = await ethers.getContractFactory("FastSwapReceiver");
    const implementation = await FastSwap.deploy();
    const Proxy = await ethers.getContractFactory("ReceiverProxy");
    const proxy = await Proxy.deploy(
      await implementation.getAddress(),
      FastSwap.interface.encodeFunctionData("initialize(address,uint16)", [owner.address, 75])
    );
    const fastSwap = await ethers.getContractAt("FastSwapReceiver", await proxy.getAddress());

    const MockAdapter = await ethers.getContractFactory("MockAdapter");
    const mockAdapter = await MockAdapter.deploy(await fastSwap.getAddress(), owner.address, await sink.getAddress());
    const adapterId = keccak256(toUtf8Bytes("mock"));
    await fastSwap.setAdapter(adapterId, await mockAdapter.getAddress());
    await fastSwap.setTreasury(owner.address);
    const relayerRole = await fastSwap.RELAYER_ROLE();
    await fastSwap.grantRole(relayerRole, owner.address);

    const Sweeper = await ethers.getContractFactory("InvoiceSweeper");
    const sweeper = await Sweeper.deploy(await fastSwap.getAddress());

    const directory = await mkdtemp(join(tmpdir(), "fastswap-e2e-"));
    const invoiceSdk = new OnchainInvoiceSdk({
      provider: ethers.provider,
      sweeperAddress: await sweeper.getAddress(),
    });

    const server = new FastSwapServer({
      sqlitePath: join(directory, "fastswap.sqlite"),
      invoiceSdk,
      chains: [
        {
          id: sourceChainId,
          type: "evm",
          name: "Source",
          nativeSymbol: "ETH",
          sweeperAddress: await sweeper.getAddress(),
          fastSwapAddress: await fastSwap.getAddress(),
          explorerUrl: "",
          tokens: [{ symbol: "ETH", chainId: sourceChainId, decimals: 18, isNative: true, priceUsdMicros: "2000000000" }],
        },
        {
          id: destChainId,
          type: "evm",
          name: "Target",
          nativeSymbol: "ETH",
          sweeperAddress: await sweeper.getAddress(),
          fastSwapAddress: await fastSwap.getAddress(),
          explorerUrl: "",
          tokens: [{ symbol: "ETH", chainId: destChainId, decimals: 18, isNative: true }],
        },
      ],
    });
    const address = await server.run("127.0.0.1", 0);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const quote = await postJson(`${baseUrl}/quotes`, {
        sourceChainId,
        sourceToken: ethersLib.ZeroAddress,
        targetChainId: destChainId,
        targetToken: ethersLib.ZeroAddress,
        recipient: recipient.address,
        usdPack: 10,
      });
      const invoice = await postJson(`${baseUrl}/invoices`, { quoteId: quote.quoteId });

      await payer.sendTransaction({ to: invoice.invoiceAddress, value: BigInt(invoice.amount) });
      await sweeper.sweepEth(invoice.invoiceId, invoice.data);

      const record = await fastSwap.invoiceRecord(invoice.invoiceId);
      expect(record.status).to.equal(1n);

      const routeData = ethersLib.AbiCoder.defaultAbiCoder().encode(["address", "bytes"], [ethersLib.ZeroAddress, "0x"]);
      const recordBefore = await fastSwap.invoiceRecord(invoice.invoiceId);
      const dest = destFieldsFromIntentData(invoice.data);
      const signature = await signTestExecutePlan({
        signer: owner,
        fastSwap,
        invoiceId: invoice.invoiceId,
        adapterId,
        routeData,
        minAmountOut: recordBefore.minAmountOut,
      });
      await fastSwap.execute(
        invoice.invoiceId,
        adapterId,
        routeData,
        dest.destChainId,
        dest.destToken,
        dest.recipient,
        signature
      );

      const executed = await fastSwap.invoiceRecord(invoice.invoiceId);
      expect(executed.status).to.equal(2n);
      expect(await sink.provider.getBalance(await sink.getAddress())).to.be.gt(0n);
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function postJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
