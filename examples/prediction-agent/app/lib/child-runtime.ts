import { Account, CallData, RpcProvider } from "starknet";
import { config } from "./config";
import type {
  ChildServerRuntime,
  ChildServerTier,
  SpawnedAgent,
} from "./agent-spawner";
import { resolveAgentPrivateKey } from "./agent-key-custody";

export interface ChildServerProvisionSuccess {
  status: "success";
  runtime: ChildServerRuntime;
}

export interface ChildServerProvisionSkipped {
  status: "skipped";
  reason: string;
}

export interface ChildServerProvisionError {
  status: "error";
  error: string;
}

export type ChildServerProvisionResult =
  | ChildServerProvisionSuccess
  | ChildServerProvisionSkipped
  | ChildServerProvisionError;

export interface ChildServerHeartbeatOk {
  status: "ok";
  machineId: string;
  stateChanged: boolean;
}

export interface ChildServerHeartbeatSkipped {
  status: "skipped";
  reason: string;
}

export interface ChildServerHeartbeatError {
  status: "error";
  machineId: string;
  error: string;
}

export interface ChildServerHeartbeatDead {
  status: "dead";
  machineId: string;
  error: string;
}

export interface ChildServerHeartbeatFailedOver {
  status: "failed_over";
  previousMachineId: string;
  machineId: string;
  previousRegion?: string;
  region?: string;
  reason: string;
}

export type ChildServerHeartbeatResult =
  | ChildServerHeartbeatOk
  | ChildServerHeartbeatSkipped
  | ChildServerHeartbeatError
  | ChildServerHeartbeatDead
  | ChildServerHeartbeatFailedOver;

export interface ChildServerTerminateResult {
  status: "success" | "skipped" | "error";
  machineId?: string;
  reason?: string;
  error?: string;
}

interface CloudMachine {
  id: string;
  flyMachineId: string;
  agentAddress: string;
  tier: ChildServerTier;
  region?: string;
  status: "starting" | "running" | "stopping" | "dead";
  createdAt: string;
}

interface CloudHeartbeatResult {
  ok: boolean;
  terminated?: boolean;
  error?: string;
}

interface CloudMachineRequest {
  agentAddress: string;
  tier: ChildServerTier;
  envVars: Record<string, string>;
  region?: string;
}

const VALID_TIERS = new Set<ChildServerTier>(["nano", "micro", "small"]);
const FAILOVER_LOCKS = new Set<string>();

function resolveTier(raw: string | undefined): ChildServerTier {
  if (!raw) return "nano";
  return VALID_TIERS.has(raw as ChildServerTier)
    ? (raw as ChildServerTier)
    : "nano";
}

function getCloudBaseUrl(): string {
  if (!config.BITSAGE_CLOUD_API_URL) {
    throw new Error("BITSAGE_CLOUD_API_URL is not configured");
  }
  return config.BITSAGE_CLOUD_API_URL.replace(/\/$/, "");
}

function childServerFeatureEnabled(): boolean {
  return config.childServerEnabled;
}

export function parseRegionPolicy(raw: string | undefined): string[] {
  return String(raw ?? "")
    .split(",")
    .map((region) => region.trim())
    .filter((region) => region.length > 0);
}

function preferredRegions(): string[] {
  return config.childServerRegions.length > 0
    ? config.childServerRegions
    : parseRegionPolicy(process.env.CHILD_AGENT_SERVER_REGIONS);
}

function buildRegionFailoverOrder(
  regions: string[],
  currentRegion?: string
): string[] {
  if (regions.length === 0) return [];
  if (!currentRegion) return [...regions];
  const normalizedCurrent = currentRegion.trim().toLowerCase();
  const idx = regions.findIndex((r) => r.toLowerCase() === normalizedCurrent);
  if (idx < 0) return [...regions];
  return [...regions.slice(idx + 1), ...regions.slice(0, idx + 1)];
}

function normalizeRegion(region: string | undefined): string {
  return String(region ?? "").trim().toLowerCase();
}

