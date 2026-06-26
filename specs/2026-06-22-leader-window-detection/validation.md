# Validation — Leader Schedule + Leader-Window Detection

This document defines how to prove the feature is complete and ready to merge.
All checks must pass before marking this feature done.

---

## Automated checks (CI-gated)

### Build integrity

| Check | Command | Expected |
|---|---|---|
| TypeScript compilation | `npm run build` | Exit code 0, `dist/` produced; leader module included |
| Type checking | `npm run typecheck` | Exit code 0, no type errors |
| Unit tests | `npm test` (vitest run) | All tests pass, no skipped tests |
| Import resolution | `node dist/index.js --help` | Exits cleanly (will fail on missing `.env` but module graph resolves) |

### Unit test coverage (minimum)

- `src/yellowstone/leader/horizon.ts` — 5 test cases:
  - Median calculation from varied inter-slot intervals
  - Fallback to default slot time when no observations exist
  - Adaptation to fast slot times (200ms → 300 slots)
  - Adaptation to slow slot times (600ms → 100 slots)
  - Sliding window evicts old entries after N observations
- `src/yellowstone/leader/detector.ts` — 6 test cases:
  - Detection fires at the correct horizon boundary
  - Same leader slot is not detected twice (dedup)
  - `leaderEntered` fires at the correct slot (Jito-annotated)
  - `leaderPassed` fires after the leader slot
  - Heartbeat emitted every slot
  - "No Jito leader" case when no Jito keys are within horizon

### Lint / hygiene

- No hardcoded Jito validator keys in source code (fetched from Kobe API at
  runtime, with env var as optional override)
- No raw `console.log` in the leader module itself — only emit events;
  entrypoint subscribes and logs
- gRPC slot stream integration does not add new console.log calls to the
  yellowstone module
- Kobe API fetch has a 5-second timeout and graceful fallback on failure

---

## Manual checks (mainnet, read-only operator)

These require a live Phase 2 slot stream and Solana RPC.

### L1 — Leader schedule fetched on startup

1. Run `npx tsx src/index.ts` with a valid Yellowstone endpoint
2. **Pass condition**: Within 5 seconds of startup, output shows:
   ```
   [leader] schedule loaded: {N} leaders, {M} Jito-Solana validators
   ```
   (M should be a non-zero number if the Kobe API resolves successfully
   and Jito validators exist in the current schedule)

### L2 — Heartbeat identifies next Jito window

1. Let the slot stream run for at least 10 seconds
2. **Pass condition**: Every observed slot produces a heartbeat line:
   ```
   [leader] slot #{N} | next Jito leader: {identity} in ~{seconds}s
   ```
   or, if none within the dynamic horizon:
   ```
   [leader] slot #{N} | no Jito leader within horizon
   ```

### L3 — Jito leader detection lifecycle

1. Wait for a `leaderDetected` event to fire
2. Note the detected leader slot number
3. Wait until the current slot reaches that leader slot
4. **Pass condition**:
   - `leaderDetected` fires before the leader slot arrives
   - `leaderEntered` fires at or within 1 slot of the detected slot
   - `leaderPassed` fires after the detected slot (current > leader slot)
5. Cross-check the leader identity against a public Solana explorer:
   **Pass condition**: The identity logged in the heartbeat matches the
   explorer's leader for that slot

### L4 — Horizon adapts to observed slot time

1. Let the stream run for 2+ minutes
2. **Pass condition**: The heartbeat's estimated seconds remaining
   converges toward real observed time (the countdown should tick down
   at roughly 1 second per real second, not drift significantly)

### L5 — Recovery after slot stream reconnect

1. With the slot stream running and leader detection active, trigger a
   disconnect (see Phase 2 M4 procedure)
2. Let the slot stream reconnect
3. **Pass condition**: Within 5 seconds of the slot stream resuming,
   the heartbeat line reappears with an accurate countdown (the detector
   re-scans the schedule from the new current slot and does not emit
   stale `leaderDetected` events for slots that have already passed)

---

## Definition of done

All automated checks pass AND all five manual checks (L1–L5) pass on a live
mainnet Yellowstone gRPC endpoint and Solana RPC. The `.env.example` is
updated with the new `JITO_VALIDATOR_KEYS` and `LEADER_HEARTBEAT_INTERVAL`
variables so someone who clones the repo can replicate L1–L5 in under
10 minutes.
