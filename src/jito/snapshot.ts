import type { TipFloorSnapshot } from "./types.js"
import { fetchTipFloor } from "./tipFloor.js"
import { TipStreamClient } from "./tipStream.js"

export interface TipFloorStore {
  get(): TipFloorSnapshot | null
  push(snapshot: TipFloorSnapshot): void
  seed(url: string): Promise<void>
  start(wsUrl: string, restUrl: string, restRefreshMs: number): TipStreamClient
  stop(): void
}

export function createTipFloorStore(
  onSnapshot?: (snapshot: TipFloorSnapshot) => void
): TipFloorStore {
  let latest: TipFloorSnapshot | null = null
  let streamClient: TipStreamClient | null = null
  let restTimer: ReturnType<typeof setInterval> | null = null
  let lastWsUpdate: number = 0
  let isRunning = false

  return {
    get(): TipFloorSnapshot | null {
      return latest
    },

    push(snapshot: TipFloorSnapshot): void {
      latest = snapshot
      lastWsUpdate = Date.now()
    },

    async seed(url: string): Promise<void> {
      const snapshot = await fetchTipFloor(url)
      latest = snapshot
    },

    start(
      wsUrl: string,
      restUrl: string,
      restRefreshMs: number
    ): TipStreamClient {
      isRunning = true

      streamClient = new TipStreamClient(wsUrl, this as TipFloorStore, {
        onSnapshot: onSnapshot ?? (() => {}),
        onReconnecting: (reason, attempt, delayMs) => {
          console.log(
            `[jito-tip] stream reconnecting (${reason}), attempt #${attempt} in ~${delayMs}ms`
          )
        },
        onError: (err) => {
          console.error(`[jito-tip] stream error: ${err.message}`)
        },
      })

      streamClient.connect()

      const stalenessThreshold = restRefreshMs * 2

      restTimer = setInterval(async () => {
        if (!isRunning) return
        const timeSinceLastWs = Date.now() - lastWsUpdate
        if (timeSinceLastWs >= stalenessThreshold) {
          try {
            const snapshot = await fetchTipFloor(restUrl)
            latest = snapshot
            console.log(
              `[jito-tip] REST backstop refreshed — p50: ${snapshot.p50} lamports`
            )
          } catch (err) {
            console.error(
              `[jito-tip] REST backstop failed: ${err instanceof Error ? err.message : String(err)}`
            )
          }
        }
      }, restRefreshMs)

      return streamClient
    },

    stop(): void {
      isRunning = false
      if (restTimer) {
        clearInterval(restTimer)
        restTimer = null
      }
      if (streamClient) {
        streamClient.disconnect()
        streamClient = null
      }
    },
  }
}

export type { TipFloorStore as TipFloorStoreType }
