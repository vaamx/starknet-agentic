import { describe, expect, it } from "vitest";
import { computeBrierWeight, computeBrierWeightedConsensus } from "./consensus-weighting";
import type { AgentPrediction } from "./market-reader";

function peer(
  agent: string,
  predictedProb: number,
  brierScore: number,
  predictionCount: number
): AgentPrediction {
  return {
    agent,
    marketId: 1,
    predictedProb,
    brierScore,
    predictionCount,
  };
}

describe("consensus-weighting", () => {
  it("assigns higher weight to lower brier at equal sample count", () => {
    const strong = computeBrierWeight(0.08, 16, 0.05);
    const weak = computeBrierWeight(0.35, 16, 0.05);
    expect(strong).toBeGreaterThan(weak);
  });

  it("falls back to lead probability when no peers are available", () => {
    const result = computeBrierWeightedConsensus({
      leadAgent: "alpha",
      leadProbability: 0.63,
      peerPredictions: [],
    });

    expect(result.probability).toBe(0.63);
    expect(result.usedPeerCount).toBe(0);
    expect(result.applied).toBe(false);
    expect(result.guardrailReason).toBe("insufficient_peer_count");
    expect(result.entries).toHaveLength(1);
  });

  it("excludes self-address peers and adjusts toward high-weight peers", () => {
    const result = computeBrierWeightedConsensus({
      leadAgent: "alpha",
      leadProbability: 0.6,
      leadBrierScore: 0.2,
      leadPredictionCount: 25,
      selfAddress: "0xself",
      peerPredictions: [
        peer("0xself", 0.95, 0.05, 100), // excluded
        peer("0xpeer1", 0.3, 0.08, 100), // strong
        peer("0xpeer2", 0.7, 0.5, 4), // weak
      ],
    });

    expect(result.usedPeerCount).toBe(2);
    expect(result.probability).toBeLessThan(0.6);
    expect(result.entries.some((e) => e.agent === "0xself")).toBe(false);
  });

  it("respects maxPeers by taking highest-weight peers first", () => {
    const result = computeBrierWeightedConsensus({
      leadAgent: "alpha",
      leadProbability: 0.5,
      maxPeers: 1,
      peerPredictions: [
        peer("0xlow", 0.2, 0.7, 2),
        peer("0xhigh", 0.8, 0.06, 40),
      ],
    });

    expect(result.usedPeerCount).toBe(1);
    expect(result.entries.some((e) => e.agent === "0xhigh")).toBe(true);
    expect(result.entries.some((e) => e.agent === "0xlow")).toBe(false);
  });

  it("enforces minimum peer prediction count and peer threshold", () => {
    const result = computeBrierWeightedConsensus({
      leadAgent: "alpha",
      leadProbability: 0.52,
      minPeers: 2,
      minPeerPredictionCount: 10,
      peerPredictions: [
        peer("0xpeer1", 0.2, 0.07, 3), // filtered by sample count
        peer("0xpeer2", 0.8, 0.08, 12), // only one valid peer
      ],
    });

    expect(result.probability).toBe(0.52);
    expect(result.usedPeerCount).toBe(1);
    expect(result.applied).toBe(false);
    expect(result.guardrailReason).toBe("insufficient_peer_count");
  });

  it("clamps excessive consensus shifts", () => {
    const result = computeBrierWeightedConsensus({
      leadAgent: "alpha",
      leadProbability: 0.5,
      maxShift: 0.1,
      minPeers: 1,
      peerPredictions: [peer("0xpeer1", 0.95, 0.01, 100)],
    });

    expect(result.applied).toBe(true);
    expect(result.guardrailReason).toBe("delta_clamped");
    expect(result.probability).toBeCloseTo(0.6, 6);
  });
});
