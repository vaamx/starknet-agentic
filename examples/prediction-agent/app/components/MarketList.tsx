"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ensureCsrfToken } from "@/lib/client-csrf";
import MarketGridCard, {
  type HeartbeatFreshness,
  type HeartbeatSource,
  type MarketAutomationCadence,
  type MarketAutomationState,
  type MarketCommentPreview,
  type MarketExecutionSurface,
  type MarketSourceHeartbeat,
} from "./MarketGridCard";
import MarketRow from "./MarketRow";
import MarketAutomationDrawer from "./MarketAutomationDrawer";
import AgentBriefPanel from "./AgentBriefPanel";
import type {
  AgentPrediction,
  LatestAgentTake,
  Market,
} from "./dashboard/types";
import type {
  AgentBriefView,
  AutomationDraft,
  AutomationPolicyView,
  AutomationRunView,
  AutomationSummaryView,
} from "./automation/types";

type ViewMode = "grid" | "table";

interface MarketListProps {
  markets: Market[];
  predictions: Record<number, AgentPrediction[]>;
  weightedProbs: Record<number, number | null>;
  latestTakes: Record<number, LatestAgentTake | null>;
  loading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onBet: (marketId: number, outcome?: 0 | 1) => void;
  onAnalyze: (marketId: number, question: string) => void;
  onRunAgentSweep: () => void;
  agentSweepBusy?: boolean;
  agentSweepMessage?: string | null;
  isAuthenticated?: boolean;
  walletSession?: {
    configured: boolean;
    authenticated: boolean;
    scopes: string[];
  } | null;
  fundingReady?: boolean;
  viewMode?: ViewMode;
}

interface RuntimePayload {
  policy: AutomationPolicyView | null;
  summary: AutomationSummaryView | null;
  recentRuns: AutomationRunView[];
}

type RoutePolicyMeta = AutomationRunView["routePolicy"];

interface AgentCommentPayload {
  id?: string;
  marketId?: number;
  parentId?: string | null;
  actorName?: string;
  content?: string;
  sourceType?: string;
  reliabilityScore?: number | null;
  backtestConfidence?: number | null;
  createdAt?: number;
}

const DEFAULT_AUTOMATION_STATE: MarketAutomationState = {
  enabled: false,
  cadence: "15m",
  executionSurface: "starkzap",
};

