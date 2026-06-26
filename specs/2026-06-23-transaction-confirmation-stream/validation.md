# Validation — Yellowstone Transaction-Confirmation Stream

This document defines how to prove the feature is complete and ready to merge.
All checks must pass before marking this feature done.

---

## Automated checks (CI-gated)

### Build integrity

| Check | Command | Expected |
|---|---|---|
| TypeScript compilation | `npm run build` | Exit code 0, `dist/` produced |
| Type checking | `npm run typecheck` | Exit code 0, no type errors |
| Unit tests | `npm test` (vitest run) | All tests pass, no skipped tests |

### Unit test coverage (minimum)

- `src/yellowstone/subscriptions/transactions.ts` — 3+ test cases:
  - `buildTxRequest` produces a `SubscribeRequest` with the correct
    `accountInclude`, `vote: false`, `failed: true`
  - `parseTxUpdate` extracts signature (base58), slot, and error from
    a mock `SubscribeUpdateTransaction`
  - `parseTxStatusUpdate` handles a null error field without crashing
- `src/lifecycle/tracker.ts` — 3+ test cases:
  - `watch` + `observe` records first-seen slot and timestamp
  - Subsequent observations at higher commitment don't overwrite
    first-seen values
  - `getStatus` returns `null` for signatures not in the watched set
- `src/yellowstone/connection.ts` — 1+ test case:
  - `watchTransactions()` throws `Error` if called before `connect()`

### Lint / hygiene

- No `.only` or `.skip` in committed tests
- All new modules have barrel `index.ts` exports
- No secrets or `.env` values committed

---

## Manual checks (mainnet, requires spend)

These require the wallet to be funded with ≥0.01 SOL. They involve a real
mainnet transaction — the first spend of the project.

### M1 — Transaction subscription active

1. Run `npx tsx src/index.ts` (no test-send)
2. **Pass condition**: System starts cleanly, no errors from
   `watchTransactions()`. Log shows Yellowstone connected + leader schedule
   loaded as before. No transaction-related crashes.

### M2 — Test transaction sent and observed via stream

**Prerequisite:** wallet funded with ≥0.01 SOL.

1. Run `SEND_TEST_TX=true npx tsx src/index.ts`
2. **Pass condition**:
   - Log shows a `[tx]` line with the sent signature and `ok` status
     at the PROCESSED slot
   - Log shows a `[tx]` line with the same signature at CONFIRMED slot
     (may be the same or different slot depending on timing)
   - SignatureTracker reports correct first-seen slot for the signature

### M3 — Cross-check against explorer

1. Take the signature logged in M2 and look it up on solscan.io or
   solanabeach.io
2. **Pass condition**: The explorer's reported slot for the transaction
   matches the slot logged by the stream-based tracker. The transaction
   details show a 0-SOL self-transfer (or whatever was sent).

### M4 — Reconnect preserves tx subscription

1. Start the system, let it connect, observe tx subscription is active
2. Kill the Yellowstone connection (e.g., block the endpoint in iptables
   or kill the process's network temporarily)
3. **Pass condition**: After reconnection (the existing backoff logic
   triggers), `watchTransactions()` is called again automatically and
   the transaction subscription resumes. This requires the entrypoint's
   reconnection handler to re-issue the tx filter — if the current
   reconnection logic reuses the same `YellowstoneConnection.connect()`
   path, the method must be called again after reconnect.

---

## Integration check (run once before merging)

```
npm run build && npm run typecheck && npm test
```

---

## Definition of done

All automated checks pass AND all four manual checks (M1–M4) pass on a live
mainnet RPC with the Yellowstone slot stream running. The test transaction
has been cross-checked against a public explorer at least once. The tracker
correctly records the signature's progression through at least one commitment
level transition.
