import { expect } from "chai";
import { network } from "hardhat";
import { ethers as ethersLib, keccak256, toUtf8Bytes } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FastSwapServer } from "../server/server.js";
import { OnchainInvoiceSdk } from "onchain-invoice";

describe("FastSwap end-to-end", function () {
  it("creates a quote, creates an invoice, sweeps payment, and executes via adapter", async function () {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & {
      ethers: any;
    };
    const [owner, payer, recipient, sink] = await ethers.getSigners();

    const FastSwap = await ethers.getContractFactory("FastSwapReceiver");
    const implementation = await FastSwap.deploy();
    const Proxy = await ethers.getContractFactory("ReceiverProxy");
    const proxy = await Proxy.deploy(
      await implementation.getAddress(),
      FastSwap.interface.encodeFunctionData("initialize", [owner.address])
    );
    const fastSwap = await ethers.getContractAt("FastSwapReceiver", await proxy.getAddress());

    const MockAdapter = await ethers.getContractFactory("MockAdapter");
    const mockAdapter = await MockAdapter.deploy(await fastSwap.getAddress(), await sink.getAddress());
    const adapterId = keccak256(toUtf8Bytes("mock"));
    await fastSwap.setAdapter(adapterId, await mockAdapter.getAddress());

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
          id: "1",
          type: "evm",
          name: "Source",
          nativeSymbol: "ETH",
          sweeperAddress: await sweeper.getAddress(),
          fastSwapAddress: await fastSwap.getAddress(),
          explorerUrl: "",
          tokens: [{ symbol: "ETH", chainId: "1", decimals: 18, isNative: true, priceUsdMicros: "2000000000" }],
        },
        {
          id: "2",
          type: "evm",
          name: "Target",
          nativeSymbol: "ETH",
          sweeperAddress: await sweeper.getAddress(),
          fastSwapAddress: await fastSwap.getAddress(),
          explorerUrl: "",
          tokens: [{ symbol: "ETH", chainId: "2", decimals: 18, isNative: true }],
        },
      ],
    });
    const address = await server.run("127.0.0.1", 0);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const quote = await postJson(`${baseUrl}/quotes`, {
        sourceChainId: "1",
        sourceToken: ethersLib.ZeroAddress,
        targetChainId: "2",
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
      await fastSwap.execute(invoice.invoiceId, adapterId, routeData, 1n);

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
