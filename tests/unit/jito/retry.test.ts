import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Keypair } from "@solana/web3.js"
import { retryBundleSubmission } from "@valence/jito"
import { SignatureTracker } from "@valence/lifecycle"
import type { ValenceConfig, FailureClassification } from "@valence/types"

const TIP_ACCOUNT = "96gYZGDn1bYYFCx1JNH7FwwTMyPavFoRjGCYZhVnPEpU"
const VALID_BLOCKHASH = "11111111111111111111111111111111"
const TEST_BLOCK_ENGINE_URL = "https://test.block-engine.jito.wtf"

function baseConfig(overrides?: Partial<ValenceConfig>): ValenceConfig {
  return {
    rpcUrl: "https://test.rpc.com",
    privateKey: null,
    keypairFile: null,
    logLevel: "info",
    yellowstoneEndpoint: null,
    yellowstoneGrpcToken: null,
    jitoValidatorKeys: [],
    leaderHeartbeatInterval: 1,
    sendTestTx: false,
    showTipData: false,
    jitoTipFloorUrl: "https://test.tip.floor",
    jitoTipStreamUrl: "wss://test.tip.stream",
    jitoBlockEngineUrl: TEST_BLOCK_ENGINE_URL,
    jitoTipRestRefreshMs: 10000,
    sendBundle: true,
    bundleTipLamports: 1000,
    lifecycleLogPath: null,
    intentionalExpiry: false,
    maxRetries: 3,
    groqApiKey: null,
    groqModel: "llama-3.1-8b-instant",
    groqEndpoint: "https://api.groq.com/openai/v1",
    maxTipLamports: 10000,
    ...overrides,
  }
}

function mockConnection() {
  return {
    simulateTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
    getSignatureStatus: vi.fn().mockResolvedValue({ value: { slot: 1000, confirmationStatus: "finalized" } }),
  }
}

function mockRpc(connection?: ReturnType<typeof mockConnection>) {
  const conn = connection ?? mockConnection()
  return {
    getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: VALID_BLOCKHASH, lastValidBlockHeight: 2000 }),
    getSlot: vi.fn().mockResolvedValue(1000),
    getConnection: () => conn,
  }
}

function mockFetchForSuccess(): void {
  vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url.toString()
    if (urlStr.includes("/getTipAccounts")) {
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: [TIP_ACCOUNT] }) } as Response
    }
    if (urlStr.includes("/getBundleStatuses")) {
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: { context: { slot: 0 }, value: [] } }) } as Response
    }
    if (urlStr.includes("/getInflightBundleStatuses")) {
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: { context: { slot: 0 }, value: [{ status: "Landed", bundle_id: "test-bundle" }] } }) } as Response
    }
    if (urlStr.includes("/bundles") && !urlStr.includes("Status")) {
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: "test-bundle-id" }) } as Response
    }
    if (urlStr.includes("/transactions")) {
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: "tx-sig" }) } as Response
    }
    return { ok: true, json: async () => ({}) } as Response
  })
}

function mockFetchForExhaustion(): void {
  vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url.toString()

    if (urlStr.includes("/getTipAccounts")) {
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: [TIP_ACCOUNT] }) } as Response
    }
    // Fail submitBundle AND sendViaBlockEngine so retry exhausts all attempts
    if (urlStr.includes("/bundles") && !urlStr.includes("Status")) {
      return { ok: false, status: 500, statusText: "Server Error", text: async () => "server error" } as unknown as Response
    }
    if (urlStr.includes("/api/v1/transactions")) {
      return { ok: false, status: 500, statusText: "Server Error", text: async () => "server error" } as unknown as Response
    }
    return { ok: true, json: async () => ({}) } as Response
  })
}

describe("retryBundleSubmission", () => {
  let wallet: Keypair
  let tracker: SignatureTracker

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch")
    wallet = Keypair.generate()
    tracker = new SignatureTracker()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns success immediately when failure is null", async () => {
    const config = baseConfig()
    const rpc = mockRpc()

    const result = await retryBundleSubmission(config, wallet, rpc, tracker, "original-id", null, 1000, "")

    expect(result.success).toBe(true)
    expect(result.finalBundleId).toBe("original-id")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("returns success immediately when maxRetries === 0", async () => {
    const config = baseConfig({ maxRetries: 0 })
    const rpc = mockRpc()

    const result = await retryBundleSubmission(config, wallet, rpc, tracker, "original-id", "expired_blockhash", 1000, "")

    expect(result.success).toBe(true)
    expect(result.finalBundleId).toBe("original-id")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("builds bundle with fresh blockhash and succeeds on retry", async () => {
    const config = baseConfig({ maxRetries: 3 })
    const connection = mockConnection()
    const rpc = mockRpc(connection)

    tracker.recordSubmitted("original-id", ["sig1", "sig2"], 1000, 500)
    mockFetchForSuccess()

    const result = await retryBundleSubmission(config, wallet, rpc, tracker, "original-id", "expired_blockhash", 1000, "test reasoning")

    expect(result.success).toBe(true)
    expect(result.finalBundleId).toMatch(/original-id-retry-\d+/)
    expect(rpc.getLatestBlockhash).toHaveBeenCalledWith("processed")

    const events = tracker.getBundleEvents(result.finalBundleId)
    const submittedEvents = events.filter((e) => e.stage === "submitted")
    expect(submittedEvents.length).toBeGreaterThan(0)
  }, 30000)

  it("exhausts all retry attempts and returns failure when submission consistently fails", async () => {
    const config = baseConfig({ maxRetries: 2 })
    const connection = mockConnection()
    const rpc = mockRpc(connection)

    tracker.recordSubmitted("original-id", ["sig1", "sig2"], 1000, 500)
    mockFetchForExhaustion()

    const result = await retryBundleSubmission(config, wallet, rpc, tracker, "original-id", "expired_blockhash", 1000, "")

    expect(result.success).toBe(false)
    expect(result.finalBundleId).toMatch(/original-id-retry-2/)
    expect(rpc.getLatestBlockhash).toHaveBeenCalledWith("processed")
  }, 30000)

  it("falls back to hardcoded retry when groqApiKey is null", async () => {
    const config = baseConfig({ maxRetries: 2 })
    const connection = mockConnection()
    const rpc = mockRpc(connection)

    tracker.recordSubmitted("original-id", ["sig1", "sig2"], 1000, 500)
    mockFetchForSuccess()

    const result = await retryBundleSubmission(config, wallet, rpc, tracker, "original-id", "expired_blockhash", 1000, "")

    expect(result.success).toBe(true)
    expect(result.finalBundleId).toMatch(/original-id-retry-\d+/)

    const events = tracker.getBundleEvents(result.finalBundleId)
    const submittedEvents = events.filter((e) => e.stage === "submitted")
    expect(submittedEvents.length).toBeGreaterThan(0)
    expect(submittedEvents[0]!.agentReasoning).toContain("No Groq API key")
  }, 30000)
})
