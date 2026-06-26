import { describe, it, expect } from "vitest"
import { classifyFailure, classifyBundleStatus, classifyTransactionError } from "@valence/jito"
import type { BundleStatusEntry } from "@valence/jito"

describe("classifyFailure", () => {
  it("classifies expired blockhash from error message", () => {
    const details = classifyFailure(new Error("Blockhash not found"))
    expect(details.classification).toBe("expired_blockhash")
    expect(details.originalError).toContain("Blockhash not found")
  })

  it("classifies expired blockhash from 'blockhash too old'", () => {
    const details = classifyFailure("blockhash too old, use a recent blockhash")
    expect(details.classification).toBe("expired_blockhash")
  })

  it("classifies expired blockhash from 'invalid blockhash'", () => {
    const details = classifyFailure("invalid blockhash")
    expect(details.classification).toBe("expired_blockhash")
  })

  it("classifies fee too low from error message", () => {
    const details = classifyFailure("tip too low, need at least 1000 lamports")
    expect(details.classification).toBe("fee_too_low")
  })

  it("classifies fee too low from 429 rate limit", () => {
    const details = classifyFailure("429 Too Many Requests")
    expect(details.classification).toBe("fee_too_low")
  })

  it("classifies compute exceeded from error message", () => {
    const details = classifyFailure("computational budget exceeded")
    expect(details.classification).toBe("compute_exceeded")
  })

  it("classifies compute exceeded from ProgramFailedToComplete", () => {
    const details = classifyFailure("Program failed to complete: computational budget exceeded")
    expect(details.classification).toBe("compute_exceeded")
  })

  it("classifies bundle failure from generic bundle error", () => {
    const details = classifyFailure("bundle did not land: no valid bundles")
    expect(details.classification).toBe("bundle_failure")
  })

  it("classifies bundle failure from failed to land", () => {
    const details = classifyFailure("Bundle simulation failed: failed to land in block")
    expect(details.classification).toBe("bundle_failure")
  })

  it("returns unknown for unrecognized errors", () => {
    const details = classifyFailure("some random network error")
    expect(details.classification).toBe("unknown")
  })

  it("handles non-Error objects with message property", () => {
    const details = classifyFailure({ message: "Blockhash not found" })
    expect(details.classification).toBe("expired_blockhash")
  })

  it("includes slot number when provided", () => {
    const details = classifyFailure("blockhash not found", { slot: 12345 })
    expect(details.classification).toBe("expired_blockhash")
    expect(details.slot).toBe(12345)
  })

  it("handles null or undefined gracefully", () => {
    const details = classifyFailure(null)
    expect(details.classification).toBe("unknown")
  })

  it("handles object with err property (tx error format)", () => {
    const details = classifyFailure({ err: "Blockhash not found" })
    expect(details.classification).toBe("expired_blockhash")
  })
})

describe("classifyBundleStatus", () => {
  it("returns null for successful landed bundles", () => {
    const statuses: BundleStatusEntry[] = [
      {
        bundle_id: "bundle-1",
        status: "Landed",
        slot: 1000,
        landed_slot: 1000,
        transactions: [
          { signature: "sig1", slot: 1000, err: null },
          { signature: "sig2", slot: 1000, err: null },
        ],
      },
    ]
    expect(classifyBundleStatus(statuses)).toBeNull()
  })

  it("classifies bundle_failure when transactions have errors", () => {
    const statuses: BundleStatusEntry[] = [
      {
        bundle_id: "bundle-1",
        status: "Landed",
        slot: 1000,
        landed_slot: 1000,
        transactions: [
          { signature: "sig1", slot: 1000, err: { InstructionError: [0, "custom error"] } },
        ],
      },
    ]
    const result = classifyBundleStatus(statuses)
    expect(result).not.toBeNull()
    expect(result!.classification).toBe("bundle_failure")
  })

  it("classifies bundle_failure when all statuses are Failed", () => {
    const statuses: BundleStatusEntry[] = [
      {
        bundle_id: "bundle-1",
        status: "Failed",
        transactions: [],
      },
    ]
    const result = classifyBundleStatus(statuses)
    expect(result).not.toBeNull()
    expect(result!.classification).toBe("bundle_failure")
    expect(result!.originalError).toContain("Failed")
  })

  it("classifies bundle_failure when all statuses are Dropped", () => {
    const statuses: BundleStatusEntry[] = [
      {
        bundle_id: "bundle-1",
        status: "Dropped",
        transactions: [],
      },
    ]
    const result = classifyBundleStatus(statuses)
    expect(result).not.toBeNull()
    expect(result!.classification).toBe("bundle_failure")
  })

  it("returns null for empty status list", () => {
    expect(classifyBundleStatus([])).toBeNull()
  })

  it("returns null for in-flight statuses without failure", () => {
    const statuses: BundleStatusEntry[] = [
      {
        bundle_id: "bundle-1",
        status: "Pending",
        transactions: [],
      },
    ]
    expect(classifyBundleStatus(statuses)).toBeNull()
  })
})

describe("classifyTransactionError", () => {
  it("returns null for no error", () => {
    expect(classifyTransactionError(null)).toBeNull()
    expect(classifyTransactionError(undefined)).toBeNull()
  })

  it("classifies transaction error with known pattern", () => {
    const result = classifyTransactionError({ InstructionError: [0, "Blockhash not found"] })
    expect(result).toBe("expired_blockhash")
  })

  it("returns unknown for unrecognized transaction errors", () => {
    const result = classifyTransactionError({ InstructionError: [0, "custom program error"] })
    expect(result).toBe("unknown")
  })
})
