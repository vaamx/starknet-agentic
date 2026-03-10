import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SerializedSpawnedAgent } from "./agent-spawner";
import { usePrismaRuntime, getPrismaClient } from "@/lib/prisma";

export interface PersistedExternalForecast {
  agentName: string;
  agentCardUrl?: string;
  probability: number;
  reasoning?: string;
  thoughtHash?: string;
  receivedAt: number;
}

export type PersistedAgentKeyProvider =
  | "local-encrypted"
  | "aws-kms"
  | "memory";

export interface PersistedAgentKeyMaterial {
  agentId: string;
  walletAddress: string;
  provider: PersistedAgentKeyProvider;
  keyRef: string;
  ciphertext: string;
  iv?: string;
  authTag?: string;
  awsKmsKeyId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PersistedProofVerification {
  verified: boolean;
  executionStatus?: string;
  finalityStatus?: string;
  blockNumber?: number;
  blockHash?: string;
  verifiedAt: number;
  error?: string;
}

export interface PersistedProofAnchor {
  provider: "arweave";
  txId: string;
  gatewayUrl: string;
  dataHash: string;
  anchoredAt: number;
}

export interface PersistedProofRecord {
  id: string;
  kind: string;
  createdAt: number;
  updatedAt: number;
  chainId: string;
  txHash?: string;
  explorerUrl?: string;
  agentId?: string;
  agentName?: string;
  walletAddress?: string;
  marketId?: number;
  question?: string;
  reasoningHash?: string;
  payloadHash: string;
  payload: string;
  verification?: PersistedProofVerification;
  anchor?: PersistedProofAnchor;
  tags?: Record<string, string>;
}

export interface PersistedMarketSnapshot {
  id: number;
  address: string;
  questionHash: string;
  question: string;
  resolutionTime: number;
  oracle: string;
  collateralToken: string;
  feeBps: number;
  status: number;
  totalPool: string;
  yesPool: string;
  noPool: string;
  impliedProbYes: number;
  impliedProbNo: number;
  winningOutcome?: number;
  tradeCount?: number;
  updatedAt: number;
  // Polymarket integration fields
  source?: string;
  category?: string;
  slug?: string;
  imageUrl?: string;
  volume24h?: number;
  liquidity?: number;
  description?: string;
  outcomes?: string;
  oneDayChange?: number | null;
  polymarketUrl?: string;
}

export interface PersistedLoopRuntimeState {
  tickCount: number;
  lastTickAt: number | null;
  intervalMs: number;
  agentRotationIndex?: number;
  debateCounter?: number;
  actionCounter?: number;
  updatedAt: number;
}

export interface PersistedLoopAction {
  id: string;
  timestamp: number;
  agentId: string;
  agentName: string;
  type: string;
  marketId?: number;
  question?: string;
  detail: string;
  probability?: number;
  betAmount?: string;
  betOutcome?: "YES" | "NO";
  resolutionOutcome?: "YES" | "NO";
  sourcesUsed?: string[];
  txHash?: string;
  huginnTxHash?: string;
  reasoningHash?: string;
  reasoning?: string;
  defiDirection?: "BUY" | "SELL";
  defiPair?: string;
  defiAmount?: string;
  debateTarget?: string;
}

export interface PersistedNetworkAgentProfile {
  id: string;
  walletAddress: string;
  x402Address?: string;
  name: string;
  handle?: string;
  description?: string;
  model?: string;
  endpointUrl?: string;
  agentCardUrl?: string;
  budgetStrk?: number;
  maxBetStrk?: number;
  topics?: string[];
  metadata?: Record<string, string>;
  proofUrl?: string;
  signature?: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  lastHeartbeatAt?: number;
  heartbeatCount?: number;
  runtime?: {
    nodeId?: string;
    provider?: string;
    region?: string;
    scheduler?: string;
    intervalMs?: number;
    version?: string;
    endpointUrl?: string;
    metadata?: Record<string, string>;
  };
}

export type PersistedNetworkContributionKind =
  | "forecast"
  | "market"
  | "comment"
  | "debate"
  | "research"
  | "bet";

export interface PersistedNetworkContribution {
  id: string;
  actorType: "agent" | "human";
  agentId?: string;
  actorName: string;
  walletAddress?: string;
  kind: PersistedNetworkContributionKind;
  marketId?: number;
  question?: string;
  content?: string;
  probability?: number;
  outcome?: "YES" | "NO";
  amountStrk?: number;
  sources?: string[];
  txHash?: string;
  proofId?: string;
  metadata?: Record<string, string>;
  signature?: string;
  createdAt: number;
}

export type PersistedNetworkAuthAction =
  | "register_agent"
  | "update_agent"
  | "post_contribution"
  | "heartbeat_agent"
  | "manual_session";

export interface PersistedNetworkAuthChallenge {
  id: string;
  walletAddress: string;
  action: PersistedNetworkAuthAction;
  payloadHash: string;
  nonce: string;
  expirySec: number;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
}

interface PersistedPredictionAgentState {
  version: 1;
  updatedAt: number;
  spawnedAgents: SerializedSpawnedAgent[];
  externalForecasts: Record<string, PersistedExternalForecast[]>;
  agentKeys: Record<string, PersistedAgentKeyMaterial>;
  proofs: PersistedProofRecord[];
  marketSnapshots: PersistedMarketSnapshot[];
  loopRuntime: PersistedLoopRuntimeState | null;
  loopActions: PersistedLoopAction[];
  networkAgents: Record<string, PersistedNetworkAgentProfile>;
  networkContributions: PersistedNetworkContribution[];
  networkAuthChallenges: Record<string, PersistedNetworkAuthChallenge>;
}

const STATE_FILE =
  process.env.AGENT_STATE_FILE ||
  path.join(os.tmpdir(), "starknet-agentic-prediction-state.json");
const STATE_BACKEND = (
  process.env.AGENT_STATE_BACKEND || "auto"
).toLowerCase();
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const UPSTASH_STATE_KEY =
  process.env.AGENT_STATE_UPSTASH_KEY ||
  "starknet-agentic:prediction-agent:state:v1";
const USE_UPSTASH_STATE =
  STATE_BACKEND !== "file" &&
  !!UPSTASH_URL &&
  !!UPSTASH_TOKEN;

export interface StateStoreBackendInfo {
  requestedBackend: "auto" | "upstash" | "file";
  effectiveBackend: "prisma" | "upstash" | "file";
  upstashConfigured: boolean;
  prismaConfigured: boolean;
  stateFile: string;
  upstashStateKey: string;
}

export function getStateStoreBackendInfo(): StateStoreBackendInfo {
  const requestedBackend =
    STATE_BACKEND === "upstash" || STATE_BACKEND === "file"
      ? STATE_BACKEND
      : "auto";

  const prismaConfigured = usePrismaRuntime();

  return {
    requestedBackend,
    effectiveBackend: prismaConfigured
      ? "prisma"
      : USE_UPSTASH_STATE
        ? "upstash"
        : "file",
    upstashConfigured: !!UPSTASH_URL && !!UPSTASH_TOKEN,
    prismaConfigured,
    stateFile: STATE_FILE,
    upstashStateKey: UPSTASH_STATE_KEY,
  };
}

let writeQueue: Promise<void> = Promise.resolve();
let lastBackendWarningAt = 0;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function createDefaultState(): PersistedPredictionAgentState {
  return {
    version: 1,
    updatedAt: Date.now(),
    spawnedAgents: [],
    externalForecasts: {},
    agentKeys: {},
    proofs: [],
    marketSnapshots: [],
    loopRuntime: null,
    loopActions: [],
    networkAgents: {},
    networkContributions: [],
    networkAuthChallenges: {},
  };
}

function warnStateStore(message: string, err?: unknown): void {
  const now = Date.now();
  if (now - lastBackendWarningAt < 60_000) return;
  lastBackendWarningAt = now;
  if (err) {
    console.warn(`[state-store] ${message}:`, err);
  } else {
    console.warn(`[state-store] ${message}`);
  }
}

function normalizeState(raw: unknown): PersistedPredictionAgentState {
  if (!isObject(raw)) return createDefaultState();

  const version = raw.version === 1 ? 1 : 1;
  const updatedAt =
    typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : Date.now();

  const spawnedAgents = Array.isArray(raw.spawnedAgents)
    ? (raw.spawnedAgents as SerializedSpawnedAgent[])
    : [];

  const externalForecasts = isObject(raw.externalForecasts)
    ? (raw.externalForecasts as Record<string, PersistedExternalForecast[]>)
    : {};

  const agentKeys = isObject(raw.agentKeys)
    ? (raw.agentKeys as Record<string, PersistedAgentKeyMaterial>)
    : {};

  const proofs = Array.isArray(raw.proofs)
    ? (raw.proofs as PersistedProofRecord[])
    : [];

  const marketSnapshots = Array.isArray(raw.marketSnapshots)
    ? (raw.marketSnapshots as PersistedMarketSnapshot[])
    : [];

  const loopRuntime = isObject(raw.loopRuntime)
      ? {
          tickCount:
            typeof raw.loopRuntime.tickCount === "number" &&
            Number.isFinite(raw.loopRuntime.tickCount)
            ? raw.loopRuntime.tickCount
            : 0,
        lastTickAt:
          typeof raw.loopRuntime.lastTickAt === "number" &&
          Number.isFinite(raw.loopRuntime.lastTickAt)
            ? raw.loopRuntime.lastTickAt
            : null,
          intervalMs:
            typeof raw.loopRuntime.intervalMs === "number" &&
            Number.isFinite(raw.loopRuntime.intervalMs)
              ? raw.loopRuntime.intervalMs
              : 60_000,
          agentRotationIndex:
            typeof raw.loopRuntime.agentRotationIndex === "number" &&
            Number.isFinite(raw.loopRuntime.agentRotationIndex)
              ? raw.loopRuntime.agentRotationIndex
              : 0,
          debateCounter:
            typeof raw.loopRuntime.debateCounter === "number" &&
            Number.isFinite(raw.loopRuntime.debateCounter)
              ? raw.loopRuntime.debateCounter
              : 0,
          actionCounter:
            typeof raw.loopRuntime.actionCounter === "number" &&
            Number.isFinite(raw.loopRuntime.actionCounter)
              ? raw.loopRuntime.actionCounter
              : 0,
          updatedAt:
            typeof raw.loopRuntime.updatedAt === "number" &&
            Number.isFinite(raw.loopRuntime.updatedAt)
              ? raw.loopRuntime.updatedAt
            : Date.now(),
      }
    : null;

  const loopActions = Array.isArray(raw.loopActions)
    ? (raw.loopActions as PersistedLoopAction[])
    : [];

  const networkAgents = isObject(raw.networkAgents)
    ? (raw.networkAgents as Record<string, PersistedNetworkAgentProfile>)
    : {};

  const networkContributions = Array.isArray(raw.networkContributions)
    ? (raw.networkContributions as PersistedNetworkContribution[])
    : [];

  const networkAuthChallenges = isObject(raw.networkAuthChallenges)
    ? (raw.networkAuthChallenges as Record<string, PersistedNetworkAuthChallenge>)
    : {};

  return {
    version,
    updatedAt,
    spawnedAgents,
    externalForecasts,
    agentKeys,
    proofs,
    marketSnapshots,
    loopRuntime,
    loopActions,
    networkAgents,
    networkContributions,
    networkAuthChallenges,
  };
}

async function ensureDirectory(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function runUpstashPipeline(
  commands: Array<Array<string>>
): Promise<any[]> {
  if (!USE_UPSTASH_STATE || !UPSTASH_URL || !UPSTASH_TOKEN) {
    throw new Error("Upstash state backend not configured");
  }

  const response = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Upstash pipeline failed: HTTP ${response.status}`);
  }

  return await response.json();
}

async function readStateFromUpstash(): Promise<PersistedPredictionAgentState> {
  const payload = await runUpstashPipeline([["GET", UPSTASH_STATE_KEY]]);
  const raw = payload?.[0]?.result;

  if (raw === null || raw === undefined || raw === "") {
    return createDefaultState();
  }

  if (typeof raw === "string") {
    return normalizeState(JSON.parse(raw));
  }

  return normalizeState(raw);
}

async function writeStateToUpstash(
  state: PersistedPredictionAgentState
): Promise<void> {
  await runUpstashPipeline([["SET", UPSTASH_STATE_KEY, JSON.stringify(state)]]);
}

async function readStateFromFile(): Promise<PersistedPredictionAgentState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (err: any) {
    if (err?.code === "ENOENT") return createDefaultState();
    return createDefaultState();
  }
}

async function readState(): Promise<PersistedPredictionAgentState> {
  if (STATE_BACKEND === "upstash" && !USE_UPSTASH_STATE) {
    warnStateStore(
      "AGENT_STATE_BACKEND=upstash but Upstash credentials are missing; using file backend"
    );
  }

  if (USE_UPSTASH_STATE) {
    try {
      return await readStateFromUpstash();
    } catch (err) {
      warnStateStore("Upstash read failed, falling back to file backend", err);
    }
  }

  return await readStateFromFile();
}

async function writeState(state: PersistedPredictionAgentState): Promise<void> {
  const normalized: PersistedPredictionAgentState = {
    version: 1,
    updatedAt: Date.now(),
    spawnedAgents: state.spawnedAgents ?? [],
    externalForecasts: state.externalForecasts ?? {},
    agentKeys: state.agentKeys ?? {},
    proofs: state.proofs ?? [],
    marketSnapshots: state.marketSnapshots ?? [],
    loopRuntime: state.loopRuntime ?? null,
    loopActions: state.loopActions ?? [],
    networkAgents: state.networkAgents ?? {},
    networkContributions: state.networkContributions ?? [],
    networkAuthChallenges: state.networkAuthChallenges ?? {},
  };

  if (USE_UPSTASH_STATE) {
    try {
      await writeStateToUpstash(normalized);
      return;
    } catch (err) {
      warnStateStore("Upstash write failed, falling back to file backend", err);
    }
  }

  await ensureDirectory(STATE_FILE);
  const tempPath = `${STATE_FILE}.${process.pid}.${Date.now()}.${Math.random()
    .toString(16)
    .slice(2)}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(normalized, null, 2), "utf8");
  await fs.rename(tempPath, STATE_FILE);
}

async function queueWrite<T>(
  fn: (state: PersistedPredictionAgentState) => Promise<T>
): Promise<T> {
  const run = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const state = await readState();
      return await fn(state);
    });

  writeQueue = run.then(
    () => undefined,
    () => undefined
  );

  return await run;
}

