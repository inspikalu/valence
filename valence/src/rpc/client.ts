import { Connection, PublicKey, type Commitment } from "@solana/web3.js"
import type { ValenceConfig } from "../types/index.js"
import { RpcConnectionError, RpcRateLimitError, RpcTimeoutError } from "./errors.js"

const DEFAULT_TIMEOUT_MS = 120_000

export interface SolanaRpcClient {
  getBalance(pubkey: PublicKey, commitment?: Commitment): Promise<number>
  getSlot(commitment?: Commitment): Promise<number>
  getLatestBlockhash(commitment?: Commitment): Promise<{ blockhash: string; lastValidBlockHeight: number }>
  getConnection(): Connection
}

export function createRpcClient(config: ValenceConfig): SolanaRpcClient {
  const connection = new Connection(config.rpcUrl, {
    commitment: "confirmed",
    fetch: globalThis.fetch as typeof globalThis.fetch,
    confirmTransactionInitialTimeout: 120_000,
    httpAgent: false,
  })

  async function withTimeout<T>(fn: () => Promise<T>, label: string, retries = 2): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

      try {
        return await fn()
      } catch (err: unknown) {
        if (controller.signal.aborted) {
          if (attempt < retries) {
            continue
          }
          throw new RpcTimeoutError(`RPC call "${label}" timed out after ${DEFAULT_TIMEOUT_MS}ms`)
        }
        if (err instanceof Error) {
          const msg = err.message.toLowerCase()
          if (msg.includes("econnrefused") || msg.includes("connect econnrefused")) {
            throw new RpcConnectionError(`Connection refused on RPC call "${label}": ${err.message}`)
          }
          if (msg.includes("429") || msg.includes("rate limit")) {
            throw new RpcRateLimitError(`Rate limited on RPC call "${label}": ${err.message}`)
          }
          if ((msg.includes("etimedout") || msg.includes("fetch failed")) && attempt < retries) {
            continue
          }
        }
        throw err
      } finally {
        clearTimeout(timer)
      }
    }
  }

  return {
    async getBalance(pubkey: PublicKey, commitment: Commitment = "confirmed"): Promise<number> {
      return withTimeout(
        () => connection.getBalance(pubkey, commitment),
        "getBalance"
      )
    },

    async getSlot(commitment: Commitment = "processed"): Promise<number> {
      return withTimeout(
        () => connection.getSlot(commitment),
        "getSlot"
      )
    },

    async getLatestBlockhash(commitment: Commitment = "confirmed"): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
      const result = await withTimeout(
        () => connection.getLatestBlockhash(commitment),
        "getLatestBlockhash"
      )
      return {
        blockhash: result.blockhash,
        lastValidBlockHeight: result.lastValidBlockHeight,
      }
    },

    getConnection(): Connection {
      return connection
    },
  }
}
