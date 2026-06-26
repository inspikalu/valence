# Plan — Failure classification (real + one intentional)

> Covers roadmap Phase 8. Implements a failure classifier for all four
> required error types, an intentional blockhash-expiry trigger, and
> dedicated failure logging alongside the existing lifecycle log.
> Current date: June 25, 2026. Submission deadline: June 29, 2026.

---

## Task group 1 — Enrich failure types and classifier interface

1. Review and extend `src/types/failure.ts` as needed:
   - Add an `originalError` field to `FailureClassification` if the type
     needs restructuring (currently `FailureDetails` already has
     `originalError` + slot). The existing interface should be sufficient.
   - Add a `FailureSource` type if useful: `"bundle_status" | "tx_simulation" | "tx_execution" | "inflight_status"`.
   - Export a `ClassifiedFailure` type that joins classification + source +
     original payload + slot + timestamp.

2. Design the classifier function signature in `src/types/failure.ts` or a
   new `src/failure/classifier.ts`:
   ```ts
   function classifyFailure(payload: unknown): FailureClassification
   function buildFailureDetails(payload: unknown, slot?: number): FailureDetails
   ```
   The `payload` is the raw error from Jito bundle statuses, Solana tx
   errors, or simulation results. The function narrows on the payload shape.

3. Re-export from `src/types/index.ts` and `src/failure/index.ts`.

## Task group 2 — Implement the classifier

1. Create `src/failure/classifier.ts` with the following parsing logic:

   a. **expired_blockhash** — match:
      - Solana `TransactionError` of shape `{ BlockhashNotFound }` or
        any error string containing `"blockhash"` / `"Blockhash"`.
      - Jito bundle status where the tx simulation error references
        blockhash expiry.

   b. **fee_too_low** — match:
      - Solana `TransactionError` of shape `{ InsufficientFundsForFee }`.
        Note: this is a wallet-balance error (not enough SOL to pay the
        base fee). The classifier should distinguish this from
        `compute_exceeded`.
      - Any error containing `"fee"` / `"Fee"` / `"insufficient"` /
        `"Insufficient"`.

   c. **compute_exceeded** — match:
      - Solana `TransactionError` of shape
        `{ InstructionError: [number, { ComputationalBudgetExceeded }] }`.
      - Any error containing `"compute"` / `"Compute"` / `"budget"` /
        `"Budget"` / `"exceeded"`.

   d. **bundle_failure** — match:
      - Jito `getInflightBundleStatuses` returning `"Invalid"` or
        `"Failed"` status (the bundle itself didn't land — distinct from
        a landed tx having an execution error).
      - Jito `getBundleStatuses` where `confirmation_status` is null and
        no per-tx error is available (bundle was dropped, not executed).

   e. **unknown** — catch-all for anything that doesn't match the above.

2. The function must handle:
   - `null` / `undefined` payload → `unknown`.
   - String payload (direct error message) → substring matching.
   - Object payload (Solana `TransactionError`) — shape matching.
   - Jito bundle status objects — field matching.

3. Add a `FailureSource` discriminator: the classifier returns not just the
   classification but also where the error came from (`"bundle_status"`,
   `"inflight_status"`, `"tx_simulation"`, `"tx_execution"`).

## Task group 3 — Implement intentional blockhash expiry trigger

1. Create `src/failure/intentionalExpiry.ts`:
   - `triggerBlockhashExpiry(config, wallet, rpc): Promise<FailureDetails>`
   - Steps:
     a. Fetch a fresh blockhash at `processed` commitment (normal).
     b. Construct and sign a self-transfer + tip transaction (same pattern
        as the fallback path in `runBundleSubmission`).
     c. Sleep for ~120 slots (poll `getSlot` every ~600ms, exit when slot
        advances by ≥120 from the start slot). Use `processed` commitment
        for slot polling.
     d. Submit via `sendTransaction` (or `sendBundle` if preferred — but
        `sendTransaction` is simpler for a single deterministic failure).
     e. Poll `getSignatureStatus` for the result.
     f. Feed the resulting error into `classifyFailure`.
     g. Return `FailureDetails` with classification + original error + slot.
   - The function should **not** throw on the expected expiry — it catches
     the send error, classifies it, and returns the classification cleanly.
     It only throws on infrastructure failures (RPC down, wallet issues).

2. The trigger is invoked via a new env flag `TRIGGER_EXPIRY=true` in the
   entrypoint, or called directly in the integration test:
   ```ts
   if (config.triggerExpiry) {
     const failure = await triggerBlockhashExpiry(config, wallet, rpc)
     console.warn(`[failure] intentional expiry: ${failure.classification} — ${failure.originalError}`)
   }
   ```

## Task group 4 — Wire classifier into the entrypoint

