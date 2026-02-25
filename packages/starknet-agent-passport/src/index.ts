import { Contract, type AccountInterface, type ProviderInterface, byteArray, type ByteArray } from "starknet"
import { identityRegistryAbi } from "./identityRegistryAbi.js"

export const PASSPORT_CAPS_KEY = "caps" as const
export const PASSPORT_SCHEMA_KEY = "passport:schema" as const
export const PASSPORT_SCHEMA_ID =
  "https://starknet-agentic.dev/schemas/agent-passport.schema.json" as const

/** Standard capability categories for Agent Passport */
export const CAPABILITY_CATEGORIES = [
  "defi",
  "trading",
  "identity",
  "messaging",
  "payments",
  "prediction",
] as const

export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number]

export type PassportCapability = {
  /** Stable identifier, ex: "swap", "transfer", "forecast" */
  name: string
  /** High-level capability class */
  category: CapabilityCategory
  /** Semantic version of capability behavior */
  version?: string
  /** Human-readable description */
  description?: string
  /** Optional endpoint for this capability */
  endpoint?: string
  /** Optional MCP tool name advertised by this capability */
  mcpTool?: string
  /** Optional A2A skill id for discovery cards */
  a2aSkillId?: string
}

/** Backward-compatible alias used by early docs/examples */
export type AgentCapability = PassportCapability

export type AgentPassport = {
  capabilities: PassportCapability[]
}

/**
 * Validates an Agent Passport object against the schema.
 * Returns { valid: true } or { valid: false, errors: string[] }.
 */
export function validatePassport(data: unknown): { valid: boolean; errors?: string[] } {
  const errors: string[] = []

  if (data == null || typeof data !== "object") {
    return { valid: false, errors: ["Passport must be an object"] }
  }

  const obj = data as Record<string, unknown>
  const topLevelKeys = Object.keys(obj)
  for (const k of topLevelKeys) {
    if (k !== "capabilities") {
      errors.push(`Unexpected top-level key: ${k}`)
    }
  }

  if (!Array.isArray(obj.capabilities)) {
    return { valid: false, errors: ["'capabilities' must be an array"] }
  }

  if (obj.capabilities.length === 0) {
    return { valid: false, errors: ["'capabilities' must have at least one entry"] }
  }

  const validCategories = new Set<string>(CAPABILITY_CATEGORIES)
  const seenNames = new Set<string>()
  const namePattern = /^[a-z][a-z0-9-]*$/
  const versionPattern = /^\d+\.\d+(\.\d+)?$/
  const mcpToolPattern = /^[a-z][a-z0-9_]*$/

  for (let i = 0; i < obj.capabilities.length; i++) {
    const cap = obj.capabilities[i]
    const prefix = `capabilities[${i}]`

    if (cap == null || typeof cap !== "object") {
      errors.push(`${prefix}: must be an object`)
      continue
    }

    const c = cap as Record<string, unknown>
    for (const k of Object.keys(c)) {
      if (!["name", "category", "version", "description", "endpoint", "mcpTool", "a2aSkillId"].includes(k)) {
        errors.push(`${prefix}: unexpected field '${k}'`)
      }
    }

    if (typeof c.name !== "string" || !c.name) {
      errors.push(`${prefix}.name: required string`)
    } else if (!namePattern.test(c.name)) {
      errors.push(`${prefix}.name: must match pattern ^[a-z][a-z0-9-]*$`)
    } else if (c.name.length > 64) {
      errors.push(`${prefix}.name: max 64 characters`)
    } else if (seenNames.has(c.name)) {
      errors.push(`${prefix}.name: duplicate capability name '${c.name}'`)
    } else {
      seenNames.add(c.name)
    }

    if (typeof c.category !== "string" || !validCategories.has(c.category)) {
      errors.push(`${prefix}.category: must be one of ${CAPABILITY_CATEGORIES.join(", ")}`)
    }

    if (c.version !== undefined && (typeof c.version !== "string" || !versionPattern.test(c.version))) {
      errors.push(`${prefix}.version: must match pattern ^\\d+\\.\\d+(\\.\\d+)?$`)
    }

    if (c.description !== undefined && (typeof c.description !== "string" || c.description.length > 256)) {
      errors.push(`${prefix}.description: must be a string (max 256 chars)`)
    }

    if (c.endpoint !== undefined && typeof c.endpoint !== "string") {
      errors.push(`${prefix}.endpoint: must be a string`)
    }

    if (c.mcpTool !== undefined && (typeof c.mcpTool !== "string" || !mcpToolPattern.test(c.mcpTool))) {
      errors.push(`${prefix}.mcpTool: must match pattern ^[a-z][a-z0-9_]*$`)
    }

    if (c.a2aSkillId !== undefined && (typeof c.a2aSkillId !== "string" || !namePattern.test(c.a2aSkillId))) {
      errors.push(`${prefix}.a2aSkillId: must match pattern ^[a-z][a-z0-9-]*$`)
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true }
}

function assertPassportValid(passport: AgentPassport) {
  const validation = validatePassport(passport)
  if (!validation.valid) {
    throw new Error(`Invalid agent passport: ${(validation.errors ?? []).join("; ")}`)
  }
}

export function capabilityKey(name: string): string {
  if (!name.trim()) throw new Error("Capability name is empty")
  return `capability:${name}`
}

export function encodeStringAsByteArray(v: string) {
  return byteArray.byteArrayFromString(v)
}

export function decodeByteArrayAsString(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v
  if (isByteArray(v)) return byteArray.stringFromByteArray(v)
  throw new Error("Unsupported metadata value type (expected string or ByteArray)")
}

function isByteArray(v: unknown): v is ByteArray {
  if (typeof v !== "object" || v === null) return false
  const obj = v as Record<string, unknown>
  return (
    Array.isArray(obj.data) &&
    typeof obj.pending_word === "string" &&
    typeof obj.pending_word_len === "number"
  )
}

export function parseCapsList(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return []
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) throw new Error("caps metadata must be a JSON array")
  const names = parsed.map((x) => {
    if (typeof x !== "string") throw new Error("caps metadata entries must be strings")
    return x
  })
  return [...new Set(names)]
}

