# Plan — Full lifecycle tracking across all four stages

> Covers roadmap Phase 7. Extends the tracker from Phase 4/6 to capture all
> four commitment stages (submitted, processed, confirmed, finalized) with
> timestamps, slot numbers, and computed latency deltas. Persists entries to
> `valence/lifecycle/log.jsonl`.
> Current date: June 25, 2026. Submission deadline: June 29, 2026.

---

## Task group 1 — Enrich lifecycle types with stage deltas

1. Add `StageDeltas` type to `src/types/lifecycle.ts`:
   ```ts
   export interface StageDeltas {
     "submitted→processed": number | null   // ms, null if stage was never reached
     "processed→confirmed": number | null
     "confirmed→finalized": number | null
   }
   ```

2. Add `stageDeltas` and `writtenAt` fields to `LifecycleLogEntry`:
   ```ts
   export interface LifecycleLogEntry {
     bundleId: string
     events: LifecycleEvent[]
     stageDeltas: StageDeltas
     writtenAt: number  // Date.now() of log append
   }
   ```

3. Add `computeStageDeltas(events: LifecycleEvent[]): StageDeltas` pure
   function in `src/types/lifecycle.ts`:
   - For each stage pair, find the earliest timestamp for the destination
     stage minus the earliest timestamp for the source stage across all
     signatures in the bundle.
   - Returns `null` for any pair where the destination stage was never
     observed.

4. Re-export the new types from `src/types/index.ts`.

## Task group 2 — Implement JSONL log writer

1. Create `src/lifecycle/logWriter.ts`:
   - `appendToLog(logPath: string, entry: LifecycleLogEntry): Promise<void>` —
     uses `fs.appendFile` with `{ flag: 'a' }` to write one JSON line +
     `\n`. Returns when the write completes.
   - `DEFAULT_LOG_PATH` constant — `path.resolve(import.meta.dirname,
     'log.jsonl')` (resolves to `valence/lifecycle/log.jsonl`).
   - The function is stateless (no class wrapper) for simplicity. Callers
     pass the path explicitly; defaults to `DEFAULT_LOG_PATH`.
   - Synchronous write is acceptable for our throughput (one line per bundle
     run, not hot-path). Use `fs.promises.appendFile` for non-blocking I/O.

2. Add a `createLifecycleLogEntry` helper:
   - Accepts `bundleId, events, tipLamports, agentReasoning, failure`.
   - Computes `stageDeltas` via `computeStageDeltas(events)`.
   - Returns a complete `LifecycleLogEntry` ready for serialization.
   - This keeps log-entry construction in one place and makes it testable.

3. Export both from `src/lifecycle/index.ts`.

## Task group 3 — Derive missing stages via polling fallback

1. In `runBundleSubmission` (src/index.ts), after the sendBundle attempt or
   sendTransaction fallback lands a transaction:

   a. **Poll for `processed`** if no gRPC-observed processed event exists for
      the signature(s):
      - After `getSignatureStatus` returns the first non-null result, call
        `tracker.observe(sig, BigInt(val.slot), "processed")` using the
        returned slot.
      - This ensures `processed` is populated even when gRPC is down.

   b. **Poll for `finalized`**:
      - After the existing confirm poll (which typically returns `confirmed`),
        do one additional poll loop (up to 60s) looking for
        `confirmationStatus === "finalized"`.
      - Call `tracker.observe(sig, BigInt(val.slot), "finalized")`.
      - If `finalized` is never observed, log a warning but do not block the
        entry's persistence — the stage remains unobserved.

2. The gRPC `txUpdate` (processed) and `txStatusUpdate` (confirmed) handlers
   already call `tracker.observe()` — these continue to work unmodified.
   The polling fallback in step 1 is the second path ("keep both paths").

## Task group 4 — Wire log persistence into the entrypoint

1. In `runBundleSubmission` (`src/index.ts`), after the lifecycle summary is
   printed to stdout (end of the function):

   a. Collect all events via `tracker.getBundleEvents(usedBundleId)`.
   b. Call `createLifecycleLogEntry(...)` to build the entry.
   c. Call `appendToLog(LOGGER_PATH, entry)` to persist.
   d. Log a confirmation line: `[lifecycle] written to log.jsonl`.

2. The `LOGGER_PATH` variable:
   - Defaults to `lifecycle/log.jsonl` relative to `src/`.
   - Overridable via a new env var `LIFECYCLE_LOG_PATH` for testing.
   - Add to `src/config/env.ts` and `src/types/config.ts`.
   - Add to `.env.example`.

3. Ensure the log write happens *after* the stdout print, so stdout completes
   even if the file write fails (the entrypoint degrades gracefully — missing
   file persistence is not a crash).

## Task group 5 — Config and env

1. Add to `src/types/config.ts` and `src/config/env.ts`:
   - `LIFECYCLE_LOG_PATH` (string, default `lifecycle/log.jsonl` relative
     to the `lifecycle/` module directory).

2. Update `.env.example` with:
   ```env
   # Lifecycle log path (relative to src/lifecycle/ or absolute)
   # LIFECYCLE_LOG_PATH=lifecycle/log.jsonl
   ```

## Task group 6 — Tests

1. `tests/unit/lifecycle/stageDeltas.test.ts` — 4+ cases:
   - All four stages present → deltas computed correctly from earliest
     timestamps per stage.
   - Missing `processed` → `submitted→processed` is `null`.
   - Missing `finalized` → `confirmed→finalized` is `null`.
   - Timestamps out of order (shouldn't happen, but verify the function
     handles it gracefully — uses `Math.max` or sorts first).

2. `tests/unit/lifecycle/logWriter.test.ts` — 3+ cases:
   - `appendToLog` writes a valid JSON line to a temp file.
   - Each call appends a new line (multiple calls → multiple lines).
   - `createLifecycleLogEntry` produces the correct shape with `stageDeltas`
     computed.

3. `tests/integration/lifecycle/fullCycle.test.ts` — 1+ cases:
   - Simulate a full bundle lifecycle (submitted → processed → confirmed →
     finalized) by manually calling `tracker.recordSubmitted`, then
     `tracker.observe` at each stage, then `getBundleEvents`, then
     `createLifecycleLogEntry`, then `appendToLog`, then read the file back
     and verify it parses correctly with all four stages and correct deltas.

## Task group 7 — Verify + docs

1. Run `npm run typecheck`, `npm run build`, `npm test` — all green.

2. **Live mainnet run** (the primary checkpoint):
   - Run the entrypoint with `SEND_BUNDLE=true` against mainnet.
   - Confirm the `[lifecycle] written to log.jsonl` line appears.
   - Read `valence/lifecycle/log.jsonl` and verify the entry has:
     - All four stages (or as many as could be observed).
     - Non-null `stageDeltas` for any observed stage pair.
     - Monotonically increasing slots and timestamps across stages.
   - Run a second time → confirm a second appended line in the file.

3. **No-regression verification**:
   - Run with `SEND_BUNDLE=false` — confirm no log file is written.
   - Run unit tests — confirm no existing tests broke (95/95 from Phase 6
     should remain 95/95 or increase).

4. Tick the Phase 7 checkbox in `specs/roadmap.md` and mark this spec's
   validation document complete.
