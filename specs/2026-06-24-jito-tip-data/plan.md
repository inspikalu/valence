# Plan — Jito Tip-Floor Data + Tip Account Fetching

> Covers roadmap Phase 5. Builds the Jito tip-data pipeline (tip-floor
> percentiles via WS-primary/REST-fallback, and `getTipAccounts` with
> per-bundle selection) that Phases 6 and 10 depend on. **No bundle
> submission, no spend, no agent decision in this phase.**
> Current date: June 24, 2026. Submission deadline: June 29, 2026.

---

## Task group 1 — Types and config

1. Add tip-data types in `src/jito/types.ts`:
   - `TipFloorSnapshot` — `{ p25, p50, p75, p95, p99, ema50 }` in lamports
     (number), plus source `time` (string/epoch from the feed) and a local
     `fetchedAt` (ms) and `source: 'ws' | 'rest'` provenance field.
   - `TipAccounts` — `string[]` of base58 pubkeys.
2. Extend `src/types/config.ts` and `src/config/env.ts` with:
   - `SHOW_TIP_DATA` (boolean, default false) — entrypoint print toggle.
   - `JITO_TIP_FLOOR_URL` (default `https://bundles.jito.wtf/api/v1/bundles/tip_floor`).
   - `JITO_TIP_STREAM_URL` (default `wss://bundles.jito.wtf/api/v1/bundles/tip_stream`).
   - `JITO_BLOCK_ENGINE_URL` (default `https://mainnet.block-engine.jito.wtf`).
   - `JITO_TIP_REST_REFRESH_MS` (default ~10000) — REST backstop interval
     while WS is down (respect the 1 req/sec Block Engine rate limit).
3. Update `.env.example` with the new vars, commented and defaulted, matching
   the existing file's documentation style.

## Task group 2 — Tip-floor REST client

1. `src/jito/tipFloor.ts`: `fetchTipFloor(url): Promise<TipFloorSnapshot>` —
   `fetch` the endpoint, parse the percentile payload, map raw field names
   (`landed_tips_*_percentile`, `ema_landed_tips_50th_percentile`) into the
   typed snapshot, stamp `fetchedAt` + `source: 'rest'`.
2. Verify the real field names against a live response during implementation
   (the payload is typically a single-element array); handle both array and
   bare-object shapes defensively.
3. Convert SOL-denominated percentile values to lamports if the feed returns
   SOL (verify units live — tip_floor historically returns SOL floats).

## Task group 3 — Tip-floor WS client + latest-snapshot store

1. `src/jito/tipStream.ts`: a WS client that connects to `tip_stream`, parses
   each message into a `TipFloorSnapshot` (`source: 'ws'`), and pushes it to
   the snapshot store. Auto-reconnect with backoff, mirroring the posture of
   `src/yellowstone/reconnect.ts`.
2. `src/jito/snapshot.ts` (or fold into the stream module): a single
   `TipFloorStore` holding the latest snapshot. API:
   - `seed()` — one REST fetch at boot to populate before WS connects.
   - `get(): TipFloorSnapshot | null` — synchronous read for consumers.
   - `start()` / `stop()` — manage the WS connection + REST backstop timer.
   - REST backstop: if WS has been disconnected longer than the staleness
     threshold, do a single `fetchTipFloor` to refresh (rate-limit aware).
3. Decide `ws` dependency: add the `ws` package (Node has no stable built-in
   WS client across target LTS) — keep it the only new dependency.

## Task group 4 — Tip-account client + selector

1. `src/jito/tipAccounts.ts`: `getTipAccounts(blockEngineUrl): Promise<string[]>`
   — JSON-RPC POST (`method: "getTipAccounts"`) to the Block Engine bundles
   endpoint; validate each result is a base58 `PublicKey`; return the list.
2. `TipAccountSelector`: round-robin with a random start offset. `next()`
   returns one pubkey per call; cycles through all 8 before repeating.
3. Cache the fetched account list in memory (the 8 accounts are static); expose
   a refetch path but do not poll.

## Task group 5 — Jito module barrel + wiring

1. `src/jito/index.ts`: replace the stub with a clean barrel export of the
   tip-floor store, REST client, tip-account client, and selector.
2. Ensure construction takes config/endpoints as arguments (no module-level
   singletons reaching into env directly) so the units stay testable.

## Task group 6 — Entrypoint integration

1. In `src/index.ts`, behind `SHOW_TIP_DATA`:
   - On startup: `seed()` the tip-floor store (REST), `getTipAccounts()`, and
     print a formatted snapshot (all percentiles + EMA) and the tip-account
     list.
   - `start()` the WS feed so subsequent log lines reflect live percentile
     changes; print on each WS update (or on a light interval) so a single run
     visibly shows the data moving.
2. Hook teardown into the existing lifecycle/abort path so the WS closes
   cleanly alongside the Yellowstone stream (respect Solinfra's 1-stream
   posture — these are separate endpoints so no conflict, but shutdown must
   still be clean).
3. Keep the feature fully opt-in: with `SHOW_TIP_DATA` unset, boot behavior is
   unchanged from Phase 4.

## Task group 7 — Tests

1. `tests/unit/jito/tipFloor.test.ts` — `fetchTipFloor` parses a mocked
   percentile payload (array + bare-object shapes), maps field names, converts
   units, stamps provenance.
2. `tests/unit/jito/tipStream.test.ts` — WS message parsing into a snapshot;
   store `get()` returns the latest pushed snapshot; REST fallback path chosen
   when WS is stale (with timers/network mocked).
3. `tests/unit/jito/tipAccounts.test.ts` — `getTipAccounts` parses a mocked
   JSON-RPC response and rejects non-base58 entries; selector round-robins
   across all accounts and wraps correctly from a given start offset.

## Task group 8 — Verify + docs

1. Run `npm run typecheck`, `npm run build`, `npm test` — all green.
2. Run the entrypoint with `SHOW_TIP_DATA=true` against mainnet endpoints;
   confirm live percentiles + 8 tip accounts print, and that re-running (or
   watching the live WS lines) shows the percentiles change over time.
3. Tick the Phase 5 checkboxes in `specs/roadmap.md` once the validation
   checklist passes.
