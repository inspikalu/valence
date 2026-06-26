import { describe, it, expect } from "vitest"
import bs58 from "bs58"
import { buildTxRequest, parseTxUpdate, parseTxStatusUpdate } from "@valence/yellowstone/subscriptions/transactions"

describe("buildTxRequest", () => {
  it("produces a request with wallet pubkey in accountInclude", () => {
    const req = buildTxRequest("WalletPubkey123")

    const filter = req.transactions?.wallet
    expect(filter).toBeDefined()
    expect(filter!.accountInclude).toContain("WalletPubkey123")
  })

  it("excludes votes by default", () => {
    const req = buildTxRequest("WalletPubkey123")

    const filter = req.transactions?.wallet
    expect(filter!.vote).toBe(false)
  })

  it("does not set failed field (unset = include both success and failed)", () => {
    const req = buildTxRequest("WalletPubkey123")

    const filter = req.transactions?.wallet
    // failed is NOT set — leaving it unset means "show all" (both success + failed).
    // Setting failed:true would restrict to ONLY failed txs, which is not intended.
    expect(filter!.failed).toBeUndefined()
  })
})

describe("parseTxUpdate", () => {
  it("extracts signature and slot from a SubscribeUpdateTransaction", () => {
    const sigBytes = new Uint8Array(64)
    for (let i = 0; i < 64; i++) sigBytes[i] = i + 1

    const update = {
      transaction: {
        signature: sigBytes,
        isVote: false,
        meta: { err: null },
        index: "0",
      },
      slot: "12345",
    }

    const result = parseTxUpdate(update as any)

    expect(result.signature).toBe(bs58.encode(sigBytes))
    expect(result.slot).toBe(BigInt(12345))
    expect(result.isVote).toBe(false)
    expect(result.err).toBeNull()
  })

  it("extracts error info when present", () => {
    const update = {
      transaction: {
        signature: new Uint8Array(64),
        isVote: false,
        meta: { err: { InstructionError: [0, "Custom(1)"] } },
        index: "0",
      },
      slot: "67890",
    }

    const result = parseTxUpdate(update as any)

    expect(result.err).toEqual({ InstructionError: [0, "Custom(1)"] })
    expect(result.slot).toBe(BigInt(67890))
  })
})

describe("parseTxStatusUpdate", () => {
  it("extracts signature and slot from a transaction status update", () => {
    const sigBytes = new Uint8Array(64)
    for (let i = 0; i < 64; i++) sigBytes[i] = i + 1

    const update = {
      signature: sigBytes,
      slot: "99999",
      isVote: false,
      index: "0",
      err: null,
    }

    const result = parseTxStatusUpdate(update as any)

    expect(result.signature).toBe(bs58.encode(sigBytes))
    expect(result.slot).toBe(BigInt(99999))
    expect(result.err).toBeNull()
  })

  it("handles null error field gracefully", () => {
    const update = {
      signature: new Uint8Array(64),
      slot: "11111",
      isVote: false,
      index: "0",
      err: null,
    }

    const result = parseTxStatusUpdate(update as any)

    expect(result.err).toBeNull()
    expect(result.slot).toBe(BigInt(11111))
  })
})
