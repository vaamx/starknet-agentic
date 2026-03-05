"use client";

import { useEffect, useState } from "react";
import { postJsonWithCsrf } from "@/lib/secure-fetch";

type LifecycleAction = "resolve" | "finalize" | "claim";

interface MarketLifecycleModalProps {
  marketId: number;
  question: string;
  action: LifecycleAction;
  onClose: () => void;
  onSuccess?: () => Promise<void> | void;
}

export default function MarketLifecycleModal({
  marketId,
  question,
  action,
  onClose,
  onSuccess,
}: MarketLifecycleModalProps) {
  const [outcome, setOutcome] = useState<0 | 1>(1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    status: "success" | "error";
    txHash?: string;
    error?: string;
  } | null>(null);

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

  async function submit() {
    setLoading(true);
    setResult(null);

    try {
      const endpoint = `/api/markets/${marketId}/${action}`;
      const payload = action === "claim" ? {} : { outcome };
      const resp = await postJsonWithCsrf(endpoint, payload);
      const data = await resp.json();

      if (!resp.ok || data.status === "error") {
        setResult({
          status: "error",
          error: data.error ?? data.txError ?? "Execution failed",
        });
      } else {
        setResult({
          status: "success",
          txHash: data.txHash,
        });
        if (onSuccess) await onSuccess();
      }
    } catch (err: any) {
      setResult({
        status: "error",
        error: err?.message ?? "Execution failed",
      });
    } finally {
      setLoading(false);
    }
  }

  const title =
    action === "resolve"
      ? "Resolve Market"
      : action === "finalize"
        ? "Finalize Accuracy"
        : "Claim Winnings";

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-md mx-4 neo-card border-2 border-black bg-white shadow-neo-lg animate-modal-in">
        <div className="flex items-center justify-between px-5 py-3.5 bg-neo-blue border-b-2 border-black">
          <h3 className="font-heading font-bold text-sm uppercase tracking-wider text-white">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center border-2 border-white/30 text-white hover:bg-white/10 text-xs font-mono transition-colors"
          >
            ESC
          </button>
        </div>

        <div className="p-5">
          <p className="text-xs text-gray-500 mb-4 line-clamp-2 leading-relaxed">
            {question}
          </p>

          {action !== "claim" && (
            <div className="flex border-2 border-black mb-4">
              <button
                onClick={() => setOutcome(1)}
                className={`flex-1 py-2.5 font-heading font-bold text-sm transition-all ${
                  outcome === 1
                    ? "bg-neo-green text-neo-dark"
                    : "bg-white text-gray-400 hover:text-gray-600"
                }`}
              >
                YES Wins
              </button>
              <div className="w-0.5 bg-black" />
              <button
                onClick={() => setOutcome(0)}
                className={`flex-1 py-2.5 font-heading font-bold text-sm transition-all ${
                  outcome === 0
                    ? "bg-neo-pink text-neo-dark"
                    : "bg-white text-gray-400 hover:text-gray-600"
                }`}
              >
                NO Wins
              </button>
            </div>
          )}

          <button
            onClick={submit}
            disabled={loading}
            className="neo-btn-dark w-full text-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {loading ? "Executing..." : title}
          </button>

          {result && (
            <div
              className={`mt-3 p-2.5 border-2 text-xs font-mono ${
                result.status === "success"
                  ? "border-neo-green bg-neo-green/10"
                  : "border-neo-pink bg-neo-pink/10"
              }`}
            >
              {result.status === "success" ? (
                <>
                  <span className="font-bold">Transaction submitted</span>
                  {result.txHash && (
                    <span className="block text-[10px] text-gray-500 mt-0.5">
                      {result.txHash}
                    </span>
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
