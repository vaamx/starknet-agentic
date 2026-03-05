"use client";

import { useEffect, useMemo, useState } from "react";
import { postJsonWithCsrf } from "@/lib/secure-fetch";
import { reviewMarketQuestion, type MarketCategory } from "@/lib/market-quality";

interface MarketCreatorProps {
  onClose: () => void;
  onCreated?: () => Promise<void> | void;
}

const QUESTION_TEMPLATES: Array<{
  label: string;
  question: string;
  category: MarketCategory;
  criteria: string;
}> = [
  {
    label: "Crypto Price",
    question: "Will ETH close above $6,000 by December 31, 2026?",
    category: "crypto",
    criteria:
      "Resolve YES if ETH/USD daily close on Coinbase for 2026-12-31 is above 6000. Resolve NO otherwise.",
  },
  {
    label: "Macro",
    question: "Will US CPI YoY be below 2.5% in Q4 2026?",
    category: "macro",
    criteria:
      "Resolve YES if latest published US CPI YoY reading in Q4 2026 is below 2.5% using BLS official release.",
  },
  {
    label: "Policy",
    question:
      "Will a US federal stablecoin bill pass both chambers before July 1, 2027?",
    category: "politics",
    criteria:
      "Resolve YES if both US House and Senate pass the same stablecoin bill before 2027-07-01 UTC.",
  },
];

const DURATION_PRESETS = [7, 30, 90, 180, 365];

