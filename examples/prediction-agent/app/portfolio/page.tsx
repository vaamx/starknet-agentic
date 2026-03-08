"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "@starknet-react/core";
import { computePayout } from "@/lib/accuracy";
import { buildClaimCalls } from "@/lib/contracts";
import { friendlyTxError } from "@/lib/tx-errors";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface Position {
  marketId: number;
  address: string;
  question: string;
  status: number;
  resolutionTime: number;
  winningOutcome?: number;
  yesBet: string;
  noBet: string;
  totalBet: string;
  totalPool: string;
  yesPool: string;
  noPool: string;
  impliedProbYes: number;
  feeBps: number;
}

type TabFilter = "all" | "open" | "resolved" | "claimable";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatStrk(wei: string | bigint): string {
  const n = Number(BigInt(wei)) / 1e18;
  if (n === 0) return "0";
  if (n < 0.01) return "<0.01";
  return n.toFixed(2);
}

function timeLabel(resolutionTime: number): string {
  const now = Date.now() / 1000;
  const secs = resolutionTime - now;
  if (secs <= 0) return "Expired";
  if (secs < 60) return `${Math.floor(secs)}s`;
  if (secs < 3600) return `${Math.ceil(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

/* ------------------------------------------------------------------ */
/*  Position Row                                                        */
/* ------------------------------------------------------------------ */

function PositionRow({
  pos,
  onClaimed,
}: {
  pos: Position;
  onClaimed?: () => void;
}) {
  const { account } = useAccount();
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<{
    status: string;
    txHash?: string;
    error?: string;
  } | null>(null);

  const yesBet = BigInt(pos.yesBet);
  const noBet = BigInt(pos.noBet);
  const totalBet = yesBet + noBet;
  const isResolved = pos.status === 2;
  const nowSec = Date.now() / 1000;
  const isExpired = pos.resolutionTime <= nowSec;
  const winningOutcome = pos.winningOutcome ?? 0;

  // Determine win/loss
  const winningBet = winningOutcome === 1 ? yesBet : noBet;
  const isWinner = isResolved && winningBet > 0n;
  const isLoser = isResolved && winningBet === 0n && totalBet > 0n;

  // Payout estimate
  const estPayout =
    isResolved && winningBet > 0n
      ? computePayout(
          winningBet,
          BigInt(pos.totalPool),
          BigInt(winningOutcome === 1 ? pos.yesPool : pos.noPool),
          pos.feeBps
        )
      : 0n;
  const profit = Number(estPayout) / 1e18 - Number(totalBet) / 1e18;

  // Unrealized P&L for open positions
  const impliedValue =
    !isResolved && totalBet > 0n
      ? (() => {
          const yesVal = yesBet > 0n ? Number(yesBet) / 1e18 * (pos.impliedProbYes > 0 ? 1 / pos.impliedProbYes : 0) : 0;
          const noVal = noBet > 0n ? Number(noBet) / 1e18 * ((1 - pos.impliedProbYes) > 0 ? 1 / (1 - pos.impliedProbYes) : 0) : 0;
          return yesVal + noVal;
        })()
      : 0;
  const unrealizedPnl = impliedValue - Number(totalBet) / 1e18;

  const handleClaim = async () => {
    if (!account || claiming) return;
    setClaiming(true);
    setClaimResult(null);
    try {
      const calls = buildClaimCalls(pos.address);
      const tx = await account.execute(calls);
      setClaimResult({ status: "success", txHash: tx.transaction_hash });
      onClaimed?.();
    } catch (err: any) {
      setClaimResult({ status: "error", error: friendlyTxError(err) });
    } finally {
      setClaiming(false);
    }
  };

  const statusBadge = (() => {
    if (isResolved && isWinner) return { label: "Won", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" };
    if (isResolved && isLoser) return { label: "Lost", color: "bg-rose-500/15 text-rose-400 border-rose-500/20" };
    if (isResolved) return { label: "Resolved", color: "bg-sky-500/15 text-sky-400 border-sky-500/20" };
    if (isExpired) return { label: "Resolving", color: "bg-amber-500/15 text-amber-400 border-amber-500/20" };
    return { label: timeLabel(pos.resolutionTime), color: "bg-white/[0.04] text-white/50 border-white/[0.06]" };
  })();

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
      <Link
        href={`/market/${pos.marketId}`}
        className="block p-4 no-underline"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white leading-snug truncate">
              {pos.question}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusBadge.color}`}>
                {statusBadge.label}
              </span>
              {yesBet > 0n && (
                <span className="text-[11px] font-mono text-emerald-400/70">
                  Yes: {formatStrk(pos.yesBet)}
                </span>
              )}
              {noBet > 0n && (
                <span className="text-[11px] font-mono text-rose-400/70">
                  No: {formatStrk(pos.noBet)}
                </span>
              )}
            </div>
          </div>

          <div className="text-right shrink-0">
            <p className="text-sm font-mono font-bold text-white">
              {formatStrk(pos.totalBet)} STRK
            </p>
            {isResolved && isWinner && (
              <p className="text-xs font-mono text-emerald-400 mt-0.5">
                +{profit.toFixed(2)} profit
              </p>
            )}
            {isResolved && isLoser && (
              <p className="text-xs font-mono text-rose-400/60 mt-0.5">
                -{formatStrk(pos.totalBet)} lost
              </p>
            )}
            {!isResolved && totalBet > 0n && (
              <p className={`text-xs font-mono mt-0.5 ${unrealizedPnl >= 0 ? "text-emerald-400/60" : "text-rose-400/60"}`}>
                {unrealizedPnl >= 0 ? "+" : ""}{unrealizedPnl.toFixed(2)} est.
              </p>
            )}
          </div>
        </div>
      </Link>

      {/* Claim button for winners */}
      {isResolved && isWinner && (
        <div className="px-4 pb-4 -mt-1">
          <button
            onClick={handleClaim}
            disabled={claiming}
            className={`w-full py-2.5 rounded-lg font-bold text-xs transition-all ${
              claiming
                ? "bg-white/[0.06] text-white/25 cursor-wait"
                : "bg-emerald-500 hover:bg-emerald-400 text-white shadow-[0_0_16px_rgba(16,185,129,0.2)]"
            }`}
          >
            {claiming ? "Claiming..." : `Claim ${formatStrk(estPayout)} STRK`}
          </button>
          {claimResult && (
            <p className={`text-[11px] font-mono mt-2 ${claimResult.status === "success" ? "text-emerald-400/70" : "text-rose-400/70"}`}>
              {claimResult.status === "success"
                ? "Claimed!"
                : claimResult.error}
              {claimResult.txHash && (
                <a
                  href={`https://sepolia.voyager.online/tx/${claimResult.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-sky-400/60 hover:underline"
                >
                  View tx
                </a>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Portfolio Page                                                 */
/* ------------------------------------------------------------------ */

export default function PortfolioPage() {
  const { isConnected, address } = useAccount();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabFilter>("all");
  const [totalInvested, setTotalInvested] = useState("0");

  const fetchPortfolio = (showLoader: boolean) => {
    if (!isConnected || !address) {
      setPositions([]);
      setLoading(false);
      return;
    }
    if (showLoader) { setLoading(true); setError(null); }
    fetch(`/api/portfolio?user=${address}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setPositions(Array.isArray(data.positions) ? data.positions : []);
        setTotalInvested(data.totalInvested ?? "0");
      })
      .catch((err) => { if (showLoader) setError(err.message); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchPortfolio(true);
    const interval = setInterval(() => fetchPortfolio(false), 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  const refresh = () => fetchPortfolio(true);

  const nowSec = Date.now() / 1000;

  const filtered = positions.filter((pos) => {
    if (tab === "open") return pos.status === 0 && pos.resolutionTime > nowSec;
    if (tab === "resolved") return pos.status === 2;
    if (tab === "claimable") {
      if (pos.status !== 2) return false;
      const winningBet = (pos.winningOutcome ?? 0) === 1 ? BigInt(pos.yesBet) : BigInt(pos.noBet);
      return winningBet > 0n;
    }
    return true;
  });

  const openCount = positions.filter((p) => p.status === 0 && p.resolutionTime > nowSec).length;
  const resolvedCount = positions.filter((p) => p.status === 2).length;
  const claimableCount = positions.filter((p) => {
    if (p.status !== 2) return false;
    const winningBet = (p.winningOutcome ?? 0) === 1 ? BigInt(p.yesBet) : BigInt(p.noBet);
    return winningBet > 0n;
  }).length;

  const totalInvestedStrk = Number(BigInt(totalInvested)) / 1e18;

  // P&L calculations
  const { realizedPnl, unrealizedPnl: totalUnrealizedPnl, winRate } = (() => {
    let realized = 0;
    let unrealized = 0;
    let wins = 0;
    let settled = 0;
    for (const pos of positions) {
      const yesBet = BigInt(pos.yesBet);
      const noBet = BigInt(pos.noBet);
      const totalBet = yesBet + noBet;
      if (pos.status === 2) {
        settled++;
        const wo = pos.winningOutcome ?? 0;
        const winningBet = wo === 1 ? yesBet : noBet;
        if (winningBet > 0n) {
          wins++;
          const payout = computePayout(winningBet, BigInt(pos.totalPool), BigInt(wo === 1 ? pos.yesPool : pos.noPool), pos.feeBps);
          realized += Number(payout) / 1e18 - Number(totalBet) / 1e18;
        } else if (totalBet > 0n) {
          realized -= Number(totalBet) / 1e18;
        }
      } else if (totalBet > 0n) {
        const yesVal = yesBet > 0n ? Number(yesBet) / 1e18 * (pos.impliedProbYes > 0 ? 1 / pos.impliedProbYes : 0) : 0;
        const noVal = noBet > 0n ? Number(noBet) / 1e18 * ((1 - pos.impliedProbYes) > 0 ? 1 / (1 - pos.impliedProbYes) : 0) : 0;
        unrealized += (yesVal + noVal) - Number(totalBet) / 1e18;
      }
    }
    return { realizedPnl: realized, unrealizedPnl: unrealized, winRate: settled > 0 ? wins / settled : 0 };
  })();

  const TABS: { key: TabFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: positions.length },
    { key: "open", label: "Open", count: openCount },
    { key: "claimable", label: "Claimable", count: claimableCount },
    { key: "resolved", label: "Resolved", count: resolvedCount },
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <SiteHeader />

      <main className="max-w-[800px] mx-auto w-full flex-1 px-4 sm:px-6 py-8 pb-24">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white tracking-tight">Portfolio</h1>
          <p className="text-sm text-white/30 mt-1">Your positions across all prediction markets</p>
        </div>

        {/* Not connected */}
        {!isConnected && (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/[0.04] flex items-center justify-center text-2xl text-white/20">
              &empty;
            </div>
            <p className="text-white/40 text-sm">Connect your wallet to view positions</p>
            <button
              onClick={() => window.dispatchEvent(new Event("hc-wallet-connect-open"))}
              className="mt-4 px-6 py-2.5 rounded-xl bg-sky-500/80 hover:bg-sky-500 text-white font-semibold text-sm transition-colors"
            >
              Connect Wallet
            </button>
          </div>
        )}

        {/* Connected */}
        {isConnected && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <p className="text-[10px] uppercase tracking-widest text-white/25 font-semibold">Invested</p>
                <p className="text-xl font-bold text-white font-mono mt-1">
                  {totalInvestedStrk.toFixed(1)}
                  <span className="text-xs text-white/30 ml-1">STRK</span>
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <p className="text-[10px] uppercase tracking-widest text-white/25 font-semibold">Realized P&L</p>
                <p className={`text-xl font-bold font-mono mt-1 ${realizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {realizedPnl >= 0 ? "+" : ""}{realizedPnl.toFixed(2)}
                  <span className="text-xs opacity-50 ml-1">STRK</span>
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <p className="text-[10px] uppercase tracking-widest text-white/25 font-semibold">Win Rate</p>
                <p className="text-xl font-bold text-white font-mono mt-1">
                  {resolvedCount > 0 ? `${Math.round(winRate * 100)}%` : "—"}
                  <span className="text-xs text-white/20 ml-1.5">{resolvedCount > 0 ? `${resolvedCount} settled` : ""}</span>
                </p>
              </div>
              <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/[0.03] p-4">
                <p className="text-[10px] uppercase tracking-widest text-emerald-400/40 font-semibold">Claimable</p>
                <p className="text-xl font-bold text-emerald-400 font-mono mt-1">{claimableCount}</p>
              </div>
            </div>

            {/* Tab filters */}
            <div className="flex gap-1 mb-5 p-1 rounded-lg bg-white/[0.03] border border-white/[0.04]">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all ${
                    tab === t.key
                      ? "bg-white/[0.08] text-white shadow-sm"
                      : "text-white/30 hover:text-white/50"
                  }`}
                >
                  {t.label}
                  {t.count > 0 && (
                    <span className={`ml-1.5 text-[10px] ${tab === t.key ? "text-white/50" : "text-white/20"}`}>
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Loading */}
            {loading && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-20 rounded-xl bg-white/[0.03] animate-pulse" />
                ))}
              </div>
            )}

            {/* Error */}
            {error && !loading && (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-300">
                {error}
              </div>
            )}

            {/* Empty state */}
            {!loading && !error && filtered.length === 0 && (
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-12 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/[0.04] flex items-center justify-center text-2xl text-white/20">
                  &empty;
                </div>
                <p className="text-white/40 text-sm">
                  {tab === "all"
                    ? "No positions yet. Place a bet on any market to get started."
                    : `No ${tab} positions.`}
                </p>
                {tab === "all" && (
                  <Link
                    href="/markets"
                    className="inline-block mt-4 px-6 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-white/60 font-semibold text-sm transition-colors no-underline"
                  >
                    Browse Markets
                  </Link>
                )}
              </div>
            )}

            {/* Position list */}
            {!loading && !error && filtered.length > 0 && (
              <div className="space-y-2">
                {filtered.map((pos) => (
                  <PositionRow key={pos.marketId} pos={pos} onClaimed={refresh} />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
