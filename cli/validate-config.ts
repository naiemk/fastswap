import type { FastSwapConfigFile } from "../config/types.js";
import { getActiveChainDefinitions, isTronEoaChain, tryResolveChainContracts } from "../config/load.js";
import { applyTronSecretDefaults, resolveTronInvoiceMasterSecret } from "../shared/tron-secrets.js";

const PLACEHOLDER_PUBLIC_URLS = new Set(["https://api.example.com"]);

export type ValidateConfigOptions = {
  /** Allow localhost / 127.0.0.1 publicUrl (testnet local stack). */
  allowLocalPublicUrl?: boolean;
};

export type ValidateConfigResult = {
  ok: boolean;
  issues: string[];
};

function isPlaceholderPublicUrl(url: string, allowLocal: boolean): boolean {
  if (PLACEHOLDER_PUBLIC_URLS.has(url)) return true;
  if (allowLocal) return false;
  return url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:");
}

export function validateFastSwapConfig(
  config: FastSwapConfigFile,
  env: NodeJS.ProcessEnv = process.env,
  options: ValidateConfigOptions = {}
): ValidateConfigResult {
  const issues: string[] = [];

  const signingEnv = config.server.signingSecretEnv ?? "API_SIGNING_SECRET";
  const signingSecret = env[signingEnv] ?? config.server.nodeApiKey;
  if (!signingSecret) {
    issues.push(`Missing ${signingEnv}`);
  } else if (signingSecret.length < 32) {
    issues.push(`${signingEnv} should be at least 32 characters`);
  }

  if (!config.server.publicUrl || isPlaceholderPublicUrl(config.server.publicUrl, options.allowLocalPublicUrl === true)) {
    issues.push("server.publicUrl is unset or still a placeholder");
  }

  const captcha = config.server.captcha;
  const captchaRequired = captcha.requireForQuotes === true || captcha.requireForInvoices === true;
  if (captchaRequired && (!captcha.siteKey || !captcha.secretKey)) {
    issues.push("captcha is required but siteKey/secretKey are empty");
  }

  for (const key of config["active-chains"]) {
    if (!config.chains.some((chain) => chain.key === key)) {
      issues.push(`active-chains references unknown key "${key}"`);
    }
  }

  for (const chain of getActiveChainDefinitions(config)) {
    if (chain.type === "evm") {
      if (!chain.rpcUrl) issues.push(`${chain.key}: missing rpcUrl env expansion`);
      if (!chain.router) issues.push(`${chain.key}: missing router env expansion`);
    }
    if (chain.type === "tron" && !(chain.fullHost || chain.rpcUrl)) {
      issues.push(`${chain.key}: missing fullHost env expansion`);
    }

    const contracts = tryResolveChainContracts(config, chain);
    if (!contracts) {
      if (chain.type === "tron" && isTronEoaChain(chain)) {
        applyTronSecretDefaults(chain.sweep?.invoiceMasterSecretEnv);
        try {
          resolveTronInvoiceMasterSecret(chain.sweep?.invoiceMasterSecretEnv);
        } catch {
          issues.push(
            `${chain.key}: missing invoice master secret (set TRON_INVOICE_MASTER_SECRET or TRON_PRIVATE_KEY / EVM_PRIVATE_KEY)`
          );
        }
        if (!env.SWEEP_TRON_PRIVATE_KEY && !env.TRON_PRIVATE_KEY && !env.EVM_PRIVATE_KEY) {
          issues.push(`${chain.key}: missing SWEEP_TRON_PRIVATE_KEY, TRON_PRIVATE_KEY, or EVM_PRIVATE_KEY`);
        }
        continue;
      }
      issues.push(`${chain.key}: contract addresses not set`);
      continue;
    }
    if (chain.type === "evm") {
      if (!contracts.fastSwapAddress || !contracts.sweeperAddress) {
        issues.push(`${chain.key}: missing fastSwap or sweeper address`);
      }
    } else if (!isTronEoaChain(chain)) {
      if (!contracts.fastSwapAddress || !contracts.sweeperAddress) {
        issues.push(`${chain.key}: missing fastSwap or sweeper address`);
      }
    }
  }

  if (!config.deploy.createx) {
    issues.push("deploy.createx is not set");
  }

  return { ok: issues.length === 0, issues };
}
