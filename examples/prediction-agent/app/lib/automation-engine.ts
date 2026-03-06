import { config } from "./config";
import { nowUnix } from "./db";
import {
  getAutomationPolicy,
  getAutomationRunSummary,
  listDueAutomationPolicies,
  listRecentAutomationRuns,
  recordAutomationRun,
  updateAutomationPolicyRuntime,
  type AutomationPolicyRecord,
  type AutomationPolicyStatus,
} from "./automation-store";
import { getMarketByIdFromDb, getWeightedProbFromDb } from "./market-db";
import {
  getMarketById,
  getWeightedProbability,
  resolveMarketQuestion,
} from "./market-reader";
import {
  listAgentCalibrationMemories,
  listSourceReliabilityBacktests,
  recordAudit,
  recordTradeExecution,
  type AgentCalibrationMemory,
  type SourceReliabilityBacktestRow,
} from "./ops-store";
import {
  placeBet,
  type ExecutionSurface,
  type TxResult,
} from "./starknet-executor";

type PolicyExecutionStatus = "success" | "error" | "skipped";
type PolicyRunTrigger = "scheduled" | "manual";

type SignalSide = 0 | 1;

interface MarketContext {
  id: number;
  question: string;
  address: string;
  collateralToken: string;
  impliedProbYes: number;
  status: number;
  resolutionTime: number;
}

interface SignalContext {
  yesProbability: number;
  confidence: number;
  side: SignalSide;
}

export interface AgentBriefPayload {
  marketId: number;
  marketQuestion: string;
  signal: {
    side: "yes" | "no";
    yesProbability: number;
    confidence: number;
  };
  backtestConfidence: number;
  sourceReliability: SourceReliabilityBacktestRow[];
  agentCalibration: AgentCalibrationMemory[];
  riskFlags: string[];
  recommendedStakeStrk: number;
}

export interface AutomationExecutionRecord {
  policyId: string;
  marketId: number;
  status: PolicyExecutionStatus;
  executionSurface: ExecutionSurface | null;
  amountStrk: number | null;
  txHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  reason: string;
  scheduledFor: number;
  executedAt: number;
}

