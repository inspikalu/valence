import { describe, it, expect } from "vitest"
import { parseInjectFailureModes } from "@valence/config"

describe("parseInjectFailureModes", () => {
  it("returns empty array for empty string", () => {
    expect(parseInjectFailureModes("")).toEqual([])
  })

  it("parses a single mode", () => {
    expect(parseInjectFailureModes("expiry")).toEqual(["expiry"])
    expect(parseInjectFailureModes("low_tip")).toEqual(["low_tip"])
    expect(parseInjectFailureModes("compute_exceeded")).toEqual(["compute_exceeded"])
  })

  it("parses multiple comma-separated modes", () => {
    expect(parseInjectFailureModes("expiry,low_tip,compute_exceeded")).toEqual([
      "expiry",
      "low_tip",
      "compute_exceeded",
    ])
  })

  it("throws on invalid mode", () => {
    expect(() => parseInjectFailureModes("unknown")).toThrow(/invalid inject failure mode/i)
  })

  it("throws on mixed valid and invalid modes", () => {
    expect(() => parseInjectFailureModes("expiry,unknown,low_tip")).toThrow(/invalid inject failure mode/i)
  })
})
