"use client";

const TIER_STYLES: Record<string, string> = {
  thriving: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  healthy: "bg-green-500/20 text-green-300 border-green-500/30",
  low: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  critical: "bg-red-500/20 text-red-300 border-red-500/30",
  dead: "bg-white/[0.06] text-white/40 border-white/[0.08]",
};

export default function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) {
    return (
      <span className="neo-badge border bg-white/[0.06] text-[10px] text-white/40 border-white/[0.08]">
        N/A
      </span>
    );
  }

  return (
    <span
      className={`neo-badge border text-[10px] ${TIER_STYLES[tier] ?? TIER_STYLES.dead}`}
    >
      {tier.toUpperCase()}
    </span>
  );
}
