/**
 * Agent Spawner — Registry for human-created agents + built-in seed agents.
 *
 * Built-in agents (Alpha through Epsilon) are always present — they survive
 * serverless cold starts because they're derived from AGENT_PERSONAS.
 *
 * User-spawned agents are stored in the browser via localStorage and passed
 * to API endpoints as needed.
 */

import type { Account } from "starknet";
import { AGENT_PERSONAS, type AgentPersona } from "./agent-personas";

export type ChildServerTier = "nano" | "micro" | "small";
export type ChildServerStatus = "starting" | "running" | "stopping" | "dead";
export type ChildServerSchedulerMode = "parent" | "self";
export type AgentKeyCustodyProvider = "memory" | "local-encrypted" | "aws-kms";

export interface ChildServerRuntime {
  provider: "bitsage-cloud";
  machineId: string;
  flyMachineId: string;
  tier: ChildServerTier;
  region?: string;
  preferredRegions?: string[];
  regionFailureLog?: Array<{ region: string; failedAt: number }>;
  status: ChildServerStatus;
  createdAt: number;
  lastHeartbeatAt: number | null;
  consecutiveHeartbeatFailures?: number;
  failoverCount?: number;
  lastFailoverAt?: number | null;
  depositTxHash?: string;
  lastError?: string;
  schedulerMode?: ChildServerSchedulerMode;
}

export interface AgentBudget {
  totalBudget: bigint;
  spent: bigint;
  maxBetSize: bigint;
}

export interface SpawnedAgent {
  id: string;
  name: string;
  persona: AgentPersona;
  budget: AgentBudget;
  createdAt: number;
  status: "running" | "paused" | "stopped";
  isBuiltIn?: boolean;
  stats: {
    predictions: number;
    bets: number;
    pnl: bigint;
  };
  /** On-chain address of this agent's own AgentAccount contract (Phase D). */
  walletAddress?: string;
  /** Ephemeral keypair — in-memory only, never serialized or returned via API. */
  privateKey?: string;
  /** In-process Account instance for signing txs as this child. Ephemeral. */
  account?: Account;
  /** Persisted encrypted key reference (KMS/local-encrypted) for signer recovery. */
  keyRef?: string;
  /** Key custody provider used for this agent signer. */
  keyCustodyProvider?: AgentKeyCustodyProvider;
  /** ERC-8004 identity token ID from the IdentityRegistry. */
  agentId?: bigint;
  /** Optional server runtime backing this child agent. */
  runtime?: ChildServerRuntime;
}

export interface SpawnAgentConfig {
  name: string;
  personaId?: string;
  customSystemPrompt?: string;
  budgetStrk?: number;
  maxBetStrk?: number;
  preferredSources?: string[];
}

/** Serializable config for localStorage persistence */
export interface SerializedSpawnedAgent {
  id: string;
  name: string;
  personaId: string;
  agentType: string;
  model: string;
  preferredSources: string[];
  budgetStrk: number;
  maxBetStrk: number;
  createdAt: number;
  status: "running" | "paused" | "stopped";
  walletAddress?: string;
  keyRef?: string;
  keyCustodyProvider?: AgentKeyCustodyProvider;
  agentId?: string;
  runtime?: {
    provider: "bitsage-cloud";
    machineId: string;
    flyMachineId?: string;
    tier: ChildServerTier;
    region?: string;
    preferredRegions?: string[];
    regionFailureLog?: Array<{ region: string; failedAt: number }>;
    status: ChildServerStatus;
    createdAt?: number;
    lastHeartbeatAt: number | null;
    consecutiveHeartbeatFailures?: number;
    failoverCount?: number;
    lastFailoverAt?: number | null;
    depositTxHash?: string;
    lastError?: string;
    schedulerMode?: ChildServerSchedulerMode;
  };
}

/**
 * Returns the 5 built-in agents derived from AGENT_PERSONAS.
 * These are always available regardless of server state.
 */
