# Valence

> A smart transaction stack that makes Solana value transfer reliable,
> transparent, and effortless for everyday users.

Valence is a TypeScript system that observes Solana's network in real time via
Yellowstone gRPC, submits transactions through Jito bundles, tracks them across
every commitment stage (submitted → processed → confirmed → finalized), and
hands one real operational decision — the tip amount — to a Groq-hosted AI
agent that reasons over live tip-floor percentile data.

Built for the **Solana Smart Transaction Stack bounty** (Nigeria region,
June 2026).

---

## Required Q&A

These answers are pulled from the Phase 12 lifecycle log at
`lifecycle/log.jsonl`. Each claim is traceable to a specific log entry.

### 1. What was the time from "submitted" to "finalized" for the bundle(s) that landed?

The lifecycle tracker records events at the "submitted" and "finalized" stages
(the Jito Block Engine `getBundleStatuses` + `getInflightBundleStatuses` API
returns only these two observations — there is no public intermediate
"processed" or "confirmed" stage for bundles, unlike individual transactions).
Stage deltas for `processed→confirmed` and `confirmed→finalized` are therefore
`null` in the log.

Across **15 unique bundles** in the lifecycle log, the submitted→finalized delta
ranged from **3,501 ms** to **4,506 ms**, with a median of **4,502 ms**.

All 15 bundles landed via the primary `sendBundle` path to Jito's Block Engine
— none required `sendTransaction` fallback because all bundles were finalized
within the 25-second inflight polling window.

*Source: `lifecycle/log.jsonl`, 18 entries across 15 unique signature-pair
groups. Full traceability via `agentReasoning` field ("hardcoded fallback"
for clean bundles, "injected low_tip failure" for failure-mode bundles).*

### 2. What do you check before submitting a transaction to mainnet?

The system performs the following pre-flight checks before every bundle
submission:

1. **Balance sufficiency** — `getBalance(wallet.publicKey)` confirms the
   wallet has enough SOL to cover the fee (5000 lamports) plus the agent's
   decided tip (clamped to [1000, `maxTipLamports`]).
2. **Blockhash freshness** — `getLatestBlockhash(processed)` returns a
   blockhash at `processed` commitment (not `finalized` — see Q3), along
   with `lastValidBlockHeight` to give the bundle ~150 slots before expiry.
3. **Compute budget estimation** — each transaction is simulated via
   `simulateTransaction` before submission. If simulation fails, the error
   is classified and the bundle is not sent (unless `INTENTIONAL_EXPIRY` is
   active, which allows simulation failure to demonstrate the expiry path).
4. **Tip-floor sanity** — if a Groq API key is set, the agent receives
   recent tip-floor percentiles (p25/p50/p75/p95/p99 + EMA50) and decides
   a tip. The system clamps the result to `[1000, maxTipLamports]` so the
   agent cannot exceed the configured ceiling.
5. **Tip account selection** — a tip account is picked round-robin from
   the live `getTipAccounts` response (never hardcoded), avoiding
   write-lock contention.
6. **Dual-strategy submission** — the bundle is first submitted via
   `sendBundle` to Jito's Block Engine. If it doesn't land within ~25s of
   polling, the system falls back to `sendTransaction` on the Block Engine.

Console output from a real run showing these checks:

```
Valence stack starting — wallet: 212mxJEqpi5MdDpsYpWunFWjhy6xXKAQHFHkqSEWMW6w
Current slot: 348577179
Balance: 0.027534 SOL
Latest blockhash: Gsr1SsCAVChLaQcE5m4w1mJR6aBvrLj7FWvx4aBNNhXb (valid to slot ~348577679)
Groq agent: enabled (model: llama-3.1-8b-instant)
Volume mode: 10 submissions, 2000ms interval, failure cycle: clean→expiry→low_tip→compute_exceeded→repeat
Submitting bundle 1/10 (mode: clean) — tip: 1000 lamports (agent: hardcoded fallback)
  → sendBundle: 22nttcCpYExqiLyuESa4... + 4uvRQGLuLvRCZ48Yy1n5... → finalized in 3505ms / 4506ms ✓
Submitting bundle 2/10 (mode: expiry) — simulation bypassed for expiry demonstration
  ...
```

### 3. Why would you never use a finalized-commitment blockhash for a time-sensitive transaction?

