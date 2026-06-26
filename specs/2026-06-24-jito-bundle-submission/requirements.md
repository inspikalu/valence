# Requirements — First Real Jito Bundle (Mainnet, Smallest Possible Spend)

## Feature summary

Submit a minimal Jito bundle to mainnet with a **hardcoded minimum tip**
(1000 lamports) — no AI agent involved — and prove the full submission →
lifecycle-tracking pipeline works end-to-end. This is the highest-leverage
checkpoint in the roadmap: everything before it feeds this moment, and
everything after it is extension.

The bundle is a pair of transactions:
1. A self-transfer (0 SOL, the wallet pays itself) — this is the "payload."
2. A tip-only transaction sending exactly 1000 lamports to a Jito tip account.

The bundle is submitted via `sendBundle` to Jito's Block Engine, tracked via
`getBundleStatuses` / `getInflightBundleStatuses`, and cross-referenced against
the Yellowstone gRPC transaction stream (from Phase 4) and a public explorer.

## Why this phase exists (context from roadmap)

Phase 6 is deliberately before the AI agent because a bug in bundle mechanics
and a bug in agent reasoning must never be debugged simultaneously. If bundle
submission doesn't work with a hardcoded minimum tip, no amount of agent
sophistication will fix it. Conversely, if Phase 6 passes cleanly, every later
failure can be attributed to the agent layer or environment conditions, not the
bundle plumbing.

This is also the **first real mainnet spend** — the financial exposure is
bounded (1000 lamports per submission, ~0.000001 SOL at current prices), but
it is real. The system's cost posture (small wallet, bounded tips, mainnet-only)
proves itself here.

## In scope

- **Bundle construction** — a pure function that produces two signed
  transactions (self-transfer + tip) given a wallet keypair, a tip account
  pubkey, and a blockhash.
- **Bundle submission** — a thin JSON-RPC client that POSTs the serialized
  bundle to `https://mainnet.block-engine.jito.wtf/api/v1/bundles` via
  `sendBundle` and returns the bundle ID.
- **Bundle status polling** — `getBundleStatuses` and
  `getInflightBundleStatuses` clients that parse the response into typed
  lifecycle fields (slot, timestamp, commitment level, error payload).
- **Lifecycle integration** — wire the `submitted` stage into the Phase 4
  tracker, and cross-reference gRPC stream observations with bundle status
  responses.
- **Entrypoint trigger** — a `SEND_BUNDLE` flag (env var or CLI arg) that,
  when set, runs the full submission pipeline once at boot after the streams
  are initialized.
- **Hardcoded tip (1000 lamports)** — deliberately not using the agent. The
  tip constant is at `BUNDLE_TIP_LAMPORTS` in config, defaulting to 1000.
- **Stdout lifecycle summary** — a structured log line printed after the
  bundle completes, showing slot numbers, timestamps, and the bundle ID.

## Out of scope (explicitly deferred)

- **Dynamic/agent-decided tip** — Phase 10. Phase 6 uses a hardcoded minimum.
- **Retry logic** — Phase 9. If the bundle fails, the Phase 6 code may log
  the failure but will not retry.
- **Failure classification** — Phase 8. Raw error payloads are printed/logged
  but not parsed into classified types.
- **JSON Lines file output** — Phase 7. Lifecycle data is printed to stdout;
  file persistence comes next.
- **Multiple sequential submissions** — Phase 12. Phase 6 submits exactly one
  bundle per run.
- **Regional Block Engine selection** — the endpoint is overridable via env
  but defaults to the mainnet URL; latency optimization is deferred.
- **`jito-ts` SDK adoption** — start with raw JSON-RPC (matching Phase 5's
  pattern); switch to `jito-ts` only if raw calls prove problematic.

## Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Bundle composition | **Two transactions** (self-transfer + tip) | Per Jito convention, the tip must be in the last transaction. Keeping the payload (self-transfer) and tip in separate transactions makes the structure explicit and each transaction independently verifiable. |
| Tip amount | **Hardcoded 1000 lamports** | Jito's protocol floor. Deliberately not dynamic — Phase 6 is about proving mechanics, not strategy. 1000 lamports is the minimum that will be accepted. |
| Submission client | **Hand-rolled JSON-RPC** (preferred, fall back to `jito-ts` if needed) | Consistency with Phase 5's `getTipAccounts` client. The `sendBundle` wire format is straightforward. Adopt `jito-ts` only if raw calls reveal serialization or compatibility issues. |
| Blockhash source | **`processed` commitment** | Per tech-stack.md: a `finalized` blockhash is already old relative to the current slot and increases expiry risk. `processed` or `confirmed` is correct for low-latency submission. |
| Entrypoint integration | **Flag-guarded single run** | The existing system (Yellowstone streams, tip data) runs normally; setting `SEND_BUNDLE=true` adds one submission cycle at boot. This keeps the Phase 6 code additive and non-breaking. |

## Context and constraints (from mission.md / tech-stack.md)

- **Mainnet only.** The bundle must land on mainnet and be verifiable on a
  public explorer. Devnet bundles would not appear on a mainnet explorer and
  cannot satisfy the verification requirement.
- **Real spend.** 1000 lamports is tiny (~0.000001 SOL) but real. This is the
  first phase that touches mainnet money. The wallet used must be funded with
  a known small balance.
- **Rate limit.** Block Engine enforces ~1 req/sec/IP/region. Status polling
  (`getBundleStatuses`) must respect this — poll no more than once per second,
  and back off on 429 responses.
- **Jito tip placement.** Tip instruction goes in the **last** transaction of
  the bundle (this differs from `sendTransaction`'s 70/30 priority-fee/tip
  split — bundles only care about the Jito tip).
- **gRPC transaction stream.** The Phase 4 Yellowstone transaction filter
  (scoped to the wallet's account) should observe the bundle's transactions
  landing. This provides a cross-check against `getBundleStatuses` data.
- **No hardcoded values** (mission.md design principle). Even the tip accounts
  must come from `getTipAccounts` at runtime, not baked into source. The only
  hardcoded value is the tip *amount* (1000), and that is explicitly temporary
  (replaced by agent decision in Phase 10).

## Open items to verify during implementation

- `sendBundle` JSON-RPC endpoint path and request/response envelope on the
  current Block Engine (confirm against `docs.jito.wtf/lowlatencytxnsend`
  or live testing).
- Whether `sendBundle` expects base64-encoded transactions or base58
  (historically base64).
- Whether legacy transactions or versioned transactions (`legacy` vs `0`) are
  accepted — test both.
- Actual tip_account pubkeys from `getTipAccounts` to use in the self-transfer
  bundle.
- The `getBundleStatuses` response shape — field names for slot, timestamp,
  commitment, error.
- The `getInflightBundleStatuses` response shape and when it returns results
  vs an empty array.
