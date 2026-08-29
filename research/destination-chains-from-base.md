# Destination Chains Providers quote from Base

**Question:** From Base (chain id 8453) as Source Chain, which Destination Chains and dest tokens do Rango, Rubic, Symbiosis, and Transit currently quote in their public APIs?

**Captured:** 2026-08-29. Live API bodies change; re-fetch the cited endpoints before shipping a dest picker.

**Scope:** This is a dest-picker catalog. FastSwap does not deploy Receivers on dest. Execute ends at the Provider Router on the Source Chain; destination delivery is the Provider's job.

**How to read this:** None of the four Providers publish a Base-only dest-pair matrix. Each publishes a global chain/token catalog used by their quote APIs, and those quote APIs accept Base as `from` / `src` / `tokenAmountIn.chainId`. A listed Destination Chain is therefore eligible for a Base-origin quote; whether a given amount and dest token returns a route is pair- and liquidity-dependent (`NO_ROUTE` / empty estimate).

Repo clients (`aggregators/*/client.ts`, `aggregators/http.ts`) were used only for URL and payload-shape hints. Claims below follow each Provider's official docs or live public API.

---

## Summary (dest picker from Base)

| Provider | Official dest catalog | Destination Chains from that catalog | Dest tokens | FastSwap dests (Arbitrum, BSC, TRON, Solana, Ethereum, Polygon) |
| --- | --- | --- | --- | --- |
| **Rango** | `GET /basic/meta/blockchains` + `GET /basic/meta` | 54 enabled Destination Chains besides Base (55 enabled including Base). 47 more returned with `enabled: false`. | Popular set: 258 tokens / 53 chains (`excludeNonPopulars=true`). EVM + Solana also accept tokens not on the list. | All six are enabled Destination Chains with popular dest tokens. |
| **Rubic** | `GET /api/info/chains` + `GET /api/tokens/?network=` | 100 Destination Chains (including Base). Native sentinel `0x000…000`. | Paginated per network; thousands on major EVM dests (e.g. ETH 18 307, BSC 15 822, Solana 11 228). | All six are listed (`ARBITRUM`, `BSC`, `TRON`, `SOLANA`, `ETH`, `POLYGON`). |
| **Symbiosis** | `GET /v1/chains` + `GET /v2/tokens` | 64 Destination Chains besides Base (65 including Base). Solana is chain id **5426** in this API (not 900). | Docs: any DEX-tradeable token on a supported chain. Curated `/v2/tokens`: 7 463 rows; 7 369 on the `/v1/chains` set. | All six are listed. TRON id `728126428`. Solana dest tokens use EVM-style `0x000…000N` ids plus native attributes. |
| **Transit** | Live: `GET /v3/cross/common/list`. Docs FAQ is a longer product list; older `/v3/cross/swap` docs omit Base. | Live cross catalog: **42** Destination Chains (including Base). No dedicated “from Base” filter. | 1 094 cross tokens across those chains. | Arbitrum, BSC, TRON, Solana, Ethereum, Polygon are all present. Solana is `ns=solana` / `chainId=1`. TRON native is `T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb`, not `T9yD14…` vs `0x000…0`. |

---

## Rango

### Sources

