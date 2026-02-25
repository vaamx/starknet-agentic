/**
 * Autonomous Agent Loop — Core engine for continuous agent operation.
 *
 * Supports two modes:
 * 1. Client-driven polling: Dashboard sends POST { action: "tick" } every 60s
 * 2. Legacy server-side: setInterval (works locally, NOT on Vercel serverless)
 *
 * Each tick picks one agent + one market and runs research → forecast → bet.
 * Executes REAL on-chain transactions when agent account is configured.
 */

import {
  getMarkets,
  getAgentBrierStats,
  getAgentPredictions,
  MARKET_QUESTIONS,
  SUPER_BOWL_REGEX,
  type MarketState,
  registerQuestion,
  resolveMarketQuestion,
} from "./market-reader";
import {
  researchAndForecast,
  type MarketContext,
  type ResearchEvent,
} from "./research-agent";
import { discoverMarkets } from "./market-discovery";
import { gatherResearch, type DataSourceName } from "./data-sources";
import { fetchCryptoPrices } from "./data-sources/crypto-prices";
import { categorizeMarket, estimateEngagementScore } from "./categories";
import {
  AGENT_PERSONAS,
  type AgentPersona,
} from "./agent-personas";
import { type AgentBudget, type SpawnedAgent, agentSpawner } from "./agent-spawner";
import { buildTickAgentActors, selectTickAgentActor } from "./agent-loop-rotation";
import {
  heartbeatChildServerRuntime,
  provisionChildServerRuntime,
} from "./child-runtime";
import { hydrateAgentAccount, storeAgentPrivateKey } from "./agent-key-custody";
import { Account, RpcProvider } from "starknet";
import { placeBet, recordPrediction, isAgentConfigured, createMarket, getSignerMode } from "./starknet-executor";
import { config } from "./config";
import { logThoughtOnChain } from "./huginn-executor";
import { executeAvnuSwap } from "./defi-executor";
import { generateDebateExchange } from "./agent-debate";
import { hasSessionKeyConfigured } from "./session-policy";
import {
  getSurvivalState,
  getBetMultiplier,
  getModelForTier,
  markSweepCompleted,
  getLastSweepAt,
  type SurvivalState,
} from "./survival-engine";
import { updateSoul, getSoulChildren, incrementSoulPredictions, incrementSoulBets } from "./soul";
import { deployChildAgent } from "./child-spawner";
import { recordAgentActionProof } from "./proof-pipeline";
import {
  assessResearchCoverage,
  checkResearchGate,
  mergeResearchCoverage,
  type ToolEvidence,
} from "./research-quality";
import {
  computeBrierWeightedConsensus,
  type ConsensusGuardrailReason,
} from "./consensus-weighting";
import { ensureAgentSpawnerHydrated, persistAgentSpawner } from "./agent-persistence";
import { deriveConsensusAutotuneProfile } from "./consensus-autotune";
import { tryResolveMarket } from "./resolution-oracle";
import {
  appendPersistedLoopAction,
  setPersistedLoopRuntime,
  type PersistedLoopAction,
} from "./state-store";

export interface AgentActionConsensusMeta {
  enabled: boolean;
  applied: boolean;
  guardrailReason: ConsensusGuardrailReason | null;
  leadProbability: number;
  finalProbability: number;
  deltaFromLead: number;
  peerCount: number;
  peerWeightTotal: number;
  minPeersUsed: number;
  minPeerPredictionCountUsed: number;
  minTotalPeerWeightUsed: number;
  maxShiftUsed: number;
  autotune: {
    enabled: boolean;
    sampleCount: number;
    drift: number;
    normalizedDrift: number;
    reason?: "disabled" | "insufficient_samples";
  };
}

export interface AgentActionRuntimeMeta {
  event:
    | "provisioned"
    | "heartbeat_recovered"
    | "failed_over"
    | "terminated"
    | "heartbeat_error";
  machineId?: string;
  previousMachineId?: string;
  region?: string;
  previousRegion?: string;
  failoverCount?: number;
  reason?: string;
}

export interface AgentAction {
  id: string;
  timestamp: number;
  agentId: string;
  agentName: string;
  type:
    | "research"
    | "prediction"
    | "bet"
    | "resolution"
    | "discovery"
    | "error"
    | "debate"
    | "market_creation"
    | "runtime"
    | "defi_signal"
    | "defi_swap";
  marketId?: number;
  question?: string;
  detail: string;
  probability?: number;
  betAmount?: string;
  betOutcome?: "YES" | "NO";
  resolutionOutcome?: "YES" | "NO";
  sourcesUsed?: string[];
  txHash?: string;
  /** Starknet tx hash of the Huginn Registry log_thought() call. Present only on Huginn success. */
  huginnTxHash?: string;
  reasoningHash?: string;
  reasoning?: string;
  defiDirection?: "BUY" | "SELL";
  defiPair?: string;
  defiAmount?: string;
  debateTarget?: string;
  consensusMeta?: AgentActionConsensusMeta;
  runtimeMeta?: AgentActionRuntimeMeta;
}


export interface LoopStatus {
  isRunning: boolean;
  tickCount: number;
  lastTickAt: number | null;
  nextTickAt: number | null;
  activeAgentCount: number;
  intervalMs: number;
  onChainEnabled: boolean;
  aiEnabled: boolean;
  signerMode: "owner" | "session";
  sessionKeyConfigured: boolean;
  autoResolveEnabled: boolean;
  defiEnabled: boolean;
  defiAutoTrade: boolean;
  debateEnabled: boolean;
}

type LoopListener = (action: AgentAction) => void;

const MAX_ACTION_LOG = 200;

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stableQuestionHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).slice(0, 4);
}

function questionFingerprint(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bwill\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

function toOnChainQuestion(question: string, durationDays: number): string {
  const clean = question
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) {
    return `Market ${Math.max(1, durationDays)}d`;
  }

  const suffix = ` ${Math.max(1, durationDays)}d ${stableQuestionHash(clean)}`;
  const maxBaseLen = Math.max(8, 31 - suffix.length);
  const base = clean.slice(0, maxBaseLen).trim();
  return `${base}${suffix}`.slice(0, 31);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(label));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function formatStrk(amount: bigint): string {
  return `${Number(amount / 10n ** 14n) / 10000} STRK`;
}

function computeBetAmount(
  confidence: number,
  budget?: AgentBudget,
  survivalMultiplier = 1.0
): bigint {
  const minStrk = Math.max(0, parseNumber(config.AGENT_BET_MIN_STRK, 5));
  const maxStrk = Math.max(minStrk, parseNumber(config.AGENT_BET_MAX_STRK, 10));

  let cap = maxStrk;
  if (budget) {
    const budgetMax = Number(budget.maxBetSize) / 1e18;
    if (Number.isFinite(budgetMax) && budgetMax > 0) {
      cap = Math.min(cap, budgetMax);
    }
  }

  if (cap <= 0) return 0n;

  const effectiveMin = Math.min(minStrk, cap);
  const betStrk = effectiveMin + confidence * (cap - effectiveMin);
  // Apply survival multiplier BEFORE budget check
  const scaledStrk = betStrk * Math.max(0, survivalMultiplier);
  let betWei = BigInt(Math.round(scaledStrk * 1e18));

  if (budget) {
    const remaining = budget.totalBudget - budget.spent;
    const minWei = BigInt(Math.round(effectiveMin * 1e18));
    if (remaining < minWei) return 0n;
    if (betWei > remaining) betWei = remaining;
  }

  return betWei;
}

