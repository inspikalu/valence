import { loadConfig } from "../config/index.js"
import { loadWallet } from "../wallet/index.js"
import { createRpcClient } from "../rpc/index.js"

async function main() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  const rpc = createRpcClient(config)

  const bh = await rpc.getLatestBlockhash()
  console.log("Full getLatestBlockhash result:", JSON.stringify(bh))
  console.log("typeof bh:", typeof bh)
  console.log("bh.blockhash:", bh.blockhash)
  console.log("typeof bh.blockhash:", typeof bh.blockhash)

  const { blockhash } = bh
  console.log("\nDestructured blockhash:", blockhash)
  console.log("typeof destructured:", typeof blockhash)
  console.log("blockhash.string:", (blockhash as any)?.string)
}

main().catch(console.error)
