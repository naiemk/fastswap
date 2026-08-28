import { Contract, JsonRpcProvider } from "ethers";
import { TronWeb } from "tronweb";

import type { FastSwapStatus, FastSwapInvoice } from "../shared/types.js";
import {
  isTronEoaChain,
  loadFastSwapConfig,
  resolveActiveFastSwapChains,
  resolveConfigPath,
  resolveTronSweepSettings,
} from "../config/load.js";
import type { FastSwapChainDefinition, ResolvedFastSwapChain } from "../config/types.js";
import { createAggregatorClientsFromEnv, mockRoutersFromChains } from "../aggregators/index.js";
import { FastSwapServer, type FastSwapServerOptions, type InvoiceAddressSdk } from "./server.js";

import type { FastSwapConfigFile } from "../config/types.js";
import { resolveTronInvoiceMasterSecret } from "../shared/tron-secrets.js";
import {
  createCloudflareTurnstileVerifier,
  OnchainInvoiceSdk,
  TronInvoiceSdk,
  TRON_NATIVE_TOKEN,
} from "onchain-invoice";
import { FASTSWAP_RECEIVER_ABI, InvoiceStatus } from "../shared/fastswap-abi.js";
import { TRON_FASTSWAP_RECEIVER_ABI } from "../shared/tron-fastswap-abi.js";

function requireSigningSecret(config: FastSwapConfigFile): string {
  const envName = config.server.signingSecretEnv ?? "API_SIGNING_SECRET";
  const secret = process.env[envName] ?? config.server.nodeApiKey;
  if (!secret) throw new Error(`Missing ${envName} (API signing secret)`);
  return secret;
}

function resolveTronMasterSecret(chain: FastSwapChainDefinition): string {
  return resolveTronInvoiceMasterSecret(chain.sweep?.invoiceMasterSecretEnv);
}

export function buildFastSwapServerOptions(config: FastSwapConfigFile): FastSwapServerOptions {
  const resolved = resolveActiveFastSwapChains(config);
  const chains = resolved.map((entry) => entry.fastSwap);
  const captcha = config.server.captcha;
  const captchaRequired = captcha.requireForQuotes === true || captcha.requireForInvoices === true;
  if (captchaRequired && (!captcha.siteKey || !captcha.secretKey)) {
    throw new Error("Captcha is required but server.captcha.siteKey/secretKey are empty");
  }

  const invoiceSdksByChainId: Record<string, InvoiceAddressSdk> = {};
  for (const entry of resolved) {
    invoiceSdksByChainId[entry.id] = buildInvoiceSdk(entry);
  }
  const defaultChain = resolved[0];
  if (!defaultChain) throw new Error("No active chains configured");

  const turnstileVerifier =
    captcha.provider === "cloudflare-turnstile" && captcha.secretKey
      ? createCloudflareTurnstileVerifier(captcha.secretKey)
      : undefined;

  return {
    sqlitePath: config.server.sqlitePath,
    auditLogPath: config.server.auditLogPath,
    signingSecret: requireSigningSecret(config),
    invoiceSdk: invoiceSdksByChainId[defaultChain.id],
    invoiceSdksByChainId,
    chains,
    packs: config.quote.packsUsdMicros.map((usdAmountMicros: string) => ({ usdAmountMicros })),
    quoteClients: createAggregatorClientsFromEnv(process.env, {
      mockRouters: mockRoutersFromChains(config.chains),
    }),
    nodeAuthSecret: requireSigningSecret(config),
    executePlanSignerPrivateKey: process.env.EXECUTE_PLAN_SIGNER_PRIVATE_KEY,
    feeBps: BigInt(config.quote.feeBps),
    quoteTtlMs: config.quote.quoteTtlSec * 1000,
    defaultSlippageBps: 100,
    requireCaptchaForQuotes: captcha.requireForQuotes === true,
    requireCaptchaForInvoices: captcha.requireForInvoices === true,
    captchaSiteKey: captcha.siteKey,
    verifyCaptcha: turnstileVerifier
      ? (token, context) =>
          turnstileVerifier(token, {
            action: context.action === "quote" ? "session" : "registerInvoice",
            request: context.request,
          })
      : undefined,
    resolveInvoiceStatus: createStatusResolver(resolved),
  };
}

export async function startFastSwapServer(configPath?: string) {
  const config = loadFastSwapConfig(configPath);
  const options = buildFastSwapServerOptions(config);
  const server = new FastSwapServer(options);
  const address = await server.run(config.server.host, config.server.apiPort);
  const publicUrl = config.server.publicUrl ?? `http://${config.server.host}:${address.port}`;
  console.log(`[fastswap-api] listening on ${publicUrl}`);
  return { server, config, publicUrl };
}

