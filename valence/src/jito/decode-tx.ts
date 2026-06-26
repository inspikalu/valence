import { Transaction, SystemProgram, PublicKey } from "@solana/web3.js"
import { loadConfig } from "../config/index.js"
import { loadWallet } from "../wallet/index.js"
import { createRpcClient } from "../rpc/index.js"
import { getTipAccounts, TipAccountSelector } from "./index.js"
import bs58 from "bs58"

async function main() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  const rpc = createRpcClient(config)

  const bh = await rpc.getLatestBlockhash("processed")
  const accounts = await getTipAccounts(config.jitoBlockEngineUrl)
  const selector = new TipAccountSelector(accounts)
  const tipAccount = selector.next()
  const tipPubkey = new PublicKey(tipAccount)

  // Build transaction matching our bundle.ts approach
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
  const b64Default = tx.serialize().toString("base64")

  console.log("Wallet:", wallet.publicKey.toBase58())
  console.log("Blockhash:", bh.blockhash)
  console.log("Signature:", bs58.encode(tx.signature!))
  console.log("Same b64 with both serialization methods:", b64 === b64Default)
  console.log("Base64 length:", b64.length)

  // Decode and inspect the transaction
  const decoded = Transaction.from(Buffer.from(b64, "base64"))
  console.log("\nDecoded tx:")
  console.log("  Signatures:", decoded.signatures.length)
  for (const s of decoded.signatures) {
    console.log(`    pubkey: ${s.publicKey?.toBase58()}, sig: ${s.signature ? bs58.encode(s.signature) : "null"}`)
  }
  console.log("  Fee payer:", decoded.feePayer?.toBase58())
  console.log("  Recent blockhash:", decoded.recentBlockhash)
  console.log("  Instructions:", decoded.instructions.length)
  for (const ix of decoded.instructions) {
    console.log(`    program: ${ix.programId.toBase58()}, data: ${ix.data.toString("hex")}, keys: ${ix.keys.length}`)
  }
  const message = decoded.serializeMessage()
  console.log("  Message buffer length:", message.length)

  // Also check the tip account is one of Jito's known accounts
  console.log("\nTip account:", tipAccount)
  console.log("Is tip account in known list:", accounts.includes(tipAccount))

  // Now try to simulate the tx via RPC
  try {
    const simResult = await rpc.getConnection().simulateTransaction(tx)
    console.log("\nSimulation:", JSON.stringify(simResult.value, null, 2))
  } catch (e) {
    console.log("\nSimulation error:", e instanceof Error ? e.message : e)
  }

  // Check wallet balance
  const bal = await rpc.getBalance(wallet.publicKey)
  console.log("\nWallet balance:", bal, "lamports")
  console.log("Tip amount:", config.bundleTipLamports, "lamports")
  console.log("Sufficient:", bal > config.bundleTipLamports + 5000)
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
