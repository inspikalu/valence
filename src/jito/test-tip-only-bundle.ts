import { Connection, Transaction, SystemProgram, PublicKey } from "@solana/web3.js"
import bs58 from "bs58"
import { loadConfig } from "../config/index.js"
import { loadWallet } from "../wallet/index.js"
import { getTipAccounts, TipAccountSelector, submitBundle, getInflightBundleStatuses } from "./index.js"

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  const conn = new Connection(config.rpcUrl)

  console.log(`Wallet: ${wallet.publicKey.toBase58()}`)

  const accounts = await getTipAccounts(config.jitoBlockEngineUrl)
  const selector = new TipAccountSelector(accounts)
  const tipAccount = selector.next()
  console.log(`Tip account: ${tipAccount}`)

  // Just a simple tip-only transaction in a bundle
  await sleep(1100)
  const bh = await conn.getLatestBlockhash("processed")
  console.log(`Blockhash: ${bh.blockhash}`)

  const tx = new Transaction()
  tx.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: new PublicKey(tipAccount),
      lamports: config.bundleTipLamports,
    }),
  )
  tx.recentBlockhash = bh.blockhash
  tx.feePayer = wallet.publicKey
  tx.sign(wallet)

  // Try serializing WITHOUT verifySignatures: false
  const b64 = tx.serialize({ requireAllSignatures: true, verifySignatures: true }).toString("base64")

  console.log(`\n=== Test: Tip-only bundle (single tx) ===`)
  console.log(`Tip: ${config.bundleTipLamports} lamports`)

  const bid = await submitBundle(config.jitoBlockEngineUrl, [b64])
  console.log(`Bundle ID: ${bid}`)

  await sleep(5000)
  const ibs = await getInflightBundleStatuses(config.jitoBlockEngineUrl, bid)
  console.log(`Inflight status: ${JSON.stringify(ibs)}`)

  // Check on-chain
  const sig = tx.signature ? bs58.encode(tx.signature) : "unknown"
  await sleep(5000)
  const status = await conn.getSignatureStatus(sig, { searchTransactionHistory: true })
  console.log(`\nOn-chain status: ${JSON.stringify(status)}`)
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
