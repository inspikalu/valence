import { loadConfig } from "../config/index.js"
import { loadWallet } from "../wallet/index.js"
import { createRpcClient } from "../rpc/index.js"

async function main() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  const rpc = createRpcClient(config)
  const balance = await rpc.getBalance(wallet.publicKey)
  console.log("Wallet:", wallet.publicKey.toBase58())
  console.log("Balance (lamports):", balance)
  console.log("Balance (SOL):", balance / 1e9)
}
main()
