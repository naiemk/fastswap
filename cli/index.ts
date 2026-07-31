#!/usr/bin/env node
import { Wallet } from "ethers";
import {
  getActiveChainDefinitions,
  getChainDefinition,
  getEvmActiveChains,
  loadFastSwapConfig,
  resolveChainContracts,
  resolveConfigPath,
  resolveCreateXAddress,
  tryResolveChainContracts,
} from "../config/load.js";
import {
  deployEvmStackToActiveChains,
  deployEvmStackToChain,
  predictEvmAddresses,
  readEvmOnChainState,
} from "./deploy-evm.js";
import { deployTronStack, readTronOnChainState } from "./deploy-tron.js";
import {
  addNativeLiquidity,
  allowLiquidityManagerRouter,
  configureFastSwapRole,
  listRoleNames,
  setAggregatorAllowed,
  setFastSwapPaused,
  setLiquidityFloor,
  type FastSwapRoleName,
} from "./configure-chain.js";
import { isDeploySaltSpec } from "../config/salts.js";
import { createPrompt, printJson, requireEnv } from "./prompt.js";
import { resolveEvmOwnerAddress } from "./owner.js";
import { verifyAllOnExplorers, printVerifyResults } from "./verify-explorer.js";
import { validateFastSwapConfig } from "./validate-config.js";
import {
  applyOperatorEnvDefaults,
  BOOTSTRAP_STEPS,
  reloadConfig,
  runTestnetBootstrap,
  stepConfigureAll,
  stepDeployTokens,
  stepEnvCheck,
  stepLiqmanOnce,
  stepSeedLiquidity,
  type BootstrapStep,
} from "./bootstrap.js";

const MENU = [
  "Show config summary",
  "Predict EVM CreateX addresses",
  "Deploy EVM stack to one chain",
  "Deploy EVM stack to all active EVM chains",
  "Deploy Tron stack",
  "Read on-chain contract state",
  "Configure contracts",
  "Validate config",
  "Exit",
] as const;

