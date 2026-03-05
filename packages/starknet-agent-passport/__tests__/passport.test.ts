import { describe, expect, it } from "vitest"
import {
  CAPABILITY_CATEGORIES,
  capabilityKey,
  decodeByteArrayAsString,
  parseCapsList,
  stringifyCapsList,
  validatePassport,
} from "../src/index.js"

describe("agent-passport", () => {
  it("builds capability keys", () => {
    expect(capabilityKey("swap")).toBe("capability:swap")
    expect(() => capabilityKey(" ")).toThrow(/empty/i)
  })

  it("parses and stringifies caps list", () => {
    expect(parseCapsList(undefined)).toEqual([])
    expect(parseCapsList("\n")).toEqual([])

    const names = parseCapsList(JSON.stringify(["a", "b", "a"]))
    expect(names).toEqual(["a", "b"])

    expect(stringifyCapsList(["a", "b", "a", " "])).toBe(JSON.stringify(["a", "b"]))
  })

  it("decodes byte array metadata safely", () => {
    expect(decodeByteArrayAsString(undefined)).toBe("")
    expect(decodeByteArrayAsString("caps")).toBe("caps")
  })

  it("rejects invalid caps metadata", () => {
    expect(() => parseCapsList(JSON.stringify({ a: 1 }))).toThrow(/must be a JSON array/i)
    expect(() => parseCapsList(JSON.stringify([1]))).toThrow(/must be strings/i)
  })

  it("validates a conforming passport payload", () => {
    const result = validatePassport({
      capabilities: [
        {
          name: "forecast",
          category: "prediction",
          version: "1.0.0",
          description: "Generate calibrated probabilities",
          endpoint: "https://agent.example.com/api/predict",
          mcpTool: "starknet_call_contract",
          a2aSkillId: "forecast",
        },
      ],
    })
    expect(result.valid).toBe(true)
  })

  it("rejects unexpected passport fields and duplicate names", () => {
    const result = validatePassport({
      capabilities: [
        { name: "swap", category: "defi", unknown: "x" },
        { name: "swap", category: "defi" },
      ],
    })

    expect(result.valid).toBe(false)
    expect(result.errors?.some((e) => e.includes("unexpected field"))).toBe(true)
    expect(result.errors?.some((e) => e.includes("duplicate capability name"))).toBe(true)
  })

  it("rejects invalid category and invalid mcp tool format", () => {
    const badCategory = validatePassport({
      capabilities: [{ name: "swap", category: "unknown" }],
    })
    expect(badCategory.valid).toBe(false)
    expect(badCategory.errors?.some((e) => e.includes(CAPABILITY_CATEGORIES.join(", ")))).toBe(true)

    const badMcpTool = validatePassport({
      capabilities: [{ name: "swap", category: "defi", mcpTool: "Starknet-Swap" }],
    })
    expect(badMcpTool.valid).toBe(false)
    expect(badMcpTool.errors?.some((e) => e.includes("mcpTool"))).toBe(true)
  })
})
