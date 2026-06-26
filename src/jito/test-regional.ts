import { Connection } from "@solana/web3.js"
import { loadConfig } from "../config/index.js"
import { loadWallet } from "../wallet/index.js"
import { getTipAccounts, TipAccountSelector, buildSelfTransferBundle, getInflightBundleStatuses, getBundleStatuses, submitBundle } from "./index.js"

const REGIONS = [
  "https://amsterdam.mainnet.block-engine.jito.wtf",
  "https://frankfurt.mainnet.block-engine.jito.wtf",
  "https://ny.mainnet.block-engine.jito.wtf",
  "https://tokyo.mainnet.block-engine.jito.wtf",
  "https://mainnet.block-engine.jito.wtf",
]

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`)

  const conn = new Connection(config.rpcUrl)

  // Fetch tip accounts once from default endpoint
  const accounts = await getTipAccounts(config.jitoBlockEngineUrl)
  console.log(`Got ${accounts.length} tip accounts`)

  for (const region of REGIONS) {
    console.log(`\n=== Testing region: ${region} ===`)
    try {
      await sleep(1500)

      const bh = await conn.getLatestBlockhash("processed")
      const selector = new TipAccountSelector(accounts)
      const tipAccount = selector.next()
      const { bundle, signatures } = buildSelfTransferBundle(
        wallet, tipAccount, bh.blockhash, config.bundleTipLamports,
      )

      const bid = await submitBundle(region, bundle)
      console.log(`  Bundle ID: ${bid}`)
      console.log(`  Signatures: ${signatures.join(", ")}`)

      await sleep(3000)
      const ibs = await getInflightBundleStatuses(region, bid)
      console.log(`  Inflight status: ${JSON.stringify(ibs)}`)
    } catch (err: any) {
      console.error(`  Error: ${err.message}`)
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
