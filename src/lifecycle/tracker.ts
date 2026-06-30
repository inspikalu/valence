import type { LifecycleEvent, LifecycleStage } from "../types/lifecycle.js"

type CommitmentLevel = "processed" | "confirmed" | "finalized"

interface StageObservation {
  slot: bigint
  timestamp: number
}

interface TrackerEntry {
  stages: Partial<Record<CommitmentLevel, StageObservation>>
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

const COMMITMENT_ORDER: CommitmentLevel[] = ["processed", "confirmed", "finalized"]

const SLOT_FINALIZED_STATUS = "root" as const
export type SlotStatus = "processed" | "confirmed" | typeof SLOT_FINALIZED_STATUS

export class SignatureTracker {
  private watched = new Map<string, TrackerEntry>()
  private bundles = new Map<string, BundleRecord>()
  private landedSlots = new Map<bigint, Set<string>>()

  watch(signature: string): void {
    if (!this.watched.has(signature)) {
      this.watched.set(signature, {
        stages: {},
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

    if (!entry.stages[commitment]) {
      entry.stages[commitment] = { slot, timestamp: Date.now() }
      if (commitment === "processed") {
        let sigs = this.landedSlots.get(slot)
        if (!sigs) {
          sigs = new Set()
          this.landedSlots.set(slot, sigs)
        }
        sigs.add(signature)
      }
    }

    entry.updatedAt = Date.now()
  }

  promoteSlot(slot: bigint, commitment: "confirmed" | "finalized"): void {
    const sigs = this.landedSlots.get(slot)
    if (!sigs) return
    for (const sig of sigs) {
      const entry = this.watched.get(sig)
      if (!entry) continue
      if (!entry.stages[commitment]) {
        entry.stages[commitment] = { slot, timestamp: Date.now() }
      }
      entry.updatedAt = Date.now()
    }
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

      const entry = this.watched.get(sig)
      if (entry) {
        for (const level of COMMITMENT_ORDER) {
          const obs = entry.stages[level]
          if (obs) {
            events.push({
              bundleId,
              signature: sig,
              stage: level as LifecycleStage,
              slot: Number(obs.slot),
              timestamp: obs.timestamp,
              tipLamports: record.tipLamports,
              agentReasoning: record.agentReasoning,
              failure: null,
            })
          }
        }
      }
    }

    return events
  }

  private highestCommitment(entry: TrackerEntry): CommitmentLevel {
    for (let i = COMMITMENT_ORDER.length - 1; i >= 0; i--) {
      const level = COMMITMENT_ORDER[i]!
      if (entry.stages[level]) return level
    }
    return "processed"
  }

  private firstObservation(entry: TrackerEntry): { slot: bigint; timestamp: number } | null {
    for (const level of COMMITMENT_ORDER) {
      const obs = entry.stages[level]
      if (obs) return obs
    }
    return null
  }

  getStatus(signature: string): {
    firstSeenSlot: bigint
    firstSeenTimestamp: number
    commitment: CommitmentLevel
    updatedAt: number
  } | null {
    const entry = this.watched.get(signature)
    if (!entry) return null

    const first = this.firstObservation(entry)
    return {
      firstSeenSlot: first?.slot ?? BigInt(0),
      firstSeenTimestamp: first?.timestamp ?? 0,
      commitment: this.highestCommitment(entry),
      updatedAt: entry.updatedAt,
    }
  }

  has(signature: string): boolean {
    return this.watched.has(signature)
  }

  clear(): void {
    this.watched.clear()
  }
}
