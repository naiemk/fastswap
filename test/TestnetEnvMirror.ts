import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "chai";

const ROOT = process.cwd();
const CONFIG_PATH = join(ROOT, "FastSwapConfig.testnet.yaml");
const ENV_EXAMPLE_PATH = join(ROOT, ".env.testnet.example");
const DOCKER_ENV_EXAMPLE_PATH = join(ROOT, "docker/compose/.env.example");

const ENV_PLACEHOLDER_RE = /\$\{([A-Z0-9_]+)\}/g;

function collectEnvPlaceholders(text: string): Set<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(ENV_PLACEHOLDER_RE)) {
    names.add(match[1]);
  }
  return names;
}

function parseEnvExampleKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    keys.add(trimmed.slice(0, eq));
  }
  return keys;
}

describe(".env.testnet.example mirror", function () {
  it("documents every ${...} placeholder used by FastSwapConfig.testnet.yaml", function () {
    const configText = readFileSync(CONFIG_PATH, "utf8");
    const envText = readFileSync(ENV_EXAMPLE_PATH, "utf8");
    const required = collectEnvPlaceholders(configText);
    const documented = parseEnvExampleKeys(envText);

    const missing = [...required].filter((name) => !documented.has(name)).sort();
    expect(missing, `missing from .env.testnet.example: ${missing.join(", ")}`).to.deep.equal([]);
  });

  it("documents 2-chain RPCs, routers, and Turnstile", function () {
    const envText = readFileSync(ENV_EXAMPLE_PATH, "utf8");
    const dockerText = readFileSync(DOCKER_ENV_EXAMPLE_PATH, "utf8");
    const testnetKeys = parseEnvExampleKeys(envText);
    const dockerKeys = parseEnvExampleKeys(dockerText);

    for (const key of [
      "API_SIGNING_SECRET",
      "SWEEP_EVM_PRIVATE_KEY",
      "SWEEP_TRON_PRIVATE_KEY",
      "RELAY_EVM_PRIVATE_KEY",
      "RELAY_TRON_PRIVATE_KEY",
      "LM_PRIVATE_KEY",
    ]) {
      expect(testnetKeys.has(key), `missing ${key}`).to.equal(true);
      expect(dockerKeys.has(key), `docker missing ${key}`).to.equal(true);
    }

    expect(envText).to.include("SEPOLIA_RPC_URL");
    expect(envText).to.include("NILE_FULL_HOST");
    expect(envText).to.include("SEPOLIA_ROUTER_ADDRESS");
    expect(envText).to.include("TRON_ROUTER_ADDRESS");
    expect(envText).to.include("TURNSTILE_SITE_KEY");
    expect(envText).to.include("TURNSTILE_SECRET_KEY");
    expect(envText).to.include("FASTSWAP_PUBLIC_URL");
  });
});
