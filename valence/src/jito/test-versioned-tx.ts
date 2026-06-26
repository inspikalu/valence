import {
  TransactionMessage, VersionedTransaction, SystemProgram, PublicKey,
} from "@solana/web3.js"
import bs58 from "bs58"
import { loadConfig } from "../config/index.js"
import { loadWallet } from "../wallet/index.js"
import {
  getTipAccounts, TipAccountSelector,
  submitBundle, getInflightBundleStatuses,
} from "./index.js"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  const conn = new (await import("@solana/web3.js")).Connection(config.rpcUrl)

  console.log(`Wallet: ${wallet.publicKey.toBase58()}`)

  const accounts = await getTipAccounts(config.jitoBlockEngineUrl)
  const selector = new TipAccountSelector(accounts)
  const tipAccount = selector.next()
  console.log(`Tip account: ${tipAccount}`)

  await sleep(1100)
  const bh = await conn.getLatestBlockhash("processed")
  console.log(`Blockhash: ${bh.blockhash}`)

  const tipPubkey = new PublicKey(tipAccount)

  const instructions = [
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: wallet.publicKey,
      lamports: 0,
    }),
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: tipPubkey,
      lamports: config.bundleTipLamports,
    }),
  ]

  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: bh.blockhash,
    instructions,
  }).compileToV0Message()

  const tx = new VersionedTransaction(messageV0)
  tx.sign([wallet])
  const sig = bs58.encode(tx.signatures[0]!)
  const b64 = Buffer.from(tx.serialize()).toString("base64")

  console.log(`\n=== Test: VersionedTransaction bundle ===`)
  console.log(`Signature: ${sig}`)
  console.log(`Tip: ${config.bundleTipLamports} lamports`)
  console.log(`Base64 length: ${b64.length}`)

  const bid = await submitBundle(config.jitoBlockEngineUrl, [b64])
  console.log(`Bundle ID: ${bid}`)
  console.log(`Explorer: https://explorer.jito.wtf/bundle/${bid}`)

  for (let i = 0; i < 30; i++) {
    await sleep(2000)
    const inflight = await getInflightBundleStatuses(config.jitoBlockEngineUrl, bid)
    if (inflight.length > 0) {
      console.log(`Poll #${i + 1}: ${inflight[0]!.status}`)
      if (inflight[0]!.status === "Landed") {
        console.log("BUNDLE LANDED!")
        break
      }
      if (inflight[0]!.status !== "Pending") break
    } else {
      console.log(`Poll #${i + 1}: no inflight status`)
    }

    const onchain = await conn.getSignatureStatus(sig, { searchTransactionHistory: true })
    if (onchain?.value?.confirmationStatus) {
      console.log(`  On-chain: ${onchain.value.confirmationStatus}`)
      break
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
