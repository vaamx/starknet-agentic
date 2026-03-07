"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAccount } from "@starknet-react/core";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import {
  ECONOMY,
  buildBidTaskCalls,
  buildSubmitProofCalls,
  buildApproveTaskCalls,
  buildDisputeTaskCalls,
} from "@/lib/contracts";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TaskStatus = "open" | "assigned" | "submitted" | "approved" | "disputed" | "cancelled";

interface Bid {
  bidder: string;
  amount: number;
  timestamp: number;
  message?: string;
}

interface TimelineEvent {
  action: string;
  actor: string;
  timestamp: number;
  detail?: string;
}

interface ProveWorkTaskDetail {
  taskId: string;
  descriptionHash: string;
  description: string | null;
  status: TaskStatus;
  rewardStrk: number;
  poster: string;
  assignee: string | null;
  deadline: number;
  requiredValidators: number;
  createdAt: number;
  proofHash: string | null;
  proofSubmittedAt: number | null;
  bids: Bid[];
  timeline: TimelineEvent[];
  source?: "onchain" | "mock";
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const STATUS_BADGE: Record<TaskStatus, { bg: string; text: string; border: string }> = {
  open: { bg: "bg-emerald-400/10", text: "text-emerald-300", border: "border-emerald-400/20" },
  assigned: { bg: "bg-sky-400/10", text: "text-sky-300", border: "border-sky-400/20" },
  submitted: { bg: "bg-amber-400/10", text: "text-amber-300", border: "border-amber-400/20" },
  approved: { bg: "bg-green-400/10", text: "text-green-300", border: "border-green-400/20" },
  disputed: { bg: "bg-red-400/10", text: "text-red-300", border: "border-red-400/20" },
  cancelled: { bg: "bg-white/[0.04]", text: "text-white/40", border: "border-white/[0.08]" },
};

function truncateHex(hex: string, head = 8, tail = 6): string {
  if (hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head)}...${hex.slice(-tail)}`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDeadline(ts: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = ts - now;
  if (diff < 0) return "Expired";
  if (diff < 3600) return `${Math.floor(diff / 60)}m remaining`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h remaining`;
  return `${Math.floor(diff / 86400)}d remaining`;
}

/* ------------------------------------------------------------------ */
/*  Timeline Item                                                      */
/* ------------------------------------------------------------------ */

const TIMELINE_COLORS: Record<string, string> = {
  "Task Created": "border-violet-400/40 bg-violet-400/10",
  "Bid Placed": "border-sky-400/40 bg-sky-400/10",
  "Bid Accepted": "border-emerald-400/40 bg-emerald-400/10",
  "Proof Submitted": "border-amber-400/40 bg-amber-400/10",
  "Dispute Raised": "border-red-400/40 bg-red-400/10",
  "Approved": "border-green-400/40 bg-green-400/10",
};

function TimelineItem({ event, isLast }: { event: TimelineEvent; isLast: boolean }) {
  const color = TIMELINE_COLORS[event.action] ?? "border-white/20 bg-white/[0.04]";
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`w-2.5 h-2.5 rounded-full border-2 ${color} shrink-0 mt-1.5`} />
        {!isLast && <div className="w-px flex-1 bg-white/[0.06] mt-1" />}
      </div>
      <div className="pb-4">
        <p className="text-xs font-semibold text-white/70">{event.action}</p>
        <p className="text-[10px] text-white/30 font-mono mt-0.5">{truncateHex(event.actor, 8, 4)}</p>
        {event.detail && (
          <p className="text-[10px] text-white/40 mt-0.5">{event.detail}</p>
        )}
        <p className="text-[10px] text-white/20 mt-1">{formatTimestamp(event.timestamp)}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Task Actions (wallet-connected)                                    */
/* ------------------------------------------------------------------ */

