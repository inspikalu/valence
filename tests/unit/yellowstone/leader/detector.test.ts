import { describe, it, expect, vi, beforeEach } from "vitest"
import { EventEmitter } from "node:events"
import { LeaderWindowDetector, resetObservations } from "@valence/yellowstone/leader"
import type { SlotUpdate } from "@valence/yellowstone"
import type { DetectedLeader, LeaderSlot } from "@valence/yellowstone/leader"

function makeSlotUpdate(slot: number, timestamp?: number): SlotUpdate {
  return {
    slot: BigInt(slot),
    parent: BigInt(slot - 1),
    status: "processed",
    timestamp: timestamp ?? Date.now(),
  }
}

class FakeYellowstone extends EventEmitter {
  emitSlot(slot: number, timestamp?: number): void {
    this.emit("slot", makeSlotUpdate(slot, timestamp))
  }
}

const JITO_KEYS = ["jito1", "jito2"]

beforeEach(() => {
  resetObservations()
})

function makeSchedule(): Map<bigint, string> {
  const s = new Map<bigint, string>()
  s.set(BigInt(100), "val1")
  s.set(BigInt(101), "val1")
  s.set(BigInt(102), "val1")
  s.set(BigInt(103), "jito1")
  s.set(BigInt(104), "val2")
  s.set(BigInt(105), "val2")
  s.set(BigInt(106), "jito2")
  s.set(BigInt(107), "val3")
  s.set(BigInt(108), "val3")
  s.set(BigInt(109), "val3")
  return s
}

describe("LeaderWindowDetector", () => {
  it("detects leaders within horizon boundary", () => {
    const yellowstone = new FakeYellowstone()
    const detector = new LeaderWindowDetector(
      yellowstone as any,
      makeSchedule(),
      JITO_KEYS
    )

    const detected: DetectedLeader[] = []
    detector.on("leaderDetected", (l) => detected.push(l))

    yellowstone.emitSlot(100, 0)
    yellowstone.emitSlot(101, 400)

    expect(detected.length).toBeGreaterThan(0)

    const jitoDetections = detected.filter((d) => d.isJito)
    expect(jitoDetections.length).toBeGreaterThan(0)
    expect(jitoDetections[0]!.identity).toBe("jito1")
  })

  it("does not detect the same leader slot twice", () => {
    const yellowstone = new FakeYellowstone()
    const detector = new LeaderWindowDetector(
      yellowstone as any,
      makeSchedule(),
      JITO_KEYS
    )

    const detected: DetectedLeader[] = []
    detector.on("leaderDetected", (l) => detected.push(l))

    yellowstone.emitSlot(100, 0)
    yellowstone.emitSlot(101, 400)
    yellowstone.emitSlot(102, 800)

    const detectionsPerSlot = new Map<string, number>()
    for (const d of detected) {
      const key = `${d.slot}`
      detectionsPerSlot.set(key, (detectionsPerSlot.get(key) ?? 0) + 1)
    }

    for (const count of detectionsPerSlot.values()) {
      expect(count).toBe(1)
    }
  })

  it("fires leaderEntered at the correct slot", () => {
    const yellowstone = new FakeYellowstone()
    const detector = new LeaderWindowDetector(
      yellowstone as any,
      makeSchedule(),
      JITO_KEYS
    )

    const entered: LeaderSlot[] = []
    detector.on("leaderEntered", (l) => entered.push(l))

    yellowstone.emitSlot(100, 0)
    yellowstone.emitSlot(101, 400)
    yellowstone.emitSlot(102, 800)
    yellowstone.emitSlot(103, 1200)

    const jitoEntered = entered.filter((e) => e.isJito)
    expect(jitoEntered.length).toBe(1)
    expect(jitoEntered[0]!.slot).toBe(BigInt(103))
    expect(jitoEntered[0]!.identity).toBe("jito1")
  })

  it("fires leaderPassed after the leader slot", () => {
    const yellowstone = new FakeYellowstone()
    const detector = new LeaderWindowDetector(
      yellowstone as any,
      makeSchedule(),
      JITO_KEYS
    )

    const passed: LeaderSlot[] = []
    detector.on("leaderPassed", (l) => passed.push(l))

    yellowstone.emitSlot(100, 0)
    yellowstone.emitSlot(101, 400)
    yellowstone.emitSlot(102, 800)
    yellowstone.emitSlot(103, 1200)
    yellowstone.emitSlot(104, 1600)

    const jitoPassed = passed.filter((p) => p.isJito)
    expect(jitoPassed.length).toBe(1)
    expect(jitoPassed[0]!.slot).toBe(BigInt(103))
    expect(jitoPassed[0]!.identity).toBe("jito1")
  })

  it("emits heartbeat every slot", () => {
    const yellowstone = new FakeYellowstone()
    const detector = new LeaderWindowDetector(
      yellowstone as any,
      makeSchedule(),
      JITO_KEYS
    )

    const heartbeats: any[] = []
    detector.on("heartbeat", (w) => heartbeats.push(w))

    yellowstone.emitSlot(100, 0)
    yellowstone.emitSlot(101, 400)

    expect(heartbeats.length).toBe(2)
    expect(heartbeats[0]!.currentSlot).toBe(BigInt(100))
  })

  it("shows no Jito leader when none within horizon", () => {
    const s = new Map<bigint, string>()
    s.set(BigInt(100), "val1")
    s.set(BigInt(101), "val1")
    s.set(BigInt(102), "val1")

    const yellowstone = new FakeYellowstone()
    const detector = new LeaderWindowDetector(yellowstone as any, s, ["jito1"])

    const heartbeats: any[] = []
    detector.on("heartbeat", (w) => heartbeats.push(w))

    yellowstone.emitSlot(100, 0)

    expect(heartbeats[0]!.leader.slot).toBe(BigInt(0))
    expect(heartbeats[0]!.leader.identity).toBe("")
  })
})
