import { Connection, PublicKey, Transaction, SystemProgram, ComputeBudgetProgram, Keypair } from "@solana/web3.js"
import { JitoJsonRpcClient } from "jito-js-rpc"
import { loadConfig } from "../config/index.js"
import { loadWallet } from "../wallet/index.js"
import { createRpcClient } from "../rpc/index.js"
import { getBundleStatuses, getInflightBundleStatuses, submitBundle, buildSelfTransferBundle, getTipAccounts, TipAccountSelector } from "./index.js"
import bs58 from "bs58"

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function testAllApproaches() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  const rpc = createRpcClient(config)

  const balance = await rpc.getBalance(wallet.publicKey)
  console.log(`\nWallet: ${wallet.publicKey.toBase58()}`)
  console.log(`Balance: ${balance / 1e9} SOL`)

  const freshBlockhash = await rpc.getLatestBlockhash("processed")
  console.log(`Blockhash: ${freshBlockhash.blockhash}`)

  const accounts = await getTipAccounts(config.jitoBlockEngineUrl)
  const selector = new TipAccountSelector(accounts)
  const tipAccount = selector.next()
  console.log(`Tip account: ${tipAccount}`)

  // Approach 1: Two-transaction bundle (our code)
  console.log(`\n=== Approach 1: Two-tx bundle (current code) ===`)
  const { bundle, signatures } = buildSelfTransferBundle(
    wallet,
    tipAccount,
    freshBlockhash.blockhash,
    config.bundleTipLamports,
  )
  console.log(`Signatures: ${signatures.join(", ")}`)

  await sleep(1100)
  const bundleId1 = await submitBundle(config.jitoBlockEngineUrl, bundle)
  console.log(`Bundle ID 1: ${bundleId1}`)
  console.log(`Explorer: https://explorer.jito.wtf/bundle/${bundleId1}`)

  await sleep(2000)
  try {
    const statuses = await getBundleStatuses(config.jitoBlockEngineUrl, bundleId1)
    console.log(`getBundleStatuses: ${JSON.stringify(statuses)}`)
  } catch (e) {
    console.log(`getBundleStatuses error: ${e instanceof Error ? e.message : e}`)
  }

  // Approach 2: Single-transaction bundle (self-transfer + tip in one tx)
  console.log(`\n=== Approach 2: Single-tx bundle ===`)
  const tx = new Transaction()
  tx.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: wallet.publicKey,
      lamports: 0,
    }),
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: new PublicKey(tipAccount),
      lamports: config.bundleTipLamports,
    }),
  )
  tx.recentBlockhash = freshBlockhash.blockhash
  tx.feePayer = wallet.publicKey
  tx.sign(wallet)

  const serialized = tx.serialize({ verifySignatures: false })
  const b64 = Buffer.from(serialized).toString("base64")
  const sig2 = bs58.encode(tx.signature!)
  console.log(`Signature: ${sig2}`)

  await sleep(1100)
  const bundleId2 = await submitBundle(config.jitoBlockEngineUrl, [b64])
  console.log(`Bundle ID 2: ${bundleId2}`)
  console.log(`Explorer: https://explorer.jito.wtf/bundle/${bundleId2}`)

  await sleep(2000)
  try {
    const statuses = await getBundleStatuses(config.jitoBlockEngineUrl, bundleId2)
    console.log(`getBundleStatuses: ${JSON.stringify(statuses)}`)
  } catch (e) {
    console.log(`getBundleStatuses error: ${e instanceof Error ? e.message : e}`)
  }

  // Now poll both bundle IDs
  console.log(`\n=== Polling both bundles (90 second loop) ===`)
  for (let i = 0; i < 45; i++) {
    await sleep(2000)
    for (const [label, bid] of [["two-tx", bundleId1], ["single-tx", bundleId2]] as const) {
      try {
        await sleep(50)
        const statuses = await getBundleStatuses(config.jitoBlockEngineUrl, bid)
        if (statuses.length > 0) {
          console.log(`[${label}] getBundleStatuses: ${JSON.stringify(statuses)}`)
        }
      } catch (e) {
        // ignore
      }
      try {
        await sleep(50)
        const inflight = await getInflightBundleStatuses(config.jitoBlockEngineUrl, bid)
        if (inflight.length > 0) {
          console.log(`[${label}] inflight: ${JSON.stringify(inflight)}`)
        }
      } catch (e) {
        // ignore
      }
    }
  }

  const finalBalance = await rpc.getBalance(wallet.publicKey)
  console.log(`\nFinal balance: ${finalBalance / 1e9} SOL`)
  console.log(`Balance change: ${(finalBalance - balance) / 1e9} SOL`)
}

testAllApproaches().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
