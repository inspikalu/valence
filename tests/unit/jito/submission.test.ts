import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { submitBundle } from "@valence/jito"

const MOCK_BUNDLE_TXS = ["base64tx1", "base64tx2"]
const MOCK_BUNDLE_ID = "bundle-abc-123"

describe("submitBundle", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("POSTs to the block engine URL with correct JSON-RPC body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: MOCK_BUNDLE_ID,
      }),
    } as Response)

    const result = await submitBundle("https://example.com", MOCK_BUNDLE_TXS)

    expect(fetch).toHaveBeenCalledWith("https://example.com/api/v1/bundles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendBundle",
        params: [MOCK_BUNDLE_TXS, { encoding: "base64" }],
      }),
    })
    expect(result).toBe(MOCK_BUNDLE_ID)
  })

  it("parses successful response into bundle ID string", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: MOCK_BUNDLE_ID,
      }),
    } as Response)

    const bundleId = await submitBundle("https://example.com/bundles", MOCK_BUNDLE_TXS)
    expect(bundleId).toBe(MOCK_BUNDLE_ID)
    expect(typeof bundleId).toBe("string")
  })

  it("throws on HTTP error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "server error",
    } as unknown as Response)

    await expect(
      submitBundle("https://example.com", MOCK_BUNDLE_TXS)
    ).rejects.toThrow(/500/)
  })

  it("throws on JSON-RPC error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        error: { message: "tip too low" },
      }),
    } as Response)

    await expect(
      submitBundle("https://example.com", MOCK_BUNDLE_TXS)
    ).rejects.toThrow(/tip too low/)
  })

  it("throws on unexpected result shape", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: ["not-a-string"],
      }),
    } as Response)

    await expect(
      submitBundle("https://example.com", MOCK_BUNDLE_TXS)
    ).rejects.toThrow(/unexpected result/)
  })
})