function toPersistedLoopAction(action: AgentAction): PersistedLoopAction {
  return {
    id: action.id,
    timestamp: action.timestamp,
    agentId: action.agentId,
    agentName: action.agentName,
    type: action.type,
    marketId: action.marketId,
    question: action.question,
    detail: action.detail,
    probability: action.probability,
    betAmount: action.betAmount,
    betOutcome: action.betOutcome,
    resolutionOutcome: action.resolutionOutcome,
    sourcesUsed: action.sourcesUsed,
    txHash: action.txHash,
    huginnTxHash: action.huginnTxHash,
    reasoningHash: action.reasoningHash,
    reasoning: action.reasoning,
    defiDirection: action.defiDirection,
    defiPair: action.defiPair,
    defiAmount: action.defiAmount,
    debateTarget: action.debateTarget,
  };
}

class AgentLoop {
  private isRunning = false;
  private intervalId?: ReturnType<typeof setInterval>;
  private actionLog: AgentAction[] = [];
  private tickCount = 0;
  private lastTickAt: number | null = null;
  private intervalMs = 60_000;
  private listeners = new Set<LoopListener>();
  private actionCounter = 0;
  private agentRotationIndex = 0;
  private marketCreationInterval = 5;
  private defiInterval = 7;
  private debateCounter = 0;
  private lastResolutionAttemptAt = new Map<number, number>();
  /** Last survival state — updated each tick */
  private lastSurvival: SurvivalState | null = null;
  /** Count of consecutive thriving ticks for replication guard */
  private thrivingTickCount = 0;

