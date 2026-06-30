import { describe, it, expect } from "vitest"
import { getNextScheduledLeader } from "@valence/jito/searcher"
import { loadConfig } from "@valence/config"

describe("getNextScheduledLeader", () => {
  it("connects to Block Engine and returns next scheduled leader", async () => {
    const config = loadConfig()
    try {
      const result = await getNextScheduledLeader(config.jitoBlockEngineUrl, 15_000)
      expect(result.currentSlot).toBeGreaterThan(0)
      expect(result.nextLeaderSlot).toBeGreaterThan(result.currentSlot)
      expect(result.nextLeaderIdentity).toBeTruthy()
      expect(typeof result.nextLeaderIdentity).toBe("string")
    } catch (err) {
      if (err instanceof Error && err.message.includes("RESOURCE_EXHAUSTED")) {
        return
      }
      throw err
    }
  }, 30_000)
})
