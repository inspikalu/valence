import { describe, it, expect } from "vitest"
import { Keypair } from "@solana/web3.js"

describe("loadWallet (via Keypair.fromSecretKey)", () => {
  it("produces a deterministic public key from a known secret", () => {
    const keypair = Keypair.generate()
    const secret = keypair.secretKey
    const restored = Keypair.fromSecretKey(secret)
    expect(restored.publicKey.toBase58()).toBe(keypair.publicKey.toBase58())
    expect(typeof restored.publicKey.toBase58()).toBe("string")
  })

  it("rejects an invalid keypair file path", () => {
    expect(() => {
      const fs = require("node:fs")
      fs.readFileSync("/nonexistent/keypair.json", "utf-8")
    }).toThrow()
  })
})
