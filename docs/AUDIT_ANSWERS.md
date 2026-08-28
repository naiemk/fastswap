# FastSwap audit answers

Responses to the 28 Aug 2026 contract audit. One decision per finding. Preference: smallest change that actually closes the hole, not the audit’s first suggestion.

Legend: **Do** = chosen fix. **Skip** = looked at, rejected.

---

## C-01 — ERC-20 payment credits idle balance

**Do:** Stop “push then `balanceOf >= amount`”. The forwarder keeps the tokens and the receiver **pulls**.

```solidity
// Receiver.receiveTokenInvoice
uint256 before = IERC20(token).balanceOf(address(this));
IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
uint256 received = IERC20(token).balanceOf(address(this)) - before;
if (received == 0) revert NoPayment();
_handleInvoice(invoiceId, token, msg.sender, received, data);
```

Forwarder drops the pre-transfer; it only needs to `approve` the receiver (or the receiver can `transferFrom` a clone that already holds the balance — `transferFrom` works without a prior `approve` if you use a pull from `msg.sender` after the forwarder has the tokens: forwarder calls receiver, receiver pulls `msg.sender`).

ETH is already correct (`msg.value`). Repeat the same pull+delta on `TronReceiver`.

**Skip:**
- Forwarder allowlist only — still credits `amount` the caller picked, not what moved. Allowlist is extra, not sufficient.
- `sum(Paid) <= balance` invariant alone — good belt, not the pants. Add later if you want.
- FastSwap-only workaround without touching onchain-invoice — `receiveTokenInvoice` is not virtual. You cannot close this in FastSwap.

**Eval:** Closes theft and grief. `paidAmount` becomes what arrived, which also closes M-03 for fee-on-transfer. Residual: rebasing tokens still unsupported (document, don’t list).

---

## C-02 — `execute` does not bind the route to the intent

Opaque Rango/Rubic/Transit calldata cannot be decoded safely (H-08 is the proof). Pinning `recipient` inside adapters is a trap.

**Do:** Relayer becomes a gas payer. The API already has a separate signing key — use it.

1. Delete the minOut override. The floor is always `intent.minAmountOut`.
2. `execute(..., bytes signature)` recovers `SIGNER_ROLE` over EIP-712 `(invoiceId, adapterId, keccak256(routeData), minAmountOut)` with `minAmountOut == intent.minAmountOut`.

```solidity
uint256 floor = record.intent.minAmountOut;
_verifyPlan(invoiceId, adapterId, keccak256(routeData), floor, signature);
```

Compromise of `EXECUTE_*_PRIVATE_KEY` can no longer redirect funds. Compromise of the API signer still can — that key already mints invoices.

**Skip:**
- Audit’s “decode dest `to` in each adapter” — provider ABIs differ and change; Symbiosis has no `to` in the head tuple.
- Commit `routeData` at invoice creation — calldata embeds the exact amount, which changes after fee/overpay.
- Dest-chain FastSwap claim contract — real pin, wrong product (you just removed dest inventory).
- `min(relayer, intent)` only — stops slippage rugs, not recipient theft.

**Eval:** Closes hot-relayer theft. Residual: signer-key compromise, and aggregators that ignore their own `toAddress` in calldata (monitor dest, don’t pretend on-chain).

---

## H-01 — Router allowlist cannot be set

The bug is that allowlist auth is `msg.sender == EXECUTOR` and the executor never calls it.

**Do:** Adapters own their allowlist. Seed in the constructor. Optional owner for later adds. Executor stays `onlyExecutor` on `execute` only.

```solidity
constructor(address executor_, bytes32 providerId_, address[] memory routers) {
    EXECUTOR = executor_;
    for (uint i; i < routers.length; ++i) routerAllowed[routers[i]] = true;
}
function setRouterAllowed(address router, bool ok) external {
    if (msg.sender != ADMIN) revert Unauthorized(); // adapter admin, not executor
}
```

**Skip:** Generic `executor.call(adapter, data)` — that is an arbitrary-call backdoor. One typed `allowRouter` on the executor is acceptable if you refuse adapter owners; constructor seed is still simpler.

