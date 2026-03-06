"use client";

import { useState } from "react";

interface FleetFundFormProps {
  agentId: string;
  agentName: string;
  currentBalance: number | null;
  onSuccess: (txHash: string) => void;
  onCancel: () => void;
}

export default function FleetFundForm({
  agentId,
  agentName,
  currentBalance,
  onSuccess,
  onCancel,
}: FleetFundFormProps) {
  const [amount, setAmount] = useState("50");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const numAmount = parseFloat(amount);
  const valid = Number.isFinite(numAmount) && numAmount > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/fleet/${agentId}/fund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ amountStrk: numAmount }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            "Wallet signature required. Use Connect User Wallet -> Verify Signature."
          );
        }
        throw new Error(data.error ?? "Fund transfer failed");
      }
      setTxHash(data.txHash);
      onSuccess(data.txHash);
    } catch (err: any) {
      setError(err.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  if (txHash) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-neo-green/20 bg-neo-green/10 p-3">
          <p className="text-xs font-medium text-neo-green">Transfer submitted</p>
          <a
            href={`https://sepolia.starkscan.co/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block truncate font-mono text-[10px] text-neo-brand hover:underline"
          >
            {txHash}
          </a>
        </div>
        <button onClick={onCancel} className="neo-btn text-xs w-full">
          Done
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">
          Fund {agentName}
        </label>
        {currentBalance !== null && (
          <p className="mb-2 text-[10px] text-muted">
            Current balance: {currentBalance.toFixed(2)} STRK
          </p>
        )}
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0.01"
            step="0.01"
            className="neo-input flex-1 text-xs"
            placeholder="Amount in STRK"
            disabled={loading}
          />
          <span className="text-xs text-muted">STRK</span>
        </div>
      </div>

      {/* Quick amounts */}
      <div className="flex gap-1.5">
        {[10, 50, 100, 500].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setAmount(String(v))}
            className={`rounded-lg border px-2.5 py-1 text-[10px] font-mono font-semibold transition-colors ${
              numAmount === v
                ? "border-neo-brand/30 bg-neo-brand/10 text-neo-brand"
                : "border-white/[0.08] bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white/70"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-lg border border-neo-red/20 bg-neo-red/5 px-2.5 py-1.5 text-[10px] text-neo-red">{error}</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl border border-white/[0.12] bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white/80"
          disabled={loading}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid || loading}
          className="flex-1 rounded-xl border border-neo-green/30 bg-neo-green/10 px-3 py-2 text-xs font-semibold text-neo-green transition-colors hover:bg-neo-green/20 disabled:opacity-40"
        >
          {loading ? "Sending..." : `Send ${valid ? numAmount : "–"} STRK`}
        </button>
      </div>
    </form>
  );
}