const DEFAULT_AUTOMATION_DRAFT: AutomationDraft = {
  enabled: false,
  cadenceMinutes: 15,
  maxStakeStrk: 5,
  riskLimitStrk: 25,
  stopLossPct: 20,
  confidenceThreshold: 0.12,
  preferredSurface: "starkzap",
  allowFallbackToDirect: true,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseCadence(minutes: number): MarketAutomationCadence {
  if (minutes <= 5) return "5m";
  if (minutes >= 60) return "1h";
  return "15m";
}

function normalizeSurface(value: unknown): MarketExecutionSurface | null {
  return value === "starkzap" || value === "avnu" || value === "direct"
    ? value
    : null;
}

const HEARTBEAT_SOURCES: HeartbeatSource[] = ["x", "espn", "rss", "onchain"];

function normalizeHeartbeatFreshness(value: unknown): HeartbeatFreshness {
  if (value === "fresh" || value === "stale" || value === "missing") {
    return value;
  }
  return "missing";
}

function normalizeHeartbeatMarket(value: unknown): MarketSourceHeartbeat | null {
  if (!value || typeof value !== "object") return null;
  const row = value as {
    marketId?: unknown;
    lastSeenAt?: unknown;
    freshness?: unknown;
    sources?: unknown;
  };
  if (typeof row.marketId !== "number" || !Number.isFinite(row.marketId)) {
    return null;
  }
  const rawSources =
    row.sources && typeof row.sources === "object"
      ? (row.sources as Record<string, { lastSeenAt?: unknown; freshness?: unknown }>)
      : {};

  const sources = HEARTBEAT_SOURCES.reduce((acc, source) => {
    const sourceRow = rawSources[source];
    const sourceLastSeenAt =
      typeof sourceRow?.lastSeenAt === "number" &&
      Number.isFinite(sourceRow.lastSeenAt)
        ? sourceRow.lastSeenAt
        : null;
    acc[source] = {
      lastSeenAt: sourceLastSeenAt,
      freshness: normalizeHeartbeatFreshness(sourceRow?.freshness),
    };
    return acc;
  }, {} as MarketSourceHeartbeat["sources"]);

  const lastSeenAt =
    typeof row.lastSeenAt === "number" && Number.isFinite(row.lastSeenAt)
      ? row.lastSeenAt
      : null;

  return {
    marketId: Math.trunc(row.marketId),
    lastSeenAt,
    freshness: normalizeHeartbeatFreshness(row.freshness),
    sources,
  };
}

function parseRoutePolicyMeta(
  metadataValue: unknown,
  executionSurface: MarketExecutionSurface | null
): RoutePolicyMeta {
  const payload =
    typeof metadataValue === "string" && metadataValue.trim().length > 0
      ? (() => {
          try {
            return JSON.parse(metadataValue) as Record<string, unknown>;
          } catch {
            return null;
          }
        })()
      : metadataValue && typeof metadataValue === "object"
        ? (metadataValue as Record<string, unknown>)
        : null;

  if (!payload) return null;

  const candidates = Array.isArray(payload.routeCandidates)
    ? payload.routeCandidates
        .map((candidate) => normalizeSurface(candidate))
        .filter((candidate): candidate is MarketExecutionSurface => Boolean(candidate))
    : [];
  const selectedSurface =
    normalizeSurface(payload.selectedSurface) ?? executionSurface;
  const routeReason =
    typeof payload.routeReason === "string" && payload.routeReason.trim().length > 0
      ? payload.routeReason.trim()
      : selectedSurface
        ? `${selectedSurface.toUpperCase()} selected by execution policy.`
        : "Route selected by execution policy.";

  const policyBinding =
    payload.policyBinding && typeof payload.policyBinding === "object"
      ? (() => {
          const row = payload.policyBinding as Record<string, unknown>;
          const preferredSurface = normalizeSurface(row.preferredSurface);
          if (!preferredSurface) return null;
          const cadenceMinutes = Number(row.cadenceMinutes);
          const maxStakeStrk = Number(row.maxStakeStrk);
          const riskLimitStrk = Number(row.riskLimitStrk);
          const stopLossPct = Number(row.stopLossPct);
          const confidenceThreshold = Number(row.confidenceThreshold);
          if (
            !Number.isFinite(cadenceMinutes) ||
            !Number.isFinite(maxStakeStrk) ||
            !Number.isFinite(riskLimitStrk) ||
            !Number.isFinite(stopLossPct) ||
            !Number.isFinite(confidenceThreshold)
          ) {
            return null;
          }
          return {
            cadenceMinutes: clamp(Math.round(cadenceMinutes), 5, 1440),
            maxStakeStrk: clamp(maxStakeStrk, 0.1, 1_000_000),
            riskLimitStrk: clamp(riskLimitStrk, 0.1, 1_000_000),
            stopLossPct: clamp(stopLossPct, 1, 99),
            confidenceThreshold: clamp(confidenceThreshold, 0.01, 0.49),
            preferredSurface,
            allowFallbackToDirect: Boolean(row.allowFallbackToDirect),
          };
        })()
      : null;

  if (!selectedSurface && candidates.length === 0 && !routeReason) {
    return null;
  }

  return {
    selectedSurface,
    routeCandidates: candidates,
    routeReason,
    backtestConfidence:
      typeof payload.backtestConfidence === "number" &&
      Number.isFinite(payload.backtestConfidence)
        ? clamp(payload.backtestConfidence, 0, 1)
        : null,
    signalConfidence:
      typeof payload.confidence === "number" && Number.isFinite(payload.confidence)
        ? clamp(payload.confidence, 0, 1)
        : null,
    executionProfile:
      typeof payload.executionProfile === "string"
        ? payload.executionProfile
        : null,
    policyBinding,
  };
}

function normalizeComment(value: unknown): MarketCommentPreview | null {
  if (!value || typeof value !== "object") return null;
  const row = value as AgentCommentPayload;
  if (
    typeof row.id !== "string" ||
    typeof row.marketId !== "number" ||
    typeof row.actorName !== "string" ||
    typeof row.content !== "string" ||
    typeof row.createdAt !== "number"
  ) {
    return null;
  }
  return {
    id: row.id,
    marketId: row.marketId,
    parentId: typeof row.parentId === "string" ? row.parentId : null,
    actorName: row.actorName,
    content: row.content,
    sourceType: typeof row.sourceType === "string" ? row.sourceType : "agent",
    reliabilityScore:
      typeof row.reliabilityScore === "number" &&
      Number.isFinite(row.reliabilityScore)
        ? clamp(row.reliabilityScore, 0, 1)
        : null,
    backtestConfidence:
      typeof row.backtestConfidence === "number" &&
      Number.isFinite(row.backtestConfidence)
        ? clamp(row.backtestConfidence, 0, 1)
        : null,
    createdAt: row.createdAt,
  };
}

function normalizeSummary(value: unknown): AutomationSummaryView | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<AutomationSummaryView>;
  if (
    typeof row.runCount !== "number" ||
    typeof row.successfulRuns !== "number" ||
    typeof row.stakeSpentStrk !== "number" ||
    typeof row.realizedPnlStrk !== "number"
  ) {
    return null;
  }
  return {
    runCount: row.runCount,
    successfulRuns: row.successfulRuns,
    stakeSpentStrk: row.stakeSpentStrk,
    realizedPnlStrk: row.realizedPnlStrk,
    lastExecutedAt:
      typeof row.lastExecutedAt === "number" ? row.lastExecutedAt : null,
  };
}

function normalizePolicy(value: unknown): AutomationPolicyView | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<AutomationPolicyView>;
  if (
    typeof row.id !== "string" ||
    typeof row.marketId !== "number" ||
    typeof row.enabled !== "boolean"
  ) {
    return null;
  }

  const preferredSurface =
    row.preferredSurface === "starkzap" ||
    row.preferredSurface === "avnu" ||
    row.preferredSurface === "direct"
      ? row.preferredSurface
      : "starkzap";

  const status =
    row.status === "active" ||
    row.status === "paused" ||
    row.status === "stop_loss" ||
    row.status === "budget_exhausted"
      ? row.status
      : "active";

  return {
    id: row.id,
    marketId: row.marketId,
    enabled: row.enabled,
    status,
    cadenceMinutes: clamp(Math.round(Number(row.cadenceMinutes ?? 15)), 5, 1440),
    maxStakeStrk: clamp(Number(row.maxStakeStrk ?? 5), 0.1, 1_000_000),
    riskLimitStrk: clamp(Number(row.riskLimitStrk ?? 25), 0.1, 1_000_000),
    stopLossPct: clamp(Number(row.stopLossPct ?? 20), 1, 99),
    confidenceThreshold: clamp(
      Number(row.confidenceThreshold ?? 0.12),
      0.01,
      0.49
    ),
    preferredSurface,
    allowFallbackToDirect: Boolean(row.allowFallbackToDirect),
    lastRunAt: typeof row.lastRunAt === "number" ? row.lastRunAt : null,
    nextRunAt: typeof row.nextRunAt === "number" ? row.nextRunAt : null,
  };
}

