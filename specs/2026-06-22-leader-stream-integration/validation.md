# Validation — Leader Stream Integration + Tip Account Pre-fetch

This document defines how to prove the feature is complete and ready to merge.
All checks must pass before marking this feature done.

---

## Automated checks (CI-gated)

### Build integrity

| Check | Command | Expected |
|---|---|---|
| TypeScript compilation | `npm run build` | Exit code 0, `dist/` produced |
| Type checking | `npm run typecheck` | Exit code 0, no type errors |
| Unit tests | `npm test` (vitest run) | All tests pass, no skipped tests |

### Unit test coverage (minimum)

- `src/leader/schedule.ts` — 3+ test cases:
  - Parse a mock leader schedule response into typed entries
  - Cache hit returns cached schedule without re-fetching
  - Epoch boundary triggers schedule refresh
- `src/leader/stream-watcher.ts` — 2+ test cases:
  - Incoming slot maps to correct leader from mock schedule
  - Unknown slot (beyond schedule range) handled gracefully
- `src/leader/window.ts` — 3+ test cases:
  - Jito leader found within offset window
  - No Jito leader in window returns null/undefined
  - Current slot at the edge of the window boundary
- `src/jito/tip-accounts.ts` — 2+ test cases:
  - Selection returns one of the 8 known accounts
  - Repeated selections with a seed produce deterministic results

### Lint / hygiene

- No `.only` or `.skip` in committed tests
- All new modules have barrel `index.ts` exports
- Leader identity constants are not committed secrets (Jito-Solana validator
  identities are public)

---

## Manual checks (mainnet, read-only operator)

These require the Phase 1 wallet/RPC and Phase 2 Yellowstone slot stream to be
operational. They involve mainnet reads only — no transactions, no spend.

### M1 — Leader schedule fetches correctly

1. Run `npx tsx src/index.ts` with debug logging enabled
2. **Pass condition**: Logs show the leader schedule for the current epoch
   printed in a readable format (slot ranges → leader identity)

### M2 — Slot-to-leader mapping works

1. Observe the slot stream output for 30+ seconds
2. **Pass condition**: Each slot shows a leader identity; the identity for
   adjacent slots is usually the same (same leader for consecutive 4-slot
   increment), and changes at the expected boundary

### M3 — Leader-window detection fires

1. Observe logs for "Jito leader within N slots" messages
2. **Pass condition**: At least one such message appears within a 2-minute
   window (assuming Jito-Solana validators are actively participating)
3. **Verify against explorer**: Look up the detected leader slot on a public
   Solana explorer (e.g., solscan.io, solanabeach.io) and confirm the slot
   range belongs to the expected leader

### M4 — Jito leader correctly identified

1. Cross-reference the logged Jito leader identity against the known
   Jito-Solana validator identity
2. **Pass condition**: The identity matches a known Jito-Solana operator;
   if no Jito leader is in the current window, the log explicitly says
   "No Jito leader in window" rather than failing silently

### M5 — Tip accounts fetched

1. Observe startup logs
2. **Pass condition**: Log shows "Fetched 8 tip accounts" and lists the
   account addresses
3. **Verify against Jito**: The account addresses match the known output of
   `getTipAccounts` from Jito docs or a manual `jito-ts` call

### M6 — Tip-account selection is distributed

1. Run a script that calls the selection function 100 times and records
   frequencies
2. **Pass condition**: Each of the 8 accounts is selected at least 5 times
   (proving no single-account bias; with random selection and n=100 the
   probability of any account being chosen < 5 times is negligible)

---

## Integration check (run once before merging)

```
npm run build && npm run typecheck && npm test
```

---

## Definition of done

All automated checks pass AND all six manual checks (M1–M6) pass on a live
mainnet RPC with the Yellowstone slot stream running. The leader-window
detection has been verified against a public explorer at least once. Tip
accounts are cached and selectable at startup.
