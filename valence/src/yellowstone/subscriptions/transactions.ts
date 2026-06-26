import bs58 from "bs58"
import {
  SubscribeRequest,
  SubscribeRequestFilterTransactions,
  SubscribeUpdateTransaction,
  CommitmentLevel,
} from "@triton-one/yellowstone-grpc"
import type { TxUpdate, TxStatusUpdate } from "../types.js"

interface RawTxStatusUpdate {
  slot: string
  signature: Uint8Array
  isVote: boolean
  index: string
  err: unknown | null
}

export function buildTxFilter(
  walletPubkey: string,
): SubscribeRequestFilterTransactions {
  // vote:false excludes validator vote transactions (too noisy for wallet tracking).
  // `failed` is NOT set — leaving it unset returns all transactions (both success
  // and failed). Setting failed:true would restrict to ONLY failed txs.
  return SubscribeRequestFilterTransactions.create({
    vote: false,
    accountInclude: [walletPubkey],
    accountExclude: [],
    accountRequired: [],
  })
}

export function buildTxRequest(
  walletPubkey: string,
): SubscribeRequest {
  const txFilter: Record<string, SubscribeRequestFilterTransactions> = {
    wallet: buildTxFilter(walletPubkey),
  }

  return SubscribeRequest.create({
    transactions: txFilter,
    commitment: CommitmentLevel.PROCESSED,
  })
}

export function parseTxUpdate(update: SubscribeUpdateTransaction): TxUpdate {
  const sigBytes = update.transaction?.signature
  return {
    signature: sigBytes ? bs58.encode(sigBytes as Uint8Array) : "unknown",
    slot: BigInt(update.slot),
    isVote: update.transaction?.isVote ?? false,
    index: update.transaction?.index ?? "0",
    err: update.transaction?.meta?.err ?? null,
    timestamp: Date.now(),
  }
}

export function parseTxStatusUpdate(
  update: RawTxStatusUpdate
): TxStatusUpdate {
  const sigBytes = update.signature
  return {
    signature: sigBytes ? bs58.encode(sigBytes as Uint8Array) : "unknown",
    slot: BigInt(update.slot),
    isVote: update.isVote ?? false,
    index: update.index ?? "0",
    err: update.err ?? null,
    timestamp: Date.now(),
  }
}
