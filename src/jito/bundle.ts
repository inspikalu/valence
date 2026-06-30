import { Keypair, PublicKey, SystemProgram, ComputeBudgetProgram, VersionedTransaction, TransactionMessage, Transaction } from "@solana/web3.js"
import bs58 from "bs58"

export interface BuildBundleResult {
  bundle: string[]
  signatures: string[]
  transactions: VersionedTransaction[]
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

  const instructions1 = []
  if (computeUnitLimit !== undefined) {
    instructions1.push(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }))
  }
  instructions1.push(
    SystemProgram.transfer({
      fromPubkey: walletPubkey,
      toPubkey: walletPubkey,
      lamports: 0,
    }),
  )
  const message1 = new TransactionMessage({
    payerKey: walletPubkey,
    recentBlockhash: blockhash,
    instructions: instructions1,
  }).compileToV0Message()
  const tx1 = new VersionedTransaction(message1)
  tx1.sign([wallet])

  const instructions2 = []
  if (computeUnitLimit !== undefined) {
    instructions2.push(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }))
  }
  instructions2.push(
    SystemProgram.transfer({
      fromPubkey: walletPubkey,
      toPubkey: tipPubkey,
      lamports: tipLamports,
    }),
  )
  const message2 = new TransactionMessage({
    payerKey: walletPubkey,
    recentBlockhash: blockhash,
    instructions: instructions2,
  }).compileToV0Message()
  const tx2 = new VersionedTransaction(message2)
  tx2.sign([wallet])

  const tx1Bytes = Buffer.from(tx1.serialize())
  const tx2Bytes = Buffer.from(tx2.serialize())
  return {
    bundle: [
      tx1Bytes.toString("base64"),
      tx2Bytes.toString("base64"),
    ],
    signatures: [
      bs58.encode(tx1.signatures[0]!),
      bs58.encode(tx2.signatures[0]!),
    ],
    transactions: [tx1, tx2],
  }
}

export function buildBundleWithUserTx(
  userTxBase64: string,
  wallet: Keypair,
  tipAccount: string,
  blockhash: string,
  tipLamports: number,
): BuildBundleResult {
  const tipPubkey = new PublicKey(tipAccount)
  const walletPubkey = wallet.publicKey

  // Decode user tx to extract its signatures
  const userTxBytes = Buffer.from(userTxBase64, "base64")
  const userTx = VersionedTransaction.deserialize(userTxBytes)
  const userSig = bs58.encode(userTx.signatures[0]!)

  // Build tip tx signed by backend wallet
  const tipMessage = new TransactionMessage({
    payerKey: walletPubkey,
    recentBlockhash: blockhash,
    instructions: [
      SystemProgram.transfer({ fromPubkey: walletPubkey, toPubkey: walletPubkey, lamports: 0 }),
      SystemProgram.transfer({ fromPubkey: walletPubkey, toPubkey: tipPubkey, lamports: tipLamports }),
    ],
  }).compileToV0Message()
  const tipTx = new VersionedTransaction(tipMessage)
  tipTx.sign([wallet])
  const tipTxBytes = Buffer.from(tipTx.serialize())

  return {
    bundle: [userTxBase64, tipTxBytes.toString("base64")],
    signatures: [userSig, bs58.encode(tipTx.signatures[0]!)],
    transactions: [userTx, tipTx],
  }
}

export function buildSelfTransferTipBundle(
  wallet: Keypair,
  tipAccount: string,
  blockhash: string,
  tipLamports: number,
  computeUnitLimit?: number,
): BuildBundleResult {
  const walletPubkey = wallet.publicKey
  const tipPubkey = new PublicKey(tipAccount)

  const instructions = []
  if (computeUnitLimit !== undefined) {
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }))
  }
  instructions.push(
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

  const message = new TransactionMessage({
    payerKey: walletPubkey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message()
  const tx = new VersionedTransaction(message)
  tx.sign([wallet])

  const txBytes = Buffer.from(tx.serialize())
  return {
    bundle: [txBytes.toString("base64")],
    signatures: [bs58.encode(tx.signatures[0]!)],
    transactions: [tx],
  }
}
