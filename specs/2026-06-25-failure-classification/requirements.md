# Requirements — Failure classification (real + one intentional)

## Feature summary

Implement a failure classifier that maps error payloads from Jito bundle
statuses (`getBundleStatuses`/`getInflightBundleStatuses`) and Solana
transaction error codes into the four required classifications: expired
blockhash, fee too low, compute exceeded, bundle failure. The classifier
populates the `failure` field on `LifecycleLogEntry`, writes to a dedicated
failures JSONL file, and logs warnings to console. Also includes an
intentional blockhash-expiry trigger utility to guarantee at least one
classifiable failure for the final lifecycle log.

Current date: June 25, 2026. Submission deadline: June 29, 2026.

## Why this phase exists (context from roadmap)

Phase 6 proved the submission pipeline works. Phase 7 added full four-stage
lifecycle tracking with persistence. But the system still only handles the
happy path — it observes events and logs them, but it cannot *understand*
what went wrong when a bundle fails.

The bounty explicitly says "Failure handling is required. Happy-path-only
submissions will not score well." And "Detect and classify failures: expired
blockhash, fee too low, compute exceeded, bundle failure." All four types
must be classifiable before Phase 9 (retry) and Phase 10 (agent reasoning)
can act on them.

The intentional blockhash-expiry trigger serves two purposes:
1. It guarantees ≥2 failures in the final 10-bundle log (required by the
   bounty) rather than hoping natural failures occur.
2. It proves the classifier works end-to-end on a known, controlled input.

## User decisions (from spec kickoff)

| Decision | Choice | Rationale |
|---|---|---|
| Failure types in scope | **All 4 + intentional blockhash expiry trigger** | Bounty requires all 4 types. Intentional trigger guarantees ≥2 failures in the final log and proves end-to-end classifier operation. Trigger is a separate utility, not baked into normal path. |
| Classifier output destinations | **LifecycleLogEntry + console.warn + dedicated failures.jsonl** | LifecycleLogEntry.failure is the canonical record (Phase 7 already has the field). Console.warn provides immediate operator visibility. Dedicated failures.jsonl makes it easy to inspect failure runs separately from the full lifecycle log. |
| Testing approach | **All three: unit tests, integration mock, live mainnet** | Unit tests cover the parser's edge cases. Integration mock tests simulate each failure type deterministically. Live mainnet run with intentional blockhash expiry proves the system works under real conditions. |

## In scope

- **Failure classifier** — a pure function (or small set of functions) that
  accepts error payloads from Jito bundle statuses and Solana tx error codes
  and returns a `FailureClassification`:
  - `expired_blockhash`
  - `fee_too_low`
  - `compute_exceeded`
  - `bundle_failure`
  - `unknown` (catch-all for unrecognised errors)
- **Error payload parsing** — parse `getBundleStatuses`/`getInflightBundleStatuses`
  responses (Jito's `BundleStatus` structure) and Solana transaction error
  objects (the `TransactionError` type from `@solana/web3.js`) into the
  classifier input.
- **LifecycleLogEntry integration** — populate the `failure` field on the
  log entry (and each `LifecycleEvent`) when a failure is detected, not just
  for the "final" lifecycle summary but at the point the error is observed.
- **Dedicated failures log** — write each classified failure as a JSON line
  to `failures.jsonl` (colocated with the lifecycle log). Each entry includes:
  - bundleId
  - signature(s)
  - failure classification
  - original error string
  - slot (if available)
  - timestamp
- **Console warning** — call `console.warn` with a structured message on
  every classified failure so the operator sees it in real time.
- **Intentional blockhash expiry trigger** — a utility (env flag or exported
  function) that holds a constructed-and-signed transaction past its
  blockhash's valid window (~150 slots / ~60-90s) before submitting,
  deterministically producing an `expired_blockhash` failure.
- **Thread-safe / stateless design** — the classifier is a pure function
  (input → output, no side effects). The intentional trigger is a separate
  async utility. Neither touches the normal submission path.

## Out of scope (explicitly deferred)

- **Automatic retry** — Phase 9. The classifier only *detects* and *records*
  failures. Retry logic on top of classification comes next.
- **Agent reasoning about failures** — Phase 10. The agent will use the
  classifier's output to decide what to do. In Phase 8, the classifier just
  produces the classification.
- **Failure recovery beyond blockhash refresh** — fee-too-low and
  compute-exceeded recovery strategies are designed and built in Phase 9.
- **Multi-bundle runs / ≥10 log entries** — Phase 12.

## Context and constraints (from tech-stack.md / mission.md / live runs)

- **Jito error payloads**: `getBundleStatuses` returns `BundleStatus` objects
  with a `confirmation_status` field. When a bundle lands but the tx fails,
  the error appears in the tx's simulation/execution error. When a bundle
  doesn't land, `getInflightBundleStatuses` returns status `"Invalid"` or
  `"Failed"` — these map to `bundle_failure`.
- **Solana tx errors**: `@solana/web3.js`'s `TransactionError` type includes
  `{ InstructionError: [number, { Custom: number }] }`,
  `{ InsufficientFundsForFee }`, `BlockhashNotFound`, etc. These map
  directly to the classifier's failure types.
- **Blockhash expiry timing**: A blockhash is valid for ~150 slots (~60-90s).
  The intentional trigger holds a signed tx for ~120 slots (~80s) before
  submitting — safely past expiry but within a reasonable test timeout.
- **Rate limit**: Jito Block Engine rate limits (1 req/sec/IP/region) apply.
  The intentional expiry trigger should not hammer the endpoint — submit
  exactly once after the hold period.
- **Phase 7's lifecycle log location**: The dedicated failures log sits
  alongside it (`failures.jsonl` next to `log.jsonl` in the lifecycle module
  directory, overridable via env var `FAILURES_LOG_PATH`).

## Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Classifier form | **Pure function** `classifyFailure(payload): FailureClassification` plus `buildFailureDetails(payload): FailureDetails` | Testable, no side effects, composable. The entrypoint calls it with whatever error payload is at hand. |
| Intentional trigger form | **Standalone async function** `triggerBlockhashExpiry(config, wallet, rpc): Promise<FailureDetails>` | Separate from `runBundleSubmission`. Called only when an env flag or test wishes it. Returns the resulting failure for logging. |
| Failures log format | **JSON Lines** (one object per line, `\n`-delimited), same convention as the lifecycle log | Consistent with the project's existing logging infrastructure. |
| Populating LifecycleEvent.failure | **At event creation time**, not retroactively | When `getBundleEvents` produces an event and a failure is known for that signature, include it immediately. For Phase 8, this means failures are known before `getBundleEvents` is called (the poll loop or bundle status check has already classified the failure). |
