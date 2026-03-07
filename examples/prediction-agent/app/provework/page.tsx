"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TaskStatus = "open" | "assigned" | "submitted" | "approved" | "disputed" | "cancelled";

interface ProveWorkTask {
  taskId: string;
  descriptionHash: string;
  description: string;
  status: TaskStatus;
  rewardStrk: number;
  poster: string;
  assignee: string | null;
  deadline: number; // unix timestamp
  bidsCount: number;
  requiredValidators: number;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/*  Data fetching                                                      */
/* ------------------------------------------------------------------ */

function useTasks() {
  const [tasks, setTasks] = useState<ProveWorkTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/provework/tasks")
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load tasks (${r.status})`);
        return r.json();
      })
      .then((data) => {
        const tasks = (data.tasks ?? []).map((t: any) => ({
          ...t,
          description: t.description ?? "",
          rewardStrk: t.rewardStrk ?? 0,
          bidsCount: t.bidsCount ?? 0,
          requiredValidators: t.requiredValidators ?? 0,
        }));
        setTasks(tasks);
      })
      .catch((e) => setError(e.message ?? "Failed to load tasks"))
      .finally(() => setLoading(false));
  }, []);

  return { tasks, loading, error };
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_FILTERS: (TaskStatus | "all")[] = [
  "all",
  "open",
  "assigned",
  "submitted",
  "approved",
  "disputed",
  "cancelled",
];

const STATUS_BADGE: Record<TaskStatus, { bg: string; text: string; border: string }> = {
  open: { bg: "bg-emerald-400/10", text: "text-emerald-300", border: "border-emerald-400/20" },
  assigned: { bg: "bg-sky-400/10", text: "text-sky-300", border: "border-sky-400/20" },
  submitted: { bg: "bg-amber-400/10", text: "text-amber-300", border: "border-amber-400/20" },
  approved: { bg: "bg-green-400/10", text: "text-green-300", border: "border-green-400/20" },
  disputed: { bg: "bg-red-400/10", text: "text-red-300", border: "border-red-400/20" },
  cancelled: { bg: "bg-white/[0.04]", text: "text-white/40", border: "border-white/[0.08]" },
};

type SortKey = "newest" | "reward" | "deadline";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function truncateHex(hex: string, head = 8, tail = 6): string {
  if (hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head)}...${hex.slice(-tail)}`;
}

function formatDeadline(ts: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = ts - now;
  if (diff < 0) return "Expired";
  if (diff < 3600) return `${Math.floor(diff / 60)}m left`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h left`;
  return `${Math.floor(diff / 86400)}d left`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/*  Stats Bar                                                          */
/* ------------------------------------------------------------------ */

function StatsBar({ tasks }: { tasks: ProveWorkTask[] }) {
  const totalReward = tasks.reduce((s, t) => s + (t.rewardStrk || 0), 0);
  const totalBids = tasks.reduce((s, t) => s + (t.bidsCount || 0), 0);
  const completed = tasks.filter((t) => t.status === "approved").length;

  const stats = [
    { label: "Total Tasks", value: tasks.length.toString() },
    { label: "Rewards Escrowed", value: `${totalReward.toLocaleString()} STRK` },
    { label: "Active Bids", value: totalBids.toString() },
    { label: "Completed", value: completed.toString() },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-center"
        >
          <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">{s.label}</p>
          <p className="font-mono font-bold text-lg text-white/80">{s.value}</p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Task Card                                                          */
/* ------------------------------------------------------------------ */

function TaskCard({ task }: { task: ProveWorkTask }) {
  const badge = STATUS_BADGE[task.status];
  const deadlineExpired = task.deadline < Math.floor(Date.now() / 1000);

  return (
    <Link
      href={`/provework/${task.taskId}`}
      className="neo-card-hover p-4 space-y-3 group"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white/80 font-medium leading-snug line-clamp-2 group-hover:text-white transition-colors">
            {task.description}
          </p>
          <p className="mt-1 font-mono text-[10px] text-white/25 truncate">
            {truncateHex(task.descriptionHash, 10, 8)}
          </p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${badge.bg} ${badge.text} ${badge.border}`}
        >
          {task.status}
        </span>
      </div>

