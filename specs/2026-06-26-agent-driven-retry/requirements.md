# Requirements — Agent-Driven Retry (Groq)

## Feature summary

Replace Phase 9's hardcoded retry logic with an agent-driven decision. On a
detected bundle failure, instead of unconditionally refreshing the blockhash
and resubmitting with the same tip, the system calls a Groq retry agent that
receives the failure classification, original tip + reasoning, and current
network conditions. The agent decides:
1. **Whether to retry** — some failures (e.g. `compute_exceeded`) may not be
   recoverable by retrying; the agent can choose to give up.
2. **What tip to use** — if retrying, the agent adjusts the tip based on the
   failure context (e.g. bump toward a higher percentile after a bundle that
   didn't land).

The agent's reasoning for both decisions is captured and persisted in the
lifecycle log alongside the original tip decision.

## User decisions (from spec kickoff)

| Decision | Choice | Rationale |
|---|---|---|
| Retry scope | **Tip + retry decision** | Agent decides whether to retry AND what tip to use. The hardcoded maxRetries loop is replaced by per-attempt agent decisions. The agent can give up early on unrecoverable failures. |
| Agent call pattern | **Separate retry agent** | New `callRetryAgent` function with a dedicated failure-reasoning prompt. Clean separation from `callTipAgent`; the retry contract (failure context + retry decision) is different enough to warrant its own function. |
| Groq model | **Same as Phase 10** (`llama-3.1-8b-instant`) | Reuse the same model for consistency. Retry reasoning is still latency-sensitive since it runs between failure detection and resubmission. |
| Provider | **Groq** (OpenAI-compatible) | Same rationale as Phase 10 — inference speed is load-bearing in the retry hot path. |

## Why this phase exists (context from roadmap)

Phase 9 proved the retry mechanics work mechanically (blockhash refresh,
rebuild bundle, resubmit), but the retry is hardcoded: it always retries
with the same tip, up to `maxRetries` times. This phase connects the retry
loop to the AI agent so the retry decision itself is reasoned, not scripted.

This satisfies mission.md's "no hardcoded retry flow" requirement. Without it,
the stack retries mechanically without learning from failures. With it, every
retry carries the agent's reasoning about what went wrong and what should
change.

## In scope

- **Retry agent module** (`src/agent/retryClient.ts`) — Groq tool-use call
  that receives failure context, original tip data, current network conditions,
  and returns `{ shouldRetry: boolean, tipLamports: number, reasoning: string }`.
- **Tool-use / function-calling contract** — structured JSON output via
  `tool_choice`, never parsed from free text.
- **Failure context input** — the agent receives the `FailureClassification`,
  original `tipLamports`, original `reasoning`, current `TipFloorSnapshot`,
  current slot, leader identity, and whether the current leader is Jito.
- **Server-side clamping** — the agent's tip is clamped to `[1000, maxTipLamports]`
  server-side, same as Phase 10.
- **Retry count awareness** — the agent receives the current attempt number
  and max attempts so it can reason about whether to keep trying.
- **Reasoning logging** — the retry agent's `reasoning` string is stored in
  the lifecycle log entry for the retry bundle, alongside the new tip amount.
- **Config**: no new env vars needed; reuses `GROQ_API_KEY`, `GROQ_MODEL`,
  `GROQ_ENDPOINT`, `MAX_TIP_LAMPORTS` from Phase 10.
- **Graceful degradation** — if the Groq call fails, fall back to Phase 9's
  hardcoded retry behavior (retry with same tip, up to maxRetries).

## Out of scope (explicitly deferred)

- **Multi-agent coordination** — the retry agent is a separate call from the
  tip agent, but they don't share state or session memory. Cross-agent memory
  is deferred to a potential future phase.
- **Dynamic maxRetries** — the agent can choose to stop retrying early, but
  the hard `maxRetries` ceiling from env still applies. The agent cannot
  extend the retry limit.
- **Failure-specific agent strategies** — each failure type gets the same
  prompt. No per-failure-class prompt specialization.
- **Switching providers** — Groq remains the sole provider for the retry
  agent, same as Phase 10.

## Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Retry agent is a separate function | **new `callRetryAgent`** | The input shape (failure context + attempt info) and output shape (shouldRetry + tip) are different enough from the tip agent that sharing one function would be awkward. |
| Agent can stop retrying | **`shouldRetry: boolean` in output** | Some failures (e.g. `compute_exceeded` with no compute budget headroom) are unrecoverable by retrying. The agent should be able to say "don't bother." |
| Fallback on API failure | **Phase 9 hardcoded behavior** | If the retry agent call fails, fall back to the original hardcoded retry (same tip, up to maxRetries). The system never blocks a retry because the agent is unavailable. |
| Timing | **Agent call inside the retry loop** | The agent call happens inside `retryBundleSubmission`, before each attempt. This is the only point where the agent has the failure context from the previous attempt. |

## Context and constraints (from mission.md / tech-stack.md)

- **Same latency budget as Phase 10.** The retry agent call adds latency
  between failure detection and resubmission. With `llama-3.1-8b-instant`,
  typical inference is 200-800ms. The blockhash is fetched fresh before each
  retry attempt anyway, so the agent call doesn't add blockhash-age risk.
- **Rate limits.** Each retry attempt adds one Groq API call. With `maxRetries`
  defaulting to 3, a worst-case failure + 3 retries = 4 Groq calls per bundle.
  Well within the 30 req/min free tier.
- **No new env vars.** All Groq config is inherited from Phase 10.
- **Failure classifications from Phase 8** (`expired_blockhash`, `fee_too_low`,
  `compute_exceeded`, `bundle_failure`, `unknown`) are the input the agent
  reasons over. The `unknown` classification is a signal to the agent that
  something unexpected happened — the agent may choose to retry cautiously
  or not at all.
