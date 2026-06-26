import { describe, it, expect, beforeEach } from "vitest"
import { SignatureTracker } from "@valence/lifecycle"

describe("SignatureTracker", () => {
  let tracker: SignatureTracker

  beforeEach(() => {
    tracker = new SignatureTracker()
  })

  it("records first-seen slot on first observe", () => {
    tracker.watch("sig1")
    tracker.observe("sig1", BigInt(100), "processed")

    const status = tracker.getStatus("sig1")
    expect(status).not.toBeNull()
    expect(status!.firstSeenSlot).toBe(BigInt(100))
    expect(status!.commitment).toBe("processed")
  })

  it("does not overwrite first-seen slot on subsequent observations", () => {
    tracker.watch("sig1")
    tracker.observe("sig1", BigInt(100), "processed")
    tracker.observe("sig1", BigInt(105), "confirmed")

    const status = tracker.getStatus("sig1")
    expect(status!.firstSeenSlot).toBe(BigInt(100))
    expect(status!.commitment).toBe("confirmed")
  })

  it("returns null for unwatched signatures", () => {
    expect(tracker.getStatus("never-watched")).toBeNull()
  })

  it("does not record observations for signatures not in watched set", () => {
    tracker.observe("unwatched", BigInt(100), "processed")

    expect(tracker.getStatus("unwatched")).toBeNull()
  })

  it("reports has() correctly before and after watch", () => {
    expect(tracker.has("sig1")).toBe(false)

    tracker.watch("sig1")
    expect(tracker.has("sig1")).toBe(true)
  })

  it("does not downgrade commitment level", () => {
    tracker.watch("sig1")
    tracker.observe("sig1", BigInt(100), "finalized")
    tracker.observe("sig1", BigInt(105), "processed")

    const status = tracker.getStatus("sig1")
    expect(status!.commitment).toBe("finalized")
  })

  it("recordSubmitted stores bundle metadata and watches signatures", () => {
    tracker.recordSubmitted("bundle-1", ["sig1", "sig2"], 1000, 500)

    expect(tracker.has("sig1")).toBe(true)
    expect(tracker.has("sig2")).toBe(true)
  })

  it("getBundleEvents returns submitted event before any observation", () => {
    tracker.recordSubmitted("bundle-1", ["sig1", "sig2"], 1000, 500)

    const events = tracker.getBundleEvents("bundle-1")
    expect(events).toHaveLength(2)
    expect(events[0]!.stage).toBe("submitted")
    expect(events[0]!.bundleId).toBe("bundle-1")
    expect(events[0]!.slot).toBe(500)
    expect(events[0]!.tipLamports).toBe(1000)
    expect(events[1]!.stage).toBe("submitted")
  })

  it("getBundleEvents includes observed stage after observation", () => {
    tracker.recordSubmitted("bundle-1", ["sig1"], 1000, 500)
    tracker.observe("sig1", BigInt(600), "confirmed")

    const events = tracker.getBundleEvents("bundle-1")
    const stages = events.map((e) => e.stage)
    expect(stages).toContain("submitted")
    expect(stages).toContain("confirmed")
  })

  it("getBundleEvents returns empty array for unknown bundle", () => {
    const events = tracker.getBundleEvents("unknown-bundle")
    expect(events).toEqual([])
  })
})
