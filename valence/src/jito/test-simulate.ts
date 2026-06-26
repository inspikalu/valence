import { PublicKey, Transaction, SystemProgram } from "@solana/web3.js"
import { loadConfig } from "../config/index.js"
import { loadWallet } from "../wallet/index.js"
import { createRpcClient } from "../rpc/index.js"
import { getTipAccounts, TipAccountSelector } from "./index.js"

const BLOCK_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles"

async function rpcCall(method: string, params: unknown[]) {
  const response = await fetch(BLOCK_ENGINE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  const text = await response.text()
  console.log(`${method} response (${response.status}): ${text.slice(0, 1000)}`)
  return text
}

async function main() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  const rpc = createRpcClient(config)

  const bh = await rpc.getLatestBlockhash()
  const accounts = await getTipAccounts(config.jitoBlockEngineUrl)
  const tipAddr = new TipAccountSelector(accounts).next()

  const tx = new Transaction()
  tx.add(
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wallet.publicKey, lamports: 0 }),
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new PublicKey(tipAddr), lamports: config.bundleTipLamports }),
  )
  tx.recentBlockhash = bh.blockhash
  tx.feePayer = wallet.publicKey
  tx.sign(wallet)

  const b64 = tx.serialize({ verifySignatures: false }).toString("base64")

  // Try simulateBundle if it exists
  console.log("=== Trying simulateBundle ===")
  await rpcCall("simulateBundle", [[b64], { encoding: "base64", preExecutionAccountsConfigs: [] }])

  // Try getTipAccounts (should work)
  console.log("\n=== Testing getTipAccounts ===")
  await rpcCall("getTipAccounts", [])

  // Try a bundle with explicit tip instruction first
  await new Promise((r) => setTimeout(r, 1500))
  
  const tx2 = new Transaction()
  tx2.add(
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new PublicKey(tipAddr), lamports: config.bundleTipLamports }),
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wallet.publicKey, lamports: 0 }),
  )
  const bh2 = await rpc.getLatestBlockhash()
  tx2.recentBlockhash = bh2.blockhash
  tx2.feePayer = wallet.publicKey
  tx2.sign(wallet)
  const b64_2 = tx2.serialize({ verifySignatures: false }).toString("base64")

  console.log("\n=== Trying sendBundle with tip FIRST ===")
  const bidResp = await rpcCall("sendBundle", [[b64_2], { encoding: "base64" }])
  
  // Extract bundle ID and check status
  try {
    const result = JSON.parse(bidResp)
    const bundleId = result?.result
    if (bundleId) {
      await new Promise((r) => setTimeout(r, 3000))
      console.log(`\n=== Checking inflight status for ${bundleId} ===`)
      await rpcCall("getInflightBundleStatuses", [[bundleId]])
      console.log(`\n=== Checking bundle status for ${bundleId} ===`)
      await rpcCall("getBundleStatuses", [[bundleId]])
    }
  } catch { /* ignore parse errors */ }

  // Try with no encoding param (default base58)
  await new Promise((r) => setTimeout(r, 1500))
  const tx3 = new Transaction()
  tx3.add(
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wallet.publicKey, lamports: 0 }),
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new PublicKey(tipAddr), lamports: config.bundleTipLamports }),
  )
  const bh3 = await rpc.getLatestBlockhash()
  tx3.recentBlockhash = bh3.blockhash
  tx3.feePayer = wallet.publicKey
  tx3.sign(wallet)
  // Use base64 coz we confirmed it works
  const b64_3 = tx3.serialize({ verifySignatures: false }).toString("base64")
  console.log("\n=== Trying sendBundle with ONLY encoding param ===")
  await rpcCall("sendBundle", [[b64_3], { encoding: "base64" }])
}

main().catch(console.error)
