# Requirements — Leader Schedule + Leader-Window Detection

## Feature summary

Pull the Solana leader schedule from RPC, cross-reference it against the live
slot stream from Phase 2, and emit structured events when a Jito-Solana
leader's slot is approaching. This becomes the submission-timing heartbeat
for all later phases — the system should never submit a bundle without first
confirming a Jito leader window is open or imminent.

Once this feature is merged, the system should be able to run alongside the
Phase 2 slot stream and log upcoming leader slots in real time, annotated
with whether the leader runs Jito-Solana, a countdown in seconds until the
leader slot, and a heartbeat line every slot showing the next Jito window.

## In scope

- Fetch the full leader schedule via `getLeaderSchedule` RPC call
- Persist the schedule in memory and update it when it changes at epoch
  boundaries
- Cross-reference the live slot stream against the schedule to detect when
  a specific leader's slot is coming up
- Compute a dynamic detection horizon based on observed slot time (roughly
  the number of slots expected in the next ~60 seconds)
- Auto-resolve Jito-Solana validator identity keys by querying the Kobe API
  (`https://kobe.mainnet.jito.network/api/v1/validators`) and cross-referencing
  vote accounts against `getVoteAccounts` RPC to obtain identity pubkeys
- Support an optional `JITO_VALIDATOR_KEYS` env var to supplement or override
  the auto-fetched list
- Annotate each leader entry with whether it is a known Jito-Solana validator
- Emit typed `EventEmitter` events:
  - `leaderDetected` — a leader slot is within the detection horizon
  - `leaderEntered` — the leader's slot has arrived
  - `leaderPassed` — the leader's slot has elapsed
- Periodic heartbeat log line on every slot showing: current slot, next Jito
  leader, countdown in seconds
- Unit tests for schedule parsing, horizon computation, and Jito-validator
  matching
- Config env vars for Jito validator identity key overrides

## Out of scope

- Any Yellowstone stream beyond `slots` (already done in Phase 2 —
  `transactions` and `blocksMeta` are Phase 4)
- Jito bundle construction or submission (Phase 6+)
- Tip intelligence or agent reasoning (Phase 10+)
- Any lifecycle tracking (Phase 4+)
- Persistent storage or logging beyond stdout (Phase 7+)

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Leader schedule source | `getLeaderSchedule` RPC | Standard Solana RPC method, no extra dependency; schedule is deterministic per epoch |
| Detection horizon | Dynamic, based on observed slot time | ~60s lookahead computed from actual slot duration observed by Phase 2 stream; adapts to real network conditions rather than a hardcoded constant |
| Jito validator identification | Auto-fetched from Kobe API + cross-referenced via `getVoteAccounts` RPC, with optional `JITO_VALIDATOR_KEYS` env var override | Avoids maintaining a hardcoded list that goes stale; Kobe API is Jito's canonical source of which validators run Jito-Solana; env var allows override or local testing without network access |
| Output | EventEmitter + per-slot heartbeat log line | Events for programmatic consumers (later phases), heartbeat for operator visibility; keeps the yellowstone module console.log-free |
| Leader annotation | All leaders logged with Jito flag | Simpler to implement; downstream code (Phase 6 submission logic) can filter however it wants without changing the detection module |

## Context references

- `specs/mission.md` — "real infrastructure" design principle, scope boundaries
- `specs/roadmap.md` — Phase 3 description and verification gate
- `specs/tech-stack.md` — leader schedule section (`getLeaderSchedule`),
  Yellowstone subscriptions, Jito integration points
- `specs/2026-06-22-slot-stream-infrastructure/requirements.md` — established
  spec conventions, config/env patterns, test infrastructure; Phase 2 slot
  stream is consumed by this phase

## Dependencies

- Node.js LTS (v20+ or v22+)
- Phase 2 complete and merged (slot stream must be running for
  cross-referencing)
- Solana mainnet RPC for leader schedule calls and vote account queries
- Kobe API (`https://kobe.mainnet.jito.network`) for Jito validator list
  (in-cluster fallback if unavailable)
