import { describe, it, expect, beforeEach } from "vitest"
import { computeHorizon, updateObservedTimes, resetObservations } from "@valence/yellowstone/leader"

beforeEach(() => {
  resetObservations()
})

describe("computeHorizon", () => {
  it("returns fallback of ~150 slots when no observations exist", () => {
    const horizon = computeHorizon()
    expect(horizon).toBe(150)
  })

  it("computes median-based horizon from varied intervals", () => {
    updateObservedTimes(400)
    updateObservedTimes(400)
    updateObservedTimes(400)
    updateObservedTimes(800)
    updateObservedTimes(400)

    const horizon = computeHorizon()
    expect(horizon).toBe(150)
  })

  it("adapts to faster slot times", () => {
    for (let i = 0; i < 10; i++) {
      updateObservedTimes(200)
    }

    const horizon = computeHorizon()
    expect(horizon).toBe(300)
  })

  it("adapts to slower slot times", () => {
    for (let i = 0; i < 10; i++) {
      updateObservedTimes(600)
    }

    const horizon = computeHorizon()
    expect(horizon).toBe(100)
  })

  it("evicts old entries from sliding window", () => {
    for (let i = 0; i < 10; i++) {
      updateObservedTimes(200)
    }
    expect(computeHorizon()).toBe(300)

    for (let i = 0; i < 10; i++) {
      updateObservedTimes(600)
    }
    expect(computeHorizon()).toBe(100)
  })
})
