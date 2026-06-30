import { EventEmitter } from "node:events"
import type { YellowstoneConnection } from "../connection.js"
import type { LeaderSlot, LeaderWindow, DetectedLeader } from "./types.js"
import { computeHorizon, updateObservedTimes } from "./horizon.js"
import { getNextScheduledLeader } from "../../jito/searcher.js"

const HORIZON_MS = 60_000
const SUBMIT_LEAD_SLOTS = 2
const LEADER_SLOTS = 4

export interface DetectorEvents {
  leaderDetected: [leader: DetectedLeader]
  leaderEntered: [leader: LeaderSlot]
  leaderPassed: [leader: LeaderSlot]
  heartbeat: [window: LeaderWindow]
  horizonAdapted: [horizonSlots: number, previousHorizon: number]
}

export class LeaderWindowDetector extends EventEmitter {
  private yellowstone: YellowstoneConnection
  private jitoValidatorKeys: string[]
  private schedule: Map<bigint, string>
  private detected: Map<bigint, DetectedLeader> = new Map()
  private previousSlot: bigint | null = null
  private previousTimestamp: number | null = null
  private lastHorizon: number | null = null
  private firstSlotResolve: (() => void) | null = null
  private firstSlotPromise: Promise<void>
  private blockEngineUrl: string | null
  private grpcNextLeader: { nextSlot: number; identity: string } | null = null
  private grpcUpdatedAt: number = 0
  private readonly grpcCacheTtlMs: number = 2000

  async waitForFirstSlot(): Promise<void> {
    if (this.previousSlot !== null) return
    this.firstSlotPromise = new Promise((resolve) => { this.firstSlotResolve = resolve })
    return this.firstSlotPromise
  }

  get currentLeader(): string | null {
    if (this.previousSlot === null) return null
    return this.schedule.get(this.previousSlot) ?? null
  }

  get currentIsJito(): boolean {
    const leader = this.currentLeader
    return leader !== null && this.jitoValidatorKeys.includes(leader)
  }

  get inSubmitWindow(): boolean {
    if (this.previousSlot === null) return false

    const grpcResult = this.grpcNextLeader
    if (grpcResult && Date.now() - this.grpcUpdatedAt < this.grpcCacheTtlMs) {
      const grpcSlot = BigInt(grpcResult.nextSlot)
      const slotsUntil = Number(grpcSlot - this.previousSlot)
      return slotsUntil <= SUBMIT_LEAD_SLOTS && slotsUntil > -LEADER_SLOTS
    }

    if (this.currentIsJito) return true
    const maxLookahead = this.previousSlot + BigInt(SUBMIT_LEAD_SLOTS)
    for (let s = this.previousSlot + BigInt(1); s <= maxLookahead; s++) {
      const identity = this.schedule.get(s)
      if (identity && this.isJito(identity)) return true
    }
    return false
  }

  constructor(
    yellowstone: YellowstoneConnection,
    schedule: Map<bigint, string>,
    jitoValidatorKeys: string[],
    blockEngineUrl?: string,
  ) {
    super()
    this.yellowstone = yellowstone
    this.schedule = schedule
    this.jitoValidatorKeys = jitoValidatorKeys
    this.blockEngineUrl = blockEngineUrl ?? null
    this.firstSlotPromise = Promise.resolve()

    this.yellowstone.on("slot", (update) => {
      this.onSlot(update.slot, update.timestamp)
    })
  }