function normalizeRun(value: unknown): AutomationRunView | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<AutomationRunView> & {
    marketId?: unknown;
    metadataJson?: unknown;
  };
  if (
    typeof row.id !== "string" ||
    typeof row.marketId !== "number" ||
    typeof row.executedAt !== "number" ||
    (row.status !== "success" && row.status !== "error" && row.status !== "skipped")
  ) {
    return null;
  }

  const executionSurface = normalizeSurface(row.executionSurface);
  const routePolicy = parseRoutePolicyMeta(row.metadataJson, executionSurface);

  return {
    id: row.id,
    marketId: row.marketId,
    status: row.status,
    executedAt: row.executedAt,
    executionSurface,
    amountStrk:
      typeof row.amountStrk === "number" && Number.isFinite(row.amountStrk)
        ? row.amountStrk
        : null,
    txHash: typeof row.txHash === "string" ? row.txHash : null,
    errorCode: typeof row.errorCode === "string" ? row.errorCode : null,
    errorMessage: typeof row.errorMessage === "string" ? row.errorMessage : null,
    routePolicy,
  };
}

function normalizeBrief(value: unknown): AgentBriefView | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<AgentBriefView>;
  if (
    typeof row.marketId !== "number" ||
    typeof row.marketQuestion !== "string" ||
    !row.signal ||
    typeof row.signal !== "object"
  ) {
    return null;
  }

  const signal = row.signal as AgentBriefView["signal"];
  if (
    (signal.side !== "yes" && signal.side !== "no") ||
    typeof signal.yesProbability !== "number" ||
    typeof signal.confidence !== "number"
  ) {
    return null;
  }

  return {
    marketId: row.marketId,
    marketQuestion: row.marketQuestion,
    signal,
    backtestConfidence: Number(row.backtestConfidence ?? 0),
    sourceReliability: Array.isArray(row.sourceReliability)
      ? (row.sourceReliability as AgentBriefView["sourceReliability"])
      : [],
    agentCalibration: Array.isArray(row.agentCalibration)
      ? (row.agentCalibration as AgentBriefView["agentCalibration"])
      : [],
    riskFlags: Array.isArray(row.riskFlags)
      ? row.riskFlags.filter((item): item is string => typeof item === "string")
      : [],
    recommendedStakeStrk: Number(row.recommendedStakeStrk ?? 0),
  };
}

function toDraft(policy: AutomationPolicyView | null | undefined): AutomationDraft {
  if (!policy) return { ...DEFAULT_AUTOMATION_DRAFT };
  return {
    enabled: policy.enabled,
    cadenceMinutes: policy.cadenceMinutes,
    maxStakeStrk: policy.maxStakeStrk,
    riskLimitStrk: policy.riskLimitStrk,
    stopLossPct: policy.stopLossPct,
    confidenceThreshold: policy.confidenceThreshold,
    preferredSurface: policy.preferredSurface,
    allowFallbackToDirect: policy.allowFallbackToDirect,
  };
}

function toAutomationState(policy: AutomationPolicyView | null | undefined): MarketAutomationState {
  if (!policy) return { ...DEFAULT_AUTOMATION_STATE };
  return {
    enabled: policy.enabled,
    cadence: parseCadence(policy.cadenceMinutes),
    executionSurface: policy.preferredSurface,
    updatedAt: (policy.lastRunAt ?? policy.nextRunAt ?? Date.now()) * 1000,
  };
}

function fallbackRoutePolicyFromPolicy(
  policy: AutomationPolicyView | undefined
): RoutePolicyMeta {
  if (!policy) return null;
  const candidates: MarketExecutionSurface[] = [policy.preferredSurface];
  if (policy.allowFallbackToDirect && policy.preferredSurface !== "direct") {
    candidates.push("direct");
  }
  if (policy.preferredSurface === "starkzap" && !candidates.includes("avnu")) {
    candidates.push("avnu");
  }
  return {
    selectedSurface: policy.preferredSurface,
    routeCandidates: candidates,
    routeReason: `${policy.preferredSurface.toUpperCase()} preferred by policy.`,
    backtestConfidence: null,
    signalConfidence: null,
    executionProfile: null,
    policyBinding: {
      cadenceMinutes: policy.cadenceMinutes,
      maxStakeStrk: policy.maxStakeStrk,
      riskLimitStrk: policy.riskLimitStrk,
      stopLossPct: policy.stopLossPct,
      confidenceThreshold: policy.confidenceThreshold,
      preferredSurface: policy.preferredSurface,
      allowFallbackToDirect: policy.allowFallbackToDirect,
    },
  };
}

