"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import { buildBetCalls } from "@/lib/contracts";
import { computePayout } from "@/lib/accuracy";
import { categorizeMarket } from "@/lib/categories";
import { getAgentVoiceByName } from "@/lib/agent-voices";
import TamagotchiLoader from "@/components/TamagotchiLoader";
import TamagotchiEmptyState from "@/components/TamagotchiEmptyState";
import type { AgentPrediction, Market } from "@/components/dashboard/types";
import { computeDisagreement, safeBigInt } from "@/components/dashboard/utils";

interface MarketDetail {
  market: Market;
  predictions: AgentPrediction[];
  weightedProbability: number | null;
  latestAgentTake: {
    agentName: string;
    probability: number;
    reasoning: string;
    timestamp: number;
  } | null;
}

interface MarketActivityEntry {
  id: string;
  type: string;
  actor: string;
  marketId?: number;
  probability?: number;
  detail?: string;
  debateTarget?: string;
  timestamp: number;
}

function brierGrade(score: number): { label: string; colorClass: string } {
  if (score < 0.1) return { label: "S", colorClass: "bg-neo-green text-neo-dark" };
  if (score < 0.15) return { label: "A", colorClass: "bg-neo-blue text-white" };
  if (score < 0.2) return { label: "B", colorClass: "bg-neo-cyan text-neo-dark" };
  if (score < 0.3) return { label: "C", colorClass: "bg-neo-orange text-neo-dark" };
  return { label: "D", colorClass: "bg-neo-red text-white" };
}