  /** Legacy: start server-side interval (only works in long-lived processes) */
  start(intervalMs?: number) {
    if (this.isRunning) return;
    this.isRunning = true;
    if (intervalMs) this.intervalMs = intervalMs;

    this.tick();
    this.intervalId = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  getStatus(): LoopStatus {
    const spawned = agentSpawner.list().filter((a) => a.status === "running");
    return {
      isRunning: this.isRunning,
      tickCount: this.tickCount,
      lastTickAt: this.lastTickAt,
      nextTickAt: this.isRunning
        ? (this.lastTickAt ?? Date.now()) + this.intervalMs
        : null,
      activeAgentCount: AGENT_PERSONAS.length + spawned.length,
      intervalMs: this.intervalMs,
      onChainEnabled: isAgentConfigured(),
      aiEnabled: !!process.env.ANTHROPIC_API_KEY,
      signerMode: getSignerMode(),
      sessionKeyConfigured: hasSessionKeyConfigured(),
      autoResolveEnabled: config.agentAutoResolveEnabled,
      defiEnabled: config.AGENT_DEFI_ENABLED === "true",
      defiAutoTrade: config.AGENT_DEFI_AUTO_TRADE === "true",
      debateEnabled: config.AGENT_DEBATE_ENABLED === "true",
    };
  }

  getActionLog(limit?: number): AgentAction[] {
    const n = limit ?? 50;
    return this.actionLog.slice(-n);
  }

  subscribe(listener: LoopListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(action: AgentAction) {
    this.actionLog.push(action);
    if (this.actionLog.length > MAX_ACTION_LOG) {
      this.actionLog = this.actionLog.slice(-MAX_ACTION_LOG);
    }
    void appendPersistedLoopAction(
      toPersistedLoopAction(action),
      MAX_ACTION_LOG
    ).catch(() => {
      // Persistence is best-effort in serverless/runtime-constrained environments.
    });
    if (action.txHash) {
      void recordAgentActionProof({
        type: action.type,
        txHash: action.txHash,
        agentId: action.agentId,
        agentName: action.agentName,
        marketId: action.marketId,
        question: action.question,
        reasoningHash: action.reasoningHash,
        probability: action.probability,
        betAmount: action.betAmount,
        betOutcome: action.betOutcome,
        resolutionOutcome: action.resolutionOutcome,
        detail: action.detail,
      }).catch(() => {
        // Proof pipeline is non-blocking.
      });
    }
    for (const listener of this.listeners) {
      try {
        listener(action);
      } catch {
        // Don't let listener errors break the loop
      }
    }
  }

  private createAction(
    partial: Omit<AgentAction, "id" | "timestamp">
  ): AgentAction {
    return {
      ...partial,
      id: `action_${++this.actionCounter}_${Date.now()}`,
      timestamp: Date.now(),
    };
  }

  /**
   * Stateless tick — called by the client-driven polling endpoint or heartbeat.
   * Picks one agent from the rotation and one random market, runs forecast.
   * Returns the actions generated during this tick.
   */
  async singleTick(): Promise<AgentAction[]> {
    await ensureAgentSpawnerHydrated();
    this.tickCount++;
    this.lastTickAt = Date.now();
    void setPersistedLoopRuntime({
      tickCount: this.tickCount,
      lastTickAt: this.lastTickAt,
      intervalMs: this.intervalMs,
      updatedAt: Date.now(),
    }).catch(() => {
      // Best-effort runtime snapshot.
    });
    const tickActions: AgentAction[] = [];

    const origEmit = this.emit.bind(this);
    const captureEmit = (action: AgentAction) => {
      tickActions.push(action);
      origEmit(action);
    };

    if (!isAgentConfigured()) {
      const errAction = this.createAction({
        agentId: "system",
        agentName: "System",
        type: "error",
        detail: "Agent account not configured — autonomous actions disabled",
      });
      captureEmit(errAction);
      return tickActions;
    }

    // ── Phase B: Survival check ──────────────────────────────────────────
    const survival = await getSurvivalState(this.tickCount);
    this.lastSurvival = survival;

    if (survival.tier === "thriving") {
      this.thrivingTickCount++;
    } else {
      this.thrivingTickCount = 0;
    }

    // Emit survival status every 5 ticks
    if (this.tickCount % 5 === 0) {
      captureEmit(this.createAction({
        agentId: "survival",
        agentName: "Survival Engine",
        type: "research",
        detail: `Tier: ${survival.tier} | ${survival.balanceStrk.toFixed(1)} STRK | model: ${getModelForTier(survival.tier)}`,
      }));
    }

    // Update soul with survival state
    updateSoul({
      tier: survival.tier,
      balanceStrk: survival.balanceStrk,
      model: getModelForTier(survival.tier),
      tickCount: this.tickCount,
    });

    if (survival.tier === "dead") {
      captureEmit(this.createAction({
        agentId: "survival",
        agentName: "Survival Engine",
        type: "error",
        detail: `DEAD — balance ${survival.balanceStrk.toFixed(2)} STRK. Halting all execution.`,
      }));
      return tickActions;
    }
    // ── End Phase B ──────────────────────────────────────────────────────

    let markets: MarketState[];
    try {
      markets = await getMarkets();
    } catch {
      const errAction = this.createAction({
        agentId: "system",
        agentName: "System",
        type: "error",
        detail: "Failed to fetch markets",
      });
      captureEmit(errAction);
      return tickActions;
    }

    const nowSec = Math.floor(Date.now() / 1000);

    await this.runPendingResolutions(captureEmit, markets, nowSec);

    const openMarkets = markets.filter(
      (m) => m.status === 0 && m.resolutionTime > nowSec
    );

    // Every N ticks, or whenever no active markets remain, attempt market creation.
    const shouldCreate =
      openMarkets.length === 0 ||
      this.tickCount % this.marketCreationInterval === 0;
    if (shouldCreate) {
      const created = await this.runMarketCreation(captureEmit, markets);
      if (created) return tickActions;
    }

    // Periodic DeFi pulse (optional)
    const shouldRunDefi = this.tickCount % this.defiInterval === 0;
    if (shouldRunDefi) {
      await this.runDefiPulse(captureEmit, survival);
    }

    // Phase G: Child replication trigger (only when thriving for 3+ consecutive ticks)
    if (
      config.childAgentEnabled &&
      survival.replicationEligible &&
      this.thrivingTickCount >= 3 &&
      this.tickCount % config.childAgentReplicateEvery === 0 &&
      agentSpawner.list().filter((a) => !a.isBuiltIn).length < config.childAgentMax
    ) {
      await this.runChildSpawn(survival, captureEmit);
    }

    await this.runChildServerHeartbeats(captureEmit);

    if (openMarkets.length === 0) return tickActions;

    // Pick the next actor in round-robin (built-in + eligible spawned agents).
    // Runtime-backed children default to self-scheduling on their dedicated machines,
    // so parent rotation skips them unless explicitly marked parent-scheduled.
    const parentEligibleSpawned = agentSpawner
      .list()
      .filter((agent) => {
        if (agent.status !== "running") return false;
        const runtime = agent.runtime;
        if (!runtime) return true;
        const runtimeActive =
          runtime.status === "running" || runtime.status === "starting";
        if (!runtimeActive) return true;
        return runtime.schedulerMode === "parent";
      });
    const tickActors = buildTickAgentActors(AGENT_PERSONAS, parentEligibleSpawned);
    const selected = selectTickAgentActor(tickActors, this.agentRotationIndex);
    if (!selected) {
      captureEmit(
        this.createAction({
          agentId: "system",
          agentName: "System",
          type: "error",
          detail: "No active agents available for autonomous tick",
        })
      );
      return tickActions;
    }
    this.agentRotationIndex = selected.nextIndex;

    // Pick a high-impact market with light randomness so agents stay diverse
    // without drifting into low-engagement loops.
    const rankedMarkets = openMarkets
      .map((market) => {
        const question = resolveMarketQuestion(market.id, market.questionHash);
        const engagement = estimateEngagementScore(
          question,
          market.resolutionTime
        );
        const poolStrk = Number(market.totalPool / 10n ** 18n);
        const poolBoost = Number.isFinite(poolStrk)
          ? Math.min(0.2, Math.log10(Math.max(1, poolStrk + 1)) / 10)
          : 0;
        const parityBoost = 1 - Math.min(1, Math.abs(market.impliedProbYes - 0.5) * 2);
        const score = engagement + poolBoost + parityBoost * 0.12;
        return { market, score };
      })
      .sort((a, b) => b.score - a.score);
    const topBand = rankedMarkets.slice(0, Math.min(4, rankedMarkets.length));
    const target =
      topBand[Math.floor(Math.random() * topBand.length)]?.market ??
      openMarkets[Math.floor(Math.random() * openMarkets.length)];

    await this.runAgentOnMarketWithEmit(
      selected.actor.persona,
      target,
      selected.actor.spawned,
      captureEmit,
      survival
    );

    return tickActions;
  }

  /** Legacy full tick — runs all agents on all markets */
  private async tick() {
    await ensureAgentSpawnerHydrated();
    this.tickCount++;
    this.lastTickAt = Date.now();
    void setPersistedLoopRuntime({
      tickCount: this.tickCount,
      lastTickAt: this.lastTickAt,
      intervalMs: this.intervalMs,
      updatedAt: Date.now(),
    }).catch(() => {
      // Best-effort runtime snapshot.
    });

    if (!isAgentConfigured()) {
      this.emit(
        this.createAction({
          agentId: "system",
          agentName: "System",
          type: "error",
          detail: "Agent account not configured — autonomous actions disabled",
        })
      );
      return;
    }

    let markets: MarketState[];
    try {
      markets = await getMarkets();
    } catch {
      this.emit(
        this.createAction({
          agentId: "system",
          agentName: "System",
          type: "error",
          detail: "Failed to fetch markets",
        })
      );
      return;
    }

    const nowSec = Math.floor(Date.now() / 1000);

    await this.runPendingResolutions(this.emit.bind(this), markets, nowSec);

    const openMarkets = markets.filter(
      (m) => m.status === 0 && m.resolutionTime > nowSec
    );

    if (this.tickCount % this.defiInterval === 0) {
      await this.runDefiPulse(this.emit.bind(this), this.lastSurvival ?? undefined);
    }

    if (openMarkets.length === 0) return;

    // Run built-in personas
    for (const persona of AGENT_PERSONAS) {
      const target = openMarkets[Math.floor(Math.random() * openMarkets.length)];
      await this.runAgentOnMarket(persona, target);
    }

    // Run spawned agents
    const spawnedAgents = agentSpawner.list().filter((a) => a.status === "running");
    for (const spawned of spawnedAgents) {
      const target = openMarkets[Math.floor(Math.random() * openMarkets.length)];
      await this.runAgentOnMarket(spawned.persona, target, spawned);
    }
  }

  private async runAgentOnMarket(
    persona: AgentPersona,
    target: MarketState,
    spawned?: SpawnedAgent
  ) {
    await this.runAgentOnMarketWithEmit(persona, target, spawned, this.emit.bind(this), this.lastSurvival ?? undefined);
  }

  private async runAgentOnMarketWithEmit(
    persona: AgentPersona,
    target: MarketState,
    spawned: SpawnedAgent | undefined,
    emit: (action: AgentAction) => void,
    survival?: SurvivalState
  ) {
    const agentId = spawned?.id ?? persona.id;
    const agentName = spawned?.name ?? persona.name;
    let execAccount = spawned?.account;
    if (spawned && !execAccount && spawned.walletAddress) {
      try {
        execAccount = (await hydrateAgentAccount(spawned)) ?? undefined;
        if (execAccount) {
          spawned.account = execAccount;
        }
      } catch {
        execAccount = undefined;
      }
    }
    const onChain = Boolean(execAccount) || isAgentConfigured();

    const question = resolveMarketQuestion(target.id, target.questionHash);

    // Auto-add ESPN source for Super Bowl related markets
    const sources = [...(persona.preferredSources ?? ["polymarket", "coingecko", "news", "social"])];
    if (SUPER_BOWL_REGEX.test(question) && !sources.includes("espn")) {
      sources.push("espn");
    }

    // Research phase
    emit(
      this.createAction({
        agentId,
        agentName,
        type: "research",
        marketId: target.id,
        question,
        detail: `Researching "${question}" using ${sources.join(", ")}`,
        sourcesUsed: sources,
      })
    );

    // Generate forecast
    let probability: number;
    let modelProbability: number | null = null;
    let reasoning: string = "";
    let researchCoverage = {
      requestedSources: sources.length,
      nonEmptySources: 0,
      totalDataPoints: 0,
      emptySourceNames: [] as string[],
      populatedSourceNames: [] as string[],
    };
    let consensusPeerCount = 0;
    let consensusDelta = 0;
    let consensusPeerWeightTotal = 0;
    let consensusApplied = false;
    let consensusGuardrailReason: ConsensusGuardrailReason | null = null;
    let consensusLeadProbability: number | null = null;
    let consensusMinPeersUsed = config.agentConsensusMinPeers;
    let consensusMinPeerPredictionCountUsed =
      config.agentConsensusMinPeerPredictions;
    let consensusMinTotalPeerWeightUsed =
      config.agentConsensusMinTotalPeerWeight;
    let consensusMaxShiftUsed = config.agentConsensusMaxShift;
    let consensusAutotuneMeta: AgentActionConsensusMeta["autotune"] = {
      enabled: false,
      sampleCount: 0,
      drift: 0,
      normalizedDrift: 0,
      reason: "disabled",
    };
    let marketPeerPredictions = [] as Awaited<ReturnType<typeof getAgentPredictions>>;
    const toolEvidence: ToolEvidence[] = [];
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        emit(
          this.createAction({
            agentId,
            agentName,
            type: "error",
            marketId: target.id,
            question,
            detail: "Anthropic API key not configured — forecasting disabled",
          })
        );
        return;
      }

      if (config.agentConsensusEnabled) {
        try {
          marketPeerPredictions = await getAgentPredictions(target.id);
        } catch {
          marketPeerPredictions = [];
        }
      }

      const context: MarketContext = {
        currentMarketProb: target.impliedProbYes,
        totalPool: (target.totalPool / 10n ** 18n).toString(),
        timeUntilResolution: `${Math.max(0, Math.floor((target.resolutionTime - Date.now() / 1000) / 86400))} days`,
        systemPrompt: persona.systemPrompt,
        model: survival ? getModelForTier(survival.tier) : persona.model,
        agentPredictions: marketPeerPredictions
          .slice(0, Math.max(0, config.agentConsensusMaxPeers))
          .map((p) => ({
            agent: p.agent.slice(0, 10),
            prob: p.predictedProb,
            brier: p.brierScore,
          })),
      };

      const gen = researchAndForecast(persona, question, context);
      const forecastStartedAt = Date.now();
      let result: any;
      while (true) {
        const elapsedMs = Date.now() - forecastStartedAt;
        const remainingMs = config.agentResearchTotalTimeoutMs - elapsedMs;
        if (remainingMs <= 0) {
          throw new Error(
            `Research timed out after ${config.agentResearchTotalTimeoutMs}ms`
          );
        }

        const stepTimeoutMs = Math.max(
          1_000,
          Math.min(config.agentResearchStepTimeoutMs, remainingMs)
        );

        const { value, done } = await withTimeout(
          gen.next(),
          stepTimeoutMs,
          `Research step timed out after ${stepTimeoutMs}ms`
        );
        if (done) {
          result = value;
          break;
        }
        const event = value as ResearchEvent;
        if (event.type === "research_complete" && event.results) {
          researchCoverage = assessResearchCoverage(event.results);
          emit(
            this.createAction({
              agentId,
              agentName,
              type: "research",
              marketId: target.id,
              question,
              detail:
                `Research evidence: ${researchCoverage.nonEmptySources}/${researchCoverage.requestedSources} ` +
                `sources produced ${researchCoverage.totalDataPoints} data points.`,
              sourcesUsed: sources,
            })
          );
        } else if (event.type === "tool_call" && event.toolName) {
          emit(
            this.createAction({
              agentId,
              agentName,
              type: "research",
              marketId: target.id,
              question,
              detail: `Tool call: ${event.toolName}`,
              sourcesUsed: sources,
            })
          );
        } else if (event.type === "tool_result" && event.toolName) {
          const source = event.source ?? event.toolName;
          const dataPoints = Math.max(
            0,
            typeof event.dataPoints === "number" ? event.dataPoints : 0
          );

          toolEvidence.push({
            source,
            dataPoints,
            isError: event.isError,
          });

          if (event.isError) {
            emit(
              this.createAction({
                agentId,
                agentName,
                type: "error",
                marketId: target.id,
                question,
                detail: `Tool ${event.toolName} failed during forecast.`,
              })
            );
          } else {
            emit(
              this.createAction({
                agentId,
                agentName,
                type: "research",
                marketId: target.id,
                question,
                detail: `Tool ${event.toolName} returned ${dataPoints} data points.`,
                sourcesUsed: sources,
              })
            );
          }
        }
      }
      researchCoverage = mergeResearchCoverage(researchCoverage, toolEvidence);
      emit(
        this.createAction({
          agentId,
          agentName,
          type: "research",
          marketId: target.id,
          question,
          detail:
            `Final evidence: ${researchCoverage.nonEmptySources}/${researchCoverage.requestedSources} ` +
            `sources, ${researchCoverage.totalDataPoints} data points.`,
          sourcesUsed: sources,
        })
      );
      probability = result?.probability;
      reasoning = result?.reasoning ?? "";
      if (typeof probability !== "number") {
        throw new Error("Forecast missing probability");
      }
      modelProbability = probability;

      if (config.agentConsensusEnabled) {
        const selfAddress = spawned?.walletAddress ?? config.AGENT_ADDRESS;
        const leadStats = await getAgentBrierStats(selfAddress ?? "");
        const autotune = deriveConsensusAutotuneProfile({
          agentKey: selfAddress ?? agentId,
          leadBrierScore: leadStats?.brierScore,
          baseMinPeers: config.agentConsensusMinPeers,
          baseMinPeerPredictionCount: config.agentConsensusMinPeerPredictions,
          baseMinTotalPeerWeight: config.agentConsensusMinTotalPeerWeight,
          baseMaxShift: config.agentConsensusMaxShift,
        });
        consensusMinPeersUsed = autotune.minPeers;
        consensusMinPeerPredictionCountUsed = autotune.minPeerPredictionCount;
        consensusMinTotalPeerWeightUsed = autotune.minTotalPeerWeight;
        consensusMaxShiftUsed = autotune.maxShift;
        consensusAutotuneMeta = {
          enabled: autotune.enabled,
          sampleCount: autotune.sampleCount,
          drift: autotune.drift,
          normalizedDrift: autotune.normalizedDrift,
          reason: autotune.reason,
        };
        const consensus = computeBrierWeightedConsensus({
          leadAgent: agentId,
          leadProbability: probability,
          leadBrierScore: leadStats?.brierScore,
          leadPredictionCount: leadStats?.predictionCount,
          peerPredictions: marketPeerPredictions,
          selfAddress,
          maxPeers: config.agentConsensusMaxPeers,
          minPeers: autotune.minPeers,
          minPeerPredictionCount: autotune.minPeerPredictionCount,
          minTotalPeerWeight: autotune.minTotalPeerWeight,
          maxShift: autotune.maxShift,
          brierFloor: config.agentConsensusBrierFloor,
          leadWeightMultiplier: config.agentConsensusLeadWeight,
        });

        consensusPeerCount = consensus.usedPeerCount;
        consensusDelta = consensus.deltaFromLead;
        consensusPeerWeightTotal = consensus.peerWeightTotal;
        consensusApplied = consensus.applied;
        consensusGuardrailReason = consensus.guardrailReason ?? null;
        consensusLeadProbability = consensus.leadProbability;
        probability = consensus.probability;

        if (consensus.usedPeerCount > 0) {
          const topPeers = consensus.entries
            .filter((e) => e.role === "peer")
            .slice(0, 3)
            .map((e) => `${e.agent.slice(0, 10)}… w=${e.weight.toFixed(1)}`)
            .join(", ");

          emit(
            this.createAction({
              agentId,
              agentName,
              type: "research",
              marketId: target.id,
              question,
              detail: consensus.applied
                ? `Consensus blend: model ${(consensus.leadProbability * 100).toFixed(1)}% ` +
                  `→ weighted ${(consensus.probability * 100).toFixed(1)}% ` +
                  `using ${consensus.usedPeerCount} peer agents by Brier ` +
                  `(peer weight ${consensus.peerWeightTotal.toFixed(1)})` +
                  `${consensus.guardrailReason === "delta_clamped" ? ", shift clamped" : ""}. ` +
                  `Guardrails p>=${consensusMinPeersUsed}, ` +
                  `preds>=${consensusMinPeerPredictionCountUsed}, ` +
                  `w>=${consensusMinTotalPeerWeightUsed.toFixed(1)}, ` +
                  `shift<=${(consensusMaxShiftUsed * 100).toFixed(1)}pp.`
                : `Consensus guardrail held lead estimate ${(consensus.leadProbability * 100).toFixed(1)}% ` +
                  `(${consensus.guardrailReason ?? "unknown"}) using ${consensus.usedPeerCount} peers ` +
                  `(peer weight ${consensus.peerWeightTotal.toFixed(1)}). ` +
                  `Guardrails p>=${consensusMinPeersUsed}, ` +
                  `preds>=${consensusMinPeerPredictionCountUsed}, ` +
                  `w>=${consensusMinTotalPeerWeightUsed.toFixed(1)}, ` +
                  `shift<=${(consensusMaxShiftUsed * 100).toFixed(1)}pp.`,
              sourcesUsed: topPeers ? [...sources, `consensus:${topPeers}`] : sources,
              consensusMeta: {
                enabled: true,
                applied: consensus.applied,
                guardrailReason: consensus.guardrailReason ?? null,
                leadProbability: consensus.leadProbability,
                finalProbability: consensus.probability,
                deltaFromLead: consensus.deltaFromLead,
                peerCount: consensus.usedPeerCount,
                peerWeightTotal: consensus.peerWeightTotal,
                minPeersUsed: consensusMinPeersUsed,
                minPeerPredictionCountUsed:
                  consensusMinPeerPredictionCountUsed,
                minTotalPeerWeightUsed: consensusMinTotalPeerWeightUsed,
                maxShiftUsed: consensusMaxShiftUsed,
                autotune: consensusAutotuneMeta,
              },
            })
          );
        }
      }
    } catch (err: any) {
      const errMessage = err?.message ?? "unknown error";
      const canFallback =
        /timed out|missing probability|tool/i.test(errMessage) ||
        researchCoverage.totalDataPoints > 0;

      if (!canFallback) {
        emit(
          this.createAction({
            agentId,
            agentName,
            type: "error",
            marketId: target.id,
            question,
            detail: `Forecast failed: ${errMessage}`,
          })
        );
        return;
      }

      const peerMean =
        marketPeerPredictions.length > 0
          ? marketPeerPredictions.reduce((sum, p) => sum + p.predictedProb, 0) /
            marketPeerPredictions.length
          : target.impliedProbYes;
      const fallbackProbability = Math.max(
        0.05,
        Math.min(0.95, target.impliedProbYes * 0.65 + peerMean * 0.35)
      );

      probability = fallbackProbability;
      modelProbability = fallbackProbability;
      reasoning =
        `Fallback forecast used after model/tool failure: ${errMessage}. ` +
        `Anchored to market prior ${(target.impliedProbYes * 100).toFixed(1)}% and peer mean ${(peerMean * 100).toFixed(1)}%.`;

      emit(
        this.createAction({
          agentId,
          agentName,
          type: "research",
          marketId: target.id,
          question,
          detail:
            `Forecast fallback applied at ${(fallbackProbability * 100).toFixed(1)}% YES ` +
            `(${errMessage}).`,
          sourcesUsed: sources,
        })
      );
    }

    // Phase E: Update soul with thesis snippet
    if (reasoning) {
      updateSoul({ currentThesis: reasoning.replace(/\s+/g, " ").trim().slice(0, 200) });
    }
    incrementSoulPredictions();

    // Phase D: use child signer account when available

    // Record prediction and log Huginn thought concurrently (both non-blocking).
    // logThoughtOnChain() never throws — it guards internally and returns status.
    // recordPrediction() is only attempted when onChain; otherwise resolves null.
    const [predSettled, huginnSettled] = await Promise.allSettled([
      onChain ? recordPrediction(target.id, probability, execAccount) : Promise.resolve(null),
      logThoughtOnChain(reasoning),
    ]);

    const predTxResult =
      predSettled.status === "fulfilled" ? predSettled.value : null;
    const huginnResult =
      huginnSettled.status === "fulfilled" ? huginnSettled.value : null;

    /** Starknet tx hash of the AccuracyTracker record_prediction() call. */
    const predictionTxHash =
      predTxResult?.status === "success" ? predTxResult.txHash : undefined;
    /** Starknet tx hash of the Huginn Registry log_thought() call. Present only on success. */
    const huginnTxHash =
      huginnResult?.status === "success" ? huginnResult.txHash : undefined;
    /** SHA-256 hash of the reasoning text. Present whenever Huginn ran (skip or success). */
    const reasoningHash = huginnResult?.thoughtHash || undefined;

    const reasoningSnippet = reasoning
      ? reasoning.replace(/\s+/g, " ").trim().slice(0, 140)
      : undefined;

    // Append Huginn provenance to the detail string when available
    const huginnSuffix = huginnTxHash
      ? ` → Huginn: ${huginnTxHash.slice(0, 14)}...`
      : huginnResult?.status === "error"
      ? ` → Huginn: err(${(huginnResult.error ?? "").slice(0, 30)})`
      : "";

    const predictionConsensusMeta =
      config.agentConsensusEnabled && modelProbability !== null
        ? {
            enabled: true,
            applied: consensusApplied,
            guardrailReason: consensusGuardrailReason,
            leadProbability: consensusLeadProbability ?? modelProbability,
            finalProbability: probability,
            deltaFromLead: consensusDelta,
            peerCount: consensusPeerCount,
            peerWeightTotal: consensusPeerWeightTotal,
            minPeersUsed: consensusMinPeersUsed,
            minPeerPredictionCountUsed: consensusMinPeerPredictionCountUsed,
            minTotalPeerWeightUsed: consensusMinTotalPeerWeightUsed,
            maxShiftUsed: consensusMaxShiftUsed,
            autotune: consensusAutotuneMeta,
          }
        : undefined;

    const consensusSuffix =
      config.agentConsensusEnabled && modelProbability !== null
        ? consensusApplied
          ? ` [model ${Math.round(modelProbability * 100)}% → consensus ${Math.round(
              probability * 100
            )}% (${consensusPeerCount} peers, w=${consensusPeerWeightTotal.toFixed(1)}, ` +
            `Δ ${(consensusDelta * 100).toFixed(1)}pp` +
            `${consensusGuardrailReason === "delta_clamped" ? ", clamped" : ""})]`
          : ` [consensus held lead by guardrail` +
            `${consensusGuardrailReason ? `:${consensusGuardrailReason}` : ""}` +
            ` (${consensusPeerCount} peers, w=${consensusPeerWeightTotal.toFixed(1)})]`
        : "";

    if (predictionTxHash) {
      emit(
        this.createAction({
          agentId,
          agentName,
          type: "prediction",
          marketId: target.id,
          question,
          probability,
          detail:
            `Predicted ${Math.round(probability * 100)}% YES on "${question}"` +
            `${consensusSuffix} [tx: ${predictionTxHash.slice(0, 16)}...]${huginnSuffix}`,
          txHash: predictionTxHash,
          huginnTxHash,
          reasoningHash,
          reasoning: reasoningSnippet,
          consensusMeta: predictionConsensusMeta,
        })
      );
    } else {
      emit(
        this.createAction({
          agentId,
          agentName,
          type: "error",
          marketId: target.id,
          question,
          detail: onChain
            ? "Prediction not recorded on-chain"
            : "Agent account not configured",
        })
      );
    }

    await this.maybeRunDebate(
      {
        lead: persona,
        question,
        probability,
        reasoning: reasoningSnippet ?? "",
        marketId: target.id,
      },
      emit
    );

    // Decide whether to bet
    const confidence = Math.abs(probability - 0.5) * 2;
    const threshold = parseNumber(config.AGENT_BET_CONFIDENCE_THRESHOLD, 0.15);
    const confidenceGate = confidence > threshold;
    const researchGate = checkResearchGate(
      researchCoverage,
      config.agentMinEvidenceSources,
      config.agentMinEvidencePoints
    );
    const shouldBet = confidenceGate && researchGate.ok;

    if (confidenceGate && !researchGate.ok) {
      emit(
        this.createAction({
          agentId,
          agentName,
          type: "error",
          marketId: target.id,
          question,
          detail:
            `Bet skipped: ${researchGate.reason}. ` +
            `Need >=${config.agentMinEvidenceSources} sources and >=${config.agentMinEvidencePoints} data points.`,
        })
      );
    }

    if (shouldBet) {
      const survivalMultiplier = survival ? getBetMultiplier(survival.tier) : 1.0;
      const betAmount = computeBetAmount(confidence, spawned?.budget, survivalMultiplier);
      if (betAmount > 0n) {
        const outcome = probability > 0.5 ? "YES" : "NO";
        const betDisplay = formatStrk(betAmount);

        let betTxHash: string | undefined;
        if (onChain) {
          try {
            const outcomeNum: 0 | 1 = probability > 0.5 ? 1 : 0;
            const txResult = await placeBet(
              target.address,
              outcomeNum,
              betAmount,
              config.COLLATERAL_TOKEN_ADDRESS,
              execAccount
            );
            if (txResult.status === "success") {
              betTxHash = txResult.txHash;
            }
          } catch {
            // Bet tx failed
          }
        }

        if (betTxHash) {
          emit(
            this.createAction({
              agentId,
              agentName,
              type: "bet",
              marketId: target.id,
              question,
              probability,
              betAmount: betDisplay,
              betOutcome: outcome,
              detail: `Bet ${betDisplay} on ${outcome} for "${question}" (confidence: ${(confidence * 100).toFixed(0)}%) [tx: ${betTxHash.slice(0, 16)}...]`,
              txHash: betTxHash,
            })
          );
          if (spawned) {
            spawned.budget.spent += betAmount;
            spawned.stats.bets++;
          }
          // Phase E: update soul bet counter
          incrementSoulBets();
        } else {
          emit(
            this.createAction({
              agentId,
              agentName,
              type: "error",
              marketId: target.id,
              question,
              detail: "Bet not executed on-chain",
            })
          );
        }
      }
    }

    if (spawned && predictionTxHash) {
      spawned.stats.predictions++;
    }
  }