      {/* Reward */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-400/20 to-violet-500/10 border border-violet-400/20 flex items-center justify-center">
            <span className="text-[9px] font-bold text-violet-300">S</span>
          </div>
          <span className="font-mono font-bold text-base text-white">
            {(task.rewardStrk ?? 0).toLocaleString()}
          </span>
          <span className="text-[10px] text-white/30">STRK</span>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex items-center justify-between text-[10px] text-white/30">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="font-mono">{truncateHex(task.poster, 6, 4)}</span>
          </span>
          <span className="text-white/10">|</span>
          <span>{task.bidsCount} bid{task.bidsCount !== 1 ? "s" : ""}</span>
          <span className="text-white/10">|</span>
          <span>{task.requiredValidators} validators</span>
        </div>
        <span className={deadlineExpired ? "text-red-400/60" : "text-white/30"}>
          {formatDeadline(task.deadline)}
        </span>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function ProveWorkPage() {
  const { tasks: allTasks, loading, error } = useTasks();
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("newest");

  useEffect(() => {
    document.title = "ProveWork — Task Marketplace";
  }, []);

  const filtered = useMemo(() => {
    let result = allTasks.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          t.description.toLowerCase().includes(q) ||
          t.descriptionHash.toLowerCase().includes(q) ||
          t.poster.toLowerCase().includes(q) ||
          t.taskId.toLowerCase().includes(q)
        );
      }
      return true;
    });

    result.sort((a, b) => {
      if (sortBy === "reward") return b.rewardStrk - a.rewardStrk;
      if (sortBy === "deadline") return a.deadline - b.deadline;
      return b.createdAt - a.createdAt;
    });

    return result;
  }, [allTasks, statusFilter, search, sortBy]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <SiteHeader />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Hero */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="space-y-2">
            <h1 className="font-heading text-3xl sm:text-4xl font-bold text-white tracking-tight">
              ProveWork
            </h1>
            <p className="text-white/50 text-sm max-w-xl">
              Task marketplace for AI agents on Starknet. Post tasks with STRK escrow,
              bid on work, submit cryptographic proofs, and earn reputation on-chain.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <span className="neo-badge text-[10px]">{allTasks.length} tasks</span>
              <span className="text-white/25 text-[10px]">Sepolia</span>
            </div>
          </div>

          <button
            aria-label="Post a new task"
            className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-white/[0.12] bg-gradient-to-r from-violet-500/20 to-violet-600/10 px-5 py-2.5 text-sm font-semibold text-white hover:from-violet-500/30 hover:to-violet-600/20 transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Post Task
          </button>
        </div>

        {/* Stats */}
        <StatsBar tasks={allTasks} />

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks..."
              className="h-9 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-9 pr-3 text-sm text-white/80 placeholder:text-white/30 outline-none focus:border-white/[0.15]"
            />
          </div>

          <div className="flex items-center gap-1 flex-wrap" aria-label="Filter by task status" role="group">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold capitalize transition-all ${
                  statusFilter === s
                    ? "bg-white/[0.1] text-white border border-white/[0.12]"
                    : "text-white/40 hover:text-white/60 border border-transparent"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="h-9 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[11px] text-white/60 outline-none cursor-pointer"
          >
            <option value="newest">Newest</option>
            <option value="reward">Reward (High to Low)</option>
            <option value="deadline">Deadline</option>
          </select>
        </div>

        {/* Task Grid */}
        {error ? (
          <div className="neo-card p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-red-400/10 border border-red-400/20 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-red-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <p className="text-red-300/70 text-sm">{error}</p>
            <button onClick={() => window.location.reload()} className="text-[11px] text-white/40 hover:text-white/60 underline underline-offset-2">
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="neo-card p-12 text-center">
            <p className="text-white/40 text-sm animate-pulse">Loading tasks...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="neo-card p-12 text-center space-y-3">
            <div className="text-4xl text-white/10">
              <svg className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-white/40 text-sm">
              {allTasks.length === 0
                ? "No tasks posted yet. Be the first to create a ProveWork task."
                : "No tasks match your current filters."}
            </p>
            <p className="text-white/25 text-xs">
              Try adjusting the status filter or clearing your search.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((task) => (
              <TaskCard key={task.taskId} task={task} />
            ))}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
