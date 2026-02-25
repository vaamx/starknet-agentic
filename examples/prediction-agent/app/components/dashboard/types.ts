import type { MarketCategory } from "@/lib/categories";
export type { MarketCategory } from "@/lib/categories";

export interface Market {
  id: number;
  question: string;
  address: string;
  oracle: string;
  impliedProbYes: number;
  impliedProbNo: number;
  totalPool: string;
  yesPool: string;
  noPool: string;
  status: number;
  resolutionTime: number;
  feeBps: number;
  collateralToken: string;
  tradeCount?: number;
}

export interface LeaderboardEntry {
  agent: string;
  avgBrier: number;
  predictionCount: number;
  rank: number;
  identity?: {
    name: string;
    agentType: string;
    model: string;
    reputationScore: number;
    feedbackCount: number;
    framework?: string;
    a2aEndpoint?: string;
    moltbookId?: string;
  } | null;
}

export interface AgentPrediction {
  agent: string;
  marketId: number;
  predictedProb: number;
  brierScore: number;
  predictionCount: number;
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

export interface AgentMetricsSnapshot {
  generatedAt: number;
  actions: {
    windowSize: number;
    errorRate: number;
  };
  consensus: {
    sampleCount: number;
    appliedCount: number;
    blockedCount: number;
    avgAbsDeltaPct: number;
    autotuneSampleCount: number;
    avgAutotuneDrift: number;
    avgAutotuneNormalizedDrift: number;
    guardrailCounts: {
      insufficient_peer_count: number;
      insufficient_peer_weight: number;
      delta_clamped: number;
    };
  };
  runtime: {
    activeRuntimes: number;
    maxFailoverCount: number;
    quarantinedRegionCount: number;
    events: {
      failedOver: number;
      heartbeatError: number;
      terminated: number;
    };
    quarantinedRegions: Array<{
      region: string;
      remainingSecs: number;
      impactedAgents: number;
    }>;
  };
}

export interface LatestAgentTake {
  agentName: string;
  probability: number;
  reasoning: string;
  timestamp: number;
}

export type SortMode = "volume" | "ending" | "disagreement";

export interface CategoryTab {
  id: MarketCategory;
  label: string;
  count: number;
}
