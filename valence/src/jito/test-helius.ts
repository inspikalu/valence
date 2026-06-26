import { Connection, PublicKey } from "@solana/web3.js"
import { loadConfig } from "../config/index.js"
import { loadWallet } from "../wallet/index.js"
import { getTipAccounts, TipAccountSelector, buildSelfTransferBundle, getBundleStatuses, getInflightBundleStatuses } from "./index.js"

const HELIUS_RPC = "https://mainnet.helius-rpc.com/?api-key=8dabc2e1-a043-4c0a-a675-52273c7ac948"

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function submitViaHelius(bundleTxs: string[]): Promise<string> {
  const response = await fetch(HELIUS_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [bundleTxs, { encoding: "base64" }],
    }),
  })

  const text = await response.text()
  console.log(`Helius sendBundle raw response (${response.status}): ${text.slice(0, 500)}`)

  if (!response.ok) {
    throw new Error(`Helius request failed: ${response.status} — ${text.slice(0, 500)}`)
  }

  const body = JSON.parse(text)
  if (body.error) {
    throw new Error(`Helius JSON-RPC error: ${body.error.message ?? JSON.stringify(body.error)}`)
  }

  if (typeof body.result !== "string") {
    throw new Error(`Helius unexpected result: ${JSON.stringify(body.result).slice(0, 200)}`)
  }

  return body.result
}

async function main() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`)

  // Get tip accounts from the block engine
  const accounts = await getTipAccounts(config.jitoBlockEngineUrl)
  const selector = new TipAccountSelector(accounts)
  const tipAccount = selector.next()
  console.log(`Tip account: ${tipAccount}`)
  console.log(`Tip amount: ${config.bundleTipLamports} lamports`)

  // Get a fresh blockhash
  const conn = new Connection(config.rpcUrl)
  const bh = await conn.getLatestBlockhash("processed")
  console.log(`Blockhash: ${bh.blockhash}`)

  // Build bundle
  const { bundle, signatures } = buildSelfTransferBundle(
    wallet, tipAccount, bh.blockhash, config.bundleTipLamports,
  )
  console.log(`Bundle transactions: ${bundle.length}`)
  console.log(`Signatures: ${signatures.join(", ")}`)

  // Test 1: Submit via Helius RPC
  console.log(`\n=== Test 1: Submit via Helius RPC ===`)
  try {
    await sleep(1100)
    const bid1 = await submitViaHelius(bundle)
    console.log(`Helius Bundle ID: ${bid1}`)

    await sleep(5000)
    const ibs1 = await getInflightBundleStatuses(config.jitoBlockEngineUrl, bid1)
    console.log(`Helius bundle inflight status: ${JSON.stringify(ibs1)}`)
    const bs1 = await getBundleStatuses(config.jitoBlockEngineUrl, bid1)
    console.log(`Helius bundle status: ${JSON.stringify(bs1)}`)
  } catch (err) {
    console.error(`Helius submission failed:`, err)
  }

  // Test 2: Submit directly to Jito block engine (for comparison)
  console.log(`\n=== Test 2: Submit directly to Jito block engine ===`)
  try {
    await sleep(1100)
    const bh2 = await conn.getLatestBlockhash("processed")
    const accounts2 = await getTipAccounts(config.jitoBlockEngineUrl)
    const selector2 = new TipAccountSelector(accounts2)
    const tipAccount2 = selector2.next()
    const { bundle: bundle2, signatures: sigs2 } = buildSelfTransferBundle(
      wallet, tipAccount2, bh2.blockhash, config.bundleTipLamports,
    )
    const { submitBundle } = await import("./submission.js")
    const bid2 = await submitBundle(config.jitoBlockEngineUrl, bundle2)
    console.log(`Block Engine Bundle ID: ${bid2}`)
    console.log(`Signatures: ${sigs2.join(", ")}`)

    await sleep(5000)
    const ibs2 = await getInflightBundleStatuses(config.jitoBlockEngineUrl, bid2)
    console.log(`Block Engine inflight status: ${JSON.stringify(ibs2)}`)
    const bs2 = await getBundleStatuses(config.jitoBlockEngineUrl, bid2)
    console.log(`Block Engine bundle status: ${JSON.stringify(bs2)}`)
  } catch (err) {
    console.error(`Block engine submission failed:`, err)
  }
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
