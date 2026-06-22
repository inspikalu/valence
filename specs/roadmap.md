# Roadmap

Small phases, in dependency order. Each phase should produce something that
runs and can be checked before moving to the next — no phase should require
trusting that an earlier, unverified phase works correctly. Mainnet-touching
phases are flagged explicitly so real-money risk is never accidental.

Deadline context: submission due June 29, 2026. This roadmap assumes work
starts close to now (current date in this conversation: June 20, 2026), so
phases are intentionally thin — each one is a single sitting of work, not a
multi-day arc.

---

## Phase 0 — Project skeleton (no network calls) ✅

- [x] Init TypeScript project, tsconfig, package.json, basic folder layout
  (`src/lifecycle`, `src/jito`, `src/yellowstone`, `src/agent`, `src/log`).
- [x] Define the lifecycle log entry shape (TypeScript types) per tech-stack.md.
- [x] Define the failure classification enum (expired blockhash, fee too low,
  compute exceeded, bundle failure).
- [x] **Check**: project builds and runs an empty entrypoint. No external calls
  yet.

## Phase 1 — Wallet and RPC plumbing (mainnet reads only, no spend) ✅

- [x] Load a keypair from env/file (never committed).
- [x] Connect to a standard Solana mainnet RPC (read-only calls only this
  phase): `getBalance`, `getLatestBlockhash`, `getSlot`.
- [x] **Check**: can print the wallet's current SOL balance and current slot.
  This is also the moment to confirm the wallet has enough SOL funded for
  the planned ~10+ tiny-tip submissions plus normal transaction fees.

## Phase 2 — Yellowstone gRPC slot stream (mainnet, read-only)

- Connect to Yellowstone (Solinfra or fallback provider) and subscribe to
  `slots`.
- Print incoming slot numbers as they arrive; measure rough delivery
  latency against RPC `getSlot` polling as a sanity check.
- Implement basic reconnect-with-backoff so a dropped stream doesn't kill
  the process.
- **Check**: stream runs for several minutes uninterrupted (or recovers
  automatically from a manually-killed connection) and produces a strictly
  increasing slot sequence.

## Phase 3 — Leader schedule + leader-window detection

- Pull leader schedule / next-leader info from RPC, cross-reference against
  the live slot stream from Phase 2.
- Implement "is a Jito-Solana leader's slot coming up within N slots"
  detection logic (this becomes the submission-timing signal, independent
  of the AI agent).
- **Check**: logs correctly identify upcoming leader slots in real time,
  verifiable by eye against a public Solana explorer's recent-leader view.

## Phase 4 — Yellowstone transaction-confirmation stream

- Add a `transactions` filter subscription scoped to the wallet's own
  account, so the system can observe its own transactions landing via
  stream rather than polling.
- Wire this into a basic in-memory lifecycle tracker: when a watched
  signature appears in the stream, record slot + timestamp for whichever
  commitment level it appeared at.
- **Check**: manually send one ordinary (non-Jito) mainnet transaction and
  confirm the stream-based tracker observes and timestamps it correctly,
  cross-checked against the explorer. *(This is the first mainnet spend —
  trivial network fee only, no Jito tip yet.)*

## Phase 5 — Jito tip-floor data + tip account fetching

- Implement the `tip_floor` REST call and parse percentile data.
- Implement `getTipAccounts` and the random/round-robin selection logic.
- No bundle submission yet — just prove the data pipeline that later
  phases (and the agent) will depend on.
- **Check**: prints live percentile tip data and a valid tip account list;
  re-running shows the percentiles changing over time (proof it's live,
  not cached/stale).

## Phase 6 — First real Jito bundle (mainnet, smallest possible spend)

- Construct a minimal single-transaction bundle (e.g. a self-transfer or
  memo instruction) with a tip instruction in the last transaction, using a
  **hardcoded minimum tip** (1000 lamports) — deliberately not using the
  agent yet, to isolate "does bundle submission work at all" from "does the
  agent work."
- Submit via `sendBundle`, track via `getBundleStatuses` /
  `getInflightBundleStatuses`.
- Wire this bundle's lifecycle into the Phase 4 tracker so it's logged with
  real slot numbers and timestamps end-to-end.
- **Check**: bundle lands on mainnet, is visible on a Jito/Solana explorer,
  and produces one complete, correct lifecycle log entry. This is the
  single most important checkpoint in the whole roadmap — if this doesn't
  work cleanly, no later phase matters.

## Phase 7 — Full lifecycle tracking across all four stages

- Extend the tracker from Phase 4/6 to explicitly capture all four stages
  (submitted, processed, confirmed, finalized) with timestamps, slot
  numbers, and computed latency deltas between each pair of stages.
- Persist entries to the JSON Lines log file from tech-stack.md.
- **Check**: one full bundle run produces a log entry with all four stages
  populated and sane (monotonically increasing slots/timestamps).

## Phase 8 — Failure classification (real + one intentional)

- Implement the classifier for: expired blockhash, fee too low, compute
  exceeded, bundle failure (using real error payloads from
  `getBundleStatuses`/`getInflightBundleStatuses` and Solana tx error
  codes).
