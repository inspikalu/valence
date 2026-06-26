import { loadConfig } from "../src/config/index.js"
import { createRpcClient } from "../src/rpc/index.js"

async function main() {
  const config = loadConfig()
  const rpc = createRpcClient(config)
  const conn = rpc.getConnection()
  const sig = "cNUtgfKfZK6hP6cRWejWUA5NkYKUro9Moqpbvg171vH1jjCzmQbsZsSqkwX472GXGPX58W9ydLJF3nQEt7W2bQN"
  const result = await conn.getSignatureStatus(sig, { searchTransactionHistory: true })
  console.log(JSON.stringify(result, null, 2))
}

main().catch(console.error)
