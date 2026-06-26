import { Connection, PublicKey, Transaction, SystemProgram, TransactionInstruction } from "@solana/web3.js"
import { JitoJsonRpcClient } from "jito-js-rpc"
import { loadConfig } from "../config/index.js"
import { loadWallet } from "../wallet/index.js"
import { createRpcClient } from "../rpc/index.js"
import { submitBundle, getInflightBundleStatuses, getBundleStatuses, getTipAccounts, TipAccountSelector } from "./index.js"
import bs58 from "bs58"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  const rpc = createRpcClient(config)

  const balance = await rpc.getBalance(wallet.publicKey)
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`)
  console.log(`Balance: ${balance} lamports (${balance / 1e9} SOL)`)

  const bh = await rpc.getLatestBlockhash()
  console.log(`Blockhash: ${bh.blockhash}`)

  const accounts = await getTipAccounts(config.jitoBlockEngineUrl)
  const selector = new TipAccountSelector(accounts)
  const tipAddress = selector.next()
  const jitoTipAccount = new PublicKey(tipAddress)
  console.log(`Tip account: ${tipAddress}`)

  // Exact SDK example pattern: transfer + tip + memo in one transaction
  const memoProgramId = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")
  const transaction = new Transaction()
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: wallet.publicKey,
      lamports: 0,
    }),
  )
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: jitoTipAccount,
      lamports: config.bundleTipLamports,
    }),
  )
  transaction.add(
    new TransactionInstruction({
      keys: [],
      programId: memoProgramId,
      data: Buffer.from("Hello, Jito!"),
    }),
  )
  transaction.recentBlockhash = bh.blockhash
  transaction.feePayer = wallet.publicKey
  transaction.sign(wallet)

  const serialized = transaction.serialize({ verifySignatures: false })
  const b64 = Buffer.from(serialized).toString("base64")
  const sig = bs58.encode(transaction.signature!)
  console.log(`Signature: ${sig}`)

  try {
    await sleep(1100)
    const bundleId = await submitBundle(config.jitoBlockEngineUrl, [b64])
    console.log(`\nBundle ID: ${bundleId}`)
    console.log(`Explorer: https://explorer.jito.wtf/bundle/${bundleId}`)

    for (let i = 0; i < 60; i++) {
      await sleep(2000)
      const inflight = await getInflightBundleStatuses(config.jitoBlockEngineUrl, bundleId)
      if (inflight.length > 0) {
        console.log(`Poll #${i + 1}: ${JSON.stringify(inflight)}`)
        if (inflight[0]!.status === "Landed") {
          console.log("BUNDLE LANDED!")
          break
        }
        if (inflight[0]!.status !== "Pending") {
          console.log(`Final state: ${inflight[0]!.status}`)
          break
        }
      }
    }

    await sleep(2000)
    const finalStatus = await getBundleStatuses(config.jitoBlockEngineUrl, bundleId)
    console.log(`\nFinal bundle status: ${JSON.stringify(finalStatus)}`)
  } catch (error: any) {
    console.error("Error:", error.message)
  }

  const endBal = await rpc.getBalance(wallet.publicKey)
  console.log(`\nFinal balance: ${endBal} lamports (${endBal / 1e9} SOL)`)
  console.log(`Balance change: ${endBal - balance} lamports`)
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
