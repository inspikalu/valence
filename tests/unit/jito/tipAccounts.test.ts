import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { getTipAccounts, TipAccountSelector } from "@valence/jito"

const MOCK_VALID_ACCOUNTS = [
  "2hmnFm5MWMEsynnkAggjnS7Db1MhrHZ8sqxbA1JYEfPd",
  "E2rFqb3QgaoBhrsAFwmc7AKTjamtW51SzHggD79gsaaV",
  "HcStJi5oXn5hQc53bVbrLM6f3EkgAbMPzTVmLjdVYmwZ",
  "7k99sYwcgxkjnpEttauKPuWdh7r7TzM1Hsy4bknXi8kS",
  "xGNSU7aDNkMyeGZgZDfQX4pqtHHJoemL2VQXAmPAcwL",
  "5L4zsBFpoyZT1TRkoCuwTrnHJc9g6cBSxTFHRWwwCZRd",
  "AnuqNGoNkCdNu9BjBA4jjEC198rStMRD1z1erpKcy3Mr",
  "35wUetaoYivZBYTf6PLHUH8jS5SwG7qaCYh6ZdDyN5u7",
]

const MOCK_RESPONSE = {
  jsonrpc: "2.0",
  id: 1,
  result: MOCK_VALID_ACCOUNTS,
}

const MOCK_INVALID_ENTRIES = ["not-base58!!", "has O and 0", "also l I"]
const MOCK_RESPONSE_WITH_INVALID = {
  jsonrpc: "2.0",
  id: 1,
  result: [...MOCK_VALID_ACCOUNTS, ...MOCK_INVALID_ENTRIES],
}

describe("getTipAccounts", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("fetches and returns tip accounts from JSON-RPC response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response)

    const accounts = await getTipAccounts("https://example.com")
    expect(accounts).toEqual(MOCK_VALID_ACCOUNTS)
    expect(accounts.length).toBe(8)
  })

  it("filters out non-base58 entries", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_RESPONSE_WITH_INVALID,
    } as Response)

    const accounts = await getTipAccounts("https://example.com")
    expect(accounts.length).toBe(8)
    expect(accounts).not.toContain("not-base58!!")
  })

  it("throws on HTTP error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as Response)

    await expect(
      getTipAccounts("https://example.com")
    ).rejects.toThrow(/500/)
  })

  it("throws on JSON-RPC error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        error: { message: "unauthorized" },
      }),
    } as Response)

    await expect(
      getTipAccounts("https://example.com")
    ).rejects.toThrow(/unauthorized/)
  })

  it("throws when result is not an array", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: "not-an-array",
      }),
    } as Response)

    await expect(
      getTipAccounts("https://example.com")
    ).rejects.toThrow(/unexpected result/)
  })

  it("throws when no valid accounts remain after filtering", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: ["not-base58!!", "also-!!invalid"],
      }),
    } as Response)

    await expect(
      getTipAccounts("https://example.com")
    ).rejects.toThrow(/no valid base58/)
  })
})

describe("TipAccountSelector", () => {
  it("round-robins through all accounts", () => {
    const selector = new TipAccountSelector(MOCK_VALID_ACCOUNTS, 0)
    for (let i = 0; i < MOCK_VALID_ACCOUNTS.length; i++) {
      expect(selector.next()).toBe(MOCK_VALID_ACCOUNTS[i])
    }
  })

  it("wraps around after the last account", () => {
    const selector = new TipAccountSelector(MOCK_VALID_ACCOUNTS, 0)
    for (let i = 0; i < MOCK_VALID_ACCOUNTS.length; i++) {
      selector.next()
    }
    expect(selector.next()).toBe(MOCK_VALID_ACCOUNTS[0])
  })

  it("starts at the given offset", () => {
    const selector = new TipAccountSelector(MOCK_VALID_ACCOUNTS, 3)
    expect(selector.next()).toBe(MOCK_VALID_ACCOUNTS[3])
    expect(selector.next()).toBe(MOCK_VALID_ACCOUNTS[4])
  })

  it("wraps start offset correctly", () => {
    const selector = new TipAccountSelector(MOCK_VALID_ACCOUNTS, 8)
    expect(selector.next()).toBe(MOCK_VALID_ACCOUNTS[0])
  })

  it("getAccounts returns a copy of the accounts list", () => {
    const selector = new TipAccountSelector(MOCK_VALID_ACCOUNTS)
    const accounts = selector.getAccounts()
    expect(accounts).toEqual(MOCK_VALID_ACCOUNTS)
    expect(accounts).not.toBe(MOCK_VALID_ACCOUNTS)
  })
})
