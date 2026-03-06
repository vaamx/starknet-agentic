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
      ? "text-neo-green"
      : persona.biasFactor < -0.02
        ? "text-neo-red"
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
      {(() => {
        const SRC_COLORS: Record<string, string> = {
          polymarket: "bg-[#8b5cf6]",
          coingecko: "bg-[#f59e0b]",
          news: "bg-[#3b82f6]",
          social: "bg-[#ec4899]",
          tavily: "bg-[#06b6d4]",
          espn: "bg-[#ef4444]",
        };
        return (
          <div className="flex flex-wrap gap-1">
            {persona.preferredSources.slice(0, 4).map((src) => (
              <span
                key={src}
                className="inline-flex items-center gap-1 rounded-md bg-white/[0.05] border border-white/[0.06] px-1.5 py-0.5 text-[8px] text-white/55"
              >
                <span className={`w-1 h-1 rounded-full ${SRC_COLORS[src] ?? "bg-white/25"}`} />
                {src}
              </span>
            ))}
            {persona.preferredSources.length > 4 && (
              <span className="rounded-md bg-white/[0.05] border border-white/[0.06] px-1.5 py-0.5 text-[8px] text-white/40">
                +{persona.preferredSources.length - 4}
              </span>
            )}
          </div>
        );
      })()}
    </button>
  );
}

export type { PersonaInfo };