// ---------------------------------------------------------------------------
// Prisma helpers
// ---------------------------------------------------------------------------

function safeJsonParse<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try {
    return JSON.parse(val) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// 1. Spawned Agents
// ---------------------------------------------------------------------------

export async function getPersistedSpawnedAgents(): Promise<
  SerializedSpawnedAgent[]
> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const rows = await prisma.spawnedAgent.findMany();
      return rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        personaId: r.personaId,
        agentType: r.agentType,
        model: r.model,
        preferredSources: safeJsonParse<string[]>(r.preferredSources, []),
        budgetStrk: r.budgetStrk,
        maxBetStrk: r.maxBetStrk,
        status: r.status,
        walletAddress: r.walletAddress ?? undefined,
        keyRef: r.keyRef ?? undefined,
        keyCustodyProvider: r.keyCustodyProvider ?? undefined,
        agentIdRef: r.agentIdRef ?? undefined,
        runtime: safeJsonParse(r.runtimeJson, undefined),
        createdAt: Number(r.createdAt),
      }));
    }
  }

  const state = await readState();
  return state.spawnedAgents ?? [];
}

export async function setPersistedSpawnedAgents(
  agents: SerializedSpawnedAgent[]
): Promise<void> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      await prisma.$transaction([
        prisma.spawnedAgent.deleteMany(),
        ...(agents.length > 0
          ? [
              prisma.spawnedAgent.createMany({
                data: agents.map((a: any) => ({
                  id: a.id,
                  name: a.name,
                  personaId: a.personaId,
                  agentType: a.agentType,
                  model: a.model,
                  preferredSources: JSON.stringify(a.preferredSources ?? []),
                  budgetStrk: a.budgetStrk ?? 0,
                  maxBetStrk: a.maxBetStrk ?? 0,
                  status: a.status ?? "running",
                  walletAddress: a.walletAddress ?? null,
                  keyRef: a.keyRef ?? null,
                  keyCustodyProvider: a.keyCustodyProvider ?? null,
                  agentIdRef: a.agentIdRef ?? null,
                  runtimeJson: a.runtime ? JSON.stringify(a.runtime) : null,
                  createdAt: BigInt(a.createdAt ?? Date.now()),
                })),
              }),
            ]
          : []),
      ]);
      return;
    }
  }

  await queueWrite(async (state) => {
    state.spawnedAgents = agents;
    await writeState(state);
  });
}

