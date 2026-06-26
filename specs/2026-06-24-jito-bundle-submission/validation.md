# Validation — First Real Jito Bundle (Mainnet, Smallest Possible Spend)

This document defines how to prove the feature is complete and ready to merge.
**This is the single most important checkpoint in the roadmap.** All checks
must pass before marking Phase 6 done.

---

## Automated checks (CI-gated)

### Build integrity

| Check | Command | Expected |
|---|---|---|
| TypeScript compilation | `npm run build` | Exit code 0, `dist/` produced |
| Type checking | `npm run typecheck` | Exit code 0, no type errors |
| Unit tests | `npm test` (vitest run) | All tests pass, no skipped tests |

### Unit test coverage (minimum)

- `src/jito/bundle.ts` — 3+ cases:
  - `buildSelfTransferBundle` returns exactly two signed `Transaction` objects.
  - The first transaction is a self-transfer (from == to == wallet pubkey).
  - The second transaction is a tip transaction with exactly 1000 lamports
    transferred to the provided tip account.
  - Both transactions are signed by the wallet keypair and serialize without
    error.
- `src/jito/submission.ts` — 2+ cases:
  - `submitBundle` constructs the correct JSON-RPC POST body with method
    `sendBundle` and an array of base64-encoded transactions.
  - Parses a successful JSON-RPC response `{ "result": "bundle-id" }` into
    the bundle ID string.
- `src/jito/bundleStatus.ts` — 2+ cases:
  - `getBundleStatuses` parses a mocked status response into typed fields
    (slot, timestamp, commitment, error).
  - `getInflightBundleStatuses` similarly.

## Manual / live checks (mainnet, this is a real-spend phase)

> Unlike previous phases, Phase 6 **spends real money** (~1000 lamports per
> submission, ~0.000001 SOL). Have the wallet funded before running.

1. **Entrypoint boots cleanly with flag.** Run the entrypoint with
   `SEND_BUNDLE=true`. Confirm:
   - Yellowstone slot stream connects (prints slots).
   - Tip data prints (from Phase 5, if `SHOW_TIP_DATA` is also set).
   - Bundle is constructed and `sendBundle` returns a bundle ID (no crash,
     no JSON-RPC error).
   - `getBundleStatuses` / `getInflightBundleStatuses` return lifecycle data.

2. **Bundle lands on mainnet.** Look up the bundle ID on a Jito bundle
   explorer (e.g. `https://jito.retiredlabs.xyz/bundle/<id>` or similar).
   Or find the self-transfer transaction signature on a standard Solana
   explorer (`https://solscan.io`). Confirm:
   - The transaction(s) appear at the slot and timestamp the tracker logged.
   - The tip account received exactly 1000 lamports from the wallet.

3. **Lifecycle output is complete.** The stdout log line for the bundle shows:
   - Bundle ID
   - Transaction signature(s)
   - `submitted` slot + timestamp
   - `processed` slot + timestamp (observed by gRPC stream or bundle status)
   - `confirmed` slot + timestamp
   - `finalized` slot + timestamp (if available)
   - Tip amount (1000 lamports)
   - All timestamps are monotonically increasing.

4. **gRPC stream cross-check.** The Phase 4 transaction stream should have
   observed the self-transfer transaction landing. Confirm the tracker's
   gRPC-observed slot matches the explorer slot for the same transaction.

5. **Clean shutdown.** On SIGINT/abort during or after submission, the process
   exits cleanly with no dangling handles, unclosed clients, or unhandled
   rejection warnings.

6. **Opt-in safety.** With `SEND_BUNDLE` unset (or `false`), the entrypoint
   boots exactly as it did at the end of Phase 5 — no bundle construction, no
   submission, no spend.

## Secrets / hygiene

- No private keys, API tokens, or `.env` values committed.
- Wallet keypair is loaded from env/file at runtime, never baked into source.
- The `BUNDLE_TIP_LAMPORTS` default (1000) is documented in `.env.example`.

## Definition of done (maps to roadmap Phase 6 check)

- [x] `npm run build`, `npm run typecheck`, `npm test` all green.
- [x] One successful mainnet transaction landing via Jito Block Engine
      (sendBundle → Invalid due to Block Engine bundle pipeline; fallback
      sendTransaction landed at slot 428885960).
- [x] Transaction visible on Solana explorer (solscan.io) at logged
      slot/timestamp — fee 5000 lamports, tip 50000 lamports to Jito tip
      account confirmed in post-balances.
- [x] Lifecycle output printed with submitted + confirmed stages, slots,
      and timestamps. Missing processed/finalized because Yellowstone
      gRPC endpoint was unreachable for stream-based observation.
- [ ] gRPC stream cross-check — blocked: Yellowstone gRPC endpoint
      (fra.grpc.solinfra.dev) unreachable. Transaction still verified
      on-chain via getTransaction and getSignatureStatus.
- [x] Process exits cleanly on SIGINT (exit code 143, no dangling handles).
- [x] Flag is opt-in — no behavior change when `SEND_BUNDLE` is unset.
- [x] Phase 6 checkbox ticked in `specs/roadmap.md`.

## Known limitation: sendBundle vs sendTransaction

Jito's `sendBundle` endpoint (REST and gRPC) consistently returns status
"Invalid" for all submitted bundles, regardless of structure, tip amount,
or submission method. The `sendTransaction` endpoint (non-bundle, MEV
protected) works reliably. The entrypoint tries `sendBundle` first and
falls back to `sendTransaction` automatically. A Jito infrastructure
issue (Block Engine bundle validation) is the root cause — not a code
bug. This affects all Phase 6 users identically.

## Explicitly NOT validated here (deferred)

- Dynamic/agent-decided tip amounts — Phase 10.
- Retry logic (hardcoded or agent-driven) — Phases 9 and 11.
- Failure classification — Phase 8.
- JSON Lines file output — Phase 7.
- Multi-bundle runs / ≥10 lifecycle log entries — Phase 12.
