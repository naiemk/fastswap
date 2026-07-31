#!/usr/bin/env node
import { loadFastSwapConfig, resolveConfigPath } from "../config/load.js";
import { toSweepNodeConfig } from "../config/adapters/sweep.js";
import { resolveApiBaseUrl } from "../shared/api-base.js";
import { SweepNode } from "onchain-invoice/sweep-node";
import { applyOperatorEnvDefaults } from "../cli/bootstrap.js";

const args = process.argv.slice(2);
const configPath = args.find((a) => !a.startsWith("-")) ?? resolveConfigPath();
const once = args.includes("--once");

applyOperatorEnvDefaults();
const fastswap = loadFastSwapConfig(configPath);
const sweepConfig = toSweepNodeConfig(fastswap, resolveApiBaseUrl(fastswap));

const node = new SweepNode(sweepConfig);

const stop = (code = 0) => {
  node.stop();
  process.exit(code);
};

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

if (once) {
  void node
    .runOnce()
    .then(() => stop(0))
    .catch((error) => {
      console.error("[sweep-node]", error);
      stop(1);
    });
} else {
  node.start();
}
