# Plan — Leader Stream Integration + Tip Account Pre-fetch

> Covers roadmap Phase 3 plus tip-account pre-fetch (added per scope decision).
> Current date: June 22, 2026. Submission deadline: June 29, 2026.

---

## Task group 1 — Leader schedule RPC integration

- [ ] 1. Create `src/leader/schedule.ts` — fetch and cache the leader schedule
   via `getLeaderSchedule` or `getSlotLeaders` from the RPC client.
- [ ] 2. Implement schedule parsing: map epoch → leader schedule entries,
   indexed by slot range.
- [ ] 3. Implement schedule refresh: detect epoch boundary and re-fetch before
   the old schedule expires.
- [ ] 4. Create `src/leader/index.ts` — barrel export.
- [ ] 5. Write unit tests for schedule parsing, caching, and refresh triggers.
- [ ] 6. **Check**: `npm test` passes; schedule module returns typed leader
   entries for a known epoch.

---

## Task group 2 — Yellowstone slot stream cross-reference

- [ ] 1. Read the existing Yellowstone slot stream from Phase 2's module
   (`src/yellowstone/`).
- [ ] 2. In `src/leader/stream-watcher.ts`, subscribe to the slot stream and
   map each incoming slot to the leader schedule: identify which leader
   produced the slot.
- [ ] 3. Log each slot with its leader identity as a sanity-check line
   (suppressed in normal operation, visible in debug mode).
- [ ] 4. Write unit tests with a mocked slot stream and a known schedule.
- [ ] 5. **Check**: `npm test` passes; with a real stream, logged slots show
   the expected leader identity.

---

## Task group 3 — Leader-window detection

- [ ] 1. Implement `nextLeaderWindow(offsetSlots: number)` in
   `src/leader/window.ts`: given the current slot from the stream, scan
   the leader schedule forward by `offsetSlots` and return the first
   Jito-Solana leader's slot range within that window.
- [ ] 2. Expose the offset as a configurable parameter (default: ~10 slots).
- [ ] 3. Implement a polling or event-based loop that checks the window
   on each new slot from the stream and emits a signal when a Jito
   leader slot is approaching.
- [ ] 4. Create `src/leader/index.ts` — update barrel to include window.
- [ ] 5. Write unit and integration tests:
   - Unit: window logic with mock schedule, known current slot.
   - Integration: run against live RPC + slot stream, verify detection
     fires at the expected offset.
- [ ] 6. **Check**: `npm test` passes; manual run shows upcoming Jito
   leader windows logged in real time.

---

## Task group 4 — Tip-account pre-fetch

- [ ] 1. Create `src/jito/tip-accounts.ts` — implement `getTipAccounts` call
   via the RPC client or `jito-ts`.
- [ ] 2. Implement random/round-robin selection logic per tech-stack.md's
   guidance (pick one account per bundle, avoid write-lock contention).
- [ ] 3. Create `src/jito/index.ts` — barrel export.
- [ ] 4. Write unit tests: mock `getTipAccounts`, verify selection is
   deterministic with a seed and distributed across all accounts.
- [ ] 5. **Check**: `npm test` passes; `getTipAccounts` returns the expected
   8 accounts from a live mainnet RPC.

---

## Task group 5 — Integration wiring + manual verification

- [ ] 1. Wire leader-window detection into the main entrypoint
   (`src/index.ts`): on each new slot, check the window and log when a
   Jito leader is within the offset.
- [ ] 2. Wire tip-account pre-fetch into startup: fetch and cache tip accounts
   once on init, log the count.
- [ ] 3. Run against mainnet:
   - Verify leader schedule logs match a known slot range from an explorer.
   - Verify tip accounts list matches `getTipAccounts` response.
   - Verify leader-window detection fires at the expected offset.
- [ ] 4. **Check**: full pipeline outputs are correct per `validation.md`.
