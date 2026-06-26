# Requirements — Volume run: produce the required lifecycle log

## Feature summary

Run the full pipeline for ≥10 real bundle submissions in a single session,
ensuring ≥2 are failures with distinct root causes (blockhash expiry, tip too
low, compute exceeded). Export the resulting lifecycle log as the bounty's
central deliverable — a structured record of every submission's full lifecycle
from submission through all four commitment stages, with failure classification
where applicable.

This phase does not add new infrastructure. It wraps the existing
single-submission flow in a sequential orchestrator that runs N submissions
with configurable failure injection, collects lifecycle entries, and outputs a
clean, aggregated log file.

## Failure injection strategy (from spec kickoff)

Three distinct failure modes are injected into the volume run, ensuring the
≥2 required failures cover different root causes:

| Mode | Mechanism | Coverage |
|---|---|---|
| **Blockhash expiry** (`expiry`) | Existing `INTENTIONAL_EXPIRY=true` — uses finalized-commitment blockhash so it's already stale at submission time | Guarantees at least one `expired_blockhash` failure |
| **Low tip** (`low_tip`) | Override tip to 1 lamport (below Jito's 1000-lamport floor), bypassing the agent's clamping — bundle fails to land or is rejected at auction | Produces a `fee_too_low` or non-landing bundle failure |
| **Compute exceeded** (`compute_exceeded`) | Include a deliberately compute-heavy instruction or set an impossibly low compute budget (e.g. 1 CU) so the transaction hits `compute_exceeded` on simulation or execution | Guarantees at least one `compute_exceeded` failure |

The orchestrator cycles through these modes across the volume run so the final
log contains submissions with all three failure types plus clean (no-injection)
submissions.

## In scope

- **Sequential orchestrator** — a loop in the existing entrypoint that runs
  `runBundleSubmission` N times (configurable via `VOLUME_COUNT` env var,
  default 1 for backward compatibility).
- **Failure injection** — three modes cycled via `INJECT_FAILURE_MODE` env
  var (comma-separated), each applied to specific submissions in the run.
  Default cycle: 1 clean, 1 expiry, 1 clean, 1 low_tip, 1 clean, 1
  compute_exceeded, repeat.
- **Per-submission reset** — each iteration gets a fresh blockhash, fresh
  signature tracker (state carried forward only for cross-submission analysis),
  and independent lifecycle events.
- **Log aggregation** — all lifecycle entries from all submissions are written
  to a single JSONL file. The final log must have ≥10 entries with ≥2 showing
  failures.
- **Rate-limit awareness** — 2-second minimum delay between submissions to
  respect Jito's 1 req/s/IP/region Block Engine rate limit. Configurable via
  `VOLUME_INTERVAL_MS` env var (default 2000).
- **Failure simulation for `low_tip`** — bypass the agent's tip clamping for
  injected low-tip submissions so the tip goes below Jito's 1000-lamport floor.
- **Failure simulation for `compute_exceeded`** — add a
  `ComputeBudgetProgram.setComputeUnitLimit(1)` instruction so the transaction
  deterministically exceeds its budget.

## Out of scope

- **Parallel submission** — all submissions are sequential. Parallel support
  would add complexity (rate-limit coordination, nonce management) with no
  scoring benefit.
- **Dynamic failure scheduling** — the injection cycle is predetermined and
  configured up front. No runtime decision about when to inject a failure.
- **Multi-wallet** — all submissions use the same wallet. Cross-wallet
  orchestration is deferred.
- **Dashboard or visualization** — the log is the deliverable. A reader/viewer
  is not required.

## User decisions (from spec kickoff)

| Decision | Choice | Rationale |
|---|---|---|
| Failure injection approaches | `INTENTIONAL_EXPIRY` + deliberately low tip + `compute_exceeded` | Three distinct failure types demonstrate the classifier's breadth. Low-tip and compute-exceeded are real-world failure modes, not just expiry. |
| Submission orchestration | Sequential | Respects Jito's 1 req/s/IP/region rate limit. Avoids nonce conflicts. Simple to debug. |
| Entrypoint | Flag on existing entrypoint (`VOLUME_COUNT` env var) | No new CLI script needed. Backward-compatible: default `VOLUME_COUNT=1` reproduces today's single-submission behavior. |

## Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Failure mode cycling | Clean → expiry → clean → low_tip → clean → compute_exceeded → repeat | Every failure submission is preceded by a clean run so failures don't cascade. Cycle produces a balanced log. |
| Log format | JSON Lines (existing `appendToLog`), one file per run | Existing format. No new parser or consumer needed. The deliverable is the file itself. |
| Wallet reuse | Same wallet across all submissions | Simpler setup. Balance must be sufficient for all tips + fees (~0.001 SOL per submission worst case). |
| Default submission count | 10 (env `VOLUME_COUNT`) | Satisfies the ≥10 requirement. Can be increased for more data. |

## Context and constraints

- **Mainnet cost**: each submission pays a tip (agent-decided, clamped 1000—
  maxTipLamports) + Solana base fee (~5000 lamports). With 10 submissions
  and tips averaging 2000–5000 lamports, total cost is ~0.0007–0.0055 SOL.
  Fund the wallet accordingly.
- **Jito rate limit**: 1 req/s/IP/region. The 2-second default interval is a
  safety margin on top of the 1-second minimum.
- **Blockhash freshness**: Each submission fetches its own blockhash at
  `processed` commitment. The sequential loop naturally avoids stale
  blockhashes since each iteration fetches a fresh one.
- **Signature tracker**: A fresh `SignatureTracker` per run bundles all
  submissions' events. Events are keyed by bundle ID with `-retry-N` suffixes
  for retries, so no collision occurs.
- **Failure mode env vars**: `INJECT_FAILURE_MODE` controls which submissions
  get failures. Example: `INJECT_FAILURE_MODE=expiry,low_tip,compute_exceeded`
  with `VOLUME_COUNT=10` distributes failures across submissions 2, 5, and 8.
