"use client";

import { useEffect, useState } from "react";
import AgentReasoningPanel from "./AgentReasoningPanel";
import DataSourcesPanel from "./DataSourcesPanel";

interface AnalyzeModalProps {
  marketId: number;
  question: string;
  onClose: () => void;
}

export default function AnalyzeModal({
  marketId,
  question,
  onClose,
}: AnalyzeModalProps) {
  const [agreeCount, setAgreeCount] = useState(0);
  const [disagreeCount, setDisagreeCount] = useState(0);
  const [reaction, setReaction] = useState<"agree" | "disagree" | null>(null);
  const [signalValue, setSignalValue] = useState(50);
  const [signalNote, setSignalNote] = useState("");
  const [signalSaved, setSignalSaved] = useState(false);

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

  // Load reactions from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("agent-reactions-v1");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const entry = parsed[marketId];
      if (entry) {
        setAgreeCount(entry.agree ?? 0);
        setDisagreeCount(entry.disagree ?? 0);
        setReaction(entry.choice ?? null);
      }
    } catch {}
  }, [marketId]);

  // Load signal from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("user-signals-v1");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const entry = parsed[marketId];
      if (entry) {
        setSignalValue(entry.value ?? 50);
        setSignalNote(entry.note ?? "");
        setSignalSaved(true);
      }
    } catch {}
  }, [marketId]);

  const persistReactions = (
    nextAgree: number,
    nextDisagree: number,
    nextChoice: "agree" | "disagree" | null
  ) => {
    try {
      const raw = localStorage.getItem("agent-reactions-v1");
      const parsed = raw ? JSON.parse(raw) : {};
      parsed[marketId] = { agree: nextAgree, disagree: nextDisagree, choice: nextChoice };
      localStorage.setItem("agent-reactions-v1", JSON.stringify(parsed));
    } catch {}
  };

  const handleReaction = (type: "agree" | "disagree") => {
    let nextAgree = agreeCount;
    let nextDisagree = disagreeCount;
    let nextChoice: "agree" | "disagree" | null = reaction;

    if (reaction === type) {
      if (type === "agree") nextAgree = Math.max(0, agreeCount - 1);
      else nextDisagree = Math.max(0, disagreeCount - 1);
      nextChoice = null;
    } else {
      if (reaction === "agree") nextAgree = Math.max(0, agreeCount - 1);
      if (reaction === "disagree") nextDisagree = Math.max(0, disagreeCount - 1);
      if (type === "agree") nextAgree++;
      else nextDisagree++;
      nextChoice = type;
    }

    setAgreeCount(nextAgree);
    setDisagreeCount(nextDisagree);
    setReaction(nextChoice);
    persistReactions(nextAgree, nextDisagree, nextChoice);
  };

  const handleSaveSignal = () => {
    try {
      const raw = localStorage.getItem("user-signals-v1");
      const parsed = raw ? JSON.parse(raw) : {};
      parsed[marketId] = { value: signalValue, note: signalNote, updatedAt: Date.now() };
      localStorage.setItem("user-signals-v1", JSON.stringify(parsed));
      setSignalSaved(true);
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 w-full sm:max-w-2xl md:max-w-4xl max-h-[90vh] sm:max-h-[85vh] flex flex-col neo-card shadow-neo-lg animate-sheet-up sm:animate-modal-in rounded-t-2xl sm:rounded-xl">
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-2">
          <div className="w-10 h-1 bg-white/20 rounded-full" />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.07] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-7 h-7 rounded-md bg-neo-brand/10 border border-neo-brand/20 flex items-center justify-center shrink-0">
              <svg className="w-3.5 h-3.5 text-neo-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
              </svg>
            </div>
            <div className="min-w-0">
              <span className="font-heading font-bold text-sm text-white block">
                Analyze
              </span>
              <span className="text-[10px] text-white/40 truncate block">
                {question}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center border border-white/15 text-white/60 hover:bg-white/10 text-xs font-mono transition-colors shrink-0 ml-3 rounded-lg"
          >
            ESC
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Consensus + reactions */}
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">
                Community Consensus
              </span>
              <span className="text-[10px] font-mono text-white/30">
                {agreeCount + disagreeCount} votes
              </span>
            </div>

            {/* Visual consensus bar */}
            {(agreeCount + disagreeCount) > 0 && (
              <div className="space-y-1">
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full bg-neo-green/70 transition-all duration-300"
                    style={{
                      width: `${Math.round((agreeCount / (agreeCount + disagreeCount)) * 100)}%`,
                    }}
                  />
                  <div
                    className="h-full bg-neo-red/70 transition-all duration-300"
                    style={{
                      width: `${Math.round((disagreeCount / (agreeCount + disagreeCount)) * 100)}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between text-[9px] font-mono">
                  <span className="text-neo-green/70">
                    {Math.round((agreeCount / (agreeCount + disagreeCount)) * 100)}% agree
                  </span>
                  <span className="text-neo-red/70">
                    {Math.round((disagreeCount / (agreeCount + disagreeCount)) * 100)}% disagree
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleReaction("agree")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all ${
                  reaction === "agree"
                    ? "bg-neo-green/15 text-neo-green border-neo-green/30 shadow-[0_0_12px_-3px] shadow-neo-green/20"
                    : "bg-white/[0.03] text-white/50 border-white/[0.08] hover:border-white/15 hover:text-white/70"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                </svg>
                Agree {agreeCount > 0 && <span className="opacity-60">({agreeCount})</span>}
              </button>
              <button
                onClick={() => handleReaction("disagree")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all ${
                  reaction === "disagree"
                    ? "bg-neo-red/15 text-neo-red border-neo-red/30 shadow-[0_0_12px_-3px] shadow-neo-red/20"
                    : "bg-white/[0.03] text-white/50 border-white/[0.08] hover:border-white/15 hover:text-white/70"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
                </svg>
                Disagree {disagreeCount > 0 && <span className="opacity-60">({disagreeCount})</span>}
              </button>
            </div>
          </div>

          {/* Your signal */}
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">
                Your Signal
              </span>
              <span className={`font-mono text-lg font-bold ${
                signalValue >= 70
                  ? "text-neo-green"
                  : signalValue <= 30
                    ? "text-neo-red"
                    : "text-neo-yellow"
              }`}>
                {signalValue}%
              </span>
            </div>

            {/* Gradient slider track */}
            <div className="relative">
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 rounded-full bg-gradient-to-r from-neo-red/30 via-neo-yellow/30 to-neo-green/30 pointer-events-none" />
              <input
                type="range"
                min={0}
                max={100}
                value={signalValue}
                onChange={(e) => {
                  setSignalValue(Number(e.target.value));
                  setSignalSaved(false);
                }}
                className="relative z-10 w-full accent-white/80"
              />
            </div>
            <div className="flex justify-between text-[9px] font-mono text-white/25">
              <span>Strong No</span>
              <span>Uncertain</span>
              <span>Strong Yes</span>
            </div>

            <div className="flex gap-2">
              <input
                value={signalNote}
                onChange={(e) => {
                  setSignalNote(e.target.value);
                  setSignalSaved(false);
                }}
                placeholder="Add reasoning note..."
                className="neo-input text-xs flex-1"
              />
              <button
                onClick={handleSaveSignal}
                className={`px-4 py-2 rounded-lg border text-xs font-semibold transition-all ${
                  signalSaved
                    ? "border-neo-green/20 bg-neo-green/10 text-neo-green"
                    : "border-white/[0.1] bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white"
                }`}
              >
                {signalSaved ? "Saved" : "Save"}
              </button>
            </div>
          </div>

          {/* Research Data */}
          <DataSourcesPanel question={question} />

          {/* Agent Reasoning */}
          <AgentReasoningPanel marketId={marketId} question={question} />
        </div>
      </div>
    </div>
  );
}
