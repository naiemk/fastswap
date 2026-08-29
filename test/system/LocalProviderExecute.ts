import { expect } from "chai";
import { Contract, JsonRpcProvider, Wallet, ZeroAddress } from "ethers";
import { network } from "hardhat";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SweepNode } from "onchain-invoice/sweep-node";
import { OnchainInvoiceSdk } from "onchain-invoice";
import { FastSwapServer } from "../../server/server.js";
import { ExecuteRunner } from "../../nodes/execute-node/runner.js";
import { attachFastSwapSweepHooks } from "../../nodes/sweep-hooks.js";
import { createAggregatorClients } from "../../aggregators/index.js";
import { InvoiceStatus } from "../../shared/fastswap-abi.js";
import {
  applyLocalOperatorEnv,
  deployLocalFastSwapChain,
  LOCAL_OPERATOR_PRIVATE_KEY,
} from "../../scripts/local-stack.js";

const HOST = "127.0.0.1";
const DEST_CHAIN_ID = "202";
const FEE_BPS = 75n;
const NODE_SECRET = "local-provider-execute-secret";

describe("dev:local Execute into a Local Provider Router", function () {
  this.timeout(120_000);

  it("pays, Sweep and Execute workers run, Router accepts, Invoice reaches complete", async function () {
    const jsonRpc = await network.createServer(undefined, HOST, 0);
    const listening = await jsonRpc.listen();
    const rpcUrl = `http://${HOST}:${listening.port}`;
    const directory = await mkdtemp(join(tmpdir(), "fastswap-local-execute-"));
    let server: FastSwapServer | undefined;
    let sweep: SweepNode | undefined;
    let execute: ExecuteRunner | undefined;
    let provider: JsonRpcProvider | undefined;

    try {
      applyLocalOperatorEnv(["alice"]);
      const probe = new JsonRpcProvider(rpcUrl);
      const sourceChainId = String((await probe.getNetwork()).chainId);
      probe.destroy();

      const deployed = await deployLocalFastSwapChain({
        key: "alice",
        id: sourceChainId,
        name: "AliceChain",
        rpcUrl,
        stableSymbol: "DumUSDT",
        feeBps: Number(FEE_BPS),
      });

      provider = new JsonRpcProvider(rpcUrl, Number(sourceChainId), { staticNetwork: true });
      const payer = new Wallet(LOCAL_OPERATOR_PRIVATE_KEY, provider);
      const recipient = Wallet.createRandom();
      const mockClients = createAggregatorClients({
        mockRouters: { [sourceChainId]: deployed.router },
      });
      const invoiceSdk = new OnchainInvoiceSdk({
        provider,
        sweeperAddress: deployed.sweeper,
      });

      server = new FastSwapServer({
        sqlitePath: join(directory, "fastswap.sqlite"),
        signingSecret: NODE_SECRET,
        nodeAuthSecret: NODE_SECRET,
        executePlanSignerPrivateKey: LOCAL_OPERATOR_PRIVATE_KEY,
        invoiceSdk,
        quoteClients: mockClients,
        feeBps: FEE_BPS,
        quoteTtlMs: 90_000,
        chains: [
          {
            id: sourceChainId,
            type: "evm",
            name: "AliceChain",
            nativeSymbol: "ETH",
            sweeperAddress: deployed.sweeper,
            fastSwapAddress: deployed.fastSwap,
            explorerUrl: "",
            tokens: [
              {
                symbol: "ETH",
                chainId: sourceChainId,
                decimals: 18,
                isNative: true,
                priceUsdMicros: "2000000000",
              },
            ],
          },
          {
            id: DEST_CHAIN_ID,
            type: "evm",
            name: "BobChain",
            nativeSymbol: "ETH",
            sweeperAddress: deployed.sweeper,
            fastSwapAddress: deployed.fastSwap,
            explorerUrl: "",
            tokens: [{ symbol: "ETH", chainId: DEST_CHAIN_ID, decimals: 18, isNative: true }],
          },
        ],
        resolveInvoiceStatus: async (inv) => {
          const receiver = new Contract(
            deployed.fastSwap,
            ["function invoiceStatus(bytes32) view returns (uint8,address,uint256)"],
            provider
          );
          const [status] = await receiver.invoiceStatus(inv.invoiceId);
          if (Number(status) === InvoiceStatus.Executed) return "complete";
          if (Number(status) === InvoiceStatus.Paid) return "paid";
          if (Number(status) === InvoiceStatus.Refunded) return "refunded";
          return inv.status;
        },
      });

      const address = await server.run(HOST, 0);
      const baseUrl = `http://${HOST}:${address.port}`;

      sweep = new SweepNode(
        attachFastSwapSweepHooks(
          {
            webServer: { baseUrl, nodeApiKey: NODE_SECRET, pageLimit: 500 },
            cache: { sqlitePath: join(directory, "sweep.sqlite") },
            pollIntervalMs: 60_000,
            chains: [
              {
                id: sourceChainId,
                type: "evm",
                rpcUrl,
                privateKey: LOCAL_OPERATOR_PRIVATE_KEY,
                sweeperAddress: deployed.sweeper,
                receiverAddress: deployed.fastSwap,
                confirmations: 0,
                startBlock: 0,
                logScanOverlap: 0,
              },
            ],
          },
          NODE_SECRET
        )
      );

      execute = new ExecuteRunner({
        apiBaseUrl: baseUrl,
        nodeAuthSecret: NODE_SECRET,
        pollIntervalMs: 60_000,
        progressPath: join(directory, "execute-progress.json"),
        maxDeviationBps: 10_000n,
        clients: mockClients,
        chains: [
          {
            id: sourceChainId,
            type: "evm",
            rpcUrl,
            fastSwapAddress: deployed.fastSwap,
            privateKeyEnv: "EXECUTE_ALICE_PRIVATE_KEY",
            feeBps: FEE_BPS,
          },
        ],
      });

      const quote = await postJson(`${baseUrl}/quotes`, {
        sourceChainId,
        sourceToken: ZeroAddress,
        targetChainId: DEST_CHAIN_ID,
        targetToken: ZeroAddress,
        recipient: recipient.address,
        usdPack: 10,
      });
      expect(quote.selectedProvider).to.equal("mock");

      const invoice = await postJson(`${baseUrl}/invoices`, { quoteId: quote.quoteId });
      expect(invoice.invoiceAddress).to.match(/^0x/);

      const payTx = await payer.sendTransaction({
        to: invoice.invoiceAddress,
        value: BigInt(invoice.amount),
      });
      await payTx.wait();

      await sweep.runOnce();
      await execute.runOnce();

      const fetched = await getJson(`${baseUrl}/invoices/${encodeURIComponent(invoice.invoiceId)}`);
      expect(fetched.status).to.equal("complete");
      expect(fetched.payout?.status).to.equal("confirmed");

      const paid = BigInt(invoice.amount);
      const fee = (paid * FEE_BPS) / 10_000n;
      const routed = paid - fee;
      expect(await provider.getBalance(deployed.fastSwap)).to.equal(0n);
      expect(await provider.getBalance(deployed.router)).to.equal(routed);
    } finally {
      execute?.stop();
      sweep?.stop();
      if (server) await server.close();
      provider?.destroy();
      await jsonRpc.close();
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

async function getJson(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}