function TaskActions({ taskId, status, onSuccess }: { taskId: string; status: TaskStatus; onSuccess?: () => void }) {
  const { isConnected, account } = useAccount();
  const [sending, setSending] = useState(false);
  const [activeAction, setActiveAction] = useState<"bid" | "proof" | "dispute" | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [txResult, setTxResult] = useState<{ status: string; txHash?: string; error?: string } | null>(null);

  const escrow = ECONOMY.TASK_ESCROW;
  const taskIdBigInt = BigInt(taskId);

  async function handleBid() {
    if (!inputValue || !account) return;
    setTxResult(null);
    setSending(true);
    try {
      const amount = BigInt(Math.floor(parseFloat(inputValue) * 1e18));
      const calls = buildBidTaskCalls(escrow, taskIdBigInt, amount);
      const res = await account.execute(calls);
      setTxResult({ status: "success", txHash: res.transaction_hash });
      setActiveAction(null);
      setInputValue("");
      setTimeout(() => onSuccess?.(), 5000);
    } catch (err: any) {
      setTxResult({ status: "error", error: err.message });
    } finally {
      setSending(false);
    }
  }

  async function handleSubmitProof() {
    if (!inputValue || !account) return;
    setTxResult(null);
    setSending(true);
    try {
      const proofHash = BigInt(inputValue);
      const calls = buildSubmitProofCalls(escrow, taskIdBigInt, proofHash);
      const res = await account.execute(calls);
      setTxResult({ status: "success", txHash: res.transaction_hash });
      setActiveAction(null);
      setInputValue("");
      setTimeout(() => onSuccess?.(), 5000);
    } catch (err: any) {
      setTxResult({ status: "error", error: err.message });
    } finally {
      setSending(false);
    }
  }

  async function handleApprove() {
    if (!account) return;
    setTxResult(null);
    setSending(true);
    try {
      const calls = buildApproveTaskCalls(escrow, taskIdBigInt);
      const res = await account.execute(calls);
      setTxResult({ status: "success", txHash: res.transaction_hash });
      setTimeout(() => onSuccess?.(), 5000);
    } catch (err: any) {
      setTxResult({ status: "error", error: err.message });
    } finally {
      setSending(false);
    }
  }

  async function handleDispute() {
    if (!inputValue || !account) return;
    setTxResult(null);
    setSending(true);
    try {
      const reasonHash = BigInt(inputValue);
      const calls = buildDisputeTaskCalls(escrow, taskIdBigInt, reasonHash);
      const res = await account.execute(calls);
      setTxResult({ status: "success", txHash: res.transaction_hash });
      setActiveAction(null);
      setInputValue("");
      setTimeout(() => onSuccess?.(), 5000);
    } catch (err: any) {
      setTxResult({ status: "error", error: err.message });
    } finally {
      setSending(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="neo-card p-5 space-y-3">
        <h2 className="font-heading font-bold text-sm text-white">Actions</h2>
        <div className="text-center py-3 border border-dashed border-white/10 text-sm text-white/50 rounded-lg">
          Connect Wallet to Interact
        </div>
      </div>
    );
  }

  return (
    <div className="neo-card p-5 space-y-3">
      <h2 className="font-heading font-bold text-sm text-white">Actions</h2>
      <div className="flex flex-wrap gap-2">
        {status === "open" && (
          <button
            onClick={() => { setActiveAction(activeAction === "bid" ? null : "bid"); setInputValue(""); }}
            disabled={sending}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-400/15 transition-all disabled:opacity-40"
          >
            Place Bid
          </button>
        )}
        {status === "assigned" && (
          <button
            onClick={() => { setActiveAction(activeAction === "proof" ? null : "proof"); setInputValue(""); }}
            disabled={sending}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-400/15 transition-all disabled:opacity-40"
          >
            Submit Proof
          </button>
        )}
        {status === "submitted" && (
          <>
            <button
              onClick={handleApprove}
              disabled={sending}
              className="inline-flex items-center gap-1.5 rounded-xl border border-green-400/20 bg-green-400/10 px-4 py-2 text-xs font-semibold text-green-300 hover:bg-green-400/15 transition-all disabled:opacity-40"
            >
              {sending ? "Signing..." : "Approve"}
            </button>
            <button
              onClick={() => { setActiveAction(activeAction === "dispute" ? null : "dispute"); setInputValue(""); }}
              disabled={sending}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-2 text-xs font-semibold text-red-300 hover:bg-red-400/15 transition-all disabled:opacity-40"
            >
              Dispute
            </button>
          </>
        )}
      </div>

      {activeAction === "bid" && (
        <div className="flex items-center gap-2 pt-2">
          <input
            type="number"
            step="0.01"
            min="0"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Bid amount (STRK)"
            className="flex-1 h-9 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white/80 placeholder:text-white/30 outline-none focus:border-white/[0.15] font-mono"
          />
          <button
            onClick={handleBid}
            disabled={sending || !inputValue}
            className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-400/15 transition-all disabled:opacity-40"
          >
            {sending ? "Signing..." : "Submit Bid"}
          </button>
        </div>
      )}

      {activeAction === "proof" && (
        <div className="flex items-center gap-2 pt-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Proof hash (0x...)"
            className="flex-1 h-9 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white/80 placeholder:text-white/30 outline-none focus:border-white/[0.15] font-mono"
          />
          <button
            onClick={handleSubmitProof}
            disabled={sending || !inputValue}
            className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-400/15 transition-all disabled:opacity-40"
          >
            {sending ? "Signing..." : "Submit"}
          </button>
        </div>
      )}

      {activeAction === "dispute" && (
        <div className="flex items-center gap-2 pt-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Reason hash (0x...)"
            className="flex-1 h-9 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white/80 placeholder:text-white/30 outline-none focus:border-white/[0.15] font-mono"
          />
          <button
            onClick={handleDispute}
            disabled={sending || !inputValue}
            className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-2 text-xs font-semibold text-red-300 hover:bg-red-400/15 transition-all disabled:opacity-40"
          >
            {sending ? "Signing..." : "Dispute"}
          </button>
        </div>
      )}

      {txResult && (
        <div className={`mt-2 p-2.5 border text-xs font-mono rounded-lg ${
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
                  className="block text-xs text-sky-400/70 mt-1 hover:underline break-all"
                >
                  View on Voyager: {txResult.txHash.slice(0, 20)}...
                </a>
              )}
            </>
          ) : (
            <span className="text-red-300">{txResult.error}</span>
          )}
        </div>
      )}

      <p className="text-[10px] text-white/20">
        Actions interact with the ProveWork smart contract on Starknet Sepolia.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function ProveWorkDetailPage() {
  const params = useParams();
  const taskId = params?.taskId as string;
  const [task, setTask] = useState<ProveWorkTaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchTask = useCallback(() => {
    setLoading(true);
    setError(false);
    fetch(`/api/provework/tasks/${encodeURIComponent(taskId)}`)
      .then((res) => {
        if (!res.ok) throw new Error("not found");
        return res.json();
      })
      .then((data) => {
        setTask({
          ...data,
          bids: data.bids ?? [],
          timeline: data.timeline ?? [],
          rewardStrk: data.rewardStrk ?? 0,
          bidsCount: data.bidsCount ?? 0,
          requiredValidators: data.requiredValidators ?? 0,
        });
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [taskId]);

  useEffect(() => {
    fetchTask();
  }, [fetchTask]);

  useEffect(() => {
    if (task?.description) {
      document.title = `ProveWork — ${task.description.slice(0, 60)}`;
    } else if (task) {
      document.title = `ProveWork — Task #${task.taskId}`;
    }
  }, [task]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
        <SiteHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin mx-auto" />
            <p className="text-white/30 text-xs">Loading task...</p>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
        <SiteHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <p className="text-white/50 text-sm">Task not found</p>
            <p className="text-white/25 text-xs font-mono">{taskId}</p>
            <Link href="/provework" className="neo-btn-secondary text-xs inline-block mt-2">
              Back to ProveWork
            </Link>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  const badge = STATUS_BADGE[task.status] ?? STATUS_BADGE.open;
  const deadlineExpired = task.deadline < Math.floor(Date.now() / 1000);
  const displayDescription = task.description || `Task #${task.taskId}`;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <SiteHeader />

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Source badge */}
        {task.source === "onchain" && (
          <div className="inline-flex items-center gap-1.5 rounded-full border border-neo-green/25 bg-neo-green/10 px-2.5 py-0.5 text-[10px] font-semibold text-neo-green">
            <span className="w-1.5 h-1.5 rounded-full bg-neo-green" />
            Live On-Chain Data
          </div>
        )}

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-white/30">
          <Link href="/provework" className="hover:text-white/50 transition-colors">ProveWork</Link>
          <span>/</span>
          <span className="text-white/60 font-mono">{truncateHex(task.taskId, 6, 4)}</span>
        </nav>

        {/* Task Header */}
        <div className="neo-card p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="font-heading text-xl sm:text-2xl font-bold text-white leading-snug">
                {displayDescription}
              </h1>
              <p className="mt-2 font-mono text-[10px] text-white/25 break-all">
                Hash: {task.descriptionHash}
              </p>
            </div>
            <span
              className={`shrink-0 inline-flex items-center rounded-lg border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${badge.bg} ${badge.text} ${badge.border}`}
            >
              {task.status}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-400/20 to-violet-500/10 border border-violet-400/20 flex items-center justify-center">
                <span className="text-xs font-bold text-violet-300">S</span>
              </div>
              <span className="font-mono font-bold text-2xl text-white">
                {(task.rewardStrk ?? 0).toLocaleString()}
              </span>
              <span className="text-sm text-white/30">STRK reward</span>
            </div>
          </div>
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
            <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">Poster</p>
            <a
              href={`https://sepolia.voyager.online/contract/${task.poster}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-sky-400/70 hover:text-sky-300 transition-colors"
            >
              {truncateHex(task.poster, 8, 6)}
            </a>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
            <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">Assignee</p>
            {task.assignee ? (
              <a
                href={`https://sepolia.voyager.online/contract/${task.assignee}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-sky-400/70 hover:text-sky-300 transition-colors"
              >
                {truncateHex(task.assignee, 8, 6)}
              </a>
            ) : (
              <p className="text-xs text-white/30">Unassigned</p>
            )}
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
            <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">Deadline</p>
            <p className={`text-xs font-mono ${deadlineExpired ? "text-red-400/70" : "text-white/60"}`}>
              {formatDeadline(task.deadline)}
            </p>
            <p className="text-[10px] text-white/20 mt-0.5">{formatTimestamp(task.deadline)}</p>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
            <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">Validators Required</p>
            <p className="font-mono text-xs text-white/60">{task.requiredValidators}</p>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
            <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">Created</p>
            <p className="text-xs text-white/60">{formatTimestamp(task.createdAt)}</p>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
            <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">Task ID</p>
            <p className="font-mono text-xs text-white/60">{task.taskId}</p>
          </div>
        </div>

        {/* Proof Section */}
        {task.proofHash && (
          <div className="neo-card p-5 space-y-3">
            <h2 className="font-heading font-bold text-sm text-white flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-300/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Submitted Proof
            </h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-white/[0.04]">
                <span className="text-white/35">Proof Hash</span>
                <span className="font-mono text-white/50 break-all text-right max-w-[60%]">
                  {task.proofHash}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-white/[0.04]">
                <span className="text-white/35">Submitted At</span>
                <span className="text-white/50">
                  {task.proofSubmittedAt ? formatTimestamp(task.proofSubmittedAt) : "N/A"}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Bids */}
          <div className="neo-card p-5 space-y-3">
            <h2 className="font-heading font-bold text-sm text-white">
              Bids
              <span className="ml-2 text-[10px] text-white/30 font-normal">({task.bids?.length ?? 0})</span>
            </h2>
            {!task.bids || task.bids.length === 0 ? (
              <p className="text-[11px] text-white/30">No bids yet.</p>
            ) : (
              <div className="space-y-2">
                {task.bids.map((bid, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <a
                        href={`https://sepolia.voyager.online/contract/${bid.bidder}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[11px] text-sky-400/70 hover:text-sky-300 transition-colors"
                      >
                        {truncateHex(bid.bidder, 8, 4)}
                      </a>
                      <span className="font-mono text-xs font-bold text-white/70">
                        {typeof bid.amount === "number" ? bid.amount.toLocaleString() : bid.amount} STRK
                      </span>
                    </div>
                    {bid.message && (
                      <p className="text-[11px] text-white/40 leading-relaxed">{bid.message}</p>
                    )}
                    <p className="text-[10px] text-white/20">{formatTimestamp(bid.timestamp)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="neo-card p-5 space-y-3">
            <h2 className="font-heading font-bold text-sm text-white">Timeline</h2>
            {!task.timeline || task.timeline.length === 0 ? (
              <p className="text-[11px] text-white/30">No events recorded yet.</p>
            ) : (
              <div className="mt-2">
                {task.timeline.map((event, i) => (
                  <TimelineItem
                    key={i}
                    event={event}
                    isLast={i === task.timeline.length - 1}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <TaskActions taskId={task.taskId} status={task.status} onSuccess={fetchTask} />

        {/* Back link */}
        <div className="pt-2">
          <Link href="/provework" className="text-xs text-white/30 hover:text-white/50 transition-colors">
            &larr; Back to ProveWork
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}
