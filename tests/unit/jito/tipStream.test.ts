import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createTipFloorStore } from "@valence/jito"

const MOCK_SNAPSHOT_WS = {
  p25: 1000,
  p50: 2000,
  p75: 5000,
  p95: 10000,
  p99: 50000,
  ema50: 2000,
  time: "2026-06-24T12:00:00.000Z",
  fetchedAt: Date.now(),
  source: "ws" as const,
}

const MOCK_SNAPSHOT_REST = {
  p25: 1100,
  p50: 2200,
  p75: 5500,
  p95: 11000,
  p99: 55000,
  ema50: 2200,
  time: "2026-06-24T12:01:00.000Z",
  fetchedAt: Date.now(),
  source: "rest" as const,
}

describe("TipFloorStore", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("get() returns null before any data", () => {
    const store = createTipFloorStore()
    expect(store.get()).toBeNull()
  })

  it("push() stores snapshot and get() returns it", () => {
    const store = createTipFloorStore()
    store.push(MOCK_SNAPSHOT_WS)
    const result = store.get()
    expect(result).toEqual(MOCK_SNAPSHOT_WS)
    expect(result?.source).toBe("ws")
  })

  it("push() overwrites previous snapshot", () => {
    const store = createTipFloorStore()
    store.push(MOCK_SNAPSHOT_WS)
    store.push(MOCK_SNAPSHOT_REST)
    const result = store.get()
    expect(result?.source).toBe("rest")
    expect(result?.p50).toBe(2200)
  })

  it("seed() fetches via REST and stores the snapshot", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          time: "2026-06-24T12:00:00.000Z",
          landed_tips_25th_percentile: 0.000001,
          landed_tips_50th_percentile: 0.000002,
          landed_tips_75th_percentile: 0.000005,
          landed_tips_95th_percentile: 0.00001,
          landed_tips_99th_percentile: 0.00005,
          ema_landed_tips_50th_percentile: 0.000002,
        },
      ],
    } as Response)

    const store = createTipFloorStore()
    await store.seed("https://example.com/tip_floor")

    const result = store.get()
    expect(result).not.toBeNull()
    expect(result!.source).toBe("rest")
    expect(result!.p50).toBe(2000)
  })
})
