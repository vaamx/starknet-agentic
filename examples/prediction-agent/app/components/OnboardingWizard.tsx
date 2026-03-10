"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface OnboardingWizardProps {
  open: boolean;
  userName: string;
  onComplete: (interests: string[]) => void;
  onClose: () => void;
}

const INTEREST_OPTIONS = [
  { id: "crypto", label: "Crypto", emoji: "\u{1f4b0}", color: "#f59e0b" },
  { id: "politics", label: "Politics", emoji: "\u{1f3db}\u{fe0f}", color: "#6366f1" },
  { id: "sports", label: "Sports", emoji: "\u{26bd}", color: "#10b981" },
  { id: "tech", label: "Tech", emoji: "\u{1f916}", color: "#8b5cf6" },
  { id: "finance", label: "Finance", emoji: "\u{1f4c8}", color: "#06b6d4" },
  { id: "climate", label: "Climate", emoji: "\u{1f30d}", color: "#22c55e" },
  { id: "culture", label: "Culture", emoji: "\u{1f3ac}", color: "#ec4899" },
  { id: "world", label: "World", emoji: "\u{1f310}", color: "#f97316" },
] as const;

export default function OnboardingWizard({
  open,
  userName,
  onComplete,
  onClose,
}: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const panelRef = useRef<HTMLDivElement>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setStep(0);
      setSelected(new Set());
      setSubmitting(false);
      setDirection("forward");
    }
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const toggleInterest = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const goNext = useCallback(async () => {
    if (step === 0 && selected.size === 0) return;

    if (step === 0) {
      // Save interests and advance
      setSubmitting(true);
      try {
        await fetch("/api/onboarding", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interests: Array.from(selected) }),
        });
      } catch {
        // Non-blocking — interests saved best-effort
      }
      setSubmitting(false);
      setDirection("forward");
      setStep(1);
    } else if (step === 1) {
      onComplete(Array.from(selected));
    }
  }, [step, selected, onComplete]);

  if (!open) return null;

  const firstName = userName.split(" ")[0] || userName;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to HiveCaster"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={onClose}
        style={{ animation: "onb-fade-in 0.3s ease-out" }}
      />

      {/* Card */}
      <div
        ref={panelRef}
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-white/[0.08] bg-[#13151d] shadow-2xl shadow-black/60"
        style={{ animation: "onb-scale-in 0.35s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        {/* Top accent line */}
        <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-[#00d4b8]/60 to-transparent" />

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 px-6 pt-5">
          {[0, 1].map((i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all duration-500 ${
                i === step
                  ? "w-8 bg-[#00d4b8]"
                  : i < step
                    ? "w-4 bg-[#00d4b8]/40"
                    : "w-4 bg-white/10"
              }`}
            />
          ))}
        </div>

        {/* Content area with transitions */}
        <div className="relative min-h-[380px]">
          {/* Step 0: Interests */}
          {step === 0 && (
            <div
              className="px-6 pb-6 pt-5"
              style={{
                animation:
                  direction === "forward"
                    ? "onb-slide-in-right 0.4s cubic-bezier(0.16, 1, 0.3, 1)"
                    : "onb-slide-in-left 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              <div className="mb-1 text-center">
                <h2 className="font-heading text-xl font-bold tracking-tight text-white">
                  What are you into, {firstName}?
                </h2>
                <p className="mt-1.5 text-sm text-white/45">
                  Pick topics to personalize your market feed
                </p>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {INTEREST_OPTIONS.map((opt) => {
                  const isSelected = selected.has(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => toggleInterest(opt.id)}
                      className={`group relative flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3.5 transition-all duration-200 ${
                        isSelected
                          ? "border-[#00d4b8]/40 bg-[#00d4b8]/[0.08] shadow-[0_0_20px_-6px_rgba(0,212,184,0.2)]"
                          : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]"
                      }`}
                      aria-pressed={isSelected}
                    >
                      {/* Checkmark */}
                      {isSelected && (
                        <div
                          className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#00d4b8] text-[10px] font-bold text-[#0d0f14]"
                          style={{ animation: "onb-pop 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
                        >
                          &#10003;
                        </div>
                      )}

                      <span
                        className="text-2xl transition-transform duration-200 group-hover:scale-110"
                        style={{
                          filter: isSelected ? "none" : "grayscale(0.3)",
                        }}
                      >
                        {opt.emoji}
                      </span>
                      <span
                        className={`text-xs font-semibold tracking-wide transition-colors duration-200 ${
                          isSelected ? "text-[#00d4b8]" : "text-white/50 group-hover:text-white/70"
                        }`}
                      >
                        {opt.label}
                      </span>

                      {/* Colored underline when selected */}
                      <div
                        className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full transition-all duration-300"
                        style={{
                          backgroundColor: isSelected ? opt.color : "transparent",
                          opacity: isSelected ? 0.6 : 0,
                        }}
                      />
                    </button>
                  );
                })}
              </div>

              {/* Continue button */}
              <button
                type="button"
                onClick={goNext}
                disabled={selected.size === 0 || submitting}
                className={`mt-5 w-full rounded-xl border px-4 py-3 font-heading text-sm font-bold tracking-wide transition-all duration-200 ${
                  selected.size > 0
                    ? "border-[#00d4b8]/30 bg-[#00d4b8]/20 text-[#00d4b8] hover:bg-[#00d4b8]/30 active:scale-[0.98]"
                    : "cursor-not-allowed border-white/[0.06] bg-white/[0.02] text-white/20"
                }`}
              >
                {submitting ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#00d4b8]/30 border-t-[#00d4b8]" />
                    Saving...
                  </span>
                ) : (
                  `Continue${selected.size > 0 ? ` (${selected.size})` : ""}`
                )}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="mt-2 w-full py-2 text-center text-xs text-white/25 transition-colors hover:text-white/45"
              >
                Skip for now
              </button>
            </div>
          )}

          {/* Step 1: Welcome confirmation */}
          {step === 1 && (
            <div
              className="flex flex-col items-center px-6 pb-6 pt-8"
              style={{
                animation: "onb-slide-in-right 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              {/* Animated check circle */}
              <div
                className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#00d4b8]/20 bg-[#00d4b8]/10"
                style={{ animation: "onb-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both" }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-8 w-8 text-[#00d4b8]"
                  style={{ animation: "onb-draw-check 0.4s ease-out 0.4s both" }}
                >
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              <h2
                className="font-heading text-2xl font-bold tracking-tight text-white"
                style={{ animation: "onb-fade-up 0.4s ease-out 0.2s both" }}
              >
                Welcome, {firstName}!
              </h2>
              <p
                className="mt-1.5 text-center text-sm text-white/45"
                style={{ animation: "onb-fade-up 0.4s ease-out 0.3s both" }}
              >
                Your feed is personalized. Here&apos;s what you&apos;re tracking:
              </p>

              {/* Interest pills */}
              <div
                className="mt-5 flex flex-wrap justify-center gap-2"
                style={{ animation: "onb-fade-up 0.4s ease-out 0.35s both" }}
              >
                {Array.from(selected).map((id) => {
                  const opt = INTEREST_OPTIONS.find((o) => o.id === id);
                  if (!opt) return null;
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold"
                      style={{
                        borderColor: `${opt.color}33`,
                        backgroundColor: `${opt.color}15`,
                        color: opt.color,
                      }}
                    >
                      {opt.emoji} {opt.label}
                    </span>
                  );
                })}
              </div>

              {/* Stats preview */}
              <div
                className="mt-6 grid w-full grid-cols-3 gap-3"
                style={{ animation: "onb-fade-up 0.4s ease-out 0.4s both" }}
              >
                {[
                  { label: "Markets", value: "87+" },
                  { label: "AI Agents", value: "5" },
                  { label: "Data Sources", value: "12" },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-center"
                  >
                    <div className="font-heading text-lg font-bold text-white">{stat.value}</div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/35">
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>

              {/* Start exploring */}
              <button
                type="button"
                onClick={goNext}
                className="mt-6 w-full rounded-xl border border-[#00d4b8]/30 bg-[#00d4b8]/20 px-4 py-3 font-heading text-sm font-bold tracking-wide text-[#00d4b8] transition-all duration-200 hover:bg-[#00d4b8]/30 active:scale-[0.98]"
                style={{ animation: "onb-fade-up 0.4s ease-out 0.45s both" }}
              >
                Start Exploring
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Animations */}
      <style jsx>{`
        @keyframes onb-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes onb-scale-in {
          from { opacity: 0; transform: scale(0.92) translateY(12px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes onb-slide-in-right {
          from { opacity: 0; transform: translateX(24px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes onb-slide-in-left {
          from { opacity: 0; transform: translateX(-24px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes onb-pop {
          from { opacity: 0; transform: scale(0); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes onb-fade-up {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes onb-draw-check {
          from { opacity: 0; stroke-dasharray: 30; stroke-dashoffset: 30; }
          to { opacity: 1; stroke-dasharray: 30; stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}
