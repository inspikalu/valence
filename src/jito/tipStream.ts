import WebSocket from "ws"
import { ReconnectBackoff } from "../yellowstone/reconnect.js"
import type { TipFloorSnapshot } from "./types.js"
import type { TipFloorStore } from "./snapshot.js"

const LAMPORTS_PER_SOL = 1_000_000_000

function solToLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL)
}

interface RawTipFloorEntry {
  time?: string
  landed_tips_25th_percentile?: number
  landed_tips_50th_percentile?: number
  landed_tips_75th_percentile?: number
  landed_tips_95th_percentile?: number
  landed_tips_99th_percentile?: number
  ema_landed_tips_50th_percentile?: number
}

function parseMessage(data: unknown): TipFloorSnapshot | null {
  try {
    const parsed: unknown = typeof data === "string" ? JSON.parse(data) : data

    const entry = (
      Array.isArray(parsed) ? parsed[0] : parsed
    ) as RawTipFloorEntry | undefined

    if (!entry || typeof entry !== "object") return null

    return {
      p25: solToLamports(entry.landed_tips_25th_percentile ?? 0),
      p50: solToLamports(entry.landed_tips_50th_percentile ?? 0),
      p75: solToLamports(entry.landed_tips_75th_percentile ?? 0),
      p95: solToLamports(entry.landed_tips_95th_percentile ?? 0),
      p99: solToLamports(entry.landed_tips_99th_percentile ?? 0),
      ema50: solToLamports(entry.ema_landed_tips_50th_percentile ?? 0),
      time: entry.time ?? "",
      fetchedAt: Date.now(),
      source: "ws",
    }
  } catch {
    return null
  }
}

export interface TipStreamCallbacks {
  onSnapshot: (snapshot: TipFloorSnapshot) => void
  onReconnecting?: (reason: string, attempt: number, delayMs: number) => void
  onError?: (err: Error) => void
}

export class TipStreamClient {
  private ws: WebSocket | null = null
  private backoff = new ReconnectBackoff()
  private shouldReconnect = false
  private url: string
  private store: TipFloorStore
  private callbacks: TipStreamCallbacks

  constructor(
    url: string,
    store: TipFloorStore,
    callbacks: TipStreamCallbacks
  ) {
    this.url = url
    this.store = store
    this.callbacks = callbacks
  }

  connect(): void {
    this.shouldReconnect = true
    this.doConnect()
  }

  private doConnect(): void {
    if (!this.shouldReconnect) return

    this.ws = new WebSocket(this.url)

    this.ws.on("open", () => {
      this.backoff.reset()
    })

    this.ws.on("message", (raw: WebSocket.Data) => {
      const snapshot = parseMessage(raw.toString())
      if (snapshot) {
        this.store.push(snapshot)
        this.callbacks.onSnapshot(snapshot)
      }
    })

    this.ws.on("close", () => {
      this.scheduleReconnect("connection closed")
    })

    this.ws.on("error", (err) => {
      this.callbacks.onError?.(err)
    })
  }

  private scheduleReconnect(reason: string): void {
    if (!this.shouldReconnect) return

    const attempt = this.backoff.attempt
    const delay = this.backoff.getDelay(attempt)
    this.callbacks.onReconnecting?.(reason, attempt + 1, delay)

    setTimeout(() => {
      this.doConnect()
    }, delay)
  }

  disconnect(): void {
    this.shouldReconnect = false
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}
