import { describe, it, expect, vi } from "vitest"
import { measureLatency, shouldSample } from "@valence/yellowstone"
import type { SlotUpdate } from "@valence/yellowstone"
import type { SolanaRpcClient } from "@valence/rpc"

function mockRpc(slot: number): SolanaRpcClient {
  return {
    getSlot: vi.fn().mockResolvedValue(slot),
  } as unknown as SolanaRpcClient
}

describe("measureLatency", () => {
  it("produces a non-negative result for normal values", async () => {
    const update: SlotUpdate = {
      slot: BigInt(12345),
      parent: BigInt(12344),
      status: "processed",
      timestamp: Date.now(),
    }

    const rpc = mockRpc(12346)
    const result = await measureLatency(update, rpc as any)

    expect(result).not.toBeNull()
    expect(result!.deltaMs).toBeGreaterThanOrEqual(0)
    expect(result!.grpcSlot).toBe(BigInt(12345))
    expect(result!.rpcSlot).toBe(12346)
  })

  it("returns null when timestamp is missing", async () => {
    const update: SlotUpdate = {
      slot: BigInt(12345),
      parent: null,
      status: "processed",
      timestamp: 0,
    }

    const badUpdate = { ...update, timestamp: 0 }

    const rpc = mockRpc(12346)
    const result = await measureLatency(badUpdate, rpc as any)
    expect(result).toBeNull()
  })

  it("returns null when RPC call fails", async () => {
    const update: SlotUpdate = {
      slot: BigInt(12345),
      parent: BigInt(12344),
      status: "processed",
      timestamp: Date.now(),
    }

    const rpc = {
      getSlot: vi.fn().mockRejectedValue(new Error("RPC failed")),
    } as unknown as SolanaRpcClient

    const result = await measureLatency(update, rpc)
    expect(result).toBeNull()
  })
})

describe("shouldSample", () => {
  it("returns true when index is divisible by interval", () => {
    expect(shouldSample(0, 10)).toBe(true)
    expect(shouldSample(10, 10)).toBe(true)
    expect(shouldSample(20, 10)).toBe(true)
  })

  it("returns false when index is not divisible by interval", () => {
    expect(shouldSample(1, 10)).toBe(false)
    expect(shouldSample(5, 10)).toBe(false)
    expect(shouldSample(11, 10)).toBe(false)
  })
})
