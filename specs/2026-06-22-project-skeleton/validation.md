# Validation — Project Skeleton + RPC Plumbing

This document defines how to prove the feature is complete and ready to merge.
All checks must pass before marking this feature done.

---

## Automated checks (CI-gated)

### Build integrity

| Check | Command | Expected |
|---|---|---|
| TypeScript compilation | `npm run build` | Exit code 0, `dist/` produced with matching structure to `src/` |
| Type checking | `npm run typecheck` | Exit code 0, no type errors with `strict: true` |
| Unit tests | `npm test` (vitest run) | All tests pass, no skipped tests |
| Import resolution | `node dist/index.js --help` | Exits cleanly (config validation will fail without .env, but the module graph resolves) |

### Unit test coverage (minimum)

All modules must have at least basic unit tests:

- `src/types/` — test that lifecycle stage union accepts valid values and rejects invalid ones; test that `FailureClassification` narrows correctly
- `src/config/env.ts` — 3+ test cases: valid env, missing RPC_URL, missing keypair source, log level default
- `src/wallet/loader.ts` — 2+ test cases: known keypair produces expected pubkey, invalid keypair file path
- `src/rpc/errors.ts` — test that custom errors are instanceof each class and `Error`
- `src/rpc/client.ts` — test that default commitments are applied (mock Connection to avoid network calls)

### Lint / hygiene

- No `.env` files committed (`.gitignore` enforced)
- No `.key` files committed
- No `console.log` in production modules (entrypoint is exempt)
- All placeholder modules have a barrel `index.ts` export (even if empty)

---

## Manual checks (mainnet, read-only operator)

These require a funded mainnet wallet and a real RPC endpoint. They are the
Phase 1 "Check" from `specs/roadmap.md` translated into explicit criteria.

### M1 — Wallet exists and is funded

1. Set `PRIVATE_KEY` in `.env` to a known funded wallet
2. Run `npx tsx src/index.ts`
3. **Pass condition**: Output shows the expected wallet public key and a
   balance > 0 SOL

### M2 — RPC responds correctly

1. Observe the `Current slot:` output
2. **Pass condition**: Slot is a positive integer (e.g., > 300,000,000 for
   2026 mainnet), visibly increasing on re-runs

### M3 — Blockhash is fresh

1. Observe the `Latest blockhash:` output
2. **Pass condition**: Blockhash is a valid base58 string, 32 bytes encoded
   (~44 chars); `lastValidBlockHeight` is within ~400 of the current block
   height from `getSlot` (proof it's the `confirmed` commitment, not stale
   `finalized`)

### M4 — Commitment-level sanity

1. Run the entrypoint three times in quick succession
2. **Pass condition**: `getSlot("processed")` values are strictly increasing
   (proves you're getting real-time slots, not cached); `getLatestBlockhash`
   returns a different blockhash each time

### M5 — Balance sufficiency for future phases

1. Note the balance printed
2. **Pass condition**: Balance >= 0.01 SOL (sufficient for ~10 bundles at
   ~0.00005 SOL tip + ~0.000005 SOL fee each, with margin)

---

## Integration check (optional, run once before merging)

Run `npm run build && npm run typecheck && npm test` as a single command.
Intentionally break something (e.g., remove a required env var in tests) and
confirm the appropriate check fails before fixing it again.

```
npm run build && npm run typecheck && npm test
```

Expected output:
```
> valence@1.0.0 build
> tsc
   ← no output = success

> valence@1.0.0 typecheck
> tsc --noEmit
   ← no output = success

> valence@1.0.0 test
> vitest run
 ✓  all tests pass
```

---

## Definition of done

All automated checks pass AND all five manual checks (M1–M5) pass on a live
mainnet RPC with a funded wallet. The `.env.example` is accurate — someone
who clones the repo and sets their own key can replicate M1–M5 in under
5 minutes.
