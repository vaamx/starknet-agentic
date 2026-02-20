"use client";

import { useState, useEffect } from "react";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import { buildResolveCalls, buildFinalizeCalls } from "@/lib/contracts";
import { getAgentVoiceByName } from "@/lib/agent-voices";

interface AgentPrediction {
  agent: string;
  predictedProb: number;
  brierScore: number;
  predictionCount: number;
}

interface MarketCardProps {
  id: number;
  question: string;
  address: string;
  oracle: string;
  impliedProbYes: number;
  impliedProbNo: number;
  totalPool: string;
  status: number;
  resolutionTime: number;
  agentConsensus?: number;
  weightedProb?: number | null;
  tradeCount?: number;
  category?: string;
  latestAgentTake?: {
    agentName: string;
    probability: number;
    reasoning: string;
    timestamp: number;
  } | null;
  predictions?: AgentPrediction[];
  onAnalyze: (marketId: number) => void;
  onBet: (marketId: number) => void;
}

export default function MarketCard({
  id,
  question,
  address: marketAddress,
  oracle,
  impliedProbYes,
  totalPool,
  status,
  resolutionTime,
  agentConsensus,
  weightedProb,
  tradeCount,
  category,
  latestAgentTake,
  predictions = [],
  onAnalyze,
  onBet,
}: MarketCardProps) {
  const { address: connectedAddress, isConnected } = useAccount();
  const { sendAsync, isPending: resolving } = useSendTransaction({});

  const [expanded, setExpanded] = useState(false);
  const [resolveResult, setResolveResult] = useState<string | null>(null);
  const [agreeCount, setAgreeCount] = useState(0);
  const [disagreeCount, setDisagreeCount] = useState(0);
  const [reaction, setReaction] = useState<"agree" | "disagree" | null>(null);
  const [signalOpen, setSignalOpen] = useState(false);
  const [signalValue, setSignalValue] = useState(50);
  const [signalNote, setSignalNote] = useState("");
  const [signalUpdatedAt, setSignalUpdatedAt] = useState<number | null>(null);

  const yesPercent = Math.round(impliedProbYes * 100);
  const noPercent = 100 - yesPercent;
  const consensusPercent = agentConsensus
    ? Math.round(agentConsensus * 100)
    : null;
  const consensusBase =
    typeof weightedProb === "number"
      ? weightedProb
      : agentConsensus ?? impliedProbYes;
  const latestDelta =
    latestAgentTake && typeof latestAgentTake.probability === "number"
      ? Math.round((latestAgentTake.probability - consensusBase) * 100)
      : null;
  const latestVoice = getAgentVoiceByName(latestAgentTake?.agentName);

  const now = Date.now() / 1000;
  const daysLeft = Math.max(
    0,
    Math.floor((resolutionTime - now) / 86400)
  );
  const isExpired = resolutionTime <= now;

  const poolDisplay =
    BigInt(totalPool) > 10n ** 18n
      ? `${(Number(BigInt(totalPool)) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      : `${totalPool}`;

  const statusLabel = status === 0
    ? (isExpired ? "PENDING" : "LIVE")
    : (["LIVE", "CLOSED", "RESOLVED"][status] ?? "???");
  const statusColor =
    status === 0
      ? isExpired
        ? "bg-neo-orange/20 text-neo-orange"
        : "bg-neo-green/20 text-neo-green"
      : status === 2
        ? "bg-neo-purple/20 text-neo-purple"
        : "bg-neo-yellow/20 text-neo-yellow";

  const edge =
    consensusPercent !== null
      ? Math.abs(yesPercent - consensusPercent)
      : 0;

  useEffect(() => {
    try {
      const raw = localStorage.getItem("agent-reactions-v1");
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<
        string,
        { agree: number; disagree: number; choice?: "agree" | "disagree" | null }
      >;
      const entry = parsed[id];
      if (entry) {
        setAgreeCount(entry.agree ?? 0);
        setDisagreeCount(entry.disagree ?? 0);
        setReaction(entry.choice ?? null);
      }
    } catch {
      // Ignore malformed storage
    }
  }, [id]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("user-signals-v1");
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<
        string,
        { value: number; note?: string; updatedAt: number }
      >;
      const entry = parsed[id];
      if (entry) {
        setSignalValue(entry.value ?? 50);
        setSignalNote(entry.note ?? "");
        setSignalUpdatedAt(entry.updatedAt ?? null);
      }
    } catch {
      // Ignore malformed storage
    }
  }, [id]);

  const persistReactions = (
    nextAgree: number,
    nextDisagree: number,
    nextChoice: "agree" | "disagree" | null
  ) => {
    try {
      const raw = localStorage.getItem("agent-reactions-v1");
      const parsed = raw ? JSON.parse(raw) : {};
      parsed[id] = {
        agree: nextAgree,
        disagree: nextDisagree,
        choice: nextChoice,
      };
      localStorage.setItem("agent-reactions-v1", JSON.stringify(parsed));
    } catch {
      // Ignore storage failures
    }
  };

  const persistSignal = (
    nextValue: number,
    nextNote: string,
    updatedAt: number
  ) => {
    try {
      const raw = localStorage.getItem("user-signals-v1");
      const parsed = raw ? JSON.parse(raw) : {};
      parsed[id] = {
        value: nextValue,
        note: nextNote,
        updatedAt,
      };
      localStorage.setItem("user-signals-v1", JSON.stringify(parsed));
    } catch {
      // Ignore storage failures
    }
  };

  const clearSignal = () => {
    setSignalUpdatedAt(null);
    try {
      const raw = localStorage.getItem("user-signals-v1");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      delete parsed[id];
      localStorage.setItem("user-signals-v1", JSON.stringify(parsed));
    } catch {
      // Ignore storage failures
    }
  };

  const handleAgree = () => {
    let nextAgree = agreeCount;
    let nextDisagree = disagreeCount;
    let nextChoice: "agree" | "disagree" | null = reaction;

    if (reaction === "agree") {
      nextAgree = Math.max(0, agreeCount - 1);
      nextChoice = null;
    } else {
      if (reaction === "disagree") {
        nextDisagree = Math.max(0, disagreeCount - 1);
      }
      nextAgree = agreeCount + 1;
      nextChoice = "agree";
    }

    setAgreeCount(nextAgree);
    setDisagreeCount(nextDisagree);
    setReaction(nextChoice);
    persistReactions(nextAgree, nextDisagree, nextChoice);
  };

  const handleDisagree = () => {
    let nextAgree = agreeCount;
    let nextDisagree = disagreeCount;
    let nextChoice: "agree" | "disagree" | null = reaction;

    if (reaction === "disagree") {
      nextDisagree = Math.max(0, disagreeCount - 1);
      nextChoice = null;
    } else {
      if (reaction === "agree") {
        nextAgree = Math.max(0, agreeCount - 1);
      }
      nextDisagree = disagreeCount + 1;
      nextChoice = "disagree";
    }

    setAgreeCount(nextAgree);
    setDisagreeCount(nextDisagree);
    setReaction(nextChoice);
    persistReactions(nextAgree, nextDisagree, nextChoice);
  };

  const handleSaveSignal = () => {
    const now = Date.now();
    setSignalUpdatedAt(now);
    persistSignal(signalValue, signalNote, now);
    setSignalOpen(false);
  };

  // Check if connected wallet is the oracle for this market
  const isOracle =
    isConnected &&
    connectedAddress &&
    oracle &&
    connectedAddress.toLowerCase() === oracle.toLowerCase();

  const handleResolve = async (outcome: 0 | 1) => {
    setResolveResult(null);
    try {
      const resolveCalls = buildResolveCalls(marketAddress, outcome);
      const finalizeCalls = buildFinalizeCalls(id, outcome);
      const allCalls = [...resolveCalls, ...finalizeCalls];

      const response = await sendAsync(allCalls);
      setResolveResult(
        `Resolved as ${outcome === 1 ? "YES" : "NO"} — tx: ${response.transaction_hash.slice(0, 16)}...`
      );
    } catch (err: any) {
      setResolveResult(`Error: ${err.message}`);
    }
  };

  return (
    <div className="neo-card-hover group relative overflow-hidden">
      {/* Top glow stripe */}
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-neo-green/70 via-neo-blue/60 to-neo-purple/70" />

      <div className="p-5 pt-6">
        {/* Header Row */}
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className={`neo-badge text-[10px] py-0.5 px-2 ${statusColor}`}
              >
                {statusLabel}
              </span>
              {category && (
                <span className="neo-badge bg-white/5 text-[10px] py-0.5 px-2 border-white/10">
                  {category.toUpperCase()}
                </span>
              )}
              <span className="font-mono text-[10px] text-white/40 tracking-wider uppercase">
                #{id}
              </span>
            </div>
            <h3 className="font-heading font-semibold text-[17px] leading-snug text-balance text-white">
              {question}
            </h3>
          </div>

          {/* Big YES number */}
          <div className="text-right shrink-0 -mt-0.5">
            <div className="font-mono font-bold text-3xl tracking-tighter leading-none text-white">
              {yesPercent}
              <span className="text-lg text-white/40">%</span>
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-white/40 mt-0.5">
              Yes
            </div>
          </div>
        </div>

        {/* Dual Probability Bar */}
        <div className="mb-4">
          <div className="flex h-4 rounded-full bg-white/10 overflow-hidden">
            <div
              className="prob-bar bg-neo-green/80 flex items-center justify-center transition-all"
              style={{ width: `${yesPercent}%` }}
            >
              {yesPercent > 15 && (
                <span className="text-[10px] font-semibold text-neo-dark/70">
                  YES {yesPercent}%
                </span>
              )}
            </div>
            <div
              className="bg-neo-pink/70 flex items-center justify-center flex-1"
            >
              {noPercent > 15 && (
                <span className="text-[10px] font-semibold text-neo-dark/70">
                  NO {noPercent}%
                </span>
              )}
            </div>
          </div>

          {/* Agent Consensus line */}
          {consensusPercent !== null && (
            <div className="relative h-4 mt-1">
              <div className="absolute top-0 h-full w-full">
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-neo-blue/80"
                  style={{ left: `${consensusPercent}%` }}
                />
                <div
                  className="absolute -top-0.5 w-2.5 h-2.5 bg-neo-blue -translate-x-1/2 rotate-45 shadow-[0_0_12px_rgba(76,141,255,0.6)]"
                  style={{ left: `${consensusPercent}%` }}
                />
              </div>
              <div className="flex items-center gap-1.5 pt-0.5">
                <div className="w-2 h-2 bg-neo-blue rotate-45 shrink-0" />
                <span className="text-[10px] text-white/60 font-medium">
                  Swarm consensus: <span className="font-mono font-bold text-neo-blue">{consensusPercent}%</span>
                  {edge > 5 && (
                    <span className="ml-1 text-neo-yellow font-bold">
                      ({edge}pt edge)
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}

          {consensusPercent !== null && (
            <div className="flex items-center gap-2 mt-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={handleAgree}
                  className={`w-7 h-7 flex items-center justify-center rounded-md border border-white/10 text-[10px] font-black ${
                    reaction === "agree"
                      ? "bg-neo-green/20 text-neo-green"
                      : "bg-white/5 text-white/50"
                  }`}
                  aria-label="Agree with agent consensus"
                >
                  <svg
                    className="w-3 h-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M7 11v9m0-9h6l1.5-5.5a1 1 0 0 0-1-1.5H9V2.5a1.5 1.5 0 0 0-3 0V11z" />
                    <path d="M13 11h5a2 2 0 0 1 2 2v7a1 1 0 0 1-1 1h-5" />
                  </svg>
                </button>
                <button
                  onClick={handleDisagree}
                  className={`w-7 h-7 flex items-center justify-center rounded-md border border-white/10 text-[10px] font-black ${
                    reaction === "disagree"
                      ? "bg-neo-pink/20 text-neo-pink"
                      : "bg-white/5 text-white/50"
                  }`}
                  aria-label="Disagree with agent consensus"
                >
                  <svg
                    className="w-3 h-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M17 13V4m0 9h-6l-1.5 5.5a1 1 0 0 0 1 1.5H15v1.5a1.5 1.5 0 0 0 3 0V13z" />
                    <path d="M11 13H6a2 2 0 0 1-2-2V4a1 1 0 0 1 1-1h5" />
                  </svg>
                </button>
              </div>
              <span className="text-[10px] text-white/40 font-mono">
                {agreeCount} agree · {disagreeCount} disagree
              </span>
            </div>
          )}
        </div>

        {/* Stats Row */}
        <div className="flex items-center gap-1.5 mb-4">
          <span className="neo-badge bg-white/5 text-[10px] py-0.5 px-2 border-white/10">
            {poolDisplay} STRK
          </span>
          <span className="neo-badge bg-white/5 text-[10px] py-0.5 px-2 border-white/10">
            {isExpired ? "Expired" : `${daysLeft}d left`}
          </span>
          {typeof tradeCount === "number" && tradeCount > 0 && (
            <span className="neo-badge bg-white/5 text-[10px] py-0.5 px-2 border-white/10">
              {tradeCount} trades
            </span>
          )}
          {predictions.length > 0 && (
            <span className="neo-badge bg-neo-blue/10 text-neo-blue text-[10px] py-0.5 px-2 border-neo-blue/30">
              {predictions.length} agents
            </span>
          )}
          {typeof weightedProb === "number" && (
            <span className="neo-badge bg-neo-green/10 text-neo-green text-[10px] py-0.5 px-2 border-neo-green/30">
              Weighted {Math.round(weightedProb * 100)}%
            </span>
          )}
          {signalUpdatedAt && (
            <span className="neo-badge bg-neo-yellow/10 text-neo-yellow text-[10px] py-0.5 px-2 border-neo-yellow/30">
              Your signal {signalValue}%
            </span>
          )}
        </div>

        {signalUpdatedAt && signalNote && (
          <div className="mb-3 text-[10px] text-white/50 line-clamp-2">
            <span className="font-mono text-white/40">Your note:</span> {signalNote}
          </div>
        )}
        {signalUpdatedAt && consensusPercent !== null && (
          <div className="mb-3 text-[10px] text-white/40">
            Your edge vs swarm:{" "}
            <span
              className={`font-mono font-bold ${
                signalValue - consensusPercent >= 0
                  ? "text-neo-green"
                  : "text-neo-pink"
              }`}
            >
              {(signalValue - consensusPercent).toFixed(0)}pt
            </span>
          </div>
        )}

        {latestAgentTake?.reasoning && (
          <div className="mb-4 text-[11px] text-white/60">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="font-mono text-[10px] text-neo-blue">
                Latest {latestAgentTake.agentName}:
              </span>
              {latestVoice && (
                <span
                  className={`text-[10px] font-mono ${latestVoice.colorClass}`}
                >
                  {latestVoice.signature}
                </span>
              )}
              {latestDelta !== null && (
                <span
                  className={`text-[10px] font-mono ${
                    latestDelta >= 0 ? "text-neo-green" : "text-neo-pink"
                  }`}
                >
                  Δ {latestDelta >= 0 ? "+" : ""}
                  {latestDelta}pt
                </span>
              )}
            </div>
            <span>{latestAgentTake.reasoning}</span>{" "}
            <button
              onClick={() => onAnalyze(id)}
              className="text-neo-blue text-[10px] font-mono underline ml-1"
            >
              See full analysis
            </button>
          </div>
        )}

        {/* Agent Predictions Drawer */}
        {predictions.length > 0 && (
          <>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1.5 text-xs font-semibold text-white/60 hover:text-white transition-colors mb-3"
            >
              <svg
                className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                  clipRule="evenodd"
                />
              </svg>
              Agent forecasts
            </button>

            {expanded && (
              <div className="border border-white/10 bg-white/[0.03] -mx-5 px-5 py-3 mb-4">
                <div className="space-y-2">
                  {predictions.map((p, i) => {
                    const prob = Math.round(p.predictedProb * 100);
                    return (
                      <div
                        key={p.agent}
                        className="flex items-center gap-3 animate-enter"
                        style={{ animationDelay: `${i * 40}ms` }}
                      >
                        <span className="font-mono text-[11px] text-white/50 w-20 truncate">
                          {p.agent.slice(0, 8)}..
                        </span>
                        <div className="flex-1 h-2 bg-white/10 overflow-hidden rounded-full">
                          <div
                            className="h-full bg-neo-blue/70"
                            style={{ width: `${prob}%` }}
                          />
                        </div>
                        <span className="font-mono font-bold text-xs w-10 text-right">
                          {prob}%
                        </span>
                        <span
                          className={`font-mono text-[10px] w-12 text-right ${
                            p.brierScore < 0.15
                              ? "text-neo-green"
                              : p.brierScore < 0.25
                                ? "text-neo-orange"
                                : "text-neo-pink"
                          }`}
                        >
                          {p.brierScore.toFixed(3)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* Actions */}
        {status === 0 && !isExpired && (
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => onAnalyze(id)}
              className="neo-btn-dark flex-1 text-sm py-2.5 gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
              </svg>
              Analyze
            </button>
            <button
              onClick={() => setSignalOpen((prev) => !prev)}
              className="neo-btn-secondary flex-1 text-sm py-2.5"
            >
              {signalOpen ? "Close Signal" : "Signal"}
            </button>
            <button
              onClick={() => onBet(id)}
              className="neo-btn-primary flex-1 text-sm py-2.5"
            >
              Place Bet
            </button>
          </div>
        )}

        {signalOpen && (
          <div className="mt-3 border border-white/10 rounded-lg bg-white/[0.04] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-widest text-white/50">
                Your signal (local)
              </span>
              <span className="font-mono text-sm text-neo-yellow">
                {signalValue}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={signalValue}
              onChange={(e) => setSignalValue(Number(e.target.value))}
              className="w-full accent-neo-yellow"
            />
            <input
              value={signalNote}
              onChange={(e) => setSignalNote(e.target.value)}
              placeholder="Optional note (why?)"
              className="neo-input mt-2"
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={handleSaveSignal}
                className="neo-btn-primary px-3 py-2 text-xs"
              >
                Save Signal
              </button>
              {signalUpdatedAt && (
                <button
                  onClick={clearSignal}
                  className="neo-btn-secondary px-3 py-2 text-xs"
                >
                  Clear
                </button>
              )}
              {signalUpdatedAt && (
                <span className="text-[10px] text-white/40">
                  saved {timeAgo(signalUpdatedAt)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Resolve buttons — show for expired, unresolved markets */}
        {status === 0 && isExpired && (
          <div className="space-y-2">
            {isOracle ? (
              <>
                <p className="text-[10px] font-mono text-neo-orange font-bold uppercase tracking-wider">
                  Resolution pending — you are the oracle
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => handleResolve(1)}
                    disabled={resolving}
                    className="flex-1 text-sm py-2.5 rounded-lg border border-neo-green/40 bg-neo-green/10 text-neo-green font-semibold hover:bg-neo-green/20 transition-colors disabled:opacity-50"
                  >
                    {resolving ? "..." : "Resolve YES"}
                  </button>
                  <button
                    onClick={() => handleResolve(0)}
                    disabled={resolving}
                    className="flex-1 text-sm py-2.5 rounded-lg border border-neo-pink/40 bg-neo-pink/10 text-neo-pink font-semibold hover:bg-neo-pink/20 transition-colors disabled:opacity-50"
                  >
                    {resolving ? "..." : "Resolve NO"}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                Resolution pending — waiting for oracle
              </p>
            )}
            {resolveResult && (
              <p className={`text-[10px] font-mono ${resolveResult.startsWith("Error") ? "text-neo-pink" : "text-neo-green"}`}>
                {resolveResult}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
