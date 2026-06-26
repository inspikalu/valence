import { Connection, Transaction, SystemProgram, PublicKey } from "@solana/web3.js"
import bs58 from "bs58"
import { loadConfig } from "../config/index.js"
import { loadWallet } from "../wallet/index.js"
import { getTipAccounts, TipAccountSelector, getInflightBundleStatuses } from "./index.js"

const BLOCK_ENGINE = "https://mainnet.block-engine.jito.wtf"

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  const conn = new Connection(config.rpcUrl)

  console.log(`Wallet: ${wallet.publicKey.toBase58()}`)

  const accounts = await getTipAccounts(BLOCK_ENGINE)
  const selector = new TipAccountSelector(accounts)
  const tipAccount = selector.next()
  console.log(`Tip account: ${tipAccount}`)

  await sleep(1100)
  const bh = await conn.getLatestBlockhash("processed")
  console.log(`Blockhash: ${bh.blockhash}`)

  // Build a single tx with self-transfer + tip
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
  tx.recentBlockhash = bh.blockhash
  tx.feePayer = wallet.publicKey
  tx.sign(wallet)

  const b64 = tx.serialize({ verifySignatures: false }).toString("base64")
  const sig = tx.signature ? bs58.encode(tx.signature) : "unknown"

  // Try sendTransaction with bundleOnly=true via block engine
  const url = `${BLOCK_ENGINE}/api/v1/transactions?bundleOnly=true`
  console.log(`\n=== sendTransaction with bundleOnly=true ===`)
  console.log(`URL: ${url}`)
  console.log(`Sig: ${sig}`)

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: [b64, { encoding: "base64" }],
    }),
  })

  console.log(`HTTP ${response.status}`)
  const bundleId = response.headers.get("x-bundle-id")
  console.log(`x-bundle-id header: ${bundleId}`)

  const text = await response.text()
  console.log(`Body: ${text.slice(0, 500)}`)

  if (bundleId) {
    await sleep(5000)
    const ibs = await getInflightBundleStatuses(BLOCK_ENGINE, bundleId)
    console.log(`Inflight status: ${JSON.stringify(ibs)}`)
  }

  // Also try: get the tx signature from RPC to see if it landed
  await sleep(5000)
  try {
    const status = await conn.getSignatureStatus(sig, { searchTransactionHistory: true })
    console.log(`\nOn-chain status: ${JSON.stringify(status)}`)
  } catch (e: any) {
    console.log(`On-chain status check error: ${e.message}`)
  }
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
