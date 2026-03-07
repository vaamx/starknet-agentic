"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAccount } from "@starknet-react/core";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import {
  ECONOMY,
  buildJoinGuildCalls,
  buildLeaveGuildCalls,
  buildGuildVoteCalls,
} from "@/lib/contracts";

// ── Types ────────────────────────────────────────────────────────────────────

interface GuildMember {
  address: string;
  stakeAmount: number;
  joinedAt: number;
}

interface Proposal {
  id: number;
  description?: string;
  descriptionHash?: string;
  status: "active" | "passed" | "rejected" | "executed" | "cancelled";
  yesVotes: number;
  noVotes: number;
  quorum: number;
  totalVoters?: number;
  deadline: number;
  creator?: string;
  proposer?: string;
}

interface GuildDetail {
  guildId: number;
  name: string;
  creator: string;
  description: string | null;
  memberCount: number;
  totalStaked: number;
  minStake: number;
  createdAt: number;
  members: GuildMember[];
  proposals: Proposal[];
  tags: string[];
  source?: "onchain" | "mock";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function fmtStrk(amount: number | undefined | null): string {
  if (amount == null || isNaN(amount)) return "0";
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toLocaleString();
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtRelative(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h left`;
  return `${hours}h left`;
}

const STATUS_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  active: { bg: "bg-cyan-400/10", text: "text-cyan-300", border: "border-cyan-400/20" },
  passed: { bg: "bg-emerald-400/10", text: "text-emerald-300", border: "border-emerald-400/20" },
  rejected: { bg: "bg-red-400/10", text: "text-red-300", border: "border-red-400/20" },
  executed: { bg: "bg-emerald-400/15", text: "text-emerald-200", border: "border-emerald-400/25" },
  cancelled: { bg: "bg-white/[0.04]", text: "text-white/40", border: "border-white/[0.08]" },
};

// ── Guild Membership Actions (wallet-connected) ─────────────────────────────

function GuildMembershipActions({
  guildId,
  minStake,
  stakeInput,
  setStakeInput,
}: {
  guildId: number;
  minStake: number;
  stakeInput: string;
  setStakeInput: (v: string) => void;
}) {
  const { isConnected, account } = useAccount();
  const [sending, setSending] = useState(false);
  const [txResult, setTxResult] = useState<{ status: string; txHash?: string; error?: string } | null>(null);

  async function handleJoin() {
    const amt = parseFloat(stakeInput);
    if (!amt || amt < minStake || !account) return;
    setTxResult(null);
    setSending(true);
    try {
      const stakeWei = BigInt(Math.floor(amt * 1e18));
      const calls = buildJoinGuildCalls(ECONOMY.GUILD_REGISTRY, BigInt(guildId), stakeWei);
      const res = await account.execute(calls);
      setTxResult({ status: "success", txHash: res.transaction_hash });
    } catch (err: any) {
      setTxResult({ status: "error", error: err.message });
    } finally {
      setSending(false);
    }
  }

  async function handleLeave() {
    if (!account) return;
    setTxResult(null);
    setSending(true);
    try {
      const calls = buildLeaveGuildCalls(ECONOMY.GUILD_REGISTRY, BigInt(guildId));
      const res = await account.execute(calls);
      setTxResult({ status: "success", txHash: res.transaction_hash });
    } catch (err: any) {
      setTxResult({ status: "error", error: err.message });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="font-heading font-bold text-base text-white">Membership</h2>
        {isConnected ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleJoin}
              disabled={sending || !stakeInput || parseFloat(stakeInput) < minStake}
              className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-400/15 hover:border-cyan-400/30 transition-all disabled:opacity-40"
            >
              {sending ? "Signing..." : "Join Guild"}
            </button>
            <button
              onClick={handleLeave}
              disabled={sending}
              className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-[11px] font-semibold text-white/40 hover:text-white/60 hover:bg-white/[0.06] transition-all disabled:opacity-40"
            >
              {sending ? "..." : "Leave Guild"}
            </button>
          </div>
        ) : (
          <span className="text-[11px] text-white/30">Connect wallet</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <input
            type="number"
            value={stakeInput}
            onChange={(e) => setStakeInput(e.target.value)}
            placeholder={`Min ${minStake} STRK`}
            className="h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 pr-14 text-sm text-white/80 placeholder:text-white/25 outline-none focus:border-white/[0.15] font-mono"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/25 font-semibold">
            STRK
          </span>
        </div>
      </div>

      {txResult && (
        <div className={`p-2.5 border text-xs font-mono rounded-lg ${
          txResult.status === "success"
            ? "border-emerald-400/30 bg-emerald-400/10"
            : "border-red-400/30 bg-red-400/10"
        }`}>
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
    </>
  );
}

// ── Vote Buttons (wallet-connected) ──────────────────────────────────────────

function VoteButtons({ proposalId }: { proposalId: number }) {
  const { isConnected, account } = useAccount();
  const [voting, setVoting] = useState(false);
  const [txResult, setTxResult] = useState<{ status: string; txHash?: string; error?: string } | null>(null);

  async function handleVote(support: boolean) {
    if (!account) return;
    setTxResult(null);
    setVoting(true);
    try {
      const calls = buildGuildVoteCalls(ECONOMY.GUILD_DAO, BigInt(proposalId), support);
      const res = await account.execute(calls);
      setTxResult({ status: "success", txHash: res.transaction_hash });
    } catch (err: any) {
      setTxResult({ status: "error", error: err.message });
    } finally {
      setVoting(false);
    }
  }

  if (!isConnected) {
    return <span className="text-[10px] text-white/25">Connect wallet to vote</span>;
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleVote(true)}
          disabled={voting}
          className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-400/15 transition-all disabled:opacity-40"
        >
          {voting ? "..." : "Vote Yes"}
        </button>
        <button
          onClick={() => handleVote(false)}
          disabled={voting}
          className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-1.5 text-[10px] font-semibold text-red-300 hover:bg-red-400/15 transition-all disabled:opacity-40"
        >
          {voting ? "..." : "Vote No"}
        </button>
      </div>
      {txResult && (
        <div className={`p-1.5 text-[10px] font-mono rounded ${
          txResult.status === "success" ? "text-emerald-300" : "text-red-300"
        }`}>
          {txResult.status === "success"
            ? <a href={`https://sepolia.voyager.online/tx/${txResult.txHash}`} target="_blank" rel="noopener noreferrer" className="hover:underline">Tx: {txResult.txHash?.slice(0, 16)}...</a>
            : txResult.error}
        </div>
      )}
    </div>
  );
}

