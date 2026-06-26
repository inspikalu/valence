import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { unlinkSync, existsSync, readFileSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { appendToLog, createLifecycleLogEntry } from "@valence/lifecycle"
import type { LifecycleEvent } from "@valence/types"

function makeEvent(stage: LifecycleEvent["stage"], timestamp: number, sig = "sig1"): LifecycleEvent {
  return {
    bundleId: "bundle-1",
    signature: sig,
    stage,
    slot: timestamp,
    timestamp,
    tipLamports: 1000,
    agentReasoning: null,
    failure: null,
  }
}

describe("appendToLog", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "logwriter-"))
  })

  afterEach(() => {
    const logFile = join(tmpDir, "test.jsonl")
    if (existsSync(logFile)) unlinkSync(logFile)
  })

  it("writes a valid JSON line to a temp file", async () => {
    const logFile = join(tmpDir, "test.jsonl")
    const entry = createLifecycleLogEntry({
      bundleId: "bundle-1",
      events: [
        makeEvent("submitted", 1000),
        makeEvent("processed", 2000),
        makeEvent("confirmed", 3500),
        makeEvent("finalized", 3800),
      ],
      tipLamports: 1000,
      agentReasoning: null,
      failure: null,
    })

    await appendToLog(logFile, entry)
    expect(existsSync(logFile)).toBe(true)

    const content = readFileSync(logFile, "utf-8").trimEnd()
    const lines = content.split("\n")
    expect(lines).toHaveLength(1)

    const parsed = JSON.parse(lines[0]!)
    expect(parsed.bundleId).toBe("bundle-1")
    expect(parsed.events).toHaveLength(4)
    expect(parsed.stageDeltas).toEqual({
      "submitted→processed": 1000,
      "processed→confirmed": 1500,
      "confirmed→finalized": 300,
    })
    expect(typeof parsed.writtenAt).toBe("number")
  })

  it("appends multiple lines on multiple calls", async () => {
    const logFile = join(tmpDir, "test.jsonl")

    const entry1 = createLifecycleLogEntry({
      bundleId: "bundle-1",
      events: [makeEvent("submitted", 1000)],
      tipLamports: 1000,
      agentReasoning: null,
      failure: null,
    })
    const entry2 = createLifecycleLogEntry({
      bundleId: "bundle-2",
      events: [makeEvent("submitted", 2000)],
      tipLamports: 2000,
      agentReasoning: null,
      failure: null,
    })

    await appendToLog(logFile, entry1)
    await appendToLog(logFile, entry2)

    const content = readFileSync(logFile, "utf-8").trimEnd()
    const lines = content.split("\n")
    expect(lines).toHaveLength(2)

    const parsed1 = JSON.parse(lines[0]!)
    expect(parsed1.bundleId).toBe("bundle-1")

    const parsed2 = JSON.parse(lines[1]!)
    expect(parsed2.bundleId).toBe("bundle-2")
  })
})

describe("createLifecycleLogEntry", () => {
  it("produces correct shape with stageDeltas computed", () => {
    const events = [
      makeEvent("submitted", 1000),
      makeEvent("processed", 2000),
      makeEvent("confirmed", 3500),
      makeEvent("finalized", 3800),
    ]

    const entry = createLifecycleLogEntry({
      bundleId: "bundle-1",
      events,
      tipLamports: 1000,
      agentReasoning: null,
      failure: null,
    })

    expect(entry.bundleId).toBe("bundle-1")
    expect(entry.events).toBe(events)
    expect(entry.stageDeltas["submitted→processed"]).toBe(1000)
    expect(entry.stageDeltas["processed→confirmed"]).toBe(1500)
    expect(entry.stageDeltas["confirmed→finalized"]).toBe(300)
    expect(typeof entry.writtenAt).toBe("number")
  })

  it("has null stageDeltas for missing stages", () => {
    const events = [makeEvent("submitted", 1000)]

    const entry = createLifecycleLogEntry({
      bundleId: "bundle-1",
      events,
      tipLamports: 1000,
      agentReasoning: null,
      failure: null,
    })

    expect(entry.stageDeltas["submitted→processed"]).toBeNull()
    expect(entry.stageDeltas["processed→confirmed"]).toBeNull()
    expect(entry.stageDeltas["confirmed→finalized"]).toBeNull()
  })
})
