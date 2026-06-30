import { createServer, IncomingMessage, ServerResponse } from "node:http"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { PublicKey } from "@solana/web3.js"
import { Valence } from "./sdk/valence.js"

export interface ServerState {
  landedCount: number
  failedCount: number
  lastForcedDecision: Record<string, unknown> | null // eslint-disable-line @typescript-eslint/no-explicit-any
}

const PORT = parseInt(process.env.PORT ?? "3000", 10)
const WEB_DIR = path.resolve(import.meta.dirname, "../web")

const valence = new Valence()
const serverState: ServerState = { landedCount: 0, failedCount: 0, lastForcedDecision: null }

// Eager init on startup
valence.start().catch((err) => {
  console.warn(`[server] valence init: ${err instanceof Error ? err.message : String(err)}`)
})

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(data))
}

function sendHtml(res: ServerResponse, content: string): void {
  res.writeHead(200, { "Content-Type": "text/html" })
  res.end(content)
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ""
    req.on("data", (chunk: Buffer) => { body += chunk.toString() })
    req.on("end", () => {
      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new Error("Invalid JSON"))
      }
    })
    req.on("error", reject)
  })
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  if (req.method === "OPTIONS") {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
  const pathname = url.pathname

  try {
    // Web dashboard
    if (pathname === "/" || pathname === "/index.html") {
      const indexPath = path.join(WEB_DIR, "index.html")
      if (existsSync(indexPath)) {
        sendHtml(res, readFileSync(indexPath, "utf-8"))
        return
      }
      sendJson(res, 404, { error: "Web dashboard not built — run: mkdir -p web" })
      return
    }

    if (pathname === "/health" || pathname === "/healthz") {
      const status = await valence.status()
      sendJson(res, status.healthy ? 200 : 503, { ...status, landed: serverState.landedCount, failed: serverState.failedCount })
      return
    }

    if (pathname === "/readyz") {
      const status = await valence.status()
      sendJson(res, status.initialized ? 200 : 503, { status: status.initialized ? "ready" : "not ready" })
      return
    }

    if (pathname === "/submit" && req.method === "POST") {
      const body = await parseBody(req)

      if (!body.transaction) {
        sendJson(res, 400, { error: "Missing 'transaction' field" })
        return
      }

      const result = await valence.submit(String(body.transaction), {
        urgency: (body.urgency as "low" | "medium" | "high") ?? "medium",
        tipCeilingLamports: typeof body.tipCeilingLamports === "number" ? body.tipCeilingLamports : undefined,
        maxRetries: typeof body.maxRetries === "number" ? body.maxRetries : undefined,
      })
      if (result.landed) serverState.landedCount++
      else serverState.failedCount++

      sendJson(res, result.landed ? 200 : 502, result)
      return
    }

    if (pathname === "/api/stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      })

      let lastTip: number | null = null
      const send = async () => {
        try {
          const status = await valence.status()
          const tipSnap = valence.getTipFloorStore()?.get() ?? null
          const data = JSON.stringify({ ...status, tipFloor: tipSnap, landed: serverState.landedCount, failed: serverState.failedCount, forcedDecision: serverState.lastForcedDecision })
          res.write(`data: ${data}\n\n`)
        } catch { /* ignore */ }
      }

      await send()
      const interval = setInterval(send, 1000)
      req.on("close", () => clearInterval(interval))
      return
    }

    if (pathname === "/status" || pathname === "/api/status") {
      const status = await valence.status()
      sendJson(res, 200, { ...status, landed: serverState.landedCount, failed: serverState.failedCount })
      return
    }

    if (pathname === "/api/balance") {
      const address = url.searchParams.get("address")
      if (!address) { sendJson(res, 400, { error: "Missing address" }); return }
      const rpc = valence.getRpc()
      try {
        const balance = await rpc.getBalance(new PublicKey(address))
        sendJson(res, 200, { address, balance, sol: balance / 1e9 })
      } catch { sendJson(res, 500, { error: "Failed to fetch balance" }) }
      return
    }

    if (pathname === "/api/blockhash") {
      const rpc = valence.getRpc()
      const bh = await rpc.getLatestBlockhash("processed")
      sendJson(res, 200, { blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight })
      return
    }

    if (pathname === "/api/agent-decision" && (req.method === "POST" || req.method === "GET")) {
      const decision = await valence.getAgentDecision()
      serverState.lastForcedDecision = decision as Record<string, unknown>
      sendJson(res, 200, decision)
      return
    }

    sendJson(res, 404, { error: "Not found" })
  } catch (err) {
    console.error(`[server] ${req.method} ${pathname}:`, err)
    sendJson(res, 500, { error: err instanceof Error ? err.message : "Internal error" })
  }
})

server.listen(PORT, () => {
  console.log(`[valence] API server listening on http://0.0.0.0:${PORT}`)
  console.log(`[valence]   GET  /             — web dashboard`)
  console.log(`[valence]   POST /submit      — submit a transaction`)
  console.log(`[valence]   GET  /health       — health check`)
  console.log(`[valence]   GET  /readyz       — readiness check`)
  console.log(`[valence]   GET  /api/status   — full status`)
  console.log(`[valence]   GET  /api/blockhash — fresh blockhash for wallet tx`)
  console.log(`[valence]   POST/GET /api/agent-decision — force agent decision (live data)`)
})
