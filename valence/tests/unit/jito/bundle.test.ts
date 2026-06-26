import { describe, it, expect } from "vitest"
import { Keypair, Transaction } from "@solana/web3.js"
import { buildSelfTransferBundle, buildSelfTransferTipBundle } from "@valence/jito"

const TIP_ACCOUNT = "96gYZGDn1bYYFCx1JNH7FwwTMyPavFoRjGCYZhVnPEpU"
const BLOCKHASH = "11111111111111111111111111111111"
const TIP_LAMPORTS = 1000

describe("buildSelfTransferBundle", () => {
  it("returns exactly two transactions", () => {
    const wallet = Keypair.generate()
    const result = buildSelfTransferBundle(wallet, TIP_ACCOUNT, BLOCKHASH, TIP_LAMPORTS)

    expect(result.bundle).toHaveLength(2)
    expect(result.signatures).toHaveLength(2)
  })

  it("produces valid base64-encoded transactions", () => {
    const wallet = Keypair.generate()
    const result = buildSelfTransferBundle(wallet, TIP_ACCOUNT, BLOCKHASH, TIP_LAMPORTS)

    for (const tx of result.bundle) {
      expect(() => Buffer.from(tx, "base64")).not.toThrow()
      const decoded = Buffer.from(tx, "base64")
      expect(decoded.length).toBeGreaterThan(0)
    }
  })

  it("first transaction is a self-transfer (from == to == wallet pubkey)", () => {
    const wallet = Keypair.generate()
    const result = buildSelfTransferBundle(wallet, TIP_ACCOUNT, BLOCKHASH, TIP_LAMPORTS)

    const decoded = Buffer.from(result.bundle[0]!, "base64")
    const tx = Transaction.from(decoded)

    expect(tx.signatures).toHaveLength(1)
    const feePayer = tx.feePayer
    expect(feePayer).toBeDefined()
    expect(feePayer!.equals(wallet.publicKey)).toBe(true)
  })

  it("second transaction transfers exactly tipLamports to the tip account", () => {
    const wallet = Keypair.generate()
    const result = buildSelfTransferBundle(wallet, TIP_ACCOUNT, BLOCKHASH, TIP_LAMPORTS)

    const decoded = Buffer.from(result.bundle[1]!, "base64")
    const tx = Transaction.from(decoded)

    expect(tx.instructions).toHaveLength(1)
    const ix = tx.instructions[0]!

    const data = Buffer.from(ix.data ?? [])
    const buf = Buffer.alloc(8)
    data.copy(buf, 0, 4, 12)
    const lamports = Number(buf.readBigUInt64LE(0))

    expect(lamports).toBe(TIP_LAMPORTS)
  })

  it("returns two unique signatures", () => {
    const wallet = Keypair.generate()
    const result = buildSelfTransferBundle(wallet, TIP_ACCOUNT, BLOCKHASH, TIP_LAMPORTS)

    expect(result.signatures[0]).toBeDefined()
    expect(result.signatures[1]).toBeDefined()
    expect(result.signatures[0]).not.toBe(result.signatures[1])
  })

  it("accepts different tip amounts", () => {
    const wallet = Keypair.generate()
    const result = buildSelfTransferBundle(wallet, TIP_ACCOUNT, BLOCKHASH, 5000)

    const decoded = Buffer.from(result.bundle[1]!, "base64")
    const tx = Transaction.from(decoded)

    const ix = tx.instructions[0]!
    const data = Buffer.from(ix.data ?? [])
    const buf = Buffer.alloc(8)
    data.copy(buf, 0, 4, 12)
    const lamports = Number(buf.readBigUInt64LE(0))

    expect(lamports).toBe(5000)
  })

  it("is backward compatible when computeUnitLimit is not provided", () => {
    const wallet = Keypair.generate()
    const result = buildSelfTransferBundle(wallet, TIP_ACCOUNT, BLOCKHASH, TIP_LAMPORTS)

    expect(result.bundle).toHaveLength(2)
    const decoded1 = Transaction.from(Buffer.from(result.bundle[0]!, "base64"))
    expect(decoded1.instructions.length).toBe(1)
    expect(decoded1.instructions[0]!.programId.toBase58()).not.toBe(
      "ComputeBudget111111111111111111111111111111",
    )
  })

  it("includes ComputeBudget.setComputeUnitLimit when computeUnitLimit is set", () => {
    const wallet = Keypair.generate()
    const result = buildSelfTransferBundle(wallet, TIP_ACCOUNT, BLOCKHASH, TIP_LAMPORTS, 1)

    expect(result.bundle).toHaveLength(2)
    const decoded1 = Transaction.from(Buffer.from(result.bundle[0]!, "base64"))
    expect(decoded1.instructions.length).toBe(2)
    expect(decoded1.instructions[0]!.programId.toBase58()).toBe(
      "ComputeBudget111111111111111111111111111111",
    )
  })
})

describe("buildSelfTransferTipBundle", () => {
  it("returns one signed transaction containing payload and tip", () => {
    const wallet = Keypair.generate()
    const result = buildSelfTransferTipBundle(wallet, TIP_ACCOUNT, BLOCKHASH, TIP_LAMPORTS)

    expect(result.bundle).toHaveLength(1)
    expect(result.signatures).toHaveLength(1)

    const decoded = Buffer.from(result.bundle[0]!, "base64")
    const tx = Transaction.from(decoded)

    expect(tx.signatures).toHaveLength(1)
    expect(tx.instructions).toHaveLength(2)
    expect(tx.feePayer!.equals(wallet.publicKey)).toBe(true)
  })

  it("puts the Jito tip instruction after the self-transfer payload", () => {
    const wallet = Keypair.generate()
    const result = buildSelfTransferTipBundle(wallet, TIP_ACCOUNT, BLOCKHASH, 5000)

    const decoded = Buffer.from(result.bundle[0]!, "base64")
    const tx = Transaction.from(decoded)
    const ix = tx.instructions[1]!
    const data = Buffer.from(ix.data ?? [])
    const buf = Buffer.alloc(8)
    data.copy(buf, 0, 4, 12)

    expect(Number(buf.readBigUInt64LE(0))).toBe(5000)
    expect(ix.keys[1]!.pubkey.toBase58()).toBe(TIP_ACCOUNT)
  })
})
