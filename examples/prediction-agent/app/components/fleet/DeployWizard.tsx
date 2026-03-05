"use client";

import { useState } from "react";
import PersonaCard, { type PersonaInfo } from "./PersonaCard";

// Mirror of AGENT_PERSONAS — kept client-side to avoid importing server module
const PERSONAS: PersonaInfo[] = [
  {
    id: "alpha",
    name: "AlphaForecaster",
    agentType: "superforecaster",
    biasFactor: 0.0,
    confidence: 0.8,
    preferredSources: ["polymarket", "coingecko", "news", "web", "social", "onchain", "rss"],
  },
  {
    id: "beta",
    name: "BetaAnalyst",
    agentType: "quant-forecaster",
    biasFactor: -0.05,
    confidence: 0.9,
    preferredSources: ["coingecko", "polymarket", "onchain", "github"],
  },
  {
    id: "gamma",
    name: "GammaTrader",
    agentType: "market-maker",
    biasFactor: 0.05,
    confidence: 0.85,
    preferredSources: ["polymarket", "social", "rss"],
  },
  {
    id: "delta",
    name: "DeltaScout",
    agentType: "data-analyst",
    biasFactor: 0.0,
    confidence: 0.7,
    preferredSources: ["news", "web", "social", "github", "onchain"],
  },
  {
    id: "epsilon",
    name: "EpsilonOracle",
    agentType: "news-analyst",
    biasFactor: 0.03,
    confidence: 0.75,
    preferredSources: ["news", "web", "polymarket", "rss"],
  },
];

const ALL_SOURCES = [
  "polymarket",
  "coingecko",
  "news",
  "web",
  "social",
  "onchain",
  "github",
  "rss",
] as const;

const SESSION_DURATIONS = [
  { label: "1 day", value: "1d" },
  { label: "1 week", value: "1w" },
  { label: "1 month", value: "1m" },
] as const;

type Step = 1 | 2 | 3;

interface DeployWizardProps {
  open: boolean;
  onClose: () => void;
  onDeployed: () => void;
}

