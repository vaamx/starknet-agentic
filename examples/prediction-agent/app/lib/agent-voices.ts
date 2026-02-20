export type AgentVoice = {
  id: string;
  name: string;
  signature: string;
  colorClass: string;
};

const AGENT_VOICES: AgentVoice[] = [
  {
    id: "alpha",
    name: "AlphaForecaster",
    signature: "Outside-view anchor",
    colorClass: "text-neo-green",
  },
  {
    id: "beta",
    name: "BetaAnalyst",
    signature: "Quant discipline",
    colorClass: "text-neo-blue",
  },
  {
    id: "gamma",
    name: "GammaTrader",
    signature: "Market microstructure",
    colorClass: "text-neo-purple",
  },
  {
    id: "delta",
    name: "DeltaScout",
    signature: "Evidence scout",
    colorClass: "text-neo-yellow",
  },
  {
    id: "epsilon",
    name: "EpsilonOracle",
    signature: "Narrative radar",
    colorClass: "text-neo-pink",
  },
];

export function getAgentVoiceByName(name?: string): AgentVoice | undefined {
  if (!name) return undefined;
  const normalized = name.toLowerCase();
  return AGENT_VOICES.find(
    (voice) =>
      voice.name.toLowerCase() === normalized || voice.id === normalized
  );
}
