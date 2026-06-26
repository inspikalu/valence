# Tech Stack

This document lists concrete tools, libraries, and endpoints, with the
reasoning for each. Versions/endpoints were checked against current sources
as of June 2026 — re-verify anything load-bearing before relying on it deep
into the build, since Jito and Yellowstone ecosystems move fast (e.g. BAM
shipped to mainnet in Sept 2025 and is still expanding).

## Runtime

- **Node.js (LTS) + TypeScript** — chosen for SDK maturity on both sides of
  this stack (Jito and Yellowstone both have first-class TS support), and
  because the bounty rewards shipping a complete, correct system over
  language purity.
- Package manager: npm (no strong reason to deviate).

## Solana / transaction layer

- **`@solana/web3.js`** (or `@solana/kit` if time allows — Quicknode's 2026
  guides have migrated examples to Kit) for keypair management, transaction
  construction, blockhash fetching, and base RPC calls.
- **Commitment levels used explicitly and deliberately**, not left at
  defaults:
  - `processed` — fastest, used for early lifecycle visibility only, never
    trusted for irreversible decisions.
  - `confirmed` — used for "did this probably land" checks during normal
    operation.
  - `finalized` — used only for the final lifecycle log entry and, per the
    bounty's own README question, **never** used when fetching a blockhash
    for a time-sensitive transaction (a finalized-commitment blockhash is
    already old relative to the current slot, increasing the chance it
    expires before the bundle lands — `confirmed` or `processed` blockhashes
    are the correct choice for low-latency submission).

## Jito (bundles, tips)

- **Block Engine** (mainnet): `https://mainnet.block-engine.jito.wtf`
  (regional endpoints available — Amsterdam, Frankfurt, NY, Tokyo, etc. —
  pick nearest or lowest-observed-latency region during build).
- **SDK**: `jito-ts` (TypeScript SDK, listed as a bounty resource) for
  `SearcherClient` — bundle construction, `sendBundle`, `getTipAccounts`,
  `getBundleStatuses`, `getInflightBundleStatuses`, `getNextScheduledLeader`.
  If `jito-ts` proves awkward, fall back to raw JSON-RPC calls per
  `docs.jito.wtf/lowlatencytxnsend` — the wire format is simple enough that
  a thin hand-rolled client is a reasonable fallback.
- **Tip data source**: `GET https://bundles.jito.wtf/api/v1/bundles/tip_floor`
  — returns rolling percentile tip data (25th/50th/75th/95th/99th + EMA).
  This is the real, live, no-hardcoded-values data source the bounty
  requires for tip calculation. A WebSocket stream
  (`wss://bundles.jito.wtf/api/v1/bundles/tip_stream`) exists too if a live
  feed is preferred over polling.
- **Tip accounts**: fetched via `getTipAccounts` (8 static accounts) —
  never hardcoded, and one is picked per bundle (random or round-robin) per
  Jito's own guidance, to avoid write-lock contention on a single account.
- **Tip placement**: tip instruction goes in the **last** transaction of the
  bundle per Jito's documented convention for `sendBundle` (note: this
  differs from `sendTransaction`'s 70/30 priority-fee/tip split — bundles
  only care about the Jito tip).
- **Minimum tip**: 1000 lamports is Jito's protocol floor — the agent's
  decided tip is clamped to never go below this and never exceed the
  mission-level per-bundle ceiling.
- **Known constraint**: 1 request/sec/IP/region default rate limit on
  Block Engine — the stack's retry/backoff logic must respect this or risk
  429s during a burst of submissions.

## Yellowstone gRPC (Geyser streaming)