  private async runMarketCreation(
    emit: (action: AgentAction) => void,
    existingMarkets?: MarketState[]
  ): Promise<boolean> {
    if (!isAgentConfigured() || config.MARKET_FACTORY_ADDRESS === "0x0") {
      return false;
    }

    let suggestedCategory: string | undefined;
    const openCategoryCounts = {
      sports: 0,
      crypto: 0,
      politics: 0,
      tech: 0,
      other: 0,
    };
    const openMarkets = (existingMarkets ?? []).filter(
      (market) => market.status === 0 && market.resolutionTime > Math.floor(Date.now() / 1000)
    );
    for (const market of openMarkets) {
      const question = resolveMarketQuestion(market.id, market.questionHash);
      const category = categorizeMarket(question);
      if (category !== "all") {
        openCategoryCounts[category] =
          (openCategoryCounts[category] ?? 0) + 1;
      }
    }

    const openTotal = Math.max(
      1,
      openCategoryCounts.sports +
        openCategoryCounts.crypto +
        openCategoryCounts.politics +
        openCategoryCounts.tech +
        openCategoryCounts.other
    );
    const cryptoShare = openCategoryCounts.crypto / openTotal;

    try {
      const sources: DataSourceName[] = ["news", "social", "coingecko", "github", "rss"];
      const research = await gatherResearch("trending markets", sources);
      const combined = research
        .map((r) => `${r.summary} ${r.data.map((d) => d.label).join(" ")}`)
        .join(" ");
      const cat = categorizeMarket(combined);
      if (cat !== "other" && cat !== "all") {
        suggestedCategory = cat;
      }
    } catch {
      // Research failed, proceed without category bias
    }

    const categoryFloorOrder: Array<
      "politics" | "sports" | "tech" | "other" | "crypto"
    > = ["politics", "sports", "tech", "other", "crypto"];
    const categoryPriority = new Map(
      categoryFloorOrder.map((category, index) => [category, index] as const)
    );
    const leastRepresented = [...categoryFloorOrder].sort((a, b) => {
      const aCount = openCategoryCounts[a] ?? 0;
      const bCount = openCategoryCounts[b] ?? 0;
      if (aCount === bCount) {
        return (categoryPriority.get(a) ?? 0) - (categoryPriority.get(b) ?? 0);
      }
      return aCount - bCount;
    })[0];

    if (!suggestedCategory || (suggestedCategory === "crypto" && cryptoShare >= 0.45)) {
      suggestedCategory = leastRepresented;
    }

    const suggestions = await discoverMarkets(suggestedCategory, 10);
    if (suggestions.length === 0) return false;

    const existingQuestionFingerprints = new Set(
      Object.values(MARKET_QUESTIONS).map((q) => questionFingerprint(q))
    );
    if (existingMarkets) {
      for (const market of existingMarkets) {
        const resolved = resolveMarketQuestion(market.id, market.questionHash);
        existingQuestionFingerprints.add(questionFingerprint(resolved));
      }
    }
    const rankedSuggestions = suggestions
      .map((suggestion) => {
        const resolutionTime =
          Math.floor(Date.now() / 1000) +
          Math.max(1, suggestion.suggestedResolutionDays ?? 30) * 86_400;
        const engagement = estimateEngagementScore(
          suggestion.question,
          resolutionTime
        );
        const categoryPenalty =
          suggestion.category === "crypto" && cryptoShare >= 0.45 ? -0.12 : 0;
        return {
          suggestion,
          score: engagement + categoryPenalty,
        };
      })
      .sort((a, b) => b.score - a.score);

    const picked =
      rankedSuggestions
        .map((entry) => entry.suggestion)
        .find(
          (s) =>
            !existingQuestionFingerprints.has(questionFingerprint(s.question))
        ) ??
      rankedSuggestions[0]?.suggestion ??
      suggestions[0];

    const questionRaw = picked.question;
    const durationDays = picked.suggestedResolutionDays ?? 30;
    const onChainQuestion = toOnChainQuestion(questionRaw, durationDays);

    const result = await createMarket(
      onChainQuestion,
      durationDays,
      200,
      config.AGENT_ADDRESS
    );

    if (result.status !== "success") {
      return false;
    }

    if (result.marketId !== undefined) {
      registerQuestion(result.marketId, questionRaw);
    }

    let detail = `Created new market: "${questionRaw}"`;
    if (result.allowlistTxHash) {
      detail += " (allowlist updated)";
    } else if (result.allowlistError) {
      detail += ` (allowlist failed: ${result.allowlistError})`;
    }

    emit(
      this.createAction({
        agentId: "agent-loop",
        agentName: "Agent Loop",
        type: "market_creation",
        marketId: result.marketId,
        question: questionRaw,
        detail,
        txHash: result.txHash,
      })
    );

    return true;
  }

