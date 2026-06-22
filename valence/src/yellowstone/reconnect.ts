const INITIAL_DELAY_MS = 1_000
const MULTIPLIER = 2
const MAX_DELAY_MS = 30_000
const JITTER_RANGE = 0.25

export class ReconnectBackoff {
  private _attempt = 0

  get attempt(): number {
    return this._attempt
  }

  /** @param attempt — zero-based retry attempt number */
  getDelay(attempt: number): number {
    this._attempt = attempt + 1
    const base = Math.min(
      MAX_DELAY_MS,
      INITIAL_DELAY_MS * Math.pow(MULTIPLIER, attempt)
    )
    const jitter = base * JITTER_RANGE
    const offset = Math.random() * jitter * 2 - jitter
    return Math.min(MAX_DELAY_MS, Math.round(base + offset))
  }

  reset(): void {
    this._attempt = 0
  }
}