**Eval:** Closes liveness. Residual: a bad constructor router is a C-02-class call target — keep the list tiny (the provider contract only).

---

## H-02 — Fee deducted, never isolated, uncapped

**Do:** Snapshot fee at payment, cap it, send it out on execute before the route.

```solidity
uint16 public constant MAX_FEE_BPS = 100;
// at payment: record.feeBps = $.feeBps;
// at execute:
if ($.feeBps > MAX_FEE_BPS) revert(); // also in setFeeBps
uint256 fee = record.paidAmount * record.feeBps / 10_000;
_transferOut(token, treasury, fee);
```

Treasury = immutable or `DEFAULT_ADMIN` set-once.

**Skip:** Off-chain-only fee (hide in dest amount) — operators can’t prove the cut. `withdrawFees` later from the same pot — that’s C-01 fuel until someone remembers to sweep.

**Eval:** Closes fee-pot theft and post-pay fee hike. Residual: treasury key.

---

## H-03 — Users cannot recover funds

**Do:** Refund is a push to `intent.refundTo`, so the caller does not matter. Require a real refund address at decode. Anyone may refund after expiry. Do not pause refunds.

```solidity
if (intent.refundTo.length != 20) revert InvalidRecipient(); // in _decodeIntent

function refund(bytes32 invoiceId) external nonReentrant { // no whenNotPaused
    if (record.status != InvoiceStatus.Paid) revert InvalidState();
    if (block.timestamp <= record.intent.expiresAt && !hasRole(RELAYER_ROLE, msg.sender))
        revert InvalidState();
    // send full paidAmount to refundTo, then status Refunded
}
```

Relayer may refund early (failed route, user abort). After expiry, the user (or a searcher) unsticks it.

**Skip:** Signature from refundTo — extra UX, no extra safety if the destination is already in the intent. Keep `whenNotPaused` on refund — that is how you brick an incident.

**Eval:** Closes “relayer disappeared / paused forever”. Residual: malicious relayer refunds early instead of executing (user gets source back, not dest). Acceptable. Empty refundTo is rejected at pay, so quotes must collect it.

---

## H-04 — `ADMIN_ROLE` upgrades, adapters, fees, pause

**Do:** Smallest split that matches how keys are actually held.

| Action | Role |
|---|---|
| `upgradeTo` | `DEFAULT_ADMIN_ROLE` only (cold multisig) |
| `pause` / `unpause` | `PAUSER_ROLE` (can be hot) |
| `setAdapter` / `setFeeBps` | `ADMIN_ROLE` (ops, not the execute wallet) |
| `execute` / early `refund` | `RELAYER_ROLE` |

Change `_authorizeUpgrade` from `onlyRole(ADMIN_ROLE)` to `onlyRole(DEFAULT_ADMIN_ROLE)`. Stop granting `RELAYER_ROLE` to the owner in `__FastSwapExecutor_init`.

**Skip:** Full OpenZeppelin timelock on day one — add when there is TVL. Four new roles for four functions — you won’t fill them.

**Eval:** Stops a stolen pause/adapter hot key from replacing implementation. Residual: `DEFAULT_ADMIN` is still god; put it on a multisig.

---

## H-05 — `executeInvoice` fakes Paid with no transfer

OCI `executeInvoice` calls `_executeInvoice` **without** `_assignPayment`. The real path sets payment first, then the hook.

**Do:** FastSwap-only guard in `FastSwapReceiver._executeInvoice`. No OCI change.

```solidity
function _executeInvoice(...) internal override returns (bytes memory) {
    InvoicePayment memory p = _getReceiverStorage().invoicePayments[invoiceId];
    // expose a Receiver-internal read if the mapping helper is private:
    // add `internal` view on Receiver, or duplicate the ERC-7201 read.
    if (!p.paid || p.token != token || p.amount != amount) revert InvalidPayment();
    return _executeFastSwapInvoice(invoiceId, token, amount, data);
}
```

