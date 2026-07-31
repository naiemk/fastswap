#!/usr/bin/env node
import { loadFastSwapConfig, resolveConfigPath } from "../../config/load.js";
import { toRelayRunnerConfig } from "../../config/adapters/relay.js";
import { RelayRunner } from "./runner.js";
import { applyOperatorEnvDefaults } from "../../cli/bootstrap.js";

const args = process.argv.slice(2);
const configPath = args.find((a) => !a.startsWith("-")) ?? resolveConfigPath();
const once = args.includes("--once");

applyOperatorEnvDefaults();
const config = loadFastSwapConfig(configPath);
const runner = new RelayRunner(toRelayRunnerConfig(config));

const stop = (code = 0) => {
  runner.stop();
  process.exit(code);
};

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

if (once) {
  void runner
    .runOnce()
    .then(() => stop(0))
    .catch((error) => {
      console.error("[relay-node]", error);
      stop(1);
    });
} else {
  await runner.start();
}
