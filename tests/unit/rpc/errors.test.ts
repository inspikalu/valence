import { describe, it, expect } from "vitest"
import { RpcConnectionError, RpcRateLimitError, RpcTimeoutError } from "@valence/rpc"

describe("RPC error classes", () => {
  it("RpcConnectionError is instanceof Error and RpcConnectionError", () => {
    const err = new RpcConnectionError("connection refused")
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(RpcConnectionError)
    expect(err.name).toBe("RpcConnectionError")
    expect(err.message).toBe("connection refused")
  })

  it("RpcRateLimitError is instanceof Error and RpcRateLimitError", () => {
    const err = new RpcRateLimitError("rate limited")
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(RpcRateLimitError)
    expect(err.name).toBe("RpcRateLimitError")
  })

  it("RpcTimeoutError is instanceof Error and RpcTimeoutError", () => {
    const err = new RpcTimeoutError("timed out")
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(RpcTimeoutError)
    expect(err.name).toBe("RpcTimeoutError")
  })
})
