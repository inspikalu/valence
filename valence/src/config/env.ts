import "dotenv/config"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ValenceConfig } from "../types/index.js"

function stripValue(value: string | undefined): string | undefined {
  return value?.trim()
}

function envOrNull(value: string | undefined): string | null {
  const stripped = stripValue(value)
  return stripped && stripped.length > 0 ? stripped : null
}

function defaultKeypairPath(): string | null {
  const path = join(homedir(), ".config", "solana", "id.json")
  return existsSync(path) ? path : null
}

function parseCommaList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function loadConfig(): ValenceConfig {
  const rpcUrl = stripValue(process.env.RPC_URL)
  if (!rpcUrl) {
    throw new Error(
      "Missing required env var: RPC_URL. Set it in .env or export it. See .env.example."
    )
  }
  if (!rpcUrl.startsWith("https://")) {
    throw new Error(
      `RPC_URL must start with https://, got: ${rpcUrl}`
    )
  }
  try {
    new URL(rpcUrl)
  } catch {
    throw new Error(
      `RPC_URL is not a valid URL: ${rpcUrl}`
    )
  }

  let privateKey = envOrNull(process.env.PRIVATE_KEY)
  let keypairFile = envOrNull(process.env.KEYPAIR_FILE)

  if (!keypairFile && !privateKey) {
    keypairFile = defaultKeypairPath()
  }

  if (!privateKey && !keypairFile) {
    throw new Error(
      "Missing keypair source: set PRIVATE_KEY or KEYPAIR_FILE in .env, " +
      "or ensure ~/.config/solana/id.json exists. See .env.example."
    )
  }

  const logLevel = stripValue(process.env.LOG_LEVEL) ?? "info"

  const yellowstoneEndpoint = envOrNull(process.env.YELLOWSTONE_ENDPOINT)
  const yellowstoneGrpcToken = envOrNull(process.env.YELLOWSTONE_GRPC_TOKEN)

  const jitoValidatorKeys = parseCommaList(process.env.JITO_VALIDATOR_KEYS)

  const leaderHeartbeatIntervalRaw = stripValue(process.env.LEADER_HEARTBEAT_INTERVAL)
  const leaderHeartbeatInterval = leaderHeartbeatIntervalRaw
    ? Number.parseInt(leaderHeartbeatIntervalRaw, 10)
    : 1
  const finalHeartbeatInterval =
    Number.isFinite(leaderHeartbeatInterval) && leaderHeartbeatInterval > 0
      ? leaderHeartbeatInterval
      : 1

  const sendTestTxRaw = stripValue(process.env.SEND_TEST_TX)
  const sendTestTx = sendTestTxRaw === "true" || sendTestTxRaw === "1"

  const showTipDataRaw = stripValue(process.env.SHOW_TIP_DATA)
  const showTipData = showTipDataRaw === "true" || showTipDataRaw === "1"

  const jitoTipFloorUrl =
    stripValue(process.env.JITO_TIP_FLOOR_URL) ??
    "https://bundles.jito.wtf/api/v1/bundles/tip_floor"

  const jitoTipStreamUrl =
    stripValue(process.env.JITO_TIP_STREAM_URL) ??
    "wss://bundles.jito.wtf/api/v1/bundles/tip_stream"

  const jitoBlockEngineUrl =
    stripValue(process.env.JITO_BLOCK_ENGINE_URL) ??
    "https://mainnet.block-engine.jito.wtf"

  const jitoTipRestRefreshMsRaw = stripValue(process.env.JITO_TIP_REST_REFRESH_MS)
  const jitoTipRestRefreshMs = jitoTipRestRefreshMsRaw
    ? Number.parseInt(jitoTipRestRefreshMsRaw, 10)
    : 10_000
  const finalJitoTipRestRefreshMs =
    Number.isFinite(jitoTipRestRefreshMs) && jitoTipRestRefreshMs > 0
      ? jitoTipRestRefreshMs
      : 10_000

  const sendBundleRaw = stripValue(process.env.SEND_BUNDLE)
  const sendBundle = sendBundleRaw === "true" || sendBundleRaw === "1"

  const bundleTipLamportsRaw = stripValue(process.env.BUNDLE_TIP_LAMPORTS)
  const bundleTipLamports = bundleTipLamportsRaw
    ? Number.parseInt(bundleTipLamportsRaw, 10)
    : 1000
  const finalBundleTipLamports =
    Number.isFinite(bundleTipLamports) && bundleTipLamports > 0
      ? bundleTipLamports
      : 1000

  const lifecycleLogPath = envOrNull(process.env.LIFECYCLE_LOG_PATH)

  const intentionalExpiryRaw = stripValue(process.env.INTENTIONAL_EXPIRY)
  const intentionalExpiry = intentionalExpiryRaw === "true" || intentionalExpiryRaw === "1"

  const maxRetriesRaw = stripValue(process.env.MAX_RETRIES)
  const maxRetriesParsed = maxRetriesRaw ? Number.parseInt(maxRetriesRaw, 10) : 3
  const maxRetries = Number.isFinite(maxRetriesParsed) ? Math.max(0, Math.min(10, maxRetriesParsed)) : 3

  const groqApiKey = envOrNull(process.env.GROQ_API_KEY)

  const groqModelRaw = stripValue(process.env.GROQ_MODEL)
  const groqModel = groqModelRaw ?? "llama-3.1-8b-instant"

  const groqEndpointRaw = stripValue(process.env.GROQ_ENDPOINT)
  const groqEndpoint = groqEndpointRaw ?? "https://api.groq.com/openai/v1"

  const maxTipLamportsRaw = stripValue(process.env.MAX_TIP_LAMPORTS)
  const maxTipLamportsParsed = maxTipLamportsRaw
    ? Number.parseInt(maxTipLamportsRaw, 10)
    : 10000
  const maxTipLamports = Number.isFinite(maxTipLamportsParsed)
    ? Math.max(1000, Math.min(100000, maxTipLamportsParsed))
    : 10000

  const volumeCountRaw = stripValue(process.env.VOLUME_COUNT)
  const volumeCountParsed = volumeCountRaw ? Number.parseInt(volumeCountRaw, 10) : 1
  const volumeCount = Number.isFinite(volumeCountParsed) && volumeCountParsed > 0 ? volumeCountParsed : 1

  const volumeIntervalMsRaw = stripValue(process.env.VOLUME_INTERVAL_MS)
  const volumeIntervalMsParsed = volumeIntervalMsRaw ? Number.parseInt(volumeIntervalMsRaw, 10) : 2000
  const volumeIntervalMs = Number.isFinite(volumeIntervalMsParsed) && volumeIntervalMsParsed > 0 ? volumeIntervalMsParsed : 2000

  const injectFailureMode = stripValue(process.env.INJECT_FAILURE_MODE) ?? ""

  return {
    rpcUrl,
    privateKey,
    keypairFile,
    logLevel,
    yellowstoneEndpoint,
    yellowstoneGrpcToken,
    jitoValidatorKeys,
    leaderHeartbeatInterval: finalHeartbeatInterval,
    sendTestTx,
    showTipData,
    jitoTipFloorUrl,
    jitoTipStreamUrl,
    jitoBlockEngineUrl,
    jitoTipRestRefreshMs: finalJitoTipRestRefreshMs,
    sendBundle,
    bundleTipLamports: finalBundleTipLamports,
    lifecycleLogPath,
    intentionalExpiry,
    maxRetries,
    groqApiKey,
    groqModel,
    groqEndpoint,
    maxTipLamports,
    volumeCount,
    volumeIntervalMs,
    injectFailureMode,
  }
}
