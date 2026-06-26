import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { callRetryAgent } from "@valence/agent"
import type { ValenceConfig } from "@valence/types"
import type { RetryInput } from "@valence/agent"

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
    maxTipLamports: 100000,
    ...overrides,
  }
}

const BASE_INPUT: RetryInput = {
  failureClassification: "expired_blockhash",
  originalTipLamports: 1000,
  originalReasoning: "Minimum tip based on quiet network conditions",
  attemptNumber: 1,
  maxAttempts: 3,
  currentSlot: 5000,
  leaderIdentity: null,
  isJitoLeader: false,
  tipFloorSnapshot: null,
  tipAccount: "96gYZGDn1bYYFCx1JNH7FwwTMyPavFoRjGCYZhVnPEpU",
}

const MOCK_RETRY_RESPONSE = {
  choices: [
    {
      message: {
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify({ shouldRetry: true, tipLamports: 5000, reasoning: "expired_blockhash is recoverable; bumping tip to increase landing probability" }),
            },
          },
        ],
      },
    },
  ],
}

describe("callRetryAgent", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("builds correct tool-use request body for retry agent", async () => {
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
        json: async () => MOCK_RETRY_RESPONSE,
      } as Response
    })

    const config = makeConfig()
    const result = await callRetryAgent(BASE_INPUT, config)

    expect(capturedUrl).toBe("https://api.groq.com/openai/v1/chat/completions")
    expect(capturedHeaders["Authorization"]).toBe("Bearer gsk_test_key")
    expect(capturedHeaders["Content-Type"]).toBe("application/json")

    const body = JSON.parse(capturedBody)
    expect(body.model).toBe("llama-3.1-8b-instant")
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].role).toBe("system")
    expect(body.messages[1].role).toBe("user")
    expect(body.messages[1].content).toContain("expired_blockhash")
    expect(body.messages[1].content).toContain("Attempt number: 1 of 3")
    expect(body.tools).toHaveLength(1)
    expect(body.tools[0].function.name).toBe("decide_retry")
    expect(body.tool_choice).toEqual({ type: "function", function: { name: "decide_retry" } })

    expect(result.shouldRetry).toBe(true)
    expect(result.tipLamports).toBe(5000)
    expect(result.reasoning).toContain("expired_blockhash is recoverable")
  })

  it("parses structured response with shouldRetry: true and new tip", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_RETRY_RESPONSE,
    } as Response)

    const result = await callRetryAgent(BASE_INPUT, makeConfig())

    expect(result.shouldRetry).toBe(true)
    expect(result.tipLamports).toBe(5000)
    expect(result.reasoning).toBe("expired_blockhash is recoverable; bumping tip to increase landing probability")
  })

  it("parses structured response with shouldRetry: false", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify({ shouldRetry: false, tipLamports: 0, reasoning: "compute_exceeded is not recoverable by retrying; giving up" }),
                  },
                },
              ],
            },
          },
        ],
      }),
    } as Response)

    const result = await callRetryAgent(BASE_INPUT, makeConfig())

    expect(result.shouldRetry).toBe(false)
    expect(result.reasoning).toContain("not recoverable")
  })

  it("falls back to hardcoded retry on HTTP error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    } as Response)

    const result = await callRetryAgent(BASE_INPUT, makeConfig())

    expect(result.shouldRetry).toBe(true)
    expect(result.tipLamports).toBe(1000)
    expect(result.reasoning).toContain("fell back to original tip")
  })

  it("falls back to hardcoded retry on timeout", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    )

    const result = await callRetryAgent(BASE_INPUT, makeConfig())

    expect(result.shouldRetry).toBe(true)
    expect(result.tipLamports).toBe(1000)
    expect(result.reasoning).toContain("timed out")
  })
})
