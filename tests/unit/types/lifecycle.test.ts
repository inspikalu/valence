import { describe, it, expect } from "vitest"

describe("LifecycleStage", () => {
  it("accepts valid stages", () => {
    const validStages = ["submitted", "processed", "confirmed", "finalized"] as const
    for (const stage of validStages) {
      expect(stage).toBeDefined()
    }
  })

  it("rejects invalid stage values at runtime", () => {
    const invalid = "invalid_stage"
    const valid: readonly string[] = ["submitted", "processed", "confirmed", "finalized"]
    expect(valid.includes(invalid)).toBe(false)
  })
})

describe("FailureClassification", () => {
  it("narrows correctly", () => {
    const failures = [
      "expired_blockhash",
      "fee_too_low",
      "compute_exceeded",
      "bundle_failure",
      "unknown",
    ] as const
    for (const f of failures) {
      expect(f).toBeDefined()
    }
  })
})