export function getBuiltInAgents(): SpawnedAgent[] {
  return AGENT_PERSONAS.map((persona) => ({
    id: persona.id,
    name: persona.name,
    persona,
    budget: {
      totalBudget: BigInt(1500) * 10n ** 18n, // 1500 STRK
      spent: 0n,
      maxBetSize: BigInt(10) * 10n ** 18n, // 10 STRK max
    },
    createdAt: Date.now(),
    status: "running" as const,
    isBuiltIn: true,
    stats: {
      predictions: 0,
      bets: 0,
      pnl: 0n,
    },
  }));
}

class AgentSpawnerRegistry {
  private agents = new Map<string, SpawnedAgent>();

  spawn(config: SpawnAgentConfig): SpawnedAgent {
    const id = `spawned_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Resolve persona: use existing or create custom
    let persona: AgentPersona;
    if (config.personaId) {
      const existing = AGENT_PERSONAS.find((p) => p.id === config.personaId);
      if (existing) {
        persona = {
          ...existing,
          id,
          name: config.name,
          preferredSources: config.preferredSources ?? existing.preferredSources,
        };
      } else {
        persona = this.createCustomPersona(id, config);
      }
    } else {
      persona = this.createCustomPersona(id, config);
    }

    const budgetWei = BigInt(Math.floor((config.budgetStrk ?? 300) * 1e18));
    const maxBetWei = BigInt(Math.floor((config.maxBetStrk ?? 10) * 1e18));

    const agent: SpawnedAgent = {
      id,
      name: config.name,
      persona,
      budget: {
        totalBudget: budgetWei,
        spent: 0n,
        maxBetSize: maxBetWei,
      },
      createdAt: Date.now(),
      status: "running",
      stats: {
        predictions: 0,
        bets: 0,
        pnl: 0n,
      },
    };

    this.agents.set(id, agent);
    return agent;
  }

  stop(agentId: string) {
    const agent = this.agents.get(agentId);
    if (agent) agent.status = "stopped";
  }

  pause(agentId: string) {
    const agent = this.agents.get(agentId);
    if (agent && agent.status === "running") agent.status = "paused";
  }

  resume(agentId: string) {
    const agent = this.agents.get(agentId);
    if (agent && agent.status === "paused") agent.status = "running";
  }

  updateBudget(
    agentId: string,
    update: { totalBudget?: bigint; maxBetSize?: bigint }
  ) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    if (update.totalBudget !== undefined) agent.budget.totalBudget = update.totalBudget;
    if (update.maxBetSize !== undefined) agent.budget.maxBetSize = update.maxBetSize;
  }

  remove(agentId: string) {
    this.agents.delete(agentId);
  }

  list(): SpawnedAgent[] {
    return Array.from(this.agents.values());
  }

  /** Returns built-in + spawned agents merged into a single list. */
  getAll(): SpawnedAgent[] {
    const builtIn = getBuiltInAgents();
    const spawned = this.list();
    return [...builtIn, ...spawned];
  }

  getAgent(id: string): SpawnedAgent | null {
    return this.agents.get(id) ?? null;
  }

  restore(serialized: SerializedSpawnedAgent): SpawnedAgent {
    const existing = this.agents.get(serialized.id);
    if (existing) {
      existing.status = serialized.status;
      existing.walletAddress = serialized.walletAddress;
      existing.keyRef = serialized.keyRef;
      existing.keyCustodyProvider = serialized.keyCustodyProvider;
      if (serialized.agentId) {
        try {
          existing.agentId = BigInt(serialized.agentId);
        } catch {
          // ignore invalid persisted agentId
        }
      }
      if (serialized.runtime) {
        existing.runtime = {
          provider: "bitsage-cloud",
          machineId: serialized.runtime.machineId,
          flyMachineId:
            serialized.runtime.flyMachineId ?? serialized.runtime.machineId,
          tier: serialized.runtime.tier,
          region: serialized.runtime.region,
          preferredRegions: serialized.runtime.preferredRegions ?? [],
          regionFailureLog: serialized.runtime.regionFailureLog ?? [],
          status: serialized.runtime.status,
          createdAt: serialized.runtime.createdAt ?? Date.now(),
          lastHeartbeatAt: serialized.runtime.lastHeartbeatAt ?? null,
          consecutiveHeartbeatFailures:
            serialized.runtime.consecutiveHeartbeatFailures ?? 0,
          failoverCount: serialized.runtime.failoverCount ?? 0,
          lastFailoverAt: serialized.runtime.lastFailoverAt ?? null,
          depositTxHash: serialized.runtime.depositTxHash,
          lastError: serialized.runtime.lastError,
          schedulerMode: serialized.runtime.schedulerMode ?? "self",
        };
      }
      return existing;
    }

    const knownPersona = AGENT_PERSONAS.find((p) => p.id === serialized.personaId);
    const persona: AgentPersona = knownPersona
      ? {
          ...knownPersona,
          id: serialized.id,
          name: serialized.name,
          preferredSources:
            serialized.preferredSources?.length > 0
              ? serialized.preferredSources
              : knownPersona.preferredSources,
        }
      : {
          id: serialized.id,
          name: serialized.name,
          agentType: serialized.agentType || "custom-forecaster",
          model: serialized.model || "claude-sonnet-4-5",
          biasFactor: 0.0,
          confidence: 0.8,
          preferredSources: serialized.preferredSources ?? [
            "polymarket",
            "coingecko",
            "news",
            "social",
          ],
          systemPrompt: `You are ${serialized.name}, a custom AI forecasting agent.`,
        };

    const budgetWei = BigInt(Math.floor((serialized.budgetStrk ?? 300) * 1e18));
    const maxBetWei = BigInt(Math.floor((serialized.maxBetStrk ?? 10) * 1e18));

    const restored: SpawnedAgent = {
      id: serialized.id,
      name: serialized.name,
      persona,
      budget: {
        totalBudget: budgetWei,
        spent: 0n,
        maxBetSize: maxBetWei,
      },
      createdAt: serialized.createdAt ?? Date.now(),
      status: serialized.status,
      stats: {
        predictions: 0,
        bets: 0,
        pnl: 0n,
      },
      walletAddress: serialized.walletAddress,
      keyRef: serialized.keyRef,
      keyCustodyProvider: serialized.keyCustodyProvider,
    };

    if (serialized.agentId) {
      try {
        restored.agentId = BigInt(serialized.agentId);
      } catch {
        // ignore invalid persisted agentId
      }
    }

    if (serialized.runtime) {
      restored.runtime = {
        provider: "bitsage-cloud",
        machineId: serialized.runtime.machineId,
        flyMachineId: serialized.runtime.flyMachineId ?? serialized.runtime.machineId,
        tier: serialized.runtime.tier,
        region: serialized.runtime.region,
        preferredRegions: serialized.runtime.preferredRegions ?? [],
        regionFailureLog: serialized.runtime.regionFailureLog ?? [],
        status: serialized.runtime.status,
        createdAt: serialized.runtime.createdAt ?? Date.now(),
        lastHeartbeatAt: serialized.runtime.lastHeartbeatAt ?? null,
        consecutiveHeartbeatFailures: serialized.runtime.consecutiveHeartbeatFailures ?? 0,
        failoverCount: serialized.runtime.failoverCount ?? 0,
        lastFailoverAt: serialized.runtime.lastFailoverAt ?? null,
        depositTxHash: serialized.runtime.depositTxHash,
        lastError: serialized.runtime.lastError,
        schedulerMode: serialized.runtime.schedulerMode ?? "self",
      };
    }

    this.agents.set(restored.id, restored);
    return restored;
  }

  private createCustomPersona(
    id: string,
    config: SpawnAgentConfig
  ): AgentPersona {
    return {
      id,
      name: config.name,
      agentType: "custom-forecaster",
      model: "claude-sonnet-4-5",
      biasFactor: 0.0,
      confidence: 0.8,
      preferredSources: config.preferredSources ?? [
        "polymarket",
        "coingecko",
        "news",
        "social",
      ],
      systemPrompt:
        config.customSystemPrompt ??
        `You are ${config.name}, a custom AI forecasting agent.

Your task is to analyze prediction market questions using real-world data and produce calibrated probability estimates.

Follow rigorous methodology:
1. Examine the research data provided carefully
2. Consider base rates and reference classes
3. Weight evidence from multiple sources
4. Be honest about uncertainty
5. Produce a specific probability estimate

End your analysis with: **My estimate: XX%**`,
    };
  }
}

/** Singleton spawner instance */
export const agentSpawner = new AgentSpawnerRegistry();

/** Serializable agent representation for API responses */
export function serializeAgent(
  agent: SpawnedAgent
): Record<string, unknown> {
  return {
    id: agent.id,
    name: agent.name,
    personaId: agent.persona.id,
    agentType: agent.persona.agentType,
    model: agent.persona.model,
    preferredSources: agent.persona.preferredSources,
    isBuiltIn: agent.isBuiltIn ?? false,
    budget: {
      totalBudget: agent.budget.totalBudget.toString(),
      spent: agent.budget.spent.toString(),
      maxBetSize: agent.budget.maxBetSize.toString(),
      remainingPct:
        agent.budget.totalBudget > 0n
          ? Number(
              ((agent.budget.totalBudget - agent.budget.spent) * 10000n) /
                agent.budget.totalBudget
            ) / 100
          : 0,
    },
    createdAt: agent.createdAt,
    status: agent.status,
    stats: {
      predictions: agent.stats.predictions,
      bets: agent.stats.bets,
      pnl: agent.stats.pnl.toString(),
    },
    // On-chain identity (Phase D) — exposed in API but private key never included
    walletAddress: agent.walletAddress,
    keyRef: agent.keyRef,
    keyCustodyProvider: agent.keyCustodyProvider,
    agentId: agent.agentId?.toString(),
    runtime: agent.runtime
      ? {
          provider: agent.runtime.provider,
          machineId: agent.runtime.machineId,
          flyMachineId: agent.runtime.flyMachineId,
          tier: agent.runtime.tier,
          region: agent.runtime.region,
          preferredRegions: agent.runtime.preferredRegions,
          regionFailureLog: agent.runtime.regionFailureLog,
          status: agent.runtime.status,
          createdAt: agent.runtime.createdAt,
          lastHeartbeatAt: agent.runtime.lastHeartbeatAt,
          consecutiveHeartbeatFailures: agent.runtime.consecutiveHeartbeatFailures,
          failoverCount: agent.runtime.failoverCount,
          lastFailoverAt: agent.runtime.lastFailoverAt,
          depositTxHash: agent.runtime.depositTxHash,
          lastError: agent.runtime.lastError,
          schedulerMode: agent.runtime.schedulerMode,
        }
      : undefined,
  };
}

/** localStorage key for spawned agents */
export const STORAGE_KEY = "prediction-agent-spawned";

/** Serialize a spawned agent for localStorage */
export function serializeForStorage(agent: SpawnedAgent): SerializedSpawnedAgent {
  return {
    id: agent.id,
    name: agent.name,
    personaId: agent.persona.id,
    agentType: agent.persona.agentType,
    model: agent.persona.model,
    preferredSources: agent.persona.preferredSources ?? [],
    budgetStrk: Number(agent.budget.totalBudget / 10n ** 18n),
    maxBetStrk: Number(agent.budget.maxBetSize / 10n ** 18n),
    createdAt: agent.createdAt,
    status: agent.status,
    walletAddress: agent.walletAddress,
    keyRef: agent.keyRef,
    keyCustodyProvider: agent.keyCustodyProvider,
    agentId: agent.agentId?.toString(),
    runtime: agent.runtime
      ? {
          provider: agent.runtime.provider,
          machineId: agent.runtime.machineId,
          flyMachineId: agent.runtime.flyMachineId,
          tier: agent.runtime.tier,
          region: agent.runtime.region,
          preferredRegions: agent.runtime.preferredRegions,
          regionFailureLog: agent.runtime.regionFailureLog,
          status: agent.runtime.status,
          createdAt: agent.runtime.createdAt,
          lastHeartbeatAt: agent.runtime.lastHeartbeatAt,
          consecutiveHeartbeatFailures: agent.runtime.consecutiveHeartbeatFailures,
          failoverCount: agent.runtime.failoverCount,
          lastFailoverAt: agent.runtime.lastFailoverAt,
          depositTxHash: agent.runtime.depositTxHash,
          lastError: agent.runtime.lastError,
          schedulerMode: agent.runtime.schedulerMode,
        }
      : undefined,
  };
}
