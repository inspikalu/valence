import { EventEmitter } from "node:events"
import type { PublicKey } from "@solana/web3.js"
import {
  SubscribeRequest,
  type ClientDuplexStream,
  type SubscribeUpdate,
} from "@triton-one/yellowstone-grpc"
import type { SolanaRpcClient } from "../rpc/index.js"

type YellowstoneClientConstructor = typeof import("@triton-one/yellowstone-grpc").default

// Dynamic import avoids a static ESM/CJS interop issue with tsx when
// @triton-one/yellowstone-grpc's native N-API module is loaded after
// other project modules. Static `import Client from "..."` fails with
// "Client is not a constructor" when modules are loaded in a specific order.
let _Client: YellowstoneClientConstructor | null = null
async function getClient(): Promise<YellowstoneClientConstructor> {
  if (!_Client) {
    const mod: typeof import("@triton-one/yellowstone-grpc") = await import("@triton-one/yellowstone-grpc")
    _Client = mod.default as unknown as YellowstoneClientConstructor
  }
  return _Client!
}
import { ReconnectBackoff } from "./reconnect.js"
import { measureLatency, shouldSample } from "./latency.js"
import {
  buildSlotRequest,
  buildTxFilter,
  parseSlotUpdate,
  parseTxUpdate,
  parseTxStatusUpdate,
} from "./subscriptions/index.js"
import type { SlotUpdate, TxUpdate, TxStatusUpdate, YellowConfig } from "./types.js"

const SAMPLE_INTERVAL = 10
const LOG_INTERVAL = 10

export interface YellowstoneEvents {
  connected: [endpoint: string]
  disconnected: []
  reconnecting: [reason: string, attempt: number, delayMs: number]
  slot: [update: SlotUpdate]
  slotLog: [slot: bigint, timestamp: number]
  latencySample: [grpcSlot: bigint, rpcSlot: number, deltaMs: number]
  fromSlotReplay: [fromSlot: bigint]
  txUpdate: [update: TxUpdate]
  txStatusUpdate: [update: TxStatusUpdate]
  error: [err: Error]
}

export class YellowstoneConnection extends EventEmitter {
  private config: YellowConfig
  private rpc: SolanaRpcClient
  private backoff: ReconnectBackoff
  private client: InstanceType<YellowstoneClientConstructor> | null = null
  private stream: ClientDuplexStream | null = null
  private lastSlot: bigint | null = null
  private slotCount = 0
  private shuttingDown = false
  private walletPubkey: string | null = null

  constructor(config: YellowConfig, rpc: SolanaRpcClient) {
    super()
    this.config = config
    this.rpc = rpc
    this.backoff = new ReconnectBackoff()
  }

  setWalletPubkey(pubkey: PublicKey): void {
    this.walletPubkey = pubkey.toBase58()
  }

  on<K extends keyof YellowstoneEvents>(
    event: K,
    listener: (...args: YellowstoneEvents[K]) => void
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void)
  }

  emit<K extends keyof YellowstoneEvents>(
    event: K,
    ...args: YellowstoneEvents[K]
  ): boolean {
    return super.emit(event, ...args)
  }

  async connect(): Promise<InstanceType<YellowstoneClientConstructor>> {
    this.shuttingDown = false

    const fromSlot = this.lastSlot !== null ? this.lastSlot + BigInt(1) : undefined
    if (fromSlot !== undefined) {
      this.emit("fromSlotReplay", fromSlot)
    }

    const YellowstoneClient = await getClient()
    const client = new YellowstoneClient(
      this.config.endpoint,
      this.config.xToken,
      undefined
    )

    await client.connect()

    const slotReq = buildSlotRequest(fromSlot)

    // Build the SubscribeRequest with all fields at once
    const request = SubscribeRequest.create({
      slots: slotReq.slots,
      commitment: slotReq.commitment,
      transactions: this.walletPubkey
        ? { wallet: buildTxFilter(this.walletPubkey) }
        : undefined,
      ...(fromSlot !== undefined ? { fromSlot: fromSlot.toString() } : {}),
    } as any)

    const stream = await client.subscribe(request)

    this.client = client
    this.stream = stream

    stream.on("data", (update: SubscribeUpdate) => {
      this.handleUpdate(update)
    })

    stream.on("error", (err: Error) => {
      this.emit("error", err)
      this.handleDisconnect(err.message)
    })

    stream.on("close", () => {
      if (!this.shuttingDown) {
        this.handleDisconnect("stream closed")
      }
    })

    this.backoff.reset()
    this.emit("connected", this.config.endpoint)
    return client
  }

  isConnected(): boolean {
    return this.stream !== null && this.client !== null && !this.shuttingDown
  }

  async disconnect(): Promise<void> {
    this.shuttingDown = true

    if (this.stream) {
      this.stream.destroy()
      this.stream = null
    }

    this.client = null
    this.emit("disconnected")
  }

  private handleUpdate(update: SubscribeUpdate): void {
    if (update.slot) {
      const slotUpdate = parseSlotUpdate(update.slot)
      this.lastSlot = slotUpdate.slot
      this.slotCount++

      if (this.slotCount % LOG_INTERVAL === 1) {
        this.emit("slotLog", slotUpdate.slot, slotUpdate.timestamp)
      }

      this.emit("slot", slotUpdate)

      if (shouldSample(this.slotCount, SAMPLE_INTERVAL)) {
        this.sampleLatency(slotUpdate)
      }
    }

    if (update.transaction) {
      const txUpdate = parseTxUpdate(update.transaction)
      this.emit("txUpdate", txUpdate)
    }

    if (update.transactionStatus) {
      const statusUpdate = parseTxStatusUpdate(update.transactionStatus)
      this.emit("txStatusUpdate", statusUpdate)
    }
  }

  private async sampleLatency(slotUpdate: SlotUpdate): Promise<void> {
    const sample = await measureLatency(slotUpdate, this.rpc)
    if (sample) {
      this.emit("latencySample", sample.grpcSlot, sample.rpcSlot, sample.deltaMs)
    }
  }

  private async handleDisconnect(reason: string): Promise<void> {
    if (this.shuttingDown) return

    this.stream = null
    this.client = null

    const attempt = this.backoff.attempt
    const delay = this.backoff.getDelay(attempt)
    this.emit("reconnecting", reason, attempt + 1, delay)

    await new Promise((resolve) => setTimeout(resolve, delay))

    if (!this.shuttingDown) {
      try {
        await this.connect()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.handleDisconnect(msg)
      }
    }
  }
}
