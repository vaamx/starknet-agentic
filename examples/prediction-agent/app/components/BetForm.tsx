"use client";

import { useState, useEffect } from "react";
import { useAccount, useSendTransaction } from "@starknet-react/core";
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
  onClose,
}: BetFormProps) {
  const { address, isConnected } = useAccount();
  const { sendAsync, isPending } = useSendTransaction({});

  const [outcome, setOutcome] = useState<0 | 1>(1);
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<{
    status: string;
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

  async function handleSubmit() {
    if (amountBigInt <= 0n || !isConnected) return;
    setResult(null);

    try {
      const calls = buildBetCalls(marketAddress, outcome, amountBigInt);
      const response = await sendAsync(calls);
      setResult({
        status: "success",
        txHash: response.transaction_hash,
      });
    } catch (err: any) {
      setResult({ status: "error", error: err.message });
    }
  }

  const presets = ["10", "50", "100", "500"];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md mx-4 neo-card shadow-neo-lg animate-modal-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-white/5 border-b border-white/10">
          <h3 className="font-heading font-bold text-sm uppercase tracking-wider text-white">
            Place Bet
          </h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center border border-white/20 hover:bg-white/10 text-xs font-mono transition-colors rounded-md"
          >
            ESC
          </button>
        </div>

        <div className="p-5">
          <p className="text-xs text-white/50 mb-3 line-clamp-2 leading-relaxed">
            {question}
          </p>

          {/* Account Info */}
          <div className="border border-dashed border-white/10 p-2.5 mb-4 bg-white/5 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase text-white/40">
                Betting from
              </span>
              {isConnected && shortWallet ? (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-neo-green" />
                  <span className="font-mono text-xs font-medium text-white/80">
                    {shortWallet}
                  </span>
                  <span className="text-[9px] text-white/40">(your wallet)</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-white/30" />
                  <span className="font-mono text-xs text-white/50">
                    Not connected
                  </span>
                </div>
              )}
            </div>
            {!isConnected && (
              <p className="text-[9px] text-white/40 mt-1">
                Connect your wallet to place bets
              </p>
            )}
          </div>

          {/* Outcome Toggle */}
          <div className="flex border border-white/10 mb-4 rounded-lg overflow-hidden">
            <button
              onClick={() => setOutcome(1)}
              className={`flex-1 py-2.5 font-heading font-semibold text-sm transition-all ${
                outcome === 1
                  ? "bg-neo-green/20 text-neo-green"
                  : "bg-white/5 text-white/50 hover:text-white/80"
              }`}
            >
              YES
            </button>
            <div className="w-px bg-white/10" />
            <button
              onClick={() => setOutcome(0)}
              className={`flex-1 py-2.5 font-heading font-semibold text-sm transition-all ${
                outcome === 0
                  ? "bg-neo-pink/20 text-neo-pink"
                  : "bg-white/5 text-white/50 hover:text-white/80"
              }`}
            >
              NO
            </button>
          </div>

          {/* Amount */}
          <div className="mb-3">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">
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
                  className={`flex-1 py-1 border border-white/10 text-[10px] font-bold transition-all rounded ${
                    amount === p
                      ? "bg-neo-blue/20 text-neo-blue"
                      : "bg-white/5 text-white/60 hover:text-white/80 hover:bg-white/10"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Payout Preview */}
          {amountBigInt > 0n && (
            <div className="border border-dashed border-white/10 p-3 mb-4 space-y-1.5 bg-white/5 rounded-lg">
              <div className="flex justify-between text-xs">
                <span className="text-white/50">Potential payout</span>
                <span className="font-mono font-bold text-white/80">
                  {(Number(estPayout) / 1e18).toFixed(2)} STRK
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/50">Multiplier</span>
                <span className="font-mono font-bold text-neo-green">
                  {estMultiple.toFixed(2)}x
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/50">Gas (est.)</span>
                <span className="font-mono text-white/50">
                  ~0.001 STRK
                </span>
              </div>
              {probShift !== 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-white/50">Price impact</span>
                  <span
                    className={`font-mono font-bold ${
                      probShift > 0 ? "text-neo-green" : "text-neo-pink"
                    }`}
                  >
                    {probShift > 0 ? "+" : ""}
                    {probShift}pt
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Submit */}
          {isConnected ? (
            <button
              onClick={handleSubmit}
              disabled={isPending || amountBigInt <= 0n}
              className={`neo-btn w-full text-sm ${
                outcome === 1
                  ? "bg-neo-green/20 text-neo-green border-neo-green/40"
                  : "bg-neo-pink/20 text-neo-pink border-neo-pink/40"
              } disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0`}
            >
              {isPending
                ? "Signing Transaction..."
                : `Bet ${outcome === 1 ? "YES" : "NO"}${amount ? ` \u2014 ${amount} STRK` : ""}`}
            </button>
          ) : (
            <div className="text-center py-3 border border-dashed border-white/10 text-xs font-mono text-white/50 rounded-lg">
              Connect Wallet to Place Bets
            </div>
          )}

          {/* Result */}
          {result && (
            <div
              className={`mt-3 p-2.5 border text-xs font-mono rounded-lg ${
                result.status === "success"
                  ? "border-neo-green/40 bg-neo-green/10"
                  : "border-neo-pink/40 bg-neo-pink/10"
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
                      className="block text-[10px] text-neo-blue mt-1 hover:underline break-all"
                    >
                      View on Voyager: {result.txHash.slice(0, 20)}...
                    </a>
                  )}
                </>
              ) : (
                <span className="text-neo-pink">{result.error}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