export function stringifyCapsList(names: string[]): string {
  const normalized = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  return JSON.stringify(normalized)
}

function parseCapabilityPayload(capabilityName: string, raw: string): PassportCapability {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid JSON for '${capabilityKey(capabilityName)}': ${message}`)
  }

  const validation = validatePassport({ capabilities: [parsed] })
  if (!validation.valid) {
    throw new Error(
      `Invalid capability payload for '${capabilityKey(capabilityName)}': ${(validation.errors ?? []).join("; ")}`
    )
  }

  const capability = parsed as PassportCapability
  if (capability.name !== capabilityName) {
    throw new Error(
      `Capability key/value mismatch: key is '${capabilityName}' but payload name is '${capability.name}'`
    )
  }

  return capability
}

export class IdentityRegistryPassportClient {
  private contract: Contract

  constructor(args: {
    identityRegistryAddress: string
    provider: ProviderInterface
    account?: AccountInterface
  }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- starknet.js Contract constructor accepts Abi type which is loosely typed
    this.contract = new Contract({
      abi: identityRegistryAbi as any,
      address: args.identityRegistryAddress,
      providerOrAccount: args.provider,
    })
    if (args.account) this.contract.connect(args.account)
  }

  async agentExists(agentId: bigint): Promise<boolean> {
    const res = await this.contract.call("agent_exists", [agentId])
    return Boolean(res)
  }

  async getMetadata(agentId: bigint, key: string): Promise<string> {
    const res = await this.contract.call("get_metadata", [agentId, encodeStringAsByteArray(key)])
    return decodeByteArrayAsString(res)
  }

  async setMetadata(agentId: bigint, key: string, value: string) {
    return this.contract.invoke("set_metadata", [
      agentId,
      encodeStringAsByteArray(key),
      encodeStringAsByteArray(value),
    ])
  }

  /**
   * Publishes one capability under `capability:<name>` and updates the `caps` index.
   * Also writes `passport:schema` to advertise the schema used by this payload.
   */
  async publishCapability(args: { agentId: bigint; capability: AgentCapability }) {
    const { agentId, capability } = args
    assertPassportValid({ capabilities: [capability] })

    const capsRaw = await this.getMetadata(agentId, PASSPORT_CAPS_KEY).catch(() => "")
    const caps = parseCapsList(capsRaw)
    const nextCaps = caps.includes(capability.name) ? caps : [...caps, capability.name]

    await this.setMetadata(agentId, capabilityKey(capability.name), JSON.stringify(capability))
    await this.setMetadata(agentId, PASSPORT_CAPS_KEY, stringifyCapsList(nextCaps))
    await this.setMetadata(agentId, PASSPORT_SCHEMA_KEY, PASSPORT_SCHEMA_ID)

    return { caps: nextCaps }
  }

  /**
   * Publishes a full passport object and rewrites the canonical `caps` index.
   * Missing/removed capability entries are not deleted automatically.
   */
  async publishPassport(args: { agentId: bigint; passport: AgentPassport }) {
    const { agentId, passport } = args
    assertPassportValid(passport)

    for (const capability of passport.capabilities) {
      await this.setMetadata(agentId, capabilityKey(capability.name), JSON.stringify(capability))
    }

    await this.setMetadata(
      agentId,
      PASSPORT_CAPS_KEY,
      stringifyCapsList(passport.capabilities.map((capability) => capability.name))
    )
    await this.setMetadata(agentId, PASSPORT_SCHEMA_KEY, PASSPORT_SCHEMA_ID)

    return { caps: passport.capabilities.map((capability) => capability.name) }
  }

  /**
   * Reads canonical `caps` and reconstructs the full passport from `capability:<name>` entries.
   */
  async getPassport(agentId: bigint): Promise<AgentPassport | null> {
    const capsRaw = await this.getMetadata(agentId, PASSPORT_CAPS_KEY).catch(() => "")
    const caps = parseCapsList(capsRaw)
    if (caps.length === 0) {
      return null
    }

    const capabilities: PassportCapability[] = []
    for (const capabilityName of caps) {
      const raw = await this.getMetadata(agentId, capabilityKey(capabilityName))
      if (!raw || !raw.trim()) {
        throw new Error(`Missing capability metadata payload for '${capabilityKey(capabilityName)}'`)
      }
      capabilities.push(parseCapabilityPayload(capabilityName, raw))
    }

    const passport = { capabilities }
    assertPassportValid(passport)
    return passport
  }
}
