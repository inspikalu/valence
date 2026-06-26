# Requirements — Jito Tip-Floor Data + Tip Account Fetching

## Feature summary

Build the Jito tip-data pipeline that later phases (bundle construction in
Phase 6, and the Tip Intelligence agent in Phase 10) depend on, **without
submitting any bundle yet**. Two independent data sources:

1. **Tip-floor percentiles** — live percentile tip data
   (25th / 50th / 75th / 95th / 99th + EMA) sourced from Jito's public
   `bundles.jito.wtf` feed, maintained as a single in-memory "latest
   snapshot" that consumers read synchronously.
2. **Tip accounts** — the 8 static Jito tip accounts, fetched via
   `getTipAccounts` (never hardcoded), with per-bundle selection logic so a
   single account is chosen each time to avoid write-lock contention.

This phase deliberately stops short of bundle assembly or `sendBundle`. Its
only job is to prove the two data feeds are real, live, and correctly parsed —
so that when Phase 6 builds its first bundle, "is the tip data correct?" and
"does bundle submission work?" are never being debugged at the same time.

Once this feature is merged, the system should be able to:
- Maintain a current tip-floor percentile snapshot in memory, driven live by
  the WebSocket `tip_stream`, seeded and backstopped by the REST `tip_floor`
  endpoint.
- Expose the latest snapshot synchronously to any consumer (the agent later,
  the entrypoint now).
- Fetch the live list of Jito tip accounts and select one per bundle via a
  round-robin (with a random start offset) strategy.
- Print, from the main entrypoint behind an env flag, the live percentiles and
  the tip-account list on startup — and show changing percentiles across runs.

## Locked decisions (from this spec's clarification round)

| Decision | Choice | Rationale |
|---|---|---|
| Jito client | **Hybrid — hand-rolled now** | Phase 5 needs only `tip_floor` (REST GET), `tip_stream` (WS), and `getTipAccounts` (JSON-RPC POST) — all trivial wire formats. A thin hand-rolled client keeps the dependency surface lean (currently `web3.js` + `yellowstone` only). The `jito-ts`-vs-raw decision for `sendBundle`/`getBundleStatuses` is deferred to Phase 6, where it can be judged against real submission behavior. |
| Tip-floor ingestion | **WS primary + REST fallback** | The WS `tip_stream` drives the live snapshot (satisfies the "percentiles changing" check and serves the Phase 10 hot-path snapshot need). A REST `GET tip_floor` seeds the snapshot at boot (before the first WS message) and refills it if the WS is disconnected. Mirrors the reconnect-with-backoff posture already committed to for the Yellowstone slot stream in Phase 2. |
| Verification surface | **Main entrypoint integration** | Tip-floor fetching wires into `src/index.ts` behind an env flag, printing percentiles + tip accounts on startup. Closer to the eventual integrated system; re-running the entrypoint shows percentiles changing over time. |
| Tip-account selection | **Round-robin with random start offset** | Per Jito guidance, rotate across the 8 accounts to avoid write-lock contention on a single tip account. A random start offset avoids every process instance hammering account #0 first. |

## In scope

- **Tip-floor REST client** (`src/jito/tipFloor.ts` or similar): a thin
  `fetch`-based call to `GET https://bundles.jito.wtf/api/v1/bundles/tip_floor`
  that parses the percentile payload into a typed `TipFloorSnapshot`
  (`p25`, `p50`, `p75`, `p95`, `p99`, `ema50`, plus the source `time`/slot
  fields the endpoint returns, and a local `fetchedAt` timestamp).
- **Tip-floor WS client**: a connection to
  `wss://bundles.jito.wtf/api/v1/bundles/tip_stream` that parses each message
  into the same `TipFloorSnapshot` shape and updates the in-memory latest
  snapshot. Auto-reconnect with backoff (reuse/mirror the existing Yellowstone
  reconnect helper's posture; does not need to share code if shapes differ).
- **Latest-snapshot store**: a single source of truth holding the most recent
  `TipFloorSnapshot` and its provenance (`ws` | `rest`) + age. Seeded by REST
  at boot; updated by WS continuously; refreshed by REST when WS is
  disconnected beyond a staleness threshold. Read synchronously by consumers.
- **Tip-account client** (`getTipAccounts`): a JSON-RPC POST to the mainnet
  Block Engine (`https://mainnet.block-engine.jito.wtf/api/v1/bundles`,
  method `getTipAccounts`) returning the 8 tip-account pubkeys, validated as
  base58 public keys.
- **Tip-account selector**: round-robin with a random start offset, exposing
  a `next()` that returns one account pubkey per call.
- **Entrypoint integration**: behind a new env flag (e.g. `SHOW_TIP_DATA`),
  on startup fetch + print the current percentile snapshot and the tip-account
  list, then keep the WS feed running so subsequent log lines reflect live
  changes. Must cleanly co-exist with the existing Yellowstone slot stream and
  shut down on the same lifecycle/abort path.
- **Config + env**: new env vars surfaced through `src/config/env.ts` and the
  `.env.example`, with sensible defaults so the feature is opt-in and the
  endpoints are overridable.
- **Unit tests** for parsing and selection logic (pure functions), with the
  network layer mocked.

## Out of scope (explicitly deferred)

- **Bundle construction / `sendBundle`** — Phase 6. No transaction is built or
  submitted in this phase.
- **`getBundleStatuses` / `getInflightBundleStatuses`** — Phase 6/7. No bundle
  exists to track yet.
- **The Tip Intelligence agent / Groq call** — Phase 10. This phase only
  produces the *data* the agent will later consume; it makes no tip *decision*.
- **Tip clamping ([1000, ceiling])** — that guardrail belongs with the agent's
  decision (Phase 10) and bundle assembly (Phase 6), not with raw data fetching.
- **`jito-ts` SDK adoption** — deliberately deferred; see locked decisions.
- **Regional Block Engine endpoint selection / latency optimization** — note
  the endpoint is overridable via config, but picking the lowest-latency region
  is a Phase 6 concern when submission latency actually matters.

## Context and constraints (from mission.md / tech-stack.md)

- **No hardcoded values** is a mission design principle — tip data must come
  from the live feed, and tip accounts must come from `getTipAccounts`, never
  baked into source.
- **Mainnet only.** Both endpoints are public and read-only; this phase spends
  no money (no bundle, no tip paid) — it is the last fully zero-cost phase
  before the first real spend in Phase 6.
- **Block Engine rate limit**: 1 request/sec/IP/region default. The REST
  fallback poll must respect this — do not poll aggressively; the WS feed is
  the primary live driver and REST is only a seed/backstop.
- **Percentile fields**: the `tip_floor` endpoint returns
  `landed_tips_25th_percentile`, `_50th_`, `_75th_`, `_95th_`, `_99th_`, and
  `ema_landed_tips_50th_percentile` (field names to be verified live during
  implementation — re-verify against the real payload, as the tech-stack doc
  warns these ecosystems move fast).
- **Tip placement / minimum tip** (1000 lamports floor, last-tx placement) are
  documented here as forward context for Phase 6 but are NOT implemented now.

## Open items to verify during implementation

- Exact JSON field names returned by `tip_floor` REST and `tip_stream` WS
  (confirm they match; the WS payload is typically an array with one object).
- The WS message framing (single snapshot object vs array) and whether it
  emits on an interval or on-change.
- `getTipAccounts` JSON-RPC endpoint path and response envelope on the current
  Block Engine.
