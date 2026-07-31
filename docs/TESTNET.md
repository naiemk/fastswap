# Testnet bootstrap (Sepolia + TRON Nile)

Go-live topology: **Sepolia + Nile** with **real market prices** and **Cloudflare Turnstile**. See [TESTNET_MIRROR.md](TESTNET_MIRROR.md).

## One command

```bash
cp .env.testnet.example .env   # fill keys, Turnstile, routers, FASTSWAP_PUBLIC_URL
# Or: npm run testnet:wallet:new
chmod +x scripts/testnet-mirror-bootstrap.sh
./scripts/testnet-mirror-bootstrap.sh
```

`scripts/testnet-launch.sh` wraps the same script.

Pipeline:

1. Env check
2. Deploy EVM (Sepolia) — skip if addresses already filled
3. TRON Nile — **EOA mode** (no contract deploy)
4. Deploy/mint test USDT if address empty
5. Configure roles, floors, routers (EVM)
6. Seed liquidity
7. Readiness
8. Validate
9. E2E nodes (optional)
10. Serve API + nodes + UI

### Flags

| Flag | Effect |
|------|--------|
| `--skip-smoke` / `--skip-e2e` | Skip `e2e-nodes` |
| `--predict-only` | Print CreateX addresses |
| `--docker` | Start `docker/compose/testnet.yml` after bootstrap |
| `--no-serve` | Deploy only |
| `--readiness` | Readiness only |
| `--serve-only` | Start local stack only |

## Manual steps

```bash
npm run fastswap:testnet -- --step env
npm run fastswap:testnet -- --step readiness
npm run fastswap:testnet:serve
```

## Captcha + prices

- Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in `.env`.
- Quotes/invoices require Turnstile when config has `requireForQuotes/Invoices: true`.
- Token prices use CoinGecko + Binance (see `FastSwapConfig.testnet.yaml`).

## Single wallet

Set `EVM_PRIVATE_KEY` (and `TRON_PRIVATE_KEY` if different). Node keys + invoice master secret auto-fill.

Gas needed:

- Sepolia ETH
- Nile TRX

## Routers

Set `SEPOLIA_ROUTER_ADDRESS` and `TRON_ROUTER_ADDRESS` for LiquidityManager / configure-all.

## Config

[`FastSwapConfig.testnet.yaml`](../FastSwapConfig.testnet.yaml) — CREATE2 namespace `fastswap-testnet/1`.
