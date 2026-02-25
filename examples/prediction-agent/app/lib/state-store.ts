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

interface PersistedPredictionAgentState {
  version: 1;
  updatedAt: number;
  spawnedAgents: SerializedSpawnedAgent[];
  externalForecasts: Record<string, PersistedExternalForecast[]>;
  agentKeys: Record<string, PersistedAgentKeyMaterial>;
  proofs: PersistedProofRecord[];
}

const DEFAULT_STATE: PersistedPredictionAgentState = {
  version: 1,
  updatedAt: Date.now(),
  spawnedAgents: [],
  externalForecasts: {},
  agentKeys: {},
  proofs: [],
};

const STATE_FILE =
  process.env.AGENT_STATE_FILE ||
  path.join(os.tmpdir(), "starknet-agentic-prediction-state.json");

let writeQueue: Promise<void> = Promise.resolve();

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function normalizeState(raw: unknown): PersistedPredictionAgentState {
  if (!isObject(raw)) return { ...DEFAULT_STATE };

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

  return {
    version,
    updatedAt,
    spawnedAgents,
    externalForecasts,
    agentKeys,
    proofs,
  };
}

async function ensureDirectory(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function readState(): Promise<PersistedPredictionAgentState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (err: any) {
    if (err?.code === "ENOENT") return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE };
  }
}

async function writeState(state: PersistedPredictionAgentState): Promise<void> {
  const normalized: PersistedPredictionAgentState = {
    version: 1,
    updatedAt: Date.now(),
    spawnedAgents: state.spawnedAgents ?? [],
    externalForecasts: state.externalForecasts ?? {},
    agentKeys: state.agentKeys ?? {},
    proofs: state.proofs ?? [],
  };

  await ensureDirectory(STATE_FILE);
  const tempPath = `${STATE_FILE}.tmp`;
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
