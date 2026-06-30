import { runAgentTests } from "./agent.js"

const harness = process.argv[2] ?? "agent"

switch (harness) {
  case "agent":
    await runAgentTests()
    break
  case "trading":
    console.log("Trading harness: set VALENCE_LIVE=1 for live execution")
    break
  case "requote":
    console.log("Re-quote harness: set VALENCE_LIVE=1 for live execution")
    break
  default:
    console.log(`Unknown harness: ${harness}`)
    console.log("Usage: tsx src/harness/run.ts [agent|trading|requote]")
}
