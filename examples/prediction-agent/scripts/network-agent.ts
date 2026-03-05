#!/usr/bin/env tsx

import os from "node:os";
import process from "node:process";
import {
  Account,
  CallData,
  RpcProvider,
  stark,
  type TypedData,
} from "starknet";
import {
  categorizeMarket,
  estimateEngagementScore,
  type MarketCategory,
} from "../app/lib/categories";
import {
  completeText,
  getLlmProviderForTask,
  resolveLlmModel,
  type LlmProvider,
  type LlmTask,
} from "../app/lib/llm-provider";

type NetworkAuthAction =
  | "register_agent"
  | "update_agent"
  | "post_contribution"
  | "heartbeat_agent";
type ContributionKind =
  | "forecast"
  | "market"
  | "comment"
  | "debate"
  | "research"
  | "bet";

type JsonMap = Record<string, unknown>;

interface NetworkAgentProfile {
  id: string;
  walletAddress: string;
  name: string;
  handle?: string;
  active: boolean;
  updatedAt: number;
}

interface MarketRow {
  id: number;
  address: string;
  question: string;
  status: number;
  resolutionTime: number;
  impliedProbYes?: number;
  impliedProbNo?: number;
  totalPool?: string;
  collateralToken?: string;
  tradeCount?: number;
}

interface ForecastContribution {
  id: string;
  agentId?: string;
  actorName?: string;
  marketId?: number;
  probability?: number;
  content?: string;
  createdAt?: number;
}

interface ForecastDecision {
  probability: number;
  confidence: number;
  reasoning: string;
  model: string;
  sourceCount: number;
}

interface ResearchDataPoint {
  label: string;
  value: string | number;
  url?: string;
  confidence?: number;
}

interface ResearchSourceResult {
  source: string;
  summary: string;
  data: ResearchDataPoint[];
}

interface ResearchPayload {
  sourceCount: number;
  results: ResearchSourceResult[];
}

interface Options {
  baseUrl: string;
  rpcUrl: string;
  walletAddress: string;
  privateKey: string;
  agentId?: string;
  name: string;
  handle: string;
  description?: string;
  modelLabel: string;
  endpointUrl?: string;
  agentCardUrl?: string;
  proofUrl?: string;
  topics: Array<"sports" | "crypto" | "politics" | "tech" | "world" | "all">;
  budgetStrk?: number;
  maxBetStrk?: number;
  metadata?: Record<string, string>;
  intervalMs: number;
  jitterMs: number;
  once: boolean;
  quiet: boolean;
  maxForecastsPerTick: number;
  maxDebatesPerTick: number;
  forecastCooldownMs: number;
  debateCooldownMs: number;
  marketFetchLimit: number;
  researchSources: string[];
  researchTimeoutMs: number;
  requestTimeoutMs: number;
  challengeTtlSecs: number;
  forecastModel?: string;
  debateModel?: string;
  llmEnabled: boolean;
  enableXaiNativeTools: boolean;
  maxPaidCallsPerHour: number;
  maxPaidCallsPerDay: number;
  premiumLockoutSecs: number;
  executeBets: boolean;
  betAmountStrk: number;
  betMinEdge: number;
  betMinConfidence: number;
  minReserveStrk: number;
  txWaitTimeoutMs: number;
  runtimeProvider: string;
  runtimeRegion?: string;
  runtimeScheduler: string;
  runtimeVersion?: string;
  runtimeNodeId: string;
  runtimeMetadata?: Record<string, string>;
  syncProfileEveryTicks: number;
}

interface WorkerState {
  agentId?: string;
  tickCount: number;
  lastForecastByMarket: Map<number, number>;
  lastDebateByMarket: Map<number, number>;
  budget: {
    paidCallTimestamps: number[];
    lockoutUntilMs: number;
    lockReason: string;
    lastWarningAtMs: number;
    lastWarningKey: string;
  };
}

function usage(): void {
  console.log(`Usage: tsx scripts/network-agent.ts [options]

Runs a full external agent node:
- signed registration/update
- signed heartbeat
- independent research + forecasting
- signed forecast/debate contributions
- optional direct on-chain bets from the worker wallet

Required env:
  NETWORK_AGENT_WALLET_ADDRESS
  NETWORK_AGENT_PRIVATE_KEY

Core env:
  NETWORK_AGENT_BASE_URL=http://localhost:3001
  NETWORK_AGENT_RPC_URL=https://starknet-sepolia.public.blastapi.io
  NETWORK_AGENT_ID=
  NETWORK_AGENT_NAME=Independent Forecaster
  NETWORK_AGENT_HANDLE=independent-forecaster
  NETWORK_AGENT_MODEL_LABEL=external-agent
  NETWORK_AGENT_TOPICS=politics,tech,sports,world
  NETWORK_AGENT_INTERVAL_MS=90000
  NETWORK_AGENT_MAX_FORECASTS_PER_TICK=2
  NETWORK_AGENT_MAX_PAID_CALLS_PER_HOUR=12
  NETWORK_AGENT_MAX_PAID_CALLS_PER_DAY=120
  NETWORK_AGENT_PREMIUM_LOCKOUT_SECS=3600
  NETWORK_AGENT_EXECUTE_BETS=false

Options:
  --base-url <url>                 API base URL
  --rpc-url <url>                  Starknet RPC URL
  --wallet <0x...>                 Wallet address (auth + optional betting)
  --private-key <0x...>            Wallet private key
  --agent-id <id>                  Existing agent id (optional)
  --name <text>                    Agent name
  --handle <slug>                  Agent handle
  --topics <csv>                   all|sports|crypto|politics|tech|world
  --interval-ms <ms>               Loop interval (default 90000)
  --jitter-ms <ms>                 Random +/- jitter (default 5000)
  --max-forecasts-per-tick <n>     Forecasts per tick (default 2)
  --max-debates-per-tick <n>       Debate posts per tick (default 1)
  --market-limit <n>               Markets fetched each tick (default 40)
  --research-sources <csv>         Sources for /api/data-sources
  --max-paid-calls-per-hour <n>    Paid LLM call cap/hour (0=unlimited)
  --max-paid-calls-per-day <n>     Paid LLM call cap/day (0=unlimited)
  --premium-lockout-secs <n>       Lockout when cap hit (default 3600)
  --execute-bets                   Enable direct on-chain bets
  --bet-amount-strk <n>            Per-bet amount when enabled (default 1)
  --bet-min-edge <n>               Min abs(prob - implied) edge (default 0.15)
  --bet-min-confidence <n>         Min confidence [0-1] (default 0.55)
  --llm-off                        Disable LLM, use heuristic-only forecasting
  --once                           Run one tick then exit
  --quiet                          Reduce logs
  -h, --help                       Show help
`);
}

function nowIso(): string {
  return new Date().toISOString();
}

function log(
  options: Options,
  level: "info" | "warn" | "error",
  message: string
): void {
  if (options.quiet && level === "info") return;
  const prefix = level === "info" ? "INFO" : level === "warn" ? "WARN" : "ERROR";
  const fn = level === "error" ? console.error : console.log;
  fn(`[network-agent][${prefix}] ${nowIso()} ${message}`);
}