1. In `runBundleSubmission` (`src/index.ts`), after each poll iteration
   that receives a bundle status or tx status:

   a. **Bundle inflight path**: when `getInflightBundleStatuses` returns
      `"Invalid"` or `"Failed"`, call `classifyFailure` and:
      - `console.warn` the classification.
      - Write to the failures log.
      - Store the classification for later use in lifecycle events.

   b. **Bundle landed path**: when `getBundleStatuses` returns a result
      with a tx-level error, call `classifyFailure` and log it.

   c. **Fallback transaction poll**: when `getSignatureStatus` returns a
      result with an error, call `classifyFailure` and log it.

2. In `getBundleEvents` (or at the point events are built), populate the
   `failure` field on each `LifecycleEvent` if a failure was classified
   for that signature. This is a change to the tracker's event construction
   — the tracker needs access to the failure map.

3. Add a failure map to `SignatureTracker` (or a parallel data structure)
   that maps `signature → FailureDetails`. The classifier populates this
   map when it runs. `getBundleEvents` reads from it when building events.

4. After the lifecycle summary (existing print), write to the failures log
   if any failures were classified in this bundle run.

## Task group 5 — Dedicated failures log

1. Create `src/failure/logWriter.ts`:
   - `appendFailureLog(logPath: string, entry: FailureLogEntry): Promise<void>`
     — same pattern as `appendToLog` in the lifecycle module.
   - `FailureLogEntry` type:
     ```ts
     interface FailureLogEntry {
       bundleId: string
       signatures: string[]
       classification: FailureClassification
       originalError: string
       slot: number | null
       timestamp: number
       source: FailureSource
     }
     ```
   - `DEFAULT_FAILURES_LOG_PATH` — resolves to `failures.jsonl` in the
     lifecycle module directory (alongside `log.jsonl`).
   - Overridable via `FAILURES_LOG_PATH` env var.

2. Export from `src/failure/index.ts`.

## Task group 6 — Config and env

1. Add to `src/types/config.ts` and `src/config/env.ts`:
   - `triggerExpiry: boolean` (default false)
   - `failuresLogPath: string | null` (default null → uses `DEFAULT_FAILURES_LOG_PATH`)

2. Update `.env.example` with:
   ```env
   # Failure classification
   # FAILURES_LOG_PATH=failures.jsonl

   # Intentional blockhash expiry trigger (for testing, default false)
   # TRIGGER_EXPIRY=false
   ```

## Task group 7 — Tests

### Unit tests — `tests/unit/failure/classifier.test.ts` (8+ cases)
- `expired_blockhash` from Solana `{ BlockhashNotFound }` error
- `fee_too_low` from `{ InsufficientFundsForFee }`
- `compute_exceeded` from `{ InstructionError: [0, { ComputationalBudgetExceeded }] }`
- `bundle_failure` from inflight status `"Invalid"`
- `bundle_failure` from inflight status `"Failed"`
- `unknown` from unrecognised error
- `unknown` from `null` / `undefined` input
- String-based error messages for each type

### Unit tests — `tests/unit/failure/intentionalExpiry.test.ts` (2+ cases)
- Verify the trigger constructs a valid transaction with a fresh blockhash
  (mock the RPC, don't actually submit).
- Verify the sleep-and-poll loop detects sufficient slot advancement.

### Integration test — `tests/integration/failure/fullCycle.test.ts` (2+ cases)
- Simulate each failure type by feeding mock bundle-status payloads through
  the full pipeline: classifier → lifecycle event → failures log → verify.
- Use a mock RPC to simulate blockhash expiry without actually waiting.

### Live mainnet run (manual)
- Run with `TRIGGER_EXPIRY=true` against mainnet.
- Confirm:
  - The expiry transaction is held past its valid window.
  - The submission attempt returns an error.
  - `classifyFailure` returns `expired_blockhash`.
  - `console.warn` prints the classification.
  - `failures.jsonl` contains the entry.
  - The lifecycle log entry has `failure` populated.

## Task group 8 — Verify + docs

1. Run `npm run typecheck`, `npm run build`, `npm test` — all green.

2. **Live mainnet run with intentional expiry**:
   - `TRIGGER_EXPIRY=true SEND_BUNDLE=false` (or with SEND_BUNDLE — the
     trigger is independent).
   - Confirm the output shows the expiry classification.
   - Confirm `failures.jsonl` has the entry.
   - Confirm the lifecycle log entry (if one was produced) has `failure`
     populated.

3. **No-regression verification**:
   - Run existing lifecycle tests (Phase 7 tests should still pass).
   - Run with `SEND_BUNDLE=false` + no `TRIGGER_EXPIRY` — confirm no
     failure log is written.

4. Update `specs/roadmap.md` — tick Phase 8 checkbox.
