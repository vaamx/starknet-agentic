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
            <span className="font-heading font-bold text-sm text-neo-brand">
              Analyze
            </span>
            <span className="text-xs text-white/40 truncate">
              {question}
            </span>
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
          {/* Reactions row */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/40">Agent consensus</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleReaction("agree")}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  reaction === "agree"
                    ? "bg-neo-green/15 text-neo-green border-neo-green/30"
                    : "bg-white/[0.04] text-white/50 border-white/10 hover:border-white/20"
                }`}
              >
                Agree {agreeCount > 0 && `(${agreeCount})`}
              </button>
              <button
                onClick={() => handleReaction("disagree")}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  reaction === "disagree"
                    ? "bg-neo-red/15 text-neo-red border-neo-red/30"
                    : "bg-white/[0.04] text-white/50 border-white/10 hover:border-white/20"
                }`}
              >
                Disagree {disagreeCount > 0 && `(${disagreeCount})`}
              </button>
            </div>
          </div>

          {/* Signal slider */}
          <div className="neo-card p-4 border-white/[0.07]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-white/50">Your signal (local)</span>
              <span className="font-mono text-sm text-neo-yellow font-bold">{signalValue}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={signalValue}
              onChange={(e) => {
                setSignalValue(Number(e.target.value));
                setSignalSaved(false);
              }}
              className="w-full accent-neo-yellow"
            />
            <input
              value={signalNote}
              onChange={(e) => {
                setSignalNote(e.target.value);
                setSignalSaved(false);
              }}
              placeholder="Optional note (why?)"
              className="neo-input text-xs mt-2 w-full"
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={handleSaveSignal}
                className="px-3 py-1.5 rounded-lg bg-neo-yellow/15 text-neo-yellow border border-neo-yellow/30 text-xs font-medium hover:bg-neo-yellow/25 transition-colors"
              >
                Save Signal
              </button>
              {signalSaved && (
                <span className="text-xs text-white/30">Saved</span>
              )}
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