// ---------------------------------------------------------------------------
// 2. External Forecasts
// ---------------------------------------------------------------------------

function cleanForecasts(
  forecasts: PersistedExternalForecast[],
  ttlHours: number
): PersistedExternalForecast[] {
  const maxAgeMs = Math.max(1, ttlHours) * 60 * 60 * 1000;
  const cutoff = Date.now() - maxAgeMs;
  return (forecasts ?? []).filter(
    (f) => Number.isFinite(f.receivedAt) && f.receivedAt >= cutoff
  );
}

export async function getPersistedExternalForecasts(
  marketId: number,
  ttlHours: number
): Promise<PersistedExternalForecast[]> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const maxAgeMs = Math.max(1, ttlHours) * 60 * 60 * 1000;
      const cutoff = BigInt(Date.now() - maxAgeMs);
      const rows = await prisma.externalForecast.findMany({
        where: { marketId, receivedAt: { gte: cutoff } },
      });
      return rows.map((r: any) => ({
        agentName: r.agentName,
        agentCardUrl: r.agentCardUrl ?? undefined,
        probability: r.probability,
        reasoning: r.reasoning ?? undefined,
        thoughtHash: r.thoughtHash ?? undefined,
        receivedAt: Number(r.receivedAt),
      }));
    }
  }

  const state = await readState();
  const key = String(marketId);
  const forecasts = cleanForecasts(state.externalForecasts[key] ?? [], ttlHours);
  return forecasts;
}