function requireNonEmpty(value: string | undefined, label: string): string {
  const next = String(value ?? "").trim();
  if (!next) throw new Error(`${label} is required`);
  return next;
}

function parseIntOrDefault(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, parsed);
}

function parseFloatOrDefault(
  value: string | undefined,
  fallback: number,
  min?: number,
  max?: number
): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  let next = Number.isFinite(parsed) ? parsed : fallback;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const raw = value.trim().toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "no", "off"].includes(raw);
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  return parsed.toString().replace(/\/+$/, "");
}

function parseCsv(raw: string | undefined): string[] {
  return String(raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 48);
}

function parseMetadata(raw: string | undefined): Record<string, string> | undefined {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err: any) {
    throw new Error(`NETWORK_AGENT_METADATA_JSON is invalid JSON: ${err?.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("NETWORK_AGENT_METADATA_JSON must be a JSON object");
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!key.trim()) continue;
    out[key] = String(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseTopics(raw: string | undefined): Array<"sports" | "crypto" | "politics" | "tech" | "world" | "all"> {
  const set = new Set(parseCsv(raw).map((topic) => topic.toLowerCase()));
  if (set.size === 0) {
    return ["politics", "tech", "sports", "world", "crypto"];
  }
  if (set.has("all")) return ["all"];
  const allowed = new Set(["sports", "crypto", "politics", "tech", "world"]);
  const topics = Array.from(set).filter((topic): topic is "sports" | "crypto" | "politics" | "tech" | "world" =>
    allowed.has(topic)
  );
  return topics.length > 0 ? topics : ["all"];
}

function compactObject<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = compactObject(value as Record<string, unknown>);
      if (Object.keys(nested).length === 0) continue;
      out[key] = nested;
      continue;
    }
    out[key] = value;
  }
  return out as T;
}

function clampProbability(value: number | undefined, fallback = 0.5): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

function short(value: string, max = 260): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 3)}...`;
}

function normalizeSignature(signature: unknown): string[] {
  return stark.formatSignature(signature as any).map((item) => String(item));
}

async function requestJson(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      json,
      text,
    };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function parseArgs(argv: string[]): Options {
  if (argv.includes("-h") || argv.includes("--help")) {
    usage();
    process.exit(0);
  }

  const options: Options = {
    baseUrl: normalizeBaseUrl(process.env.NETWORK_AGENT_BASE_URL || "http://localhost:3001"),
    rpcUrl:
      process.env.NETWORK_AGENT_RPC_URL ||
      process.env.STARKNET_RPC_URL ||
      "https://starknet-sepolia.public.blastapi.io",
    walletAddress: String(process.env.NETWORK_AGENT_WALLET_ADDRESS ?? "").trim().toLowerCase(),
    privateKey: String(process.env.NETWORK_AGENT_PRIVATE_KEY ?? "").trim(),
    agentId: process.env.NETWORK_AGENT_ID?.trim() || undefined,
    name: process.env.NETWORK_AGENT_NAME?.trim() || "Independent Forecaster",
    handle:
      process.env.NETWORK_AGENT_HANDLE?.trim() ||
      slugify(process.env.NETWORK_AGENT_NAME || "independent-forecaster"),
    description: process.env.NETWORK_AGENT_DESCRIPTION?.trim() || undefined,
    modelLabel: process.env.NETWORK_AGENT_MODEL_LABEL?.trim() || "external-agent",
    endpointUrl: process.env.NETWORK_AGENT_ENDPOINT_URL?.trim() || undefined,
    agentCardUrl: process.env.NETWORK_AGENT_CARD_URL?.trim() || undefined,
    proofUrl: process.env.NETWORK_AGENT_PROOF_URL?.trim() || undefined,
    topics: parseTopics(process.env.NETWORK_AGENT_TOPICS),
    budgetStrk: process.env.NETWORK_AGENT_BUDGET_STRK
      ? parseFloatOrDefault(process.env.NETWORK_AGENT_BUDGET_STRK, 0, 0)
      : undefined,
    maxBetStrk: process.env.NETWORK_AGENT_MAX_BET_STRK
      ? parseFloatOrDefault(process.env.NETWORK_AGENT_MAX_BET_STRK, 0, 0)
      : undefined,
    metadata: parseMetadata(process.env.NETWORK_AGENT_METADATA_JSON),
    intervalMs: parseIntOrDefault(process.env.NETWORK_AGENT_INTERVAL_MS, 90_000, 2_000),
    jitterMs: parseIntOrDefault(process.env.NETWORK_AGENT_JITTER_MS, 5_000, 0),
    once: parseBool(process.env.NETWORK_AGENT_ONCE, false),
    quiet: parseBool(process.env.NETWORK_AGENT_QUIET, false),
    maxForecastsPerTick: parseIntOrDefault(
      process.env.NETWORK_AGENT_MAX_FORECASTS_PER_TICK,
      2,
      1
    ),
    maxDebatesPerTick: parseIntOrDefault(
      process.env.NETWORK_AGENT_MAX_DEBATES_PER_TICK,
      1,
      0
    ),
    forecastCooldownMs: parseIntOrDefault(
      process.env.NETWORK_AGENT_FORECAST_COOLDOWN_MS,
      15 * 60 * 1000,
      60_000
    ),
    debateCooldownMs: parseIntOrDefault(
      process.env.NETWORK_AGENT_DEBATE_COOLDOWN_MS,
      10 * 60 * 1000,
      60_000
    ),
    marketFetchLimit: parseIntOrDefault(process.env.NETWORK_AGENT_MARKET_LIMIT, 40, 5),
    researchSources: parseCsv(
      process.env.NETWORK_AGENT_RESEARCH_SOURCES ||
        "polymarket,news,web,rss,onchain,social"
    ),
    researchTimeoutMs: parseIntOrDefault(
      process.env.NETWORK_AGENT_RESEARCH_TIMEOUT_MS,
      20_000,
      1_000
    ),
    requestTimeoutMs: parseIntOrDefault(
      process.env.NETWORK_AGENT_REQUEST_TIMEOUT_MS,
      12_000,
      1_000
    ),
    challengeTtlSecs: parseIntOrDefault(
      process.env.NETWORK_AGENT_CHALLENGE_TTL_SECS,
      180,
      30
    ),
    forecastModel: process.env.NETWORK_AGENT_FORECAST_MODEL?.trim() || undefined,
    debateModel: process.env.NETWORK_AGENT_DEBATE_MODEL?.trim() || undefined,
    llmEnabled: parseBool(process.env.NETWORK_AGENT_LLM_ENABLED, true),
    enableXaiNativeTools: parseBool(process.env.NETWORK_AGENT_ENABLE_XAI_TOOLS, false),
    maxPaidCallsPerHour: parseIntOrDefault(
      process.env.NETWORK_AGENT_MAX_PAID_CALLS_PER_HOUR,
      12,
      0
    ),
    maxPaidCallsPerDay: parseIntOrDefault(
      process.env.NETWORK_AGENT_MAX_PAID_CALLS_PER_DAY,
      120,
      0
    ),
    premiumLockoutSecs: parseIntOrDefault(
      process.env.NETWORK_AGENT_PREMIUM_LOCKOUT_SECS,
      3600,
      0
    ),
    executeBets: parseBool(process.env.NETWORK_AGENT_EXECUTE_BETS, false),
    betAmountStrk: parseFloatOrDefault(process.env.NETWORK_AGENT_BET_AMOUNT_STRK, 1, 0.01),
    betMinEdge: parseFloatOrDefault(process.env.NETWORK_AGENT_BET_MIN_EDGE, 0.15, 0, 1),
    betMinConfidence: parseFloatOrDefault(
      process.env.NETWORK_AGENT_BET_MIN_CONFIDENCE,
      0.55,
      0,
      1
    ),
    minReserveStrk: parseFloatOrDefault(process.env.NETWORK_AGENT_MIN_RESERVE_STRK, 0.5, 0),
    txWaitTimeoutMs: parseIntOrDefault(process.env.NETWORK_AGENT_TX_WAIT_TIMEOUT_MS, 12_000, 1_000),
    runtimeProvider: process.env.NETWORK_AGENT_RUNTIME_PROVIDER?.trim() || "independent-node",
    runtimeRegion: process.env.NETWORK_AGENT_RUNTIME_REGION?.trim() || undefined,
    runtimeScheduler: process.env.NETWORK_AGENT_RUNTIME_SCHEDULER?.trim() || "self",
    runtimeVersion: process.env.NETWORK_AGENT_RUNTIME_VERSION?.trim() || undefined,
    runtimeNodeId: process.env.NETWORK_AGENT_RUNTIME_NODE_ID?.trim() || os.hostname(),
    runtimeMetadata: parseMetadata(process.env.NETWORK_AGENT_RUNTIME_METADATA_JSON),
    syncProfileEveryTicks: parseIntOrDefault(
      process.env.NETWORK_AGENT_SYNC_PROFILE_EVERY_TICKS,
      20,
      1
    ),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url") {
      options.baseUrl = normalizeBaseUrl(requireNonEmpty(argv[++i], "--base-url"));
      continue;
    }
    if (arg === "--rpc-url") {
      options.rpcUrl = requireNonEmpty(argv[++i], "--rpc-url");
      continue;
    }
    if (arg === "--wallet") {
      options.walletAddress = requireNonEmpty(argv[++i], "--wallet").toLowerCase();
      continue;
    }
    if (arg === "--private-key") {
      options.privateKey = requireNonEmpty(argv[++i], "--private-key");
      continue;
    }
    if (arg === "--agent-id") {
      options.agentId = requireNonEmpty(argv[++i], "--agent-id");
      continue;
    }
    if (arg === "--name") {
      options.name = requireNonEmpty(argv[++i], "--name");
      continue;
    }
    if (arg === "--handle") {
      options.handle = slugify(requireNonEmpty(argv[++i], "--handle"));
      continue;
    }
    if (arg === "--topics") {
      options.topics = parseTopics(requireNonEmpty(argv[++i], "--topics"));
      continue;
    }
    if (arg === "--interval-ms") {
      options.intervalMs = parseIntOrDefault(argv[++i], options.intervalMs, 2_000);
      continue;
    }
    if (arg === "--jitter-ms") {
      options.jitterMs = parseIntOrDefault(argv[++i], options.jitterMs, 0);
      continue;
    }
    if (arg === "--max-forecasts-per-tick") {
      options.maxForecastsPerTick = parseIntOrDefault(argv[++i], options.maxForecastsPerTick, 1);
      continue;
    }
    if (arg === "--max-debates-per-tick") {
      options.maxDebatesPerTick = parseIntOrDefault(argv[++i], options.maxDebatesPerTick, 0);
      continue;
    }
    if (arg === "--market-limit") {
      options.marketFetchLimit = parseIntOrDefault(argv[++i], options.marketFetchLimit, 5);
      continue;
    }
    if (arg === "--research-sources") {
      options.researchSources = parseCsv(requireNonEmpty(argv[++i], "--research-sources"));
      continue;
    }
    if (arg === "--max-paid-calls-per-hour") {
      options.maxPaidCallsPerHour = parseIntOrDefault(argv[++i], options.maxPaidCallsPerHour, 0);
      continue;
    }
    if (arg === "--max-paid-calls-per-day") {
      options.maxPaidCallsPerDay = parseIntOrDefault(argv[++i], options.maxPaidCallsPerDay, 0);
      continue;
    }
    if (arg === "--premium-lockout-secs") {
      options.premiumLockoutSecs = parseIntOrDefault(argv[++i], options.premiumLockoutSecs, 0);
      continue;
    }
    if (arg === "--execute-bets") {
      options.executeBets = true;
      continue;
    }
    if (arg === "--bet-amount-strk") {
      options.betAmountStrk = parseFloatOrDefault(argv[++i], options.betAmountStrk, 0.01);
      continue;
    }
    if (arg === "--bet-min-edge") {
      options.betMinEdge = parseFloatOrDefault(argv[++i], options.betMinEdge, 0, 1);
      continue;
    }
    if (arg === "--bet-min-confidence") {
      options.betMinConfidence = parseFloatOrDefault(argv[++i], options.betMinConfidence, 0, 1);
      continue;
    }
    if (arg === "--llm-off") {
      options.llmEnabled = false;
      continue;
    }
    if (arg === "--once") {
      options.once = true;
      continue;
    }
    if (arg === "--quiet") {
      options.quiet = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  options.walletAddress = requireNonEmpty(
    options.walletAddress,
    "NETWORK_AGENT_WALLET_ADDRESS (or --wallet)"
  ).toLowerCase();
  options.privateKey = requireNonEmpty(
    options.privateKey,
    "NETWORK_AGENT_PRIVATE_KEY (or --private-key)"
  );
  options.handle = slugify(options.handle || options.name);
  if (!options.handle) {
    options.handle = slugify(options.name || "external-agent");
  }

  return options;
}

async function issueChallengeAndSign(args: {
  options: Options;
  account: Account;
  action: NetworkAuthAction;
  payload: JsonMap;
}): Promise<{ challengeId: string; signature: string[] }> {
  const challenge = await requestJson(
    endpoint(args.options.baseUrl, "/api/network/auth/challenge"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        action: args.action,
        walletAddress: args.options.walletAddress,
        payload: args.payload,
        ttlSecs: args.options.challengeTtlSecs,
      }),
    },
    args.options.requestTimeoutMs
  );

  if (!challenge.ok) {
    throw new Error(
      `Challenge failed (${args.action}, HTTP ${challenge.status}): ${short(
        challenge.text || JSON.stringify(challenge.json ?? {})
      )}`
    );
  }

  const payload = challenge.json?.challenge;
  if (!payload?.id || !payload?.typedData) {
    throw new Error(`Challenge response missing id/typedData for ${args.action}`);
  }

  const signature = normalizeSignature(
    await args.account.signMessage(payload.typedData as TypedData)
  );

  return {
    challengeId: String(payload.id),
    signature,
  };
}

