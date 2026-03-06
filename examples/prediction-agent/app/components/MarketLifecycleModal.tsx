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

      <div className="relative z-10 w-full max-w-md mx-4 rounded-2xl border border-white/[0.12] bg-[linear-gradient(180deg,#0d1222,#0a0f1b)] shadow-[0_20px_90px_rgba(3,8,20,0.65)] animate-modal-in">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08]">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-neo-blue/10 border border-neo-blue/20 flex items-center justify-center">
              <svg className="w-3 h-3 text-neo-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {action === "resolve" ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                ) : action === "finalize" ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                )}
              </svg>
            </div>
            <h3 className="font-heading font-bold text-sm text-white">
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-semibold text-white/60 transition-colors hover:bg-white/[0.09] hover:text-white/80"
          >
            ESC
          </button>
        </div>

        <div className="p-5">
          <p className="text-xs text-white/50 mb-4 line-clamp-2 leading-relaxed">
            {question}
          </p>

          {action !== "claim" && (
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setOutcome(1)}
                className={`flex-1 py-2.5 rounded-xl font-heading font-bold text-sm transition-all border ${
                  outcome === 1
                    ? "bg-neo-green/15 border-neo-green/35 text-neo-green"
                    : "bg-white/[0.03] border-white/[0.08] text-white/35 hover:text-white/55 hover:border-white/[0.15]"
                }`}
              >
                YES Wins
              </button>
              <button
                onClick={() => setOutcome(0)}
                className={`flex-1 py-2.5 rounded-xl font-heading font-bold text-sm transition-all border ${
                  outcome === 0
                    ? "bg-neo-pink/15 border-neo-pink/35 text-neo-pink"
                    : "bg-white/[0.03] border-white/[0.08] text-white/35 hover:text-white/55 hover:border-white/[0.15]"
                }`}
              >
                NO Wins
              </button>
            </div>
          )}

          <button
            onClick={submit}
            disabled={loading}
            className="w-full rounded-xl border border-neo-brand/30 bg-neo-brand/15 px-4 py-2.5 text-sm font-heading font-bold text-neo-brand transition-colors hover:bg-neo-brand/25 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? "Executing..." : title}
          </button>

          {result && (
            <div
              className={`mt-3 p-2.5 rounded-xl border text-xs font-mono ${
                result.status === "success"
                  ? "border-neo-green/25 bg-neo-green/10 text-neo-green"
                  : "border-neo-pink/25 bg-neo-pink/10 text-neo-pink"
              }`}
            >
              {result.status === "success" ? (
                <>
                  <span className="font-bold text-neo-green">Transaction submitted</span>
                  {result.txHash && (
                    <span className="block text-[10px] text-white/40 mt-0.5 truncate">
                      {result.txHash}
                    </span>
                  )}
                </>
              ) : (
                <span>{result.error}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
