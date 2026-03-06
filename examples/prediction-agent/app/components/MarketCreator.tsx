"use client";

import { useState, useEffect } from "react";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import { buildCreateMarketCalls } from "@/lib/contracts";
import { reviewMarketQuestion } from "@/lib/market-quality";

interface MarketCreatorProps {
  onClose: () => void;
  onCreated?: () => Promise<void> | void;
}

const DURATION_PRESETS = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

const FEE_PRESETS = [
  { label: "1%", bps: 100 },
  { label: "2%", bps: 200 },
  { label: "3%", bps: 300 },
  { label: "5%", bps: 500 },
];

export default function MarketCreator({ onClose, onCreated }: MarketCreatorProps) {
  const { address, isConnected } = useAccount();
  const { sendAsync, isPending } = useSendTransaction({});

  const [question, setQuestion] = useState("");
  const [days, setDays] = useState(30);
  const [feeBps, setFeeBps] = useState(200);
  const [result, setResult] = useState<{
    txHash?: string;
    error?: string;
  } | null>(null);

  const validDays = Number.isFinite(days) && days >= 1 && days <= 3650;
  const validFee = Number.isFinite(feeBps) && feeBps >= 0 && feeBps <= 1000;
  const resolutionDate = validDays
    ? new Date(Date.now() + days * 86_400_000)
    : null;
  const review = reviewMarketQuestion(question);

  const qualityColor = review.score >= 80
    ? "text-neo-green"
    : review.score >= 60
      ? "text-neo-yellow"
      : "text-neo-red";
  const qualityBarColor = review.score >= 80
    ? "bg-neo-green"
    : review.score >= 60
      ? "bg-neo-yellow"
      : "bg-neo-red";

  const canDeploy = question.trim().length > 0 && validDays && validFee && isConnected && !isPending;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const handleDeploy = async () => {
    if (!canDeploy || !address) return;
    setResult(null);
    try {
      const calls = buildCreateMarketCalls(question.trim(), days, feeBps, address);
      const response = await sendAsync(calls);
      try {
        await fetch("/api/markets/register-question", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            txHash: response.transaction_hash,
            question: question.trim(),
          }),
        });
      } catch {
        // Registration is best-effort
      }
      setResult({ txHash: response.transaction_hash });
      if (onCreated) void onCreated();
    } catch (err: any) {
      setResult({ error: err.message || "Transaction rejected" });
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg neo-card shadow-neo-lg animate-modal-in overflow-hidden">
        {/* Quick Flow Steps */}
        <div className="flex items-stretch border-b border-white/[0.07]">
          {["Create", "Deploy", "Trade", "Resolve"].map((step, i) => (
            <div
              key={step}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-[11px] font-semibold uppercase tracking-wider border-r border-white/[0.06] last:border-r-0 ${
                i === 0
                  ? "bg-neo-brand/10 text-neo-brand"
                  : "text-white/30"
              }`}
            >
              <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-bold ${
                i === 0
                  ? "bg-neo-brand/25 text-neo-brand"
                  : "bg-white/[0.06] text-white/25"
              }`}>
                {i + 1}
              </span>
              {step}
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-neo-green/10 border border-neo-green/20 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-neo-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </div>
            <div>
              <h3 className="font-heading font-bold text-base text-white">
                Create Market
              </h3>
              <p className="text-[11px] text-white/40 mt-0.5">
                Deploy a prediction market on Starknet Sepolia
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/15 text-white/50 hover:bg-white/[0.08] hover:text-white/80 transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Question */}
          <div>
            <label className="block text-xs font-semibold text-white/60 mb-1.5">
              Question
            </label>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Will ETH hit $10k by December 2026?"
              maxLength={31}
              autoFocus
              className="neo-input w-full text-sm"
            />
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[10px] text-white/30 font-mono">
                {question.length}/31 chars
              </span>
              {question.length > 0 && (
                <span className={`text-[10px] font-semibold font-mono ${qualityColor}`}>
                  Score: {review.score}/100
                </span>
              )}
            </div>
          </div>

          {/* Duration presets */}
          <div>
            <label className="block text-xs font-semibold text-white/60 mb-1.5">
              Duration
            </label>
            <div className="flex gap-2">
              {DURATION_PRESETS.map((preset) => (
                <button
                  key={preset.days}
                  type="button"
                  onClick={() => setDays(preset.days)}
                  className={`flex-1 py-2 rounded-lg border text-sm font-semibold transition-all ${
                    days === preset.days
                      ? "border-neo-brand/40 bg-neo-brand/15 text-neo-brand"
                      : "border-white/[0.08] bg-white/[0.03] text-white/50 hover:border-white/15 hover:text-white/70"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {resolutionDate && (
              <p className="text-[10px] text-white/30 mt-1.5 font-mono">
                Resolves {resolutionDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </p>
            )}
          </div>

          {/* Fee presets */}
          <div>
            <label className="block text-xs font-semibold text-white/60 mb-1.5">
              Creator Fee
            </label>
            <div className="flex gap-2">
              {FEE_PRESETS.map((preset) => (
                <button
                  key={preset.bps}
                  type="button"
                  onClick={() => setFeeBps(preset.bps)}
                  className={`flex-1 py-2 rounded-lg border text-sm font-semibold transition-all ${
                    feeBps === preset.bps
                      ? "border-neo-brand/40 bg-neo-brand/15 text-neo-brand"
                      : "border-white/[0.08] bg-white/[0.03] text-white/50 hover:border-white/15 hover:text-white/70"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Quality check — compact inline */}
          {question.trim().length > 0 && (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">
                  Preflight Check
                </span>
                <span className={`text-xs font-bold font-mono ${qualityColor}`}>
                  {review.score}/100
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${qualityBarColor}`}
                  style={{ width: `${review.score}%` }}
                />
              </div>
              <div className="flex items-center gap-3 text-[10px] font-mono text-white/45">
                <span className="flex items-center gap-1">
                  <span className={review.isBinary ? "text-neo-green" : "text-white/30"}>
                    {review.isBinary ? "+" : "-"}
                  </span>
                  Binary
                </span>
                <span className="flex items-center gap-1">
                  <span className={review.hasTimeBound ? "text-neo-green" : "text-white/30"}>
                    {review.hasTimeBound ? "+" : "-"}
                  </span>
                  Time-bound
                </span>
                <span className="text-white/25">|</span>
                <span className="text-white/35">{review.categoryHint}</span>
              </div>
              {(review.issues.length > 0 || review.warnings.length > 0) && (
                <div className="space-y-0.5 pt-1 border-t border-white/[0.06]">
                  {review.issues.map((issue) => (
                    <p key={issue} className="text-[10px] text-neo-red">
                      {issue}
                    </p>
                  ))}
                  {review.warnings.map((warning) => (
                    <p key={warning} className="text-[10px] text-neo-yellow">
                      {warning}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Result feedback */}
          {result && (
            <div
              className={`rounded-xl border p-3 text-xs font-mono ${
                result.error
                  ? "border-red-500/30 bg-red-500/[0.08] text-neo-red"
                  : "border-neo-green/30 bg-neo-green/[0.08] text-neo-green"
              }`}
            >
              {result.error ? (
                <p>{result.error}</p>
              ) : (
                <div className="space-y-1">
                  <p className="font-semibold">Market deployed on-chain!</p>
                  {result.txHash && (
                    <a
                      href={`https://sepolia.voyager.online/tx/${result.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neo-cyan hover:underline"
                    >
                      View on Voyager
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Deploy button */}
          {isConnected ? (
            <button
              onClick={handleDeploy}
              disabled={!canDeploy}
              className="w-full py-3 rounded-xl font-heading font-bold text-sm bg-neo-brand/20 border border-neo-brand/30 text-neo-brand hover:bg-neo-brand/30 hover:border-neo-brand/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              {isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-neo-brand animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-neo-brand animate-bounce [animation-delay:0.1s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-neo-brand animate-bounce [animation-delay:0.2s]" />
                  Signing...
                </span>
              ) : result?.txHash ? (
                "Deploy Another Market"
              ) : (
                "Deploy Market"
              )}
            </button>
          ) : (
            <div className="py-3 rounded-xl border border-dashed border-white/10 text-center text-xs text-white/40">
              Connect wallet to create markets
            </div>
          )}

          {/* Footer info */}
          <div className="flex items-center justify-center gap-3 text-[10px] text-white/25">
            <span>Starknet Sepolia</span>
            <span className="text-white/10">|</span>
            <span>Collateral: STRK</span>
            <span className="text-white/10">|</span>
            <span>Oracle: Your wallet</span>
          </div>
        </div>
      </div>
    </div>
  );
}
