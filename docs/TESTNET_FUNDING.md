# Fund your testnet operator wallet

Faucets require a **browser** and **captcha** — they cannot be claimed fully from the CLI in this environment.

## Generate or show wallet

```bash
# Create new .env with testnet-only key (if you don't have one)
node scripts/generate-testnet-wallet.mjs

# Print addresses + faucet links (never prints private key)
npm run testnet:wallet
```

The private key lives only in `.env` (gitignored). **Never use a testnet-generated key on mainnet.**

## What to fund

| Network | Address field | Token | Suggested |
|---------|---------------|-------|-----------|
| Sepolia | `0x…` (EVM) | ETH | 0.1 ETH |
| BSC testnet | same `0x…` | BNB | 0.1 BNB |
| TRON Nile | `T…` (different from `0x…`) | TRX | 500 TRX |

Use `npm run testnet:wallet` to print your exact addresses.

## Faucet links

- **Sepolia**: [Alchemy Sepolia Faucet](https://www.alchemy.com/faucets/ethereum-sepolia), [Chainstack Faucet](https://faucet.chainstack.com)
- **BSC testnet**: [BNB Smart Chain Faucet](https://testnet.bnbchain.org/faucet-smart)
- **TRON Nile**: [Nile Faucet](https://nileex.io/join/getJoinPage) — paste your `T…` address, complete captcha, click Obtain (~2000 TRX / 24h)

## After funding

1. Add router addresses to `.env` (`SEPOLIA_ROUTER_ADDRESS`, etc.)
2. Run `./scripts/testnet-launch.sh`

Check balances:

```bash
npm run fastswap:testnet -- --step env
```
