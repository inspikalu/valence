# Plan — First Real Jito Bundle (Mainnet, Smallest Possible Spend)

> Covers roadmap Phase 6. Builds and submits a minimal single-transaction bundle
> to mainnet with a **hardcoded minimum tip** (1000 lamports) — deliberately
> not using the AI agent yet, to isolate "does bundle submission work at all"
> from "does the agent work." This is the single most important checkpoint in
> the entire roadmap.
> Current date: June 24, 2026. Submission deadline: June 29, 2026.

---

## Task group 1 — Bundle construction (self-transfer/memo)

1. Implement `src/jito/bundle.ts`:
   - `buildSelfTransferBundle(wallet, tipAccount, blockhash): Transaction[]`
     — constructs a bundle containing **two** transactions:
     1. A minimal self-transfer (0 SOL, the wallet pays itself) with a compute
        budget instruction (microLamports per CU, minimal) so the tx is valid.
     2. A second transaction containing only the **tip instruction** to the
        chosen `tipAccount` for exactly **1000 lamports** (Jito's protocol
        floor), with no other instructions — per Jito's convention the tip goes
        in the **last** transaction of the bundle and the tip tx has the tip
        account as its sole recipient.
   - Accept the `blockhash` as a parameter (fetched externally, not inside the
     builder — keeps the builder pure and testable).
   - Return both serialized + signed transactions as a pair ready for
     `sendBundle`.

2. Decide build approach for the tip transaction:
   - Use `@solana/web3.js` `Transaction` + `SystemProgram.transfer` for both
     the self-transfer and the tip.
   - The self-transfer uses `fromPubkey` == `toPubkey` == wallet's public key.
   - The tip transaction uses `fromPubkey` == wallet's public key, `toPubkey`
     == `tipAccount`.
   - Sign both transactions with the wallet keypair.

3. Handle serialization:
   - `serialize()` each transaction (versioned or legacy — test what `sendBundle`
     accepts, starting with legacy since it is the safest baseline).
   - Return `{ bundle: number[][] /* base58-encoded signatures for logging */ }`.

## Task group 2 — Bundle submission client

1. Implement `src/jito/submission.ts`:
   - `submitBundle(blockEngineUrl, bundleTxs): Promise<string>` — JSON-RPC POST
     to `https://mainnet.block-engine.jito.wtf/api/v1/bundles` with method
     `sendBundle` and the two serialized transactions.
   - Parse the response: on success returns a **bundle ID** (string). On failure
     throw/return a typed error with the JSON-RPC error payload.
   - If `jito-ts` is unevaluated: this is where we decide. Start with a raw
     JSON-RPC call (the wire format is simple — an array of base64-encoded
     transactions). Add the `jito-ts` SDK only if raw calls show issues with
     serialization, signing, or endpoint compatibility. (Rationale: we already
     have a hand-rolled pattern from Phase 5's `getTipAccounts`; consistency
     keeps the dependency surface lean.)

2. Implement `src/jito/bundleStatus.ts`:
   - `getBundleStatuses(blockEngineUrl, bundleId): Promise<BundleStatusResult>`
     — JSON-RPC call with method `getBundleStatuses`.
   - `getInflightBundleStatuses(blockEngineUrl): Promise<InflightBundleStatusResult>`
     — JSON-RPC call for real-time inflight status between submission and
     finalization.
   - Parse the response: extract slot numbers, timestamps, commitment level,
     and any error payload. Map into typed return values.

## Task group 3 — Wire submission into the Phase 4 lifecycle tracker

