#!/usr/bin/env node
/**
 * Prod-mirror E2E matrix (T1–T5) for FastSwapConfig.testnet.yaml.
 *
 *   npm run fastswap:e2e-matrix
 *   npm run fastswap:e2e-matrix -- --only T1,T2
 */
import { resolveConfigPath } from "../config/load.js";
import { applyOperatorEnvDefaults } from "./bootstrap.js";
import { runCrossChainE2ENodes } from "./testnet-e2e-nodes.js";
import { runTestnetSmokePair } from "./testnet-smoke.js";

import { E2E_MATRIX } from "./e2e-matrix-cases.js";
import type { E2EMatrixCase } from "./e2e-matrix-cases.js";

export type RunE2EMatrixOptions = {
  only?: string[];
};

export async function runE2EMatrix(configPath: string, options: RunE2EMatrixOptions = {}) {
  applyOperatorEnvDefaults();
  const only = options.only?.length ? new Set(options.only) : undefined;
  const cases = E2E_MATRIX.filter((c) => !only || only.has(c.id));

  if (cases.length === 0) {
    throw new Error(`No matrix cases matched: ${options.only?.join(", ") ?? "(empty)"}`);
  }

  console.log(`\n=== FastSwap E2E matrix (${cases.length} case(s)) ===\n`);

  for (const testCase of cases) {
    console.log(`── ${testCase.id}: ${testCase.label} ──`);
    if (testCase.mode === "nodes") {
      await runCrossChainE2ENodes(configPath, {
        sourceKey: testCase.sourceKey,
        targetKey: testCase.targetKey === "*" ? undefined : testCase.targetKey,
      });
    } else {
      await runTestnetSmokePair(configPath, {
        sourceKey: testCase.sourceKey,
        targetKey: testCase.targetKey,
        sendSymbol: testCase.sendSymbol,
        recvSymbol: testCase.recvSymbol,
      });
    }
    console.log(`✓ ${testCase.id} passed\n`);
  }

  console.log("✓ E2E matrix complete\n");
}

async function main() {
  const configPath = resolveConfigPath(readFlag("--config"));
  const onlyArg = readFlag("--only");
  const only = onlyArg ? onlyArg.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  await runE2EMatrix(configPath, { only });
}

function readFlag(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1]?.includes("testnet-e2e-matrix")) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
