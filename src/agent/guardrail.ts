import type { AgentDecision } from "./contract.js"

interface GuardrailResult {
  passed: boolean
  errors: string[]
  corrected: Partial<AgentDecision> | null
}

const MAX_BLOCKHASH_AGE_SLOTS = 150
const TIP_CEILING = 100_000
const MIN_TIP = 1_000

export function validateDecision(decision: AgentDecision, context: {
  tipFloorP25?: number
  currentSlot?: number
}): GuardrailResult {
  const errors: string[] = []

  if (!decision.action || !["retry", "hold", "abort"].includes(decision.action)) {
    errors.push(`Invalid action: ${decision.action}. Must be retry, hold, or abort`)
  }

  if (decision.action === "retry") {
    const p = decision.params

    if (!p.refreshBlockhash) {
      errors.push("refreshBlockhash must be true for retry action")
    }

    if (typeof p.newTipLamports !== "number" || p.newTipLamports < MIN_TIP || p.newTipLamports > TIP_CEILING) {
      errors.push(`newTipLamports ${p.newTipLamports} out of range [${MIN_TIP}, ${TIP_CEILING}]`)
    }

    if (context.tipFloorP25 !== undefined && p.newTipLamports < context.tipFloorP25) {
      errors.push(`newTipLamports ${p.newTipLamports} below tip floor p25 (${context.tipFloorP25}) — will likely fail`)
    }

    if (typeof p.maxBlockhashAgeSlots !== "number" || p.maxBlockhashAgeSlots > MAX_BLOCKHASH_AGE_SLOTS) {
      errors.push(`maxBlockhashAgeSlots ${p.maxBlockhashAgeSlots} exceeds max ${MAX_BLOCKHASH_AGE_SLOTS}`)
    }

    if (p.tipPercentileTarget !== null && (p.tipPercentileTarget < 25 || p.tipPercentileTarget > 99)) {
      errors.push(`tipPercentileTarget ${p.tipPercentileTarget} out of range [25, 99]`)
    }

    if (p.submitAtSlot !== null && context.currentSlot !== undefined && p.submitAtSlot <= context.currentSlot) {
      errors.push(`submitAtSlot ${p.submitAtSlot} is not in the future (current: ${context.currentSlot})`)
    }
  }

  if (typeof decision.confidence !== "number" || decision.confidence < 0 || decision.confidence > 1) {
    errors.push(`confidence ${decision.confidence} out of range [0, 1]`)
  }

  if (!decision.diagnosis || decision.diagnosis.length < 10) {
    errors.push("diagnosis too short or missing")
  }

  return {
    passed: errors.length === 0,
    errors,
    corrected: null,
  }
}

export function correctDecision(decision: AgentDecision, context: {
  tipFloorP25?: number
  currentSlot?: number
}): AgentDecision {
  const corrected = { ...decision, params: { ...decision.params } }

  if (corrected.params.newTipLamports < MIN_TIP) {
    corrected.params.newTipLamports = context.tipFloorP25 ?? MIN_TIP
  }
  if (corrected.params.newTipLamports > TIP_CEILING) {
    corrected.params.newTipLamports = TIP_CEILING
  }
  if (corrected.params.maxBlockhashAgeSlots > MAX_BLOCKHASH_AGE_SLOTS) {
    corrected.params.maxBlockhashAgeSlots = MAX_BLOCKHASH_AGE_SLOTS
  }
  if (corrected.params.submitAtSlot !== null && context.currentSlot !== undefined && corrected.params.submitAtSlot <= context.currentSlot) {
    corrected.params.submitAtSlot = context.currentSlot + 1
  }
  if (corrected.action === "retry") {
    corrected.params.refreshBlockhash = true
  }

  return corrected
}
