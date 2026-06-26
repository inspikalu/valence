# Plan — Yellowstone Transaction-Confirmation Stream

> Covers roadmap Phase 4. Adds a `transactions` filter to the existing
> Yellowstone gRPC subscription, a basic in-memory lifecycle tracker for
> watched signatures, and a self-transfer test transaction for end-to-end
> verification.
> Current date: June 23, 2026. Updated with real-world findings June 24, 2026.
> Submission deadline: June 29, 2026.

---

## Key real-world findings (discovered during implementation)

### 1. Combined request, not additive

The original plan called for an "additive" approach — subscribe with slots
first, then write a second `SubscribeRequest` with transactions to the duplex
stream. This doesn't work because protobuf `map<string, SubscribeRequestFilter>`
fields on the `SubscribeRequest` message aren't mutable after creation via
`SubscribeRequest.create()`. Setting `request.transactions = {...}` after
creation has no effect on the serialized message — protobuf encodes the message
at creation time, and the `transactions` field isn't included.

**Solution**: Combined approach — set slots + transactions + commitment in a
*single* `SubscribeRequest.create()` call. The `setWalletPubkey()` method on
`YellowstoneConnection` stores the pubkey before `connect()`, and the combined
request is built during connection. This was verified to work: the server
processes both filters from the initial subscription.

### 2. `failed: true` restricts to ONLY failed transactions

The Yellowstone gRPC `failed` field on `SubscribeRequestFilterTransactions`
has restrictive semantics, not additive:

| `failed` value | Behavior |
|---|---|
| unset (default) | Returns all transactions (success + failed) ✓ |
| `true` | Returns ONLY failed transactions ✗ |
| `false` | Returns ONLY successful transactions |

The original spec said `failed: true` meant "include failed transactions",
but it actually means "show only failed transactions." A successful 0-SOL
self-transfer would never appear with `failed: true`.

**Solution**: Don't set the `failed` field at all. The unset default shows
both success and failed transactions, which is the correct behavior.

### 3. `vote` field semantics confirmed

| `vote` value | Behavior |
|---|---|
| unset (default) | Returns all transactions (votes + non-votes) |
| `true` | Returns ONLY vote transactions |
| `false` | Returns ONLY non-vote transactions ✓ |

`vote: false` correctly excludes validator vote transactions, which is the
intended behavior for wallet tracking.

### 4. Solinfra constraints

- **1 concurrent stream**: the free tier limits to one gRPC stream at a time.
  Test scripts must close between runs or face "max concurrent streams" errors.
- **Backpressure**: the server closes streams if the client doesn't consume
  updates fast enough. The wallet filter (`vote: false, accountInclude: [wallet]`)
  produces ~1 tx per manual test send, so this is manageable.

---

## Task group 1 — Transaction subscription module ✓

- [x] 1. Create `src/yellowstone/subscriptions/transactions.ts`:
  - `buildTxFilter(walletPubkey)` — builds a `SubscribeRequestFilterTransactions`
    with `accountInclude: [pubkey]` and `vote: false`. `failed` is intentionally
    NOT set (unset = include both success and failed)
  - `buildTxRequest(walletPubkey)` — wraps `buildTxFilter` into a full
    `SubscribeRequest` at `PROCESSED` commitment
  - `parseTxUpdate(update)` — extracts base58 signature, slot, isVote, error
  - `parseTxStatusUpdate(update)` — same extraction from status updates
- [x] 2. Add `TxUpdate` and `TxStatusUpdate` interfaces to
   `src/yellowstone/types.ts`
- [x] 3. Export from `src/yellowstone/subscriptions/index.ts`
- [x] 4. Unit tests:
  - `buildTxRequest` includes wallet pubkey in `accountInclude`
  - Excludes votes by default (`vote: false`)
  - `failed` is intentionally undefined (unset = include all)
  - `parseTxUpdate` extracts signature + slot from mock update
  - `parseTxUpdate` extracts error info when present
  - `parseTxStatusUpdate` handles null error field
- [x] 5. **Check**: `npm test` passes (51 tests, 11 files)

---

## Task group 2 — YellowstoneConnection: combined tx filter ✓

- [x] 1. Add `setWalletPubkey(pubkey: PublicKey): void` to `YellowstoneConnection`
   — stores the pubkey before `connect()` (replaces the planned `watchTransactions`)
- [x] 2. Add `txUpdate` and `txStatusUpdate` events to `YellowstoneEvents`
- [x] 3. Modify `handleUpdate()` to dispatch `update.transaction` and
   `update.transactionStatus` to the new event emitters alongside slot handling
- [x] 4. Build combined `SubscribeRequest` during `connect()` — set slots +
   transactions filters + commitment in a single `SubscribeRequest.create()` call
- [x] 5. **Check**: `npm test` passes

---

## Task group 3 — In-memory lifecycle tracker ✓

- [x] 1. Create `src/lifecycle/tracker.ts`:
  - `class SignatureTracker` with `Map<signature, TrackerEntry>`
  - `watch()` / `observe()` / `getStatus()` methods
- [x] 2. Export from `src/lifecycle/index.ts`
- [x] 3. Unit tests:
  - `watch` + `observe` records first-seen slot and timestamp
  - Higher-commitment observations don't overwrite first-seen values
  - `getStatus` returns null for unwatched signatures
- [x] 4. **Check**: `npm test` passes

---

## Task group 4 — Entrypoint wiring + test-send mechanism ✓

- [x] 1. In `src/index.ts`, call `yellowstone.setWalletPubkey(wallet.publicKey)`
   **before** `yellowstone.connect()` so the pubkey is available when the
   combined `SubscribeRequest` is built
- [x] 2. Listen for `txUpdate` / `txStatusUpdate` events:
  - Log with signature, slot, success/fail status
  - Feed into `SignatureTracker` via `observe()`
- [x] 3. Add `SEND_TEST_TX` env var (default `false`):
  - After startup + subscription active, sends a 0-SOL self-transfer
  - Logs the signature and adds to `SignatureTracker` watched set
  - Stream picks it up naturally
- [x] 4. **Check**: `SEND_TEST_TX=false` starts cleanly; `SEND_TEST_TX=true`
   captures the test tx via stream and logs it

---

## Task group 5 — Manual verification on mainnet ✓

- [x] 1. Wallet funded with ≥0.01 SOL (balance: 0.02875 SOL)
- [x] 2. Run `SEND_TEST_TX=true`:
  - Stream fires `txUpdate` with sent signature at PROCESSED slot
  - Signature recorded: `3KSiuWa8V8m3FbyECGuNF7W8k6Agf7uiV6u3dy3kAFXD4siNmqV88Tq6f1Zev86dCfGqCpS5eXX1VqUbXeHCXVa2`
  - Slot observed: 428614641
- [x] 3. Cross-checked against Solana explorer: **slot 428614641 matches**
- [x] 4. **Check**: manual checks per `validation.md` all pass; tracker output
   matches explorer data
