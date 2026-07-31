import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FastSwapInvoice, FastSwapInvoiceTrackPatch } from "../../shared/types.js";
import { AuditLog } from "../../shared/audit.js";
import { verifyInvoiceSignature } from "../../shared/signing.js";
import {
  readTargetSwapState,
  relaySwapOnTarget,
  scanSwapRequested,
  type RelayChain,
} from "./index.js";
import { payoutFromNodeWallet } from "./tron-payout.js";
import type { RelayRunnerConfig } from "../../config/adapters/relay.js";

type RelayProgress = Record<string, number>;
type RelayedSet = Record<string, string[]>;

export class RelayRunner {
  private timer?: NodeJS.Timeout;
  private progress: RelayProgress = {};
  private relayedTronEoa: RelayedSet = {};
  private readonly audit: AuditLog;

  constructor(private readonly config: RelayRunnerConfig) {
    this.audit = new AuditLog(config.auditLogPath, "relay");
  }

  async start() {
    await this.loadProgress();
    await this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => console.error("[relay-node]", error));
    }, this.config.pollIntervalMs);
    console.log(`[relay-node] started (${this.config.chains.length} chain(s), poll ${this.config.pollIntervalMs}ms)`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce() {
    const chains = this.config.chains;
    await Promise.all(chains.flatMap((source) => chains.map((target) => this.relayFrom(source, target))));
    await Promise.all(
      chains
        .filter((source) => source.type === "tron" && source.nodeWalletMode)
        .flatMap((source) => chains.map((target) => this.relayFromTronEoaSource(source, target)))
    );
    await writeFile(this.config.progressPath, JSON.stringify({ cursors: this.progress, tronEoa: this.relayedTronEoa }, null, 2));
    this.audit.append("heartbeat", { payload: { message: "relay node running" } });
  }

  private async relayFrom(source: RelayChain, target: RelayChain) {
    if (source.type === "tron" && source.nodeWalletMode) return;

    const progressKey = `${source.id}->${target.id}`;
    const cursor = this.progress[progressKey] ?? (source.type === "tron" ? source.startTimestamp ?? 0 : source.startBlock ?? 0);

    let scan;
    try {
      scan = await scanSwapRequested(source, cursor);
    } catch (error) {
      this.audit.append("error", { chainId: source.id, payload: { message: String(error), stage: "scan" } });
      return;
    }

    for (const event of scan.events) {
      await this.processRelay(source, target, event.swapId, event.txHash, event.blockNumber);
    }

    this.progress[progressKey] = scan.cursor;
  }

  private async relayFromTronEoaSource(source: RelayChain, target: RelayChain) {
    const progressKey = `tron-eoa:${source.id}->${target.id}`;
    const relayed = new Set(this.relayedTronEoa[progressKey] ?? []);
    const invoices = await this.listPaidSourceInvoices(source.id);

    for (const invoice of invoices) {
      if (invoice.targetChainId !== target.id) continue;
      if (relayed.has(invoice.invoiceId)) continue;
      if (!verifyInvoiceSignature(invoice, this.config.nodeAuthSecret)) continue;
      if (invoice.status !== "paid" && invoice.status !== "relaying") continue;

      const sweepTx = invoice.sweep?.tx?.txHash ?? invoice.sweep?.sourcePayment?.txHash ?? "";
      await this.processRelay(source, target, invoice.invoiceId, sweepTx);
      relayed.add(invoice.invoiceId);
    }

    this.relayedTronEoa[progressKey] = [...relayed];
  }

  private async processRelay(
    source: RelayChain,
    target: RelayChain,
    swapId: string,
    sourceTxHash: string,
    blockNumber?: number
  ) {
    try {
      const invoice = await this.fetchInvoice(swapId);
      if (!invoice || invoice.targetChainId !== target.id) return;
      if (!verifyInvoiceSignature(invoice, this.config.nodeAuthSecret)) {
        this.audit.append("error", {
          invoiceId: swapId,
          payload: { message: "invalid invoice signature" },
        });
        return;
      }

      const state = await readTargetSwapState(target, swapId);
      if (state.relayed || state.processed) return;
      if (invoice.payout?.status === "confirmed") return;

      this.audit.append("relay.planned", {
        invoiceId: swapId,
        chainId: target.id,
        payload: { source: source.id, target: target.id, txHash: sourceTxHash },
      });

      if (sourceTxHash) {
        await this.track(swapId, {
          relay: {
            swapRequestedTx: {
              chainId: source.id,
              txHash: sourceTxHash,
              blockNumber,
              status: "confirmed",
            },
          },
        });
      }

      if (target.type === "tron" && target.nodeWalletMode) {
        const payout = await payoutFromNodeWallet(
          {
            id: target.id,
            fullHost: target.fullHost!,
            privateKey: target.privateKey,
            feeLimit: target.feeLimit,
            sponsorAddress: target.sponsorAddress,
            router: target.router,
            aggregatorSlug: target.aggregatorSlug,
            nativeSentinel: target.nativeSentinel,
            tokens: target.tokens ?? [],
          },
          invoice
        );
        const relayTx = {
          chainId: target.id,
          txHash: payout.txHash,
          status: "confirmed" as const,
        };
        await this.track(swapId, {
          status: "complete",
          relay: { status: "confirmed", tx: relayTx },
          payout: {
            status: "confirmed",
            tx: relayTx,
            token: invoice.targetToken,
            amount: payout.amount.toString(),
            recipient: invoice.recipient,
          },
        });
        this.audit.append("relay.confirmed", {
          invoiceId: swapId,
          chainId: target.id,
          txHash: payout.txHash,
          payload: { mode: "tron-node-wallet", swapped: payout.swapped },
        });
        console.log(`[relay-node] ${source.name} -> ${target.name} paid out ${swapId}`);
        return;
      }

      const relay = await relaySwapOnTarget(target, swapId, invoice.data);
      const relayTx = {
        chainId: target.id,
        txHash: relay.txHash,
        blockNumber: relay.blockNumber,
        gasUsed: relay.gasUsed,
        status: relay.status,
      };
      const patch: FastSwapInvoiceTrackPatch = {
        relay: { status: relay.status === "confirmed" ? "confirmed" : "failed", tx: relayTx },
      };
      if (relay.processed) {
        patch.status = "complete";
        patch.payout = {
          status: "confirmed",
          tx: relayTx,
          token: invoice.targetToken,
          amount: invoice.targetAmount,
          recipient: invoice.recipient,
        };
      } else {
        patch.status = "relaying";
      }
      await this.track(swapId, patch);
      this.audit.append(relay.status === "confirmed" ? "relay.confirmed" : "relay.failed", {
        invoiceId: swapId,
        chainId: target.id,
        txHash: relay.txHash,
        payload: { processed: relay.processed },
      });
      console.log(`[relay-node] ${source.name} -> ${target.name} relayed ${swapId}`);
    } catch (error) {
      this.audit.append("error", {
        invoiceId: swapId,
        txHash: sourceTxHash,
        payload: { message: String(error) },
      });
    }
  }

  private async listPaidSourceInvoices(sourceChainId: string): Promise<FastSwapInvoice[]> {
    const results: FastSwapInvoice[] = [];
    let cursor: string | undefined;
    do {
      const url = new URL(`${this.config.apiBaseUrl}/invoices`);
      url.searchParams.set("limit", "200");
      if (cursor) url.searchParams.set("cursor", cursor);
      const response = await fetch(url, { headers: { "x-api-key": this.config.nodeAuthSecret } });
      if (!response.ok) break;
      const body = (await response.json()) as {
        invoices?: Array<{ invoice: FastSwapInvoice }>;
        nextCursor?: string;
      };
      for (const row of body.invoices ?? []) {
        const invoice = row.invoice;
        if (invoice.sourceChainId === sourceChainId && (invoice.status === "paid" || invoice.status === "relaying")) {
          results.push(invoice);
        }
      }
      cursor = body.nextCursor;
    } while (cursor);
    return results;
  }

  private async fetchInvoice(invoiceId: string): Promise<FastSwapInvoice | undefined> {
    const response = await fetch(`${this.config.apiBaseUrl}/invoices/${encodeURIComponent(invoiceId)}`, {
      headers: { "x-api-key": this.config.nodeAuthSecret },
    });
    return response.ok ? ((await response.json()) as FastSwapInvoice) : undefined;
  }

  private async track(invoiceId: string, patch: FastSwapInvoiceTrackPatch) {
    const response = await fetch(`${this.config.apiBaseUrl}/invoices/${encodeURIComponent(invoiceId)}/track`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.nodeAuthSecret,
      },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      console.error("[relay-node] track failed", response.status, await response.text());
    }
  }

  private async loadProgress() {
    try {
      await mkdir(dirname(this.config.progressPath), { recursive: true });
      const raw: unknown = JSON.parse(await readFile(this.config.progressPath, "utf8"));
      if (raw && typeof raw === "object" && "cursors" in raw) {
        const boxed = raw as { cursors?: RelayProgress; tronEoa?: RelayedSet };
        this.progress = boxed.cursors ?? {};
        this.relayedTronEoa = boxed.tronEoa ?? {};
      } else if (raw && typeof raw === "object") {
        this.progress = raw as RelayProgress;
      }
    } catch {
      this.progress = {};
      this.relayedTronEoa = {};
    }
  }
}
