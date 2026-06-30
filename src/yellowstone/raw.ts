import { EventEmitter } from "node:events"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import type { PublicKey } from "@solana/web3.js"
import type { SolanaRpcClient } from "../rpc/index.js"
import type { SlotUpdate, TxUpdate, TxStatusUpdate, YellowConfig } from "./types.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROTO_PATH = path.resolve(__dirname, "geyser.proto")

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false, longs: Number, enums: Number, defaults: false, oneofs: true,
  includeDirs: [__dirname],
})
const proto = grpc.loadPackageDefinition(packageDef) as any

const LOG_INTERVAL = 10
const SAMPLE_INTERVAL = 10

export interface RawGrpcEvents {
  connected: [endpoint: string]
  disconnected: []
  reconnecting: [reason: string, attempt: number, delayMs: number]
  slot: [update: SlotUpdate]
  slotLog: [slot: bigint, timestamp: number]
  txUpdate: [update: TxUpdate]
  txStatusUpdate: [update: TxStatusUpdate]
  error: [err: Error]
}

export class RawGrpcConnection extends EventEmitter {
  private config: YellowConfig
  private rpc: SolanaRpcClient
  private client: ReturnType<typeof proto.geyser.Geyser> | null = null
  private stream: grpc.ClientDuplexStream<any, any> | null = null
  private lastSlot: bigint | null = null
  private slotCount = 0
  private shuttingDown = false
  private walletPubkey: string | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(config: YellowConfig, rpc: SolanaRpcClient) {
    super()
    this.config = config
    this.rpc = rpc
  }

  setWalletPubkey(pubkey: PublicKey): void {
    this.walletPubkey = pubkey.toBase58()
  }

  isConnected(): boolean {
    return this.stream !== null && this.client !== null && !this.shuttingDown
  }

  async connect(): Promise<void> {
    this.shuttingDown = false
    const host = this.config.endpoint.replace(/^https?:\/\//, "")

    const md = new grpc.Metadata()
    if (this.config.xToken) md.add("x-token", this.config.xToken)

    this.client = new proto.geyser.Geyser(host, grpc.credentials.createInsecure())

    this.stream = this.client.Subscribe(md)
    const stream = this.stream!

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve()
      }, 3000)

      stream.on("data", (update: any) => {
        clearTimeout(timeout)
        if (update.slot) {
          const status: SlotUpdate["status"] = update.slot.status === 1 ? "confirmed" as any
            : update.slot.status === 2 ? "root" as any
            : "processed" as any
          const slotUpdate: SlotUpdate = {
            slot: BigInt(update.slot.slot),
            parent: update.slot.parent ? BigInt(update.slot.parent) : null,
            status,
            timestamp: Date.now(),
          }
          this.lastSlot = slotUpdate.slot
          this.slotCount++
          if (this.slotCount % LOG_INTERVAL === 1) {
            this.emit("slotLog", slotUpdate.slot, slotUpdate.timestamp)
          }
          this.emit("slot", slotUpdate)
        }
        if (update.transaction) {
          const now = Date.now()
          const txUpdate: TxUpdate = {
            signature: Buffer.from(update.transaction.signature).toString("base58" as any),
            slot: BigInt(update.transaction.slot),
            isVote: update.transaction.isVote ?? false,
            index: String(update.transaction.index ?? 0),
            err: update.transaction.err ?? null,
            timestamp: now,
          }
          this.emit("txUpdate", txUpdate)
        }
        if (update.transactionStatus) {
          const now = Date.now()
          const statusUpdate: TxStatusUpdate = {
            signature: typeof update.transactionStatus.signature === "string"
              ? update.transactionStatus.signature
              : Buffer.from(update.transactionStatus.signature).toString("hex"),
            slot: BigInt(update.transactionStatus.slot),
            isVote: update.transactionStatus.isVote ?? false,
            index: String(update.transactionStatus.index ?? 0),
            err: update.transactionStatus.err ?? null,
            timestamp: now,
          }
          this.emit("txStatusUpdate", statusUpdate)
        }
      })

      stream.on("error", (err: Error) => {
        clearTimeout(timeout)
        reject(err)
      })

      stream.on("close", () => {
        if (!this.shuttingDown) {
          this.scheduleReconnect("stream closed")
        }
      })

      // Subscribe to slots + wallet transactions
      const subscribeReq: any = {
        slots: { all: {} },
        commitment: 1, // CONFIRMED
      }
      if (this.walletPubkey) {
        subscribeReq.transactions = {
          wallet: { accountInclude: [this.walletPubkey], accountExclude: [], vote: false, failed: false },
        }
      }
      stream.write(subscribeReq)
    }).then(() => {
      this.emit("connected", this.config.endpoint)
    })
  }

  async disconnect(): Promise<void> {
    this.shuttingDown = true
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    const s = this.stream
    if (s) { s.destroy() }
    this.stream = null
    this.client = null
    this.emit("disconnected")
  }

  private scheduleReconnect(reason: string): void {
    if (this.shuttingDown) return
    this.stream = null
    const delay = 1000 + Math.random() * 2000
    this.reconnectTimer = setTimeout(() => {
      if (!this.shuttingDown) this.connect().catch(() => this.scheduleReconnect("reconnect failed"))
    }, delay)
  }
}

export function isLocalEndpoint(endpoint: string): boolean {
  try {
    const host = endpoint.replace(/^https?:\/\//, "").split(":")[0]!
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0"
  } catch { return false }
}
