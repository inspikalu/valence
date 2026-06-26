# Validation — Jito Tip-Floor Data + Tip Account Fetching

This document defines how to prove the feature is complete and ready to merge.
All checks must pass before marking Phase 5 done.

---

## Automated checks (CI-gated)

### Build integrity

| Check | Command | Expected |
|---|---|---|
| TypeScript compilation | `npm run build` | Exit code 0, `dist/` produced |
| Type checking | `npm run typecheck` | Exit code 0, no type errors |
| Unit tests | `npm test` (vitest run) | All tests pass, no skipped tests |

### Unit test coverage (minimum)

- `src/jito/tipFloor.ts` — 3+ cases:
  - `fetchTipFloor` parses a mocked percentile payload and maps raw field
    names (`landed_tips_*_percentile`, `ema_landed_tips_50th_percentile`) onto
    `p25/p50/p75/p95/p99/ema50`.
  - Handles both the array-wrapped and bare-object response shapes.
  - Converts feed units to lamports correctly and stamps `source: 'rest'` +
    `fetchedAt`.
- `src/jito/tipStream.ts` (+ snapshot store) — 3+ cases:
  - A parsed WS message updates the store; `get()` returns the latest snapshot
    with `source: 'ws'`.
  - `get()` returns `null` before any snapshot has been seeded/received.
  - The REST backstop path is chosen when the WS is stale beyond the threshold
    (timers + network mocked — no real sockets in unit tests).
- `src/jito/tipAccounts.ts` — 3+ cases:
  - `getTipAccounts` parses a mocked JSON-RPC result into 8 pubkeys.
  - Rejects / filters a non-base58 entry rather than returning it raw.
  - `TipAccountSelector.next()` round-robins through all accounts and wraps
    back to the start; a given random start offset produces the expected order.

## Manual / live checks (mainnet, zero-cost)

> This phase is read-only against public endpoints — **no bundle, no tip
> paid, no spend.** These checks require live network access.

1. **Tip-floor snapshot prints.** Run the entrypoint with `SHOW_TIP_DATA=true`.
   On startup it prints a percentile snapshot with all of `p25, p50, p75, p95,
   p99, ema50` populated with plausible lamport values (non-zero, monotonic
   p25 ≤ p50 ≤ p75 ≤ p95 ≤ p99 within normal variance).
2. **Tip accounts print.** The same run prints a list of **8** tip-account
   pubkeys, each a valid base58 public key, fetched live via `getTipAccounts`
   (not hardcoded — grep the source to confirm no literal tip-account strings).
3. **Liveness — percentiles change.** Either within a single run (watching the
   live WS lines) or across two runs a short interval apart, the percentile
   values are observably different — proving the data is live, not cached or
   stale. Capture two snapshots showing different numbers.
4. **WS-primary confirmed.** Logs show the snapshot source transitioning from
   `rest` (boot seed) to `ws` (live stream) once the stream connects.
5. **REST fallback confirmed.** Simulate/observe a WS drop (e.g. temporary
   network blip or a forced disconnect) and confirm the store refreshes via
   REST and the process does not crash or hang — reconnect resumes the WS.
6. **Opt-in safety.** With `SHOW_TIP_DATA` unset, the entrypoint boots exactly
   as it did at the end of Phase 4 (no tip output, no new connections).
7. **Clean shutdown.** On SIGINT/abort, both the Yellowstone slot stream and
   the tip-floor WS close cleanly with no dangling handles or unhandled
   rejection warnings.

## Secrets / hygiene

- No API tokens or private keys introduced or committed (the Jito public
  endpoints need no auth).
- New env vars are documented in `.env.example` with safe defaults; no real
  endpoint credentials committed.

## Definition of done (maps to roadmap Phase 5 check)

- [ ] `npm run build`, `npm run typecheck`, `npm test` all green.
- [ ] Live run prints percentile tip data and a valid 8-account tip list.
- [ ] Re-running (or live WS) shows percentiles changing over time.
- [ ] WS-primary + REST-seed/fallback behavior verified.
- [ ] Feature is opt-in and shuts down cleanly.
- [ ] No bundle submitted, no spend incurred (scope boundary respected).
- [ ] Phase 5 checkboxes ticked in `specs/roadmap.md`.

## Explicitly NOT validated here (deferred)

- Bundle construction / `sendBundle` landing — Phase 6.
- `getBundleStatuses` lifecycle tracking — Phase 6/7.
- Agent tip *decision* quality / reasoning strings — Phase 10.
- Server-side tip clamping to [1000, ceiling] — Phase 6/10.
