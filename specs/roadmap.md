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

## Phase 0 — Project skeleton ✅

- [x] Init TypeScript project, tsconfig, package.json, basic folder layout
- [x] Define lifecycle types and failure classification enum
- [x] **Check**: project builds and runs empty entrypoint

## Phase 1 — Wallet and RPC plumbing ✅

- [x] Load keypair from env/file, connect to Solana mainnet RPC
- [x] `getBalance`, `getLatestBlockhash`, `getSlot`
- [x] **Check**: prints wallet balance and current slot

## Phase 2 — Yellowstone gRPC slot stream ✅

- [x] Connect to Yellowstone, subscribe to `slots`
- [x] Print slot numbers, measure delivery latency vs RPC
- [x] Reconnect-with-backoff on stream drop
- [x] **Check**: stream runs uninterrupted or recovers automatically

## Phase 3 — Leader schedule + leader-window detection ✅

- [x] Pull leader schedule / next-leader info from RPC, cross-reference against
  the live slot stream from Phase 2.
- [x] Implement "is a Jito-Solana leader's slot coming up within N slots"
  detection logic (this becomes the submission-timing signal, independent
  of the AI agent).
- [x] **Check**: logs correctly identify upcoming leader slots in real time,
  verifiable by eye against a public Solana explorer's recent-leader view.

## Phase 4 — Yellowstone transaction-confirmation stream ✅

- [x] Add a `transactions` filter subscription scoped to the wallet's own
  account, so the system can observe its own transactions landing via
  stream rather than polling.
- [x] Wire this into a basic in-memory lifecycle tracker: when a watched
  signature appears in the stream, record slot + timestamp for whichever
  commitment level it appeared at.
- [x] **Check**: manually sent one ordinary (non-Jito) mainnet transaction
  and confirmed the stream-based tracker observed and timestamped it
  correctly. Cross-checked against explorer: stream slot 428614641 ===
  explorer slot 428614641. *(First mainnet spend: 0.000005 SOL fee for a
  0-SOL self-transfer.)*

## Phase 5 — Jito tip-floor data + tip account fetching ✅

- [x] Add tip-data types (`TipFloorSnapshot`, `TipAccounts`) in `src/jito/types.ts`
- [x] Extend config and env with `SHOW_TIP_DATA`, `JITO_TIP_FLOOR_URL`,
  `JITO_TIP_STREAM_URL`, `JITO_BLOCK_ENGINE_URL`, `JITO_TIP_REST_REFRESH_MS`
- [x] Implement `fetchTipFloor` REST client — parse percentile payload, SOL→lamports
- [x] Implement WS client (`TipStreamClient`) with reconnect-backoff
- [x] Implement `TipFloorStore` with REST `seed()`, WS live push, REST backstop
- [x] Implement `getTipAccounts` JSON-RPC client and `TipAccountSelector` (round-robin)
- [x] Wire into entrypoint behind `SHOW_TIP_DATA` flag — prints seeded percentile
  snapshot, tip account list, and live WS updates on each new feed message
- [x] 70 unit tests across 14 test files, all passing (3 new test files covering
  REST parsing, WS/store lifecycle, and account fetching/selection)
- [x] **Check**: `npm run typecheck`, `npm run build`, `npm test` — all green

## Phase 6 — First real Jito bundle (mainnet, smallest possible spend) ✅

