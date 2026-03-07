"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import { buildBuyCurveCalls, buildSellCurveCalls } from "@/lib/contracts";

// ── Types ────────────────────────────────────────────────────────────────────

type CurveType = "linear" | "quadratic" | "sigmoid";

interface TokenDetail {
  id: string;
  name: string;
  symbol: string;
  curveType: CurveType;
  currentPrice: number;
  basePrice?: number;
  totalSupply: number;
  maxSupply?: number;
  reserveBalance: number;
  feeBps: number;
  creator: string;
  createdAt: number;
  curveAddress?: string;
  tokenAddress?: string;
  source?: "onchain" | "mock";
}

// ── Constants ────────────────────────────────────────────────────────────────

const CURVE_BADGE: Record<CurveType, { bg: string; text: string; border: string }> = {
  linear: { bg: "bg-cyan-400/10", text: "text-cyan-300", border: "border-cyan-400/20" },
  quadratic: { bg: "bg-violet-400/10", text: "text-violet-300", border: "border-violet-400/20" },
  sigmoid: { bg: "bg-amber-400/10", text: "text-amber-300", border: "border-amber-400/20" },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncateAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatNumber(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Bonding Curve SVG ────────────────────────────────────────────────────────

function BondingCurveSvg({
  curveType,
  supplyPct,
}: {
  curveType: CurveType;
  supplyPct: number;
}) {
  const W = 400;
  const H = 200;
  const PAD = 20;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;

  const points: [number, number][] = [];
  const steps = 80;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let y: number;
    if (curveType === "linear") {
      y = t;
    } else if (curveType === "quadratic") {
      y = t * t;
    } else {
      const k = 8;
      y = 1 / (1 + Math.exp(-k * (t - 0.5)));
    }
    const px = PAD + t * innerW;
    const py = PAD + innerH - y * innerH;
    points.push([px, py]);
  }

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
  const fillPath = `${linePath} L${PAD + innerW},${PAD + innerH} L${PAD},${PAD + innerH} Z`;

  const clampedPct = Math.min(1, Math.max(0, supplyPct));
  let dotY: number;
  if (curveType === "linear") {
    dotY = clampedPct;
  } else if (curveType === "quadratic") {
    dotY = clampedPct * clampedPct;
  } else {
    dotY = 1 / (1 + Math.exp(-8 * (clampedPct - 0.5)));
  }
  const dotPx = PAD + clampedPct * innerW;
  const dotPy = PAD + innerH - dotY * innerH;

  const gradientId = `curve-grad-${curveType}`;
  const glowId = `curve-glow-${curveType}`;

  const gradientColors: Record<CurveType, [string, string]> = {
    linear: ["#22d3ee", "#06b6d4"],
    quadratic: ["#a78bfa", "#7c3aed"],
    sigmoid: ["#fbbf24", "#f59e0b"],
  };
  const [c1, c2] = gradientColors[curveType];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Bonding curve price visualization">
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={c1} stopOpacity="0.05" />
          <stop offset="100%" stopColor={c2} stopOpacity="0.25" />
        </linearGradient>
        <filter id={glowId}>
          <feGaussianBlur stdDeviation="3" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <line x1={PAD} y1={PAD} x2={PAD} y2={PAD + innerH} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      <line x1={PAD} y1={PAD + innerH} x2={PAD + innerW} y2={PAD + innerH} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />

      <text x={W / 2} y={H - 2} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="9" fontFamily="monospace">
        Supply
      </text>
      <text x={6} y={H / 2} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="9" fontFamily="monospace" transform={`rotate(-90, 6, ${H / 2})`}>
        Price
      </text>

      <path d={fillPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke={c1} strokeWidth="2" filter={`url(#${glowId})`} opacity="0.8" />
      <circle cx={dotPx} cy={dotPy} r="5" fill={c2} stroke="white" strokeWidth="1.5" filter={`url(#${glowId})`} />

      <line x1={dotPx} y1={dotPy} x2={dotPx} y2={PAD + innerH} stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="3,3" />
      <line x1={PAD} y1={dotPy} x2={dotPx} y2={dotPy} stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="3,3" />
    </svg>
  );
}

// ── Trade Button (wallet-connected) ──────────────────────────────────────────

function TradeButton({ tab, token, amount }: { tab: "buy" | "sell"; token: TokenDetail; amount: string }) {
  const { isConnected } = useAccount();
  const { sendAsync, isPending } = useSendTransaction({});
  const [txResult, setTxResult] = useState<{ status: string; txHash?: string; error?: string } | null>(null);

  async function handleTrade() {
    const qty = parseFloat(amount);
    if (!qty || qty <= 0) return;
    setTxResult(null);
    try {
      const amountWei = BigInt(Math.floor(qty * 1e18));
      const curveAddress = token.curveAddress ?? token.id;
      const tokenAddress = token.tokenAddress ?? token.id;
      const estimatedCost = BigInt(Math.ceil(qty * token.currentPrice * 1.05 * 1e18));
      const calls = tab === "buy"
        ? buildBuyCurveCalls(curveAddress, amountWei, estimatedCost)
        : buildSellCurveCalls(curveAddress, tokenAddress, amountWei);
      const res = await sendAsync(calls);
      setTxResult({ status: "success", txHash: res.transaction_hash });
    } catch (err: any) {
      setTxResult({ status: "error", error: err.message });
    }
  }

  if (!isConnected) {
    return (
      <div className="text-center py-3 border border-dashed border-white/10 text-sm text-white/50 rounded-lg">
        Connect Wallet to Trade
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleTrade}
        disabled={isPending || !amount || parseFloat(amount) <= 0}
        className={`w-full h-11 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
          tab === "buy"
            ? "bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-400 hover:to-emerald-500 shadow-lg shadow-emerald-500/20"
            : "bg-gradient-to-r from-red-500 to-red-600 text-white hover:from-red-400 hover:to-red-500 shadow-lg shadow-red-500/20"
        }`}
      >
        {isPending
          ? "Signing Transaction..."
          : tab === "buy"
          ? `Buy ${token.symbol}`
          : `Sell ${token.symbol}`}
      </button>
      {txResult && (
        <div className={`p-2.5 border text-xs font-mono rounded-lg ${
          txResult.status === "success"
            ? "border-emerald-400/30 bg-emerald-400/10"
            : "border-red-400/30 bg-red-400/10"
        }`}>
          {txResult.status === "success" ? (
            <>
              <span className="font-bold text-emerald-300">Transaction sent</span>
              {txResult.txHash && (
                <a
                  href={`https://sepolia.voyager.online/tx/${txResult.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sky-400/70 mt-1 hover:underline break-all"
                >
                  {txResult.txHash.slice(0, 20)}...
                </a>
              )}
            </>
          ) : (
            <span className="text-red-300">{txResult.error}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StarkMintTokenDetail() {
  const params = useParams();
  const tokenId = params?.tokenId as string;
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState<TokenDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    fetch(`/api/starkmint/tokens/${encodeURIComponent(tokenId)}`)
      .then((res) => {
        if (!res.ok) throw new Error("not found");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setToken({
            ...data,
            currentPrice: data.currentPrice ?? 0,
            totalSupply: data.totalSupply ?? 0,
            reserveBalance: data.reserveBalance ?? 0,
            feeBps: data.feeBps ?? 0,
          });
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [tokenId]);

  useEffect(() => {
    if (token) {
      document.title = `StarkMint — ${token.name} ($${token.symbol})`;
    }
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
        <SiteHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
        <Footer />
      </div>
    );
  }

  if (error || !token) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
        <SiteHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <p className="text-white/50">Token not found</p>
            <Link href="/starkmint" className="neo-btn-secondary text-xs">
              Back to StarkMint
            </Link>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  const cb = CURVE_BADGE[token.curveType] ?? CURVE_BADGE.linear;
  const maxSupply = token.maxSupply ?? token.totalSupply * 2;
  const supplyPct = maxSupply > 0 ? token.totalSupply / maxSupply : 0;

  const estimatedCost = useMemo(() => {
    const qty = parseFloat(amount);
    if (!qty || qty <= 0) return null;
    return tab === "buy" ? qty * token.currentPrice : qty * token.currentPrice * 0.98;
  }, [amount, tab, token.currentPrice]);

  const infoGrid = [
    { label: "Creator", value: truncateAddress(token.creator), mono: true },
    { label: "Curve Type", value: token.curveType.charAt(0).toUpperCase() + token.curveType.slice(1), mono: false },
    { label: "Base Price", value: `${(token.basePrice ?? 0).toFixed(4)} STRK`, mono: true },
    { label: "Current Supply", value: formatNumber(token.totalSupply), mono: true },
    { label: "Reserve Balance", value: `${formatNumber(token.reserveBalance)} STRK`, mono: true },
    { label: "Fee", value: `${token.feeBps} bps`, mono: true },
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <SiteHeader />

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Source badge */}
        {token.source === "onchain" && (
          <div className="inline-flex items-center gap-1.5 rounded-full border border-neo-green/25 bg-neo-green/10 px-2.5 py-0.5 text-[10px] font-semibold text-neo-green">
            <span className="w-1.5 h-1.5 rounded-full bg-neo-green" />
            Live On-Chain Data
          </div>
        )}

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-white/30">
          <Link href="/starkmint" className="hover:text-white/50 transition-colors">
            StarkMint
          </Link>
          <span>/</span>
          <span className="text-white/60">{token.name}</span>
        </nav>

        {/* Token Header */}
        <div className="neo-card p-5 space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/[0.08] flex items-center justify-center">
                <span className="font-heading font-bold text-lg text-white/60">
                  {token.symbol.charAt(0)}
                </span>
              </div>
              <div>
                <h1 className="font-heading font-bold text-xl text-white">{token.name}</h1>
                <p className="font-mono text-sm text-white/40">${token.symbol}</p>
              </div>
            </div>
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cb.bg} ${cb.text} ${cb.border}`}
            >
              {token.curveType}
            </span>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="font-mono font-bold text-3xl text-white">
              {token.currentPrice === 0 ? "0" : token.currentPrice < 0.0001 ? "< 0.0001" : token.currentPrice < 1 ? token.currentPrice.toFixed(4) : token.currentPrice < 1000 ? token.currentPrice.toFixed(2) : formatNumber(token.currentPrice)}
            </span>
            <span className="text-sm text-white/30">STRK / token</span>
          </div>
        </div>

        {/* Bonding Curve Visualization */}
        <div className="neo-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-heading font-bold text-sm text-white/70">Bonding Curve</h2>
            <span className="text-[10px] text-white/30 font-mono">
              {(supplyPct * 100).toFixed(1)}% supply minted
            </span>
          </div>
          <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-3">
            <BondingCurveSvg curveType={token.curveType} supplyPct={supplyPct} />
          </div>
          <div className="flex items-center justify-between text-[10px] text-white/25 px-1">
            <span>0 supply</span>
            <span>{formatNumber(maxSupply)} max</span>
          </div>
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {infoGrid.map((item) => (
            <div key={item.label} className="neo-card p-3 space-y-1">
              <p className="text-[9px] uppercase tracking-wider text-white/30">{item.label}</p>
              <p className={`text-sm text-white/80 ${item.mono ? "font-mono" : "font-heading font-semibold"}`}>
                {item.value}
              </p>
            </div>
          ))}
        </div>

        {/* Buy / Sell Form */}
        <div className="neo-card p-5 space-y-4">
          <h2 className="font-heading font-bold text-sm text-white/70">Trade</h2>

          <div className="flex rounded-xl bg-white/[0.03] border border-white/[0.06] p-0.5">
            <button
              onClick={() => setTab("buy")}
              aria-label="Switch to buy tab"
              className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
                tab === "buy"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/20"
                  : "text-white/40 hover:text-white/60 border border-transparent"
              }`}
            >
              Buy
            </button>
            <button
              onClick={() => setTab("sell")}
              aria-label="Switch to sell tab"
              className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
                tab === "sell"
                  ? "bg-red-500/20 text-red-300 border border-red-400/20"
                  : "text-white/40 hover:text-white/60 border border-transparent"
              }`}
            >
              Sell
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-wider text-white/35">
              Amount ({token.symbol})
            </label>
            <input
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full h-11 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-lg font-mono text-white placeholder:text-white/20 outline-none focus:border-white/[0.15]"
            />
          </div>

          {estimatedCost !== null && (
            <div className="flex items-center justify-between rounded-xl bg-white/[0.02] border border-white/[0.05] px-4 py-3">
              <span className="text-[11px] text-white/40">
                {tab === "buy" ? "Estimated Cost" : "Estimated Return"}
              </span>
              <span className="font-mono font-semibold text-sm text-white">
                {estimatedCost.toFixed(4)} STRK
              </span>
            </div>
          )}

          <TradeButton tab={tab} token={token} amount={amount} />

          <p className="text-[9px] text-white/20 text-center">
            Fee: {token.feeBps} bps per trade
          </p>
        </div>

        {/* Created at */}
        <p className="text-[10px] text-white/20 text-center">
          Created {timeAgo(token.createdAt)}
        </p>
      </main>

      <Footer />
    </div>
  );
}
