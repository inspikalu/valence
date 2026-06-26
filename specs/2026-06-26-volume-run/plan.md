# Plan — Volume run: produce the required lifecycle log

> Covers roadmap Phase 12. Wraps the existing single-submission flow in a
> sequential orchestrator that runs N submissions with configurable failure
> injection, collects lifecycle entries, and outputs a clean, aggregated log
> file. All ≥10 real bundles land on mainnet; ≥2 are deliberate failures.
>
> Current date: June 26, 2026. Submission deadline: June 29, 2026.

---

## Task group 1 — Env vars for volume orchestration

1. Add to `src/config/env.ts` and `ValenceConfig`:
   - `volumeCount: number` — loaded from `VOLUME_COUNT` env var, default `1`.
     Must be 1 or more. Enforced at config load time.
   - `volumeIntervalMs: number` — loaded from `VOLUME_INTERVAL_MS` env var,
     default `2000`. Minimum enforced at 1000ms.
   - `injectFailureMode: string` — loaded from `INJECT_FAILURE_MODE` env var,
     default `""` (empty = no injection). Values: comma-separated list of
     `expiry`, `low_tip`, `compute_exceeded`. Example:
     `INJECT_FAILURE_MODE=expiry,low_tip,compute_exceeded`.

2. Define a type for failure injection modes:

```ts
export type InjectFailureMode = "expiry" | "low_tip" | "compute_exceeded"
```

3. Add a helper `parseInjectFailureModes(value: string): InjectFailureMode[]`
   that splits on comma, validates each token (throws on unknown), and returns
   the array. Empty string → `[]`.

4. Update `.env.example` with the three new vars and their descriptions.

5. Existing tests for config/env must be updated to set defaults for the new
   fields so they continue to pass.

## Task group 2 — Failure injection in `runBundleSubmission`

1. **Low-tip injection**: Add a new env `INJECT_LOW_TIP` (boolean, default
   false). When true and `injectFailureMode` includes `low_tip`, bypass the
   agent's tip clamping and use `reducedTipLamports = 1`. The `buildSelfTransferBundle`
   will use 1 lamport as the tip, which is below Jito's 1000-lamport floor and
   will cause the bundle to fail. The failure classifier will pick up the result
   as `fee_too_low` or `bundle_failure`.

   Implementation: In `runBundleSubmission`, after the agent call but before
   `buildSelfTransferBundle`, if the current submission is marked for low-tip
   injection, override `tipAmount` to 1 and log:
   ```
   [volume] injecting low_tip failure — tip set to 1 lamport
   ```

2. **Compute-exceeded injection**: When the current submission is marked for
   `compute_exceeded`, add a `ComputeBudgetProgram.setComputeUnitLimit(1)`
   instruction to both transactions in the bundle. This allocates only 1 CU of
   compute budget, which the runtime will deterministically exceed, producing a
   `compute_exceeded` error.

   Implementation: In `runBundleSubmission`, before calling
   `buildSelfTransferBundle`, if the current submission is marked for
   compute_exceeded injection, set a flag. Modify `buildSelfTransferBundle` to
   accept an optional `computeUnitLimit: number` parameter. When set, prepend
   `ComputeBudgetProgram.setComputeUnitLimit(computeUnitLimit)` to each
   transaction. Pass `1` for failure injection, and the existing behavior (no
   compute budget instruction) for normal submissions.

   Actually, simpler approach: pass `computeUnitLimit` through from
   `runBundleSubmission` to `buildSelfTransferBundle`. When set, add the
   compute budget instruction. This keeps the failure injection logic at the
   caller level.

   Log:
   ```
   [volume] injecting compute_exceeded failure — computeUnitLimit set to 1
   ```

3. **Expiry injection**: Already implemented via `INTENTIONAL_EXPIRY=true` and
   `config.intentionalExpiry`. The volume orchestrator sets
   `config.intentionalExpiry = true` for the relevant submission.

## Task group 3 — Volume orchestrator loop

1. In `src/index.ts`, after the existing pre-flight checks (balance, slot,
   blockhash), add a `VOLUME_COUNT` loop. The structure:

```ts
async function runVolume(
  config: ValenceConfig,
  wallet: Keypair,
  rpc: SolanaRpcClient,
  tracker: SignatureTracker,
  extras: { ... },
): Promise<void> {
  const failureModes = parseInjectFailureModes(config.injectFailureMode)
  const logPath = process.env.LIFECYCLE_LOG_PATH ?? DEFAULT_LOG_PATH
  let successCount = 0
  let failureCount = 0

  for (let i = 0; i < config.volumeCount; i++) {
    console.log(`[volume] submission ${i + 1} / ${config.volumeCount}`)

    // Determine failure injection for this iteration
    const modeIndex = i > 0 ? (i - 1) % failureModes.length : -1
    const mode = modeIndex >= 0 ? failureModes[modeIndex] : null

    // Build per-submission config override
    const perConfig = { ...config }
    if (mode === "expiry") {
      perConfig.intentionalExpiry = true
    }

    await runBundleSubmission(perConfig, wallet, rpc, tracker, {
      tipFloorSnapshot: extras.tipFloorSnapshot,
      leaderIdentity: extras.leaderIdentity,
      isJitoLeader: extras.isJitoLeader,
      injectFailureMode: mode,
    })

    // Log results
    const allEvents = getAllLifecycleEvents(tracker)
    const hasFailure = allEvents.some(e => e.failure !== null)
    if (hasFailure) failureCount++ else successCount++

    // Wait for rate limit
    if (i < config.volumeCount - 1) {
      console.log(`[volume] waiting ${config.volumeIntervalMs}ms before next submission...`)
      await sleep(config.volumeIntervalMs)
    }
  }

  console.log(`[volume] complete — ${successCount} success, ${failureCount} failures`)
}
```

