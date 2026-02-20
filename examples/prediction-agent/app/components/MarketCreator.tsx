"use client";

import { useState, useEffect } from "react";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import { buildCreateMarketCalls } from "@/lib/contracts";

interface MarketCreatorProps {
  onClose: () => void;
}

export default function MarketCreator({ onClose }: MarketCreatorProps) {
  const { address, isConnected } = useAccount();
  const { sendAsync, isPending } = useSendTransaction({});

  const [question, setQuestion] = useState("");
  const [days, setDays] = useState("30");
  const [feeBps, setFeeBps] = useState("200");
  const [result, setResult] = useState<{
    txHash?: string;
    error?: string;
  } | null>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const handleDeploy = async () => {
    if (!question.trim() || isPending || !isConnected || !address) return;

    setResult(null);

    try {
      const calls = buildCreateMarketCalls(
        question.trim(),
        parseInt(days) || 30,
        parseInt(feeBps) || 200,
        address
      );

      const response = await sendAsync(calls);

      // Register the question text server-side (no signing, just bookkeeping)
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
    } catch (err: any) {
      setResult({ error: err.message || "Transaction rejected" });
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg neo-card shadow-neo-lg animate-modal-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-white/5 border-b border-white/10">
          <h3 className="font-heading font-bold text-sm text-white uppercase tracking-wider">
            New Prediction Market
          </h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center border border-white/20 text-white hover:bg-white/10 text-xs font-mono transition-colors rounded-md"
          >
            ESC
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">
              Question
            </label>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Will ETH hit $10k by December 2026?"
              maxLength={31}
              autoFocus
              className="neo-input w-full"
            />
            <p className="text-[10px] text-white/40 mt-1 font-mono">
              {question.length}/31 chars (on-chain limit)
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">
                Duration (days)
              </label>
              <input
                type="number"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                min="1"
                max="365"
                className="neo-input w-full"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">
                Fee (basis pts)
              </label>
              <input
                type="number"
                value={feeBps}
                onChange={(e) => setFeeBps(e.target.value)}
                min="0"
                max="1000"
                className="neo-input w-full"
              />
              <p className="text-[10px] text-white/40 mt-1 font-mono">
                = {(parseInt(feeBps || "0") / 100).toFixed(1)}% fee
              </p>
            </div>
          </div>

          {/* Result feedback */}
          {result && (
            <div
              className={`border p-3 text-xs font-mono rounded-lg ${
                result.error
                  ? "border-neo-pink/40 bg-neo-pink/10 text-neo-pink"
                  : "border-neo-green/40 bg-neo-green/10 text-neo-green"
              }`}
            >
              {result.error ? (
                <p>{result.error}</p>
              ) : (
                <div className="space-y-1">
                  <p className="font-bold text-neo-green">Market deployed on-chain!</p>
                  {result.txHash && (
                    <a
                      href={`https://sepolia.voyager.online/tx/${result.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neo-blue underline"
                    >
                      View transaction
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {isConnected ? (
            <button
              onClick={handleDeploy}
              disabled={!question.trim() || isPending}
              className="neo-btn-dark w-full text-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
            >
              {isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-2 h-2 bg-white rounded-full animate-bounce" />
                  <span className="w-2 h-2 bg-white rounded-full animate-bounce [animation-delay:0.1s]" />
                  <span className="w-2 h-2 bg-white rounded-full animate-bounce [animation-delay:0.2s]" />
                  Signing Transaction...
                </span>
              ) : result?.txHash ? (
                "Deploy Another Market"
              ) : (
                "Deploy Market Contract"
              )}
            </button>
          ) : (
            <div className="text-center py-3 border border-dashed border-white/10 text-xs font-mono text-white/50 rounded-lg">
              Connect Wallet to Create Markets
            </div>
          )}

          <p className="text-[10px] text-white/40 text-center font-mono leading-relaxed">
            Deploys a new PredictionMarket contract via the factory on Sepolia.
            <br />
            Oracle is set to your connected wallet. Collateral: STRK.
          </p>
        </div>
      </div>
    </div>
  );
}