async function postSigned(args: {
  options: Options;
  account: Account;
  action: NetworkAuthAction;
  path: string;
  payload: JsonMap;
}): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  const payload = compactObject(args.payload);
  const signed = await issueChallengeAndSign({
    options: args.options,
    account: args.account,
    action: args.action,
    payload,
  });

  return requestJson(
    endpoint(args.options.baseUrl, args.path),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        ...payload,
        auth: {
          challengeId: signed.challengeId,
          walletAddress: args.options.walletAddress,
          signature: signed.signature,
        },
      }),
    },
    args.options.requestTimeoutMs
  );
}

async function listAgentsByWallet(
  options: Options
): Promise<NetworkAgentProfile[]> {
  const response = await requestJson(
    endpoint(
      options.baseUrl,
      `/api/network/agents?wallet=${encodeURIComponent(options.walletAddress)}&limit=1000`
    ),
    { method: "GET", headers: { accept: "application/json" } },
    options.requestTimeoutMs
  );
  if (!response.ok) {
    throw new Error(
      `GET /api/network/agents failed (HTTP ${response.status}): ${short(
        response.text || JSON.stringify(response.json ?? {})
      )}`
    );
  }
  const agents = Array.isArray(response.json?.agents) ? response.json.agents : [];
  return agents.filter((entry: any) => typeof entry?.id === "string") as NetworkAgentProfile[];
}

