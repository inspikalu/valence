import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fetchTipFloor } from "@valence/jito"

const MOCK_ARRAY_RESPONSE = [
  {
    time: "2026-06-24T12:00:00.000Z",
    landed_tips_25th_percentile: 0.000001,
    landed_tips_50th_percentile: 0.000002,
    landed_tips_75th_percentile: 0.000005,
    landed_tips_95th_percentile: 0.00001,
    landed_tips_99th_percentile: 0.00005,
    ema_landed_tips_50th_percentile: 0.000002,
  },
]

const MOCK_OBJECT_RESPONSE = {
  time: "2026-06-24T12:00:00.000Z",
  landed_tips_25th_percentile: 0.000001,
  landed_tips_50th_percentile: 0.000002,
  landed_tips_75th_percentile: 0.000005,
  landed_tips_95th_percentile: 0.00001,
  landed_tips_99th_percentile: 0.00005,
  ema_landed_tips_50th_percentile: 0.000002,
}

describe("fetchTipFloor", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("parses an array response and converts SOL to lamports", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_ARRAY_RESPONSE,
    } as Response)

    const snapshot = await fetchTipFloor("https://example.com/tip_floor")

    expect(snapshot.p25).toBe(1000)
    expect(snapshot.p50).toBe(2000)
    expect(snapshot.p75).toBe(5000)
    expect(snapshot.p95).toBe(10000)
    expect(snapshot.p99).toBe(50000)
    expect(snapshot.ema50).toBe(2000)
    expect(snapshot.time).toBe("2026-06-24T12:00:00.000Z")
    expect(snapshot.source).toBe("rest")
    expect(typeof snapshot.fetchedAt).toBe("number")
  })

  it("parses a bare-object response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_OBJECT_RESPONSE,
    } as Response)

    const snapshot = await fetchTipFloor("https://example.com/tip_floor")

    expect(snapshot.p50).toBe(2000)
    expect(snapshot.source).toBe("rest")
  })

  it("throws on HTTP error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    } as Response)

    await expect(
      fetchTipFloor("https://example.com/tip_floor")
    ).rejects.toThrow(/429/)
  })

  it("handles missing fields by defaulting to 0", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [{}],
    } as Response)

    const snapshot = await fetchTipFloor("https://example.com/tip_floor")

    expect(snapshot.p25).toBe(0)
    expect(snapshot.p50).toBe(0)
    expect(snapshot.ema50).toBe(0)
  })
})