- **Provider**: mainnet endpoint from Solinfra (bounty's infra sponsor) if
  credentials are obtained in time; otherwise any Yellowstone-compatible
  provider (Helius, Triton/Chainstack, QuickNode) as fallback — the protocol
  is standardized so switching providers is a config change, not a rewrite.
- **SDK**: `@triton-one/yellowstone-grpc` (the reference TypeScript client,
  also what Solinfra and most providers document against).
- **Subscriptions needed**:
  - `slots` — for live slot progression and leader-window detection.
  - `transactions` (filtered to the wallet's own signatures/accounts) — to
    observe the submitted bundle's transactions landing in real time,
    rather than relying on RPC polling (the bounty explicitly disallows
    polling-only confirmation: "RPC polling alone is not sufficient").
  - `blocksMeta` — lightweight, useful for slot/leader cross-referencing
    without pulling full block bodies.
- **Transaction filter semantics** (empirically verified against Solinfra's
  Yellowstone endpoint — matches the standard Yellowstone gRPC behavior):
  - `vote: false` → excludes validator vote transactions (only non-vote txs)
  - `vote: true` → shows ONLY vote transactions
  - `vote` unset → shows both votes and non-votes (too noisy for wallet tracking)
  - `failed: true` → shows ONLY failed transactions (restrictive, not additive)
  - `failed: false` → shows ONLY successful transactions
  - `failed` unset → shows all transactions (success and failed) — this is
    the correct default for wallet tracking
  - `accountInclude: [pubkey]` → matches any tx where the pubkey appears
    in the account keys list
- **Filter construction**: use a **combined** `SubscribeRequest.create()` that
  sets slots + transactions filter + commitment in a single call. The protobuf
  `map<string, SubscribeRequestFilter>` fields are **not** mutable after
  `create()` — setting `request.transactions = {...}` after construction has
  no effect. The `setWalletPubkey()` pattern stores the pubkey before
  `connect()`, where the combined request is built.
- **Solinfra constraints**:
  - **1 concurrent stream** on the free tier — scripts must close connections
    between tests
  - **Backpressure enforcement** — the server closes streams if the client
    doesn't consume updates fast enough. The wallet filter (~1 tx per test
    send) is well within limits, but broad filters can trigger this
- **Commitment**: subscribe at `processed` for earliest signal, but the
  lifecycle tracker independently re-derives `confirmed`/`finalized` state
  rather than trusting gRPC's buffered commitment-level delivery, since the
  docs note Dragon's Mouth buffers updates server-side for non-`processed`
  levels — client-side commitment tracking is documented as the
  higher-performance, more controllable approach.
- **Reconnection**: gRPC streams will drop. The client must auto-reconnect
  with backoff and use `fromSlot` replay (supported by most providers, ~3000
  slot / ~20 minute buffer) to backfill any gap rather than silently losing
  lifecycle events.

## Leader schedule

- `getLeaderSchedule` via standard Solana RPC, cross-referenced against the
  live slot stream from Yellowstone to detect "is a Jito-Solana leader's slot
  coming up soon" — this is the basis for submission timing logic, separate
  from the AI agent's tip decision.
- **Jito validator identity resolution**: auto-fetched at startup from the
  Kobe API (`https://kobe.mainnet.jito.network/api/v1/validators`) which
  returns vote accounts running Jito-Solana. Vote accounts are cross-referenced
  against `getVoteAccounts` RPC to resolve identity pubkeys. An optional
  `JITO_VALIDATOR_KEYS` env var supplements or overrides the auto-fetched list.
  Kobe API has a 5-second timeout with graceful fallback to env-var-only mode.

## AI agent (Tip Intelligence)

- **Provider**: **Groq**, OpenAI-compatible Chat Completions API
  (`https://api.groq.com/openai/v1`), using native tool-use / function
  calling so the tip decision is returned as structured JSON, not parsed
  from free text.
- **Why Groq over OpenRouter**: the tip decision happens between bundle
  assembly and submission — it's in the hot path. Groq's inference speed is
  the deciding factor; OpenRouter's value (model breadth, easy swapping) is
  not load-bearing for a single, well-scoped decision like this one.
- **Model**: a fast Groq-hosted model with reliable structured-output
  support (e.g. an `openai/gpt-oss` class model on Groq, or whichever
  current Groq-hosted model best supports `tool_choice`-forced structured
  JSON at low latency — confirm current model roster against
  `console.groq.com/docs/models` at build time, since Groq's hosted lineup
  changes).
- **Structured output contract** (concept, finalized in implementation):
  the agent receives recent tip-floor percentiles, current slot/leader
  context, and bundle metadata, and must return a tip in lamports plus a
  short natural-language reasoning string. The reasoning string is what
  gets logged — this is what satisfies "reasoning is visible" in judging,
  not a black-box number.
- **Guardrails**: the agent's output tip is still clamped server-side
  (min 1000 lamports, max per mission.md ceiling) — the agent reasons and
  decides within bounds the system enforces, it does not have unbounded
  control over wallet spend.

## Failure simulation (for the ≥2 required failure cases)

- At least one **intentionally triggered blockhash expiry**: hold a
  constructed-and-signed transaction past its blockhash's valid window
  (~150 slots / roughly 60-90s) before submitting, to deterministically
  produce a real, classifiable failure rather than hoping one occurs
  naturally.
- Other failure types (fee too low, compute exceeded, bundle not landing)
  are classified from real `getBundleStatuses`/`getInflightBundleStatuses`
  error payloads and Solana transaction error codes as they occur during
  the live run, not separately simulated unless natural occurrences don't
  show up in time.

## Storage / logging

- Lifecycle log: structured JSON Lines (one event per line) or a simple
  JSON array — append-only, written to disk as the system runs. No database
  needed for this scope; a file is sufficient, inspectable, and easy to
  include directly in the submission.
- Each log entry captures: bundle ID, transaction signature(s), slot
  numbers at each stage, timestamps at each stage, computed latency deltas,
  tip amount + agent reasoning, and failure classification if applicable.

## Architecture document hosting

- Public Notion or Google Docs page (per bounty's accepted formats) — kept
  separate from the GitHub repo as required, linked from the README.

## Explicitly avoided

- **BAM-specific APIs** — BAM is real and shipped, but the existing Block
  Engine JSON-RPC surface (`sendBundle`, `getTipAccounts`, etc.) remains the
  documented and SDK-supported path; building against BAM's TEE/plugin
  surface directly would add complexity with no bounty-scoring benefit.
- **ShredStream** — lower latency, not required by the bounty text, adds
  infra surface area for no required-requirement gain.
- **A second LLM provider as primary** — OpenRouter stays a documented
  fallback option in case Groq has availability issues during the live run,
  but is not the default path.