function recordRegionFailure(
  runtime: ChildServerRuntime,
  region: string | undefined,
  failedAt: number
): void {
  const normalized = normalizeRegion(region);
  if (!normalized) return;

  const entries = Array.isArray(runtime.regionFailureLog)
    ? runtime.regionFailureLog.slice(-24)
    : [];
  const index = entries.findIndex((entry) => normalizeRegion(entry.region) === normalized);
  if (index >= 0) {
    entries[index] = { region: normalized, failedAt };
  } else {
    entries.push({ region: normalized, failedAt });
  }
  runtime.regionFailureLog = entries.slice(-24);
}

export function selectFailoverRegions(args: {
  regions: string[];
  currentRegion?: string;
  regionFailureLog?: Array<{ region: string; failedAt: number }>;
  quarantineSecs: number;
  nowMs?: number;
}): string[] {
  const ordered = buildRegionFailoverOrder(args.regions, args.currentRegion);
  if (ordered.length === 0) return [];

  const quarantineMs = Math.max(0, args.quarantineSecs) * 1000;
  if (quarantineMs <= 0) return ordered;

  const now = args.nowMs ?? Date.now();
  const lastFailureByRegion = new Map<string, number>();
  for (const event of args.regionFailureLog ?? []) {
    const region = normalizeRegion(event.region);
    if (!region) continue;
    const ts = Number.isFinite(event.failedAt) ? event.failedAt : 0;
    const prev = lastFailureByRegion.get(region) ?? 0;
    if (ts > prev) {
      lastFailureByRegion.set(region, ts);
    }
  }

  const healthy = ordered.filter((region) => {
    const failedAt = lastFailureByRegion.get(normalizeRegion(region));
    if (!failedAt) return true;
    return now - failedAt >= quarantineMs;
  });

  // If every region is quarantined, allow full order to avoid deadlock.
  return healthy.length > 0 ? healthy : ordered;
}

export function shouldAttemptRuntimeFailover(args: {
  consecutiveFailures: number;
  failoverCount: number;
  lastFailoverAt: number | null | undefined;
  nowMs?: number;
}): boolean {
  if (config.childServerMaxFailovers <= 0) return false;
  if (args.failoverCount >= config.childServerMaxFailovers) return false;
  if (args.consecutiveFailures < config.childServerFailoverAfterFailures) return false;

  const now = args.nowMs ?? Date.now();
  const last = args.lastFailoverAt ?? 0;
  const cooldownMs = config.childServerFailoverCooldownSecs * 1000;
  if (cooldownMs <= 0) return true;
  return now - last >= cooldownMs;
}

function cloudHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.BITSAGE_CLOUD_API_TOKEN) {
    headers.Authorization = `Bearer ${config.BITSAGE_CLOUD_API_TOKEN}`;
  }

  return headers;
}

async function cloudFetchJson<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${getCloudBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...cloudHeaders(),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`BitsagE Cloud ${path} failed: HTTP ${response.status} ${text}`);
  }

  return (await response.json()) as T;
}

async function createMachine(args: CloudMachineRequest): Promise<CloudMachine> {
  return await cloudFetchJson<CloudMachine>("/machines/create", {
    method: "POST",
    body: JSON.stringify(args),
  });
}

async function createMachineWithPolicy(args: {
  agentAddress: string;
  tier: ChildServerTier;
  envVars: Record<string, string>;
  regions: string[];
}): Promise<{ machine: CloudMachine; region?: string }> {
  const errors: string[] = [];

  for (const region of args.regions) {
    try {
      const machine = await createMachine({
        agentAddress: args.agentAddress,
        tier: args.tier,
        envVars: args.envVars,
        region,
      });
      return { machine, region };
    } catch (err: any) {
      errors.push(`${region}: ${err?.message ?? String(err)}`);
    }
  }

  try {
    const machine = await createMachine({
      agentAddress: args.agentAddress,
      tier: args.tier,
      envVars: args.envVars,
    });
    return { machine, region: undefined };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    const detail = errors.length > 0 ? `${errors.join(" | ")} | fallback: ${message}` : message;
    throw new Error(detail);
  }
}

