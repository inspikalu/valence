import { appendFile } from "node:fs/promises"
import path from "node:path"
import { computeStageDeltas } from "../types/lifecycle.js"
import type { LifecycleEvent, LifecycleLogEntry, FailureClassification } from "../types/index.js"

export const DEFAULT_LOG_PATH = path.resolve(import.meta.dirname, "log.jsonl")

export async function appendToLog(
  logPath: string,
  entry: LifecycleLogEntry,
): Promise<void> {
  const line = JSON.stringify(entry) + "\n"
  await appendFile(logPath, line, { flag: "a" })
}

export interface CreateLogEntryParams {
  bundleId: string
  events: LifecycleEvent[]
  tipLamports: number
  agentReasoning: string | null
  failure: FailureClassification | null
}

export function createLifecycleLogEntry(params: CreateLogEntryParams): LifecycleLogEntry {
  const { bundleId, events, failure, tipLamports, agentReasoning } = params

  return {
    bundleId,
    events,
    stageDeltas: computeStageDeltas(events),
    writtenAt: Date.now(),
    failure,
    tipLamports,
    agentReasoning,
  }
}
