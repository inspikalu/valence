# Valence

> A smart transaction stack combining Surge's proof-first infrastructure rigor
> with SolGuard's developer-first SDK — real-time Solana transaction submission,
> lifecycle tracking, AI-driven retry, and verifiable evidence.

Valence is the merged best-of-both-worlds from two Advanced Infrastructure
Challenge entries:
- **[Surge AI](https://github.com/danielAsaboro/surge-ai)** — Rust proof-first
  infrastructure with self-validating evidence, guardrailed AI, operator memory
- **[SolGuard](https://github.com/unnamed-lab/solguard)** — TypeScript
  developer SDK with clean `submit()` API, 6 test harnesses, congestion oracle

Built for the **Solana Smart Transaction Stack bounty** (Nigeria region,
June 2026).

---

## Architecture

```
                     ┌──────────────────────┐
  Developer App      │  Valence SDK          │
  (trading bot,      │  new Valence();       │
   aggregator, etc.) │  await v.submit(tx)   │
                     └──────────┬───────────┘
                                │ submit(instructions | tx | base64)
                                ▼
┌──────────────────────────────────────────────────────────────┐
│                    Valence Engine                            │
│                                                              │
│  ┌─────────────────┐    ┌──────────────┐    ┌────────────┐  │
│  │ Yellowstone     │    │ Congestion   │    │ Leader     │  │
│  │ Stream Manager  │───▶│ Oracle       │───▶│ Window     │  │
│  │ (reconnect,     │    │ (64-slot,    │    │ Detector   │  │
│  │  replay, dedup) │    │  skip rate)  │    │            │  │
│  └─────────────────┘    └──────┬───────┘    └──────┬─────┘  │
│                                │                    │        │
│                                ▼                    │        │
│  ┌──────────────────────────────────┐               │        │
│  │  Tip Model                       │◄──────────────┘        │
│  │  tip = livedata × congestion_mul │                        │
│  └──────────────┬───────────────────┘                        │
│                 │                                            │
│                 ▼                                            │
│  ┌──────────────────────────────────────────┐                │
│  │  AI Agent (Groq/Claude)                  │                │
│  │  • Guardrail with re-prompting           │                │
│  │  • Operator memory (Postgres)            │                │
│  │  • Decision ledger (append-only)         │                │
│  └──────────────┬───────────────────────────┘                │
│                 │ retry / hold / abort                        │
│                 ▼                                            │
│  ┌──────────────────────────────────────────┐                │
│  │  Bundle Builder + Submitter              │                │
│  │  • Jito sendBundle → sendTransaction     │                │
│  │  • Lifecycle: submitted→processed→       │                │
│  │    confirmed→finalized                   │                │
│  │  • Failure classifier (5 types)          │                │
│  └──────────────┬───────────────────────────┘                │
│                 │                                             │
│                 ▼                                             │
│  ┌──────────────────────────────────────────┐                │
│  │  Evidence Pipeline                       │                │
│  │  • JSONL with hash-chain                 │                │
│  │  • evidence-validate / -report / -package│                │
│  │  • Readiness gates                       │                │
│  └──────────────────────────────────────────┘                │
│                                                              │
│  ┌──────────────────────────────────────────┐                │
│  │  HTTP API Server (PORT 3000)             │                │
│  │  POST /submit · GET /health · GET /readyz│                │
│  └──────────────────────────────────────────┘                │
└──────────────────────────────────────────────────────────────┘
```

---

## What Valence Does

| Capability | How | Source |
|---|---|---|
| Developer SDK | `new Valence()` class with `submit(tx)` accepting instructions, unsigned tx, pre-signed tx, base64 | SolGuard |
| Evidence pipeline | Self-validating JSONL with hash chains, SHA-256 manifests, readiness gates | Surge |
| Yellowstone streaming | gRPC slot/tx stream with reconnect, fromSlot replay, dedup, backpressure | Valence |
| Congestion oracle | 64-slot rolling window → skip rate + P→C delta → dynamic multiplier | SolGuard |
| Leader window detection | Jito-Solana leader detection, only submits in valid windows | Valence |
| Dynamic tipping | Live tip-floor percentiles × congestion multiplier, zero hardcoded values | SolGuard |
| Lifecycle tracking | 4-stage (submitted→processed→confirmed→finalized) with deltas | Valence |
| AI agent | Groq/Claude retry decisions with strict-JSON contract, guardrail, re-prompting | Surge + SolGuard |
| Decision ledger | Append-only `logs/decisions.jsonl` with full input→reasoning→outcome | SolGuard |
| Operator memory | Postgres-backed lessons that feed into agent context | Surge |
| Guardrail layer | Validates agent output, re-prompts on unsafe decisions, never substitutes | Surge |
| Failure classifier | 5 types: expired_blockhash, fee_too_low, compute_exceeded, bundle_failure, unknown | Valence |
| HTTP API | `POST /submit`, `GET /health`, `GET /readyz` for easy integration | SolGuard |
| Test harnesses | agent, trading, requote, sniper, budget, sandwich | SolGuard |
| CLI commands | `submit`, `evidence-validate`, `evidence-report`, `evidence-package`, `daemon`, `server` | Surge |
| Prometheus/Grafana | Metrics, alert rules, production dashboard | Surge |

---

## Developer SDK

```typescript
import { Valence } from "./src/sdk/valence.js"

const guard = new Valence()

// Submit instructions (auto-signs)
const result = await guard.submit([myTransferInstruction])

// Submit pre-signed transaction
const result = await guard.submit(base64Tx)

// Submit with options
const result = await guard.submit(tx, {
  urgency: "high",
  tipCeilingLamports: 50000,
  maxRetries: 3,
})

console.log(result.landed ? `Landed: ${result.signature}` : `Failed: ${result.error}`)
```

### `submit()` input matrix

| Input type | Blockhash refresh on retry? | Notes |
|---|---|---|
| `TransactionInstruction[]` | ✅ Yes | Valence compiles, signs with wallet |
| `VersionedTransaction` (unsigned) | ✅ Yes | Valence re-signs |
| Pre-signed transaction | ❌ No | Sent as-is |
| Base64 / Base58 string | Depends | Deserialized then routed above |

---

## Evidence Pipeline

Valence records every submission as verifiable, self-validating evidence.

```bash
# Validate evidence JSONL
tsx src/cli.ts evidence-validate evidence/final/lifecycle.jsonl

# Generate report
tsx src/cli.ts evidence-report evidence/final/lifecycle.jsonl \
  --manifest-out evidence/final/manifest.json \
  --markdown-out evidence/final/audit.md

# Package with checksums
tsx src/cli.ts evidence-package evidence/final/lifecycle.jsonl \
  --out target/valence-evidence-package

# Check readiness
tsx src/cli.ts evidence-readiness evidence/final/lifecycle.jsonl
```

Each evidence row includes:
- Hash-chain integrity (each row references previous hash)
- Bundle ID != signature (anti-fabrication check)
- `confirmedVia: "stream"` (stream-primary, not RPC polling alone)
- Agent decision snapshots with prompt/observation hashes
- Stage deltas and failure classification

---

## AI Agent Contract

The agent receives a structured context and returns a strict-JSON decision:

```jsonc
{
  "diagnosis": "Blockhash expired after 47 slots — leader was skipped.",
  "rootCause": "blockhash_expired",
  "action": "retry",
  "params": {
    "refreshBlockhash": true,
    "newTipLamports": 11000,
    "tipPercentileTarget": 75,
    "submitAtSlot": 312911,
    "maxBlockhashAgeSlots": 60
  },
  "confidence": 0.82,
  "expectedOutcome": "land within next Jito leader window"
}
```

The guardrail layer validates before execution:
- `newTipLamports >= tipFloor.p25` and `<= TIP_CEILING`
- `maxBlockhashAgeSlots <= 150`
- `submitAtSlot` is a future slot
- Re-prompts the model on invalid output (3 attempts before heuristic fallback)

---

## Project Structure

```
src/
  sdk/valence.ts       Valence class — clean submit() API for developers
  sdk/types.ts         SDK input/output types
  agent/               AI agent with guardrail, contract, decision ledger
  evidence/            Evidence validator, reporter, packager
  network/             Congestion oracle (64-slot skip rate + P→C delta)
  cli.ts               CLI: submit, evidence-*, daemon, server, preflight
  server.ts            HTTP API server (POST /submit, GET /health)
  index.ts             Original entrypoint (main loop, volume runner)
  config/              Env var loading + validation
  types/               Shared types (lifecycle, failure, config)
  wallet/              Keypair loading
  rpc/                 Solana RPC client with timeout/retry
  jito/                Jito bundle builder, submitter, tip floor, status polling
  lifecycle/           Signature tracker, JSONL log writer
  yellowstone/         Yellowstone gRPC streaming, leader detection
  harness/             Test harnesses: agent, trading, requote, sniper, budget, sandwich
tests/                 Unit tests (130+) + integration tests
logs/                  Lifecycle + decision JSONL (generated)
evidence/              Verified evidence artifacts
```

---

## Quick Start

```bash
pnpm install
cp .env.example .env      # fill in credentials
pnpm typecheck            # verify the build

# SDK usage
pnpm sdk

# HTTP API server
pnpm server
curl http://localhost:3000/health

# CLI
pnpm cli submit "test memo"
pnpm cli preflight --strict

# Evidence
pnpm cli evidence-validate logs/lifecycle.jsonl
pnpm cli evidence-report logs/lifecycle.jsonl

# Tests
pnpm test:run
```

---

## Required Q&A

### 1. What does `processed→confirmed` delta tell you about network health?

The delta measures how long the cluster takes to reach supermajority vote. A
small delta (< 500ms) indicates healthy, fast voting. A large/widening delta
indicates congestion or validator degradation. Valence's congestion oracle
tracks this in a 64-slot rolling window and adjusts the tip multiplier when
p50 exceeds 700ms.

### 2. Why never use `finalized` blockhash for time-sensitive transactions?

A `finalized` blockhash burns ~1/5 of the ~150-slot validity window before
submission. Valence fetches at `confirmed` (default) — maximizing usable
validity while avoiding `processed` reorg risk.

### 3. What happens if the Jito leader skips their slot?

The bundle is not included in that slot. Valence detects the skip via the slot
stream, classifies it as `bundle_failure`, and the AI agent decides whether to
resubmit targeting the next Jito leader window.

---

## Merged From

| Feature | Source |
|---|---|
| Evidence pipeline (validate, report, package, readiness) | Surge |
| Self-validating JSONL with hash chains | Surge |
| Guardrailed AI with re-prompting | Surge |
| Operator memory in Postgres | Surge |
| Prometheus/Grafana dashboards | Surge |
| Developer SDK with `submit()` API | SolGuard |
| 6 test harnesses (agent, trading, requote, sniper, budget, sandwich) | SolGuard |
| Congestion oracle (64-slot, skip rate, multiplier) | SolGuard |
| Decision ledger (append-only) | SolGuard |
| Strict-JSON agent contract | SolGuard |
| HTTP API server | SolGuard |
| Yellowstone streaming + leader detection | Valence |
| Jito bundle + fallback dual strategy | Valence |
| Lifecycle tracker + JSONL persistence | Valence |
| Failure classifier (5 types) | Valence |

---

## License

MIT
