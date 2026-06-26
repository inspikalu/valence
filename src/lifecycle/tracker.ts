import type { LifecycleEvent, LifecycleStage } from "../types/lifecycle.js"

type CommitmentLevel = "processed" | "confirmed" | "finalized"

interface TrackerEntry {
  firstSeenSlot: bigint
  firstSeenTimestamp: number
  commitment: CommitmentLevel
  updatedAt: number
}

interface BundleRecord {
  bundleId: string
  signatures: string[]
  tipLamports: number
  agentReasoning: string | null
  submittedSlot: number
  submittedTimestamp: number
}

export class SignatureTracker {
  private watched = new Map<string, TrackerEntry>()
  private bundles = new Map<string, BundleRecord>()

  watch(signature: string): void {
    if (!this.watched.has(signature)) {
      this.watched.set(signature, {
        firstSeenSlot: BigInt(0),
        firstSeenTimestamp: 0,
        commitment: "processed",
        updatedAt: 0,
      })
    }
  }

  observe(
    signature: string,
    slot: bigint,
    commitment: CommitmentLevel
  ): void {
    const entry = this.watched.get(signature)
    if (!entry) return

    if (entry.firstSeenSlot === BigInt(0)) {
      entry.firstSeenSlot = slot
      entry.firstSeenTimestamp = Date.now()
    }

    const levels: CommitmentLevel[] = ["processed", "confirmed", "finalized"]
    if (levels.indexOf(commitment) > levels.indexOf(entry.commitment)) {
      entry.commitment = commitment
    }

    entry.updatedAt = Date.now()
  }

  recordSubmitted(
    bundleId: string,
    signatures: string[],
    tipLamports: number,
    slot: number,
    agentReasoning: string | null = null,
  ): void {
    for (const sig of signatures) {
      this.watch(sig)
    }
    this.bundles.set(bundleId, {
      bundleId,
      signatures,
      tipLamports,
      agentReasoning,
      submittedSlot: slot,
      submittedTimestamp: Date.now(),
    })
  }

  getBundleEvents(bundleId: string): LifecycleEvent[] {
    const record = this.bundles.get(bundleId)
    if (!record) return []

    const events: LifecycleEvent[] = []

    for (const sig of record.signatures) {
      events.push({
        bundleId,
        signature: sig,
        stage: "submitted",
        slot: record.submittedSlot,
        timestamp: record.submittedTimestamp,
        tipLamports: record.tipLamports,
        agentReasoning: record.agentReasoning,
        failure: null,
      })

      const status = this.getStatus(sig)
      if (status && status.firstSeenSlot > BigInt(0)) {
        events.push({
          bundleId,
          signature: sig,
          stage: status.commitment as LifecycleStage,
          slot: Number(status.firstSeenSlot),
          timestamp: status.firstSeenTimestamp,
          tipLamports: record.tipLamports,
          agentReasoning: record.agentReasoning,
          failure: null,
        })
      }
    }

    return events
  }

  getStatus(signature: string): {
    firstSeenSlot: bigint
    firstSeenTimestamp: number
    commitment: CommitmentLevel
    updatedAt: number
  } | null {
    const entry = this.watched.get(signature)
    if (!entry) return null
    return { ...entry }
  }

  has(signature: string): boolean {
    return this.watched.has(signature)
  }

  clear(): void {
    this.watched.clear()
  }
}
