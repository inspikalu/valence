# Requirements — Yellowstone gRPC Slot Stream

## Feature summary

Connect to Yellowstone gRPC (Solinfra or any compatible provider), subscribe
to live slot updates, and prove the stream is reliable by running
uninterrupted for minutes at a time and auto-recovering from disconnections
with exponential + jitter backoff. Also includes a lightweight latency
comparison against RPC `getSlot` polling to validate that gRPC streaming is
providing value over vanilla RPC.

Once this feature is merged, the system should be able to stream live Solana
slot numbers indefinitely, survive network blips, and produce a running
latency delta against RPC polling that the operator can observe.

## In scope

- Yellowstone gRPC client wrapper (`@triton-one/yellowstone-grpc`)
- Slot subscription handler with typed event emission
- Reconnect logic with exponential + jitter backoff
- `fromSlot` replay on reconnect to backfill gaps
- Latency measurement: gRPC slot arrival time vs RPC `getSlot("processed")`
- Config integration: `YELLOWSTONE_ENDPOINT`, `YELLOWSTONE_GRPC_TOKEN` env vars
- Entrypoint integration: start subscription on boot, clean shutdown
- Unit tests for the reconnect backoff and latency modules
- Manual smoke test (mainnet, read-only, ≥5 minutes continuous or recovered)

## Out of scope

- Leader schedule or leader-window detection (Phase 3)
- Yellowstone `transactions` subscription (Phase 4)
- Yellowstone `blocksMeta` subscription (deferred — only `slots` this phase)
- Any Yellowstone stream beyond raw slot numbers
- Jito tip-floor data or tip account fetching (Phase 5)
- Any Jito bundle construction or submission (Phase 6+)
- Lifecycle tracker beyond awareness of the slot stream (Phase 4+)
- Failure classification logic (Phase 8+)
- Retry logic (Phase 9+)
- AI agent (Phase 10+)
- Persistent storage or logging beyond stdout (Phase 7+)

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Yellowstone provider | Configurable via env var (`YELLOWSTONE_ENDPOINT`), defaults to Solinfra mainnet | tech-stack.md lists Solinfra as the primary provider but documents that the protocol is standardized — making it configurable avoids blocking on credentials while keeping the system portable |
| gRPC SDK | `@triton-one/yellowstone-grpc` | The reference TypeScript client, documented by Solinfra and most providers |
| Commitment for slot subscription | `processed` | per tech-stack.md: earliest signal, used for visibility only; client-side commitment tracking independently re-derives `confirmed`/`finalized` |
| Backoff strategy | Exponential (1s base, 2x multiplier, 30s cap) + uniform random ±25% jitter | Chosen to avoid thundering herd on provider reconnect (relevant if this runs alongside other stream consumers) while giving the operator bounded worst-case recovery time |
| `fromSlot` replay | Track max slot received, request replay from `lastSlot + 1` on reconnect | Prevents silent gaps in the slot sequence; providers typically buffer ~3000 slots / ~20 min |
| Latency measurement | Compare gRPC receipt timestamp vs RPC `getSlot` wall-clock time, every Nth slot (default 10) | The delta is an upper bound, not a precise measurement, but it's good enough to sanity-check that gRPC is actually faster than polling; the sample interval avoids rate-limit issues with public RPC |
| Stream output | Log every Nth slot to stdout, not every slot | Every-Solana-slot (~400ms) would be noise; logging every 10th gives the operator a heartbeat without drowning the terminal |
| Clean shutdown | `SIGINT`/`SIGTERM` handler calls `disconnect()` on the gRPC client | Prevents zombie gRPC connections; essential for local dev ergonomics |

## Context references

- `specs/mission.md` — "real infrastructure" design principle, scope boundaries
- `specs/roadmap.md` — Phase 2 description and verification gate
- `specs/tech-stack.md` — Yellowstone gRPC section (provider, SDK, subscriptions,
  commitment, reconnection with `fromSlot` replay)
- `specs/2026-06-22-project-skeleton/requirements.md` — established spec
  conventions, config/env patterns, test infrastructure

## Dependencies

- Node.js LTS (v20+ or v22+)
- npm
- Yellowstone-compatible gRPC endpoint (Solinfra mainnet or fallback provider)
- Previous feature phases complete (project skeleton + RPC plumbing) — the
  config, wallet, and RPC modules from those phases are used by this feature
- `@triton-one/yellowstone-grpc` npm package (to be installed in this phase)
