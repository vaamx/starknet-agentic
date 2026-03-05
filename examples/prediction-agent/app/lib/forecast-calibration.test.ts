import { describe, expect, it } from "vitest";
import {
  adjustWithCalibrationMemory,
  aggregateSourceReliability,
  blendResearchQuality,
  deriveConfidenceInterval,
} from "./forecast-calibration";

describe("forecast calibration helpers", () => {
  it("aggregates source reliability with confidence weighting", () => {
    const score = aggregateSourceReliability(["news", "social"], {
      news: {
        source: "news",
        samples: 20,
        markets: 8,
        avgBrier: 0.18,
        calibrationBias: 0.02,
        reliabilityScore: 0.72,
        confidence: 0.7,
      },
      social: {
        source: "social",
        samples: 6,
        markets: 4,
        avgBrier: 0.26,
        calibrationBias: -0.05,
        reliabilityScore: 0.48,
        confidence: 0.35,
      },
    });

    expect(score).toBeGreaterThan(0.55);
    expect(score).toBeLessThan(0.8);
  });

  it("adjusts overconfident agents toward calibration memory", () => {
    const result = adjustWithCalibrationMemory(
      0.8,
      {
        agentId: "alpha",
        samples: 40,
        avgBrier: 0.22,
        calibrationBias: 0.12,
        reliabilityScore: 0.58,
        confidence: 0.9,
        memoryStrength: 0.75,
      },
      0.7
    );

    expect(result.adjustedProbability).toBeLessThan(0.8);
    expect(result.appliedStrength).toBeGreaterThan(0.3);
  });

  it("derives tighter confidence intervals at higher confidence", () => {
    const low = deriveConfidenceInterval(0.62, 0.35);
    const high = deriveConfidenceInterval(0.62, 0.85);

    expect(high.high - high.low).toBeLessThan(low.high - low.low);
    expect(blendResearchQuality(0.7, 0.6)).toBeGreaterThan(0.6);
  });
});
