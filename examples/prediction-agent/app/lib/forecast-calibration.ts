import type {
  AgentCalibrationMemory,
  SourceReliabilityBacktestRow,
} from "./ops-store";

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function clampProbability(value: number): number {
  return Math.max(0.01, Math.min(0.99, value));
}

export function aggregateSourceReliability(
  sources: string[],
  profile: Record<string, SourceReliabilityBacktestRow>
): number {
  const normalized = Array.from(
    new Set(sources.map((source) => source.toLowerCase().trim()).filter(Boolean))
  );
  if (normalized.length === 0) return 0.6;

  let weightedSum = 0;
  let weightTotal = 0;
  for (const source of normalized) {
    const row = profile[source];
    if (!row) continue;
    const weight = 0.35 + row.confidence * 0.65;
    weightedSum += row.reliabilityScore * weight;
    weightTotal += weight;
  }

  if (weightTotal === 0) return 0.6;
  return clampUnit(weightedSum / weightTotal);
}

export function blendResearchQuality(
  liveQuality: number,
  backtestedReliability: number
): number {
  return clampUnit(
    clampUnit(liveQuality) * 0.65 + clampUnit(backtestedReliability) * 0.35
  );
}

export function adjustWithCalibrationMemory(
  rawProbability: number,
  memory: AgentCalibrationMemory,
  sourceQuality: number
): {
  adjustedProbability: number;
  adjustment: number;
  appliedStrength: number;
} {
  const p = clampProbability(rawProbability);
  const strength = clampUnit(
    memory.memoryStrength * (0.55 + clampUnit(sourceQuality) * 0.45)
  );

  if (memory.samples === 0 || strength <= 0.01) {
    return {
      adjustedProbability: p,
      adjustment: 0,
      appliedStrength: 0,
    };
  }

  const biasCorrection = memory.calibrationBias * 0.8 * strength;
  const reliabilityShrink = (1 - memory.reliabilityScore) * 0.2 * strength;
  const biasAdjusted = p - biasCorrection;
  const shrunk = 0.5 + (biasAdjusted - 0.5) * (1 - reliabilityShrink);
  const adjusted = clampProbability(shrunk);

  return {
    adjustedProbability: adjusted,
    adjustment: adjusted - p,
    appliedStrength: strength,
  };
}

export function deriveForecastConfidence(
  probability: number,
  researchQuality: number,
  memory?: AgentCalibrationMemory
): number {
  const edge = Math.abs(clampProbability(probability) - 0.5);
  const memoryBonus = memory ? memory.reliabilityScore * 0.15 : 0;
  return clampUnit(0.42 + edge * 0.75 + clampUnit(researchQuality) * 0.25 + memoryBonus);
}

export function deriveConfidenceInterval(
  probability: number,
  confidence: number
): { low: number; high: number } {
  const halfBand = Math.min(
    0.32,
    Math.max(0.05, 0.29 - clampUnit(confidence) * 0.2)
  );
  return {
    low: clampProbability(probability - halfBand),
    high: clampProbability(probability + halfBand),
  };
}
