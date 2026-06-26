# Validation — Retry logic (hardcoded first, to de-risk Phase 10)

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

- `src/jito/retry.ts` (`retryBundleSubmission`) — 4+ cases:
  - Returns immediately with `success: true` when `failure` is `null`.
  - Returns immediately with `success: true` when `maxRetries === 0`.
  - Makes a submission attempt with a fresh blockhash — verify via mocked
    `submitBundle` that the bundle includes a non-stale blockhash.
  - Exhausts all retry attempts and returns `success: false` when mocked
    submission consistently fails.
- All tests must mock Jito network calls (`submitBundle`,
  `getInflightBundleStatuses`, `sendViaBlockEngine`) to avoid hitting real
  endpoints. Use `vi.mock` or dependency injection as preferred.

### Integration test coverage

- `tests/integration/jito/retryCycle.test.ts` — 1+ case:
  - Inject a classified failure entry, call `retryBundleSubmission` with
    `maxRetries=1`, mock the underlying Jito calls to succeed on the second
    attempt, verify:
    - The retry function calls `buildSelfTransferBundle` with a new blockhash.
    - A tracker entry exists for the retry bundle ID.
    - The returned `success` is `true` and `finalBundleId` includes the
      retry suffix.

## Manual / live checks (mainnet)

1. **Retry fires after intentional expiry.**
   - Set `INTENTIONAL_EXPIRY=true` and `MAX_RETRIES=3` in `.env`.
   - Run the entrypoint with `SEND_BUNDLE=true`.
   - Confirm the stdout shows:
     - The original bundle failure with `[bundle]` classification lines.
     - `[retry]` lines for each retry attempt (up to 2 retries).
     - A successful retry landing (the retry bundle lands because it uses a
       fresh blockhash).
   - The process exits cleanly (no crash from the retry path).

2. **Lifecycle log contains both original failure and retry entry.**
   - After the run, read `lifecycle/log.jsonl`.
   - Confirm ≥2 lines: the first has `failure: "expired_blockhash"` (or the
     appropriate classification), the second has `failure: null` (successful
     retry) and a `bundleId` ending in `-retry-1`.
   - Both entries have valid `writtenAt`, `events`, and `stageDeltas`.

3. **All retries exhausted gracefully.**
   - (Optional / extreme case) Set `MAX_RETRIES=2` and mock the network to
     always fail, or use a scenario where retries can't succeed.
   - Confirm the process logs each retry attempt and eventually prints
     `[retry] result: failed` without crashing.

4. **Opt-in / no-regression.**
   - Run with `INTENTIONAL_EXPIRY` unset (or `false`) and no `MAX_RETRIES`.
   - Confirm the normal submission flow runs as before — no retry lines in
     stdout, no extra entries in the lifecycle log.
   - Confirm `npm test` still passes Phase 8's 128 tests.

5. **MAX_RETRIES=0 disables retry.**
   - Set `INTENTIONAL_EXPIRY=true` and `MAX_RETRIES=0`.
   - Confirm the failure is logged but no retry lines appear in stdout
     and no retry entry is written to the lifecycle log.

## Secrets / hygiene

- No private keys, API tokens, or `.env` values committed.
- The retry function never reads or writes secrets — it uses the same
  `config` and `wallet` objects passed to `runBundleSubmission`.
- The `MAX_RETRIES` env var is documented in `.env.example`.

## Definition of done (maps to roadmap Phase 9 check)

- [ ] `npm run build`, `npm run typecheck`, `npm test` all green.
- [ ] `MAX_RETRIES` config field in `ValenceConfig`, read from env var,
      documented in `.env.example`.
- [ ] `retryBundleSubmission` function exists in `src/jito/retry.ts`:
      refreshes blockhash, rebuilds bundle, resubmits with full dual-strategy.
- [ ] Wired into `runBundleSubmission` — fires on classified failure after
      original lifecycle log is written.
- [ ] Retry lifecycle entries use `-retry-N` suffix and are persisted as
      separate JSONL lines.
- [ ] Live test: `INTENTIONAL_EXPIRY=true` + `MAX_RETRIES=3` produces ≥2
      lifecycle log entries (original failure + successful retry).
- [ ] Phase 9 checkbox ticked in `specs/roadmap.md`.

## Explicitly NOT validated here (deferred)

- Agent reasoning for retry decision — Phase 11.
- Tip adjustment on retry — Phase 11 (agent decides if/how much to bump).
- Leader-aware retry timing — Phase 11.
- Multi-bundle volume runs — Phase 12.
