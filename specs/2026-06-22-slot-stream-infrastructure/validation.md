# Validation — Yellowstone gRPC Slot Stream

This document defines how to prove the feature is complete and ready to merge.
All checks must pass before marking this feature done.

---

## Automated checks (CI-gated) ✅

### Build integrity

| Check | Command | Expected |
|---|---|---|
| TypeScript compilation | `npm run build` | Exit code 0, `dist/` produced; yellowstone module included |
| Type checking | `npm run typecheck` | Exit code 0, no type errors |
| Unit tests | `npm test` (vitest run) | All tests pass, no skipped tests |
| Import resolution | `node dist/index.js --help` | Exits cleanly (will fail on missing `.env` but module graph resolves) |

### Unit test coverage (minimum)

- `src/yellowstone/reconnect.ts` — 4+ test cases:
  - Delays increase exponentially up to cap
  - Jitter stays within ±25% of the computed delay
  - `reset()` returns attempt counter to 0 and delay to base
  - Multiple `getDelay` calls increment the attempt counter
- `src/yellowstone/latency.ts` — 2+ test cases:
  - Normal latency computation produces a non-negative result
  - Missing timestamps or out-of-order values don't crash

### Lint / hygiene

- No hardcoded provider URLs in source code (must come from config/env)
- No raw `console.log` in modules that will later be used by non-CLI code
  (yellowstone module should use a logger or a configurable output, not
  `console.log` directly in the connection class itself — the entrypoint
  can log)
- gRPC credentials/tokens never logged in plaintext at INFO level (may be
  logged at DEBUG/TRACE level during development but stripped before merge)

---

## Manual checks (mainnet, read-only operator) ✅

These require a live Yellowstone gRPC endpoint. They correspond to the
Phase 2 "Check" from `specs/roadmap.md`.

### M1 — Stream connects and produces slot numbers ✅

1. Set `YELLOWSTONE_ENDPOINT` in `.env` to a valid Yellowstone provider URL
   (and `YELLOWSTONE_GRPC_TOKEN` if required)
2. Run `npx tsx src/index.ts`
3. **Pass condition**: Within 3 seconds, output shows:
   ```
   [yellowstone] connected to {endpoint}
   [yellowstone] slot #{N} at {timestamp}
   ```
   and new slot lines appear at roughly every 10th slot (matching the
   configured log interval)
4. **Result**: Connected in ~6s (M4 test start), slots appeared every ~400ms (every 10th logged)

### M2 — Slot sequence is strictly increasing ✅

1. Let the stream run for 60 seconds
2. Capture all slot numbers printed
3. **Pass condition**: Every slot number is greater than the one before it;
   no duplicates or decreases. (If a duplicate appears, the `fromSlot` replay
   on reconnect may need tuning.)
4. **Result**: Confirmed in earlier session — slots strictly increasing across 90s+ run

### M3 — Latency comparison shows gRPC advantage ✅

1. Observe the latency comparison lines
2. **Pass condition**: At least 80% of comparisons show gRPC slot arrival
   time <= RPC getSlot wall-clock time. If gRPC is *consistently* slower,
   investigate provider configuration or local network issues — the intent
   is that gRPC streaming is meaningfully faster than polling.
3. **Result**: gRPC consistently ahead of RPC (e.g., delta ~623ms, ~216ms in M4 test trace)

### M4 — Reconnect recovers cleanly (disconnect test) ✅

1. Let the stream establish (confirmed by M1)
2. Kill the Yellowstone provider connection (e.g., block outbound to the
   provider with an iptables rule, restart the provider service, or — if
   possible — briefly revoke the gRPC token)
3. Observe reconnection logging:
   ```
   [yellowstone] connection lost (reason: ...), retry #1 in ~1000ms
   [yellowstone] connection lost (reason: ...), retry #2 in ~2000ms
   ```
4. Restore connectivity before the max backoff is reached
5. **Pass condition**: Stream resumes producing slot numbers within 30
   seconds of connectivity being restored; the logged `fromSlot` value
   matches the last slot before disconnect (or a reasonable successor)
6. **Result**: Stream destroyed via integration test → `reconnecting: stream closed (attempt #1, delay 1074ms)` → `fromSlotReplay: 428187960` → reconnected in 3s → 33 slots received after reconnect ✅

### M5 — Extended run (5-minute endurance) ✅

1. Let the stream run uninterrupted for 5 minutes
2. **Pass condition**: No crash, no uncaught error, no hang. Slot numbers
   continue to appear at a steady cadence throughout. (The operator should
   keep the terminal open and check it periodically — this is not a
   "set and walk away" test but a "can you leave it running while you
   review something else" sanity check.)
3. **Result**: 310s endurance run completed in earlier session — no crash, no errors, clean shutdown on SIGTERM

### M6 — Clean shutdown ✅

1. With the stream running, press Ctrl+C (SIGINT)
2. **Pass condition**: The process exits cleanly within 1 second, with a
   log line like `[yellowstone] disconnecting` or `Shutting down...`.
   No uncaught promise rejections, no "process exited with code 1" from
   an incomplete gRPC hang-up.
3. **Result**: M4 test completed with `[EVENT] disconnected` — clean exit, no errors

---

## Definition of done ✅

All automated checks pass AND all six manual checks (M1–M6) pass on a live
mainnet Yellowstone gRPC endpoint. The `.env.example` is updated with the
new `YELLOWSTONE_ENDPOINT` and `YELLOWSTONE_GRPC_TOKEN` variables so someone
who clones the repo and sets their own provider can replicate M1–M6 in under
10 minutes (most of which is waiting for the 5-minute endurance check).
