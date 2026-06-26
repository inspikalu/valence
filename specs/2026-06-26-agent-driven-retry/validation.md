# Validation — Agent-Driven Retry (Groq)

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

- `src/agent/retryClient.ts` (`callRetryAgent`) — 5+ cases:
  - Builds correct tool-use request body (verify via mocked fetch that the
    Groq API URL, headers, and JSON body contain the retry-specific prompt
    and `decide_retry` tool definition).
  - Parses a valid Groq response with `shouldRetry: true`, `tipLamports`, and
    `reasoning` into `RetryOutput`.
  - Parses a valid Groq response with `shouldRetry: false` and empty/zero tip.
  - Falls back to hardcoded retry `{ shouldRetry: true, tipLamports: originalTip }`
    on HTTP error (non-2xx response from Groq).
  - Falls back to hardcoded retry on timeout (simulate `AbortSignal` abort).
- Existing `retry.test.ts` hardcoded retry tests must still pass (the fallback
  path is preserved).
- All tests must mock the Groq endpoint via `vi.spyOn(globalThis, "fetch")`.

### Integration test coverage

- `tests/integration/agent/retryDecisionCycle.test.ts` — 2+ cases:
  - Inject `expired_blockhash` failure, mock Groq to return
    `shouldRetry: true, tipLamports: 8000`. Call `retryBundleSubmission` and
    verify the retry attempt uses tip 8000 (not the original 1000) and the
    lifecycle entry contains the agent's reasoning.
  - Inject `compute_exceeded` failure, mock Groq to return
    `shouldRetry: false`. Verify the retry loop exits without submitting a
    new bundle and the return value is `{ success: false, ... }`.

## Manual / live checks (mainnet)

1. **Agent makes a visible retry decision.**
   - Set `GROQ_API_KEY`, `SEND_BUNDLE=true`, and `INTENTIONAL_EXPIRY=true`
     in `.env`.
   - Run the entrypoint.
   - Confirm stdout shows `[retry-agent]` lines with the retry decision
     (shouldRetry + tipLamports) and reasoning string before each retry
     attempt.
   - The retry lifecycle log entry should contain `agentReasoning` with
     non-null content explaining the retry decision.

2. **Agent decides not to retry on terminal failure.**
   - Set up a scenario where the agent classifies a failure as unrecoverable
     (e.g. `compute_exceeded` with no headroom, or mock the Groq response).
   - Confirm the retry loop exits immediately without submitting.
   - Confirm the lifecycle log entry shows `agentReasoning` that mentions
     the terminal failure.

3. **Agent adjusts tip upward on retry.**
   - Trigger a bundle that doesn't land (e.g. low initial tip).
   - Confirm the retry agent's decided tip is higher than the original tip.
   - Confirm the lifecycle log shows the higher tip and the agent's reasoning
     for the increase.

4. **Graceful fallback when Groq is unavailable.**
   - Set `GROQ_API_KEY` to an invalid key.
   - Run with `INTENTIONAL_EXPIRY=true`.
   - Confirm retries fall back to Phase 9 hardcoded behavior (same tip,
     up to `maxRetries`).
   - Confirm no crash or hang.

5. **No-regression without GROQ_API_KEY.**
   - Unset `GROQ_API_KEY`.
   - Run with `INTENTIONAL_EXPIRY=true`.
   - Confirm retries use Phase 9 hardcoded behavior as before.
   - Confirm no Groq-related errors or warnings.

## Secrets / hygiene

- Same rules as Phase 10: `GROQ_API_KEY` is never committed, logged, or
  serialized in lifecycle entries.

## Definition of done (maps to roadmap Phase 11 check)

- [ ] `npm run build`, `npm run typecheck`, `npm test` all green.
- [ ] `callRetryAgent` function in `src/agent/retryClient.ts`: builds tool-use
      request, calls Groq API, parses structured JSON, returns `RetryOutput`.
- [ ] `RetryInput` and `RetryOutput` types in `src/agent/retryTypes.ts`.
- [ ] Wired into `retryBundleSubmission`: agent call before each retry attempt;
      agent decides `shouldRetry` and `tipLamports`; agent reasoning captured
      in lifecycle events and log entries for retry bundles.
- [ ] Server-side tip clamping: `Math.max(1000, Math.min(config.maxTipLamports, agentOutput.tipLamports))`.
- [ ] Graceful fallback: Groq API error/timeout produces hardcoded retry
      behavior (same as Phase 9), does not crash the process.
- [ ] Agent can stop retrying: when `shouldRetry: false`, the retry loop
      exits and returns `{ success: false }`.
- [ ] Live test: `INTENTIONAL_EXPIRY=true` run produces `[retry-agent]` stdout
      lines and non-null `agentReasoning` in retry lifecycle log entry.
- [ ] No-regression: without `GROQ_API_KEY`, retries use Phase 9 hardcoded
      behavior with no errors.
- [ ] Phase 11 checkbox ticked in `specs/roadmap.md`.

## Explicitly NOT validated here (deferred)

- Session memory / learning from past bundles — uses current context only.
- Multi-agent coordination — retry agent is independent of tip agent.
- Per-failure-class prompt specialization — all failures use the same prompt.
