import { loadConfig } from "./config/index.js"
import { loadWallet } from "./wallet/index.js"
import { createRpcClient } from "./rpc/index.js"
import { YellowstoneConnection } from "./yellowstone/index.js"

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

  if (config.yellowstoneEndpoint) {
    const yellowstone = new YellowstoneConnection(
      {
        endpoint: config.yellowstoneEndpoint,
        ...(config.yellowstoneGrpcToken ? { xToken: config.yellowstoneGrpcToken } : {}),
      },
      rpc
    )

    yellowstone.on("connected", (endpoint) => {
      console.log(`[yellowstone] connected to ${endpoint}`)
    })

    yellowstone.on("disconnected", () => {
      console.log("[yellowstone] disconnecting")
    })

    yellowstone.on("reconnecting", (reason, attempt, delayMs) => {
      console.log(
        `[yellowstone] connection lost (reason: ${reason}), retry #${attempt} in ~${delayMs}ms`
      )
    })

    yellowstone.on("slotLog", (slot, timestamp) => {
      console.log(`[yellowstone] slot #${slot} at ${timestamp}`)
    })

    yellowstone.on("latencySample", (grpcSlot, rpcSlot, deltaMs) => {
      console.log(
        `[yellowstone] slot #${grpcSlot} via grpc, #${rpcSlot} via rpc, delta ~${deltaMs}ms`
      )
    })

    yellowstone.on("fromSlotReplay", (fromSlot) => {
      console.log(`[yellowstone] reconnecting with fromSlot=${fromSlot}`)
    })

    yellowstone.on("error", (err) => {
      console.error(`[yellowstone] error: ${err.message}`)
    })

    await yellowstone.connect()

    const shutdown = async () => {
      console.log("\nShutting down...")
      await yellowstone.disconnect()
      process.exit(0)
    }

    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)

    await new Promise(() => {})
  } else {
    console.log("No YELLOWSTONE_ENDPOINT configured — skipping slot stream.")
    console.log("Set YELLOWSTONE_ENDPOINT in .env to enable gRPC slot streaming.")
    process.exit(0)
  }
}

main().catch((err) => {
  console.error("Fatal startup error:", err)
  process.exit(1)
})
