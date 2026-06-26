import { Keypair, Transaction, SystemProgram, PublicKey } from "@solana/web3.js"
import bs58 from "bs58"
import type { ValenceConfig, FailureClassification } from "../types/index.js"
import type { SolanaRpcClient } from "../rpc/index.js"
import { SignatureTracker } from "../lifecycle/index.js"
import { buildSelfTransferBundle } from "./bundle.js"
import { submitBundle, sendViaBlockEngine } from "./submission.js"
import { getInflightBundleStatuses, getBundleStatuses } from "./bundleStatus.js"
import { classifyFailure } from "./failureClassifier.js"
import { getTipAccounts, TipAccountSelector } from "./tipAccounts.js"
import { callRetryAgent } from "../agent/index.js"
import type { RetryExtras } from "../agent/index.js"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pollUntilProcessed(
  rpc: SolanaRpcClient,
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
    }
  }
}

async function pollUntilFinalized(
  rpc: SolanaRpcClient,
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
    }
  }
}

export interface RetryResult {
  success: boolean
  finalBundleId: string
}

export async function retryBundleSubmission(
  config: ValenceConfig,
  wallet: Keypair,
  rpc: SolanaRpcClient,
  tracker: SignatureTracker,
  originalBundleId: string,
  failure: FailureClassification | null,
  originalTipLamports: number,
  initialReasoning: string,
  extras?: RetryExtras,
): Promise<RetryResult> {
  if (failure === null || config.maxRetries === 0) {
    return { success: true, finalBundleId: originalBundleId }
  }

  const connection = rpc.getConnection()
  let lastAttemptId = originalBundleId
  let currentFailure: FailureClassification = failure

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    const retryBundleId = `${originalBundleId}-retry-${attempt}`
    lastAttemptId = retryBundleId

    console.log(`[retry] attempt ${attempt}/${config.maxRetries} — id: ${retryBundleId}`)

    const currentSlot = await rpc.getSlot("processed")

    const accounts = await getTipAccounts(config.jitoBlockEngineUrl)
    const selector = new TipAccountSelector(accounts)
    const tipAccount = selector.next()

    let agentOutput: { shouldRetry: boolean; tipLamports: number; reasoning: string }
    if (config.groqApiKey) {
      try {
        agentOutput = await callRetryAgent({
          failureClassification: currentFailure,
          originalTipLamports,
          originalReasoning: initialReasoning,
          attemptNumber: attempt,
          maxAttempts: config.maxRetries,
          currentSlot,
          leaderIdentity: extras?.leaderIdentity ?? null,
          isJitoLeader: extras?.isJitoLeader ?? false,
          tipFloorSnapshot: extras?.tipFloorSnapshot ?? null,
          tipAccount,
        }, config)
        console.log(`[retry-agent] decision: shouldRetry=${agentOutput.shouldRetry} tip=${agentOutput.tipLamports} reasoning="${agentOutput.reasoning}"`)
      } catch (err) {
        console.warn(`[retry-agent] call failed: ${err instanceof Error ? err.message : String(err)} — using hardcoded retry`)
        agentOutput = { shouldRetry: true, tipLamports: originalTipLamports, reasoning: "Agent call failed — falling back to original tip" }
      }
    } else {
      console.log(`[retry] no groqApiKey — using hardcoded retry with original tip ${originalTipLamports}`)
      agentOutput = { shouldRetry: true, tipLamports: originalTipLamports, reasoning: "No Groq API key — hardcoded retry" }
    }

    if (!agentOutput.shouldRetry) {
      console.log(`[retry] agent decided NOT to retry — ${agentOutput.reasoning}`)
      return { success: false, finalBundleId: lastAttemptId }
    }

    const clampedTip = Math.max(1000, Math.min(config.maxTipLamports, agentOutput.tipLamports))

    const freshBlockhash = await rpc.getLatestBlockhash("processed")
    console.log(`[retry] fresh blockhash: ${freshBlockhash.blockhash}`)

    await sleep(1_000)

    const { bundle, signatures, transactions } = buildSelfTransferBundle(
      wallet,
      tipAccount,
      freshBlockhash.blockhash,
      clampedTip,
    )

    let simulationFailed = false
    for (let i = 0; i < transactions.length; i++) {
      const simResult = await connection.simulateTransaction(transactions[i]!)
      const err = simResult.value.err
      if (err) {
        const details = classifyFailure(err)
        console.warn(`[retry] tx[${i}] simulation FAILED: ${details.classification}`)
        simulationFailed = true
        currentFailure = details.classification
        break
      }
    }
    if (simulationFailed) {
      console.warn(`[retry] simulation failed on attempt ${attempt}, continuing...`)
      continue
    }

    console.log(`[retry] submitting via sendBundle...`)
    let bundleId: string
    try {
      bundleId = await submitBundle(config.jitoBlockEngineUrl, bundle)
    } catch (err) {
      const details = classifyFailure(err)
      console.warn(`[retry] submitBundle failed: ${details.classification} — ${details.originalError.slice(0, 120)}`)
      currentFailure = details.classification
      continue
    }
    tracker.recordSubmitted(retryBundleId, signatures, clampedTip, currentSlot, agentOutput.reasoning)
    console.log(`[retry] bundle submitted — id: ${bundleId}, sigs: ${signatures.join(", ")}`)

    let pollCount = 0
    for (; pollCount < 20; pollCount++) {
      await sleep(1_250)
      try {
        const inflight = await getInflightBundleStatuses(config.jitoBlockEngineUrl, bundleId)
        for (const s of inflight) {
          console.log(`[retry] inflight #${pollCount + 1}: ${s.status} landed_slot=${s.landed_slot ?? "n/a"}`)
          if (s.status === "Landed") {
            pollCount = 99
          }
        }
      } catch (err) {
        console.error(`[retry] status poll error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (pollCount >= 99) {
      await sleep(1_250)
      const statuses = await getBundleStatuses(config.jitoBlockEngineUrl, bundleId)
      for (const s of statuses) {
        if (s.transactions) {
          for (const tx of s.transactions) {
            if (tx.err !== null) {
              const details = classifyFailure(tx.err)
              console.warn(`[retry] tx ${tx.signature.slice(0, 16)}.. error: ${details.classification}`)
            }
          }
        }
      }

      for (const sig of signatures) {
        await pollUntilProcessed(rpc, tracker, sig)
      }
      for (const sig of signatures) {
        await pollUntilFinalized(rpc, tracker, sig)
      }

      console.log(`[retry] bundle landed on attempt ${attempt}`)
      return { success: true, finalBundleId: retryBundleId }
    }

    console.log(`[retry] bundle not landed, falling back to sendTransaction...`)

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
        lamports: clampedTip,
      }),
    )
    combinedTx.recentBlockhash = freshBlockhash.blockhash
    combinedTx.feePayer = wallet.publicKey
    combinedTx.sign(wallet)

    const combinedB64 = combinedTx.serialize({ verifySignatures: false }).toString("base64")
    const combinedSig = bs58.encode(combinedTx.signature!)
    console.log(`[retry] submitting via sendTransaction — sig=${combinedSig}`)

    const simResult = await connection.simulateTransaction(combinedTx)
    if (simResult.value.err) {
      console.warn(`[retry] combined tx simulation FAILED: ${JSON.stringify(simResult.value.err)}`)
      continue
    }

    try {
      await sendViaBlockEngine(config.jitoBlockEngineUrl, combinedB64, combinedSig)
    } catch (err) {
      const details = classifyFailure(err, { slot: currentSlot })
      console.warn(`[retry] sendTransaction fallback failed: ${details.classification} — ${details.originalError.slice(0, 120)}`)
      currentFailure = details.classification
      continue
    }

    tracker.recordSubmitted("retry-fallback-" + combinedSig, [combinedSig], clampedTip, currentSlot, agentOutput.reasoning)

    let fallbackLanded = false
    for (let i = 0; i < 60; i++) {
      await sleep(1_000)
      try {
        const status = await connection.getSignatureStatus(combinedSig, { searchTransactionHistory: false })
        const val = status?.value
        if (val) {
          const commitment = val.confirmationStatus ?? "processed"
          tracker.observe(combinedSig, BigInt(val.slot ?? 0), commitment as "processed" | "confirmed" | "finalized")
          console.log(`[retry] sendTransaction landed: sig=${combinedSig.slice(0, 16)}.. slot=${val.slot} conf=${commitment}`)
          fallbackLanded = true
          break
        }
      } catch {
      }
    }

    await pollUntilProcessed(rpc, tracker, combinedSig)
    await pollUntilFinalized(rpc, tracker, combinedSig)

    if (fallbackLanded) {
      console.log(`[retry] sendTransaction succeeded on attempt ${attempt}`)
      return { success: true, finalBundleId: retryBundleId }
    }

    currentFailure = "expired_blockhash"
    console.warn(`[retry] attempt ${attempt} exhausted — neither sendBundle nor sendTransaction landed`)
  }

  console.log(`[retry] all ${config.maxRetries} attempts exhausted — returning failure`)
  return { success: false, finalBundleId: lastAttemptId }
}
