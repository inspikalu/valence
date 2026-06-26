import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGetBalance = vi.hoisted(() => vi.fn())
const mockGetSlot = vi.hoisted(() => vi.fn())
const mockGetLatestBlockhash = vi.hoisted(() => vi.fn())

vi.mock("@solana/web3.js", async () => {
  const actual = await vi.importActual("@solana/web3.js")

  const mockConnection = vi.fn()
  mockConnection.prototype.getBalance = mockGetBalance
  mockConnection.prototype.getSlot = mockGetSlot
  mockConnection.prototype.getLatestBlockhash = mockGetLatestBlockhash

  return {
    ...actual as Record<string, unknown>,
    Connection: mockConnection,
  }
})

import { PublicKey } from "@solana/web3.js"

describe("createRpcClient", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBalance.mockResolvedValue(1_000_000_000)
    mockGetSlot.mockResolvedValue(350_000_000)
    mockGetLatestBlockhash.mockResolvedValue({
      blockhash: "11111111111111111111111111111111111111111111",
      lastValidBlockHeight: 350_000_400,
    })
  })

  it("can import the module without error", async () => {
    const { createRpcClient } = await import("@valence/rpc")
    expect(createRpcClient).toBeDefined()
  })

  it("has correct default commitment for getBalance (confirmed)", async () => {
    const { createRpcClient } = await import("@valence/rpc")

    const config = {
      rpcUrl: "https://api.mainnet-beta.solana.com",
      privateKey: "dummy",
      keypairFile: null,
      logLevel: "info",
    }

    const client = createRpcClient(config)
    const pubkey = new PublicKey("11111111111111111111111111111111")
    await client.getBalance(pubkey)

    expect(mockGetBalance).toHaveBeenCalledWith(pubkey, "confirmed")
  })

  it("has correct default commitment for getSlot (processed)", async () => {
    const { createRpcClient } = await import("@valence/rpc")

    const config = {
      rpcUrl: "https://api.mainnet-beta.solana.com",
      privateKey: "dummy",
      keypairFile: null,
      logLevel: "info",
    }

    const client = createRpcClient(config)
    await client.getSlot()

    expect(mockGetSlot).toHaveBeenCalledWith("processed")
  })

  it("has correct default commitment for getLatestBlockhash (confirmed)", async () => {
    const { createRpcClient } = await import("@valence/rpc")

    const config = {
      rpcUrl: "https://api.mainnet-beta.solana.com",
      privateKey: "dummy",
      keypairFile: null,
      logLevel: "info",
    }

    const client = createRpcClient(config)
    await client.getLatestBlockhash()

    expect(mockGetLatestBlockhash).toHaveBeenCalledWith("confirmed")
  })
})