2. Determine cycle: failure modes are assigned to submissions starting from
   index 1 (the first submission is always clean). Modes cycle: expiry,
   low_tip, compute_exceeded, then repeat.

   Example with `VOLUME_COUNT=10` and `INJECT_FAILURE_MODE=expiry,low_tip,compute_exceeded`:
   - 1: clean
   - 2: expiry
   - 3: clean
   - 4: low_tip
   - 5: clean
   - 6: compute_exceeded
   - 7: clean
   - 8: expiry
   - 9: clean
   - 10: low_tip

   This guarantees at least 2 failures of 2 different types by submission 6,
   and fills to 10 total.

3. After the loop, print a summary with submission counts and failure counts.

## Task group 4 — Pass failure injection context through `runBundleSubmission`

1. Extend the `extras` parameter of `runBundleSubmission` (or the function
   signature directly) to accept `injectFailureMode: InjectFailureMode | null`.

2. Inside `runBundleSubmission`:
   - If `injectFailureMode === "low_tip"`: override `tipAmount` to 1.
   - If `injectFailureMode === "compute_exceeded"`: pass `computeUnitLimit: 1`
     to `buildSelfTransferBundle`.
   - If `injectFailureMode === "expiry"`: `config.intentionalExpiry` is
     already set at the orchestrator level.
   - If `null`: normal behavior.

3. Ensure the injected tip override happens *after* the agent call on clean
   submissions, or *without* the agent call on injected ones. For low-tip
   injection, skip the agent call entirely since we're overriding the tip
   anyway.

## Task group 5 — Update `buildSelfTransferBundle` for compute unit limit

1. Extend `buildSelfTransferBundle` signature:

```ts
export function buildSelfTransferBundle(
  wallet: Keypair,
  tipAccount: string,
  blockhash: string,
  tipLamports: number,
  computeUnitLimit?: number,
): BuildBundleResult
```

2. When `computeUnitLimit` is provided, prepend
   `ComputeBudgetProgram.setComputeUnitLimit(computeUnitLimit)` to each
   transaction before adding the transfer instructions.

3. Existing callers pass `undefined` — backward compatible.

4. The compute_unit_limit instruction uses the existing
   `ComputeBudgetProgram` import already in `bundle.ts`.

## Task group 6 — Lifecycle event aggregation

1. Since each submission produces independent lifecycle events (keyed by
   bundle ID), a single `SignatureTracker` across the whole volume run
   captures everything. The `appendToLog` calls inside `runBundleSubmission`
   (and any retry calls) write directly to the JSONL file.

2. After the volume loop, the log file already contains all entries. No
   separate aggregation step is needed.

3. Add a final summary log entry to the JSONL file (or just to stdout) with:
   ```
   [volume] total submissions: 10, successes: 7, failures: 3
   [volume] log written to: /path/to/log.jsonl
   ```

## Task group 7 — Tests

1. **`tests/unit/config/env.test.ts`** — 3 new cases:
   - Parses `VOLUME_COUNT=10` → `config.volumeCount === 10`
   - Parses `VOLUME_INTERVAL_MS=3000` → `config.volumeIntervalMs === 3000`
   - Parses `INJECT_FAILURE_MODE=expiry,low_tip` → failure modes parsed correctly
   - Default values when env vars are unset

2. **`tests/unit/config/failureModes.test.ts`** — 5 new cases:
   - `parseInjectFailureModes("")` → `[]`
   - `parseInjectFailureModes("expiry")` → `["expiry"]`
   - `parseInjectFailureModes("expiry,low_tip,compute_exceeded")` → all three
   - `parseInjectFailureModes("invalid")` throws
   - `parseInjectFailureModes("expiry,invalid,compute_exceeded")` throws

3. **`tests/unit/jito/bundle.test.ts`** — update for new `computeUnitLimit` param:
   - `buildSelfTransferBundle` without `computeUnitLimit` still works (backward compat)
   - `buildSelfTransferBundle` with `computeUnitLimit=1` adds the instruction
   - Transaction simulation should confirm 1 CU is too low to execute (mocked)

4. **Integration test**: `tests/integration/volume/sequentialRun.test.ts`:
   - Mock fetch to simulate Jito/Block Engine
   - Set `VOLUME_COUNT=3` with `INJECT_FAILURE_MODE=expiry,low_tip`
   - Mock a Groq response for the clean submission
   - Verify 3 `recordSubmitted` calls
   - Verify the expiry submission produces `expired_blockhash` in lifecycle
   - Verify the low_tip submission uses tip=1

## Task group 8 — Verification + docs

1. `npm run typecheck`, `npm run build`, `npm test` — all green.
2. **Live mainnet run**:
   - Fund wallet with ~0.01 SOL.
   - Set `SEND_BUNDLE=true VOLUME_COUNT=10 INJECT_FAILURE_MODE=expiry,low_tip,compute_exceeded`.
   - Run `npm start`.
   - Confirm ≥10 lifecycle entries in the log file.
   - Confirm ≥2 entries have non-null `failure` field.
   - Confirm `expired_blockhash`, `fee_too_low`/`bundle_failure`, and
     `compute_exceeded` all appear across the failures.
   - Spot-check 2-3 slot numbers against a public Solana explorer.
3. Tick the Phase 12 checkbox in `specs/roadmap.md`.
