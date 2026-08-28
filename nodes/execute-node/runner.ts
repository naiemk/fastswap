import { Contract, JsonRpcProvider, Wallet, type ContractRunner } from "ethers";
import type { FastSwapInvoice } from "../../shared/types.js";
import { FASTSWAP_RECEIVER_ABI } from "../../shared/fastswap-abi.js";
import { createAggregatorClients, type IAggregatorClient } from "../../aggregators/index.js";
import { routeAmountAfterFee } from "../../aggregators/compare.js";
import type { AggregatorId } from "../../shared/types.js";
import type { ExecutionPlan } from "../../aggregators/types.js";

export type ExecuteChainConfig = {
  id: string;
  type: "evm" | "tron";
  rpcUrl?: string;
  fullHost?: string;
  fastSwapAddress: string;
  privateKeyEnv: string;
  feeBps: bigint;
};

export type ExecuteRunnerConfig = {
  apiBaseUrl: string;
  nodeAuthSecret: string;
  pollIntervalMs: number;
  progressPath: string;
  auditLogPath?: string;
  maxDeviationBps?: bigint;
  chains: ExecuteChainConfig[];
  clients?: IAggregatorClient[];
};

export class ExecuteRunner {
  private timer?: NodeJS.Timeout;
  private readonly clients: IAggregatorClient[];
  private inFlight = new Set<string>();

  constructor(private readonly config: ExecuteRunnerConfig) {
    this.clients = config.clients ?? createAggregatorClients({ includeMock: true });
  }

