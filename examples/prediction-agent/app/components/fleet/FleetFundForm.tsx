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
        body: JSON.stringify({ amountStrk: numAmount }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
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
        <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-3">
          <p className="text-xs font-medium text-green-300">Transfer submitted</p>
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
      <div className="flex gap-1">
        {[10, 50, 100, 500].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setAmount(String(v))}
            className="rounded-md bg-white/[0.04] px-2 py-1 text-[10px] text-muted hover:bg-white/[0.08] hover:text-white"
          >
            {v}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-[10px] text-red-400">{error}</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="neo-btn flex-1 text-xs"
          disabled={loading}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid || loading}
          className="neo-btn-primary flex-1 text-xs disabled:opacity-50"
        >
          {loading ? "Sending..." : `Send ${valid ? numAmount : "–"} STRK`}
        </button>
      </div>
    </form>
  );
}