async function heartbeatMachine(machineId: string): Promise<CloudHeartbeatResult> {
  return await cloudFetchJson<CloudHeartbeatResult>(`/machines/${machineId}/heartbeat`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

async function destroyMachine(machineId: string): Promise<void> {
  await cloudFetchJson<Record<string, unknown>>(`/machines/${machineId}`, {
    method: "DELETE",
    body: JSON.stringify({}),
  });
}

async function depositEscrowCredits(args: {
  accountAddress: string;
  privateKey: string;
  amountStrk: number;
}): Promise<string> {
  if (!config.BITSAGE_CLOUD_ESCROW_ADDRESS) {
    throw new Error("BITSAGE_CLOUD_ESCROW_ADDRESS is not configured");
  }
  if (args.amountStrk <= 0) {
    throw new Error("Escrow deposit amount must be positive");
  }

  const provider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });
  const account = new Account({
    provider,
    address: args.accountAddress,
    signer: args.privateKey,
  });

  const amountWei = BigInt(Math.round(args.amountStrk * 1e18));

  const calls = [
    {
      contractAddress: config.COLLATERAL_TOKEN_ADDRESS,
      entrypoint: "approve",
      calldata: CallData.compile({
        spender: config.BITSAGE_CLOUD_ESCROW_ADDRESS,
        amount: { low: amountWei, high: 0n },
      }),
    },
    {
      contractAddress: config.BITSAGE_CLOUD_ESCROW_ADDRESS,
      entrypoint: "deposit",
      calldata: CallData.compile({
        amount: { low: amountWei, high: 0n },
      }),
    },
  ];

  const result = await account.execute(calls);
  await provider.waitForTransaction(result.transaction_hash);
  return result.transaction_hash;
}

export function shouldHeartbeatChildServer(
  tickCount: number,
  heartbeatEveryTicks: number
): boolean {
  if (!Number.isFinite(tickCount) || tickCount < 1) return false;
  const interval = Math.max(1, Math.floor(heartbeatEveryTicks));
  return tickCount % interval === 0;
}

