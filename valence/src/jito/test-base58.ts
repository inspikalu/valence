import { Connection, PublicKey, Transaction, SystemProgram, TransactionInstruction } from "@solana/web3.js"
import { loadConfig } from "../config/index.js"
import { loadWallet } from "../wallet/index.js"
import { createRpcClient } from "../rpc/index.js"
import { submitBundle, getInflightBundleStatuses, getTipAccounts, TipAccountSelector } from "./index.js"
import bs58 from "bs58"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  const rpc = createRpcClient(config)

  const balance = await rpc.getBalance(wallet.publicKey)
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`)
  console.log(`Balance: ${balance} lamports (${balance / 1e9} SOL)`)

  // Test 1: bundle with base64 encoding (current approach)
  const bh1 = await rpc.getLatestBlockhash()
  const accounts1 = await getTipAccounts(config.jitoBlockEngineUrl)
  const tip1 = new TipAccountSelector(accounts1).next()

  const tx1 = new Transaction()
  tx1.add(
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wallet.publicKey, lamports: 0 }),
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new PublicKey(tip1), lamports: config.bundleTipLamports }),
  )
  tx1.recentBlockhash = bh1.blockhash
  tx1.feePayer = wallet.publicKey
  tx1.sign(wallet)
  const b64 = tx1.serialize({ verifySignatures: false }).toString("base64")

  await sleep(1100)
  const bid1 = await submitBundle(config.jitoBlockEngineUrl, [b64])
  console.log(`\n--- Test 1: base64 encoding ---`)
  console.log(`Bundle ID: ${bid1}`)
  await sleep(3000)
  const s1 = await getInflightBundleStatuses(config.jitoBlockEngineUrl, bid1)
  console.log(`Status: ${JSON.stringify(s1)}`)

  // Test 2: bundle with base58 encoding (no encoding param)
  const bh2 = await rpc.getLatestBlockhash()
  const accounts2 = await getTipAccounts(config.jitoBlockEngineUrl)
  const tip2 = new TipAccountSelector(accounts2).next()

  const tx2 = new Transaction()
  tx2.add(
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wallet.publicKey, lamports: 0 }),
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new PublicKey(tip2), lamports: config.bundleTipLamports }),
  )
  tx2.recentBlockhash = bh2.blockhash
  tx2.feePayer = wallet.publicKey
  tx2.sign(wallet)
  const rawBytes = tx2.serialize({ verifySignatures: false })
  const b58 = bs58.encode(rawBytes)

  await sleep(1100)
  const bid2 = await submitBase58Bundle(config.jitoBlockEngineUrl, [b58])
  console.log(`\n--- Test 2: base58 encoding (no encoding param) ---`)
  console.log(`Bundle ID: ${bid2}`)
  await sleep(3000)
  const s2 = await getInflightBundleStatuses(config.jitoBlockEngineUrl, bid2)
  console.log(`Status: ${JSON.stringify(s2)}`)

  // Test 3: base58 with encoding param
  const bh3 = await rpc.getLatestBlockhash()
  const accounts3 = await getTipAccounts(config.jitoBlockEngineUrl)
  const tip3 = new TipAccountSelector(accounts3).next()

  const tx3 = new Transaction()
  tx3.add(
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wallet.publicKey, lamports: 0 }),
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new PublicKey(tip3), lamports: config.bundleTipLamports }),
  )
  tx3.recentBlockhash = bh3.blockhash
  tx3.feePayer = wallet.publicKey
  tx3.sign(wallet)
  const b58_3 = bs58.encode(tx3.serialize({ verifySignatures: false }))

  await sleep(1100)
  const bid3 = await submitBase58Bundle(config.jitoBlockEngineUrl, [b58_3], { encoding: "base58" })
  console.log(`\n--- Test 3: base58 with {encoding: "base58"} ---`)
  console.log(`Bundle ID: ${bid3}`)
  await sleep(3000)
  const s3 = await getInflightBundleStatuses(config.jitoBlockEngineUrl, bid3)
  console.log(`Status: ${JSON.stringify(s3)}`)

  // Test 4: bundle with just a real SOL transfer (no self-transfer)
  const bh4 = await rpc.getLatestBlockhash()
  const accounts4 = await getTipAccounts(config.jitoBlockEngineUrl)
  const tip4 = new TipAccountSelector(accounts4).next()

  const tx4 = new Transaction()
  tx4.add(
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new PublicKey(tip4), lamports: config.bundleTipLamports }),
  )
  tx4.recentBlockhash = bh4.blockhash
  tx4.feePayer = wallet.publicKey
  tx4.sign(wallet)
  const b64_4 = tx4.serialize({ verifySignatures: false }).toString("base64")

  await sleep(1100)
  const bid4 = await submitBundle(config.jitoBlockEngineUrl, [b64_4])
  console.log(`\n--- Test 4: tip-only bundle (no self-transfer) ---`)
  console.log(`Bundle ID: ${bid4}`)
  await sleep(3000)
  const s4 = await getInflightBundleStatuses(config.jitoBlockEngineUrl, bid4)
  console.log(`Status: ${JSON.stringify(s4)}`)
}

async function submitBase58Bundle(
  blockEngineUrl: string,
  bundleTxs: string[],
  extra?: { encoding: string },
): Promise<string> {
  const url = blockEngineUrl.replace(/\/+$/, "") + "/api/v1/bundles"
  const params: unknown[] = [bundleTxs]
  if (extra) params.push(extra)
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params,
    }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`sendBundle request failed: ${response.status} ${response.statusText} — ${text.slice(0, 500)}`)
  }
  const body: { result?: unknown; error?: { message?: string } } = await response.json()
  if (body.error) throw new Error(`sendBundle JSON-RPC error: ${body.error.message ?? JSON.stringify(body.error)}`)
  return body.result as string
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
