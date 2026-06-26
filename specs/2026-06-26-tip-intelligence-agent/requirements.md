# Requirements — Tip Intelligence agent (Groq)

## Feature summary

Replace Phase 6's hardcoded minimum tip (1000 lamports) with a real-time AI
agent decision. The agent receives live tip-floor percentiles, current
slot/leader context, and bundle metadata, then returns a tip in lamports plus
a natural-language reasoning string. The reasoning string is logged in every
lifecycle entry from this point on — satisfying the bounty's "reasoning is
visible" requirement.

The agent runs in the hot path between bundle assembly and submission. Groq's
low inference latency is the deciding factor: the agent call must complete
before the leader window passes.

## User decisions (from spec kickoff)

| Decision | Choice | Rationale |
|---|---|---|
| Scope | **Match roadmap exactly** | Groq tool-use call, structured `{ tip_lamports, reasoning }` output, server-side clamped. |
| Tip ceiling | **10,000 lamports** | 10x the minimum. With ≤15 submissions and ≤2 retries per submission, worst-case ~45 tips = 0.00045 SOL. Safe cost bound. |
| Groq model | **mixtral-8x7b-32768** | Fast inference, reliable structured-output / function-calling support on Groq's hosted API. |
| Provider | **Groq** (OpenAI-compatible) | Inference speed is load-bearing — the agent call sits between bundle assembly and submission. |

## Why this phase exists (context from roadmap)

Phase 6 proved the mechanical bundle submission works, but with a hardcoded
minimum tip — good for proving the plumbing, bad for winning tip auctions
under real conditions. Phase 10 replaces that constant with a live decision
backed by real data (tip-floor percentiles) and visible reasoning.

This is the phase that satisfies the bounty's "AI agent" requirement. Without
it, Valence is a well-instrumented mechanical stack with no agent-driven
decision. With it, every lifecycle entry carries the agent's reasoning string
alongside the numeric tip — a concrete, observable artifact of "the AI made
a real decision here."

## In scope

- **Groq client module** (`src/agent/`) — structured-output API call that
  sends tip-floor data + slot/leader context + bundle metadata and receives
  `{ tip_lamports, reasoning }`.
- **Tool-use / function-calling contract** — the agent response is returned as
  structured JSON via Groq's `tool_choice: "required"` or equivalent
  function-calling mode, never parsed from free text.
- **Tip floor data input** — the agent receives the current `TipFloorSnapshot`
  (p25/p50/p75/p95/p99/ema50) from the existing `TipFloorStore`.
- **Slot/leader context input** — the agent receives current slot number,
  leader identity, and whether the next leader is a Jito-Solana validator
  (from the existing `LeaderWindowDetector`).
- **Bundle metadata input** — the agent receives bundle size (number of
  transactions) and tip account (for awareness of write-lock contention).
- **Server-side tip clamping** — the agent's output tip is clamped server-side
  to `[1000, MAX_TIP_LAMPORTS]` (default max 10,000). The agent reasons within
  these bounds; it does not have unbounded wallet control.
- **Reasoning logging** — the `reasoning` string is stored in every
  `LifecycleEvent` and `LifecycleLogEntry` produced after this phase.
- **Config**: `GROQ_API_KEY`, `GROQ_MODEL` (default `mixtral-8x7b-32768`),
  `GROQ_ENDPOINT` (default `https://api.groq.com/openai/v1`),
  `MAX_TIP_LAMPORTS` (default 10000, range 1000-100000).
- **Graceful degradation** — if the Groq call fails (network error, API
  error, timeout), the system falls back to the 1000-lamport minimum and logs
  a warning, rather than crashing the submission.

## Out of scope (explicitly deferred)

- **Agent-driven retry** — Phase 11. Phase 10 only replaces the *tip*
  decision. Retry mechanics from Phase 9 remain hardcoded.
- **Multiple agent modes** — only Tip Intelligence ships. Failure Reasoning,
  Submission Timing, and Autonomous Retry are not implemented.
- **Agent memory / history** — the agent receives the current bundle context
  only, not a history of past decisions or bundle outcomes. Session memory is
  a Phase 11+ concern if the agent needs to learn from its own results.
- **Model swapping via OpenRouter** — documented as a fallback option in
  mission.md but not the default path for this phase.

## Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Agent runs in hot path | **Synchronous await before bundle submission** | The tip must be known before the bundle is built. Async fire-and-forget would miss the submission slot. |
| Structured output | **tool_choice / function-calling, not free-text parsing** | Deterministic, typed output the system can rely on without fragile regex/text parsing. |
| Reasoning string format | **Free text, 1-3 sentences, natural language** | The reasoning is for human readability in the lifecycle log, not machine processing. No templated format enforced. |
| Fallback on API failure | **Silent fallback to 1000 lamports, log warning** | A Groq outage should not block bundle submission. The system continues with the minimum floor tip. |

## Context and constraints (from mission.md / tech-stack.md)

- **Mainnet only.** The agent's input data (tip-floor percentiles, leader
  schedule) comes from mainnet endpoints. Devnet has no meaningful tip floor
  data and no Jito leader schedule.
- **Latency budget.** The Groq call adds latency between bundle assembly and
  submission. With mixtral-8x7b, typical inference time is 200-800ms. The
  total budget before the leader window closes is measured in seconds — the
  agent call must fit comfortably.
- **Rate limits.** Groq API rate limits apply (typically 30 req/min on the
  free tier, 500+ on paid). With ≤15 bundle submissions in the volume run,
  this is not a constraint — but documented for awareness.
- **No hardcoded tips after this phase.** Once Phase 10 ships, the hardcoded
  `BUNDLE_TIP_LAMPORTS` default of 1000 becomes the *minimum clamp*, not the
  default tip. The agent determines the actual tip per bundle.
