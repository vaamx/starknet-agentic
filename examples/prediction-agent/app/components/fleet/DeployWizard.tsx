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

const SOURCE_COLORS: Record<string, string> = {
  polymarket: "#8b5cf6",
  coingecko: "#f59e0b",
  news: "#3b82f6",
  web: "#06b6d4",
  social: "#ec4899",
  onchain: "#f97316",
  github: "#a3a3a3",
  rss: "#6366f1",
};

const SESSION_DURATIONS = [
  { label: "1 day", value: "1d" },
  { label: "1 week", value: "1w" },
  { label: "1 month", value: "1m" },
] as const;

type Step = 1 | 2 | 3;
type DeploymentMode = "managed" | "byo";

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
  const [deploymentMode, setDeploymentMode] = useState<DeploymentMode>("managed");
  const [walletAddress, setWalletAddress] = useState("");
  const [walletPrivateKey, setWalletPrivateKey] = useState("");
  const [spawnServer, setSpawnServer] = useState(true);

  // Step 3: deploy
  const [deploying, setDeploying] = useState(false);
  const [deployStep, setDeployStep] = useState(0);
  const [deployResult, setDeployResult] = useState<{
    agentId: string;
    walletAddress?: string;
    txHash?: string;
    warnings?: string[];
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
    setDeploymentMode("managed");
    setWalletAddress("");
    setWalletPrivateKey("");
    setSpawnServer(true);
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
    if (deploymentMode === "byo" && !walletAddress.trim()) {
      setDeployError("Wallet address is required for Bring Your Own Wallet mode.");
      return;
    }

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
          spawnServer,
          walletAddress:
            deploymentMode === "byo" ? walletAddress.trim() || undefined : undefined,
          walletPrivateKey:
            deploymentMode === "byo" && walletPrivateKey.trim()
              ? walletPrivateKey.trim()
              : undefined,
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
        warnings: Array.isArray(data.warnings)
          ? data.warnings.map((warning: unknown) => String(warning))
          : undefined,
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

        {/* Quick flow step indicator — BROBET-inspired */}
        <div className="flex items-stretch border-b border-white/[0.07]">
          {([
            { num: 1, label: "Persona" },
            { num: 2, label: "Configure" },
            { num: 3, label: "Deploy" },
          ] as const).map((s) => (
            <div
              key={s.num}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider border-r border-white/[0.06] last:border-r-0 transition-colors ${
                s.num === step
                  ? "bg-neo-brand/10 text-neo-brand"
                  : s.num < step
                    ? "text-white/40"
                    : "text-white/20"
              }`}
            >
              <span className={`w-4.5 h-4.5 rounded-full text-[9px] flex items-center justify-center font-bold ${
                s.num < step
                  ? "bg-neo-brand/30 text-neo-brand"
                  : s.num === step
                    ? "bg-neo-brand/25 text-neo-brand"
                    : "bg-white/[0.06] text-white/20"
              }`}>
                {s.num < step ? "\u2713" : s.num}
              </span>
              {s.label}
            </div>
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
                <div className="flex flex-wrap gap-1.5">
                  {ALL_SOURCES.map((src) => (
                    <button
                      key={src}
                      onClick={() => toggleSource(src)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold transition-all ${
                        sources.includes(src)
                          ? "border-white/[0.15] bg-white/[0.08] text-white"
                          : "border-white/[0.06] bg-white/[0.02] text-white/35 hover:border-white/[0.1] hover:text-white/50"
                      }`}
                    >
                      <span
                        className={`inline-block h-2 w-2 rounded-full transition-opacity ${
                          sources.includes(src) ? "opacity-100" : "opacity-30"
                        }`}
                        style={{ backgroundColor: SOURCE_COLORS[src] ?? "#6b7280" }}
                      />
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

              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">
                  Wallet Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDeploymentMode("managed")}
                    className={`rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors ${
                      deploymentMode === "managed"
                        ? "bg-neo-brand/20 text-neo-brand"
                        : "bg-white/[0.04] text-muted hover:bg-white/[0.08]"
                    }`}
                  >
                    Managed Wallet
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeploymentMode("byo")}
                    className={`rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors ${
                      deploymentMode === "byo"
                        ? "bg-neo-brand/20 text-neo-brand"
                        : "bg-white/[0.04] text-muted hover:bg-white/[0.08]"
                    }`}
                  >
                    Bring Your Wallet
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-muted">
                  Managed: platform deploys agent wallet. BYO: attach your existing Starknet wallet.
                </p>
              </div>

              {deploymentMode === "byo" && (
                <div className="space-y-3 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                  <div>
                    <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">
                      Wallet Address
                    </label>
                    <input
                      type="text"
                      value={walletAddress}
                      onChange={(e) => setWalletAddress(e.target.value)}
                      placeholder="0x..."
                      className="neo-input w-full text-xs"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">
                      Wallet Private Key (optional)
                    </label>
                    <input
                      type="password"
                      value={walletPrivateKey}
                      onChange={(e) => setWalletPrivateKey(e.target.value)}
                      placeholder="0x... for signed bets"
                      className="neo-input w-full text-xs"
                    />
                    <p className="mt-1 text-[10px] text-muted">
                      Without key, the agent can research and forecast but cannot execute on-chain bets.
                    </p>
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[11px] text-white/75">
                <input
                  type="checkbox"
                  checked={spawnServer}
                  onChange={(e) => setSpawnServer(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-white/25 bg-transparent accent-[var(--accent)]"
                />
                Provision runtime server for this agent
              </label>
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
                    <div className="flex justify-between text-xs">
                      <span className="text-muted">Wallet Mode</span>
                      <span className="text-white">
                        {deploymentMode === "managed" ? "Managed" : "Bring Your Wallet"}
                      </span>
                    </div>
                    {deploymentMode === "byo" && walletAddress.trim() && (
                      <div className="flex justify-between gap-3 text-xs">
                        <span className="text-muted">Wallet</span>
                        <span className="truncate font-mono text-white/80">
                          {walletAddress.trim()}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs">
                      <span className="text-muted">Runtime</span>
                      <span className="text-white">{spawnServer ? "Provision" : "No runtime"}</span>
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
                        <span className="text-neo-green">&#x2713;</span>
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
                  <div className="rounded-lg border border-neo-green/20 bg-neo-green/10 p-3">
                    <p className="text-xs font-medium text-neo-green">
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
                  {deployResult.warnings && deployResult.warnings.length > 0 && (
                    <div className="rounded-lg border border-neo-yellow/20 bg-neo-yellow/10 p-3">
                      <p className="text-xs font-medium text-neo-yellow">
                        Deployment warnings
                      </p>
                      <ul className="mt-1 list-disc space-y-1 pl-4 text-[10px] text-neo-yellow/90">
                        {deployResult.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
              {deployError && (
                <div className="rounded-lg border border-neo-red/20 bg-neo-red/10 p-3">
                  <p className="text-xs font-medium text-neo-red">
                    Deployment failed
                  </p>
                  <p className="mt-1 text-[10px] text-neo-red">
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
