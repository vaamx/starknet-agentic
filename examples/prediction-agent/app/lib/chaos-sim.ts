import { selectFailoverRegions } from "./child-runtime";
import {
  computeBrierWeightedConsensus,
  type ConsensusGuardrailReason,
} from "./consensus-weighting";
import type { AgentPrediction } from "./market-reader";

export interface ChaosSimulationOptions {
  seed: number;
  ticks: number;
  tickMs: number;
  regions: string[];
  initialRegion: string;
  outageRate: number;
  adversarialPeerRate: number;
  sparsePeerRate: number;
  peerCount: number;
  minPeers: number;
  minPeerPredictionCount: number;
  minTotalPeerWeight: number;
  brierFloor: number;
  leadWeightMultiplier: number;
  maxShift: number;
  quarantineSecs: number;
}

export interface ChaosTickSummary {
  tick: number;
  region: string;
  outageRegions: string[];
  failoverOccurred: boolean;
  failoverTarget?: string;
  consensusApplied: boolean;
  consensusGuardrail: ConsensusGuardrailReason | null;
  consensusPeerCount: number;
  consensusDeltaPct: number;
}

export interface ChaosSimulationResult {
  options: ChaosSimulationOptions;
  failover: {
    outageEvents: number;
    attempts: number;
    succeeded: number;
    noHealthyRegion: number;
    quarantinedRegionSkips: number;
    successRate: number;
    finalRegion: string;
  };
  consensus: {
    samples: number;
    applied: number;
    blocked: number;
    clamped: number;
    guardrailCounts: Record<ConsensusGuardrailReason, number>;
    avgAbsDeltaPct: number;
    maxAbsDeltaPct: number;
  };
  timeline: ChaosTickSummary[];
}

export interface ChaosSlo {
  minFailoverSuccessRate?: number;
  maxConsensusBlockRate?: number;
  maxConsensusAvgAbsDeltaPct?: number;
}

export interface ChaosSloResult {
  ok: boolean;
  checks: Array<{
    name: string;
    ok: boolean;
    actual: number;
    expected: number;
  }>;
}

const GUARDRAIL_REASONS: ConsensusGuardrailReason[] = [
  "insufficient_peer_count",
  "insufficient_peer_weight",
  "delta_clamped",
];

