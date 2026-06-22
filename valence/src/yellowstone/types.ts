export interface YellowConfig {
  endpoint: string
  xToken?: string
}

export interface SlotUpdate {
  slot: bigint
  parent: bigint | null
  status: "confirmed" | "processed" | "root"
  timestamp: number
}

export interface LatencySample {
  grpcSlot: bigint
  rpcSlot: number
  deltaMs: number
  timestamp: number
}