export async function upsertPersistedExternalForecast(
  marketId: number,
  forecast: PersistedExternalForecast,
  ttlHours: number
): Promise<PersistedExternalForecast[]> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      await prisma.externalForecast.upsert({
        where: {
          marketId_agentName: { marketId, agentName: forecast.agentName },
        },
        update: {
          agentCardUrl: forecast.agentCardUrl ?? null,
          probability: forecast.probability,
          reasoning: forecast.reasoning ?? null,
          thoughtHash: forecast.thoughtHash ?? null,
          receivedAt: BigInt(forecast.receivedAt),
        },
        create: {
          marketId,
          agentName: forecast.agentName,
          agentCardUrl: forecast.agentCardUrl ?? null,
          probability: forecast.probability,
          reasoning: forecast.reasoning ?? null,
          thoughtHash: forecast.thoughtHash ?? null,
          receivedAt: BigInt(forecast.receivedAt),
        },
      });

      // Clean up expired forecasts
      const maxAgeMs = Math.max(1, ttlHours) * 60 * 60 * 1000;
      const cutoff = BigInt(Date.now() - maxAgeMs);
      await prisma.externalForecast.deleteMany({
        where: { marketId, receivedAt: { lt: cutoff } },
      });

      // Return current list
      return await getPersistedExternalForecasts(marketId, ttlHours);
    }
  }

  const key = String(marketId);
  return await queueWrite(async (state) => {
    const current = cleanForecasts(state.externalForecasts[key] ?? [], ttlHours);
    const deduped = current.filter((f) => f.agentName !== forecast.agentName);
    const next = [...deduped, forecast];
    state.externalForecasts[key] = next;
    await writeState(state);
    return next;
  });
}

// ---------------------------------------------------------------------------
// 3. Agent Key Material
// ---------------------------------------------------------------------------

export async function getPersistedAgentKey(
  agentId: string
): Promise<PersistedAgentKeyMaterial | null> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const row = await prisma.agentKeyMaterial.findUnique({
        where: { agentId },
      });
      if (!row) return null;
      return {
        agentId: row.agentId,
        walletAddress: row.walletAddress,
        provider: row.provider as PersistedAgentKeyProvider,
        keyRef: row.keyRef,
        ciphertext: row.ciphertext,
        iv: row.iv ?? undefined,
        authTag: row.authTag ?? undefined,
        awsKmsKeyId: row.awsKmsKeyId ?? undefined,
        createdAt: Number(row.createdAt),
        updatedAt: Number(row.updatedAt),
      };
    }
  }

  const state = await readState();
  return state.agentKeys[agentId] ?? null;
}

export async function upsertPersistedAgentKey(
  material: PersistedAgentKeyMaterial
): Promise<void> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      await prisma.agentKeyMaterial.upsert({
        where: { agentId: material.agentId },
        update: {
          walletAddress: material.walletAddress,
          provider: material.provider,
          keyRef: material.keyRef,
          ciphertext: material.ciphertext,
          iv: material.iv ?? null,
          authTag: material.authTag ?? null,
          awsKmsKeyId: material.awsKmsKeyId ?? null,
          updatedAt: BigInt(material.updatedAt),
        },
        create: {
          agentId: material.agentId,
          walletAddress: material.walletAddress,
          provider: material.provider,
          keyRef: material.keyRef,
          ciphertext: material.ciphertext,
          iv: material.iv ?? null,
          authTag: material.authTag ?? null,
          awsKmsKeyId: material.awsKmsKeyId ?? null,
          createdAt: BigInt(material.createdAt),
          updatedAt: BigInt(material.updatedAt),
        },
      });
      return;
    }
  }

  await queueWrite(async (state) => {
    state.agentKeys[material.agentId] = material;
    await writeState(state);
  });
}

export async function deletePersistedAgentKey(agentId: string): Promise<void> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      await prisma.agentKeyMaterial.deleteMany({ where: { agentId } });
      return;
    }
  }

  await queueWrite(async (state) => {
    delete state.agentKeys[agentId];
    await writeState(state);
  });
}

// ---------------------------------------------------------------------------
// 4. Proof Records
// ---------------------------------------------------------------------------

function proofRowToRecord(r: any): PersistedProofRecord {
  return {
    id: r.id,
    kind: r.kind,
    chainId: r.chainId,
    txHash: r.txHash ?? undefined,
    explorerUrl: r.explorerUrl ?? undefined,
    agentId: r.agentId ?? undefined,
    agentName: r.agentName ?? undefined,
    walletAddress: r.walletAddress ?? undefined,
    marketId: r.marketId ?? undefined,
    question: r.question ?? undefined,
    reasoningHash: r.reasoningHash ?? undefined,
    payloadHash: r.payloadHash,
    payload: r.payload,
    verification: safeJsonParse(r.verificationJson, undefined),
    anchor: safeJsonParse(r.anchorJson, undefined),
    tags: safeJsonParse(r.tagsJson, undefined),
    createdAt: Number(r.createdAt),
    updatedAt: Number(r.updatedAt),
  };
}

export async function getPersistedProofs(limit = 100): Promise<PersistedProofRecord[]> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const n = Math.max(1, Math.floor(limit));
      const rows = await prisma.proofRecord.findMany({
        orderBy: { createdAt: "desc" },
        take: n,
      });
      return rows.map(proofRowToRecord);
    }
  }

  const state = await readState();
  const n = Math.max(1, Math.floor(limit));
  return (state.proofs ?? [])
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, n);
}

export async function getPersistedProofById(
  id: string
): Promise<PersistedProofRecord | null> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const row = await prisma.proofRecord.findUnique({ where: { id } });
      if (!row) return null;
      return proofRowToRecord(row);
    }
  }

  const state = await readState();
  const proofs = state.proofs ?? [];
  return proofs.find((proof) => proof.id === id) ?? null;
}