const DEFAULT_OPTIONS: ChaosSimulationOptions = {
  seed: 20260224,
  ticks: 180,
  tickMs: 60_000,
  regions: ["iad", "sfo", "fra"],
  initialRegion: "iad",
  outageRate: 0.22,
  adversarialPeerRate: 0.4,
  sparsePeerRate: 0.2,
  peerCount: 8,
  minPeers: 1,
  minPeerPredictionCount: 3,
  minTotalPeerWeight: 2,
  brierFloor: 0.05,
  leadWeightMultiplier: 1.0,
  maxShift: 0.15,
  quarantineSecs: 600,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeProbability(value: number): number {
  return clamp(value, 0, 1);
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function nextInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function mergeOptions(
  overrides: Partial<ChaosSimulationOptions> | undefined
): ChaosSimulationOptions {
  const merged: ChaosSimulationOptions = {
    seed: overrides?.seed ?? DEFAULT_OPTIONS.seed,
    ticks: overrides?.ticks ?? DEFAULT_OPTIONS.ticks,
    tickMs: overrides?.tickMs ?? DEFAULT_OPTIONS.tickMs,
    regions: overrides?.regions ?? DEFAULT_OPTIONS.regions,
    initialRegion: overrides?.initialRegion ?? DEFAULT_OPTIONS.initialRegion,
    outageRate: overrides?.outageRate ?? DEFAULT_OPTIONS.outageRate,
    adversarialPeerRate:
      overrides?.adversarialPeerRate ?? DEFAULT_OPTIONS.adversarialPeerRate,
    sparsePeerRate: overrides?.sparsePeerRate ?? DEFAULT_OPTIONS.sparsePeerRate,
    peerCount: overrides?.peerCount ?? DEFAULT_OPTIONS.peerCount,
    minPeers: overrides?.minPeers ?? DEFAULT_OPTIONS.minPeers,
    minPeerPredictionCount:
      overrides?.minPeerPredictionCount ?? DEFAULT_OPTIONS.minPeerPredictionCount,
    minTotalPeerWeight:
      overrides?.minTotalPeerWeight ?? DEFAULT_OPTIONS.minTotalPeerWeight,
    brierFloor: overrides?.brierFloor ?? DEFAULT_OPTIONS.brierFloor,
    leadWeightMultiplier:
      overrides?.leadWeightMultiplier ?? DEFAULT_OPTIONS.leadWeightMultiplier,
    maxShift: overrides?.maxShift ?? DEFAULT_OPTIONS.maxShift,
    quarantineSecs: overrides?.quarantineSecs ?? DEFAULT_OPTIONS.quarantineSecs,
  };
  const regions = (merged.regions ?? []).filter((r) => r.trim().length > 0);
  const initialRegion = regions.includes(merged.initialRegion)
    ? merged.initialRegion
    : regions[0] ?? DEFAULT_OPTIONS.initialRegion;

  return {
    ...merged,
    regions: regions.length > 0 ? regions : [...DEFAULT_OPTIONS.regions],
    initialRegion,
    ticks: Math.max(1, Math.floor(merged.ticks)),
    tickMs: Math.max(1000, Math.floor(merged.tickMs)),
    outageRate: clamp(merged.outageRate, 0, 1),
    adversarialPeerRate: clamp(merged.adversarialPeerRate, 0, 1),
    sparsePeerRate: clamp(merged.sparsePeerRate, 0, 1),
    peerCount: Math.max(1, Math.floor(merged.peerCount)),
    minPeers: Math.max(0, Math.floor(merged.minPeers)),
    minPeerPredictionCount: Math.max(1, Math.floor(merged.minPeerPredictionCount)),
    minTotalPeerWeight: Math.max(0, merged.minTotalPeerWeight),
    brierFloor: Math.max(0.001, merged.brierFloor),
    leadWeightMultiplier: Math.max(0.1, merged.leadWeightMultiplier),
    maxShift: clamp(merged.maxShift, 0, 0.49),
    quarantineSecs: Math.max(0, Math.floor(merged.quarantineSecs)),
  };
}

function upsertRegionFailure(
  entries: Array<{ region: string; failedAt: number }>,
  region: string,
  failedAt: number
): Array<{ region: string; failedAt: number }> {
  const normalized = region.trim().toLowerCase();
  if (!normalized) return entries;
  const next = entries.slice(-24);
  const index = next.findIndex((entry) => entry.region === normalized);
  if (index >= 0) {
    next[index] = { region: normalized, failedAt };
  } else {
    next.push({ region: normalized, failedAt });
  }
  return next.slice(-24);
}

function orderedFailoverRegions(regions: string[], currentRegion: string): string[] {
  if (regions.length === 0) return [];
  const idx = regions.findIndex((r) => r === currentRegion);
  if (idx < 0) return [...regions];
  return [...regions.slice(idx + 1), ...regions.slice(0, idx + 1)];
}

function generatePeerPredictions(args: {
  rng: () => number;
  tick: number;
  leadProbability: number;
  peerCount: number;
  adversarialPeerRate: number;
  sparsePeerRate: number;
}): AgentPrediction[] {
  const peers: AgentPrediction[] = [];
  for (let i = 0; i < args.peerCount; i += 1) {
    const adversarial = args.rng() < args.adversarialPeerRate;
    const sparse = args.rng() < args.sparsePeerRate;

    const probability = adversarial
      ? normalizeProbability(1 - args.leadProbability + (args.rng() - 0.5) * 0.12)
      : normalizeProbability(args.leadProbability + (args.rng() - 0.5) * 0.3);

    const brierScore = adversarial
      ? 0.35 + args.rng() * 0.25
      : 0.06 + args.rng() * 0.2;

    const predictionCount = sparse
      ? nextInt(args.rng, 1, 2)
      : adversarial
        ? nextInt(args.rng, 10, 60)
        : nextInt(args.rng, 3, 30);

    peers.push({
      agent: `peer_${args.tick}_${i}`,
      marketId: args.tick,
      predictedProb: probability,
      brierScore,
      predictionCount,
    });
  }
  return peers;
}

export function runDeterministicChaosSimulation(
  overrides?: Partial<ChaosSimulationOptions>
): ChaosSimulationResult {
  const options = mergeOptions(overrides);
  const rng = createRng(options.seed);

  let region = options.initialRegion;
  let regionFailureLog: Array<{ region: string; failedAt: number }> = [];

  const guardrailCounts = GUARDRAIL_REASONS.reduce(
    (acc, reason) => {
      acc[reason] = 0;
      return acc;
    },
    {} as Record<ConsensusGuardrailReason, number>
  );

  let failoverOutageEvents = 0;
  let failoverAttempts = 0;
  let failoverSucceeded = 0;
  let failoverNoHealthyRegion = 0;
  let failoverQuarantineSkips = 0;

  let consensusApplied = 0;
  let consensusBlocked = 0;
  let consensusClamped = 0;
  let consensusAbsDeltaTotal = 0;
  let consensusAbsDeltaMax = 0;

  const timeline: ChaosTickSummary[] = [];

  for (let tick = 1; tick <= options.ticks; tick += 1) {
    const nowMs = tick * options.tickMs;
    const outageRegions = options.regions.filter(() => rng() < options.outageRate);
    const outageSet = new Set(outageRegions);

    let failoverOccurred = false;
    let failoverTarget: string | undefined;

    if (outageSet.has(region)) {
      failoverOutageEvents += 1;
      failoverAttempts += 1;
      regionFailureLog = upsertRegionFailure(regionFailureLog, region, nowMs);

      const baseOrder = orderedFailoverRegions(options.regions, region);
      const order = selectFailoverRegions({
        regions: options.regions,
        currentRegion: region,
        regionFailureLog,
        quarantineSecs: options.quarantineSecs,
        nowMs,
      });
      failoverQuarantineSkips += Math.max(0, baseOrder.length - order.length);

      const nextRegion = order.find((candidate) => !outageSet.has(candidate));
      if (nextRegion) {
        if (nextRegion !== region) {
          failoverSucceeded += 1;
          failoverOccurred = true;
          failoverTarget = nextRegion;
          region = nextRegion;
        }
      } else {
        failoverNoHealthyRegion += 1;
      }
    }

    const leadProbability = normalizeProbability(0.25 + rng() * 0.5);
    const peers = generatePeerPredictions({
      rng,
      tick,
      leadProbability,
      peerCount: options.peerCount,
      adversarialPeerRate: options.adversarialPeerRate,
      sparsePeerRate: options.sparsePeerRate,
    });

    const consensus = computeBrierWeightedConsensus({
      leadAgent: `lead_${tick}`,
      leadProbability,
      leadBrierScore: 0.12 + rng() * 0.12,
      leadPredictionCount: nextInt(rng, 10, 80),
      peerPredictions: peers,
      maxPeers: options.peerCount,
      minPeers: options.minPeers,
      minPeerPredictionCount: options.minPeerPredictionCount,
      minTotalPeerWeight: options.minTotalPeerWeight,
      maxShift: options.maxShift,
      brierFloor: options.brierFloor,
      leadWeightMultiplier: options.leadWeightMultiplier,
    });

    if (consensus.applied) {
      consensusApplied += 1;
    } else {
      consensusBlocked += 1;
    }
    if (consensus.guardrailReason) {
      guardrailCounts[consensus.guardrailReason] += 1;
    }
    if (consensus.guardrailReason === "delta_clamped") {
      consensusClamped += 1;
    }

    const absDelta = Math.abs(consensus.deltaFromLead);
    consensusAbsDeltaTotal += absDelta;
    consensusAbsDeltaMax = Math.max(consensusAbsDeltaMax, absDelta);

    timeline.push({
      tick,
      region,
      outageRegions,
      failoverOccurred,
      failoverTarget,
      consensusApplied: consensus.applied,
      consensusGuardrail: consensus.guardrailReason ?? null,
      consensusPeerCount: consensus.usedPeerCount,
      consensusDeltaPct: Number((consensus.deltaFromLead * 100).toFixed(4)),
    });
  }

  return {
    options,
    failover: {
      outageEvents: failoverOutageEvents,
      attempts: failoverAttempts,
      succeeded: failoverSucceeded,
      noHealthyRegion: failoverNoHealthyRegion,
      quarantinedRegionSkips: failoverQuarantineSkips,
      successRate:
        failoverAttempts > 0 ? Number((failoverSucceeded / failoverAttempts).toFixed(4)) : 1,
      finalRegion: region,
    },
    consensus: {
      samples: options.ticks,
      applied: consensusApplied,
      blocked: consensusBlocked,
      clamped: consensusClamped,
      guardrailCounts,
      avgAbsDeltaPct: Number(((consensusAbsDeltaTotal / options.ticks) * 100).toFixed(4)),
      maxAbsDeltaPct: Number((consensusAbsDeltaMax * 100).toFixed(4)),
    },
    timeline,
  };
}

export function evaluateChaosSlo(
  result: ChaosSimulationResult,
  slo?: ChaosSlo
): ChaosSloResult {
  const checks: ChaosSloResult["checks"] = [];

  if (typeof slo?.minFailoverSuccessRate === "number") {
    checks.push({
      name: "min_failover_success_rate",
      ok: result.failover.successRate >= slo.minFailoverSuccessRate,
      actual: result.failover.successRate,
      expected: slo.minFailoverSuccessRate,
    });
  }

  if (typeof slo?.maxConsensusBlockRate === "number") {
    const blockRate =
      result.consensus.samples > 0
        ? result.consensus.blocked / result.consensus.samples
        : 0;
    checks.push({
      name: "max_consensus_block_rate",
      ok: blockRate <= slo.maxConsensusBlockRate,
      actual: Number(blockRate.toFixed(4)),
      expected: slo.maxConsensusBlockRate,
    });
  }

  if (typeof slo?.maxConsensusAvgAbsDeltaPct === "number") {
    checks.push({
      name: "max_consensus_avg_abs_delta_pct",
      ok: result.consensus.avgAbsDeltaPct <= slo.maxConsensusAvgAbsDeltaPct,
      actual: result.consensus.avgAbsDeltaPct,
      expected: slo.maxConsensusAvgAbsDeltaPct,
    });
  }

  const ok = checks.every((check) => check.ok);
  return { ok, checks };
}
