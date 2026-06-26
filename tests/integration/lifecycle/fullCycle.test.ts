import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { unlinkSync, existsSync, readFileSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { SignatureTracker, appendToLog, createLifecycleLogEntry } from "@valence/lifecycle"

describe("full lifecycle integration", () => {
  let tracker: SignatureTracker
  let tmpDir: string
  const logFile = "test-full-cycle.jsonl"

  beforeEach(() => {
    tracker = new SignatureTracker()
    tmpDir = mkdtempSync(join(tmpdir(), "fullcycle-"))
  })

  afterEach(() => {
    const logPath = join(tmpDir, logFile)
    if (existsSync(logPath)) unlinkSync(logPath)
  })

  it("simulates a full bundle lifecycle and persists to JSONL", async () => {
    const bundleId = "test-bundle-1"
    // Each sig stops at a different commitment level so the event
    // set covers processed, confirmed, and finalized across sigs
    const sigs = ["sig-processed", "sig-confirmed", "sig-finalized"]
    const tipLamports = 1000
    const submittedSlot = 500

    // Stage 1: submitted
    tracker.recordSubmitted(bundleId, sigs, tipLamports, submittedSlot)

    // Stage 2: all three sigs reach processed
    tracker.observe("sig-processed", BigInt(600), "processed")
    tracker.observe("sig-confirmed", BigInt(601), "processed")
    tracker.observe("sig-finalized", BigInt(602), "processed")

    // Stage 3: two sigs reach confirmed
    tracker.observe("sig-confirmed", BigInt(700), "confirmed")
    tracker.observe("sig-finalized", BigInt(702), "confirmed")

    // Stage 4: one sig reaches finalized
    tracker.observe("sig-finalized", BigInt(800), "finalized")

    const events = tracker.getBundleEvents(bundleId)

    const entry = createLifecycleLogEntry({
      bundleId,
      events,
      tipLamports,
      agentReasoning: null,
      failure: null,
    })

    const logPath = join(tmpDir, logFile)
    await appendToLog(logPath, entry)

    // Read back and verify
    expect(existsSync(logPath)).toBe(true)
    const content = readFileSync(logPath, "utf-8").trimEnd()
    const lines = content.split("\n")
    expect(lines).toHaveLength(1)

    const parsed = JSON.parse(lines[0]!)
    expect(parsed.bundleId).toBe(bundleId)

    // Events contain submitted + observed per sig
    const stages = new Set(parsed.events.map((e: { stage: string }) => e.stage))
    expect(stages.has("submitted")).toBe(true)
    expect(stages.has("processed")).toBe(true)
    expect(stages.has("confirmed")).toBe(true)
    expect(stages.has("finalized")).toBe(true)

    // Total events = 1 submitted per sig + 1 observed per sig = 6
    expect(parsed.events).toHaveLength(6)

    // stageDeltas should have computed values (non-null) for all pairs
    const deltas = parsed.stageDeltas
    expect(typeof deltas["submitted→processed"]).toBe("number")
    expect(typeof deltas["processed→confirmed"]).toBe("number")
    expect(typeof deltas["confirmed→finalized"]).toBe("number")
    expect(deltas["confirmed→finalized"]).toBeGreaterThanOrEqual(0)

    // writtenAt is a plausible Unix timestamp
    expect(typeof parsed.writtenAt).toBe("number")
    expect(parsed.writtenAt).toBeGreaterThan(1700000000000)
    expect(parsed.writtenAt).toBeLessThan(2000000000000)
  })
})
