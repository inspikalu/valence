import { Valence } from "../sdk/valence.js"

export async function runBudgetTests(): Promise<void> {
  console.log("\n=== Tip Budget Enforcement Harness ===\n")
  console.log("  Scenario: session budget drains across failures")
  console.log("  AI agent receives remaining_tip_budget_lamports in every context")
  console.log("  Must adapt: tip conservatively when budget tight, hold/abort when exhausted\n")
}