`_getReceiverStorage` is private in OCI today — add an `internal` view `paymentOf(bytes32)` on Receiver (one-liner) or copy the ERC-7201 slot read once.

**Skip:** “Remove `executeInvoice` from OCI” — right long-term, slower. Checking FastSwap `msg.sender` — the hook’s sender is still the receiver.

**Eval:** Closes the owner fake-pay path. Residual: none if C-01 pull is also in. Together they require a real transfer recorded as `paid`.

---

## H-06 — TRON return data ignored; prod EOA is custodial

Two different problems.

**Do (TRC20):** Copy `TronForwarder` — treat `false` as failure. Use `forceApprove` (0 then amount) like EVM.

```solidity
(bool ok, bytes memory result) = token.call(abi.encodeCall(ITrc20.transfer, (to, amount)));
if (!ok || (result.length != 0 && !abi.decode(result, (bool)))) revert InvalidPayment();
```

**Do (custody):** Do not ship `executeTronEoa` as `console.log`. Either deploy `TronFastSwapReceiver` and execute on-chain (same as EVM) or hold funds in a 2-of-3 and say so in the UI. A stub that marks `bridging` is a silent drain.

**Skip:** “USDT on TRON is fine without return checks” — until it isn’t.

**Eval:** Return-data check is complete. EOA mode is a product decision; the stub is not.

---

## H-07 — `expiresAt` not checked at execute

C-02’s hard `minAmountOut` already stops a stale *price*. A second clock stops *zombie Paid* invoices.

**Do:** Execute allowed until `expiresAt + 1 hours`. After that, only refund (H-03).

```solidity
if (block.timestamp > uint256(record.intent.expiresAt) + 1 hours) revert InvalidPayment();
```

**Skip:** Same `expiresAt` for pay and execute — a sweep 2s before expiry cannot land execute. No execute expiry at all — Paid can sit forever if refund stays relayer-gated (fixed in H-03).

**Eval:** Closes infinite in-flight. Residual: 1h of stale-route attempts, bounded by minOut.

---

## H-08 — Symbiosis recipient pin is wrong

**Do:** Delete `_requireRecipientPinned`. The struct has no `to`; dest lives in `otherSideCalldata`; `bytes20` vs `address` endianness doesn’t match. Rely on C-02’s signed plan (API already sets `to: request.recipient`).

**Skip:** Another magic offset. A half-decoder that reverts good routes.

**Eval:** Removes false assurance. Residual: same as C-02 (signer).

---

## H-09 — No rescue / terminal `Executed`

**Do:** One admin rescue, with a reserve check. Don’t build dest-chain failure handling on-chain — you cannot see it.

```solidity
function rescue(address token, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
    if (amount > IERC20(token).balanceOf(address(this)) - reserved[token]) revert();
    _transferOut(token, to, amount);
}
```

`reserved[token] += received` on pay, `-= routeAmount+fee` on execute, `-= paidAmount` on refund.

Wrong-asset sitting on a **forwarder**: out of scope for v1; user sent to a clone that only sweeps one invoice. Support via upgrade if the amount is large.

Failed bridge after `Executed`: aggregator refunds to `refundTo` (must be passed in the signed route). Ops, not Solidity.

**Skip:** Rescue on every Forwarder clone. User-triggered unwind of `Executed`.

**Eval:** Recovers fees/dust/C-01 leftovers after the reserve math exists. Residual: Executed+lost-bridge is off-chain.

---

## M-01 — Quote dest ignores fee; `maxDeviationBps` dead

**Do:** Quote aggregators on `routeAmountAfterFee(source, feeBps)`. `intent.minAmountOut` = slippage floor of *that* dest. Execute-node: if live dest `< quoted * (10000 - maxDeviationBps) / 10000`, refund, don’t execute.

**Skip:** Keep quoting gross and hope slippage covers the 75 bps haircut — that’s how you under-deliver.

**Eval:** Closes over-promise. Residual: aggregator dest units (Rubic human amounts) — fix in the client, not here.

---

