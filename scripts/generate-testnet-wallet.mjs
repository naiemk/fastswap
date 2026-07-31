#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Wallet } from "ethers";
import { TronWeb } from "tronweb";

const w = Wallet.createRandom();
const pk = w.privateKey;
const secret = randomBytes(32).toString("hex");
const tron = new TronWeb({ fullHost: "https://nile.trongrid.io", privateKey: pk.replace(/^0x/, "") });
const tronAddress = tron.defaultAddress.base58;

const env = `# Auto-generated testnet operator wallet — TESTNET ONLY. Do not use on mainnet.
# Fund addresses: npm run testnet:wallet

API_SIGNING_SECRET=${secret}

EVM_PRIVATE_KEY=${pk}
TRON_PRIVATE_KEY=${pk}

SEPOLIA_RPC_URL=https://sepolia.drpc.org
NILE_FULL_HOST=https://nile.trongrid.io

# Required before go-live
SEPOLIA_ROUTER_ADDRESS=
TRON_ROUTER_ADDRESS=
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
FASTSWAP_PUBLIC_URL=http://127.0.0.1:4010

FASTSWAP_OWNER_ADDRESS=${w.address}
`;

writeFileSync(".env", env, { mode: 0o600 });
writeFileSync(
  ".env.testnet.wallet.json",
  JSON.stringify(
    {
      evmAddress: w.address,
      tronAddress,
      createdAt: new Date().toISOString(),
      note: "Private key is in .env only (gitignored). See docs/TESTNET_FUNDING.md",
    },
    null,
    2
  ),
  { mode: 0o600 }
);

console.log(JSON.stringify({ evmAddress: w.address, tronAddress, envFile: ".env" }, null, 2));
