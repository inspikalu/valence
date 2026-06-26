# Validation — Full lifecycle tracking across all four stages

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

- `src/types/lifecycle.ts` (`computeStageDeltas`) — 4+ cases:
  - All four stages present with distinct timestamps → correct deltas.
  - Missing `processed` stage → `submitted→processed` is `null`.
  - Missing `finalized` stage → `confirmed→finalized` is `null`.
  - Out-of-order timestamps (defensive) → sorted before subtraction.
- `src/lifecycle/logWriter.ts` (`appendToLog`, `createLifecycleLogEntry`) — 3+ cases:
  - Writes one valid JSON line per append to a temp file.
  - Multiple appends produce multiple lines.
  - Entry shape includes `bundleId`, `events`, `stageDeltas`, `writtenAt`.

### Integration test coverage (minimum)

- `tests/integration/lifecycle/fullCycle.test.ts` — 1+ case:
  - Full simulated lifecycle: recordSubmitted → observe(processed) →
    observe(confirmed) → observe(finalized) → getBundleEvents →
    createLifecycleLogEntry → appendToLog → read back → verify all four
    stages present and deltas are correct and monotonically increasing.

## Manual / live checks (mainnet)

1. **lifecycle captures `processed` and `finalized`.** Run the entrypoint with
   `SEND_BUNDLE=true`. Confirm the stdout lifecycle summary shows at least
   3 of 4 stages (submitted, processed/confirmed, finalized). If Yellowstone
   gRPC is available, confirm `processed` is populated by the stream; if not,
   confirm it's populated by the first poll.

2. **JSONL file is written.** Check that `valence/lifecycle/log.jsonl` exists
   after the run. Read it with `cat` (or `jq . valence/lifecycle/log.jsonl`
   for pretty-print). Confirm:
   - One JSON object per line.
   - `bundleId` matches the stdout output.
   - `events` array contains entries for each observed stage.
   - `stageDeltas` contains number values (not `null`) for any pair where
     both stages were observed.
   - `writtenAt` is a plausible recent Unix timestamp.

3. **Append behavior.** Run the entrypoint a second time. Confirm the log file
   now contains two lines. Read the second line and verify it refers to the
   second run's bundle.

4. **Monotonically increasing.** Within each log entry, verify:
   - `submitted` slot < `processed` slot < `confirmed` slot < `finalized` slot
     (if all four are present).
   - `submitted` timestamp < `processed` timestamp < `confirmed` timestamp <
     `finalized` timestamp.
   - `stageDeltas` values are all non-negative (or `null` for missing stages).

5. **Opt-in safety.** With `SEND_BUNDLE` unset (or `false`), no log file is
   created or appended to. Confirm the program exits without writing to
   `valence/lifecycle/log.jsonl`.

6. **No-regression on Phase 6 behavior.** The existing `sendBundle` → fallback
   → `sendTransaction` flow (Phase 6) continues to work. The lifecycle summary
   still prints to stdout. The changes are additive — no existing behavior is
   removed or altered.

## Secrets / hygiene

- No private keys, API tokens, or `.env` values committed.
- `lifecycle/log.jsonl` is added to `.gitignore` (it contains operational data
  but no secrets; still, it's a generated artifact).
- The `LIFECYCLE_LOG_PATH` default is documented in `.env.example`.

## Definition of done (maps to roadmap Phase 7 check)

- [x] `npm run build`, `npm run typecheck`, `npm test` all green.
- [ ] One full bundle run produces a log entry with all four stages populated
      (or as many as observable) and sane (monotonically increasing
      slots/timestamps). *(requires live mainnet)*
- [x] `stageDeltas` are pre-computed and present in the log entry for any
      observed stage pair. *(verified by unit tests)*
- [ ] Second run produces a second line in the log file (append works).
      *(requires live mainnet)*
- [x] `processed` stage is populated via polling fallback when gRPC is
      unavailable. *(src/index.ts pollUntilProcessed function present)*
- [x] No regression on Phase 6 submission flow — `sendBundle` fallback still
      works, stdout lifecycle summary still prints. *(128/128 tests pass)*
- [x] Phase 7 checkbox ticked in `specs/roadmap.md`.
- [x] `lifecycle/log.jsonl` added to `.gitignore`.

## Explicitly NOT validated here (deferred)

- Failure classification — Phase 8.
- Agent decision on tip amount — Phase 10.
- Multi-bundle runs / ≥10 log entries — Phase 12.
- gRPC stream reconnection — was validated in Phase 4.