## M-02 — Adapter leaves router allowance

**Do:** After `_callRouter`, `forceApprove(router, 0)`. You already do this on the executor→adapter side.

**Skip:** Infinite approve for “gas” — not worth it on a one-shot adapter.

**Eval:** Closed. Residual: tokens the router pulled but didn’t spend (dust) — H-09 rescue.

---

## M-03 — Fee-on-transfer / rebasing

**Do:** Nothing extra. C-01’s `received` delta *is* the fix for fee-on-transfer. Rebasing: do not list (stETH etc.).

**Skip:** Per-token strategy hooks.

**Eval:** Closed for FOT if C-01 lands. Rebasing explicitly unsupported.

---

## M-04 — Ownable ∥ AccessControl

**Do:** After H-05, Ownable is leftover OCI. Point `owner` and `DEFAULT_ADMIN` at the same multisig in deploy. Don’t merge the two systems.

**Skip:** Strip Ownable from Receiver in the same PR as C-01 — tempting, not simplest.

**Eval:** Operational close. Residual: someone `transferOwnership` without moving roles — put it in the runbook.

---

## M-05 — `sourceChainId` / `destToken` / `slippageBps` unused

**Do:** `require(intent.sourceChainId == block.chainid)` at payment. Stop storing `slippageBps` (off-chain only). Do not on-chain-check `destToken` until routes are signed (C-02 already binds calldata the API built with that dest).

**Skip:** Enforcing `destToken` by decoding calldata.

**Eval:** Stops paying the same blob on the wrong chain. Residual: dest token still a signer/API concern.

---

## M-06 — Payment not `nonReentrant`; status after adapter call

**Do:** Two small edits.

```solidity
// after adapter returns, before approve(0)
record.status = InvoiceStatus.Executed;
record.executedAdapterId = adapterId;
_approveToken(token, adapterAddr, 0);

// _executeFastSwapInvoice
nonReentrant { ... }
```

If `execute` is already `nonReentrant`, a router callback into `receiveTokenInvoice` → hook will now revert. Good.

**Skip:** Checks-effects-interactions with status *before* the adapter call — a revert still undoes it; moving after success only matters for the `approve(0)` failure edge.

**Eval:** Closed. Residual: none that matters.

---

## M-07 — Two `InvoicePaid` events; `InvalidPayment` is a junk drawer

**Do:** Drop FastSwap’s `InvoicePaid` (Receiver already emits, with `data`). Split errors when you touch `execute`: `Expired`, `TokenMismatch`, `TransferFailed`. Not a standalone PR.

**Skip:** Versioned indexer migration for a pretty event graph.

**Eval:** Hygiene. Residual: Receiver’s `InvoicePaid` vs FastSwap `SwapExecuted` is enough to index.

---

## M-08 — `initialize(..., 75)` vs YAML `feeBps`

**Do:** `initialize(address owner, uint16 feeBps_)` and pass `config.quote.feeBps` from the deploy CLI.

**Skip:** Always `setFeeBps` in a second tx — it will be forgotten.

**Eval:** Closed.

---

## L-01 — No `providerId` check

**Do:**

```solidity
if (IAggregatorAdapter(adapterAddr).providerId() != adapterId) revert InvalidAdapter();
```

**Eval:** Closed. Cheap.

---

## L-02 — Open `receive()` / NFTs

**Do:** Keep `receive()` — native invoices need it. Do not implement ERC-721 receivers (plain `transfer` can still stick; H-09 ETH rescue covers native donations). Skip NFT handling.

**Eval:** Accept. Residual: stuck NFTs, ignore.

---

## L-03 — `watch()` uses a stale invoice

**Do:** Use the hash you just got.

```ts
const receipt = await this.executeEvm(...)
await client.watch({ txHash: receipt.hash, requestId: liveQuote.providerQuoteId, ... })
```

`executeEvm` should return the receipt instead of only PATCHing track.

**Eval:** Closed.

---

## L-04 — Rubic deposit-address rejected off-chain only