// ── Proposal Card ────────────────────────────────────────────────────────────

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const st = STATUS_STYLE[proposal.status] ?? STATUS_STYLE.cancelled;
  const totalVotes = proposal.yesVotes + proposal.noVotes;
  const yesPct = totalVotes > 0 ? (proposal.yesVotes / totalVotes) * 100 : 0;
  const noPct = totalVotes > 0 ? 100 - yesPct : 0;
  const quorumPct = proposal.quorum > 0 ? Math.min(100, (totalVotes / proposal.quorum) * 100) : 0;
  const isActive = proposal.status === "active";
  const displayText = proposal.description ?? `Proposal ${proposal.descriptionHash ?? `#${proposal.id}`}`;
  const creatorAddr = proposal.creator ?? proposal.proposer ?? "0x0";

  return (
    <div className="neo-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-mono text-white/25">#{proposal.id}</span>
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${st.bg} ${st.text} ${st.border}`}
            >
              {proposal.status}
            </span>
          </div>
          <p className="text-[12px] text-white/70 leading-relaxed">{displayText}</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-emerald-300/70">Yes: {fmtStrk(proposal.yesVotes)} STRK</span>
          <span className="text-red-300/70">No: {fmtStrk(proposal.noVotes)} STRK</span>
        </div>
        <div className="h-2.5 rounded-full bg-white/[0.06] overflow-hidden flex" role="progressbar" aria-valuenow={totalVotes} aria-valuemax={proposal.quorum} aria-label="Vote distribution">
          {totalVotes > 0 && (
            <>
              <div
                className="h-full bg-gradient-to-r from-emerald-500/70 to-emerald-400/50 transition-all duration-700"
                style={{ width: `${yesPct}%` }}
              />
              <div
                className="h-full bg-gradient-to-r from-red-500/50 to-red-400/40 transition-all duration-700"
                style={{ width: `${noPct}%` }}
              />
            </>
          )}
        </div>
        <div className="flex items-center justify-between text-[10px] text-white/30">
          <span>{yesPct.toFixed(1)}% Yes</span>
          {proposal.totalVoters != null && <span>{proposal.totalVoters} voters</span>}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-[9px]">
          <span className="uppercase tracking-wider text-white/25">Quorum</span>
          <span className="text-white/35">{quorumPct.toFixed(0)}% of {fmtStrk(proposal.quorum)} STRK</span>
        </div>
        <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden" role="progressbar" aria-valuenow={totalVotes} aria-valuemax={proposal.quorum} aria-label="Quorum progress">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              quorumPct >= 100
                ? "bg-gradient-to-r from-emerald-400/60 to-emerald-300/40"
                : "bg-gradient-to-r from-amber-400/50 to-amber-300/30"
            }`}
            style={{ width: `${quorumPct}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-[10px] text-white/25">
          <span>by {truncAddr(creatorAddr)}</span>
          <span>{isActive ? fmtRelative(proposal.deadline) : `Ended ${fmtDate(proposal.deadline)}`}</span>
        </div>

        {isActive && (
          <VoteButtons proposalId={proposal.id} />
        )}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function GuildDetailPage() {
  const params = useParams();
  const guildId = params?.guildId as string;
  const [stakeInput, setStakeInput] = useState("");
  const [guild, setGuild] = useState<GuildDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    fetch(`/api/guilds/${encodeURIComponent(guildId)}`)
      .then((res) => {
        if (!res.ok) throw new Error("not found");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setGuild({
            ...data,
            tags: data.tags ?? [],
            members: data.members ?? [],
            proposals: data.proposals ?? [],
            description: data.description ?? null,
            totalStaked: data.totalStaked ?? 0,
            memberCount: data.memberCount ?? 0,
            minStake: data.minStake ?? 0,
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
  }, [guildId]);

  useEffect(() => {
    if (guild) {
      document.title = `${guild.name} — Agent Guild`;
    }
  }, [guild]);

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

  if (error || !guild) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
        <SiteHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <p className="text-white/50">Guild not found</p>
            <Link href="/guilds" className="neo-btn-secondary text-xs">Back to Guilds</Link>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  const activeProposals = (guild.proposals ?? []).filter((p) => p.status === "active").length;
  const displayDescription = guild.description ?? `Guild #${guild.guildId}`;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <SiteHeader />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Source badge */}
        {guild.source === "onchain" && (
          <div className="inline-flex items-center gap-1.5 rounded-full border border-neo-green/25 bg-neo-green/10 px-2.5 py-0.5 text-[10px] font-semibold text-neo-green">
            <span className="w-1.5 h-1.5 rounded-full bg-neo-green" />
            Live On-Chain Data
          </div>
        )}

        {/* Back */}
        <Link
          href="/guilds"
          className="inline-flex items-center gap-1.5 text-[11px] text-white/35 hover:text-white/60 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to Guilds
        </Link>

        {/* Guild Header */}
        <div className="neo-card p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-400/15 to-violet-400/10 border border-white/[0.08] flex items-center justify-center">
                <span className="font-heading font-bold text-xl text-cyan-300/80">
                  {guild.name.charAt(0)}
                </span>
              </div>
              <div>
                <h1 className="font-heading text-2xl sm:text-3xl font-bold text-white tracking-tight">
                  {guild.name}
                </h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-white/30 font-mono">
                    Created by {truncAddr(guild.creator)}
                  </span>
                  <span className="text-white/10">|</span>
                  <span className="text-[10px] text-white/25">{fmtDate(guild.createdAt)}</span>
                </div>
              </div>
            </div>
            {guild.tags && guild.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {guild.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-white/[0.06] bg-white/[0.02] px-2.5 py-0.5 text-[10px] text-white/35"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
          <p className="text-[12px] text-white/45 leading-relaxed max-w-2xl">
            {displayDescription}
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Members", value: guild.memberCount.toString() },
            { label: "Total Staked", value: `${fmtStrk(guild.totalStaked)} STRK` },
            { label: "Min Stake", value: `${guild.minStake} STRK` },
            { label: "Active Proposals", value: activeProposals.toString() },
          ].map((s) => (
            <div key={s.label} className="neo-card p-4 text-center space-y-1">
              <p className="text-[9px] uppercase tracking-wider text-white/30 font-semibold">{s.label}</p>
              <p className="font-heading font-bold text-lg text-white">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Membership Section */}
        <div className="neo-card p-6 space-y-5">
          <GuildMembershipActions guildId={guild.guildId} minStake={guild.minStake} stakeInput={stakeInput} setStakeInput={setStakeInput} />

          {/* Members Table */}
          {guild.members && guild.members.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="pb-2 text-[9px] uppercase tracking-wider text-white/25 font-semibold">Address</th>
                      <th className="pb-2 text-[9px] uppercase tracking-wider text-white/25 font-semibold text-right">Stake</th>
                      <th className="pb-2 text-[9px] uppercase tracking-wider text-white/25 font-semibold text-right hidden sm:table-cell">Weight</th>
                      <th className="pb-2 text-[9px] uppercase tracking-wider text-white/25 font-semibold text-right hidden sm:table-cell">Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {guild.members.map((m, i) => {
                      const weight = guild.totalStaked > 0
                        ? ((m.stakeAmount / guild.totalStaked) * 100).toFixed(1)
                        : "0";
                      return (
                        <tr key={i} className="group">
                          <td className="py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
                                <span className="text-[8px] text-white/30 font-mono">{i + 1}</span>
                              </div>
                              <span className="text-[11px] text-white/60 font-mono group-hover:text-white/80 transition-colors">
                                {truncAddr(m.address)}
                              </span>
                              {m.address === guild.creator && (
                                <span className="rounded border border-amber-400/20 bg-amber-400/10 px-1.5 py-0 text-[8px] font-semibold text-amber-300">
                                  FOUNDER
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 text-right">
                            <span className="text-[11px] text-white/60 font-mono">{fmtStrk(m.stakeAmount)} STRK</span>
                          </td>
                          <td className="py-2.5 text-right hidden sm:table-cell">
                            <div className="inline-flex items-center gap-1.5">
                              <div className="w-12 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-cyan-400/50 to-violet-400/30"
                                  style={{ width: `${parseFloat(weight)}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-white/35 font-mono w-8 text-right">{weight}%</span>
                            </div>
                          </td>
                          <td className="py-2.5 text-right hidden sm:table-cell">
                            <span className="text-[10px] text-white/30">{fmtDate(m.joinedAt)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {guild.memberCount > guild.members.length && (
                <p className="text-[10px] text-white/20 text-center pt-1">
                  Showing {guild.members.length} of {guild.memberCount} members
                </p>
              )}
            </>
          )}

          {(!guild.members || guild.members.length === 0) && guild.memberCount > 0 && (
            <p className="text-[10px] text-white/25 text-center py-3">
              {guild.memberCount} members on-chain (member details not available in this view)
            </p>
          )}
        </div>

        {/* Proposals Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-heading font-bold text-base text-white">Proposals</h2>
            <button aria-label="Create a new proposal" className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-[11px] font-semibold text-white/60 hover:text-white/80 hover:bg-white/[0.08] transition-all">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Create Proposal
            </button>
          </div>

          {!guild.proposals || guild.proposals.length === 0 ? (
            <div className="neo-card p-10 text-center">
              <p className="text-white/35 text-sm">No proposals yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {guild.proposals.map((p) => (
                <ProposalCard key={p.id} proposal={p} />
              ))}
            </div>
          )}
        </div>

        {/* Treasury Overview */}
        <div className="neo-card p-6 space-y-3">
          <h2 className="font-heading font-bold text-base text-white">Treasury</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <p className="text-[9px] uppercase tracking-wider text-white/25">Total Treasury</p>
              <p className="font-heading font-bold text-xl text-white">{fmtStrk(guild.totalStaked)} STRK</p>
            </div>
            <div className="space-y-1">
              <p className="text-[9px] uppercase tracking-wider text-white/25">Governance Model</p>
              <p className="text-[12px] text-white/50">Stake-weighted voting. 1 STRK = 1 vote.</p>
            </div>
            <div className="space-y-1">
              <p className="text-[9px] uppercase tracking-wider text-white/25">Quorum Requirement</p>
              <p className="text-[12px] text-white/50">30% of total staked STRK must participate.</p>
            </div>
          </div>
          <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400/40 via-violet-400/30 to-emerald-400/20"
              style={{ width: "100%" }}
            />
          </div>
          <p className="text-[10px] text-white/20">
            All staked STRK is held on-chain. Withdrawals require a 48-hour unbonding period.
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
