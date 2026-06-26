import { readFileSync } from "node:fs"
import { Keypair } from "@solana/web3.js"
import bs58 from "bs58"
import type { ValenceConfig } from "../types/index.js"

export function loadWallet(config: ValenceConfig): Keypair {
  if (config.privateKey) {
    const decoded = bs58.decode(config.privateKey)
    const keypair = Keypair.fromSecretKey(decoded)
    console.log(`Wallet loaded from PRIVATE_KEY — public key: ${keypair.publicKey.toBase58()}`)
    return keypair
  }

  if (config.keypairFile) {
    const raw = readFileSync(config.keypairFile, "utf-8").trim()
    let decoded: Uint8Array
    if (raw.startsWith("[")) {
      const arr: number[] = JSON.parse(raw)
      decoded = Uint8Array.from(arr)
    } else {
      decoded = bs58.decode(raw)
    }
    const keypair = Keypair.fromSecretKey(decoded)
    console.log(`Wallet loaded from file — public key: ${keypair.publicKey.toBase58()}`)
    return keypair
  }

  throw new Error("No keypair source available")
}
