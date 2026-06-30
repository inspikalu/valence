import { Keypair, VersionedTransaction, Transaction, TransactionMessage, SystemProgram, PublicKey } from "@solana/web3.js"
import bs58 from "bs58"
import { loadConfig } from "../config/index.js"
import { loadWallet } from "../wallet/index.js"
import { createRpcClient } from "../rpc/index.js"
import type { SolanaRpcClient } from "../rpc/index.js"
import { YellowstoneConnection, RawGrpcConnection, isLocalEndpoint } from "../yellowstone/index.js"
import { fetchLeaderSchedule, LeaderWindowDetector } from "../yellowstone/leader/index.js"
import { SignatureTracker, appendToLog, createLifecycleLogEntry, DEFAULT_LOG_PATH } from "../lifecycle/index.js"
import { createTipFloorStore, getTipAccounts, TipAccountSelector, buildSelfTransferTipBundle, buildBundleWithUserTx, submitBundle, sendViaBlockEngine, getInflightBundleStatuses, getBundleStatuses, classifyFailure, classifyBundleStatus, retryBundleSubmission } from "../jito/index.js"
import type { TipFloorSnapshot } from "../jito/index.js"
import { callTipAgent, callRetryAgent, DecisionLedger } from "../agent/index.js"
import type { AgentOutput } from "../agent/types.js"
import type { TxInput, SubmitResult, SubmitOptions, SdkStatus, LifecycleSnapshot } from "./types.js"
import { CongestionOracle } from "../network/congestion.js"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pollUntilProcessed(
  rpc: ReturnType<typeof createRpcClient>,
  tracker: SignatureTracker,
  sig: string,
): Promise<void> {
  return pollSignatureStatus(rpc, tracker, sig, "processed", 30)
}

function pollUntilFinalized(
  rpc: ReturnType<typeof createRpcClient>,
  tracker: SignatureTracker,
  sig: string,
): Promise<void> {
  return pollSignatureStatus(rpc, tracker, sig, "finalized", 60)
}

async function pollSignatureStatus(
  rpc: ReturnType<typeof createRpcClient>,
  tracker: SignatureTracker,
  sig: string,
  target: "processed" | "finalized",
  maxPolls: number,
): Promise<void> {
  if (tracker.has(sig)) {
    const status = tracker.getStatus(sig)
    if (status && status.firstSeenSlot > BigInt(0)) return
  }
  const connection = rpc.getConnection()
  for (let i = 0; i < maxPolls; i++) {
    await sleep(1_000)
    try {
      const result = await connection.getSignatureStatus(sig, { searchTransactionHistory: false })
      const val = result?.value
      if (val && val.slot) {
        const commitment = val.confirmationStatus ?? "processed"
        if (target === "processed") {
          tracker.observe(sig, BigInt(val.slot), "processed")
          return
        }
        if (commitment === "finalized") {
          tracker.observe(sig, BigInt(val.slot), "finalized")
          return
        }
      }
    } catch { }
  }
}

export class Valence {
  private config: ReturnType<typeof loadConfig>
  private wallet: ReturnType<typeof loadWallet>
  private rpc: ReturnType<typeof createRpcClient>
  private tracker: SignatureTracker
  private yellowstone: YellowstoneConnection | null = null
  private detector: LeaderWindowDetector | null = null
  private tipStore: ReturnType<typeof createTipFloorStore> | null = null
  private congestionOracle: CongestionOracle | null = null
  private lastSeenSlot: number | null = null
  private started = false