function SkeletonCard() {
  return (
    <div className="market-card relative overflow-hidden">
      {/* Shimmer overlay */}
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/[0.03] to-transparent" />

      <div className="h-[2px] w-full bg-gradient-to-r from-white/[0.02] via-white/[0.05] to-white/[0.02]" />
      <div className="p-5 pb-3">
        {/* Category + lifecycle badge */}
        <div className="flex items-center gap-2 mb-3.5">
          <div className="h-5 bg-white/[0.05] rounded-md w-16 animate-pulse" />
          <div className="h-5 bg-white/[0.03] rounded-md w-12 animate-pulse [animation-delay:0.1s]" />
          <div className="ml-auto h-4 bg-white/[0.03] rounded-full w-14 animate-pulse [animation-delay:0.15s]" />
        </div>
        {/* Question text */}
        <div className="space-y-2 mb-4">
          <div className="h-4 bg-white/[0.05] rounded w-[92%] animate-pulse [animation-delay:0.05s]" />
          <div className="h-4 bg-white/[0.04] rounded w-[60%] animate-pulse [animation-delay:0.1s]" />
        </div>
        {/* Mini chart area */}
        <div className="h-[80px] bg-white/[0.02] rounded-lg mb-3 flex items-end px-2 pb-2 gap-[3px]">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 bg-white/[0.04] rounded-sm animate-pulse"
              style={{
                height: `${20 + Math.sin(i * 0.8) * 15 + Math.random() * 10}%`,
                animationDelay: `${i * 0.08}s`,
              }}
            />
          ))}
        </div>
        {/* Price row */}
        <div className="flex items-end justify-between mb-2">
          <div className="h-8 bg-white/[0.04] rounded w-20 animate-pulse" />
          <div className="h-5 bg-white/[0.03] rounded w-14 animate-pulse [animation-delay:0.1s]" />
        </div>
        {/* Probability bar */}
        <div className="h-1.5 bg-white/[0.03] rounded-full mb-1 overflow-hidden">
          <div className="h-full w-[45%] bg-white/[0.04] rounded-full animate-pulse" />
        </div>
        <div className="flex justify-between">
          <div className="h-2.5 bg-white/[0.02] rounded w-10 animate-pulse" />
          <div className="h-2.5 bg-white/[0.02] rounded w-10 animate-pulse [animation-delay:0.05s]" />
        </div>
      </div>
      {/* Action buttons */}
      <div className="px-5 pb-4 flex gap-2.5">
        <div className="flex-1 h-[44px] rounded-xl bg-neo-green/[0.04] animate-pulse" />
        <div className="flex-1 h-[44px] rounded-xl bg-red-500/[0.04] animate-pulse [animation-delay:0.1s]" />
      </div>
      {/* Footer */}
      <div className="px-5 py-3 border-t border-white/[0.04] flex items-center gap-3">
        <div className="flex -space-x-1.5">
          <div className="w-5 h-5 rounded-full bg-white/[0.05] ring-1 ring-white/[0.03] animate-pulse" />
          <div className="w-5 h-5 rounded-full bg-white/[0.04] ring-1 ring-white/[0.03] animate-pulse [animation-delay:0.1s]" />
          <div className="w-5 h-5 rounded-full bg-white/[0.03] ring-1 ring-white/[0.03] animate-pulse [animation-delay:0.2s]" />
        </div>
        <div className="flex-1" />
        <div className="h-3 bg-white/[0.03] rounded w-12 animate-pulse" />
        <div className="h-3 bg-white/[0.03] rounded w-10 animate-pulse [animation-delay:0.05s]" />
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 lg:px-5 py-4 animate-pulse">
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-4 bg-white/[0.05] rounded w-3/4" />
        <div className="h-3 bg-white/[0.03] rounded w-20" />
      </div>
      <div className="w-[88px] shrink-0 space-y-1.5">
        <div className="h-4 bg-neo-green/[0.06] rounded w-14 ml-auto" />
        <div className="h-[3px] bg-white/[0.03] rounded-full" />
      </div>
      <div className="w-[88px] shrink-0 space-y-1.5">
        <div className="h-4 bg-red-500/[0.06] rounded w-14 ml-auto" />
        <div className="h-[3px] bg-white/[0.03] rounded-full" />
      </div>
      <div className="hidden sm:block w-[80px] shrink-0">
        <div className="h-3 bg-white/[0.03] rounded w-12 ml-auto" />
      </div>
      <div className="hidden md:block w-[48px] shrink-0">
        <div className="h-3 bg-white/[0.03] rounded w-8 ml-auto" />
      </div>
    </div>
  );
}

