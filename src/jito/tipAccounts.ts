import bs58 from "bs58"
import type { TipAccounts } from "./types.js"

function isBase58(s: string): boolean {
  try {
    bs58.decode(s)
    return true
  } catch {
    return false
  }
}

export async function getTipAccounts(
  blockEngineUrl: string
): Promise<TipAccounts> {
  const url = blockEngineUrl.replace(/\/+$/, "") + "/api/v1/getTipAccounts"
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTipAccounts",
      params: [],
    }),
  })

  if (!response.ok) {
    throw new Error(
      `getTipAccounts request failed: ${response.status} ${response.statusText}`
    )
  }

  const body: {
    result?: unknown
    error?: { message?: string }
  } = await response.json()

  if (body.error) {
    throw new Error(
      `getTipAccounts JSON-RPC error: ${body.error.message ?? JSON.stringify(body.error)}`
    )
  }

  if (!Array.isArray(body.result)) {
    throw new Error(
      `getTipAccounts unexpected result shape: ${JSON.stringify(body.result).slice(0, 200)}`
    )
  }

  const accounts: string[] = []
  for (const item of body.result) {
    if (typeof item === "string" && isBase58(item)) {
      accounts.push(item)
    }
  }

  if (accounts.length === 0) {
    throw new Error("getTipAccounts returned no valid base58 accounts")
  }

  return accounts
}

export class TipAccountSelector {
  private accounts: TipAccounts

  constructor(accounts: TipAccounts) {
    this.accounts = accounts
  }

  next(): string {
    if (this.accounts.length === 0) {
      throw new Error("TipAccountSelector: empty account list")
    }
    return this.accounts[Math.floor(Math.random() * this.accounts.length)]!
  }

  getAccounts(): TipAccounts {
    return [...this.accounts]
  }
}
