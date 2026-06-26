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

export interface StageDeltas {
  "submitted→processed": number | null
  "processed→confirmed": number | null
  "confirmed→finalized": number | null
}

export interface LifecycleLogEntry {
  bundleId: string
  events: LifecycleEvent[]
  stageDeltas: StageDeltas
  writtenAt: number
  failure: FailureClassification | null
  tipLamports: number
  agentReasoning: string | null
}

const STAGE_PAIRS: [LifecycleStage, LifecycleStage, keyof StageDeltas][] = [
  ["submitted", "processed", "submitted→processed"],
  ["processed", "confirmed", "processed→confirmed"],
  ["confirmed", "finalized", "confirmed→finalized"],
]

export function computeStageDeltas(events: LifecycleEvent[]): StageDeltas {
  const stageTimestamps = new Map<LifecycleStage, number>()

  for (const event of events) {
    const existing = stageTimestamps.get(event.stage)
    if (existing === undefined || event.timestamp < existing) {
      stageTimestamps.set(event.stage, event.timestamp)
    }
  }

  const deltas: StageDeltas = {
    "submitted→processed": null,
    "processed→confirmed": null,
    "confirmed→finalized": null,
  }

  for (const [source, dest, key] of STAGE_PAIRS) {
    const srcTs = stageTimestamps.get(source)
    const dstTs = stageTimestamps.get(dest)
    if (srcTs !== undefined && dstTs !== undefined) {
      deltas[key] = Math.max(0, dstTs - srcTs)
    }
  }

  return deltas
}