export function buildChildServerEnv(args: {
  childAgentId: string;
  childName: string;
  childAddress: string;
  childPrivateKey: string;
  parentAddress?: string | null;
}): Record<string, string> {
  const envVars: Record<string, string> = {
    STARKNET_RPC_URL: config.STARKNET_RPC_URL,
    STARKNET_CHAIN_ID: config.STARKNET_CHAIN_ID,
    AGENT_ADDRESS: args.childAddress,
    AGENT_PRIVATE_KEY: args.childPrivateKey,
    MARKET_FACTORY_ADDRESS: config.MARKET_FACTORY_ADDRESS,
    ACCURACY_TRACKER_ADDRESS: config.ACCURACY_TRACKER_ADDRESS,
    COLLATERAL_TOKEN_ADDRESS: config.COLLATERAL_TOKEN_ADDRESS,
    CHILD_AGENT_ID: args.childAgentId,
    CHILD_AGENT_NAME: args.childName,
    CHILD_AGENT_SELF_SCHEDULER_ENABLED: "true",
    CHILD_AGENT_SELF_SCHEDULER_INTERVAL_MS: String(
      config.childSelfSchedulerIntervalMs
    ),
    CHILD_AGENT_SELF_SCHEDULER_JITTER_MS: String(
      config.childSelfSchedulerJitterMs
    ),
  };

  if (config.HUGINN_REGISTRY_ADDRESS && config.HUGINN_REGISTRY_ADDRESS !== "0x0") {
    envVars.HUGINN_REGISTRY_ADDRESS = config.HUGINN_REGISTRY_ADDRESS;
  }
  if (process.env.AGENT_LLM_PROVIDER) {
    envVars.AGENT_LLM_PROVIDER = process.env.AGENT_LLM_PROVIDER;
  }
  if (process.env.AGENT_LLM_MODEL) {
    envVars.AGENT_LLM_MODEL = process.env.AGENT_LLM_MODEL;
  }
  if (process.env.AGENT_LLM_FORECAST_MODEL) {
    envVars.AGENT_LLM_FORECAST_MODEL = process.env.AGENT_LLM_FORECAST_MODEL;
  }
  if (process.env.AGENT_LLM_DEBATE_MODEL) {
    envVars.AGENT_LLM_DEBATE_MODEL = process.env.AGENT_LLM_DEBATE_MODEL;
  }
  if (process.env.AGENT_LLM_RESOLUTION_MODEL) {
    envVars.AGENT_LLM_RESOLUTION_MODEL = process.env.AGENT_LLM_RESOLUTION_MODEL;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    envVars.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.XAI_API_KEY) {
    envVars.XAI_API_KEY = process.env.XAI_API_KEY;
  }
  if (process.env.XAI_BASE_URL) {
    envVars.XAI_BASE_URL = process.env.XAI_BASE_URL;
  }
  if (process.env.XAI_ENABLE_NATIVE_TOOLS) {
    envVars.XAI_ENABLE_NATIVE_TOOLS = process.env.XAI_ENABLE_NATIVE_TOOLS;
  }
  if (process.env.XAI_ENABLE_WEB_SEARCH) {
    envVars.XAI_ENABLE_WEB_SEARCH = process.env.XAI_ENABLE_WEB_SEARCH;
  }
  if (process.env.XAI_ENABLE_X_SEARCH) {
    envVars.XAI_ENABLE_X_SEARCH = process.env.XAI_ENABLE_X_SEARCH;
  }
  if (process.env.XAI_ENABLE_CODE_EXECUTION) {
    envVars.XAI_ENABLE_CODE_EXECUTION = process.env.XAI_ENABLE_CODE_EXECUTION;
  }
  if (process.env.XAI_ENABLE_COLLECTIONS_SEARCH) {
    envVars.XAI_ENABLE_COLLECTIONS_SEARCH =
      process.env.XAI_ENABLE_COLLECTIONS_SEARCH;
  }
  if (process.env.XAI_COLLECTION_IDS) {
    envVars.XAI_COLLECTION_IDS = process.env.XAI_COLLECTION_IDS;
  }
  if (process.env.XAI_CODE_TOOL_TYPE) {
    envVars.XAI_CODE_TOOL_TYPE = process.env.XAI_CODE_TOOL_TYPE;
  }
  if (config.HEARTBEAT_SECRET) {
    envVars.HEARTBEAT_SECRET = config.HEARTBEAT_SECRET;
  }
  if (args.parentAddress) {
    envVars.PARENT_AGENT_ADDRESS = args.parentAddress;
  }

  return envVars;
}

export async function provisionChildServerRuntime(
  agent: SpawnedAgent
): Promise<ChildServerProvisionResult> {
  if (!childServerFeatureEnabled()) {
    return {
      status: "skipped",
      reason: "CHILD_AGENT_SERVER_ENABLED is false or BitsagE Cloud is not configured",
    };
  }

  if (!agent.walletAddress) {
    return {
      status: "error",
      error: "Child wallet address is missing",
    };
  }

  const privateKey = await resolveAgentPrivateKey(agent);
  if (!privateKey) {
    return {
      status: "error",
      error: "Child wallet signing key is unavailable (key custody unresolved)",
    };
  }

  if (agent.runtime && ["starting", "running"].includes(agent.runtime.status)) {
    return {
      status: "skipped",
      reason: `Runtime already exists (${agent.runtime.status})`,
    };
  }

  try {
    let depositTxHash: string | undefined;
    if (config.childServerEscrowDepositStrk > 0) {
      depositTxHash = await depositEscrowCredits({
        accountAddress: agent.walletAddress,
        privateKey,
        amountStrk: config.childServerEscrowDepositStrk,
      });
    }

    const policyRegions = preferredRegions();
    const { machine, region } = await createMachineWithPolicy({
      agentAddress: agent.walletAddress,
      tier: resolveTier(config.childServerTier),
      envVars: buildChildServerEnv({
        childAgentId: agent.id,
        childName: agent.name,
        childAddress: agent.walletAddress,
        childPrivateKey: privateKey,
        parentAddress: config.AGENT_ADDRESS,
      }),
      regions: policyRegions,
    });

    const runtime: ChildServerRuntime = {
      provider: config.childServerProvider,
      machineId: machine.id,
      flyMachineId: machine.flyMachineId,
      tier: machine.tier,
      region: region ?? machine.region,
      preferredRegions: policyRegions,
      regionFailureLog: [],
      status: machine.status,
      createdAt: Date.now(),
      lastHeartbeatAt: null,
      consecutiveHeartbeatFailures: 0,
      failoverCount: 0,
      lastFailoverAt: null,
      depositTxHash,
      schedulerMode: "self",
    };

    agent.runtime = runtime;
    return { status: "success", runtime };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    return { status: "error", error: `Failed to provision child server: ${message}` };
  }
}

