# Validation — Failure classification (real + one intentional)

This document defines how to prove the feature is complete and ready to merge.

---

## Automated checks (CI-gated)

### Build integrity

| Check | Command | Expected |
|---|---|---|
| TypeScript compilation | `npm run build` | Exit code 0, `dist/` produced |
| Type checking | `npm run typecheck` | Exit code 0, no type errors |
| Unit tests | `npm test` (vitest run) | All tests pass, no skipped tests |

### Unit test coverage (minimum)

- `src/failure/classifier.ts` (`classifyFailure`, `buildFailureDetails`) — 8+ cases:
  - `expired_blockhash` from Solana `{ BlockhashNotFound }`
  - `fee_too_low` from `{ InsufficientFundsForFee }`
  - `compute_exceeded` from `{ InstructionError: [0, { ComputationalBudgetExceeded }] }`
  - `bundle_failure` from inflight status `"Invalid"`
  - `bundle_failure` from inflight status `"Failed"`
  - `unknown` from unrecognised error payload
  - `unknown` from `null` / `undefined`
  - String-based error message for each type (defensive)
- `src/failure/intentionalExpiry.ts` — 2+ cases:
  - Transaction construction correctness (mock RPC)
  - Slot advancement detection logic
- `src/failure/logWriter.ts` — 3+ cases:
  - Writes one valid JSON line per append
  - Multiple appends produce multiple lines
  - Entry shape includes all required fields

### Existing test no-regression

- All Phase 7 lifecycle tests continue to pass (no breakage from failure
  wiring changes).

## Manual / live checks (mainnet)

### 1. Classifier works on real errors

Run with `SEND_BUNDLE=true`. The bundle inflight statuses may return
`"Invalid"` (Phase 6/7 runs show this is the common case). Confirm:
- The `console.warn` output includes the classification.
- The failures log contains an entry for the classified failure.

### 2. Intentional expiry produces correct classification

Run with `TRIGGER_EXPIRY=true SEND_BUNDLE=false`. Confirm:
- The output shows the expiry transaction being held.
- After the hold period, the submission returns an error.
- `console.warn` shows `expired_blockhash`.
- `failures.jsonl` contains an entry with `classification: "expired_blockhash"`.
- The exit code is 0 (the trigger does not crash the process).

### 3. Lifecycle log `failure` field is populated

If the intentional expiry runs as part of a bundle submission (or produces
a lifecycle entry), confirm the log entry's `failure` field is non-null and
contains the correct classification and original error.

### 4. Append behavior on failures log

Run with `TRIGGER_EXPIRY=true` twice. Confirm `failures.jsonl` contains
two lines after the second run.

### 5. Opt-in safety

With `TRIGGER_EXPIRY` unset (or `false`) and `SEND_BUNDLE` unset (or
`false`), confirm:
- No failure log is created.
- No lifecycle log is created.
- The program exits normally.

## Secrets / hygiene

- No private keys, API tokens, or `.env` values committed.
- `failures.jsonl` is added to `.gitignore` (operational artifact).
- The `FAILURES_LOG_PATH` and `TRIGGER_EXPIRY` vars are documented in
  `.env.example`.

## Definition of done (maps to roadmap Phase 8 check)

- [ ] `npm run build`, `npm run typecheck`, `npm test` all green.
- [ ] All 4 failure types are classifiable by the classifier:
      `expired_blockhash`, `fee_too_low`, `compute_exceeded`,
      `bundle_failure`, plus `unknown` catch-all.
- [ ] The intentional blockhash expiry trigger produces a correctly
      classified `expired_blockhash` failure on mainnet.
- [ ] The classifier does not crash the process — it logs and returns
      control cleanly.
- [ ] `failures.jsonl` is written alongside `log.jsonl` for every
      classified failure.
- [ ] `LifecycleLogEntry.failure` is populated when the failure is known
      at event-creation time.
- [ ] No regression on Phase 6/7 submission flow — all existing tests pass.
- [ ] Phase 8 checkbox ticked in `specs/roadmap.md`.
- [ ] `failures.jsonl` added to `.gitignore`.

## Explicitly NOT validated here (deferred)

- Automatic retry on failure — Phase 9.
- Agent reasoning about failure cause — Phase 10.
- Agent decision to retry vs abort — Phase 10.
- Multi-bundle runs / ≥10 log entries — Phase 12.
