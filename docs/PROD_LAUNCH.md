# FastSwap production launch

## Architecture

- **UI**: static checkout + admin in [`ui/`](../ui/) — Docker image `ghcr.io/naiemk/fastswap-ui`
- **API**: Node server — `ghcr.io/naiemk/fastswap-api` on port 4010
- **Nodes**: sweep + execute workers — `ghcr.io/naiemk/fastswap-nodes` (`FASTSWAP_ROLE=sweep|execute`)
- **Gateway**: vibed-infra nginx profile (`deploy/dist/install-gateway.sh`)
- **Config**: [`FastSwapConfig.yaml`](../FastSwapConfig.yaml) mounted at `/config/FastSwapConfig.yaml`
- **Secrets**: `.env` on VPS — private keys, `API_SIGNING_SECRET`, RPC URLs

## 1. Prepare environment

```bash
cp .env.example .env
```

Fill RPC URLs, operator keys, Turnstile keys (if captcha enabled), and `FASTSWAP_OWNER_ADDRESS`.

Set `server.publicUrl` in `FastSwapConfig.yaml` to your public API URL (gateway rewrites to the API container).

## 2. Deploy contracts (EVM)

```bash
npm run compile
npm run cli:predict
npm run cli -- --deploy-evm-all
```

TRON uses EOA sweep + wallet payout (`sweep.mode: eoa`); no on-chain FastSwap receiver deploy.

## 3. Post-deploy configure

Grant roles and register adapters. Use the same cold multisig for `DEFAULT_ADMIN_ROLE` and Ownable owner so upgrades and role grants stay aligned.

```bash
npm run cli -- --configure-role --chain base --role RELAYER_ROLE --account 0x...
npm run cli -- --configure-role --chain base --role PAUSER_ROLE --account 0x...
npm run cli -- --configure-role --chain base --role SIGNER_ROLE --account 0x...
npm run cli -- --configure-adapter --chain base --adapter-id symbiosis --adapter-address 0x...
npm run cli -- --validate
npm run cli:verify
```

## 4. Package and deploy to VPS

```bash
npm run package
git add deploy/dist && git commit -m "package dist"
```

On the VPS (see generated `deploy/dist/README.md`):

```bash
wget -qO- .../deploy/dist/install-api.sh | bash
# edit .env.api, copy FastSwapConfig.yaml to /config, ./start-api.sh

wget -qO- .../deploy/dist/install-ui.sh | bash
wget -qO- .../deploy/dist/install-nodes.sh | bash
wget -qO- .../deploy/dist/install-gateway.sh | bash
```

Set `FASTSWAP_API_BASE` in the UI runtime config (gateway / `.env.ui`) to the public API origin.

## 5. Local development

```bash
npm run dev:local
# open ui/ with FASTSWAP_API_BASE=http://127.0.0.1:4010
npm run dev:pay -- <invoiceId>
```

Uses [`FastSwapConfig.local.yaml`](../FastSwapConfig.local.yaml) (generated) with captcha disabled.

## Health checks

```bash
curl -fsS https://app.example.com/health
curl -fsS https://app.example.com/config
```