async function attemptRuntimeFailover(args: {
  agent: SpawnedAgent;
  reason: string;
}): Promise<ChildServerHeartbeatFailedOver | null> {
  const { agent, reason } = args;
  const runtime = agent.runtime;
  if (!runtime) return null;
  if (!agent.walletAddress) return null;
  const privateKey = await resolveAgentPrivateKey(agent);
  if (!privateKey) return null;
  const lockKey = agent.id || runtime.machineId;
  if (FAILOVER_LOCKS.has(lockKey)) return null;

  const consecutiveFailures = runtime.consecutiveHeartbeatFailures ?? 0;
  const failoverCount = runtime.failoverCount ?? 0;
  if (
    !shouldAttemptRuntimeFailover({
      consecutiveFailures,
      failoverCount,
      lastFailoverAt: runtime.lastFailoverAt,
    })
  ) {
    return null;
  }

  FAILOVER_LOCKS.add(lockKey);

  const previousMachineId = runtime.machineId;
  const previousRegion = runtime.region;
  const policyRegions =
    runtime.preferredRegions && runtime.preferredRegions.length > 0
      ? runtime.preferredRegions
      : preferredRegions();
  const now = Date.now();
  recordRegionFailure(runtime, previousRegion, now);
  const failoverOrder = selectFailoverRegions({
    regions: policyRegions,
    currentRegion: previousRegion,
    regionFailureLog: runtime.regionFailureLog,
    quarantineSecs: config.childServerRegionQuarantineSecs,
    nowMs: now,
  });

  try {
    try {
      // Best-effort cleanup of the failed machine.
      await destroyMachine(previousMachineId);
    } catch {
      // ignore cleanup failures
    }

    const { machine, region } = await createMachineWithPolicy({
      agentAddress: agent.walletAddress,
      tier: runtime.tier,
      envVars: buildChildServerEnv({
        childAgentId: agent.id,
        childName: agent.name,
        childAddress: agent.walletAddress,
        childPrivateKey: privateKey,
        parentAddress: config.AGENT_ADDRESS,
      }),
      regions: failoverOrder,
    });

    runtime.machineId = machine.id;
    runtime.flyMachineId = machine.flyMachineId;
    runtime.tier = machine.tier;
    runtime.status = machine.status;
    runtime.region = region ?? machine.region;
    runtime.preferredRegions = policyRegions;
    runtime.lastHeartbeatAt = null;
    runtime.consecutiveHeartbeatFailures = 0;
    runtime.failoverCount = failoverCount + 1;
    runtime.lastFailoverAt = now;
    runtime.lastError = `failover: ${reason}`;
    runtime.schedulerMode = runtime.schedulerMode ?? "self";

    return {
      status: "failed_over",
      previousMachineId,
      machineId: machine.id,
      previousRegion,
      region: runtime.region,
      reason,
    };
  } catch (err: any) {
    runtime.status = "dead";
    runtime.lastError = `Failover failed: ${err?.message ?? String(err)}`;
    runtime.lastFailoverAt = now;
    return null;
  } finally {
    FAILOVER_LOCKS.delete(lockKey);
  }
}