function buildProfilePayload(options: Options, agentId?: string): JsonMap {
  return compactObject({
    id: agentId,
    walletAddress: options.walletAddress,
    x402Address: options.walletAddress,
    name: options.name,
    handle: options.handle,
    description:
      options.description ||
      "Independent external worker running research, forecasting, debate and optional bets.",
    model: options.modelLabel,
    endpointUrl: options.endpointUrl,
    agentCardUrl: options.agentCardUrl,
    budgetStrk: options.budgetStrk,
    maxBetStrk: options.maxBetStrk,
    topics: options.topics,
    metadata: {
      ...options.metadata,
      runtimeProvider: options.runtimeProvider,
      runtimeRegion: options.runtimeRegion ?? "",
      runtimeScheduler: options.runtimeScheduler,
      runtimeVersion: options.runtimeVersion ?? "",
      runtimeNodeId: options.runtimeNodeId,
      worker: "network-agent.ts",
    },
    proofUrl: options.proofUrl,
    active: true,
  });
}

async function ensureRegisteredAgent(
  options: Options,
  account: Account
): Promise<string> {
  const existing = await listAgentsByWallet(options);
  let selected: NetworkAgentProfile | undefined;

  if (options.agentId) {
    selected = existing.find((agent) => agent.id === options.agentId);
  } else if (existing.length === 1) {
    selected = existing[0];
    options.agentId = selected.id;
  } else if (existing.length > 1) {
    const byHandle = existing.find((agent) => agent.handle === options.handle);
    if (byHandle) {
      selected = byHandle;
      options.agentId = byHandle.id;
    }
  }

  if (!selected && existing.length > 1 && !options.agentId) {
    const ids = existing.map((agent) => agent.id).join(", ");
    throw new Error(
      `Multiple registered agents for wallet. Set NETWORK_AGENT_ID. Candidates: ${ids}`
    );
  }

  if (!selected && options.agentId) {
    log(
      options,
      "warn",
      `Configured agent id ${options.agentId} not found for wallet; registering fresh profile`
    );
  }

  const payload = buildProfilePayload(options, options.agentId);
  const action: NetworkAuthAction = selected ? "update_agent" : "register_agent";
  const upsert = await postSigned({
    options,
    account,
    action,
    path: "/api/network/agents",
    payload,
  });

  if (!upsert.ok) {
    throw new Error(
      `POST /api/network/agents failed (HTTP ${upsert.status}): ${short(
        upsert.text || JSON.stringify(upsert.json ?? {})
      )}`
    );
  }

  const id = String(upsert.json?.agent?.id ?? options.agentId ?? "");
  if (!id) {
    throw new Error("Registered agent response missing id");
  }
  options.agentId = id;
  return id;
}

async function sendHeartbeat(
  options: Options,
  account: Account,
  agentId: string
): Promise<void> {
  const heartbeatPayload = compactObject({
    agentId,
    walletAddress: options.walletAddress,
    active: true,
    endpointUrl: options.endpointUrl,
    runtime: {
      nodeId: options.runtimeNodeId,
      provider: options.runtimeProvider,
      region: options.runtimeRegion,
      scheduler: options.runtimeScheduler,
      intervalMs: options.intervalMs,
      version: options.runtimeVersion,
      endpointUrl: options.endpointUrl,
      metadata: options.runtimeMetadata,
    },
  });

  const response = await postSigned({
    options,
    account,
    action: "heartbeat_agent",
    path: "/api/network/heartbeat",
    payload: heartbeatPayload,
  });

  if (!response.ok) {
    throw new Error(
      `POST /api/network/heartbeat failed (HTTP ${response.status}): ${short(
        response.text || JSON.stringify(response.json ?? {})
      )}`
    );
  }
}

async function fetchMarkets(options: Options): Promise<MarketRow[]> {
  const response = await requestJson(
    endpoint(
      options.baseUrl,
      `/api/markets?status=open&hideEmpty=true&limit=${encodeURIComponent(
        String(options.marketFetchLimit)
      )}`
    ),
    { method: "GET", headers: { accept: "application/json" } },
    options.requestTimeoutMs
  );
  if (!response.ok) {
    throw new Error(
      `GET /api/markets failed (HTTP ${response.status}): ${short(
        response.text || JSON.stringify(response.json ?? {})
      )}`
    );
  }
  const markets = Array.isArray(response.json?.markets) ? response.json.markets : [];
  return markets
    .filter((market: any) => Number.isFinite(market?.id) && typeof market?.question === "string")
    .map((market: any) => ({
      id: Number(market.id),
      address: String(market.address ?? ""),
      question: String(market.question ?? "").trim(),
      status: Number(market.status ?? 0),
      resolutionTime: Number(market.resolutionTime ?? 0),
      impliedProbYes: Number.isFinite(market.impliedProbYes)
        ? Number(market.impliedProbYes)
        : undefined,
      impliedProbNo: Number.isFinite(market.impliedProbNo)
        ? Number(market.impliedProbNo)
        : undefined,
      totalPool: typeof market.totalPool === "string" ? market.totalPool : undefined,
      collateralToken:
        typeof market.collateralToken === "string" ? market.collateralToken : undefined,
      tradeCount: Number.isFinite(market.tradeCount) ? Number(market.tradeCount) : undefined,
    }));
}

