"use client";

import { useState, useEffect } from "react";
import { AGENT_PERSONAS } from "@/lib/agent-personas";
import { STORAGE_KEY, type SerializedSpawnedAgent } from "@/lib/agent-spawner";

interface AgentSpawnerFormProps {
  onClose: () => void;
  onSpawned?: (agent: SerializedSpawnedAgent) => void;
}

const DATA_SOURCES = [
  { id: "polymarket", label: "Polymarket", desc: "Prediction market odds" },
  { id: "coingecko", label: "CoinGecko", desc: "Crypto prices & trends" },
  { id: "news", label: "News", desc: "Headlines & articles" },
  { id: "social", label: "Social", desc: "Trending topics & sentiment" },
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

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          personaId,
          budgetStrk: parseFloat(budgetStrk) || 300,
          maxBetStrk: parseFloat(maxBetStrk) || 10,
          preferredSources: selectedSources,
          sovereign: sovereignMode,
          spawnServer: sovereignMode ? spawnServer : false,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
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
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-white/5">
          <span className="font-heading font-bold text-sm text-white uppercase tracking-wider">
            Deploy Agent
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center border border-white/20 text-white hover:bg-white/10 text-xs font-mono transition-colors rounded-md"
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

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-white/70">
                  <input
                    type="checkbox"
                    checked={sovereignMode}
                    onChange={(e) => setSovereignMode(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Deploy as sovereign child (on-chain wallet + autonomous identity)
                </label>
                <label className="flex items-center gap-2 text-xs text-white/60">
                  <input
                    type="checkbox"
                    checked={spawnServer}
                    disabled={!sovereignMode}
                    onChange={(e) => setSpawnServer(e.target.checked)}
                    className="h-4 w-4 disabled:opacity-40"
                  />
                  Provision dedicated server runtime
                </label>
              </div>

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
                        className={`flex items-center gap-2 px-3 py-2.5 border text-left transition-all rounded-lg ${
                          isSelected
                            ? "border-neo-purple/40 bg-neo-purple/10 shadow-neo-sm"
                            : "border-white/10 hover:border-white/30"
                        }`}
                      >
                        <span
                          className={`w-4 h-4 border flex items-center justify-center text-[9px] font-bold shrink-0 rounded ${
                            isSelected
                              ? "border-neo-purple/40 bg-neo-purple text-white"
                              : "border-white/20"
                          }`}
                        >
                          {isSelected ? "\u2713" : ""}
                        </span>
                        <div className="min-w-0">
                          <span className="font-heading font-bold text-xs block text-white/80">
                            {source.label}
                          </span>
                          <span className="text-[9px] text-white/40">
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
