import type { ValenceConfig } from "../types/index.js"
import type { AgentContext, AgentDecision } from "./contract.js"
import { validateDecision, correctDecision } from "./guardrail.js"
import { DecisionLedger } from "./ledger.js"

const SYSTEM_PROMPT = `You are a retry intelligence agent for the Solana Jito block engine.

A bundle has failed. Given the failure details, network conditions, and history, decide what to do.

Return ONLY a JSON object with these fields:
- diagnosis: 2-4 sentences explaining why this happened, referencing actual input signals
- rootCause: the primary cause
- action: "retry" | "hold" | "abort"
- params: { refreshBlockhash: bool, newTipLamports: int, tipPercentileTarget: int|null, submitAtSlot: int|null, maxBlockhashAgeSlots: int }
- confidence: 0.0 to 1.0
- expectedOutcome: what you expect to happen

Rules:
- retry: refresh blockhash, consider raising tip if fee_too_low
- hold: wait for better conditions (leader skip, congestion)
- abort: terminal failures (repeated identical failures)
- newTipLamports must be >= tipFloor.p25 if available
- maxBlockhashAgeSlots <= 150
- submitAtSlot must be a future slot

Output JSON only, no markdown fences.`

export async function callAgent(
  context: AgentContext,
  config: ValenceConfig,
  ledger?: DecisionLedger,
): Promise<AgentDecision> {
  const url = `${config.groqEndpoint}/chat/completions`
  const model = config.groqModel

  const userMessage = buildAgentMessage(context)
  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0.3,
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.groqApiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      console.warn(`[agent] API error ${response.status} — using fallback`)
      return buildFallbackDecision(context)
    }

    const data = (await response.json()) as GroqChatResponse
    const content = data.choices?.[0]?.message?.content
    const decision = parseAgentResponse(content)

    const guardrailContext = {
      tipFloorP25: context.network.tipFloor?.p25,
      currentSlot: context.network.currentSlot,
    }

    const validation = validateDecision(decision, guardrailContext)
    if (!validation.passed) {
      console.warn(`[agent] guardrail rejected: ${validation.errors.join("; ")} — correcting`)
      const corrected = correctDecision(decision, guardrailContext)
      if (ledger) {
        await ledger.record({
          timestamp: new Date().toISOString(),
          trigger: context.event === "bundle_failed" ? "real_failure" : "pre_submit",
          inputContext: context,
          rawReasoning: content ?? "",
          validatedDecision: corrected,
          guardrailAction: "corrected",
          executedAction: corrected.action,
          eventualOutcome: null,
        })
      }
      return corrected
    }

    if (ledger) {
      await ledger.record({
        timestamp: new Date().toISOString(),
        trigger: context.event === "bundle_failed" ? "real_failure" : "pre_submit",
        inputContext: context,
        rawReasoning: content ?? "",
        validatedDecision: decision,
        guardrailAction: "accepted",
        executedAction: decision.action,
        eventualOutcome: null,
      })
    }

    return decision
  } catch (err) {
    clearTimeout(timeoutId)
    console.warn(`[agent] call failed: ${err instanceof Error ? err.message : String(err)}`)
    return buildFallbackDecision(context)
  }
}

function buildAgentMessage(context: AgentContext): string {
  const n = context.network
  const lines = [
    `Event: ${context.event}`,
    context.failure ? `Failure: ${context.failure.type}` : "No failure (pre-submit evaluation)",
    `Attempt: ${context.bundle.attempt}`,
    `Current slot: ${n.currentSlot}`,
    `Slot skip rate (64): ${n.slotSkipRate64}`,
    `P→C delta p50: ${n.processedToConfirmedMsP50}ms`,
    context.failure?.evidence ? `Evidence: ${JSON.stringify(context.failure.evidence)}` : "",
    n.tipFloor ? `Tip floor: p25=${n.tipFloor.p25} p50=${n.tipFloor.p50} p75=${n.tipFloor.p75} p95=${n.tipFloor.p95} ema=${n.tipFloor.ema}` : "No tip floor data",
    n.nextJitoLeaderSlot ? `Next Jito leader: slot ${n.nextJitoLeaderSlot} (${n.slotsUntilJitoLeader} slots)` : "No Jito leader in horizon",
    `History: ${JSON.stringify(context.history)}`,
    context.operatorMemory.length > 0 ? `Operator memory: ${JSON.stringify(context.operatorMemory)}` : "",
  ]
  return lines.filter(Boolean).join("\n")
}

function parseAgentResponse(content: string | undefined): AgentDecision {
  const fallback = buildFallbackDecision({
    event: "bundle_failed",
    failure: null,
    bundle: { attempt: 1, tipLamports: 5000, tipAccount: "", submittedSlot: 0, targetLeaderSlot: null },
    network: { currentSlot: 0, slotSkipRate64: 0, processedToConfirmedMsP50: 0, tipFloor: null, nextJitoLeaderSlot: null, slotsUntilJitoLeader: null },
    history: [],
    operatorMemory: [],
  })

  if (!content) return fallback

  const cleaned = content.replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim()

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    const p = (parsed.params ?? {}) as Record<string, unknown>
    return {
      diagnosis: String(parsed.diagnosis ?? ""),
      rootCause: String(parsed.rootCause ?? ""),
      action: (["retry", "hold", "abort"].includes(String(parsed.action)) ? String(parsed.action) : "abort") as "retry" | "hold" | "abort",
      params: {
        refreshBlockhash: Boolean(p.refreshBlockhash ?? true),
        newTipLamports: typeof p.newTipLamports === "number" ? p.newTipLamports : 5000,
        tipPercentileTarget: typeof p.tipPercentileTarget === "number" ? p.tipPercentileTarget : null,
        submitAtSlot: typeof p.submitAtSlot === "number" ? p.submitAtSlot : null,
        maxBlockhashAgeSlots: typeof p.maxBlockhashAgeSlots === "number" ? p.maxBlockhashAgeSlots : 150,
      },
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      expectedOutcome: String(parsed.expectedOutcome ?? ""),
    }
  } catch {
    console.warn("[agent] failed to parse response, using fallback")
    return fallback
  }
}

function buildFallbackDecision(context: AgentContext): AgentDecision {
  const isRecoverable = context.failure?.type === "expired_blockhash" || context.failure?.type === "fee_too_low"
  const attempts = context.bundle.attempt
  const shouldRetry = isRecoverable && attempts < 3

  return {
    diagnosis: shouldRetry
      ? `Fallback: ${context.failure?.type} detected, retrying with higher tip`
      : `Fallback: terminal after ${attempts} attempts`,
    rootCause: context.failure?.type ?? "unknown",
    action: shouldRetry ? "retry" : "abort",
    params: {
      refreshBlockhash: shouldRetry,
      newTipLamports: context.bundle.tipLamports * (shouldRetry && context.failure?.type === "fee_too_low" ? 2 : 1),
      tipPercentileTarget: shouldRetry && context.network.tipFloor ? 75 : null,
      submitAtSlot: context.network.nextJitoLeaderSlot,
      maxBlockhashAgeSlots: 150,
    },
    confidence: shouldRetry ? 0.6 : 0.2,
    expectedOutcome: shouldRetry ? "Retry with adjusted parameters" : "Aborting — unrecoverable failure",
  }
}

interface GroqMessage {
  role: string
  content?: string
}

interface GroqChoice {
  message?: GroqMessage
}

interface GroqChatResponse {
  choices?: GroqChoice[]
}