1. Review `src/lifecycle/` from Phase 4 to understand the existing tracker
   interface. The tracker already observes signatures via the Yellowstone gRPC
   `transactions` stream (filtered to the wallet's account).

2. Add a `submitted` stage trigger to the tracker:
   - After `submitBundle` returns a bundle ID, call
     `tracker.recordSubmitted(bundleId, bundleTxSignatures, tipAmount)` so the
     tracker records slot + timestamp for the submission event.

3. Ensure the tracker already handles `processed`, `confirmed`, `finalized`
   via the existing gRPC stream observation (Phase 4 wired this for individual
   transactions — verify it works for bundle transactions too, or extend it).

4. Add the `getBundleStatuses` / `getInflightBundleStatuses` path as a
   complementary observation mechanism:
   - After submission, poll `getBundleStatuses` on a short interval (respecting
     the 1 req/sec rate limit) until the bundle is no longer inflight.
   - Record `processed`/`confirmed`/`finalized` slot + timestamp from each
     status response.
   - Compare against gRPC-observed data for cross-validation.

## Task group 4 — Entrypoint orchestration

1. Add a `--send-bundle` CLI flag or `SEND_BUNDLE` env var (matching the
   existing pattern in `src/config/env.ts`):
   - Default: `false` — the system boots as it did before (Yellowstone streams
     only, no spend).
   - When `true`: after the Yellowstone streams and tip data are initialized,
     construct the bundle, submit it, and track it through its lifecycle.

2. In `src/index.ts`, behind the flag:
   - Fetch a fresh blockhash at `processed` commitment (per tech-stack.md:
     never use `finalized` blockhash for time-sensitive transactions).
   - Build the bundle via `buildSelfTransferBundle`.
   - Submit via `submitBundle`.
   - Record `submitted` stage.
   - Poll `getBundleStatuses` (rate-limited) until the bundle is finalized or
     fails.
   - Print a summary line with slot numbers, timestamps, and the bundle ID.

3. Log the full lifecycle entry to stdout in the same structured format the
   Phase 7 JSON Lines file will use (so Phase 7 is just "write to file instead
   of (or in addition to) stdout").

4. Keep the Yellowstone slot stream + gRPC transaction filter running during
   the submission to capture the bundle's transactions via stream as well.

## Task group 5 — Config and env

1. Add to `src/types/config.ts` and `src/config/env.ts`:
   - `SEND_BUNDLE` (boolean, default false) — trigger flag.
   - `JITO_BLOCK_ENGINE_URL` (already exists from Phase 5 — re-verify).
   - `BUNDLE_TIP_LAMPORTS` (number, default 1000) — hardcoded minimum tip for
     Phase 6; will be replaced by agent decision in Phase 10.

2. Update `.env.example` with the new vars, matching existing style.

## Task group 6 — Tests

1. `tests/unit/jito/bundle.test.ts` — 3+ cases:
   - `buildSelfTransferBundle` returns two transactions with correct structure
     (self-transfer tx + tip tx).
   - The tip transaction has exactly 1000 lamports to the tip account.
   - Both transactions are signed and serialize without error.

2. `tests/unit/jito/submission.test.ts` — 2+ cases:
   - `submitBundle` POSTs to the correct endpoint with the expected JSON-RPC
     body shape.
   - Parses a successful response into a bundle ID string.

3. `tests/unit/jito/bundleStatus.test.ts` — 2+ cases:
   - `getBundleStatuses` parses a mocked status response into typed fields.
   - `getInflightBundleStatuses` similarly.

## Task group 7 — Verify + docs

1. Run `npm run typecheck`, `npm run build`, `npm test` — all green.

2. **Live mainnet submission** (the primary checkpoint):
   - Run the entrypoint with `SEND_BUNDLE=true` against real mainnet endpoints.
   - Confirm bundle ID is returned by `sendBundle`.
   - Confirm `getBundleStatuses` returns the bundle and produces lifecyle data.
   - Look up the bundle on a Jito explorer / Solana explorer to confirm it
     landed at the slot/timestamp the tracker logged.
   - Capture the complete lifecycle output as proof.

3. Tick the Phase 6 checkbox in `specs/roadmap.md` and mark this spec's
   validation document complete.