export default function MarketCreator({ onClose, onCreated }: MarketCreatorProps) {
  const [question, setQuestion] = useState("");
  const [days, setDays] = useState("30");
  const [feeBps, setFeeBps] = useState("200");
  const [category, setCategory] = useState<MarketCategory>("crypto");
  const [resolutionCriteria, setResolutionCriteria] = useState("");
  const [executionSurface, setExecutionSurface] = useState<"direct" | "starkzap">(
    "direct"
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const review = useMemo(() => reviewMarketQuestion(question), [question]);
  const parsedDays = Number.parseInt(days || "0", 10);
  const parsedFeeBps = Number.parseInt(feeBps || "0", 10);
  const validDays = Number.isFinite(parsedDays) && parsedDays >= 1 && parsedDays <= 3650;
  const validFee = Number.isFinite(parsedFeeBps) && parsedFeeBps >= 0 && parsedFeeBps <= 1000;
  const resolutionDate = useMemo(() => {
    if (!Number.isFinite(parsedDays) || parsedDays <= 0) return null;
    return new Date(Date.now() + parsedDays * 24 * 60 * 60 * 1000);
  }, [parsedDays]);
  const canCreate =
    question.trim().length > 0 &&
    !creating &&
    review.score >= 60 &&
    review.issues.length === 0 &&
    validDays &&
    validFee;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const applyTemplate = (index: number) => {
    const template = QUESTION_TEMPLATES[index];
    if (!template) return;
    setQuestion(template.question);
    setCategory(template.category);
    setResolutionCriteria(template.criteria);
    setError(null);
  };

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreating(true);
    setError(null);

    try {
      const response = await postJsonWithCsrf("/api/markets", {
        question: question.trim(),
        days: parsedDays,
        feeBps: parsedFeeBps,
        category,
        resolutionCriteria: resolutionCriteria.trim() || undefined,
        executionSurface,
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const issues = Array.isArray(data?.issues)
          ? ` (${data.issues.join("; ")})`
          : "";
        throw new Error((data?.error ?? "Failed to create market") + issues);
      }

      if (onCreated) {
        await onCreated();
      }
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to create market");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-5xl max-h-[90vh] overflow-hidden neo-card border-2 border-black bg-white shadow-neo-lg animate-modal-in">
        <div className="flex items-center justify-between px-5 py-3.5 bg-neo-purple border-b-2 border-black">
          <div>
            <h3 className="font-heading font-bold text-sm text-white uppercase tracking-wider">
              Create Forecast Market
            </h3>
            <p className="text-[10px] font-mono text-white/75 mt-0.5">
              Production-grade market preflight with quality validation
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center border-2 border-white/30 text-white hover:bg-white/10 text-xs font-mono transition-colors"
          >
            ESC
          </button>
        </div>

        <div className="p-5 overflow-y-auto max-h-[calc(90vh-70px)]">
          <div className="grid lg:grid-cols-[1.35fr,0.9fr] gap-5">
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">
                  Quick Templates
                </p>
                <div className="flex flex-wrap gap-2">
                  {QUESTION_TEMPLATES.map((template, index) => (
                    <button
                      key={template.label}
                      onClick={() => applyTemplate(index)}
                      className="text-[10px] font-mono border border-black px-2.5 py-1 hover:bg-cream"
                    >
                      {template.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">
                  Market Question
                </label>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Will ETH close above $6,000 by December 31, 2026?"
                  autoFocus
                  rows={3}
                  className="neo-input w-full resize-y min-h-[90px]"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">
                  Resolution Criteria (Recommended)
                </label>
                <textarea
                  value={resolutionCriteria}
                  onChange={(e) => setResolutionCriteria(e.target.value)}
                  placeholder="Define exact data source and rule for YES/NO resolution."
                  rows={4}
                  className="neo-input w-full resize-y min-h-[110px]"
                />
              </div>

              <div className="grid md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as MarketCategory)}
                    className="neo-input w-full"
                  >
                    <option value="crypto">Crypto</option>
                    <option value="macro">Macro</option>
                    <option value="politics">Politics</option>
                    <option value="tech">Tech</option>
                    <option value="sports">Sports</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">
                    Duration
                  </label>
                  <input
                    type="number"
                    value={days}
                    min="1"
                    max="3650"
                    onChange={(e) => setDays(e.target.value)}
                    className="neo-input w-full"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">
                    Fee (bps)
                  </label>
                  <input
                    type="number"
                    value={feeBps}
                    min="0"
                    max="1000"
                    onChange={(e) => setFeeBps(e.target.value)}
                    className="neo-input w-full"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">
                    Surface
                  </label>
                  <select
                    value={executionSurface}
                    onChange={(e) =>
                      setExecutionSurface(e.target.value as "direct" | "starkzap")
                    }
                    className="neo-input w-full"
                  >
                    <option value="direct">direct</option>
                    <option value="starkzap">starkzap</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setDays(String(preset))}
                    className={`text-[10px] font-mono border px-2 py-1 ${
                      Number(days) === preset
                        ? "border-black bg-neo-yellow/30"
                        : "border-black/40 hover:border-black"
                    }`}
                  >
                    {preset}d
                  </button>
                ))}
              </div>

              <button
                onClick={handleCreate}
                disabled={!canCreate}
                className="neo-btn-dark w-full text-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
              >
                {creating ? "Deploying Market..." : "Deploy Market Contract"}
              </button>

              {error && (
                <p className="text-[10px] text-red-500 font-mono leading-relaxed">
                  {error}
                </p>
              )}
            </div>

            <aside className="space-y-3">
              <div className="border-2 border-black bg-cream p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    Preflight Score
                  </p>
                  <span
                    className={`text-xs font-mono font-bold ${
                      review.score >= 80
                        ? "text-neo-green"
                        : review.score >= 60
                          ? "text-neo-orange"
                          : "text-neo-pink"
                    }`}
                  >
                    {review.score}/100
                  </span>
                </div>
                <div className="mt-2 h-2 border border-black bg-white">
                  <div
                    className={`h-full ${
                      review.score >= 80
                        ? "bg-neo-green"
                        : review.score >= 60
                          ? "bg-neo-orange"
                          : "bg-neo-pink"
                    }`}
                    style={{ width: `${review.score}%` }}
                  />
                </div>
                <div className="mt-2 text-[10px] font-mono text-gray-500 space-y-1">
                  <p>Binary: {review.isBinary ? "yes" : "no"}</p>
                  <p>Time bound: {review.hasTimeBound ? "yes" : "no"}</p>
                  <p>Category hint: {review.categoryHint}</p>
                </div>
              </div>

              <div className="border-2 border-black bg-white p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">
                  Resolution Preview
                </p>
                <div className="space-y-1 text-[11px] font-mono">
                  <p>
                    Duration: <span className="font-bold">{parsedDays || 0} days</span>
                  </p>
                  <p>
                    Fee:{" "}
                    <span className="font-bold">
                      {(Number.isFinite(parsedFeeBps) ? parsedFeeBps : 0) / 100}%
                    </span>
                  </p>
                  {!validDays && (
                    <p className="text-neo-pink text-[10px]">
                      Duration must be between 1 and 3650 days.
                    </p>
                  )}
                  {!validFee && (
                    <p className="text-neo-pink text-[10px]">
                      Fee must be between 0 and 1000 bps.
                    </p>
                  )}
                  <p>
                    Resolves:{" "}
                    <span className="font-bold">
                      {resolutionDate
                        ? resolutionDate.toLocaleString()
                        : "invalid duration"}
                    </span>
                  </p>
                </div>
              </div>

              <div className="border-2 border-black bg-white p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">
                  Quality Findings
                </p>
                {review.issues.length === 0 && review.warnings.length === 0 ? (
                  <p className="text-[11px] font-mono text-neo-green">
                    No blockers detected.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {review.issues.map((issue) => (
                      <p key={issue} className="text-[10px] font-mono text-neo-pink">
                        - {issue}
                      </p>
                    ))}
                    {review.warnings.map((warning) => (
                      <p
                        key={warning}
                        className="text-[10px] font-mono text-neo-orange"
                      >
                        - {warning}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
