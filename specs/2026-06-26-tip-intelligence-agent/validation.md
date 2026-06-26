# Validation — Tip Intelligence agent (Groq)

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

- `src/agent/groqClient.ts` (`callTipAgent`) — 4+ cases:
  - Builds correct tool-use request body (verify via mocked fetch that the
    Groq API URL, headers, and JSON body are correct).
  - Parses a valid Groq structured-response into `AgentOutput` with
    `tipLamports` and `reasoning`.
  - Falls back to `{ tipLamports: 1000, reasoning: ... }` on HTTP error
    (non-2xx response from Groq).
  - Falls back to minimum tip on timeout (simulate `AbortSignal` abort).
- All tests must mock the Groq endpoint via `vi.spyOn(globalThis, "fetch")`
  to avoid real API calls.

### Integration test coverage

- `tests/integration/agent/tipDecisionCycle.test.ts` — 1+ case:
  - Mock the Groq endpoint to return `{ tipLamports: 5000, reasoning: "test" }`.
  - Call `callTipAgent` with a realistic `AgentInput` (real `TipFloorSnapshot`
    shape, real slot/leader context).
  - Verify the returned `tipLamports` is clamped to `[1000, maxTipLamports]`
    (e.g. test with `maxTipLamports: 3000` and agent returns 5000 → clamped
    to 3000).
  - Verify `reasoning` is non-empty string.

## Manual / live checks (mainnet)

1. **Agent makes a visible tip decision.**
   - Set `GROQ_API_KEY` and `SEND_BUNDLE=true` in `.env`.
   - Run the entrypoint.
   - Confirm stdout shows `[agent]` lines with the decided tip amount and
     reasoning string before the bundle submission lines.
   - The lifecycle log entry should contain the `agentReasoning` field with
     non-null content.

2. **Agent chooses different tips across runs.**
   - Run the entrypoint 2-3 times (or across a span where tip-floor data
     shifts naturally).
   - Compare the `agentReasoning` and `tipLamports` values across runs.
   - At least two runs should show different reasoning (not identical
     templated text), demonstrating the agent is responding to live data
     rather than returning a static response.

3. **Server-side clamping enforced.**
   - Set `MAX_TIP_LAMPORTS=2000` in `.env`.
   - If the Groq API returns a tip above 2000, confirm the lifecycle log
     shows `tipLamports: 2000` (not the inflated value).
   - If the Groq API returns a tip below 1000, confirm the lifecycle log
     shows `tipLamports: 1000`.

4. **Graceful fallback when Groq is unavailable.**
   - Set `GROQ_API_KEY` to an invalid key (or unset it).
   - Run the entrypoint.
   - Confirm stdout shows a `[agent]` warning about the API failure.
   - Confirm the bundle still submits with the minimum 1000-lamport tip.
   - Confirm the lifecycle log shows `agentReasoning` indicating fallback.

5. **No-regression without GROQ_API_KEY.**
   - Unset `GROQ_API_KEY` (or don't set it).
   - Run with `SEND_BUNDLE=true`.
   - Confirm the system uses `config.bundleTipLamports` (1000) as before.
   - Confirm no Groq-related errors or warnings appear.
   - Confirm the lifecycle log has `agentReasoning: null` (same as Phase 7/8
     behavior).

## Secrets / hygiene

- `GROQ_API_KEY` is never committed, logged, or serialized in lifecycle entries.
- The agent function receives the key from `config.groqApiKey` (loaded from
  env) and uses it only in the HTTP Authorization header.
- The `GROQ_API_KEY` env var is documented in `.env.example` with a
  placeholder.

## Definition of done (maps to roadmap Phase 10 check)

- [ ] `npm run build`, `npm run typecheck`, `npm test` all green.
- [ ] `callTipAgent` function in `src/agent/groqClient.ts`: builds tool-use
      request, calls Groq API, parses structured JSON, clamps result,
      returns `AgentOutput`.
- [ ] `AgentInput` and `AgentOutput` types in `src/agent/types.ts`.
- [ ] `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_ENDPOINT`, `MAX_TIP_LAMPORTS`
      config fields in `ValenceConfig`, read from env vars, documented in
      `.env.example`.
- [ ] Wired into `runBundleSubmission`: agent call between blockhash fetch
      and bundle construction; agent reasoning captured in lifecycle events
      and log entries.
- [ ] Server-side tip clamping: `Math.max(1000, Math.min(config.maxTipLamports, agentOutput.tipLamports))`.
- [ ] Graceful fallback: Groq API error/timeout produces minimum tip + logged
      warning, does not crash the process.
- [ ] Live test: `GROQ_API_KEY` set produces `[agent]` stdout lines and
      non-null `agentReasoning` in lifecycle log.
- [ ] No-regression: without `GROQ_API_KEY`, system uses 1000-lamport floor
      with no errors.
- [ ] Phase 10 checkbox ticked in `specs/roadmap.md`.

## Explicitly NOT validated here (deferred)

- Agent-driven retry decision — Phase 11.
- Tip adjustment on retry — Phase 11.
- Session memory / learning from past bundle outcomes — Phase 11.
- Volume run with ≥10 submissions — Phase 12.
