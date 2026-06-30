import type { FailureClassification } from "../types/index.js"

export interface AgentContext {
  event: "bundle_failed" | "pre_submit_evaluation"
  failure: {
    type: FailureClassification
    evidence: Record<string, unknown>
  } | null
  bundle: {
    attempt: number
    tipLamports: number
    tipAccount: string
    submittedSlot: number
    targetLeaderSlot: number | null
  }
  network: {
    currentSlot: number
    slotSkipRate64: number
    processedToConfirmedMsP50: number
    tipFloor: {
      p25: number
      p50: number
      p75: number
      p95: number
      ema: number
    } | null
    nextJitoLeaderSlot: number | null
    slotsUntilJitoLeader: number | null
  }
  history: Array<{
    attempt: number
    outcome: string
    tipLamports: number
  }>
  operatorMemory: Array<{
    key: string
    summary: string
  }>
}

export interface AgentDecision {
  diagnosis: string
  rootCause: string
  action: "retry" | "hold" | "abort"
  params: {
    refreshBlockhash: boolean
    newTipLamports: number
    tipPercentileTarget: number | null
    submitAtSlot: number | null
    maxBlockhashAgeSlots: number
  }
  confidence: number
  expectedOutcome: string
}

export const DECISION_CONTRACT = {
  input: {
    event: "string (bundle_failed | pre_submit_evaluation)",
    failure: "object | null — type, evidence",
    bundle: "object — attempt, tipLamports, tipAccount, submittedSlot, targetLeaderSlot",
    network: "object — currentSlot, slotSkipRate64, processedToConfirmedMsP50, tipFloor, nextJitoLeaderSlot, slotsUntilJitoLeader",
    history: "array — { attempt, outcome, tipLamports }",
    operatorMemory: "array — { key, summary }",
  },
  output: {
    diagnosis: "2-4 sentences referencing actual input signals",
    rootCause: "string",
    action: "retry | hold | abort",
    params: {
      refreshBlockhash: "boolean",
      newTipLamports: "integer (min: tipFloor.p25, max: TIP_CEILING)",
      tipPercentileTarget: "integer | null (25-99)",
      submitAtSlot: "integer | null (future slot)",
      maxBlockhashAgeSlots: "integer (max: 150)",
    },
    confidence: "number (0-1)",
    expectedOutcome: "string",
  },
}