function buildInvoiceSdk(chain: ResolvedFastSwapChain): InvoiceAddressSdk {
  if (chain.type === "tron") {
    const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl ?? "" });
    if (isTronEoaChain(chain)) {
      return new TronInvoiceSdk({
        tronWeb,
        chainId: chain.id,
        invoiceMasterSecret: resolveTronMasterSecret(chain),
        mode: "eoa",
        feeLimit: chain.feeLimit,
      });
    }
    return new TronInvoiceSdk({
      tronWeb,
      sweeperAddress: chain.contracts.sweeperAddress,
      mode: "contract",
      feeLimit: chain.feeLimit,
    });
  }
  if (chain.type === "solana") {
    throw new Error("Solana invoice SDK wiring: use onchain-invoice SolanaSdk with solanaMerchant from chain config");
  }
  const provider = new JsonRpcProvider(chain.rpcUrl);
  return new OnchainInvoiceSdk({ provider, sweeperAddress: chain.contracts.sweeperAddress });
}

function createStatusResolver(chains: ResolvedFastSwapChain[]) {
  const yamlById = new Map(chains.map((c) => [c.id, c]));
  const sdks = new Map(
    chains.filter((c) => c.type === "tron" && isTronEoaChain(c)).map((c) => [c.id, buildInvoiceSdk(c) as TronInvoiceSdk])
  );
  return async (invoice: FastSwapInvoice): Promise<FastSwapStatus | undefined> => {
    const source = yamlById.get(invoice.sourceChainId);
    if (!source) return invoice.status;

    const paid = await readSourcePayment(source, invoice, sdks.get(source.id));
    if (paid === 0n) return "waiting_payment";

    const sourceStatus = await readSourceInvoiceStatus(source, invoice.invoiceId);
    if (sourceStatus === InvoiceStatus.Executed) return "complete";
    if (sourceStatus === InvoiceStatus.Refunded) return "refunded";
    if (invoice.execute?.status === "submitted" || invoice.status === "bridging") return "bridging";
    if (invoice.status === "executing") return "executing";
    if (paid > 0n) return "paid";
    return invoice.status;
  };
}

async function readSourcePayment(
  chain: ResolvedFastSwapChain,
  invoice: FastSwapInvoice,
  eoaSdk?: TronInvoiceSdk
): Promise<bigint> {
  if (chain.type === "tron" && isTronEoaChain(chain)) {
    const sdk =
      eoaSdk ??
      new TronInvoiceSdk({
        tronWeb: new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl ?? "" }),
        chainId: chain.id,
        invoiceMasterSecret: resolveTronMasterSecret(chain),
        mode: "eoa",
      });
    const token = invoice.token ?? invoice.sourceToken ?? TRON_NATIVE_TOKEN;
    const balance = await sdk.getBalance(invoice.invoiceAddress, token);
    const minAmount = BigInt(invoice.amount || invoice.sourceAmount || "1");
    return balance >= minAmount ? balance : 0n;
  }
  if (chain.type === "tron") {
    const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl ?? "" });
    const contract = await tronWeb.contract(TRON_FASTSWAP_RECEIVER_ABI as never, chain.contracts.fastSwapAddress);
    const payment = await contract.invoicePayment(invoice.invoiceId).call();
    return BigInt(payment.amount.toString());
  }
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const contract = new Contract(
    chain.contracts.fastSwapAddress,
    ["function invoicePayment(bytes32 invoiceId) view returns (address token,uint256 amount,address forwarder)"],
    provider
  );
  const payment = await contract.invoicePayment(invoice.invoiceId);
  return BigInt(payment.amount.toString());
}

async function readSourceInvoiceStatus(chain: ResolvedFastSwapChain, invoiceId: string): Promise<number> {
  if (chain.type === "tron" && isTronEoaChain(chain)) {
    return InvoiceStatus.Paid;
  }
  if (chain.type === "tron") {
    const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl ?? "" });
    const contract = await tronWeb.contract(TRON_FASTSWAP_RECEIVER_ABI as never, chain.contracts.fastSwapAddress);
    const record = await contract.invoiceRecord(invoiceId).call();
    return Number(record.status);
  }
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const contract = new Contract(chain.contracts.fastSwapAddress, FASTSWAP_RECEIVER_ABI, provider);
  const [status] = await contract.invoiceStatus(invoiceId);
  return Number(status);
}

export const DEFAULT_MAIN_CONFIG = resolveConfigPath();
