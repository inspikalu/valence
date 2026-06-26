import type { SolanaRpcClient } from "../rpc/index.js"
import type { SlotUpdate, LatencySample } from "./types.js"

export async function measureLatency(
  slotUpdate: SlotUpdate,
  rpc: SolanaRpcClient
): Promise<LatencySample | null> {
  const grpcTimestamp = slotUpdate.timestamp
  if (!grpcTimestamp) {
    return null
  }

  try {
    const before = Date.now()
    const rpcSlot = await rpc.getSlot("processed")
    const after = Date.now()

    const deltaMs = after - grpcTimestamp
    const rpcLatency = after - before

    return {
      grpcSlot: slotUpdate.slot,
      rpcSlot,
      deltaMs: Math.max(0, deltaMs),
      timestamp: after,
    }
  } catch {
    return null
  }
}

export function shouldSample(index: number, interval: number): boolean {
  return index % interval === 0
}
