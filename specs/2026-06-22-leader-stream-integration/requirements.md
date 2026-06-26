# Requirements — Leader Stream Integration + Tip Account Pre-fetch

## Feature summary

Pull the Solana leader schedule from RPC and cross-reference it against the live
Yellowstone slot stream (Phase 2) to detect when a Jito-Solana leader's slot is
approaching. This leader-window signal becomes the submission-timing trigger for
later phases. Also pre-fetch and cache tip accounts (normally Phase 5 work) to
reduce dependencies between phases and ensure tip-account plumbing is ready
before bundle construction begins.

Once this feature is merged, the system should be able to:
- Fetch and cache the leader schedule for the current epoch
- Cross-reference each incoming slot against the schedule to identify the
  producing leader
- Detect when a Jito-Solana leader's slot is within N slots of the current slot
  and emit a signal
- Fetch and cache the current tip account list from the Jito Block Engine

## In scope

- Leader schedule RPC integration: `getLeaderSchedule`/`getSlotLeaders`, parse,
  cache, refresh at epoch boundaries
- Yellowstone slot stream cross-reference: map each slot to its producing
  leader using the cached schedule
- Leader-window detection: given a configurable offset (in slots), detect when
  a Jito-Solana leader's slot is coming up
- Tip-account pre-fetch: `getTipAccounts` via RPC, random/round-robin selection
  logic per tech-stack.md
- Logging: upcoming leader windows, tip account count, slot-to-leader mapping
  in debug mode
- Unit tests for schedule parsing, window logic, tip-account selection
- Manual mainnet verification against a public explorer

## Out of scope

- Jito bundle construction or submission (Phase 6+)
- Yellowstone transaction-confirmation stream (Phase 4)
- Jito tip-floor percentile data (remainder of Phase 5, left for the dedicated
  phase)
- Lifecycle tracking beyond slot/leader mapping
- Failure classification
- Retry logic
- AI agent integration
- Any mainnet spend of any kind (Phase 6+)

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Leader schedule source | `getLeaderSchedule` RPC method | Standard Solana RPC, no provider dependency; returns schedule for the current epoch only, which is sufficient for leader-window detection within a single epoch |
| Cache strategy | In-memory, refresh on epoch boundary detected via slot progression | No database needed; epoch transitions are infrequent (~2 days); slot stream detects boundary naturally when the next slot falls outside the cached range |
| Window offset default | 10 slots | Approximates ~5 seconds of leader time at Solana's 400ms slot time; allows enough time for agent reasoning (Phase 10) and bundle submission before the leader slot arrives |
| Jito-leader detection | Match leader identity against known Jito-Solana validator identity(s) | Jito-Solana validators are publicly identifiable; the known identity list is hardcoded as a config constant, verifiable against current Jito-Solana operator docs |
| Tip-account selection strategy | Random per bundle | Simpler than round-robin and achieves the same write-lock distribution goal per Jito's guidance |
| Tip-account fetch timing | Once at startup, re-fetch on configurable interval | Accounts are static (8 accounts, rarely change); no need to fetch per-bundle |

## Context references

- `specs/mission.md` — leader-window detection feeds into "real infrastructure"
  design principle; the agent gets live slot/leader context
- `specs/roadmap.md` — Phase 3 description, dependency order, "Check" culture
- `specs/tech-stack.md` — `getLeaderSchedule`/`getSlotLeaders` RPC usage,
  tip account guidance, commitment level strategy
- Phase 2 slot stream (`specs/2026-06-22-slot-stream-infrastructure/`) — the
  Yellowstone stream this phase cross-references

## Dependencies

- Phase 0 (project skeleton) — the TypeScript project must build and pass checks
- Phase 1 (RPC plumbing) — `Connection` instance with `getLeaderSchedule` support
- Phase 2 (slot stream) — live Yellowstone slot subscription
- Node.js LTS, npm
- A Solana mainnet RPC endpoint
- A Yellowstone gRPC endpoint (from Phase 2) for the slot stream
