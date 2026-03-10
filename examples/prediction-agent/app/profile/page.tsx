"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface SessionUser {
  id: string;
  email: string;
  name: string;
}

interface SessionOrg {
  id: string;
  name: string;
  slug: string;
}

interface LinkedWallet {
  walletAddress: string;
  provider: string;
  label: string | null;
  isPrimary: boolean;
  chainId: string;
  lastUsedAt: number;
}

interface SessionData {
  user: SessionUser;
  organization: SessionOrg;
  role: string;
  onboardingCompleted: boolean;
  interests: string[];
  wallets: LinkedWallet[];
}

/* ------------------------------------------------------------------ */
/*  Interest config (mirrors OnboardingWizard)                          */
/* ------------------------------------------------------------------ */

const INTEREST_OPTIONS = [
  { id: "crypto", label: "Crypto", color: "#f59e0b" },
  { id: "politics", label: "Politics", color: "#6366f1" },
  { id: "sports", label: "Sports", color: "#10b981" },
  { id: "tech", label: "Tech", color: "#8b5cf6" },
  { id: "finance", label: "Finance", color: "#06b6d4" },
  { id: "climate", label: "Climate", color: "#22c55e" },
  { id: "culture", label: "Culture", color: "#ec4899" },
  { id: "world", label: "World", color: "#f97316" },
] as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function roleBadgeColor(role: string): string {
  switch (role.toLowerCase()) {
    case "admin":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "owner":
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    default:
      return "bg-neo-brand/20 text-neo-brand border-neo-brand/30";
  }
}

