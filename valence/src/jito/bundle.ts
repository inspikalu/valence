import { Keypair, PublicKey, SystemProgram, ComputeBudgetProgram, Transaction } from "@solana/web3.js"
import bs58 from "bs58"

export interface BuildBundleResult {
  bundle: string[]
  signatures: string[]
  transactions: Transaction[]
}

export function buildSelfTransferBundle(
  wallet: Keypair,
  tipAccount: string,
  blockhash: string,
  tipLamports: number,
  computeUnitLimit?: number,
): BuildBundleResult {
  const walletPubkey = wallet.publicKey
  const tipPubkey = new PublicKey(tipAccount)

  const tx1 = new Transaction()
  if (computeUnitLimit !== undefined) {
    tx1.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }))
  }
  tx1.add(
    SystemProgram.transfer({
      fromPubkey: walletPubkey,
      toPubkey: walletPubkey,
      lamports: 0,
    }),
  )
  tx1.recentBlockhash = blockhash
  tx1.feePayer = walletPubkey
  tx1.sign(wallet)

  const tx2 = new Transaction()
  if (computeUnitLimit !== undefined) {
    tx2.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }))
  }
  tx2.add(
    SystemProgram.transfer({
      fromPubkey: walletPubkey,
      toPubkey: tipPubkey,
      lamports: tipLamports,
    }),
  )
  tx2.recentBlockhash = blockhash
  tx2.feePayer = walletPubkey
  tx2.sign(wallet)

  const tx1Bytes = tx1.serialize()
  const tx2Bytes = tx2.serialize()
  return {
    bundle: [
      tx1Bytes.toString("base64"),
      tx2Bytes.toString("base64"),
    ],
    signatures: [
      bs58.encode(tx1.signature!),
      bs58.encode(tx2.signature!),
    ],
    transactions: [tx1, tx2],
  }
}

export function buildSelfTransferTipBundle(
  wallet: Keypair,
  tipAccount: string,
  blockhash: string,
  tipLamports: number,
): BuildBundleResult {
  const walletPubkey = wallet.publicKey
  const tipPubkey = new PublicKey(tipAccount)

  const tx = new Transaction()
  tx.add(
    SystemProgram.transfer({
      fromPubkey: walletPubkey,
      toPubkey: walletPubkey,
      lamports: 0,
    }),
    SystemProgram.transfer({
      fromPubkey: walletPubkey,
      toPubkey: tipPubkey,
      lamports: tipLamports,
    }),
  )
  tx.recentBlockhash = blockhash
  tx.feePayer = walletPubkey
  tx.sign(wallet)

  const txBytes = tx.serialize()
  return {
    bundle: [txBytes.toString("base64")],
    signatures: [bs58.encode(tx.signature!)],
    transactions: [tx],
  }
}