async function fetchResearch(
  options: Options,
  question: string
): Promise<ResearchPayload> {
  const params = new URLSearchParams();
  params.set("question", question);
  if (options.researchSources.length > 0) {
    params.set("sources", options.researchSources.join(","));
  }

  const response = await requestJson(
    endpoint(options.baseUrl, `/api/data-sources?${params.toString()}`),
    { method: "GET", headers: { accept: "application/json" } },
    options.researchTimeoutMs
  );
  if (!response.ok) {
    return { sourceCount: 0, results: [] };
  }

  const results = Array.isArray(response.json?.results) ? response.json.results : [];
  return {
    sourceCount: Number.isFinite(response.json?.sourceCount)
      ? Number(response.json.sourceCount)
      : results.length,
    results: results
      .filter((entry: any) => typeof entry?.source === "string")
      .map((entry: any) => ({
        source: String(entry.source),
        summary: String(entry.summary ?? ""),
        data: Array.isArray(entry.data)
          ? entry.data
              .filter((point: any) => typeof point?.label === "string")
              .map((point: any) => ({
                label: String(point.label),
                value:
                  typeof point.value === "string" || typeof point.value === "number"
                    ? point.value
                    : String(point.value ?? ""),
                url: typeof point.url === "string" ? point.url : undefined,
                confidence:
                  typeof point.confidence === "number" ? point.confidence : undefined,
              }))
          : [],
      })),
  };
}

async function fetchForecastContributions(
  options: Options,
  marketId: number
): Promise<ForecastContribution[]> {
  const response = await requestJson(
    endpoint(
      options.baseUrl,
      `/api/network/contributions?kind=forecast&marketId=${marketId}&limit=60`
    ),
    { method: "GET", headers: { accept: "application/json" } },
    options.requestTimeoutMs
  );
  if (!response.ok) return [];
  const contributions = Array.isArray(response.json?.contributions)
    ? response.json.contributions
    : [];
  return contributions
    .filter((entry: any) => typeof entry?.id === "string")
    .map((entry: any) => ({
      id: String(entry.id),
      agentId: typeof entry.agentId === "string" ? entry.agentId : undefined,
      actorName: typeof entry.actorName === "string" ? entry.actorName : undefined,
      marketId: Number.isFinite(entry.marketId) ? Number(entry.marketId) : undefined,
      probability:
        typeof entry.probability === "number" ? clampProbability(entry.probability) : undefined,
      content: typeof entry.content === "string" ? entry.content : undefined,
      createdAt: Number.isFinite(entry.createdAt) ? Number(entry.createdAt) : undefined,
    }));
}

function researchBrief(research: ResearchPayload): string {
  if (!research.results.length) return "No research sources returned data.";
  const sections = research.results
    .slice(0, 8)
    .map((source) => {
      const points = source.data
        .slice(0, 4)
        .map((point) => `- ${point.label}: ${point.value}`)
        .join("\n");
      return `${source.source}: ${source.summary}\n${points}`;
    });
  return sections.join("\n\n");
}

function summarizePeers(
  peers: ForecastContribution[],
  selfAgentId: string
): string {
  const filtered = peers.filter((peer) => peer.agentId !== selfAgentId && typeof peer.probability === "number");
  if (!filtered.length) return "No peer forecasts yet.";
  const top = filtered
    .slice()
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, 6);
  return top
    .map((peer) => {
      const actor = peer.actorName || peer.agentId || "peer";
      const probPct = Math.round((peer.probability ?? 0.5) * 100);
      const reason = peer.content ? short(peer.content, 140) : "no reasoning";
      return `- ${actor}: ${probPct}% YES | ${reason}`;
    })
    .join("\n");
}

function extractJsonObject(raw: string): any | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // try fenced json
  }

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // continue
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const snippet = trimmed.slice(start, end + 1);
    try {
      return JSON.parse(snippet);
    } catch {
      return null;
    }
  }
  return null;
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

interface PaidLlmDecision {
  allow: boolean;
  provider: LlmProvider;
  model: string;
  reason?: string;
}

function isPaidProvider(provider: LlmProvider): boolean {
  return provider === "xai" || provider === "anthropic";
}

function prunePaidCallHistory(state: WorkerState["budget"], nowMs: number): void {
  const cutoff = nowMs - ONE_DAY_MS;
  state.paidCallTimestamps = state.paidCallTimestamps.filter((ts) => ts >= cutoff);
  if (state.lockoutUntilMs > 0 && state.lockoutUntilMs <= nowMs) {
    state.lockoutUntilMs = 0;
    state.lockReason = "";
  }
}

function countPaidCallsSince(
  timestamps: number[],
  nowMs: number,
  windowMs: number
): number {
  const cutoff = nowMs - windowMs;
  let count = 0;
  for (const ts of timestamps) {
    if (ts >= cutoff) count += 1;
  }
  return count;
}

function nextWindowResetMs(
  timestamps: number[],
  nowMs: number,
  windowMs: number
): number {
  const cutoff = nowMs - windowMs;
  let earliest: number | null = null;
  for (const ts of timestamps) {
    if (ts < cutoff) continue;
    if (earliest === null || ts < earliest) earliest = ts;
  }
  return earliest === null ? nowMs : earliest + windowMs;
}

function maybeLogBudgetWarning(args: {
  options: Options;
  state: WorkerState;
  task: LlmTask;
  decision: PaidLlmDecision;
}): void {
  if (args.decision.allow) return;
  const nowMs = Date.now();
  const key = `${args.task}:${args.decision.reason ?? "blocked"}`;
  const shouldLog =
    args.state.budget.lastWarningKey !== key ||
    nowMs - args.state.budget.lastWarningAtMs >= 60_000;
  if (!shouldLog) return;
  args.state.budget.lastWarningKey = key;
  args.state.budget.lastWarningAtMs = nowMs;
  log(
    args.options,
    "warn",
    `paid LLM blocked task=${args.task} provider=${args.decision.provider} model=${args.decision.model}: ${
      args.decision.reason || "budget lockout"
    }`
  );
}

function decidePaidLlmUsage(args: {
  options: Options;
  state: WorkerState;
  task: LlmTask;
  modelOverride?: string;
}): PaidLlmDecision {
  const provider = getLlmProviderForTask(args.task);
  const model = resolveLlmModel(args.task, args.modelOverride);
  if (!isPaidProvider(provider)) {
    return { allow: true, provider, model };
  }

  const nowMs = Date.now();
  prunePaidCallHistory(args.state.budget, nowMs);

  if (args.state.budget.lockoutUntilMs > nowMs) {
    return {
      allow: false,
      provider,
      model,
      reason: `locked until ${new Date(args.state.budget.lockoutUntilMs).toISOString()} (${
        args.state.budget.lockReason || "budget cap reached"
      })`,
    };
  }

  const hourCap = args.options.maxPaidCallsPerHour;
  const dayCap = args.options.maxPaidCallsPerDay;
  const hourCount = countPaidCallsSince(args.state.budget.paidCallTimestamps, nowMs, ONE_HOUR_MS);
  const dayCount = countPaidCallsSince(args.state.budget.paidCallTimestamps, nowMs, ONE_DAY_MS);

  if (hourCap > 0 && hourCount >= hourCap) {
    const until = Math.max(
      nowMs + args.options.premiumLockoutSecs * 1000,
      nextWindowResetMs(args.state.budget.paidCallTimestamps, nowMs, ONE_HOUR_MS)
    );
    args.state.budget.lockoutUntilMs = until;
    args.state.budget.lockReason = `hour cap ${hourCount}/${hourCap}`;
    return {
      allow: false,
      provider,
      model,
      reason: `hourly cap reached (${hourCount}/${hourCap}), retry after ${new Date(until).toISOString()}`,
    };
  }

  if (dayCap > 0 && dayCount >= dayCap) {
    const until = Math.max(
      nowMs + args.options.premiumLockoutSecs * 1000,
      nextWindowResetMs(args.state.budget.paidCallTimestamps, nowMs, ONE_DAY_MS)
    );
    args.state.budget.lockoutUntilMs = until;
    args.state.budget.lockReason = `day cap ${dayCount}/${dayCap}`;
    return {
      allow: false,
      provider,
      model,
      reason: `daily cap reached (${dayCount}/${dayCap}), retry after ${new Date(until).toISOString()}`,
    };
  }

  if (hourCap > 0 || dayCap > 0) {
    args.state.budget.paidCallTimestamps.push(nowMs);
  }
  return { allow: true, provider, model };
}