export async function upsertPersistedProof(
  proof: PersistedProofRecord,
  maxRecords = 500
): Promise<PersistedProofRecord> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const data = {
        kind: proof.kind,
        chainId: proof.chainId,
        txHash: proof.txHash ?? null,
        explorerUrl: proof.explorerUrl ?? null,
        agentId: proof.agentId ?? null,
        agentName: proof.agentName ?? null,
        walletAddress: proof.walletAddress ?? null,
        marketId: proof.marketId ?? null,
        question: proof.question ?? null,
        reasoningHash: proof.reasoningHash ?? null,
        payloadHash: proof.payloadHash,
        payload: proof.payload,
        verificationJson: proof.verification
          ? JSON.stringify(proof.verification)
          : null,
        anchorJson: proof.anchor ? JSON.stringify(proof.anchor) : null,
        tagsJson: proof.tags ? JSON.stringify(proof.tags) : null,
        updatedAt: BigInt(proof.updatedAt),
      };

      await prisma.proofRecord.upsert({
        where: { id: proof.id },
        update: data,
        create: {
          id: proof.id,
          ...data,
          createdAt: BigInt(proof.createdAt),
        },
      });

      // Cleanup old records beyond cap
      const cap = Math.max(50, Math.floor(maxRecords));
      const count = await prisma.proofRecord.count();
      if (count > cap) {
        const excess = await prisma.proofRecord.findMany({
          orderBy: { createdAt: "desc" },
          skip: cap,
          select: { id: true },
        });
        if (excess.length > 0) {
          await prisma.proofRecord.deleteMany({
            where: { id: { in: excess.map((e: any) => e.id) } },
          });
        }
      }

      return proof;
    }
  }

  return await queueWrite(async (state) => {
    const records = Array.isArray(state.proofs) ? state.proofs.slice() : [];
    const existingIndex = records.findIndex((entry) => entry.id === proof.id);

    if (existingIndex >= 0) {
      records[existingIndex] = proof;
    } else {
      records.unshift(proof);
    }

    const cap = Math.max(50, Math.floor(maxRecords));
    state.proofs = records
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, cap);
    await writeState(state);
    return proof;
  });
}

// ---------------------------------------------------------------------------
// 5. Market Snapshots
// ---------------------------------------------------------------------------

export async function getPersistedMarketSnapshots(
  limit = 300
): Promise<PersistedMarketSnapshot[]> {
  // No dedicated Prisma model for market snapshots in the schema provided
  // (market-db handles this separately). Fall through to file/Upstash.
  const state = await readState();
  const n = Math.max(1, Math.floor(limit));
  return (state.marketSnapshots ?? [])
    .slice()
    .sort((a, b) => a.id - b.id)
    .slice(0, n);
}

export async function setPersistedMarketSnapshots(
  snapshots: PersistedMarketSnapshot[]
): Promise<void> {
  // No dedicated Prisma model for market snapshots; fall through to file/Upstash.
  await queueWrite(async (state) => {
    const deduped = new Map<number, PersistedMarketSnapshot>();
    for (const snapshot of snapshots) {
      if (!Number.isFinite(snapshot.id)) continue;
      deduped.set(snapshot.id, snapshot);
    }
    state.marketSnapshots = Array.from(deduped.values()).sort(
      (a, b) => a.id - b.id
    );
    await writeState(state);
  });
}

// ---------------------------------------------------------------------------
// 6. Loop Runtime
// ---------------------------------------------------------------------------

export async function getPersistedLoopRuntime(): Promise<PersistedLoopRuntimeState | null> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const row = await prisma.loopRuntime.findUnique({
        where: { id: "singleton" },
      });
      if (!row) return null;
      return {
        tickCount: row.tickCount,
        lastTickAt: row.lastTickAt != null ? Number(row.lastTickAt) : null,
        intervalMs: row.intervalMs,
        agentRotationIndex: row.agentRotationIndex,
        debateCounter: row.debateCounter,
        actionCounter: row.actionCounter,
        updatedAt: Number(row.updatedAt),
      };
    }
  }

  const state = await readState();
  return state.loopRuntime ?? null;
}

export async function setPersistedLoopRuntime(
  runtime: PersistedLoopRuntimeState
): Promise<void> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      await prisma.loopRuntime.upsert({
        where: { id: "singleton" },
        update: {
          tickCount: runtime.tickCount,
          lastTickAt:
            runtime.lastTickAt != null ? BigInt(runtime.lastTickAt) : null,
          intervalMs: runtime.intervalMs,
          agentRotationIndex: runtime.agentRotationIndex ?? 0,
          debateCounter: runtime.debateCounter ?? 0,
          actionCounter: runtime.actionCounter ?? 0,
          updatedAt: BigInt(runtime.updatedAt),
        },
        create: {
          id: "singleton",
          tickCount: runtime.tickCount,
          lastTickAt:
            runtime.lastTickAt != null ? BigInt(runtime.lastTickAt) : null,
          intervalMs: runtime.intervalMs,
          agentRotationIndex: runtime.agentRotationIndex ?? 0,
          debateCounter: runtime.debateCounter ?? 0,
          actionCounter: runtime.actionCounter ?? 0,
          updatedAt: BigInt(runtime.updatedAt),
        },
      });
      return;
    }
  }

  await queueWrite(async (state) => {
    state.loopRuntime = {
      tickCount: runtime.tickCount,
      lastTickAt: runtime.lastTickAt ?? null,
      intervalMs: runtime.intervalMs,
      agentRotationIndex: runtime.agentRotationIndex ?? 0,
      debateCounter: runtime.debateCounter ?? 0,
      actionCounter: runtime.actionCounter ?? 0,
      updatedAt: runtime.updatedAt,
    };
    await writeState(state);
  });
}

// ---------------------------------------------------------------------------
// 7. Loop Actions
// ---------------------------------------------------------------------------

function actionRowToPersistedAction(r: any): PersistedLoopAction {
  return {
    id: r.id,
    timestamp: Number(r.timestamp),
    agentId: r.agentId,
    agentName: r.agentName,
    type: r.actionType,
    marketId: r.marketId ?? undefined,
    question: r.question ?? undefined,
    detail: r.detail,
    probability: r.probability ?? undefined,
    betAmount: r.betAmount ?? undefined,
    betOutcome: (r.betOutcome as "YES" | "NO") ?? undefined,
    resolutionOutcome: (r.resolutionOutcome as "YES" | "NO") ?? undefined,
    sourcesUsed: r.sourcesUsed
      ? safeJsonParse<string[] | undefined>(r.sourcesUsed, undefined)
      : undefined,
    txHash: r.txHash ?? undefined,
    huginnTxHash: r.huginnTxHash ?? undefined,
    reasoningHash: r.reasoningHash ?? undefined,
    reasoning: r.reasoning ?? undefined,
    defiDirection: (r.defiDirection as "BUY" | "SELL") ?? undefined,
    defiPair: r.defiPair ?? undefined,
    defiAmount: r.defiAmount ?? undefined,
    debateTarget: r.debateTarget ?? undefined,
  };
}

