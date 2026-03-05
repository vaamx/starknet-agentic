export interface EnsembleAgentInput {
  id: string;
  name: string;
  probability: number;
  brierScore: number;
  confidence?: number;
  sourceQuality?: number;
}

export interface EnsembleAgentResult {
  id: string;
  name: string;
  probability: number;
  brierScore: number;
  weight: number;
  confidence: number;
  sourceQuality: number;
}

export interface SuperforecastConsensus {
  weightedProbability: number;
  simpleProbability: number;
  agentCount: number;
  disagreement: number;
  confidenceScore: number;
  confidenceInterval: {
    low: number;
    high: number;
  };
  marketEdge: number;
  signal: "high_conviction" | "moderate" | "uncertain";
  scenarios: Array<{
    id: "bear" | "base" | "bull";
    label: string;
    probability: number;
  }>;
  agents: EnsembleAgentResult[];
}

export function clampProbability(value: number): number {
  return Math.max(0.01, Math.min(0.99, value));
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizedEntropy(probability: number): number {
  const p = clampProbability(probability);
  const q = 1 - p;
  const entropy = -(p * Math.log2(p) + q * Math.log2(q));
  return clampUnit(entropy);
}

function computeBaseWeight(agent: EnsembleAgentInput): number {
  const brier = Math.max(0.03, agent.brierScore);
  const calibrationFactor = 1 / brier;
  const confidenceFactor = 0.6 + clampUnit(agent.confidence ?? 0.7) * 0.8;
  const sourceFactor = 0.75 + clampUnit(agent.sourceQuality ?? 0.65) * 0.5;
  return calibrationFactor * confidenceFactor * sourceFactor;
}

export function buildSuperforecastConsensus(
  agents: EnsembleAgentInput[],
  marketProbability = 0.5
): SuperforecastConsensus {
  if (agents.length === 0) {
    return {
      weightedProbability: 0.5,
      simpleProbability: 0.5,
      agentCount: 0,
      disagreement: 0,
      confidenceScore: 0,
      confidenceInterval: { low: 0.35, high: 0.65 },
      marketEdge: 0,
      signal: "uncertain",
      scenarios: [
        { id: "bear", label: "Bear", probability: 0.4 },
        { id: "base", label: "Base", probability: 0.5 },
        { id: "bull", label: "Bull", probability: 0.6 },
      ],
      agents: [],
    };
  }

  const weights = agents.map((agent) => computeBaseWeight(agent));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;

  const weightedProbability = clampProbability(
    agents.reduce((sum, agent, index) => {
      return sum + agent.probability * (weights[index] / totalWeight);
    }, 0)
  );

  const simpleProbability = clampProbability(
    agents.reduce((sum, agent) => sum + agent.probability, 0) / agents.length
  );

  const variance =
    agents.reduce((sum, agent) => {
      const delta = agent.probability - weightedProbability;
      return sum + delta * delta;
    }, 0) / agents.length;
  const disagreement = Math.sqrt(Math.max(0, variance));

  const entropy = normalizedEntropy(weightedProbability);
  const confidenceScore = clampUnit(
    1 - (disagreement * 1.8 + entropy * 0.35)
  );

  const intervalHalfWidth = Math.min(
    0.35,
    Math.max(0.05, 0.05 + disagreement * 1.3 + (1 - confidenceScore) * 0.12)
  );

  const low = clampProbability(weightedProbability - intervalHalfWidth);
  const high = clampProbability(weightedProbability + intervalHalfWidth);

  const scenarioShift = intervalHalfWidth * 0.7;
  const scenarios: SuperforecastConsensus["scenarios"] = [
    {
      id: "bear",
      label: "Bear",
      probability: clampProbability(weightedProbability - scenarioShift),
    },
    { id: "base", label: "Base", probability: weightedProbability },
    {
      id: "bull",
      label: "Bull",
      probability: clampProbability(weightedProbability + scenarioShift),
    },
  ];

  const conviction = Math.abs(weightedProbability - 0.5);
  const signal: SuperforecastConsensus["signal"] =
    conviction >= 0.2 && confidenceScore >= 0.65
      ? "high_conviction"
      : conviction >= 0.12 && confidenceScore >= 0.45
        ? "moderate"
        : "uncertain";

  const agentResults: EnsembleAgentResult[] = agents.map((agent, index) => ({
    id: agent.id,
    name: agent.name,
    probability: clampProbability(agent.probability),
    brierScore: Math.max(0, agent.brierScore),
    weight: weights[index] / totalWeight,
    confidence: clampUnit(agent.confidence ?? 0.7),
    sourceQuality: clampUnit(agent.sourceQuality ?? 0.65),
  }));

  return {
    weightedProbability,
    simpleProbability,
    agentCount: agents.length,
    disagreement,
    confidenceScore,
    confidenceInterval: { low, high },
    marketEdge: weightedProbability - clampUnit(marketProbability),
    signal,
    scenarios,
    agents: agentResults,
  };
}
