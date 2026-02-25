import { describe, expect, it, beforeEach } from "vitest";
import {
  deriveConsensusAutotuneProfile,
  resetConsensusAutotuneState,
} from "./consensus-autotune";

describe("consensus-autotune", () => {
  beforeEach(() => {
    resetConsensusAutotuneState();
  });

  it("keeps baseline guardrails until min samples are collected", () => {
    for (let i = 0; i < 4; i += 1) {
      const profile = deriveConsensusAutotuneProfile({
        agentKey: "0xabc",
        leadBrierScore: 0.12 + i * 0.002,
        baseMinPeers: 1,
        baseMinPeerPredictionCount: 3,
        baseMinTotalPeerWeight: 2,
        baseMaxShift: 0.15,
        policy: {
          enabled: true,
          minSamples: 6,
          windowSize: 24,
          driftLow: 0.01,
          driftHigh: 0.08,
          maxShiftFloor: 0.05,
          minPeersCap: 4,
          minPeerPredictionCountCap: 8,
          minTotalPeerWeightCap: 12,
        },
      });

      expect(profile.minPeers).toBe(1);
      expect(profile.minPeerPredictionCount).toBe(3);
      expect(profile.minTotalPeerWeight).toBe(2);
      expect(profile.maxShift).toBe(0.15);
      expect(profile.reason).toBe("insufficient_samples");
    }
  });

  it("tightens guardrails under high rolling brier drift", () => {
    let final = deriveConsensusAutotuneProfile({
      agentKey: "0xdrift",
      leadBrierScore: 0.05,
      baseMinPeers: 1,
      baseMinPeerPredictionCount: 3,
      baseMinTotalPeerWeight: 2,
      baseMaxShift: 0.15,
      policy: {
        enabled: true,
        minSamples: 6,
        windowSize: 24,
        driftLow: 0.01,
        driftHigh: 0.08,
        maxShiftFloor: 0.05,
        minPeersCap: 4,
        minPeerPredictionCountCap: 8,
        minTotalPeerWeightCap: 12,
      },
    });

    const noisySeries = [0.3, 0.07, 0.31, 0.09, 0.29, 0.08, 0.28];
    for (const score of noisySeries) {
      final = deriveConsensusAutotuneProfile({
        agentKey: "0xdrift",
        leadBrierScore: score,
        baseMinPeers: 1,
        baseMinPeerPredictionCount: 3,
        baseMinTotalPeerWeight: 2,
        baseMaxShift: 0.15,
        policy: {
          enabled: true,
          minSamples: 6,
          windowSize: 24,
          driftLow: 0.01,
          driftHigh: 0.08,
          maxShiftFloor: 0.05,
          minPeersCap: 4,
          minPeerPredictionCountCap: 8,
          minTotalPeerWeightCap: 12,
        },
      });
    }

    expect(final.sampleCount).toBeGreaterThanOrEqual(6);
    expect(final.reason).toBeUndefined();
    expect(final.normalizedDrift).toBeGreaterThan(0.5);
    expect(final.minPeers).toBeGreaterThan(1);
    expect(final.minPeerPredictionCount).toBeGreaterThan(3);
    expect(final.minTotalPeerWeight).toBeGreaterThan(2);
    expect(final.maxShift).toBeLessThan(0.15);
  });

  it("supports disabled mode while still tracking samples", () => {
    const profile = deriveConsensusAutotuneProfile({
      agentKey: "0xoff",
      leadBrierScore: 0.2,
      baseMinPeers: 1,
      baseMinPeerPredictionCount: 3,
      baseMinTotalPeerWeight: 2,
      baseMaxShift: 0.15,
      policy: {
        enabled: false,
        minSamples: 6,
        windowSize: 24,
        driftLow: 0.01,
        driftHigh: 0.08,
        maxShiftFloor: 0.05,
        minPeersCap: 4,
        minPeerPredictionCountCap: 8,
        minTotalPeerWeightCap: 12,
      },
    });

    expect(profile.enabled).toBe(false);
    expect(profile.sampleCount).toBe(1);
    expect(profile.reason).toBe("disabled");
    expect(profile.maxShift).toBe(0.15);
  });
});
