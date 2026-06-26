import { Connection, Transaction, SystemProgram, PublicKey } from "@solana/web3.js"
import { loadConfig } from "../config/index.js"
import { loadWallet } from "../wallet/index.js"
import { createRpcClient } from "../rpc/index.js"
import { submitBundle, getBundleStatuses, getInflightBundleStatuses, getTipAccounts, TipAccountSelector, buildSelfTransferBundle } from "./index.js"
import bs58 from "bs58"

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  const rpc = createRpcClient(config)

  const rawBal = await rpc.getBalance(wallet.publicKey)
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`)
  console.log(`Balance: ${rawBal} lamports (${rawBal / 1e9} SOL)`)

  // Test 1: Send a regular self-transfer via RPC to verify wallet works
  console.log(`\n--- Test 1: Regular self-transfer via RPC ---`)
  const bh1 = await rpc.getLatestBlockhash("processed")
  const tx1 = new Transaction()
  tx1.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: wallet.publicKey,
      lamports: 0,
    }),
  )
  tx1.recentBlockhash = bh1.blockhash
  tx1.feePayer = wallet.publicKey
  tx1.sign(wallet)

  const sig1 = await rpc.getConnection().sendRawTransaction(tx1.serialize(), { skipPreflight: false })
  console.log(`Sent raw tx: ${sig1}`)

  await sleep(10000)
  const status1 = await rpc.getConnection().getSignatureStatus(sig1, { searchTransactionHistory: true })
  console.log(`Status: ${JSON.stringify(status1)}`)

  // Test 2: Single-transaction bundle with tip (self-transfer + tip in one tx)
  console.log(`\n--- Test 2: Single-tx bundle with tip ---`)
  await sleep(1100)
  const bh2 = await rpc.getLatestBlockhash("processed")
  const accounts2 = await getTipAccounts(config.jitoBlockEngineUrl)
  const selector2 = new TipAccountSelector(accounts2)
  const tipAccount2 = selector2.next()
  const tx2 = new Transaction()
  tx2.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: wallet.publicKey,
      lamports: 0,
    }),
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: new PublicKey(tipAccount2),
      lamports: config.bundleTipLamports,
    }),
  )
  tx2.recentBlockhash = bh2.blockhash
  tx2.feePayer = wallet.publicKey
  tx2.sign(wallet)

  const b642 = tx2.serialize({ verifySignatures: false }).toString("base64")
  const bid2 = await submitBundle(config.jitoBlockEngineUrl, [b642])
  console.log(`Bundle ID: ${bid2}`)
  console.log(`Signature: ${bs58.encode(tx2.signature!)}`)

  await sleep(3000)
  const ibs2 = await getInflightBundleStatuses(config.jitoBlockEngineUrl, bid2)
  console.log(`Inflight status: ${JSON.stringify(ibs2)}`)
  const bs2 = await getBundleStatuses(config.jitoBlockEngineUrl, bid2)
  console.log(`Bundle status: ${JSON.stringify(bs2)}`)

  // Test 3: Two-tx bundle (self-transfer + tip, no compute budget)
  console.log(`\n--- Test 3: Two-tx bundle with tip ---`)
  await sleep(1100)
  const bh3 = await rpc.getLatestBlockhash("processed")
  const accounts3 = await getTipAccounts(config.jitoBlockEngineUrl)
  const selector3 = new TipAccountSelector(accounts3)
  const tipAccount3 = selector3.next()
  const { bundle: bundle3, signatures: sigs3 } = buildSelfTransferBundle(
    wallet, tipAccount3, bh3.blockhash, config.bundleTipLamports,
  )
  const bid3 = await submitBundle(config.jitoBlockEngineUrl, bundle3)
  console.log(`Bundle ID: ${bid3}`)
  console.log(`Signatures: ${sigs3.join(", ")}`)

  await sleep(3000)
  const ibs3 = await getInflightBundleStatuses(config.jitoBlockEngineUrl, bid3)
  console.log(`Inflight status: ${JSON.stringify(ibs3)}`)
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