export async function getPersistedLoopActions(
  limit = 200
): Promise<PersistedLoopAction[]> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const n = Math.max(1, Math.floor(limit));
      // Get the last N actions sorted by timestamp ascending
      const total = await prisma.loopAction.count();
      const skip = Math.max(0, total - n);
      const rows = await prisma.loopAction.findMany({
        orderBy: { timestamp: "asc" },
        skip,
        take: n,
      });
      return rows.map(actionRowToPersistedAction);
    }
  }

  const state = await readState();
  const n = Math.max(1, Math.floor(limit));
  return (state.loopActions ?? [])
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-n);
}

export async function appendPersistedLoopAction(
  action: PersistedLoopAction,
  maxRecords = 500
): Promise<void> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const data = {
        timestamp: BigInt(action.timestamp),
        agentId: action.agentId,
        agentName: action.agentName,
        actionType: action.type,
        marketId: action.marketId ?? null,
        question: action.question ?? null,
        detail: action.detail,
        probability: action.probability ?? null,
        betAmount: action.betAmount ?? null,
        betOutcome: action.betOutcome ?? null,
        resolutionOutcome: action.resolutionOutcome ?? null,
        sourcesUsed: action.sourcesUsed
          ? JSON.stringify(action.sourcesUsed)
          : null,
        txHash: action.txHash ?? null,
        huginnTxHash: action.huginnTxHash ?? null,
        reasoningHash: action.reasoningHash ?? null,
        reasoning: action.reasoning ?? null,
        defiDirection: action.defiDirection ?? null,
        defiPair: action.defiPair ?? null,
        defiAmount: action.defiAmount ?? null,
        debateTarget: action.debateTarget ?? null,
      };

      await prisma.loopAction.upsert({
        where: { id: action.id },
        update: data,
        create: { id: action.id, ...data },
      });

      // Cleanup old records beyond cap
      const cap = Math.max(100, Math.floor(maxRecords));
      const count = await prisma.loopAction.count();
      if (count > cap) {
        const excess = await prisma.loopAction.findMany({
          orderBy: { timestamp: "asc" },
          take: count - cap,
          select: { id: true },
        });
        if (excess.length > 0) {
          await prisma.loopAction.deleteMany({
            where: { id: { in: excess.map((e: any) => e.id) } },
          });
        }
      }

      return;
    }
  }

  await queueWrite(async (state) => {
    const records = Array.isArray(state.loopActions)
      ? state.loopActions.slice()
      : [];
    const existingIndex = records.findIndex((entry) => entry.id === action.id);
    if (existingIndex >= 0) {
      records[existingIndex] = action;
    } else {
      records.push(action);
    }

    const cap = Math.max(100, Math.floor(maxRecords));
    state.loopActions = records
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-cap);
    await writeState(state);
  });
}

// ---------------------------------------------------------------------------
// 8. Network Agents
// ---------------------------------------------------------------------------

function networkAgentRowToProfile(r: any): PersistedNetworkAgentProfile {
  return {
    id: r.id,
    walletAddress: r.walletAddress,
    x402Address: r.x402Address ?? undefined,
    name: r.name,
    handle: r.handle ?? undefined,
    description: r.description ?? undefined,
    model: r.model ?? undefined,
    endpointUrl: r.endpointUrl ?? undefined,
    agentCardUrl: r.agentCardUrl ?? undefined,
    budgetStrk: r.budgetStrk ?? undefined,
    maxBetStrk: r.maxBetStrk ?? undefined,
    topics: safeJsonParse<string[] | undefined>(r.topics, undefined),
    metadata: safeJsonParse<Record<string, string> | undefined>(
      r.metadataJson,
      undefined
    ),
    proofUrl: r.proofUrl ?? undefined,
    signature: r.signature ?? undefined,
    active: r.active,
    createdAt: Number(r.createdAt),
    updatedAt: Number(r.updatedAt),
    lastSeenAt: Number(r.lastSeenAt),
    lastHeartbeatAt:
      r.lastHeartbeatAt != null ? Number(r.lastHeartbeatAt) : undefined,
    heartbeatCount: r.heartbeatCount ?? 0,
    runtime: safeJsonParse(r.runtimeJson, undefined),
  };
}

export async function listPersistedNetworkAgents(
  limit = 500
): Promise<PersistedNetworkAgentProfile[]> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const n = Math.max(1, Math.floor(limit));
      const rows = await prisma.networkAgent.findMany({
        orderBy: { updatedAt: "desc" },
        take: n,
      });
      return rows.map(networkAgentRowToProfile);
    }
  }

  const state = await readState();
  const n = Math.max(1, Math.floor(limit));
  return Object.values(state.networkAgents ?? {})
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, n);
}

export async function getPersistedNetworkAgent(
  id: string
): Promise<PersistedNetworkAgentProfile | null> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const row = await prisma.networkAgent.findUnique({ where: { id } });
      if (!row) return null;
      return networkAgentRowToProfile(row);
    }
  }

  const state = await readState();
  return state.networkAgents?.[id] ?? null;
}

