import type { MarketExecutionSurface } from "../MarketGridCard";

export interface AutomationPolicyView {
  id: string;
  marketId: number;
  enabled: boolean;
  status: "active" | "paused" | "stop_loss" | "budget_exhausted";
  cadenceMinutes: number;
  maxStakeStrk: number;
  riskLimitStrk: number;
  stopLossPct: number;
  confidenceThreshold: number;
  preferredSurface: MarketExecutionSurface;
  allowFallbackToDirect: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
}

export interface AutomationRunView {
  id: string;
  marketId: number;
  status: "success" | "error" | "skipped";
  executedAt: number;
  executionSurface: MarketExecutionSurface | null;
  amountStrk: number | null;
  txHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  routePolicy: {
    selectedSurface: MarketExecutionSurface | null;
    routeCandidates: MarketExecutionSurface[];
    routeReason: string;
    backtestConfidence: number | null;
    signalConfidence: number | null;
    executionProfile: string | null;
    policyBinding: {
      cadenceMinutes: number;
      maxStakeStrk: number;
      riskLimitStrk: number;
      stopLossPct: number;
      confidenceThreshold: number;
      preferredSurface: MarketExecutionSurface;
      allowFallbackToDirect: boolean;
    } | null;
  } | null;
}

export interface AutomationSummaryView {
  runCount: number;
  successfulRuns: number;
  stakeSpentStrk: number;
  realizedPnlStrk: number;
  lastExecutedAt: number | null;
}

export interface AutomationDraft {
  enabled: boolean;
  cadenceMinutes: number;
  maxStakeStrk: number;
  riskLimitStrk: number;
  stopLossPct: number;
  confidenceThreshold: number;
  preferredSurface: MarketExecutionSurface;
  allowFallbackToDirect: boolean;
}

export interface AgentBriefView {
  marketId: number;
  marketQuestion: string;
  signal: {
    side: "yes" | "no";
    yesProbability: number;
    confidence: number;
  };
  backtestConfidence: number;
  sourceReliability: Array<{
    source: string;
    samples: number;
    markets: number;
    avgBrier: number;
    calibrationBias: number;
    reliabilityScore: number;
    confidence: number;
  }>;
  agentCalibration: Array<{
    agentId: string;
    samples: number;
    avgBrier: number;
    calibrationBias: number;
    reliabilityScore: number;
    confidence: number;
    memoryStrength: number;
  }>;
  riskFlags: string[];
  recommendedStakeStrk: number;
}
