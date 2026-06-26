import type { TipFloorSnapshot } from "../jito/types.js"

export interface AgentInput {
  tipFloorSnapshot: TipFloorSnapshot | null
  currentSlot: number
  leaderIdentity: string | null
  isJitoLeader: boolean
  bundleSize: number
  tipAccount: string
}

export interface AgentOutput {
  tipLamports: number
  reasoning: string
}
