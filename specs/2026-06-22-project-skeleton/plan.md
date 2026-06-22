# Plan — Project Skeleton + RPC Plumbing

> Combines roadmap Phase 0 and Phase 1.
> Current date: June 22, 2026. Submission deadline: June 29, 2026.

---

## Task group 1 — Project initialization ✅

- [x] 1. Create `package.json` with:
   - name: `valence`
   - module type: `module` (ESM)
   - scripts: `build` (tsc), `dev` (tsx watch), `start` (node dist/index.js), `test` (vitest), `test:run` (vitest run), `typecheck` (tsc --noEmit), `lint` (tsc --noEmit)
- [x] 2. Create `tsconfig.json` with:
    - `target`: `ES2022`, `module`: `ESNext`, `moduleResolution`: `Bundler`
    - `outDir`: `dist/`, `rootDir`: `src/`
    - `strict`: `true`, `noUncheckedIndexedAccess`: `true`, `exactOptionalPropertyTypes`: `true`
    - `paths` mapping `@valence/*` → `src/*`
    - `baseUrl`: `.`
    - `include`: `["src"]`
    - Note: `Bundler` resolution is used because TypeScript's `paths` alias
      map is only supported at compile time — Node.js cannot resolve `@valence/*`
      at runtime. Source code uses relative imports (e.g. `../types/index.js`)
      so `node dist/index.js` works without a runtime resolver. Tools like
      `tsx` and Vitest have their own path-alias support, so `@valence/*`
      imports in test files resolve correctly via the Vitest config.
- [x] 3. Create folder structure
- [x] 4. Create `.gitignore`
- [x] 5. Create `.env.example`
- [x] 6. Install base dependencies
- [x] 7. Install dev dependencies
- [x] 8. Create `vitest.config.ts`
- [x] 9. **Check**: `npm run build` produces `dist/`; `npm run typecheck` passes; `npm test` passes

---

## Task group 2 — Shared type definitions ✅

- [x] 1. Create `src/types/lifecycle.ts`
- [x] 2. Create `src/types/failure.ts`
- [x] 3. Create `src/types/config.ts`
- [x] 4. Create `src/types/index.ts` — barrel export
- [x] 5. **Check**: `npm run typecheck` passes; types importable from `@valence/types`

---

## Task group 3 — Configuration and environment ✅

- [x] 1. Create `src/config/env.ts`
- [x] 2. Create `src/config/index.ts` — barrel export
- [x] 3. Write unit test `tests/unit/config/env.test.ts` (6 tests)
- [x] 4. **Check**: `npm test` passes; config module returns typed config

---

## Task group 4 — Wallet loading ✅

- [x] 1. Create `src/wallet/loader.ts`
- [x] 2. Create `src/wallet/index.ts` — barrel export
- [x] 3. Write unit test `tests/unit/wallet/loader.test.ts` (2 tests)
- [x] 4. **Check**: `npm test` passes; wallet loading is deterministic

---

## Task group 5 — RPC client wrapper ✅

- [x] 1. Create `src/rpc/client.ts`
- [x] 2. Create `src/rpc/errors.ts` — custom error classes
- [x] 3. Create `src/rpc/index.ts` — barrel export
- [x] 4. Write unit test `tests/unit/rpc/client.test.ts` (4 tests) + `tests/unit/rpc/errors.test.ts` (3 tests)
- [x] 5. **Check**: `npm test` passes; default commitments explicit

---

## Task group 6 — Entrypoint integration ✅

- [x] 1. Create `src/index.ts` with relative imports and `wallet.publicKey` argument
- [x] 2. **Check**: `npm run build` compiles without errors

---

## Task group 7 — Manual smoke test (mainnet, read-only)

This task cannot run in CI — it requires a real mainnet-funded wallet.

1. Set up `.env` with a real mainnet RPC URL and a funded wallet's private key
2. Run `npm run dev` (or `npx tsx src/index.ts`)
3. **Verify**:
   - Wallet public key printed matches the expected key
   - Current slot is a positive integer, looks like a recent mainnet slot
   - Balance > 0 SOL (enough for future ~10 bundle submissions)
   - Blockhash is a valid base58 string of ~44 characters
   - The program exits cleanly with "Valence stack initialized successfully."
4. If balance is too low, fund the wallet before proceeding to later phases
5. **Check**: script runs against mainnet, all values are printed correctly, no errors
