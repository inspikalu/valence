import type { VersionedTransaction, Transaction, TransactionInstruction } from "@solana/web3.js"

export type TxInput =
  | TransactionInstruction[]
  | VersionedTransaction
  | Transaction
  | string

export interface SubmitResult {
  landed: boolean
  signature: string | null
  slot: number | null
  error: string | null
  failureClass: string | null
  lifecycle: LifecycleSnapshot | null
  agentDecision: SdkAgentDecision | null
}

export interface LifecycleSnapshot {
  submitted: StageSnapshot | null
  processed: StageSnapshot | null
  confirmed: StageSnapshot | null
  finalized: StageSnapshot | null
  deltasMs: {
    submittedToProcessed: number | null
    processedToConfirmed: number | null
    confirmedToFinalized: number | null
  }
}

export interface StageSnapshot {
  slot: number
  timestamp: number
}

export interface SdkAgentDecision {
  action: "retry" | "hold" | "abort"
  tipLamports: number
  reasoning: string
  confidence: number
}

export interface SubmitOptions {
  urgency?: "low" | "medium" | "high"
  tipCeilingLamports?: number | undefined
  maxRetries?: number | undefined
  skipPreflight?: boolean | undefined
}

export interface SdkStatus {
  healthy: boolean
  initialized: boolean
  wallet: string | null
  currentSlot: number | null
  streamConnected: boolean
  congestion: {
    skipRate: number
    pcDeltaMs: number
    multiplier: number
  } | null
}
