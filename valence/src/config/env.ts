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

  return { rpcUrl, privateKey, keypairFile, logLevel }
}
