import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Keypair } from "@solana/web3.js"
import { retryBundleSubmission } from "@valence/jito"
import { SignatureTracker } from "@valence/lifecycle"
import type { ValenceConfig } from "@valence/types"

const TIP_ACCOUNT = "96gYZGDn1bYYFCx1JNH7FwwTMyPavFoRjGCYZhVnPEpU"
const VALID_BLOCKHASH = "11111111111111111111111111111111"
const TEST_BLOCK_ENGINE_URL = "https://test.block-engine.jito.wtf"

describe("retryBundleSubmission integration cycle", () => {
  let config: ValenceConfig
  let wallet: Keypair
  let rpc: ReturnType<typeof createMockRpc>
  let tracker: SignatureTracker

  function createMockConnection() {
    return {
      simulateTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
      getSignatureStatus: vi.fn().mockResolvedValue({ value: { slot: 1000, confirmationStatus: "finalized" } }),
    }
  }

  function createMockRpc(connection?: ReturnType<typeof createMockConnection>) {
    const conn = connection ?? createMockConnection()
    return {
      getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: VALID_BLOCKHASH, lastValidBlockHeight: 3000 }),
      getSlot: vi.fn().mockResolvedValue(1000),
      getConnection: () => conn,
    }
  }

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch")

    wallet = Keypair.generate()
    tracker = new SignatureTracker()
    rpc = createMockRpc()

    config = {
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
      maxRetries: 1,
      groqApiKey: null,
      groqModel: "llama-3.1-8b-instant",
      groqEndpoint: "https://api.groq.com/openai/v1",
      maxTipLamports: 10000,
    }

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
        return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: "retry-bundle-id" }) } as Response
      }
      if (urlStr.includes("/transactions")) {
        return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: "tx-sig" }) } as Response
      }

      return { ok: true, json: async () => ({}) } as Response
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("retries with a fresh blockhash when original submission failed, and retry succeeds with tracker entry", async () => {
    tracker.recordSubmitted("original-id", ["sig1", "sig2"], 1000, 500)

    const result = await retryBundleSubmission(config, wallet, rpc, tracker, "original-id", "expired_blockhash", 1000, "")

    expect(result.success).toBe(true)
    expect(result.finalBundleId).toMatch(/original-id-retry-\d+/)

    const events = tracker.getBundleEvents(result.finalBundleId)
    const submittedEvents = events.filter((e) => e.stage === "submitted")
    expect(submittedEvents.length).toBeGreaterThan(0)
    expect(submittedEvents[0]!.tipLamports).toBe(1000)

    expect(rpc.getLatestBlockhash).toHaveBeenCalledWith("processed")
  }, 30000)
})
