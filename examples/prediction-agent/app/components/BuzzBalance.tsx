"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface BuzzBalanceProps {
  walletAddress?: string;
}

export default function BuzzBalance({ walletAddress }: BuzzBalanceProps) {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!walletAddress) {
      setBalance(null);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `/api/buzz/balance?address=${encodeURIComponent(walletAddress!)}`,
          { credentials: "include" },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        // API returns balance as number (whole BUZZ) or string — handle both
        const val = typeof data.balance === "number"
          ? data.balance
          : typeof data.balance === "string"
            ? parseFloat(data.balance) || 0
            : null;
        if (val !== null) setBalance(val);
      } catch {
        // silently ignore — header component should never break the page
      }
    }

    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [walletAddress]);

  if (!walletAddress || balance === null) return null;

  return (
    <Link
      href="/buzz"
      className="group flex items-center gap-1.5 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-2.5 py-1 no-underline transition-all duration-150 hover:border-amber-400/35 hover:bg-amber-400/10"
    >
      {/* Hexagon bee icon */}
      <svg
        className="h-3.5 w-3.5 text-amber-400 transition-transform group-hover:scale-110"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 2l8.66 5v10L12 22l-8.66-5V7L12 2zm0 2.31L5.34 8.15v7.69L12 19.69l6.66-3.85V8.15L12 4.31z" />
        <path d="M12 7l4.33 2.5v5L12 17l-4.33-2.5v-5L12 7z" />
      </svg>
      <span className="text-[13px] font-bold tabular-nums text-amber-400">
        {balance.toLocaleString()}
      </span>
      <span className="text-[11px] font-semibold text-amber-400/60">
        BUZZ
      </span>
    </Link>
  );
}