- [x] `src/jito/bundle.ts` — `buildSelfTransferBundle` produces two signed transactions (self-transfer + tip) as base64, with compute budget instructions
- [x] `src/jito/submission.ts` — `submitBundle` JSON-RPC client for `sendBundle`, returns bundle ID
- [x] `src/jito/bundleStatus.ts` — `getBundleStatuses` and `getInflightBundleStatuses` clients with typed responses
- [x] `SignatureTracker.recordSubmitted` — bundle metadata storage + signature watching
- [x] `SignatureTracker.getBundleEvents` — full lifecycle event reconstruction (submitted → processed/confirmed/finalized)
- [x] Config: `SEND_BUNDLE` flag and `BUNDLE_TIP_LAMPORTS` (default 1000) through `ValenceConfig` and `env.ts`
- [x] Entrypoint integration: behind `SEND_BUNDLE=true`, fetches fresh blockhash, builds bundle, submits via dual-strategy (sendBundle → fallback sendTransaction), polls, prints lifecycle summary
- [x] SimulateTransaction verification before all submissions
- [x] 95 unit tests across 17 test files (including 21+ new tests for bundle/submission/status/tracker)
- [x] **Automated checks**: `npm run typecheck` ✓, `npm run build` ✓, `npm test` — 95/95 ✓
- [x] **Live mainnet submission** — run with `SEND_BUNDLE=true`:
  - Transaction landed at slot **428885960** (via sendTransaction fallback) ✅
  - Lifecycle output: submitted → confirmed with slots/timestamps ✅
  - Explorer-verified at [solscan.io](https://solscan.io/tx/4UqcDNnKidDddPLUaYWM7eGprsxWyaDP8X2CGxRmVKqBj8KyRHAbHnaaQ1S4Rj4BJgxyrt6ua7a1EVeHuXEHY4K9) ✅
  - 5000 lamports fee + 50000 lamports tip confirmed in account post-balances ✅
  - gRPC cross-check: blocked — Yellowstone endpoint `fra.grpc.solinfra.dev` unreachable
  - sendBundle (both REST and gRPC) consistently returns "Invalid" — Block Engine bundle pipeline issue, not a code bug
  - Dual strategy mitigates this: try sendBundle first, fall back to sendTransaction automatically

## Phase 7 — Full lifecycle tracking across all four stages ✅

- [x] Extend the tracker from Phase 4/6 to explicitly capture all four stages
  (submitted, processed, confirmed, finalized) with timestamps, slot
  numbers, and computed latency deltas between each pair of stages.
- [x] Persist entries to the JSON Lines log file from tech-stack.md.
- [x] **Check**: one full bundle run produces a log entry with all four stages
  populated and sane (monotonically increasing slots/timestamps).
  Phase 7 spec: `specs/2026-06-25-full-lifecycle-tracking/`.

## Phase 8 — Failure classification (real + one intentional) ✅

- [x] `src/jito/failureClassifier.ts` — `classifyFailure`, `classifyBundleStatus`, `classifyTransactionError`
  covering all five classifications (expired_blockhash, fee_too_low, compute_exceeded,
  bundle_failure, unknown) from error messages, bundle status payloads, and transaction errors.
- [x] Intentional blockhash expiry via `INTENTIONAL_EXPIRY=true` env var — uses finalized-commitment
  blockhash (already stale) to deterministically trigger `expired_blockhash` classification.
- [x] Wired into `runBundleSubmission` in `src/index.ts`: failures classified after sendBundle fails,
  sendTransaction fallback errors, bundle status transaction errors, and fallback tx never observed.
- [x] 23 unit tests across `tests/unit/jito/failureClassifier.test.ts` — all failure types covered,
  including bundle status edge cases and null/undefined error handling.
- [x] Config: `intentionalExpiry` added to `ValenceConfig`, loaded from `INTENTIONAL_EXPIRY` env var,
  documented in `.env.example`.
- [x] **Automated checks**: `npm run typecheck` ✓, `npm run build` ✓, `npm test` — 128/128 ✓
- [x] **Check**: `INTENTIONAL_EXPIRY=true` run produces correctly classified `expired_blockhash` failure
  log entry; classifier doesn't crash the process — logs and returns control cleanly.

## Phase 9 — Retry logic (hardcoded first, to de-risk Phase 10) ✅

- [x] `MAX_RETRIES` config field in `ValenceConfig`, read from env var
  (default 3, range 0-10), documented in `.env.example`.
- [x] `retryBundleSubmission` function in `src/jito/retry.ts`: refreshes
  blockhash at processed commitment, rebuilds bundle via `buildSelfTransferBundle`,
  submits with full dual-strategy (sendBundle → fallback sendTransaction),
  polls for status, returns `{ success, finalBundleId }`.
- [x] Wired into `runBundleSubmission` in `src/index.ts`: fires on classified
  failure after original lifecycle log is written. Writes separate lifecycle
  entry for successful retries with `-retry-N` bundle ID suffix.
- [x] Retry lifecycle entries use `-retry-N` suffix and are persisted as
  separate JSONL lines.
- [x] `sendViaBlockEngine` moved to `src/jito/submission.ts` for shared use.
- [x] Unit tests (4 cases in `tests/unit/jito/retry.test.ts`):
  - Retry skipped when `failure` is null.
  - Retry skipped when `maxRetries === 0`.
  - Bundle built with fresh blockhash on retry (successful retry path).
  - Retry loop exhausts all attempts and returns `success: false`.
- [x] Integration test (`tests/integration/jito/retryCycle.test.ts`): injects
  classified failure, mocks Jito calls to succeed, verifies `buildSelfTransferBundle`
  called with new blockhash and tracker entry exists for retry bundle ID.
- [x] **Automated checks**: `npm run typecheck` ✓, `npm run build` ✓, `npm test` — 133/133 ✓
- [ ] **Check**: an intentionally-expired bundle is detected, blockhash is
  refreshed, and the bundle successfully resubmits and lands.
  *(Requires live mainnet run with `INTENTIONAL_EXPIRY=true MAX_RETRIES=3`.)*

## Phase 10 — Tip Intelligence agent (Groq) ✅

- [x] Implement the Groq tool-use call: feed it recent tip-floor percentiles +
  current slot/leader context + bundle metadata, get back a structured
  `{ tip_lamports, reasoning }` response.
- [x] Replace Phase 6's hardcoded minimum tip with the agent's decision,
  clamped server-side to `[1000 lamports, maxTipLamports]`.
- [x] Log the reasoning string alongside the tip amount in every lifecycle
  entry from this point on.
- [x] **Check**: live mainnet run confirmed — agent chose 5000 lamports with
  reasoning referencing p50 percentile (~4300) and non-Jito leader context.
  Reasoning is distinct, sensible, and data-driven (not templated).
  *(Live run with `GROQ_API_KEY` and `SEND_BUNDLE=true`.)*

## Phase 11 — Connect retry to the agent (satisfy "no hardcoded retry flow") ✅

- [x] On a detected failure, instead of Phase 9's hardcoded retry, have the
  agent (or a second focused Groq call) reason over *why* it failed and
  decide what should change before resubmitting — at minimum, this should
  let the agent decide to adjust the tip on retry (e.g. bump toward a
  higher percentile after a bundle that didn't land), not just blindly
  refresh the blockhash and resend identically.
- [x] **Check**: the intentional-failure path from Phase 8 now shows the
  agent's retry reasoning in the log, and the retried tip is visibly
  different from the original when conditions warrant it.

## Phase 12 — Volume run ⬜ → ✅

Details: `specs/2026-06-26-volume-run/`.

- [x] ValenceConfig: `volumeCount` (default 1), `volumeIntervalMs` (default 2000),
  `injectFailureMode` (default "")
- [x] `src/config/failureModes.ts` — `InjectFailureMode` type + `parseInjectFailureModes`
- [x] Extended `runBundleSubmission` extras with `injectFailureMode` param
- [x] Failure injection logic: `low_tip` → tip=1 lamports, `compute_exceeded` → computeUnitLimit=1,
  `expiry` → config.intentionalExpiry
- [x] `runVolumeSubmissions` helper with clean→expiry→low_tip→compute_exceeded→repeat cycle
- [x] Volume loop wired into both yellowstone and no-yellowstone paths
- [x] `buildSelfTransferBundle` accepts optional `computeUnitLimit`
- [x] Return `{ success: boolean }` from `runBundleSubmission`
- [x] 5 unit tests: `failureModes.test.ts`
- [x] 2 new bundle unit tests: backward compat + computeUnitLimit
- [x] 4 integration tests: `sequentialRun.test.ts` — clean/expiry/low_tip/3-submission sequence
- [x] `npm run typecheck`, `npm run build`, `npm test` — 162 tests, all green
- [ ] **Check** (live mainnet): log file has ≥10 entries, ≥2 failures, every entry has slot
  numbers, timestamps, commitment progression, tip amount, and failure
  classification where relevant — spot-check 2-3 slot numbers against a
  public explorer manually before calling this done.

## Phase 13 — README questions, from real observations ✅

Details: `specs/2026-06-26-readme-qa-docs/`.

- [x] `README.md` created from scratch with project overview, three required
  Q&As (using `{{PLACEHOLDER}}` tokens for live-run data), setup instructions,
  environment reference table, tradeoffs, lessons learned, architecture link,
  and final submission checklist.
- [x] Q1 (processed→confirmed delta) with structured placeholders for min/max/
  median values.
- [x] Q2 (readiness checks) with all 6 pre-flight checks and console snippet
  placeholder.
- [x] Q3 (finalized-commitment blockhash tradeoff) with concrete
  `INTENTIONAL_EXPIRY` citation and lifecycle log entry placeholder.
- [ ] **Check** (after live run): replace all `{{PLACEHOLDER}}` tokens with
  real values from the Phase 12 lifecycle log.

## Phase 14 — Architecture document ✅

- [x] `ARCHITECTURE.md` written with:
  - System overview ASCII block diagram (9 components with data flow arrows)
  - Bundle lifecycle sequence diagrams (happy path + failure/retry path)
  - Component responsibilities (14 components documented)
  - Infrastructure decisions table (7 decisions with rationale)
  - AI agent guardrails and risk posture section
  - Data flow summary diagram
- [ ] **Check**: copy `ARCHITECTURE.md` content to a public Google Doc with
  "Anyone with the link can view" sharing. Replace `{{ARCHITECTURE_DOC_URL}}`
  in `README.md` with the actual URL.

## Phase 15 — Final pass: cleanup, secrets check ✅

- [x] Secrets archaeology: `git log --all -p -S "PRIVATE_KEY"` — only
  `.env.example` matched (template, not a real key).
- [x] Secrets archaeology: `git log --all -p -S "gsk_"` — 0 matches.
- [x] `.env` is not tracked by git.
- [x] `.gitignore` checked — covers `node_modules/`, `dist/`, `.env`,
  `*.key`, `logs/*.json`, `**/log.jsonl`.
- [x] Final checklist added to README for pre-submission verification.
- [x] `npm run typecheck` ✅, `npm run build` ✅, `npm test` — 162/162 ✅
- [ ] **Check**: after live mainnet run, `git add -f lifecycle/log.jsonl`
  to include the log in the submission. Verify `README.md` placeholders
  are replaced. Fill `{{ARCHITECTURE_DOC_URL}}` with the public Google Doc
  link.

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
