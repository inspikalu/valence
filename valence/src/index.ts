import { loadConfig } from "./config/index.js"
import { loadWallet } from "./wallet/index.js"
import { createRpcClient } from "./rpc/index.js"
import { YellowstoneConnection } from "./yellowstone/index.js"
import { fetchLeaderSchedule, LeaderWindowDetector } from "./yellowstone/leader/index.js"
import { SignatureTracker, appendToLog, createLifecycleLogEntry, DEFAULT_LOG_PATH } from "./lifecycle/index.js"
import { Transaction, SystemProgram, sendAndConfirmTransaction, PublicKey } from "@solana/web3.js"
import bs58 from "bs58"
import { createTipFloorStore, getTipAccounts, TipAccountSelector, TipStreamClient, buildSelfTransferBundle, submitBundle, sendViaBlockEngine, getBundleStatuses, getInflightBundleStatuses, classifyFailure, classifyBundleStatus, retryBundleSubmission } from "./jito/index.js"
import type { TipFloorSnapshot } from "./jito/index.js"
import { callTipAgent } from "./agent/index.js"
import type { AgentOutput } from "./agent/index.js"
import type { FailureClassification } from "./types/index.js"
import type { InjectFailureMode } from "./config/index.js"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pollUntilProcessed(
  rpc: ReturnType<typeof createRpcClient>,
  tracker: SignatureTracker,
  sig: string,
): Promise<void> {
  if (tracker.has(sig)) {
    const status = tracker.getStatus(sig)
    if (status && status.firstSeenSlot > BigInt(0)) return
  }
  const connection = rpc.getConnection()
  for (let i = 0; i < 30; i++) {
    await sleep(1_000)
    try {
      const result = await connection.getSignatureStatus(sig, { searchTransactionHistory: false })
      const val = result?.value
      if (val && val.slot) {
        tracker.observe(sig, BigInt(val.slot), "processed")
        return
      }
    } catch {
      // ignore individual poll errors
    }
  }
}

async function pollUntilFinalized(
  rpc: ReturnType<typeof createRpcClient>,
  tracker: SignatureTracker,
  sig: string,
): Promise<void> {
  const connection = rpc.getConnection()
  for (let i = 0; i < 60; i++) {
    await sleep(1_000)
    try {
      const result = await connection.getSignatureStatus(sig, { searchTransactionHistory: false })
      const val = result?.value
      if (val && val.confirmationStatus === "finalized") {
        tracker.observe(sig, BigInt(val.slot), "finalized")
        return
      }
    } catch {
      // ignore individual poll errors
    }
  }
  console.warn(`[bundle] finalized not observed for ${sig.slice(0, 16)}.. within 60s — continuing without finalized`)
}

