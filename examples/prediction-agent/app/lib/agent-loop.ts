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

import { getMarkets, MARKET_QUESTIONS, SUPER_BOWL_REGEX, type MarketState, registerQuestion } from "./market-reader";
import {
  researchAndForecast,
  type MarketContext,
} from "./research-agent";
import { discoverMarkets } from "./market-discovery";
import { gatherResearch, type DataSourceName } from "./data-sources";
import { fetchCryptoPrices } from "./data-sources/crypto-prices";
import { categorizeMarket } from "./categories";
import {
  AGENT_PERSONAS,
  type AgentPersona,
} from "./agent-personas";
import { type AgentBudget, type SpawnedAgent, agentSpawner } from "./agent-spawner";
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

export interface AgentAction {
  id: string;
  timestamp: number;
  agentId: string;
  agentName: string;
  type:
    | "research"
    | "prediction"
    | "bet"
    | "discovery"
    | "error"
    | "debate"
    | "market_creation"
    | "defi_signal"
    | "defi_swap";
  marketId?: number;
  question?: string;
  detail: string;
  probability?: number;
  betAmount?: string;
  betOutcome?: "YES" | "NO";
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
    this.tickCount++;
    this.lastTickAt = Date.now();
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

    const openMarkets = markets.filter((m) => m.status === 0);

    // Every N ticks, attempt to create a new market instead of forecasting
    const shouldCreate = this.tickCount % this.marketCreationInterval === 0;
    if (shouldCreate) {
      const created = await this.runMarketCreation(captureEmit);
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

    if (openMarkets.length === 0) return tickActions;

    // Pick the next agent in round-robin from built-in personas
    const allPersonas = AGENT_PERSONAS;
    const persona = allPersonas[this.agentRotationIndex % allPersonas.length];
    this.agentRotationIndex++;

    // Pick a random market
    const target = openMarkets[Math.floor(Math.random() * openMarkets.length)];

    await this.runAgentOnMarketWithEmit(persona, target, undefined, captureEmit, survival);

    return tickActions;
  }

  /** Legacy full tick — runs all agents on all markets */
  private async tick() {
    this.tickCount++;
    this.lastTickAt = Date.now();

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

    const openMarkets = markets.filter((m) => m.status === 0);

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
    const onChain = isAgentConfigured();

    const question = MARKET_QUESTIONS[target.id] ?? `Market #${target.id}`;

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
    let reasoning: string = "";
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

      const context: MarketContext = {
        currentMarketProb: target.impliedProbYes,
        totalPool: (target.totalPool / 10n ** 18n).toString(),
        timeUntilResolution: `${Math.max(0, Math.floor((target.resolutionTime - Date.now() / 1000) / 86400))} days`,
        systemPrompt: persona.systemPrompt,
      };

      const gen = researchAndForecast(persona, question, context);
      let result: any;
      while (true) {
        const { value, done } = await gen.next();
        if (done) {
          result = value;
          break;
        }
      }
      probability = result?.probability;
      reasoning = result?.reasoning ?? "";
      if (typeof probability !== "number") {
        throw new Error("Forecast missing probability");
      }
    } catch (err: any) {
      emit(
        this.createAction({
          agentId,
          agentName,
          type: "error",
          marketId: target.id,
          question,
          detail: `Forecast failed: ${err?.message ?? "unknown error"}`,
        })
      );
      return;
    }

    // Phase E: Update soul with thesis snippet
    if (reasoning) {
      updateSoul({ currentThesis: reasoning.replace(/\s+/g, " ").trim().slice(0, 200) });
    }
    incrementSoulPredictions();

    // Phase D: use child's own account if available
    const execAccount = spawned?.account ?? undefined;

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

    if (predictionTxHash) {
      emit(
        this.createAction({
          agentId,
          agentName,
          type: "prediction",
          marketId: target.id,
          question,
          probability,
          detail: `Predicted ${Math.round(probability * 100)}% YES on "${question}" [tx: ${predictionTxHash.slice(0, 16)}...]${huginnSuffix}`,
          txHash: predictionTxHash,
          huginnTxHash,
          reasoningHash,
          reasoning: reasoningSnippet,
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
    const shouldBet = confidence > threshold;

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
    emit: (action: AgentAction) => void
  ): Promise<boolean> {
    if (!isAgentConfigured() || config.MARKET_FACTORY_ADDRESS === "0x0") {
      return false;
    }

    let suggestedCategory: string | undefined;
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

    const suggestions = await discoverMarkets(suggestedCategory, 6);
    if (suggestions.length === 0) return false;

    const existingQuestions = new Set(
      Object.values(MARKET_QUESTIONS).map((q) => q.toLowerCase())
    );
    const picked =
      suggestions.find((s) => !existingQuestions.has(s.question.toLowerCase())) ??
      suggestions[0];

    const questionRaw = picked.question;
    const question = questionRaw.slice(0, 31).replace(/[^\x20-\x7E]/g, "");
    const durationDays = picked.suggestedResolutionDays ?? 30;

    const result = await createMarket(
      question,
      durationDays,
      200,
      config.AGENT_ADDRESS
    );

    if (result.status !== "success") {
      return false;
    }

    if (result.marketId !== undefined) {
      registerQuestion(result.marketId, question);
    }

    let detail = `Created new market: "${question}"`;
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
        question,
        detail,
        txHash: result.txHash,
      })
    );

    return true;
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
  }
}

/** Singleton agent loop instance */
export const agentLoop = new AgentLoop();
