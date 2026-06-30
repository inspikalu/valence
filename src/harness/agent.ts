import { Valence } from "../sdk/valence.js"
import { DecisionLedger, callAgent } from "../agent/index.js"
import type { AgentContext } from "../agent/index.js"

export async function runAgentTests(): Promise<void> {
  console.log("\n=== Agent Test Harness ===\n")

  const ledger = new DecisionLedger("logs/decisions.jsonl")

  const scenarios: Array<{ name: string; context: Partial<AgentContext> }> = [
    {
      name: "blockhash expired",
      context: {
        failure: { type: "expired_blockhash", evidence: { blockhashAgeSlots: 47, lastValidSlot: 312900 } },
        network: { currentSlot: 312901, slotSkipRate64: 0.04, processedToConfirmedMsP50: 380, tipFloor: null, nextJitoLeaderSlot: 312912, slotsUntilJitoLeader: 11 },
      },
    },
    {
      name: "fee too low",
      context: {
        failure: { type: "fee_too_low", evidence: {} },
        network: { currentSlot: 312901, slotSkipRate64: 0.04, processedToConfirmedMsP50: 380, tipFloor: { p25: 1000, p50: 5000, p75: 12000, p95: 25000, ema: 6200 }, nextJitoLeaderSlot: 312912, slotsUntilJitoLeader: 11 },
      },
    },
    {
      name: "compute exceeded",
      context: {
        failure: { type: "compute_exceeded", evidence: {} },
        network: { currentSlot: 312901, slotSkipRate64: 0.04, processedToConfirmedMsP50: 380, tipFloor: { p25: 1000, p50: 5000, p75: 12000, p95: 25000, ema: 6200 }, nextJitoLeaderSlot: 312912, slotsUntilJitoLeader: 11 },
      },
    },
    {
      name: "leader skip recovery",
      context: {
        failure: { type: "bundle_failure", evidence: { skippedSlot: 312850 } },
        network: { currentSlot: 312901, slotSkipRate64: 0.12, processedToConfirmedMsP50: 850, tipFloor: { p25: 1000, p50: 5000, p75: 12000, p95: 25000, ema: 6200 }, nextJitoLeaderSlot: 312920, slotsUntilJitoLeader: 19 },
        history: [{ attempt: 1, outcome: "leader_skip", tipLamports: 5000 }],
      },
    },
  ]

  for (const scenario of scenarios) {
    console.log(`\n--- ${scenario.name} ---`)
    const ctx: AgentContext = {
      event: "bundle_failed",
      failure: scenario.context.failure ?? null,
      bundle: { attempt: 1, tipLamports: 5000, tipAccount: "96gYZGLnJYVFmbjzopPSLU6B3Q2sWEiRFFuTm1vxLs", submittedSlot: 312847, targetLeaderSlot: 312850 },
      network: scenario.context.network ?? { currentSlot: 0, slotSkipRate64: 0, processedToConfirmedMsP50: 0, tipFloor: null, nextJitoLeaderSlot: null, slotsUntilJitoLeader: null },
      history: scenario.context.history ?? [],
      operatorMemory: [],
    }

    const decision = await callAgent(ctx, {
      groqApiKey: process.env.GROQ_API_KEY ?? null,
      groqEndpoint: process.env.GROQ_ENDPOINT ?? "https://api.groq.com/openai/v1",
      groqModel: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
    } as never, ledger)

    console.log(`  Decision: ${decision.action}`)
    console.log(`  Tip: ${decision.params.newTipLamports}`)
    console.log(`  Confidence: ${decision.confidence}`)
    console.log(`  Diagnosis: ${decision.diagnosis}`)
  }
}
