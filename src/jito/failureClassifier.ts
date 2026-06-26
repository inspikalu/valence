import type { FailureClassification, FailureDetails } from "../types/index.js"
import type { BundleStatusEntry } from "./bundleStatus.js"

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>
    if (typeof obj.message === "string") return obj.message
    if (typeof obj.err === "string") return obj.err
    return JSON.stringify(err)
  }
  return String(err)
}

function classifyMessage(msg: string): FailureClassification {
  const lower = msg.toLowerCase()

  if (
    lower.includes("blockhash not found") ||
    lower.includes("blockhash") && lower.includes("expir") ||
    lower.includes("invalid blockhash") ||
    lower.includes("blockhash too old") ||
    lower.includes("expired blockhash") ||
    lower.includes("was not processed") && lower.includes("blockhash")
  ) {
    return "expired_blockhash"
  }

  if (
    lower.includes("fee too low") ||
    lower.includes("tip too low") ||
    lower.includes("429") ||
    lower.includes("rate limit")
  ) {
    return "fee_too_low"
  }

  if (
    lower.includes("computational budget") ||
    lower.includes("computebudget") ||
    lower.includes("compute exceeded") ||
    lower.includes("program failed to complete") ||
    lower.includes("exceeded compute")
  ) {
    return "compute_exceeded"
  }

  if (
    lower.includes("bundle") ||
    lower.includes("no valid") ||
    lower.includes("invalid bundle") ||
    lower.includes("failed to land") ||
    lower.includes("did not land") ||
    lower.includes("was processed but no confirmation")
  ) {
    return "bundle_failure"
  }

  return "unknown"
}

export function classifyFailure(
  error: unknown,
  context?: { slot?: number },
): FailureDetails {
  const msg = extractMessage(error)
  const classification = classifyMessage(msg)
  const result: FailureDetails = {
    classification,
    originalError: msg,
  }
  if (context?.slot) result.slot = context.slot
  return result
}

export function classifyBundleStatus(
  statuses: BundleStatusEntry[],
): FailureDetails | null {
  for (const s of statuses) {
    if (s.transactions) {
      for (const tx of s.transactions) {
        if (tx.err !== null) {
          return {
            classification: "bundle_failure",
            originalError: JSON.stringify(tx.err),
            slot: tx.slot,
          }
        }
      }
    }
  }

  const hasLanded = statuses.some(
    (s) => s.status === "Landed" || s.landed_slot != null,
  )
  if (!hasLanded && statuses.length > 0) {
    const allFailed = statuses.every((s) => s.status === "Failed" || s.status === "Dropped")
    if (allFailed) {
      const result: FailureDetails = {
        classification: "bundle_failure",
        originalError: `bundle status: ${statuses.map((s) => s.status).join(", ")}`,
      }
      const slot = statuses.find((s) => s.slot != null)?.slot ?? statuses.find((s) => s.landed_slot != null)?.landed_slot
      if (slot != null) result.slot = slot
      return result
    }
  }

  return null
}

export function classifyTransactionError(
  txError: unknown,
): FailureClassification | null {
  if (txError == null) return null

  const msg = extractMessage(txError)
  return classifyMessage(msg)
}
