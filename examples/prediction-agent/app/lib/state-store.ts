import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SerializedSpawnedAgent } from "./agent-spawner";

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
  effectiveBackend: "upstash" | "file";
  upstashConfigured: boolean;
  stateFile: string;
  upstashStateKey: string;
}

export function getStateStoreBackendInfo(): StateStoreBackendInfo {
  const requestedBackend =
    STATE_BACKEND === "upstash" || STATE_BACKEND === "file"
      ? STATE_BACKEND
      : "auto";

  return {
    requestedBackend,
    effectiveBackend: USE_UPSTASH_STATE ? "upstash" : "file",
    upstashConfigured: !!UPSTASH_URL && !!UPSTASH_TOKEN,
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

export async function getPersistedSpawnedAgents(): Promise<
  SerializedSpawnedAgent[]
> {
  const state = await readState();
  return state.spawnedAgents ?? [];
}

export async function setPersistedSpawnedAgents(
  agents: SerializedSpawnedAgent[]
): Promise<void> {
  await queueWrite(async (state) => {
    state.spawnedAgents = agents;
    await writeState(state);
  });
}

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

export async function getPersistedAgentKey(
  agentId: string
): Promise<PersistedAgentKeyMaterial | null> {
  const state = await readState();
  return state.agentKeys[agentId] ?? null;
}

export async function upsertPersistedAgentKey(
  material: PersistedAgentKeyMaterial
): Promise<void> {
  await queueWrite(async (state) => {
    state.agentKeys[material.agentId] = material;
    await writeState(state);
  });
}

export async function deletePersistedAgentKey(agentId: string): Promise<void> {
  await queueWrite(async (state) => {
    delete state.agentKeys[agentId];
    await writeState(state);
  });
}

export async function getPersistedProofs(limit = 100): Promise<PersistedProofRecord[]> {
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
  const state = await readState();
  const proofs = state.proofs ?? [];
  return proofs.find((proof) => proof.id === id) ?? null;
}

export async function upsertPersistedProof(
  proof: PersistedProofRecord,
  maxRecords = 500
): Promise<PersistedProofRecord> {
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

export async function getPersistedMarketSnapshots(
  limit = 300
): Promise<PersistedMarketSnapshot[]> {
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

export async function getPersistedLoopRuntime(): Promise<PersistedLoopRuntimeState | null> {
  const state = await readState();
  return state.loopRuntime ?? null;
}

export async function setPersistedLoopRuntime(
  runtime: PersistedLoopRuntimeState
): Promise<void> {
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

export async function getPersistedLoopActions(
  limit = 200
): Promise<PersistedLoopAction[]> {
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