export async function upsertPersistedNetworkAgent(
  profile: PersistedNetworkAgentProfile
): Promise<PersistedNetworkAgentProfile> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const existing = await prisma.networkAgent.findUnique({
        where: { id: profile.id },
      });

      const data = {
        walletAddress: profile.walletAddress,
        x402Address: profile.x402Address ?? null,
        name: profile.name,
        handle: profile.handle ?? null,
        description: profile.description ?? null,
        model: profile.model ?? null,
        endpointUrl: profile.endpointUrl ?? null,
        agentCardUrl: profile.agentCardUrl ?? null,
        budgetStrk: profile.budgetStrk ?? null,
        maxBetStrk: profile.maxBetStrk ?? null,
        topics: profile.topics ? JSON.stringify(profile.topics) : "[]",
        metadataJson: profile.metadata
          ? JSON.stringify(profile.metadata)
          : null,
        proofUrl: profile.proofUrl ?? null,
        signature: profile.signature ?? null,
        active: profile.active,
        updatedAt: BigInt(profile.updatedAt),
        lastSeenAt: BigInt(profile.lastSeenAt),
        lastHeartbeatAt:
          profile.lastHeartbeatAt != null
            ? BigInt(profile.lastHeartbeatAt)
            : existing?.lastHeartbeatAt ?? null,
        heartbeatCount:
          profile.heartbeatCount ?? existing?.heartbeatCount ?? 0,
        runtimeJson:
          profile.runtime ?? existing?.runtimeJson
            ? JSON.stringify(
                profile.runtime ??
                  safeJsonParse(existing?.runtimeJson, undefined)
              )
            : null,
      };

      const row = await prisma.networkAgent.upsert({
        where: { id: profile.id },
        update: data,
        create: {
          id: profile.id,
          ...data,
          createdAt: BigInt(existing ? Number(existing.createdAt) : profile.createdAt),
        },
      });

      return networkAgentRowToProfile(row);
    }
  }

  return await queueWrite(async (state) => {
    const existing = state.networkAgents?.[profile.id];
    const next: PersistedNetworkAgentProfile = {
      ...existing,
      ...profile,
      id: profile.id,
      walletAddress: profile.walletAddress,
      createdAt: existing?.createdAt ?? profile.createdAt,
      updatedAt: profile.updatedAt,
      lastSeenAt: profile.lastSeenAt,
      lastHeartbeatAt: profile.lastHeartbeatAt ?? existing?.lastHeartbeatAt,
      heartbeatCount: profile.heartbeatCount ?? existing?.heartbeatCount ?? 0,
      runtime: profile.runtime ?? existing?.runtime,
    };
    if (!state.networkAgents) state.networkAgents = {};
    state.networkAgents[profile.id] = next;
    await writeState(state);
    return next;
  });
}

export async function touchPersistedNetworkAgentHeartbeat(args: {
  id: string;
  walletAddress: string;
  active?: boolean;
  endpointUrl?: string;
  runtime?: PersistedNetworkAgentProfile["runtime"];
  at?: number;
}): Promise<PersistedNetworkAgentProfile | null> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const existing = await prisma.networkAgent.findUnique({
        where: { id: args.id },
      });
      if (!existing) return null;
      if (
        existing.walletAddress.trim().toLowerCase() !==
        args.walletAddress.trim().toLowerCase()
      ) {
        return null;
      }

      const now = Number.isFinite(args.at) ? Number(args.at) : Date.now();
      const existingRuntime = safeJsonParse(existing.runtimeJson, undefined) as
        | PersistedNetworkAgentProfile["runtime"]
        | undefined;
      const mergedRuntime = args.runtime
        ? {
            ...(existingRuntime ?? {}),
            ...args.runtime,
            metadata: args.runtime.metadata ?? existingRuntime?.metadata,
          }
        : existingRuntime;

      const row = await prisma.networkAgent.update({
        where: { id: args.id },
        data: {
          active: args.active ?? existing.active,
          endpointUrl: args.endpointUrl ?? existing.endpointUrl,
          runtimeJson: mergedRuntime
            ? JSON.stringify(mergedRuntime)
            : existing.runtimeJson,
          updatedAt: BigInt(now),
          lastSeenAt: BigInt(now),
          lastHeartbeatAt: BigInt(now),
          heartbeatCount: (existing.heartbeatCount ?? 0) + 1,
        },
      });

      return networkAgentRowToProfile(row);
    }
  }

  return await queueWrite(async (state) => {
    const existing = state.networkAgents?.[args.id];
    if (!existing) return null;
    if (
      existing.walletAddress.trim().toLowerCase() !==
      args.walletAddress.trim().toLowerCase()
    ) {
      return null;
    }

    const now = Number.isFinite(args.at) ? Number(args.at) : Date.now();
    const next: PersistedNetworkAgentProfile = {
      ...existing,
      active: args.active ?? existing.active,
      endpointUrl: args.endpointUrl ?? existing.endpointUrl,
      runtime: args.runtime
        ? {
            ...(existing.runtime ?? {}),
            ...args.runtime,
            metadata: args.runtime.metadata ?? existing.runtime?.metadata,
          }
        : existing.runtime,
      updatedAt: now,
      lastSeenAt: now,
      lastHeartbeatAt: now,
      heartbeatCount: (existing.heartbeatCount ?? 0) + 1,
    };

    if (!state.networkAgents) state.networkAgents = {};
    state.networkAgents[args.id] = next;
    await writeState(state);
    return next;
  });
}

// ---------------------------------------------------------------------------
// 9. Network Contributions
// ---------------------------------------------------------------------------

function contributionRowToContribution(r: any): PersistedNetworkContribution {
  return {
    id: r.id,
    actorType: r.actorType as "agent" | "human",
    agentId: r.agentId ?? undefined,
    actorName: r.actorName,
    walletAddress: r.walletAddress ?? undefined,
    kind: r.kind as PersistedNetworkContributionKind,
    marketId: r.marketId ?? undefined,
    question: r.question ?? undefined,
    content: r.content ?? undefined,
    probability: r.probability ?? undefined,
    outcome: (r.outcome as "YES" | "NO") ?? undefined,
    amountStrk: r.amountStrk ?? undefined,
    sources: safeJsonParse<string[] | undefined>(r.sources, undefined),
    txHash: r.txHash ?? undefined,
    proofId: r.proofId ?? undefined,
    metadata: safeJsonParse<Record<string, string> | undefined>(
      r.metadataJson,
      undefined
    ),
    signature: r.signature ?? undefined,
    createdAt: Number(r.createdAt),
  };
}

