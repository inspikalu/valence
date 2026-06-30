const WINDOW_SIZE = 64
const SLOT_INTERVAL_MS = 400

export interface CongestionStatus {
  skipRate: number
  pcDeltaMs: number
  multiplier: number
  samplesInWindow: number
}

export class CongestionOracle {
  private slotRing: bigint[] = []
  private pcDeltas: number[] = []
  private lastStatus: CongestionStatus = {
    skipRate: 0,
    pcDeltaMs: 0,
    multiplier: 1,
    samplesInWindow: 0,
  }

  recordSlot(slot: bigint | number): void {
    const s = BigInt(slot)
    this.slotRing.push(s)
    if (this.slotRing.length > WINDOW_SIZE) {
      this.slotRing.shift()
    }
    this.update()
  }

  recordProcessedToConfirmed(deltaMs: number): void {
    this.pcDeltas.push(deltaMs)
    if (this.pcDeltas.length > WINDOW_SIZE) {
      this.pcDeltas.shift()
    }
    this.update()
  }

  private update(): void {
    const skipRate = this.computeSkipRate()
    const pcDeltaMs = this.percentile(this.pcDeltas, 50)
    const multiplier = this.computeMultiplier(skipRate, pcDeltaMs)

    this.lastStatus = {
      skipRate,
      pcDeltaMs,
      multiplier,
      samplesInWindow: this.slotRing.length,
    }
  }

  private computeSkipRate(): number {
    if (this.slotRing.length < 2) return 0
    const sorted = [...this.slotRing].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    const min = sorted[0]!
    const max = sorted[sorted.length - 1]!
    const expected = Number(max - min) + 1
    const actual = sorted.length
    return expected > 0 ? 1 - actual / expected : 0
  }

  private computeMultiplier(skipRate: number, pcDeltaMs: number): number {
    let m = 1
    if (skipRate > 0.05) m += (skipRate - 0.05) * 5
    if (pcDeltaMs >= 700) m += ((pcDeltaMs - 700) / 1000) * 2
    return Math.min(m, 5)
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const copy = [...sorted].sort((a, b) => a - b)
    const i = Math.ceil((p / 100) * copy.length) - 1
    return copy[Math.max(0, i)]!
  }

  getStatus(): CongestionStatus {
    return { ...this.lastStatus }
  }

  getMultiplier(): number {
    return this.lastStatus.multiplier
  }

  getSkipRate(): number {
    return this.lastStatus.skipRate
  }
}
