"use client";

interface PersonaInfo {
  id: string;
  name: string;
  agentType: string;
  biasFactor: number;
  confidence: number;
  preferredSources: string[];
}

export default function PersonaCard({
  persona,
  selected,
  onClick,
}: {
  persona: PersonaInfo;
  selected: boolean;
  onClick: () => void;
}) {
  const biasLabel =
    persona.biasFactor > 0.02
      ? "Bullish"
      : persona.biasFactor < -0.02
        ? "Bearish"
        : "Neutral";
  const biasColor =
    persona.biasFactor > 0.02
      ? "text-green-400"
      : persona.biasFactor < -0.02
        ? "text-red-400"
        : "text-white/60";

  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl border p-3 text-left transition-all ${
        selected
          ? "border-neo-brand/50 bg-neo-brand/10 shadow-[0_0_12px_rgba(0,229,204,0.15)]"
          : "border-white/[0.07] bg-white/[0.03] hover:border-white/[0.12] hover:bg-white/[0.05]"
      }`}
    >
      <div className="mb-1 flex items-center justify-between">
        <h4 className="font-heading text-xs font-bold text-white">
          {persona.name}
        </h4>
        {selected && (
          <span className="text-neo-brand text-[10px]">&#x2713;</span>
        )}
      </div>
      <p className="mb-2 text-[10px] text-muted">{persona.agentType}</p>

      {/* Bias + Confidence */}
      <div className="mb-2 flex gap-3">
        <div>
          <span className="block text-[9px] uppercase tracking-wider text-muted">
            Bias
          </span>
          <span className={`text-[10px] font-medium ${biasColor}`}>
            {biasLabel} ({persona.biasFactor >= 0 ? "+" : ""}
            {(persona.biasFactor * 100).toFixed(0)}%)
          </span>
        </div>
        <div>
          <span className="block text-[9px] uppercase tracking-wider text-muted">
            Conf
          </span>
          <span className="text-[10px] font-medium text-white/70">
            {(persona.confidence * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Sources */}
      <div className="flex flex-wrap gap-1">
        {persona.preferredSources.slice(0, 4).map((src) => (
          <span
            key={src}
            className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[8px] text-muted"
          >
            {src}
          </span>
        ))}
        {persona.preferredSources.length > 4 && (
          <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[8px] text-muted">
            +{persona.preferredSources.length - 4}
          </span>
        )}
      </div>
    </button>
  );
}

export type { PersonaInfo };
