import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { getBundleStatuses, getInflightBundleStatuses } from "@valence/jito"

const MOCK_STATUS_RESPONSE = [
  {
    bundle_id: "bundle-abc-123",
    status: "finalized",
    slot: 428700000,
    timestamp: 1719212345000,
    transactions: [
      { signature: "sig1", slot: 428700000, err: null },
      { signature: "sig2", slot: 428700000, err: null },
    ],
  },
]

const MOCK_INFLIGHT_RESPONSE = [
  {
    bundle_id: "bundle-def-456",
    status: "processed",
    slot: 428700100,
    timestamp: 1719212346000,
  },
]

describe("getBundleStatuses", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("parses a successful response into typed status entries", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: {
          context: { slot: 428700000 },
          value: MOCK_STATUS_RESPONSE,
        },
      }),
    } as Response)

    const statuses = await getBundleStatuses("https://example.com", "bundle-abc-123")

    expect(statuses).toHaveLength(1)
    expect(statuses[0]!.bundle_id).toBe("bundle-abc-123")
    expect(statuses[0]!.status).toBe("finalized")
    expect(statuses[0]!.slot).toBe(428700000)
    expect(statuses[0]!.transactions).toHaveLength(2)
  })

  it("throws on HTTP error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as Response)

    await expect(
      getBundleStatuses("https://example.com", "bundle-abc-123")
    ).rejects.toThrow(/500/)
  })

  it("throws on JSON-RPC error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        error: { message: "bundle not found" },
      }),
    } as Response)

    await expect(
      getBundleStatuses("https://example.com", "bundle-abc-123")
    ).rejects.toThrow(/bundle not found/)
  })

  it("throws on result without context/value wrapper", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: "not-a-valid-result",
      }),
    } as Response)

    await expect(
      getBundleStatuses("https://example.com", "bundle-abc-123")
    ).rejects.toThrow(/unexpected result/)
  })

  it("throws on non-array result.value", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: {
          context: { slot: 0 },
          value: "not-an-array",
        },
      }),
    } as Response)

    await expect(
      getBundleStatuses("https://example.com", "bundle-abc-123")
    ).rejects.toThrow(/unexpected result/)
  })
})

describe("getInflightBundleStatuses", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("parses a successful response into typed entries", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: {
          context: { slot: 428700100 },
          value: MOCK_INFLIGHT_RESPONSE,
        },
      }),
    } as Response)

    const statuses = await getInflightBundleStatuses("https://example.com")

    expect(statuses).toHaveLength(1)
    expect(statuses[0]!.bundle_id).toBe("bundle-def-456")
    expect(statuses[0]!.status).toBe("processed")
  })

  it("throws on HTTP error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    } as Response)

    await expect(
      getInflightBundleStatuses("https://example.com")
    ).rejects.toThrow(/403/)
  })

  it("throws on JSON-RPC error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        error: { message: "unauthorized" },
      }),
    } as Response)

    await expect(
      getInflightBundleStatuses("https://example.com")
    ).rejects.toThrow(/unauthorized/)
  })
})
