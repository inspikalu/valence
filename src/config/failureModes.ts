export type InjectFailureMode = "expiry" | "low_tip" | "compute_exceeded"

const VALID_MODES = ["expiry", "low_tip", "compute_exceeded"] as const

export function parseInjectFailureModes(value: string): InjectFailureMode[] {
  if (!value) return []
  const tokens = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  const modes: InjectFailureMode[] = []
  for (const token of tokens) {
    if (!(VALID_MODES as readonly string[]).includes(token)) {
      throw new Error(
        `Invalid inject failure mode: "${token}". Valid modes: ${VALID_MODES.join(", ")}`,
      )
    }
    modes.push(token as InjectFailureMode)
  }
  return modes
}
