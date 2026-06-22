import type { FailureClassification } from "./failure.js"

export type LifecycleStage = "submitted" | "processed" | "confirmed" | "finalized"

export interface LifecycleEvent {
  bundleId: string
  signature: string
  stage: LifecycleStage
  slot: number
  timestamp: number
  tipLamports: number
  agentReasoning: string | null
  failure: FailureClassification | null
}

export interface LifecycleLogEntry {
  bundleId: string
  events: LifecycleEvent[]
}
