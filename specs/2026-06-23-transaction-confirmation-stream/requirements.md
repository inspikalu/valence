# Requirements — Yellowstone Transaction-Confirmation Stream

## Feature summary

Subscribe to Yellowstone's `transactions` and `transactionsStatus` feeds,
scoped to the wallet's own account, so the system can observe its own
transactions landing via stream rather than polling RPC. Wire this into a
basic in-memory lifecycle tracker that records slot + timestamp at each
commitment level a watched signature appears at.

This is the first phase that involves a mainnet spend (a trivial network
fee for a simple self-transfer), used to verify the stream-based tracking
works end-to-end before bundle submission begins in Phase 6.

Once this feature is merged, the system should be able to:
- Subscribe to Yellowstone `transactions` filtered to the wallet's account
  and receive real-time `transactionsStatus` updates as commitment advances
- Track a set of watched signatures in memory, recording the slot + timestamp
  at which each signature appeared at each observed commitment level
- Send a single ordinary (non-Jito) mainnet transaction and confirm the
  stream-based tracker observes and timestamps it correctly

## In scope

- Yellowstone `transactions` / `transactionsStatus` subscription: build a
  `SubscribeRequestFilterTransactions` scoped to the wallet's pubkey
  (`accountInclude`), excluding votes (`vote: false`). The `failed` field is
  intentionally NOT set — in Yellowstone's semantics, `failed: true` restricts
  to ONLY failed transactions, while leaving it unset returns both success and
  failed (which is the intended behavior).
- Combined filter approach: slots + transactions filter + commitment are set in
  a single `SubscribeRequest.create()` call during `connect()`. The original
  "additive" approach (writing a second message to the duplex stream) was
  abandoned because protobuf `map<string, SubscribeRequestFilter>` fields aren't
  mutable after `create()` returns — a combined request is the only reliable way
  to include the transactions filter.
- `setWalletPubkey(pubkey)` method on `YellowstoneConnection` stores the pubkey
  before `connect()`, where it's woven into the combined `SubscribeRequest`
- Parse incoming `SubscribeUpdateTransaction` and
  `SubscribeUpdateTransactionStatus` payloads into typed TS interfaces
- In-memory lifecycle tracker: `Map<signature, {slot, timestamp, commitment}>`
  that records each observation as updates arrive from the stream
- Logging: every observed transaction update printed to console with
  signature, slot, and status
- A mechanism to send a simple self-transfer transaction for manual
  verification (env-gated or script)
- Unit tests for filter building, parsing, and tracker logic
- Manual mainnet verification: send a 0-SOL self-transfer and confirm the
  stream logs it with correct slot number, cross-checked against explorer

## Out of scope

- Full four-stage lifecycle logging (submitted/processed/confirmed/finalized
  with latency deltas — belongs in Phase 7)
- Jito bundle construction or submission (Phase 6+)
- Jito tip data (Phase 5)
- Failure classification or retry logic (Phase 8+)
- AI agent integration (Phase 10+)
- Persistence to the JSON Lines lifecycle log file (Phase 7)

## Decisions

| Decision | Choice | Rationale |
|---|---|---|---|
| Subscription approach | Combined — slots + transactions in a single `SubscribeRequest.create()` | Protobuf `map<string, SubscribeRequestFilter>` fields aren't mutable after `create()`. Setting `request.transactions = {...}` after construction has no effect — the field is omitted from the serialized message. A combined request at `connect()` time is the only reliable approach. |
| Tracker depth | `Map<signature, {slot, timestamp, commitment}>` in a dedicated module | ~20 lines today, gives Phase 7 a clean foundation to extend to the full four-stage tracker rather than replacing from scratch |
| Transaction filter scope | `accountInclude: [walletPubkey]`, `vote: false`, `failed` NOT set | `vote: false` excludes validator vote transactions (too noisy). `failed` is intentionally **not set** — Yellowstone's `failed: true` restricts to ONLY failed transactions, while unset returns both success and failed (correct behavior). Discovered empirically during testing. |
| Commitment tracking | Client-side re-derivation from stream events | Per tech-stack.md: "lifecycle tracker independently re-derives confirmed/finalized state rather than trusting gRPC's buffered delivery" — stream gives us PROCESSED-level updates earliest, we track progress ourselves |
| Transaction type | 0-SOL self-transfer | Simplest possible mainnet spend — only pays the base fee (~5000 lamports), no program instructions, no risk of side effects |
| Wallet funding | 0.01 SOL prerequisite noted in validation | Enough for base fees across all Phase 4 manual checks; excess carries forward to Phase 6+ |

## Context references

- `specs/mission.md` — "real infrastructure" design principle; stream-based
  tracking avoids polling-only confirmation per bounty requirements
- `specs/roadmap.md` — Phase 4 description, dependency order
- `specs/tech-stack.md` — Yellowstone subscriptions section (`transactions`
  filter, commitment strategy, reconnection with `fromSlot` replay)
- Phase 2 slot stream (`specs/2026-06-22-slot-stream-infrastructure/`) —
  existing Yellowstone connection this phase extends
- Phase 3 leader detection (`specs/2026-06-22-leader-stream-integration/`) —
  leader schedule already wired; transaction subscription runs alongside

## Dependencies

- Phase 0 (project skeleton) — TypeScript project builds and passes checks
- Phase 1 (RPC plumbing) — `Connection` instance for RPC calls
- Phase 2 (slot stream) — live Yellowstone connection with reconnect
- Phase 3 (leader detection) — slot stream cross-referencing continues
  unaffected; no code dependency but both share the Yellowstone connection
- Node.js LTS, npm
- A Solana mainnet RPC endpoint
- A Yellowstone gRPC endpoint
- A funded wallet with ≥0.01 SOL for the manual verification transaction
