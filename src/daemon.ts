import { loadConfig } from "./config/index.js"
import { loadWallet } from "./wallet/index.js"
import { createRpcClient } from "./rpc/index.js"
import { Valence } from "./sdk/valence.js"
import { Dashboard } from "./tui/dashboard.js"
import type { DashboardState } from "./tui/dashboard.js"

let landedCount = 0
let failedCount = 0

const logBuffer: Array<{ ts: number; level: string; msg: string }> = []
function pushLog(level: string, msg: string): void {
  logBuffer.push({ ts: Date.now(), level, msg })
  if (logBuffer.length > 100) logBuffer.shift()
}

const origLog = console.log
const origWarn = console.warn
const origError = console.error
console.log = (...args: unknown[]) => { pushLog("info", args.map(String).join(" ")); origLog(...args) }
console.warn = (...args: unknown[]) => { pushLog("warn", args.map(String).join(" ")); origWarn(...args) }
console.error = (...args: unknown[]) => { pushLog("error", args.map(String).join(" ")); origError(...args) }

async function main() {
  const config = loadConfig()
  const wallet = loadWallet(config)
  const rpc = createRpcClient(config)

  console.log(`Valence daemon starting — wallet: ${wallet.publicKey.toBase58()}`)

  const [balance, slot] = await Promise.all([
    rpc.getBalance(wallet.publicKey),
    rpc.getSlot(),
  ])
  console.log(`Slot: ${slot}  Balance: ${(balance / 1e9).toFixed(4)} SOL`)

  // ── Single Valence instance ──
  const valence = new Valence(config)
  await valence.start()

  const oracle = valence.getCongestionOracle()
  const yellowstone = valence.getYellowstone()
  const detector = valence.getLeaderDetector()

  let lastDecision: DashboardState["lastDecision"] = null
  let leaderNext: string | null = null
  let leaderSlotsUntil: number | null = null
  let leaderInWindow = false

  if (detector) {
    detector.on("heartbeat", (w) => {
      leaderNext = w.leader.identity?.slice(0, 8) ?? null
      leaderSlotsUntil = w.estimatedSeconds
      leaderInWindow = w.inSubmitWindow
    })
  }

  const startTime = Date.now()

  // ── TUI dashboard ──
  const dashboard = new Dashboard(() => {
    const tipFloorSnap = valence.getTipFloorStore()?.get() ?? null

    const bundleList: DashboardState["bundles"] = []

    return {
      slot: String(valence.getCurrentSlot() ?? ""),
      wallet: wallet.publicKey.toBase58().slice(0, 8) + "…",
      balance: (balance / 1e9).toFixed(3) + " SOL",
      stream: yellowstone?.isConnected() ?? false,
      congestion: oracle?.getStatus() ?? null,
      leader: {
        current: detector?.currentLeader?.slice(0, 8) ?? null,
        next: leaderNext,
        slotsUntil: leaderSlotsUntil,
        inWindow: leaderInWindow || (detector?.inSubmitWindow ?? false),
      },
      tipFloor: tipFloorSnap,
      computedTip: lastDecision?.tip ?? null,
      bundles: bundleList,
      lastDecision,
      logs: [...logBuffer].slice(-6),
      uptime: startTime,
      landed: landedCount,
      failed: failedCount,
    }
  }, 1000)
  dashboard.start()

  // ── Submission loop ──
  async function doSubmit(memo?: string) {
    try {
      const result = await valence.submit(memo ?? "daemon submission", { tipCeilingLamports: config.maxTipLamports })
      if (result.landed) {
        landedCount++
        const tip = result.agentDecision?.tipLamports ?? null
        lastDecision = result.agentDecision
          ? { action: result.agentDecision.action, tip: result.agentDecision.tipLamports, reasoning: result.agentDecision.reasoning, confidence: result.agentDecision.confidence }
          : { action: "land", tip: 0, reasoning: "landed — no agent decision", confidence: 1 }
        console.log(`Landed: ${result.signature?.slice(0, 16)}… slot=${result.slot} tip=${tip ?? "?"}`)
      } else {
        failedCount++
        lastDecision = { action: "abort", tip: 0, reasoning: result.error ?? "unknown", confidence: 0 }
        console.log(`Failed: ${result.failureClass} — ${result.error?.slice(0, 60)}`)
      }
    } catch (err) {
      failedCount++
      console.error(`Submit error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── Start server if requested ──
  const startServer = process.argv.includes("--server")
  if (startServer) {
    const { createServer } = await import("node:http")
    const port = parseInt(process.env.PORT ?? "3000", 10)
    createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({
        status: "running",
        slot: valence.getCurrentSlot(),
        landed: landedCount,
        failed: failedCount,
        congestion: oracle?.getStatus(),
      }))
    }).listen(port, () => console.log(`API: http://0.0.0.0:${port}`))
  }

  // ── Listen for signals ──
  process.on("SIGINT", async () => {
    console.log("\nShutting down…")
    dashboard.stop()
    await valence.stop()
    process.exit(0)
  })
  process.on("SIGTERM", () => process.exit(0))

  // ── Run one submit on startup if configured ──
  if (config.sendBundle) {
    setTimeout(() => doSubmit("daemon auto-submit"), 3000)
  }

  // Block forever
  await new Promise(() => { })
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})