  private async runPendingResolutions(
    emit: (action: AgentAction) => void,
    markets: MarketState[],
    nowSec = Math.floor(Date.now() / 1000)
  ): Promise<void> {
    if (!config.agentAutoResolveEnabled) return;
    if (this.tickCount % config.agentAutoResolveEvery !== 0) return;

    const pending = markets
      .filter((m) => m.status === 0 && m.resolutionTime <= nowSec)
      .sort((a, b) => a.resolutionTime - b.resolutionTime);
    if (pending.length === 0) return;

    const nowMs = Date.now();
    const cooldownMs = config.agentAutoResolveCooldownSecs * 1000;
    const maxToResolve = Math.max(
      1,
      Math.min(config.agentAutoResolveMaxPerTick, pending.length)
    );

    let attempts = 0;
    for (const market of pending) {
      if (attempts >= maxToResolve) break;

      const lastAttempt = this.lastResolutionAttemptAt.get(market.id) ?? 0;
      if (cooldownMs > 0 && nowMs - lastAttempt < cooldownMs) {
        continue;
      }
      this.lastResolutionAttemptAt.set(market.id, nowMs);
      attempts++;

      const question = resolveMarketQuestion(market.id, market.questionHash);
      emit(
        this.createAction({
          agentId: "resolution-oracle",
          agentName: "Resolution Oracle",
          type: "research",
          marketId: market.id,
          question,
          detail: `Resolution sweep checking "${question}".`,
        })
      );

      let result: Awaited<ReturnType<typeof tryResolveMarket>>;
      try {
        result = await withTimeout(
          tryResolveMarket(market.id, market.address, question),
          8_000,
          "Resolution timed out"
        );
      } catch (err: any) {
        result = {
          status: "error",
          error: err?.message ?? "Resolution timed out",
        };
      }

      if (result.status === "resolved" && typeof result.outcome === "number") {
        const outcomeLabel: "YES" | "NO" = result.outcome === 1 ? "YES" : "NO";
        const confidenceText =
          typeof result.confidence === "number"
            ? ` (${(result.confidence * 100).toFixed(0)}%)`
            : "";
        const txHash = result.finalizeTxHash ?? result.resolveTxHash;

        emit(
          this.createAction({
            agentId: "resolution-oracle",
            agentName: "Resolution Oracle",
            type: "resolution",
            marketId: market.id,
            question,
            detail:
              `Resolved "${question}" as ${outcomeLabel}${confidenceText}.` +
              (txHash ? ` [tx: ${txHash.slice(0, 16)}...]` : "") +
              (result.error ? ` (${result.error})` : ""),
            txHash,
            resolutionOutcome: outcomeLabel,
          })
        );
        continue;
      }

      if (result.status === "insufficient_evidence") {
        emit(
          this.createAction({
            agentId: "resolution-oracle",
            agentName: "Resolution Oracle",
            type: "research",
            marketId: market.id,
            question,
            detail: `Resolution skipped for "${question}" — insufficient evidence.`,
          })
        );
        continue;
      }

      emit(
        this.createAction({
          agentId: "resolution-oracle",
          agentName: "Resolution Oracle",
          type: "error",
          marketId: market.id,
          question,
          detail: `Resolution failed for "${question}": ${result.error ?? "unknown error"}`,
        })
      );
    }
  }