function userInitial(name: string): string {
  return (name || "?").charAt(0).toUpperCase();
}

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function ProfilePage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionData | null>(null);
  const [favorites, setFavorites] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingInterests, setEditingInterests] = useState(false);
  const [selectedInterests, setSelectedInterests] = useState<Set<string>>(
    new Set()
  );
  const [savingInterests, setSavingInterests] = useState(false);

  /* Fetch session + favorites */
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [sessionRes, favRes] = await Promise.all([
          fetch("/api/auth/session", { credentials: "include" }),
          fetch("/api/favorites", { credentials: "include" }),
        ]);

        if (!sessionRes.ok) {
          router.replace("/markets?auth=signin");
          return;
        }

        const sessionData = await sessionRes.json();
        if (!sessionData?.user) {
          router.replace("/markets?auth=signin");
          return;
        }

        if (!cancelled) {
          setSession(sessionData);
          setSelectedInterests(new Set(sessionData.interests ?? []));
        }

        if (favRes.ok) {
          const favData = await favRes.json();
          if (!cancelled) setFavorites(favData.favorites ?? []);
        }
      } catch {
        router.replace("/markets?auth=signin");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  /* Toggle interest */
  const toggleInterest = useCallback((id: string) => {
    setSelectedInterests((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /* Save interests */
  const saveInterests = useCallback(async () => {
    if (selectedInterests.size === 0) return;
    setSavingInterests(true);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interests: Array.from(selectedInterests) }),
      });
      if (res.ok) {
        setSession((prev) =>
          prev
            ? { ...prev, interests: Array.from(selectedInterests) }
            : prev
        );
        setEditingInterests(false);
      }
    } catch {
      /* best-effort */
    } finally {
      setSavingInterests(false);
    }
  }, [selectedInterests]);

  /* Cancel editing */
  const cancelEdit = useCallback(() => {
    setSelectedInterests(new Set(session?.interests ?? []));
    setEditingInterests(false);
  }, [session]);

  /* ---- Loading state ---- */
  if (loading) {
    return (
      <div className="min-h-screen bg-[#12141a] flex flex-col">
        <SiteHeader />
        <main className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-neo-brand/40 border-t-neo-brand rounded-full animate-spin" />
            <p className="text-white/40 text-sm font-body">
              Loading profile...
            </p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!session) return null;

  const { user, organization, role, interests } = session;

  return (
    <div className="min-h-screen bg-[#12141a] flex flex-col">
      <SiteHeader />

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-10">
        {/* ---- Profile card ---- */}
        <div className="bg-[#181b23] border border-white/[0.06] rounded-xl p-6 mb-6">
          <div className="flex items-start gap-5">
            {/* Avatar */}
            <div className="w-16 h-16 rounded-full bg-neo-brand/20 border border-neo-brand/30 flex items-center justify-center flex-shrink-0">
              <span className="text-2xl font-heading font-bold text-neo-brand">
                {userInitial(user.name)}
              </span>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-heading font-semibold text-white truncate">
                  {user.name}
                </h1>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border font-body font-medium ${roleBadgeColor(role)}`}
                >
                  {role}
                </span>
              </div>

              <p className="text-white/50 text-sm font-body mt-1 truncate">
                {user.email}
              </p>

              {organization?.name && (
                <p className="text-white/40 text-xs font-body mt-2">
                  {organization.name}
                </p>
              )}

              <p className="text-white/30 text-xs font-body mt-1">Member</p>
            </div>
          </div>
        </div>

        {/* ---- Interests ---- */}
        <div className="bg-[#181b23] border border-white/[0.06] rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-white/70 uppercase tracking-wider">
              Interests
            </h2>
            {!editingInterests ? (
              <button
                onClick={() => setEditingInterests(true)}
                className="text-xs text-neo-brand/70 hover:text-neo-brand font-body transition-colors"
              >
                Edit
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={cancelEdit}
                  className="text-xs text-white/40 hover:text-white/60 font-body transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveInterests}
                  disabled={savingInterests || selectedInterests.size === 0}
                  className="text-xs px-3 py-1 rounded-lg bg-neo-brand/20 border border-neo-brand/30 text-neo-brand hover:bg-neo-brand/30 font-body transition-colors disabled:opacity-40"
                >
                  {savingInterests ? "Saving..." : "Save"}
                </button>
              </div>
            )}
          </div>

          {editingInterests ? (
            <div className="flex flex-wrap gap-2">
              {INTEREST_OPTIONS.map((opt) => {
                const active = selectedInterests.has(opt.id);
                return (
                  <button
                    key={opt.id}
                    onClick={() => toggleInterest(opt.id)}
                    className="px-3 py-1.5 rounded-full text-sm font-body font-medium border transition-all"
                    style={{
                      backgroundColor: active
                        ? `${opt.color}20`
                        : "transparent",
                      borderColor: active ? `${opt.color}50` : "rgba(255,255,255,0.06)",
                      color: active ? opt.color : "rgba(255,255,255,0.35)",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          ) : interests && interests.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {interests.map((id) => {
                const opt = INTEREST_OPTIONS.find((o) => o.id === id);
                const color = opt?.color ?? "#888";
                const label = opt?.label ?? id;
                return (
                  <span
                    key={id}
                    className="px-3 py-1.5 rounded-full text-sm font-body font-medium border"
                    style={{
                      backgroundColor: `${color}20`,
                      borderColor: `${color}50`,
                      color: color,
                    }}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-white/30 text-sm font-body">
              No interests selected yet.{" "}
              <button
                onClick={() => setEditingInterests(true)}
                className="text-neo-brand/70 hover:text-neo-brand underline"
              >
                Pick some
              </button>
            </p>
          )}
        </div>

        {/* ---- Linked Wallets ---- */}
        <div className="bg-[#181b23] border border-white/[0.06] rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-white/70 uppercase tracking-wider">
              Wallets
            </h2>
            <span className="text-xs text-white/30 font-body">
              {(session.wallets ?? []).length} linked
            </span>
          </div>

          {(session.wallets ?? []).length > 0 ? (
            <div className="space-y-2.5">
              {session.wallets.map((w) => (
                <div
                  key={w.walletAddress}
                  className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3"
                >
                  {/* Icon */}
                  <div className="w-8 h-8 rounded-full bg-[#00d4b8]/10 border border-[#00d4b8]/20 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-[#00d4b8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
                    </svg>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-body text-white/80 font-mono truncate">
                        {w.walletAddress.slice(0, 6)}...{w.walletAddress.slice(-4)}
                      </span>
                      {w.isPrimary && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#00d4b8]/15 text-[#00d4b8] border border-[#00d4b8]/20 font-body font-medium">
                          PRIMARY
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-white/30 font-body">
                        {w.provider !== "unknown" ? w.provider : "Starknet"}
                      </span>
                      <span className="text-white/15">·</span>
                      <span className="text-xs text-white/30 font-body">
                        {w.chainId === "SN_SEPOLIA" ? "Sepolia" : w.chainId}
                      </span>
                      {w.label && (
                        <>
                          <span className="text-white/15">·</span>
                          <span className="text-xs text-white/40 font-body">{w.label}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Remove button */}
                  <button
                    onClick={async () => {
                      try {
                        await fetch(`/api/wallets?address=${encodeURIComponent(w.walletAddress)}`, {
                          method: "DELETE",
                          credentials: "include",
                        });
                        setSession((prev) =>
                          prev ? { ...prev, wallets: prev.wallets.filter((x) => x.walletAddress !== w.walletAddress) } : prev
                        );
                      } catch {}
                    }}
                    className="text-xs text-white/20 hover:text-rose-400/70 transition-colors flex-shrink-0"
                    title="Unlink wallet"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-white/30 text-sm font-body">
              No wallets linked yet. Connect a wallet from the{" "}
              <Link
                href="/markets"
                className="text-neo-brand/70 hover:text-neo-brand underline"
              >
                markets page
              </Link>{" "}
              and it will be automatically linked to your account.
            </p>
          )}
        </div>

        {/* ---- Favorites ---- */}
        <div className="bg-[#181b23] border border-white/[0.06] rounded-xl p-6 mb-6">
          <h2 className="text-sm font-heading font-semibold text-white/70 uppercase tracking-wider mb-3">
            Favorites
          </h2>

          {favorites.length > 0 ? (
            <div className="flex items-center justify-between">
              <p className="text-white/60 text-sm font-body">
                <span className="text-white font-semibold">
                  {favorites.length}
                </span>{" "}
                market{favorites.length !== 1 ? "s" : ""} favorited
              </p>
              <Link
                href="/markets"
                className="text-xs px-3 py-1.5 rounded-lg bg-neo-brand/20 border border-neo-brand/30 text-neo-brand hover:bg-neo-brand/30 font-body transition-colors"
              >
                View Markets
              </Link>
            </div>
          ) : (
            <p className="text-white/30 text-sm font-body">
              No favorites yet. Star markets from the{" "}
              <Link
                href="/markets"
                className="text-neo-brand/70 hover:text-neo-brand underline"
              >
                markets page
              </Link>
              .
            </p>
          )}
        </div>

        {/* ---- Account actions ---- */}
        <div className="bg-[#181b23] border border-white/[0.06] rounded-xl p-6">
          <h2 className="text-sm font-heading font-semibold text-white/70 uppercase tracking-wider mb-3">
            Account
          </h2>
          <div className="flex items-center gap-3">
            <Link
              href="/markets"
              className="text-xs px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-white/50 hover:text-white/70 hover:bg-white/[0.06] font-body transition-colors"
            >
              Back to Markets
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
