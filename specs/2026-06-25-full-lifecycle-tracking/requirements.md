# Requirements — Full lifecycle tracking across all four stages

## Feature summary

Extend the SignatureTracker from Phase 4/6 to explicitly capture all four
commitment stages (submitted, processed, confirmed, finalized) with timestamps,
slot numbers, and computed latency deltas between each consecutive stage pair.
Persist completed lifecycle entries to a JSON Lines log file at
`valence/lifecycle/log.jsonl`.

Phase 6 proved that the submission pipeline works end-to-end on mainnet, but
the lifecycle output was incomplete: the `processed` stage was missing (no gRPC
stream), and `confirmed`/`finalized` came from polling without explicit
cross-referencing. Phase 7 closes those gaps and adds file persistence, so
every bundle run produces a verifiable, durable, four-stage lifecycle record.

## Why this phase exists (context from roadmap)

The bounty scoring weights "Depth of Integration" heavily. A lifecycle tracker
that can only produce two of four stages on its best day is a weak foundation
for the AI agent (Phases 9-11) that needs to reason about *where* in the
lifecycle a failure occurred. Phase 7 builds the observable substrate that
every subsequent phase depends on.

The JSON Lines file also serves as the primary deliverable for the "≥10 bundle
submissions" requirement (Phase 12) — Phase 7 ships the logging infrastructure
so Phase 12 is purely about running the system N times.

## User decisions (from spec kickoff)

| Decision | Choice | Rationale |
|---|---|---|
| Processed stage source | **Keep both paths** — Yellowstone gRPC when available, signature polling fallback | gRPC is the ideal source (earliest signal) but the endpoint may be unreachable (Phase 6 blocker). Polling provides a working fallback at the cost of slightly later detection. |
| Log file path | **`valence/lifecycle/log.jsonl`** | Colocated with the lifecycle module, easy to find, follows the project's existing module layout. |
| Latency delta storage | **Both** — raw timestamps in each event + pre-computed summary deltas at the end of the lifecycle | Raw timestamps enable post-hoc analysis and re-computation; pre-computed deltas make the log self-documenting and reduce downstream processing. |

## In scope

- **Extra lifecycle stages** — ensure `processed` and `finalized` are captured
  alongside `submitted` and `confirmed` in every lifecycle entry. When gRPC is
  unavailable, derive `processed` from the first `getSignatureStatus` poll that
  returns a slot (the earliest known slot is the `processed` slot).
- **Latency deltas** — for each consecutive stage pair
  (submitted→processed, processed→confirmed, confirmed→finalized), compute
  elapsed time in milliseconds. Store as a `stageDeltas` map in the log entry.
- **JSON Lines log file** — after each bundle lifecycle completes, append one
  JSON line to `valence/lifecycle/log.jsonl` containing:
  - `bundleId`
  - `events` array (one per stage per signature)
  - `stageDeltas` (pre-computed ms between each consecutive stage pair)
  - `tipLamports`
  - `agentReasoning` (null for Phase 7, populated in Phase 10)
  - `failure` (null for Phase 7, populated in Phase 8)
- **Log appender** — a stateless function or class that opens/creates the
  log file, appends one JSON line atomically (including a trailing `\n`), and
  flushes. No buffering beyond the OS write cache — crash-safe append.
- **Index.ts export** — export the log writer from the lifecycle module so
  the entrypoint and future phases can import it.
- **Integration with Phase 6's runBundleSubmission** — after the lifecycle
  summary is printed to stdout (existing behavior), write the same data to the
  JSONL file.
- **Backward compatibility** — the in-memory `SignatureTracker` API does not
  change. The JSONL writer is additive; existing consumers (entrypoint, tests)
  continue to work without modification.

## Out of scope (explicitly deferred)

- **Failure classification** — Phase 8. The log entry includes a `failure`
  field, but Phase 7 always writes `null`.
- **Agent reasoning** — Phase 10. `agentReasoning` is `null` in Phase 7.
- **Multi-bundle runs** — Phase 12. Phase 7 persists one bundle per run;
  over time the JSONL file accumulates entries from separate runs.
- **Log rotation / retention** — not needed for the ≤50-entry log this system
  will produce.
- **Read-back / query tool** — a script to read and pretty-print the JSONL log
  is deferred but may be useful for Phase 12's "show me the log" requirement.
- **gRPC stream reconnection with fromSlot replay** — already exists in
  YellowstoneConnection (Phase 4). Phase 7 uses the tracker's existing
  `observe()` interface; it does not reimplement stream recovery.

## Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Log format | **JSON Lines** (one JSON object per line, `\n`-delimited) | Append-only, parseable line-by-line, standard tooling support (jq, pandas, etc.). Each line is a complete, self-describing record. |
| Latency delta structure | `{ "submitted→processed": 1234, "processed→confirmed": 567, "confirmed→finalized": 89 }` (ms, integer) | Pre-computed at log-write time from the events' timestamps. Missing if a stage was never reached. |
| Processed derivation | First non-zero slot from `getSignatureStatus` poll = `processed` slot; poll timestamp = `processed` timestamp | This is the best approximation when gRPC is unavailable. The true `processed` time may be slightly earlier, but the slot is authoritative. |
| Log file creation | Create + append; if file doesn't exist, create it | Standard JSONL pattern. The file is in `.gitignore` (like `.env`). |

## Context and constraints (from mission.md / tech-stack.md)

- **Mainnet only.** All four stages must be observable on mainnet. Devnet
  bundles don't produce explorer-verifiable proof.
- **Rate limit.** Jito Block Engine rate limits (1 req/sec/IP/region) apply to
  `getBundleStatuses` and `getInflightBundleStatuses` polling. Must back off on
  429s.
- **gRPC stream.** Yellowstone gRPC (when available) provides the earliest
  `processed` signal. Phase 7 uses it via the existing `txUpdate` and
  `txStatusUpdate` event handlers, which already call `tracker.observe()`.
- **No hardcoded values.** Tip accounts come from `getTipAccounts`, tip amounts
  from config (soon from the agent). The log file path uses a default constant
  but is overridable via env var for testing.
- **Commitment level semantics** (from tech-stack.md):
  - `processed` — fastest, earliest visibility, never trusted for irreversible
    decisions.
  - `confirmed` — "did this probably land" during normal operation.
  - `finalized` — final log entry only; never used for blockhash fetching.
- **Phase 6 fallback.** When `sendBundle` fails with "Invalid" and the system
  falls back to `sendTransaction`, the lifecycle should still capture all four
  stages for the fallback transaction (via polling; gRPC will observe it too
  if connected).

## Open items to verify during implementation

- Whether `getSignatureStatus` returns `confirmationStatus: "processed"` for
  a transaction on its first poll, or whether the first non-null response
  already shows `confirmed` (depends on RPC node's commitment propagation
  latency).
- Whether the gRPC `txUpdate` event (processed) fires before the first poll,
  after, or not at all given the current Yellowstone endpoint status.
- Atomicity of `appendFile` in Node.js — it's not atomic at the filesystem
  level for multi-writer scenarios, but for our single-writer use case
  (`fs.appendFile` with `{ flag: 'a' }` is sufficient).
- The maximum JSON line length: events array × 4 stages × ~200 bytes ≈ ~800
  bytes per line; well within Node.js default buffer limits.