  private async runDefiPulse(emit: (action: AgentAction) => void, survival?: SurvivalState): Promise<void> {
    if (config.AGENT_DEFI_ENABLED !== "true") return;
    if (!isAgentConfigured()) return;

    // Phase F: Compute reserve sweep when thriving
    if (config.computeReserveEnabled && survival?.tier === "thriving") {
      await this.runComputeSweep(survival, emit);
    }

    let change: number | null = null;
    try {
      const prices = await fetchCryptoPrices("ethereum");
      const ethPoint = prices.data.find((p) =>
        String(p.label).toLowerCase().includes("ethereum price")
      );
      if (ethPoint?.value) {
        const match = String(ethPoint.value).match(/\(([+-]?\d+(?:\.\d+)?)%\)/);
        if (match) {
          change = parseFloat(match[1]);
        }
      }
    } catch {
      // ignore
    }

    if (change === null || Number.isNaN(change)) {
      emit(
        this.createAction({
          agentId: "defi-pulse",
          agentName: "DeFi Pulse",
          type: "defi_signal",
          detail: "No ETH change data available for DeFi pulse.",
        })
      );
      return;
    }

    const threshold = parseNumber(config.AGENT_DEFI_SIGNAL_THRESHOLD, 2);
    const direction =
      change >= threshold ? "BUY" : change <= -threshold ? "SELL" : null;

    const pair = `${config.AGENT_DEFI_SELL_TOKEN}/${config.AGENT_DEFI_BUY_TOKEN}`;

    emit(
      this.createAction({
        agentId: "defi-pulse",
        agentName: "DeFi Pulse",
        type: "defi_signal",
        detail: `ETH 24h change ${change.toFixed(2)}%. Signal: ${direction ?? "HOLD"} for ${pair}.`,
        defiDirection: direction ?? undefined,
        defiPair: pair,
      })
    );

    if (!direction) return;
    if (config.AGENT_DEFI_AUTO_TRADE !== "true") return;

    const amountStrk = parseNumber(config.AGENT_DEFI_MAX_STRK, 10);
    if (amountStrk <= 0) return;

    const sellToken =
      direction === "BUY"
        ? config.AGENT_DEFI_SELL_TOKEN
        : config.AGENT_DEFI_BUY_TOKEN;
    const buyToken =
      direction === "BUY"
        ? config.AGENT_DEFI_BUY_TOKEN
        : config.AGENT_DEFI_SELL_TOKEN;

    const slippage = parseNumber(config.AGENT_DEFI_SLIPPAGE, 0.01);

    const swapResult = await executeAvnuSwap({
      sellToken,
      buyToken,
      amount: amountStrk,
      slippage,
    });

    if (swapResult.status === "success") {
      emit(
        this.createAction({
          agentId: "defi-pulse",
          agentName: "DeFi Pulse",
          type: "defi_swap",
          detail: `AVNU swap executed: ${amountStrk} ${sellToken} → ${buyToken} (slippage ${slippage}).`,
          defiDirection: direction,
          defiPair: `${sellToken}/${buyToken}`,
          defiAmount: `${amountStrk} ${sellToken}`,
          txHash: swapResult.txHash,
        })
      );
    } else {
      emit(
        this.createAction({
          agentId: "defi-pulse",
          agentName: "DeFi Pulse",
          type: "error",
          detail: `AVNU swap failed: ${swapResult.error ?? "unknown error"}`,
        })
      );
    }
  }