  on<K extends keyof DetectorEvents>(
    event: K,
    listener: (...args: DetectorEvents[K]) => void
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void)
  }

  emit<K extends keyof DetectorEvents>(
    event: K,
    ...args: DetectorEvents[K]
  ): boolean {
    return super.emit(event, ...args)
  }

  private onSlot(slot: bigint, timestamp: number): void {
    this.updateHorizon(slot, timestamp)
    this.processSchedule(slot)
    this.emitHeartbeat(slot)
    this.fetchGrpcLeader()
    if (this.firstSlotResolve) {
      this.firstSlotResolve()
      this.firstSlotResolve = null
    }
  }

  private async fetchGrpcLeader(): Promise<void> {
    if (!this.blockEngineUrl) return
    try {
      const result = await getNextScheduledLeader(this.blockEngineUrl)
      this.grpcNextLeader = {
        nextSlot: result.nextLeaderSlot,
        identity: result.nextLeaderIdentity,
      }
      this.grpcUpdatedAt = Date.now()
    } catch {
      // gRPC errors are non-fatal; fall back to schedule-based detection
    }
  }

  private updateHorizon(slot: bigint, timestamp: number): void {
    if (this.previousSlot !== null && this.previousTimestamp !== null) {
      if (slot === this.previousSlot) return

      const slotDelta = Number(slot - this.previousSlot)
      if (slotDelta > 0) {
        const timeDelta = timestamp - this.previousTimestamp
        const interval = timeDelta / slotDelta
        updateObservedTimes(interval)
      }

      const horizon = computeHorizon()
      if (
        this.lastHorizon !== null &&
        Math.abs(horizon - this.lastHorizon) / this.lastHorizon > 0.2
      ) {
        this.emit("horizonAdapted", horizon, this.lastHorizon)
      }
      this.lastHorizon = horizon
    }

    this.previousSlot = slot
    this.previousTimestamp = timestamp
  }

  private processSchedule(slot: bigint): void {
    const currentHorizon = computeHorizon()
    const maxLookaheadSlot = slot + BigInt(currentHorizon)

    for (let s = slot + BigInt(1); s <= maxLookaheadSlot; s++) {
      const identity = this.schedule.get(s)
      if (!identity) continue

      if (!this.detected.has(s)) {
        const isJito = this.isJito(identity)
        const detected: DetectedLeader = {
          slot: s,
          identity,
          isJito,
          detectedAt: slot,
          horizonSlots: currentHorizon,
        }
        this.detected.set(s, detected)
        this.emit("leaderDetected", detected)
      }
    }

    const passed: bigint[] = []
    for (const [leaderSlot, leader] of this.detected) {
      if (slot === leaderSlot) {
        this.emit("leaderEntered", {
          slot: leaderSlot,
          identity: leader.identity,
          isJito: leader.isJito,
        })
      }
      if (slot > leaderSlot) {
        this.emit("leaderPassed", {
          slot: leaderSlot,
          identity: leader.identity,
          isJito: leader.isJito,
        })
        passed.push(leaderSlot)
      }
    }

    for (const ps of passed) {
      this.detected.delete(ps)
    }
  }

  emitHeartbeat(slot: bigint): void {
    const currentHorizon = computeHorizon()
    const maxLookaheadSlot = slot + BigInt(currentHorizon)

    let nextJito: { slot: bigint; identity: string; slotsRemaining: number } | null = null

    for (let s = slot + BigInt(1); s <= maxLookaheadSlot; s++) {
      const identity = this.schedule.get(s)
      if (!identity) continue
      if (this.isJito(identity)) {
        const slotsRemaining = Number(s - slot)
        nextJito = { slot: s, identity, slotsRemaining }
        break
      }
    }

    if (nextJito) {
      const estimatedSeconds = Math.round(
        nextJito.slotsRemaining * (HORIZON_MS / currentHorizon / 1000)
      )
      this.emit("heartbeat", {
        currentSlot: slot,
        leader: {
          slot: nextJito.slot,
          identity: nextJito.identity,
          isJito: true,
        },
        slotsRemaining: nextJito.slotsRemaining,
        estimatedSeconds,
        inSubmitWindow: this.inSubmitWindow,
      })
    } else {
      this.emit("heartbeat", {
        currentSlot: slot,
        leader: { slot: BigInt(0), identity: "", isJito: false },
        slotsRemaining: 0,
        estimatedSeconds: 0,
        inSubmitWindow: this.inSubmitWindow,
      })
    }
  }

  private isJito(identity: string): boolean {
    return this.jitoValidatorKeys.includes(identity)
  }
}
