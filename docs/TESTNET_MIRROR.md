# FastSwap 2-chain testnet go-live (Sepolia + TRON Nile)

Target topology for launch:

| Chain | Role |
|-------|------|
| **Sepolia** | EVM invoices (forwarder + sweeper + FastSwap receiver + LM) |
| **TRON Nile** | EOA invoices (sponsor sweep + node-wallet payout) |

| Requirement | Status |
|-------------|--------|
| Real prices | CoinGecko + Binance in `FastSwapConfig.testnet.yaml` (no static feeds) |
| Real captcha | Cloudflare Turnstile required for quotes + invoices (`TURNSTILE_*` env) |
| Sepolia contracts | Pre-filled from prior deploy (re-run bootstrap if re-deploying) |

Security hardening beyond Turnstile (separate node keys, HSM) remains optional for this testnet.

## 1. Prepare environment

```bash
cp .env.testnet.example .env
# Or: npm run testnet:wallet:new
```

Fill at minimum:

- `API_SIGNING_SECRET` (≥ 32 chars)
- `EVM_PRIVATE_KEY` / `TRON_PRIVATE_KEY`
- `FASTSWAP_PUBLIC_URL` (public API URL, e.g. `https://api.yourdomain.com` or local `http://127.0.0.1:4010`)
- `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` from [Cloudflare Turnstile](https://dash.cloudflare.com/)
- `SEPOLIA_RPC_URL` / `NILE_FULL_HOST`
- `SEPOLIA_ROUTER_ADDRESS` / `TRON_ROUTER_ADDRESS`

Fund the operator wallet:

- Sepolia ETH
- Nile TRX (freeze for energy if `energyMode: staked`)

## 2. Config

```bash
npm run generate:testnet-config   # regenerates skeleton (does not clear hand-filled deploy addresses if you restore them)
```

Current `FastSwapConfig.testnet.yaml` already includes:

- Live-market `priceSources` (coingecko + binance)
- Turnstile captcha flags on
- Known Sepolia stack addresses + Nile USDT (`TXYZop…`)

Regenerate then restore `deploy.contracts` / Sepolia USDT address if you need a clean regenerate.

## 3. Bootstrap / serve

```bash
chmod +x scripts/testnet-mirror-bootstrap.sh
./scripts/testnet-mirror-bootstrap.sh --skip-e2e   # deploy/configure/seed if needed
./scripts/testnet-mirror-bootstrap.sh --serve-only # start API + nodes + UI
# or Docker:
cp .env docker/compose/.env
npm run docker:testnet:up
```

Contracts already set → you can skip deploy and just:

```bash
npm run fastswap:testnet -- --step readiness
npm run fastswap:testnet -- --step validate
npm run fastswap:testnet:serve
```

## 4. Readiness checklist

```bash
npm run fastswap:testnet -- --step readiness
```

Must be green:

- Env keys + Turnstile expanded
- Sepolia receiver deployed + RELAYER_ROLE
- TRON sponsor TRX / energy
- Liquidity band sanity

## 5. E2E matrix

```bash
npm run fastswap:e2e-matrix
npm run fastswap:e2e-matrix -- --only T1
```

| Case | Route |
|------|-------|
| T1 | TRON USDT → Sepolia ETH (nodes) |
| T2 | Sepolia ETH → TRON TRX (smoke) |
| T3 | TRON TRX → Sepolia ETH (smoke) |
| T4 | Sepolia USDT → TRON USDT (smoke) |
| T5 | TRON USDT → default EVM (nodes) |

Note: UI/API quote + invoice creation requires a valid Turnstile token when captcha is enabled. Node E2E runners that hit `/quotes` may need a temporary captcha bypass or demo token for automation — prefer `--skip-e2e` for captcha-gated production-like serve, then run manual UI flows.

## Related

- [TESTNET.md](TESTNET.md) — short quick-start
- [PROD_LAUNCH.md](PROD_LAUNCH.md) — production runbook
