"use client";

const TIER_STYLES: Record<string, string> = {
  thriving: "bg-neo-purple/20 text-neo-purple border-neo-purple/30",
  healthy: "bg-neo-green/20 text-neo-green border-neo-green/30",
  low: "bg-neo-yellow/20 text-neo-yellow border-neo-yellow/30",
  critical: "bg-neo-red/20 text-neo-red border-neo-red/30",
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
