import { appendFile } from "node:fs/promises"
import path from "node:path"
import type { AgentContext, AgentDecision } from "./contract.js"

export interface DecisionLedgerEntry {
  timestamp: string
  trigger: "real_failure" | "injected_fault" | "pre_submit"
  inputContext: AgentContext
  rawReasoning: string
  validatedDecision: AgentDecision
  guardrailAction: "accepted" | "re-prompted" | "corrected"
  executedAction: "retry" | "hold" | "abort"
  eventualOutcome: string | null
}

const DEFAULT_LEDGER_PATH = path.resolve(import.meta.dirname, "../../logs/decisions.jsonl")

export class DecisionLedger {
  private path: string

  constructor(logPath?: string) {
    this.path = logPath ?? DEFAULT_LEDGER_PATH
  }

  async record(entry: DecisionLedgerEntry): Promise<void> {
    const line = JSON.stringify(entry) + "\n"
    await appendFile(this.path, line, { flag: "a" })
  }

  async readAll(): Promise<DecisionLedgerEntry[]> {
    const { readFile } = await import("node:fs/promises")
    try {
      const raw = await readFile(this.path, "utf-8")
      return raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as DecisionLedgerEntry)
    } catch {
      return []
    }
  }

  getPath(): string {
    return this.path
  }
}
