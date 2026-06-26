const WINDOW_SIZE = 10
const DEFAULT_SLOT_TIME_MS = 400
const HORIZON_MS = 60_000

const observedIntervals: number[] = []

export function updateObservedTimes(interSlotMs: number): void {
  observedIntervals.push(interSlotMs)
  if (observedIntervals.length > WINDOW_SIZE) {
    observedIntervals.shift()
  }
}

const MAX_HORIZON_SLOTS = 300

export function computeHorizon(): number {
  if (observedIntervals.length === 0) {
    return Math.floor(HORIZON_MS / DEFAULT_SLOT_TIME_MS)
  }

  const sorted = [...observedIntervals].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]!
  const raw = Math.floor(HORIZON_MS / median)
  return Math.min(raw, MAX_HORIZON_SLOTS)
}

export function getObservedIntervalCount(): number {
  return observedIntervals.length
}

export function resetObservations(): void {
  observedIntervals.length = 0
}
