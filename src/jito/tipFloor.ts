import type { TipFloorSnapshot } from "./types.js"

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

function parseRawEntry(entry: RawTipFloorEntry): TipFloorSnapshot {
  return {
    p25: solToLamports(entry.landed_tips_25th_percentile ?? 0),
    p50: solToLamports(entry.landed_tips_50th_percentile ?? 0),
    p75: solToLamports(entry.landed_tips_75th_percentile ?? 0),
    p95: solToLamports(entry.landed_tips_95th_percentile ?? 0),
    p99: solToLamports(entry.landed_tips_99th_percentile ?? 0),
    ema50: solToLamports(entry.ema_landed_tips_50th_percentile ?? 0),
    time: entry.time ?? "",
    fetchedAt: Date.now(),
    source: "rest",
  }
}

export async function fetchTipFloor(url: string): Promise<TipFloorSnapshot> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `tip_floor request failed: ${response.status} ${response.statusText}`
    )
  }

  const body: unknown = await response.json()

  if (Array.isArray(body) && body.length > 0) {
    return parseRawEntry(body[0] as RawTipFloorEntry)
  }

  if (body !== null && typeof body === "object") {
    return parseRawEntry(body as RawTipFloorEntry)
  }

  throw new Error(
    `unexpected tip_floor response shape: ${JSON.stringify(body).slice(0, 200)}`
  )
}
