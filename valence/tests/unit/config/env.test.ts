import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs")
  return {
    ...actual as Record<string, unknown>,
    existsSync: vi.fn(() => false),
  }
})

import { loadConfig } from "@valence/config"

const ORIGINAL_ENV = { ...process.env }

function cleanEnv(): void {
  delete process.env.RPC_URL
  delete process.env.PRIVATE_KEY
  delete process.env.KEYPAIR_FILE
  delete process.env.LOG_LEVEL
  delete process.env.VOLUME_COUNT
  delete process.env.VOLUME_INTERVAL_MS
  delete process.env.INJECT_FAILURE_MODE
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe("loadConfig", () => {
  beforeEach(() => {
    cleanEnv()
  })

  it("returns a valid config with PRIVATE_KEY set", () => {
    process.env.RPC_URL = "https://api.mainnet-beta.solana.com"
    process.env.PRIVATE_KEY = "5MaiiCavjCznEVDTpLTMnLmD66GnPgK8N1B8kGmCqQuF"
    process.env.LOG_LEVEL = "debug"

    const config = loadConfig()
    expect(config.rpcUrl).toBe("https://api.mainnet-beta.solana.com")
    expect(config.privateKey).toBe("5MaiiCavjCznEVDTpLTMnLmD66GnPgK8N1B8kGmCqQuF")
    expect(config.keypairFile).toBeNull()
    expect(config.logLevel).toBe("debug")
  })

  it("returns a valid config with KEYPAIR_FILE set", () => {
    process.env.RPC_URL = "https://api.mainnet-beta.solana.com"
    process.env.KEYPAIR_FILE = "/home/user/.config/solana/id.json"

    const config = loadConfig()
    expect(config.keypairFile).toBe("/home/user/.config/solana/id.json")
    expect(config.privateKey).toBeNull()
  })

  it("defaults LOG_LEVEL to info", () => {
    process.env.RPC_URL = "https://api.mainnet-beta.solana.com"
    process.env.PRIVATE_KEY = "5MaiiCavjCznEVDTpLTMnLmD66GnPgK8N1B8kGmCqQuF"

    const config = loadConfig()
    expect(config.logLevel).toBe("info")
  })

  it("defaults volume config values correctly", () => {
    process.env.RPC_URL = "https://api.mainnet-beta.solana.com"
    process.env.PRIVATE_KEY = "5MaiiCavjCznEVDTpLTMnLmD66GnPgK8N1B8kGmCqQuF"

    const config = loadConfig()
    expect(config.volumeCount).toBe(1)
    expect(config.volumeIntervalMs).toBe(2000)
    expect(config.injectFailureMode).toBe("")
  })

  it("throws when RPC_URL is missing", () => {
    process.env.PRIVATE_KEY = "5MaiiCavjCznEVDTpLTMnLmD66GnPgK8N1B8kGmCqQuF"

    expect(() => loadConfig()).toThrow(/RPC_URL/)
  })

  it("throws when RPC_URL is not https", () => {
    process.env.RPC_URL = "http://api.mainnet-beta.solana.com"
    process.env.PRIVATE_KEY = "5MaiiCavjCznEVDTpLTMnLmD66GnPgK8N1B8kGmCqQuF"

    expect(() => loadConfig()).toThrow(/https/)
  })

  it("throws when both keypair sources are missing and no default keypair found", () => {
    process.env.RPC_URL = "https://api.mainnet-beta.solana.com"

    expect(() => loadConfig()).toThrow(/PRIVATE_KEY|KEYPAIR_FILE|keypair source/)
  })
})