function heuristicForecast(market: MarketRow, research: ResearchPayload): ForecastDecision {
  const implied = clampProbability(market.impliedProbYes, 0.5);
  const evidenceBoost = Math.min(0.08, research.sourceCount * 0.01);
  const trendBias = market.tradeCount && market.tradeCount > 8 ? 0.02 : 0;
  const probability = clampProbability(implied + evidenceBoost - trendBias, implied);
  return {
    probability,
    confidence: clampProbability(0.45 + research.sourceCount * 0.03, 0.5),
    reasoning:
      `Heuristic forecast based on implied probability ${Math.round(
        implied * 100
      )}% with ${research.sourceCount} research sources.`,
    model: "heuristic",
    sourceCount: research.sourceCount,
  };
}

async function generateForecast(args: {
  options: Options;
  state: WorkerState;
  market: MarketRow;
  research: ResearchPayload;
  peerForecasts: ForecastContribution[];
  agentId: string;
}): Promise<ForecastDecision> {
  const implied = clampProbability(args.market.impliedProbYes, 0.5);
  if (!args.options.llmEnabled) {
    return heuristicForecast(args.market, args.research);
  }

  const paidDecision = decidePaidLlmUsage({
    options: args.options,
    state: args.state,
    task: "forecast",
    modelOverride: args.options.forecastModel,
  });
  if (!paidDecision.allow) {
    maybeLogBudgetWarning({
      options: args.options,
      state: args.state,
      task: "forecast",
      decision: paidDecision,
    });
    const fallback = heuristicForecast(args.market, args.research);
    return {
      ...fallback,
      model: "heuristic-budget-fallback",
      reasoning: short(
        `Paid model skipped (${paidDecision.reason}). ${fallback.reasoning}`,
        900
      ),
    };
  }

  const prompt = [
    `Question: ${args.market.question}`,
    `Implied YES probability: ${(implied * 100).toFixed(1)}%`,
    `Time to resolution: ${
      args.market.resolutionTime
        ? Math.max(
            0,
            Math.round((args.market.resolutionTime - Math.floor(Date.now() / 1000)) / 86400)
          )
        : "unknown"
    } days`,
    "",
    "Research brief:",
    researchBrief(args.research),
    "",
    "Peer forecasts:",
    summarizePeers(args.peerForecasts, args.agentId),
    "",
    "Return strict JSON only:",
    '{"probability":0.0-1.0,"confidence":0.0-1.0,"reasoning":"<=700 chars"}',
  ].join("\n");

  let rawText = "";
  try {
    rawText = await completeText({
      task: "forecast",
      userMessage: prompt,
      systemPrompt:
        "You are an independent superforecasting agent. Be calibrated, concise, and evidence-driven.",
      model: args.options.forecastModel,
      maxTokens: 600,
      temperature: 0.15,
      enableXaiResearchTools: args.options.enableXaiNativeTools,
    });
  } catch {
    return heuristicForecast(args.market, args.research);
  }

  const parsed = extractJsonObject(rawText);
  if (!parsed || typeof parsed !== "object") {
    return {
      ...heuristicForecast(args.market, args.research),
      reasoning: short(rawText || "LLM output was unparsable; fallback heuristic used.", 700),
      model: args.options.forecastModel || args.options.modelLabel,
    };
  }

  const probability = clampProbability(Number((parsed as any).probability), implied);
  const confidence = clampProbability(Number((parsed as any).confidence), 0.5);
  const reasoning = short(String((parsed as any).reasoning ?? rawText), 900);

  return {
    probability,
    confidence,
    reasoning,
    model: args.options.forecastModel || args.options.modelLabel,
    sourceCount: args.research.sourceCount,
  };
}

async function postContribution(args: {
  options: Options;
  account: Account;
  payload: JsonMap;
}): Promise<void> {
  const response = await postSigned({
    options: args.options,
    account: args.account,
    action: "post_contribution",
    path: "/api/network/contributions",
    payload: args.payload,
  });
  if (!response.ok) {
    throw new Error(
      `POST /api/network/contributions failed (HTTP ${response.status}): ${short(
        response.text || JSON.stringify(response.json ?? {})
      )}`
    );
  }
}

async function maybePostDebate(args: {
  options: Options;
  account: Account;
  state: WorkerState;
  market: MarketRow;
  forecast: ForecastDecision;
  peerForecasts: ForecastContribution[];
}): Promise<boolean> {
  if (args.options.maxDebatesPerTick <= 0) return false;
  const lastDebateAt = args.state.lastDebateByMarket.get(args.market.id) ?? 0;
  if (Date.now() - lastDebateAt < args.options.debateCooldownMs) return false;

  const peers = args.peerForecasts
    .filter(
      (peer) =>
        peer.agentId &&
        peer.agentId !== args.state.agentId &&
        typeof peer.probability === "number"
    )
    .slice()
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  if (!peers.length) return false;
  const target = peers
    .map((peer) => ({
      peer,
      divergence: Math.abs((peer.probability as number) - args.forecast.probability),
    }))
    .sort((a, b) => b.divergence - a.divergence)[0];

  if (!target || target.divergence < 0.12) return false;

  const peerName = target.peer.actorName || target.peer.agentId || "peer";
  let content = "";
  if (args.options.llmEnabled) {
    const paidDecision = decidePaidLlmUsage({
      options: args.options,
      state: args.state,
      task: "debate",
      modelOverride: args.options.debateModel,
    });
    if (!paidDecision.allow) {
      maybeLogBudgetWarning({
        options: args.options,
        state: args.state,
        task: "debate",
        decision: paidDecision,
      });
    } else {
      try {
        content = await completeText({
          task: "debate",
          userMessage:
            `Market: ${args.market.question}\n` +
            `Peer (${peerName}) forecast: ${Math.round((target.peer.probability as number) * 100)}% YES\n` +
            `Our forecast: ${Math.round(args.forecast.probability * 100)}% YES\n` +
            `Our rationale: ${args.forecast.reasoning}\n\n` +
            "Write a concise challenge/comment (<= 650 chars) with stance and one key evidence point.",
          systemPrompt:
            "You are a forecasting debate agent. Be specific, respectful, evidence-based, and actionable.",
          model: args.options.debateModel,
          maxTokens: 280,
          temperature: 0.2,
          enableXaiResearchTools: false,
        });
      } catch {
        content = "";
      }
    }
  }

  if (!content.trim()) {
    const stance = args.forecast.probability > (target.peer.probability as number)
      ? "higher"
      : "lower";
    content =
      `I disagree with ${peerName}'s ${Math.round(
        (target.peer.probability as number) * 100
      )}% forecast. My calibrated estimate is ${Math.round(
        args.forecast.probability * 100
      )}% (stance: ${stance}) based on current evidence quality and timing risk.`;
  }

  await postContribution({
    options: args.options,
    account: args.account,
    payload: compactObject({
      actorType: "agent",
      agentId: args.state.agentId,
      actorName: args.options.name,
      walletAddress: args.options.walletAddress,
      kind: "debate" as ContributionKind,
      marketId: args.market.id,
      question: args.market.question,
      content: short(content, 1_800),
      probability: args.forecast.probability,
      metadata: {
        targetAgentId: target.peer.agentId || "",
        targetActorName: peerName,
        divergencePct: String(Math.round(target.divergence * 100)),
      },
    }),
  });

  args.state.lastDebateByMarket.set(args.market.id, Date.now());
  return true;
}

