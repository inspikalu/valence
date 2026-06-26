import type { SolanaRpcClient } from "../../rpc/index.js"

const KOBE_API = "https://kobe.mainnet.jito.network/api/v1/validators"

interface KobeValidator {
  vote_account: string
  mev_commission_bps: number
  running_jito: boolean
}

interface KobeResponse {
  validators: KobeValidator[]
}

let scheduleCache: Map<bigint, string> | null = null
let epochStartSlotCache: bigint | null = null
let epochCache: number | null = null
let slotsInEpochCache: number | null = null

export async function fetchJitoValidatorKeys(
  rpc: SolanaRpcClient,
  overrideKeys: string[]
): Promise<string[]> {
  const combined = new Set(overrideKeys)

  try {
    const response = await fetch(KOBE_API, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) {
      console.warn(`[leader] Kobe API returned ${response.status}, falling back to env var keys only`)
      return [...combined]
    }

    const data: KobeResponse = await response.json()
    const jitoVoteAccounts = new Set(
      data.validators.filter((v) => v.running_jito).map((v) => v.vote_account)
    )

    if (jitoVoteAccounts.size === 0) {
      return [...combined]
    }

    const voteAccounts = await rpc.getConnection().getVoteAccounts()
    for (const validator of [...voteAccounts.current, ...voteAccounts.delinquent]) {
      if (jitoVoteAccounts.has(validator.votePubkey)) {
        combined.add(validator.nodePubkey)
      }
    }

    console.log(
      `[leader] Kobe API: ${jitoVoteAccounts.size} Jito vote accounts, ` +
        `${combined.size - overrideKeys.length} matched to identity keys` +
        (overrideKeys.length > 0 ? ` (${overrideKeys.length} from env var)` : "")
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[leader] Kobe API fetch failed (${msg}), falling back to env var keys only`)
  }

  return [...combined]
}

export async function fetchLeaderSchedule(
  rpc: SolanaRpcClient,
  jitoValidatorKeys: string[]
): Promise<{
  schedule: Map<bigint, string>
  epochStartSlot: bigint
  jitoCount: number
  jitoKeys: string[]
}> {
  const connection = rpc.getConnection()
  const epochInfo = await connection.getEpochInfo("confirmed")
  const rawSchedule = await connection.getLeaderSchedule()

  const schedule = new Map<bigint, string>()
  const epochStartSlot = BigInt(epochInfo.absoluteSlot) - BigInt(epochInfo.slotIndex)

  for (const [identity, slots] of Object.entries(rawSchedule)) {
    for (const slot of slots) {
      schedule.set(BigInt(slot) + epochStartSlot, identity)
    }
  }

  if (schedule.size > 0) {
    const sortedSlots = [...schedule.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    const minSlot = sortedSlots[0]!
    const maxSlot = sortedSlots[sortedSlots.length - 1]!

    let lastIdentity = schedule.get(minSlot)!
    for (let s = minSlot + BigInt(1); s <= maxSlot; s++) {
      const existing = schedule.get(s)
      if (existing !== undefined) {
        lastIdentity = existing
      } else {
        schedule.set(s, lastIdentity)
      }
    }
  }

  const jitoKeys = await fetchJitoValidatorKeys(rpc, jitoValidatorKeys)
  const jitoSet = new Set(jitoKeys)
  let jitoCount = 0
  for (const identity of schedule.values()) {
    if (jitoSet.has(identity)) jitoCount++
  }

  scheduleCache = schedule
  epochStartSlotCache = epochStartSlot
  epochCache = epochInfo.epoch
  slotsInEpochCache = epochInfo.slotsInEpoch

  return { schedule, epochStartSlot, jitoCount, jitoKeys }
}

export function isJitoValidator(identity: string, jitoValidatorKeys: string[]): boolean {
  return jitoValidatorKeys.includes(identity)
}

export function getCachedSchedule(): Map<bigint, string> | null {
  return scheduleCache
}

export function getEpochStartSlot(): bigint | null {
  return epochStartSlotCache
}

export function shouldRefreshEpoch(currentSlot: bigint): boolean {
  if (epochStartSlotCache === null || slotsInEpochCache === null) return true
  return currentSlot - epochStartSlotCache >= BigInt(slotsInEpochCache)
}
