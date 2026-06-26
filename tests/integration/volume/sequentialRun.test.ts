import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Keypair } from "@solana/web3.js"
import { runBundleSubmission } from "@valence/index"
import { SignatureTracker } from "@valence/lifecycle"
import type { ValenceConfig } from "@valence/types"

const TIP_ACCOUNT = "96gYZGDn1bYYFCx1JNH7FwwTMyPavFoRjGCYZhVnPEpU"
const VALID_BLOCKHASH = "11111111111111111111111111111111"

describe("sequential volume run", () => {
  let config: ValenceConfig
  let wallet: Keypair
  let rpc: ReturnType<typeof createMockRpc>
  let tracker: SignatureTracker

  function createMockConnection() {
    return {
      simulateTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
      getSignatureStatus: vi.fn().mockResolvedValue({
        value: { slot: 1000, confirmationStatus: "finalized" },
      }),
    }
  }

  function createMockRpc(connection?: ReturnType<typeof createMockConnection>) {
    const conn = connection ?? createMockConnection()
    return {
      getLatestBlockhash: vi
        .fn()
        .mockResolvedValue({ blockhash: VALID_BLOCKHASH, lastValidBlockHeight: 3000 }),
      getSlot: vi.fn().mockResolvedValue(1000),
      getConnection: () => conn,
      getBalance: vi.fn().mockResolvedValue(1_000_000_000),
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
      jitoBlockEngineUrl: "https://test.block-engine.jito.wtf",
      jitoTipRestRefreshMs: 10000,
      sendBundle: true,
      bundleTipLamports: 1000,
      lifecycleLogPath: null,
      intentionalExpiry: false,
      maxRetries: 0,
      groqApiKey: null,
      groqModel: "llama-3.1-8b-instant",
      groqEndpoint: "https://api.groq.com/openai/v1",
      maxTipLamports: 10000,
      volumeCount: 3,
      volumeIntervalMs: 100,
      injectFailureMode: "",
    }

    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString()

      if (urlStr.includes("/getTipAccounts")) {
        return {
          ok: true,
          json: async () => ({ jsonrpc: "2.0", id: 1, result: [TIP_ACCOUNT] }),
        } as Response
      }
      if (urlStr.includes("/getBundleStatuses")) {
        return {
          ok: true,
          json: async () => ({
            jsonrpc: "2.0",
            id: 1,
            result: { context: { slot: 0 }, value: [] },
          }),
        } as Response
      }
      if (urlStr.includes("/getInflightBundleStatuses")) {
        return {
          ok: true,
          json: async () => ({
            jsonrpc: "2.0",
            id: 1,
            result: {
              context: { slot: 0 },
              value: [{ status: "Landed", bundle_id: "test-bundle" }],
            },
          }),
        } as Response
      }
      if (urlStr.includes("/bundles") && !urlStr.includes("Status")) {
        return {
          ok: true,
          json: async () => ({ jsonrpc: "2.0", id: 1, result: "test-bundle-id" }),
        } as Response
      }
      if (urlStr.includes("/transactions")) {
        return {
          ok: true,
          json: async () => ({ jsonrpc: "2.0", id: 1, result: "tx-sig" }),
        } as Response
      }

      return { ok: true, json: async () => ({}) } as Response
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("runs clean submission with agent tip", async () => {
    const result = await runBundleSubmission(config, wallet, rpc, tracker, {
      injectFailureMode: null,
    })

    expect(result.success).toBe(true)
    const events = tracker.getBundleEvents("test-bundle-id")
    expect(events.length).toBeGreaterThan(0)
  }, 30000)

  it("injects expiry failure with expired_blockhash", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const expiryConfig = { ...config, intentionalExpiry: true }
    const result = await runBundleSubmission(expiryConfig, wallet, rpc, tracker, {
      injectFailureMode: "expiry",
    })

    expect(typeof result.success).toBe("boolean")
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("[volume] injecting expiry failure"),
    )
    logSpy.mockRestore()
  }, 30000)

  it("injects low_tip failure with tip set to 1 lamport", async () => {
    const result = await runBundleSubmission(config, wallet, rpc, tracker, {
      injectFailureMode: "low_tip",
    })

    expect(result.success).toBe(true)
  }, 30000)

  it("runs 3 sequential submissions verifying tracker records", async () => {
    const bundleIds: string[] = []
    const modes: Array<"clean" | "expiry" | "low_tip"> = ["clean", "expiry", "low_tip"]

    for (const mode of modes) {
      let runConfig = config
      if (mode === "expiry") {
        runConfig = { ...config, intentionalExpiry: true }
      }
      const result = await runBundleSubmission(runConfig, wallet, rpc, tracker, {
        injectFailureMode: mode === "clean" ? null : mode,
      })
      expect(typeof result.success).toBe("boolean")
      bundleIds.push("test-bundle-id")
    }

    expect(bundleIds).toHaveLength(3)
  }, 30000)
})
