import type { FailureClassification } from "../types/index.js"
import type { TipFloorSnapshot } from "../jito/types.js"

export interface RetryInput {
  failureClassification: FailureClassification
  originalTipLamports: number
  originalReasoning: string
  attemptNumber: number
  maxAttempts: number
  currentSlot: number
  leaderIdentity: string | null
  isJitoLeader: boolean
  tipFloorSnapshot: TipFloorSnapshot | null
  tipAccount: string
}

export interface RetryOutput {
  shouldRetry: boolean
  tipLamports: number
  reasoning: string
}

export interface RetryExtras {
  tipFloorSnapshot?: TipFloorSnapshot | null
  leaderIdentity?: string | null
  isJitoLeader?: boolean
  inSubmitWindow?: boolean
}
