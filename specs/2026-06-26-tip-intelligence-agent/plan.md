# Plan — Tip Intelligence agent (Groq)

> Covers roadmap Phase 10. Implements a Groq tool-use call that replaces Phase
> 6's hardcoded minimum tip with a live AI agent decision backed by tip-floor
> percentiles, slot/leader context, and bundle metadata. The agent's reasoning
> string is captured and persisted in every lifecycle entry.
> Current date: June 26, 2026. Submission deadline: June 29, 2026.

---

## Task group 1 — Agent config and types

1. Create `src/agent/types.ts`:
   ```ts
   export interface AgentInput {
     tipFloorSnapshot: TipFloorSnapshot
     currentSlot: number
     leaderIdentity: string | null
     isJitoLeader: boolean
     bundleSize: number // tx count
     tipAccount: string
   }

   export interface AgentOutput {
     tipLamports: number
     reasoning: string
   }
   ```

2. Add config fields to `ValenceConfig` in `src/types/config.ts`:
   - `groqApiKey: string | null`
   - `groqModel: string` (default `"mixtral-8x7b-32768"`)
   - `groqEndpoint: string` (default `"https://api.groq.com/openai/v1"`)
   - `maxTipLamports: number` (default 10000, range 1000–100000)

3. Read from env vars in `src/config/env.ts`:
   - `GROQ_API_KEY` — required (throw if unset and agent-enabled)
   - `GROQ_MODEL` — optional, default `mixtral-8x7b-32768`
   - `GROQ_ENDPOINT` — optional, default `https://api.groq.com/openai/v1`
   - `MAX_TIP_LAMPORTS` — optional, strip+parse, default 10000, clamp to `[1000, 100000]`

4. Update `.env.example`:
   ```env
   # Groq AI agent (Tip Intelligence)
   GROQ_API_KEY=gsk_your_key_here
   # GROQ_MODEL=mixtral-8x7b-32768
   # GROQ_ENDPOINT=https://api.groq.com/openai/v1
   # MAX_TIP_LAMPORTS=10000
   ```

## Task group 2 — Groq client

1. Create `src/agent/groqClient.ts` with:
   - `callTipAgent(input: AgentInput, config: ValenceConfig): Promise<AgentOutput>`
   - Builds a tool-use / function-calling request to the Groq Chat Completions API
   - The tool/function has:
     - Name: `decide_tip`
     - Description: "Decide the Jito bundle tip in lamports based on current network conditions"
     - Parameters (JSON Schema):
       ```json
       {
         "type": "object",
         "properties": {
           "tipLamports": { "type": "integer", "description": "Tip in lamports (1000-100000)" },
           "reasoning": { "type": "string", "description": "Short natural-language explanation of the decision" }
         },
         "required": ["tipLamports", "reasoning"]
       }
       ```
   - System prompt (concept):
     ```
     You are a Tip Intelligence agent for the Solana Jito block engine.
     Given current tip-floor percentiles, slot/leader context, and bundle metadata,
     choose a tip in lamports and explain your reasoning.
     - The minimum tip is 1000 lamports.
     - Higher tips increase landing probability but cost more.
     - Consider the current p50/p75/p95 percentiles as guidance.
     - If the next leader is a Jito validator, a moderate tip may suffice.
     - Return your decision as a JSON object with tipLamports (integer) and reasoning (string).
     ```
   - Uses `tool_choice: { type: "function", function: { name: "decide_tip" } }` to force structured output
   - On API error / timeout: return `{ tipLamports: 1000, reasoning: "Groq API unavailable — fell back to minimum tip" }`

2. Handle rate limits (429):
   - Retry once after 1s backoff
   - If still rate-limited, fall back to minimum tip

3. Handle timeout:
   - Use `AbortController` with 5-second timeout
   - On timeout, fall back to minimum tip

## Task group 3 — Wire agent into bundle submission

1. In `src/index.ts` `runBundleSubmission`, replace the hardcoded
   `config.bundleTipLamports` with an agent call between blockhash fetch and
   bundle construction:

   ```ts
   let agentOutput: AgentOutput = { tipLamports: config.bundleTipLamports, reasoning: "hardcoded fallback" }
   if (config.groqApiKey) {
     try {
       const tipFloorSnapshot = tipStore?.get() ?? null
       const leaderInfo = detector ? { identity: detector.currentLeader, isJito: detector.currentIsJito } : null
       agentOutput = await callTipAgent({
         tipFloorSnapshot,
         currentSlot,
         leaderIdentity: leaderInfo?.identity ?? null,
         isJitoLeader: leaderInfo?.isJito ?? false,
         bundleSize: 2,
         tipAccount,
       }, config)
     } catch (err) {
       console.warn(`[agent] Groq call failed: ${err instanceof Error ? err.message : String(err)} — using minimum tip`)
     }
   }
   const tipAmount = Math.max(1000, Math.min(config.maxTipLamports, agentOutput.tipLamports))
   ```

2. Pass `agentOutput.reasoning` into `createLifecycleLogEntry` and
   `SignatureTracker.recordSubmitted` / `getBundleEvents` so the reasoning
   string appears in every lifecycle event and log entry.

3. **Important**: the agent call happens AFTER blockhash fetch (so blockhash
   stays fresh) but BEFORE `buildSelfTransferBundle` (so bundle uses the
   decided tip).

## Task group 4 — Update lifecycle types for reasoning

1. Ensure `LifecycleEvent` and `LifecycleLogEntry` already include
   `agentReasoning: string | null` — if not, add it (check Phase 7 types).

2. In `createLifecycleLogEntry`, pass `agentReasoning` through from the
   entry parameters.

3. In `SignatureTracker.recordSubmitted`, accept `agentReasoning` and store
   it in the `BundleRecord`.

4. In `SignatureTracker.getBundleEvents`, include `agentReasoning` in each
   generated event.

## Task group 5 — Tests

1. `tests/unit/agent/groqClient.test.ts` — at least 4 cases:
   - Calls Groq API with correct tool-use payload (mock fetch, verify
     request body shape).
   - Parses structured JSON response into `AgentOutput`.
   - Falls back to minimum tip on API error (mock non-ok response).
   - Falls back to minimum tip on timeout (mock slow response with
     `AbortController` simulation).

2. `tests/integration/agent/tipDecisionCycle.test.ts` — 1+ case:
   - Mock the Groq endpoint to return a specific `tipLamports` + `reasoning`.
   - Call `callTipAgent` with a real `TipFloorSnapshot` and leader context.
   - Verify the returned tip is clamped to `[1000, maxTipLamports]`.
   - Verify the reasoning string is non-empty.

3. All tests must mock the Groq HTTP endpoint (mock `fetch`) to avoid real
   API calls and API key requirements.

## Task group 6 — Verify + docs

1. `npm run typecheck`, `npm run build`, `npm test` — all green.
2. **Live mainnet run with SEND_BUNDLE=true and GROQ_API_KEY set**:
   - Run the entrypoint. Confirm stdout shows `[agent]` lines with tip
     decision and reasoning.
   - Confirm the lifecycle log entry contains the reasoning string.
   - Run back-to-back submissions (or restart a few times) and observe that
     the agent chooses different tips as tip-floor data shifts.
3. **No-regression**: run with `SEND_BUNDLE=true` but without `GROQ_API_KEY`
   — confirm the system falls back to the minimum 1000-lamport tip and does
   not crash or error.
4. Tick the Phase 10 checkbox in `specs/roadmap.md`.
