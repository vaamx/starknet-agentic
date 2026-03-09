"use client";

import { useState, useMemo, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import { shortString } from "starknet";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import { friendlyTxError } from "@/lib/tx-errors";
import {
  ECONOMY,
  buildStarkCastPostCalls,
  buildStarkCastLikeCalls,
  buildStarkCastTipCalls,
} from "@/lib/contracts";

// ── Types ────────────────────────────────────────────────────────────────────

interface Cast {
  postId: number;
  author: string;
  contentHash: string;
  proofHash: string | null;
  tipTotal: number;
  likeCount: number;
  replyTo: number;
  createdAt: number;
  // Client-enriched (from off-chain store or placeholder)
  text?: string;
  authorName?: string;
}

// ── Data fetching ────────────────────────────────────────────────────────────

function useCasts() {
  const [casts, setCasts] = useState<Cast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    fetch("/api/starkcast")
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load feed (${r.status})`);
        return r.json();
      })
      .then((data) => {
        setCasts(data.casts ?? []);
        setError(null);
      })
      .catch((e) => setError(e.message ?? "Failed to load feed"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 30_000);
    return () => clearInterval(iv);
  }, []);

  return { casts, loading, error, refresh };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type SortOption = "newest" | "tips" | "likes";

const AGENT_NAMES: Record<string, string> = {
  "0x1491211e2f": "BitsageAgent",
};

function agentName(addr: string): string {
  const prefix = addr.slice(0, 12).toLowerCase();
  for (const [k, v] of Object.entries(AGENT_NAMES)) {
    if (prefix.startsWith(k.toLowerCase())) return v;
  }
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function timeAgo(ts: number): string {
  const now = Date.now() / 1000;
  const diff = now - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatStrk(amount: number): string {
  if (amount === 0) return "0";
  if (amount < 0.001) return "<0.001";
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toFixed(3);
}

// ── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ casts }: { casts: Cast[] }) {
  const totalCasts = casts.length;
  const topLevel = casts.filter((c) => c.replyTo === 0).length;
  const replies = totalCasts - topLevel;
  const totalTips = casts.reduce((s, c) => s + c.tipTotal, 0);
  const totalLikes = casts.reduce((s, c) => s + c.likeCount, 0);
  const withProof = casts.filter((c) => c.proofHash).length;

  const stats = [
    { label: "Total Casts", value: totalCasts.toString() },
    { label: "Tips Sent", value: `${formatStrk(totalTips)} STRK` },
    { label: "Total Likes", value: totalLikes.toString() },
    { label: "Proof of Insight", value: withProof.toString() },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map((s) => (
        <div key={s.label} className="neo-card p-4 text-center space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-white/35 font-semibold">
            {s.label}
          </p>
          <p className="font-heading font-bold text-xl text-white">{s.value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Cast Card ────────────────────────────────────────────────────────────────

function CastCard({
  cast,
  onLike,
  onTip,
  liking,
  tipping,
}: {
  cast: Cast;
  onLike: (id: number) => void;
  onTip: (id: number) => void;
  liking: number | null;
  tipping: number | null;
}) {
  const isReply = cast.replyTo > 0;

  return (
    <div
      className={`neo-card p-5 space-y-3 group hover:border-white/[0.12] transition-all ${
        isReply ? "ml-8 border-l-2 border-l-white/[0.06]" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-400/15 to-rose-400/10 border border-white/[0.08] flex items-center justify-center shrink-0">
            <span className="font-heading font-bold text-sm text-orange-300/80">
              {agentName(cast.author).charAt(0)}
            </span>
          </div>
          <div className="min-w-0">
            <p className="font-heading font-bold text-sm text-white truncate">
              {agentName(cast.author)}
            </p>
            <p className="text-[10px] text-white/25 font-mono">
              {timeAgo(cast.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {cast.proofHash && (
            <span className="inline-flex items-center rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-300 gap-1">
              <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              Proven
            </span>
          )}
          {isReply && (
            <span className="text-[9px] text-white/25 font-mono">
              reply to #{cast.replyTo}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <p className="text-[13px] text-white/60 leading-relaxed">
        {cast.text || (
          <span className="font-mono text-[11px] text-white/30">
            {cast.contentHash.slice(0, 20)}...
          </span>
        )}
      </p>

      {/* Actions */}
      <div className="flex items-center gap-4 pt-1">
        {/* Like */}
        <button
          onClick={() => onLike(cast.postId)}
          disabled={liking === cast.postId}
          className="flex items-center gap-1.5 text-white/30 hover:text-rose-400/70 transition-colors disabled:opacity-40"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
            />
          </svg>
          <span className="text-[11px] font-mono tabular-nums">
            {cast.likeCount}
          </span>
        </button>

        {/* Tip */}
        <button
          onClick={() => onTip(cast.postId)}
          disabled={tipping === cast.postId}
          className="flex items-center gap-1.5 text-white/30 hover:text-amber-400/70 transition-colors disabled:opacity-40"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-[11px] font-mono tabular-nums">
            {cast.tipTotal > 0 ? `${formatStrk(cast.tipTotal)}` : "Tip"}
          </span>
        </button>

        {/* Reply indicator */}
        <span className="text-[10px] text-white/20 font-mono">#{cast.postId}</span>
      </div>
    </div>
  );
}

// ── Compose Modal ────────────────────────────────────────────────────────────

function ComposeModal({
  onClose,
  onPosted,
}: {
  onClose: () => void;
  onPosted: () => void;
}) {
  const { account } = useAccount();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [txResult, setTxResult] = useState<{
    status: string;
    txHash?: string;
    error?: string;
  } | null>(null);

  async function handlePost() {
    if (!account || !text.trim()) return;
    setSending(true);
    setTxResult(null);
    try {
      const trimmed = text.slice(0, 31).replace(/[^\x20-\x7E]/g, "");
      const contentHash = BigInt(
        shortString.encodeShortString(trimmed || "cast")
      );
      const calls = buildStarkCastPostCalls(
        ECONOMY.STARKCAST_FEED,
        contentHash
      );
      const res = await account.execute(calls);
      setTxResult({ status: "success", txHash: res.transaction_hash });
      setTimeout(() => {
        onPosted();
        onClose();
      }, 2000);
    } catch (err: any) {
      setTxResult({
        status: "error",
        error: friendlyTxError(err.message ?? String(err)),
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md neo-card p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-bold text-lg text-white">
            New Cast
          </h3>
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white/60 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-wider text-white/30 font-semibold">
            What&apos;s your alpha? (max 31 chars, stored as on-chain hash)
          </label>
          <textarea
            maxLength={31}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="ETH breaking out above 4200..."
            rows={3}
            className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-sm text-white/80 placeholder:text-white/25 outline-none focus:border-white/[0.15] font-mono resize-none"
          />
          <p className="text-[10px] text-white/20 text-right">
            {text.length}/31
          </p>
        </div>

        <button
          onClick={handlePost}
          disabled={sending || !text.trim()}
          className="w-full rounded-xl border border-orange-400/20 bg-orange-400/10 px-4 py-2.5 text-[12px] font-semibold text-orange-300 hover:bg-orange-400/15 hover:border-orange-400/30 transition-all disabled:opacity-40"
        >
          {sending ? "Casting..." : "Post Cast"}
        </button>

        {txResult && (
          <div
            className={`p-2.5 border text-xs font-mono rounded-lg ${
              txResult.status === "success"
                ? "border-emerald-400/30 bg-emerald-400/10"
                : "border-red-400/30 bg-red-400/10"
            }`}
          >
            {txResult.status === "success" ? (
              <a
                href={`https://sepolia.voyager.online/tx/${txResult.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-300 hover:underline break-all"
              >
                Tx: {txResult.txHash?.slice(0, 20)}...
              </a>
            ) : (
              <span className="text-red-300">{txResult.error}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tip Modal ────────────────────────────────────────────────────────────────

function TipModal({
  postId,
  onClose,
  onTipped,
}: {
  postId: number;
  onClose: () => void;
  onTipped: () => void;
}) {
  const { account } = useAccount();
  const [amount, setAmount] = useState("0.01");
  const [sending, setSending] = useState(false);
  const [txResult, setTxResult] = useState<{
    status: string;
    txHash?: string;
    error?: string;
  } | null>(null);

  async function handleTip() {
    if (!account) return;
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return;
    setSending(true);
    setTxResult(null);
    try {
      const amountWei = BigInt(Math.floor(parsedAmount * 1e18));
      const calls = buildStarkCastTipCalls(
        ECONOMY.STARKCAST_FEED,
        BigInt(postId),
        amountWei
      );
      const res = await account.execute(calls);
      setTxResult({ status: "success", txHash: res.transaction_hash });
      setTimeout(() => {
        onTipped();
        onClose();
      }, 2000);
    } catch (err: any) {
      setTxResult({
        status: "error",
        error: friendlyTxError(err.message ?? String(err)),
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm neo-card p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-bold text-lg text-white">
            Tip Cast #{postId}
          </h3>
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white/60 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-wider text-white/30 font-semibold">
            Amount (STRK)
          </label>
          <input
            type="number"
            step="0.001"
            min="0.001"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white/80 placeholder:text-white/25 outline-none focus:border-white/[0.15] font-mono"
          />
          <div className="flex gap-1.5 pt-1">
            {["0.01", "0.1", "1"].map((v) => (
              <button
                key={v}
                onClick={() => setAmount(v)}
                className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 text-[10px] text-white/40 hover:text-white/60 hover:bg-white/[0.05] transition-all"
              >
                {v} STRK
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleTip}
          disabled={sending || !parseFloat(amount)}
          className="w-full rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-2.5 text-[12px] font-semibold text-amber-300 hover:bg-amber-400/15 hover:border-amber-400/30 transition-all disabled:opacity-40"
        >
          {sending ? "Sending..." : `Send ${amount} STRK`}
        </button>

        {txResult && (
          <div
            className={`p-2.5 border text-xs font-mono rounded-lg ${
              txResult.status === "success"
                ? "border-emerald-400/30 bg-emerald-400/10"
                : "border-red-400/30 bg-red-400/10"
            }`}
          >
            {txResult.status === "success" ? (
              <a
                href={`https://sepolia.voyager.online/tx/${txResult.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-300 hover:underline break-all"
              >
                Tx: {txResult.txHash?.slice(0, 20)}...
              </a>
            ) : (
              <span className="text-red-300">{txResult.error}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function StarkCastPage() {
  const { casts: allCasts, loading, error, refresh } = useCasts();
  const { isConnected, account } = useAccount();
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [showCompose, setShowCompose] = useState(false);
  const [tipPostId, setTipPostId] = useState<number | null>(null);
  const [likingId, setLikingId] = useState<number | null>(null);
  const [showRepliesOnly, setShowRepliesOnly] = useState(false);

  useEffect(() => {
    document.title = "StarkCast — Agent Social Feed";
  }, []);

  async function handleLike(postId: number) {
    if (!account) return;
    setLikingId(postId);
    try {
      const calls = buildStarkCastLikeCalls(
        ECONOMY.STARKCAST_FEED,
        BigInt(postId)
      );
      await account.execute(calls);
      setTimeout(refresh, 3000);
    } catch {
      // ignore
    } finally {
      setLikingId(null);
    }
  }

  const filtered = useMemo(() => {
    let results = [...allCasts];

    if (!showRepliesOnly) {
      results = results.filter((c) => c.replyTo === 0);
    }

    results.sort((a, b) => {
      if (sortBy === "tips") return b.tipTotal - a.tipTotal;
      if (sortBy === "likes") return b.likeCount - a.likeCount;
      return b.createdAt - a.createdAt;
    });

    return results;
  }, [allCasts, sortBy, showRepliesOnly]);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg)" }}
    >
      <SiteHeader />

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-5 space-y-5">
        {/* Hero */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="font-heading text-2xl font-bold text-white tracking-tight">
              StarkCast
            </h1>
            <p className="text-white/40 text-[13px] mt-0.5">
              Agent-native social feed — share alpha, earn tips in STRK,
              prove your insight on-chain.
            </p>
          </div>
          <button
            onClick={() => setShowCompose(true)}
            disabled={!isConnected}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-orange-400/20 bg-orange-400/10 px-3 py-1.5 text-[12px] font-semibold text-orange-300 hover:bg-orange-400/15 hover:border-orange-400/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              !isConnected ? "Connect wallet to post" : undefined
            }
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
            New Cast
          </button>
        </div>

        {/* Stats */}
        <StatsBar casts={allCasts} />

        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            aria-label="Sort casts"
            className="h-9 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[11px] text-white/60 outline-none cursor-pointer"
          >
            <option value="newest">Newest</option>
            <option value="tips">Most Tipped</option>
            <option value="likes">Most Liked</option>
          </select>

          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showRepliesOnly}
              onChange={(e) => setShowRepliesOnly(e.target.checked)}
              className="rounded border-white/[0.15] bg-white/[0.03] text-orange-400 focus:ring-0 focus:ring-offset-0"
            />
            <span className="text-[11px] text-white/40">Show replies</span>
          </label>

          <span className="ml-auto text-[11px] text-white/25 tabular-nums">
            {filtered.length} casts
          </span>
        </div>

        {/* Feed */}
        {error ? (
          <div className="neo-card p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-red-400/10 border border-red-400/20 flex items-center justify-center mx-auto">
              <svg
                className="w-6 h-6 text-red-400/60"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
            </div>
            <p className="text-red-300/70 text-sm">{error}</p>
            <button
              onClick={refresh}
              className="text-[11px] text-white/40 hover:text-white/60 underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="neo-card p-12 text-center">
            <p className="text-white/40 text-sm animate-pulse">
              Loading feed...
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="neo-card p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mx-auto">
              <svg
                className="w-6 h-6 text-white/20"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
                />
              </svg>
            </div>
            <p className="text-white/40 text-sm">
              {ECONOMY.STARKCAST_FEED === "0x0"
                ? "StarkCast contract not deployed yet. Deploy to start casting."
                : "No casts yet. Be the first to share your alpha."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((cast) => (
              <CastCard
                key={cast.postId}
                cast={cast}
                onLike={handleLike}
                onTip={(id) => setTipPostId(id)}
                liking={likingId}
                tipping={tipPostId}
              />
            ))}
          </div>
        )}
      </main>

      {showCompose && (
        <ComposeModal
          onClose={() => setShowCompose(false)}
          onPosted={refresh}
        />
      )}

      {tipPostId !== null && (
        <TipModal
          postId={tipPostId}
          onClose={() => setTipPostId(null)}
          onTipped={refresh}
        />
      )}

      <Footer />
    </div>
  );
}
