import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "chai";

const ROOT = process.cwd();
const COMPOSE_PATH = join(ROOT, "docker/compose/testnet.yml");
const CONFIG_PATH = join(ROOT, "FastSwapConfig.testnet.yaml");

const ENV_PLACEHOLDER_RE = /\$\{([A-Z0-9_]+)\}/g;

function collectPlaceholders(text: string): Set<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(ENV_PLACEHOLDER_RE)) {
    names.add(match[1]);
  }
  return names;
}

describe("docker/compose/testnet.yml", function () {
  it("mounts FastSwapConfig.testnet.yaml and passes chain env to every service", function () {
    const compose = readFileSync(COMPOSE_PATH, "utf8");
    const configText = readFileSync(CONFIG_PATH, "utf8");
    const chainsMarker = "\nchains:";
    const chainSection = configText.slice(configText.indexOf(chainsMarker) + 1);
    const chainPlaceholders = collectPlaceholders(chainSection);

    expect(compose).to.include("FastSwapConfig.testnet.yaml:/config/FastSwapConfig.yaml:ro");
    expect(compose).to.include("fastswap-testnet");

    for (const service of ["api:", "sweep:", "relay:", "liqman:"]) {
      expect(compose).to.include(service);
    }

    for (const name of chainPlaceholders) {
      expect(compose, `compose missing ${name}`).to.include(`${name}:`);
    }
  });
});
