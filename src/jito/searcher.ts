import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const _dirname = dirname(fileURLToPath(import.meta.url))
const PROTO_DIR = join(_dirname, "..", "..", "proto")
const PROTO_PATH = join(PROTO_DIR, "searcher.proto")

export interface NextScheduledLeader {
  currentSlot: number
  nextLeaderSlot: number
  nextLeaderIdentity: string
  nextLeaderRegion?: string
}

interface SearcherClient {
  GetNextScheduledLeader(
    request: { regions: string[] },
    options: { deadline: number },
    callback: (err: grpc.ServiceError | null, resp: {
      currentSlot: number
      nextLeaderSlot: number
      nextLeaderIdentity: string
      nextLeaderRegion: string
    }) => void,
  ): void
  SendBundle(
    request: { bundle: unknown },
    options: { deadline: number },
    callback: (err: grpc.ServiceError | null, resp: { uuid: string }) => void,
  ): void
}

let _client: SearcherClient | undefined

function searcherClient(blockEngineUrl: string): SearcherClient {
  if (_client) return _client

  const url = new URL(blockEngineUrl)
  const address = `${url.hostname}:443`

  const pkgDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false,
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [PROTO_DIR],
  })
  const proto = grpc.loadPackageDefinition(pkgDef) as unknown as {
    searcher: { SearcherService: new (address: string, creds: grpc.ChannelCredentials) => SearcherClient }
  }

  _client = new proto.searcher.SearcherService(address, grpc.credentials.createSsl())
  return _client
}

export function sendBundleViaGrpc(
  blockEngineUrl: string,
  txData: Uint8Array[],
  timeoutMs = 10_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const client = searcherClient(blockEngineUrl)

      const deadline = Date.now() + timeoutMs

      const packets = txData.map((data) => ({
        data,
        meta: {
          size: data.length,
          addr: "",
          port: 0,
          flags: {},
          sender_stake: 0,
        },
      }))

      const bundle = {
        header: { ts: Date.now() },
        packets,
      }

      client.SendBundle(
        { bundle },
        { deadline },
        (err, resp) => {
          if (err) {
            reject(new Error(`gRPC SendBundle failed: ${err.message}`))
            return
          }
          resolve(resp.uuid)
        },
      )
    } catch (err) {
      reject(new Error(`gRPC SendBundle error: ${err instanceof Error ? err.message : String(err)}`))
    }
  })
}

export function getNextScheduledLeader(blockEngineUrl: string, timeoutMs = 5000): Promise<NextScheduledLeader> {
  return new Promise((resolve, reject) => {
    const client = searcherClient(blockEngineUrl)
    const deadline = Date.now() + timeoutMs

    client.GetNextScheduledLeader(
      { regions: [] },
      { deadline },
      (err, resp) => {
        if (err) {
          reject(new Error(`gRPC GetNextScheduledLeader failed: ${err.message}`))
          return
        }
        const leader: NextScheduledLeader = {
          currentSlot: Number(resp.currentSlot),
          nextLeaderSlot: Number(resp.nextLeaderSlot),
          nextLeaderIdentity: resp.nextLeaderIdentity,
        }
        if (resp.nextLeaderRegion) {
          leader.nextLeaderRegion = resp.nextLeaderRegion
        }
        resolve(leader)
      },
    )
  })
}