  start() {
    void this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce().catch((e) => console.error("[execute-node]", e));
    }, this.config.pollIntervalMs);
    console.log(`[execute-node] started (${this.config.chains.length} chain(s))`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce() {
    const invoices = await this.fetchPaidInvoices();
    for (const invoice of invoices) {
      if (this.inFlight.has(invoice.invoiceId)) continue;
      this.inFlight.add(invoice.invoiceId);
      try {
        await this.processInvoice(invoice);
      } catch (error) {
        console.error("[execute-node] invoice failed", invoice.invoiceId, error);
      } finally {
        this.inFlight.delete(invoice.invoiceId);
      }
    }
  }

  private async fetchPaidInvoices(): Promise<FastSwapInvoice[]> {
    const response = await fetch(`${this.config.apiBaseUrl.replace(/\/$/, "")}/invoices/paid`, {
      headers: { "x-api-key": this.config.nodeAuthSecret },
    });
    if (!response.ok) throw new Error(`fetch invoices: ${response.status}`);
    return (await response.json()) as FastSwapInvoice[];
  }

  private async processInvoice(invoice: FastSwapInvoice) {
    const chain = this.config.chains.find((c) => c.id === invoice.sourceChainId);
    if (!chain) return;

    const paidAmount = BigInt(invoice.sweep?.paymentAmount ?? invoice.amount ?? invoice.sourceAmount);
    const routeAmount = routeAmountAfterFee(paidAmount, chain.feeBps);

    const quoteReq = {
      sourceChainId: invoice.sourceChainId,
      sourceToken: invoice.sourceToken,
      sourceAmount: routeAmount.toString(),
      destChainId: invoice.targetChainId,
      destToken: invoice.targetToken,
      recipient: invoice.recipient,
      refundAddress: invoice.refundAddress,
      slippageBps: invoice.slippageBps,
      preferredProvider: invoice.selectedProvider,
    };

    const client = this.clients.find((c) => c.id === invoice.selectedProvider) ?? this.clients[0];
    const liveQuote = await client.quote(quoteReq);
    const quotedMin = BigInt(invoice.targetAmount);
    const liveDest = BigInt(liveQuote.destAmountOut);
    const maxDev = this.config.maxDeviationBps ?? 100n;
    const deviationFloor = (quotedMin * (10_000n - maxDev)) / 10_000n;
    if (liveDest < deviationFloor) {
      console.warn("[execute-node] live dest below deviation floor — refunding", invoice.invoiceId, {
        liveDest: liveDest.toString(),
        deviationFloor: deviationFloor.toString(),
      });
      if (planKindSupportsRefund(chain)) {
        await this.refund(chain, invoice.invoiceId);
      }
      return;
    }

    const plan = await client.buildExecution(quoteReq, liveQuote, {
      fromAddress: chain.fastSwapAddress,
      actualSourceAmount: routeAmount.toString(),
      slippageBps: invoice.slippageBps,
    });

    await this.patchTrack(invoice.invoiceId, { status: "executing" });

    let execTxHash: string | undefined;
    if (plan.kind === "evm-contract") {
      execTxHash = (await this.executeEvm(chain, invoice.invoiceId, plan)).txHash;
    } else if (plan.kind === "tron-contract") {
      console.warn("[execute-node] TRON contract execute not wired — skipping", invoice.invoiceId);
      return;
    } else if (plan.kind === "tron-eoa") {
      console.warn("[execute-node] TRON EOA path disabled — no custodial bridging", invoice.invoiceId);
      return;
    }

    const status = await client.watch({
      txHash: execTxHash,
      requestId: liveQuote.providerQuoteId,
      chainId: invoice.sourceChainId,
    });

    if (status.state === "dest_confirmed") {
      await this.patchTrack(invoice.invoiceId, { status: "complete", payout: { status: "confirmed" } });
    } else if (status.state === "failed") {
      await this.patchTrack(invoice.invoiceId, { status: "failed", execute: { status: "failed", error: status.message } });
    } else {
      await this.patchTrack(invoice.invoiceId, { status: "bridging" });
    }
  }

  private async fetchExecuteSignature(
    invoiceId: string,
    adapterId: string,
    routeData: string,
    minAmountOut: string
  ): Promise<string> {
    const response = await fetch(
      `${this.config.apiBaseUrl.replace(/\/$/, "")}/invoices/${encodeURIComponent(invoiceId)}/execute-plan`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.config.nodeAuthSecret,
        },
        body: JSON.stringify({ adapterId, routeData, minAmountOut }),
      }
    );
    if (!response.ok) throw new Error(`execute-plan: ${response.status} ${await response.text()}`);
    const body = (await response.json()) as { signature: string };
    return body.signature;
  }

  private async executeEvm(
    chain: ExecuteChainConfig,
    invoiceId: string,
    plan: ExecutionPlan & { kind: "evm-contract" }
  ): Promise<{ txHash: string }> {
    const pk = process.env[chain.privateKeyEnv];
    if (!pk) throw new Error(`Missing ${chain.privateKeyEnv}`);
    const provider = new JsonRpcProvider(chain.rpcUrl);
    const wallet = new Wallet(pk, provider) as unknown as ContractRunner;
    const contract = new Contract(chain.fastSwapAddress, FASTSWAP_RECEIVER_ABI, wallet);
    const signature = await this.fetchExecuteSignature(invoiceId, plan.adapterId, plan.routeData, plan.minAmountOut);
    const tx = await contract.execute(invoiceId, plan.adapterId, plan.routeData, signature);
    const receipt = await tx.wait();
    await this.patchTrack(invoiceId, {
      execute: {
        status: "confirmed",
        provider: plan.adapterId as unknown as AggregatorId,
        tx: { chainId: chain.id, txHash: receipt.hash, status: "confirmed" },
      },
    });
    return { txHash: receipt.hash };
  }

  private async refund(chain: ExecuteChainConfig, invoiceId: string) {
    if (chain.type !== "evm") {
      console.warn("[execute-node] refund not wired for chain type", chain.id);
      return;
    }
    const pk = process.env[chain.privateKeyEnv];
    if (!pk) throw new Error(`Missing ${chain.privateKeyEnv}`);
    const provider = new JsonRpcProvider(chain.rpcUrl);
    const wallet = new Wallet(pk, provider) as unknown as ContractRunner;
    const contract = new Contract(chain.fastSwapAddress, FASTSWAP_RECEIVER_ABI, wallet);
    const tx = await contract.refund(invoiceId);
    await tx.wait();
    await this.patchTrack(invoiceId, { status: "refunded" });
  }

  private async patchTrack(invoiceId: string, patch: Record<string, unknown>) {
    await fetch(`${this.config.apiBaseUrl.replace(/\/$/, "")}/invoices/${encodeURIComponent(invoiceId)}/track`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.nodeAuthSecret,
      },
      body: JSON.stringify(patch),
    });
  }
}

function planKindSupportsRefund(chain: ExecuteChainConfig): boolean {
  return chain.type === "evm" && Boolean(chain.fastSwapAddress);
}