export interface ExecuteDueAutomationResult {
  processed: number;
  results: AutomationExecutionRecord[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function strkToWei(amountStrk: number): bigint {
  const normalized = Math.max(0, amountStrk);
  const [wholePart, fractionPart = ""] = normalized.toFixed(6).split(".");
  const whole = BigInt(wholePart || "0");
  const frac = BigInt((fractionPart.padEnd(18, "0").slice(0, 18)) || "0");
  return whole * 10n ** 18n + frac;
}

function dedupeSurfaces(values: ExecutionSurface[]): ExecutionSurface[] {
  return Array.from(new Set(values));
}

function buildSignal(
  market: MarketContext,
  weightedProbability: number | null
): SignalContext {
  const yesProbability = clamp(
    typeof weightedProbability === "number"
      ? weightedProbability
      : market.impliedProbYes,
    0,
    1
  );
  const confidence = clamp(Math.abs(yesProbability - 0.5) * 2, 0, 1);
  const side: SignalSide = yesProbability >= 0.5 ? 1 : 0;
  return { yesProbability, confidence, side };
}

function computeBacktestConfidence(params: {
  sourceRows: SourceReliabilityBacktestRow[];
  calibrationRows: AgentCalibrationMemory[];
}): number {
  const sourceRows = params.sourceRows.slice(0, 6);
  const calibrationRows = params.calibrationRows.slice(0, 6);

  const sourceScore =
    sourceRows.length > 0
      ? sourceRows.reduce(
          (sum, row) =>
            sum +
            clamp(row.reliabilityScore, 0, 1) *
              clamp(0.35 + row.confidence * 0.65, 0, 1),
          0
        ) / sourceRows.length
      : 0.5;

  const calibrationScore =
    calibrationRows.length > 0
      ? calibrationRows.reduce(
          (sum, row) =>
            sum +
            clamp(row.reliabilityScore, 0, 1) *
              clamp(0.3 + row.memoryStrength * 0.7, 0, 1),
          0
        ) / calibrationRows.length
      : 0.5;

  return clamp(sourceScore * 0.58 + calibrationScore * 0.42, 0, 1);
}

function buildRiskFlags(params: {
  signal: SignalContext;
  backtestConfidence: number;
  policy: AutomationPolicyRecord;
  market: MarketContext;
  remainingBudget: number;
}): string[] {
  const flags: string[] = [];
  if (params.signal.confidence < params.policy.confidenceThreshold) {
    flags.push("Signal confidence is below threshold.");
  }
  if (params.backtestConfidence < 0.45) {
    flags.push("Backtest confidence is weak; route policy will favor safer execution.");
  }
  if (params.remainingBudget <= params.policy.maxStakeStrk) {
    flags.push("Risk budget is near limit.");
  }
  const secsToResolution = params.market.resolutionTime - nowUnix();
  if (secsToResolution > 0 && secsToResolution <= 60 * 60) {
    flags.push("Market resolves within one hour.");
  }
  return flags;
}

function selectSurfaces(params: {
  policy: AutomationPolicyRecord;
  backtestConfidence: number;
  signalConfidence: number;
}): ExecutionSurface[] {
  const surfaces: ExecutionSurface[] = [];
  const preferred = params.policy.preferredSurface;
  const fallbackEnabled =
    params.policy.allowFallbackToDirect ||
    config.STARKZAP_FALLBACK_TO_DIRECT === "true";

  if (
    preferred === "starkzap" &&
    (params.backtestConfidence < 0.45 ||
      params.signalConfidence < params.policy.confidenceThreshold)
  ) {
    surfaces.push("direct", "starkzap");
  } else {
    surfaces.push(preferred);
  }

  if (fallbackEnabled && !surfaces.includes("direct")) {
    surfaces.push("direct");
  }
  if (preferred === "starkzap" && !surfaces.includes("avnu")) {
    surfaces.push("avnu");
  }

  return dedupeSurfaces(surfaces);
}

function explainRouteSelection(params: {
  policy: AutomationPolicyRecord;
  backtestConfidence: number;
  signalConfidence: number;
}): string {
  const preferred = params.policy.preferredSurface;
  const fallbackEnabled =
    params.policy.allowFallbackToDirect ||
    config.STARKZAP_FALLBACK_TO_DIRECT === "true";

  if (preferred === "starkzap" && params.backtestConfidence < 0.45) {
    return "Low backtest confidence; trying direct first before StarkZap.";
  }
  if (
    preferred === "starkzap" &&
    params.signalConfidence < Math.max(params.policy.confidenceThreshold, 0.2)
  ) {
    return "Signal confidence is soft; retaining direct fallback before StarkZap.";
  }
  if (preferred === "starkzap") {
    return fallbackEnabled
      ? "StarkZap preferred by policy, with direct and AVNU fallbacks enabled."
      : "StarkZap preferred by policy.";
  }
  if (preferred === "avnu") {
    return fallbackEnabled
      ? "AVNU preferred by policy, with direct fallback enabled."
      : "AVNU preferred by policy.";
  }
  if (preferred === "direct") {
    return fallbackEnabled
      ? "Direct execution preferred for deterministic fills."
      : "Direct execution pinned by policy.";
  }
  return "Route selected by execution policy.";
}

function buildPolicyBindingSnapshot(policy: AutomationPolicyRecord): Record<string, unknown> {
  return {
    id: policy.id,
    marketId: policy.marketId,
    enabled: policy.enabled,
    status: policy.status,
    cadenceMinutes: policy.cadenceMinutes,
    maxStakeStrk: policy.maxStakeStrk,
    riskLimitStrk: policy.riskLimitStrk,
    stopLossPct: policy.stopLossPct,
    confidenceThreshold: policy.confidenceThreshold,
    preferredSurface: policy.preferredSurface,
    allowFallbackToDirect: policy.allowFallbackToDirect,
  };
}

function buildRunMetadata(params: {
  policy: AutomationPolicyRecord;
  trigger: PolicyRunTrigger;
  scheduledFor: number;
  extra?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    policyBinding: buildPolicyBindingSnapshot(params.policy),
    trigger: params.trigger,
    scheduledFor: params.scheduledFor,
    ...(params.extra ?? {}),
  });
}

async function loadMarketContext(marketId: number): Promise<MarketContext | null> {
  const onChainMarket = await getMarketById(marketId).catch(() => null);
  if (onChainMarket) {
    return {
      id: onChainMarket.id,
      question: resolveMarketQuestion(marketId, onChainMarket.questionHash),
      address: onChainMarket.address,
      collateralToken: onChainMarket.collateralToken,
      impliedProbYes: onChainMarket.impliedProbYes,
      status: onChainMarket.status,
      resolutionTime: onChainMarket.resolutionTime,
    };
  }

  const dbMarket = getMarketByIdFromDb(marketId);
  if (!dbMarket) return null;
  return {
    id: dbMarket.id,
    question: dbMarket.question,
    address: dbMarket.address,
    collateralToken: dbMarket.collateralToken,
    impliedProbYes: dbMarket.impliedProbYes,
    status: dbMarket.status,
    resolutionTime: dbMarket.resolutionTime,
  };
}

async function loadWeightedProbability(marketId: number): Promise<number | null> {
  const fromChain = await getWeightedProbability(marketId).catch(() => null);
  if (typeof fromChain === "number" && Number.isFinite(fromChain)) {
    return clamp(fromChain, 0, 1);
  }
  const fromDb = getWeightedProbFromDb(marketId);
  return typeof fromDb === "number" && Number.isFinite(fromDb)
    ? clamp(fromDb, 0, 1)
    : null;
}

export async function buildAgentBrief(params: {
  organizationId: string;
  userId: string;
  marketId: number;
  policy?: AutomationPolicyRecord | null;
}): Promise<AgentBriefPayload | null> {
  const market = await loadMarketContext(params.marketId);
  if (!market) return null;

  const [weightedProbability, sourceRows, calibrationRows] = await Promise.all([
    loadWeightedProbability(params.marketId),
    listSourceReliabilityBacktests(params.organizationId),
    listAgentCalibrationMemories(params.organizationId, 8),
  ]);

  const signal = buildSignal(market, weightedProbability);
  const backtestConfidence = computeBacktestConfidence({
    sourceRows,
    calibrationRows,
  });

  const riskReference = params.policy?.riskLimitStrk ?? 25;
  const recommendedStake = clamp(
    (riskReference * (0.2 + backtestConfidence * 0.35)) *
      Math.max(0.2, signal.confidence),
    0.25,
    params.policy?.maxStakeStrk ?? 6
  );

  const policyForFlags =
    params.policy ??
    ({
      confidenceThreshold: 0.12,
      maxStakeStrk: 6,
      riskLimitStrk: 25,
      stopLossPct: 20,
      cadenceMinutes: 15,
    } as AutomationPolicyRecord);

  const riskFlags = buildRiskFlags({
    signal,
    backtestConfidence,
    policy: policyForFlags,
    market,
    remainingBudget: policyForFlags.riskLimitStrk,
  });

  return {
    marketId: market.id,
    marketQuestion: market.question,
    signal: {
      side: signal.side === 1 ? "yes" : "no",
      yesProbability: signal.yesProbability,
      confidence: signal.confidence,
    },
    backtestConfidence,
    sourceReliability: sourceRows.slice(0, 6),
    agentCalibration: calibrationRows.slice(0, 6),
    riskFlags,
    recommendedStakeStrk: recommendedStake,
  };
}

async function executeByRoutePolicy(params: {
  market: MarketContext;
  amountStrk: number;
  side: SignalSide;
  surfaces: ExecutionSurface[];
}): Promise<{
  selectedSurface: ExecutionSurface;
  tx: TxResult;
}> {
  const amountWei = strkToWei(params.amountStrk);
  let lastSurface: ExecutionSurface = params.surfaces[0] ?? "direct";
  let lastResult: TxResult = {
    txHash: "",
    status: "error",
    executionSurface: lastSurface,
    errorCode: "EXECUTION_FAILED",
    error: "No execution attempted",
  };

  for (const surface of params.surfaces) {
    lastSurface = surface;
    const result = await placeBet(
      params.market.address,
      params.side,
      amountWei,
      params.market.collateralToken,
      surface
    );
    lastResult = result;

    if (result.status === "success") {
      return { selectedSurface: surface, tx: result };
    }

    const retryable =
      result.errorCode === "UNSUPPORTED_SURFACE" ||
      result.errorCode === "PROVIDER_UNAVAILABLE";
    if (!retryable) {
      break;
    }
  }

  return { selectedSurface: lastSurface, tx: lastResult };
}

async function executePolicy(params: {
  policy: AutomationPolicyRecord;
  organizationId: string;
  userId: string;
  nowSec: number;
  trigger: PolicyRunTrigger;
}): Promise<AutomationExecutionRecord> {
  const { policy, organizationId, userId, nowSec, trigger } = params;
  const scheduledFor = policy.nextRunAt ?? nowSec;
  const market = await loadMarketContext(policy.marketId);
  if (!market) {
    const run = await recordAutomationRun({
      policyId: policy.id,
      organizationId,
      userId,
      marketId: policy.marketId,
      scheduledFor,
      executedAt: nowSec,
      status: "skipped",
      errorCode: "market_unavailable",
      errorMessage: "Market is unavailable",
      metadataJson: buildRunMetadata({
        policy,
        trigger,
        scheduledFor,
        extra: {
          reason: "market_unavailable",
        },
      }),
    });
    await updateAutomationPolicyRuntime({
      policyId: policy.id,
      lastRunAt: nowSec,
      nextRunAt: nowSec + policy.cadenceMinutes * 60,
    });
    return {
      policyId: policy.id,
      marketId: policy.marketId,
      status: "skipped",
      executionSurface: null,
      amountStrk: null,
      txHash: null,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      reason: "Market unavailable",
      scheduledFor,
      executedAt: nowSec,
    };
  }

  if (market.status !== 0 || market.resolutionTime <= nowSec) {
    const run = await recordAutomationRun({
      policyId: policy.id,
      organizationId,
      userId,
      marketId: policy.marketId,
      scheduledFor,
      executedAt: nowSec,
      status: "skipped",
      errorCode: "market_closed",
      errorMessage: "Market is closed for trading",
      metadataJson: buildRunMetadata({
        policy,
        trigger,
        scheduledFor,
        extra: {
          reason: "market_closed",
        },
      }),
    });
    await updateAutomationPolicyRuntime({
      policyId: policy.id,
      status: "paused",
      lastRunAt: nowSec,
      nextRunAt: null,
    });
    return {
      policyId: policy.id,
      marketId: policy.marketId,
      status: "skipped",
      executionSurface: null,
      amountStrk: null,
      txHash: null,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      reason: "Market closed",
      scheduledFor,
      executedAt: nowSec,
    };
  }

  const [summary, weightedProbability, sourceRows, calibrationRows] =
    await Promise.all([
      getAutomationRunSummary(policy.id),
      loadWeightedProbability(policy.marketId),
      listSourceReliabilityBacktests(organizationId),
      listAgentCalibrationMemories(organizationId, 8),
    ]);

  const signal = buildSignal(market, weightedProbability);
  const backtestConfidence = computeBacktestConfidence({
    sourceRows,
    calibrationRows,
  });

  const stopLossThreshold = policy.riskLimitStrk * (policy.stopLossPct / 100);
  if (summary.realizedPnlStrk <= -stopLossThreshold) {
    await updateAutomationPolicyRuntime({
      policyId: policy.id,
      status: "stop_loss",
      lastRunAt: nowSec,
      nextRunAt: null,
      lastSignalSide: signal.side === 1 ? "yes" : "no",
      lastSignalProb: signal.yesProbability,
    });
    const run = await recordAutomationRun({
      policyId: policy.id,
      organizationId,
      userId,
      marketId: policy.marketId,
      scheduledFor,
      executedAt: nowSec,
      status: "skipped",
      errorCode: "stop_loss_triggered",
      errorMessage: "Stop-loss threshold reached",
      probability: signal.yesProbability,
      side: signal.side,
      metadataJson: buildRunMetadata({
        policy,
        trigger,
        scheduledFor,
        extra: {
          reason: "stop_loss_triggered",
          backtestConfidence,
          stopLossThreshold,
        },
      }),
    });
    return {
      policyId: policy.id,
      marketId: policy.marketId,
      status: "skipped",
      executionSurface: null,
      amountStrk: null,
      txHash: null,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      reason: "Stop-loss triggered",
      scheduledFor,
      executedAt: nowSec,
    };
  }

  const remainingBudget = Math.max(0, policy.riskLimitStrk - summary.stakeSpentStrk);
  if (remainingBudget <= 0) {
    await updateAutomationPolicyRuntime({
      policyId: policy.id,
      status: "budget_exhausted",
      lastRunAt: nowSec,
      nextRunAt: null,
      lastSignalSide: signal.side === 1 ? "yes" : "no",
      lastSignalProb: signal.yesProbability,
    });
    const run = await recordAutomationRun({
      policyId: policy.id,
      organizationId,
      userId,
      marketId: policy.marketId,
      scheduledFor,
      executedAt: nowSec,
      status: "skipped",
      errorCode: "risk_budget_exhausted",
      errorMessage: "Risk budget exhausted",
      probability: signal.yesProbability,
      side: signal.side,
      metadataJson: buildRunMetadata({
        policy,
        trigger,
        scheduledFor,
        extra: {
          reason: "risk_budget_exhausted",
          remainingBudget,
          stakeSpentStrk: summary.stakeSpentStrk,
        },
      }),
    });
    return {
      policyId: policy.id,
      marketId: policy.marketId,
      status: "skipped",
      executionSurface: null,
      amountStrk: null,
      txHash: null,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      reason: "Risk budget exhausted",
      scheduledFor,
      executedAt: nowSec,
    };
  }

  if (signal.confidence < policy.confidenceThreshold) {
    const run = await recordAutomationRun({
      policyId: policy.id,
      organizationId,
      userId,
      marketId: policy.marketId,
      scheduledFor,
      executedAt: nowSec,
      status: "skipped",
      errorCode: "signal_below_threshold",
      errorMessage: "Signal confidence below threshold",
      probability: signal.yesProbability,
      side: signal.side,
      metadataJson: buildRunMetadata({
        policy,
        trigger,
        scheduledFor,
        extra: {
          reason: "signal_below_threshold",
          confidence: signal.confidence,
          threshold: policy.confidenceThreshold,
          backtestConfidence,
        },
      }),
    });
    await updateAutomationPolicyRuntime({
      policyId: policy.id,
      lastRunAt: nowSec,
      nextRunAt: nowSec + policy.cadenceMinutes * 60,
      lastSignalSide: signal.side === 1 ? "yes" : "no",
      lastSignalProb: signal.yesProbability,
      status: "active",
    });
    return {
      policyId: policy.id,
      marketId: policy.marketId,
      status: "skipped",
      executionSurface: null,
      amountStrk: null,
      txHash: null,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      reason: "Signal below threshold",
      scheduledFor,
      executedAt: nowSec,
    };
  }

  const amountStrk = clamp(
    policy.maxStakeStrk * (0.5 + backtestConfidence * 0.5),
    0.1,
    Math.max(0.1, remainingBudget)
  );
  const surfaces = selectSurfaces({
    policy,
    backtestConfidence,
    signalConfidence: signal.confidence,
  });
  const routeReason = explainRouteSelection({
    policy,
    backtestConfidence,
    signalConfidence: signal.confidence,
  });

  const executed = await executeByRoutePolicy({
    market,
    amountStrk,
    side: signal.side,
    surfaces,
  });
  const result = executed.tx;
  const status: PolicyExecutionStatus =
    result.status === "success" ? "success" : "error";

  const run = await recordAutomationRun({
    policyId: policy.id,
    organizationId,
    userId,
    marketId: policy.marketId,
    scheduledFor,
    executedAt: nowSec,
    status,
    executionSurface: executed.selectedSurface,
    amountStrk,
    side: signal.side,
    probability: signal.yesProbability,
    txHash: result.txHash || null,
    errorCode: result.errorCode ?? null,
    errorMessage: result.error ?? null,
    metadataJson: buildRunMetadata({
      policy,
      trigger,
      scheduledFor,
      extra: {
        routeCandidates: surfaces,
        selectedSurface: executed.selectedSurface,
        routeReason,
        backtestConfidence,
        confidence: signal.confidence,
        executionProfile: config.EXECUTION_PROFILE,
      },
    }),
  });

  await updateAutomationPolicyRuntime({
    policyId: policy.id,
    status: "active",
    lastRunAt: nowSec,
    nextRunAt: nowSec + policy.cadenceMinutes * 60,
    lastSignalSide: signal.side === 1 ? "yes" : "no",
    lastSignalProb: signal.yesProbability,
  });

  await recordTradeExecution({
    organizationId,
    marketId: policy.marketId,
    userId,
    executionSurface: executed.selectedSurface,
    txHash: result.txHash || undefined,
    status: result.status,
    errorCode: result.errorCode,
    errorMessage: result.error,
    notionalStrk: amountStrk,
  });

  await recordAudit({
    organizationId,
    userId,
    action: "automation.run",
    targetType: "market",
    targetId: String(policy.marketId),
    metadata: {
      policyId: policy.id,
      status,
      selectedSurface: executed.selectedSurface,
      routeCandidates: surfaces,
      routeReason,
      amountStrk,
      signalSide: signal.side,
      signalProb: signal.yesProbability,
      signalConfidence: signal.confidence,
      backtestConfidence,
      trigger,
      policyBinding: buildPolicyBindingSnapshot(policy),
      txHash: result.txHash || null,
      errorCode: result.errorCode ?? null,
    },
  });

  return {
    policyId: policy.id,
    marketId: policy.marketId,
    status,
    executionSurface: executed.selectedSurface,
    amountStrk,
    txHash: result.txHash || null,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    reason:
      status === "success"
        ? "Executed"
        : result.error ?? "Execution failed",
    scheduledFor,
    executedAt: nowSec,
  };
}

export async function executeDueAutomationPolicies(params: {
  organizationId: string;
  userId: string;
  nowSec?: number;
  limit?: number;
}): Promise<ExecuteDueAutomationResult> {
  const nowSec = params.nowSec ?? nowUnix();
  const duePolicies = await listDueAutomationPolicies({
    organizationId: params.organizationId,
    userId: params.userId,
    nowSec,
    limit: params.limit ?? 12,
  });

  const results: AutomationExecutionRecord[] = [];
  for (const policy of duePolicies) {
    results.push(
      await executePolicy({
        policy,
        organizationId: params.organizationId,
        userId: params.userId,
        nowSec,
        trigger: "scheduled",
      })
    );
  }

  return {
    processed: duePolicies.length,
    results,
  };
}

export async function executeAutomationMarketNow(params: {
  organizationId: string;
  userId: string;
  marketId: number;
}): Promise<AutomationExecutionRecord | null> {
  const policy = await getAutomationPolicy(
    params.organizationId,
    params.userId,
    params.marketId
  );
  if (!policy) return null;

  return executePolicy({
    policy,
    organizationId: params.organizationId,
    userId: params.userId,
    nowSec: nowUnix(),
    trigger: "manual",
  });
}

export async function getAutomationPolicyWithRuntime(params: {
  organizationId: string;
  userId: string;
  marketId: number;
}): Promise<{
  policy: AutomationPolicyRecord | null;
  summary: Awaited<ReturnType<typeof getAutomationRunSummary>> | null;
  recentRuns: Awaited<ReturnType<typeof listRecentAutomationRuns>>;
}> {
  const policy = await getAutomationPolicy(
    params.organizationId,
    params.userId,
    params.marketId
  );
  const recentRuns = await listRecentAutomationRuns({
    organizationId: params.organizationId,
    userId: params.userId,
    marketId: params.marketId,
    limit: 12,
  });
  if (!policy) {
    return { policy: null, summary: null, recentRuns };
  }
  const summary = await getAutomationRunSummary(policy.id);
  return { policy, summary, recentRuns };
}

export function mapCadenceMinutesToLabel(cadenceMinutes: number): "5m" | "15m" | "1h" {
  if (cadenceMinutes <= 5) return "5m";
  if (cadenceMinutes >= 60) return "1h";
  return "15m";
}

export function mapCadenceLabelToMinutes(label: "5m" | "15m" | "1h"): number {
  if (label === "5m") return 5;
  if (label === "1h") return 60;
  return 15;
}

export function normalizePolicyStatus(status: string): AutomationPolicyStatus {
  if (
    status === "active" ||
    status === "paused" ||
    status === "stop_loss" ||
    status === "budget_exhausted"
  ) {
    return status;
  }
  return "active";
}