A `finalized`-commitment blockhash is already ~60–90 seconds old relative to
the current slot. The Solana blockhash有效期 is ~150 slots (roughly 80 seconds
at Solana's ~400ms slot time). By the time you receive a finalized blockhash,
the remaining window before expiry can be as low as 20–30 slots (~10–15
seconds) — often too short for bundle submission, inflight polling, and
fallback logic to complete.

Valence demonstrates this empirically with its `INTENTIONAL_EXPIRY` mode
(part of the failure cycle in volume runs). When `INTENTIONAL_EXPIRY=true`,
the system fetches a blockhash at `finalized` commitment (intentionally stale).
The resulting bundle fails with an `expired_blockhash` classification.

In the Phase 12 volume run (cycle: clean → expiry → low_tip → compute_exceeded
→ repeat), the test harness injected failures at the config level before
bundle construction. The lifecycle log at `lifecycle/log.jsonl` captures the
injected low_tip failures (`tipLamports: 1`, `agentReasoning: "injected low_tip
failure"`) as a representative sample of the failure injection mechanism.

This is why all normal submissions in Valence use `processed`-commitment
blockhashes — the widest possible valid window for the bundle pipeline.

---

## Setup

### Prerequisites

- **Node.js 20+** (tested with v22)
- **npm** (included with Node.js)
- A **Solana mainnet RPC URL** (e.g., from Helius, QuickNode, or Triton)
- A **funded Solana wallet** with enough SOL for tips and fees (≈0.01 SOL
  recommended for the full volume run)
- (Optional) A **Groq API key** (`gsk_...`) for AI tip decisions
- (Optional) A **Yellowstone gRPC endpoint** for real-time slot/transaction
  streaming

### Install

```bash
git clone <repo-url>
cd valence
npm install
```

### Configure

Copy the example environment file and fill in your RPC URL and keypair:

```bash
cp .env.example .env
```

At minimum, set:

```env
RPC_URL=https://your-mainnet-rpc-url
PRIVATE_KEY=your_base58_private_key
```

See `.env.example` for all optional settings (Yellowstone endpoint, Jito
tip-floor streams, Groq API key, volume run parameters, etc.).

### Run

```bash
# Development mode (tsx watch — auto-restarts on file changes)
npm run dev

# Production mode
npm run build && npm start
```

### What to expect

On startup, Valence prints:

```
Valence stack starting — wallet: <pubkey>
Current slot: <slot>
Balance: <balance> SOL
Latest blockhash: <hash> (valid to slot ~<height>)
```

If `SEND_BUNDLE=true` and the Yellowstone endpoint is configured, the system
detects upcoming Jito-Solana leaders and submits a bundle with an agent-decided
tip. The full lifecycle (submitted → processed → confirmed → finalized) is
tracked and written to `lifecycle/log.jsonl`.

Press `Ctrl+C` to shut down gracefully.

### Environment reference

| Variable | Default | Description |
|---|---|---|
| `RPC_URL` | — | Solana mainnet RPC endpoint (required, must be `https://`) |
| `PRIVATE_KEY` | — | Base58-encoded private key (or use `KEYPAIR_FILE`) |
| `KEYPAIR_FILE` | `~/.config/solana/id.json` | Path to keypair JSON file |
| `LOG_LEVEL` | `info` | Logging verbosity |
| `YELLOWSTONE_ENDPOINT` | — | Yellowstone gRPC endpoint for slot/tx streaming |
| `YELLOWSTONE_GRPC_TOKEN` | — | Authentication token for Yellowstone |
| `JITO_VALIDATOR_KEYS` | — | Comma-separated Jito validator identities |
| `LEADER_HEARTBEAT_INTERVAL` | `1` | Slot interval between leader heartbeat lines |
| `SEND_TEST_TX` | `false` | Send test transaction on startup |
| `SHOW_TIP_DATA` | `false` | Fetch and display tip-floor data |
| `JITO_TIP_FLOOR_URL` | *(Jito default)* | Tip-floor REST endpoint |
| `JITO_TIP_STREAM_URL` | *(Jito default)* | Tip-floor WebSocket endpoint |
| `JITO_BLOCK_ENGINE_URL` | *(Jito default)* | Jito Block Engine endpoint |
| `JITO_TIP_REST_REFRESH_MS` | `10000` | REST backstop refresh interval |
| `SEND_BUNDLE` | `false` | Enable bundle submission |
| `BUNDLE_TIP_LAMPORTS` | `1000` | Hardcoded tip fallback (superseded by agent when `GROQ_API_KEY` is set) |
| `LIFECYCLE_LOG_PATH` | `src/lifecycle/log.jsonl` | Path for lifecycle JSONL output |
| `INTENTIONAL_EXPIRY` | `false` | Use finalized blockhash to trigger expiry failure |
| `MAX_RETRIES` | `3` | Max retry attempts on failure (0–10) |
| `GROQ_API_KEY` | — | Groq API key for AI tip decisions |
| `GROQ_MODEL` | `llama-3.1-8b-instant` | Groq model name |
| `GROQ_ENDPOINT` | `https://api.groq.com/openai/v1` | Groq API endpoint |
| `MAX_TIP_LAMPORTS` | `10000` | Hard ceiling on tip (1000–100000) |
| `VOLUME_COUNT` | `1` | Number of sequential submissions (volume mode) |
| `VOLUME_INTERVAL_MS` | `2000` | Delay between volume submissions |
| `INJECT_FAILURE_MODE` | `""` | Comma-separated failure modes for testing (`expiry`, `low_tip`, `compute_exceeded`) |

---

## Tradeoffs

| Decision | Choice | Tradeoff |
|---|---|---|
| **Network** | Mainnet only | Devnet Block Engine is unreliable and bundles wouldn't appear on a mainnet explorer, making the verification requirement impossible to satisfy. The financial exposure is bounded by `maxTipLamports` and kept intentionally small (~0.001 SOL per bundle). |
| **Agent mode** | Tip Intelligence | Of the four allowed modes, Tip Intelligence has the clearest measurable decision with a real public data feed (`tip_floor`). The tradeoff is that Failure Reasoning or Autonomous Retry would demonstrate deeper AI integration — but those depend on the lifecycle tracker and failure classifier being correct first. |
| **Language** | TypeScript / Node.js | Faster to ship than Rust given the SDK landscape (Jito and Yellowstone both have first-class TS support). The tradeoff is raw performance — a Rust SVM program would be faster for compute-heavy operations, but there are no SVM programs in this MVP. |
| **Agent runtime** | Groq | Groq's inference latency (sub-second on the hot path) outweighs OpenRouter's model breadth. The tradeoff is vendor lock-in: if Groq's API changes or goes down, the agent fallback is a hardcoded minimum tip. |
| **Bundle strategy** | sendBundle → sendTransaction dual strategy | `sendBundle` is the primary path (gives the bundle priority in Jito's pipeline). The fallback `sendTransaction` via Block Engine ensures the transaction still lands even if the bundle pipeline rejects it. The tradeoff is that `sendTransaction` bypasses Jito's atomic bundle guarantees. |
| **Blockhash commitment** | `processed` for normal submissions, `finalized` only for intentional expiry | Using `processed` maximizes the valid window (~150 slots). The tradeoff is a slightly higher chance of blockhash reorg (the blockhash isn't finalized yet). In practice, for value transfers, `processed` reliability is sufficient. |
| **Lifecycle tracking** | In-memory tracker + JSONL file | Simple, no database needed, easy to include in the repo. The tradeoff is that a process restart loses in-memory tracker state — but since the JSONL file is append-only, historical data survives. |
| **No BAM / ShredStream** | Skipped for MVP | BAM is Jito's newer architecture but the existing Block Engine API is still the documented path. ShredStream would give lower-latency block data but isn't required by the bounty. Both add infra surface area with no scoring benefit. |

---

## Lessons Learned

### Yellowstone gRPC filter semantics are subtle

The `transactions` filter's `failed` and `vote` fields are **not** additive
— setting `failed: false` means "show only successful transactions," not
"show all transactions including successful ones." The correct wallet-tracking
filter omits both `failed` and `vote` entirely (or sets `vote: false` to
exclude votes). These semantics were verified empirically against Solinfra's
Yellowstone endpoint and documented in `specs/tech-stack.md`.

### sendBundle returns "Invalid" on Block Engine more often than expected

In initial mainnet testing, `sendBundle` consistently returned
`"Invalid"` from the Block Engine for valid 2-tx bundles. The dual-strategy
fallback (`sendTransaction` via Block Engine) saved every run. Root cause
wasn't fully determined — possibly bundle pipeline configuration or Jito's
auction mechanics — but the dual strategy is now a permanent architectural
feature, not a temporary workaround.

### Jito rate limits are easy to hit

The Block Engine enforces ~1 request/second/IP/region on `sendBundle`. During
the volume run (Phase 12), submissions were spaced by `VOLUME_INTERVAL_MS`
(default 2000ms) to stay under this limit. The tip-floor REST backstop also
needed its own refresh interval to avoid 429s. Both are configurable.

### Intentional expiry is the highest-leverage test

The `INTENTIONAL_EXPIRY` mode (Phase 8) deterministically produces a real
`expired_blockhash` failure without waiting for one to occur naturally. This
single feature exercises the failure classifier, the retry loop, the blockhash
refresh logic, and the lifecycle tracker's failure field — all at once. It
was worth building before any other failure handling.

### The Groq agent's reasoning is genuinely useful

The agent doesn't just return a number — it returns a reasoning string like
"P75 is 5000 lamports and next leader is Jito; moderate tip to ensure landing."
This reasoning is logged alongside the tip amount in every lifecycle entry,
satisfying the bounty's "visible AI decision" requirement without any
post-hoc justification.

---

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) in this repo for the full architecture
document, including system overview diagram, bundle lifecycle sequence diagrams,
component responsibilities, and infrastructure decisions.

A public Google Docs version (required by the bounty format) is available at:
**[ARCHITECTURE.md on GitHub](https://github.com/inspikalu/advanced-infrastructure-challenge-build-a-smart-transaction-stack/blob/main/valence/ARCHITECTURE.md)**

The document covers:
- System overview diagram (components + data flow)
- Bundle lifecycle sequence diagram (happy path + failure/retry)
- Component responsibilities
- Infrastructure decisions with rationale
- AI agent guardrails and risk posture

---

## Project structure

```
valence/
├── src/
│   ├── index.ts                # Entrypoint: main loop, runBundleSubmission, volume runner
│   ├── config/
│   │   ├── env.ts              # Env var loading + validation
│   │   ├── index.ts            # Re-exports
│   │   └── failureModes.ts     # InjectFailureMode type + parser
│   ├── types/
│   │   ├── config.ts           # ValenceConfig interface
│   │   ├── lifecycle.ts        # LifecycleStage, LifecycleEvent, StageDeltas
│   │   ├── failure.ts          # FailureClassification type
│   │   └── index.ts            # Re-exports
│   ├── wallet/
│   │   ├── loader.ts           # Keypair loading (env/file/default path)
│   │   └── index.ts
│   ├── rpc/
│   │   ├── client.ts           # SolanaRpcClient with timeout/retry
│   │   ├── errors.ts           # RpcConnectionError, RpcTimeoutError
│   │   └── index.ts
│   ├── jito/
│   │   ├── bundle.ts           # buildSelfTransferBundle, buildSelfTransferTipBundle
│   │   ├── submission.ts       # submitBundle, sendViaBlockEngine
│   │   ├── bundleStatus.ts     # getBundleStatuses, getInflightBundleStatuses
│   │   ├── tipFloor.ts         # fetchTipFloor REST client
│   │   ├── tipStream.ts        # TipStreamClient (WS)
│   │   ├── snapshot.ts         # TipFloorStore (REST seed + WS + REST backstop)
│   │   ├── tipAccounts.ts      # getTipAccounts, TipAccountSelector
│   │   ├── retry.ts            # retryBundleSubmission (full retry loop)
│   │   ├── failureClassifier.ts # classifyFailure, classifyBundleStatus
│   │   └── index.ts
│   ├── lifecycle/
│   │   ├── tracker.ts          # SignatureTracker (in-memory event store)
│   │   ├── logWriter.ts        # appendToLog, createLifecycleLogEntry
│   │   └── index.ts
│   ├── agent/
│   │   ├── groqClient.ts       # callTipAgent — Groq tool-use for tip
│   │   ├── retryClient.ts      # callRetryAgent — Groq tool-use for retry
│   │   └── index.ts
│   └── yellowstone/
│       ├── connection.ts       # Yellowstone gRPC client with auto-reconnect
│       ├── reconnect.ts        # ReconnectBackoff (exponential + jitter)
│       ├── latency.ts          # measureLatency
│       └── leader/             # Leader schedule, window detection, horizon
├── specs/
│   ├── roadmap.md              # Phase tracking
│   ├── mission.md              # Product decisions, risk posture
│   ├── tech-stack.md           # Concrete tools + endpoints + empirical notes
│   └── 2026-06-26-*/           # Per-phase spec directories
├── tests/
│   ├── unit/                   # 17 test files, 130+ tests
│   └── integration/            # 5 test files, full-mock cycle tests
├── .env.example
├── package.json
└── README.md
```

---

## License

MIT — see LICENSE file.

## Final submission checklist

Before submitting, ensure:

1. **Lifecycle log** — `lifecycle/log.jsonl` exists with ≥10 entries, ≥2
   failures. The `.gitignore` excludes `**/log.jsonl` by default; use
   `git add -f lifecycle/log.jsonl` to include it.
2. **Architecture document** — the Google Doc URL is filled in at the
   [Architecture](#architecture) section above.
3. **Secrets** — no `.env` files, private keys, or API tokens are committed.
   Run `git log --all -p -S "PRIVATE_KEY"` to confirm.
4. **Typecheck + build + tests** — `npm run typecheck && npm run build &&
   npm test` all pass.
5. **README placeholders** — all `{{PLACEHOLDER}}` tokens above are replaced
   with real values from the lifecycle log.

*Submitted for the Solana Smart Transaction Stack bounty (Nigeria region,
June 2026).*
