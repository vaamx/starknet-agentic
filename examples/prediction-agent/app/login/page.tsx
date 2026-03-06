"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "../components/SiteHeader";
import Footer from "../components/Footer";
import AuthModal from "../components/AuthModal";

export default function LoginPage() {
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
          <div className="mx-auto w-14 h-14 rounded-2xl bg-neo-brand/10 border border-neo-brand/20 flex items-center justify-center">
            <svg className="w-7 h-7 text-neo-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>

          <div>
            <h1 className="font-heading text-2xl font-bold text-white">
              Welcome back
            </h1>
            <p className="mt-2 text-sm text-white/50">
              Sign in to access your markets, agent fleet, and predictions.
            </p>
          </div>

          {/* Value props */}
          <div className="flex items-center justify-center gap-4 text-[10px] text-white/30">
            <span className="flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-neo-green" />Account Abstraction</span>
            <span className="flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-neo-blue" />Gasless</span>
            <span className="flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-neo-purple" />Session Keys</span>
          </div>

          <button
            type="button"
            onClick={() => setAuthOpen(true)}
            className="w-full rounded-xl bg-neo-brand/15 border border-neo-brand/30 px-6 py-3 text-sm font-heading font-bold text-neo-brand transition-colors hover:bg-neo-brand/25"
          >
            Sign In
          </button>

          <p className="text-xs text-white/40">
            New here?{" "}
            <Link href="/signup" className="text-neo-brand hover:text-neo-brand/80 no-underline font-medium">
              Create an account
            </Link>
          </p>
        </div>
      </main>
      <Footer />

      <AuthModal
        open={authOpen}
        initialMode="signin"
        onClose={handleClose}
        onAuthenticated={handleAuthenticated}
      />
    </div>
  );
}
