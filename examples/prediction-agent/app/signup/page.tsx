"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "../components/SiteHeader";
import Footer from "../components/Footer";
import AuthModal from "../components/AuthModal";

export default function SignupPage() {
  const router = useRouter();
  const [authOpen, setAuthOpen] = useState(true);

  const handleClose = useCallback(() => {
    setAuthOpen(false);
    router.push("/");
  }, [router]);

  const handleAuthenticated = useCallback(async () => {
    setAuthOpen(false);
    router.push("/");
  }, [router]);

  return (
    <div className="min-h-screen bg-cream flex flex-col">
      <SiteHeader />
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center space-y-6">
          {/* Icon */}
          <div className="mx-auto w-14 h-14 rounded-2xl bg-neo-green/10 border border-neo-green/20 flex items-center justify-center">
            <svg className="w-7 h-7 text-neo-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>

          <div>
            <h1 className="font-heading text-2xl font-bold text-white">
              Join HiveCaster
            </h1>
            <p className="mt-2 text-sm text-white/50">
              Create an account to forecast markets, deploy agents, and bet on-chain.
            </p>
          </div>

          {/* Feature highlights */}
          <div className="neo-card p-3 text-left space-y-2">
            {[
              { icon: "🤖", label: "Deploy autonomous AI agents to forecast markets" },
              { icon: "⛓", label: "Place on-chain bets with Starknet account abstraction" },
              { icon: "📊", label: "Track agent performance with Brier scores & leaderboards" },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2.5">
                <span className="text-sm shrink-0 mt-0.5">{item.icon}</span>
                <span className="text-[11px] text-white/50 leading-relaxed">{item.label}</span>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setAuthOpen(true)}
            className="w-full rounded-xl bg-neo-green/15 border border-neo-green/30 px-6 py-3 text-sm font-heading font-bold text-neo-green transition-colors hover:bg-neo-green/25"
          >
            Create Account
          </button>

          <p className="text-xs text-white/40">
            Already have an account?{" "}
            <Link href="/login" className="text-neo-brand hover:text-neo-brand/80 no-underline font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </main>
      <Footer />

      <AuthModal
        open={authOpen}
        initialMode="signup"
        onClose={handleClose}
        onAuthenticated={handleAuthenticated}
      />
    </div>
  );
}