export default function MarketList({
  markets,
  predictions,
  weightedProbs,
  latestTakes,
  loading,
  isRefreshing,
  onRefresh,
  onBet,
  onAnalyze,
  onRunAgentSweep,
  agentSweepBusy = false,
  agentSweepMessage = null,
  isAuthenticated = false,
  walletSession = null,
  fundingReady = false,
  viewMode = "grid",
}: MarketListProps) {
  const [policyMap, setPolicyMap] = useState<Record<number, AutomationPolicyView>>({});
  const [summaryMap, setSummaryMap] = useState<Record<number, AutomationSummaryView>>({});
  const [latestRunMap, setLatestRunMap] = useState<Record<number, AutomationRunView>>({});
  const [commentPreviewMap, setCommentPreviewMap] = useState<
    Record<number, MarketCommentPreview | null>
  >({});
  const [fleetExecutionReadiness, setFleetExecutionReadiness] = useState<{
    fundedAgents: number;
    executableAgents: number;
  } | null>(null);
  const [marketHeartbeatMap, setMarketHeartbeatMap] = useState<
    Record<number, MarketSourceHeartbeat>
  >({});

  const [drawerMarketId, setDrawerMarketId] = useState<number | null>(null);
  const [drawerDraft, setDrawerDraft] = useState<AutomationDraft>(
    DEFAULT_AUTOMATION_DRAFT
  );
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const [briefOpen, setBriefOpen] = useState(false);
  const [briefData, setBriefData] = useState<AgentBriefView | null>(null);
  const [briefSummary, setBriefSummary] = useState<AutomationSummaryView | null>(null);
  const [briefRuns, setBriefRuns] = useState<AutomationRunView[]>([]);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  const selectedMarket = useMemo(
    () =>
      drawerMarketId === null
        ? null
        : markets.find((market) => market.id === drawerMarketId) ?? null,
    [drawerMarketId, markets]
  );

  const fetchPolicyRuntime = useCallback(
    async (marketId: number): Promise<RuntimePayload | null> => {
      if (!isAuthenticated) return null;
      const response = await fetch(`/api/automation/policies?marketId=${marketId}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch automation runtime (HTTP ${response.status})`);
      }
      const payload = (await response.json()) as {
        policy?: unknown;
        summary?: unknown;
        recentRuns?: unknown[];
      };

      const policy = normalizePolicy(payload.policy ?? null);
      const summary = normalizeSummary(payload.summary ?? null);
      const recentRuns = Array.isArray(payload.recentRuns)
        ? payload.recentRuns
            .map((value) => normalizeRun(value))
            .filter((value): value is AutomationRunView => Boolean(value))
        : [];

      setPolicyMap((prev) => {
        const next = { ...prev };
        if (policy) next[marketId] = policy;
        else delete next[marketId];
        return next;
      });
      setSummaryMap((prev) => {
        const next = { ...prev };
        if (summary) next[marketId] = summary;
        else delete next[marketId];
        return next;
      });
      setLatestRunMap((prev) => {
        const next = { ...prev };
        if (recentRuns.length > 0) next[marketId] = recentRuns[0];
        else delete next[marketId];
        return next;
      });

      return { policy, summary, recentRuns };
    },
    [isAuthenticated]
  );

  const loadRecentRuns = useCallback(async () => {
    if (!isAuthenticated) {
      setLatestRunMap({});
      return;
    }

    const response = await fetch("/api/automation/runs?limit=180", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Failed to load automation runs (HTTP ${response.status})`);
    }

    const payload = (await response.json()) as { runs?: unknown[] };
    const next: Record<number, AutomationRunView> = {};
    for (const raw of payload.runs ?? []) {
      const run = normalizeRun(raw);
      if (!run) continue;
      if (!next[run.marketId]) {
        next[run.marketId] = run;
      }
    }
    setLatestRunMap(next);
  }, [isAuthenticated]);

  const loadCommentPreviews = useCallback(async () => {
    if (!isAuthenticated || markets.length === 0) {
      setCommentPreviewMap({});
      return;
    }

    const marketIds = markets.map((market) => market.id);
    const params = new URLSearchParams({
      marketIds: marketIds.join(","),
      limitPerMarket: "1",
    });

    const response = await fetch(`/api/agent-comments?${params.toString()}`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Failed to load market comments (HTTP ${response.status})`);
    }

    const payload = (await response.json()) as {
      byMarket?: Record<string, unknown[]>;
    };
    const next: Record<number, MarketCommentPreview | null> = {};
    for (const market of markets) {
      const list = Array.isArray(payload.byMarket?.[String(market.id)])
        ? payload.byMarket?.[String(market.id)] ?? []
        : [];
      const first = normalizeComment(list[0] ?? null);
      next[market.id] = first;
    }
    setCommentPreviewMap(next);
  }, [isAuthenticated, markets]);

  const loadFleetExecutionReadiness = useCallback(async () => {
    if (!isAuthenticated) {
      setFleetExecutionReadiness(null);
      setMarketHeartbeatMap({});
      return;
    }
    const params = new URLSearchParams();
    if (markets.length > 0) {
      params.set(
        "marketIds",
        markets
          .map((market) => market.id)
          .filter((marketId) => Number.isFinite(marketId))
          .join(",")
      );
    }
    const endpoint = params.toString() ? `/api/fleet?${params.toString()}` : "/api/fleet";
    const response = await fetch(endpoint, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Failed to load fleet readiness (HTTP ${response.status})`);
    }
    const payload = (await response.json()) as {
      fleet?: {
        readiness?: {
          fundedAgents?: unknown;
          executableAgents?: unknown;
          sourceHeartbeat?: {
            markets?: unknown[];
          } | null;
        };
      };
    };
    const fundedAgents = Number(payload.fleet?.readiness?.fundedAgents ?? 0);
    const executableAgents = Number(payload.fleet?.readiness?.executableAgents ?? 0);
    setFleetExecutionReadiness({
      fundedAgents:
        Number.isFinite(fundedAgents) && fundedAgents > 0
          ? Math.floor(fundedAgents)
          : 0,
      executableAgents:
        Number.isFinite(executableAgents) && executableAgents > 0
          ? Math.floor(executableAgents)
          : 0,
    });
    const heartbeatRows = Array.isArray(payload.fleet?.readiness?.sourceHeartbeat?.markets)
      ? payload.fleet?.readiness?.sourceHeartbeat?.markets ?? []
      : [];
    const heartbeatByMarket: Record<number, MarketSourceHeartbeat> = {};
    for (const row of heartbeatRows) {
      const normalized = normalizeHeartbeatMarket(row);
      if (!normalized) continue;
      heartbeatByMarket[normalized.marketId] = normalized;
    }
    setMarketHeartbeatMap(heartbeatByMarket);
  }, [isAuthenticated, markets]);

  const loadPolicies = useCallback(async () => {
    if (!isAuthenticated) {
      setPolicyMap({});
      setSummaryMap({});
      return;
    }

    const response = await fetch("/api/automation/policies", {
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Failed to load automation policies (HTTP ${response.status})`);
    }

    const payload = (await response.json()) as {
      policies?: Array<{ summary?: unknown } & Record<string, unknown>>;
    };

    const nextPolicies: Record<number, AutomationPolicyView> = {};
    const nextSummaries: Record<number, AutomationSummaryView> = {};

    for (const raw of payload.policies ?? []) {
      const policy = normalizePolicy(raw);
      if (!policy) continue;
      nextPolicies[policy.marketId] = policy;

      const summary = normalizeSummary(raw.summary);
      if (summary) {
        nextSummaries[policy.marketId] = summary;
      }
    }

    setPolicyMap(nextPolicies);
    setSummaryMap(nextSummaries);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setPolicyMap({});
      setSummaryMap({});
      setLatestRunMap({});
      setCommentPreviewMap({});
      setFleetExecutionReadiness(null);
      setMarketHeartbeatMap({});
      return;
    }
    void Promise.all([
      loadPolicies(),
      loadRecentRuns(),
      loadCommentPreviews(),
      loadFleetExecutionReadiness(),
    ]).catch(() => {
      // Best-effort on initial paint.
    });
  }, [
    isAuthenticated,
    loadCommentPreviews,
    loadFleetExecutionReadiness,
    loadPolicies,
    loadRecentRuns,
  ]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const id = window.setInterval(() => {
      void loadFleetExecutionReadiness().catch(() => {
        // Soft polling for hard execution gate.
      });
    }, 45_000);
    return () => window.clearInterval(id);
  }, [isAuthenticated, loadFleetExecutionReadiness]);

  const executionBlockers = useMemo(() => {
    if (!isAuthenticated) {
      return ["Sign in to run automation."];
    }

    const blockers: string[] = [];
    const configured = walletSession?.configured !== false;
    const authenticated = walletSession?.authenticated === true;
    const scopes = Array.isArray(walletSession?.scopes)
      ? walletSession.scopes.map((scope) => String(scope).toLowerCase())
      : [];

    if (!configured) {
      blockers.push("Manual wallet auth is not configured on the server.");
      return blockers;
    }
    if (!authenticated) {
      blockers.push("Wallet signature session is required.");
    }
    if (!scopes.includes("tick")) {
      blockers.push("Tick scope is missing in the wallet session.");
    }

    const fundedAgents =
      typeof fleetExecutionReadiness?.fundedAgents === "number"
        ? fleetExecutionReadiness.fundedAgents
        : fundingReady
          ? 1
          : 0;
    const executableAgents =
      typeof fleetExecutionReadiness?.executableAgents === "number"
        ? fleetExecutionReadiness.executableAgents
        : 0;

    if (fundedAgents <= 0) {
      blockers.push("No funded agent wallet is available.");
    }
    if (executableAgents <= 0) {
      blockers.push("No signing-enabled agent is available.");
    }

    return blockers;
  }, [fleetExecutionReadiness, fundingReady, isAuthenticated, walletSession]);

  const canExecuteAutomation = executionBlockers.length === 0;

  const runDuePolicies = useCallback(async () => {
    if (!isAuthenticated || !canExecuteAutomation) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }

    const token = await ensureCsrfToken();
    const response = await fetch("/api/automation/runs", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": token,
      },
      body: JSON.stringify({ limit: 8 }),
    });

    if (!response.ok) return;

    const payload = (await response.json().catch(() => null)) as
      | { processed?: number; results?: Array<{ marketId?: number }> }
      | null;

    const touched = new Set<number>();
    for (const result of payload?.results ?? []) {
      if (typeof result?.marketId === "number") {
        touched.add(result.marketId);
      }
    }

    if (touched.size > 0) {
      void loadPolicies();
      void loadRecentRuns();
      if (drawerMarketId !== null && touched.has(drawerMarketId)) {
        void fetchPolicyRuntime(drawerMarketId);
      }
    }
  }, [
    canExecuteAutomation,
    drawerMarketId,
    fetchPolicyRuntime,
    isAuthenticated,
    loadPolicies,
    loadRecentRuns,
  ]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void runDuePolicies().catch(() => {
      // Non-blocking scheduler tick.
    });

    const id = window.setInterval(() => {
      void runDuePolicies().catch(() => {
        // Non-blocking scheduler tick.
      });
    }, 60_000);

    return () => window.clearInterval(id);
  }, [isAuthenticated, runDuePolicies]);

  const handleOpenAutomation = useCallback(
    (marketId: number) => {
      setDrawerMarketId(marketId);
      setDrawerError(null);
      setRunMessage(null);
      setDrawerDraft(toDraft(policyMap[marketId]));

      if (!isAuthenticated) {
        setDrawerError("Sign in to persist automation settings per workspace user.");
        return;
      }

      void fetchPolicyRuntime(marketId)
        .then((runtime) => {
          if (runtime?.policy) {
            setDrawerDraft(toDraft(runtime.policy));
          }
        })
        .catch((error: any) => {
          setDrawerError(error?.message ?? "Failed to load automation state.");
        });
    },
    [fetchPolicyRuntime, isAuthenticated, policyMap]
  );

  const handleSavePolicy = useCallback(async () => {
    if (drawerMarketId === null) return;
    if (!isAuthenticated) {
      setDrawerError("Sign in to save automation settings.");
      return;
    }

    setDrawerBusy(true);
    setDrawerError(null);
    try {
      const token = await ensureCsrfToken();
      const response = await fetch("/api/automation/policies", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({
          marketId: drawerMarketId,
          enabled: drawerDraft.enabled,
          cadenceMinutes: clamp(Math.round(drawerDraft.cadenceMinutes), 5, 1440),
          maxStakeStrk: clamp(Number(drawerDraft.maxStakeStrk), 0.1, 1_000_000),
          riskLimitStrk: clamp(Number(drawerDraft.riskLimitStrk), 0.1, 1_000_000),
          stopLossPct: clamp(Number(drawerDraft.stopLossPct), 1, 99),
          confidenceThreshold: clamp(
            Number(drawerDraft.confidenceThreshold),
            0.01,
            0.49
          ),
          preferredSurface: drawerDraft.preferredSurface,
          allowFallbackToDirect: drawerDraft.allowFallbackToDirect,
          status: drawerDraft.enabled ? "active" : "paused",
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { policy?: unknown; summary?: unknown; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? `Failed to save policy (HTTP ${response.status})`);
      }

      const policy = normalizePolicy(payload?.policy ?? null);
      const summary = normalizeSummary(payload?.summary ?? null);

      if (policy) {
        setPolicyMap((prev) => ({ ...prev, [policy.marketId]: policy }));
        setDrawerDraft(toDraft(policy));
      }
      if (summary && drawerMarketId !== null) {
        setSummaryMap((prev) => ({ ...prev, [drawerMarketId]: summary }));
      }

      setRunMessage("Automation policy saved.");
      await loadPolicies();
      await loadRecentRuns();
    } catch (error: any) {
      setDrawerError(error?.message ?? "Failed to save policy.");
    } finally {
      setDrawerBusy(false);
    }
  }, [drawerDraft, drawerMarketId, isAuthenticated, loadPolicies, loadRecentRuns]);

  const handleRunNow = useCallback(async () => {
    if (drawerMarketId === null) return;
    if (!isAuthenticated) {
      setDrawerError("Sign in to run automation.");
      return;
    }
    if (!canExecuteAutomation) {
      setDrawerError(executionBlockers.join(" "));
      return;
    }

    setRunBusy(true);
    setDrawerError(null);
    setRunMessage(null);

    try {
      const token = await ensureCsrfToken();
      const response = await fetch("/api/automation/runs", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({ marketId: drawerMarketId }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            results?: Array<{
              status?: string;
              reason?: string;
              errorMessage?: string | null;
            }>;
            error?: string;
          }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? `Run failed (HTTP ${response.status})`);
      }

      const result = payload?.results?.[0];
      const reason =
        typeof result?.reason === "string"
          ? result.reason
          : typeof result?.errorMessage === "string"
            ? result.errorMessage
            : "Execution completed.";
      setRunMessage(reason);

      await fetchPolicyRuntime(drawerMarketId);
      await loadPolicies();
      await loadRecentRuns();
      await loadCommentPreviews();
    } catch (error: any) {
      setDrawerError(error?.message ?? "Failed to run automation.");
    } finally {
      setRunBusy(false);
    }
  }, [
    canExecuteAutomation,
    drawerMarketId,
    executionBlockers,
    fetchPolicyRuntime,
    isAuthenticated,
    loadCommentPreviews,
    loadPolicies,
    loadRecentRuns,
  ]);

  const handleOpenBrief = useCallback(
    async (marketId: number) => {
      setBriefOpen(true);
      setBriefLoading(true);
      setBriefError(null);
      setBriefData(null);
      setBriefSummary(null);
      setBriefRuns([]);

      if (!isAuthenticated) {
        setBriefError("Sign in to view Agent Brief confidence and source reliability.");
        setBriefLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/automation/brief?marketId=${marketId}`, {
          credentials: "include",
          cache: "no-store",
        });

        const payload = (await response.json().catch(() => null)) as
          | {
              brief?: unknown;
              summary?: unknown;
              recentRuns?: unknown[];
              error?: string;
            }
          | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? `Failed to load brief (HTTP ${response.status})`);
        }

        const brief = normalizeBrief(payload?.brief ?? null);
        if (!brief) {
          throw new Error("Brief payload is malformed");
        }

        const summary = normalizeSummary(payload?.summary ?? null);
        const runs = Array.isArray(payload?.recentRuns)
          ? payload.recentRuns
              .map((run) => normalizeRun(run))
              .filter((run): run is AutomationRunView => Boolean(run))
          : [];

        setBriefData(brief);
        setBriefSummary(summary);
        setBriefRuns(runs);
      } catch (error: any) {
        setBriefError(error?.message ?? "Failed to load Agent Brief.");
      } finally {
        setBriefLoading(false);
      }
    },
    [isAuthenticated]
  );

  const automationStats = useMemo(() => {
    const entries = Object.values(policyMap).filter(
      (state) => state.enabled && state.status === "active"
    );
    const automatedCount = entries.length;
    const starkZapCount = entries.filter(
      (state) => state.preferredSurface === "starkzap"
    ).length;
    const debatedCount = markets.filter(
      (market) => (predictions[market.id]?.length ?? 0) > 0
    ).length;
    const coveragePct =
      markets.length > 0 ? Math.round((automatedCount / markets.length) * 100) : 0;
    return {
      automatedCount,
      starkZapCount,
      debatedCount,
      coveragePct,
    };
  }, [markets, policyMap, predictions]);

  const overlays = (
    <>
      <MarketAutomationDrawer
        open={drawerMarketId !== null}
        market={selectedMarket}
        draft={drawerDraft}
        summary={
          drawerMarketId !== null ? summaryMap[drawerMarketId] ?? null : null
        }
        nextRunAt={
          drawerMarketId !== null ? policyMap[drawerMarketId]?.nextRunAt ?? null : null
        }
        status={drawerMarketId !== null ? policyMap[drawerMarketId]?.status ?? null : null}
        authenticated={isAuthenticated}
        executionReady={canExecuteAutomation}
        executionBlockers={executionBlockers}
        busy={drawerBusy}
        runBusy={runBusy}
        error={drawerError}
        runMessage={runMessage}
        onClose={() => {
          setDrawerMarketId(null);
          setDrawerError(null);
          setRunMessage(null);
        }}
        onChange={setDrawerDraft}
        onSave={handleSavePolicy}
        onRunNow={handleRunNow}
        onOpenBrief={() => {
          if (drawerMarketId !== null) {
            void handleOpenBrief(drawerMarketId);
          }
        }}
      />

      <AgentBriefPanel
        open={briefOpen}
        brief={briefData}
        summary={briefSummary}
        runs={briefRuns}
        loading={briefLoading}
        error={briefError}
        onClose={() => {
          setBriefOpen(false);
          setBriefError(null);
        }}
      />
    </>
  );

  const controlRail = (
    <section className="mb-4 rounded-2xl border border-white/[0.08] bg-[linear-gradient(135deg,rgba(11,18,36,0.95),rgba(19,25,45,0.95))] p-3.5 sm:p-4 shadow-[0_12px_40px_rgba(2,6,23,0.25)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.15em] text-white/45">
            Agentic Market Ops
          </p>
          <h3 className="mt-1 text-[16px] font-semibold text-white">
            Superforecast + Automation Memory + StarkZap Policies
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
          <span className="rounded-full border border-sky-300/25 bg-sky-400/12 px-2.5 py-1 text-sky-100">
            🧠 Agent Brief
          </span>
          <span className="rounded-full border border-neo-green/25 bg-neo-green/12 px-2.5 py-1 text-neo-green">
            🤖 Per-user Policy Memory
          </span>
          <span className="rounded-full border border-fuchsia-300/25 bg-fuchsia-400/12 px-2.5 py-1 text-fuchsia-100">
            ⚡ Route Selection
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
          <p className="text-[11px] text-white/45">Automated</p>
          <p className="mt-0.5 text-[16px] font-semibold text-white">
            {automationStats.automatedCount}
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
          <p className="text-[11px] text-white/45">Coverage</p>
          <p className="mt-0.5 text-[16px] font-semibold text-white">
            {automationStats.coveragePct}%
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
          <p className="text-[11px] text-white/45">StarkZap</p>
          <p className="mt-0.5 text-[16px] font-semibold text-white">
            {automationStats.starkZapCount}
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
          <p className="text-[11px] text-white/45">Debated</p>
          <p className="mt-0.5 text-[16px] font-semibold text-white">
            {automationStats.debatedCount}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onRunAgentSweep}
          disabled={agentSweepBusy}
          className="rounded-xl border border-cyan-300/35 bg-cyan-400/15 px-3.5 py-2 text-[12px] font-semibold text-cyan-100 transition-colors hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {agentSweepBusy
            ? "Running Agent Sweep..."
            : isAuthenticated
              ? "Run Agent Sweep"
              : "Sign In + Run Sweep"}
        </button>
        <Link
          href="/fleet"
          className="rounded-xl border border-white/[0.15] bg-white/[0.04] px-3.5 py-2 text-[12px] font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.08]"
        >
          Open Fleet
        </Link>
        <p className="text-[11px] text-white/50">
          Schedules execute via persisted policy cadence and backend risk controls.
        </p>
      </div>

      {agentSweepMessage && (
        <p className="mt-2 text-[11px] text-neo-green/90">{agentSweepMessage}</p>
      )}
      {!canExecuteAutomation && (
        <p className="mt-2 text-[11px] text-neo-yellow/90">
          Execution blocked: {executionBlockers[0]}
        </p>
      )}
    </section>
  );

  if (loading) {
    return viewMode === "grid" ? (
      <div>
        {controlRail}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        {overlays}
      </div>
    ) : (
      <div>
        {controlRail}
        <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] overflow-hidden">
          <div className="flex items-center gap-4 px-4 lg:px-5 py-3 border-b border-white/[0.04]">
            <div className="flex-1 min-w-0"><div className="h-3 bg-white/[0.04] rounded w-12" /></div>
            <div className="w-[88px] shrink-0"><div className="h-3 bg-white/[0.04] rounded w-6 ml-auto" /></div>
            <div className="w-[88px] shrink-0"><div className="h-3 bg-white/[0.04] rounded w-6 ml-auto" /></div>
            <div className="hidden sm:block w-[80px] shrink-0"><div className="h-3 bg-white/[0.04] rounded w-10 ml-auto" /></div>
            <div className="hidden md:block w-[48px] shrink-0"><div className="h-3 bg-white/[0.04] rounded w-6 ml-auto" /></div>
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={i > 0 ? "border-t border-white/[0.03]" : ""}><SkeletonRow /></div>
          ))}
        </div>
        {overlays}
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div>
        {controlRail}
        <div className="flex flex-col items-center justify-center py-20 rounded-xl border border-white/[0.04] bg-white/[0.01]">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/[0.05] flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
            </svg>
          </div>
          <p className="text-sm text-white/35 mb-1 font-heading font-semibold">No markets found</p>
          <p className="text-xs text-white/20 mb-5">Try a different category or create a new market</p>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold font-heading text-white/60 bg-white/[0.05] border border-white/[0.06] hover:bg-white/[0.08] disabled:opacity-40 transition-all"
          >
            <svg className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {overlays}
      </div>
    );
  }

  if (viewMode === "grid") {
    return (
      <div>
        {controlRail}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {markets.map((market, i) => (
            <MarketGridCard
              key={market.id}
              market={market}
              predictions={predictions[market.id]}
              weightedProb={weightedProbs[market.id]}
              latestTake={latestTakes[market.id]}
              onBet={onBet}
              onAnalyze={onAnalyze}
              automationState={toAutomationState(policyMap[market.id])}
              routePolicy={
                latestRunMap[market.id]?.routePolicy ??
                fallbackRoutePolicyFromPolicy(policyMap[market.id])
              }
              commentPreview={commentPreviewMap[market.id] ?? null}
              sourceHeartbeat={marketHeartbeatMap[market.id] ?? null}
              onOpenAutomation={handleOpenAutomation}
              onOpenAgentBrief={(marketId) => {
                void handleOpenBrief(marketId);
              }}
              index={i}
            />
          ))}
        </div>
        {overlays}
      </div>
    );
  }

  return (
    <div>
      {controlRail}
      <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] overflow-hidden">
        <div className="flex items-center gap-4 px-4 lg:px-5 py-3 border-b border-white/[0.04] bg-white/[0.01]">
          <div className="flex-1 min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-white/25">Market</span>
          </div>
          <div className="w-[88px] shrink-0 text-right">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neo-green/40">Yes</span>
          </div>
          <div className="w-[88px] shrink-0 text-right">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-red-400/40">No</span>
          </div>
          <div className="hidden sm:block w-[80px] shrink-0 text-right">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-white/25">Volume</span>
          </div>
          <div className="hidden md:block w-[48px] shrink-0 text-right">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-white/25">Ends</span>
          </div>
          <div className="w-3.5 shrink-0 hidden lg:block" />
        </div>
        {markets.map((market, i) => (
          <div key={market.id} className={i > 0 ? "border-t border-white/[0.03]" : ""} style={{ animationDelay: `${Math.min(i * 0.03, 0.3)}s` }}>
            <MarketRow market={market} predictions={predictions[market.id]} weightedProb={weightedProbs[market.id]} latestTake={latestTakes[market.id]} onBet={onBet} />
          </div>
        ))}
      </div>
      {overlays}
    </div>
  );
}
