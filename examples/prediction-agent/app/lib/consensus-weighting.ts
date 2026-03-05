import type { AgentPrediction } from "./market-reader";

export type ConsensusGuardrailReason =
  | "insufficient_peer_count"
  | "insufficient_peer_weight"
  | "delta_clamped";

export interface ConsensusWeightEntry {
  agent: string;
  role: "lead" | "peer";
  probability: number;
  brierScore: number;
  predictionCount: number;
  weight: number;
}

export interface BrierConsensusResult {
  probability: number;
  leadProbability: number;
  deltaFromLead: number;
  usedPeerCount: number;
  peerWeightTotal: number;
  applied: boolean;
  guardrailReason?: ConsensusGuardrailReason;
  entries: ConsensusWeightEntry[];
}

function normalizeAddress(address: string | undefined): string {
  return (address ?? "").trim().toLowerCase();
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function safeCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

/**
 * Brier-to-weight transform: lower Brier and higher sample count increase weight.
 */
export function computeBrierWeight(
  brierScore: number,
  predictionCount: number,
  brierFloor: number
): number {
  const safeFloor = Math.max(0.001, brierFloor);
  const safeBrier = Math.max(safeFloor, Number.isFinite(brierScore) ? brierScore : 1);
  return (1 / safeBrier) * Math.sqrt(safeCount(predictionCount));
}

export function computeBrierWeightedConsensus(args: {
  leadAgent: string;
  leadProbability: number;
  leadBrierScore?: number | null;
  leadPredictionCount?: number;
  peerPredictions: AgentPrediction[];
  selfAddress?: string;
  maxPeers?: number;
  minPeers?: number;
  minPeerPredictionCount?: number;
  minTotalPeerWeight?: number;
  brierFloor?: number;
  leadWeightMultiplier?: number;
  maxShift?: number;
}): BrierConsensusResult {
  const safeLeadProb = clampProbability(args.leadProbability);
  const brierFloor = Math.max(0.001, args.brierFloor ?? 0.05);
  const leadMultiplier = Math.max(0.1, args.leadWeightMultiplier ?? 1);
  const minPeers = Math.max(0, Math.floor(args.minPeers ?? 1));
  const minPeerPredictionCount = Math.max(
    1,
    Math.floor(args.minPeerPredictionCount ?? 1)
  );
  const minTotalPeerWeight = Math.max(0, args.minTotalPeerWeight ?? 0);
  const maxShift = Math.max(0, Math.min(0.49, args.maxShift ?? 0.49));
  const normalizedSelf = normalizeAddress(args.selfAddress);
  const maxPeers = Math.max(0, Math.floor(args.maxPeers ?? 8));

  const peers = (Array.isArray(args.peerPredictions) ? args.peerPredictions : [])
    .filter((p) => {
      if (!Number.isFinite(p.predictedProb)) return false;
      if (normalizedSelf && normalizeAddress(p.agent) === normalizedSelf) return false;
      if (safeCount(p.predictionCount) < minPeerPredictionCount) return false;
      return true;
    })
    .map((p) => {
      const probability = clampProbability(p.predictedProb);
      const brierScore = Number.isFinite(p.brierScore) ? p.brierScore : 1;
      const predictionCount = safeCount(p.predictionCount);
      return {
        agent: p.agent,
        role: "peer" as const,
        probability,
        brierScore,
        predictionCount,
        weight: computeBrierWeight(brierScore, predictionCount, brierFloor),
      };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxPeers);

  const leadBrierScore =
    Number.isFinite(args.leadBrierScore) && (args.leadBrierScore as number) > 0
      ? (args.leadBrierScore as number)
      : 1;
  const leadPredictionCount = safeCount(args.leadPredictionCount ?? 1);
  const leadWeight =
    computeBrierWeight(leadBrierScore, leadPredictionCount, brierFloor) *
    leadMultiplier;

  const peerWeightTotal = peers.reduce((sum, p) => sum + p.weight, 0);

  const entries: ConsensusWeightEntry[] = [
    {
      agent: args.leadAgent,
      role: "lead",
      probability: safeLeadProb,
      brierScore: leadBrierScore,
      predictionCount: leadPredictionCount,
      weight: leadWeight,
    },
    ...peers,
  ];

  if (peers.length < minPeers) {
    return {
      probability: safeLeadProb,
      leadProbability: safeLeadProb,
      deltaFromLead: 0,
      usedPeerCount: peers.length,
      peerWeightTotal,
      applied: false,
      guardrailReason: "insufficient_peer_count",
      entries,
    };
  }

  if (peerWeightTotal < minTotalPeerWeight) {
    return {
      probability: safeLeadProb,
      leadProbability: safeLeadProb,
      deltaFromLead: 0,
      usedPeerCount: peers.length,
      peerWeightTotal,
      applied: false,
      guardrailReason: "insufficient_peer_weight",
      entries,
    };
  }

  const weightedSum = entries.reduce((sum, e) => sum + e.probability * e.weight, 0);
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  const unclampedProbability =
    totalWeight > 0 ? clampProbability(weightedSum / totalWeight) : safeLeadProb;
  const unclampedDelta = unclampedProbability - safeLeadProb;
  let consensusProbability = unclampedProbability;
  let guardrailReason: ConsensusGuardrailReason | undefined;

  if (Math.abs(unclampedDelta) > maxShift) {
    consensusProbability = clampProbability(
      safeLeadProb + Math.sign(unclampedDelta) * maxShift
    );
    guardrailReason = "delta_clamped";
  }

  const finalDelta = consensusProbability - safeLeadProb;

  return {
    probability: consensusProbability,
    leadProbability: safeLeadProb,
    deltaFromLead: finalDelta,
    usedPeerCount: peers.length,
    peerWeightTotal,
    applied: Math.abs(finalDelta) >= 0.001,
    guardrailReason,
    entries,
  };
}
