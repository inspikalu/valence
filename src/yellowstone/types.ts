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

export interface TxUpdate {
  signature: string
  slot: bigint
  isVote: boolean
  index: string
  err: unknown | null
  timestamp: number
}

export interface TxStatusUpdate {
  signature: string
  slot: bigint
  isVote: boolean
  index: string
  err: unknown | null
  timestamp: number
}

export type CommitmentLevel = "processed" | "confirmed" | "finalized"
