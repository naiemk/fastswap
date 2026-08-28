#!/usr/bin/env node
import { loadFastSwapConfig, resolveConfigPath } from "../../config/load.js";
import { toExecuteNodeConfig } from "../../config/adapters/execute.js";
import { ExecuteRunner } from "./runner.js";

const configPath = process.argv.find((a) => !a.startsWith("-")) ?? resolveConfigPath();
const fastswap = loadFastSwapConfig(configPath);
const config = toExecuteNodeConfig(fastswap);

const runner = new ExecuteRunner(config);
runner.start();

process.on("SIGINT", () => {
  runner.stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  runner.stop();
  process.exit(0);
});
