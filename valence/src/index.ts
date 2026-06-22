import { loadConfig } from "./config/index.js"
import { loadWallet } from "./wallet/index.js"
import { createRpcClient } from "./rpc/index.js"

async function main() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  const rpc = createRpcClient(config)

  console.log(`Valence stack starting — wallet: ${wallet.publicKey.toBase58()}`)

  const [balance, slot, blockhash] = await Promise.all([
    rpc.getBalance(wallet.publicKey),
    rpc.getSlot(),
    rpc.getLatestBlockhash(),
  ])

  console.log(`Current slot: ${slot}`)
  console.log(`Balance: ${balance} SOL`)
  console.log(`Latest blockhash: ${blockhash.blockhash} (valid to slot ~${blockhash.lastValidBlockHeight})`)

  console.log("Valence stack initialized successfully.")
  process.exit(0)
}

main().catch((err) => {
  console.error("Fatal startup error:", err)
  process.exit(1)
})
