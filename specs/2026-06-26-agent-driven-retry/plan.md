# Plan — Agent-Driven Retry (Groq)

> Covers roadmap Phase 11. Replaces Phase 9's hardcoded retry loop with a
> Groq agent call per retry attempt. The agent receives failure context,
> original tip data, and current network conditions, and decides whether to
> retry and what tip to use. The agent's reasoning is captured and persisted
> in every retry lifecycle entry.
> Current date: June 26, 2026. Submission deadline: June 29, 2026.

---

## Task group 1 — Retry agent types

1. Create `src/agent/retryTypes.ts`:

```ts
import type { FailureClassification } from "../types/index.js"
import type { TipFloorSnapshot } from "../jito/types.js"

export interface RetryInput {
  failureClassification: FailureClassification
  originalTipLamports: number
  originalReasoning: string
  attemptNumber: number
  maxAttempts: number
  currentSlot: number
  leaderIdentity: string | null
  isJitoLeader: boolean
  tipFloorSnapshot: TipFloorSnapshot | null
  tipAccount: string
}

export interface RetryOutput {
  shouldRetry: boolean
  tipLamports: number
  reasoning: string
}
```

2. Export from `src/agent/index.ts` (already created in Phase 10).

## Task group 2 — Retry Groq client

1. Create `src/agent/retryClient.ts` with:
   - `callRetryAgent(input: RetryInput, config: ValenceConfig): Promise<RetryOutput>`
   - Builds a tool-use request to the Groq Chat Completions API
   - The tool/function has:
     - Name: `decide_retry`
     - Description: "Decide whether to retry a failed Jito bundle submission and what tip to use"
     - Parameters (JSON Schema):
       ```json
       {
         "type": "object",
         "properties": {
           "shouldRetry": { "type": "boolean", "description": "Whether to retry the submission" },
           "tipLamports": { "type": "integer", "description": "Tip in lamports if retrying (1000-100000)" },
           "reasoning": { "type": "string", "description": "Short natural-language explanation of the retry decision" }
         },
         "required": ["shouldRetry", "tipLamports", "reasoning"]
       }
       ```
   - System prompt (concept):
     ```
     You are a Retry Intelligence agent for the Solana Jito block engine.
     A bundle submission has failed. Given the failure classification, original
     tip amount and reasoning, current network conditions, and attempt number,
     decide whether to retry and what tip to use.
     - The minimum tip is 1000 lamports.
     - Consider whether the failure type is recoverable (e.g. expired_blockhash
       is recoverable; compute_exceeded may not be).
     - If retrying with a higher tip, explain why a higher tip is justified.
     - If choosing not to retry, explain why the failure is terminal.
     - Return your decision as a JSON object with shouldRetry (boolean),
       tipLamports (integer), and reasoning (string).
     ```
   - Uses `tool_choice: { type: "function", function: { name: "decide_retry" } }`
   - Reuses `AbortController` with 5-second timeout (same as Phase 10)
   - Rate limit retry: same 429-retry-once pattern as Phase 10
   - On total API failure: return `{ shouldRetry: true, tipLamports: originalTipLamports, reasoning: "...fallback..." }`

2. Tip clamping: same `clampOutput` helper from Phase 10

## Task group 3 — Wire retry agent into `retryBundleSubmission`

1. In `src/jito/retry.ts`, replace the hardcoded retry loop:

   Current flow:
   ```
   for attempt 1..maxRetries:
     fetch blockhash
     build bundle with config.bundleTipLamports
     simulate / submit / poll
   ```

   New flow:
   ```
   for attempt 1..maxRetries:
     callRetryAgent({ failure, originalTip, attemptNumber, maxAttempts, currentConditions })
     if !shouldRetry:
       log agent reasoning, return failure
     fetch blockhash
     build bundle with agent-decided tip
     simulate / submit / poll
   ```

2. The first retry call uses the original failure and tip from the initial
   submission. Subsequent retries pass the failure from the most recent failed
   attempt.

3. Pass `agentOutput.reasoning` to `tracker.recordSubmitted` for the retry
   bundle ID, and into `createLifecycleLogEntry` for the retry lifecycle entry.

4. The hardcoded `config.bundleTipLamports` in `buildSelfTransferBundle` calls
   within `retryBundleSubmission` is replaced by the agent-decided tip.

## Task group 4 — Update `retryBundleSubmission` return type

The current `RetryResult` interface:

```ts
export interface RetryResult {
  success: boolean
  finalBundleId: string
}
```

No changes needed — the caller (`runBundleSubmission`) already handles
success/failure based on this return type. The agent's reasoning is captured
in the lifecycle entry rather than the return value.

## Task group 5 — Tests

1. `tests/unit/agent/retryClient.test.ts` — at least 5 cases:
   - Builds correct tool-use request body for retry agent
   - Parses structured response with `shouldRetry: true` and new tip
   - Parses structured response with `shouldRetry: false`
   - Falls back to hardcoded retry on API error
   - Falls back to hardcoded retry on timeout

2. `tests/integration/agent/retryDecisionCycle.test.ts` — 2+ cases:
   - Inject classified failure, mock Groq to return `shouldRetry: true` with
     a higher tip, verify the retry bundle uses the higher tip.
   - Inject classified failure, mock Groq to return `shouldRetry: false`,
     verify the retry loop exits immediately without submitting.
   - Inject `compute_exceeded` failure, mock Groq to return `shouldRetry: false`,
     verify the retry loop exits and the lifecycle entry shows agent reasoning
     about the terminal failure.

3. All tests must mock the Groq HTTP endpoint (mock `fetch`) to avoid real
   API calls and API key requirements.

4. Update existing `retry.test.ts` tests:
   - The hardcoded retry tests should still pass since the fallback path
     (Groq API failure → hardcoded behavior) is preserved.
   - Add a test that verifies the fallback path when `groqApiKey` is null.

## Task group 6 — Verify + docs

1. `npm run typecheck`, `npm run build`, `npm test` — all green.
2. **Live mainnet run with INTENTIONAL_EXPIRY=true**:
   - Trigger an intentional blockhash expiry.
   - Confirm the retry agent is called and the stdout shows `[retry-agent]`
     lines with the retry decision and reasoning.
   - Confirm the retry lifecycle log entry contains the retry agent's reasoning.
3. **No-regression**: run with `GROQ_API_KEY` unset — confirm retries fall
   back to Phase 9 hardcoded behavior.
4. Tick the Phase 11 checkbox in `specs/roadmap.md`.
