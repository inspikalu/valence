import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { callTipAgent } from "@valence/agent"
import type { ValenceConfig } from "@valence/types"
import type { TipFloorSnapshot } from "@valence/types"

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

const MOCK_TIP_FLOOR: TipFloorSnapshot = {
  p25: 1000,
  p50: 2000,
  p75: 5000,
  p95: 10000,
  p99: 50000,
  ema50: 2500,
  time: "2026-06-26T12:00:00.000Z",
  fetchedAt: Date.now(),
  source: "rest",
}

describe("tip decision integration cycle", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("uses tip-floor snapshot and leader context to decide a clamped tip", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify({
                      tipLamports: 5000,
                      reasoning: "P75 is 5000 lamports and next leader is Jito; moderate tip to ensure landing",
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    } as Response)

    const config = makeConfig({ maxTipLamports: 3000 })
    const result = await callTipAgent(
      {
        tipFloorSnapshot: MOCK_TIP_FLOOR,
        currentSlot: 12345,
        leaderIdentity: "JitoValidatorPubkey11111111111111111111111111111",
        isJitoLeader: true,
        bundleSize: 2,
        tipAccount: "96gYZGDn1bYYFCx1JNH7FwwTMyPavFoRjGCYZhVnPEpU",
      },
      config,
    )

    expect(result.tipLamports).toBeGreaterThanOrEqual(1000)
    expect(result.tipLamports).toBeLessThanOrEqual(3000)
    expect(result.reasoning).toBeTruthy()
    expect(typeof result.reasoning).toBe("string")
    expect(result.reasoning.length).toBeGreaterThan(0)
  })

  it("clamps to minimum when agent returns below floor", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify({
                      tipLamports: 100,
                      reasoning: "Network is quiet; minimum tip should suffice",
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    } as Response)

    const result = await callTipAgent(
      {
        tipFloorSnapshot: null,
        currentSlot: 999,
        leaderIdentity: null,
        isJitoLeader: false,
        bundleSize: 2,
        tipAccount: "96gYZGDn1bYYFCx1JNH7FwwTMyPavFoRjGCYZhVnPEpU",
      },
      makeConfig({ maxTipLamports: 10000 }),
    )

    expect(result.tipLamports).toBe(1000)
    expect(result.reasoning).toBeTruthy()
  })
})
