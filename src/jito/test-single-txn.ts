import { Connection, Transaction, SystemProgram, PublicKey } from "@solana/web3.js"
import bs58 from "bs58"
import { loadConfig } from "../config/index.js"
import { loadWallet } from "../wallet/index.js"

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  const conn = new Connection(config.rpcUrl)

  console.log(`Wallet: ${wallet.publicKey.toBase58()}`)

  await sleep(1100)
  const bh = await conn.getLatestBlockhash("processed")
  console.log(`Blockhash: ${bh.blockhash}`)

  // Simple 0-lamport self-transfer (no tip)
  const tx = new Transaction()
  tx.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: wallet.publicKey,
      lamports: 0,
    }),
  )
  tx.recentBlockhash = bh.blockhash
  tx.feePayer = wallet.publicKey
  tx.sign(wallet)

  const b64 = tx.serialize({ verifySignatures: false }).toString("base64")
  const sig = bs58.encode(tx.signature!)
  console.log(`Sig: ${sig}`)

  // sendTransaction via block engine (no bundleOnly)
  const url = "https://mainnet.block-engine.jito.wtf/api/v1/transactions"
  console.log(`\n=== sendTransaction via block engine (no bundleOnly) ===`)
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
  console.log(`x-bundle-id: ${bundleId}`)
  const text = await response.text()
  console.log(`Body: ${text.slice(0, 500)}`)

  // Wait and check on-chain status
  await sleep(15000)
  const status = await conn.getSignatureStatus(sig, { searchTransactionHistory: true })
  console.log(`\nOn-chain status after 15s: ${JSON.stringify(status)}`)
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
