"use client";

import { useState, useEffect } from "react";
import { AGENT_PERSONAS } from "@/lib/agent-personas";
import { STORAGE_KEY, type SerializedSpawnedAgent } from "@/lib/agent-spawner";

interface AgentSpawnerFormProps {
  onClose: () => void;
  onSpawned?: (agent: SerializedSpawnedAgent) => void;
}

const DATA_SOURCES = [
  { id: "polymarket", label: "Polymarket", desc: "Prediction market odds", color: "#8b5cf6" },
  { id: "coingecko", label: "CoinGecko", desc: "Crypto prices & trends", color: "#f59e0b" },
  { id: "news", label: "News", desc: "Headlines & articles", color: "#3b82f6" },
  { id: "social", label: "Social", desc: "Trending topics & sentiment", color: "#ec4899" },
];

export default function AgentSpawnerForm({
  onClose,
  onSpawned,
}: AgentSpawnerFormProps) {
  const [name, setName] = useState("");
  const [personaId, setPersonaId] = useState("alpha");
  const [budgetStrk, setBudgetStrk] = useState("300");
  const [maxBetStrk, setMaxBetStrk] = useState("10");
  const [sovereignMode, setSovereignMode] = useState(true);
  const [useByoWallet, setUseByoWallet] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [walletPrivateKey, setWalletPrivateKey] = useState("");
  const [walletAgentId, setWalletAgentId] = useState("");
  const [spawnServer, setSpawnServer] = useState(true);
  const [selectedSources, setSelectedSources] = useState<string[]>([
    "polymarket",
    "coingecko",
    "news",
    "social",
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [spawnedName, setSpawnedName] = useState("");

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const toggleSource = (id: string) => {
    setSelectedSources((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleSubmit = async () => {
    if (!name.trim() || name.length < 2) {
      setError("Agent name must be at least 2 characters");
      return;
    }

    if (useByoWallet && !walletAddress.trim()) {
      setError("BYO wallet mode requires a wallet address");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        personaId,
        budgetStrk: parseFloat(budgetStrk) || 300,
        maxBetStrk: parseFloat(maxBetStrk) || 10,
        preferredSources: selectedSources,
      };

      if (useByoWallet) {
        body.sovereign = false;
        body.spawnServer = spawnServer;
        body.walletAddress = walletAddress.trim();
        if (walletPrivateKey.trim()) {
          body.walletPrivateKey = walletPrivateKey.trim();
        }
        if (walletAgentId.trim()) {
          body.walletAgentId = walletAgentId.trim();
        }
      } else {
        body.sovereign = sovereignMode;
        body.spawnServer = sovereignMode ? spawnServer : false;
      }

      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setError("Wallet signature required. Use Connect User Wallet -> Verify Signature.");
          return;
        }
        setError(data.error ?? "Failed to spawn agent");
        return;
      }

      // Save to localStorage for persistence across page reloads
      const serialized: SerializedSpawnedAgent = {
        id: data.agent.id,
        name: data.agent.name,
        personaId: data.agent.personaId,
        agentType: data.agent.agentType,
        model: data.agent.model,
        preferredSources: data.agent.preferredSources ?? selectedSources,
        budgetStrk: parseFloat(budgetStrk) || 300,
        maxBetStrk: parseFloat(maxBetStrk) || 10,
        createdAt: data.agent.createdAt ?? Date.now(),
        status: "running",
        walletAddress: data.agent.walletAddress,
        keyRef: data.agent.keyRef,
        keyCustodyProvider: data.agent.keyCustodyProvider,
        agentId: data.agent.agentId,
        runtime: data.agent.runtime
          ? {
              provider: data.agent.runtime.provider,
              machineId: data.agent.runtime.machineId,
              flyMachineId: data.agent.runtime.flyMachineId,
              tier: data.agent.runtime.tier,
              region: data.agent.runtime.region,
              preferredRegions: data.agent.runtime.preferredRegions,
              regionFailureLog: data.agent.runtime.regionFailureLog,
              status: data.agent.runtime.status,
              createdAt: data.agent.runtime.createdAt,
              lastHeartbeatAt: data.agent.runtime.lastHeartbeatAt ?? null,
              consecutiveHeartbeatFailures:
                data.agent.runtime.consecutiveHeartbeatFailures,
              failoverCount: data.agent.runtime.failoverCount,
              lastFailoverAt: data.agent.runtime.lastFailoverAt ?? null,
              depositTxHash: data.agent.runtime.depositTxHash,
              lastError: data.agent.runtime.lastError,
              schedulerMode: data.agent.runtime.schedulerMode,
            }
          : undefined,
      };

      try {
        const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        existing.push(serialized);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
      } catch {
        // localStorage unavailable, agent still works for this session
      }

      setSpawnedName(name);
      setSuccess(true);
      onSpawned?.(serialized);
      setTimeout(() => onClose(), 1800);
    } catch (err: any) {
      setError(err.message ?? "Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md mx-4 neo-card shadow-neo-lg animate-modal-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.07] bg-white/[0.03]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-neo-green/10 border border-neo-green/20 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-neo-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
              </svg>
            </div>
            <span className="font-heading font-bold text-sm text-white">
              Deploy Agent
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-white/15 text-white/50 hover:bg-white/[0.08] hover:text-white/80 text-xs font-mono transition-colors"
          >
            ESC
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {success ? (
            <div className="py-10 text-center">
              <div className="w-14 h-14 mx-auto mb-4 bg-neo-green/20 border border-neo-green/30 flex items-center justify-center shadow-neo-sm rounded-xl">
                <span className="text-2xl text-neo-green font-black">OK</span>
              </div>
              <p className="font-heading font-bold text-lg">
                Agent &ldquo;{spawnedName}&rdquo; deployed!
              </p>
              <p className="text-xs text-white/50 mt-1.5 font-mono">
                Saved locally. It will persist across page reloads.
              </p>
            </div>
          ) : (
            <>
              {/* Name */}
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-white/40 mb-1.5">
                  Agent Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="My Superforecaster"
                  autoFocus
                  className="neo-input w-full"
                />
              </div>

              {/* Persona */}
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-white/40 mb-1.5">
                  Base Persona
                </label>
                <select
                  value={personaId}
                  onChange={(e) => setPersonaId(e.target.value)}
                  className="neo-input w-full"
                >
                  {AGENT_PERSONAS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.agentType})
                    </option>
                  ))}
                  <option value="custom">Custom (default settings)</option>
                </select>
              </div>

              {/* Budget */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-[10px] font-mono uppercase tracking-wider text-white/40 mb-1.5">
                    Budget (STRK)
                  </label>
                  <input
                    type="number"
                    value={budgetStrk}
                    onChange={(e) => setBudgetStrk(e.target.value)}
                    className="neo-input w-full"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] font-mono uppercase tracking-wider text-white/40 mb-1.5">
                    Max Bet (STRK)
                  </label>
                  <input
                    type="number"
                    value={maxBetStrk}
                    onChange={(e) => setMaxBetStrk(e.target.value)}
                    className="neo-input w-full"
                  />
                </div>
              </div>

              <div className="space-y-2.5 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                <button
                  type="button"
                  onClick={() => setUseByoWallet(!useByoWallet)}
                  className="w-full flex items-center justify-between gap-2 text-xs text-white/70"
                >
                  <span>Register BYO wallet (existing agent account)</span>
                  <span className={`w-8 h-4.5 rounded-full p-0.5 transition-colors ${useByoWallet ? "bg-neo-brand" : "bg-white/15"}`}>
                    <span className={`block w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${useByoWallet ? "translate-x-3.5" : ""}`} />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => !useByoWallet && setSovereignMode(!sovereignMode)}
                  className={`w-full flex items-center justify-between gap-2 text-xs ${useByoWallet ? "text-white/30" : "text-white/70"}`}
                >
                  <span>Deploy as sovereign child (on-chain wallet + identity)</span>
                  <span className={`w-8 h-4.5 rounded-full p-0.5 transition-colors ${sovereignMode && !useByoWallet ? "bg-neo-green" : "bg-white/15"}`}>
                    <span className={`block w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${sovereignMode && !useByoWallet ? "translate-x-3.5" : ""}`} />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => sovereignMode && setSpawnServer(!spawnServer)}
                  className={`w-full flex items-center justify-between gap-2 text-xs ${!sovereignMode ? "text-white/30" : "text-white/60"}`}
                >
                  <span>Provision dedicated server runtime</span>
                  <span className={`w-8 h-4.5 rounded-full p-0.5 transition-colors ${spawnServer && sovereignMode ? "bg-neo-blue" : "bg-white/15"}`}>
                    <span className={`block w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${spawnServer && sovereignMode ? "translate-x-3.5" : ""}`} />
                  </span>
                </button>
              </div>

              {useByoWallet && (
                <div className="space-y-2 border border-white/10 rounded-lg p-3 bg-white/5">
                  <div>
                    <label className="block text-[10px] font-mono uppercase tracking-wider text-white/40 mb-1.5">
                      Wallet Address
                    </label>
                    <input
                      type="text"
                      value={walletAddress}
                      onChange={(e) => setWalletAddress(e.target.value)}
                      placeholder="0x..."
                      className="neo-input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono uppercase tracking-wider text-white/40 mb-1.5">
                      Wallet Private Key (optional)
                    </label>
                    <input
                      type="password"
                      value={walletPrivateKey}
                      onChange={(e) => setWalletPrivateKey(e.target.value)}
                      placeholder="0x..."
                      className="neo-input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono uppercase tracking-wider text-white/40 mb-1.5">
                      ERC-8004 Agent ID (optional)
                    </label>
                    <input
                      type="text"
                      value={walletAgentId}
                      onChange={(e) => setWalletAgentId(e.target.value)}
                      placeholder="123"
                      className="neo-input w-full"
                    />
                  </div>
                  <p className="text-[10px] text-white/40">
                    If private key is omitted, the agent can forecast but cannot sign bets.
                  </p>
                </div>
              )}

              {/* Data Sources */}
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-white/40 mb-2">
                  Data Sources
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {DATA_SOURCES.map((source) => {
                    const isSelected = selectedSources.includes(source.id);
                    return (
                      <button
                        key={source.id}
                        onClick={() => toggleSource(source.id)}
                        className={`flex items-center gap-2.5 px-3 py-2.5 border text-left transition-all rounded-lg ${
                          isSelected
                            ? "border-white/15 bg-white/[0.06]"
                            : "border-white/[0.06] bg-white/[0.02] hover:border-white/15"
                        }`}
                      >
                        <span
                          className={`w-4 h-4 border flex items-center justify-center text-[9px] font-bold shrink-0 rounded-sm transition-all ${
                            isSelected
                              ? "border-transparent text-white"
                              : "border-white/20"
                          }`}
                          style={isSelected ? { backgroundColor: source.color } : undefined}
                        >
                          {isSelected ? "\u2713" : ""}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: source.color }} />
                            <span className="font-heading font-bold text-xs text-white/80">
                              {source.label}
                            </span>
                          </div>
                          <span className="text-[9px] text-white/35 ml-3">
                            {source.desc}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="text-[10px] text-white/30">
                Recommended max bet for testnet: 5–10 STRK.
              </p>

              {error && (
                <div className="bg-neo-pink/10 border border-neo-pink/30 px-3 py-2.5 text-xs text-neo-pink font-mono rounded-lg">
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className={`w-full neo-btn-primary py-3 font-bold text-sm ${
                  submitting ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                {submitting ? "Deploying..." : "Deploy Agent"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
