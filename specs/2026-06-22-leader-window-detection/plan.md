# Plan — Leader Schedule + Leader-Window Detection

> Covers roadmap Phase 3: leader schedule + leader-window detection.
> Current date: June 22, 2026. Submission deadline: June 29, 2026.

---

## Task group 1 — Leader schedule fetching and caching

- [x] 1. Create `src/yellowstone/leader/schedule.ts`:
       - `fetchLeaderSchedule()` — calls `getLeaderSchedule()` RPC to retrieve
         the full leader schedule for the current epoch; internally calls
         `fetchJitoValidatorKeys()` to resolve Jito identity keys
       - `fetchJitoValidatorKeys()` — fetches `https://kobe.mainnet.jito.network/api/v1/validators`
         to get vote accounts running Jito-Solana, cross-references against
         `getVoteAccounts()` RPC to map vote accounts → identity pubkeys, and
         merges with any override keys from `JITO_VALIDATOR_KEYS` env var
       - Returns a map of `slot -> validatorIdentity` (as `Map<bigint, string>`)
       - Handles schedule gaps (some slots may not have a leader in the RPC
         response — use the nearest known assignment)
       - Caches the schedule in-memory; re-fetches when the epoch advances
         (detected via slot number crossing the epoch boundary)
       - `isJitoValidator(identity: string): boolean` — checks against the
         resolved Jito-Solana identity key set
       - Kobe API has a 5-second timeout; on failure, falls back to env var
         keys only (may be empty, treating all leaders as non-Jito)
- [x] 2. Create `src/yellowstone/leader/types.ts`:
       - `LeaderSlot` — `{ slot: bigint, identity: string, isJito: boolean }`
       - `LeaderWindow` — `{ currentSlot: bigint, leader: LeaderSlot,
         slotsRemaining: number, estimatedSeconds: number }`
       - `DetectedLeader` — `{ slot: bigint, identity: string, isJito: boolean,
         detectedAt: bigint, horizonSlots: number }`
- [x] 3. Create `src/yellowstone/leader/index.ts` — barrel export
- [x] 4. **Check**: `npm run typecheck` passes; leader schedule module can be
       imported without runtime error (RPC call will fail in test, but module
       graph resolves)

---

## Task group 2 — Horizon computation

- [x] 1. Create `src/yellowstone/leader/horizon.ts`:
       - `computeHorizon(): number` — computes the number of slots expected in
         the next ~60 seconds based on observed inter-slot intervals
       - Uses median of the last N observed intervals (sliding window of 10)
         to estimate slot duration, then divides 60,000ms by that median
       - Returns a slot count (e.g., ~150 slots for ~400ms/slot)
       - Guards against empty/insufficient data (fall back to 400ms default
         slot time → 150 slots)
       - `updateObservedTimes(interSlotMs: number): void` — accepts new
         observations and updates the sliding window
       - `resetObservations(): void` — clears the sliding window (for tests)
- [x] 2. Wire horizon computation into the Phase 2 slot stream handler:
       - On each slot update (already received in Phase 2), compute the
         inter-slot interval and feed it to `updateObservedTimes`
       - When the horizon changes significantly (>20% delta from previous),
         emit a `horizonAdapted` event
- [x] 3. Write unit test `tests/unit/yellowstone/leader/horizon.test.ts` (5):
       - Test median calculation from varied intervals
       - Test fallback when no data is available
       - Test adaptation to fast/slow slot times
       - Test sliding window behaviour (old entries are evicted)
- [x] 4. **Check**: `npm test` passes; horizon adapts to input timing

---

## Task group 3 — Leader-window detection engine

- [x] 1. Create `src/yellowstone/leader/detector.ts`:
       - `LeaderWindowDetector` class (EventEmitter):
         - Constructor takes: YellowstoneConnection, schedule Map,
           resolved jitoValidatorKeys array
         - On each slot update, scans the schedule ahead up to `horizon` slots
         - For each upcoming leader within the horizon, emits `leaderDetected`
           with `DetectedLeader` payload (only once per leader slot — dedup
           by slot number)
         - When the current slot reaches a previously-detected leader slot,
           emits `leaderEntered`
         - When the current slot passes a leader slot (current > leader slot),
           emits `leaderPassed`
         - Emits a per-slot heartbeat event with `LeaderWindow` payload
           showing the next Jito leader slot and estimated seconds remaining
         - Emits `horizonAdapted` when the horizon changes by >20%
- [x] 2. Wire `LeaderWindowDetector` into `src/index.ts`:
       - Initialize alongside the Phase 2 slot stream
       - Subscribe to `leaderDetected`, `leaderEntered`, `leaderPassed`
         events and log them
       - Subscribe to heartbeat and log on every slot:
         `[leader] slot #{N} | next Jito leader: {identity} in ~{seconds}s`
         (or "no Jito leader within horizon" if none found)
- [x] 3. Write unit tests `tests/unit/yellowstone/leader/detector.test.ts` (6):
       - Test detection fires at correct horizon boundary
       - Test dedup (same leader slot not detected twice)
       - Test leaderEntered/leaderPassed at correct slots
       - Test heartbeat emission
       - Test "no Jito leader" case
- [x] 4. **Check**: `npm test` passes; detector logic is deterministic in
       tests with a fake slot stream

---

## Task group 4 — Config and entrypoint integration

- [x] 1. Update `src/config/env.ts` to add:
       - `JITO_VALIDATOR_KEYS` — optional comma-separated list of known
         Jito-Solana validator identity public keys; used as an override
         supplement to the auto-fetched list from the Kobe API
       - `LEADER_HEARTBEAT_INTERVAL` — optional, default 1 (every slot);
         controls how often the heartbeat log line is printed
- [x] 2. Update config type definitions in `src/types/config.ts` to match
- [x] 3. Update `.env.example` with the new variables
- [x] 4. **Check**: `npm run build && npm run typecheck` succeeds; leader
       module is included in the build output

---

## Task group 5 — Manual smoke test (mainnet, read-only)

This task cannot run in CI — it requires a live Yellowstone endpoint and a
Solana RPC.

1. Set `YELLOWSTONE_ENDPOINT` and optionally `JITO_VALIDATOR_KEYS` in `.env`
2. Run `npx tsx src/index.ts`
3. **Verify**:
   - On startup, leader schedule is fetched, Kobe API is queried, and the
     resolved Jito count is logged:
     `[leader] schedule loaded: {N} leaders, {M} Jito-Solana validators`
   - Within one slot (~400ms) of the slot stream starting, the heartbeat log
     line appears: `[leader] slot #{N} | next Jito leader: {identity} in ~{seconds}s`
   - If a Jito leader is within the horizon, a `leaderDetected` event fires
   - When the current slot reaches a detected leader slot, `leaderEntered`
     fires
   - After the leader slot passes, `leaderPassed` fires
   - If the slot stream disconnects and reconnects (Phase 2), the detector
     catches up gracefully (re-scans schedule from the new current slot)
4. **Check**: pick a Jito leader slot from the heartbeat log, verify it
   against a public Solana explorer's leader view
