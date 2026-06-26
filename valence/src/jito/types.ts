export interface TipFloorSnapshot {
  p25: number
  p50: number
  p75: number
  p95: number
  p99: number
  ema50: number
  time: string
  fetchedAt: number
  source: "ws" | "rest"
}

export type TipAccounts = string[]
