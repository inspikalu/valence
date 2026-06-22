# Requirements — Project Skeleton + RPC Plumbing

## Feature summary

Scaffold the Valence project and prove it can connect to Solana mainnet
(read-only). Combines roadmap Phase 0 (project skeleton) and Phase 1 (wallet
and RPC plumbing) into one feature because the package init, type definitions,
and connectivity test share a single dependency chain.

Once this feature is merged, the repo should be a valid TypeScript project
that builds, has all shared type definitions in place, and can print the
wallet's balance and current slot from a live mainnet RPC.

## In scope

- TypeScript project init: `package.json`, `tsconfig.json`, folder layout
  (`src/` with modules per tech-stack.md, `tests/` with Vitest config)
- Shared type definitions: lifecycle log entry shape, failure classification
  enum, config schema
- Environment configuration: `.env.example`, env parsing, validation at startup
- Wallet loading: keypair from env var or file path, never committed
- RPC client wrapper: connect to mainnet RPC, expose typed methods for
  `getBalance`, `getLatestBlockhash`, `getSlot` at explicit commitment levels
- A runnable entrypoint (`src/index.ts`) that validates config, loads wallet,
  connects RPC, and prints balance + current slot
- Vitest test runner configured with a smoke test

## Out of scope

- Yellowstone gRPC streams (Phase 2)
- Leader schedule or leader-window logic (Phase 3)
- Yellowstone transaction-confirmation stream (Phase 4)
- Jito tip-floor data or tip account fetching (Phase 5)
- Any Jito bundle construction or submission (Phase 6+)
- Lifecycle tracker beyond its type definition (Phase 7+)
- Failure classification logic beyond the enum (Phase 8+)
- Retry logic (Phase 9+)
- AI agent (Phase 10+)
- README content or architecture document (Phases 13-14)
- CI pipeline (deferred)

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Package name | `valence` | Project name per mission.md; short, npm-publishable if desired |
| Test runner | Vitest | Fast native TS support, Solana ecosystem convention, zero-config with `tsx` |
| Module root | `src/` | Standard TS layout |
| Source modules | `src/types/`, `src/config/`, `src/wallet/`, `src/rpc/`, `src/lifecycle/`, `src/jito/`, `src/yellowstone/`, `src/agent/`, `src/log/` | Mirrors the component decomposition in roadmap.md and tech-stack.md; modules without implementation get a barrel `index.ts` or a placeholder |
| Entrypoint | `src/index.ts` | Single entry for the whole stack; extended by later phases, not replaced |
| Config lib | `dotenv` + hand-rolled validation | No need for a heavier config framework at this scope; tech-stack.md lists `dotenv` as a utility |
| Solana SDK | `@solana/web3.js` | tech-stack.md lists it as the primary path; `@solana/kit` is deferred if time allows |
| Keypair source | `PRIVATE_KEY` env var (base58) or `KEYPAIR_FILE` env var (filesystem path) | Standard Solana practice; base58 is the most portable format across tools |
| Commitment for Phase 1 calls | `confirmed` for `getLatestBlockhash` and `getBalance`, `processed` for `getSlot` | Per tech-stack.md's commitment level strategy: blockhashes need recency not finality, balance needs reliability, slot needs speed |

## Context references

- `specs/mission.md` — project identity, design principles, locked decisions,
  risk posture
- `specs/roadmap.md` — dependency order among phases, verification culture
- `specs/tech-stack.md` — concrete tool/library choices, endpoint URLs,
  commitment level reasoning, configuration approach
- `bounty.md` — final submission requirements that this skeleton exists to
  support

## Dependencies

- Node.js LTS (v20+ or v22+)
- npm
- A Solana mainnet RPC endpoint (public or Solinfra)
- A funded mainnet wallet (small SOL balance for Phase 1 balance check;
  actual spend comes later)
