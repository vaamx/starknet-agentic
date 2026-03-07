"use client";

import { useState, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import { computePayout } from "@/lib/accuracy";
import { buildBetCalls } from "@/lib/contracts";

interface BetFormProps {
  marketId: number;
  marketAddress: string;
  question: string;
  yesPool: string;
  noPool: string;
  totalPool: string;
  feeBps: number;
  impliedProbYes: number;
  preselectedOutcome?: 0 | 1;
  onClose: () => void;
}

export default function BetForm({
  marketId,
  marketAddress,
  question,
  yesPool,
  noPool,
  totalPool,
  feeBps,
  impliedProbYes,
  preselectedOutcome,
  onClose,
}: BetFormProps) {
  const { address, isConnected, account } = useAccount();
  const [sending, setSending] = useState(false);

  const [outcome, setOutcome] = useState<0 | 1>(preselectedOutcome ?? 1);
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<{
    status: string;
    txHash?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (preselectedOutcome !== undefined) {
      setOutcome(preselectedOutcome);
    }
  }, [preselectedOutcome]);

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

  const amountBigInt = (() => {
    try {
      return BigInt(Math.floor(parseFloat(amount || "0") * 1e18));
    } catch {
      return 0n;
    }
  })();

  const winningPool = outcome === 1 ? BigInt(yesPool) : BigInt(noPool);
  const newWinningPool = winningPool + amountBigInt;
  const newTotalPool = BigInt(totalPool) + amountBigInt;

  const estPayout =
    amountBigInt > 0n && newWinningPool > 0n
      ? computePayout(amountBigInt, newTotalPool, newWinningPool, feeBps)
      : 0n;

  const estMultiple =
    amountBigInt > 0n ? Number(estPayout) / Number(amountBigInt) : 0;

  const newImpliedYes =
    newTotalPool > 0n
      ? Number(
          outcome === 1
            ? BigInt(yesPool) + amountBigInt
            : BigInt(yesPool)
        ) / Number(newTotalPool)
      : impliedProbYes;

  const probShift = Math.round((newImpliedYes - impliedProbYes) * 100);

  const shortWallet = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;

  // Pool share percentage
  const poolSharePct =
    amountBigInt > 0n && newWinningPool > 0n
      ? ((Number(amountBigInt) / Number(newWinningPool)) * 100).toFixed(1)
      : null;

  async function handleSubmit() {
    if (amountBigInt <= 0n || !isConnected || !account) return;
    setResult(null);
    setSending(true);
    try {
      const calls = buildBetCalls(marketAddress, outcome, amountBigInt);
      const response = await account.execute(calls);
      setResult({
        status: "success",
        txHash: response.transaction_hash,
      });
    } catch (err: any) {
      setResult({ status: "error", error: err.message });
    } finally {
      setSending(false);
    }
  }

  const presets = ["10", "50", "100", "500"];

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-md sm:mx-4 neo-card shadow-neo-lg animate-sheet-up sm:animate-modal-in rounded-t-2xl sm:rounded-xl">
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-2">
          <div className="w-10 h-1 bg-white/20 rounded-full" />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.07]">
          <h3 className="font-heading font-bold text-sm text-white">
            Place Bet
          </h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center border border-white/15 hover:bg-white/10 text-xs font-mono text-white/60 transition-colors rounded-lg"
          >
            ESC
          </button>
        </div>

        <div className="p-5">
          <p className="text-xs text-white/50 mb-3 line-clamp-2 leading-relaxed">
            {question}
          </p>

          {/* Agent consensus hint */}
          <div className="flex items-center gap-2 mb-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
            <div className="flex -space-x-1">
              {["#10b981", "#3b82f6", "#f59e0b"].map((c, i) => (
                <div key={i} className="w-4 h-4 rounded-full border border-white/20 flex items-center justify-center text-[7px] font-bold text-white/80" style={{ backgroundColor: c }}>
                  {["A", "B", "G"][i]}
                </div>
              ))}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-white/35">Agent consensus</span>
                <span className="font-mono text-[11px] font-bold text-neo-brand">
                  {Math.round(impliedProbYes * 100)}% Yes
                </span>
              </div>
              <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden mt-0.5">
                <div className="h-full rounded-full bg-neo-brand/50 transition-all" style={{ width: `${Math.round(impliedProbYes * 100)}%` }} />
              </div>
            </div>
          </div>

          {/* Account Info */}
          <div className="border border-white/[0.07] p-2.5 mb-4 bg-white/[0.03] rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/40">Betting from</span>
              {isConnected && shortWallet ? (
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-neo-green" />
                  <span className="font-mono text-xs text-white/80">{shortWallet}</span>
                </div>
              ) : (
                <span className="font-mono text-xs text-white/50">Not connected</span>
              )}
            </div>
          </div>

          {/* Outcome Toggle */}
          <div className="flex border border-white/10 mb-4 rounded-lg overflow-hidden">
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
          <div className="mb-3">
            <label className="block text-xs font-medium text-white/40 mb-1.5">
              Amount (STRK)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              autoFocus
              className="neo-input w-full"
            />
            <div className="flex gap-1.5 mt-2">
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
          </div>

          {/* Payout Preview */}
          {amountBigInt > 0n && (
            <div className="border border-white/[0.07] p-3 mb-4 bg-white/[0.03] rounded-lg space-y-2">
              {/* Hero multiplier */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-white/40 block">If {outcome === 1 ? "YES" : "NO"} wins</span>
                  <span className="font-mono text-lg font-black text-white">
                    {(Number(estPayout) / 1e18).toFixed(2)} STRK
                  </span>
                </div>
                <div className={`rounded-xl px-3 py-1.5 border ${
                  estMultiple >= 2 ? "border-neo-green/30 bg-neo-green/10" : "border-white/[0.1] bg-white/[0.04]"
                }`}>
                  <span className={`font-mono text-sm font-black ${
                    estMultiple >= 2 ? "text-neo-green" : "text-white/70"
                  }`}>
                    {estMultiple.toFixed(2)}x
                  </span>
                </div>
              </div>

              {/* Details row */}
              <div className="flex items-center gap-3 text-[10px] font-mono text-white/40">
                {poolSharePct && (
                  <span>Pool share: <span className="text-white/60">{poolSharePct}%</span></span>
                )}
                {probShift !== 0 && (
                  <span>
                    Impact:{" "}
                    <span className={probShift > 0 ? "text-neo-green" : "text-neo-red"}>
                      {probShift > 0 ? "+" : ""}{probShift}pt
                    </span>
                  </span>
                )}
                <span>Fee: <span className="text-white/60">{(feeBps / 100).toFixed(1)}%</span></span>
              </div>
            </div>
          )}

          {/* Submit */}
          {isConnected ? (
            <button
              onClick={handleSubmit}
              disabled={sending || amountBigInt <= 0n}
              className={`w-full py-3 rounded-lg font-heading font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                outcome === 1
                  ? "bg-neo-green/20 text-neo-green border border-neo-green/30 hover:bg-neo-green/30"
                  : "bg-neo-red/20 text-neo-red border border-neo-red/30 hover:bg-neo-red/30"
              }`}
            >
              {sending
                ? "Signing Transaction..."
                : `Bet ${outcome === 1 ? "YES" : "NO"}${amount ? ` \u2014 ${amount} STRK` : ""}`}
            </button>
          ) : (
            <div className="text-center py-3 border border-dashed border-white/10 text-sm text-white/50 rounded-lg">
              Connect Wallet to Place Bets
            </div>
          )}

          {/* Result */}
          {result && (
            <div
              className={`mt-3 p-2.5 border text-xs font-mono rounded-lg ${
                result.status === "success"
                  ? "border-neo-green/30 bg-neo-green/10"
                  : "border-neo-red/30 bg-neo-red/10"
              }`}
            >
              {result.status === "success" ? (
                <>
                  <span className="font-bold">Bet placed on-chain</span>
                  {result.txHash && (
                    <a
                      href={`https://sepolia.voyager.online/tx/${result.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-xs text-neo-blue mt-1 hover:underline break-all"
                    >
                      View on Voyager: {result.txHash.slice(0, 20)}...
                    </a>
                  )}
                </>
              ) : (
                <span className="text-neo-red">{result.error}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
