import { expect } from "chai";
import { ethers as ethersLib, keccak256, toUtf8Bytes } from "ethers";
import { network } from "hardhat";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FastSwapServer } from "../../server/server.js";
import type { FastSwapInvoice, FastSwapStatus } from "../../shared/types.js";
import { OnchainInvoiceSdk } from "onchain-invoice";
import { InvoiceStatus } from "../../shared/fastswap-abi.js";
import { signTestExecutePlan } from "../helpers/execute-plan.js";

const NODE_KEY = "system-test-node";

describe("FastSwap system API (end-to-end)", function () {
  this.timeout(120_000);

  async function deployStack(ethers: any) {
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
    const mockAdapter = await MockAdapter.deploy(await fastSwap.getAddress(), owner.address, await sink.getAddress());
    const adapterId = keccak256(toUtf8Bytes("mock"));
    await fastSwap.setAdapter(adapterId, await mockAdapter.getAddress());
    await fastSwap.setTreasury(owner.address);
    const relayerRole = await fastSwap.RELAYER_ROLE();
    await fastSwap.grantRole(relayerRole, owner.address);
    const Sweeper = await ethers.getContractFactory("InvoiceSweeper");
    const sweeper = await Sweeper.deploy(await fastSwap.getAddress());
    return { owner, payer, recipient, sink, fastSwap, sweeper, adapterId };
  }

  it("creates invoice via API, pays, sweeps, executes, and GET invoice shows completion", async function () {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & { ethers: any };
    const { owner, payer, recipient, sink, fastSwap, sweeper, adapterId } = await deployStack(ethers);
    const sourceChainId = String((await ethers.provider.getNetwork()).chainId);
    const destChainId = String(Number(sourceChainId) + 1);

    const directory = await mkdtemp(join(tmpdir(), "fastswap-system-api-"));
    const invoiceSdk = new OnchainInvoiceSdk({
      provider: ethers.provider,
      sweeperAddress: await sweeper.getAddress(),
    });

    const server = new FastSwapServer({
      sqlitePath: join(directory, "fastswap.sqlite"),
      nodeApiKey: NODE_KEY,
      invoiceSdk,
      invoiceSdksByChainId: { [sourceChainId]: invoiceSdk, [destChainId]: invoiceSdk },
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
      resolveInvoiceStatus: async (inv: FastSwapInvoice): Promise<FastSwapStatus> => {
        const payment = await fastSwap.invoicePayment(inv.invoiceId);
        if ((payment.amount as bigint) === 0n) return "waiting_payment";
        const record = await fastSwap.invoiceRecord(inv.invoiceId);
        if (Number(record.status) === InvoiceStatus.Executed) return "complete";
        if (Number(record.status) === InvoiceStatus.Paid) return "paid";
        return inv.status;
      },
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

      await (await payer.sendTransaction({ to: invoice.invoiceAddress, value: BigInt(invoice.amount) })).wait();
      await (await sweeper.sweepEth(invoice.invoiceId, invoice.data)).wait();

      const routeData = ethersLib.AbiCoder.defaultAbiCoder().encode(["address", "bytes"], [ethersLib.ZeroAddress, "0x"]);
      const record = await fastSwap.invoiceRecord(invoice.invoiceId);
      const signature = await signTestExecutePlan({
        signer: owner,
        fastSwap,
        invoiceId: invoice.invoiceId,
        adapterId,
        routeData,
        minAmountOut: record.intent.minAmountOut,
      });
      await (await fastSwap.execute(invoice.invoiceId, adapterId, routeData, signature)).wait();

      const fetched = await getInvoice(baseUrl, invoice.invoiceId);
      expect(fetched.status).to.equal("complete");
      expect(await sink.provider.getBalance(await sink.getAddress())).to.be.gt(0n);
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("executes ERC20 source payment through mock adapter", async function () {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & { ethers: any };
    const { owner, payer, recipient, sink, fastSwap, sweeper, adapterId } = await deployStack(ethers);
    const sourceChainId = String((await ethers.provider.getNetwork()).chainId);
    const destChainId = String(Number(sourceChainId) + 1);

    const Token = await ethers.getContractFactory("MockERC20");
    const sourceToken = await Token.deploy("Source Coin", "SRC", 18);
    const sourceAddr = await sourceToken.getAddress();
    await (await sourceToken.mint(payer.address, ethersLib.parseEther("100"))).wait();

    const directory = await mkdtemp(join(tmpdir(), "fastswap-system-api-erc20-"));
    const invoiceSdk = new OnchainInvoiceSdk({
      provider: ethers.provider,
      sweeperAddress: await sweeper.getAddress(),
    });

    const server = new FastSwapServer({
      sqlitePath: join(directory, "fastswap.sqlite"),
      nodeApiKey: NODE_KEY,
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
          tokens: [
            { symbol: "SRC", chainId: sourceChainId, decimals: 18, address: sourceAddr, priceUsdMicros: "1000000" },
          ],
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
        sourceToken: sourceAddr,
        targetChainId: destChainId,
        targetToken: ethersLib.ZeroAddress,
        recipient: recipient.address,
        sourceAmount: ethersLib.parseEther("1").toString(),
      });

      const invoice = await postJson(`${baseUrl}/invoices`, { quoteId: quote.quoteId });
      await (await sourceToken.connect(payer).transfer(invoice.invoiceAddress, BigInt(invoice.amount))).wait();
      await (await sweeper.sweepToken(invoice.invoiceId, sourceAddr, invoice.data)).wait();

      const routeData = ethersLib.AbiCoder.defaultAbiCoder().encode(["address", "bytes"], [ethersLib.ZeroAddress, "0x"]);
      const record = await fastSwap.invoiceRecord(invoice.invoiceId);
      const signature = await signTestExecutePlan({
        signer: owner,
        fastSwap,
        invoiceId: invoice.invoiceId,
        adapterId,
        routeData,
        minAmountOut: record.intent.minAmountOut,
      });
      await (await fastSwap.execute(invoice.invoiceId, adapterId, routeData, signature)).wait();
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
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

async function getInvoice(baseUrl: string, invoiceId: string): Promise<FastSwapInvoice> {
  const response = await fetch(`${baseUrl}/invoices/${encodeURIComponent(invoiceId)}`);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json() as Promise<FastSwapInvoice>;
}
