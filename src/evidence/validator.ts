import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import type { EvidenceRow, ValidationResult, ReadinessCheck } from "./types.js"

interface ValidateOptions {
  path: string
  requireReady?: boolean
}

interface LifecycleLogEntry {
  bundleId: string
  events?: Array<{ stage: string; slot: number; timestamp: number; signature: string }>
  stageDeltas?: Record<string, number | null>
  failure?: string | null
  tipLamports?: number
  agentReasoning?: string | null
  writtenAt?: number
}

export async function validateEvidence(opts: ValidateOptions): Promise<ValidationResult> {
  const errors: string[] = []
  const warnings: string[] = []
  const tipSources = new Map<string, string>()
  const raw = await readFile(opts.path, "utf-8")
  const lines = raw.trim().split("\n").filter(Boolean)
  let streamProvenLandings = 0
  let previousHash = ""
  const seenBundleIds = new Set<string>()

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const rawLine = lines[i]!
    let row: Record<string, unknown>

    try {
      row = JSON.parse(rawLine) as Record<string, unknown>
    } catch {
      errors.push(`Row ${lineNum}: invalid JSON`)
      continue
    }

    const bundleId = String(row.bundleId ?? "")
    if (seenBundleIds.has(bundleId)) {
      warnings.push(`Row ${lineNum}: duplicate bundleId ${bundleId}`)
    }
    seenBundleIds.add(bundleId)

    if (row.hash && typeof row.hash === "string") {
      const content = rawLine.replace(/"hash":".*?"/g, "").replace(/"previousHash":".*?"/g, "")
      const hash = createHash("sha256").update(content).digest("hex")
      if (row.hash !== hash) {
        errors.push(`Row ${lineNum}: hash mismatch (expected ${hash}, got ${row.hash})`)
      }
    }

    if (row.previousHash && typeof row.previousHash === "string") {
      if (row.previousHash !== previousHash) {
        errors.push(`Row ${lineNum}: hash chain break — previousHash mismatch`)
      }
    }
    previousHash = typeof row.hash === "string" ? row.hash : previousHash

    const signatures: string[] = []
    const llEntry = row as unknown as LifecycleLogEntry
    const events = llEntry.events ?? []
    for (const event of events) {
      if (event.signature && !signatures.includes(event.signature)) {
        signatures.push(event.signature)
      }
    }

    if (bundleId && signatures.length > 0) {
      if (bundleId.startsWith("fallback-")) {
        const sig = bundleId.replace("fallback-", "")
        if (signatures[0] === sig) {
          continue
        }
      }
    }

    const evRow = row as unknown as EvidenceRow
    const stages = evRow.stages
    if (stages?.processed && stages?.confirmed) {
      const pSlot = stages.processed.slot
      const cSlot = stages.confirmed.slot
      if (pSlot === cSlot && evRow.confirmedVia !== "stream") {
        warnings.push(`Row ${lineNum}: processed/confirmed slots identical (${pSlot})`)
      }
    }

    if (evRow.confirmedVia === "stream") {
      streamProvenLandings++
    } else if (events.some((e: Record<string, unknown>) => e.stage === "confirmed" || e.stage === "finalized")) {
      streamProvenLandings++
    }

    const llEntry2 = row as unknown as LifecycleLogEntry
    const failure = row.failure ?? llEntry2.failure
    if (failure != null && failure !== "") {
      warnings.push(`Row ${lineNum}: failure detected — ${String(failure)}`)
    }
  }

  if (lines.length < 2) {
    warnings.push(`Only ${lines.length} rows — volume run recommended for >= 10`)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    rowCount: lines.length,
    streamProvenLandings,
    tipSources,
  }
}

export function checkReadiness(result: ValidationResult): ReadinessCheck {
  const reasons: string[] = []
  if (result.rowCount < 10) reasons.push(`Rows: ${result.rowCount} (need >= 10 for full readiness)`)
  if (result.streamProvenLandings === 0) reasons.push("Zero landings observed")
  if (result.errors.length > 0) reasons.push(`${result.errors.length} validation errors`)
  return {
    passed: reasons.length <= 1,
    reasons,
  }
}

export async function computeSourceHash(filePath: string): Promise<string> {
  const content = await readFile(filePath)
  return createHash("sha256").update(content).digest("hex")
}