export default function MarketPage() {
  const params = useParams();
  const id = params.id as string;

  const [data, setData] = useState<MarketDetail | null>(null);
  const [activityTrail, setActivityTrail] = useState<MarketActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bet form state
  const { address: connectedAddress, isConnected } = useAccount();
  const { sendAsync, isPending: betPending } = useSendTransaction({});
  const [outcome, setOutcome] = useState<0 | 1>(1);
  const [amount, setAmount] = useState("");
  const [betResult, setBetResult] = useState<{ status: string; txHash?: string; error?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchMarket = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, activityRes] = await Promise.all([
        fetch(`/api/markets/${id}`, { cache: "no-store" }),
        fetch("/api/activity?limit=200", { cache: "no-store" }).catch(() => null),
      ]);

      if (!res.ok) {
        setError(res.status === 404 ? "Market not found" : `HTTP ${res.status}`);
        return;
      }
      const json = await res.json();
      setData({
        market: json.market,
        predictions: Array.isArray(json.predictions) ? json.predictions : [],
        weightedProbability: typeof json.weightedProbability === "number" ? json.weightedProbability : null,
        latestAgentTake: json.latestAgentTake ?? null,
      });

      if (activityRes && activityRes.ok) {
        const payload = await activityRes.json();
        const entries = Array.isArray(payload.activities)
          ? (payload.activities as MarketActivityEntry[])
          : [];
        const numericId = Number(id);
        const filtered = entries
          .filter((entry) => entry.marketId === numericId)
          .filter(
            (entry) =>
              entry.type === "prediction" ||
              entry.type === "debate" ||
              entry.type === "bet"
          )
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-60);
        setActivityTrail(filtered);
      } else {
        setActivityTrail([]);
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to load market");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchMarket(); }, [fetchMarket]);

  const market = data?.market;
  const predictions = data?.predictions ?? [];

  const yesPercent = market ? Math.round(market.impliedProbYes * 100) : 50;
  const noPercent = 100 - yesPercent;
  const category = market ? categorizeMarket(market.question) : "other";

  const now = Date.now() / 1000;
  const daysLeft = market ? Math.max(0, Math.floor((market.resolutionTime - now) / 86400)) : 0;
  const hoursLeft = market ? Math.max(0, Math.floor((market.resolutionTime - now) / 3600)) : 0;
  const isExpired = market ? market.resolutionTime <= now : false;

  const poolWei = market ? safeBigInt(market.totalPool) : 0n;
  const poolDisplay = (poolWei / 10n ** 18n).toString();

  const disagreement = computeDisagreement(predictions);
  const isHot = (market?.tradeCount ?? 0) > 3;
  const isContested = disagreement > 0.15;
  const predictionTrail = activityTrail.filter(
    (entry) => entry.type === "prediction" && typeof entry.probability === "number"
  );
  const debateTrail = activityTrail
    .filter((entry) => entry.type === "debate")
    .slice(-4)
    .reverse();

  const statusLabel = market
    ? market.status === 0
      ? isExpired ? "PENDING" : "LIVE"
      : ["LIVE", "CLOSED", "RESOLVED"][market.status] ?? "???"
    : "";
  const statusColor =
    market?.status === 0
      ? isExpired
        ? "bg-neo-orange/15 text-neo-orange border-neo-orange/30"
        : "bg-neo-green/15 text-neo-green border-neo-green/30"
      : market?.status === 2
        ? "bg-neo-purple/15 text-neo-purple border-neo-purple/30"
        : "bg-neo-yellow/15 text-neo-yellow border-neo-yellow/30";

  // Bet calculations
  const amountBigInt = useMemo(() => {
    try { return BigInt(Math.floor(parseFloat(amount || "0") * 1e18)); }
    catch { return 0n; }
  }, [amount]);

  const estPayout = useMemo(() => {
    if (!market || amountBigInt <= 0n) return 0n;
    const winningPool = outcome === 1 ? BigInt(market.yesPool) : BigInt(market.noPool);
    const newWinningPool = winningPool + amountBigInt;
    const newTotalPool = BigInt(market.totalPool) + amountBigInt;
    return newWinningPool > 0n ? computePayout(amountBigInt, newTotalPool, newWinningPool, market.feeBps) : 0n;
  }, [market, amountBigInt, outcome]);

  const estMultiple = amountBigInt > 0n ? Number(estPayout) / Number(amountBigInt) : 0;

  async function handleBet() {
    if (!market || amountBigInt <= 0n || !isConnected) return;
    setBetResult(null);
    try {
      const calls = buildBetCalls(market.address, outcome, amountBigInt);
      const response = await sendAsync(calls);
      setBetResult({ status: "success", txHash: response.transaction_hash });
    } catch (err: any) {
      setBetResult({ status: "error", error: err.message });
    }
  }

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: market?.question, url }); }
      catch {}
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-3xl mx-auto px-4 pt-8">
        <TamagotchiLoader text="Loading market..." />
      </div>
    </div>
  );

  if (error || !market) return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-3xl mx-auto px-4 pt-8">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors mb-6">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to Dashboard
        </Link>
        <TamagotchiEmptyState message={error ?? "Market not found"} />
      </div>
    </div>
  );

  const presets = ["10", "50", "100", "500"];

  return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 pb-20 space-y-5">
        {/* Back navigation */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to Dashboard
        </Link>

        {/* Market Header */}
        <div className="neo-card p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className={`neo-badge text-xs py-0.5 px-2 ${statusColor}`}>
              {statusLabel}
            </span>
            <span className="text-xs font-medium text-neo-brand/80 uppercase tracking-wider">
              {category}
            </span>
            <span className="text-xs text-white/30 ml-auto">
              {isExpired ? "Expired" : daysLeft > 0 ? `${daysLeft}d left` : `${hoursLeft}h left`}
            </span>
          </div>

          {(isHot || isContested) && (
            <div className="flex items-center gap-1.5 mb-3">
              {isHot && (
                <span className="text-xs px-1.5 py-0.5 bg-neo-yellow/10 border border-neo-yellow/20 rounded text-neo-yellow font-medium">
                  Hot
                </span>
              )}
              {isContested && (
                <span className="text-xs px-1.5 py-0.5 bg-neo-orange/10 border border-neo-orange/20 rounded text-neo-orange font-medium">
                  Contested
                </span>
              )}
            </div>
          )}

          <h1 className="font-heading font-bold text-xl sm:text-2xl text-white leading-snug text-balance mb-4">
            {market.question}
          </h1>

          {/* Share */}
          <button
            type="button"
            onClick={handleShare}
            className="text-xs text-white/40 hover:text-white/60 font-medium transition-colors"
          >
            {copied ? "Copied!" : "Share"}
          </button>
        </div>

        {/* Probability Visualization */}
        <div className="neo-card p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="font-heading font-bold text-sm text-neo-green">YES {yesPercent}%</span>
            <span className="font-heading font-bold text-sm text-neo-red">NO {noPercent}%</span>
          </div>
          <div className="relative w-full h-6 bg-white/[0.05] rounded-full overflow-hidden">
            <div
              className="absolute left-0 top-0 bottom-0 bg-neo-green/30 rounded-l-full prob-bar"
              style={{ width: `${yesPercent}%` }}
            />
            <div
              className="absolute right-0 top-0 bottom-0 bg-neo-red/30 rounded-r-full"
              style={{ width: `${noPercent}%` }}
            />
            {/* Agent prediction dots */}
            {predictions.map((pred) => {
              const voice = getAgentVoiceByName(pred.agent);
              const dotColor = voice?.colorClass?.replace("text-", "bg-") ?? "bg-neo-blue";
              const left = Math.max(2, Math.min(98, pred.predictedProb * 100));
              return (
                <div
                  key={pred.agent}
                  className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border border-white/20 ${dotColor}`}
                  style={{ left: `${left}%`, marginLeft: -5 }}
                  title={`${pred.agent}: ${Math.round(pred.predictedProb * 100)}%`}
                />
              );
            })}
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {predictions.map((pred) => {
              const voice = getAgentVoiceByName(pred.agent);
              return (
                <span key={pred.agent} className="flex items-center gap-1 text-[10px] text-white/40">
                  <span className={`w-1.5 h-1.5 rounded-full ${voice?.colorClass?.replace("text-", "bg-") ?? "bg-neo-blue"}`} />
                  {pred.agent}
                </span>
              );
            })}
          </div>
        </div>

        {/* Market Analytics */}
        <div className="neo-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading font-bold text-sm text-white">Forecast Trail</h2>
            <span className="text-[10px] font-mono text-white/35">
              {predictionTrail.length} points
            </span>
          </div>
          {predictionTrail.length >= 2 ? (
            <div className="space-y-2">
              <div className="h-20 rounded-lg border border-white/10 bg-white/[0.03] p-2">
                <svg viewBox="0 0 320 64" className="w-full h-full">
                  {predictionTrail.map((point, idx) => {
                    if (typeof point.probability !== "number") return null;
                    const x = (idx / Math.max(1, predictionTrail.length - 1)) * 320;
                    const y = 64 - Math.max(0, Math.min(1, point.probability)) * 64;
                    return (
                      <circle
                        key={`${point.id}-${idx}`}
                        cx={x}
                        cy={y}
                        r="2"
                        fill="rgba(93,245,213,0.9)"
                      />
                    );
                  })}
                  <polyline
                    points={predictionTrail
                      .map((point, idx) => {
                        const probability =
                          typeof point.probability === "number"
                            ? point.probability
                            : 0.5;
                        const x =
                          (idx / Math.max(1, predictionTrail.length - 1)) * 320;
                        const y = 64 - Math.max(0, Math.min(1, probability)) * 64;
                        return `${x},${y}`;
                      })
                      .join(" ")}
                    fill="none"
                    stroke="rgba(93,245,213,0.85)"
                    strokeWidth="2"
                  />
                </svg>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {predictionTrail
                  .slice(-5)
                  .reverse()
                  .map((point) => (
                    <span
                      key={`pred-${point.id}`}
                      className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/65"
                    >
                      {point.actor}:{" "}
                      {Math.round((point.probability ?? 0.5) * 100)}%
                    </span>
                  ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-white/45">Need more live predictions for charting.</p>
          )}

          <div className="mt-4 pt-3 border-t border-white/10">
            <h3 className="font-heading font-bold text-xs text-white/70 mb-2">
              Debate Thread
            </h3>
            {debateTrail.length > 0 ? (
              <div className="space-y-2">
                {debateTrail.map((entry) => (
                  <div
                    key={`debate-${entry.id}`}
                    className="rounded-lg border border-white/10 bg-white/[0.03] p-2"
                  >
                    <p className="text-[10px] font-mono text-white/70">
                      {entry.actor}
                      {entry.debateTarget ? ` -> ${entry.debateTarget}` : ""}
                    </p>
                    <p className="text-[11px] text-white/55 mt-1 line-clamp-2">
                      {entry.detail ?? "debate update"}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/45">
                No live rebuttal yet for this market.
              </p>
            )}
          </div>
        </div>

        {/* Inline Bet Form */}
        {market.status === 0 && !isExpired && (
          <div className="neo-card p-5">
            <h2 className="font-heading font-bold text-sm text-white mb-3">Place Bet</h2>

            {/* Outcome Toggle */}
            <div className="flex border border-white/10 mb-3 rounded-lg overflow-hidden">
              <button
                onClick={() => setOutcome(1)}
                className={`flex-1 py-2.5 font-heading font-bold text-sm transition-all ${
                  outcome === 1
                    ? "bg-neo-green/15 text-neo-green"
                    : "bg-white/[0.03] text-white/40 hover:text-white/60"
                }`}
              >
                YES
              </button>
              <div className="w-px bg-white/10" />
              <button
                onClick={() => setOutcome(0)}
                className={`flex-1 py-2.5 font-heading font-bold text-sm transition-all ${
                  outcome === 0
                    ? "bg-neo-red/15 text-neo-red"
                    : "bg-white/[0.03] text-white/40 hover:text-white/60"
                }`}
              >
                NO
              </button>
            </div>

            {/* Amount */}
            <label className="block text-xs font-medium text-white/40 mb-1.5">Amount (STRK)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="neo-input w-full mb-2"
            />
            <div className="flex gap-1.5 mb-3">
              {presets.map((p) => (
                <button
                  key={p}
                  onClick={() => setAmount(p)}
                  className={`flex-1 py-1.5 border text-xs font-medium transition-all rounded-lg ${
                    amount === p
                      ? "bg-neo-blue/15 text-neo-blue border-neo-blue/30"
                      : "bg-white/[0.04] text-white/60 border-white/10 hover:bg-white/[0.08]"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Payout Preview */}
            {amountBigInt > 0n && (
              <div className="border border-white/[0.07] p-3 mb-3 space-y-1.5 bg-white/[0.03] rounded-lg">
                <div className="flex justify-between text-xs">
                  <span className="text-white/50">Potential payout</span>
                  <span className="font-mono font-bold text-white/80">
                    {(Number(estPayout) / 1e18).toFixed(2)} STRK
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-white/50">Multiplier</span>
                  <span className="font-mono font-bold text-neo-green">{estMultiple.toFixed(2)}x</span>
                </div>
              </div>
            )}

            {isConnected ? (
              <button
                onClick={handleBet}
                disabled={betPending || amountBigInt <= 0n}
                className={`w-full py-3 rounded-lg font-heading font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  outcome === 1
                    ? "bg-neo-green/20 text-neo-green border border-neo-green/30 hover:bg-neo-green/30"
                    : "bg-neo-red/20 text-neo-red border border-neo-red/30 hover:bg-neo-red/30"
                }`}
              >
                {betPending
                  ? "Signing Transaction..."
                  : `Bet ${outcome === 1 ? "YES" : "NO"}${amount ? ` \u2014 ${amount} STRK` : ""}`}
              </button>
            ) : (
              <div className="text-center py-3 border border-dashed border-white/10 text-sm text-white/50 rounded-lg">
                Connect Wallet to Place Bets
              </div>
            )}

            {betResult && (
              <div className={`mt-3 p-2.5 border text-xs font-mono rounded-lg ${
                betResult.status === "success"
                  ? "border-neo-green/30 bg-neo-green/10"
                  : "border-neo-red/30 bg-neo-red/10"
              }`}>
                {betResult.status === "success" ? (
                  <>
                    <span className="font-bold">Bet placed on-chain</span>
                    {betResult.txHash && (
                      <a
                        href={`https://sepolia.voyager.online/tx/${betResult.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-neo-blue mt-1 hover:underline break-all"
                      >
                        View on Voyager: {betResult.txHash.slice(0, 20)}...
                      </a>
                    )}
                  </>
                ) : (
                  <span className="text-neo-red">{betResult.error}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Agent Predictions List */}
        {predictions.length > 0 && (
          <div className="neo-card overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.07] bg-white/[0.03]">
              <h2 className="font-heading font-bold text-sm text-white">Agent Predictions</h2>
            </div>
            <div className="divide-y divide-white/[0.05]">
              {predictions.map((pred) => {
                const voice = getAgentVoiceByName(pred.agent);
                const grade = brierGrade(pred.brierScore);
                return (
                  <div key={pred.agent} className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-1 h-6 rounded-full ${voice?.colorClass?.replace("text-", "bg-") ?? "bg-neo-blue"}`} />
                      <Link
                        href={`/agent/${encodeURIComponent(pred.agent)}`}
                        className={`font-mono text-sm font-medium hover:underline ${voice?.colorClass ?? "text-neo-blue"}`}
                      >
                        {pred.agent}
                      </Link>
                      {voice && (
                        <span className="text-xs text-white/40">{voice.signature}</span>
                      )}
                      <span className={`ml-auto w-5 h-5 flex items-center justify-center text-[9px] font-bold rounded ${grade.colorClass}`}>
                        {grade.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="font-mono text-sm font-bold text-white/80">
                        {Math.round(pred.predictedProb * 100)}% YES
                      </span>
                      <span className="text-xs text-white/35 font-mono">
                        Brier: {pred.brierScore.toFixed(3)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Market Details Panel */}
        <div className="neo-card p-5 space-y-3">
          <h2 className="font-heading font-bold text-sm text-white mb-2">Market Details</h2>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-white/40">Contract</span>
              <a
                href={`https://sepolia.voyager.online/contract/${market.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-neo-blue hover:underline"
              >
                {market.address.slice(0, 10)}...{market.address.slice(-6)}
              </a>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Oracle</span>
              <span className="font-mono text-white/60">
                {market.oracle.slice(0, 10)}...{market.oracle.slice(-6)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Fee</span>
              <span className="font-mono text-white/60">{market.feeBps / 100}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Total Pool</span>
              <span className="font-mono text-white/60">{poolDisplay} STRK</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">YES Pool</span>
              <span className="font-mono text-neo-green">
                {(safeBigInt(market.yesPool) / 10n ** 18n).toString()} STRK
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">NO Pool</span>
              <span className="font-mono text-neo-red">
                {(safeBigInt(market.noPool) / 10n ** 18n).toString()} STRK
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Resolution</span>
              <span className="font-mono text-white/60">
                {new Date(market.resolutionTime * 1000).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
