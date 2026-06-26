# Plan — Retry logic (hardcoded first, to de-risk Phase 10)

> Covers roadmap Phase 9. Implements a hardcoded blockhash refresh + resubmit
> retry loop that triggers on any classified failure from Phase 8. No AI
> involvement — purely mechanical, to prove retry mechanics work before adding
> agent reasoning on top (Phase 11).
> Current date: June 26, 2026. Submission deadline: June 29, 2026.

---

## Task group 1 — Retry config and types ✅

- [x] Add `maxRetries` field to `ValenceConfig` in `src/types/config.ts`:
   ```ts
   maxRetries: number
   ```

- [x] Read from `process.env.MAX_RETRIES` in `src/config/env.ts`:
   - Strip and parse integer
   - Default to `3` if unset or invalid
   - Clamp to `[0, 10]` range

- [x] Add `maxRetries` to the returned config object in `src/config/env.ts`.

- [x] Update `.env.example`:
   ```env
   # Max retry attempts on failure (optional, default 3, range 0-10)
   # MAX_RETRIES=3
   ```

## Task group 2 — Implement hardcoded retry function ✅

- [x] Create `src/jito/retry.ts` with:
   - `retryBundleSubmission(config, wallet, rpc, tracker, originalBundleId, failure)`
   - Accepts the classified failure from Phase 8 and the original bundle context.
   - Returns `Promise<{ success: boolean; finalBundleId: string }>`.

- [x] Retry logic:
   a. If `failure` is `null` or `config.maxRetries === 0`, return immediately
      with `success: true` (nothing to retry).
   b. Loop up to `config.maxRetries` times:
      i.   Fetch a fresh blockhash at `processed` commitment.
      ii.  Wait 1 second for slot progression.
      iii. Rebuild tip accounts + bundle via `buildSelfTransferBundle` using
           the fresh blockhash.
      iv.  Simulate all bundle transactions. If simulation fails → log warning,
           increment retry count, continue to next attempt.
      v.   Submit via `submitBundle`. Record submission with a retry bundle ID
           like `"${originalBundleId}-retry-${attempt}"`.
      vi.  Poll for bundle status (20 × 1.25s). If landed → poll for
           processed/finalized, return `success: true`.
      vii. If bundle didn't land → fall back to `sendTransaction` (same
           combined-tx strategy). Poll for status.
      viii. If `sendTransaction` lands → return `success: true`.
      ix.  If neither path succeeded → classify the new failure, log warning,
           increment retry count, continue loop.
   c. After all retries exhausted, return `success: false`, `finalBundleId`
      set to the last attempted retry ID.

- [x] Export from `src/jito/index.ts`.

## Task group 3 — Wire retry into the entrypoint ✅

- [x] In `src/index.ts` `runBundleSubmission`, after the lifecycle log is written
   (end of the function):

   a. If `bundleFailure` is non-null AND `config.maxRetries > 0`:
      ```ts
      const retryResult = await retryBundleSubmission(
        config, wallet, rpc, tracker, usedBundleId, bundleFailure
      )
      ```
   b. Log retry outcome:
      ```ts
      console.log(`[retry] result: ${retryResult.success ? "success" : "failed"} after retries`)
      ```
   c. If the retry succeeded, write a second lifecycle log entry for the
      retry bundle (same `createLifecycleLogEntry` + `appendToLog` path).

   d. The retry function is called AFTER stdout summary + original log write,
      so a crash in retry logic doesn't lose the original lifecycle record.

- [x] If `bundleFailure` is null (no failure), skip retry entirely.

## Task group 4 — Tests ✅

- [x] `tests/unit/jito/retry.test.ts` — 4 cases:
   - Retry skipped when `failure` is null.
   - Retry skipped when `maxRetries === 0`.
   - Retry logic builds a bundle attempt with fresh blockhash (verify that
     `buildSelfTransferBundle` is called with the new blockhash — mock the
     submission layer to avoid real network calls).
   - Retry loop exhausts all attempts and returns `success: false` when
     submission consistently fails.

- [x] All tests mock `submitBundle` and `getInflightBundleStatuses` etc.
   to avoid hitting real Jito endpoints.

## Task group 5 — Verify + docs ✅

- [x] `npm run typecheck`, `npm run build`, `npm test` — all green.
- [ ] **Live mainnet run with INTENTIONAL_EXPIRY=true and MAX_RETRIES=3**:
   - Run the entrypoint. The intentional blockhash expiry triggers a failure.
   - The retry function should fire: detect the failure, refresh blockhash,
     rebuild bundle, resubmit, and the retry bundle should land successfully.
   - The lifecycle log should contain ≥2 entries: one with `failure:
     "expired_blockhash"` for the original, one with `failure: null` for
     the successful retry.
   - Confirm the stdout prints the `[retry]` lines for each attempt.
   *(Requires a funded mainnet wallet and RPC in .env. Run with
   `INTENTIONAL_EXPIRY=true MAX_RETRIES=3 SEND_BUNDLE=true`.)*
- [ ] **No-regression**: run without `INTENTIONAL_EXPIRY` — confirm normal
   submission flow is unchanged (no retries fire, lifecycle log has one
   entry with no failure).
- [x] Tick the Phase 9 checkbox in `specs/roadmap.md`.
