import { describe, it, expect } from "vitest"
import { ReconnectBackoff } from "@valence/yellowstone"

describe("ReconnectBackoff", () => {
  it("delays increase exponentially up to the cap", () => {
    const backoff = new ReconnectBackoff()
    const delays: number[] = []
    for (let i = 0; i < 10; i++) {
      delays.push(backoff.getDelay())
    }

    expect(delays[0]).toBeGreaterThanOrEqual(750)
    expect(delays[0]).toBeLessThanOrEqual(1250)

    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1] * 0.75)
    }

    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(30_000)
    }
  })

  it("jitter produces values within ±25% of the computed delay", () => {
    const backoff = new ReconnectBackoff()
    for (let i = 0; i < 100; i++) {
      backoff.reset()
      const delay = backoff.getDelay()
      const baseMax = 1_000
      const lowerBound = Math.floor(baseMax * 0.75)
      const upperBound = Math.ceil(baseMax * 1.25)
      expect(delay).toBeGreaterThanOrEqual(lowerBound)
      expect(delay).toBeLessThanOrEqual(upperBound)
    }
  })

  it("reset() returns attempt counter to 0 and delay to base", () => {
    const backoff = new ReconnectBackoff()
    backoff.getDelay()
    backoff.getDelay()
    expect(backoff.attempt).toBe(2)

    backoff.reset()
    expect(backoff.attempt).toBe(0)

    const delay = backoff.getDelay()
    expect(delay).toBeGreaterThanOrEqual(750)
    expect(delay).toBeLessThanOrEqual(1250)
  })

  it("multiple getDelay calls increment the attempt counter", () => {
    const backoff = new ReconnectBackoff()
    expect(backoff.attempt).toBe(0)

    backoff.getDelay()
    expect(backoff.attempt).toBe(1)

    backoff.getDelay()
    expect(backoff.attempt).toBe(2)

    backoff.getDelay()
    expect(backoff.attempt).toBe(3)
  })
})
