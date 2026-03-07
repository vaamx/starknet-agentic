"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import TamagotchiLoader from "@/components/TamagotchiLoader";

interface SoukAgent {
  agentId: number;
  name: string;
  agentType: string;
  model: string;
  status: string;
  capabilities: string;
  framework: string;
  a2aEndpoint: string;
  walletAddress: string;
  reputationScore: number;
  feedbackCount: number;
}

const STATUS_COLORS: Record<string, { dot: string; text: string }> = {
  active: { dot: "bg-emerald-400", text: "text-emerald-300" },
  inactive: { dot: "bg-white/30", text: "text-white/40" },
  suspended: { dot: "bg-red-400", text: "text-red-300" },
};

export default function AgentSoukDetail() {
  const params = useParams();
  const agentId = params?.agentId as string;
  const [agent, setAgent] = useState<SoukAgent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgent = useCallback(async () => {
    if (!agentId) return;
    try {
      const res = await fetch(`/api/souk/agents/${agentId}`);
      if (!res.ok) {
        setError(res.status === 404 ? "Agent not found" : "Failed to load agent");
        return;
      }
      const data = await res.json();
      setAgent(data.agent);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchAgent();
  }, [fetchAgent]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
        <SiteHeader />
        <div className="flex-1 flex items-center justify-center">
          <TamagotchiLoader />
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
        <SiteHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <p className="text-white/50">{error ?? "Agent not found"}</p>
            <Link href="/souk" className="neo-btn-secondary text-xs">Back to AgentSouk</Link>
          </div>
        </div>
      </div>
    );
  }

  const sc = STATUS_COLORS[agent.status] ?? STATUS_COLORS.inactive;
  const capabilities = agent.capabilities
    ? agent.capabilities.split(",").map((c) => c.trim()).filter(Boolean)
    : [];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <SiteHeader />

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-white/30">
          <Link href="/souk" className="hover:text-white/50 transition-colors">AgentSouk</Link>
          <span>/</span>
          <span className="text-white/60">{agent.name}</span>
        </nav>

        {/* Hero card */}
        <div className="neo-card p-6 space-y-5">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-white/[0.1] to-white/[0.03] border border-white/[0.1] flex items-center justify-center shrink-0">
              <span className="font-heading font-bold text-2xl text-white/50">
                {agent.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="font-heading text-2xl font-bold text-white">{agent.name}</h1>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold capitalize text-white/50">
                  {agent.agentType}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className={`w-2 h-2 rounded-full ${sc.dot}`} />
                <span className={`text-xs capitalize ${sc.text}`}>{agent.status}</span>
                <span className="text-white/15 text-xs">|</span>
                <span className="text-xs text-white/30 font-mono">ID #{agent.agentId}</span>
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">Reputation</p>
              <p className="font-mono font-bold text-xl text-amber-300">{agent.reputationScore}</p>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">Reviews</p>
              <p className="font-mono font-bold text-xl text-white/70">{agent.feedbackCount}</p>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">Model</p>
              <p className="font-mono text-xs text-white/50 truncate">{agent.model}</p>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">Framework</p>
              <p className="text-xs text-white/50 truncate">{agent.framework || "N/A"}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Identity */}
          <div className="neo-card p-5 space-y-3">
            <h2 className="font-heading font-bold text-sm text-white">On-Chain Identity</h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-white/[0.04]">
                <span className="text-white/35">Wallet</span>
                <a
                  href={`https://sepolia.voyager.online/contract/${agent.walletAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-sky-400/70 hover:text-sky-300 transition-colors"
                >
                  {agent.walletAddress.slice(0, 10)}...{agent.walletAddress.slice(-6)}
                </a>
              </div>
              <div className="flex justify-between py-1.5 border-b border-white/[0.04]">
                <span className="text-white/35">Registry</span>
                <span className="text-white/50">ERC-8004 IdentityRegistry</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-white/[0.04]">
                <span className="text-white/35">Chain</span>
                <span className="text-white/50">Starknet Sepolia</span>
              </div>
              {agent.a2aEndpoint && (
                <div className="flex justify-between py-1.5 border-b border-white/[0.04]">
                  <span className="text-white/35">A2A Endpoint</span>
                  <a
                    href={agent.a2aEndpoint}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sky-400/70 hover:text-sky-300 transition-colors truncate max-w-[200px]"
                  >
                    {agent.a2aEndpoint}
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Capabilities */}
          <div className="neo-card p-5 space-y-3">
            <h2 className="font-heading font-bold text-sm text-white">Capabilities</h2>
            {capabilities.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[11px] text-white/55 font-medium"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-white/30">No capabilities registered on-chain.</p>
            )}

            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 mt-2">
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5">Reputation Summary</p>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400/60 to-amber-300/80 transition-all"
                    style={{ width: `${Math.min(100, agent.reputationScore)}%` }}
                  />
                </div>
                <span className="font-mono text-sm font-bold text-amber-300/80">{agent.reputationScore}/100</span>
              </div>
              <p className="text-[10px] text-white/25 mt-1.5">
                Based on {agent.feedbackCount} on-chain feedback submissions via ReputationRegistry.
              </p>
            </div>
          </div>
        </div>

        {/* Back */}
        <div className="pt-2">
          <Link href="/souk" className="text-xs text-white/30 hover:text-white/50 transition-colors">
            &larr; Back to AgentSouk
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}
