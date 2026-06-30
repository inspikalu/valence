export interface LeaderSlot {
  slot: bigint
  identity: string
  isJito: boolean
}

export interface LeaderWindow {
  currentSlot: bigint
  leader: LeaderSlot
  slotsRemaining: number
  estimatedSeconds: number
  inSubmitWindow: boolean
}

export interface DetectedLeader {
  slot: bigint
  identity: string
  isJito: boolean
  detectedAt: bigint
  horizonSlots: number
}