- Docs: [Get Blockchains & Tokens (Basic API)](https://docs.rango.exchange/api-integration/basic-api-single-step/api-reference/get-blockchains-and-tokens.md) — `GET https://public-api.rango.exchange/basic/meta` and `/basic/meta/blockchains` with public test key `c6381a79-2817-4602-83bf-6a641a409e32`. Private keys use `https://api.rango.exchange`.
- Docs: [Get Quote](https://docs.rango.exchange/api-integration/basic-api-single-step/api-reference/get-quote.md) — `GET /basic/quote` with `from` / `to` asset ids.
- Live: `GET https://public-api.rango.exchange/basic/meta/blockchains?apiKey=…` (200, 2026-08-29).
- Live: `GET https://public-api.rango.exchange/basic/meta?apiKey=…&excludeNonPopulars=true` (200, 2026-08-29).

Rango's own docs say the meta response is “all the essential data needed for a swap's UI, including list of all blockchains [and] tokens”, and that quote/swap need the blockchain `name` from meta. A chain with `enabled: false` should not be offered. For EVM and Solana, tokens outside the meta list are still valid quote inputs; other VMs must use meta tokens.

Base in meta: `name=BASE`, `chainId=0x2105` (8453), `type=EVM`, `enabled=true`. Quote `from` for native ETH on Base is `BASE.--` (or `BASE.ETH`); ERC-20 is `BASE--<address>`.

### Destination Chains (enabled, besides Base)

55 enabled blockchains total, so **54 Destination Chains** if the dest picker excludes Base. Types: 39 EVM, 6 TRANSFER (UTXO), plus Cosmos, Solana, Sui, Tron, TON, Starknet, XRPL, Stellar, Hyperliquid.

| Rango name | Display | Type | chainId (as returned) | Decimal (if hex) |
| --- | --- | --- | --- | --- |
| ETH | Ethereum | EVM | `0x1` | 1 |
| BSC | BNB Smart Chain | EVM | `0x38` | 56 |
| POLYGON | Polygon | EVM | `0x89` | 137 |
| ARBITRUM | Arbitrum | EVM | `0xa4b1` | 42161 |
| OPTIMISM | Optimism | EVM | `0xa` | 10 |
| AVAX_CCHAIN | Avalanche | EVM | `0xa86a` | 43114 |
| LINEA | Linea | EVM | `0xe708` | 59144 |
| ZKSYNC | zkSync era | EVM | `0x144` | 324 |
| SCROLL | Scroll | EVM | `0x82750` | 534352 |
| BLAST | Blast | EVM | `0x13e31` | 81457 |
| MODE | Mode | EVM | `0x868b` | 34443 |
| TAIKO | Taiko | EVM | `0x28c58` | 167000 |
| FANTOM | Fantom | EVM | `0xfa` | 250 |
| CRONOS | Cronos | EVM | `0x19` | 25 |
| GNOSIS | Gnosis | EVM | `0x64` | 100 |
| CELO | Celo | EVM | `0xa4ec` | 42220 |
| AURORA | Aurora | EVM | `0x4e454152` | 1313161554 |
| METIS | Metis | EVM | `0x440` | 1088 |
| MOONBEAM | MoonBeam | EVM | `0x504` | 1284 |
| MOONRIVER | MoonRiver | EVM | `0x505` | 1285 |
| OKC | OKX Chain (OKC) | EVM | `0x42` | 66 |
| XLAYER | XLayer | EVM | `0xc4` | 196 |
| IOTA | IOTA | EVM | `0x2276` | 8822 |
| UNICHAIN | Unichain | EVM | `0x82` | 130 |
| SONEIUM | Soneium | EVM | `0x74c` | 1868 |
| KATANA | Katana | EVM | `0xb67d2` | 747474 |
| MONAD | Monad | EVM | `0x8f` | 143 |
| PLASMA | Plasma | EVM | `0x2611` | 9745 |
| HYPEREVM | HyperEVM | EVM | `0x3e7` | 999 |
| CITREA | Citrea | EVM | `0x1012` | 4114 |
| STABLE | Stable | EVM | `0x3dc` | 988 |
| ROBINHOOD | Robinhood | EVM | `0x1237` | 4663 |
| ZETA_CHAIN | ZetaChain | EVM | `0x1b58` | 7000 |
| MEGAETH | MegaETH | EVM | `0x10e6` | 4326 |
| SONIC | Sonic | EVM | `0x92` | 146 |
| BERACHAIN | Berachain | EVM | `0x138de` | 80094 |
| ZORA | Zora | EVM | `0x76adf1` | 7777777 |
| SHIMMER | Shimmer | EVM | `0x94` | 148 |
| SOLANA | Solana | SOLANA | `mainnet-beta` | — |
| TRON | Tron | TRON | `0x2b6653dc` | 728126428 |
| TON | Ton | TON | `-239` | — |
| SUI | Sui | SUI | `sui-mainnet` | — |
| STARKNET | StarkNet | STARKNET | `0x534e5f4d41494e` | — |
| STELLAR | Stellar | STELLAR | `null` | — |
| XRPL | XRPL | XRPL | `mainnet` | — |
| HYPERLIQUID | Hyperliquid | HYPERLIQUID | `1337` | — |
| BTC | Bitcoin | TRANSFER | `null` | — |
| BCH | Bitcoin Cash | TRANSFER | `null` | — |
| LTC | LiteCoin | TRANSFER | `null` | — |
| DOGE | Doge | TRANSFER | `null` | — |
| DASH | Dash | TRANSFER | `null` | — |
| ZCASH | ZCash | TRANSFER | `null` | — |
| THOR | Thorchain | COSMOS | `thorchain-1` | — |
| MAYA | MayaChain | COSMOS | `mayachain-mainnet-v1` | — |

47 additional names come back with `enabled: false` (Polygon zkEVM, most Cosmos app-chains, HECO, KCC, Harmony, …). Do not put those on the dest picker.

### Dest tokens (popular set)

`excludeNonPopulars=true` is documented as “native token and stable coins of each blockchain”. Live count: **258 tokens on 53 chains**. DASH and HYPERLIQUID are enabled chains with no popular-token rows in this snapshot.

Popular dest tokens on FastSwap-relevant Destination Chains:

| Destination Chain | Popular dest tokens (symbol, address or native) |
| --- | --- |
| ETH | ETH native; USDC `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`; USDT `0xdac17f958d2ee523a2206206994597c13d831ec7`; DAI, WBTC, WETH, BUSD, XAUt, MATIC, FTM |
| ARBITRUM | ETH native; USDC `0xaf88d065e77c8cc2239327c5edb3a432268e5831`; USDT `0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9`; USDC.e, WETH, WBTC, MIM, XAUt0 |
| BSC | BNB native; USDT `0x55d398326f99059ff775485246999027b3197955`; USDC `0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d`; WBNB, BUSD, BTCB, DAI, ETH, AVAX, ATOM, MATIC |
| POLYGON | POL native; USDT `0xc2132d05d31c914a87c6611c10748aeb04b58e8f`; USDC (bridged) `0x2791bca1f2de4661ed88a30c99a7a9449aa84174`; DAI, WETH, WPOL, XAUt0 |
| TRON | TRX native; USDT `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`; WTRX `TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR` |
| SOLANA | SOL native; USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`; USDT `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`; WSOL `So11111111111111111111111111111111111111112`; XAUt0 |
| BASE (on-chain dest) | ETH native; USDC `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`; DAI, WETH, USDbC |

TON's only popular row in this snapshot is **GRAM**, not TON native. Full (non-popular) meta is larger; omit listing it here.

---

## Rubic

### Sources

- Docs: [Get chains list](https://docs.rubic.finance/api-reference/info/get-chains-list.md) — `GET https://api-v2.rubic.exchange/api/info/chains`.
- Docs: [Get best quote](https://docs.rubic.finance/api-reference/router/get-best-quote.md) — `POST /api/routes/quoteBest` with `srcTokenBlockchain` / `dstTokenBlockchain`. `BASE` is in both enums.
- Docs: [Tokens API](https://docs.rubic.finance/docs/token-api/token-api.md) — page still says “under development” and points at Swagger.
- OpenAPI: `GET https://api-v2.rubic.exchange/api/routes/swagger/json` documents `GET /api/tokens/` with query `network` (enum includes `BASE`, `ARBITRUM`, `BSC`, `TRON`, `SOLANA`, `ETH`, `POLYGON`, …).
- Live: `GET https://api-v2.rubic.exchange/api/info/chains` (200, 100 chains, 2026-08-29).
- Live: `GET https://api-v2.rubic.exchange/api/tokens/?network=<NAME>` (paginated `count` / `results` of 100).

Rubic does **not** document a Base-only dest graph. `getChains` is the dest-picker chain list. `quoteBest` takes any `srcTokenBlockchain`/`dstTokenBlockchain` pair from that enum. Native dest token address is `0x0000000000000000000000000000000000000000` on EVM, TRON, TON, Bitcoin.

### Destination Chains (`/api/info/chains`, besides Base)

`BASE` is present (`id=8453`, `type=EVM`, `proxyAvailable=true`). Remaining dest names (id as returned; `null` = non-EVM in Rubic's schema):

**EVM (id set):** ETH 1, OPTIMISM 10, FLARE 14, CRONOS 25, ROOTSTOCK 30, TELOS 40, BSC 56, SYSCOIN 57, OKX 66, VELAS 106, FUSE 122, UNICHAIN 130, POLYGON 137, MONAD 143, MANTA_PACIFIC 169, XLAYER 196, FANTOM 250, FRAXTAL 252, BOBA 288, ZK_SYNC 324, THETA 361, PULSECHAIN 369, ASTAR_EVM 592, HYPER_EVM 999, METIS 1088, CORE 1116, MOONBEAM 1284, MOONRIVER 1285, SEI 1329, GRAVITY 1625, SONEIUM 1868, KAVA 2222, MORPH 2818, MERLIN 4200, MEGAETH 4326, IOTEX 4689, MANTLE 5000, BAHAMUT 5165, ZETACHAIN 7000, HORIZEN_EON 7332, KLAYTN 8217, PLASMA 9745, MODE 34443, ARBITRUM 42161, CELO 42220, OASIS 42262, ZK_FAIR 42766, HEMI 43111, AVALANCHE 43114, BOBA_BSC 56288, LINEA 59144, BERACHAIN 80094, BLAST 81457, TAIKO 167000, BITLAYER 200901, SCROLL 534352, ZK_LINK 810180, AURORA 1313161554, HARMONY 1666600000.

**Other VMs:** TRON 195, SOLANA 7565164, SUI 9999101, STELLAR 1500, BITCOIN 5555, XDC 50, ONTOLOGY 58, EOS 59, FILECOIN 314, TON / ICP / CARDANO / ALGORAND / APTOS / ASTAR / COSMOS / CASPER / DASH / DOGECOIN / POLKADOT / FLOW / HEDERA / KADENA / KUSAMA / LITECOIN / MINA_PROTOCOL / NEAR / NEO / OSMOSIS / SIA / SECRET / WAVES / WAX / MONERO / RIPPLE / TEZOS / ZCASH / ZILLIQA / KAVA_COSMOS / STARKNET — `id: null`.

**Dest-picker note:** Rubic's TRON `id` is **195**, not 728126428. Quote bodies use the string `TRON`, not the numeric id. Solana quote blockchain is `SOLANA`, not `mainnet-beta`.

### Dest tokens (`GET /api/tokens/?network=`)

Each call returns `{ count, next, previous, results }` (100 per page). Native/stables on FastSwap dests from page 1 plus `count`:

| `network` | `count` (full list) | Native + core stables (from first page) |
| --- | --- | --- |
| ETH | 18 307 | ETH `0x000…000`; USDC `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`; USDT `0xdac17f958d2ee523a2206206994597c13d831ec7`; DAI `0x6b175474e89094c44da98b954eedeac495271d0f` |
| ARBITRUM | 2 769 | ETH `0x000…000`; USDC `0xaf88d065e77c8cc2239327c5edb3a432268e5831`; USDT `0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9`; WETH `0x82af49447d8a07e3bd95bd0d56f35241523fbab1` |
| BSC | 15 822 | BNB `0x000…000`; USDT `0x55d398326f99059ff775485246999027b3197955`; USDC `0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d`; WBNB `0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c` |
| POLYGON | 3 471 | POL `0x000…000`; USDC `0x3c499c542cef5e3811e1192ce70d8cc03d5c3359`; USDT `0xc2132d05d31c914a87c6611c10748aeb04b58e8f` |
| TRON | 112 | TRX `0x000…000`; USDT `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`; USDC `TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8` |
| SOLANA | 11 228 | SOL `So11111111111111111111111111111111111111111` (wrapped-SOL mint as native in this API); USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`; USDT `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |
| BASE | 3 959 | ETH `0x000…000`; USDC `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`; USDbC `0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca`; WETH `0x4200000000000000000000000000000000000006` |

Other sampled dests: OPTIMISM 1 148, LINEA 178, AVALANCHE 1 670, TON 605, SUI 253, BITCOIN 1 (BTC native only).

Rubic TON native is labeled **GRAM** in this token API (same quirk as Rango's popular TON row).

---

## Symbiosis

### Sources

- Docs: [Symbiosis API](https://docs.symbiosis.finance/developer-tools/symbiosis-api.md) — “Get a list of supported blockchain networks using `/v1/chains`”; “For Any -> Any (except BTC -> Any), use `/v2/quote`”. Supported tokens: “you can operate any token that exists and can be exchanged in DEXs within the blockchains supported by the Symbiosis Protocol. There are no predefined restrictions.” Curated list: `GET /v2/tokens`.
- Live: `GET https://api.symbiosis.finance/crosschain/v1/chains` (200, 65 chains, 2026-08-29).
- Live: `GET https://api.symbiosis.finance/crosschain/v2/tokens` (200, 7 463 tokens, 2026-08-29).

Quote shape matches the docs: `tokenAmountIn.chainId` / `tokenOut.chainId`. Base is `8453`. Native dest token uses empty `address` (`""`), not `0x000…0`.

### Destination Chains (`/v1/chains`, besides Base)

65 chains including Base (`id=8453`, `name=Base`). **64 Destination Chains:**

| id | name | id | name |
| --- | --- | --- | --- |
| 1 | Ethereum | 56 | BNB |
| 137 | Polygon | 43114 | Avalanche |
| 42161 | Arbitrum One | 42170 | Arbitrum Nova |
| 10 | Optimism | 1101 | Polygon zkEVM |
| 728126428 | Tron | 59144 | Linea |
| 5000 | Mantle | 534352 | Scroll |
| 169 | Manta | 1088 | Metis |
| 324 | ZkSync Era | 30 | Rootstock |
| 81457 | Blast | 4200 | Merlin |
| 810180 | ZkLink | 1116 | CORE |
| 167000 | Taiko | 1329 | Sei v2 |
| 7000 | ZetaChain | 25 | Cronos |
| 252 | Fraxtal | 1625 | Gravity |
| 223 | B² Network | 388 | Cronos zkEVM |
| 2818 | Morph | **5426** | **Solana** |
| 146 | Sonic | 2741 | Abstract |
| 100 | Gnosis | 80094 | Berachain |
| 130 | Unichain | 1868 | Soneium |
| 204 | opBNB | 999 | HyperEVM |
| 747474 | Katana | 33139 | ApeChain |
| 9745 | Plasma | 143 | Monad |
| 4114 | Citrea | 9 | Quai |
| 40 | Telos | 2222 | KAVA EVM |
| 288 | Boba Ethereum | 5165 | Bahamut |
| 34443 | Mode | 13863860 | Symbiosis (host) |
| 85918 | TON | 3652501241 | Bitcoin |
| 99990001 | Hyperliquid | 99990002 | Lighter |
| 2345 | Goat | 14400144 | XRP Ledger |
| 12800128 | Monero | 14500145 | Bitcoin Cash |
| 300003 | Dogecoin | 200002 | Litecoin |
| 13300133 | Zcash | 4217 | Tempo |
| 4663 | Robinhood | 988 | Stable |

**Dest-picker note:** Solana dest `chainId` in this API is **5426**, not FastSwap's `mainnet-beta` / 900. TRON is **728126428**. TON is **85918**.

### Dest tokens

Official rule: dest token = any DEX-tradeable token on a `/v1/chains` network. `/v2/tokens` is “the list of token used in Symbiosis”, not an exclusive allow-list.

Counts on `/v1/chains` ids (curated list): Ethereum 1 770, BNB 1 353, Arbitrum One 566, Polygon 549, Avalanche 296, Base 781, Optimism 229, Tron 46, Solana (5426) 35, TON 8, Bitcoin 1, plus 10–100 on most L2s. 94 extra token rows sit on chain ids **not** in `/v1/chains` (testnets / leftovers); ignore those for the dest picker.

FastSwap-relevant dest tokens from `/v2/tokens` (native `address=""`):

| Destination Chain | Native | USDC / USDT (curated) |
| --- | --- | --- |
| Ethereum (1) | ETH | USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`; USDT `0xdAC17F958D2ee523a2206206994597C13D831ec7` |
| Arbitrum One (42161) | ETH | USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`; USDC.e `0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8` |
| BNB (56) | BNB | USDC `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` |
| Polygon (137) | POL | USDC.e `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
| Tron (728126428) | TRX | USDT `0xa614f803b6fd780986a42c78ec9c7f77e6ded13c` (TRON hex); USDC `0x3487b63d30b5b2c87fb7ffa8bcfade38eaac1abe` |
| Solana (5426) | SOL | USDC `0x0000000000000000000000000000000000000003` (internal id; native mint goes in `attributes`) |

TRON / TON / Solana dest quotes must follow the docs' EVM-style address + `attributes` rules, not raw base58 in `address` except where the token list already stores hex.

---

## Transit

### Sources

Transit does **not** publish a Base-specific dest matrix. Three official surfaces disagree in breadth; the live cross-token API is the one that actually feeds quotes.

1. **Product FAQ** — [Which blockchains does Transit currently support?](https://docs.transit.finance/start-to-use/faq/which-blockchains-does-transit-currently-support.md). Long EVM + non-EVM table including Base. Tells the reader to “check the dropdown menu on the Swap & Cross-Chain page” for the latest list. This is a product chain list, not a dest-token catalog and not a “from Base” filter.
2. **Cross Tokens List (documented + live)** — [Transit Swap Cross](https://docs.transit.finance/reference/api-reference/transit-swap-cross.md): `GET https://aggserver.transit.finance/v3/cross/common/list`. Official SDK `quoteCrossTokens()` wraps this. Live 200 on 2026-08-29: `bridgers` (18 names) + `tokens` (1 094 rows). **No `chains` object** in the live body (docs sample still shows `chains` / `tokens` keyed by bridger).
3. **Older cross-swap docs on the same page** still list `fromChainID` / `toChainID` as only Ethereum 1, BSC 56, OkEx 66, HECO 128, Matic 137, Fantom 250, KCC 321, AVAX 43114, TRON **95500**. That list **omits Base** and uses TRON 95500, which does **not** match the live list (TRON `728126428`). Treat that block as stale relative to `/v3/cross/common/list`.
4. **Aggregation swap docs** (`GET /v3/transit/swap`) list on-chain dests for a single `chain` flag (ETH, BSC, … Solana, Aptos). That is same-chain aggregation, not Base→dest.
5. **FAQ vs live:** FAQ names Berachain, HyperEVM, Bitcoin, TON, SUI, APTOS, Polkadot, etc. Live cross tokens include most of those namespaces but **not** every FAQ name (e.g. no Berachain row in this snapshot). Prefer the live list for dest-picker dest tokens.

There is **no** documented public `GET` that returns `getSupportChain()` JSON. SDK README documents `transit.swapV1.getSupportChain()` without an HTTP path. Guessed `/v3/transit/chains` and similar URLs 404.

FastSwap's `POST /v3/quote` (`fromChain` / `toChain`) is **not** in Transit's public docs (docs show `GET /v3/cross/swap` and `GET /v3/transit/swap`). Do not treat that path as a primary dest catalog.

### Destination Chains (live `/v3/cross/common/list`, besides Base)

Merged by `(ns, chainId)`: **42** Destination Chains including Base, so **41** if the dest picker excludes Base. Bridgers in the same body: METAPATH, CBRIDGE, CCTP, LINEABRIDGE, Orbiter, Meson, Owlto, ButterSwap, Across, Relay, MySonic, USDT0, OpenUSDT, Omni, Changelly, HifiSwap, SwapKit, deBridge.

| ns | chainId | Name (inferred) | Cross tokens |
| --- | --- | --- | --- |
| ethereum | 1 | Ethereum | 435 |
| ethereum | 56 | BNB Smart Chain | 184 |
| ethereum | 42161 | Arbitrum | 48 |
| ethereum | 137 | Polygon | 45 |
| ethereum | 10 | Optimism | 27 |
| ethereum | 43114 | Avalanche | 25 |
| ethereum | 324 | zkSync Era | 16 |
| ethereum | 59144 | Linea | 14 |
| ethereum | 196 | XLayer | 10 |
| ethereum | 4663 | Robinhood | 9 |
| ethereum | 534352 | Scroll | 7 |
| ethereum | 25 | Cronos | 6 |
| ethereum | 999 | HyperEVM | 6 |
| ethereum | 1030 | Conflux | 5 |
| ethereum | 1116 | CORE | 5 |
| ethereum | 480 | World Chain | 5 |
| ethereum | 130 | Unichain | 4 |
| ethereum | 200901 | Bitlayer | 4 |
| ethereum | 204 | opBNB | 4 |
| ethereum | 250 | Fantom | 4 |
| ethereum | 5000 | Mantle | 4 |
| ethereum | 169 | Manta | 3 |
| ethereum | 81457 | Blast | 3 |
| ethereum | 143 | Monad | 2 |
| ethereum | 146 | Sonic | 2 |
| ethereum | 1284 | Moonbeam | 2 |
| ethereum | 9745 | Plasma | 2 |
| ethereum | 61 | Ethereum Classic | 1 |
| ethereum | 128 | HECO | 1 |
| ethereum | 7000 | ZetaChain | 1 |
| ethereum | 8453 | Base (on-chain dest) | 66 |
| tron | 728126428 | TRON | 15 |
| solana | 1 | Solana | 99 |
| ton | -239 | TON | 6 |
| sui | 897796746 | Sui | 15 |
| aptos | 25 | Aptos | 1 |
| xrp | 0 | XRP Ledger | 3 |
| bitcoin | `00000000…a8ce26f` | Bitcoin | 1 |
| bitcoin | `1a91e3da…5591` | Dogecoin | 1 |
| iost | 1024 | IOST | 1 |
| polkadot | 0 | Polkadot | 1 |
| polkadot | 2 | Kusama | 1 |

### Dest tokens (live cross list)

1 094 rows. Native on EVM dests is `0x0000000000000000000000000000000000000000`. FastSwap dests:

**Ethereum (1):** ETH native; USDC `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`; USDT `0xdAC17F958D2ee523a2206206994597C13D831ec7`; DAI, WETH, … (435 total).

**Arbitrum (42161):** ETH native; USDC `0xaf88d065e77c8cc2239327c5edb3a432268e5831`; USDC.e `0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8`; USDT `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`; WETH (48 total).

**BSC (56):** BNB native; USDT `0x55d398326f99059fF775485246999027B3197955`; USDC `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` (184 total).

**Polygon (137):** POL native; USDC `0x3c499c542cef5e3811e1192ce70d8cc03d5c3359`; USDC.e `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`; USDT `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` (45 total).

**TRON (728126428):** TRX `T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb`; USDT `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`; plus JST, WIN, USDD, HTX, SUN\*, BTT, TUSD, NFT, WBT (15 total). Native is **not** `0x000…0`.

**Solana (`ns=solana`, chainId `1`):** SOL native as `0x000…000`; 99 tokens total (stables are in the remaining rows; not fully dumped here).

**Base (8453, on-chain dest):** ETH native; USDC `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`; USDT `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2`; USDbC, WETH (66 total).

---

## Dest-picker overlay (FastSwap dests)

These Destination Chains are the ones FastSwap already names as dest-capable (no Receiver). All four Providers list them in their public catalogs as of 2026-08-29.

| Destination Chain | Rango | Rubic | Symbiosis | Transit |
| --- | --- | --- | --- | --- |
| Ethereum | ETH / 1; popular ETH, USDC, USDT | `ETH` / 1; 18 307 tokens | id 1; 1 770 curated | ns ethereum / 1; 435 cross tokens |
| Arbitrum | ARBITRUM / 42161; popular ETH, USDC, USDT | `ARBITRUM` / 42161; 2 769 tokens | id 42161; 566 curated | ns ethereum / 42161; 48 |
| BNB Smart Chain | BSC / 56; popular BNB, USDT, USDC | `BSC` / 56; 15 822 tokens | id 56; 1 353 curated | ns ethereum / 56; 184 |
| Polygon | POLYGON / 137; popular POL, USDT, USDC.e | `POLYGON` / 137; 3 471 tokens | id 137; 549 curated | ns ethereum / 137; 45 |
| TRON | TRON / 728126428; TRX, USDT, WTRX | `TRON` (id 195 in chains API); TRX `0x000…0`, USDT `TR7NH…` | id 728126428; TRX, USDT hex | ns tron / 728126428; TRX `T9yD14…`, USDT `TR7NH…` |
| Solana | SOLANA / `mainnet-beta`; SOL, USDC, USDT | `SOLANA` (id 7565164); SOL wrapped mint, USDC, USDT | **id 5426**; SOL, USDC as `0x000…0003` | ns solana / chainId **1**; SOL `0x000…0` |

Identifier mismatches the dest picker must map: Rubic TRON id 195 vs everyone else's 728126428; Symbiosis Solana 5426 vs Rango `mainnet-beta` vs Transit `solana/1` vs Rubic 7565164; Transit TRON native `T9yD14…` vs Rubic/Rango empty-or-zero native.

---

## What this is not

- Not a promise that every Base→dest token pair returns a route today. Quote those pairs at dest-picker confirm time.
- Not a Receiver deploy list. Dest has no FastSwap contract.
- Not FastSwap config. `FastSwapConfig.yaml` dest tokens are a product subset of the catalogs above.
