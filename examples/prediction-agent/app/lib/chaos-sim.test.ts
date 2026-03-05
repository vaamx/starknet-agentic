import { describe, expect, it } from "vitest";
import {
  evaluateChaosSlo,
  runDeterministicChaosSimulation,
} from "./chaos-sim";

describe("chaos-sim", () => {
  it("is deterministic for the same seed and options", () => {
    const a = runDeterministicChaosSimulation({
      seed: 7,
      ticks: 40,
      outageRate: 0.25,
      adversarialPeerRate: 0.45,
    });
    const b = runDeterministicChaosSimulation({
      seed: 7,
      ticks: 40,
      outageRate: 0.25,
      adversarialPeerRate: 0.45,
    });

    expect(a.failover).toEqual(b.failover);
    expect(a.consensus).toEqual(b.consensus);
    expect(a.timeline).toEqual(b.timeline);
  });

  it("produces failover attempts under frequent region outages", () => {
    const result = runDeterministicChaosSimulation({
      seed: 11,
      ticks: 80,
      outageRate: 0.45,
      quarantineSecs: 900,
    });

    expect(result.failover.outageEvents).toBeGreaterThan(0);
    expect(result.failover.attempts).toBeGreaterThan(0);
    expect(result.failover.succeeded + result.failover.noHealthyRegion).toBe(
      result.failover.attempts
    );
  });

  it("triggers consensus clamp guardrail under adversarial pressure", () => {
    const result = runDeterministicChaosSimulation({
      seed: 99,
      ticks: 120,
      peerCount: 10,
      adversarialPeerRate: 0.8,
      maxShift: 0.08,
      minTotalPeerWeight: 1,
    });

    expect(result.consensus.clamped).toBeGreaterThan(0);
    expect(result.consensus.guardrailCounts.delta_clamped).toBeGreaterThan(0);
    expect(result.consensus.maxAbsDeltaPct).toBeLessThanOrEqual(8.0001);
  });

  it("evaluates SLO constraints", () => {
    const result = runDeterministicChaosSimulation({
      seed: 5,
      ticks: 100,
    });

    const strict = evaluateChaosSlo(result, {
      minFailoverSuccessRate: 0.99,
      maxConsensusBlockRate: 0.01,
    });
    expect(strict.ok).toBe(false);

    const relaxed = evaluateChaosSlo(result, {
      minFailoverSuccessRate: 0.2,
      maxConsensusBlockRate: 0.9,
      maxConsensusAvgAbsDeltaPct: 20,
    });
    expect(relaxed.ok).toBe(true);
  });
});