export async function runBundleSubmission(
  config: ReturnType<typeof loadConfig>,
  wallet: ReturnType<typeof loadWallet>,
  rpc: ReturnType<typeof createRpcClient>,
  tracker: SignatureTracker,
  extras?: {
    tipFloorSnapshot?: TipFloorSnapshot | null
    leaderIdentity?: string | null
    isJitoLeader?: boolean
    injectFailureMode?: InjectFailureMode | null
  },
): Promise<{ success: boolean }> {
  const blockhashCommitment = config.intentionalExpiry ? "finalized" : "processed"
  if (config.intentionalExpiry) {
    console.log("[bundle] INTENTIONAL_EXPIRY enabled — using finalized blockhash to trigger blockhash expiry")
  }
  const freshBlockhash = await rpc.getLatestBlockhash(blockhashCommitment)
  const currentSlot = await rpc.getSlot("processed")
  let bundleFailure: FailureClassification | null = null

  const accounts = await getTipAccounts(config.jitoBlockEngineUrl)
  const selector = new TipAccountSelector(accounts)
  const tipAccount = selector.next()

  let agentOutput: AgentOutput = { tipLamports: config.bundleTipLamports, reasoning: "hardcoded fallback" }

  if (extras?.injectFailureMode === "low_tip") {
    console.log("[volume] injecting low_tip failure — bypassing agent, setting tip to 1 lamport")
    agentOutput = { tipLamports: 1, reasoning: "injected low_tip failure" }
  } else if (config.groqApiKey) {
    try {
      agentOutput = await callTipAgent({
        tipFloorSnapshot: extras?.tipFloorSnapshot ?? null,
        currentSlot,
        leaderIdentity: extras?.leaderIdentity ?? null,
        isJitoLeader: extras?.isJitoLeader ?? false,
        bundleSize: 2,
        tipAccount,
      }, config)
      console.log(`[agent] decided tip=${agentOutput.tipLamports} reasoning="${agentOutput.reasoning}"`)
    } catch (err) {
      console.warn(`[agent] Groq call failed: ${err instanceof Error ? err.message : String(err)} — using minimum tip`)
    }
  }
  if (extras?.injectFailureMode === "expiry") {
    console.log("[volume] injecting expiry failure — using finalized blockhash")
  }

  let tipAmount: number
  if (extras?.injectFailureMode === "low_tip") {
    tipAmount = 1
  } else {
    tipAmount = Math.max(1000, Math.min(config.maxTipLamports, agentOutput.tipLamports))
  }

  const computeUnitLimit = extras?.injectFailureMode === "compute_exceeded" ? 1 : undefined
  if (computeUnitLimit !== undefined) {
    console.log("[volume] injecting compute_exceeded failure — setting computeUnitLimit to 1")
  }

  console.log(`[bundle] building bundle with tip=${tipAmount} lamports to ${tipAccount}`)

  const { bundle, signatures, transactions } = buildSelfTransferBundle(
    wallet,
    tipAccount,
    freshBlockhash.blockhash,
    tipAmount,
    computeUnitLimit,
  )

  console.log(`[bundle] simulating ${transactions.length} transaction(s)...`)
  const connection = rpc.getConnection()
  for (let i = 0; i < transactions.length; i++) {
    const simResult = await connection.simulateTransaction(transactions[i]!)
    const err = simResult.value.err
    if (err) {
      const details = classifyFailure(err)
      const logs = (simResult.value.logs ?? []).join("\n    ")
      console.error(`[bundle] tx[${i}] simulation FAILED:`)
      console.error(`  error: ${JSON.stringify(err)} (classified: ${details.classification})`)
      if (logs) console.error(`  logs:\n    ${logs}`)
      if (config.intentionalExpiry) {
        bundleFailure = details.classification
        console.warn(`[bundle] simulation failed but INTENTIONAL_EXPIRY is active — continuing (failure: ${bundleFailure})`)
        break
      }
      throw new Error(`Transaction ${i} simulation failed: ${JSON.stringify(err)}`)
    }
    const lastLog = simResult.value.logs?.[simResult.value.logs.length - 1] ?? "ok"
    console.log(`[bundle] tx[${i}] simulation passed — ${lastLog}`)
  }

  // Try sendBundle first; if it lands, great. If not, fall back to sendTransaction.
  let landedSig: string | null = null
  let combinedSig: string | undefined

  console.log(`[bundle] submitting via sendBundle...`)
  const bundleId = await submitBundle(config.jitoBlockEngineUrl, bundle)
  tracker.recordSubmitted(bundleId, signatures, tipAmount, currentSlot, agentOutput.reasoning)
  console.log(`[bundle] bundle submitted — id: ${bundleId}, sigs: ${signatures.join(", ")}`)

  // Poll for bundle status
  let pollCount = 0
  for (; pollCount < 20; pollCount++) {
    await sleep(1_250)
    try {
      const inflight = await getInflightBundleStatuses(config.jitoBlockEngineUrl, bundleId)
      for (const s of inflight) {
        console.log(`[bundle] inflight #${pollCount + 1}: ${s.status} landed_slot=${s.landed_slot ?? "n/a"}`)
        if (s.status === "Landed") {
          pollCount = 99
        }
      }
    } catch (err) {
      console.error(`[bundle] status poll error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (pollCount >= 99) {
    // Bundle landed — get final status
    await sleep(1_250)
    const statuses = await getBundleStatuses(config.jitoBlockEngineUrl, bundleId)
    for (const s of statuses) {
      console.log(`[bundle] final bundle status: slot=${s.slot ?? s.landed_slot ?? "n/a"} conf=${s.confirmation_status ?? "n/a"}`)
      // Check for transaction-level errors in the bundle
      if (s.transactions) {
        for (const tx of s.transactions) {
          if (tx.err !== null) {
            const errStr = JSON.stringify(tx.err)
            bundleFailure = classifyFailure(errStr, { slot: tx.slot }).classification
            console.warn(`[bundle] tx ${tx.signature.slice(0, 16)}.. error: ${errStr} (classified: ${bundleFailure})`)
          }
        }
      }
    }
    landedSig = signatures[0]!

    // Poll for processed if gRPC didn't pick it up
    for (const sig of signatures) {
      await pollUntilProcessed(rpc, tracker, sig)
    }

    // Poll for finalized
    for (const sig of signatures) {
      await pollUntilFinalized(rpc, tracker, sig)
    }
  } else {
    // Bundle didn't land — fall back to sendTransaction
    console.log(`[bundle] bundle not landed after ${pollCount * 1.25}s, falling back to sendTransaction...`)

    // Build a single transaction with both self-transfer and tip
    const combinedTx = new Transaction()
    combinedTx.add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: wallet.publicKey,
        lamports: 0,
      }),
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(tipAccount),
        lamports: tipAmount,
      }),
    )
    combinedTx.recentBlockhash = freshBlockhash.blockhash
    combinedTx.feePayer = wallet.publicKey
    combinedTx.sign(wallet)

    const combinedB64 = combinedTx.serialize({ verifySignatures: false }).toString("base64")
    combinedSig = bs58.encode(combinedTx.signature!)
    console.log(`[bundle] submitting via sendTransaction — sig=${combinedSig}`)

    // Simulate before sending
    const simResult = await connection.simulateTransaction(combinedTx)
    if (simResult.value.err) {
      console.error(`[bundle] combined tx simulation FAILED: ${JSON.stringify(simResult.value.err)}`)
      throw new Error(`Combined tx simulation failed: ${JSON.stringify(simResult.value.err)}`)
    }
    console.log(`[bundle] combined tx simulation passed`)

    try {
      await sendViaBlockEngine(config.jitoBlockEngineUrl, combinedB64, combinedSig)
    } catch (err) {
      const details = classifyFailure(err, { slot: currentSlot })
      bundleFailure = details.classification
      console.warn(`[bundle] sendTransaction fallback failed: ${details.classification} — ${details.originalError.slice(0, 120)}`)
      landedSig = null
    }

    if (landedSig) {
      tracker.recordSubmitted("fallback-" + landedSig, [landedSig], tipAmount, currentSlot, agentOutput.reasoning)
    } else {
      tracker.recordSubmitted("fallback-" + combinedSig, [combinedSig], tipAmount, currentSlot, agentOutput.reasoning)
    }

    const finalSigs = [landedSig ?? combinedSig]
    for (const sig of finalSigs) {
      for (let i = 0; i < 60; i++) {
        await sleep(1_000)
        try {
          const status = await connection.getSignatureStatus(sig, { searchTransactionHistory: false })
          const val = status?.value
          if (val) {
            const commitment = val.confirmationStatus ?? "processed"
            tracker.observe(sig, BigInt(val.slot ?? 0), commitment as "processed" | "confirmed" | "finalized")
            console.log(`[bundle] sendTransaction landed: sig=${sig.slice(0, 16)}.. slot=${val.slot} conf=${commitment}`)
            break
          }
        } catch {
          // ignore individual poll errors
        }
      }
      // Poll for processed if not yet observed (gRPC fallback)
      await pollUntilProcessed(rpc, tracker, sig)
      // Poll for finalized
      await pollUntilFinalized(rpc, tracker, sig)
    }

    // If the fallback tx never landed on-chain, classify the failure
    if (!bundleFailure) {
      const sig = landedSig ?? combinedSig
      if (sig) {
        const status = tracker.getStatus(sig)
        if (!status || status.firstSeenSlot === BigInt(0)) {
          bundleFailure = "expired_blockhash"
          console.warn(`[bundle] fallback tx ${sig.slice(0, 16)}.. never observed on-chain — classified: ${bundleFailure}`)
        }
      }
    }
  }

  // Print lifecycle summary
  const usedBundleId = pollCount >= 99
    ? bundleId
    : ("fallback-" + (landedSig ?? combinedSig ?? "unknown"))
  const events = tracker.getBundleEvents(usedBundleId)
  console.log(`[bundle] lifecycle summary (${events.length} events):`)
  for (const event of events) {
    console.log(
      `  ${event.stage}: sig=${event.signature.slice(0, 16)}.. slot=${event.slot} ts=${event.timestamp}`,
    )
  }
  console.log(`[bundle] complete — id: ${usedBundleId}`)

  // Persist lifecycle entry to JSONL log
  const logPath = process.env.LIFECYCLE_LOG_PATH ?? DEFAULT_LOG_PATH
  const entry = createLifecycleLogEntry({
    bundleId: usedBundleId,
    events,
    tipLamports: tipAmount,
    agentReasoning: agentOutput.reasoning,
    failure: bundleFailure,
  })
  await appendToLog(logPath, entry)
  console.log(`[lifecycle] written to ${logPath}`)

  const submissionSuccess = bundleFailure === null

  // Retry logic: if failure detected and retries are enabled, attempt recovery
  if (bundleFailure !== null && config.maxRetries > 0) {
    const retryResult = await retryBundleSubmission(
      config, wallet, rpc, tracker, usedBundleId, bundleFailure,
      tipAmount, agentOutput.reasoning,
      { tipFloorSnapshot: extras?.tipFloorSnapshot ?? null, leaderIdentity: extras?.leaderIdentity ?? null, isJitoLeader: extras?.isJitoLeader ?? false },
    )
    console.log(`[retry] result: ${retryResult.success ? "success" : "failed"} after retries`)

    if (retryResult.success) {
      const retryEvents = tracker.getBundleEvents(retryResult.finalBundleId)
      const retryEventAgentReasoning = retryEvents.find((e) => e.agentReasoning !== null)?.agentReasoning ?? null
      const retryEntry = createLifecycleLogEntry({
        bundleId: retryResult.finalBundleId,
        events: retryEvents,
        tipLamports: tipAmount,
        agentReasoning: retryEventAgentReasoning,
        failure: null,
      })
      await appendToLog(logPath, retryEntry)
      console.log(`[lifecycle] retry entry written to ${logPath}`)
    }
  }

  return { success: submissionSuccess }
}

const FAILURE_CYCLE: InjectFailureMode[] = ["expiry", "low_tip", "compute_exceeded"]

async function runVolumeSubmissions(
  config: ReturnType<typeof loadConfig>,
  wallet: ReturnType<typeof loadWallet>,
  rpc: ReturnType<typeof createRpcClient>,
  tracker: SignatureTracker,
  extras?: {
    tipFloorSnapshot?: TipFloorSnapshot | null
    leaderIdentity?: string | null
    isJitoLeader?: boolean
  },
): Promise<void> {
  let successCount = 0
  let failureCount = 0

  for (let i = 0; i < config.volumeCount; i++) {
    let injectFailureMode: InjectFailureMode | null = null
    if (i > 0) {
      const cycleIndex = (i - 1) % FAILURE_CYCLE.length
      injectFailureMode = FAILURE_CYCLE[cycleIndex]!
    }

    let runConfig = config
    if (injectFailureMode === "expiry") {
      runConfig = { ...config, intentionalExpiry: true }
    }

    console.log(`[volume] submission ${i + 1}/${config.volumeCount} — mode: ${injectFailureMode ?? "clean"}`)
    try {
      const result = await runBundleSubmission(runConfig, wallet, rpc, tracker, {
        ...extras,
        injectFailureMode,
      })
      if (result.success) {
        successCount++
      } else {
        failureCount++
      }
    } catch (err) {
      failureCount++
      console.error(`[volume] submission ${i + 1} threw: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (i < config.volumeCount - 1) {
      console.log(`[volume] sleeping ${config.volumeIntervalMs}ms before next submission...`)
      await sleep(config.volumeIntervalMs)
    }
  }

  console.log(`[volume] complete — ${successCount} succeeded, ${failureCount} failed (out of ${config.volumeCount} submissions)`)
}

async function main() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  const rpc = createRpcClient(config)

  console.log(`Valence stack starting — wallet: ${wallet.publicKey.toBase58()}`)

  const [balance, slot, blockhash] = await Promise.all([
    rpc.getBalance(wallet.publicKey),
    rpc.getSlot(),
    rpc.getLatestBlockhash(),
  ])

  console.log(`Current slot: ${slot}`)
    console.log(`Balance: ${balance / 1e9} SOL`)
  console.log(`Latest blockhash: ${blockhash.blockhash} (valid to slot ~${blockhash.lastValidBlockHeight})`)

  let tipStore: ReturnType<typeof createTipFloorStore> | null = null
  let tipStreamClient: TipStreamClient | null = null

  if (config.showTipData) {
    tipStore = createTipFloorStore((snapshot) => {
      console.log(
        `[jito-tip] ws p25=${snapshot.p25} p50=${snapshot.p50} p75=${snapshot.p75} ` +
        `p95=${snapshot.p95} p99=${snapshot.p99} ema50=${snapshot.ema50} ` +
        `time=${snapshot.time}`
      )
    })

    await tipStore.seed(config.jitoTipFloorUrl)
    const seedSnapshot = tipStore.get()
    if (seedSnapshot) {
      console.log(
        `[jito-tip] seeded — p25=${seedSnapshot.p25} p50=${seedSnapshot.p50} ` +
        `p75=${seedSnapshot.p75} p95=${seedSnapshot.p95} p99=${seedSnapshot.p99} ` +
        `ema50=${seedSnapshot.ema50} time=${seedSnapshot.time}`
      )
    }

    const accounts = await getTipAccounts(config.jitoBlockEngineUrl)
    console.log(`[jito-tip] tip accounts (${accounts.length}): ${accounts.join(", ")}`)

    const selector = new TipAccountSelector(accounts)
    const firstNext = selector.next()
    console.log(`[jito-tip] first selected account: ${firstNext}`)

    tipStreamClient = tipStore.start(
      config.jitoTipStreamUrl,
      config.jitoTipFloorUrl,
      config.jitoTipRestRefreshMs
    )
  }

  if (config.yellowstoneEndpoint) {
    const tracker = new SignatureTracker()
    const yellowstone = new YellowstoneConnection(
      {
        endpoint: config.yellowstoneEndpoint,
        ...(config.yellowstoneGrpcToken ? { xToken: config.yellowstoneGrpcToken } : {}),
      },
      rpc
    )

    yellowstone.setWalletPubkey(wallet.publicKey)

    yellowstone.on("connected", (endpoint) => {
      console.log(`[yellowstone] connected to ${endpoint}`)
      console.log("[yellowstone] transaction subscription active")
    })

    yellowstone.on("reconnecting", (reason, attempt, delayMs) => {
      console.log(
        `[yellowstone] connection lost (reason: ${reason}), retry #${attempt} in ~${delayMs}ms`
      )
    })

    yellowstone.on("slotLog", (slot, timestamp) => {
      console.log(`[yellowstone] slot #${slot} at ${timestamp}`)
    })

    yellowstone.on("latencySample", (grpcSlot, rpcSlot, deltaMs) => {
      console.log(
        `[yellowstone] slot #${grpcSlot} via grpc, #${rpcSlot} via rpc, delta ~${deltaMs}ms`
      )
    })

    yellowstone.on("fromSlotReplay", (fromSlot) => {
      console.log(`[yellowstone] reconnecting with fromSlot=${fromSlot}`)
    })

    yellowstone.on("error", (err) => {
      console.error(`[yellowstone] error: ${err.message}`)
    })

    yellowstone.on("txUpdate", (tx) => {
      const tag = tx.isVote ? "vote" : ""
      tracker.observe(tx.signature, tx.slot, "processed")
      console.log(
        `[tx]${tag ? `[${tag}]` : ""} ${tx.signature} at slot #${tx.slot} ${tx.err ? `err=${JSON.stringify(tx.err)}` : "ok"}`
      )
    })

    yellowstone.on("txStatusUpdate", (tx) => {
      const tag = tx.isVote ? "vote" : ""
      tracker.observe(tx.signature, tx.slot, "confirmed")
      console.log(
        `[tx]${tag ? `[${tag}]` : ""} ${tx.signature} at slot #${tx.slot} ${tx.err ? `err=${JSON.stringify(tx.err)}` : "ok"}`
      )
    })

    try {
      await yellowstone.connect()
    } catch (err) {
      if (!config.sendBundle) {
        throw err
      }

      const message = err instanceof Error ? err.message : String(err)
      console.error(`[yellowstone] connect failed; continuing with Jito status polling only: ${message}`)
      await runBundleSubmission(config, wallet, rpc, tracker, {
        tipFloorSnapshot: tipStore?.get() ?? null,
      })
      console.log("[bundle] done — exiting")
      if (tipStore) tipStore.stop()
      process.exit(0)
    }

    const { schedule, epochStartSlot, jitoCount, jitoKeys } = await fetchLeaderSchedule(
      rpc,
      config.jitoValidatorKeys
    )
    console.log(`[leader] schedule loaded: ${schedule.size} leaders, ${jitoCount} Jito-Solana validators`)

    const detector = new LeaderWindowDetector(yellowstone, schedule, jitoKeys)

    detector.on("leaderDetected", (leader) => {
      console.log(
        `[leader] detected slot #${leader.slot} (${leader.identity}) ${leader.isJito ? "[Jito]" : ""} — detected ${Number(leader.slot - leader.detectedAt)} slots ahead`
      )
    })

    detector.on("leaderEntered", (leader) => {
      console.log(
        `[leader] entered slot #${leader.slot} (${leader.identity}) ${leader.isJito ? "[Jito]" : ""}`
      )
    })

    detector.on("leaderPassed", (leader) => {
      console.log(
        `[leader] passed slot #${leader.slot} (${leader.identity}) ${leader.isJito ? "[Jito]" : ""}`
      )
    })

    detector.on("heartbeat", (window) => {
      if (window.leader.slot !== BigInt(0)) {
        console.log(
          `[leader] slot #${window.currentSlot} | next Jito leader: ${window.leader.identity} in ~${window.estimatedSeconds}s`
        )
      } else {
        console.log(
          `[leader] slot #${window.currentSlot} | no Jito leader within horizon`
        )
      }
    })

    detector.on("horizonAdapted", (horizon, previous) => {
      console.log(
        `[leader] horizon adapted: ~${horizon} slots (was ~${previous})`
      )
    })

    if (config.sendTestTx) {
      const sig = await sendAndConfirmTransaction(
        rpc.getConnection(),
        new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: wallet.publicKey,
            lamports: 0,
          })
        ),
        [wallet],
        { commitment: "finalized" },
      )
      tracker.watch(sig)
      console.log(`[test-tx] confirmed — signature: ${sig}`)
    }

    if (config.sendBundle) {
      if (config.volumeCount > 1) {
        await runVolumeSubmissions(config, wallet, rpc, tracker, {
          tipFloorSnapshot: tipStore?.get() ?? null,
          leaderIdentity: detector.currentLeader,
          isJitoLeader: detector.currentIsJito,
        })
      } else {
        await runBundleSubmission(config, wallet, rpc, tracker, {
          tipFloorSnapshot: tipStore?.get() ?? null,
          leaderIdentity: detector.currentLeader,
          isJitoLeader: detector.currentIsJito,
        })
      }
    }

    const shutdown = async () => {
      console.log("\nShutting down...")
      if (tipStore) tipStore.stop()
      await yellowstone.disconnect()
      process.exit(0)
    }

    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)

    await new Promise(() => {})
  } else {
    if (config.sendBundle) {
      const tracker = new SignatureTracker()
      console.log("[bundle] no YELLOWSTONE_ENDPOINT — bundle status relies on Jito poll only (no gRPC cross-check)")
      if (config.volumeCount > 1) {
        await runVolumeSubmissions(config, wallet, rpc, tracker, {
          tipFloorSnapshot: tipStore?.get() ?? null,
        })
      } else {
        await runBundleSubmission(config, wallet, rpc, tracker, {
          tipFloorSnapshot: tipStore?.get() ?? null,
        })
      }
      console.log("[bundle] done — exiting")
      process.exit(0)
    } else {
      console.log("No YELLOWSTONE_ENDPOINT configured — skipping slot stream.")
      console.log("Set YELLOWSTONE_ENDPOINT in .env to enable gRPC slot streaming.")
      process.exit(0)
    }
  }
}

main().catch((err) => {
  console.error("Fatal startup error:", err)
  process.exit(1)
})
