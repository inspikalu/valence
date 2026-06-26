# Valence - Smart Transaction Stack Architecture

> Architecture document for the Valence smart transaction stack on Solana.

---

## 1. System Overview

![System Overview](System-Overview.png)

---

## 2. Bundle Lifecycle Sequence

![Bundle Lifecycle Sequence](Bundle-Lifecycle-Sequence.png)

---

## 3. Component Responsibilities

### YellowstoneConnection (`src/yellowstone/connection.ts`)
- Connects to a Yellowstone gRPC endpoint (e.g., Solinfra, Helius)
- Subscribes to `slots` and `transactions` (filtered to wallet pubkey)
- Auto-reconnects with exponential backoff + jitter on stream drop
- Emits events: `slotLog`, `txUpdate`, `txStatusUpdate`, `latencySample`
- Uses `fromSlot` replay to backfill gaps during reconnection

### LeaderWindowDetector (`src/yellowstone/leader/detector.ts`)
- Receives live slot updates from Yellowstone
- Cross-references against the leader schedule from `getLeaderSchedule` RPC
- Detects: upcoming Jito leader, leader window entered, leader window passed
- Adapts detection horizon dynamically based on observed latency
- Emits: `leaderDetected`, `leaderEntered`, `leaderPassed`, `heartbeat`

### TipFloorStore (`src/jito/snapshot.ts`)
- Seeds initial percentile data from REST endpoint on startup
- Subscribes to live WebSocket `tip_stream` for updates
- REST backstop polling when WS disconnects
- Provides `get()` snapshot for the Groq agent

### Bundle Builder (`src/jito/bundle.ts`)
- `buildSelfTransferBundle`: creates 2 signed transactions (self-transfer + tip)
- `buildSelfTransferTipBundle`: creates 1 combined transaction (for fallback)
- Both accept optional `computeUnitLimit` for compute-exceeded testing
- Outputs base64-encoded bundle, signatures, and Transaction objects

### Submission Pipeline (`src/jito/submission.ts` + `src/index.ts`)
- Primary: `submitBundle` → `getInflightBundleStatuses` (up to 25s)
- Fallback: `sendViaBlockEngine` (sendTransaction) + on-chain polling (60s)
- Rate-limit aware: retries 429 responses up to 5 times with backoff
- Simulation before every submission

### SignatureTracker (`src/lifecycle/tracker.ts`)
- In-memory Map of watched signatures with commitment progression
- `recordSubmitted`: stores bundle metadata (signatures, tip, slot, reasoning)
- `observe`: updates commitment level (never downgrades)
- `getBundleEvents`: reconstructs full lifecycle from submitted to observed
- Bundles map keys: bundleId → signatures → each sig's tracked events

### Lifecycle Log Writer (`src/lifecycle/logWriter.ts`)
- `createLifecycleLogEntry`: builds structured entry with computed stage deltas
- `appendToLog`: appends JSON line to the JSONL file
- Used both for original submissions and retry entries (separate lines)

### Failure Classifier (`src/jito/failureClassifier.ts`)
- `classifyFailure`: maps error strings to 5 classification types
- `classifyBundleStatus`: maps bundle status payloads
- `classifyTransactionError`: maps transaction-level errors
- Sources: simulation errors, bundle status payloads, sendTransaction errors,
  fallback tx not observed on-chain

### Retry Loop (`src/jito/retry.ts`)
- Triggered post-failure when `maxRetries > 0`
- Calls Groq retry agent for decision (shouldRetry + new tip + reasoning)
- Falls back to hardcoded retry with original tip if no Groq key
- Fresh blockhash, tip account, and bundle per attempt
- Returns `{ success, finalBundleId }`

### Groq Agent (`src/agent/groqClient.ts`, `src/agent/retryClient.ts`)
- `callTipAgent`: receives tip-floor percentiles, slot, leader context,
  bundle size, tip account; returns `{ tipLamports, reasoning }`
- `callRetryAgent`: receives failure type, original tip, failure context;
  returns `{ shouldRetry, tipLamports, reasoning }`
- Both use OpenAI-compatible tool-use API for structured JSON output
- Tip clamped server-side to [1000, maxTipLamports] - agent does not have
  unbounded control over spend

### Volume Runner (`src/index.ts`)
- Sequential loop when `volumeCount > 1`
- Cycles failure modes: clean → expiry → low_tip → compute_exceeded → repeat
- Sleeps `volumeIntervalMs` between submissions
- Shared SignatureTracker across all submissions
- Prints summary: `X succeeded, Y failed (out of Z)`

---

## 4. Infrastructure Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Network | Mainnet only | Devnet Block Engine unreliable; explorer verification requires mainnet. |
| Agent mode | Tip Intelligence | Clearest measurable decision with real data feed. |
| Language | TypeScript / Node.js | SDK maturity (Jito, Yellowstone both have first-class TS). |
| Agent runtime | Groq | Sub-second latency on the hot path between bundle assembly and submission. |
| Lifecycle log | JSONL file | Simple, append-only, no database, easy to include in repo. |
| Blockhash commitment | `processed` (normal), `finalized` (intentional expiry) | Maximizes valid window; expiry mode demonstrates the tradeoff. |
| Bundle strategy | sendBundle → sendTransaction | Dual strategy mitigates Block Engine "Invalid" responses. |

---

## 5. AI Agent Guardrails and Risk Posture

- **Tip clamping**: The agent's tip decision is clamped server-side to
  `[1000 lamports, maxTipLamports]`. The agent cannot drain the wallet.
- **Retry bounds**: The retry loop is bounded by `maxRetries` (0–10, default 3).
  The agent can decide not to retry, but the loop cannot exceed this ceiling.
- **Keypair safety**: The private key is loaded from env or file, never
  hardcoded, never exposed to the agent. The agent receives only tip-floor
  data and slot/leader context.
- **Failure injection**: `INTENTIONAL_EXPIRY` and `INJECT_FAILURE_MODE` are
  env-gated. The agent cannot trigger failure modes.
- **Financial exposure**: With `maxTipLamports` at 10,000 lamports and
  `volumeCount` at the configured value, worst-case spend is bounded by
  `volumeCount × (5000 fee + maxTipLamports)`. A full 10-bundle run costs
  at most ~0.0015 SOL.

---

## 6. Data Flow Summary

![Data Flow Summary](Data-Flow-Summary.png)

---

*Last updated: June 26, 2026.*
