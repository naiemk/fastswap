#!/usr/bin/env node
import { applyOperatorEnvDefaults } from "../cli/bootstrap.js";
import { startFastSwapServer, DEFAULT_MAIN_CONFIG } from "./bootstrap.js";

applyOperatorEnvDefaults();
const configPath = process.argv[2] ?? DEFAULT_MAIN_CONFIG;

const running = await startFastSwapServer(configPath);

const shutdown = async () => {
  await running.server.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
