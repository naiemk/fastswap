/**
 * TRON EOA rebalance is integrated into the LiquidityManager bot via `nodeWalletMode`
 * on `ChainConfig` (see `app/fastswap/config/adapters/liqman.ts`).
 *
 * - Observe: `LiquidityManager/bot/observe.ts` → `observeTronNodeWallet`
 * - Execute: `LiquidityManager/bot/execute.ts` → `executeTronNodeWallet`
 */
export const TRON_NODE_WALLET_REBALANCE = "integrated-in-liqman-bot";
