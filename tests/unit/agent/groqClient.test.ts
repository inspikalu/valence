import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { callTipAgent } from "@valence/agent"
import type { ValenceConfig } from "@valence/types"

function makeConfig(overrides?: Partial<ValenceConfig>): ValenceConfig {
  return {
    rpcUrl: "https://api.mainnet-beta.solana.com",
    privateKey: null,
    keypairFile: null,
    logLevel: "info",
    yellowstoneEndpoint: null,
    yellowstoneGrpcToken: null,
    jitoValidatorKeys: [],
    leaderHeartbeatInterval: 1,
    sendTestTx: false,
    showTipData: false,
    jitoTipFloorUrl: "https://bundles.jito.wtf/api/v1/bundles/tip_floor",
    jitoTipStreamUrl: "wss://bundles.jito.wtf/api/v1/bundles/tip_stream",
    jitoBlockEngineUrl: "https://mainnet.block-engine.jito.wtf",
    jitoTipRestRefreshMs: 10000,
    sendBundle: false,
    bundleTipLamports: 1000,
    lifecycleLogPath: null,
    intentionalExpiry: false,
    maxRetries: 3,
    groqApiKey: "gsk_test_key",
    groqModel: "llama-3.1-8b-instant",
    groqEndpoint: "https://api.groq.com/openai/v1",
    maxTipLamports: 10000,
    ...overrides,
  }
}

const BASE_INPUT = {
  tipFloorSnapshot: null,
  currentSlot: 500,
  leaderIdentity: null,
  isJitoLeader: false,
  bundleSize: 2,
  tipAccount: "96gYZGDn1bYYFCx1JNH7FwwTMyPavFoRjGCYZhVnPEpU",
}

const MOCK_SUCCESS_RESPONSE = {
  choices: [
    {
      message: {
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify({ tipLamports: 5000, reasoning: "P50 tip floor is moderate; submitting with conservative tip" }),
            },
          },
        ],
      },
    },
  ],
}

describe("callTipAgent", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("builds correct tool-use request body", async () => {
    let capturedUrl = ""
    let capturedHeaders: Record<string, string> = {}
    let capturedBody = ""

    vi.mocked(fetch).mockImplementationOnce(async (url, opts) => {
      const req = opts as RequestInit
      capturedUrl = url as string
      capturedHeaders = req.headers as Record<string, string>
      capturedBody = req.body as string
      return {
        ok: true,
        json: async () => MOCK_SUCCESS_RESPONSE,
      } as Response
    })

    const config = makeConfig()
    const result = await callTipAgent(BASE_INPUT, config)

    expect(capturedUrl).toBe("https://api.groq.com/openai/v1/chat/completions")
    expect(capturedHeaders["Authorization"]).toBe("Bearer gsk_test_key")
    expect(capturedHeaders["Content-Type"]).toBe("application/json")

    const body = JSON.parse(capturedBody)
    expect(body.model).toBe("llama-3.1-8b-instant")
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].role).toBe("system")
    expect(body.messages[1].role).toBe("user")
    expect(body.messages[1].content).toContain("Current slot: 500")
    expect(body.tools).toHaveLength(1)
    expect(body.tools[0].function.name).toBe("decide_tip")
    expect(body.tool_choice).toEqual({ type: "function", function: { name: "decide_tip" } })

    expect(result.tipLamports).toBe(5000)
    expect(result.reasoning).toContain("conservative tip")
  })

  it("parses valid Groq structured response into AgentOutput", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_SUCCESS_RESPONSE,
    } as Response)

    const result = await callTipAgent(BASE_INPUT, makeConfig())

    expect(result.tipLamports).toBe(5000)
    expect(result.reasoning).toBe("P50 tip floor is moderate; submitting with conservative tip")
  })

  it("falls back to minimum tip on HTTP error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    } as Response)

    const result = await callTipAgent(BASE_INPUT, makeConfig())

    expect(result.tipLamports).toBe(1000)
    expect(result.reasoning).toContain("fell back to minimum tip")
  })

  it("falls back to minimum tip on rate limit (429) after retry", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "Too Many Requests",
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "Still rate limited",
      } as Response)

    const result = await callTipAgent(BASE_INPUT, makeConfig())

    expect(result.tipLamports).toBe(1000)
    expect(result.reasoning).toContain("rate-limited")
  })

  it("retries once on 429 and returns result on second attempt", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "Too Many Requests",
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_SUCCESS_RESPONSE,
      } as Response)

    const result = await callTipAgent(BASE_INPUT, makeConfig())

    expect(result.tipLamports).toBe(5000)
    expect(result.reasoning).toContain("conservative tip")
  })

  it("falls back to minimum tip on network error (abort/timeout)", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    )

    const result = await callTipAgent(BASE_INPUT, makeConfig())

    expect(result.tipLamports).toBe(1000)
    expect(result.reasoning).toContain("timed out")
  })

  it("falls back to minimum tip on generic network error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"))

    const result = await callTipAgent(BASE_INPUT, makeConfig())

    expect(result.tipLamports).toBe(1000)
    expect(result.reasoning).toContain("unavailable")
  })
})