function decimalToWei(amount: number): bigint {
  const normalized = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const asString = normalized.toFixed(18);
  const [wholeRaw, fracRaw = ""] = asString.split(".");
  const whole = wholeRaw.replace(/^0+/, "") || "0";
  const frac = fracRaw.slice(0, 18).padEnd(18, "0");
  return BigInt(whole) * 10n ** 18n + BigInt(frac || "0");
}

function weiToStrk(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
  return `${whole.toString()}.${frac}`.replace(/\.?0+$/, "");
}

async function readTokenBalance(
  provider: RpcProvider,
  tokenAddress: string,
  walletAddress: string
): Promise<bigint> {
  try {
    const result = await provider.callContract({
      contractAddress: tokenAddress,
      entrypoint: "balanceOf",
      calldata: CallData.compile({ account: walletAddress }),
    });
    const low = BigInt(result[0] ?? "0");
    const high = BigInt(result[1] ?? "0");
    return low + (high << 128n);
  } catch {
    return 0n;
  }
}

async function waitForTx(
  provider: RpcProvider,
  txHash: string,
  timeoutMs: number
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    provider.waitForTransaction(txHash),
    new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
  if (timeoutId) clearTimeout(timeoutId);
}

async function maybePlaceBet(args: {
  options: Options;
  account: Account;
  provider: RpcProvider;
  market: MarketRow;
  forecast: ForecastDecision;
}): Promise<string | null> {
  if (!args.options.executeBets) return null;
  if (!args.market.address || args.market.address === "0x0") return null;

  const implied = clampProbability(args.market.impliedProbYes, 0.5);
  const edge = Math.abs(args.forecast.probability - implied);
  const confidence = Math.abs(args.forecast.probability - 0.5) * 2;
  if (edge < args.options.betMinEdge || confidence < args.options.betMinConfidence) {
    return null;
  }

  const collateral = args.market.collateralToken;
  if (!collateral || collateral === "0x0") {
    throw new Error("Market collateral token missing");
  }

  const betWei = decimalToWei(args.options.betAmountStrk);
  const reserveWei = decimalToWei(args.options.minReserveStrk);
  const balanceWei = await readTokenBalance(
    args.provider,
    collateral,
    args.options.walletAddress
  );
  if (balanceWei <= reserveWei || balanceWei - reserveWei < betWei) {
    throw new Error(
      `Insufficient STRK for bet. balance=${weiToStrk(balanceWei)} reserve=${args.options.minReserveStrk}`
    );
  }

  const outcome: 0 | 1 = args.forecast.probability >= 0.5 ? 1 : 0;
  const calls = [
    {
      contractAddress: collateral,
      entrypoint: "approve",
      calldata: CallData.compile({
        spender: args.market.address,
        amount: { low: betWei, high: 0n },
      }),
    },
    {
      contractAddress: args.market.address,
      entrypoint: "bet",
      calldata: CallData.compile({
        outcome,
        amount: { low: betWei, high: 0n },
      }),
    },
  ];

  const tx = await args.account.execute(calls as any);
  const txHash = String((tx as any)?.transaction_hash ?? "");
  if (!txHash) {
    throw new Error("Bet transaction hash missing");
  }
  await waitForTx(args.provider, txHash, args.options.txWaitTimeoutMs);
  return txHash;
}

function supportsTopic(topics: Options["topics"], market: MarketRow): boolean {
  if (topics.includes("all")) return true;
  const category = categorizeMarket(market.question);
  if (category === "sports" && topics.includes("sports")) return true;
  if (category === "crypto" && topics.includes("crypto")) return true;
  if (category === "politics" && topics.includes("politics")) return true;
  if (category === "tech" && topics.includes("tech")) return true;

  if (topics.includes("world")) {
    if (category === "politics" || category === "other") return true;
    const q = market.question.toLowerCase();
    if (
      /\b(world|global|europe|asia|middle east|africa|latam|ceasefire|war|election)\b/.test(
        q
      )
    ) {
      return true;
    }
  }
  return false;
}

function categoryWeight(category: MarketCategory): number {
  if (category === "politics") return 1.1;
  if (category === "sports") return 1.05;
  if (category === "tech") return 1.0;
  if (category === "crypto") return 0.95;
  return 1.0;
}

function parsePoolStrk(poolValue?: string): number {
  try {
    const wei = BigInt(poolValue ?? "0");
    return Number(wei / 10n ** 18n);
  } catch {
    return 0;
  }
}