- Implement the intentional blockhash-expiry trigger described in
  tech-stack.md (hold a signed tx past its valid window before sending).
- **Check**: running the intentional-expiry path produces a correctly
  classified failure log entry; the classifier doesn't crash the process,
  it logs and returns control cleanly.

## Phase 9 — Retry logic (hardcoded first, to de-risk Phase 10)

- Implement blockhash refresh + resubmit on detected expiry, as a plain
  hardcoded function — no AI yet. This phase exists purely to prove the
  *mechanics* of retry work before adding agent reasoning on top, so a bug
  in retry mechanics and a bug in agent reasoning are never debugged at the
  same time.
- **Check**: an intentionally-expired bundle is detected, blockhash is
  refreshed, and the bundle successfully resubmits and lands.

## Phase 10 — Tip Intelligence agent (Groq)

- Implement the Groq tool-use call: feed it recent tip-floor percentiles +
  current slot/leader context + bundle metadata, get back a structured
  `{ tip_lamports, reasoning }` response.
- Replace Phase 6's hardcoded minimum tip with the agent's decision,
  clamped server-side to [1000 lamports, mission.md ceiling].
- Log the reasoning string alongside the tip amount in every lifecycle
  entry from this point on.
- **Check**: several consecutive bundles show the agent choosing different
  tip amounts as tip-floor data changes, each with a distinct, sensible
  reasoning string (not a templated/identical response every time).

## Phase 11 — Connect retry to the agent (satisfy "no hardcoded retry flow")

- On a detected failure, instead of Phase 9's hardcoded retry, have the
  agent (or a second focused Groq call) reason over *why* it failed and
  decide what should change before resubmitting — at minimum, this should
  let the agent decide to adjust the tip on retry (e.g. bump toward a
  higher percentile after a bundle that didn't land), not just blindly
  refresh the blockhash and resend identically.
- **Check**: the intentional-failure path from Phase 8 now shows the
  agent's retry reasoning in the log, and the retried tip is visibly
  different from the original when conditions warrant it.

## Phase 12 — Volume run: produce the required lifecycle log

- Run the full pipeline for ≥10 real bundle submissions in one session,
  ensuring ≥2 are failures (the intentional blockhash-expiry case can
  account for one; a second can come from a deliberately low tip ceiling
  on one run, or a naturally-occurring auction loss).
- Export/clean the resulting log file as the bounty deliverable.
- **Check**: log file has ≥10 entries, ≥2 failures, every entry has slot
  numbers, timestamps, commitment progression, tip amount, and failure
  classification where relevant — spot-check 2-3 slot numbers against a
  public explorer manually before calling this done.

## Phase 13 — README questions, from real observations

- Write the three required README answers using actual numbers/behavior
  pulled from the Phase 12 log (e.g. real observed processed→confirmed
  deltas), not generic textbook answers.
- Write setup instructions, tradeoffs, and lessons learned sections.
- **Check**: every claim in the README about system behavior is traceable
  to something in the lifecycle log or a specific observed run.

## Phase 14 — Architecture document

- Write the public architecture doc (Notion/Google Docs) covering system
  architecture, components, data flow, infra decisions, failure handling
  strategy, and AI agent responsibilities, with at least one diagram
  (system overview) and one sequence-style diagram (bundle lifecycle from
  submission to finalized, including the failure/retry branch).
- **Check**: doc is reachable at a public URL with no auth required;
  someone with zero context on the repo could read it and understand the
  system's shape.

## Phase 15 — Final pass: cleanup, secrets check, submission packaging

- Confirm no private keys, API tokens, or `.env` values are committed.
- Confirm setup instructions work from a clean clone (or are at least
  precisely accurate if a clean-environment test isn't feasible in time).
- Link the architecture doc from the README; confirm the lifecycle log file
  is included in the repo.
- **Check**: repo is what a judge would actually receive — read it once
  fully from a fresh perspective before submitting.

---

## Sequencing notes

- Phases 0-5 touch no money and can be done quickly in any order internally,
  but are listed in the order that minimizes rework (skeleton → reads →
  streaming → leader logic → tracking plumbing → tip data).
- Phase 6 is the first real spend and the highest-leverage checkpoint in the
  roadmap — everything before it is in service of making Phase 6 work
  cleanly the first time, and everything after it is extension.
- The agent (Phase 10-11) is deliberately *after* the mechanical stack is
  proven (Phases 6-9), per mission.md's priority ordering: "Does It Work"
  and "Depth of Integration" outweigh "AI Demonstration" in judging, and a
  reliable mechanical stack is also a precondition for the agent having
  anything real to reason about.
- If time runs short before the deadline, Phase 11 (agent-driven retry) is
  the most defensible phase to compress — Phase 9's hardcoded retry plus a
  clear README note about the tradeoff is an honest fallback that still
  satisfies "failure handling is required," even if it weakens the
  Autonomous-Retry-style polish. Phases 12-15 (the actual deliverables) are
  not compressible — an incomplete log or missing architecture doc fails
  explicit, named requirements.
