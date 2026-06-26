# Plan — README Q&A, Architecture Doc, Final Pass

## Task group 1 — README: three required Q&As

1. Locate the Phase 12 lifecycle log at `lifecycle/log.jsonl`. If the live
   mainnet run hasn't happened yet, document `{{LIFECYCLE_LOG_PATH}}`.
2. Extract `submitted`, `processed`, `confirmed`, `finalized` timestamps
   for each bundle entry.
3. Answer **Q1 (processed→confirmed delta)**:
   - Compute `confirmed_timestamp - processed_timestamp` for each bundle
     that reached confirmed.
   - Report min, max, median across submissions. Explain any outliers
     (e.g. a bundle that went via fallback `sendTransaction`).
4. Answer **Q2 (readiness checks)**:
   - List pre-flight checks: balance ≥ fee + tip, blockhash within
     `lastValidBlockHeight`, simulation passes, tip ≥ 1000 lamports,
     tip ≤ `maxTipLamports`, tip account is from `getTipAccounts`.
   - Show the actual console output lines from a real run as evidence.
5. Answer **Q3 (finalized-commitment blockhash tradeoff)**:
   - Explain blockhash expiry window (~150 slots / ~60-90s).
   - Cite the `INTENTIONAL_EXPIRY=true` failure from Phase 8/12 where a
     finalized-commitment blockhash caused an `expired_blockhash` failure.
   - Include the lifecycle log entry for that failure as evidence.
6. Use `{{PLACEHOLDER}}` tokens for any concrete slot numbers, timestamps,
   or deltas that depend on the live mainnet run.

## Task group 2 — README: setup, tradeoffs, lessons

1. Write **Setup instructions** in `README.md`:
   - Prerequisites: Node.js 20+, Solana CLI (optional), funded mainnet
     wallet.
   - `git clone`, `npm install`, copy `.env.example` to `.env`, fill in
     `RPC_URL` and keypair source.
   - Run: `npm run dev` (tsx watch) or `npm run build && npm start`.
   - Environment variables table with descriptions and defaults.
   - "What to expect" section: console output walkthrough.
2. Write **Tradeoffs** section:
   - Mainnet-only (devnet Block Engine unreliable, explorer verification
     requires mainnet).
   - Tip Intelligence mode over other agent modes (clearest measurable
     decision, real data feed).
   - TypeScript over Rust (faster path to working system, SDK maturity).
   - Groq over OpenRouter (latency on hot path).
   - No BAM / no ShredStream / no multi-wallet.
3. Write **Lessons learned** section:
   - Yellowstone gRPC filter semantics (verified empirically — documented
     in `tech-stack.md`).
   - sendBundle vs sendTransaction dual strategy (Block Engine returned
     "Invalid" for bundles; fallback to sendTransaction saved the run).
   - Rate limits: Jito Block Engine 1 req/s/IP; tip stream REST backstop
     needed.
   - Intentional expiry deterministically produces the right failure
     classification — worth building early.

## Task group 3 — Architecture document (Google Docs)

1. Create a public Google Doc with:
   - Title: "Valence — Smart Transaction Stack Architecture"
   - Share setting: "Anyone with the link can view" (no sign-in required).
2. **System overview** block diagram (text or embedded image):
   - Boxes: Yellowstone gRPC, Tip Floor Store, Leader Detector, Bundle
     Builder, Jito Block Engine, Lifecycle Tracker, Failure Classifier,
     Retry Loop, Groq Agent.
   - Arrows showing data flow between components.
3. **Component descriptions**:
   - YellowstoneConnection — slot stream + transaction subscription with
     auto-reconnect.
   - LeaderWindowDetector — real-time leader detection from slot stream.
   - BuildSelfTransferBundle — 2-tx bundle (self-transfer + tip).
   - SignatureTracker — in-memory event reconstruction across 4 stages.
   - FailureClassifier — maps error payloads to 5 classifications.
   - RetryBundleSubmission — agent-decided retry with fresh parameters.
   - callTipAgent / callRetryAgent — Groq tool-use for tip + retry decisions.
4. **Sequence diagram** (text or image):
   - Happy path: submit → inflight poll → Landed → poll processed → poll
     finalized → log entry.
   - Failure path: submit → not landed → fallback sendTransaction → never
     observed → expired_blockhash → retry agent → fresh bundle → land.
5. **Infrastructure decisions** table (copy from README tradeoffs).
6. **Security and risk** section:
   - Tip clamped server-side (agent doesn't control spend).
   - Keypair loaded from env or file, never hardcoded.
   - `INTENTIONAL_EXPIRY` is env-gated, not triggerable from agent.
7. Link the doc from `README.md` once created.

## Task group 4 — Secrets archaeology and git hygiene

1. Run `git log --all -p -S "PRIVATE_KEY"` — confirm zero matches.
2. Run `git log --all -p -S "gsk_"` — confirm zero Groq key leaks.
3. Run `git log --all -p -S ".env"` — confirm no `.env` committed.
4. Check `.gitignore` covers: `node_modules/`, `dist/`, `.env`, `logs/`,
   `*.log`, `.env.local`, `.env.*.local`.
5. Check no `.env` file is tracked by git (`git ls-files .env`).
6. Verify `tests/` don't contain real keys (only test mocks/fakes).
7. Run `npm run typecheck && npm run build && npm test` — all green.

## Task group 5 — Final review pass

1. Read the entire repo from `README.md` through every source file as if
   you were a judge seeing it for the first time.
2. Check for:
   - Dead code or commented-out blocks.
   - Missing error handling at public boundaries.
   - Inconsistent naming or style.
   - Missing exports or re-exports from `index.ts` barrel files.
3. Verify the lifecycle log file is included in the repo
   (`lifecycle/log.jsonl` exists and has ≥10 entries).
4. Confirm the architecture doc link works from the README.
5. Run one final `npm run typecheck && npm run build && npm test`.

## Task group 6 — Tick roadmap

1. Update `specs/roadmap.md`:
   - Mark Phase 13 checkboxes complete.
   - Mark Phase 14 checkboxes complete (or partially).
   - Mark Phase 15 checkboxes complete.
