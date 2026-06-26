import { describe, it, expect } from "vitest"
import { computeStageDeltas } from "@valence/types"
import type { LifecycleEvent } from "@valence/types"

function makeEvent(
  stage: LifecycleEvent["stage"],
  timestamp: number,
  sig = "sig1",
  bundleId = "bundle-1",
): LifecycleEvent {
  return {
    bundleId,
    signature: sig,
    stage,
    slot: timestamp, // slot monotonic with timestamp for simplicity
    timestamp,
    tipLamports: 1000,
    agentReasoning: null,
    failure: null,
  }
}

describe("computeStageDeltas", () => {
  it("computes deltas correctly when all four stages are present", () => {
    const events = [
      makeEvent("submitted", 1000),
      makeEvent("processed", 2000),
      makeEvent("confirmed", 3500),
      makeEvent("finalized", 3800),
    ]
    const deltas = computeStageDeltas(events)
    expect(deltas["submitted→processed"]).toBe(1000)
    expect(deltas["processed→confirmed"]).toBe(1500)
    expect(deltas["confirmed→finalized"]).toBe(300)
  })

  it("uses earliest timestamp per stage across multiple signatures", () => {
    const events = [
      makeEvent("submitted", 1000, "sig1"),
      makeEvent("submitted", 1005, "sig2"),
      makeEvent("processed", 2000, "sig1"),
      makeEvent("processed", 1995, "sig2"),
      makeEvent("confirmed", 3500, "sig1"),
      makeEvent("confirmed", 3400, "sig2"),
      makeEvent("finalized", 3700, "sig1"),
      makeEvent("finalized", 3800, "sig2"),
    ]
    const deltas = computeStageDeltas(events)
    // Earliest submitted: 1000 (sig1), earliest processed: 1995 (sig2)
    expect(deltas["submitted→processed"]).toBe(995)
    // Earliest processed: 1995 (sig2), earliest confirmed: 3400 (sig2)
    expect(deltas["processed→confirmed"]).toBe(1405)
    // Earliest confirmed: 3400 (sig2), earliest finalized: 3700 (sig1)
    expect(deltas["confirmed→finalized"]).toBe(300)
  })

  it("returns null for submitted→processed when processed stage is missing", () => {
    const events = [
      makeEvent("submitted", 1000),
      makeEvent("confirmed", 3500),
      makeEvent("finalized", 3800),
    ]
    const deltas = computeStageDeltas(events)
    expect(deltas["submitted→processed"]).toBeNull()
    expect(deltas["processed→confirmed"]).toBeNull()
    expect(deltas["confirmed→finalized"]).toBe(300)
  })

  it("returns null for confirmed→finalized when finalized stage is missing", () => {
    const events = [
      makeEvent("submitted", 1000),
      makeEvent("processed", 2000),
      makeEvent("confirmed", 3500),
    ]
    const deltas = computeStageDeltas(events)
    expect(deltas["submitted→processed"]).toBe(1000)
    expect(deltas["processed→confirmed"]).toBe(1500)
    expect(deltas["confirmed→finalized"]).toBeNull()
  })

  it("handles out-of-order timestamps gracefully (uses Math.max)", () => {
    const events = [
      makeEvent("submitted", 5000),
      makeEvent("processed", 1000),
      makeEvent("confirmed", 2000),
      makeEvent("finalized", 3000),
    ]
    const deltas = computeStageDeltas(events)
    // earliest submitted = 5000, earliest processed = 1000
    // delta = 1000 - 5000 = -4000, but we use Math.max(0, -4000) = 0
    expect(deltas["submitted→processed"]).toBe(0)
    expect(deltas["processed→confirmed"]).toBe(1000)
    expect(deltas["confirmed→finalized"]).toBe(1000)
  })
})
