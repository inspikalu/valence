import { Connection, Transaction, SystemProgram, PublicKey } from "@solana/web3.js"
import { loadConfig } from "../config/index.js"
import { loadWallet } from "../wallet/index.js"
import { getTipAccounts, TipAccountSelector } from "./index.js"

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  const conn = new Connection(config.rpcUrl)

  console.log(`Wallet: ${wallet.publicKey.toBase58()}`)

  // Get tip accounts
  const accounts = await getTipAccounts(config.jitoBlockEngineUrl)
  const selector = new TipAccountSelector(accounts)
  const tipAccount = selector.next()
  console.log(`Tip account: ${tipAccount}`)

  // Get fresh blockhash
  const bh = await conn.getLatestBlockhash("processed")
  console.log(`Blockhash: ${bh.blockhash}`)

  // Build and simulate the tip transaction
  const tipTx = new Transaction()
  tipTx.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: new PublicKey(tipAccount),
      lamports: config.bundleTipLamports,
    }),
  )
  tipTx.recentBlockhash = bh.blockhash
  tipTx.feePayer = wallet.publicKey
  tipTx.sign(wallet)

  const simResult = await conn.simulateTransaction(tipTx)
  console.log(`\nTip tx simulation:`)
  console.log(`  Error: ${simResult.value.err || "none (success)"}`)
  console.log(`  Logs: ${(simResult.value.logs || []).slice(0, 5).join(" | ")}`)
  console.log(`  Units consumed: ${simResult.value.unitsConsumed}`)

  // Also simulate the self-transfer
  const selfTx = new Transaction()
  selfTx.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: wallet.publicKey,
      lamports: 0,
    }),
  )
  selfTx.recentBlockhash = bh.blockhash
  selfTx.feePayer = wallet.publicKey
  selfTx.sign(wallet)

  const simResult2 = await conn.simulateTransaction(selfTx)
  console.log(`\nSelf-transfer tx simulation:`)
  console.log(`  Error: ${simResult2.value.err || "none (success)"}`)
  console.log(`  Logs: ${(simResult2.value.logs || []).slice(0, 5).join(" | ")}`)

  // Simulate a combined tx (self + tip)
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
      lamports: config.bundleTipLamports,
    }),
  )
  combinedTx.recentBlockhash = bh.blockhash
  combinedTx.feePayer = wallet.publicKey
  combinedTx.sign(wallet)

  await sleep(1100)
  const simResult3 = await conn.simulateTransaction(combinedTx)
  console.log(`\nCombined tx (self + tip) simulation:`)
  console.log(`  Error: ${simResult3.value.err || "none (success)"}`)
  console.log(`  Logs: ${(simResult3.value.logs || []).slice(0, 5).join(" | ")}`)
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
