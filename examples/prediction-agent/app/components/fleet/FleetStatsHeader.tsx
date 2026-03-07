"use client";

interface FleetStats {
  totalAgents: number;
  runningAgents: number;
  totalStrkHuman: number;
  avgBrierScore: number | null;
  tierDistribution: Record<string, number>;
  fleetPnl: string;
}

const TIER_COLORS: Record<string, string> = {
  thriving: "bg-neo-purple",
  healthy: "bg-neo-green",
  low: "bg-neo-yellow",
  critical: "bg-neo-red",
  dead: "bg-white/20",
};

function TierDistBar({ dist }: { dist: Record<string, number> }) {
  const total = Object.values(dist).reduce((a, b) => a + b, 0);
  if (total === 0) return <div className="h-1.5 w-full rounded bg-white/[0.06]" />;

  return (
    <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded">
      {Object.entries(dist).map(([tier, count]) =>
        count > 0 ? (
          <div
            key={tier}
            className={`${TIER_COLORS[tier] ?? "bg-white/10"} rounded-sm`}
            style={{ flex: count }}
            title={`${tier}: ${count}`}
          />
        ) : null
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="neo-card flex flex-col gap-1 p-3">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
        {label}
      </span>
      <span className="font-heading text-lg font-bold text-white">{value}</span>
      {sub && (
        <span className="text-[10px] text-muted">{sub}</span>
      )}
      {children}
    </div>
  );
}

export default function FleetStatsHeader({ stats }: { stats: FleetStats | null }) {
  if (!stats) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="neo-card relative overflow-hidden p-3 h-20">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/[0.03] to-transparent" />
            <div className="h-2.5 w-16 rounded bg-white/[0.05] animate-pulse mb-2" />
            <div className="h-5 w-12 rounded bg-white/[0.07] animate-pulse mb-1.5" />
            <div className="h-2 w-20 rounded bg-white/[0.03] animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  const pnlWei = BigInt(stats.fleetPnl || "0");
  const pnlStrk = Number(pnlWei) / 1e18;
  const pnlSign = pnlStrk >= 0 ? "+" : "";
  const pnlColor = pnlStrk >= 0 ? "text-neo-green" : "text-neo-red";
  const runRate = stats.totalAgents > 0
    ? Math.round((stats.runningAgents / stats.totalAgents) * 100)
    : 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
      <StatCard
        label="Total Agents"
        value={String(stats.totalAgents)}
        sub={`${stats.runningAgents} running`}
      >
        {/* Run rate bar */}
        <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden mt-0.5">
          <div
            className="h-full rounded-full bg-neo-brand/50 transition-all"
            style={{ width: `${runRate}%` }}
          />
        </div>
      </StatCard>
      <StatCard
        label="STRK Under Mgmt"
        value={(stats.totalStrkHuman ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
        sub="across all wallets"
      >
        <TierDistBar dist={stats.tierDistribution} />
      </StatCard>
      <StatCard
        label="Avg Brier Score"
        value={stats.avgBrierScore !== null ? stats.avgBrierScore.toFixed(3) : "Pending"}
        sub={stats.avgBrierScore !== null ? "lower is better" : "waiting for resolved markets"}
      />
      <StatCard
        label="Fleet P&L"
        value={`${pnlSign}${Math.abs(pnlStrk).toFixed(1)} STRK`}
      >
        <span className={`text-xs font-mono font-bold ${pnlColor}`}>
          {pnlSign}{Math.abs(pnlStrk).toFixed(2)}
        </span>
      </StatCard>
      <StatCard
        label="Tier Distribution"
        value={`${stats.tierDistribution.thriving ?? 0} thriving`}
        sub={`${stats.tierDistribution.critical ?? 0} critical / ${stats.tierDistribution.dead ?? 0} dead`}
      >
        <TierDistBar dist={stats.tierDistribution} />
      </StatCard>
    </div>
  );
}