export async function listPersistedNetworkContributions(args?: {
  limit?: number;
  marketId?: number;
  kind?: PersistedNetworkContributionKind;
  actorId?: string;
  since?: number;
}): Promise<PersistedNetworkContribution[]> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const limit = Math.max(1, Math.floor(args?.limit ?? 200));
      const where: any = {};
      if (args?.marketId !== undefined) where.marketId = args.marketId;
      if (args?.kind) where.kind = args.kind;
      if (args?.actorId?.trim()) where.agentId = args.actorId.trim();
      if (args?.since !== undefined)
        where.createdAt = { gte: BigInt(args.since) };

      const rows = await prisma.networkContribution.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return rows.map(contributionRowToContribution);
    }
  }

  const state = await readState();
  const limit = Math.max(1, Math.floor(args?.limit ?? 200));
  const marketId = args?.marketId;
  const kind = args?.kind;
  const actorId = args?.actorId?.trim();
  const since = args?.since;

  return (state.networkContributions ?? [])
    .filter((entry) => {
      if (marketId !== undefined && entry.marketId !== marketId) return false;
      if (kind && entry.kind !== kind) return false;
      if (actorId && entry.agentId !== actorId) return false;
      if (since !== undefined && entry.createdAt < since) return false;
      return true;
    })
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export async function appendPersistedNetworkContribution(
  contribution: PersistedNetworkContribution,
  maxRecords = 5000
): Promise<PersistedNetworkContribution> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const data = {
        actorType: contribution.actorType,
        agentId: contribution.agentId ?? null,
        actorName: contribution.actorName,
        walletAddress: contribution.walletAddress ?? null,
        kind: contribution.kind,
        marketId: contribution.marketId ?? null,
        question: contribution.question ?? null,
        content: contribution.content ?? null,
        probability: contribution.probability ?? null,
        outcome: contribution.outcome ?? null,
        amountStrk: contribution.amountStrk ?? null,
        sources: contribution.sources
          ? JSON.stringify(contribution.sources)
          : "[]",
        txHash: contribution.txHash ?? null,
        proofId: contribution.proofId ?? null,
        metadataJson: contribution.metadata
          ? JSON.stringify(contribution.metadata)
          : null,
        signature: contribution.signature ?? null,
        createdAt: BigInt(contribution.createdAt),
      };

      await prisma.networkContribution.upsert({
        where: { id: contribution.id },
        update: data,
        create: { id: contribution.id, ...data },
      });

      // Cleanup old records beyond cap
      const cap = Math.max(500, Math.floor(maxRecords));
      const count = await prisma.networkContribution.count();
      if (count > cap) {
        const excess = await prisma.networkContribution.findMany({
          orderBy: { createdAt: "asc" },
          take: count - cap,
          select: { id: true },
        });
        if (excess.length > 0) {
          await prisma.networkContribution.deleteMany({
            where: { id: { in: excess.map((e: any) => e.id) } },
          });
        }
      }

      return contribution;
    }
  }

  return await queueWrite(async (state) => {
    const records = Array.isArray(state.networkContributions)
      ? state.networkContributions.slice()
      : [];
    const existingIndex = records.findIndex((entry) => entry.id === contribution.id);
    if (existingIndex >= 0) {
      records[existingIndex] = contribution;
    } else {
      records.push(contribution);
    }

    const cap = Math.max(500, Math.floor(maxRecords));
    state.networkContributions = records
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-cap);
    await writeState(state);
    return contribution;
  });
}

// ---------------------------------------------------------------------------
// 10. Network Auth Challenges
// ---------------------------------------------------------------------------

function challengeRowToChallenge(r: any): PersistedNetworkAuthChallenge {
  return {
    id: r.id,
    walletAddress: r.walletAddress,
    action: r.action as PersistedNetworkAuthAction,
    payloadHash: r.payloadHash,
    nonce: r.nonce,
    expirySec: r.expirySec,
    createdAt: Number(r.createdAt),
    expiresAt: Number(r.expiresAt),
    usedAt: r.usedAt != null ? Number(r.usedAt) : undefined,
  };
}

export async function getPersistedNetworkAuthChallenge(
  id: string
): Promise<PersistedNetworkAuthChallenge | null> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const row = await prisma.networkAuthChallenge.findUnique({
        where: { id },
      });
      if (!row) return null;
      return challengeRowToChallenge(row);
    }
  }

  const state = await readState();
  return state.networkAuthChallenges?.[id] ?? null;
}

export async function upsertPersistedNetworkAuthChallenge(
  challenge: PersistedNetworkAuthChallenge
): Promise<PersistedNetworkAuthChallenge> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const data = {
        walletAddress: challenge.walletAddress,
        action: challenge.action,
        payloadHash: challenge.payloadHash,
        nonce: challenge.nonce,
        expirySec: challenge.expirySec,
        createdAt: BigInt(challenge.createdAt),
        expiresAt: BigInt(challenge.expiresAt),
        usedAt: challenge.usedAt != null ? BigInt(challenge.usedAt) : null,
      };

      await prisma.networkAuthChallenge.upsert({
        where: { id: challenge.id },
        update: data,
        create: { id: challenge.id, ...data },
      });

      // Cleanup expired challenges older than 24h
      const cutoff = BigInt(Date.now() - 24 * 60 * 60 * 1000);
      await prisma.networkAuthChallenge.deleteMany({
        where: {
          expiresAt: { lt: cutoff },
        },
      });

      return challenge;
    }
  }

  return await queueWrite(async (state) => {
    if (!state.networkAuthChallenges) state.networkAuthChallenges = {};

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, entry] of Object.entries(state.networkAuthChallenges)) {
      if ((entry.usedAt ?? entry.expiresAt) < cutoff) {
        delete state.networkAuthChallenges[id];
      }
    }

    state.networkAuthChallenges[challenge.id] = challenge;
    await writeState(state);
    return challenge;
  });
}

export async function markPersistedNetworkAuthChallengeUsed(
  id: string,
  usedAt = Date.now()
): Promise<PersistedNetworkAuthChallenge | null> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const existing = await prisma.networkAuthChallenge.findUnique({
        where: { id },
      });
      if (!existing) return null;
      if (existing.usedAt != null) return null;
      if (Number(existing.expiresAt) < usedAt) return null;

      const row = await prisma.networkAuthChallenge.update({
        where: { id },
        data: { usedAt: BigInt(usedAt) },
      });
      return challengeRowToChallenge(row);
    }
  }

  return await queueWrite(async (state) => {
    const existing = state.networkAuthChallenges?.[id];
    if (!existing) return null;
    if (existing.usedAt) return null;
    if (existing.expiresAt < usedAt) return null;

    const updated: PersistedNetworkAuthChallenge = {
      ...existing,
      usedAt,
    };
    state.networkAuthChallenges[id] = updated;
    await writeState(state);
    return updated;
  });
}
