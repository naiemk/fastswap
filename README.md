# fastswap

Cross-chain Fast Swap product built on [`onchain-invoice`](https://github.com/naiemk/onchain-invoice) payment infrastructure.

## Layout

- `server/` — FastSwap HTTP API (quotes, invoices, track, liquidity)
- `ui/` — static checkout UI
- `nodes/` — sweep adapter, relay, liquidity monitor, aggregate-all
- `cli/` — deploy / configure / testnet ops
- `contracts/` — FastSwapReceiver, FastSwapCore, Tron FastSwap, LM wrappers
- `LiquidityManager/` — treasury rebalancer bot + contracts
- `FastSwapConfig.yaml` — chains, tokens, liquidity, deploy addresses

## Dependency

Installs `onchain-invoice` from the sibling checkout (`file:../onchain-invoice`). Rebuild the invoice package after pulling changes:

```bash
cd ../onchain-invoice && npm run build
cd ../fastswap && npm install && npm run build
```

Hardhat compiles shared invoice contracts via relative symlinks under `contracts/` (for example `Receiver.sol` → `../onchain-invoice/contracts/Receiver.sol`). Keep the repos as siblings.

For TypeScript `Provider` / `TronWeb` type unity with the `file:` dependency, after install:

```bash
rm -rf ../onchain-invoice/node_modules/ethers ../onchain-invoice/node_modules/tronweb
ln -s "$(pwd)/node_modules/ethers" ../onchain-invoice/node_modules/ethers
ln -s "$(pwd)/node_modules/tronweb" ../onchain-invoice/node_modules/tronweb
```

## Commands

```bash
npm run compile
npm test
npm run server
npm run sweep
npm run relay
npm run liqman
npm run cli -- --predict
```

See `docs/PROD_LAUNCH.md` and `docs/TESTNET_MIRROR.md`.