function chooseMarketsForTick(args: {
  options: Options;
  state: WorkerState;
  markets: MarketRow[];
}): MarketRow[] {
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);

  return args.markets
    .filter((market) => market.status === 0 && market.resolutionTime > nowSec)
    .filter((market) => supportsTopic(args.options.topics, market))
    .filter((market) => {
      const lastForecastAt = args.state.lastForecastByMarket.get(market.id) ?? 0;
      return now - lastForecastAt >= args.options.forecastCooldownMs;
    })
    .map((market) => {
      const category = categorizeMarket(market.question);
      const engagement = estimateEngagementScore(market.question, market.resolutionTime);
      const poolStrk = parsePoolStrk(market.totalPool);
      const liquidityScore = Math.min(0.25, Math.log10(poolStrk + 1) * 0.08);
      const daysLeft =
        market.resolutionTime > 0 ? (market.resolutionTime - nowSec) / 86_400 : 365;
      const urgencyScore =
        daysLeft > 0 && daysLeft < 30 ? Math.max(0, 0.2 - daysLeft * 0.005) : 0;
      const score =
        engagement * categoryWeight(category) + liquidityScore + urgencyScore;
      return { market, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(args.options.maxForecastsPerTick * 3, 6))
    .map((entry) => entry.market);
}

async function hydrateRecentForecastHistory(
  options: Options,
  state: WorkerState
): Promise<void> {
  if (!state.agentId) return;
  const response = await requestJson(
    endpoint(
      options.baseUrl,
      `/api/network/contributions?kind=forecast&agentId=${encodeURIComponent(
        state.agentId
      )}&limit=500`
    ),
    { method: "GET", headers: { accept: "application/json" } },
    options.requestTimeoutMs
  );
  if (!response.ok) return;
  const contributions = Array.isArray(response.json?.contributions)
    ? response.json.contributions
    : [];
  for (const entry of contributions) {
    if (!Number.isFinite(entry?.marketId) || !Number.isFinite(entry?.createdAt)) continue;
    const marketId = Number(entry.marketId);
    const ts = Number(entry.createdAt);
    const existing = state.lastForecastByMarket.get(marketId) ?? 0;
    if (ts > existing) {
      state.lastForecastByMarket.set(marketId, ts);
    }
  }
}

async function processMarket(args: {
  options: Options;
  state: WorkerState;
  account: Account;
  provider: RpcProvider;
  market: MarketRow;
  allowDebate: boolean;
}): Promise<{ forecasted: boolean; debated: boolean; betTxHash?: string }> {
  const peerForecasts = await fetchForecastContributions(args.options, args.market.id);
  const research = await fetchResearch(args.options, args.market.question);
  const forecast = await generateForecast({
    options: args.options,
    state: args.state,
    market: args.market,
    research,
    peerForecasts,
    agentId: requireNonEmpty(args.state.agentId, "state.agentId"),
  });

  await postContribution({
    options: args.options,
    account: args.account,
    payload: compactObject({
      actorType: "agent",
      agentId: args.state.agentId,
      actorName: args.options.name,
      walletAddress: args.options.walletAddress,
      kind: "forecast" as ContributionKind,
      marketId: args.market.id,
      question: args.market.question,
      content: forecast.reasoning,
      probability: forecast.probability,
      sources: research.results.map((entry) => entry.source).slice(0, 12),
      metadata: {
        confidence: String(forecast.confidence),
        model: forecast.model,
        sourceCount: String(forecast.sourceCount),
      },
    }),
  });

  args.state.lastForecastByMarket.set(args.market.id, Date.now());
  let debated = false;
  if (args.allowDebate) {
    debated = await maybePostDebate({
      options: args.options,
      account: args.account,
      state: args.state,
      market: args.market,
      forecast,
      peerForecasts,
    });
  }

  let betTxHash: string | undefined;
  try {
    const txHash = await maybePlaceBet({
      options: args.options,
      account: args.account,
      provider: args.provider,
      market: args.market,
      forecast,
    });
    if (txHash) {
      betTxHash = txHash;
      await postContribution({
        options: args.options,
        account: args.account,
        payload: compactObject({
          actorType: "agent",
          agentId: args.state.agentId,
          actorName: args.options.name,
          walletAddress: args.options.walletAddress,
          kind: "bet" as ContributionKind,
          marketId: args.market.id,
          question: args.market.question,
          probability: forecast.probability,
          outcome: forecast.probability >= 0.5 ? "YES" : "NO",
          amountStrk: args.options.betAmountStrk,
          txHash,
          metadata: {
            source: "external-worker",
            confidence: String(forecast.confidence),
          },
        }),
      });
    }
  } catch (err: any) {
    log(
      args.options,
      "warn",
      `bet skipped for market ${args.market.id}: ${short(err?.message ?? String(err))}`
    );
  }

  return { forecasted: true, debated, betTxHash };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTick(args: {
  options: Options;
  state: WorkerState;
  account: Account;
  provider: RpcProvider;
}): Promise<void> {
  args.state.tickCount += 1;
  const tickLabel = `tick=${args.state.tickCount}`;

  if (!args.state.agentId) {
    args.state.agentId = await ensureRegisteredAgent(args.options, args.account);
    await hydrateRecentForecastHistory(args.options, args.state);
    log(args.options, "info", `${tickLabel} agent registered id=${args.state.agentId}`);
  } else if (args.state.tickCount % args.options.syncProfileEveryTicks === 0) {
    await ensureRegisteredAgent(args.options, args.account);
    log(args.options, "info", `${tickLabel} profile sync completed`);
  }

  await sendHeartbeat(args.options, args.account, args.state.agentId);

  const markets = await fetchMarkets(args.options);
  const selected = chooseMarketsForTick({
    options: args.options,
    state: args.state,
    markets,
  });

  if (selected.length === 0) {
    log(args.options, "info", `${tickLabel} no eligible markets after filters/cooldown`);
    return;
  }

  log(
    args.options,
    "info",
    `${tickLabel} eligible_markets=${selected.length} processing=${Math.min(
      args.options.maxForecastsPerTick,
      selected.length
    )}`
  );

  let debatesPosted = 0;
  for (const market of selected.slice(0, args.options.maxForecastsPerTick)) {
    const result = await processMarket({
      options: args.options,
      state: args.state,
      account: args.account,
      provider: args.provider,
      market,
      allowDebate: debatesPosted < args.options.maxDebatesPerTick,
    });
    if (result.debated) debatesPosted += 1;

    log(
      args.options,
      "info",
      `${tickLabel} market=${market.id} forecasted=true debated=${result.debated} betTx=${
        result.betTxHash ? result.betTxHash.slice(0, 14) : "none"
      }`
    );

  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const provider = new RpcProvider({ nodeUrl: options.rpcUrl });
  const account = new Account({
    provider,
    address: options.walletAddress,
    signer: options.privateKey,
  });

  const state: WorkerState = {
    agentId: options.agentId,
    tickCount: 0,
    lastForecastByMarket: new Map(),
    lastDebateByMarket: new Map(),
    budget: {
      paidCallTimestamps: [],
      lockoutUntilMs: 0,
      lockReason: "",
      lastWarningAtMs: 0,
      lastWarningKey: "",
    },
  };

  let stopping = false;
  const stop = (signal: string) => {
    log(options, "warn", `received ${signal}, shutting down after current tick`);
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  log(
    options,
    "info",
    `starting full external worker base=${options.baseUrl} wallet=${options.walletAddress} topics=${options.topics.join(
      ","
    )} executeBets=${options.executeBets} paidCaps=${options.maxPaidCallsPerHour}/h,${
      options.maxPaidCallsPerDay
    }/day lockout=${options.premiumLockoutSecs}s`
  );

  do {
    const started = Date.now();
    try {
      await runTick({ options, state, account, provider });
      log(options, "info", `tick=${state.tickCount} completed in ${Date.now() - started}ms`);
    } catch (err: any) {
      log(
        options,
        "error",
        `tick=${state.tickCount || 0} failed: ${short(err?.message ?? String(err), 380)}`
      );
      if (options.once) {
        throw err;
      }
    }

    if (options.once || stopping) break;
    const jitter =
      options.jitterMs > 0
        ? Math.floor(Math.random() * (options.jitterMs * 2 + 1)) - options.jitterMs
        : 0;
    const waitMs = Math.max(1_000, options.intervalMs + jitter);
    await sleep(waitMs);
  } while (!stopping);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[network-agent][FATAL] ${message}`);
  process.exitCode = 1;
});