  constructor(config?: Partial<ReturnType<typeof loadConfig>>) {
    this.config = { ...loadConfig(), ...config }
    this.wallet = loadWallet(this.config)
    this.rpc = createRpcClient(this.config)
    this.tracker = new SignatureTracker()
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true

    console.log(`[valence] starting — wallet: ${this.wallet.publicKey.toBase58()}`)

    const [balance, slot, blockhash] = await Promise.all([
      this.rpc.getBalance(this.wallet.publicKey),
      this.rpc.getSlot(),
      this.rpc.getLatestBlockhash(),
    ])

    console.log(`[valence] slot: ${slot}, balance: ${balance / 1e9} SOL, blockhash: ${blockhash.blockhash}`)

    this.congestionOracle = new CongestionOracle()

    if (this.config.showTipData) {
      this.tipStore = createTipFloorStore()
      await this.tipStore.seed(this.config.jitoTipFloorUrl)
      this.tipStore.start(this.config.jitoTipStreamUrl, this.config.jitoTipFloorUrl, this.config.jitoTipRestRefreshMs)
    }

    if (this.config.yellowstoneEndpoint) {
      const yConfig = {
        endpoint: this.config.yellowstoneEndpoint,
        ...(this.config.yellowstoneGrpcToken ? { xToken: this.config.yellowstoneGrpcToken } : {}),
      }

      if (isLocalEndpoint(this.config.yellowstoneEndpoint)) {
        console.log(`[valence] local endpoint detected — using raw gRPC`)
        this.yellowstone = new RawGrpcConnection(yConfig, this.rpc) as unknown as YellowstoneConnection
      } else {
        this.yellowstone = new YellowstoneConnection(yConfig, this.rpc)
      }

      this.yellowstone.setWalletPubkey(this.wallet.publicKey)

      this.yellowstone.on("slotLog", (slotNum) => {
        this.lastSeenSlot = Number(slotNum)
        this.congestionOracle?.recordSlot(slotNum)
      })

      this.yellowstone.on("txUpdate", (tx) => {
        this.tracker.observe(tx.signature, tx.slot, "processed")
        this.lastSeenSlot = Number(tx.slot)
      })

      this.yellowstone.on("txStatusUpdate", (tx) => {
        this.tracker.observe(tx.signature, tx.slot, "confirmed")
      })

      this.yellowstone.on("slot", (update) => {
        if (update.status === "confirmed") {
          this.tracker.promoteSlot(update.slot, "confirmed")
        } else if (update.status === "root") {
          this.tracker.promoteSlot(update.slot, "finalized")
        }
      })

      try {
        await this.yellowstone.connect()
      } catch (err) {
        console.warn(`[valence] gRPC stream unavailable: ${err instanceof Error ? err.message : String(err)}`)
        console.warn("[valence] continuing without stream — fallback to RPC polling")
        this.yellowstone = null
      }

      if (this.yellowstone) {
        const { schedule, jitoCount, jitoKeys } = await fetchLeaderSchedule(this.rpc, this.config.jitoValidatorKeys)
        console.log(`[valence] leader schedule: ${schedule.size} slots, ${jitoCount} Jito validators`)
        this.detector = new LeaderWindowDetector(this.yellowstone, schedule, jitoKeys, this.config.jitoBlockEngineUrl)
        await this.detector.waitForFirstSlot()
      }
    }
  }

  async submit(input: TxInput, options?: SubmitOptions): Promise<SubmitResult> {
    if (!this.started) {
      await this.start()
    }
    return this.executeSubmit(input, options)
  }