  private async maybeRunDebate(
    params: {
      lead: AgentPersona;
      question: string;
      probability: number;
      reasoning: string;
      marketId: number;
    },
    emit: (action: AgentAction) => void
  ) {
    if (config.AGENT_DEBATE_ENABLED !== "true") return;
    if (!params.reasoning) return;

    const interval = parseNumber(config.AGENT_DEBATE_INTERVAL, 3);
    if (interval <= 0) return;
    this.debateCounter += 1;
    if (this.debateCounter % interval !== 0) return;

    const challengers = AGENT_PERSONAS.filter((p) => p.id !== params.lead.id);
    if (challengers.length === 0) return;
    const challenger =
      challengers[Math.floor(Math.random() * challengers.length)];

    try {
      const debateText = await generateDebateExchange({
        question: params.question,
        leadAgent: params.lead.name,
        leadProbability: params.probability,
        leadReasoning: params.reasoning,
        challenger,
      });

      emit(
        this.createAction({
          agentId: challenger.id,
          agentName: challenger.name,
          type: "debate",
          marketId: params.marketId,
          question: params.question,
          detail: debateText,
          debateTarget: params.lead.name,
        })
      );
    } catch (err: any) {
      emit(
        this.createAction({
          agentId: "debate-engine",
          agentName: "Debate Engine",
          type: "error",
          detail: `Debate generation failed: ${err?.message ?? "unknown error"}`,
        })
      );
    }
  }

  // ── Phase F: Compute Reserve Sweep ────────────────────────────────────────

  private async runComputeSweep(
    survival: SurvivalState,
    emit: (action: AgentAction) => void
  ): Promise<void> {
    const hoursSinceLast = (Date.now() - getLastSweepAt()) / 3_600_000;
    if (hoursSinceLast < 24) return; // max once per 24h

    const thrivingWei = BigInt(
      Math.round(parseFloat(String((config as any).SURVIVAL_TIER_THRIVING ?? "1000")) * 1e18)
    );
    const surplus = Number(survival.balanceWei > thrivingWei ? survival.balanceWei - thrivingWei : 0n) / 1e18;
    const threshold = parseFloat(String((config as any).COMPUTE_RESERVE_THRESHOLD ?? "200"));
    if (surplus < threshold) return;

    const pct = parseFloat(String((config as any).COMPUTE_RESERVE_PERCENT ?? "20")) / 100;
    const sweepAmount = surplus * pct;

    const swapResult = await executeAvnuSwap({
      sellToken: "STRK",
      buyToken: "USDC",
      amount: sweepAmount,
      slippage: parseNumber(config.AGENT_DEFI_SLIPPAGE, 0.01),
    });

    if (swapResult.status === "success") {
      markSweepCompleted();
      emit(this.createAction({
        agentId: "compute-reserve",
        agentName: "Compute Reserve",
        type: "defi_swap",
        detail: `Swept ${sweepAmount.toFixed(2)} STRK → USDC (compute reserve). 24h cooldown.`,
        txHash: swapResult.txHash,
        defiDirection: "SELL",
        defiPair: "STRK/USDC",
        defiAmount: `${sweepAmount.toFixed(2)} STRK`,
      }));
    } else {
      emit(this.createAction({
        agentId: "compute-reserve",
        agentName: "Compute Reserve",
        type: "error",
        detail: `Compute reserve sweep failed: ${swapResult.error ?? "unknown"}`,
      }));
    }
  }

