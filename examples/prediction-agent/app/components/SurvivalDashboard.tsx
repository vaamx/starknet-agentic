"use client";

import { useState, useEffect } from "react";

type SurvivalTier = "thriving" | "healthy" | "low" | "critical" | "dead" | "unknown";

interface SurvivalState {
  tier: SurvivalTier;
  balanceStrk: number;
  balanceWei: string;
  replicationEligible: boolean;
  lastCheckedAt: number;
  agentAddress?: string | null;
  network?: string;
  explorerUrl?: string | null;
  faucetUrl?: string | null;
  thresholds?: {
    critical: number;
    low: number;
    healthy: number;
    thriving: number;
  };
  funding?: {
    targetThreshold: number;
    topUpToTargetStrk: number;
    topUpToHealthyStrk: number;
    canRunOnChain: boolean;
  };
}

interface SoulChild {
  id: string;
  name: string;
  tier: string;
}

const TIER_COLORS: Record<SurvivalTier, { bg: string; text: string; border: string; glow: string }> = {
  thriving: {
    bg: "bg-purple-500/10",
    text: "text-purple-400",
    border: "border-purple-500/40",
    glow: "shadow-[0_0_12px_rgba(168,85,247,0.3)]",
  },
  healthy: {
    bg: "bg-neo-green/10",
    text: "text-neo-green",
    border: "border-neo-green/40",
    glow: "",
  },
  low: {
    bg: "bg-yellow-500/10",
    text: "text-yellow-400",
    border: "border-yellow-500/40",
    glow: "",
  },
  critical: {
    bg: "bg-red-500/10",
    text: "text-red-400",
    border: "border-red-500/40",
    glow: "shadow-[0_0_8px_rgba(239,68,68,0.4)]",
  },
  dead: {
    bg: "bg-white/5",
    text: "text-white/30",
    border: "border-white/10",
    glow: "",
  },
  unknown: {
    bg: "bg-white/5",
    text: "text-white/40",
    border: "border-white/10",
    glow: "",
  },
};

const TIER_THRESHOLDS: Record<SurvivalTier, number> = {
  thriving: 1000,
  healthy: 100,
  low: 10,
  critical: 1,
  dead: 0,
  unknown: 0,
};

const TIER_LABELS: Record<SurvivalTier, string> = {
  thriving: "THRIVING",
  healthy:  "HEALTHY",
  low:      "LOW",
  critical: "CRITICAL",
  dead:     "DEAD",
  unknown:  "UNKNOWN",
};

function TierBadge({ tier }: { tier: SurvivalTier }) {
  const c = TIER_COLORS[tier];
  const isPulsing = tier === "thriving" || tier === "critical";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-mono tracking-wider font-bold ${c.bg} ${c.text} ${c.border} ${c.glow}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${tier === "dead" || tier === "unknown" ? "bg-white/20" : "bg-current"} ${isPulsing ? "animate-pulse" : ""}`} />
      {TIER_LABELS[tier]}
    </span>
  );
}

function BalanceBar({ balance, tier }: { balance: number; tier: SurvivalTier }) {
  const thrivingThreshold = TIER_THRESHOLDS.thriving;
  const pct = Math.min(100, (balance / thrivingThreshold) * 100);
  const c = TIER_COLORS[tier];
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-mono text-white/40 uppercase tracking-wider">Balance</span>
        <span className={`text-[10px] font-mono font-bold tabular-nums ${c.text}`}>
          {balance.toFixed(2)} STRK
        </span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${c.text.replace("text-", "bg-")}`}
          style={{ width: `${Math.max(1, pct)}%` }}
        />
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[8px] font-mono text-white/20">0</span>
        <span className="text-[8px] font-mono text-white/20">{thrivingThreshold} STRK</span>
      </div>
    </div>
  );
}

