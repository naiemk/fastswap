#!/usr/bin/env node
/**
 * Print testnet wallet addresses and faucet links (no private key).
 */
import { readFileSync, existsSync } from "node:fs";
import { Wallet } from "ethers";
import { TronWeb } from "tronweb";

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    out[t.slice(0, i)] = t.slice(i + 1);
  }
  return out;
}

const env = loadEnv(".env");
const pk = env.EVM_PRIVATE_KEY;
if (!pk) {
  console.error("No .env or EVM_PRIVATE_KEY — run: node scripts/generate-testnet-wallet.mjs");
  process.exit(1);
}

const evmAddress = env.FASTSWAP_OWNER_ADDRESS || new Wallet(pk).address;
const tronPk = env.TRON_PRIVATE_KEY || pk;
const tron = new TronWeb({ fullHost: "https://nile.trongrid.io", privateKey: tronPk.replace(/^0x/, "") });
const tronAddress = tron.defaultAddress.base58;

console.log("\nFastSwap testnet operator wallet\n");
console.log(`  Sepolia / BSC (EVM):  ${evmAddress}`);
console.log(`  TRON Nile:            ${tronAddress}`);
console.log("\nFund these (browser + captcha required):\n");
console.log(`  Sepolia ETH:  https://www.alchemy.com/faucets/ethereum-sepolia`);
console.log(`                https://faucet.chainstack.com (paste ${evmAddress})`);
console.log(`  BSC tBNB:     https://testnet.bnbchain.org/faucet-smart`);
console.log(`  Nile TRX:     https://nileex.io/join/getJoinPage (paste ${tronAddress})`);
console.log("\nRecommended: ~0.1 ETH, ~0.1 BNB, ~500 TRX\n");
console.log("After funding, set router addresses in .env, then:");
console.log("  ./scripts/testnet-launch.sh\n");
