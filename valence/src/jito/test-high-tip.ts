import { PublicKey, Transaction, SystemProgram } from "@solana/web3.js"
import { loadConfig } from "../config/index.js"
import { loadWallet } from "../wallet/index.js"
import { createRpcClient } from "../rpc/index.js"
import { submitBundle, getInflightBundleStatuses, getTipAccounts, TipAccountSelector } from "./index.js"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  const rpc = createRpcClient(config)

  const balance = await rpc.getBalance(wallet.publicKey)
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`)
  console.log(`Balance: ${balance} lamports (${balance / 1e9} SOL)`)

  // Try with a very high tip (200_000 lamports)
  const highTip = 200_000
  console.log(`\nTip amount: ${highTip} lamports`)

  const bh = await rpc.getLatestBlockhash()
  const accounts = await getTipAccounts(config.jitoBlockEngineUrl)
  const tipAddr = new TipAccountSelector(accounts).next()
  console.log(`Tip account: ${tipAddr}`)
  console.log(`Blockhash: ${bh.blockhash}`)

  const tx = new Transaction()
  tx.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: wallet.publicKey,
      lamports: 0,
    }),
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: new PublicKey(tipAddr),
      lamports: highTip,
    }),
  )
  tx.recentBlockhash = bh.blockhash
  tx.feePayer = wallet.publicKey
  tx.sign(wallet)

  const b64 = tx.serialize({ verifySignatures: false }).toString("base64")

  await sleep(1100)
  const bid = await submitBundle(config.jitoBlockEngineUrl, [b64])
  console.log(`Bundle ID: ${bid}`)
  console.log(`Explorer: https://explorer.jito.wtf/bundle/${bid}`)

  for (let i = 0; i < 60; i++) {
    await sleep(2000)
    const inflight = await getInflightBundleStatuses(config.jitoBlockEngineUrl, bid)
    if (inflight.length > 0) {
      console.log(`Poll #${i + 1}: ${inflight[0]!.status}`)
      if (inflight[0]!.status === "Landed") {
        console.log("BUNDLE LANDED!")
        break
      }
      if (inflight[0]!.status !== "Pending") break
    }
  }
}

main().catch(console.error)
