import { config } from "./config";

export interface ConsensusAutotunePolicy {
  enabled: boolean;
  windowSize: number;
  minSamples: number;
  driftLow: number;
  driftHigh: number;
  maxShiftFloor: number;
  minPeersCap: number;
  minPeerPredictionCountCap: number;
  minTotalPeerWeightCap: number;
}

export interface ConsensusAutotuneProfile {
  enabled: boolean;
  sampleCount: number;
  drift: number;
  normalizedDrift: number;
  minPeers: number;
  minPeerPredictionCount: number;
  minTotalPeerWeight: number;
  maxShift: number;
  reason?: "disabled" | "insufficient_samples";
}

const BRIER_HISTORY = new Map<string, number[]>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeAgentKey(raw: string | undefined): string {
  const normalized = String(raw ?? "").trim().toLowerCase();
  return normalized || "default";
}

function normalizeBrier(value: number | null | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  return clamp(value as number, 0, 1);
}

function computeRollingDrift(samples: number[]): number {
  if (samples.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < samples.length; i += 1) {
    total += Math.abs(samples[i] - samples[i - 1]);
  }
  return total / (samples.length - 1);
}

function normalizeDrift(drift: number, low: number, high: number): number {
  const lo = Math.max(0, low);
  const hi = Math.max(lo + 0.0001, high);
  return clamp((drift - lo) / (hi - lo), 0, 1);
}

function pushSample(
  history: number[],
  sample: number | null,
  windowSize: number
): number[] {
  const next = [...history];
  if (sample !== null) {
    next.push(sample);
  }
  const keep = Math.max(2, windowSize);
  return next.slice(-keep);
}

function intClamp(value: number, min: number, max: number): number {
  return Math.floor(clamp(value, min, max));
}

export function getConsensusAutotunePolicy(): ConsensusAutotunePolicy {
  return {
    enabled: config.agentConsensusAutotuneEnabled,
    windowSize: config.agentConsensusAutotuneWindow,
    minSamples: config.agentConsensusAutotuneMinSamples,
    driftLow: config.agentConsensusAutotuneDriftLow,
    driftHigh: config.agentConsensusAutotuneDriftHigh,
    maxShiftFloor: config.agentConsensusAutotuneMaxShiftFloor,
    minPeersCap: config.agentConsensusAutotuneMinPeersCap,
    minPeerPredictionCountCap: config.agentConsensusAutotuneMinPeerPredictionsCap,
    minTotalPeerWeightCap: config.agentConsensusAutotuneMinTotalPeerWeightCap,
  };
}

export function resetConsensusAutotuneState(): void {
  BRIER_HISTORY.clear();
}

export function deriveConsensusAutotuneProfile(args: {
  agentKey?: string;
  leadBrierScore?: number | null;
  baseMinPeers: number;
  baseMinPeerPredictionCount: number;
  baseMinTotalPeerWeight: number;
  baseMaxShift: number;
  policy?: Partial<ConsensusAutotunePolicy>;
}): ConsensusAutotuneProfile {
  const baseMinPeers = Math.max(0, Math.floor(args.baseMinPeers));
  const baseMinPeerPredictionCount = Math.max(
    1,
    Math.floor(args.baseMinPeerPredictionCount)
  );
  const baseMinTotalPeerWeight = Math.max(0, args.baseMinTotalPeerWeight);
  const baseMaxShift = clamp(args.baseMaxShift, 0, 0.49);

  const baseProfile: ConsensusAutotuneProfile = {
    enabled: false,
    sampleCount: 0,
    drift: 0,
    normalizedDrift: 0,
    minPeers: baseMinPeers,
    minPeerPredictionCount: baseMinPeerPredictionCount,
    minTotalPeerWeight: baseMinTotalPeerWeight,
    maxShift: baseMaxShift,
  };

  const policy: ConsensusAutotunePolicy = {
    ...getConsensusAutotunePolicy(),
    ...(args.policy ?? {}),
  };

  const key = safeAgentKey(args.agentKey);
  const prevHistory = BRIER_HISTORY.get(key) ?? [];
  const history = pushSample(
    prevHistory,
    normalizeBrier(args.leadBrierScore),
    policy.windowSize
  );
  BRIER_HISTORY.set(key, history);

  if (!policy.enabled) {
    return {
      ...baseProfile,
      sampleCount: history.length,
      reason: "disabled",
    };
  }

  if (history.length < Math.max(2, policy.minSamples)) {
    return {
      ...baseProfile,
      enabled: true,
      sampleCount: history.length,
      reason: "insufficient_samples",
    };
  }

  const drift = computeRollingDrift(history);
  const normalized = normalizeDrift(drift, policy.driftLow, policy.driftHigh);

  const minPeersCap = Math.max(baseMinPeers, policy.minPeersCap);
  const minPeerPredCap = Math.max(
    baseMinPeerPredictionCount,
    policy.minPeerPredictionCountCap
  );
  const minPeerWeightCap = Math.max(
    baseMinTotalPeerWeight,
    policy.minTotalPeerWeightCap
  );

  const minPeers = intClamp(
    Math.round(baseMinPeers + normalized * (minPeersCap - baseMinPeers)),
    baseMinPeers,
    minPeersCap
  );
  const minPeerPredictionCount = intClamp(
    Math.round(
      baseMinPeerPredictionCount +
        normalized * (minPeerPredCap - baseMinPeerPredictionCount)
    ),
    baseMinPeerPredictionCount,
    minPeerPredCap
  );
  const minTotalPeerWeight = clamp(
    baseMinTotalPeerWeight +
      normalized * (minPeerWeightCap - baseMinTotalPeerWeight),
    baseMinTotalPeerWeight,
    minPeerWeightCap
  );

  // High drift tightens shift allowance, low drift keeps baseline max shift.
  const maxShift = clamp(
    baseMaxShift * (1 - normalized * 0.5),
    clamp(policy.maxShiftFloor, 0, baseMaxShift),
    baseMaxShift
  );

  return {
    enabled: true,
    sampleCount: history.length,
    drift,
    normalizedDrift: normalized,
    minPeers,
    minPeerPredictionCount,
    minTotalPeerWeight,
    maxShift,
  };
}
