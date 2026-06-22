# Plan — Yellowstone gRPC Slot Stream

> Covers roadmap Phase 2: Yellowstone gRPC slot stream (mainnet, read-only).
> Current date: June 22, 2026. Submission deadline: June 29, 2026.

---

## Task group 1 — Yellowstone gRPC client scaffold

- [x] 1. Create `src/yellowstone/types.ts` — request config shapes for `subscribeSlots`:
       subscription id, commitment level, provider endpoint URL
- [x] 2. Create `src/yellowstone/connection.ts` — thin wrapper around
       `@triton-one/yellowstone-grpc` `Client`:
       - Constructor takes an endpoint URL (configurable — any Yellowstone-
         compatible provider, Solinfra by default with env var fallback)
       - `connect()` — opens the gRPC stream, returns a `Client` handle
       - `disconnect()` — cleanly tears down the stream
       - Imports the protobuf-generated types for `SubscribeRequest`
       - Uses `processed` commitment for earliest slot signal per tech-stack.md
- [x] 3. Create `src/yellowstone/subscriptions/slots.ts` — the slot subscription
       handler:
       - Builds a `SubscribeRequest` with `slots: {}` filter
       - Wraps the incoming stream in an async iterable or event emitter
       - Emits typed `SlotUpdate` events: `{ slot: bigint, parent: bigint | null, status: 'confirmed' | 'processed' | 'root', timestamp: number }`
       - Source-level `parent` and `status` fields extracted from the gRPC
         protobuf `SubscribeUpdateSlot` message; `timestamp` is `Date.now()`
         on receipt for latency measurement
- [x] 4. Create `src/yellowstone/subscriptions/index.ts` — barrel export
- [x] 5. Create `src/yellowstone/index.ts` — barrel export
- [x] 6. **Check**: `npm run typecheck` passes; yellowstone module imports without
       runtime error (connection will fail without a real endpoint, but the
       module graph resolves)

---

## Task group 2 — Reconnect with exponential + jitter backoff

- [x] 1. Create `src/yellowstone/reconnect.ts`:
       - `ReconnectBackoff` class with exponential strategy:
         - Initial delay: 1,000ms
         - Multiplier: 2x
         - Max delay: 30,000ms
         - Jitter: random ±25% on each computed delay
           (e.g., a 2,000ms base becomes uniform-random 1,500ms–2,500ms)
       - `getDelay(attempt: number): number` — returns millisecond delay
         before the next retry attempt (formula:
         `min(cap, base * multiplier^attempt)` with jitter applied after
         clamping)
       - `reset()` — resets attempt counter to 0 (call on successful connect)
       - `attempt` counter increments on each call to `getDelay`, resets on
         `reset`
       - Fires a `reconnecting` event/console log at each backoff level so
         the operator can see the stream is recovering, not silently hanging
- [x] 2. Integrate `ReconnectBackoff` into `connection.ts`:
       - On gRPC stream error/disconnect, catch the event, log the error
         level, compute backoff delay, wait, then call `connect()` again
       - Log every reconnection attempt with:
         `[yellowstone] connection lost (reason: ...), retry #N in ~Xms`
       - On successful reconnect, call `backoff.reset()` and re-subscribe
         (including the slot subscription)
- [x] 3. Add `fromSlot` replay support in `connection.ts`:
       - Track the highest slot number received before disconnect
       - On reconnect, include `fromSlot` (that value + 1) in the
         `SubscribeRequest` to backfill any gap (providers typically buffer
         ~3000 slots / ~20 minutes)
       - Log the `fromSlot` value on reconnect so the operator can verify
         gap-filling behavior
- [x] 4. Write unit tests `tests/unit/yellowstone/reconnect.test.ts` (4+ tests):
       - Test that delays increase exponentially (capped at max)
       - Test that jitter produces values within expected range
       - Test that `reset()` returns to initial delay
       - Test that multiple `getDelay` calls increase the attempt counter
- [x] 5. **Check**: `npm test` passes; reconnect backoff is deterministic in tests

---

## Task group 3 — Latency measurement: gRPC vs RPC polling

- [x] 1. Create `src/yellowstone/latency.ts`:
       - `measureLatency()` — on every slot received via gRPC, also fire an
         RPC `getSlot("processed")` call and compare the two values:
         - gRPC slot arrives with wall-clock timestamp (on receipt)
         - RPC slot is fetched immediately after with its own timestamp
         - Compute `grpc_delivery_latency_ms` (estimated: gRPC slot arrives
           at wall time T_grpc, RPC returns slot value S_rpc at wall time T_rpc;
           the RPC's slot value is already older by the time it's received, but
           the difference T_rpc - T_grpc is a rough upper bound on gRPC's
           advantage)
       - Log: `[yellowstone] slot #{slot} via grpc, #{rpcSlot} via rpc, delta ~Xms`
- [x] 2. Wire `measureLatency` into the slot subscription handler so it runs
       automatically (configurable sample interval: e.g., every 10th slot to
       avoid hammering the RPC)
- [x] 3. Write unit test `tests/unit/yellowstone/latency.test.ts` (2+ tests):
       - Test that latency computation handles normal values
       - Test that missing timestamps don't crash
- [x] 4. **Check**: `npm test` passes; latency module is instrumented

---

## Task group 4 — Integration into entrypoint

- [x] 1. Extend `src/index.ts`:
       - On startup, initialize `YellowstoneConnection` with the provider
         endpoint from config
       - Start the slot subscription
       - Log incoming slot numbers to stdout every N slots (configurable,
         default every 10) so the operator can see live progression
       - On shutdown (SIGINT/SIGTERM), disconnect cleanly
       - The entrypoint should run indefinitely, streaming slots, until the
         operator kills it
- [x] 2. Update `src/config/env.ts` to add:
       - `YELLOWSTONE_ENDPOINT` — optional, defaults to Solinfra endpoint
         if not set; value can be any Yellowstone-compatible provider URL
       - `YELLOWSTONE_GRPC_TOKEN` — optional auth token if the provider
         requires one
- [x] 3. Update config type definitions in `src/types/config.ts` to match
- [x] 4. **Check**: `npm run build && npm run typecheck` succeeds

---

## Task group 5 — Manual smoke test (mainnet, read-only, requires funded wallet)

This task cannot run in CI — it requires a real Yellowstone provider endpoint.

1. Set `.env` with `YELLOWSTONE_ENDPOINT` (Solinfra or fallback provider)
   and optionally `YELLOWSTONE_GRPC_TOKEN`
2. Run `npx tsx src/index.ts`
3. **Verify**:
   - Stream connects and prints `[yellowstone] connected to {endpoint}`
   - Slot numbers appear every ~400-800ms (one per Solana slot)
   - Slot numbers are strictly increasing
   - After 2+ minutes of uninterrupted streaming, manually kill the
     Yellowstone provider process (or unplug the network) and observe:
     - Reconnection logging appears with increasing backoff delays
     - Stream recovers within ~30 seconds of the provider coming back
     - Slot numbers resume from roughly where they left off (no large gap
       unless the downtime exceeded the provider's `fromSlot` buffer)
   - Latency comparison lines show gRPC slots consistently arriving before
     or at the same time as RPC-slots (if not, there may be a configuration
     issue or the provider is proxying)
4. **Check**: stream runs for ≥5 minutes uninterrupted OR recovers from at
   least two manually-triggered disconnects
