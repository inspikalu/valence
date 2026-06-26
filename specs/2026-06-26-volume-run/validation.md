# Validation — Volume run: produce the required lifecycle log

This document defines how to prove Phase 12 is complete and ready to merge.

---

## Automated checks (CI-gated)

### Build integrity

| Check | Command | Expected |
|---|---|---|
| TypeScript compilation | `npm run build` | Exit code 0, `dist/` produced |
| Type checking | `npm run typecheck` | Exit code 0, no type errors |
| Unit tests | `npm test` (vitest run) | All tests pass, no skipped tests |

### Unit test coverage (minimum)

- `tests/unit/config/env.test.ts` — 4 cases for new env vars:
  - `VOLUME_COUNT` parsed correctly.
  - `VOLUME_INTERVAL_MS` parsed correctly.
  - `INJECT_FAILURE_MODE` parsed correctly (comma-separated).
  - All new vars have sensible defaults when unset.
- `tests/unit/config/failureModes.test.ts` — 5 cases:
  - Empty string returns empty array.
  - Single mode parsed.
  - Multiple modes parsed.
  - Unknown mode throws.
  - Mixed valid+invalid throws.
- `tests/unit/jito/bundle.test.ts` — 2+ cases:
  - `buildSelfTransferBundle` without `computeUnitLimit` unchanged (backward compat).
  - `buildSelfTransferBundle` with `computeUnitLimit=1` includes the instruction.
- `tests/integration/volume/sequentialRun.test.ts` — 3+ cases:
  - Volume run with `VOLUME_COUNT=3` produces 3 `recordSubmitted` calls.
  - Expiry injection produces `expired_blockhash` in lifecycle events.
  - Low-tip injection uses tip=1 lamport.
  - Clean submissions use the agent-decided tip (not injected).

### Integration test coverage

- `tests/integration/volume/sequentialRun.test.ts`:
  - Mocks fetch for all Jito endpoints and Groq.
  - Sets up a mock RPC that returns `{ err: null }` for simulations and
    `{ slot, confirmationStatus: "finalized" }` for status checks.
  - Runs 3 sequential submissions with injections.
  - Verifies tracker records 3 distinct bundle IDs.
  - Verifies at least 1 event has `failure: "expired_blockhash"` and 1 has
    `tipLamports === 1`.

### Existing test regression

All existing tests (150+ from Phases 0-11) must still pass unchanged. The
volume loop is additive — it only triggers when `VOLUME_COUNT > 1`. Default
behavior (`VOLUME_COUNT=1`, no `INJECT_FAILURE_MODE`) must be byte-identical
to pre-Phase-12 behavior in terms of what `runBundleSubmission` does.

## Manual / live checks (mainnet)

### 1. ≥10 lifecycle entries in log

1. Fund wallet with ~0.01 SOL.
2. Set env:
   ```
   SEND_BUNDLE=true
   VOLUME_COUNT=10
   INJECT_FAILURE_MODE=expiry,low_tip,compute_exceeded
   GROQ_API_KEY=<valid key>
   ```
3. Run `npm start`.
4. Wait for completion (10 sequential submissions at ~30-60s each ≈ 5-10 min).
5. Count entries in the lifecycle log file. If JSONL: `wc -l <logfile>`.
6. **Expected**: ≥10 lines, each a valid JSON object with `bundleId`,
   `events`, `stageDeltas`, `writtenAt`.

### 2. ≥2 failures, covering ≥3 failure types

1. From the same run, extract unique failure classifications:
   ```bash
   grep '"failure"' <logfile> | jq -r '.failure' | sort -u
   ```
2. If log entries don't have a top-level `failure` field, check each event's
   `failure` field:
   ```bash
   jq -r '.events[].failure // empty' <logfile> | sort -u | grep -v null
   ```
3. **Expected**: at least 2 distinct entries have `failure: "expired_blockhash"`
   and at least 1 has `failure: "compute_exceeded"` (or `"bundle_failure"` for
   the low-tip case). The three failure modes may produce different
   classifications depending on runtime behavior:
   - `expiry` → `expired_blockhash`
   - `low_tip` → `fee_too_low` (if caught by simulation) or `bundle_failure`
     (if bundle is submitted but doesn't land)
   - `compute_exceeded` → `compute_exceeded`

### 3. Every entry has complete lifecycle data

For each log entry, verify:
```bash
jq -r '[.bundleId, (.events | length), .stageDeltas["submitted→processed"], .events[0].tipLamports] | @tsv' <logfile>
```

**Expected**: no null `bundleId`, ≥1 event per entry, `submitted→processed`
delta is a number (not null), `tipLamports` is a positive integer.

### 4. Spot-check 2-3 slot numbers against explorer

1. Pick 2-3 entries from the log.
2. For each, take the `events[0].slot` (submission slot) and
   `events[-1].slot` (final slot).
3. Look up the transaction signature (`events[0].signature`) on a Solana
   explorer (Solscan, SolanaFM, or similar).
4. **Expected**: the explorer shows the same slots ±1 as the log (small
   discrepancies are OK — the log records the slot when the system observed
   the event, which may be the next slot due to polling interval).

### 5. No-regression: single submission still works

Run with default env (no volume vars):
```
SEND_BUNDLE=true
```
(or the pre-Phase-12 env that works)

**Expected**: the system behaves exactly as before — one bundle submission,
one lifecycle entry, one log line. No volume loop starts.

### 6. Log export as deliverable

Copy the resulting log file to `log/lifecycle.jsonl` (or similar standard
location in the repo) so it can be linked from the README and included in the
submission. The file should contain ≥10 entries, ≥2 with failures.

## Secrets / hygiene

- Same rules as all phases: no private keys, API tokens, or `.env` values
  committed.
- The lifecycle log contains `tipLamports` and `agentReasoning` but *not* the
  private key or API key. Review the log for accidental secret leakage before
  committing.

## Definition of done (maps to roadmap Phase 12 check)

- [ ] `npm run build`, `npm run typecheck`, `npm test` all green (all 150+
      existing tests + new tests pass).
- [ ] `VOLUME_COUNT`, `VOLUME_INTERVAL_MS`, `INJECT_FAILURE_MODE` env vars
      in config, type, `.env.example`, and parsed correctly.
- [ ] `parseInjectFailureModes` helper with validation.
- [ ] Three failure injection modes implemented: `expiry`, `low_tip`,
      `compute_exceeded`.
- [ ] Volume orchestrator loop in `src/index.ts` — runs N sequential
      submissions, cycles through failure modes, respects interval delay.
- [ ] `buildSelfTransferBundle` accepts optional `computeUnitLimit` param.
- [ ] Lifecycle log aggregated by the existing `appendToLog` mechanism — no
      separate aggregation step needed.
- [ ] Live mainnet run: ≥10 entries in log, ≥2 failures, ≥3 failure types
      represented.
- [ ] Spot-check: 2-3 slot numbers in log match explorer.
- [ ] `log/lifecycle.jsonl` present in repo with the run's output.
- [ ] Phase 12 checkbox ticked in `specs/roadmap.md`.

## Explicitly NOT validated here (deferred to Phase 13)

- README answers from the log data — Phase 13 produces those once the log
  exists.
- Architecture document updates — Phase 14 covers diagrams and prose.
- Log file format beyond the existing schema — no new fields are added in
  this phase.
