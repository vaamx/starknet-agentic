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
  thriving: "bg-purple-400",
  healthy: "bg-green-400",
  low: "bg-yellow-400",
  critical: "bg-red-400",
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
          <div key={i} className="neo-card h-20 animate-pulse p-3" />
        ))}
      </div>
    );
  }

  const pnlWei = BigInt(stats.fleetPnl || "0");
  const pnlStrk = Number(pnlWei) / 1e18;
  const pnlSign = pnlStrk >= 0 ? "+" : "";
  const pnlColor = pnlStrk >= 0 ? "text-green-400" : "text-red-400";

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
      <StatCard
        label="Total Agents"
        value={String(stats.totalAgents)}
        sub={`${stats.runningAgents} running`}
      />
      <StatCard
        label="STRK Under Mgmt"
        value={
          stats.totalStrkHuman > 0
            ? stats.totalStrkHuman.toLocaleString(undefined, {
                maximumFractionDigits: 1,
              })
            : "–"
        }
        sub="across all wallets"
      >
        <TierDistBar dist={stats.tierDistribution} />
      </StatCard>
      <StatCard
        label="Avg Brier Score"
        value={stats.avgBrierScore !== null ? stats.avgBrierScore.toFixed(3) : "–"}
        sub={stats.avgBrierScore !== null ? "lower is better" : "no data yet"}
      />
      <StatCard
        label="Fleet P&L"
        value={`${pnlSign}${Math.abs(pnlStrk).toFixed(1)} STRK`}
      >
        <span className={`text-xs font-mono ${pnlColor}`}>
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