**Do:** Nothing new if C-02 signed plans land — the API already throws on `depositAddress`, and the relayer cannot swap in a different `routeData`. If C-02 is delayed, keep the throw.

**Skip:** On-chain calldata heuristics.

**Eval:** Closed by C-02. Else residual: compromised relayer.

---

## L-05 — `invoiceId = keccak256(data)` has no domain

**Do:** Don’t change the id scheme if CREATE2 salts are already published. M-05’s `sourceChainId == block.chainid` is the replay control.

If you have not deployed anywhere: `keccak256(abi.encode(block.chainid, address(this), data))` is nicer and is a breaking invoice-address change.

**Eval:** Skip unless pre-deploy. Residual: same id bytes on two chains, different forwarders — fine.

---

## G-01 — Full `SwapIntent` in storage

**Do:** Store the few fields execute/refund need + a pin hash. Relayer already has `invoice.data`.

```solidity
struct InvoiceRecord {
    InvoiceStatus status;
    address paidToken;
    uint256 paidAmount;
    uint16 feeBps;
    uint64 expiresAt;
    address refundTo;
    uint256 minAmountOut;
    bytes32 pins; // keccak256(destChainId, destToken, recipient)
}
```

At execute, re-decode `data` or pass dest fields and `require(keccak256(...) == record.pins)`.

Do this in the same storage-layout pass as H-02 snapshot / H-09 `reserved`.

**Skip:** Keep storing four dynamic `bytes` “for convenience”.

**Eval:** Biggest gas win on the pay path. Residual: execute calldata slightly larger (you already send `routeData`).

---

## G-02 — `keccak256(data)` twice

**Do:** Trust Receiver’s `_verifyInvoiceData`. Drop the second check in `_executeFastSwapInvoice`.

**Eval:** Closed. Residual: none if payment only enters through `_handleInvoice`.

---

## G-03 — EVM addresses stored as `bytes`

**Do:** Fold into G-01: `refundTo` as `address`. Keep `destToken` / `recipient` as `bytes` only inside the pin hash, not in storage.

**Eval:** Closed with G-01. Don’t do a separate bytes→address refactor.

---

## G-04 — Rango / Rubic / Transit are the same contract

**Do:** One `OpaqueRouterAdapter` with `providerId` in the constructor. MockAdapter stays separate.

**Eval:** Closed. Residual: none.

---

## G-05 — TRC20 `approve` via `encodeWithSignature`

**Do:** `abi.encodeCall(ITrc20.approve, ...)` in the same patch as H-06. Add `approve` to `ITrc20` if missing.

**Eval:** Closed.

---

## G-06 — Fat `invoiceRecord()` on a 5s poll

**Do:**

```solidity
function invoiceStatus(bytes32 id) external view returns (uint8 status, address token, uint256 amount);
```

Point sweep/execute at that. Keep the full struct for debugging if you still want it.

**Eval:** Closed. Residual: RPC cost, not user gas.

---

## G-07 — Custom reentrancy word; noop `supportsInterface`

**Do:** Delete the `supportsInterface` override. Don’t pack `feeBps` with the reentrancy slot unless you are already on G-01’s new layout — then pack them.

**Skip:** EIP-1153 transient reentrancy as its own task.

**Eval:** Tiny. Do with G-01 or skip packing.

---

## G-08 — `AdapterContext` memory then ABI-encode

**Do:** Nothing. An external call must encode anyway. “Pass calldata pins” from the executor does not remove a copy.

**Eval:** Audit noise. Residual: n/a.

---

## Order if you implement

1. C-01 pull+delta in onchain-invoice (blocks ERC-20 go-live)
2. C-02 signed plan + hard minOut
3. H-01 constructor allowlist (else no live route)
4. H-05 payment-must-exist guard
5. H-02 / H-03 / H-04 / H-07 together on the executor
6. H-06 TRON
7. M-01 + L-03 off-chain
8. G-01 layout pass (bundles G-03, G-07, H-09 reserved)

H-08 is a delete. G-08 is a no-op. L-05 is a no-op post-deploy.
