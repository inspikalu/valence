import { loadConfig } from "../config/index.js"
import { fetchTipFloor } from "./tipFloor.js"

async function main() {
  const config = loadConfig()
  const tipData = await fetchTipFloor(config.jitoTipFloorUrl)
  console.log("Current tip floor data:", JSON.stringify(tipData, null, 2))
}

main().catch(console.error)