function SoulPreview() {
  const [soulMd, setSoulMd] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch("/api/soul")
      .then((r) => r.text())
      .then(setSoulMd)
      .catch(() => {});

    const iv = setInterval(() => {
      fetch("/api/soul")
        .then((r) => r.text())
        .then(setSoulMd)
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(iv);
  }, []);

  if (!soulMd) return null;

  const preview = soulMd.slice(0, 400);
  const hasMore = soulMd.length > 400;

  return (
    <div className="mt-3 pt-3 border-t border-white/10">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between text-[10px] font-mono text-white/40 hover:text-white/60 transition-colors"
      >
        <span className="uppercase tracking-wider">SOUL.md</span>
        <span>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <pre
          className="mt-2 text-[9px] font-mono text-white/50 whitespace-pre-wrap break-all leading-relaxed max-h-48 overflow-y-auto"
          /* Safe: rendered as pre text, not dangerouslySetInnerHTML */
        >
          {hasMore && !expanded ? `${preview}…` : soulMd}
        </pre>
      )}
    </div>
  );
}

function ChildrenList({ children }: { children: SoulChild[] }) {
  if (children.length === 0) return null;
  return (
    <div className="mt-3 pt-3 border-t border-white/10">
      <p className="text-[9px] font-mono text-white/40 uppercase tracking-wider mb-2">Children</p>
      <div className="space-y-1">
        {children.map((c) => (
          <div key={c.id} className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-white/70 truncate max-w-[150px]">{c.name}</span>
            <TierBadge tier={(c.tier as SurvivalTier) ?? "unknown"} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SurvivalDashboard() {
  const [survival, setSurvival] = useState<SurvivalState | null>(null);
  const [soulChildren, setSoulChildren] = useState<SoulChild[]>([]);
  const [soulText, setSoulText] = useState<string>("");
  const [copiedAddress, setCopiedAddress] = useState(false);

  useEffect(() => {
    const fetchSurvival = () =>
      fetch("/api/survival")
        .then((r) => r.json())
        .then((data: SurvivalState) => setSurvival(data))
        .catch(() => {});

    const fetchSoul = () =>
      fetch("/api/soul")
        .then((r) => r.text())
        .then((md) => {
          setSoulText(md);
          // Parse children from soul markdown
          const childMatches = [...md.matchAll(/\| `([^`]+)…` \| ([^|]+) \| ([^|]+) \|/g)];
          const parsed: SoulChild[] = childMatches.map((m) => ({
            id: m[1],
            name: m[2].trim(),
            tier: m[3].trim().toLowerCase(),
          }));
          if (parsed.length > 0) setSoulChildren(parsed);
        })
        .catch(() => {});

    fetchSurvival();
    fetchSoul();

    const iv = setInterval(() => {
      fetchSurvival();
      fetchSoul();
    }, 15_000);
    return () => clearInterval(iv);
  }, []);

  const tier = (survival?.tier as SurvivalTier) ?? "unknown";
  const c = TIER_COLORS[tier];

  // Derive model from tier
  const modelByTier: Record<SurvivalTier, string> = {
    thriving: "claude-opus-4-6",
    healthy:  "claude-sonnet-4-6",
    low:      "claude-haiku-4-5-20251001",
    critical: "claude-haiku-4-5-20251001",
    dead:     "claude-haiku-4-5-20251001",
    unknown:  "--",
  };

  // Extract thesis from SOUL.md
  const thesisMatch = soulText.match(/^>\s*(.+)$/m);
  const thesis = thesisMatch ? thesisMatch[1].trim() : null;
  const agentAddress = survival?.agentAddress ?? null;
  const topUpToTarget = Math.max(0, survival?.funding?.topUpToTargetStrk ?? 0);
  const topUpToHealthy = Math.max(0, survival?.funding?.topUpToHealthyStrk ?? 0);
  const needsFunding = topUpToTarget > 0.0001;

  return (
    <div className={`neo-card overflow-hidden border ${c.border} ${c.glow} transition-all duration-500`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b border-white/10 ${c.bg}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${tier === "dead" ? "bg-white/20" : "bg-current"} ${tier === "thriving" || tier === "critical" ? "animate-pulse" : ""} ${c.text}`} />
            <h3 className="font-heading font-bold text-white text-xs tracking-tight">
              Survival Engine
            </h3>
          </div>
          <TierBadge tier={tier} />
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-2 text-[11px] text-white/60">
        {/* Balance bar */}
        <BalanceBar balance={survival?.balanceStrk ?? 0} tier={tier} />

        {agentAddress && (
          <div className="pt-2 border-t border-white/10 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono text-white/40 uppercase tracking-wider">
                Owner Wallet (Server)
              </span>
              <span
                className={`text-[9px] font-mono ${
                  needsFunding ? "text-neo-yellow" : "text-neo-green"
                }`}
              >
                {needsFunding ? "FUNDING NEEDED" : "FUNDED"}
              </span>
            </div>
            <p className="text-[10px] font-mono text-white/60 break-all">
              {agentAddress}
            </p>
            <p className="text-[10px] text-white/45">
              Autonomous forecasts/bets use this server wallet. User wallet connect is optional for manual actions.
            </p>
            {needsFunding && (
              <div className="rounded-lg border border-neo-yellow/30 bg-neo-yellow/10 p-2">
                <p className="text-[10px] text-neo-yellow">
                  Add {topUpToTarget.toFixed(2)} STRK to resume on-chain actions
                  {topUpToHealthy > topUpToTarget + 0.01
                    ? ` (${topUpToHealthy.toFixed(2)} STRK to healthy tier).`
                    : "."}
                </p>
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(agentAddress);
                    setCopiedAddress(true);
                    setTimeout(() => setCopiedAddress(false), 1200);
                  } catch {
                    // Ignore clipboard failures.
                  }
                }}
                className="text-[10px] font-mono px-2 py-1 rounded border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors"
              >
                {copiedAddress ? "COPIED" : "COPY"}
              </button>
              {survival?.explorerUrl && (
                <a
                  href={survival.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-mono px-2 py-1 rounded border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors"
                >
                  EXPLORER
                </a>
              )}
              {survival?.faucetUrl && (
                <a
                  href={survival.faucetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-mono px-2 py-1 rounded border border-neo-yellow/30 text-neo-yellow hover:border-neo-yellow/50 transition-colors"
                >
                  FAUCET
                </a>
              )}
            </div>
          </div>
        )}

        {/* Model */}
        <div className="flex items-center justify-between pt-1">
          <span>Active Model</span>
          <span className={`font-mono text-[10px] ${c.text}`}>
            {modelByTier[tier]}
          </span>
        </div>

        {/* Bet multiplier */}
        <div className="flex items-center justify-between">
          <span>Bet Multiplier</span>
          <span className="font-mono text-[10px] text-white/80">
            {tier === "thriving" ? "2.0×"
              : tier === "healthy" ? "1.0×"
              : tier === "low" ? "0.5×"
              : tier === "critical" || tier === "dead" ? "0×"
              : "--"}
          </span>
        </div>

        {/* Replication eligible */}
        <div className="flex items-center justify-between">
          <span>Replication</span>
          <span className={`font-mono text-[10px] ${survival?.replicationEligible ? "text-purple-400" : "text-white/30"}`}>
            {survival?.replicationEligible ? "ELIGIBLE" : "NOT YET"}
          </span>
        </div>

        {/* Last checked */}
        <div className="flex items-center justify-between">
          <span>Last checked</span>
          <span className="font-mono text-[10px]">
            {survival?.lastCheckedAt
              ? `${Math.floor((Date.now() - survival.lastCheckedAt) / 1000)}s ago`
              : "--"}
          </span>
        </div>

        {/* Current thesis */}
        {thesis && (
          <div className="pt-2 border-t border-white/10">
            <p className="text-[9px] font-mono text-white/40 uppercase tracking-wider mb-1">Current Thesis</p>
            <p className="text-[10px] text-white/60 italic line-clamp-3 leading-relaxed">
              &ldquo;{thesis}&rdquo;
            </p>
          </div>
        )}

        {/* Children */}
        <ChildrenList children={soulChildren} />

        {/* SOUL.md link */}
        <div className="pt-2 border-t border-white/10 flex items-center justify-between">
          <span className="text-[9px] font-mono text-white/30">SOUL.md</span>
          <a
            href="/api/soul"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[9px] font-mono text-white/40 hover:text-white/70 transition-colors underline"
          >
            view →
          </a>
        </div>
      </div>
    </div>
  );
}