async function main() {
  const args = process.argv.slice(2);
  applyOperatorEnvDefaults();
  const configPath = resolveConfigPath(readFlag(args, "--config"));
  let config = loadFastSwapConfig(configPath);

  if (args.includes("--help") || args.includes("-h")) {
    printCliHelp();
    return;
  }

  if (args.includes("--serve-only")) {
    const { startTestnetServices } = await import("./testnet-serve.js");
    await startTestnetServices(configPath);
    return;
  }

  const stepArg = readFlag(args, "--step");
  if (stepArg === "list") {
    console.log([...BOOTSTRAP_STEPS, "all"].join("\n"));
    return;
  }
  if (stepArg === "all") {
    await runTestnetBootstrap({
      configPath,
      skipSmoke: args.includes("--skip-smoke"),
      skipLiqman: !args.includes("--liqman"),
      serve: args.includes("--serve"),
      includeLiquidityManager: !args.includes("--no-liqman"),
    });
    return;
  }
  if (stepArg) {
    await runBootstrapStep(stepArg as BootstrapStep, config, configPath, args);
    return;
  }

  if (args.includes("--readiness")) {
    const { checkDeployReadiness } = await import("./deploy-readiness.js");
    const report = await checkDeployReadiness(reloadConfig(configPath));
    printJson(report);
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (args.includes("--validate")) {
    const result = validateConfig(config, configPath);
    printJson(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (args.includes("--predict")) {
    const wallet = new Wallet(requireEnv("EVM_PRIVATE_KEY"));
    const owner = resolveEvmOwnerAddress(process.env.FASTSWAP_OWNER_ADDRESS, wallet.address);
    printJson(await predictEvmAddresses(config, owner));
    return;
  }

  if (args.includes("--verifyAll")) {
    const owner = readFlag(args, "--owner");
    const results = await verifyAllOnExplorers(config, owner);
    printVerifyResults(results);
    const failed = results.some((r) => r.status === "failed");
    if (failed) process.exitCode = 1;
    return;
  }

  if (args.includes("--deploy-evm-all")) {
    const privateKey = requireEnv("EVM_PRIVATE_KEY");
    const includeLm = !args.includes("--no-liqman");
    const results = await deployEvmStackToActiveChains({
      config,
      privateKey,
      includeLiquidityManager: includeLm,
      save: true,
      configPath,
    });
    printJson(results);
    return;
  }

  const deployEvmChain = readFlag(args, "--deploy-evm");
  if (deployEvmChain) {
    const privateKey = requireEnv("EVM_PRIVATE_KEY");
    const includeLm = !args.includes("--no-liqman");
    const result = await deployEvmStackToChain({
      config,
      chainKey: deployEvmChain,
      privateKey,
      includeLiquidityManager: includeLm,
      save: true,
      configPath,
    });
    printJson(result);
    return;
  }

  if (args.includes("--deploy-tron")) {
    const privateKey = requireEnv("TRON_PRIVATE_KEY");
    const includeLm = !args.includes("--no-liqman");
    const result = await deployTronStack({
      config,
      privateKey,
      includeLiquidityManager: includeLm,
      save: true,
      configPath,
    });
    printJson(result);
    return;
  }

  const configureHandled = await handleConfigureFlags(args, config);
  if (configureHandled) return;

  const prompt = createPrompt();
  try {
    console.log(`FastSwap CLI — config: ${configPath}`);
    while (true) {
      const choice = await prompt.choose("Main menu", MENU, "Show config summary");
      config = loadFastSwapConfig(configPath);
      switch (choice) {
        case "Show config summary":
          await showSummary(config);
          break;
        case "Predict EVM CreateX addresses":
          await actionPredict(config);
          break;
        case "Deploy EVM stack to one chain":
          await actionDeployEvmOne(config, configPath, prompt);
          break;
        case "Deploy EVM stack to all active EVM chains":
          await actionDeployEvmAll(config, configPath, prompt);
          break;
        case "Deploy Tron stack":
          await actionDeployTron(config, configPath, prompt);
          break;
        case "Read on-chain contract state":
          await actionRead(config, prompt);
          break;
        case "Configure contracts":
          await actionConfigure(config, prompt);
          break;
        case "Validate config":
          printJson(validateConfig(config, configPath));
          break;
        case "Exit":
          return;
      }
    }
  } finally {
    prompt.close();
  }
}

async function showSummary(config: ReturnType<typeof loadFastSwapConfig>) {
  console.log("\nActive chains:");
  for (const chain of getActiveChainDefinitions(config)) {
    const contracts = tryResolveChainContracts(config, chain);
    console.log(`  - ${chain.key} (${chain.name}, ${chain.type}, id=${chain.id})`);
    if (contracts) {
      console.log(`      fastSwap=${contracts.fastSwapAddress}`);
      console.log(`      sweeper=${contracts.sweeperAddress}`);
      if (contracts.liquidityManagerAddress) {
        console.log(`      liquidityManager=${contracts.liquidityManagerAddress}`);
      }
    } else {
      console.log("      contracts: not configured");
    }
  }
  console.log(`\nCreateX factory: ${resolveCreateXAddress(config)}`);
  console.log(`Quote fee: ${config.quote.feeBps} bps`);
}

async function actionPredict(config: ReturnType<typeof loadFastSwapConfig>) {
  const wallet = new Wallet(requireEnv("EVM_PRIVATE_KEY"));
  const owner = resolveEvmOwnerAddress(process.env.FASTSWAP_OWNER_ADDRESS, wallet.address);
  printJson(await predictEvmAddresses(config, owner));
}

async function actionDeployEvmOne(
  config: ReturnType<typeof loadFastSwapConfig>,
  configPath: string,
  prompt: ReturnType<typeof createPrompt>
) {
  const evmChains = config.chains.filter((chain) => chain.type === "evm").map((chain) => chain.key);
  const chainKey = await prompt.choose("Select EVM chain", evmChains);
  const privateKey = requireEnv("EVM_PRIVATE_KEY");
  const includeLm = await prompt.confirm("Deploy LiquidityManager too?", true);
  const save = await prompt.confirm("Write addresses to FastSwapConfig.yaml as each contract deploys?", true);
  const result = await deployEvmStackToChain({
    config,
    chainKey,
    privateKey,
    includeLiquidityManager: includeLm,
    save,
    configPath,
  });
  printJson(result);
}

async function actionDeployEvmAll(
  config: ReturnType<typeof loadFastSwapConfig>,
  configPath: string,
  prompt: ReturnType<typeof createPrompt>
) {
  const active = getEvmActiveChains(config).map((chain) => chain.key);
  console.log(`Active EVM chains: ${active.join(", ")}`);
  const proceed = await prompt.confirm("Deploy CreateX stack to all of them?", false);
  if (!proceed) return;
  const privateKey = requireEnv("EVM_PRIVATE_KEY");
  const includeLm = await prompt.confirm("Deploy LiquidityManager too?", true);
  const save = await prompt.confirm("Write addresses to FastSwapConfig.yaml as each contract deploys?", true);
  const results = await deployEvmStackToActiveChains({
    config,
    privateKey,
    includeLiquidityManager: includeLm,
    save,
    configPath,
  });
  printJson(results);
}

async function actionDeployTron(
  config: ReturnType<typeof loadFastSwapConfig>,
  configPath: string,
  prompt: ReturnType<typeof createPrompt>
) {
  const privateKey = requireEnv("TRON_PRIVATE_KEY");
  const includeLm = await prompt.confirm("Deploy LiquidityManager too?", true);
  const save = await prompt.confirm("Write addresses to FastSwapConfig.yaml as each contract deploys?", true);
  const result = await deployTronStack({
    config,
    privateKey,
    includeLiquidityManager: includeLm,
    save,
    configPath,
  });
  printJson(result);
}

async function actionRead(config: ReturnType<typeof loadFastSwapConfig>, prompt: ReturnType<typeof createPrompt>) {
  const active = getActiveChainDefinitions(config).map((chain) => chain.key);
  const chainKey = await prompt.choose("Select chain", active);
  const chain = getChainDefinition(config, chainKey);
  const contracts = resolveChainContracts(config, chain);
  if (chain.type === "evm") {
    printJson(
      await readEvmOnChainState({
        config,
        chainKey,
        addresses: {
          fastSwapAddress: contracts.fastSwapAddress,
          sweeperAddress: contracts.sweeperAddress,
          liquidityManagerAddress: contracts.liquidityManagerAddress,
        },
      })
    );
    return;
  }
  printJson(
    await readTronOnChainState({
      config,
      chainKey,
      addresses: {
        fastSwapAddress: contracts.fastSwapAddress,
        sweeperAddress: contracts.sweeperAddress,
        liquidityManagerAddress: contracts.liquidityManagerAddress,
      },
    })
  );
}

async function actionConfigure(config: ReturnType<typeof loadFastSwapConfig>, prompt: ReturnType<typeof createPrompt>) {
  const actions = [
    "Grant/revoke FastSwap role (EVM)",
    "Set liquidity floor (EVM)",
    "Add native liquidity (EVM)",
    "Allow router on LiquidityManager (EVM)",
  ] as const;
  const action = await prompt.choose("Configure action", actions);
  const evmActive = getEvmActiveChains(config).map((chain) => chain.key);
  const chainKey = await prompt.choose("Select EVM chain", evmActive);
  const privateKey = requireEnv("EVM_PRIVATE_KEY");

  switch (action) {
    case "Grant/revoke FastSwap role (EVM)": {
      const role = await prompt.choose("Role", listRoleNames() as unknown as readonly string[]);
      const account = await prompt.ask("Account address");
      const grant = await prompt.confirm("Grant role?", true);
      printJson(await configureFastSwapRole({ config, chainKey, privateKey, role: role as never, account, grant }));
      break;
    }
    case "Set liquidity floor (EVM)": {
      const token = await prompt.ask("Token address (or NATIVE)");
      const amount = await prompt.ask("Floor amount (base units)");
      printJson(await setLiquidityFloor({ config, chainKey, privateKey, token, amount }));
      break;
    }
    case "Add native liquidity (EVM)": {
      const amount = await prompt.ask("Native amount (base units)");
      printJson(await addNativeLiquidity({ config, chainKey, privateKey, amount }));
      break;
    }
    case "Allow router on LiquidityManager (EVM)": {
      const chain = getChainDefinition(config, chainKey);
      const router = await prompt.ask("Router address", chain.router ?? "");
      const allowed = await prompt.confirm("Allow router?", true);
      printJson(await allowLiquidityManagerRouter({ config, chainKey, privateKey, router, allowed }));
      break;
    }
  }
}

function validateConfig(config: ReturnType<typeof loadFastSwapConfig>, configPath?: string) {
  return validateFastSwapConfig(config, process.env, {
    allowLocalPublicUrl: configPath ? isTestnetConfig(config, configPath) : false,
  });
}

function isTestnetConfig(config: ReturnType<typeof loadFastSwapConfig>, configPath: string): boolean {
  if (configPath.includes("testnet")) return true;
  const salts = config.deploy.salts;
  return isDeploySaltSpec(salts) && salts.namespace.toLowerCase().includes("testnet");
}

async function runBootstrapStep(
  step: BootstrapStep,
  config: ReturnType<typeof loadFastSwapConfig>,
  configPath: string,
  args: string[]
) {
  switch (step) {
    case "env":
      printJson(stepEnvCheck(config));
      return;
    case "deploy-evm": {
      const privateKey = requireEnv("EVM_PRIVATE_KEY");
      printJson(
        await deployEvmStackToActiveChains({
          config,
          privateKey,
          includeLiquidityManager: !args.includes("--no-liqman"),
          save: true,
          configPath,
        })
      );
      return;
    }
    case "deploy-tron": {
      const privateKey = requireEnv("TRON_PRIVATE_KEY");
      printJson(
        await deployTronStack({
          config,
          privateKey,
          includeLiquidityManager: !args.includes("--no-liqman"),
          save: true,
          configPath,
        })
      );
      return;
    }
    case "deploy-tokens": {
      const next = await stepDeployTokens(config, configPath);
      printJson({ ok: true, configPath });
      config = next;
      return;
    }
    case "configure-all":
      printJson(await stepConfigureAll(reloadConfig(configPath)));
      return;
    case "seed":
      printJson(await stepSeedLiquidity(reloadConfig(configPath)));
      return;
    case "liqman-once":
      await stepLiqmanOnce(configPath);
      return;
    case "validate": {
      const loaded = reloadConfig(configPath);
      const result = validateFastSwapConfig(loaded, process.env, {
        allowLocalPublicUrl: isTestnetConfig(loaded, configPath),
      });
      printJson(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    case "smoke": {
      const { runTestnetSmoke } = await import("./testnet-smoke.js");
      await runTestnetSmoke(configPath);
      return;
    }
    case "readiness": {
      const { checkDeployReadiness } = await import("./deploy-readiness.js");
      const report = await checkDeployReadiness(reloadConfig(configPath));
      printJson(report);
      if (!report.ok) process.exitCode = 1;
      return;
    }
    case "e2e-nodes": {
      const { runCrossChainE2ENodes } = await import("./testnet-e2e-nodes.js");
      await runCrossChainE2ENodes(configPath, { sourceKey: "tron" });
      return;
    }
    case "e2e-matrix": {
      const { runE2EMatrix } = await import("./testnet-e2e-matrix.js");
      const onlyArg = readFlag(args, "--only");
      const only = onlyArg ? onlyArg.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      await runE2EMatrix(configPath, { only });
      return;
    }
    default:
      throw new Error(`Unknown step "${step}". Run --step list`);
  }
}

async function handleConfigureFlags(args: string[], config: ReturnType<typeof loadFastSwapConfig>): Promise<boolean> {
  const chainKey = readFlag(args, "--chain");
  const privateKey = process.env.EVM_PRIVATE_KEY;

  if (args.includes("--configure-role")) {
    if (!chainKey) throw new Error("--configure-role requires --chain");
    if (!privateKey) throw new Error("Missing EVM_PRIVATE_KEY");
    const role = readFlag(args, "--role");
    const account = readFlag(args, "--account");
    if (!role || !account) throw new Error("--configure-role requires --role and --account");
    if (!(listRoleNames() as readonly string[]).includes(role)) throw new Error(`Unknown role ${role}`);
    const grant = !args.includes("--revoke");
    printJson(
      await configureFastSwapRole({
        config,
        chainKey,
        privateKey,
        role: role as FastSwapRoleName,
        account,
        grant,
      })
    );
    return true;
  }

  if (args.includes("--configure-floor")) {
    if (!chainKey) throw new Error("--configure-floor requires --chain");
    if (!privateKey) throw new Error("Missing EVM_PRIVATE_KEY");
    const token = readFlag(args, "--token");
    const amount = readFlag(args, "--amount");
    if (!token || !amount) throw new Error("--configure-floor requires --token and --amount");
    printJson(await setLiquidityFloor({ config, chainKey, privateKey, token, amount }));
    return true;
  }

  if (args.includes("--configure-liquidity")) {
    if (!chainKey) throw new Error("--configure-liquidity requires --chain");
    if (!privateKey) throw new Error("Missing EVM_PRIVATE_KEY");
    const amount = readFlag(args, "--amount");
    if (!amount) throw new Error("--configure-liquidity requires --amount");
    printJson(await addNativeLiquidity({ config, chainKey, privateKey, amount }));
    return true;
  }

  if (args.includes("--configure-router")) {
    if (!chainKey) throw new Error("--configure-router requires --chain");
    if (!privateKey) throw new Error("Missing EVM_PRIVATE_KEY");
    const router = readFlag(args, "--router");
    if (!router) throw new Error("--configure-router requires --router");
    const allowed = !args.includes("--revoke");
    printJson(await allowLiquidityManagerRouter({ config, chainKey, privateKey, router, allowed }));
    return true;
  }

  if (args.includes("--configure-aggregator")) {
    if (!chainKey) throw new Error("--configure-aggregator requires --chain");
    if (!privateKey) throw new Error("Missing EVM_PRIVATE_KEY");
    const aggregator = readFlag(args, "--aggregator");
    if (!aggregator) throw new Error("--configure-aggregator requires --aggregator");
    const allowed = !args.includes("--revoke");
    printJson(await setAggregatorAllowed({ config, chainKey, privateKey, aggregator, allowed }));
    return true;
  }

  if (args.includes("--configure-pause")) {
    if (!chainKey) throw new Error("--configure-pause requires --chain");
    if (!privateKey) throw new Error("Missing EVM_PRIVATE_KEY");
    printJson(await setFastSwapPaused({ config, chainKey, privateKey, paused: true }));
    return true;
  }

  if (args.includes("--configure-unpause")) {
    if (!chainKey) throw new Error("--configure-unpause requires --chain");
    if (!privateKey) throw new Error("Missing EVM_PRIVATE_KEY");
    printJson(await setFastSwapPaused({ config, chainKey, privateKey, paused: false }));
    return true;
  }

  return false;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function printCliHelp() {
  console.log(`FastSwap deploy CLI

Deploy (writes FastSwapConfig.yaml incrementally; no explorer verification):
  --deploy-evm <chainKey>     Deploy CreateX stack on one EVM chain
  --deploy-evm-all            Deploy on all active EVM chains
  --deploy-tron               Deploy Tron stack
  --no-liqman                 Skip LiquidityManager (with deploy flags)

Bootstrap (step-by-step; use FastSwapConfig.testnet.yaml on testnets):
  --step list                 Show ordered bootstrap steps
  --step env                  Check .env + print operator addresses
  --step deploy-evm           Deploy CreateX stack on all active EVM chains
  --step deploy-tron          Deploy Tron stack
  --step deploy-tokens        Deploy mintable test USDT where address is empty
  --step configure-all        Grant roles, floors, router allowlist from YAML
  --step seed                 Mint/transfer USDT to LM reserve + seed receiver targets
  --step liqman-once          Run LiquidityManager bot one cycle
  --step validate             Pre-flight config check
  --step readiness            On-chain + env deployment readiness report
  --step smoke                Multi-scenario in-process E2E (primary EVM + BSC + Nile)
  --step e2e-nodes            TRON → default EVM via sweep + relay nodes
  --step e2e-matrix           Run T1–T5 matrix (--only T1,T2 to subset)
  --step all                  Run full testnet bootstrap (deploy → seed → e2e-nodes)
  --readiness                 Same as --step readiness (JSON report, exit 1 if not ready)
  --serve                     After --step all, start API + nodes + UI locally
  --serve-only                Start services only (skip deploy/bootstrap)
  --skip-smoke                With --step all, skip e2e-nodes test
  --liqman                    With --step all, run one LiquidityManager cycle after seed

  Set EVM_PRIVATE_KEY (+ TRON_PRIVATE_KEY or same key); node keys and TRON invoice secret auto-fill from operator key.

Sweep / relay workers: pass --once for a single poll tick (no loop).

Other:
  --validate                  Pre-flight check YAML + env before launch
  --predict                   Print predicted EVM CreateX addresses
  --verifyAll                 Verify configured contracts on block explorers (EVM)
  --owner <0x...>             Owner for proxy verify constructor args (--verifyAll)
  --config <path>             Config file (default FastSwapConfig.yaml)

Post-deploy configure (EVM; requires --chain and EVM_PRIVATE_KEY):
  --configure-role --role <ROLE> --account <0x...> [--revoke]
  --configure-floor --token <NATIVE|0x...> --amount <base units>
  --configure-liquidity --amount <base units>
  --configure-router --router <0x...> [--revoke]
  --configure-aggregator --aggregator <0x...> [--revoke]
  --configure-pause | --configure-unpause

Env: EVM_PRIVATE_KEY, TRON_PRIVATE_KEY, ETHERSCAN_API_KEY (verify), FASTSWAP_OWNER_ADDRESS
`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