export async function heartbeatChildServerRuntime(args: {
  agent: SpawnedAgent;
  tickCount: number;
}): Promise<ChildServerHeartbeatResult> {
  const { agent, tickCount } = args;

  if (!childServerFeatureEnabled()) {
    return { status: "skipped", reason: "Child server runtime disabled" };
  }

  if (!agent.runtime) {
    return { status: "skipped", reason: "No runtime attached" };
  }

  if (!shouldHeartbeatChildServer(tickCount, config.childServerHeartbeatEvery)) {
    return { status: "skipped", reason: "Heartbeat interval not reached" };
  }

  if (agent.runtime.status === "stopping") {
    return { status: "skipped", reason: "Runtime is stopping" };
  }

  if (agent.runtime.status === "dead") {
    agent.runtime.consecutiveHeartbeatFailures = Math.max(
      config.childServerFailoverAfterFailures,
      agent.runtime.consecutiveHeartbeatFailures ?? 0
    );
    const failover = await attemptRuntimeFailover({
      agent,
      reason: "runtime is marked dead",
    });
    if (failover) return failover;
    return { status: "skipped", reason: "Runtime is dead and failover is not allowed yet" };
  }

  const prevStatus = agent.runtime.status;

  try {
    const result = await heartbeatMachine(agent.runtime.machineId);

    if (result.ok) {
      agent.runtime.status = "running";
      agent.runtime.lastHeartbeatAt = Date.now();
      agent.runtime.consecutiveHeartbeatFailures = 0;
      agent.runtime.lastError = undefined;
      return {
        status: "ok",
        machineId: agent.runtime.machineId,
        stateChanged: prevStatus !== "running",
      };
    }

    if (result.terminated) {
      const error = result.error ?? "terminated due to insufficient escrow balance";
      agent.runtime.status = "dead";
      agent.runtime.consecutiveHeartbeatFailures =
        (agent.runtime.consecutiveHeartbeatFailures ?? 0) + 1;
      agent.runtime.lastError = error;
      const failover = await attemptRuntimeFailover({ agent, reason: error });
      if (failover) return failover;
      return {
        status: "dead",
        machineId: agent.runtime.machineId,
        error,
      };
    }

    const error = result.error ?? "heartbeat rejected";
    agent.runtime.consecutiveHeartbeatFailures =
      (agent.runtime.consecutiveHeartbeatFailures ?? 0) + 1;
    agent.runtime.lastError = error;
    const failover = await attemptRuntimeFailover({ agent, reason: error });
    if (failover) return failover;
    return {
      status: "error",
      machineId: agent.runtime.machineId,
      error,
    };
  } catch (err: any) {
    const error = err?.message ?? String(err);
    agent.runtime.consecutiveHeartbeatFailures =
      (agent.runtime.consecutiveHeartbeatFailures ?? 0) + 1;
    agent.runtime.lastError = error;
    const failover = await attemptRuntimeFailover({ agent, reason: error });
    if (failover) return failover;
    return {
      status: "error",
      machineId: agent.runtime.machineId,
      error,
    };
  }
}

export async function terminateChildServerRuntime(
  agent: SpawnedAgent
): Promise<ChildServerTerminateResult> {
  if (!agent.runtime) {
    return { status: "skipped", reason: "No runtime attached" };
  }

  if (!childServerFeatureEnabled()) {
    agent.runtime.status = "dead";
    return {
      status: "skipped",
      machineId: agent.runtime.machineId,
      reason: "Child server runtime disabled",
    };
  }

  try {
    await destroyMachine(agent.runtime.machineId);
    agent.runtime.status = "dead";
    agent.runtime.lastError = undefined;
    return {
      status: "success",
      machineId: agent.runtime.machineId,
    };
  } catch (err: any) {
    const error = err?.message ?? String(err);
    agent.runtime.lastError = error;
    return {
      status: "error",
      machineId: agent.runtime.machineId,
      error,
    };
  }
}
