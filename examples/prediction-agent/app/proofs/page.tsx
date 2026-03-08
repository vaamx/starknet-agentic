"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface ProofVerification {
  verified: boolean;
  executionStatus?: string;
  finalityStatus?: string;
  blockNumber?: number;
  blockHash?: string;
  verifiedAt?: number;
  error?: string;
}

interface ProofAnchor {
  provider: string;
  txId: string;
  gatewayUrl: string;
  dataHash?: string;
  anchoredAt?: number;
}

interface ProofRecord {
  id: string;
  kind: string;
  createdAt: number;
  updatedAt: number;
  chainId?: string;
  txHash?: string;
  explorerUrl?: string;
  agentId?: string;
  agentName?: string;
  walletAddress?: string;
  marketId?: number;
  question?: string;
  reasoningHash?: string;
  payloadHash?: string;
  payload?: string;
  verification?: ProofVerification;
  anchor?: ProofAnchor;
  tags?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function shortHash(hash: string | undefined, len = 14): string {
  if (!hash) return "—";
  if (hash.length <= len + 4) return hash;
  return `${hash.slice(0, len)}...${hash.slice(-4)}`;
}

function formatTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function kindColor(kind: string): string {
  switch (kind) {
    case "prediction":
      return "bg-neo-blue/15 text-neo-blue border-neo-blue/30";
    case "bet":
      return "bg-neo-green/15 text-neo-green border-neo-green/30";
    case "resolution":
      return "bg-neo-purple/15 text-neo-purple border-neo-purple/30";
    case "market_creation":
      return "bg-neo-yellow/15 text-neo-yellow border-neo-yellow/30";
    case "defi_swap":
      return "bg-neo-cyan/15 text-neo-cyan border-neo-cyan/30";
    default:
      return "bg-white/10 text-white/60 border-white/20";
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "prediction":
      return "Forecast";
    case "bet":
      return "Bet";
    case "resolution":
      return "Resolution";
    case "market_creation":
      return "Market";
    case "defi_swap":
      return "DeFi";
    default:
      return kind;
  }
}

/* ------------------------------------------------------------------ */
/*  Proof Detail Drawer                                                  */
/* ------------------------------------------------------------------ */

function ProofDetail({
  proof,
  onClose,
}: {
  proof: ProofRecord;
  onClose: () => void;
}) {
  let parsedPayload: any = null;
  try {
    parsedPayload = proof.payload ? JSON.parse(proof.payload) : null;
  } catch {
    // noop
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-neo-dark border-l border-white/10 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-neo-dark/95 backdrop-blur-md border-b border-white/[0.07] px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${kindColor(
                proof.kind
              )}`}
            >
              {kindLabel(proof.kind)}
            </span>
            <span className="text-xs text-white/40 font-mono">
              {shortHash(proof.id, 20)}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors"
          >
            <svg
              className="w-4 h-4"
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

        <div className="p-6 space-y-5">
          {/* Timestamp */}
          <div>
            <p className="text-[10px] text-white/30 uppercase tracking-wider font-mono mb-1">
              Recorded
            </p>
            <p className="text-sm text-white/80 font-mono">
              {formatTime(proof.createdAt)}
            </p>
          </div>

          {/* Market context */}
          {proof.question && (
            <div>
              <p className="text-[10px] text-white/30 uppercase tracking-wider font-mono mb-1">
                Market
              </p>
              <p className="text-sm text-white/80">{proof.question}</p>
              {proof.marketId !== undefined && (
                <Link
                  href={`/market/${proof.marketId}`}
                  className="text-xs text-neo-brand hover:underline mt-1 inline-block"
                >
                  View Market #{proof.marketId}
                </Link>
              )}
            </div>
          )}

          {/* Reasoning Hash */}
          {proof.reasoningHash && (
            <div>
              <p className="text-[10px] text-white/30 uppercase tracking-wider font-mono mb-1">
                Reasoning Hash (SHA-256)
              </p>
              <p className="text-xs text-white/60 font-mono break-all bg-white/[0.03] rounded-lg px-3 py-2">
                {proof.reasoningHash}
              </p>
            </div>
          )}

          {/* Payload Hash */}
          {proof.payloadHash && (
            <div>
              <p className="text-[10px] text-white/30 uppercase tracking-wider font-mono mb-1">
                Payload Hash
              </p>
              <p className="text-xs text-white/60 font-mono break-all">
                {proof.payloadHash}
              </p>
            </div>
          )}

          {/* On-Chain Verification */}
          <div>
            <p className="text-[10px] text-white/30 uppercase tracking-wider font-mono mb-2">
              On-Chain Verification
            </p>
            {proof.txHash ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      proof.verification?.verified
                        ? "bg-neo-green"
                        : "bg-neo-orange"
                    }`}
                  />
                  <span className="text-xs text-white/60">
                    {proof.verification?.verified
                      ? "Verified on Starknet"
                      : "Pending verification"}
                  </span>
                </div>
                <div className="text-xs font-mono text-white/50 space-y-1">
                  <p>
                    TX:{" "}
                    {proof.explorerUrl ? (
                      <a
                        href={proof.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-neo-brand hover:underline"
                      >
                        {shortHash(proof.txHash, 18)}
                      </a>
                    ) : (
                      shortHash(proof.txHash, 18)
                    )}
                  </p>
                  {proof.verification?.blockNumber && (
                    <p>Block: {proof.verification.blockNumber}</p>
                  )}
                  {proof.verification?.executionStatus && (
                    <p>Execution: {proof.verification.executionStatus}</p>
                  )}
                  {proof.verification?.finalityStatus && (
                    <p>Finality: {proof.verification.finalityStatus}</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-white/40">No transaction hash</p>
            )}
          </div>

          {/* Arweave Anchor */}
          <div>
            <p className="text-[10px] text-white/30 uppercase tracking-wider font-mono mb-2">
              Permanent Anchor
            </p>
            {proof.anchor ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-neo-cyan" />
                  <span className="text-xs text-white/60">
                    Anchored to Arweave
                  </span>
                </div>
                <p className="text-xs font-mono text-white/50">
                  TX:{" "}
                  <a
                    href={proof.anchor.gatewayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-neo-brand hover:underline"
                  >
                    {shortHash(proof.anchor.txId, 18)}
                  </a>
                </p>
              </div>
            ) : (
              <p className="text-xs text-white/40">Not anchored</p>
            )}
          </div>

          {/* Agent */}
          {(proof.agentName || proof.agentId) && (
            <div>
              <p className="text-[10px] text-white/30 uppercase tracking-wider font-mono mb-1">
                Agent
              </p>
              <p className="text-sm text-white/70">
                {proof.agentName ?? shortHash(proof.agentId, 12)}
              </p>
            </div>
          )}

          {/* Payload */}
          {parsedPayload && (
            <div>
              <p className="text-[10px] text-white/30 uppercase tracking-wider font-mono mb-1">
                Action Payload
              </p>
              <pre className="text-[11px] text-white/50 font-mono bg-white/[0.03] rounded-lg px-3 py-2 overflow-x-auto max-h-48">
                {JSON.stringify(parsedPayload, null, 2)}
              </pre>
            </div>
          )}

          {/* Tags */}
          {proof.tags && Object.keys(proof.tags).length > 0 && (
            <div>
              <p className="text-[10px] text-white/30 uppercase tracking-wider font-mono mb-1">
                Tags
              </p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(proof.tags).map(([k, v]) => (
                  <span
                    key={k}
                    className="px-2 py-0.5 rounded bg-white/[0.04] text-[10px] font-mono text-white/40"
                  >
                    {k}={v.length > 20 ? shortHash(v, 16) : v}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stats Row                                                           */
/* ------------------------------------------------------------------ */

function StatCard({
  label,
  value,
  sub,
  color = "text-white",
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="neo-card px-5 py-4">
      <p className="text-[10px] uppercase tracking-wider text-white/35 font-mono mb-1">
        {label}
      </p>
      <p className={`text-2xl font-heading font-bold tabular-nums ${color}`}>
        {value}
      </p>
      {sub && (
        <p className="text-[11px] text-white/40 mt-0.5 font-mono">{sub}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function ProofsPage() {
  const [proofs, setProofs] = useState<ProofRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProof, setSelectedProof] = useState<ProofRecord | null>(null);
  const [kindFilter, setKindFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/proofs?limit=200");
        if (!res.ok) throw new Error("Failed to fetch proofs");
        const data = await res.json();
        if (!cancelled) {
          setProofs(Array.isArray(data.proofs) ? data.proofs : []);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    }
    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const kinds = useMemo(() => {
    const set = new Set(proofs.map((p) => p.kind));
    return ["all", ...Array.from(set).sort()];
  }, [proofs]);

  const filtered = useMemo(() => {
    if (kindFilter === "all") return proofs;
    return proofs.filter((p) => p.kind === kindFilter);
  }, [proofs, kindFilter]);

  const stats = useMemo(() => {
    const verified = proofs.filter((p) => p.verification?.verified).length;
    const anchored = proofs.filter((p) => !!p.anchor?.txId).length;
    const withHuginn = proofs.filter((p) => !!p.reasoningHash).length;
    return { total: proofs.length, verified, anchored, withHuginn };
  }, [proofs]);

  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-cream">
        {/* Hero */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-neo-purple/[0.03] to-transparent pointer-events-none" />
          <div className="max-w-6xl mx-auto px-4 pt-24 pb-10">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-neo-purple/10 border border-neo-purple/20 flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-neo-purple"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
              </div>
              <h1 className="text-3xl font-heading font-bold text-white">
                Proof Trail
              </h1>
            </div>
            <p className="text-sm text-white/50 max-w-xl">
              Verifiable provenance for every agent action. Reasoning hashes
              logged to the Huginn Registry on Starknet, with optional Arweave
              permanence anchoring.
            </p>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 pb-20 space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Total Proofs"
              value={String(stats.total)}
              color="text-white"
            />
            <StatCard
              label="On-Chain Verified"
              value={String(stats.verified)}
              sub={
                stats.total > 0
                  ? `${((stats.verified / stats.total) * 100).toFixed(0)}%`
                  : "—"
              }
              color="text-neo-green"
            />
            <StatCard
              label="Arweave Anchored"
              value={String(stats.anchored)}
              sub="permanent storage"
              color="text-neo-cyan"
            />
            <StatCard
              label="Huginn Hashed"
              value={String(stats.withHuginn)}
              sub="reasoning provenance"
              color="text-neo-purple"
            />
          </div>

          {/* How It Works */}
          <div className="neo-card p-5">
            <h2 className="font-heading font-bold text-sm text-white mb-3">
              Provenance Pipeline
            </h2>
            <div className="flex flex-col md:flex-row gap-3">
              {[
                {
                  step: "1",
                  title: "Reasoning",
                  desc: "Agent generates forecast reasoning via LLM",
                  color: "neo-blue",
                },
                {
                  step: "2",
                  title: "SHA-256 Hash",
                  desc: "Reasoning text hashed client-side (Web Crypto)",
                  color: "neo-purple",
                },
                {
                  step: "3",
                  title: "Huginn Registry",
                  desc: "Hash logged to Starknet via log_thought(u256)",
                  color: "neo-brand",
                },
                {
                  step: "4",
                  title: "Arweave Anchor",
                  desc: "Full payload anchored for permanent verifiability",
                  color: "neo-cyan",
                },
              ].map((s) => (
                <div
                  key={s.step}
                  className="flex-1 bg-white/[0.02] rounded-xl px-4 py-3 border border-white/[0.06]"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className={`w-5 h-5 rounded-md bg-${s.color}/15 text-${s.color} text-[10px] font-bold flex items-center justify-center`}
                    >
                      {s.step}
                    </span>
                    <span className="text-xs font-heading font-semibold text-white/80">
                      {s.title}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/40">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Filter + Table */}
          <div className="neo-card overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.07] bg-white/[0.02] flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-heading font-bold text-sm text-white">
                Proof Records
              </h2>
              <div className="flex gap-1">
                {kinds.map((k) => (
                  <button
                    key={k}
                    onClick={() => setKindFilter(k)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-mono transition-colors ${
                      kindFilter === k
                        ? "bg-neo-brand/15 text-neo-brand border border-neo-brand/30"
                        : "text-white/40 hover:text-white/60 border border-transparent"
                    }`}
                  >
                    {k === "all" ? "All" : kindLabel(k)}
                  </button>
                ))}
              </div>
            </div>

            {error ? (
              <div className="px-5 py-8 text-center text-sm text-neo-pink">
                {error}
              </div>
            ) : loading ? (
              <div className="px-5 py-8 text-center text-sm text-white/30">
                Loading proof records...
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-white/40">
                {kindFilter !== "all"
                  ? `No ${kindLabel(kindFilter).toLowerCase()} proofs found.`
                  : "No proof records yet. Once the agent loop runs and logs actions, provenance data will appear here."}
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {/* Header */}
                <div className="hidden md:grid grid-cols-[5rem_1fr_8rem_7rem_6rem_5rem] gap-3 px-5 py-2 text-[10px] font-mono uppercase tracking-wider text-white/25">
                  <span>Type</span>
                  <span>Context</span>
                  <span>Hash</span>
                  <span>TX</span>
                  <span>Status</span>
                  <span>Time</span>
                </div>

                {filtered.map((proof) => (
                  <button
                    key={proof.id}
                    onClick={() => setSelectedProof(proof)}
                    className="w-full grid grid-cols-1 md:grid-cols-[5rem_1fr_8rem_7rem_6rem_5rem] gap-1 md:gap-3 px-5 py-3.5 items-center text-left transition-colors hover:bg-white/[0.03]"
                  >
                    {/* Kind */}
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-[10px] font-mono font-bold border w-fit ${kindColor(
                        proof.kind
                      )}`}
                    >
                      {kindLabel(proof.kind)}
                    </span>

                    {/* Context */}
                    <div className="min-w-0">
                      {proof.question ? (
                        <p className="text-xs text-white/70 truncate">
                          {proof.question}
                        </p>
                      ) : (
                        <p className="text-xs text-white/30 font-mono">
                          {shortHash(proof.id, 24)}
                        </p>
                      )}
                      {proof.agentName && (
                        <p className="text-[10px] text-white/30 mt-0.5">
                          {proof.agentName}
                        </p>
                      )}
                    </div>

                    {/* Reasoning Hash */}
                    <span className="font-mono text-[10px] text-white/35 truncate hidden md:block">
                      {proof.reasoningHash
                        ? shortHash(proof.reasoningHash, 12)
                        : "—"}
                    </span>

                    {/* TX */}
                    <span className="font-mono text-[10px] text-white/35 truncate hidden md:block">
                      {proof.txHash ? shortHash(proof.txHash, 10) : "—"}
                    </span>

                    {/* Status icons */}
                    <div className="flex items-center gap-1.5 hidden md:flex">
                      {/* Chain verified */}
                      <span
                        className={`w-2 h-2 rounded-full ${
                          proof.verification?.verified
                            ? "bg-neo-green"
                            : proof.txHash
                              ? "bg-neo-orange"
                              : "bg-white/10"
                        }`}
                        title={
                          proof.verification?.verified
                            ? "On-chain verified"
                            : "Unverified"
                        }
                      />
                      {/* Arweave */}
                      <span
                        className={`w-2 h-2 rounded-full ${
                          proof.anchor?.txId
                            ? "bg-neo-cyan"
                            : "bg-white/10"
                        }`}
                        title={
                          proof.anchor?.txId
                            ? "Arweave anchored"
                            : "Not anchored"
                        }
                      />
                      {/* Huginn */}
                      <span
                        className={`w-2 h-2 rounded-full ${
                          proof.reasoningHash
                            ? "bg-neo-purple"
                            : "bg-white/10"
                        }`}
                        title={
                          proof.reasoningHash
                            ? "Huginn hashed"
                            : "No reasoning hash"
                        }
                      />
                    </div>

                    {/* Time */}
                    <span className="font-mono text-[10px] text-white/30 hidden md:block">
                      {new Date(proof.createdAt)
                        .toISOString()
                        .slice(5, 16)
                        .replace("T", " ")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />

      {/* Detail Drawer */}
      {selectedProof && (
        <ProofDetail
          proof={selectedProof}
          onClose={() => setSelectedProof(null)}
        />
      )}
    </>
  );
}
