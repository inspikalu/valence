# Requirements — Retry logic (hardcoded first, to de-risk Phase 10)

## Feature summary

When a bundle submission fails with any classified failure (expired blockhash,
fee too low, compute exceeded, bundle failure), the system should
automatically attempt to recover by refreshing the blockhash and resubmitting
the bundle. Phase 9 implements this as a plain hardcoded loop — no AI agent
involvement — to isolate and prove the mechanics of retry before Phase 11
wraps agent reasoning around it.

Phase 8 proved that failures can be classified. Phase 9 proves they can be
recovered from. Together they form the non-agent half of "automatic recovery."

## Why this phase exists (context from roadmap)

The roadmap deliberately splits retry into two phases:
- **Phase 9 (this)**: hardcoded retry mechanics — proves blockhash refresh,
  rebuild, and resubmit work end-to-end without the complexity of agent
  reasoning. Bugs in retry mechanics and bugs in agent reasoning are never
  debugged at the same time.
- **Phase 11**: agent-driven retry — the agent decides *whether* to retry,
  *what* to change (e.g. tip bump), and *when*. Phase 9's hardcoded function
  will be replaced or augmented by the agent's decision loop.

This split matters because the mission.md defines "Failure is a feature" as a
design principle — the system must demonstrate recovery from real failures, and
a hardcoded retry is the simplest thing that can work while the agent path is
still being built. If Phase 11 runs short on time, Phase 9's hardcoded retry
plus a README note about the tradeoff is an honest fallback that still
satisfies "failure handling is required."

## User decisions (from spec kickoff)

| Decision | Choice | Rationale |
|---|---|---|
| Retry trigger scope | **All failure types** (not just expired blockhash) | The retry function should handle any classified failure. A single refresh+resubmit loop works for all cases — the fresh blockhash addresses expiry, and the rebuild addresses transient state issues. |
| Max retry attempts | **3** (1 original + 2 retries) | Bounded cost per mission.md risk posture. 3 attempts provide enough rope to demonstrate the retry path without unbounded wallet risk. |
| Retry strategy | **Retry full submission** — fresh blockhash, new bundle, simulation, sendBundle + fallback | Simpler, cleaner than trying to retry only the sendBundle portion. Matches Phase 6's dual-strategy approach and gives each retry the best chance of landing. |
| Retry tracking | **Separate lifecycle entries** — original failure as one entry, each retry as a new entry with `-retry-N` suffix | Keep the lifecycle log clean: one entry per submission attempt. The original failure entry is preserved as a durable record. |

## In scope

- **Retry function** (`retryBundleSubmission`) — standalone, stateless function
  that accepts config + wallet + rpc + tracker + original bundle ID + failure
  classification and returns `{ success, finalBundleId }`.
- **Blockhash refresh** — fetches a fresh blockhash at `processed` commitment
  before each retry attempt, ensuring the retried bundle uses a current
  blockhash even if the original expired.
- **Bundle rebuild** — calls `buildSelfTransferBundle` with the fresh blockhash
  to produce new transactions. The tip account rotates via `TipAccountSelector`
  (already round-robin) for better distribution.
- **Simulation on retry** — simulates all retry bundle transactions before
  submission; logs warnings on simulation failure but continues (the fresh
  blockhash might make it work).
- **Full dual-strategy submission on retry** — each retry goes through the
  same sendBundle → fallback sendTransaction path as Phase 6.
- **Separate lifecycle tracking** — each retry has its own bundle ID
  (`"${originalId}-retry-${attempt}"`) and is tracked via the existing
  `SignatureTracker` + `createLifecycleLogEntry` + `appendToLog`.
- **Config**: `MAX_RETRIES` env var (default 3, range 0-10, 0 disables retry).
- **Graceful degradation** — if the retry function itself throws, the error is
  caught and logged without crashing the process. The original lifecycle log
  entry (the one that triggered the retry) is already on disk.

## Out of scope (explicitly deferred)

- **Agent reasoning on retry** — Phase 11. Phase 9 does not call Groq, does
  not adjust tip amounts, does not decide "should I retry or give up" — it
  always retries up to `maxRetries` times on any classified failure.
- **Tip bump** — Phase 11. Phase 9 retries with the same tip amount. Tip
  adjustment is an agent-level decision.
- **Exponential backoff** — not needed for ≤2 retries. A fixed 1s wait between
  attempts is sufficient and simpler.
- **Leader-aware timing** — not needed for hardcoded retry. The agent may
  consider leader windows in Phase 11.
- **Partial retry** (e.g., retrying only one failed transaction in a bundle) —
  the whole bundle is rebuilt and resubmitted. Partial retry adds complexity
  with no Phase 9 benefit.

## Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Retry entry in lifecycle log | **Separate JSONL line** per retry attempt, with `-retry-N` suffix on bundle ID | Preserves the original failure record; the log becomes a full audit trail of what happened and what was done about it. |
| Retry function signature | `(config, wallet, rpc, tracker, originalBundleId, failure) => Promise<{ success, finalBundleId }>` | Stateless, testable, all inputs explicit. No hidden state or class fields. |
| Failure types that trigger retry | All five: expired_blockhash, fee_too_low, compute_exceeded, bundle_failure, unknown | The hardcoded refresh+resubmit loop is cheap enough to run on any failure. A fresh blockhash + new bundle is a reasonable recovery attempt for any transient failure. |

## Context and constraints (from mission.md / tech-stack.md)

- **Mainnet only.** Retry must work on mainnet; the `INTENTIONAL_EXPIRY=true`
  path from Phase 8 is the primary test vehicle.
- **Rate limit.** Jito Block Engine rate limits (1 req/sec/IP/region) apply.
  The 1s backoff between attempts helps, but the retry loop should also
  handle 429s from `submitBundle` and status polls (the existing 5-attempt
  retry-with-backoff in `submitBundle` already handles this).
- **Cost bounding.** Each retry attempt costs tip + fee. With default 1000
  lamport tips and ≤2 retries, worst-case per-bundle spend is ~3× the single
  tip (3000 lamports = ~0.000003 SOL). Well within mission.md's risk posture.
- **No hardcoded tips.** The retry uses the same `config.bundleTipLamports`
  as the original submission. Tip adjustment comes in Phase 11.
- **Log persistence order.** The original (failed) lifecycle entry is written
  to disk before retry starts. If the retry crashes, the original failure
  record is not lost.

## Open items to verify during implementation

- Whether `submitBundle` returns a valid bundle ID for a bundle built with a
  freshly fetched blockhash after an intentional expiry — the Jito Block Engine
  should accept it; verify on live mainnet.
- Whether the 1s backoff between retry attempts is sufficient to avoid 429s
  — the existing rate-limit retry in `submitBundle` provides a safety net.
- Whether the simulation of the retry bundle might still fail if the new
  blockhash was fetched at the very edge of its validity window (unlikely with
  `processed` commitment, but worth observing on mainnet).
