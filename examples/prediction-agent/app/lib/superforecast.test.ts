import { describe, expect, it } from "vitest";
import { buildSuperforecastConsensus } from "./superforecast";

describe("superforecast consensus", () => {
  it("weights lower-brier agents more heavily", () => {
    const consensus = buildSuperforecastConsensus(
      [
        {
          id: "alpha",
          name: "Alpha",
          probability: 0.7,
          brierScore: 0.09,
          confidence: 0.8,
          sourceQuality: 0.8,
        },
        {
          id: "beta",
          name: "Beta",
          probability: 0.3,
          brierScore: 0.35,
          confidence: 0.8,
          sourceQuality: 0.8,
        },
      ],
      0.5
    );

    expect(consensus.weightedProbability).toBeGreaterThan(0.55);
    expect(consensus.agents.find((a) => a.id === "alpha")?.weight).toBeGreaterThan(
      consensus.agents.find((a) => a.id === "beta")?.weight ?? 0
    );
  });

  it("returns bounded intervals and ordered scenarios", () => {
    const consensus = buildSuperforecastConsensus(
      [
        { id: "a", name: "A", probability: 0.62, brierScore: 0.16 },
        { id: "b", name: "B", probability: 0.58, brierScore: 0.18 },
        { id: "c", name: "C", probability: 0.55, brierScore: 0.2 },
      ],
      0.5
    );

    expect(consensus.confidenceInterval.low).toBeLessThanOrEqual(
      consensus.weightedProbability
    );
    expect(consensus.confidenceInterval.high).toBeGreaterThanOrEqual(
      consensus.weightedProbability
    );
    expect(consensus.scenarios[0].probability).toBeLessThan(
      consensus.scenarios[1].probability
    );
    expect(consensus.scenarios[1].probability).toBeLessThan(
      consensus.scenarios[2].probability
    );
  });

  it("reduces confidence score under high disagreement", () => {
    const tight = buildSuperforecastConsensus([
      { id: "a", name: "A", probability: 0.52, brierScore: 0.2 },
      { id: "b", name: "B", probability: 0.53, brierScore: 0.2 },
      { id: "c", name: "C", probability: 0.54, brierScore: 0.2 },
    ]);
    const wide = buildSuperforecastConsensus([
      { id: "a", name: "A", probability: 0.2, brierScore: 0.2 },
      { id: "b", name: "B", probability: 0.5, brierScore: 0.2 },
      { id: "c", name: "C", probability: 0.8, brierScore: 0.2 },
    ]);

    expect(tight.confidenceScore).toBeGreaterThan(wide.confidenceScore);
    expect(tight.disagreement).toBeLessThan(wide.disagreement);
  });
});