  // ── Phase G: Child Agent Replication ─────────────────────────────────────

  private async runChildSpawn(
    survival: SurvivalState,
    emit: (action: AgentAction) => void
  ): Promise<void> {
    if (!config.childAgentEnabled) return;

    const tag = Date.now().toString(36).toUpperCase().slice(-4);
    const name = `AlphaChild-${tag}`;

    emit(this.createAction({
      agentId: "replication",
      agentName: "Replication Engine",
      type: "market_creation",
      detail: `Spawning child agent "${name}"…`,
    }));

    const result = await deployChildAgent({
      name,
      model: "claude-sonnet-4-6",
      fundingStrk: config.childAgentFundStrk,
    });

    if (result.error || !result.agentAddress) {
      emit(this.createAction({
        agentId: "replication",
        agentName: "Replication Engine",
        type: "error",
        detail: `Child spawn failed: ${result.error}`,
      }));
      return;
    }

    // Register child in spawner with its own Account instance
    const provider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });
    const childBasePersona = AGENT_PERSONAS[0];
    const childAccount = new Account({
      provider,
      address: result.agentAddress,
      signer: result.privateKey,
    });

    const spawned = agentSpawner.spawn({
      name,
      customSystemPrompt: childBasePersona.systemPrompt,
      budgetStrk: config.childAgentFundStrk,
      maxBetStrk: 5,
    });
    spawned.walletAddress = result.agentAddress;
    spawned.privateKey = result.privateKey; // in-memory only
    spawned.account = childAccount;
    spawned.agentId = result.agentId;
    try {
      const storedKey = await storeAgentPrivateKey({
        agentId: spawned.id,
        walletAddress: result.agentAddress,
        privateKey: result.privateKey,
      });
      spawned.keyRef = storedKey.keyRef;
      spawned.keyCustodyProvider = storedKey.provider;
    } catch (err: any) {
      emit(
        this.createAction({
          agentId: "replication",
          agentName: "Replication Engine",
          type: "error",
          detail:
            `Child key custody store failed, using memory signer only: ` +
            `${err?.message ?? String(err)}`,
        })
      );
    }

    const runtimeProvision = await provisionChildServerRuntime(spawned);
    if (runtimeProvision.status === "success") {
      emit(this.createAction({
        agentId: "replication",
        agentName: "Replication Engine",
        type: "runtime",
        detail:
          `Provisioned child runtime machine ${runtimeProvision.runtime.machineId} ` +
          `(${runtimeProvision.runtime.tier}, ${runtimeProvision.runtime.status}` +
          `${runtimeProvision.runtime.region ? `, ${runtimeProvision.runtime.region}` : ""}).`,
        runtimeMeta: {
          event: "provisioned",
          machineId: runtimeProvision.runtime.machineId,
          region: runtimeProvision.runtime.region,
          failoverCount: runtimeProvision.runtime.failoverCount ?? 0,
        },
      }));
    } else if (runtimeProvision.status === "error") {
      emit(this.createAction({
        agentId: "replication",
        agentName: "Replication Engine",
        type: "error",
        detail: `Child server provisioning failed: ${runtimeProvision.error}`,
      }));
    }

    // Log lineage to Huginn
    await logThoughtOnChain(
      `Spawned child agent "${name}" at ${result.agentAddress}. ` +
      `ERC-8004 ID: #${result.agentId}. Parent: ${config.AGENT_ADDRESS ?? "unknown"}. ` +
      `Funding: ${config.childAgentFundStrk} STRK.`
    );

    emit(this.createAction({
      agentId: "replication",
      agentName: "Replication Engine",
      type: "market_creation",
      detail: `Spawned child: "${name}" → ${result.agentAddress} (ERC-8004 #${result.agentId})`,
      txHash: result.txHash,
    }));

    // Phase E: update soul children
    const current = getSoulChildren();
    updateSoul({ children: [...current, { id: result.agentAddress, name, tier: "healthy" }] });
    await persistAgentSpawner();
  }

  private async runChildServerHeartbeats(
    emit: (action: AgentAction) => void
  ): Promise<void> {
    const spawnedChildren = agentSpawner
      .list()
      .filter((agent) => !agent.isBuiltIn && agent.status === "running");
    let shouldPersist = false;
    for (const child of spawnedChildren) {
      const heartbeat = await heartbeatChildServerRuntime({
        agent: child,
        tickCount: this.tickCount,
      });

      if (heartbeat.status === "ok" && heartbeat.stateChanged) {
        shouldPersist = true;
        emit(
          this.createAction({
            agentId: child.id,
            agentName: child.name,
            type: "runtime",
            detail: `Child runtime ${heartbeat.machineId} is now running.`,
            runtimeMeta: {
              event: "heartbeat_recovered",
              machineId: heartbeat.machineId,
              region: child.runtime?.region,
              failoverCount: child.runtime?.failoverCount,
            },
          })
        );
      }

      if (heartbeat.status === "failed_over") {
        shouldPersist = true;
        emit(
          this.createAction({
            agentId: child.id,
            agentName: child.name,
            type: "runtime",
            detail:
              `Child runtime failover: ${heartbeat.previousMachineId}` +
              `${heartbeat.previousRegion ? ` (${heartbeat.previousRegion})` : ""}` +
              ` → ${heartbeat.machineId}` +
              `${heartbeat.region ? ` (${heartbeat.region})` : ""}. ` +
              `Reason: ${heartbeat.reason}`,
            runtimeMeta: {
              event: "failed_over",
              previousMachineId: heartbeat.previousMachineId,
              machineId: heartbeat.machineId,
              previousRegion: heartbeat.previousRegion,
              region: heartbeat.region,
              failoverCount: child.runtime?.failoverCount,
              reason: heartbeat.reason,
            },
          })
        );
      }

      if (heartbeat.status === "dead") {
        shouldPersist = true;
        emit(
          this.createAction({
            agentId: child.id,
            agentName: child.name,
            type: "error",
            detail:
              `Child runtime ${heartbeat.machineId} terminated: ${heartbeat.error}`,
            runtimeMeta: {
              event: "terminated",
              machineId: heartbeat.machineId,
              region: child.runtime?.region,
              failoverCount: child.runtime?.failoverCount,
              reason: heartbeat.error,
            },
          })
        );
      }

      if (heartbeat.status === "error") {
        shouldPersist = true;
        emit(
          this.createAction({
            agentId: child.id,
            agentName: child.name,
            type: "error",
            detail:
              `Child runtime heartbeat failed (${heartbeat.machineId}): ${heartbeat.error}`,
            runtimeMeta: {
              event: "heartbeat_error",
              machineId: heartbeat.machineId,
              region: child.runtime?.region,
              failoverCount: child.runtime?.failoverCount,
              reason: heartbeat.error,
            },
          })
        );
      }
    }
    if (shouldPersist) {
      await persistAgentSpawner();
    }
  }
}

/** Singleton agent loop instance */
export const agentLoop = new AgentLoop();
