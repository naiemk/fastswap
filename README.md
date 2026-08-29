# FastSwap

Cross-chain swap aggregator built on [`onchain-invoice`](https://github.com/naiemk/onchain-invoice). Users pay a deterministic invoice address (no wallet connect); a relayer executes the best route via Rango, Rubic, Symbiosis, or Transit adapters on the source chain.

## Layout

- `server/` — HTTP API (multi-aggregator quotes, invoices, track)
- `aggregators/` — provider clients + quote comparison
- `ui/` — checkout UI (simple / advanced modes)
- `nodes/` — sweep adapter, execute node (replaces dest-chain relay)
- `cli/` — deploy / configure ops
- `contracts/` — `FastSwapExecutor`, adapters, `FastSwapReceiver` (invoice stack from npm)
- `FastSwapConfig.yaml` — chains, tokens, deploy addresses

## Dependency

```bash
npm install   # runs postinstall: builds onchain-invoice SDK + copies contract artifacts
npm run compile
npm run build
```

Invoice contracts compile from `node_modules/onchain-invoice/contracts` (no sibling checkout required). Postinstall clones/builds from GitHub when prebuilt `dist/` is missing.

## Commands

```bash
npm run server
npm run sweep
npm run execute
npm run cli -- --predict
npm run dev:local    # two Hardhat chains + production API/nodes
npm run dev:pay -- <invoiceId>
npm run package      # regenerate deploy/dist for VPS wget install
```

See [docs/PROD_LAUNCH.md](docs/PROD_LAUNCH.md).

## VPS install

After `npm run package`, commit `deploy/dist/` and on the VPS:

```bash
wget -qO- https://raw.githubusercontent.com/naiemk/fastswap/main/deploy/dist/install-api.sh | bash
wget -qO- https://raw.githubusercontent.com/naiemk/fastswap/main/deploy/dist/install-ui.sh | bash
wget -qO- https://raw.githubusercontent.com/naiemk/fastswap/main/deploy/dist/install-nodes.sh | bash
wget -qO- https://raw.githubusercontent.com/naiemk/fastswap/main/deploy/dist/install-gateway.sh | bash
```