export default function DeployWizard({
  open,
  onClose,
  onDeployed,
}: DeployWizardProps) {
  const [step, setStep] = useState<Step>(1);

  // Step 1: persona selection
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [isCustom, setIsCustom] = useState(false);

  // Step 2: config
  const [name, setName] = useState("");
  const [budgetStrk, setBudgetStrk] = useState(300);
  const [maxBetStrk, setMaxBetStrk] = useState(10);
  const [sources, setSources] = useState<string[]>([
    "polymarket",
    "coingecko",
    "news",
    "social",
  ]);
  const [sessionDuration, setSessionDuration] = useState("1w");

  // Step 3: deploy
  const [deploying, setDeploying] = useState(false);
  const [deployStep, setDeployStep] = useState(0);
  const [deployResult, setDeployResult] = useState<{
    agentId: string;
    walletAddress?: string;
    txHash?: string;
  } | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);

  function reset() {
    setStep(1);
    setSelectedPersona(null);
    setIsCustom(false);
    setName("");
    setBudgetStrk(300);
    setMaxBetStrk(10);
    setSources(["polymarket", "coingecko", "news", "social"]);
    setSessionDuration("1w");
    setDeploying(false);
    setDeployStep(0);
    setDeployResult(null);
    setDeployError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function selectPersona(id: string) {
    setSelectedPersona(id);
    setIsCustom(false);
    const p = PERSONAS.find((p) => p.id === id);
    if (p) {
      setName(p.name + " Jr.");
      setSources([...p.preferredSources]);
    }
  }

  function selectCustom() {
    setSelectedPersona(null);
    setIsCustom(true);
    setName("");
    setSources(["polymarket", "coingecko", "news", "social"]);
  }

  function toggleSource(src: string) {
    setSources((prev) =>
      prev.includes(src) ? prev.filter((s) => s !== src) : [...prev, src]
    );
  }

  async function handleDeploy() {
    setDeploying(true);
    setDeployError(null);
    setDeployStep(1);

    try {
      // Call the existing /api/agents endpoint which handles spawning
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim() || "Custom Agent",
          personaId: selectedPersona ?? undefined,
          budgetStrk,
          maxBetStrk,
          preferredSources: sources,
        }),
      });

      setDeployStep(2);
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            "Wallet signature required. Use Connect User Wallet -> Verify Signature."
          );
        }
        throw new Error(data.error ?? "Deploy failed");
      }

      setDeployStep(3);

      // Brief pause for UX
      await new Promise((r) => setTimeout(r, 600));
      setDeployStep(4);

      setDeployResult({
        agentId: data.id ?? data.agent?.id ?? "unknown",
        walletAddress: data.walletAddress ?? data.agent?.walletAddress,
        txHash: data.txHash ?? data.agent?.txHash,
      });
    } catch (err: any) {
      setDeployError(err.message ?? "Unknown error");
    } finally {
      setDeploying(false);
    }
  }

  if (!open) return null;

  const DEPLOY_STEPS = [
    "Preparing agent configuration...",
    "Registering agent in swarm...",
    "Configuring data sources...",
    "Activating in fleet rotation...",
    "Done!",
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0d111c] shadow-2xl animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3">
          <div>
            <h2 className="font-heading text-sm font-bold text-white">
              Deploy Agent
            </h2>
            <p className="text-[10px] text-muted">
              Step {step} of 3 &mdash;{" "}
              {step === 1
                ? "Choose Persona"
                : step === 2
                  ? "Configure"
                  : "Deploy"}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="rounded p-1 text-muted hover:bg-white/[0.05] hover:text-white"
          >
            &#x2715;
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-1 px-5 py-2">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full ${
                s <= step ? "bg-neo-brand" : "bg-white/[0.08]"
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Step 1: Choose Persona */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-xs text-muted">
                Select a persona template or create a custom agent.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {PERSONAS.map((p) => (
                  <PersonaCard
                    key={p.id}
                    persona={p}
                    selected={selectedPersona === p.id}
                    onClick={() => selectPersona(p.id)}
                  />
                ))}
                {/* Custom card */}
                <button
                  onClick={selectCustom}
                  className={`w-full rounded-xl border p-3 text-left transition-all ${
                    isCustom
                      ? "border-neo-brand/50 bg-neo-brand/10"
                      : "border-dashed border-white/[0.1] bg-white/[0.02] hover:border-white/[0.15]"
                  }`}
                >
                  <h4 className="font-heading text-xs font-bold text-white">
                    Custom Agent
                  </h4>
                  <p className="text-[10px] text-muted">
                    Build from scratch with custom parameters
                  </p>
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Configure */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">
                  Agent Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter agent name"
                  className="neo-input w-full text-xs"
                />
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">
                  Budget: {budgetStrk} STRK
                </label>
                <input
                  type="range"
                  min={10}
                  max={2000}
                  step={10}
                  value={budgetStrk}
                  onChange={(e) => setBudgetStrk(Number(e.target.value))}
                  className="w-full accent-[var(--accent)]"
                />
                <div className="flex justify-between text-[9px] text-muted">
                  <span>10</span>
                  <span>2,000 STRK</span>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">
                  Max Bet: {maxBetStrk} STRK
                </label>
                <input
                  type="range"
                  min={1}
                  max={100}
                  step={1}
                  value={maxBetStrk}
                  onChange={(e) => setMaxBetStrk(Number(e.target.value))}
                  className="w-full accent-[var(--accent)]"
                />
                <div className="flex justify-between text-[9px] text-muted">
                  <span>1</span>
                  <span>100 STRK</span>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">
                  Data Sources
                </label>
                <div className="flex flex-wrap gap-1">
                  {ALL_SOURCES.map((src) => (
                    <button
                      key={src}
                      onClick={() => toggleSource(src)}
                      className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                        sources.includes(src)
                          ? "bg-neo-brand/20 text-neo-brand"
                          : "bg-white/[0.04] text-muted hover:bg-white/[0.08]"
                      }`}
                    >
                      {src}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">
                  Session Key Duration
                </label>
                <div className="flex gap-2">
                  {SESSION_DURATIONS.map((d) => (
                    <button
                      key={d.value}
                      onClick={() => setSessionDuration(d.value)}
                      className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors ${
                        sessionDuration === d.value
                          ? "bg-neo-brand/20 text-neo-brand"
                          : "bg-white/[0.04] text-muted hover:bg-white/[0.08]"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Deploy */}
          {step === 3 && (
            <div className="space-y-4">
              {!deployResult && !deployError && !deploying && (
                <>
                  <p className="text-xs text-muted">
                    Review your configuration and deploy.
                  </p>
                  <div className="neo-card space-y-2 p-3">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted">Name</span>
                      <span className="text-white">
                        {name || "Custom Agent"}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted">Persona</span>
                      <span className="text-white">
                        {selectedPersona
                          ? PERSONAS.find((p) => p.id === selectedPersona)
                              ?.name ?? selectedPersona
                          : "Custom"}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted">Budget</span>
                      <span className="text-white">{budgetStrk} STRK</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted">Max Bet</span>
                      <span className="text-white">{maxBetStrk} STRK</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted">Sources</span>
                      <span className="text-white">
                        {sources.length} selected
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted">Session</span>
                      <span className="text-white">{sessionDuration}</span>
                    </div>
                  </div>
                </>
              )}

              {/* Deploy progress */}
              {deploying && (
                <div className="space-y-2">
                  {DEPLOY_STEPS.slice(0, deployStep + 1).map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {i < deployStep ? (
                        <span className="text-green-400">&#x2713;</span>
                      ) : (
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neo-brand border-t-transparent" />
                      )}
                      <span
                        className={
                          i < deployStep ? "text-white/60" : "text-white"
                        }
                      >
                        {s}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Success */}
              {deployResult && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-3">
                    <p className="text-xs font-medium text-green-300">
                      Agent deployed successfully!
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-muted">
                      ID: {deployResult.agentId}
                    </p>
                    {deployResult.walletAddress && (
                      <a
                        href={`https://sepolia.starkscan.co/contract/${deployResult.walletAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block truncate font-mono text-[10px] text-neo-brand hover:underline"
                      >
                        {deployResult.walletAddress}
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Error */}
              {deployError && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                  <p className="text-xs font-medium text-red-300">
                    Deployment failed
                  </p>
                  <p className="mt-1 text-[10px] text-red-400">
                    {deployError}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/[0.07] px-5 py-3">
          <button
            onClick={
              step === 1
                ? handleClose
                : () => setStep((s) => Math.max(1, s - 1) as Step)
            }
            className="neo-btn text-xs"
            disabled={deploying}
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>

          {step < 3 ? (
            <button
              onClick={() => setStep((s) => Math.min(3, s + 1) as Step)}
              disabled={step === 1 && !selectedPersona && !isCustom}
              className="neo-btn-primary text-xs disabled:opacity-50"
            >
              Next
            </button>
          ) : deployResult ? (
            <button
              onClick={() => {
                handleClose();
                onDeployed();
              }}
              className="neo-btn-primary text-xs"
            >
              View in Fleet
            </button>
          ) : (
            <button
              onClick={handleDeploy}
              disabled={deploying}
              className="neo-btn-primary text-xs disabled:opacity-50"
            >
              {deploying ? "Deploying..." : "Deploy Agent"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
