"use client";

import { accuracyTier, formatBrier } from "@/lib/accuracy";

interface AgentIdentityCardProps {
  agent: string;
  avgBrier: number;
  predictionCount: number;
  rank: number;
  identity?: {
    name: string;
    agentType: string;
    model: string;
    reputationScore: number;
    feedbackCount: number;
    framework?: string;
    a2aEndpoint?: string;
    moltbookId?: string;
  } | null;
}

export default function AgentIdentityCard({
  agent,
  avgBrier,
  predictionCount,
  rank,
  identity,
}: AgentIdentityCardProps) {
  const tier = accuracyTier(avgBrier);
  const accuracy = Math.max(0, Math.round((1 - avgBrier) * 100));

  const accentColor =
    tier.label === "Excellent"
      ? "neo-green"
      : tier.label === "Good"
        ? "neo-blue"
        : tier.label === "Fair"
          ? "neo-orange"
          : "neo-pink";
  const accentStyles: Record<
    string,
    { stripe: string; badge: string; bar: string }
  > = {
    "neo-green": {
      stripe: "bg-neo-green/60",
      badge: "bg-neo-green/15 text-neo-green",
      bar: "bg-neo-green",
    },
    "neo-blue": {
      stripe: "bg-neo-blue/60",
      badge: "bg-neo-blue/15 text-neo-blue",
      bar: "bg-neo-blue",
    },
    "neo-orange": {
      stripe: "bg-neo-orange/60",
      badge: "bg-neo-orange/15 text-neo-orange",
      bar: "bg-neo-orange",
    },
    "neo-pink": {
      stripe: "bg-neo-pink/60",
      badge: "bg-neo-pink/15 text-neo-pink",
      bar: "bg-neo-pink",
    },
  };
  const accent = accentStyles[accentColor] ?? accentStyles["neo-blue"];

  return (
    <div className="neo-card overflow-hidden animate-enter">
      {/* Accent stripe */}
      <div className={`h-1.5 ${accent.stripe}`} />

      <div className="p-4">
        {/* Agent Header */}
        <div className="flex items-start gap-3 mb-4">
          <div
            className={`w-10 h-10 ${accent.badge} border border-white/10 flex items-center justify-center font-black text-lg shrink-0 rounded-lg`}
          >
            {rank}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-mono text-xs font-bold truncate text-white/90">
              {identity?.name ?? agent}
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[10px] font-mono text-white/40">
                ERC-8004
              </span>
              <span className="w-1 h-1 rounded-full bg-white/30" />
              <span className={`text-[10px] font-bold ${tier.color}`}>
                {tier.label}
              </span>
            </div>
            {identity && (
              <p className="text-[9px] text-white/40 mt-0.5">
                {identity.agentType} · {identity.model}
              </p>
            )}
            {identity?.framework && (
              <p className="text-[9px] text-white/30 mt-0.5">
                {identity.framework}
                {identity.moltbookId ? ` · MoltBook ${identity.moltbookId}` : ""}
              </p>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className={`grid ${identity ? "grid-cols-4" : "grid-cols-3"} gap-px bg-white/10 border border-white/10 rounded-lg overflow-hidden`}>
          <div className="bg-white/[0.04] p-2.5 text-center">
            <p className={`font-mono font-black text-base leading-none ${tier.color}`}>
              {formatBrier(avgBrier)}
            </p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-white/40 mt-1">
              Brier
            </p>
          </div>
          <div className="bg-white/[0.04] p-2.5 text-center">
            <p className="font-mono font-black text-base leading-none text-white/90">
              {predictionCount}
            </p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-white/40 mt-1">
              Preds
            </p>
          </div>
          <div className="bg-white/[0.04] p-2.5 text-center">
            <p className="font-mono font-black text-base leading-none text-white/90">
              {accuracy}%
            </p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-white/40 mt-1">
              Acc
            </p>
          </div>
          {identity && (
            <div className="bg-white/[0.04] p-2.5 text-center">
              <p className="font-mono font-black text-base leading-none text-neo-purple">
                {identity.reputationScore}
              </p>
              <p className="text-[9px] font-bold uppercase tracking-widest text-white/40 mt-1">
                Rep
              </p>
            </div>
          )}
        </div>

        {/* Accuracy Bar */}
        <div className="mt-3">
          <div className="h-2 border border-white/10 bg-white/10 overflow-hidden rounded-full">
            <div
              className={`h-full ${accent.bar} prob-bar`}
              style={{ width: `${accuracy}%` }}
            />
          </div>
        </div>

        {/* Agent Address */}
        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono text-[9px] text-white/40 truncate max-w-[140px]">
            {agent}
          </span>
          {identity && (
            <span className="neo-badge text-[8px] py-0 px-1.5 bg-neo-purple/10 text-neo-purple border-neo-purple/30">
              {identity.feedbackCount} reviews
            </span>
          )}
        </div>
        {identity?.a2aEndpoint && (
          <p className="text-[9px] text-white/30 mt-2 truncate">
            A2A: {identity.a2aEndpoint}
          </p>
        )}
      </div>
    </div>
  );
}