  async getAgentDecision(): Promise<AgentOutput | { error: string }> {
    if (!this.started) {
      await this.start()
    }
    if (!this.config.groqApiKey) {
      return { error: "No GROQ API key configured" }
    }
    try {
      const currentSlot = this.lastSeenSlot ?? await this.rpc.getSlot("processed")
      const accounts = await getTipAccounts(this.config.jitoBlockEngineUrl)
      const selector = new TipAccountSelector(accounts)
      const tipAccount = selector.next()
      const snapshot = this.tipStore?.get() ?? null
      const output = await callTipAgent({
        tipFloorSnapshot: snapshot,
        currentSlot,
        leaderIdentity: this.detector?.currentLeader ?? null,
        isJitoLeader: this.detector?.currentIsJito ?? false,
        bundleSize: 2,
        tipAccount,
      }, this.config)
      return output
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }

  private async executeSubmit(input: TxInput, options?: SubmitOptions): Promise<SubmitResult> {
    const tipCeiling = options?.tipCeilingLamports ?? this.config.maxTipLamports
    const maxRetries = options?.maxRetries ?? this.config.maxRetries
    const logPath = this.config.lifecycleLogPath ?? DEFAULT_LOG_PATH

    const freshBlockhash = await this.rpc.getLatestBlockhash("processed")
    const currentSlot = await this.rpc.getSlot("processed")

    const accounts = await getTipAccounts(this.config.jitoBlockEngineUrl)
    const selector = new TipAccountSelector(accounts)
    const tipAccount = selector.next()

    let tipAmount = this.config.bundleTipLamports
    let agentReasoning = "hardcoded fallback"
    let bundleFailure: string | null = null

    if (this.config.groqApiKey) {
      try {
        const snapshot = this.tipStore?.get() ?? null
        const agentOutput = await callTipAgent({
          tipFloorSnapshot: snapshot,
          currentSlot,
          leaderIdentity: this.detector?.currentLeader ?? null,
          isJitoLeader: this.detector?.currentIsJito ?? false,
          bundleSize: 2,
          tipAccount,
        }, this.config)
        tipAmount = Math.max(1000, Math.min(tipCeiling, agentOutput.tipLamports))
        agentReasoning = agentOutput.reasoning
        console.log(`[sdk] agent tip: ${tipAmount} — "${agentReasoning}"`)
      } catch (err) {
        console.warn(`[sdk] agent unavailable: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const isUserTx = typeof input === "string"
    const { bundle, signatures, transactions } = isUserTx
      ? buildBundleWithUserTx(input, this.wallet, tipAccount, freshBlockhash.blockhash, tipAmount)
      : buildSelfTransferTipBundle(this.wallet, tipAccount, freshBlockhash.blockhash, tipAmount)

    for (let i = 0; i < transactions.length; i++) {
      const sim = await this.rpc.getConnection().simulateTransaction(transactions[i]!)
      if (sim.value.err) {
        bundleFailure = classifyFailure(sim.value.err).classification
        return {
          landed: false,
          signature: null,
          slot: null,
          error: JSON.stringify(sim.value.err),
          failureClass: bundleFailure,
          lifecycle: null,
          agentDecision: null,
        }
      }
    }

    let bundleId: string | undefined
    let bundleLanded = false
    const inWindow = this.detector?.inSubmitWindow ?? true

    if (inWindow) {
      try {
        bundleId = await submitBundle(this.config.jitoBlockEngineUrl, bundle)
      } catch (err) {
        console.warn(`[sdk] sendBundle failed: ${err instanceof Error ? err.message : String(err)}`)
        bundleFailure = classifyFailure(err).classification
      }
    }

    let primarySig = signatures[0]!
    let usedBundleId = bundleId ?? `fallback-${primarySig}`

    if (bundleId) {
      this.tracker.recordSubmitted(bundleId, signatures, tipAmount, currentSlot, agentReasoning)
      console.log(`[sdk] bundle submitted — id: ${bundleId}, sigs: ${signatures.join(", ")}`)

      // Stream-primary: wait for Yellowstone tx events to populate the tracker
      // Slot-level promotion (confirmed via slot status) is wired in start()
      for (let i = 0; i < 20; i++) {
        await sleep(1_250)
        const status = this.tracker.getStatus(primarySig)
        if (status && status.firstSeenSlot > BigInt(0) && status.commitment !== "processed") {
          bundleLanded = true
          break
        }
        // Also check Jito inflight as secondary signal
        try {
          const inflight = await getInflightBundleStatuses(this.config.jitoBlockEngineUrl, bundleId)
          for (const s of inflight) {
            if (s.status === "Landed") { bundleLanded = true; break }
            if (s.status === "Invalid" || s.status === "Failed") { i = 99; break }
          }
        } catch { }
        if (bundleLanded) break
      }

      if (bundleLanded) {
        // Let slot-level promotion from Yellowstone confirm/finalize
        // Wait up to 5s more for stream to catch finalization
        for (let i = 0; i < 5; i++) {
          await sleep(1_000)
          const status = this.tracker.getStatus(primarySig)
          if (status && (status.commitment === "confirmed" || status.commitment === "finalized")) break
        }
      }
    }

    if (!bundleLanded) {
      console.log(`[sdk] bundle not landed via stream, falling back to sendTransaction...`)
      const fallbackSig = await this.submitFallback(freshBlockhash.blockhash, tipAccount, tipAmount, currentSlot)
      if (!fallbackSig) {
        return {
          landed: false, signature: null, slot: null,
          error: "Bundle and fallback both failed",
          failureClass: bundleFailure ?? "bundle_failure",
          lifecycle: null, agentDecision: null,
        }
      }
      usedBundleId = "fallback-" + fallbackSig
      primarySig = fallbackSig!
      this.tracker.recordSubmitted(usedBundleId, [primarySig], tipAmount, currentSlot, agentReasoning)
      // Stream-primary wait for the fallback tx too
      for (let i = 0; i < 10; i++) {
        await sleep(500)
        const status = this.tracker.getStatus(fallbackSig)
        if (status && status.firstSeenSlot > BigInt(0)) { bundleLanded = true; break }
      }
    }

    // Final RPC poll as fallback for any missing stages
    if (this.tracker.getStatus(primarySig)?.commitment !== "finalized") {
      await pollUntilFinalized(this.rpc, this.tracker, primarySig)
    }

    // Write lifecycle log
    const events = this.tracker.getBundleEvents(usedBundleId)
    if (events.length > 0) {
      const entry = createLifecycleLogEntry({
        bundleId: usedBundleId, events,
        tipLamports: tipAmount, agentReasoning,
        failure: bundleFailure as never,
      })
      await appendToLog(logPath, entry)
    }

    return this.buildSuccessResult(usedBundleId, primarySig, currentSlot, tipAmount, agentReasoning)
  }

  private async submitFallback(blockhash: string, tipAccount: string, tipAmount: number, currentSlot?: number): Promise<string | null> {
    const message = new TransactionMessage({
      payerKey: this.wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({ fromPubkey: this.wallet.publicKey, toPubkey: this.wallet.publicKey, lamports: 0 }),
        SystemProgram.transfer({ fromPubkey: this.wallet.publicKey, toPubkey: new PublicKey(tipAccount), lamports: tipAmount }),
      ],
    }).compileToV0Message()
    const tx = new VersionedTransaction(message)
    tx.sign([this.wallet])
    const b64 = Buffer.from(tx.serialize()).toString("base64")
    const sig = bs58.encode(tx.signatures[0]!)

    try {
      await sendViaBlockEngine(this.config.jitoBlockEngineUrl, b64, sig)
    } catch {
      return null
    }

    this.tracker.recordSubmitted("fallback-" + sig, [sig], tipAmount, currentSlot ?? Date.now(), "fallback")

    for (let i = 0; i < 60; i++) {
      await sleep(1_000)
      try {
        const status = await this.rpc.getConnection().getSignatureStatus(sig, { searchTransactionHistory: false })
        if (status?.value) {
          this.tracker.observe(sig, BigInt(status.value.slot ?? 0), (status.value.confirmationStatus ?? "processed") as "processed" | "confirmed" | "finalized")
          for (const level of ["confirmed", "finalized"] as const) {
            if (status.value.confirmationStatus === level || level === "finalized" && status.value.confirmationStatus === "finalized") {
              this.tracker.observe(sig, BigInt(status.value.slot), level)
            }
          }
          return sig
        }
      } catch { }
    }
    return null
  }

  private async pollUntilFinalized(sig: string): Promise<void> {
    for (let i = 0; i < 60; i++) {
      await sleep(1_000)
      try {
        const status = await this.rpc.getConnection().getSignatureStatus(sig, { searchTransactionHistory: false })
        if (status?.value?.confirmationStatus === "finalized") {
          this.tracker.observe(sig, BigInt(status.value.slot), "finalized")
          return
        }
      } catch { }
    }
  }

  private buildSuccessResult(bundleId: string, sig: string, slot: number, tip: number, reasoning: string): SubmitResult {
    const events = this.tracker.getBundleEvents(bundleId)

    const getStage = (stage: string) => {
      const e = events.find((ev) => ev.stage === stage)
      return e ? { slot: e.slot, timestamp: e.timestamp } : null
    }

    return {
      landed: true,
      signature: sig,
      slot: events.find((e) => e.slot > 0)?.slot ?? slot,
      error: null,
      failureClass: null,
      lifecycle: {
        submitted: getStage("submitted"),
        processed: getStage("processed"),
        confirmed: getStage("confirmed"),
        finalized: getStage("finalized"),
        deltasMs: {
          submittedToProcessed: null,
          processedToConfirmed: null,
          confirmedToFinalized: null,
        },
      },
      agentDecision: {
        action: "retry",
        tipLamports: tip,
        reasoning,
        confidence: 1,
      },
    }
  }

  async status(): Promise<SdkStatus> {
    let slot: number | null = null
    try {
      slot = await this.rpc.getSlot()
    } catch { }

    return {
      healthy: true,
      initialized: this.started,
      wallet: this.wallet.publicKey.toBase58(),
      currentSlot: slot,
      streamConnected: this.yellowstone?.isConnected?.() ?? false,
      congestion: this.congestionOracle?.getStatus() ?? null,
    }
  }

  getTracker(): SignatureTracker {
    return this.tracker
  }

  getRpc(): ReturnType<typeof createRpcClient> {
    return this.rpc
  }

  getCongestionOracle(): CongestionOracle | null {
    return this.congestionOracle
  }

  getTipFloorStore(): ReturnType<typeof createTipFloorStore> | null {
    return this.tipStore
  }

  getLeaderDetector(): LeaderWindowDetector | null {
    return this.detector
  }

  getCurrentSlot(): number | null {
    return this.lastSeenSlot
  }

  getYellowstone(): YellowstoneConnection | null {
    return this.yellowstone
  }

  async stop(): Promise<void> {
    if (this.yellowstone) {
      await this.yellowstone.disconnect()
    }
    if (this.tipStore) {
      this.tipStore.stop()
    }
    this.started = false
  }
}
