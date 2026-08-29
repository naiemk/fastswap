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
import {
  configureFastSwapRole,
  listRoleNames,
  setAdapter,
  setFastSwapPaused,
  type FastSwapRoleName,
} from "./configure-chain.js";
import { createPrompt, printJson, requireEnv } from "./prompt.js";
import { resolveEvmOwnerAddress } from "./owner.js";
import { verifyAllOnExplorers, printVerifyResults } from "./verify-explorer.js";
import { validateFastSwapConfig } from "./validate-config.js";
import { applyOperatorEnvDefaults } from "./bootstrap.js";

const MENU = [
  "Show config summary",
  "Predict EVM CreateX addresses",
  "Deploy EVM stack to one chain",
  "Deploy EVM stack to all active EVM chains",
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

  if (args.includes("--readiness")) {
    const { checkDeployReadiness } = await import("./deploy-readiness.js");
    const report = await checkDeployReadiness(config);
    printJson(report);
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (args.includes("--validate")) {
    const result = validateFastSwapConfig(config, process.env);
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
    if (results.some((r) => r.status === "failed")) process.exitCode = 1;
    return;
  }

  if (args.includes("--deploy-evm-all")) {
    const privateKey = requireEnv("EVM_PRIVATE_KEY");
    printJson(
      await deployEvmStackToActiveChains({
        config,
        privateKey,
        save: true,
        configPath,
      })
    );
    return;
  }

  const deployEvmChain = readFlag(args, "--deploy-evm");
  if (deployEvmChain) {
    const privateKey = requireEnv("EVM_PRIVATE_KEY");
    printJson(
      await deployEvmStackToChain({
        config,
        chainKey: deployEvmChain,
        privateKey,
        save: true,
        configPath,
      })
    );
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
        case "Read on-chain contract state":
          await actionRead(config, prompt);
          break;
        case "Configure contracts":
          await actionConfigure(config, prompt);
          break;
        case "Validate config":
          printJson(validateFastSwapConfig(config, process.env));
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
  const save = await prompt.confirm("Write addresses to config as each contract deploys?", true);
  printJson(
    await deployEvmStackToChain({
      config,
      chainKey,
      privateKey,
      save,
      configPath,
    })
  );
}

async function actionDeployEvmAll(
  config: ReturnType<typeof loadFastSwapConfig>,
  configPath: string,
  prompt: ReturnType<typeof createPrompt>
) {
  const active = getEvmActiveChains(config).map((chain) => chain.key);
  console.log(`Active EVM chains: ${active.join(", ")}`);
  if (!(await prompt.confirm("Deploy CreateX stack to all of them?", false))) return;
  const privateKey = requireEnv("EVM_PRIVATE_KEY");
  const save = await prompt.confirm("Write addresses to config as each contract deploys?", true);
  printJson(
    await deployEvmStackToActiveChains({
      config,
      privateKey,
      save,
      configPath,
    })
  );
}

async function actionRead(config: ReturnType<typeof loadFastSwapConfig>, prompt: ReturnType<typeof createPrompt>) {
  const active = getActiveChainDefinitions(config).map((chain) => chain.key);
  const chainKey = await prompt.choose("Select chain", active);
  const chain = getChainDefinition(config, chainKey);
  if (chain.type !== "evm") {
    console.log("On-chain read is EVM-only; TRON uses EOA payout mode.");
    return;
  }
  const contracts = resolveChainContracts(config, chain);
  printJson(
    await readEvmOnChainState({
      config,
      chainKey,
      addresses: {
        fastSwapAddress: contracts.fastSwapAddress,
        sweeperAddress: contracts.sweeperAddress,
      },
    })
  );
}

async function actionConfigure(config: ReturnType<typeof loadFastSwapConfig>, prompt: ReturnType<typeof createPrompt>) {
  const actions = ["Grant/revoke FastSwap role (EVM)", "Register aggregator adapter (EVM)"] as const;
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
    case "Register aggregator adapter (EVM)": {
      const adapterId = await prompt.ask("Adapter id (e.g. symbiosis, rango)");
      const adapterAddress = await prompt.ask("Adapter contract address");
      printJson(await setAdapter({ config, chainKey, privateKey, adapterId, adapterAddress }));
      break;
    }
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
    printJson(
      await configureFastSwapRole({
        config,
        chainKey,
        privateKey,
        role: role as FastSwapRoleName,
        account,
        grant: !args.includes("--revoke"),
      })
    );
    return true;
  }

  if (args.includes("--configure-adapter")) {
    if (!chainKey) throw new Error("--configure-adapter requires --chain");
    if (!privateKey) throw new Error("Missing EVM_PRIVATE_KEY");
    const adapterId = readFlag(args, "--adapter-id");
    const adapterAddress = readFlag(args, "--adapter-address");
    if (!adapterId || !adapterAddress) throw new Error("--configure-adapter requires --adapter-id and --adapter-address");
    printJson(await setAdapter({ config, chainKey, privateKey, adapterId, adapterAddress }));
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

Deploy (writes config incrementally):
  --deploy-evm <chainKey>     Deploy CreateX stack on one EVM chain
  --deploy-evm-all            Deploy on all active EVM chains

Other:
  --validate                  Pre-flight check YAML + env
  --predict                   Print predicted EVM CreateX addresses
  --verifyAll                 Verify configured contracts on block explorers (EVM)
  --readiness                 Deployment readiness report
  --owner <0x...>             Owner for proxy verify constructor args (--verifyAll)
  --config <path>             Config file (default FastSwapConfig.yaml)

Post-deploy configure (EVM; requires --chain and EVM_PRIVATE_KEY):
  --configure-role --role <ROLE> --account <0x...> [--revoke]
  --configure-adapter --adapter-id <symbiosis|rango|...> --adapter-address <0x...>
  --configure-pause | --configure-unpause

Env: EVM_PRIVATE_KEY, TRON_PRIVATE_KEY, ETHERSCAN_API_KEY (verify), FASTSWAP_OWNER_ADDRESS
`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
